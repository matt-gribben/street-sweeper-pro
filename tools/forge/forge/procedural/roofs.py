"""Roof surfaces: seeded, seamless 32x32 tiles at 16 px/m on the tile grid (ART_BIBLE §9.5).

Each generator is ``fn(params, rng, cell, variant) -> (h, w) uint8`` palette indices
(ASSET_PIPELINE §6.4). Every pattern is periodic in the cell, so a roof tiles across a building
footprint without a seam (the cell is one 2 m tile; cityMesh draws one roof quad per building
cell). The 1 px parapet / eave line (ART_BIBLE §9.3) is drawn by cityMesh along the real roof
outline, not baked into these textures. Random draws happen in a fixed order per variant, and
variant ``k`` draws after variants ``0..k-1`` (the shared ``rng``).

M1 placeholders (ROADMAP §5.1 "P"); the final roof families, the 4+ storey low-frequency
variants and slope-aware slate are SSP-124 (M4):

- ``roofs.slate`` (``roof.slate``): 02 base, a 03 course line every 4 px, a sparse 25 tint
  (the lit-slope tint: M1 roofs are flat quads without a ridge, so every variant carries it) and
  a few 03 chips.
- ``roofs.felt`` (``roof.felt``): 01 base mottled with 02 in 2x1 clumps, plus 03 repair patches.
- ``roofs.depot_placeholder`` (``roof.depot``): the landmark depot roof is a Codex golden later
  (ART_BIBLE §9.5, ASSET_PIPELINE §10.10); until then a corrugated sheet (05/06 stripes every
  2 px) with a 04 sheet-overlap line every 16 px and sparse 04 specks, under the final ID.
"""

from __future__ import annotations

from collections.abc import Mapping

import numpy as np
import numpy.typing as npt
from numpy.random import Generator

from forge.palette import PALETTE_SIZE
from forge.procedural.common import ProceduralError

__all__ = ["depot_placeholder", "felt", "slate"]

U8Array = npt.NDArray[np.uint8]


def _index(params: Mapping[str, object], key: str) -> int:
    v = params.get(key)
    if not isinstance(v, int) or isinstance(v, bool) or not 0 <= v < PALETTE_SIZE:
        raise ProceduralError(f"params.{key} must be a palette index 0-{PALETTE_SIZE - 1}, got {v!r}")
    return v


def _density(spec: Mapping[str, object], key: str, where: str) -> float:
    v = spec.get(key)
    if not isinstance(v, (int, float)) or isinstance(v, bool) or not 0.0 <= float(v) <= 1.0:
        raise ProceduralError(f"params.{where}.{key} must be a number in [0, 1], got {v!r}")
    return float(v)


def _positive(params: Mapping[str, object], key: str, where: str = "") -> int:
    v = params.get(key)
    if not isinstance(v, int) or isinstance(v, bool) or v < 1:
        raise ProceduralError(f"params.{where}{key} must be a positive integer, got {v!r}")
    return v


def _speckle_spec(params: Mapping[str, object], key: str) -> tuple[int, float]:
    spec = params.get(key)
    if not isinstance(spec, dict):
        raise ProceduralError(f"params.{key} must be an object {{ index, density }}")
    return _index(spec, "index"), _density(spec, "density", key)


def _check_period(cell: tuple[int, int], period: int, what: str) -> None:
    w, h = cell
    if w % period or h % period:
        raise ProceduralError(f"{what} every {period} px does not tile a {w}x{h} cell seamlessly")


def slate(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> U8Array:
    """Slate: base, a course line every ``course_spacing_px`` rows, sparse tint and chips."""
    w, h = cell
    base = _index(params, "base_index")
    course = _index(params, "course_index")
    spacing = _positive(params, "course_spacing_px")
    _check_period(cell, spacing, "a slate course")
    tint_idx, tint_density = _speckle_spec(params, "tint")
    chip_idx, chip_density = _speckle_spec(params, "chip")
    out = np.full((h, w), base, dtype=np.uint8)
    course_rows = (np.arange(h) % spacing) == spacing - 1
    out[course_rows, :] = course
    tint = rng.random((h, w)) < tint_density
    chip = rng.random((h, w)) < chip_density
    on_slate = ~course_rows[:, None] & np.ones((1, w), dtype=np.bool_)
    out[tint & on_slate] = tint_idx
    out[chip & on_slate & ~tint] = chip_idx
    return out


def felt(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> U8Array:
    """Felt: base mottled in 2x1 clumps (wrapping), plus 0..max rectangular repair patches."""
    w, h = cell
    base = _index(params, "base_index")
    mottle_idx, mottle_density = _speckle_spec(params, "mottle")
    patches = params.get("patches")
    if not isinstance(patches, dict):
        raise ProceduralError("params.patches must be an object { index, max_count, w_px, h_px }")
    patch_idx = _index(patches, "index")
    max_count = patches.get("max_count")
    if not isinstance(max_count, int) or isinstance(max_count, bool) or max_count < 0:
        raise ProceduralError(f"params.patches.max_count must be an integer >= 0, got {max_count!r}")
    sizes: list[tuple[int, int]] = []
    for key in ("w_px", "h_px"):
        rng_range = patches.get(key)
        if not (
            isinstance(rng_range, list)
            and len(rng_range) == 2
            and all(isinstance(v, int) and not isinstance(v, bool) and v >= 1 for v in rng_range)
            and rng_range[0] <= rng_range[1]
        ):
            raise ProceduralError(f"params.patches.{key} must be [min, max] positive integers")
        sizes.append((rng_range[0], rng_range[1]))
    out = np.full((h, w), base, dtype=np.uint8)
    seeds = rng.random((h, w)) < mottle_density
    clumps = seeds | np.roll(seeds, 1, axis=1)
    out[clumps] = mottle_idx
    count = int(rng.integers(0, max_count + 1))
    for _ in range(count):
        px = int(rng.integers(0, w))
        py = int(rng.integers(0, h))
        pw = int(rng.integers(sizes[0][0], sizes[0][1] + 1))
        ph = int(rng.integers(sizes[1][0], sizes[1][1] + 1))
        ys = (py + np.arange(ph)) % h
        xs = (px + np.arange(pw)) % w
        out[np.ix_(ys, xs)] = patch_idx
    return out


def depot_placeholder(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> U8Array:
    """Corrugated placeholder: alternating stripe columns, an overlap row every N px, sparse specks."""
    w, h = cell
    stripes = params.get("stripe_indices")
    if not (isinstance(stripes, list) and stripes and all(isinstance(v, int) and not isinstance(v, bool) for v in stripes)):
        raise ProceduralError("params.stripe_indices must be a non-empty list of palette indices")
    stripe_idx = [_index({"i": v}, "i") for v in stripes]
    stripe_px = _positive(params, "stripe_px")
    _check_period(cell, stripe_px * len(stripe_idx), "a corrugation stripe")
    seam = _index(params, "seam_index")
    seam_spacing = _positive(params, "seam_spacing_px")
    _check_period(cell, seam_spacing, "a sheet overlap line")
    speck_idx, speck_density = _speckle_spec(params, "speck")
    cols = (np.arange(w) // stripe_px) % len(stripe_idx)
    out = np.tile(np.array(stripe_idx, dtype=np.uint8)[cols], (h, 1))
    seam_rows = (np.arange(h) % seam_spacing) == seam_spacing - 1
    out[seam_rows, :] = seam
    specks = rng.random((h, w)) < speck_density
    out[specks & ~seam_rows[:, None]] = speck_idx
    return out
