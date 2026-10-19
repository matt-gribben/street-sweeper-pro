"""Ground tiles: seeded 32x32 surfaces, road markings and the 47-tile kerb blob (ART_BIBLE §9.1).

M1 placeholders (SSP-040, ROADMAP §5.1 "P") under their final IDs; the final looks are SSP-119
(road surfaces and markings), SSP-120 (kerb blob) and SSP-121 (pavement, grass, setts) in M4.
AI-generated ground tiles are banned: only code guarantees seams (ASSET_PIPELINE §2).

**Variant generators** have the ASSET_PIPELINE §6.4 shape ``fn(params, rng, cell, variant) ->
(h, w)`` palette indices. Opaque surfaces return ``uint8``; the road-marking overlays return
``int16`` with :data:`~forge.palette.TRANSPARENT` (-1) where the ground below shows through.
Every random draw comes from the shared ``rng`` in a fixed order, so variant ``k`` draws after
variants ``0..k-1`` and appending a variant never changes the earlier ones.

Seams: a params file with ``"wrap": true`` promises a seamless tile. Patterns with a period are
periodic in the cell by construction, and every random pattern wraps (``np.roll`` / modulo
indexing). On top of that, each wrap variant is drawn until it passes :func:`seam_ok` (the
ART_BIBLE §9.1 seam rule: the wrap-edge difference never exceeds the largest interior
difference, on both axes); a retry draws again from the same ``rng``, so the result is still a
pure function of the seed. :data:`MAX_SEAM_DRAWS` failed draws in a row is an error.

Surfaces (``v`` frames are plain variants unless a ``layouts`` list gives them a meaning):

- ``tiles.asphalt`` (``tile.asphalt``): 02 base, 01/03 aggregate speckle as single pixels or 2x1
  clumps that never touch each other, capped at ``max_fraction`` (<= 8%) of the pixels.
- ``tiles.pavement`` (``tile.pavement``): 05 slabs between 04 joint lines at ``joints_px`` on
  both axes (0, 11, 22: a wrap-safe 10/11/11 px rhythm for the ~10 px 600 mm grid), each slab
  tinted whole 06 or 04 with ``tint.probability``, plus sparse single-pixel 04 speckle.
- ``tiles.grass`` (``tile.grass``): 22 base, 1x2 tufts of 23 with a 21 shade pixel to their
  south-east (the sun is in the north-west), plus sparse 21 shade specks.
- ``tiles.setts`` (``tile.setts``, alley ``;``): ``block_px`` stone blocks in running bond with
  1 px 03 gaps, 04 blocks of which some are tinted 05.
- ``tiles.apron`` (``tile.apron``, concrete ``+``): 04 base with 03/05 single-pixel speckle and a
  03 expansion joint along the east and south edge of every ``joint_period_px`` square.
- ``tiles.zebra`` (``tile.zebra``): an asphalt ground with 07 bars ``bar_px`` wide and as far
  apart, worn to 06. ``layouts``: ``bars_along_y`` (vertical bars: a zebra across a north-south
  road) or ``bars_along_x``.
- ``tiles.speed_bump`` (``haz.speed_bump``, ENTITY_CATALOG §10 "a ground tile variant"): an
  asphalt ground with a tile-wide 03 band (ART_BIBLE §8.7), lit 04 on its north/west edge and
  shaded 01 on its south/east edge, with 07 chevrons every ``chevron_period_px``. ``layouts``:
  ``band_along_x`` (across a north-south road) or ``band_along_y``.
- ``tiles.cobbles`` (``tile.cobbles``, precinct ``:``; SSP-101): courses ``course_px`` tall of
  rounded stones (their four corner pixels left as gap) whose pitch (stone plus a 1 px gap) is
  drawn from ``stone_px``, 04 with some tinted 05, 03 gaps (ART_BIBLE §9.1). Each course starts at
  a random x and wraps, so its joints never line up with the tile edge.
- ``tiles.open_manhole`` (``haz.open_manhole``, ENTITY_CATALOG §10 "tile variant of the manhole
  ground tile"; SSP-101): an asphalt ground with a 00 hole in a ``rim.width_px`` 03 rim, the
  hole's far (south-east) inner wall lit 01, and the 04 lid (05 lit north-west edge, 03 pattern)
  slid aside to the south-east, casting a 1 px 01 shadow (ART_BIBLE §8.7).
- ``tiles.markings`` (overlays: ``tile.lane_marking``, ``tile.double_yellow``,
  ``tile.parking_bay``): transparent tiles holding straight lines, each ``{along, offset_px,
  width_px, index, dash_px?}``, worn by ``wear``. One ``layouts`` entry (a list of lines) per
  variant, so the variant index names an orientation the renderer looks up from the compiled
  ``markings`` bits (LEVEL_DESIGN §7.1, ART_BIBLE §9.1 has the table).

**The kerb blob** (``tiles.kerb_blob``, a ``frames`` generator): ``tile.kerb:blob:-:n`` for the
47 reduced neighbour masks in ``kerb_blob.json`` -> ``params.blob_masks`` (the one table shared
with the level compiler, SSP-034; never reordered or copied). A mask bit is set when that
neighbour is not road; road lies beyond every clear edge and every clear corner. Each pixel's
kerb distance ``d`` is its Chebyshev distance to the nearest road pixel minus one, so a straight
kerb is a band of rows and a corner is a square ring. ``d == 0`` is the 01 gutter line,
``1 <= d <= kerb_px`` the kerb stone (06 top), and everything further in is the interior tile
(``style.interior``: a variant of another tile's params, the pavement by default). A stone pixel
on its road side (``d == 1``) or its pavement side (``d == kerb_px``) is a lip: the 8-neighbours
across that side are summed as ``dx + dy`` (screen axes, y down), and a negative sum (the lip
faces north or west, toward the sun) is the 07 NW lip, a positive one the 04 SE lip, and zero
(a corner pixel facing north-east or south-west) stays 06. The distance is evaluated one pixel
beyond the cell from the same neighbour mask, which equals what the neighbouring kerb tile
computes there, so kerb runs and corners join seamlessly across tiles.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence

import numpy as np
import numpy.typing as npt
from numpy.random import PCG64, Generator

from forge.palette import PALETTE_SIZE, TRANSPARENT
from forge.procedural.common import Context, ProceduralError

__all__ = [
    "BLOB_COUNT",
    "BLOB_DIRS",
    "MAX_SEAM_DRAWS",
    "VARIANT_GENERATORS",
    "apron",
    "asphalt",
    "blob_table",
    "cobbles",
    "grass",
    "kerb_blob",
    "kerb_dependencies",
    "kerb_distance",
    "kerb_frame",
    "markings",
    "open_manhole",
    "pavement",
    "reduce_mask",
    "seam_ok",
    "setts",
    "speed_bump",
    "zebra",
]

U8Array = npt.NDArray[np.uint8]
I16Array = npt.NDArray[np.int16]
I64Array = npt.NDArray[np.int64]
BoolArray = npt.NDArray[np.bool_]

BLOB_COUNT = 47
"""Frames in the kerb blob autotile (``AUTOTILE_COUNT`` in ``src/sim/map.ts``)."""

BLOB_DIRS = ("n", "ne", "e", "se", "s", "sw", "w", "nw")
"""The eight neighbour directions named by ``params.mask_bits`` (the order of ``tools/levels/kerbBlob.ts``)."""

_CORNERS = (("ne", "n", "e"), ("se", "s", "e"), ("sw", "s", "w"), ("nw", "n", "w"))

MAX_SEAM_DRAWS = 64
"""Draws of one wrap variant before :class:`ProceduralError` (a sane params file needs one or two)."""

BLOB_STATE = "blob"
"""Frame state of the kerb blob (ART_BIBLE §14.4: ``tile.kerb:blob:-:n``)."""


# ---------------------------------------------------------------------------------------------
# Params helpers


def _where(where: str, key: str) -> str:
    return f"params.{where}{key}" if where else f"params.{key}"


def _index(spec: Mapping[str, object], key: str, where: str = "") -> int:
    v = spec.get(key)
    if not isinstance(v, int) or isinstance(v, bool) or not 0 <= v < PALETTE_SIZE:
        raise ProceduralError(f"{_where(where, key)} must be a palette index 0-{PALETTE_SIZE - 1}, got {v!r}")
    return v


def _indices(spec: Mapping[str, object], key: str, where: str = "") -> list[int]:
    v = spec.get(key)
    if not (isinstance(v, list) and v):
        raise ProceduralError(f"{_where(where, key)} must be a non-empty list of palette indices")
    return [_index({"i": i}, "i", f"{where}{key}[{n}].") for n, i in enumerate(v)]


def _fraction(spec: Mapping[str, object], key: str, where: str = "") -> float:
    v = spec.get(key)
    if not isinstance(v, (int, float)) or isinstance(v, bool) or not 0.0 <= float(v) <= 1.0:
        raise ProceduralError(f"{_where(where, key)} must be a number in [0, 1], got {v!r}")
    return float(v)


def _positive(spec: Mapping[str, object], key: str, where: str = "") -> int:
    v = spec.get(key)
    if not isinstance(v, int) or isinstance(v, bool) or v < 1:
        raise ProceduralError(f"{_where(where, key)} must be a positive integer, got {v!r}")
    return v


def _object(spec: Mapping[str, object], key: str, where: str = "") -> Mapping[str, object]:
    v = spec.get(key)
    if not isinstance(v, dict):
        raise ProceduralError(f"{_where(where, key)} must be an object")
    return v


def _wrap(params: Mapping[str, object]) -> bool:
    v = params.get("wrap", False)
    if not isinstance(v, bool):
        raise ProceduralError(f"params.wrap must be true or false, got {v!r}")
    return v


def _layout(params: Mapping[str, object], variant: int, allowed: Sequence[str] | None = None) -> object:
    layouts = params.get("layouts")
    if not (isinstance(layouts, list) and layouts):
        raise ProceduralError("params.layouts must be a non-empty list (one entry per variant)")
    if variant >= len(layouts):
        raise ProceduralError(f"variant {variant} has no params.layouts entry ({len(layouts)} listed); variants must equal its length")
    layout = layouts[variant]
    if allowed is not None and layout not in allowed:
        raise ProceduralError(f"params.layouts[{variant}] must be one of {', '.join(allowed)}, got {layout!r}")
    return layout


def _check_period(length: int, period: int, what: str) -> None:
    if length % period:
        raise ProceduralError(f"{what} every {period} px does not tile a {length} px cell seamlessly")


# ---------------------------------------------------------------------------------------------
# Seams


def seam_ok(arr: npt.NDArray[np.integer]) -> bool:
    """ART_BIBLE §9.1 seam rule on both axes: wrap-edge difference <= the largest interior one.

    The difference between two adjacent pixel columns (rows) is the fraction of their pixels that
    differ; the wrap edge pairs the last column (row) with the first.
    """
    for a in (arr, arr.T):
        if a.shape[1] < 2:
            continue
        interior = (a[:, 1:] != a[:, :-1]).mean(axis=0)
        wrap = float((a[:, -1] != a[:, 0]).mean())
        if wrap > float(interior.max()):
            return False
    return True


def _seamless(params: Mapping[str, object], draw: Callable[[], U8Array]) -> U8Array:
    """``draw()`` once, or (``wrap: true``) until the result passes :func:`seam_ok`."""
    if not _wrap(params):
        return draw()
    for _ in range(MAX_SEAM_DRAWS):
        out = draw()
        if seam_ok(out):
            return out
    raise ProceduralError(f"no seamless draw in {MAX_SEAM_DRAWS} tries; the pattern cannot wrap (check its periods)")


# ---------------------------------------------------------------------------------------------
# Shared texture pieces


def _speckle(rng: Generator, out: U8Array, spec: Mapping[str, object], where: str, mask: BoolArray | None = None) -> None:
    """Scatter isolated speckle clumps (1x1, or 2x1 with ``pair_probability``) over ``out`` in place.

    A clump is placed only where it and its 8-neighbourhood (wrapping) hold no speckle yet, so
    clumps never merge into anything larger than 2x1; placement stops at ``max_fraction`` of the
    pixels. ``mask`` (optional) limits where speckle may land. Draws: seed roll, colour pick and
    pair roll per pixel, in that order, always the full arrays.
    """
    h, w = out.shape
    indices = _indices(spec, "indices", where)
    density = _fraction(spec, "density", where)
    pair_p = _fraction(spec, "pair_probability", where) if "pair_probability" in spec else 0.0
    max_fraction = _fraction(spec, "max_fraction", where) if "max_fraction" in spec else 1.0
    seeds = rng.random((h, w)) < density
    picks = rng.integers(0, len(indices), size=(h, w))
    pairs = rng.random((h, w)) < pair_p
    occupied = np.zeros((h, w), dtype=np.bool_)
    cap = int(max_fraction * h * w)
    count = 0
    for y, x in zip(*np.nonzero(seeds), strict=True):
        cells = [(int(y), int(x))]
        if pairs[y, x]:
            cells.append((int(y), (int(x) + 1) % w))
        if count + len(cells) > cap:
            continue
        if mask is not None and not all(mask[cy, cx] for cy, cx in cells):
            continue
        if any(occupied[(cy + dy) % h, (cx + dx) % w] for cy, cx in cells for dy in (-1, 0, 1) for dx in (-1, 0, 1)):
            continue
        for cy, cx in cells:
            occupied[cy, cx] = True
            out[cy, cx] = indices[int(picks[y, x])]
        count += len(cells)


def _scatter(rng: Generator, out: U8Array, spec: Mapping[str, object], where: str, mask: BoolArray | None = None) -> None:
    """Independent single pixels of ``index`` at ``density`` (one roll per pixel), inside ``mask``."""
    index = _index(spec, "index", where)
    hit = rng.random(out.shape) < _fraction(spec, "density", where)
    if mask is not None:
        hit &= mask
    out[hit] = index


def _asphalt_ground(rng: Generator, params: Mapping[str, object], cell: tuple[int, int], key: str = "ground") -> U8Array:
    """A plain asphalt ground for marked tiles: ``params[key]`` = ``{ base_index, speckle }``."""
    w, h = cell
    ground = _object(params, key)
    out = np.full((h, w), _index(ground, "base_index", f"{key}."), dtype=np.uint8)
    _speckle(rng, out, _object(ground, "speckle", f"{key}."), f"{key}.speckle.")
    return out


# ---------------------------------------------------------------------------------------------
# Surfaces


def asphalt(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> U8Array:
    """Asphalt: base plus isolated 1x1 / 2x1 aggregate speckle, capped at ``speckle.max_fraction``."""
    w, h = cell
    base = _index(params, "base_index")
    speckle = _object(params, "speckle")

    def draw() -> U8Array:
        out = np.full((h, w), base, dtype=np.uint8)
        _speckle(rng, out, speckle, "speckle.")
        return out

    return _seamless(params, draw)


def _joints(params: Mapping[str, object], length: int) -> list[int]:
    v = params.get("joints_px")
    if not (
        isinstance(v, list)
        and v
        and all(isinstance(j, int) and not isinstance(j, bool) and 0 <= j < length for j in v)
        and v == sorted(set(v))
    ):
        raise ProceduralError(f"params.joints_px must be ascending distinct pixel offsets in 0-{length - 1}")
    return v


def pavement(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> U8Array:
    """Pavement slabs: base slabs between joint lines, whole-slab tints and sparse speckle."""
    w, h = cell
    if w != h:
        raise ProceduralError(f"tiles.pavement needs a square cell, got {w}x{h}")
    base = _index(params, "base_index")
    joint = _index(params, "joint_index")
    joints = _joints(params, w)
    tint = _object(params, "tint")
    tint_indices = _indices(tint, "indices", "tint.")
    tint_p = _fraction(tint, "probability", "tint.")
    speckle = _object(params, "speckle")
    is_joint = np.zeros(w, dtype=np.bool_)
    is_joint[joints] = True
    # Slab number along an axis: the joints cut the (wrapping) line into len(joints) slabs.
    slab_of = (np.searchsorted(np.array(joints), np.arange(w), side="right") - 1) % len(joints)
    joint_px = is_joint[None, :] | is_joint[:, None]

    def draw() -> U8Array:
        n = len(joints)
        rolls = rng.random((n, n)) < tint_p
        picks = rng.integers(0, len(tint_indices), size=(n, n))
        slab_colour = np.where(rolls, np.array(tint_indices, dtype=np.int64)[picks], base)
        out = slab_colour[slab_of[:, None], slab_of[None, :]].astype(np.uint8)
        out[joint_px] = joint
        _scatter(rng, out, speckle, "speckle.", ~joint_px)
        return out

    return _seamless(params, draw)


def grass(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> U8Array:
    """Grass: base, 1x2 tufts with a shade pixel to their south-east, sparse shade specks."""
    w, h = cell
    base = _index(params, "base_index")
    tufts = _object(params, "tufts")
    tuft_idx = _index(tufts, "index", "tufts.")
    tuft_density = _fraction(tufts, "density", "tufts.")
    shade_idx = _index(params, "shade_index")
    specks = _object(params, "shade_specks")

    def draw() -> U8Array:
        out = np.full((h, w), base, dtype=np.uint8)
        _scatter(rng, out, {"index": shade_idx, "density": _fraction(specks, "density", "shade_specks.")}, "shade_specks.")
        seeds = rng.random((h, w)) < tuft_density
        for y, x in zip(*np.nonzero(seeds), strict=True):
            out[y, x] = tuft_idx
            out[(y - 1) % h, x] = tuft_idx
            if out[y, (x + 1) % w] == base:
                out[y, (x + 1) % w] = shade_idx
        return out

    return _seamless(params, draw)


def setts(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> U8Array:
    """Setts: ``block_px`` [w, h] blocks in running bond (alternate courses offset half a block)."""
    w, h = cell
    block = params.get("block_px")
    if not (isinstance(block, list) and len(block) == 2 and all(isinstance(v, int) and not isinstance(v, bool) and v >= 2 for v in block)):
        raise ProceduralError("params.block_px must be [w, h] with integers >= 2")
    bw, bh = block
    if bw % 2:
        raise ProceduralError(f"params.block_px width {bw} must be even (courses are offset by half a block)")
    _check_period(w, bw, "a sett block")
    _check_period(h, 2 * bh, "a pair of sett courses")
    base = _index(params, "base_index")
    gap = _index(params, "gap_index")
    tint = _object(params, "tint")
    tint_idx = _index(tint, "index", "tint.")
    tint_p = _fraction(tint, "probability", "tint.")
    ys, xs = np.mgrid[0:h, 0:w]
    course = ys // bh
    shifted = (xs + (course % 2) * (bw // 2)) % w
    block_id = course * (w // bw) + shifted // bw
    gap_px = ((ys % bh) == bh - 1) | ((shifted % bw) == bw - 1)
    n_blocks = (h // bh) * (w // bw)

    def draw() -> U8Array:
        tinted = rng.random(n_blocks) < tint_p
        out = np.where(tinted[block_id], tint_idx, base).astype(np.uint8)
        out[gap_px] = gap
        return out

    return _seamless(params, draw)


def apron(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> U8Array:
    """Concrete apron: base, isolated single-pixel speckle, an expansion joint every ``joint_period_px``."""
    w, h = cell
    base = _index(params, "base_index")
    joint = _index(params, "joint_index")
    period = _positive(params, "joint_period_px")
    _check_period(w, period, "an apron joint")
    _check_period(h, period, "an apron joint")
    speckle = _object(params, "speckle")
    line = (np.arange(w) % period) == period - 1
    joint_px = line[None, :] | line[:, None]

    def draw() -> U8Array:
        out = np.full((h, w), base, dtype=np.uint8)
        _speckle(rng, out, speckle, "speckle.", ~joint_px)
        out[joint_px] = joint
        return out

    return _seamless(params, draw)


def _wear(rng: Generator, out: U8Array, painted: BoolArray, params: Mapping[str, object]) -> None:
    wear = params.get("wear")
    if wear is None:
        return
    if not isinstance(wear, dict):
        raise ProceduralError("params.wear must be an object { index, density }")
    _scatter(rng, out, wear, "wear.", painted)


def zebra(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> U8Array:
    """Zebra crossing: asphalt ground with bars ``bar_px`` wide and as far apart, worn."""
    w, h = cell
    layout = _layout(params, variant, ("bars_along_y", "bars_along_x"))
    bar_idx = _index(params, "bar_index")
    bar_px = _positive(params, "bar_px")
    across = w if layout == "bars_along_y" else h
    _check_period(across, 2 * bar_px, "a zebra bar")
    ys, xs = np.mgrid[0:h, 0:w]
    t = xs if layout == "bars_along_y" else ys
    bar = (t // bar_px) % 2 == 0

    def draw() -> U8Array:
        out = _asphalt_ground(rng, params, cell)
        out[bar] = bar_idx
        _wear(rng, out, bar, params)
        return out

    return _seamless(params, draw)


def speed_bump(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> U8Array:
    """Speed bump: asphalt ground with a tile-wide band, lit and shaded edges and chevrons."""
    w, h = cell
    layout = _layout(params, variant, ("band_along_x", "band_along_y"))
    band = _object(params, "band")
    band_idx = _index(band, "index", "band.")
    band_px = _positive(band, "width_px", "band.")
    lit_idx = _index(band, "lit_index", "band.")
    shade_idx = _index(band, "shade_index", "band.")
    chevron = _object(params, "chevrons")
    chev_idx = _index(chevron, "index", "chevrons.")
    period = _positive(chevron, "period_px", "chevrons.")
    arm = _positive(chevron, "arm_px", "chevrons.")
    length, depth = (w, h) if layout == "band_along_x" else (h, w)
    if band_px + 2 > depth:
        raise ProceduralError(f"params.band.width_px {band_px} does not leave ground on both sides of a {depth} px tile")
    _check_period(length, period, "a speed-bump chevron")
    if 2 * arm > period or arm + 2 > band_px:
        raise ProceduralError(f"params.chevrons.arm_px {arm} does not fit the {period} px period and {band_px} px band")
    top = (depth - band_px) // 2
    # Drawn with the band along x (rows = depth); band_along_y is the transpose, which keeps the
    # lit edge on the north/west side and the shaded edge on the south/east side.
    pattern = np.full((depth, length), -1, dtype=np.int16)
    pattern[top : top + band_px, :] = band_idx
    pattern[top, :] = lit_idx
    pattern[top + band_px - 1, :] = shade_idx
    apex = top + (band_px - arm) // 2
    for cx in range(period // 2, length, period):
        for k in range(arm):
            pattern[apex + k, (cx - 1 - k) % length] = chev_idx
            pattern[apex + k, (cx + k) % length] = chev_idx
    if layout == "band_along_y":
        pattern = pattern.T
    painted = pattern >= 0

    def draw() -> U8Array:
        out = _asphalt_ground(rng, params, cell)
        out[painted] = pattern[painted].astype(np.uint8)
        return out

    return _seamless(params, draw)


def cobbles(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> U8Array:
    """Cobbles: courses of rounded stones of random width, 04 or 05, with 1 px gaps."""
    w, h = cell
    course_px = _positive(params, "course_px")
    if course_px < 3:
        raise ProceduralError(f"params.course_px {course_px} leaves no stone between the gaps (needs >= 3)")
    _check_period(h, course_px, "a cobble course")
    widths = params.get("stone_px")
    if not (
        isinstance(widths, list)
        and len(widths) == 2
        and all(isinstance(v, int) and not isinstance(v, bool) for v in widths)
        and 3 <= widths[0] <= widths[1] <= w
    ):
        raise ProceduralError("params.stone_px must be [lo, hi] stone pitches (stone plus gap) with 3 <= lo <= hi <= the tile width")
    base = _index(params, "base_index")
    gap = _index(params, "gap_index")
    tint = _object(params, "tint")
    tint_idx = _index(tint, "index", "tint.")
    tint_p = _fraction(tint, "probability", "tint.")
    lo, hi = widths

    def course_widths() -> list[int]:
        """Random stone pitches that fill one course exactly.

        The last pitch is cut to fit; a cut shorter than ``lo`` joins the stone before it.
        """
        out: list[int] = []
        while sum(out) < w:
            out.append(int(rng.integers(lo, hi + 1)))
        out[-1] -= sum(out) - w
        if out[-1] < lo and len(out) > 1:
            last = out.pop()
            out[-1] += last
        if sum(out) != w:
            raise ProceduralError(f"tiles.cobbles: stone pitches {out} do not fill the {w} px course")
        return out

    def draw() -> U8Array:
        out = np.full((h, w), gap, dtype=np.uint8)
        for course in range(h // course_px):
            y0 = course * course_px
            x = int(rng.integers(0, w))  # the course starts anywhere: its joints wrap
            for pitch in course_widths():
                colour = tint_idx if rng.random() < tint_p else base
                stone_w = pitch - 1
                for dy in range(course_px - 1):
                    for dx in range(stone_w):
                        corner = dy in (0, course_px - 2) and dx in (0, stone_w - 1)
                        if not corner or stone_w < 3:
                            out[y0 + dy, (x + dx) % w] = colour
                x += pitch
        return out

    return _seamless(params, draw)


def open_manhole(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> U8Array:
    """Open manhole: asphalt ground, a 00 hole in an 03 rim, the 04 lid slid aside to the south-east."""
    w, h = cell
    hole = _object(params, "hole")
    hole_idx = _index(hole, "index", "hole.")
    hole_r = _positive(hole, "radius_px", "hole.")
    hole_c = _xy(hole, "centre_px", "hole.", cell)
    wall_idx = _index(hole, "wall_index", "hole.")
    rim = _object(params, "rim")
    rim_idx = _index(rim, "index", "rim.")
    rim_px = _positive(rim, "width_px", "rim.")
    lid = _object(params, "lid")
    lid_idx = _index(lid, "index", "lid.")
    lid_r = _positive(lid, "radius_px", "lid.")
    lid_c = _xy(lid, "centre_px", "lid.", cell)
    lit_idx = _index(lid, "lit_index", "lid.")
    pattern_idx = _index(lid, "pattern_index", "lid.")
    shadow_idx = _index(lid, "shadow_index", "lid.")
    ys, xs = np.mgrid[0:h, 0:w]

    def disc(c: tuple[int, int], r: int) -> BoolArray:
        return 4 * ((xs - c[0]) ** 2 + (ys - c[1]) ** 2) <= (2 * r + 1) ** 2

    hole_px = disc(hole_c, hole_r)
    rim_ring = disc(hole_c, hole_r + rim_px) & ~hole_px
    # The far (south-east) inner wall catches the north-west sun: its top pixel row is lit 01.
    wall = hole_px & ~disc((hole_c[0] - 1, hole_c[1] - 1), hole_r)
    lid_px = disc(lid_c, lid_r)
    lid_edge = lid_px & ~disc(lid_c, lid_r - 1)
    lid_lit = lid_edge & ((xs - lid_c[0]) + (ys - lid_c[1]) < 0)
    lid_pattern = lid_px & ~lid_edge & ((xs + ys) % 3 == 0)
    lid_shadow = disc((lid_c[0] + 1, lid_c[1] + 1), lid_r) & ~lid_px & ~hole_px

    def draw() -> U8Array:
        out = _asphalt_ground(rng, params, cell)
        out[rim_ring] = rim_idx
        out[hole_px] = hole_idx
        out[wall] = wall_idx
        out[lid_shadow] = shadow_idx
        out[lid_px] = lid_idx
        out[lid_pattern] = pattern_idx
        out[lid_lit] = lit_idx
        return out

    return _seamless(params, draw)


def _xy(spec: Mapping[str, object], key: str, where: str, cell: tuple[int, int]) -> tuple[int, int]:
    v = spec.get(key)
    if not (
        isinstance(v, list)
        and len(v) == 2
        and all(isinstance(c, int) and not isinstance(c, bool) for c in v)
        and 0 <= v[0] < cell[0]
        and 0 <= v[1] < cell[1]
    ):
        raise ProceduralError(f"{_where(where, key)} must be an [x, y] pixel inside the {cell[0]}x{cell[1]} tile, got {v!r}")
    return v[0], v[1]


def _line_mask(line: Mapping[str, object], cell: tuple[int, int], where: str) -> BoolArray:
    w, h = cell
    along = line.get("along")
    if along not in ("x", "y"):
        raise ProceduralError(f"params.{where}along must be 'x' (a horizontal line) or 'y' (a vertical line), got {along!r}")
    offset = line.get("offset_px")
    width = _positive(line, "width_px", where)
    length, across = (w, h) if along == "x" else (h, w)
    if not isinstance(offset, int) or isinstance(offset, bool) or not 0 <= offset <= across - width:
        raise ProceduralError(f"params.{where}offset_px must place the {width} px line inside the {across} px tile, got {offset!r}")
    run = np.ones(length, dtype=np.bool_)
    if "dash_px" in line:
        dash = line["dash_px"]
        if not (isinstance(dash, list) and len(dash) == 2 and all(isinstance(v, int) and not isinstance(v, bool) and v >= 1 for v in dash)):
            raise ProceduralError(f"params.{where}dash_px must be [on, off] positive integers")
        _check_period(length, dash[0] + dash[1], "a dash")
        run = (np.arange(length) % (dash[0] + dash[1])) < dash[0]
    mask = np.zeros((across, length), dtype=np.bool_)
    mask[offset : offset + width, :] = run[None, :]
    return mask if along == "x" else mask.T


def markings(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> I16Array:
    """Overlay lines on a transparent tile: ``layouts[variant]`` is a list of line specs."""
    w, h = cell
    lines = _layout(params, variant)
    if not (isinstance(lines, list) and lines and all(isinstance(ln, dict) for ln in lines)):
        raise ProceduralError(f"params.layouts[{variant}] must be a non-empty list of line objects")
    out = np.full((h, w), PALETTE_SIZE, dtype=np.uint8)  # PALETTE_SIZE marks "transparent" until the end
    painted = np.zeros((h, w), dtype=np.bool_)
    for n, line in enumerate(lines):
        where = f"layouts[{variant}][{n}]."
        mask = _line_mask(line, cell, where)
        out[mask] = _index(line, "index", where)
        painted |= mask
    _wear(rng, out, painted, params)
    result = out.astype(np.int16)
    result[~painted] = TRANSPARENT
    return result


VARIANT_GENERATORS: Mapping[str, Callable[[Mapping[str, object], Generator, tuple[int, int], int], npt.NDArray[np.integer]]] = {
    "tiles.apron": apron,
    "tiles.asphalt": asphalt,
    "tiles.cobbles": cobbles,
    "tiles.grass": grass,
    "tiles.markings": markings,
    "tiles.open_manhole": open_manhole,
    "tiles.pavement": pavement,
    "tiles.setts": setts,
    "tiles.speed_bump": speed_bump,
    "tiles.zebra": zebra,
}
"""The ``variant`` generators of this module by registry name (a kerb ``style.interior`` may use any)."""


# ---------------------------------------------------------------------------------------------
# Kerb blob


def reduce_mask(raw: int, bits: Mapping[str, int]) -> int:
    """Clear every corner bit whose two adjacent edge bits are not both set (``reduceBlobMask``)."""
    mask = raw & (bits["n"] | bits["e"] | bits["s"] | bits["w"])
    for corner, a, b in _CORNERS:
        if raw & bits[corner] and raw & bits[a] and raw & bits[b]:
            mask |= bits[corner]
    return mask


def blob_table(params: Mapping[str, object]) -> tuple[dict[str, int], list[int]]:
    """Check ``mask_bits`` and ``blob_masks`` exactly as ``tools/levels/kerbBlob.ts`` does."""
    raw_bits = params.get("mask_bits")
    if not isinstance(raw_bits, dict) or sorted(raw_bits) != sorted(BLOB_DIRS):
        raise ProceduralError(f"params.mask_bits must name exactly {', '.join(BLOB_DIRS)}")
    bits: dict[str, int] = {}
    seen = 0
    for d in BLOB_DIRS:
        v = raw_bits[d]
        if not isinstance(v, int) or isinstance(v, bool) or not 1 <= v <= 128 or v & (v - 1):
            raise ProceduralError(f"params.mask_bits.{d} must be a single bit 1..128, got {v!r}")
        if seen & v:
            raise ProceduralError(f"params.mask_bits.{d} repeats bit {v}")
        seen |= v
        bits[d] = v
    masks = params.get("blob_masks")
    if not isinstance(masks, list) or len(masks) != BLOB_COUNT:
        n = len(masks) if isinstance(masks, list) else "no"
        raise ProceduralError(f"params.blob_masks has {n} entries; the kerb blob has {BLOB_COUNT}")
    table: list[int] = []
    for i, m in enumerate(masks):
        if not isinstance(m, int) or isinstance(m, bool) or not 0 <= m <= 255:
            raise ProceduralError(f"params.blob_masks[{i}] must be an integer 0..255, got {m!r}")
        if reduce_mask(m, bits) != m:
            raise ProceduralError(f"params.blob_masks[{i}] = {m} is not reduced (a corner bit without both edge bits)")
        if m in table:
            raise ProceduralError(f"params.blob_masks[{i}] = {m} repeats entry {table.index(m)}")
        table.append(m)
    for raw in range(256):
        if reduce_mask(raw, bits) not in table:
            raise ProceduralError(f"raw mask {raw} reduces to {reduce_mask(raw, bits)}, which is not in params.blob_masks")
    return bits, table


def kerb_distance(mask: int, bits: Mapping[str, int], cell: tuple[int, int], margin: int = 1) -> I64Array:
    """Kerb distance ``d`` per pixel over the cell plus ``margin`` px on every side.

    ``d`` = Chebyshev distance to the nearest road pixel minus one (0 = touching road, negative =
    inside a road neighbour); pixels with no road neighbour get a large value. Row ``margin``,
    column ``margin`` of the result is the cell's top-left pixel.
    """
    w, h = cell
    ys, xs = np.mgrid[-margin : h + margin, -margin : w + margin]
    far = np.full(ys.shape, 1 << 20, dtype=np.int64)
    rx, ry = (w - 1) - xs, (h - 1) - ys
    regions = {
        "n": ys,
        "s": ry,
        "w": xs,
        "e": rx,
        "nw": np.maximum(xs, ys),
        "ne": np.maximum(rx, ys),
        "se": np.maximum(rx, ry),
        "sw": np.maximum(xs, ry),
    }
    d = far
    for name in BLOB_DIRS:
        if not mask & bits[name]:
            d = np.minimum(d, regions[name])
    return d


def _style(params: Mapping[str, object]) -> tuple[Mapping[str, object], int]:
    style = _object(params, "style")
    kerb_px = _positive(style, "kerb_px", "style.")
    if kerb_px < 2:
        raise ProceduralError("params.style.kerb_px must be at least 2 (a lip on each side of the stone)")
    return style, kerb_px


def kerb_frame(mask: int, bits: Mapping[str, int], style: Mapping[str, object], interior: U8Array) -> U8Array:
    """One kerb tile for a reduced neighbour mask, drawn over ``interior`` (see the module docstring)."""
    h, w = interior.shape
    kerb_px = _positive(style, "kerb_px", "style.")
    gutter = _index(style, "gutter_index", "style.")
    top = _index(style, "top_index", "style.")
    lip_nw = _index(style, "lip_nw_index", "style.")
    lip_se = _index(style, "lip_se_index", "style.")
    d = kerb_distance(mask, bits, (w, h))
    inner = d[1:-1, 1:-1]
    toward_road = np.zeros((h, w), dtype=np.int64)
    toward_kerb_back = np.zeros((h, w), dtype=np.int64)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            nb = d[1 + dy : 1 + dy + h, 1 + dx : 1 + dx + w]
            toward_road += np.where(nb < 1, dx + dy, 0)
            toward_kerb_back += np.where(nb > kerb_px, dx + dy, 0)
    facing = np.where(inner == 1, toward_road, np.where(inner == kerb_px, toward_kerb_back, 0))
    out = interior.copy()
    stone = (inner >= 1) & (inner <= kerb_px)
    out[stone] = top
    out[stone & (facing < 0)] = lip_nw
    out[stone & (facing > 0)] = lip_se
    out[inner == 0] = gutter
    return out


def _interior(params: Mapping[str, object], ctx: Context) -> U8Array:
    """The tile a kerb is drawn over: variant ``interior_variant`` of the ``interior`` params file."""
    style = _object(params, "style")
    rel = style.get("interior")
    if not isinstance(rel, str):
        raise ProceduralError("params.style.interior must be the repo-relative path of a tile params file")
    variant = style.get("interior_variant", 0)
    if not isinstance(variant, int) or isinstance(variant, bool) or variant < 0:
        raise ProceduralError(f"params.style.interior_variant must be an integer >= 0, got {variant!r}")
    path = ctx.read_dependency(rel)
    try:
        doc: object = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ProceduralError(f"params.style.interior {rel}: cannot read it ({exc})") from None
    if not isinstance(doc, dict):
        raise ProceduralError(f"params.style.interior {rel} must be a JSON object")
    gen = doc.get("generator")
    if gen not in VARIANT_GENERATORS:
        raise ProceduralError(f"params.style.interior {rel}: generator {gen!r} is not a tiles variant generator")
    if doc.get("cell") != [ctx.cell[0], ctx.cell[1]]:
        raise ProceduralError(f"params.style.interior {rel}: cell {doc.get('cell')!r} is not the kerb cell {list(ctx.cell)}")
    seed, variants, inner_params = doc.get("seed"), doc.get("variants"), doc.get("params")
    if not isinstance(seed, int) or isinstance(seed, bool) or seed < 0:
        raise ProceduralError(f"params.style.interior {rel}: seed must be an integer >= 0")
    if not isinstance(variants, int) or isinstance(variants, bool) or not variant < variants:
        raise ProceduralError(f"params.style.interior {rel}: has no variant {variant}")
    if not isinstance(inner_params, dict):
        raise ProceduralError(f"params.style.interior {rel}: params must be an object")
    fn = VARIANT_GENERATORS[str(gen)]
    rng = Generator(PCG64(seed))
    frame: npt.NDArray[np.integer] | None = None
    for k in range(variant + 1):  # the shared rng: variant k draws after 0..k-1, as in the build
        frame = fn(inner_params, rng, ctx.cell, k)
    assert frame is not None
    if frame.shape != (ctx.cell[1], ctx.cell[0]) or int(frame.min()) < 0 or int(frame.max()) >= PALETTE_SIZE:
        raise ProceduralError(f"params.style.interior {rel}: variant {variant} is not an opaque {ctx.cell[0]}x{ctx.cell[1]} tile")
    return frame.astype(np.uint8)


def kerb_blob(params: Mapping[str, object], ctx: Context) -> dict[str, I16Array]:
    """All 47 kerb tiles ``blob:-:n``, one per entry of ``params.blob_masks``."""
    bits, table = blob_table(params)
    style, _ = _style(params)
    interior = _interior(params, ctx)
    return {f"{BLOB_STATE}:-:{n}": kerb_frame(m, bits, style, interior).astype(np.int16) for n, m in enumerate(table)}


def kerb_dependencies(params: Mapping[str, object]) -> list[str]:
    """The repo-relative files :func:`kerb_blob` reads besides its params file (the interior tile)."""
    style = params.get("style")
    if isinstance(style, dict) and isinstance(style.get("interior"), str):
        return [str(style["interior"])]
    return []
