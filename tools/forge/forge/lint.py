"""``forge lint``: the M0 asset rules (ASSET_PIPELINE §9.4; the full rule set lands in M4, SSP-115).

Rules implemented here, each reported as a :class:`Finding` tagged with its rule name:

``manifest``
    Entries unsorted by id, duplicate ids, an unknown class prefix (CLAUDE.md §5.4), an entry
    whose shape :mod:`forge.manifest` rejects, or a ``source`` inside ``assets-src/_probe/``.
``shape``
    The entry does not build (:func:`forge.build.build_asset`): a frame whose size mismatches
    the manifest cell, a frame list (count) that mismatches the manifest, an empty frame, a
    missing source. Also the committed atlas JSON: every manifest frame must be listed with
    ``w``/``h`` equal to the cell.
``palette``
    Any pixel off Kerbside-32 or semi-transparent (0 < alpha < 255) in an image that is pixel
    art pixel for pixel: the Blender renders (the rig emits exact palette colours with binary
    alpha, ASSET_PIPELINE §7.3) and every committed PNG under ``public/assets/``. Built frames
    are index arrays, so they are range-checked. AI goldens are raw tool output and exempt.
``provenance``
    Every ``assets-src/ai/<id>/`` folder: ``meta.json`` present, valid and complete (§6.5
    schema, ``id`` = folder name, ``seed`` null), ``prompt.md`` and ``golden.png`` present and
    ``golden_sha256`` = SHA-256 of ``golden.png``. ``prompt_sha256`` / ``preamble_version`` may
    be ``null`` only when ``acceptance_notes`` say the meta is retro-filled (the word "retro";
    a generic rule rather than a list of folder names). For ``ai-ingest`` entries the grid's
    ``origin: ai/<id>#cell=...`` header must name a folder that passes those checks.
``blender-drift``
    ``render.json`` ``script_sha256`` != sha256(script + NUL + rig.py) now: **warning**
    "re-render needed". A missing script or ``render.json`` is an error.
``blender-snap``
    The build's palette snap changed a pixel of a render (``snap_changed_px``, SSP-009).
``ramps``
    A built frame of a hand-authored sprite (``grid`` / ``ai-ingest``) uses more than
    :data:`MAX_RAMP_STEPS` steps of one ramp (ART_BIBLE §5.4; SSP-051). Ink used as the outline
    (an index-00 pixel 4-adjacent to transparency or the cell edge) does not count; interior ink
    does. ``accents`` is a list of unrelated hues, not a light ramp, so it is not counted.
    Procedural and Blender assets are left to the complete rule (SSP-115, M4).
``litter-shading``
    An authored ``h00`` frame of a ``litter.*`` entry whose shading is not rotation-symmetric
    (ASSET_PIPELINE §6.2, ART_BIBLE §6.2; SSP-051), see :func:`rotation_shading_problems`. Also a
    ``litter.*`` entry whose ``dirs`` is not ``"rot4"``.

``assets-src/_probe/`` is never read: AI folders are only looked for in ``assets-src/ai/``
and a manifest entry pointing into the probe is a ``manifest`` error that skips the entry.

``--only <id>...`` restricts the per-asset and per-folder rules to those IDs (manifest IDs or
AI folder IDs); the manifest-wide checks always run. Warnings exit 0 unless ``--warn-as-error``
(which also escalates "re-render needed"). Errors exit 1.

Lint never writes anything: it builds frames in memory and reads the committed outputs.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

import numpy as np
import numpy.typing as npt
from PIL import Image

from forge import palette as _palette_mod
from forge.build import BuildError, build_asset, font_outputs, is_font
from forge.manifest import ASSET_CLASSES, ROTATION_SPEC, AssetEntry, ManifestError, entry_from_data
from forge.palette import PALETTE_SIZE, TRANSPARENT, Palette, PaletteError, load_palette
from forge.sprite import SpriteError, read_sprite

__all__ = [
    "AI_DIR",
    "MAX_RAMP_STEPS",
    "META_FIELDS",
    "PROBE_DIR",
    "RULES",
    "SHADING_TOLERANCE",
    "Finding",
    "LintReport",
    "cli",
    "darkest_step_shares",
    "lint",
    "outline_ink",
    "pixel_violations",
    "ramp_steps",
    "retro_allowed",
    "rotation_shading_problems",
]

Severity = Literal["error", "warning"]

RULES = ("manifest", "shape", "palette", "ramps", "litter-shading", "provenance", "blender-drift", "blender-snap")
"""Rule names, in report order."""

PROBE_DIR = Path("assets-src") / "_probe"
"""Probe artefacts: git-tracked, never in the manifest, never linted (ASSET_PIPELINE §3)."""

AI_DIR = Path("assets-src") / "ai"
RENDER_JSON = "render.json"
RIG = Path("assets-src") / "blender" / "rig.py"
PUBLIC_ASSETS = Path("public") / "assets"
ATLAS_DIR = PUBLIC_ASSETS / "atlas"

META_FIELDS = (
    "id",
    "tool",
    "tool_version",
    "model",
    "date",
    "argv",
    "prompt_sha256",
    "preamble_version",
    "reference_images",
    "original_output_path",
    "candidates_generated",
    "accepted_index",
    "acceptance_notes",
    "golden_sha256",
    "size",
    "seed",
)
"""The ``meta.json`` schema (ASSET_PIPELINE §6.5)."""

RERENDER_NEEDED = "re-render needed"

_RETRO_RE = re.compile(r"\bretro", re.IGNORECASE)
_SHA_RE = re.compile(r"^[0-9a-f]{64}$")
_ORIGIN_RE = re.compile(r"^ai/([a-z]+\.[a-z0-9]+(?:_[a-z0-9]+)*)#cell=(?:0|[1-9][0-9]*)(?:,(?:0|[1-9][0-9]*))*$")
_MAX_SHOWN = 3

U8Array = npt.NDArray[np.uint8]
BoolArray = npt.NDArray[np.bool_]


@dataclass(frozen=True)
class Finding:
    """One lint result."""

    severity: Severity
    rule: str
    subject: str
    message: str

    def line(self, warn_as_error: bool = False) -> str:
        label = self.severity
        if self.severity == "warning" and warn_as_error:
            label = "warning (as error)"
        return f"{label}: [{self.rule}] {self.subject}: {self.message}"


@dataclass
class LintReport:
    """Everything one lint run found and what it looked at."""

    findings: list[Finding] = field(default_factory=list)
    assets: list[str] = field(default_factory=list)
    """Manifest IDs whose per-asset rules ran."""
    ai_folders: list[str] = field(default_factory=list)
    """``assets-src/ai/`` folders whose provenance rules ran."""
    files: list[str] = field(default_factory=list)
    """Repo-relative paths lint read directly (sources read by the build are not listed)."""

    @property
    def errors(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "error"]

    @property
    def warnings(self) -> list[Finding]:
        return [f for f in self.findings if f.severity == "warning"]

    def failed(self, warn_as_error: bool = False) -> bool:
        return bool(self.errors) or (warn_as_error and bool(self.warnings))

    def by_rule(self, rule: str) -> list[Finding]:
        return [f for f in self.findings if f.rule == rule]


class _Ctx:
    """Shared state of one run: repo root, palette, report and the file-read log."""

    def __init__(self, root: Path, palette: Palette, report: LintReport) -> None:
        self.root = root
        self.palette = palette
        self.report = report
        rgb = palette.rgb.astype(np.int64)
        self.palette_keys = np.unique((rgb[:, 0] << 16) | (rgb[:, 1] << 8) | rgb[:, 2])

    def rel(self, path: Path) -> str:
        return path.relative_to(self.root).as_posix() if path.is_relative_to(self.root) else str(path)

    def touch(self, path: Path) -> None:
        rel = self.rel(path)
        if _in_probe(rel):  # defensive: no rule may read the probe
            raise AssertionError(f"forge lint must never read {rel}")
        self.report.files.append(rel)

    def read_bytes(self, path: Path) -> bytes:
        self.touch(path)
        return path.read_bytes()

    def read_rgba(self, path: Path) -> U8Array:
        self.touch(path)
        with Image.open(path) as im:
            return np.asarray(im.convert("RGBA"), dtype=np.uint8).copy()

    def add(self, severity: Severity, rule: str, subject: str, message: str) -> None:
        self.report.findings.append(Finding(severity, rule, subject, message))

    def error(self, rule: str, subject: str, message: str) -> None:
        self.add("error", rule, subject, message)

    def warn(self, rule: str, subject: str, message: str) -> None:
        self.add("warning", rule, subject, message)


def _in_probe(rel: str) -> bool:
    return Path(rel).parts[:2] == PROBE_DIR.parts


# ---------------------------------------------------------------------------------------------
# Palette


def pixel_violations(rgba: U8Array, palette_keys: npt.NDArray[np.int64]) -> tuple[BoolArray, BoolArray]:
    """``(off_palette, semi_transparent)`` masks of an ``(H, W, 4)`` image.

    A pixel is semi-transparent when ``0 < alpha < 255``. A pixel is off-palette when it is
    not fully transparent and its RGB is not exactly a Kerbside-32 colour.
    """
    alpha = rgba[:, :, 3]
    semi = (alpha > 0) & (alpha < 255)
    rgb = rgba[:, :, :3].astype(np.int64)
    key = (rgb[:, :, 0] << 16) | (rgb[:, :, 1] << 8) | rgb[:, :, 2]
    pos = np.clip(np.searchsorted(palette_keys, key), 0, len(palette_keys) - 1)
    off = (alpha > 0) & (palette_keys[pos] != key)
    return off, semi


def _describe_pixels(rgba: U8Array, mask: BoolArray, what: str, origin: tuple[int, int] = (0, 0)) -> str:
    ys, xs = np.nonzero(mask)
    shown = []
    for y, x in list(zip(ys.tolist(), xs.tolist(), strict=True))[:_MAX_SHOWN]:
        r, g, b, a = (int(v) for v in rgba[y, x])
        shown.append(f"({x + origin[0]},{y + origin[1]}) rgba({r},{g},{b},{a})")
    more = f" (+{len(ys) - _MAX_SHOWN} more)" if len(ys) > _MAX_SHOWN else ""
    return f"{len(ys)} {what} pixel(s): {', '.join(shown)}{more}"


def _palette_check_image(ctx: _Ctx, rgba: U8Array, subject: str, origin: tuple[int, int] = (0, 0)) -> None:
    off, semi = pixel_violations(rgba, ctx.palette_keys)
    if off.any():
        ctx.error("palette", subject, _describe_pixels(rgba, off, "off-palette", origin))
    if semi.any():
        ctx.error("palette", subject, _describe_pixels(rgba, semi, "semi-transparent", origin))


def _check_render_palette(ctx: _Ctx, entry: AssetEntry) -> None:
    src = ctx.root / entry.source
    if not src.is_dir():
        return  # reported by the shape rule
    for path in sorted(src.iterdir()):
        if path.is_file() and path.suffix.lower() == ".png":
            _palette_check_image(ctx, ctx.read_rgba(path), f"{entry.id} ({ctx.rel(path)})")


def _atlas_rects(ctx: _Ctx, atlas: str) -> dict[str, dict[str, int]] | None:
    path = ctx.root / ATLAS_DIR / f"{atlas}.json"
    if not path.is_file():
        return None
    try:
        data: object = json.loads(ctx.read_bytes(path))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    frames = data.get("frames") if isinstance(data, dict) else None
    if not isinstance(frames, dict):
        return None
    out: dict[str, dict[str, int]] = {}
    for fid, rect in frames.items():
        if isinstance(rect, dict) and all(isinstance(rect.get(k), int) for k in ("x", "y", "w", "h")):
            out[str(fid)] = {k: int(rect[k]) for k in ("x", "y", "w", "h")}
    return out


def _check_published_pngs(ctx: _Ctx, entries: Sequence[AssetEntry], only: set[str] | None) -> None:
    """Palette rule over the committed PNGs under ``public/assets/``.

    With ``only``, just the atlas rects of the selected frames are checked (atlas JSON).
    """
    pub = ctx.root / PUBLIC_ASSETS
    if not pub.is_dir():
        return
    selected_frames = {fid: e for e in entries for fid in e.frame_ids()}
    for path in sorted(pub.rglob("*.png"), key=lambda p: p.as_posix()):
        rel = ctx.rel(path)
        is_atlas = path.parent == ctx.root / ATLAS_DIR
        if only is not None and not is_atlas:
            continue
        rgba = ctx.read_rgba(path)
        if only is None:
            _palette_check_image(ctx, rgba, rel)
            continue
        rects = _atlas_rects(ctx, path.stem) or {}
        for fid in sorted(rects):
            if fid in selected_frames and selected_frames[fid].id in only:
                r = rects[fid]
                crop = rgba[r["y"] : r["y"] + r["h"], r["x"] : r["x"] + r["w"]]
                _palette_check_image(ctx, crop, f"{fid} ({rel})", (r["x"], r["y"]))


# ---------------------------------------------------------------------------------------------
# Ramps and rotation-symmetric litter shading

MAX_RAMP_STEPS = 4
"""At most 4 steps of any one ramp per sprite (ART_BIBLE §5.4)."""

SHADING_TOLERANCE = 0.5
"""Largest allowed change of an edge's darkest-step share under a 90° turn (:func:`rotation_shading_problems`)."""

UNRAMPED = frozenset({"accents"})
"""Palette ``ramps`` entries that are not light ramps (unrelated accent hues), so they have no steps."""

SIDES = ("N", "E", "S", "W")
"""Cell edges in clockwise order: a 90° clockwise turn moves each edge's pixels to the next one."""

IntArray = npt.NDArray[np.integer]


def outline_ink(indices: IntArray) -> BoolArray:
    """Ink (index 00) pixels used as the outline: 4-adjacent to transparency or to the cell edge."""
    clear = np.pad(indices == TRANSPARENT, 1, constant_values=True)
    near = clear[:-2, 1:-1] | clear[2:, 1:-1] | clear[1:-1, :-2] | clear[1:-1, 2:]
    return (indices == 0) & near


def _body(indices: IntArray) -> BoolArray:
    """Opaque pixels that are not outline ink."""
    return (indices != TRANSPARENT) & ~outline_ink(indices)


def ramp_steps(indices: IntArray, palette: Palette) -> dict[str, tuple[int, ...]]:
    """The steps of each light ramp that a frame's body uses (outline ink excluded), sorted."""
    used = set(np.unique(indices[_body(indices)]).tolist())
    out: dict[str, tuple[int, ...]] = {}
    for name, members in palette.ramps.items():
        if name in UNRAMPED:
            continue
        steps = tuple(sorted(used & set(members)))
        if steps:
            out[name] = steps
    return out


def _rims(body: BoolArray) -> dict[str, BoolArray]:
    """Body pixels whose N/E/S/W neighbour is not body (outline ink, transparency or off-cell)."""
    outside = np.pad(~body, 1, constant_values=True)
    return {
        "N": body & outside[:-2, 1:-1],
        "E": body & outside[1:-1, 2:],
        "S": body & outside[2:, 1:-1],
        "W": body & outside[1:-1, :-2],
    }


def darkest_step_shares(indices: IntArray, palette: Palette) -> dict[str, tuple[int, dict[str, float | None]]]:
    """Per light ramp with at least 2 steps in the body: ``(darkest step, {edge: share})``.

    The darkest step is the used step with the lowest OKLab L. An edge's share is the fraction of
    that edge's rim pixels of the ramp (body pixels whose neighbour on that side is not body) that
    are the darkest step, or ``None`` when the edge has no rim pixel of the ramp.
    """
    body = _body(indices)
    rims = _rims(body)
    out: dict[str, tuple[int, dict[str, float | None]]] = {}
    for name, steps in ramp_steps(indices, palette).items():
        if len(steps) < 2:
            continue
        darkest = min(steps, key=lambda i: (float(palette.oklab[i, 0]), i))
        in_ramp = np.isin(indices, steps)
        shares: dict[str, float | None] = {}
        for side in SIDES:
            rim = rims[side] & in_ramp
            n = int(rim.sum())
            shares[side] = None if n == 0 else int((rim & (indices == darkest)).sum()) / n
        out[name] = (darkest, shares)
    return out


def rotation_shading_problems(indices: IntArray, palette: Palette) -> list[str]:
    """Why a litter frame's shading is not rotation-symmetric (empty when it is).

    Litter is turned in 90° steps by code (``rot4``), so its shading must not depend on the
    light direction: outline, base and one centred highlight, no NW glint and no darker SE edge
    (ASSET_PIPELINE §6.2). The check is the documented one, "a 90° rotation changes which edge
    carries the ramp's darkest step": for every light ramp with at least 2 steps, the share of
    each edge's rim that is the darkest step (:func:`darkest_step_shares`) is compared with the
    share of the edge a 90° clockwise turn moves onto it (W -> N, N -> E, E -> S, S -> W). A
    difference above :data:`SHADING_TOLERANCE` is a problem. An edge without rim pixels of the
    ramp (a can's silver end has no red rim) is not compared. Directional shading fails it both
    ways: a darker SE edge makes the darkest step's share high on S and E and low on N and W, and
    a lighter NW glint leaves the base as the darkest step everywhere except on N and W.
    """
    problems: list[str] = []
    for name, (darkest, shares) in darkest_step_shares(indices, palette).items():
        for i, side in enumerate(SIDES):
            prev = SIDES[i - 1]
            a, b = shares[side], shares[prev]
            if a is None or b is None or abs(a - b) <= SHADING_TOLERANCE:
                continue
            problems.append(
                f"ramp {name}: darkest step {darkest:02d} covers {a:.0%} of the {side} rim but {b:.0%} of the "
                f"{prev} rim, so a 90° turn moves it to another edge (litter shading must be top-lit and "
                "rotation-symmetric: outline, base, one centred highlight; ASSET_PIPELINE §6.2)"
            )
    return problems


def _check_sprite_rules(ctx: _Ctx, entry: AssetEntry, frames: Sequence[tuple[str, IntArray]]) -> None:
    """``ramps`` for grid / ai-ingest entries and ``litter-shading`` for litter entries."""
    if entry.technique in ("grid", "ai-ingest"):
        for fid, indices in frames:
            for name, steps in ramp_steps(indices, ctx.palette).items():
                if len(steps) > MAX_RAMP_STEPS:
                    shown = " ".join(f"{i:02d}" for i in steps)
                    ctx.error(
                        "ramps",
                        fid,
                        f"uses {len(steps)} steps of ramp {name} ({shown}); the limit is {MAX_RAMP_STEPS} "
                        "(ART_BIBLE §5.4; outline ink does not count)",
                    )
    if entry.asset_class != "litter":
        return
    if entry.dirs_spec != ROTATION_SPEC:
        ctx.error("litter-shading", entry.id, f'litter dirs must be "{ROTATION_SPEC}" (h00 authored, h08/h16/h24 generated)')
    for fid, indices in frames:
        if fid.split(":")[2] != "h00":
            continue  # generated rotations of a checked h00 frame
        for problem in rotation_shading_problems(indices, ctx.palette):
            ctx.error("litter-shading", fid, problem)


# ---------------------------------------------------------------------------------------------
# Manifest


def _check_manifest(ctx: _Ctx) -> list[AssetEntry]:
    """Manifest-wide rules. Returns the entries that validated (first occurrence of each id)."""
    path = ctx.root / "assets-src" / "manifest.json"
    subject = ctx.rel(path)
    if not path.is_file():
        ctx.error("manifest", subject, "missing")
        return []
    try:
        data: object = json.loads(ctx.read_bytes(path))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        ctx.error("manifest", subject, f"not valid JSON: {exc}")
        return []
    raw = data.get("assets") if isinstance(data, dict) else None
    if not isinstance(data, dict) or set(data) != {"assets"} or not isinstance(raw, list):
        ctx.error("manifest", subject, 'top level must be exactly { "assets": [ ... ] }')
        return []

    ids: list[str] = []
    for i, item in enumerate(raw):
        aid = item.get("id") if isinstance(item, dict) else None
        if not isinstance(aid, str):
            ctx.error("manifest", f"assets[{i}]", "entry has no string id")
            continue
        ids.append(aid)
        prefix = aid.split(".", 1)[0]
        if prefix not in ASSET_CLASSES:
            ctx.error("manifest", aid, f"unknown class prefix {prefix!r} (classes: {' '.join(sorted(ASSET_CLASSES))})")
    for a, b in zip(ids, ids[1:], strict=False):
        if a > b:
            ctx.error("manifest", a, f"entries are not sorted by id: {a!r} comes before {b!r}")
    seen: set[str] = set()
    for aid in ids:
        if aid in seen:
            ctx.error("manifest", aid, "duplicate id")
        seen.add(aid)

    entries: list[AssetEntry] = []
    accepted: set[str] = set()
    for i, item in enumerate(raw):
        try:
            entry = entry_from_data(item, i)
        except ManifestError as exc:
            aid = item.get("id") if isinstance(item, dict) else None
            msg = str(exc)
            if isinstance(aid, str) and "unknown asset class" in msg:
                continue  # already reported as an unknown class prefix
            ctx.error("manifest", aid if isinstance(aid, str) else f"assets[{i}]", msg)
            continue
        if entry.id in accepted:
            continue
        if _in_probe(entry.source):
            ctx.error("manifest", entry.id, f"source {entry.source} is inside {PROBE_DIR.as_posix()}/, which is never in the manifest")
            continue
        accepted.add(entry.id)
        entries.append(entry)
    return entries


# ---------------------------------------------------------------------------------------------
# Shape and Blender snap


def _check_build(ctx: _Ctx, entry: AssetEntry) -> None:
    try:
        built = build_asset(entry, ctx.root, ctx.palette)
    except BuildError as exc:
        msg = str(exc)
        prefix = f"{entry.id}: "
        ctx.error("shape", entry.id, msg[len(prefix) :] if msg.startswith(prefix) else msg)
        return
    _check_sprite_rules(ctx, entry, [(f.frame_id, f.indices) for f in built.frames])
    expected = entry.frame_ids()
    got = [f.frame_id for f in built.frames]
    if sorted(got) != expected:
        ctx.error("shape", entry.id, f"built {len(got)} frames, the manifest expects {len(expected)}")
    for f in built.frames:
        if f.indices.shape != (entry.height, entry.width):
            ctx.error("shape", f.frame_id, f"frame is {f.width}x{f.height}, manifest cell is {entry.width}x{entry.height}")
        if not (f.indices != TRANSPARENT).any():
            ctx.error("shape", f.frame_id, "frame is empty")
        if f.indices.size and (int(f.indices.min()) < TRANSPARENT or int(f.indices.max()) >= PALETTE_SIZE):
            ctx.error("palette", f.frame_id, f"frame indices outside -1..{PALETTE_SIZE - 1}")
        if f.snap_changed_px:
            ctx.error(
                "blender-snap",
                f.frame_id,
                f"the palette snap changed {f.snap_changed_px} px (the render has off-palette block winners; "
                "fix the Blender materials and re-render)",
            )


def _check_atlas_json(ctx: _Ctx, entries: Sequence[AssetEntry]) -> None:
    by_atlas: dict[str, list[AssetEntry]] = {}
    for e in entries:
        by_atlas.setdefault(e.atlas, []).append(e)
    for atlas in sorted(by_atlas):
        rel = (ATLAS_DIR / f"{atlas}.json").as_posix()
        rects = _atlas_rects(ctx, atlas)
        if rects is None:
            ctx.error("shape", rel, "missing or unreadable; run npm run assets")
            continue
        for e in by_atlas[atlas]:
            missing = [fid for fid in e.frame_ids() if fid not in rects]
            if missing:
                more = f" (+{len(missing) - _MAX_SHOWN} more)" if len(missing) > _MAX_SHOWN else ""
                ctx.error(
                    "shape",
                    e.id,
                    f"{len(missing)} manifest frame(s) not in {rel}: {', '.join(missing[:_MAX_SHOWN])}{more}; "
                    "run npm run assets",
                )
            for fid in e.frame_ids():
                r = rects.get(fid)
                if r is not None and (r["w"], r["h"]) != e.cell:
                    ctx.error("shape", fid, f"{rel} has it at {r['w']}x{r['h']}, manifest cell is {e.width}x{e.height}")


def _check_font_metrics(ctx: _Ctx, entries: Sequence[AssetEntry]) -> None:
    """Shape: every font entry's metrics JSON is committed and matches its glyph file (SSP-068)."""
    for e in entries:
        if not is_font(e):
            continue
        try:
            expected = font_outputs([e], ctx.root)
        except BuildError:
            continue  # already reported by the build check
        for rel, data in expected.items():
            path = ctx.root / rel
            if not path.is_file():
                ctx.error("shape", e.id, f"{rel} is missing; run npm run assets")
            elif ctx.read_bytes(path) != data:
                ctx.error("shape", e.id, f"{rel} does not match the glyph file; run npm run assets")


# ---------------------------------------------------------------------------------------------
# Provenance


def retro_allowed(meta: dict[str, object]) -> bool:
    """True when ``acceptance_notes`` say the meta is retro-filled (null prompt fields allowed)."""
    notes = meta.get("acceptance_notes")
    return isinstance(notes, str) and bool(_RETRO_RE.search(notes))


def _check_ai_folder(ctx: _Ctx, folder: Path) -> bool:
    """Provenance rules for one AI folder. Returns True when it is complete and hash-valid."""
    name = folder.name
    subject = ctx.rel(folder)
    before = len(ctx.report.errors)
    ctx.report.ai_folders.append(name)
    meta_path = folder / "meta.json"
    if not meta_path.is_file():
        ctx.error("provenance", subject, "meta.json is missing")
        return False
    try:
        meta: object = json.loads(ctx.read_bytes(meta_path))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        ctx.error("provenance", subject, f"meta.json is not valid JSON: {exc}")
        return False
    if not isinstance(meta, dict):
        ctx.error("provenance", subject, "meta.json must be an object")
        return False
    missing = [k for k in META_FIELDS if k not in meta]
    if missing:
        ctx.error("provenance", subject, f"meta.json is missing field(s) {missing} (ASSET_PIPELINE §6.5)")
    if meta.get("id") != name:
        ctx.error("provenance", subject, f"meta.json id {meta.get('id')!r} != folder name {name!r}")
    if "seed" in meta and meta["seed"] is not None:
        ctx.error("provenance", subject, f"meta.json seed must be null, got {meta['seed']!r}")
    for key in ("prompt_sha256", "preamble_version"):
        if key in meta and meta[key] is None and not retro_allowed(meta):
            ctx.error(
                "provenance",
                subject,
                f"meta.json {key} is null, which is allowed only for a retro-filled meta "
                "(acceptance_notes must say 'retro')",
            )
    ps = meta.get("prompt_sha256")
    if ps is not None and not (isinstance(ps, str) and _SHA_RE.match(ps)):
        ctx.error("provenance", subject, f"meta.json prompt_sha256 must be 64 lower-case hex digits or null, got {ps!r}")
    if not (folder / "prompt.md").is_file():
        ctx.error("provenance", subject, "prompt.md is missing")
    golden = folder / "golden.png"
    want = meta.get("golden_sha256")
    if not golden.is_file():
        ctx.error("provenance", subject, "golden.png is missing")
    elif not (isinstance(want, str) and _SHA_RE.match(want)):
        ctx.error("provenance", subject, f"meta.json golden_sha256 must be 64 lower-case hex digits, got {want!r}")
    else:
        got = hashlib.sha256(ctx.read_bytes(golden)).hexdigest()
        if got != want:
            ctx.error("provenance", subject, f"golden.png SHA-256 {got} != meta.json golden_sha256 {want}")
    return len(ctx.report.errors) == before


def _ai_folders(ctx: _Ctx) -> list[Path]:
    base = ctx.root / AI_DIR
    if not base.is_dir():
        return []
    return [p for p in sorted(base.iterdir(), key=lambda p: p.name) if p.is_dir() and not p.name.startswith(("_", "."))]


def _check_origin(ctx: _Ctx, entry: AssetEntry, valid: dict[str, bool]) -> None:
    path = ctx.root / entry.source
    if not path.is_file():
        return  # reported by the shape rule
    ctx.touch(path)
    try:
        grid = read_sprite(path)
    except (SpriteError, UnicodeDecodeError):
        return  # reported by the shape rule
    if grid.origin is None:
        ctx.error("provenance", entry.id, f"ai-ingest grid {entry.source} has no origin: header (written by forge ingest)")
        return
    m = _ORIGIN_RE.match(grid.origin)
    if not m:
        ctx.error("provenance", entry.id, f"origin {grid.origin!r} is not ai/<asset-id>#cell=<k>[,<k>...]")
        return
    folder_id = m.group(1)
    folder = ctx.root / AI_DIR / folder_id
    if not folder.is_dir():
        ctx.error("provenance", entry.id, f"origin folder {(AI_DIR / folder_id).as_posix()} does not exist")
        return
    if folder_id not in valid:
        valid[folder_id] = _check_ai_folder(ctx, folder)
    if not valid[folder_id]:
        ctx.error(
            "provenance",
            entry.id,
            f"origin folder {(AI_DIR / folder_id).as_posix()} is not complete and hash-valid (see its provenance errors)",
        )


# ---------------------------------------------------------------------------------------------
# Blender drift


def _check_blender_drift(ctx: _Ctx, entry: AssetEntry) -> None:
    from forge.blender import BlenderError, find_script, script_sha256  # deferred: pulls in subprocess

    try:
        script = find_script(entry.id, ctx.root)
    except BlenderError as exc:
        ctx.error("blender-drift", entry.id, str(exc).removeprefix("forge blender: "))
        return
    rig = ctx.root / RIG
    if not rig.is_file():
        ctx.error("blender-drift", entry.id, f"{RIG.as_posix()} is missing")
        return
    meta_path = ctx.root / entry.source / RENDER_JSON
    if not meta_path.is_file():
        ctx.error("blender-drift", entry.id, f"{ctx.rel(meta_path)} is missing")
        return
    try:
        meta: object = json.loads(ctx.read_bytes(meta_path))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        ctx.error("blender-drift", entry.id, f"{ctx.rel(meta_path)} is not valid JSON: {exc}")
        return
    recorded = meta.get("script_sha256") if isinstance(meta, dict) else None
    ctx.touch(script)
    ctx.touch(rig)
    current = script_sha256(script, rig)
    if recorded != current:
        shown = f"{recorded[:12]}..." if isinstance(recorded, str) else repr(recorded)
        ctx.warn(
            "blender-drift",
            entry.id,
            f"{RERENDER_NEEDED}: render.json script_sha256 {shown} != sha256({ctx.rel(script)} + rig.py) "
            f"{current[:12]}...; run npm run assets:blender -- {entry.id}",
        )


# ---------------------------------------------------------------------------------------------
# Driver


def lint(repo_root: Path | None = None, only: Iterable[str] | None = None) -> LintReport:
    """Run every M0 rule over ``repo_root`` (default: this repo) and return the findings.

    ``only`` restricts the per-asset and per-folder rules to those IDs; an ID that is neither a
    manifest entry nor an AI folder is an error.
    """
    root = (repo_root if repo_root is not None else _palette_mod.REPO_ROOT).resolve()
    report = LintReport()
    palette_path = root / "assets-src" / "palette" / "kerbside32.json"
    try:
        palette = load_palette(palette_path)
    except (OSError, PaletteError, json.JSONDecodeError) as exc:
        report.findings.append(Finding("error", "palette", "assets-src/palette/kerbside32.json", f"cannot load: {exc}"))
        return report
    ctx = _Ctx(root, palette, report)

    entries = _check_manifest(ctx)
    folders = _ai_folders(ctx)
    only_set = set(only) if only is not None else None
    if only_set is not None:
        known = {e.id for e in entries} | {p.name for p in folders}
        for unknown in sorted(only_set - known):
            ctx.error("manifest", unknown, "--only: not a manifest entry or an assets-src/ai/ folder")
        entries = [e for e in entries if e.id in only_set]
        folders = [p for p in folders if p.name in only_set]

    valid: dict[str, bool] = {}
    for folder in folders:
        valid[folder.name] = _check_ai_folder(ctx, folder)

    for entry in sorted(entries, key=lambda e: e.id):
        report.assets.append(entry.id)
        _check_build(ctx, entry)
        if entry.technique == "blender":
            _check_render_palette(ctx, entry)
            _check_blender_drift(ctx, entry)
        if entry.technique == "ai-ingest":
            _check_origin(ctx, entry, valid)
    _check_atlas_json(ctx, entries)
    _check_font_metrics(ctx, entries)
    _check_published_pngs(ctx, entries, only_set)

    order = {r: i for i, r in enumerate(RULES)}
    report.findings.sort(key=lambda f: (order.get(f.rule, len(RULES)), f.subject, f.severity, f.message))
    return report


def cli(args: argparse.Namespace, repo_root: Path | None = None) -> int:
    """``forge lint [--only <id>...] [--warn-as-error]``."""
    warn_as_error: bool = args.warn_as_error
    report = lint(repo_root, args.only)
    for f in report.findings:
        print(f"forge lint: {f.line(warn_as_error)}")
    n_err, n_warn = len(report.errors), len(report.warnings)
    print(
        f"forge lint: {n_err} error(s), {n_warn} warning(s); {len(report.assets)} asset(s), "
        f"{len(report.ai_folders)} AI folder(s) checked"
    )
    if report.failed(warn_as_error):
        why = "errors" if n_err else "warnings with --warn-as-error"
        print(f"forge lint: failed ({why})", file=sys.stderr)
        return 1
    return 0
