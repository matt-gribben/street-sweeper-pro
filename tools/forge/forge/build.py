"""``forge build``: manifest entries -> indexed, outlined, byte-stable frames (ASSET_PIPELINE §9.2).

Pure and deterministic: the output is a function of ``assets-src/manifest.json``, each entry's
source bytes, ``kerbside32.json`` and the forge code. No clock, no unordered iteration (asset
IDs and frame IDs are processed in sorted order), no randomness.

Techniques built here (M0):

- ``grid`` / ``ai-ingest``: parse the ``.sprite.txt`` (:mod:`forge.sprite`) -> validate id,
  cell, key and frame list against the manifest -> render frames -> apply mirrors -> outline
  when ``outline: true`` -> pivot (:func:`grid_pivot`: feet for ``npc`` creatures, cell centre
  otherwise). An entry with ``dirs: "rot4"`` (litter, SSP-051) authors ``h00`` only, and the
  build generates ``h08``/``h16``/``h24`` as exact 90°/180°/270° clockwise rotations of it
  (:func:`rotate_frames`) before the outline step.
- ``grid`` with a ``.glyphs.txt`` source (SSP-068): the font builder (:mod:`forge.glyphs`)
  parses the glyph file, checks the 101-glyph character set, renders the ``glyph`` and
  ``outline`` (8-connected) frames with their pivot on the glyph's top-left, and
  :func:`font_outputs` writes the metrics JSON to ``public/assets/fonts/``.
- ``blender``: read ``assets-src/rendered/<id>/`` -> block-mode 4x4 -> 1 px -> palette snap ->
  alpha 128 -> 1 px ink outline (:mod:`forge.outline`) -> pivots from ``render.json``.

- ``procedural`` (SSP-041): the params JSON names a generator in :mod:`forge.procedural`
  (seeded surface variants such as roofs, or assembled frames such as facade sets with their
  forge-derived ``lit``/``dark`` ramps) -> validate the frame list -> outline when asked -> pivot
  at the cell centre. Every extra file a generator reads (facade module grids) is part of the
  asset's cache key.

``ai-art`` entries raise :class:`BuildError` until M4 implements them.

Blender reduction details. Each render pixel is keyed by its *exact* colour: a Kerbside-32
colour gets its palette index (0-31) as key, any other colour gets ``32 + 0xRRGGBB``. Block
mode (:func:`forge.pixelize.block_mode_keys_factor`) then takes the majority key over the
opaque pixels (alpha >= 128) of each 4x4 block; a block is opaque when at least half its
pixels are; **ties go to the lowest key, i.e. the lower palette index**. Because an output
pixel is always one of its block's source colours, the palette snap that follows (nearest
OKLab colour, :func:`forge.palette.nearest_indices`) only changes pixels whose winning colour
was off-palette. Their number is counted per frame (``snap_changed_px``) and exposed for
``forge lint`` (§9.4 "Blender snap"); on the committed renders it is expected to be 0.

Outputs: ``<out>/frames/<asset-id>/<frame-id>.png`` (indexed PNGs via :mod:`forge.pngio`)
plus ``<out>/frames/<asset-id>/asset.json`` (frame list, pivots, snap counts). The frames of
every manifest entry are then packed (:mod:`forge.pack`) and the generated outputs
(:mod:`forge.outputs`: atlases, ``src/gen/assets.ts``, ``asset-hashes.json``) are written under
the repo root, or under ``--out`` when it is given. ``<out>`` defaults to
``build/.forge-cache/``. A content-hash cache lives in ``build/.forge-cache/entries/``;
``--no-cache`` neither reads nor writes it.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import re
import shutil
import sys
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import numpy as np
import numpy.typing as npt
from PIL import Image

from forge.glyphs import (
    GLYPHS_SUFFIX,
    ORIGIN,
    GlyphError,
    GlyphFont,
    check_charset,
    font_frames,
    frame_size,
    metrics_json,
    metrics_path,
    read_glyphs,
)
from forge.manifest import ROTATION_DIRS, AssetEntry, ManifestError, load_manifest
from forge.outline import add_outline, outline_gaps
from forge.outputs import generated_files, write_outputs
from forge.pack import Atlas, PackError, pack_atlases
from forge.palette import PALETTE_PATH, PALETTE_SIZE, REPO_ROOT, TRANSPARENT, Palette, load_palette, nearest_indices
from forge.pixelize import ALPHA_THRESHOLD, block_mode_keys_factor
from forge.pngio import PngError, decode_indexed_png, encode_indexed_png, write_bytes_if_changed
from forge.procedural import ProceduralError, dependencies, run_procedural
from forge.sprite import SpriteError, read_sprite, render_frames

__all__ = [
    "ASSET_JSON",
    "BUILT_TECHNIQUES",
    "CACHE_VERSION",
    "DEFAULT_CACHE_DIR",
    "RENDER_FACTOR",
    "AssetBuild",
    "BuildError",
    "BuildResult",
    "Frame",
    "asset_cache_key",
    "build",
    "build_asset",
    "cli",
    "font_outputs",
    "is_font",
    "parse_render_name",
    "reduce_render",
    "rotate_frames",
]

log = logging.getLogger("forge")

DEFAULT_CACHE_DIR = REPO_ROOT / "build" / ".forge-cache"
"""Content-hash cache root, and the default ``--out`` (frames land in ``<out>/frames/``)."""

RENDER_FACTOR = 4
"""Blender renders are 4x the target cell (ASSET_PIPELINE §6.6); block mode reduces 4x4 -> 1 px."""

BUILT_TECHNIQUES = ("grid", "ai-ingest", "blender", "procedural")
"""Techniques this build implements (ai-art: M4)."""

ASSET_JSON = "asset.json"
"""Per-asset summary written next to the frame PNGs."""

CACHE_VERSION = "forge-build-cache-v1"
"""Bump to invalidate every cache entry when the cache layout changes."""

I16Array = npt.NDArray[np.int16]
U8Array = npt.NDArray[np.uint8]

_STATE = r"[a-z][a-z0-9]*(?:_[a-z0-9]+)*?"
_HEADING = r"h(?:0[0-9]|[12][0-9]|3[01])"
_RENDER_RE = re.compile(rf"^(?:(?P<state>{_STATE})_)?(?P<dir>{_HEADING})(?:_(?P<n>0|[1-9][0-9]*))?\.png$")
_SLICE_RE = re.compile(r"^slice_(?P<k>0|[1-9][0-9]*)\.png$")
BODY_STATE = "body"
"""State of a bare ``hNN.png`` render (ASSET_PIPELINE §6.6: ``h07.png`` -> ``<id>:body:h07:0``)."""


class BuildError(Exception):
    """The build cannot produce correct output for an asset (bad source, bad manifest entry)."""


@dataclass(frozen=True)
class Frame:
    """One built frame: an ``(H, W)`` Kerbside-32 index array (``-1`` = transparent)."""

    frame_id: str
    asset_id: str
    state: str
    dir: str
    n: int
    indices: I16Array
    pivot: tuple[int, int]
    atlas: str
    snap_changed_px: int = 0

    @property
    def width(self) -> int:
        return int(self.indices.shape[1])

    @property
    def height(self) -> int:
        return int(self.indices.shape[0])

    @property
    def filename(self) -> str:
        return f"{self.frame_id}.png"


@dataclass
class AssetBuild:
    """The frames of one manifest entry plus build statistics."""

    entry: AssetEntry
    frames: list[Frame]
    snap_changed_px: int = 0
    source_off_palette_px: int = 0
    cache: Literal["hit", "miss", "off"] = "off"


@dataclass
class BuildResult:
    """What ``forge build`` produced, in sorted asset-id order."""

    assets: list[AssetBuild] = field(default_factory=list)
    frames_dir: Path | None = None
    atlases: list[Atlas] = field(default_factory=list)
    """Every packed atlas (all manifest entries, even with ``only``), in ATLASES order."""
    outputs: dict[str, bytes] = field(default_factory=dict)
    """The generated outputs (atlases, ``src/gen/assets.ts``, hashes) by root-relative path."""
    publish_root: Path | None = None
    """Where :attr:`outputs` were written (the repo root, or ``out_root``)."""
    changed_outputs: list[str] = field(default_factory=list)
    """The output paths whose bytes changed on disk during this build."""

    @property
    def frames(self) -> list[Frame]:
        """Every frame of every built asset, sorted by frame id (the order packing expects)."""
        return sorted((f for a in self.assets for f in a.frames), key=lambda f: f.frame_id)

    @property
    def snap_changed_px(self) -> int:
        return sum(a.snap_changed_px for a in self.assets)


# ---------------------------------------------------------------------------------------------
# Helpers


def _split_local(asset_id: str, local: str) -> tuple[str, str, str, int]:
    state, d, n = local.split(":")
    return f"{asset_id}:{local}", state, d, int(n)


def _check_frame_list(entry: AssetEntry, got: Iterable[str], what: str) -> None:
    expected = set(entry.local_frame_ids())
    have = set(got)
    missing = sorted(expected - have)
    extra = sorted(have - expected)
    if missing or extra:

        def show(items: list[str]) -> str:
            return ", ".join(items[:6]) + (f" (+{len(items) - 6} more)" if len(items) > 6 else "")

        parts = []
        if missing:
            parts.append(f"missing {len(missing)}: {show(missing)}")
        if extra:
            parts.append(f"not in the manifest {len(extra)}: {show(extra)}")
        raise BuildError(f"{entry.id}: {what} frame list does not match the manifest ({'; '.join(parts)})")


def _finish_frame(entry: AssetEntry, local: str, indices: I16Array) -> I16Array:
    if indices.shape != (entry.height, entry.width):
        raise BuildError(
            f"{entry.id}:{local}: frame is {indices.shape[1]}x{indices.shape[0]}, manifest cell is "
            f"{entry.width}x{entry.height}"
        )
    if not (indices != TRANSPARENT).any():
        raise BuildError(f"{entry.id}:{local}: frame is empty")
    if entry.outline:
        indices = add_outline(indices)
        gaps = int(outline_gaps(indices).sum())
        if gaps:
            raise BuildError(
                f"{entry.id}:{local}: {gaps} body pixel(s) touch the cell edge, so the outline cannot be "
                "completed (the visible body must be at most cell - 2 px, ASSET_PIPELINE §6.1)"
            )
    return indices.astype(np.int16)


# ---------------------------------------------------------------------------------------------
# Blender technique


def parse_render_name(name: str) -> tuple[str, str, int] | None:
    """``(state, dir, n)`` for a render file name (ASSET_PIPELINE §6.6), ``None`` if it is not a frame.

    ``h07.png`` -> ``("body", "h07", 0)``; ``dented_h07.png`` -> ``("dented", "h07", 0)``;
    ``brush_h07_2.png`` -> ``("brush", "h07", 2)``; ``slice_3.png`` -> ``("slice", "-", 3)``.
    """
    if m := _SLICE_RE.match(name):
        return "slice", "-", int(m.group("k"))
    if m := _RENDER_RE.match(name):
        return m.group("state") or BODY_STATE, m.group("dir"), int(m.group("n") or 0)
    return None


def _palette_key_lookup(palette: Palette) -> tuple[npt.NDArray[np.int64], npt.NDArray[np.int64]]:
    """Sorted ``0xRRGGBB`` keys of the palette and the (lowest) index of each."""
    rgb = palette.rgb.astype(np.int64)
    keys = (rgb[:, 0] << 16) | (rgb[:, 1] << 8) | rgb[:, 2]
    uniq, first = np.unique(keys, return_index=True)
    return uniq, first.astype(np.int64)


def reduce_render(
    rgba: U8Array, cell: tuple[int, int], palette: Palette, factor: int = RENDER_FACTOR
) -> tuple[I16Array, int, int]:
    """Block-mode reduce a render to ``cell`` and snap it to the palette.

    Returns ``(indices, snap_changed_px, source_off_palette_px)``: the ``(H, W)`` index array
    (``-1`` = transparent), the number of output pixels the palette snap changed, and the
    number of opaque render pixels whose colour is not exactly a Kerbside-32 colour.
    """
    if rgba.ndim != 3 or rgba.shape[2] != 4 or rgba.dtype != np.uint8:
        raise BuildError(f"render must be an (H, W, 4) uint8 array, got {rgba.dtype} {rgba.shape}")
    w, h = cell
    if rgba.shape[:2] != (h * factor, w * factor):
        raise BuildError(
            f"render is {rgba.shape[1]}x{rgba.shape[0]}, expected {w * factor}x{h * factor} "
            f"({factor}x the {w}x{h} cell)"
        )
    opaque = rgba[:, :, 3] >= ALPHA_THRESHOLD
    rgb = rgba[:, :, :3].astype(np.int64)
    rgb24 = (rgb[:, :, 0] << 16) | (rgb[:, :, 1] << 8) | rgb[:, :, 2]
    pal_keys, pal_index = _palette_key_lookup(palette)
    pos = np.clip(np.searchsorted(pal_keys, rgb24), 0, len(pal_keys) - 1)
    exact = pal_keys[pos] == rgb24
    keys = np.where(exact, pal_index[pos], PALETTE_SIZE + rgb24)
    out_keys, out_opaque = block_mode_keys_factor(keys, opaque, factor)
    off = out_opaque & (out_keys >= PALETTE_SIZE)
    indices = np.where(out_opaque, out_keys, TRANSPARENT).astype(np.int16)
    if off.any():
        k = out_keys[off] - PALETTE_SIZE
        off_rgb = np.stack([(k >> 16) & 0xFF, (k >> 8) & 0xFF, k & 0xFF], axis=-1).astype(np.uint8)
        indices[off] = nearest_indices(off_rgb, palette).astype(np.int16)
    return indices, int(off.sum()), int((opaque & ~exact).sum())


def _read_rgba(path: Path) -> U8Array:
    with Image.open(path) as im:
        return np.asarray(im.convert("RGBA"), dtype=np.uint8).copy()


def _load_pivots(entry: AssetEntry, src: Path) -> dict[str, object]:
    meta_path = src / "render.json"
    if not meta_path.is_file():
        raise BuildError(f"{entry.id}: {meta_path} is missing (ASSET_PIPELINE §6.6)")
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise BuildError(f"{entry.id}: render.json is not valid JSON: {exc}") from None
    pivots = meta.get("pivots_px") if isinstance(meta, dict) else None
    if not isinstance(pivots, dict):
        raise BuildError(f"{entry.id}: render.json has no pivots_px object")
    return pivots


#: Heading key of a single-heading render (``--headings 1``). The rig writes ``pivots_px`` by heading,
#: so an undirected frame (``slice_<k>.png`` -> dir ``-``) of a sprite-stack prop falls back to it.
SINGLE_HEADING = "h00"


def _pivot(entry: AssetEntry, pivots: dict[str, object], d: str, stem: str) -> tuple[int, int]:
    keys = (d, stem, SINGLE_HEADING) if d == "-" else (d, stem)
    for key in keys:
        if key in pivots:
            p = pivots[key]
            if (
                isinstance(p, list)
                and len(p) == 2
                and all(isinstance(v, int) and not isinstance(v, bool) for v in p)
                and 0 <= p[0] <= entry.width
                and 0 <= p[1] <= entry.height
            ):
                return int(p[0]), int(p[1])
            raise BuildError(f"{entry.id}: render.json pivots_px[{key!r}] must be [x, y] inside the cell, got {p!r}")
    raise BuildError(f"{entry.id}: render.json pivots_px has no entry for {d!r} (or {stem!r})")


def _build_blender(entry: AssetEntry, repo_root: Path, palette: Palette) -> AssetBuild:
    src = repo_root / entry.source
    if not src.is_dir():
        raise BuildError(f"{entry.id}: render folder {src} does not exist")
    pivots = _load_pivots(entry, src)
    files: dict[str, Path] = {}
    for path in sorted(src.iterdir()):
        if path.suffix.lower() != ".png" or not path.is_file():
            continue
        parsed = parse_render_name(path.name)
        if parsed is None:
            raise BuildError(f"{entry.id}: {path.name} is not a render frame name (ASSET_PIPELINE §6.6)")
        state, d, n = parsed
        local = f"{state}:{d}:{n}"
        if local in files:
            raise BuildError(f"{entry.id}: {path.name} and {files[local].name} both map to frame {local}")
        files[local] = path
    _check_frame_list(entry, files, "render folder")
    frames: list[Frame] = []
    snap_total = 0
    off_total = 0
    for local in sorted(files):
        path = files[local]
        fid, state, d, n = _split_local(entry.id, local)
        indices, snap_changed, off_palette = reduce_render(_read_rgba(path), entry.cell, palette)
        indices = _finish_frame(entry, local, indices)
        snap_total += snap_changed
        off_total += off_palette
        log.debug("forge build: %s <- %s (snap changed %d px)", fid, path.name, snap_changed)
        frames.append(
            Frame(
                frame_id=fid,
                asset_id=entry.id,
                state=state,
                dir=d,
                n=n,
                indices=indices,
                pivot=_pivot(entry, pivots, d, path.stem),
                atlas=entry.atlas,
                snap_changed_px=snap_changed,
            )
        )
    return AssetBuild(entry=entry, frames=frames, snap_changed_px=snap_total, source_off_palette_px=off_total)


# ---------------------------------------------------------------------------------------------
# Grid technique

#: Asset classes whose grids are creatures (people and animals): their pivot is the feet.
FEET_PIVOT_CLASSES = frozenset({"npc"})


def grid_pivot(entry: AssetEntry) -> tuple[int, int]:
    """Pivot of a grid frame, in cell pixels.

    Creatures (``npc``) pivot on the bottom-centre of the feet, row ``h - 2`` with the last row
    clear (ART_BIBLE §4.4, §7.2: row 22 of a 24x24 human cell), so actors sort and stand on their
    feet (SSP-018). Everything else pivots on the cell centre.
    """
    if entry.asset_class in FEET_PIVOT_CLASSES:
        return (entry.width // 2, entry.height - 2)
    return (entry.width // 2, entry.height // 2)


def rotate_frames(entry_id: str, rendered: dict[str, I16Array]) -> dict[str, I16Array]:
    """The ``rot4`` frame set: every authored ``h00`` frame plus its ``h08``/``h16``/``h24`` rotations.

    Headings step clockwise from north (``h00`` = screen up), so ``h08`` is the ``h00`` frame
    turned 90° clockwise, ``h16`` 180° and ``h24`` 270°: pixel-exact ``np.rot90`` turns, never
    resampled (ASSET_PIPELINE §6.2, ENTITY_CATALOG §1.3). Raises :class:`BuildError` when the grid
    authors any dir other than ``h00`` (the others are generated, never authored). Cells must be
    square so a rotated frame keeps the manifest cell.
    """
    other = sorted(fid for fid in rendered if fid.split(":")[1] != "h00")
    if other:
        shown = ", ".join(other[:6]) + (f" (+{len(other) - 6} more)" if len(other) > 6 else "")
        raise BuildError(
            f'{entry_id}: dirs "rot4" authors h00 only (h08/h16/h24 are generated by the build), '
            f"but the grid has {shown}"
        )
    out: dict[str, I16Array] = {}
    for fid, arr in rendered.items():
        if arr.shape[0] != arr.shape[1]:
            raise BuildError(f'{entry_id}: dirs "rot4" needs a square cell, got {arr.shape[1]}x{arr.shape[0]}')
        state, _, n = fid.split(":")
        for d, quarter_turns in ROTATION_DIRS.items():
            out[f"{state}:{d}:{n}"] = np.ascontiguousarray(np.rot90(arr, -quarter_turns))
    return {fid: out[fid] for fid in sorted(out)}


def _read_font(entry: AssetEntry, repo_root: Path) -> GlyphFont:
    path = repo_root / entry.source
    if not path.is_file():
        raise BuildError(f"{entry.id}: glyph file {path} does not exist")
    try:
        font = read_glyphs(path, entry.source)
        check_charset(font)
    except GlyphError as exc:
        raise BuildError(f"{entry.id}: {exc}") from None
    return font


def _build_font(entry: AssetEntry, repo_root: Path) -> AssetBuild:
    """Font builder (SSP-068, ASSET_PIPELINE §6.3): glyph file -> ``glyph`` and ``outline`` frames."""
    if entry.technique != "grid":
        raise BuildError(f"{entry.id}: a {GLYPHS_SUFFIX} source needs technique 'grid', got {entry.technique!r}")
    if entry.outline:
        raise BuildError(
            f"{entry.id}: a font entry must have outline: false (the font builder makes its own 8-connected "
            "outline state)"
        )
    if entry.dirs != ("-",):
        raise BuildError(f'{entry.id}: a font entry must have dirs "-"')
    font = _read_font(entry, repo_root)
    if frame_size(font) != entry.cell:
        fw, fh = frame_size(font)
        raise BuildError(
            f"{entry.id}: manifest cell {entry.width}x{entry.height} != the font's frame {fw}x{fh} "
            f"(glyph {font.glyph_w}x{font.glyph_h} grown by 1 px per side)"
        )
    rendered = font_frames(font)
    _check_frame_list(entry, rendered, "glyph file")
    frames: list[Frame] = []
    for local in sorted(rendered):
        fid, state, d, n = _split_local(entry.id, local)
        indices = _finish_frame(entry, local, rendered[local])
        frames.append(
            Frame(frame_id=fid, asset_id=entry.id, state=state, dir=d, n=n, indices=indices, pivot=ORIGIN, atlas=entry.atlas)
        )
    return AssetBuild(entry=entry, frames=frames)


def is_font(entry: AssetEntry) -> bool:
    """A manifest entry built by the font builder (a ``.glyphs.txt`` source)."""
    return entry.source.endswith(GLYPHS_SUFFIX)


def font_outputs(entries: Sequence[AssetEntry], repo_root: Path = REPO_ROOT) -> dict[str, bytes]:
    """The metrics JSON of every font entry, keyed by its root-relative output path."""
    out: dict[str, bytes] = {}
    for entry in sorted(entries, key=lambda e: e.id):
        if is_font(entry):
            font = _read_font(entry, repo_root)
            out[metrics_path(entry.id)] = metrics_json(font, entry.id, entry.atlas, entry.source)
    return out


def _build_grid(entry: AssetEntry, repo_root: Path) -> AssetBuild:
    if is_font(entry):
        return _build_font(entry, repo_root)
    path = repo_root / entry.source
    if not entry.source.endswith(".sprite.txt"):
        raise BuildError(
            f"{entry.id}: {entry.technique} source must be a .sprite.txt (or, for a font, {GLYPHS_SUFFIX}) file, "
            f"got {entry.source}"
        )
    if not path.is_file():
        raise BuildError(f"{entry.id}: grid {path} does not exist")
    try:
        grid = read_sprite(path)
        rendered = render_frames(grid)
    except SpriteError as exc:
        raise BuildError(str(exc)) from None
    if grid.id != entry.id:
        raise BuildError(f"{entry.id}: {entry.source} declares id {grid.id!r}")
    if grid.cell != entry.cell:
        raise BuildError(
            f"{entry.id}: {entry.source} cell {grid.width}x{grid.height} != manifest cell {entry.width}x{entry.height}"
        )
    if entry.rotated:
        rendered = rotate_frames(entry.id, rendered)
    _check_frame_list(entry, rendered, "grid")
    pivot = grid_pivot(entry)
    frames: list[Frame] = []
    for local in sorted(rendered):
        fid, state, d, n = _split_local(entry.id, local)
        indices = _finish_frame(entry, local, rendered[local])
        frames.append(
            Frame(frame_id=fid, asset_id=entry.id, state=state, dir=d, n=n, indices=indices, pivot=pivot, atlas=entry.atlas)
        )
    return AssetBuild(entry=entry, frames=frames)


# ---------------------------------------------------------------------------------------------
# Procedural technique


def _build_procedural(entry: AssetEntry, repo_root: Path, palette: Palette) -> AssetBuild:
    path = repo_root / entry.source
    if not entry.source.endswith(".json"):
        raise BuildError(f"{entry.id}: procedural source must be a params .json file, got {entry.source}")
    try:
        out = run_procedural(entry.id, path, entry.cell, repo_root, palette)
    except ProceduralError as exc:
        msg = str(exc)
        raise BuildError(msg if msg.startswith(f"{entry.id}") else f"{entry.id}: {msg}") from None
    _check_frame_list(entry, out.frames, "generator")
    pivot = grid_pivot(entry)
    frames: list[Frame] = []
    for local in sorted(out.frames):
        fid, state, d, n = _split_local(entry.id, local)
        indices = _finish_frame(entry, local, out.frames[local])
        frames.append(
            Frame(frame_id=fid, asset_id=entry.id, state=state, dir=d, n=n, indices=indices, pivot=pivot, atlas=entry.atlas)
        )
    return AssetBuild(entry=entry, frames=frames)


def build_asset(entry: AssetEntry, repo_root: Path = REPO_ROOT, palette: Palette | None = None) -> AssetBuild:
    """Build one manifest entry (no cache, no file output)."""
    if entry.technique not in BUILT_TECHNIQUES:
        raise BuildError(f"{entry.id}: technique {entry.technique!r} is not implemented yet (ai-art: M4)")
    if entry.technique == "blender":
        return _build_blender(entry, repo_root, palette or load_palette())
    if entry.technique == "procedural":
        return _build_procedural(entry, repo_root, palette or load_palette())
    return _build_grid(entry, repo_root)


# ---------------------------------------------------------------------------------------------
# Content-hash cache


def _forge_code_digest() -> bytes:
    """SHA-256 over the forge package's ``.py`` files, so a code change invalidates the cache."""
    pkg = Path(__file__).resolve().parent
    h = hashlib.sha256()
    for path in sorted(pkg.rglob("*.py"), key=lambda p: p.relative_to(pkg).as_posix()):
        rel = path.relative_to(pkg).as_posix().encode()
        data = path.read_bytes()
        h.update(len(rel).to_bytes(8, "big") + rel + len(data).to_bytes(8, "big") + data)
    return h.digest()


def asset_cache_key(entry: AssetEntry, repo_root: Path = REPO_ROOT, palette_path: Path = PALETTE_PATH) -> str:
    """Content hash of everything an asset's frames depend on.

    Covers the cache layout version, the forge code, the palette file, the canonical JSON of
    the manifest entry and the source bytes (every file of a Blender render folder, by name;
    for a procedural entry also every file its generator reads, by repo-relative path).
    """
    h = hashlib.sha256()

    def feed(data: bytes) -> None:
        h.update(len(data).to_bytes(8, "big"))
        h.update(data)

    feed(CACHE_VERSION.encode())
    feed(_forge_code_digest())
    feed(Path(palette_path).read_bytes())
    feed(json.dumps(entry.raw, sort_keys=True, separators=(",", ":")).encode())
    src = repo_root / entry.source
    if src.is_dir():
        for path in sorted(src.iterdir(), key=lambda p: p.name):
            if path.is_file():
                feed(path.name.encode())
                feed(path.read_bytes())
    elif src.is_file():
        feed(src.read_bytes())
    else:
        feed(b"<missing>")
    if entry.technique == "procedural" and src.is_file():
        for dep in dependencies(src, repo_root):
            feed(dep.relative_to(repo_root).as_posix().encode() if dep.is_relative_to(repo_root) else str(dep).encode())
            feed(dep.read_bytes() if dep.is_file() else b"<missing>")
    return h.hexdigest()


def _asset_json(ab: AssetBuild) -> bytes:
    e = ab.entry
    doc = {
        "id": e.id,
        "technique": e.technique,
        "atlas": e.atlas,
        "cell": [e.width, e.height],
        "outline": e.outline,
        "frame_count": len(ab.frames),
        "snap_changed_px": ab.snap_changed_px,
        "source_off_palette_px": ab.source_off_palette_px,
        "frames": [
            {
                "id": f.frame_id,
                "file": f.filename,
                "pivot": [f.pivot[0], f.pivot[1]],
                "snap_changed_px": f.snap_changed_px,
            }
            for f in ab.frames
        ],
    }
    return (json.dumps(doc, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def _asset_files(ab: AssetBuild, palette: Palette) -> dict[str, bytes]:
    files = {f.filename: encode_indexed_png(f.indices, palette) for f in ab.frames}
    files[ASSET_JSON] = _asset_json(ab)
    return dict(sorted(files.items()))


def _load_cached(entry: AssetEntry, entry_dir: Path, palette: Palette) -> tuple[AssetBuild, dict[str, bytes]] | None:
    try:
        meta_bytes = (entry_dir / ASSET_JSON).read_bytes()
        meta = json.loads(meta_bytes)
        files: dict[str, bytes] = {ASSET_JSON: meta_bytes}
        frames: list[Frame] = []
        for fm in meta["frames"]:
            data = (entry_dir / fm["file"]).read_bytes()
            files[fm["file"]] = data
            fid: str = fm["id"]
            if not fid.startswith(f"{entry.id}:"):
                return None
            _, state, d, n = _split_local(entry.id, fid[len(entry.id) + 1 :])
            frames.append(
                Frame(
                    frame_id=fid,
                    asset_id=entry.id,
                    state=state,
                    dir=d,
                    n=n,
                    indices=decode_indexed_png(data, palette),
                    pivot=(int(fm["pivot"][0]), int(fm["pivot"][1])),
                    atlas=entry.atlas,
                    snap_changed_px=int(fm["snap_changed_px"]),
                )
            )
        ab = AssetBuild(
            entry=entry,
            frames=frames,
            snap_changed_px=int(meta["snap_changed_px"]),
            source_off_palette_px=int(meta["source_off_palette_px"]),
            cache="hit",
        )
    except (OSError, ValueError, KeyError, TypeError, IndexError, PngError) as exc:
        log.debug("forge build: cache entry %s unusable (%s); rebuilding", entry_dir, exc)
        return None
    if [f.frame_id for f in frames] != entry.frame_ids():
        return None
    return ab, dict(sorted(files.items()))


def _store_cached(entry_root: Path, key: str, files: dict[str, bytes]) -> None:
    """Write a cache entry atomically (temp dir + rename) and drop the asset's older entries."""
    entry_root.mkdir(parents=True, exist_ok=True)
    final = entry_root / key
    tmp = entry_root / f".{key}.tmp"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir()
    for name, data in files.items():
        (tmp / name).write_bytes(data)
    if final.exists():
        shutil.rmtree(final)
    tmp.rename(final)
    for other in sorted(entry_root.iterdir()):
        if other.name != key and other.is_dir():
            shutil.rmtree(other)


# ---------------------------------------------------------------------------------------------
# Output


def _write_asset_dir(asset_dir: Path, files: dict[str, bytes]) -> None:
    asset_dir.mkdir(parents=True, exist_ok=True)
    for stale in sorted(asset_dir.iterdir()):
        if stale.name not in files:
            if stale.is_dir():
                shutil.rmtree(stale)
            else:
                stale.unlink()
    for name, data in files.items():
        write_bytes_if_changed(asset_dir / name, data)


def build(
    *,
    manifest_path: Path | None = None,
    repo_root: Path = REPO_ROOT,
    out_root: Path | None = None,
    only: Sequence[str] | None = None,
    use_cache: bool = True,
    cache_dir: Path | None = None,
    palette_path: Path | None = None,
    publish: bool = True,
) -> BuildResult:
    """Build every manifest entry (or ``only`` those IDs), write ``<out_root>/frames/``, then pack.

    ``out_root`` defaults to ``cache_dir``, which defaults to ``<repo_root>/build/.forge-cache``.
    Assets are processed in sorted id order; with ``use_cache=False`` the cache is neither read
    nor written.

    With ``publish`` (the default) every atlas is packed from the frames of **every** manifest
    entry (``only`` restricts which assets are reported and whose frame folders are written;
    the others come from the cache when possible, else are rebuilt, so packing stays global
    and deterministic, ASSET_PIPELINE §5.3) and the generated outputs (:mod:`forge.outputs`)
    are written under the publish root: ``out_root`` when it is given, else ``repo_root``.
    """
    manifest_path = manifest_path or repo_root / "assets-src" / "manifest.json"
    cache_dir = cache_dir or repo_root / "build" / ".forge-cache"
    publish_root = out_root if out_root is not None else repo_root
    out_root = out_root or cache_dir
    palette_path = palette_path or repo_root / "assets-src" / "palette" / "kerbside32.json"
    try:
        entries = sorted(load_manifest(manifest_path), key=lambda e: e.id)
    except (OSError, json.JSONDecodeError, ManifestError) as exc:
        raise BuildError(f"manifest: {exc}") from None
    palette = load_palette(palette_path)
    by_id = {e.id: e for e in entries}
    if only:
        unknown = sorted(set(only) - set(by_id))
        if unknown:
            raise BuildError(f"--only: not in the manifest: {', '.join(unknown)}")
        selected = [by_id[i] for i in sorted(set(only))]
    else:
        selected = entries

    frames_dir = out_root / "frames"
    result = BuildResult(frames_dir=frames_dir)
    selected_ids = {e.id for e in selected}
    pack_frames: list[Frame] = []
    for entry in entries if publish else selected:
        cached = None
        key = ""
        entry_root = cache_dir / "entries" / entry.id
        if use_cache:
            key = asset_cache_key(entry, repo_root, palette_path)
            if (entry_root / key).is_dir():
                cached = _load_cached(entry, entry_root / key, palette)
        if cached is not None:
            ab, files = cached
            log.debug("forge build: %s: cache hit %s", entry.id, key[:12])
        else:
            ab = build_asset(entry, repo_root, palette)
            ab.cache = "miss" if use_cache else "off"
            files = _asset_files(ab, palette)
            if use_cache:
                _store_cached(entry_root, key, files)
        pack_frames.extend(ab.frames)
        if entry.id in selected_ids:
            _write_asset_dir(frames_dir / entry.id, files)
            result.assets.append(ab)

    if not only and frames_dir.is_dir():
        for stale in sorted(frames_dir.iterdir()):
            if stale.is_dir() and stale.name not in by_id:
                log.debug("forge build: removing stale %s", stale)
                shutil.rmtree(stale)

    if publish:
        try:
            result.atlases = pack_atlases(pack_frames)
        except PackError as exc:
            raise BuildError(str(exc)) from None
        result.outputs = generated_files(
            result.atlases, [e.id for e in entries], palette, extra=font_outputs(entries, repo_root)
        )
        result.publish_root = publish_root
        result.changed_outputs = write_outputs(publish_root, result.outputs)
    return result


# ---------------------------------------------------------------------------------------------
# Command line


def cli(args: argparse.Namespace) -> int:
    """``forge build [--only <id>...] [--out <dir>] [--no-cache]``."""
    out_root = Path(args.out).resolve() if args.out else None
    try:
        result = build(out_root=out_root, only=args.only, use_cache=not args.no_cache)
    except BuildError as exc:
        print(f"forge build: error: {exc}", file=sys.stderr)
        return 1
    for ab in result.assets:
        print(
            f"forge build: {ab.entry.id}: {len(ab.frames)} frames ({ab.entry.technique}, cache {ab.cache}); "
            f"palette snap changed {ab.snap_changed_px} px"
        )
        if ab.snap_changed_px:
            print(
                f"forge build: warning: {ab.entry.id}: the palette snap changed {ab.snap_changed_px} px "
                "(expected 0; forge lint fails 'Blender snap')",
                file=sys.stderr,
            )
    print(
        f"forge build: {len(result.frames)} frames from {len(result.assets)} assets -> {_shown(result.frames_dir)}; "
        f"palette snap changed {result.snap_changed_px} px in total"
    )
    for atlas in result.atlases:
        print(f"forge build: atlas {atlas.name}: {atlas.width}x{atlas.height}, {len(atlas.frames)} frames")
    root = result.publish_root
    if root is not None:
        changed = len(result.changed_outputs)
        print(
            f"forge build: {len(result.outputs)} generated outputs under {_shown(root) or '.'} "
            f"({changed} changed{': ' + ', '.join(result.changed_outputs) if changed else ''})"
        )
    return 0


def _shown(path: Path | None) -> Path | None:
    if path is not None and path.is_relative_to(Path.cwd()):
        return path.relative_to(Path.cwd())
    return path
