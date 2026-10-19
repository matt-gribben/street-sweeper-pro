"""Deterministic atlas packing (ASSET_PIPELINE §9.3).

The packer is MaxRects (Jylänki, "A Thousand Ways to Pack the Bin", 2010) with the
Best-Short-Side-Fit heuristic, written with integer arithmetic only and fully specified tie
breaks, so the layout is a pure function of the list of frame sizes and frame ids:

- inputs are placed in order of **area descending, then frame id** (:func:`pack_order`);
- **no rotation**;
- **1 px padding** between frames (:data:`PADDING`): each rect is inflated by 1 px to the
  right and bottom and the bin by the same 1 px, so neighbours are 1 px apart while a frame
  may still touch the atlas edge;
- a free rect is chosen by ``(short side leftover, long side leftover, y, x)``, lowest first;
- the free list is kept sorted by ``(y, x, w, h)`` and pruned of contained rects after every
  placement.

Atlas size. The atlas is the first power-of-two size (each side 16..2048) in the order
``(area, longest side, height)`` into which every frame of the atlas fits, so small atlases
stay small and the choice is deterministic. Nothing fitting into 2048x2048 is an error
(``atlas '<name>' exceeds 2048×2048``, ASSET_PIPELINE §13.4).

M0 scope (SSP-010): frames are packed untrimmed at their cell size, and the atlas JSON
``px``/``py`` is the frame pivot within that cell. Trimming and the transparent gutter are
SSP-113 (M4).

Extrusion (SSP-039, ART_BIBLE §14.6). Frames of the tiling surface classes
(:data:`EXTRUDED_CLASSES`: ground tiles, facade modules and roof surfaces, plus the ground-tile
hazard :data:`EXTRUDED_IDS`) are packed with a
:data:`EXTRUDE` px border of duplicated edge pixels (corners repeat the corner pixel), so a
sampler that strays past the cell edge reads the surface, never a transparent seam. The atlas
rect ``{x, y, w, h}`` of an extruded frame is the **interior cell only**: the border lies
outside it, and the 1 px padding lies outside the border.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

import numpy as np
import numpy.typing as npt

from forge.manifest import ATLASES
from forge.palette import TRANSPARENT, Palette
from forge.pngio import encode_indexed_png

__all__ = [
    "ATLASES",
    "EXTRUDE",
    "EXTRUDED_CLASSES",
    "EXTRUDED_IDS",
    "MAX_ATLAS_SIZE",
    "MIN_ATLAS_SIZE",
    "PADDING",
    "Atlas",
    "AtlasFrame",
    "MaxRects",
    "PackError",
    "PackItem",
    "PackableFrame",
    "Placement",
    "atlas_json",
    "atlas_png",
    "candidate_sizes",
    "compose_atlas",
    "extrude",
    "extrusion",
    "pack_atlases",
    "pack_items",
    "pack_order",
]

MAX_ATLAS_SIZE = 2048
"""Each atlas is at most 2048x2048 (ASSET_PIPELINE §9.3)."""

MIN_ATLAS_SIZE = 16
"""Smallest atlas side considered."""

PADDING = 1
"""Transparent pixels between neighbouring frames."""

EXTRUDE = 1
"""Border of duplicated edge pixels around every frame of an extruded class (ART_BIBLE §14.6)."""

EXTRUDED_CLASSES = frozenset({"tile", "facade", "roof"})
"""Asset classes whose frames tile across a surface, so they are extruded rather than padded only.

ART_BIBLE §14.6 names ground tiles and facade modules. Roof surfaces were added by the SSP-039
lead decision: they also tile across building footprints (16 px/m on the tile grid,
ART_BIBLE §9.5) and are magnified up to 1.91x. Roof furniture shares the ``roof`` class, but
its cell edges are transparent, so its extruded border is transparent and acts as padding.
"""

EXTRUDED_IDS = frozenset({"haz.speed_bump"})
"""Assets of other classes that are drawn as ground cells, so they are extruded like ``tile.*``.

``haz.speed_bump`` is "rendered as a ground tile variant" (ENTITY_CATALOG §10): groundLayer
draws it as a whole cell like any ground tile (SSP-040). Decal hazards and stains stay padded.
"""

I16Array = npt.NDArray[np.int16]


class PackError(Exception):
    """The frames of an atlas cannot be packed (too many or too large)."""


@dataclass(frozen=True)
class PackItem:
    """A rect to place: frame id plus width and height in pixels."""

    id: str
    w: int
    h: int

    @property
    def area(self) -> int:
        return self.w * self.h


@dataclass(frozen=True)
class Placement:
    """Where an item landed (top-left corner, atlas pixels)."""

    id: str
    x: int
    y: int
    w: int
    h: int


@dataclass(frozen=True)
class _Rect:
    x: int
    y: int
    w: int
    h: int

    def contains(self, o: _Rect) -> bool:
        return self.x <= o.x and self.y <= o.y and o.x + o.w <= self.x + self.w and o.y + o.h <= self.y + self.h


def pack_order(items: Sequence[PackItem]) -> list[PackItem]:
    """The placement order: area descending, then frame id (ASSET_PIPELINE §9.3)."""
    return sorted(items, key=lambda it: (-it.area, it.id))


class MaxRects:
    """A MaxRects bin with Best-Short-Side-Fit placement and deterministic tie breaks."""

    def __init__(self, width: int, height: int) -> None:
        if width < 1 or height < 1:
            raise ValueError(f"bin must be at least 1x1, got {width}x{height}")
        self.width = width
        self.height = height
        self.free: list[_Rect] = [_Rect(0, 0, width, height)]

    def insert(self, w: int, h: int) -> tuple[int, int] | None:
        """Place a ``w`` x ``h`` rect; returns its top-left corner, or ``None`` if it does not fit."""
        best: tuple[int, int, int, int] | None = None
        for fr in self.free:
            if fr.w >= w and fr.h >= h:
                dw, dh = fr.w - w, fr.h - h
                key = (min(dw, dh), max(dw, dh), fr.y, fr.x)
                if best is None or key < best:
                    best = key
        if best is None:
            return None
        x, y = best[3], best[2]
        self._split(_Rect(x, y, w, h))
        return x, y

    def _split(self, used: _Rect) -> None:
        out: list[_Rect] = []
        for fr in self.free:
            if (
                used.x >= fr.x + fr.w
                or used.x + used.w <= fr.x
                or used.y >= fr.y + fr.h
                or used.y + used.h <= fr.y
            ):
                out.append(fr)
                continue
            if used.x > fr.x:
                out.append(_Rect(fr.x, fr.y, used.x - fr.x, fr.h))
            if used.x + used.w < fr.x + fr.w:
                right = used.x + used.w
                out.append(_Rect(right, fr.y, fr.x + fr.w - right, fr.h))
            if used.y > fr.y:
                out.append(_Rect(fr.x, fr.y, fr.w, used.y - fr.y))
            if used.y + used.h < fr.y + fr.h:
                bottom = used.y + used.h
                out.append(_Rect(fr.x, bottom, fr.w, fr.y + fr.h - bottom))
        uniq = sorted(set(out), key=lambda r: (r.y, r.x, r.w, r.h))
        self.free = [r for i, r in enumerate(uniq) if not any(j != i and o.contains(r) for j, o in enumerate(uniq))]


def candidate_sizes(max_size: int = MAX_ATLAS_SIZE, min_size: int = MIN_ATLAS_SIZE) -> list[tuple[int, int]]:
    """Power-of-two ``(w, h)`` atlas sizes in try order: area, then longest side, then height."""
    sides: list[int] = []
    s = min_size
    while s <= max_size:
        sides.append(s)
        s *= 2
    return sorted(((w, h) for w in sides for h in sides), key=lambda wh: (wh[0] * wh[1], max(wh), wh[1]))


def _try_pack(order: Sequence[PackItem], width: int, height: int, padding: int) -> list[Placement] | None:
    bin_ = MaxRects(width + padding, height + padding)
    placed: list[Placement] = []
    for it in order:
        pos = bin_.insert(it.w + padding, it.h + padding)
        if pos is None:
            return None
        placed.append(Placement(it.id, pos[0], pos[1], it.w, it.h))
    return placed


def pack_items(
    items: Sequence[PackItem],
    *,
    name: str = "atlas",
    max_size: int = MAX_ATLAS_SIZE,
    padding: int = PADDING,
) -> tuple[tuple[int, int], list[Placement]]:
    """Pack ``items`` into the smallest candidate atlas; returns ``((w, h), placements)``.

    Placements come back in placement order (:func:`pack_order`). Raises :class:`PackError`
    when the items do not fit into ``max_size`` x ``max_size``.
    """
    if not items:
        raise PackError(f"atlas '{name}' has no frames")
    ids = [it.id for it in items]
    if len(set(ids)) != len(ids):
        raise PackError(f"atlas '{name}': duplicate frame ids")
    for it in items:
        if it.w < 1 or it.h < 1:
            raise PackError(f"atlas '{name}': frame {it.id} has an empty size {it.w}x{it.h}")
    order = pack_order(items)
    need = sum((it.w + padding) * (it.h + padding) for it in order)
    widest = max(it.w for it in order)
    tallest = max(it.h for it in order)
    for w, h in candidate_sizes(max_size):
        if w < widest or h < tallest or (w + padding) * (h + padding) < need:
            continue
        placed = _try_pack(order, w, h, padding)
        if placed is not None:
            return (w, h), placed
    raise PackError(f"atlas '{name}' exceeds {max_size}×{max_size}")


# ---------------------------------------------------------------------------------------------
# Atlases


@dataclass(frozen=True)
class AtlasFrame:
    """A frame as placed in an atlas: rect plus pivot (relative to the rect)."""

    frame_id: str
    asset_id: str
    x: int
    y: int
    w: int
    h: int
    px: int
    py: int


@dataclass(frozen=True)
class Atlas:
    """One packed atlas: its size, placed frames (sorted by frame id) and pixels."""

    name: str
    width: int
    height: int
    frames: tuple[AtlasFrame, ...]
    indices: I16Array


class PackableFrame(Protocol):
    """What packing needs from a frame (:class:`forge.build.Frame` satisfies it)."""

    @property
    def frame_id(self) -> str: ...
    @property
    def asset_id(self) -> str: ...
    @property
    def atlas(self) -> str: ...
    @property
    def indices(self) -> I16Array: ...
    @property
    def pivot(self) -> tuple[int, int]: ...


def extrusion(asset_id: str) -> int:
    """The extruded border of an asset's frames: :data:`EXTRUDE` for :data:`EXTRUDED_CLASSES` and
    :data:`EXTRUDED_IDS`, else 0."""
    return EXTRUDE if asset_id.split(".", 1)[0] in EXTRUDED_CLASSES or asset_id in EXTRUDED_IDS else 0


def extrude(indices: I16Array, border: int) -> I16Array:
    """``indices`` with ``border`` px of duplicated edge pixels on every side (corners repeat the corner)."""
    if border == 0:
        return indices
    return np.pad(indices, border, mode="edge")


def compose_atlas(name: str, frames: Sequence[PackableFrame], *, max_size: int = MAX_ATLAS_SIZE) -> Atlas:
    """Pack ``frames`` (anything with ``frame_id``, ``asset_id``, ``indices``, ``pivot``) into one atlas.

    A frame of an :data:`EXTRUDED_CLASSES` asset is packed together with its extruded border,
    and its :class:`AtlasFrame` rect is the interior cell inside that border.
    """
    by_id = {f.frame_id: f for f in frames}
    if len(by_id) != len(frames):
        raise PackError(f"atlas '{name}': duplicate frame ids")
    border = {f.frame_id: extrusion(f.asset_id) for f in frames}
    items = [
        PackItem(f.frame_id, int(f.indices.shape[1]) + 2 * b, int(f.indices.shape[0]) + 2 * b)
        for f in frames
        for b in (border[f.frame_id],)
    ]
    (w, h), placed = pack_items(items, name=name, max_size=max_size)
    canvas = np.full((h, w), TRANSPARENT, dtype=np.int16)
    placed_frames: list[AtlasFrame] = []
    for p in placed:
        f = by_id[p.id]
        b = border[p.id]
        canvas[p.y : p.y + p.h, p.x : p.x + p.w] = extrude(f.indices, b)
        placed_frames.append(
            AtlasFrame(f.frame_id, f.asset_id, p.x + b, p.y + b, p.w - 2 * b, p.h - 2 * b, f.pivot[0], f.pivot[1])
        )
    placed_frames.sort(key=lambda af: af.frame_id)
    return Atlas(name=name, width=w, height=h, frames=tuple(placed_frames), indices=canvas)


def pack_atlases(frames: Sequence[PackableFrame], *, max_size: int = MAX_ATLAS_SIZE) -> list[Atlas]:
    """Group frames by their ``atlas`` field and pack each group, in :data:`ATLASES` order.

    An atlas with no frames is not emitted.
    """
    unknown = sorted({f.atlas for f in frames} - set(ATLASES))
    if unknown:
        raise PackError(f"unknown atlas name(s): {', '.join(unknown)}")
    out: list[Atlas] = []
    for name in ATLASES:
        group = sorted((f for f in frames if f.atlas == name), key=lambda f: f.frame_id)
        if group:
            out.append(compose_atlas(name, group, max_size=max_size))
    return out


def atlas_json(atlas: Atlas) -> bytes:
    """``public/assets/atlas/<name>.json``: ``{ frames: { id: {x,y,w,h,px,py} }, swaps: {} }``.

    One frame per line, keys sorted by frame id, UTF-8 with a trailing newline. Swap tables
    arrive in M4, so ``swaps`` is always empty for now.
    """
    lines = ["{", '  "frames": {']
    for i, af in enumerate(atlas.frames):
        body = json.dumps({"x": af.x, "y": af.y, "w": af.w, "h": af.h, "px": af.px, "py": af.py}, separators=(", ", ": "))
        body = "{ " + body[1:-1] + " }"
        comma = "," if i < len(atlas.frames) - 1 else ""
        lines.append(f"    {json.dumps(af.frame_id, ensure_ascii=False)}: {body}{comma}")
    lines.append("  },")
    lines.append('  "swaps": {}')
    lines.append("}")
    return ("\n".join(lines) + "\n").encode("utf-8")


def atlas_png(atlas: Atlas, palette: Palette) -> bytes:
    """The atlas pixels as a deterministic indexed PNG (same PLTE/tRNS contract as the frames)."""
    return encode_indexed_png(atlas.indices, palette)
