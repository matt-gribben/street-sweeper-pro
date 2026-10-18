"""Deterministic PNG encode/decode for forge outputs (CLAUDE.md §5.2, ASSET_PIPELINE §1).

Every PNG the forge writes goes through this module so the bytes are a pure function of
the pixels:

- written with Pillow, from a freshly constructed image (never one opened from disk, whose
  ``info`` could carry an ICC profile, EXIF or text into the output);
- no metadata: no ``tEXt``/``iTXt``/``zTXt``/``tIME``/``pHYs``/``iCCP``/``eXIf``/``gAMA``/
  ``cHRM``/``sRGB`` chunks, no ``pnginfo``, no ``dpi``;
- fixed encoder parameters: :data:`COMPRESS_LEVEL`, default filter strategy, and **never**
  ``optimize`` (its output depends on a search that is not part of the pinned contract).

After encoding, the chunk list is checked against :data:`ALLOWED_CHUNKS`; a stray chunk is a
bug, so it raises instead of writing.

Indexed frames
--------------
A built frame is an ``(H, W)`` integer array of Kerbside-32 indices, with ``-1``
(:data:`forge.palette.TRANSPARENT`) for transparent pixels. It is written as an 8-bit
palette (``P``) PNG whose PLTE holds the 32 palette colours in index order plus one extra
entry, :data:`PNG_TRANSPARENT_INDEX` (32), which ``tRNS`` makes fully transparent. Every
other entry is fully opaque, so alpha is binary by construction and the stored pixel value
*is* the palette index.
"""

from __future__ import annotations

import io
import struct
import zlib
from pathlib import Path

import numpy as np
import numpy.typing as npt
from PIL import Image

from forge.palette import PALETTE_SIZE, TRANSPARENT, Palette

__all__ = [
    "ALLOWED_CHUNKS",
    "COMPRESS_LEVEL",
    "FORBIDDEN_METADATA_CHUNKS",
    "PNG_TRANSPARENT_INDEX",
    "PngError",
    "decode_indexed_png",
    "encode_indexed_png",
    "encode_rgba_png",
    "indices_to_rgba",
    "png_chunk_types",
    "write_bytes_if_changed",
]

COMPRESS_LEVEL = 9
"""zlib level for every forge PNG. Fixed; ``optimize`` is never passed."""

PNG_TRANSPARENT_INDEX = PALETTE_SIZE
"""The PLTE entry (32) that ``tRNS`` marks transparent in an indexed frame PNG."""

ALLOWED_CHUNKS = frozenset({b"IHDR", b"PLTE", b"tRNS", b"IDAT", b"IEND"})
"""The only chunk types a forge PNG may contain."""

FORBIDDEN_METADATA_CHUNKS = frozenset({b"tEXt", b"iTXt", b"zTXt", b"tIME", b"pHYs"})
"""Metadata chunks that must never appear (checked explicitly by the tests)."""

_PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

IntArray = npt.NDArray[np.integer]
U8Array = npt.NDArray[np.uint8]


class PngError(ValueError):
    """A PNG is malformed, or an encode produced an unexpected chunk."""


def png_chunk_types(data: bytes) -> list[bytes]:
    """The chunk types of a PNG byte string, in file order (CRCs are verified)."""
    if not data.startswith(_PNG_SIGNATURE):
        raise PngError("not a PNG (bad signature)")
    pos = len(_PNG_SIGNATURE)
    out: list[bytes] = []
    while pos < len(data):
        if pos + 8 > len(data):
            raise PngError("truncated chunk header")
        length, ctype = struct.unpack(">I4s", data[pos : pos + 8])
        end = pos + 8 + length + 4
        if end > len(data):
            raise PngError(f"truncated {ctype!r} chunk")
        (crc,) = struct.unpack(">I", data[end - 4 : end])
        if zlib.crc32(data[pos + 4 : pos + 8 + length]) != crc:
            raise PngError(f"bad CRC in {ctype!r} chunk")
        out.append(ctype)
        pos = end
        if ctype == b"IEND":
            break
    if not out or out[0] != b"IHDR" or out[-1] != b"IEND":
        raise PngError("PNG must start with IHDR and end with IEND")
    return out


def _check_chunks(data: bytes) -> bytes:
    stray = sorted({c for c in png_chunk_types(data)} - ALLOWED_CHUNKS)
    if stray:
        raise PngError(f"encoder wrote unexpected chunks {stray}")
    return data


def _plte(palette: Palette) -> bytes:
    if len(palette) != PALETTE_SIZE:
        raise PngError(f"expected a {PALETTE_SIZE}-colour palette, got {len(palette)}")
    # The extra transparent entry's RGB is never visible; black keeps it deterministic.
    return palette.rgb.astype(np.uint8).tobytes() + b"\x00\x00\x00"


def encode_indexed_png(indices: IntArray, palette: Palette) -> bytes:
    """Encode an ``(H, W)`` index array (``-1`` = transparent) as a deterministic ``P`` PNG."""
    idx = np.asarray(indices)
    if idx.ndim != 2 or idx.shape[0] == 0 or idx.shape[1] == 0:
        raise PngError(f"expected a non-empty (H, W) index array, got shape {idx.shape}")
    if not np.issubdtype(idx.dtype, np.integer):
        raise PngError(f"index array must be integer, got {idx.dtype}")
    if idx.size and (int(idx.min()) < TRANSPARENT or int(idx.max()) >= PALETTE_SIZE):
        raise PngError(f"indices must be in -1..{PALETTE_SIZE - 1}")
    px = np.where(idx == TRANSPARENT, PNG_TRANSPARENT_INDEX, idx).astype(np.uint8)
    h, w = px.shape
    im = Image.frombytes("P", (w, h), np.ascontiguousarray(px).tobytes())
    im.putpalette(_plte(palette), "RGB")
    buf = io.BytesIO()
    im.save(buf, format="PNG", compress_level=COMPRESS_LEVEL, transparency=PNG_TRANSPARENT_INDEX)
    return _check_chunks(buf.getvalue())


def encode_rgba_png(rgba: U8Array) -> bytes:
    """Encode an ``(H, W, 4)`` ``uint8`` array as a deterministic RGBA PNG (no metadata)."""
    arr = np.asarray(rgba)
    if arr.ndim != 3 or arr.shape[2] != 4 or arr.dtype != np.uint8 or arr.shape[0] == 0 or arr.shape[1] == 0:
        raise PngError(f"expected a non-empty (H, W, 4) uint8 array, got {arr.dtype} {arr.shape}")
    h, w = arr.shape[:2]
    im = Image.frombytes("RGBA", (w, h), np.ascontiguousarray(arr).tobytes())
    buf = io.BytesIO()
    im.save(buf, format="PNG", compress_level=COMPRESS_LEVEL)
    return _check_chunks(buf.getvalue())


def decode_indexed_png(data: bytes, palette: Palette | None = None) -> npt.NDArray[np.int16]:
    """Decode a PNG written by :func:`encode_indexed_png` back to an ``int16`` index array.

    With ``palette``, the PLTE is checked against it, so a frame written for a different
    palette is rejected rather than silently reinterpreted.
    """
    with Image.open(io.BytesIO(data)) as im:
        if im.mode != "P":
            raise PngError(f"expected a palette (P) PNG, got mode {im.mode}")
        if im.info.get("transparency") != PNG_TRANSPARENT_INDEX:
            raise PngError(f"expected tRNS transparency index {PNG_TRANSPARENT_INDEX}")
        if palette is not None:
            got = bytes(im.getpalette("RGB") or b"")[: (PALETTE_SIZE + 1) * 3]
            if got != _plte(palette):
                raise PngError("PLTE does not match the Kerbside-32 palette")
        px = np.asarray(im, dtype=np.uint8)
    if px.size and int(px.max()) > PNG_TRANSPARENT_INDEX:
        raise PngError(f"pixel values must be <= {PNG_TRANSPARENT_INDEX}")
    out = px.astype(np.int16)
    out[px == PNG_TRANSPARENT_INDEX] = TRANSPARENT
    return out


def indices_to_rgba(indices: IntArray, palette: Palette) -> U8Array:
    """Expand an index array (``-1`` = transparent) to RGBA with binary alpha."""
    idx = np.asarray(indices)
    out = np.zeros((*idx.shape, 4), dtype=np.uint8)
    opaque = idx != TRANSPARENT
    out[opaque, :3] = palette.rgb[idx[opaque]]
    out[opaque, 3] = 255
    return out


def write_bytes_if_changed(path: Path, data: bytes) -> bool:
    """Write ``data`` to ``path`` (creating parents) unless it already holds exactly those bytes.

    Returns ``True`` when the file was written. Skipping identical writes keeps mtimes
    stable for tools that watch the output tree.
    """
    if path.is_file() and path.read_bytes() == data:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)
    return True
