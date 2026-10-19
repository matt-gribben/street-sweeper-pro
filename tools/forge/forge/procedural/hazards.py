"""Hazard ground decals: seeded 32x32 placeholders (ART_BIBLE §8.7, ENTITY_CATALOG §10).

M3 placeholders (SSP-101, ROADMAP §5.1 "P") under their final IDs; the final hazard decals are
SSP-123 (M4). Like the stains (:mod:`forge.procedural.stains`, whose integer geometry they share),
hazards are decals on the world: ``int16`` palette indices with
:data:`~forge.palette.TRANSPARENT` (-1) wherever the ground shows through, ``world`` atlas, never
outlined (ART_BIBLE §6.3). ``haz.oil_slick`` reuses ``stains.oil`` ("as stain.oil"), and the two
ground-tile variants (``haz.speed_bump``, ``haz.open_manhole``) are opaque tiles in
:mod:`forge.procedural.tiles`.

``variant`` generators (``fn(params, rng, cell, variant)``, every draw from the shared ``rng`` in
a fixed order, so appending a variant never changes the earlier ones):

- ``hazards.puddle`` (``haz.puddle``): a rough 25 body (an irregular edge), a 27 inner rim
  ``rim.inset_px`` deep on its north-west side (the sun's side, ART_BIBLE §6.1) and
  ``glints.count`` 2x1 px 28 glints inside it, never touching each other.
- ``hazards.pothole`` (``haz.pothole``): a rough 01 bowl with a 00 core (the pixels at least
  ``core.inset_px`` inside the bowl, shifted ``core.offset_px`` toward the north-west, where the
  bowl's own wall shades it, and never on the bowl's outermost pixel ring), a 1 px 03 broken rim (the ring just outside the bowl with
  ``rim.dropout`` of it missing) and 04 rubble crumbs scattered beyond the rim.
- ``hazards.wet_leaves`` (``haz.wet_leaves``): a rough patch darkened 01 on the
  ``patch.coverage`` share of its pixels with the highest smooth-noise value (so the ground shows
  through in clumps), with ``leaves.count`` small 14/11/13 leaves on top, spaced apart.

``frames`` generator (``fn(params, ctx)``):

- ``hazards.broken_glass`` (``haz.broken_glass``, frames ``v:-:0`` and ``v:-:1``): the 2-frame
  glint (ART_BIBLE §8.7). Both frames show the same shards, so they come from one
  ``numpy.random.Generator(PCG64(params.seed))`` stream rather than one draw per variant:
  ``shards.count`` short 28 lines (``shards.length_px`` long, along random 16-way directions,
  ending in a 27 shade pixel when longer than 1 px) inside ``area.radius_px`` of the centre,
  never touching each other. Frame ``f`` lights the first pixel of ``glints.per_frame`` shards in
  07; the frames light different shards, so the glint jumps between them. The state stays ``v``
  (ART_BIBLE §14.4), animated through its frames, as SSP-123 allows.
"""

from __future__ import annotations

from collections.abc import Mapping

import numpy as np
import numpy.typing as npt
from numpy.random import PCG64, Generator

from forge.procedural.common import Context, ProceduralError
from forge.procedural.stains import (
    DIRECTIONS_16,
    _along,
    _centre,
    _count,
    _dilate,
    _disc,
    _draw,
    _empty,
    _fraction,
    _index,
    _indices,
    _int,
    _object,
    _range,
    _top,
    blob,
    inset_distance,
    smooth_noise,
)

__all__ = ["broken_glass", "pothole", "puddle", "wet_leaves"]

I16Array = npt.NDArray[np.int16]
BoolArray = npt.NDArray[np.bool_]

_MAX_PLACEMENT_TRIES = 400
"""Random positions tried per piece before giving up on placing every piece."""

_LEAF_SHAPES: tuple[tuple[tuple[int, int], ...], ...] = (
    ((0, 0), (1, 0)),
    ((0, 0), (0, 1)),
    ((0, 0), (1, 0), (1, 1)),
    ((0, 0), (1, 1)),
    ((1, 0), (0, 1)),
    ((0, 0), (1, 0), (0, 1)),
)
"""Small leaf shapes as ``(dx, dy)`` pixels: 2 px blades and 3 px curls, seen from above."""


def _offset(spec: Mapping[str, object], key: str, where: str) -> tuple[int, int]:
    v = spec.get(key)
    if not (isinstance(v, list) and len(v) == 2 and all(isinstance(x, int) and not isinstance(x, bool) for x in v)):
        raise ProceduralError(f"params.{where}{key} must be [dx, dy] integers")
    return v[0], v[1]


def _nw_side(cell: tuple[int, int], centre: tuple[int, int], margin: int) -> BoolArray:
    """Pixels on the north-west side of ``centre``: ``x + y`` at least ``margin`` below the centre's."""
    w, h = cell
    ys, xs = np.mgrid[0:h, 0:w]
    return (xs - centre[0]) + (ys - centre[1]) <= -margin


def _place(
    rng: Generator,
    cell: tuple[int, int],
    allowed: BoolArray,
    taken: BoolArray,
    shape: tuple[tuple[int, int], ...],
    gap: int,
) -> tuple[int, int] | None:
    """A random origin where every ``shape`` pixel is ``allowed`` and ``gap`` px clear of ``taken``."""
    w, h = cell
    for _ in range(_MAX_PLACEMENT_TRIES):
        x0, y0 = int(rng.integers(0, w)), int(rng.integers(0, h))
        pixels = [(x0 + dx, y0 + dy) for dx, dy in shape]
        if not all(0 <= x < w and 0 <= y < h and allowed[y, x] for x, y in pixels):
            continue
        mask = np.zeros((h, w), dtype=np.bool_)
        for x, y in pixels:
            mask[y, x] = True
        if (_dilate(mask, gap) & taken).any():
            continue
        return x0, y0
    return None


# ---------------------------------------------------------------------------------------------
# Variant generators


def puddle(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> I16Array:
    """A puddle: rough 25 body, 27 inner rim on the north-west, 2x1 px 28 glints."""
    body_spec = _object(params, "body")
    body_idx = _index(body_spec, "index", "body.")
    radius = _draw(rng, _range(body_spec, "radius_px", "body.", minimum=3))
    rough = _int(body_spec, "rough_px", "body.")
    centre = _centre(body_spec, rng, cell, "body.")
    rim = _object(params, "rim")
    rim_idx = _index(rim, "index", "rim.")
    rim_px = _int(rim, "inset_px", "rim.", minimum=1)
    glints = _object(params, "glints")
    glint_idx = _index(glints, "index", "glints.")
    n_glints = _draw(rng, _range(glints, "count", "glints."))

    out = _empty(cell)
    body = blob(rng, cell, centre, radius, rough)
    out[body] = body_idx
    depth = inset_distance(body)
    out[body & (depth <= rim_px) & _nw_side(cell, centre, radius // 3)] = rim_idx
    inner = body & (depth > rim_px + 1)
    taken = np.zeros(body.shape, dtype=np.bool_)
    for k in range(n_glints):
        at = _place(rng, cell, inner, taken, ((0, 0), (1, 0)), 1)
        if at is None:
            raise ProceduralError(f"hazards.puddle placed {k} of {n_glints} glints; grow the body or cut glints.count")
        x, y = at
        out[y, x : x + 2] = glint_idx
        taken[y, x : x + 2] = True
    return out


def pothole(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> I16Array:
    """A pothole: rough 01 bowl, 00 core toward the north-west, broken 03 rim, 04 crumbs."""
    bowl_spec = _object(params, "bowl")
    bowl_idx = _index(bowl_spec, "index", "bowl.")
    radius = _draw(rng, _range(bowl_spec, "radius_px", "bowl.", minimum=3))
    rough = _int(bowl_spec, "rough_px", "bowl.")
    centre = _centre(bowl_spec, rng, cell, "bowl.")
    core = _object(params, "core")
    core_idx = _index(core, "index", "core.")
    core_inset = _int(core, "inset_px", "core.", minimum=1)
    dx, dy = _offset(core, "offset_px", "core.")
    rim = _object(params, "rim")
    rim_idx = _index(rim, "index", "rim.")
    dropout = _fraction(rim, "dropout", "rim.")
    crumbs = _object(params, "crumbs")
    crumb_idx = _index(crumbs, "index", "crumbs.")
    n_crumbs = _draw(rng, _range(crumbs, "count", "crumbs."))
    lo, hi = _range(crumbs, "distance_px", "crumbs.", minimum=1)

    out = _empty(cell)
    bowl = blob(rng, cell, centre, radius, rough)
    out[bowl] = bowl_idx
    # The core: the bowl's deep pixels, seen through a window shifted toward the north-west.
    depth = inset_distance(bowl)
    deep = depth >= core_inset
    shifted = np.zeros_like(deep)
    h, w = deep.shape
    ys, xs = np.nonzero(deep)
    keep = (ys + dy >= 0) & (ys + dy < h) & (xs + dx >= 0) & (xs + dx < w)
    shifted[ys[keep] + dy, xs[keep] + dx] = True
    out[shifted & (depth >= 2)] = core_idx  # never on the bowl's own rim pixels
    ring = _dilate(bowl, 1) & ~bowl
    broken = rng.random(ring.shape) < dropout
    out[ring & ~broken] = rim_idx
    # Crumbs: single pixels lo..hi px beyond the rim along distinct random 16-way rays.
    order = rng.permutation(len(DIRECTIONS_16))
    for k in range(min(n_crumbs, len(DIRECTIONS_16))):
        direction = DIRECTIONS_16[int(order[k])]
        dist = _draw(rng, (lo, hi))
        # March out from the centre to the first pixel beyond the rim, then ``dist`` further.
        edge = 0
        while edge < 2 * (radius + rough) + 4:
            x, y = _along(centre, direction, edge)
            if not (0 <= x < w and 0 <= y < h) or not (bowl[y, x] or ring[y, x]):
                break
            edge += 1
        x, y = _along(centre, direction, edge + dist - 1)
        if 0 <= x < w and 0 <= y < h and out[y, x] < 0:
            out[y, x] = crumb_idx
    return out


def wet_leaves(params: Mapping[str, object], rng: Generator, cell: tuple[int, int], variant: int) -> I16Array:
    """Wet leaves: a rough patch darkened 01 in clumps, with small 14/11/13 leaves on top."""
    patch = _object(params, "patch")
    patch_idx = _index(patch, "index", "patch.")
    radius = _draw(rng, _range(patch, "radius_px", "patch.", minimum=3))
    rough = _int(patch, "rough_px", "patch.")
    centre = _centre(patch, rng, cell, "patch.")
    coverage = _fraction(patch, "coverage", "patch.")
    passes = _int(patch, "smoothing_passes", "patch.", minimum=1)
    leaves = _object(params, "leaves")
    leaf_idx = _indices(leaves, "indices", "leaves.")
    n_leaves = _draw(rng, _range(leaves, "count", "leaves."))
    gap = _int(leaves, "gap_px", "leaves.")

    out = _empty(cell)
    area = blob(rng, cell, centre, radius, rough)
    w, h = cell
    field = smooth_noise(rng, (h, w), passes)
    tiebreak = rng.integers(0, 1 << 30, size=(h, w), dtype=np.int64)
    out[_top(field, tiebreak, area, _count(coverage, int(area.sum())))] = patch_idx
    taken = np.zeros(area.shape, dtype=np.bool_)
    for k in range(n_leaves):
        shape = _LEAF_SHAPES[int(rng.integers(0, len(_LEAF_SHAPES)))]
        colour = leaf_idx[int(rng.integers(0, len(leaf_idx)))]
        at = _place(rng, cell, area, taken, shape, gap)
        if at is None:
            raise ProceduralError(f"hazards.wet_leaves placed {k} of {n_leaves} leaves; grow the patch or cut leaves.count")
        for sx, sy in shape:
            out[at[1] + sy, at[0] + sx] = colour
            taken[at[1] + sy, at[0] + sx] = True
    return out


# ---------------------------------------------------------------------------------------------
# Frames generator


def broken_glass(params: Mapping[str, object], ctx: Context) -> dict[str, I16Array]:
    """Broken glass: the same 28/27 shards in every frame, a different pair glinting 07 in each."""
    cell = ctx.cell
    seed = _int(params, "seed")
    n_frames = _int(params, "frames", minimum=1)
    area = _object(params, "area")
    centre = _offset(area, "centre_px", "area.")
    radius = _int(area, "radius_px", "area.", minimum=2)
    shards = _object(params, "shards")
    shard_idx = _index(shards, "index", "shards.")
    shade_idx = _index(shards, "shade_index", "shards.")
    count = _range(shards, "count", "shards.", minimum=1)
    length = _range(shards, "length_px", "shards.", minimum=1)
    gap = _int(shards, "gap_px", "shards.")
    glints = _object(params, "glints")
    glint_idx = _index(glints, "index", "glints.")
    per_frame = _int(glints, "per_frame", "glints.", minimum=1)

    rng = Generator(PCG64(seed))
    allowed = _disc(cell, centre, radius)
    taken = np.zeros(allowed.shape, dtype=np.bool_)
    base = _empty(cell)
    heads: list[tuple[int, int]] = []
    n = _draw(rng, count)
    for k in range(n):
        size = _draw(rng, length)
        direction = DIRECTIONS_16[int(rng.integers(0, len(DIRECTIONS_16)))]
        shape = tuple(dict.fromkeys(_along((0, 0), direction, d) for d in range(size)))
        at = _place(rng, cell, allowed, taken, shape, gap)
        if at is None:
            raise ProceduralError(f"hazards.broken_glass placed {k} of {n} shards; grow area.radius_px or cut shards.count")
        pixels = [(at[0] + sx, at[1] + sy) for sx, sy in shape]
        for i, (x, y) in enumerate(pixels):
            base[y, x] = shade_idx if i == len(pixels) - 1 and len(pixels) > 1 else shard_idx
            taken[y, x] = True
        heads.append(pixels[0])
    if per_frame * n_frames > len(heads):
        raise ProceduralError(f"hazards.broken_glass: {n_frames} frames x {per_frame} glints needs that many shards, got {len(heads)}")
    order = rng.permutation(len(heads))
    frames: dict[str, I16Array] = {}
    for f in range(n_frames):
        arr = base.copy()
        for j in order[f * per_frame : (f + 1) * per_frame]:
            x, y = heads[int(j)]
            arr[y, x] = glint_idx
        frames[f"v:-:{f}"] = arr
    return frames
