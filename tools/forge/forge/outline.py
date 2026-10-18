"""The 1 px ink outline (ART_BIBLE §6.3, ASSET_PIPELINE §9.2).

Rule: **every transparent pixel 4-adjacent to a non-ink opaque pixel becomes ink** (index 00,
``#0f0e12``). The outline is 4-connected and lies outside the silhouette. Ink pixels never
seed new outline, so a grid that already has a full ink border is unchanged (the build
*completes* an outline; it never thickens one).

Frames are ``(H, W)`` integer index arrays with :data:`forge.palette.TRANSPARENT` (-1) for
transparent pixels. Pixels outside the frame are treated as transparent but cannot be
painted, so a non-ink pixel on the frame edge is reported by :func:`outline_gaps` and the
build refuses such a frame (the visible body must be at most cell - 2 px, ASSET_PIPELINE §6.1).
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

from forge.palette import TRANSPARENT

__all__ = ["INK", "add_outline", "outline_gaps"]

INK = 0
"""Palette index of ``ink`` (``#0f0e12``), the outline colour."""

IntArray = npt.NDArray[np.integer]
BoolArray = npt.NDArray[np.bool_]


def _check(indices: IntArray) -> None:
    if indices.ndim != 2:
        raise ValueError(f"expected an (H, W) index array, got shape {indices.shape}")
    if not np.issubdtype(indices.dtype, np.integer):
        raise ValueError(f"expected an integer index array, got {indices.dtype}")


def _any_4_neighbour(mask: BoolArray) -> BoolArray:
    """``True`` where any of the 4 neighbours (inside the frame) is ``True``."""
    out = np.zeros_like(mask)
    out[1:, :] |= mask[:-1, :]
    out[:-1, :] |= mask[1:, :]
    out[:, 1:] |= mask[:, :-1]
    out[:, :-1] |= mask[:, 1:]
    return out


def add_outline(indices: IntArray) -> IntArray:
    """Return a copy of ``indices`` with the 1 px, 4-connected ink outline completed."""
    _check(indices)
    body = (indices != TRANSPARENT) & (indices != INK)
    grow = (indices == TRANSPARENT) & _any_4_neighbour(body)
    out = indices.copy()
    out[grow] = INK
    return out


def outline_gaps(indices: IntArray) -> BoolArray:
    """Mask of opaque non-ink pixels that are 4-adjacent to transparency.

    Out-of-frame neighbours count as transparent. An empty mask means the outline rule holds
    (ART_BIBLE §6.3: "an opaque, non-ink pixel 4-adjacent to transparency" fails lint).
    """
    _check(indices)
    transparent = np.pad(indices == TRANSPARENT, 1, constant_values=True)
    near = (
        transparent[:-2, 1:-1] | transparent[2:, 1:-1] | transparent[1:-1, :-2] | transparent[1:-1, 2:]
    )
    return (indices != TRANSPARENT) & (indices != INK) & near
