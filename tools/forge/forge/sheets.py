"""``forge sheets``: labelled 4x contact sheets for review with Read (ASSET_PIPELINE §9.5).

``build/sheets/<atlas>.png`` shows every frame of every manifest entry in that atlas, built
in memory from the sources exactly as ``forge build`` builds them (so a sheet never depends on
the cache or on stale outputs). ``--only <id>`` writes ``build/sheets/only_<id>.png`` with just
that asset (one sheet per ID). An alias entry (``veh.<type>_parked``, SSP-100) repeats its
target's frames, so atlas sheets leave it out; ``--only <alias>`` shows the target's frames under
the alias's frame IDs.

Layout, top to bottom:

- a title line (atlas or asset, frame count, scale);
- the palette strip: the 32 Kerbside-32 swatches, each labelled with its two-digit index;
- one group per asset (sorted by id): a header line (id, technique, cell, frame count), then
  rows of frame tiles. **Bessie h00** (``veh.sweeper:body:h00:0``) is the first tile of every
  group, for scale. A state with one frame per direction is one run of directions, left to
  right; an animated state gets one run of frames per direction, left to right, so a cycle
  reads in sequence (ART_BIBLE §15.1). Runs wrap at :data:`MAX_ROW_PX` (a run longer than a
  row, such as the 47 kerb blob tiles, continues on the next row);
- for a ``wrap: true`` procedural tile (its params file says so; SSP-040, ASSET_PIPELINE
  §10.8), a row of **3x3 tiled previews** after its frames: each frame repeated 3x3 at 4x on
  the light background, labelled ``3x3 <frame id>``, so a seam shows as a line or a break in
  the pattern at the tile joins;
- for a font (a ``.glyphs.txt`` source; SSP-068), **specimen rows** after its frames: the whole
  character set, the kerning pairs and a sample line typeset with the font's metrics
  (:func:`forge.glyphs.typeset`), plain and outlined, once at **1x** (the legibility check)
  and once at 4x, each on the light and the dark background.

Each tile is the frame's full ID as its label, then the frame at 4x on the light background
(palette 06) and again on the dark background (palette 01). Each panel is exactly the cell, so
the panel edge is the cell edge (diagonal headings can be checked against it). Every colour
comes from ``kerbside32.json`` by index; labels use Pillow's built-in bitmap font (no
anti-aliasing), so a sheet holds palette colours only and is written as an indexed PNG via
:mod:`forge.pngio` (byte-stable). Sheets are ``build/`` artefacts and are never shipped.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from pathlib import Path

import numpy as np
import numpy.typing as npt
from PIL import Image, ImageDraw, ImageFont

from forge import palette as _palette_mod
from forge.build import BuildError, Frame, build_asset, is_font
from forge.glyphs import GLYPH_STATE, OUTLINE_STATE, GlyphError, read_glyphs, specimen_lines, typeset
from forge.manifest import ATLASES, AssetEntry, ManifestError, load_manifest
from forge.palette import PALETTE_SIZE, TRANSPARENT, Palette, load_palette
from forge.procedural import wrap_tile
from forge.pngio import encode_indexed_png, write_bytes_if_changed

__all__ = [
    "BESSIE_FRAME",
    "BG_DARK",
    "BG_LIGHT",
    "PREVIEW_REPEAT",
    "SCALE",
    "SHEETS_DIR",
    "Sheet",
    "SheetError",
    "TilePlacement",
    "cli",
    "compose_sheet",
    "font_specimens",
    "render_text",
    "write_sheets",
]

SCALE = 4
"""Every frame and swatch is drawn at 4x (ASSET_PIPELINE §9.5)."""

LABEL_SCALE = 2
"""Labels: Pillow's bitmap font drawn at 2x so they stay legible beside 4x sprites."""

BG_LIGHT = 6
"""Light panel background: palette 06 ``kerb`` (value read from kerbside32.json)."""

BG_DARK = 1
"""Dark panel background: palette 01 ``tar`` (value read from kerbside32.json)."""

SHEET_BG = 3
"""Sheet background between tiles: palette 03 ``asphalt_lt``, distinct from both panels."""

LABEL_INK = 7
"""Label text: palette 07 ``chalk``."""

HEADER_INK = 16
"""Group headers and the title: palette 16 ``lemon``."""

BESSIE_ID = "veh.sweeper"
BESSIE_FRAME = "veh.sweeper:body:h00:0"
"""The scale reference shown beside every group (ASSET_PIPELINE §9.5)."""

SHEETS_DIR = Path("build") / "sheets"

MAX_ROW_PX = 6400
"""Rows of tiles wrap before this width (a whole direction run stays on one row)."""

MARGIN = 16
TILE_GAP = 16
ROW_GAP = 12
GROUP_GAP = 28
PANEL_GAP = 4
LABEL_GAP = 4
SWATCH_PX = 8 * SCALE
SWATCH_BORDER = 2

U8Array = npt.NDArray[np.uint8]
I16Array = npt.NDArray[np.int16]

_FONT = ImageFont.load_default_imagefont()


class SheetError(Exception):
    """A sheet cannot be made (bad manifest, unknown ID, an asset that does not build)."""


@dataclass(frozen=True)
class TilePlacement:
    """Where one labelled tile landed: label origin, light panel and dark panel (top-left)."""

    label: str
    frame_id: str
    label_xy: tuple[int, int]
    light_xy: tuple[int, int]
    dark_xy: tuple[int, int]
    size: tuple[int, int]
    """The frame's ``(w, h)`` at 1x."""
    scale_ref: bool = False
    preview: bool = False
    """A 3x3 tiled preview of a wrap tile (one panel, ``size`` is still the frame at 1x)."""
    specimen: bool = False
    """A font specimen (typeset text, not a frame of the atlas)."""
    scale: int = SCALE
    """How many sheet pixels each frame pixel takes (1 for the 1x font specimens)."""


@dataclass
class Sheet:
    """A composed sheet: the index canvas and what was placed where."""

    name: str
    indices: U8Array
    tiles: list[TilePlacement] = field(default_factory=list)
    swatches: list[tuple[int, tuple[int, int]]] = field(default_factory=list)
    """``(palette index, top-left)`` of each palette-strip swatch."""

    @property
    def width(self) -> int:
        return int(self.indices.shape[1])

    @property
    def height(self) -> int:
        return int(self.indices.shape[0])

    def png(self, palette: Palette) -> bytes:
        return encode_indexed_png(self.indices, palette)


# ---------------------------------------------------------------------------------------------
# Text


def render_text(text: str, scale: int = LABEL_SCALE) -> npt.NDArray[np.bool_]:
    """A boolean ink mask of ``text`` in Pillow's built-in bitmap font, scaled by ``scale``."""
    left, top, right, bottom = _FONT.getbbox(text)
    w, h = max(1, right), max(1, bottom)
    im = Image.new("L", (w, h), 0)
    ImageDraw.Draw(im).text((0, 0), text, fill=255, font=_FONT)
    mask = np.asarray(im, dtype=np.uint8) >= 128
    return np.repeat(np.repeat(mask, scale, axis=0), scale, axis=1)


def _text_size(text: str, scale: int = LABEL_SCALE) -> tuple[int, int]:
    _, _, right, bottom = _FONT.getbbox(text)
    return max(1, right) * scale, max(1, bottom) * scale


_LINE_H = _text_size("Ag:0")[1]


# ---------------------------------------------------------------------------------------------
# Layout


@dataclass
class _Tile:
    frame: Frame
    label: str
    width: int
    height: int
    scale_ref: bool = False
    preview: bool = False
    specimen: bool = False
    scale: int = SCALE


@dataclass
class _Item:
    """One thing in the vertical flow: a text line, the palette strip or a row of tiles."""

    kind: str
    height: int
    width: int
    text: str = ""
    ink: int = LABEL_INK
    tiles: list[_Tile] = field(default_factory=list)


def _tile(frame: Frame, label: str, scale_ref: bool = False, scale: int = SCALE, specimen: bool = False) -> _Tile:
    pw, ph = frame.width * scale, frame.height * scale
    lw, _ = _text_size(label)
    return _Tile(
        frame, label, max(2 * pw + PANEL_GAP, lw), _LINE_H + LABEL_GAP + ph, scale_ref, specimen=specimen, scale=scale
    )


def font_specimens(entry: AssetEntry, root: Path) -> list[list[_Tile]]:
    """Specimen rows of a font entry: plain and outlined text at 1x, then at 4x."""
    try:
        font = read_glyphs(root / entry.source, entry.source)
    except GlyphError as exc:
        raise SheetError(f"{entry.id}: {exc}") from None
    lines = specimen_lines(font)
    rows: list[list[_Tile]] = []
    for scale in (1, SCALE):
        row: list[_Tile] = []
        for state, outlined in ((GLYPH_STATE, False), (OUTLINE_STATE, True)):
            indices = typeset(font, lines, outlined=outlined)
            label = f"specimen {entry.id} {state} {scale}x"
            frame = Frame(
                frame_id=label, asset_id=entry.id, state=state, dir="-", n=0, indices=indices, pivot=(0, 0), atlas=entry.atlas
            )
            row.append(_tile(frame, label, scale=scale, specimen=True))
        rows.append(row)
    return rows


PREVIEW_REPEAT = 3
"""A wrap tile's preview repeats each frame this many times on both axes."""


def _preview_tile(frame: Frame) -> _Tile:
    label = f"3x3 {frame.frame_id}"
    pw, ph = frame.width * SCALE * PREVIEW_REPEAT, frame.height * SCALE * PREVIEW_REPEAT
    lw, _ = _text_size(label)
    return _Tile(frame, label, max(pw, lw), _LINE_H + LABEL_GAP + ph, preview=True)


def _preview_rows(frames: dict[str, Frame]) -> list[list[_Tile]]:
    rows: list[list[_Tile]] = [[]]
    for fid in sorted(frames, key=lambda f: (frames[f].state, frames[f].dir, frames[f].n)):
        t = _preview_tile(frames[fid])
        if rows[-1] and _row_width([*rows[-1], t]) > MAX_ROW_PX:
            rows.append([])
        rows[-1].append(t)
    return [r for r in rows if r]


def _runs(entry: AssetEntry, frames: dict[str, Frame]) -> list[list[Frame]]:
    """Direction runs in manifest order: one run per state (n = 1) or per (state, dir) (n > 1)."""
    runs: list[list[Frame]] = []
    for state in entry.states:
        n = entry.frames[state]
        if n == 1:
            runs.append([frames[f"{entry.id}:{state}:{d}:0"] for d in entry.dirs])
        else:
            runs.extend([frames[f"{entry.id}:{state}:{d}:{k}"] for k in range(n)] for d in entry.dirs)
    return runs


def _row_width(tiles: Sequence[_Tile]) -> int:
    return sum(t.width for t in tiles) + TILE_GAP * max(0, len(tiles) - 1)


def _group_rows(entry: AssetEntry, frames: dict[str, Frame], bessie: Frame | None) -> list[list[_Tile]]:
    tiles_by_id = {fid: _tile(f, fid) for fid, f in frames.items()}
    tile_w = max(t.width for t in tiles_by_id.values())
    for t in tiles_by_id.values():
        t.width = tile_w  # uniform columns within a group
    cols = max(1, (MAX_ROW_PX + TILE_GAP) // (tile_w + TILE_GAP))
    rows: list[list[_Tile]] = []
    current: list[_Tile] = []
    for run in _runs(entry, frames):
        run_tiles = [tiles_by_id[f.frame_id] for f in run]
        if len(run) == 1 or entry.frames[run[0].state] == 1:
            # A run of single-frame directions may wrap anywhere.
            for t in run_tiles:
                if len(current) >= cols:
                    rows.append(current)
                    current = []
                current.append(t)
            rows.append(current)
            current = []
            continue
        # An animated run stays on one row; several runs share a row while they fit. A run longer
        # than a whole row (the 47 kerb blob tiles) continues on the next rows.
        if current and len(current) + len(run_tiles) > cols:
            rows.append(current)
            current = []
        while len(run_tiles) > cols:
            rows.append(run_tiles[:cols])
            run_tiles = run_tiles[cols:]
        current.extend(run_tiles)
    if current:
        rows.append(current)
    rows = [r for r in rows if r]
    if bessie is not None and rows:
        rows[0].insert(0, _tile(bessie, f"scale: {BESSIE_FRAME}", scale_ref=True))
    return rows


def _flow(
    title: str,
    groups: Sequence[tuple[AssetEntry, dict[str, Frame]]],
    bessie: Frame | None,
    wrap_ids: frozenset[str] = frozenset(),
    specimens: dict[str, list[list[_Tile]]] | None = None,
) -> list[_Item]:
    items: list[_Item] = []
    tw, th = _text_size(title)
    items.append(_Item("text", th, tw, text=title, ink=HEADER_INK))
    strip_w = PALETTE_SIZE * SWATCH_PX + (PALETTE_SIZE - 1) * PANEL_GAP
    items.append(_Item("palette", SWATCH_PX + LABEL_GAP + _text_size("00")[1], strip_w))
    for entry, frames in groups:
        header = (
            f"{entry.id}  ({entry.technique}, cell {entry.width}x{entry.height}, {len(frames)} frames, "
            f"atlas {entry.atlas})"
        )
        hw, hh = _text_size(header)
        items.append(_Item("gap", GROUP_GAP, 0))
        items.append(_Item("text", hh, hw, text=header, ink=HEADER_INK))
        rows = _group_rows(entry, frames, bessie)
        if entry.id in wrap_ids:
            rows += _preview_rows(frames)
        rows += (specimens or {}).get(entry.id, [])
        for row in rows:
            items.append(_Item("tiles", max(t.height for t in row), _row_width(row), tiles=row))
    return items


def _paint_mask(canvas: U8Array, mask: npt.NDArray[np.bool_], x: int, y: int, ink: int) -> None:
    h, w = mask.shape
    region = canvas[y : y + h, x : x + w]
    region[mask[: region.shape[0], : region.shape[1]]] = ink


def _paint_frame(canvas: U8Array, indices: I16Array, x: int, y: int, bg: int, scale: int = SCALE) -> None:
    big = np.repeat(np.repeat(indices, scale, axis=0), scale, axis=1)
    h, w = big.shape
    canvas[y : y + h, x : x + w] = np.where(big == TRANSPARENT, bg, big).astype(np.uint8)


def compose_sheet(
    name: str,
    title: str,
    groups: Sequence[tuple[AssetEntry, dict[str, Frame]]],
    bessie: Frame | None,
    wrap_ids: frozenset[str] = frozenset(),
    specimens: dict[str, list[list[_Tile]]] | None = None,
) -> Sheet:
    """Lay out and paint one sheet. ``groups`` are ``(entry, {frame_id: Frame})`` in display order.

    Every asset in ``wrap_ids`` also gets a row of 3x3 tiled previews after its frames, and
    every asset in ``specimens`` (fonts) gets those rows after its frames.
    """
    items = _flow(title, groups, bessie, wrap_ids, specimens)
    width = MARGIN * 2 + max(it.width for it in items)
    height = MARGIN * 2 + sum(it.height for it in items) + ROW_GAP * (len(items) - 1)
    canvas = np.full((height, width), SHEET_BG, dtype=np.uint8)
    sheet = Sheet(name=name, indices=canvas)
    y = MARGIN
    for it in items:
        if it.kind == "text":
            _paint_mask(canvas, render_text(it.text), MARGIN, y, it.ink)
        elif it.kind == "palette":
            for i in range(PALETTE_SIZE):
                x = MARGIN + i * (SWATCH_PX + PANEL_GAP)
                # A chalk border keeps the swatch that matches the sheet background (03) visible.
                canvas[y : y + SWATCH_PX, x : x + SWATCH_PX] = LABEL_INK
                b = SWATCH_BORDER
                canvas[y + b : y + SWATCH_PX - b, x + b : x + SWATCH_PX - b] = i
                _paint_mask(canvas, render_text(f"{i:02d}"), x, y + SWATCH_PX + LABEL_GAP, LABEL_INK)
                sheet.swatches.append((i, (x, y)))
        elif it.kind == "tiles":
            x = MARGIN
            for t in it.tiles:
                f = t.frame
                pw = f.width * t.scale
                panel_y = y + _LINE_H + LABEL_GAP
                _paint_mask(canvas, render_text(t.label), x, y, HEADER_INK if t.scale_ref else LABEL_INK)
                if t.preview:
                    _paint_frame(canvas, np.tile(f.indices, (PREVIEW_REPEAT, PREVIEW_REPEAT)), x, panel_y, BG_LIGHT)
                    sheet.tiles.append(
                        TilePlacement(
                            label=t.label,
                            frame_id=f.frame_id,
                            label_xy=(x, y),
                            light_xy=(x, panel_y),
                            dark_xy=(x, panel_y),
                            size=(f.width, f.height),
                            preview=True,
                        )
                    )
                    x += t.width + TILE_GAP
                    continue
                _paint_frame(canvas, f.indices, x, panel_y, BG_LIGHT, t.scale)
                _paint_frame(canvas, f.indices, x + pw + PANEL_GAP, panel_y, BG_DARK, t.scale)
                sheet.tiles.append(
                    TilePlacement(
                        label=t.label,
                        frame_id=f.frame_id,
                        label_xy=(x, y),
                        light_xy=(x, panel_y),
                        dark_xy=(x + pw + PANEL_GAP, panel_y),
                        size=(f.width, f.height),
                        scale_ref=t.scale_ref,
                        specimen=t.specimen,
                        scale=t.scale,
                    )
                )
                x += t.width + TILE_GAP
        y += it.height + ROW_GAP
    return sheet


# ---------------------------------------------------------------------------------------------
# Driver


def _built_frames(
    entry: AssetEntry, root: Path, palette: Palette, by_id: dict[str, AssetEntry] | None = None
) -> dict[str, Frame]:
    """The entry's frames, built in memory. An alias entry shows its target's frames under its own IDs."""
    if entry.is_alias:
        target = (by_id or {}).get(entry.source)
        if target is None:
            raise SheetError(f"{entry.id}: alias target {entry.source} is not in the manifest (run npm run assets:lint)")
        frames = _built_frames(target, root, palette)
        twins = [
            replace(f, frame_id=f"{entry.id}{f.frame_id[len(target.id) :]}", asset_id=entry.id) for f in frames.values()
        ]
        return {f.frame_id: f for f in twins}
    try:
        built = build_asset(entry, root, palette)
    except BuildError as exc:
        raise SheetError(f"{exc} (run npm run assets:lint)") from None
    return {f.frame_id: f for f in built.frames}


def write_sheets(
    repo_root: Path | None = None,
    *,
    atlas: str | None = None,
    only: Sequence[str] | None = None,
    out_dir: Path | None = None,
) -> list[tuple[Path, Sheet]]:
    """Compose and write the requested sheets; returns ``(path, sheet)`` per sheet written.

    Without ``only``: one ``<atlas>.png`` per atlas that has manifest entries (or just
    ``atlas``). With ``only``: one ``only_<id>.png`` per ID (each must be in ``atlas`` when it
    is given). ``out_dir`` defaults to ``<repo_root>/build/sheets``.
    """
    root = (repo_root if repo_root is not None else _palette_mod.REPO_ROOT).resolve()
    out = out_dir if out_dir is not None else root / SHEETS_DIR
    if atlas is not None and atlas not in ATLASES:
        raise SheetError(f"--atlas: {atlas!r} is not one of {', '.join(ATLASES)}")
    try:
        entries = sorted(load_manifest(root / "assets-src" / "manifest.json"), key=lambda e: e.id)
    except (OSError, json.JSONDecodeError, ManifestError) as exc:
        raise SheetError(f"manifest: {exc}") from None
    palette = load_palette(root / "assets-src" / "palette" / "kerbside32.json")
    by_id = {e.id: e for e in entries}

    bessie: Frame | None = None
    if BESSIE_ID in by_id:
        bessie = _built_frames(by_id[BESSIE_ID], root, palette).get(BESSIE_FRAME)
    if bessie is None:
        print(f"forge sheets: warning: {BESSIE_FRAME} is not available; sheets have no scale reference", file=sys.stderr)

    jobs: list[tuple[str, str, list[AssetEntry]]] = []
    if only:
        unknown = sorted(set(only) - set(by_id))
        if unknown:
            raise SheetError(f"--only: not in the manifest: {', '.join(unknown)}")
        for aid in sorted(set(only)):
            e = by_id[aid]
            if atlas is not None and e.atlas != atlas:
                raise SheetError(f"--only: {aid} is in atlas {e.atlas!r}, not {atlas!r}")
            jobs.append((f"only_{aid}", f"only {aid} (atlas {e.atlas})", [e]))
    else:
        for name in ATLASES:
            # An alias entry repeats its target's frames, so the atlas sheet shows the target only.
            group = [e for e in entries if e.atlas == name and not e.is_alias]
            if (atlas is None or name == atlas) and group:
                jobs.append((name, f"atlas {name}", group))

    written: list[tuple[Path, Sheet]] = []
    for name, label, group_entries in jobs:
        groups = [(e, _built_frames(e, root, palette, by_id)) for e in group_entries]
        wrap_ids = frozenset(e.id for e in group_entries if e.technique == "procedural" and wrap_tile(root / e.source))
        specimens = {e.id: font_specimens(e, root) for e in group_entries if is_font(e)}
        n = sum(len(fr) for _, fr in groups)
        sheet = compose_sheet(
            name, f"{label}: {n} frames at {SCALE}x, light 06 | dark 01", groups, bessie, wrap_ids, specimens
        )
        path = out / f"{name}.png"
        write_bytes_if_changed(path, sheet.png(palette))
        written.append((path, sheet))
    return written


def cli(args: argparse.Namespace, repo_root: Path | None = None) -> int:
    """``forge sheets [--atlas <name>] [--only <id>...]``."""
    root = (repo_root if repo_root is not None else _palette_mod.REPO_ROOT).resolve()
    try:
        written = write_sheets(root, atlas=args.atlas, only=args.only)
    except SheetError as exc:
        print(f"forge sheets: error: {exc}", file=sys.stderr)
        return 1
    if not written:
        what = f"atlas {args.atlas}" if args.atlas else "the manifest"
        print(f"forge sheets: {what} has no frames; nothing written")
        return 0
    for path, sheet in written:
        shown = path.relative_to(root).as_posix() if path.is_relative_to(root) else str(path)
        frames = sum(1 for t in sheet.tiles if not t.scale_ref and not t.preview and not t.specimen)
        print(f"forge sheets: wrote {shown} ({sheet.width}x{sheet.height}, {frames} frames)")
    return 0
