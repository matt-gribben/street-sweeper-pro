"""Pixelize primitives: AI "pixel art" goldens and renders -> native-resolution sprites.

Refactored from the asset probe's ``assets-src/_probe/tools/pixelize.py`` (2026-10-18).
The probe was a script: it parsed ``sys.argv`` at import time, wrote files and built a
median-cut palette. Median cut was rejected (ADR 0002 E8): palette mapping belongs to
``forge.palette`` (Kerbside-32, OKLab). What remains here are pure functions over numpy
arrays, with no import-time side effects:

- :func:`key_bg`: real alpha thresholded at 128, else key out the median border colour
  (RGB distance > 110). ASSET_PIPELINE §9.1 step 2.
- :func:`pixel_period` / :func:`detect_period`: FFT of the colour-edge profile, searching
  only frequencies strictly between 1/16 and 1/3 (periods 3-16 px). Step 4.
- :func:`alpha_bbox` / :func:`bbox_crop`: crop to the opaque bounding box. Step 3.
- :func:`block_mode_keys` / :func:`block_mode_resize`: block-mode resample by majority over
  opaque pixels. Step 5.

Array conventions: images are ``(H, W, 3)`` RGB or ``(H, W, 4)`` RGBA ``uint8`` arrays.
Inputs are never modified; every function returns new arrays.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
import numpy.typing as npt

__all__ = [
    "ALPHA_THRESHOLD",
    "BG_KEY_DISTANCE",
    "MAX_PERIOD_PX",
    "MIN_PERIOD_PX",
    "REAL_ALPHA_MIN_TRANSPARENT_FRACTION",
    "KeyedImage",
    "alpha_bbox",
    "bbox_crop",
    "block_mode_keys",
    "block_mode_resize",
    "detect_period",
    "key_bg",
    "masked_rgb",
    "pixel_period",
    "resample_at_period",
    "rgb555_keys",
]

U8Array = npt.NDArray[np.uint8]
IntArray = npt.NDArray[np.integer]
BoolArray = npt.NDArray[np.bool_]

ALPHA_THRESHOLD = 128
"""A pixel is opaque when its alpha is >= this value (binary alpha everywhere in the forge)."""

BG_KEY_DISTANCE = 110.0
"""Border-colour key: a pixel is foreground when its RGB distance to the key is > this."""

REAL_ALPHA_MIN_TRANSPARENT_FRACTION = 0.2
"""An RGBA image has *meaningful* alpha when more than this fraction of pixels have alpha 0.

Otherwise the alpha channel is treated as absent and the border colour is keyed instead
(Codex sometimes returns fully opaque RGBA PNGs with a flat background)."""

MIN_PERIOD_PX = 3
MAX_PERIOD_PX = 16
"""Pseudo-pixel period search band. Frequencies strictly between 1/16 and 1/3 cycles per px:
large enough to skip JPEG/noise jitter, small enough to skip frame spacing."""

_FFT_OVERSAMPLE = 4
_RGB555_SHIFT = 3  # 8-bit channel -> 5-bit bucket (//8)


@dataclass(frozen=True, slots=True)
class KeyedImage:
    """Result of :func:`key_bg`.

    ``rgba`` has binary alpha (0 or 255). ``method`` says which rule produced it;
    ``bg_rgb`` is the keyed median border colour for ``"border"`` and ``None`` for ``"alpha"``.
    """

    rgba: U8Array
    method: Literal["alpha", "border"]
    bg_rgb: tuple[float, float, float] | None


def _check_image(img: npt.NDArray[np.generic], name: str = "image") -> None:
    if img.ndim != 3 or img.shape[2] not in (3, 4):
        raise ValueError(f"{name} must be an (H, W, 3) or (H, W, 4) array, got shape {img.shape}")
    if img.dtype != np.uint8:
        raise ValueError(f"{name} must be uint8, got {img.dtype}")
    if img.shape[0] == 0 or img.shape[1] == 0:
        raise ValueError(f"{name} must be non-empty, got shape {img.shape}")


def _check_rgba(img: npt.NDArray[np.generic], name: str = "image") -> None:
    _check_image(img, name)
    if img.shape[2] != 4:
        raise ValueError(f"{name} must be RGBA (H, W, 4), got shape {img.shape}")


def key_bg(img: U8Array, threshold: float = BG_KEY_DISTANCE) -> KeyedImage:
    """Return ``img`` as RGBA with binary alpha.

    - RGBA input whose alpha is meaningful (more than
      :data:`REAL_ALPHA_MIN_TRANSPARENT_FRACTION` of pixels at alpha 0): alpha becomes
      ``255 if alpha >= 128 else 0``; RGB is kept unchanged.
    - Otherwise (RGB input, or RGBA with no meaningful alpha): the background colour is the
      per-channel median of the four border rows/columns, and a pixel is opaque when its
      Euclidean RGB distance to that colour is strictly greater than ``threshold``.
    """
    _check_image(img)
    if img.shape[2] == 4:
        alpha = img[:, :, 3]
        if float((alpha == 0).mean()) > REAL_ALPHA_MIN_TRANSPARENT_FRACTION:
            out = img.copy()
            out[:, :, 3] = np.where(alpha >= ALPHA_THRESHOLD, 255, 0).astype(np.uint8)
            return KeyedImage(rgba=out, method="alpha", bg_rgb=None)

    rgb = np.ascontiguousarray(img[:, :, :3])
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]).astype(np.float64)
    bg = np.median(border, axis=0)
    diff = rgb.astype(np.float64) - bg
    dist_sq = (diff * diff).sum(axis=-1)
    alpha = np.where(dist_sq > float(threshold) ** 2, 255, 0).astype(np.uint8)
    out = np.dstack([rgb, alpha])
    bg_rgb = (float(bg[0]), float(bg[1]), float(bg[2]))
    return KeyedImage(rgba=out, method="border", bg_rgb=bg_rgb)


def masked_rgb(rgba: U8Array) -> U8Array:
    """RGB with every transparent pixel (alpha == 0) set to black, as the period detector expects."""
    _check_rgba(rgba)
    return (rgba[:, :, :3] * (rgba[:, :, 3:] > 0)).astype(np.uint8)


def pixel_period(rgb: U8Array, axis: int) -> float:
    """Dominant period, in source px, of colour edges along ``axis`` (the pseudo-pixel size).

    ``axis=1`` measures along x (columns), ``axis=0`` along y (rows). The edge profile is the
    summed absolute RGB difference between neighbours, projected onto ``axis``; its mean is
    removed and it is zero-padded to 4x length before the real FFT. Only frequencies strictly
    between 1/16 and 1/3 are considered; ties in magnitude go to the lowest frequency
    (longest period), via ``argmax``'s first-index rule.
    """
    _check_image(rgb, "rgb")
    if axis not in (0, 1):
        raise ValueError(f"axis must be 0 (y) or 1 (x), got {axis}")
    a = rgb[:, :, :3].astype(np.float32)
    edges = np.abs(np.diff(a, axis=axis)).sum(-1)
    prof = edges.sum(axis=1 - axis)
    prof = prof - prof.mean()
    n = len(prof)
    if n < 2:
        raise ValueError("image too small along the measured axis to detect a period")
    spec = np.abs(np.fft.rfft(prof, n=n * _FFT_OVERSAMPLE))
    freqs = np.fft.rfftfreq(n * _FFT_OVERSAMPLE)
    ok = (freqs > 1 / MAX_PERIOD_PX) & (freqs < 1 / MIN_PERIOD_PX)
    if not ok.any():
        raise ValueError("image too small to resolve any period in the 3-16 px band")
    f = freqs[ok][np.argmax(spec[ok])]
    return float(1 / f)


def detect_period(rgba: U8Array) -> tuple[float, float]:
    """``(period_x, period_y)`` of a keyed RGBA sheet (transparent pixels count as black)."""
    rgb = masked_rgb(rgba)
    return pixel_period(rgb, 1), pixel_period(rgb, 0)


def alpha_bbox(rgba: U8Array) -> tuple[int, int, int, int] | None:
    """Bounding box ``(left, top, right, bottom)`` (exclusive right/bottom) of alpha > 0.

    Same box as Pillow's ``getchannel("A").getbbox()``; ``None`` when fully transparent.
    """
    _check_rgba(rgba)
    nz = rgba[:, :, 3] > 0
    rows = np.flatnonzero(nz.any(axis=1))
    if rows.size == 0:
        return None
    cols = np.flatnonzero(nz.any(axis=0))
    return int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1


def bbox_crop(rgba: U8Array) -> U8Array:
    """Crop to :func:`alpha_bbox`; a fully transparent image is returned unchanged (as a copy)."""
    bb = alpha_bbox(rgba)
    if bb is None:
        return rgba.copy()
    left, top, right, bottom = bb
    return rgba[top:bottom, left:right].copy()


def _block_bounds(size: int, out_size: int, i: int) -> tuple[int, int]:
    """Source span of output cell ``i`` (integer maths; every block holds at least one px)."""
    start = (i * size) // out_size
    end = max(((i + 1) * size) // out_size, start + 1)
    return start, end


def rgb555_keys(rgb: U8Array) -> npt.NDArray[np.int32]:
    """Pack 8-bit RGB into 15-bit bucket keys ``(R>>3)<<10 | (G>>3)<<5 | (B>>3)``."""
    q = rgb[..., :3].astype(np.int32) >> _RGB555_SHIFT
    return (q[..., 0] << 10) | (q[..., 1] << 5) | q[..., 2]


def block_mode_keys(
    keys: IntArray, opaque: BoolArray, out_w: int, out_h: int
) -> tuple[npt.NDArray[np.int64], BoolArray]:
    """Block-mode resample of an integer key image to ``out_w`` x ``out_h``.

    Each output cell covers source rows ``[y*H//out_h, max((y+1)*H//out_h, y*H//out_h + 1))``
    (likewise for columns). A cell is opaque when at least half of its source pixels are
    opaque (an exact half counts as opaque). Its key is the most frequent key among the
    opaque source pixels.

    **Tie rule: ties go to the lowest key.** With palette indices as keys this is the
    "lower palette index wins" rule (ASSET_PIPELINE §9.1 step 5). Transparent output cells
    get key ``-1``.
    """
    if keys.ndim != 2 or opaque.shape != keys.shape:
        raise ValueError("keys must be 2-D and opaque must have the same shape")
    if out_w < 1 or out_h < 1:
        raise ValueError(f"output size must be >= 1x1, got {out_w}x{out_h}")
    h, w = keys.shape
    out_keys = np.full((out_h, out_w), -1, dtype=np.int64)
    out_opaque = np.zeros((out_h, out_w), dtype=np.bool_)
    for y in range(out_h):
        y0, y1 = _block_bounds(h, out_h, y)
        for x in range(out_w):
            x0, x1 = _block_bounds(w, out_w, x)
            blk_opaque = opaque[y0:y1, x0:x1]
            n_opaque = int(blk_opaque.sum())
            if n_opaque * 2 < blk_opaque.size:
                continue
            vals, counts = np.unique(keys[y0:y1, x0:x1][blk_opaque], return_counts=True)
            # np.unique returns vals ascending and argmax returns the first maximum,
            # so a tie resolves to the lowest key.
            out_keys[y, x] = int(vals[np.argmax(counts)])
            out_opaque[y, x] = True
    return out_keys, out_opaque


def block_mode_resize(rgba: U8Array, out_w: int, out_h: int) -> U8Array:
    """Block-mode resample an RGBA image to ``out_w`` x ``out_h`` with binary alpha.

    Before palette indices exist, colours are bucketed by :func:`rgb555_keys` (5 bits per
    channel) and :func:`block_mode_keys` picks the majority bucket over opaque pixels
    (alpha >= 128). **Deterministic tie rule (pre-palette): the lowest RGB555 key wins**,
    i.e. compare R>>3, then G>>3, then B>>3. The output colour is the per-channel integer
    floor of the mean of that bucket's opaque pixels inside the block.
    """
    _check_rgba(rgba)
    rgb = rgba[:, :, :3]
    opaque = rgba[:, :, 3] >= ALPHA_THRESHOLD
    keys = rgb555_keys(rgb)
    out_keys, out_opaque = block_mode_keys(keys, opaque, out_w, out_h)
    h, w = keys.shape
    res = np.zeros((out_h, out_w, 4), dtype=np.uint8)
    for y in range(out_h):
        y0, y1 = _block_bounds(h, out_h, y)
        for x in range(out_w):
            if not out_opaque[y, x]:
                continue
            x0, x1 = _block_bounds(w, out_w, x)
            sel = opaque[y0:y1, x0:x1] & (keys[y0:y1, x0:x1] == out_keys[y, x])
            px = rgb[y0:y1, x0:x1][sel].astype(np.int64)
            res[y, x, :3] = (px.sum(axis=0) // len(px)).astype(np.uint8)
            res[y, x, 3] = 255
    return res


def resample_at_period(rgba: U8Array, period: float) -> U8Array:
    """Block-mode resample so each detected pseudo-pixel becomes one output pixel.

    Output size is ``max(1, round(W / period))`` x ``max(1, round(H / period))``.
    """
    if not period > 0:
        raise ValueError(f"period must be > 0, got {period}")
    _check_rgba(rgba)
    h, w = rgba.shape[:2]
    return block_mode_resize(rgba, max(1, round(w / period)), max(1, round(h / period)))
