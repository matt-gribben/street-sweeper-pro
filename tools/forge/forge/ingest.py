"""``forge ingest <id>``: AI golden -> indexed text grid (ASSET_PIPELINE §9.1).

The M0 prototype (SSP-013) of the 10-step pipeline, for ``mode: sheet`` goldens:

1. load ``assets-src/ai/<id>/golden.png``;
2. alpha: real alpha thresholded at 128, else key out the median border colour
   (RGB distance > 110) (:func:`forge.pixelize.key_bg`);
3. slice by the ``ingest.json`` grid and crop each cell to its opaque bounding box;
4. pseudo-pixel period from the FFT edge profile of the whole keyed sheet, 3-16 px per axis
   (:func:`forge.pixelize.detect_period`), unless ``period_override`` is set in ``ingest.json``
   (never a CLI flag: the override must be committed);
5. block-mode resample of every cell at that period (majority, ties -> lowest RGB555 key);
6. step down by **one factor per sheet** (never per-cell normalisation, ADR 0002 E10), chosen
   so the largest figure on the sheet is ``largest_item_px`` (or so every figure fits the target
   cell), then place each figure in the target cell (centred, or feet on ``baseline_row``);
7. nearest Kerbside-32 colour in OKLab, no dither (:func:`forge.palette.map_image`);
8. despeckle: 3x3 majority on opaque pixels (:func:`despeckle`);
9. binary alpha (:func:`binary_alpha`);
10. write ``assets-src/sprites/<class>/<name>.sprite.txt`` through the shared
    :mod:`forge.sprite` writer, with ``origin: ai/<id>#cell=<k>[,<k>...]`` and
    ``ingest_sha256: <sha256 of the frame blocks as first written>`` headers.

Every cell with content goes through steps 3-9 and counts towards the sheet's scale factor,
including cells mapped to ``null`` in ``ingest.json``, so the factor is a property of the sheet
and never of which cells happen to be written. Only non-null cells are written.

``--dry-run`` writes ``build/tmp/ingest/<id>/preview.png`` (8x; one row per cell: raw cell |
resampled | palette-mapped | final) and ``report.json``, and touches nothing under
``assets-src/``. A real run writes the same preview, then the grids. :func:`ingest_sheet` and
:func:`preview_png` are pure functions of an image and a config, so ``forge gen-ai`` can run
the same preview on every candidate (``review.png``).

Edited-grid protection (CLAUDE.md hard rule 9, ASSET_PIPELINE §6.2): before writing, every
existing target grid is parsed and the SHA-256 of its frame blocks (as the shared writer
formats them) is compared with its ``ingest_sha256`` header. A mismatch, a missing header or an
unparsable file counts as edited, and ingest refuses to overwrite anything (exit 1,
``ingest: grid edited, refusing to overwrite``) unless ``--force`` is given.

Pure and deterministic: no clock, no randomness, no unordered iteration. The same golden and
``ingest.json`` always give byte-identical grids and previews.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import numpy.typing as npt
from PIL import Image

from forge import palette as _palette_mod
from forge.manifest import ASSET_CLASSES, ManifestError, load_manifest
from forge.palette import PALETTE_SIZE, TRANSPARENT, Palette, load_palette, map_image
from forge.pixelize import (
    MAX_PERIOD_PX,
    MIN_PERIOD_PX,
    alpha_bbox,
    block_mode_resize,
    detect_period,
    key_bg,
)
from forge.pngio import encode_rgba_png, indices_to_rgba, write_bytes_if_changed
from forge.sprite import SpriteError, SpriteGrid, format_frames, format_sprite, read_sprite

__all__ = [
    "EDITED_MESSAGE",
    "PREVIEW_BG_DARK",
    "PREVIEW_BG_LIGHT",
    "PREVIEW_SCALE",
    "CellResult",
    "CellTarget",
    "IngestConfig",
    "IngestError",
    "IngestOutcome",
    "SheetResult",
    "binary_alpha",
    "build_grids",
    "check_overwrite",
    "cli",
    "despeckle",
    "frames_sha256",
    "ingest",
    "ingest_sheet",
    "load_config",
    "parse_config",
    "place_in_cell",
    "preview_png",
    "render_preview",
    "resample_cell",
    "sheet_factor",
    "sheet_period",
    "slice_cells",
    "sprite_path",
    "step_down",
]

log = logging.getLogger("forge")

U8Array = npt.NDArray[np.uint8]
I16Array = npt.NDArray[np.int16]

EDITED_MESSAGE = "ingest: grid edited, refusing to overwrite"
"""The refusal text (ASSET_PIPELINE §13.4)."""

PREVIEW_SCALE = 8
"""Preview magnification (one art pixel = 8x8 preview pixels)."""

PREVIEW_BG_LIGHT = (0xC3, 0xC1, 0xC0)
PREVIEW_BG_DARK = (0x24, 0x22, 0x2A)
"""Contact-sheet backgrounds (ASSET_PIPELINE §5.3): panels are light, gutters are dark."""

_PREVIEW_PAD = 8
_CONFIG_KEYS = frozenset(
    {"mode", "grid", "cells", "frame", "target_cell", "largest_item_px", "period_override", "baseline_row"}
)
_ASSET_ID = r"[a-z]+\.[a-z0-9]+(?:_[a-z0-9]+)*"
_STATE = r"[a-z][a-z0-9]*(?:_[a-z0-9]+)*"
_DIR = r"h(?:0[0-9]|[12][0-9]|3[01])|s|sw|w|nw|n|ne|e|se|-"
_LOCAL_FRAME = rf"(?:{_STATE}):(?:{_DIR}):(?:0|[1-9][0-9]*)"
_ASSET_RE = re.compile(rf"^{_ASSET_ID}$")
_LOCAL_FRAME_RE = re.compile(rf"^{_LOCAL_FRAME}$")
_FULL_FRAME_RE = re.compile(rf"^({_ASSET_ID}):({_LOCAL_FRAME})$")


class IngestError(Exception):
    """Ingest cannot proceed (bad config, bad golden, a figure that does not fit, ...)."""


# ---------------------------------------------------------------------------------------------
# ingest.json


@dataclass(frozen=True)
class CellTarget:
    """Where one sheet cell goes: frame ``frame`` (``state:dir:n``) of asset ``asset_id``."""

    asset_id: str
    frame: str

    @property
    def frame_id(self) -> str:
        return f"{self.asset_id}:{self.frame}"


@dataclass(frozen=True)
class IngestConfig:
    """A validated ``mode: sheet`` ``ingest.json`` (ASSET_PIPELINE §6.5)."""

    grid: tuple[int, int]
    cells: tuple[CellTarget | None, ...]
    target_cell: tuple[int, int]
    largest_item_px: int | None = None
    period_override: tuple[float, float] | None = None
    baseline_row: int | None = None

    @property
    def columns(self) -> int:
        return self.grid[0]

    @property
    def rows(self) -> int:
        return self.grid[1]


def _pos_int_pair(value: object, where: str) -> tuple[int, int]:
    if (
        not isinstance(value, list)
        or len(value) != 2
        or not all(isinstance(v, int) and not isinstance(v, bool) and v >= 1 for v in value)
    ):
        raise IngestError(f"{where} must be [w, h] with positive integers, got {value!r}")
    return int(value[0]), int(value[1])


def _period_value(value: object, where: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise IngestError(f"{where} must be a number, got {value!r}")
    p = float(value)
    if not MIN_PERIOD_PX <= p <= MAX_PERIOD_PX:
        raise IngestError(f"{where} must be within {MIN_PERIOD_PX}-{MAX_PERIOD_PX} px, got {p}")
    return p


def parse_config(data: object, where: str = "ingest.json") -> IngestConfig:
    """Validate parsed ``ingest.json`` data. Unknown keys are errors.

    ``cells`` entries are ``null`` (no frame is written for the cell), an asset ID (the frame
    is the top-level ``frame``; multi-asset sheets such as litter) or a full frame ID
    ``<asset-id>:<state>:<dir>:<n>`` (single-asset sheets such as people). ``period_override``
    is ``null``, one period for both axes, or ``[x, y]``.
    """
    if not isinstance(data, dict):
        raise IngestError(f"{where}: top level must be an object")
    unknown = sorted(set(data) - _CONFIG_KEYS)
    if unknown:
        raise IngestError(f"{where}: unknown keys {unknown} (known: {sorted(_CONFIG_KEYS)})")
    mode = data.get("mode")
    if mode == "art":
        raise IngestError(f"{where}: mode 'art' is the ai-art build path (M4, SSP-112), not forge ingest")
    if mode != "sheet":
        raise IngestError(f"{where}: mode must be 'sheet', got {mode!r}")
    for key in ("grid", "cells", "target_cell"):
        if key not in data:
            raise IngestError(f"{where}: missing {key!r}")
    grid = _pos_int_pair(data["grid"], f"{where}: grid")
    target_cell = _pos_int_pair(data["target_cell"], f"{where}: target_cell")

    frame = data.get("frame")
    if frame is not None and (not isinstance(frame, str) or not _LOCAL_FRAME_RE.match(frame)):
        raise IngestError(f"{where}: frame must be '<state>:<dir>:<n>', got {frame!r}")

    raw_cells = data["cells"]
    if not isinstance(raw_cells, list) or len(raw_cells) != grid[0] * grid[1]:
        raise IngestError(f"{where}: cells must be a list of exactly {grid[0]} x {grid[1]} = {grid[0] * grid[1]} entries")
    cells: list[CellTarget | None] = []
    seen: dict[str, int] = {}
    for k, cell in enumerate(raw_cells):
        if cell is None:
            cells.append(None)
            continue
        if not isinstance(cell, str):
            raise IngestError(f"{where}: cells[{k}] must be null or a string, got {cell!r}")
        if m := _FULL_FRAME_RE.match(cell):
            target = CellTarget(m.group(1), m.group(2))
        elif _ASSET_RE.match(cell):
            if frame is None:
                raise IngestError(f"{where}: cells[{k}] is an asset ID ({cell}) but no top-level 'frame' is set")
            target = CellTarget(cell, frame)
        else:
            raise IngestError(f"{where}: cells[{k}] must be an asset ID or <asset-id>:<state>:<dir>:<n>, got {cell!r}")
        cls = target.asset_id.split(".")[0]
        if cls not in ASSET_CLASSES:
            raise IngestError(f"{where}: cells[{k}]: unknown asset class {cls!r} in {target.asset_id}")
        if target.frame_id in seen:
            raise IngestError(f"{where}: cells[{k}] and cells[{seen[target.frame_id]}] both write {target.frame_id}")
        seen[target.frame_id] = k
        cells.append(target)

    largest = data.get("largest_item_px")
    if largest is not None and (isinstance(largest, bool) or not isinstance(largest, int) or largest < 1):
        raise IngestError(f"{where}: largest_item_px must be null or a positive integer, got {largest!r}")
    if largest is not None and largest > max(target_cell):
        raise IngestError(f"{where}: largest_item_px {largest} exceeds the target cell {target_cell[0]}x{target_cell[1]}")

    override = data.get("period_override")
    period: tuple[float, float] | None
    if override is None:
        period = None
    elif isinstance(override, list):
        if len(override) != 2:
            raise IngestError(f"{where}: period_override must be null, a number or [x, y], got {override!r}")
        period = (
            _period_value(override[0], f"{where}: period_override[0]"),
            _period_value(override[1], f"{where}: period_override[1]"),
        )
    else:
        p = _period_value(override, f"{where}: period_override")
        period = (p, p)

    baseline = data.get("baseline_row")
    if baseline is not None and (
        isinstance(baseline, bool) or not isinstance(baseline, int) or not 0 <= baseline < target_cell[1]
    ):
        raise IngestError(f"{where}: baseline_row must be null or a row 0-{target_cell[1] - 1}, got {baseline!r}")

    return IngestConfig(
        grid=grid,
        cells=tuple(cells),
        target_cell=target_cell,
        largest_item_px=largest,
        period_override=period,
        baseline_row=baseline,
    )


def load_config(path: Path) -> IngestConfig:
    """Read and validate an ``ingest.json`` file."""
    try:
        data: object = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise IngestError(f"{path} does not exist (write ingest.json first, ASSET_PIPELINE §6.5)") from None
    except json.JSONDecodeError as exc:
        raise IngestError(f"{path}: invalid JSON: {exc}") from None
    return parse_config(data, str(path))


# ---------------------------------------------------------------------------------------------
# Steps 3-9 (pure functions over arrays)


def slice_cells(rgba: U8Array, grid: tuple[int, int]) -> list[tuple[tuple[int, int, int, int], U8Array] | None]:
    """Step 3: cut a keyed sheet into ``grid`` cells (reading order) and crop each to its bbox.

    Cell ``(c, r)`` spans columns ``[c*W//cols, (c+1)*W//cols)`` and rows likewise. Returns, per
    cell, ``(bbox in sheet coordinates (left, top, right, bottom), cropped RGBA)``, or ``None``
    for a cell with no opaque pixel.
    """
    cols, rows = grid
    h, w = rgba.shape[:2]
    if cols > w or rows > h:
        raise IngestError(f"grid {cols}x{rows} is larger than the {w}x{h} image")
    out: list[tuple[tuple[int, int, int, int], U8Array] | None] = []
    for r in range(rows):
        y0, y1 = r * h // rows, (r + 1) * h // rows
        for c in range(cols):
            x0, x1 = c * w // cols, (c + 1) * w // cols
            cell = rgba[y0:y1, x0:x1]
            bb = alpha_bbox(cell)
            if bb is None:
                out.append(None)
                continue
            left, top, right, bottom = bb
            out.append(((x0 + left, y0 + top, x0 + right, y0 + bottom), cell[top:bottom, left:right].copy()))
    return out


def sheet_period(rgba: U8Array, override: tuple[float, float] | None) -> tuple[tuple[float, float], tuple[float, float], str]:
    """Step 4: ``(period used, period detected, "override" | "detected")`` for a keyed sheet."""
    detected = detect_period(rgba)
    if override is not None:
        return override, detected, "override"
    return detected, detected, "detected"


def _round_half_up(x: float) -> int:
    return int(math.floor(x + 0.5))


def resample_cell(rgba: U8Array, period: tuple[float, float]) -> U8Array:
    """Step 5: block-mode resample so one pseudo-pixel becomes one pixel (per-sheet period)."""
    h, w = rgba.shape[:2]
    px, py = period
    return block_mode_resize(rgba, max(1, _round_half_up(w / px)), max(1, _round_half_up(h / py)))


def sheet_factor(
    native_sizes: list[tuple[int, int]],
    target_cell: tuple[int, int],
    largest_item_px: int | None,
    baseline_row: int | None = None,
) -> float:
    """Step 6: the ONE step-down factor for a whole sheet (never above 1; never per cell).

    With ``largest_item_px``, the factor makes the largest extent (max of width and height) of
    any figure on the sheet equal to ``largest_item_px``: the largest litter item for litter,
    the tallest figure for people. Without it, the factor is the largest that fits every figure
    inside the target cell (above ``baseline_row`` when one is set).
    """
    if not native_sizes:
        raise IngestError("the sheet has no cell with content")
    if largest_item_px is not None:
        extent = max(max(w, h) for w, h in native_sizes)
        return min(1.0, largest_item_px / extent)
    tw, th = target_cell
    if baseline_row is not None:
        th = baseline_row + 1
    return min(1.0, min(min(tw / w, th / h) for w, h in native_sizes))


def step_down(rgba: U8Array, factor: float) -> U8Array:
    """Step 6: block-mode reduce by the per-sheet ``factor`` (identity at 1)."""
    if not 0 < factor <= 1:
        raise ValueError(f"factor must be in (0, 1], got {factor}")
    if factor == 1:
        return rgba.copy()
    h, w = rgba.shape[:2]
    return block_mode_resize(rgba, max(1, _round_half_up(w * factor)), max(1, _round_half_up(h * factor)))


def place_in_cell(rgba: U8Array, target_cell: tuple[int, int], baseline_row: int | None) -> tuple[U8Array, tuple[int, int]]:
    """Place a figure in a transparent ``target_cell``: centred horizontally (floor), and
    centred vertically or with its bottom row on ``baseline_row`` (feet on the pivot row).

    Returns ``(cell RGBA, (x, y) offset)``. Raises :class:`IngestError` if it does not fit.
    """
    tw, th = target_cell
    h, w = rgba.shape[:2]
    x0 = (tw - w) // 2
    y0 = (th - h) // 2 if baseline_row is None else baseline_row + 1 - h
    if x0 < 0 or y0 < 0 or y0 + h > th:
        where = "" if baseline_row is None else f" above baseline row {baseline_row}"
        raise IngestError(f"a {w}x{h} figure does not fit the {tw}x{th} target cell{where}")
    out = np.zeros((th, tw, 4), dtype=np.uint8)
    out[y0 : y0 + h, x0 : x0 + w] = rgba
    return out, (x0, y0)


def despeckle(indices: I16Array) -> tuple[I16Array, int]:
    """Step 8: 3x3 majority on opaque pixels. Returns ``(new frame, pixels changed)``.

    Reads the input only (order-independent). For each opaque pixel, its *window* is itself plus
    its opaque 8-neighbours inside the frame:

    - an opaque pixel with no opaque neighbour (an orphan) becomes transparent;
    - a pixel whose index none of its neighbours shares (a speck) takes the most frequent
      neighbour index, ties to the lower index, **only** when that index holds a strict majority
      of the window. Pixels in any 1 px line (outlines, two-pixel eyes) share their index with a
      neighbour and are never changed.
    """
    if indices.ndim != 2:
        raise ValueError(f"expected an (H, W) index array, got shape {indices.shape}")
    h, w = indices.shape
    out = indices.astype(np.int16).copy()
    changed = 0
    for y in range(h):
        for x in range(w):
            c = int(indices[y, x])
            if c == TRANSPARENT:
                continue
            counts = [0] * PALETTE_SIZE
            n = 0
            for dy in (-1, 0, 1):
                yy = y + dy
                if not 0 <= yy < h:
                    continue
                for dx in (-1, 0, 1):
                    xx = x + dx
                    if (dy == 0 and dx == 0) or not 0 <= xx < w:
                        continue
                    v = int(indices[yy, xx])
                    if v != TRANSPARENT:
                        counts[v] += 1
                        n += 1
            if n == 0:
                out[y, x] = TRANSPARENT
                changed += 1
                continue
            if counts[c]:
                continue
            best = max(range(PALETTE_SIZE), key=lambda i: (counts[i], -i))
            if counts[best] * 2 > n + 1:
                out[y, x] = best
                changed += 1
    return out, changed


def binary_alpha(indices: npt.NDArray[np.integer]) -> I16Array:
    """Step 9: a final frame with binary alpha: every pixel is a palette index or transparent."""
    arr = np.asarray(indices)
    if arr.ndim != 2 or not np.issubdtype(arr.dtype, np.integer):
        raise ValueError(f"expected an (H, W) integer index array, got {arr.dtype} {arr.shape}")
    bad = (arr != TRANSPARENT) & ((arr < 0) | (arr >= PALETTE_SIZE))
    if bad.any():
        raise IngestError(f"{int(bad.sum())} pixel(s) are neither a Kerbside-32 index nor transparent")
    return arr.astype(np.int16)


# ---------------------------------------------------------------------------------------------
# The whole sheet


@dataclass
class CellResult:
    """Every intermediate of one sheet cell (steps 3-9)."""

    index: int
    target: CellTarget | None
    bbox: tuple[int, int, int, int]
    raw: U8Array
    resampled: U8Array
    stepped: U8Array
    offset: tuple[int, int]
    mapped: I16Array
    final: I16Array
    despeckled_px: int

    @property
    def native_size(self) -> tuple[int, int]:
        return int(self.resampled.shape[1]), int(self.resampled.shape[0])

    @property
    def stepped_size(self) -> tuple[int, int]:
        return int(self.stepped.shape[1]), int(self.stepped.shape[0])


@dataclass
class SheetResult:
    """The outcome of :func:`ingest_sheet`."""

    config: IngestConfig
    size: tuple[int, int]
    alpha_method: str
    bg_rgb: tuple[float, float, float] | None
    period: tuple[float, float]
    period_detected: tuple[float, float]
    period_source: str
    factor: float
    cells: list[CellResult] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def report(self) -> dict[str, object]:
        """A JSON-friendly summary (floats rounded to 4 places, so it is byte-stable)."""

        def r4(v: float) -> float:
            return round(float(v), 4)

        return {
            "size": list(self.size),
            "alpha": self.alpha_method,
            "bg_rgb": None if self.bg_rgb is None else [r4(v) for v in self.bg_rgb],
            "period": [r4(v) for v in self.period],
            "period_detected": [r4(v) for v in self.period_detected],
            "period_source": self.period_source,
            "factor": r4(self.factor),
            "target_cell": list(self.config.target_cell),
            "largest_item_px": self.config.largest_item_px,
            "baseline_row": self.config.baseline_row,
            "cells": [
                {
                    "cell": c.index,
                    "frame": None if c.target is None else c.target.frame_id,
                    "bbox": list(c.bbox),
                    "native_px": list(c.native_size),
                    "final_px": list(c.stepped_size),
                    "offset": list(c.offset),
                    "despeckled_px": c.despeckled_px,
                }
                for c in self.cells
            ],
            "warnings": list(self.warnings),
        }


def ingest_sheet(image: U8Array, config: IngestConfig, palette: Palette) -> SheetResult:
    """Run steps 2-9 on a decoded golden (``(H, W, 3|4)`` ``uint8``). Pure; writes nothing."""
    if image.dtype != np.uint8 or image.ndim != 3 or image.shape[2] not in (3, 4):
        raise IngestError(f"golden must be an 8-bit RGB or RGBA image, got {image.dtype} {image.shape}")
    keyed = key_bg(image)  # step 2
    log.debug("ingest: step 2 alpha by %s (bg %s)", keyed.method, keyed.bg_rgb)
    sliced = slice_cells(keyed.rgba, config.grid)  # step 3
    for k, target in enumerate(config.cells):
        if target is not None and sliced[k] is None:
            raise IngestError(f"cell {k} ({target.frame_id}) is empty in the golden")
    period, detected, source = sheet_period(keyed.rgba, config.period_override)  # step 4
    log.debug("ingest: step 4 period %.4f x %.4f (%s; detected %.4f x %.4f)", *period, source, *detected)
    warnings: list[str] = []
    if abs(period[0] - period[1]) > 0.1 * min(period):
        warnings.append(
            f"x/y periods {period[0]:.2f}/{period[1]:.2f} differ by more than 10% (soft or anisotropic grid, ADR 0002 §5.1)"
        )

    present = [(k, s) for k, s in enumerate(sliced) if s is not None]
    resampled = {k: resample_cell(crop, period) for k, (_, crop) in present}  # step 5
    sizes = [(int(a.shape[1]), int(a.shape[0])) for a in resampled.values()]
    factor = sheet_factor(sizes, config.target_cell, config.largest_item_px, config.baseline_row)  # step 6
    log.debug("ingest: step 6 one factor for the sheet: %.4f (native sizes %s)", factor, sizes)

    result = SheetResult(
        config=config,
        size=(int(image.shape[1]), int(image.shape[0])),
        alpha_method=keyed.method,
        bg_rgb=keyed.bg_rgb,
        period=period,
        period_detected=detected,
        period_source=source,
        factor=factor,
        warnings=warnings,
    )
    for k, (bbox, crop) in present:
        target = config.cells[k]
        stepped = step_down(resampled[k], factor)
        try:
            placed, offset = place_in_cell(stepped, config.target_cell, config.baseline_row)
        except IngestError as exc:
            hint = "lower largest_item_px" if config.largest_item_px is not None else "check the grid"
            raise IngestError(f"cell {k}: {exc} ({hint}; the factor is per sheet, never per cell)") from None
        mapped = map_image(placed, palette)  # step 7
        despeckled, n_changed = despeckle(mapped)  # step 8
        final = binary_alpha(despeckled)  # step 9
        if target is not None and not (final != TRANSPARENT).any():
            raise IngestError(f"cell {k} ({target.frame_id}) is empty after despeckle")
        result.cells.append(
            CellResult(
                index=k,
                target=target,
                bbox=bbox,
                raw=crop,
                resampled=resampled[k],
                stepped=stepped,
                offset=offset,
                mapped=mapped,
                final=final,
                despeckled_px=n_changed,
            )
        )
        log.debug(
            "ingest: cell %d -> %s native %s final %s at %s, despeckled %d px",
            k,
            None if target is None else target.frame_id,
            result.cells[-1].native_size,
            result.cells[-1].stepped_size,
            offset,
            n_changed,
        )
    return result


# ---------------------------------------------------------------------------------------------
# Preview (reusable by gen-ai)


def _panel(rgba: U8Array, box: tuple[int, int]) -> U8Array:
    """``rgba`` composited on the light background, centred in a ``box`` (w, h) panel."""
    bw, bh = box
    out = np.empty((bh, bw, 3), dtype=np.uint8)
    out[:] = PREVIEW_BG_LIGHT
    h, w = rgba.shape[:2]
    x0, y0 = (bw - w) // 2, (bh - h) // 2
    region = out[y0 : y0 + h, x0 : x0 + w]
    opaque = rgba[:, :, 3] >= 128
    region[opaque] = rgba[:, :, :3][opaque]
    return out


def _scale(rgba: U8Array, s: int) -> U8Array:
    return np.repeat(np.repeat(rgba, s, axis=0), s, axis=1)


def render_preview(result: SheetResult, palette: Palette, scale: int = PREVIEW_SCALE) -> U8Array:
    """The ingest preview as an ``(H, W, 3)`` RGB array: one row per cell with content, four
    panels per row (raw cell | resampled | palette-mapped | final), all at ``scale``.

    The resampled panel is the native-resolution cell (step 5) at ``scale``; the raw cell is shown
    at the same on-screen size (box filter) so the two compare directly; the palette-mapped (step 7,
    after the step-down and placement) and final (steps 8-9) panels are the whole target cell.
    """
    if not result.cells:
        raise IngestError("nothing to preview: the sheet has no cell with content")
    tw, th = result.config.target_cell
    rows: list[list[U8Array]] = []
    for c in result.cells:
        nat = _scale(c.resampled, scale)
        nh, nw = nat.shape[:2]
        raw = np.asarray(Image.fromarray(c.raw, "RGBA").resize((nw, nh), Image.Resampling.BOX), dtype=np.uint8)
        raw = raw.copy()
        raw[:, :, 3] = np.where(raw[:, :, 3] >= 128, 255, 0).astype(np.uint8)
        mapped = _scale(indices_to_rgba(c.mapped, palette), scale)
        final = _scale(indices_to_rgba(c.final, palette), scale)
        rows.append([raw, nat, mapped, final])
    col_w = [max(r[i].shape[1] for r in rows) for i in range(4)]
    col_w[2] = col_w[3] = max(col_w[2], tw * scale)
    row_h = [max(max(p.shape[0] for p in r), th * scale) for r in rows]
    pad = _PREVIEW_PAD
    width = sum(col_w) + pad * 5
    height = sum(row_h) + pad * (len(rows) + 1)
    out = np.empty((height, width, 3), dtype=np.uint8)
    out[:] = PREVIEW_BG_DARK
    y = pad
    for r, rh in zip(rows, row_h, strict=True):
        x = pad
        for i, p in enumerate(r):
            out[y : y + rh, x : x + col_w[i]] = _panel(p, (col_w[i], rh))
            x += col_w[i] + pad
        y += rh + pad
    return out


def preview_png(result: SheetResult, palette: Palette, scale: int = PREVIEW_SCALE) -> bytes:
    """:func:`render_preview` as deterministic PNG bytes (no metadata, :mod:`forge.pngio`)."""
    rgb = render_preview(result, palette, scale)
    alpha = np.full(rgb.shape[:2] + (1,), 255, dtype=np.uint8)
    return encode_rgba_png(np.concatenate([rgb, alpha], axis=2))


# ---------------------------------------------------------------------------------------------
# Step 10: grids, provenance and edit protection


def frames_sha256(grid: SpriteGrid) -> str:
    """SHA-256 (hex) of the frame blocks exactly as the shared writer formats them."""
    return hashlib.sha256(format_frames(grid).encode("utf-8")).hexdigest()


def build_grids(result: SheetResult, sheet_id: str) -> dict[str, SpriteGrid]:
    """One :class:`SpriteGrid` per target asset, in order of first appearance on the sheet.

    Frames follow cell order. ``origin`` is ``ai/<sheet_id>#cell=<k>[,<k>...]`` (the cells that
    fed the grid, in frame order); ``ingest_sha256`` hashes the frame blocks as written here.
    The default key is used, so every character is ``.``, ``0``-``9`` or ``a``-``v``.
    """
    grouped: dict[str, list[CellResult]] = {}
    for c in result.cells:
        if c.target is not None:
            grouped.setdefault(c.target.asset_id, []).append(c)
    grids: dict[str, SpriteGrid] = {}
    for asset_id, cells in grouped.items():
        grid = SpriteGrid(
            id=asset_id,
            cell=result.config.target_cell,
            frames={c.target.frame: c.final for c in cells if c.target is not None},
            origin=f"ai/{sheet_id}#cell={','.join(str(c.index) for c in cells)}",
        )
        grid.ingest_sha256 = frames_sha256(grid)
        grids[asset_id] = grid
    return grids


def sprite_path(asset_id: str, repo_root: Path) -> Path:
    """Where ``asset_id``'s grid lives: its manifest ``source`` when the manifest lists it with a
    ``.sprite.txt`` source, else ``assets-src/sprites/<class>/<name>.sprite.txt`` (CLAUDE.md §5.4).
    """
    manifest = repo_root / "assets-src" / "manifest.json"
    if manifest.is_file():
        try:
            entries = load_manifest(manifest)
        except ManifestError as exc:
            raise IngestError(str(exc)) from None
        for e in entries:
            if e.id == asset_id and e.source.endswith(".sprite.txt"):
                return repo_root / e.source
    cls, name = asset_id.split(".", 1)
    return repo_root / "assets-src" / "sprites" / cls / f"{name}.sprite.txt"


def check_overwrite(path: Path) -> str | None:
    """``None`` when ``path`` may be (over)written by ingest, else why it counts as edited."""
    if not path.exists():
        return None
    try:
        existing = read_sprite(path)
    except (SpriteError, UnicodeDecodeError) as exc:
        return f"it does not parse ({exc})"
    if existing.ingest_sha256 is None:
        return "it has no ingest_sha256 header (not written by forge ingest)"
    try:
        current = frames_sha256(existing)
    except SpriteError as exc:
        return f"its frames cannot be formatted ({exc})"
    if current != existing.ingest_sha256:
        return f"its frame blocks hash to {current[:12]}..., not ingest_sha256 {existing.ingest_sha256[:12]}..."
    return None


@dataclass
class IngestOutcome:
    """What :func:`ingest` did."""

    result: SheetResult
    preview_path: Path
    report_path: Path
    written: list[Path] = field(default_factory=list)
    unchanged: list[Path] = field(default_factory=list)
    refused: dict[Path, str] = field(default_factory=dict)
    forced: dict[Path, str] = field(default_factory=dict)


def _load_golden(path: Path) -> U8Array:
    if not path.is_file():
        raise IngestError(f"{path} does not exist")
    with Image.open(path) as im:
        im.load()
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGBA" if "A" in im.getbands() or "transparency" in im.info else "RGB")
        return np.asarray(im, dtype=np.uint8).copy()


def _rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix() if path.is_relative_to(root) else str(path)


def ingest(
    asset_id: str,
    repo_root: Path | None = None,
    *,
    force: bool = False,
    dry_run: bool = False,
    palette: Palette | None = None,
) -> IngestOutcome:
    """Ingest ``assets-src/ai/<asset_id>/golden.png`` per its ``ingest.json``.

    Always writes ``build/tmp/ingest/<asset_id>/preview.png`` and ``report.json``. Unless
    ``dry_run``, then writes each target grid, refusing (nothing written, ``refused`` filled) when
    any existing target grid counts as edited and ``force`` is false.
    """
    root = (repo_root if repo_root is not None else _palette_mod.REPO_ROOT).resolve()
    if not _ASSET_RE.match(asset_id):
        raise IngestError(f"{asset_id!r} is not an asset ID (<class>.<snake_name>)")
    folder = root / "assets-src" / "ai" / asset_id
    config = load_config(folder / "ingest.json")
    golden_path = folder / "golden.png"
    image = _load_golden(golden_path)
    pal = palette if palette is not None else load_palette()
    result = ingest_sheet(image, config, pal)

    tmp = root / "build" / "tmp" / "ingest" / asset_id
    preview_path = tmp / "preview.png"
    report_path = tmp / "report.json"
    write_bytes_if_changed(preview_path, preview_png(result, pal))
    report = {"id": asset_id, "golden_sha256": hashlib.sha256(golden_path.read_bytes()).hexdigest(), **result.report()}
    write_bytes_if_changed(report_path, (json.dumps(report, indent=2) + "\n").encode("utf-8"))
    outcome = IngestOutcome(result=result, preview_path=preview_path, report_path=report_path)
    if dry_run:
        return outcome

    grids = build_grids(result, asset_id)
    if not grids:
        raise IngestError("every cell is null in ingest.json: nothing to write")
    targets = [(sprite_path(aid, root), grid) for aid, grid in grids.items()]
    for path, _ in targets:
        why = check_overwrite(path)
        if why is not None:
            (outcome.forced if force else outcome.refused)[path] = why
    if outcome.refused:
        return outcome
    for path, grid in targets:
        if write_bytes_if_changed(path, format_sprite(grid).encode("utf-8")):
            outcome.written.append(path)
        else:
            outcome.unchanged.append(path)
    return outcome


# ---------------------------------------------------------------------------------------------
# Command line


def cli(args: argparse.Namespace, repo_root: Path | None = None) -> int:
    """``forge ingest <id> [--force] [--dry-run]``."""
    root = (repo_root if repo_root is not None else _palette_mod.REPO_ROOT).resolve()
    try:
        outcome = ingest(args.id, root, force=args.force, dry_run=args.dry_run)
    except IngestError as exc:
        print(f"forge ingest: error: {exc}", file=sys.stderr)
        return 1
    res = outcome.result
    print(
        f"forge ingest: {args.id}: alpha by {res.alpha_method}; period {res.period[0]:.2f} x {res.period[1]:.2f} px "
        f"({res.period_source}); one step-down factor for the sheet: {res.factor:.4f}"
    )
    for c in res.cells:
        name = "null (not written)" if c.target is None else c.target.frame_id
        print(
            f"forge ingest:   cell {c.index}: native {c.native_size[0]}x{c.native_size[1]} -> "
            f"{c.stepped_size[0]}x{c.stepped_size[1]} at {c.offset}, despeckled {c.despeckled_px} px -> {name}"
        )
    for w in res.warnings:
        print(f"forge ingest: warning: {w}", file=sys.stderr)
    print(f"forge ingest: preview {_rel(outcome.preview_path, root)}")
    if args.dry_run:
        print("forge ingest: dry run: nothing under assets-src/ was written")
        return 0
    if outcome.refused:
        for path, why in outcome.refused.items():
            print(f"forge {EDITED_MESSAGE} {_rel(path, root)}: {why}", file=sys.stderr)
        print(
            "forge ingest: the grid is the truth after ingest; use --dry-run to compare, or --force only to "
            "discard the hand edits deliberately (CLAUDE.md hard rule 9)",
            file=sys.stderr,
        )
        return 1
    for path, why in outcome.forced.items():
        print(f"forge ingest: warning: --force: discarding hand edits in {_rel(path, root)} ({why})", file=sys.stderr)
    for path in outcome.written:
        print(f"forge ingest: wrote {_rel(path, root)}")
    for path in outcome.unchanged:
        print(f"forge ingest: unchanged {_rel(path, root)}")
    return 0
