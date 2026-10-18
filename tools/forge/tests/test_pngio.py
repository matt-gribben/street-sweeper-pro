"""Tests for forge.pngio: deterministic, metadata-free PNG encoding (CLAUDE.md §5.2)."""

from __future__ import annotations

import io
import struct
import zlib
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from forge.palette import TRANSPARENT, load_palette
from forge.pngio import (
    ALLOWED_CHUNKS,
    FORBIDDEN_METADATA_CHUNKS,
    PNG_TRANSPARENT_INDEX,
    PngError,
    decode_indexed_png,
    encode_indexed_png,
    encode_rgba_png,
    indices_to_rgba,
    png_chunk_types,
    write_bytes_if_changed,
)

PALETTE = load_palette()


def _frame(seed: int = 1, shape: tuple[int, int] = (24, 20)) -> np.ndarray:
    rng = np.random.Generator(np.random.PCG64(seed))
    return rng.integers(-1, 32, size=shape).astype(np.int16)


def test_indexed_round_trip_preserves_indices_and_binary_alpha() -> None:
    idx = _frame()
    data = encode_indexed_png(idx, PALETTE)
    np.testing.assert_array_equal(decode_indexed_png(data, PALETTE), idx)
    with Image.open(io.BytesIO(data)) as im:
        assert im.mode == "P"
        assert im.size == (20, 24)
        rgba = np.asarray(im.convert("RGBA"))
    assert set(np.unique(rgba[:, :, 3]).tolist()) <= {0, 255}
    np.testing.assert_array_equal(rgba, indices_to_rgba(idx, PALETTE))
    opaque = rgba[:, :, 3] == 255
    pal = {tuple(int(v) for v in c) for c in PALETTE.rgb}
    assert {tuple(int(v) for v in c) for c in rgba[opaque][:, :3]} <= pal


def test_encoding_is_byte_identical_across_calls() -> None:
    idx = _frame(7)
    assert encode_indexed_png(idx, PALETTE) == encode_indexed_png(idx.copy(), PALETTE)
    rgba = indices_to_rgba(idx, PALETTE)
    assert encode_rgba_png(rgba) == encode_rgba_png(rgba.copy())


def test_only_allowed_chunks_and_no_metadata() -> None:
    for data in (encode_indexed_png(_frame(), PALETTE), encode_rgba_png(indices_to_rgba(_frame(), PALETTE))):
        chunks = png_chunk_types(data)
        assert set(chunks) <= ALLOWED_CHUNKS
        assert not set(chunks) & FORBIDDEN_METADATA_CHUNKS
        with Image.open(io.BytesIO(data)) as im:
            assert not {"dpi", "exif", "icc_profile", "gamma", "srgb", "chromaticity"} & set(im.info)
    chunks = png_chunk_types(encode_indexed_png(_frame(), PALETTE))
    assert chunks[:3] == [b"IHDR", b"PLTE", b"tRNS"] and chunks[-1] == b"IEND"


def test_plte_is_the_palette_plus_one_transparent_entry() -> None:
    data = encode_indexed_png(_frame(), PALETTE)
    with Image.open(io.BytesIO(data)) as im:
        assert im.info["transparency"] == PNG_TRANSPARENT_INDEX == 32
        plte = bytes(im.getpalette("RGB") or b"")
    assert plte[: 32 * 3] == PALETTE.rgb.tobytes()


def test_chunk_parser_rejects_bad_crc_and_signature() -> None:
    data = bytearray(encode_indexed_png(_frame(), PALETTE))
    with pytest.raises(PngError, match="signature"):
        png_chunk_types(b"GIF89a" + bytes(data[6:]))
    data[20] ^= 0xFF  # inside IHDR
    with pytest.raises(PngError, match="CRC"):
        png_chunk_types(bytes(data))


def test_chunk_parser_sees_a_text_chunk() -> None:
    """A PNG with tEXt (as Pillow writes with pnginfo) is detected, so the tests above are meaningful."""
    from PIL import PngImagePlugin

    info = PngImagePlugin.PngInfo()
    info.add_text("Software", "x")
    buf = io.BytesIO()
    Image.new("RGBA", (2, 2)).save(buf, format="PNG", pnginfo=info)
    assert b"tEXt" in png_chunk_types(buf.getvalue())


@pytest.mark.parametrize(
    "bad",
    [
        np.zeros((0, 3), dtype=np.int16),
        np.zeros((2, 2, 1), dtype=np.int16),
        np.full((2, 2), 32, dtype=np.int16),
        np.full((2, 2), -2, dtype=np.int16),
        np.zeros((2, 2), dtype=np.float64),
    ],
)
def test_encode_rejects_bad_index_arrays(bad: np.ndarray) -> None:
    with pytest.raises(PngError):
        encode_indexed_png(bad, PALETTE)


def test_decode_rejects_foreign_pngs() -> None:
    with pytest.raises(PngError, match="mode"):
        decode_indexed_png(encode_rgba_png(np.zeros((2, 2, 4), dtype=np.uint8)))
    # A P image with another palette is rejected when the palette is checked.
    im = Image.frombytes("P", (1, 1), b"\x00")
    im.putpalette(bytes(99), "RGB")
    buf = io.BytesIO()
    im.save(buf, format="PNG", transparency=32)
    with pytest.raises(PngError, match="PLTE"):
        decode_indexed_png(buf.getvalue(), PALETTE)
    assert decode_indexed_png(buf.getvalue()).tolist() == [[0]]


def test_transparent_pixels_store_index_32() -> None:
    idx = np.array([[TRANSPARENT, 0, 31]], dtype=np.int16)
    data = encode_indexed_png(idx, PALETTE)
    with Image.open(io.BytesIO(data)) as im:
        assert np.asarray(im).tolist() == [[32, 0, 31]]


def test_idat_uses_a_fixed_compression_level() -> None:
    data = encode_indexed_png(_frame(3, (64, 64)), PALETTE)
    pos = 8
    idat = b""
    while pos < len(data):
        n, t = struct.unpack(">I4s", data[pos : pos + 8])
        if t == b"IDAT":
            idat += data[pos + 8 : pos + 8 + n]
        pos += 12 + n
    # zlib header FLEVEL bits = 3 ("maximum compression") for compress_level 9.
    assert idat[1] >> 6 == 3
    assert zlib.decompress(idat)


def test_write_bytes_if_changed(tmp_path: Path) -> None:
    p = tmp_path / "a" / "b.png"
    assert write_bytes_if_changed(p, b"x") is True
    assert write_bytes_if_changed(p, b"x") is False
    assert write_bytes_if_changed(p, b"y") is True
    assert p.read_bytes() == b"y"
    assert not list(tmp_path.rglob("*.tmp"))
