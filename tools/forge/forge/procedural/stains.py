"""Stains and grime overlays: seeded ground decals (ART_BIBLE §8.7, §9.2).

M2 placeholders (SSP-052, ROADMAP §5.1 "P") under their final IDs; the final stain art is SSP-123
(M4) and SSP-225 (M6), the final grime patterns SSP-122 (M4).

Every generator here is a ``variant`` generator with the ASSET_PIPELINE §6.4 shape
``fn(params, rng, cell, variant) -> (h, w)`` and returns ``int16`` palette indices with
:data:`~forge.palette.TRANSPARENT` (-1) wherever the ground below shows through: stains and grime
are decals on the world, never outlined (ART_BIBLE §6.3). Every random draw comes from the shared
``rng`` in a fixed order, so variant ``k`` draws after variants ``0..k-1`` and appending a variant
never changes the earlier ones. Geometry is integer-only (squared distances, Bresenham lines, the
:data:`DIRECTIONS_16` vector table, integer box-blurred noise), so no float rounding or platform
``cos`` ever decides a pixel.

**Stains** (``stain.*``, 32x32 cell, ``world`` atlas, ENTITY_CATALOG §5):

- ``stains.gum`` (``stain.gum``): ``count`` flattened discs of ``sizes_px`` (2 or 3 px), 06 with
  their south-east pixels in 05, some (``old_fraction``) all 05, scattered with a gap between
  them.
- ``stains.milkshake`` (``stain.milkshake``): a rough 20 splash with droplets around it, a 07
  core, and a 1 px 13 ring (the dropped cup, seen from above) in a free corner nearby.
- ``stains.oil`` (``stain.oil``): a rough 01 pool with 30 and 29 sheen pixels 1-2 px inside its
  north-west rim (the sun's side, ART_BIBLE §6.1).
- ``stains.chalk_art`` (``stain.chalk_art``): child drawings from stroke lists, one
  ``layouts`` entry per variant (hopscotch, sun, stick cat), worn by random dropout.
- ``stains.splat`` (``stain.splat``): a rough 08 body with a 13 sheen toward the north-west and
  radial 08/13 flecks (a short spike, then dots) along random :data:`DIRECTIONS_16` rays.

**Grime overlays** (``stains.grime``: ``tile.grime_asphalt``, ``tile.grime_slab``,
``tile.grime_gutter``; ART_BIBLE §9.2): tileable 32x32 overlays that the ground shader masks per
4 px grime cell (TECHNICAL_DESIGN §10.3). Each ``grime_cell_px`` square covers between
``coverage_px[0]`` and ``coverage_px[1]`` of its pixels, chosen as the highest values of a
smooth toroidal noise field (``smoothing_passes``: fine, so the clean pixels clump inside the
cell without lining up along its edges); covered pixels are ``base_index`` (08), the top
``blotches.fraction`` of them by a second, coarser field (``blotches.smoothing_passes``) become
``blotches.index`` blotches that span several cells, and a random ``flecks.fraction`` become
``flecks.index``. With
``"wrap": true`` (all three) a draw is repeated from the same stream until it passes the
ART_BIBLE §9.1 seam rule, as for the wrap tiles.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Callable, Mapping, Sequence

import numpy as np
import numpy.typing as npt
from numpy.random import Generator

from forge.palette import PALETTE_SIZE, TRANSPARENT
from forge.procedural.common import ProceduralError
from forge.procedural.tiles import MAX_SEAM_DRAWS, seam_ok

__all__ = [
    "DIRECTIONS_16",
    "blob",
    "chalk_art",
    "component",
    "grime",
    "gum",
    "inset_distance",
    "milkshake",
    "oil",
    "ring",
    "smooth_noise",
    "splat",
]

I16Array = npt.NDArray[np.int16]
I64Array = npt.NDArray[np.int64]
BoolArray = npt.NDArray[np.bool_]

DIRECTIONS_16: tuple[tuple[int, int], ...] = (
    (8, 0), (7, 3), (6, 6), (3, 7), (0, 8), (-3, 7), (-6, 6), (-7, 3),
    (-8, 0), (-7, -3), (-6, -6), (-3, -7), (0, -8), (3, -7), (6, -6), (7, -3),
)  # fmt: skip
"""16 directions as integer ``(dx, dy)`` vectors of length about 8 px (screen axes, y down), in
22.5° steps clockwise from east: radial geometry with no trigonometry."""

_NOISE_MAX = 256
"""Exclusive upper bound of the raw integer noise before smoothing."""

_MAX_PLACEMENT_TRIES = 400
"""Random positions tried per stain before giving up on placing every piece."""


# ---------------------------------------------------------------------------------------------
# Params helpers


def _where(where: str, key: str) -> str:
    return f"params.{where}{key}"


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


def _int(spec: Mapping[str, object], key: str, where: str = "", minimum: int = 0) -> int:
    v = spec.get(key)
    if not isinstance(v, int) or isinstance(v, bool) or v < minimum:
        raise ProceduralError(f"{_where(where, key)} must be an integer >= {minimum}, got {v!r}")
    return v


def _range(spec: Mapping[str, object], key: str, where: str = "", minimum: int = 0) -> tuple[int, int]:
    """An inclusive ``[lo, hi]`` integer range with ``minimum <= lo <= hi``."""
    v = spec.get(key)
    if not (
        isinstance(v, list)
        and len(v) == 2
        and all(isinstance(x, int) and not isinstance(x, bool) for x in v)
        and minimum <= v[0] <= v[1]
    ):
        raise ProceduralError(f"{_where(where, key)} must be [lo, hi] integers with {minimum} <= lo <= hi, got {v!r}")
    return v[0], v[1]


def _fraction(spec: Mapping[str, object], key: str, where: str = "") -> float:
    v = spec.get(key)
    if not isinstance(v, (int, float)) or isinstance(v, bool) or not 0.0 <= float(v) <= 1.0:
        raise ProceduralError(f"{_where(where, key)} must be a number in [0, 1], got {v!r}")
    return float(v)


def _object(spec: Mapping[str, object], key: str, where: str = "") -> Mapping[str, object]:
    v = spec.get(key)
    if not isinstance(v, dict):
        raise ProceduralError(f"{_where(where, key)} must be an object")
    return v


def _point(v: object, what: str, cell: tuple[int, int]) -> tuple[int, int]:
    w, h = cell
    if not (
        isinstance(v, list)
        and len(v) == 2
        and all(isinstance(x, int) and not isinstance(x, bool) for x in v)
        and 0 <= v[0] < w
        and 0 <= v[1] < h
    ):
        raise ProceduralError(f"{what} must be an [x, y] pixel inside the {w}x{h} cell, got {v!r}")
    return v[0], v[1]


def _draw(rng: Generator, lo_hi: tuple[int, int]) -> int:
    """One integer in the inclusive range (one ``rng.integers`` call, even when ``lo == hi``)."""
    return int(rng.integers(lo_hi[0], lo_hi[1] + 1))


def _count(fraction: float, total: int) -> int:
    """``round(fraction * total)``, halves up."""
    return int(fraction * total + 0.5)


# ---------------------------------------------------------------------------------------------
# Integer geometry and noise


def smooth_noise(rng: Generator, shape: tuple[int, int], passes: int) -> I64Array:
    """Integer value noise: uniform integers box-blurred (3x3 sums) ``passes`` times on the torus.

    Toroidal (``np.roll``), so the field tiles with its cell; integer, so it is exact everywhere.
    One ``rng.integers`` call.
    """
    field = rng.integers(0, _NOISE_MAX, size=shape, dtype=np.int64)
    for _ in range(passes):
        acc = np.zeros_like(field)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                acc += np.roll(field, (dy, dx), axis=(0, 1))
        field = acc
    return field


def _scale(field: I64Array, lo: int, hi: int) -> I64Array:
    """Map an integer field linearly onto the integers ``lo..hi`` (integer arithmetic only)."""
    mn, mx = int(field.min()), int(field.max())
    return ((field - mn) * (hi - lo + 1)) // (mx - mn + 1) + lo


def component(mask: BoolArray, seed: tuple[int, int]) -> BoolArray:
    """The 4-connected component of ``mask`` that contains ``seed`` (``(y, x)``); empty if unset."""
    h, w = mask.shape
    out = np.zeros_like(mask)
    if not mask[seed]:
        return out
    queue: deque[tuple[int, int]] = deque([seed])
    out[seed] = True
    while queue:
        y, x = queue.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not out[ny, nx]:
                out[ny, nx] = True
                queue.append((ny, nx))
    return out


def _disc(cell: tuple[int, int], centre: tuple[int, int], radius: I64Array | int) -> BoolArray:
    """Pixels within ``radius + 0.5`` px of ``centre`` (``(x, y)``): ``4 d² <= (2 r + 1)²``."""
    w, h = cell
    ys, xs = np.mgrid[0:h, 0:w]
    d2 = (xs - centre[0]) ** 2 + (ys - centre[1]) ** 2
    r = np.maximum(np.asarray(radius, dtype=np.int64), 0)
    return 4 * d2 <= (2 * r + 1) ** 2


def ring(cell: tuple[int, int], centre: tuple[int, int], radius: int) -> BoolArray:
    """A 1 px circle: pixels more than ``radius - 0.5`` and at most ``radius + 0.5`` px from ``centre``."""
    return _disc(cell, centre, radius) & ~_disc(cell, centre, radius - 1)


def blob(rng: Generator, cell: tuple[int, int], centre: tuple[int, int], radius: int, rough: int) -> BoolArray:
    """An irregular disc: the radius varies by ``-rough..rough`` px with a smooth noise field.

    Only the 4-connected piece containing ``centre`` is kept, so a blob never sheds islands.
    Draws: one :func:`smooth_noise` field.
    """
    w, h = cell
    offsets = _scale(smooth_noise(rng, (h, w), 2), -rough, rough)
    return component(_disc(cell, centre, radius + offsets), (centre[1], centre[0]))


def inset_distance(mask: BoolArray) -> I64Array:
    """Per ``mask`` pixel, how many 4-neighbour erosions remove it (1 = rim); 0 outside ``mask``.

    Pixels beyond the cell count as outside.
    """
    out = np.zeros(mask.shape, dtype=np.int64)
    cur = mask.copy()
    d = 0
    while cur.any():
        d += 1
        pad = np.pad(cur, 1, constant_values=False)
        inner = cur & pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:]
        out[cur & ~inner] = d
        cur = inner
    return out


def _dilate(mask: BoolArray, px: int) -> BoolArray:
    """Square (Chebyshev) dilation by ``px`` pixels, clipped to the cell."""
    out = mask.copy()
    for _ in range(px):
        pad = np.pad(out, 1, constant_values=False)
        grown = out.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                grown |= pad[1 + dy : 1 + dy + out.shape[0], 1 + dx : 1 + dx + out.shape[1]]
        out = grown
    return out


def _line(a: tuple[int, int], b: tuple[int, int]) -> list[tuple[int, int]]:
    """Bresenham pixels from ``a`` to ``b`` inclusive (``(x, y)`` pairs)."""
    (x0, y0), (x1, y1) = a, b
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    err = dx + dy
    out: list[tuple[int, int]] = []
    while True:
        out.append((x0, y0))
        if (x0, y0) == (x1, y1):
            return out
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy


def _along(centre: tuple[int, int], direction: tuple[int, int], dist: int) -> tuple[int, int]:
    """The pixel ``dist`` px from ``centre`` along a :data:`DIRECTIONS_16` vector (rounded, halves up)."""
    dx, dy = direction
    return centre[0] + (dx * dist + 4) // 8, centre[1] + (dy * dist + 4) // 8


def _paint(out: I16Array, pixels: Sequence[tuple[int, int]], index: int) -> None:
    h, w = out.shape
    for x, y in pixels:
        if 0 <= x < w and 0 <= y < h:
            out[y, x] = index


def _top(values: I64Array, tiebreak: I64Array, mask: BoolArray, n: int) -> BoolArray:
    """The ``n`` pixels of ``mask`` with the highest ``values`` (ties: highest ``tiebreak``)."""
    flat = np.flatnonzero(mask)
    order = np.lexsort((tiebreak.ravel()[flat], values.ravel()[flat]))  # ascending
    out = np.zeros(mask.size, dtype=np.bool_)
    if n > 0:
        out[flat[order[-n:]]] = True
    return out.reshape(mask.shape)


def _empty(cell: tuple[int, int]) -> I16Array:
    return np.full((cell[1], cell[0]), TRANSPARENT, dtype=np.int16)


def _seamless(params: Mapping[str, object], draw: Callable[[], I16Array]) -> I16Array:
    """``draw()`` once, or (``wrap: true``) until the result passes the seam rule (:func:`seam_ok`)."""
    wrap = params.get("wrap", False)
    if not isinstance(wrap, bool):
        raise ProceduralError(f"params.wrap must be true or false, got {wrap!r}")
    if not wrap:
        return draw()
    for _ in range(MAX_SEAM_DRAWS):
        out = draw()
        if seam_ok(out):
            return out
    raise ProceduralError(f"no seamless draw in {MAX_SEAM_DRAWS} tries; the pattern cannot wrap")


# ---------------------------------------------------------------------------------------------
# Grime overlays (ART_BIBLE §9.2)


def grime(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> I16Array:
    """A tileable grime overlay: per grime cell, ``coverage_px`` covered pixels in 08 / blotches / flecks."""
    w, h = cell
    g = _int(params, "grime_cell_px", minimum=1)
    if w % g or h % g:
        raise ProceduralError(f"params.grime_cell_px {g} does not divide the {w}x{h} cell")
    lo, hi = _range(params, "coverage_px", minimum=1)
    if hi > g * g:
        raise ProceduralError(f"params.coverage_px {hi} exceeds the {g * g} pixels of a grime cell")
    base = _index(params, "base_index")
    passes = _int(params, "smoothing_passes", minimum=1)
    blotches = _object(params, "blotches")
    blotch_idx = _index(blotches, "index", "blotches.")
    blotch_frac = _fraction(blotches, "fraction", "blotches.")
    blotch_passes = _int(blotches, "smoothing_passes", "blotches.", minimum=1)
    flecks = params.get("flecks")
    fleck_idx, fleck_frac = -1, 0.0
    if flecks is not None:
        if not isinstance(flecks, dict):
            raise ProceduralError("params.flecks must be an object { index, fraction }")
        fleck_idx = _index(flecks, "index", "flecks.")
        fleck_frac = _fraction(flecks, "fraction", "flecks.")
    cy, cx = h // g, w // g

    def draw() -> I16Array:
        shape_field = smooth_noise(rng, (h, w), passes)
        tiebreak = rng.integers(0, 1 << 30, size=(h, w), dtype=np.int64)
        counts = rng.integers(lo, hi + 1, size=(cy, cx))
        colour_field = smooth_noise(rng, (h, w), blotch_passes)
        fleck_rank = rng.integers(0, 1 << 30, size=(h, w), dtype=np.int64)
        covered = np.zeros((h, w), dtype=np.bool_)
        for j in range(cy):
            for i in range(cx):
                sl = (slice(j * g, (j + 1) * g), slice(i * g, (i + 1) * g))
                block = np.ones((g, g), dtype=np.bool_)
                covered[sl] = _top(shape_field[sl], tiebreak[sl], block, int(counts[j, i]))
        out = _empty(cell)
        out[covered] = base
        n = int(covered.sum())
        out[_top(colour_field, tiebreak, covered, _count(blotch_frac, n))] = blotch_idx
        if fleck_idx >= 0:
            out[_top(fleck_rank, tiebreak, covered, _count(fleck_frac, n))] = fleck_idx
        return out

    return _seamless(params, draw)


# ---------------------------------------------------------------------------------------------
# Stains (ART_BIBLE §8.7)

_GUM_SHAPES: dict[int, tuple[list[tuple[int, int]], list[tuple[int, int]]]] = {
    # size -> (body pixels (dx, dy), south-east shade pixels), a flattened disc seen from above
    2: ([(0, 0), (1, 0), (0, 1), (1, 1)], [(1, 1)]),
    3: ([(1, 0), (0, 1), (1, 1), (2, 1), (1, 2)], [(2, 1), (1, 2)]),
}


def gum(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> I16Array:
    """Chewing gum: ``count`` flattened 2-3 px discs, 06 with 05 south-east pixels, spaced apart."""
    w, h = cell
    count = _range(params, "count", minimum=1)
    sizes = params.get("sizes_px")
    if not (isinstance(sizes, list) and sizes and all(s in _GUM_SHAPES for s in sizes)):
        raise ProceduralError(f"params.sizes_px must be a non-empty list of disc sizes from {sorted(_GUM_SHAPES)}")
    top = _index(params, "top_index")
    shade = _index(params, "shade_index")
    old_frac = _fraction(params, "old_fraction")
    margin = _int(params, "margin_px")
    gap = _int(params, "gap_px")
    if w - 2 * margin < 3 or h - 2 * margin < 3:
        raise ProceduralError(f"params.margin_px {margin} leaves no room in the {w}x{h} cell")
    n = _draw(rng, count)
    out = _empty(cell)
    taken = np.zeros((h, w), dtype=np.bool_)
    placed = 0
    for _ in range(_MAX_PLACEMENT_TRIES):
        if placed == n:
            break
        size = int(sizes[int(rng.integers(0, len(sizes)))])
        x0 = int(rng.integers(margin, w - margin - size + 1))
        y0 = int(rng.integers(margin, h - margin - size + 1))
        old = bool(rng.random() < old_frac)
        body, shaded = _GUM_SHAPES[size]
        mask = np.zeros((h, w), dtype=np.bool_)
        for dx, dy in body:
            mask[y0 + dy, x0 + dx] = True
        if (_dilate(mask, gap) & taken).any():
            continue
        taken |= mask
        for dx, dy in body:
            out[y0 + dy, x0 + dx] = shade if old or (dx, dy) in shaded else top
        placed += 1
    if placed < n:
        raise ProceduralError(f"stains.gum placed {placed} of {n} discs; loosen margin_px or gap_px")
    return out


def _centre(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], where: str = "") -> tuple[int, int]:
    lo, hi = _range(params, "centre_px", where)
    if hi >= min(cell):
        raise ProceduralError(f"params.{where}centre_px {hi} lies outside the {cell[0]}x{cell[1]} cell")
    return _draw(rng, (lo, hi)), _draw(rng, (lo, hi))


def _droplets(
    rng: Generator, out: I16Array, centre: tuple[int, int], radius: int, spec: Mapping[str, object], index: int, where: str
) -> BoolArray:
    """``count`` 1 px droplets ``distance_px`` beyond ``radius`` along distinct random 16-way rays."""
    count = _range(spec, "count", where)
    dist = _range(spec, "distance_px", where, minimum=1)
    n = _draw(rng, count)
    order = rng.permutation(len(DIRECTIONS_16))
    painted = np.zeros(out.shape, dtype=np.bool_)
    for k in range(min(n, len(DIRECTIONS_16))):
        x, y = _along(centre, DIRECTIONS_16[int(order[k])], radius + _draw(rng, dist))
        if 0 <= x < out.shape[1] and 0 <= y < out.shape[0]:
            out[y, x] = index
            painted[y, x] = True
    return painted


def milkshake(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> I16Array:
    """Milkshake: a rough 20 splash with droplets, a 07 core and a 1 px 13 cup ring in a free corner."""
    w, h = cell
    splash = _object(params, "splash")
    splash_idx = _index(splash, "index", "splash.")
    radius = _draw(rng, _range(splash, "radius_px", "splash.", minimum=1))
    rough = _int(splash, "rough_px", "splash.")
    centre = _centre(splash, rng, cell, "splash.")
    core = _object(params, "core")
    core_idx = _index(core, "index", "core.")
    core_r = _draw(rng, _range(core, "radius_px", "core.", minimum=0))
    cup = _object(params, "cup")
    cup_idx = _index(cup, "index", "cup.")
    cup_r = _int(cup, "radius_px", "cup.", minimum=1)
    cup_gap = _int(cup, "gap_px", "cup.")

    out = _empty(cell)
    body = blob(rng, cell, centre, radius, rough)
    out[body] = splash_idx
    drops = _droplets(rng, out, centre, radius, _object(params, "droplets"), splash_idx, "droplets.")
    out[blob(rng, cell, centre, core_r, min(1, core_r)) & body] = core_idx
    # The cup: the first corner (in a random order) whose ring clears the splash and droplets.
    inset = cup_r + 1
    corners = [(inset, inset), (w - 1 - inset, inset), (w - 1 - inset, h - 1 - inset), (inset, h - 1 - inset)]
    busy = _dilate(body | drops, cup_gap)
    for k in rng.permutation(len(corners)):
        cup_px = ring(cell, corners[int(k)], cup_r)
        if not (cup_px & busy).any():
            out[cup_px] = cup_idx
            return out
    raise ProceduralError("stains.milkshake: no corner leaves room for the cup ring; shrink the splash or the cup")


def oil(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> I16Array:
    """Oil: a rough 01 pool with 30/29 sheen 1-2 px inside its north-west rim."""
    pool = _object(params, "pool")
    pool_idx = _index(pool, "index", "pool.")
    radius = _draw(rng, _range(pool, "radius_px", "pool.", minimum=2))
    rough = _int(pool, "rough_px", "pool.")
    centre = _centre(pool, rng, cell, "pool.")
    sheen = _object(params, "sheen")
    sheen_idx = _indices(sheen, "indices", "sheen.")
    lo_in, hi_in = _range(sheen, "inset_px", "sheen.", minimum=2)
    share = _fraction(sheen, "fraction", "sheen.")

    out = _empty(cell)
    body = blob(rng, cell, centre, radius, rough)
    out[body] = pool_idx
    depth = inset_distance(body)
    h, w = body.shape
    ys, xs = np.mgrid[0:h, 0:w]
    # North-west side: x + y at least half a radius below the centre's (the sun's quarter, §6.1).
    nw = (xs - centre[0]) + (ys - centre[1]) <= -(radius // 2)
    candidates = body & (depth >= lo_in) & (depth <= hi_in) & nw
    field = smooth_noise(rng, (h, w), 1)
    tiebreak = rng.integers(0, 1 << 30, size=(h, w), dtype=np.int64)
    lit = _top(field, tiebreak, candidates, _count(share, int(candidates.sum())))
    # Split the sheen pixels into runs by the same field: higher values take the first index.
    per = -(-int(lit.sum()) // len(sheen_idx))
    remaining = lit.copy()
    for idx in sheen_idx:
        pick = _top(field, tiebreak, remaining, min(per, int(remaining.sum())))
        out[pick] = idx
        remaining &= ~pick
    return out


def _stroke(out: I16Array, stroke: Mapping[str, object], cell: tuple[int, int], where: str) -> None:
    shape = stroke.get("shape")
    index = _index(stroke, "index", where)
    if shape == "line":
        a = _point(stroke.get("from"), f"params.{where}from", cell)
        b = _point(stroke.get("to"), f"params.{where}to", cell)
        _paint(out, _line(a, b), index)
    elif shape in ("rect", "fill"):
        r = stroke.get("rect")
        if not (isinstance(r, list) and len(r) == 4 and all(isinstance(v, int) and not isinstance(v, bool) for v in r)):
            raise ProceduralError(f"params.{where}rect must be [x, y, w, h] integers")
        x, y, rw, rh = r
        if rw < 1 or rh < 1 or x < 0 or y < 0 or x + rw > cell[0] or y + rh > cell[1]:
            raise ProceduralError(f"params.{where}rect {r} must lie inside the {cell[0]}x{cell[1]} cell")
        if shape == "fill":
            out[y : y + rh, x : x + rw] = index
        else:
            out[y, x : x + rw] = index
            out[y + rh - 1, x : x + rw] = index
            out[y : y + rh, x] = index
            out[y : y + rh, x + rw - 1] = index
    elif shape in ("circle", "disc"):
        c = _point(stroke.get("centre"), f"params.{where}centre", cell)
        r = _int(stroke, "radius_px", where, minimum=1)
        out[ring(cell, c, r) if shape == "circle" else _disc(cell, c, r)] = index
    elif shape == "points":
        pts = stroke.get("points")
        if not (isinstance(pts, list) and pts):
            raise ProceduralError(f"params.{where}points must be a non-empty list of [x, y]")
        _paint(out, [_point(p, f"params.{where}points[{n}]", cell) for n, p in enumerate(pts)], index)
    else:
        raise ProceduralError(f"params.{where}shape must be line, rect, fill, circle, disc or points, got {shape!r}")


def chalk_art(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> I16Array:
    """Chalk drawings: ``layouts[variant]`` is a list of strokes, worn by ``wear.density`` dropout."""
    layouts = params.get("layouts")
    if not (isinstance(layouts, list) and layouts):
        raise ProceduralError("params.layouts must be a non-empty list (one stroke list per variant)")
    if variant >= len(layouts):
        raise ProceduralError(f"variant {variant} has no params.layouts entry ({len(layouts)} listed); variants must equal its length")
    strokes = layouts[variant]
    if not (isinstance(strokes, list) and strokes and all(isinstance(s, dict) for s in strokes)):
        raise ProceduralError(f"params.layouts[{variant}] must be a non-empty list of stroke objects")
    allowed = set(_indices(params, "palette"))
    out = _empty(cell)
    for n, stroke in enumerate(strokes):
        where = f"layouts[{variant}][{n}]."
        if _index(stroke, "index", where) not in allowed:
            raise ProceduralError(f"params.{where}index must be one of the chalk palette {sorted(allowed)}")
        _stroke(out, stroke, cell, where)
    wear = _object(params, "wear")
    drop = (rng.random(out.shape) < _fraction(wear, "density", "wear.")) & (out != TRANSPARENT)
    out[drop] = TRANSPARENT
    return out


def splat(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> I16Array:
    """A splat: rough 08 body, 13 sheen toward the north-west, radial 08/13 spikes and dots."""
    body_spec = _object(params, "body")
    body_idx = _index(body_spec, "index", "body.")
    radius = _draw(rng, _range(body_spec, "radius_px", "body.", minimum=1))
    rough = _int(body_spec, "rough_px", "body.")
    centre = _centre(body_spec, rng, cell, "body.")
    sheen = _object(params, "sheen")
    sheen_idx = _index(sheen, "index", "sheen.")
    sheen_r = _draw(rng, _range(sheen, "radius_px", "sheen.", minimum=0))
    off = sheen.get("offset_px")
    if not (isinstance(off, list) and len(off) == 2 and all(isinstance(v, int) and not isinstance(v, bool) for v in off)):
        raise ProceduralError("params.sheen.offset_px must be [dx, dy] integers")
    flecks = _object(params, "flecks")
    fleck_idx = _indices(flecks, "indices", "flecks.")
    rays = _range(flecks, "rays", "flecks.", minimum=1)
    spike = _range(flecks, "spike_px", "flecks.")
    dots = _range(flecks, "dots", "flecks.")
    step = _range(flecks, "step_px", "flecks.", minimum=1)

    out = _empty(cell)
    body = blob(rng, cell, centre, radius, rough)
    out[body] = body_idx
    sheen_centre = (centre[0] + off[0], centre[1] + off[1])
    out[_disc(cell, sheen_centre, sheen_r) & (inset_distance(body) >= 2)] = sheen_idx
    order = rng.permutation(len(DIRECTIONS_16))
    for k in range(min(_draw(rng, rays), len(DIRECTIONS_16))):
        direction = DIRECTIONS_16[int(order[k])]
        colour = fleck_idx[k % len(fleck_idx)]
        # The ray leaves the body where it last crosses it, then a spike and dots continue outward.
        edge = radius
        while edge < 2 * radius + rough + 2:
            x, y = _along(centre, direction, edge + 1)
            if not (0 <= x < cell[0] and 0 <= y < cell[1]) or not body[y, x]:
                break
            edge += 1
        length = _draw(rng, spike)
        _paint(out, [_along(centre, direction, edge + d) for d in range(1, length + 1)], colour)
        dist = edge + length
        for _ in range(_draw(rng, dots)):
            dist += _draw(rng, step)
            _paint(out, [_along(centre, direction, dist)], colour)
    return out
