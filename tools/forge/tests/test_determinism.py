"""Determinism and acceptance checks over a real build of the committed M0 assets (SSP-009).

Builds ``assets-src/manifest.json`` twice with the cache off, into two temp dirs, and checks
that every output file has the same SHA-256; then inspects the built frames: 192 of them,
64x64 Bessie / 96x96 brush, Kerbside-32 colours only with binary alpha, the outline rule,
no metadata chunks, and a palette snap that changed 0 pixels.
"""

from __future__ import annotations

import hashlib
import io
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from forge.build import BuildResult, build
from forge.palette import REPO_ROOT, load_palette
from forge.pngio import FORBIDDEN_METADATA_CHUNKS, png_chunk_types

PALETTE = load_palette()
CELLS = {"veh.sweeper": (64, 64), "veh.sweeper_brush": (96, 96)}


def _hashes(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(root.rglob("*"))
        if p.is_file()
    }


@pytest.fixture(scope="module")
def builds(tmp_path_factory: pytest.TempPathFactory) -> tuple[BuildResult, Path, Path]:
    a = tmp_path_factory.mktemp("a")
    b = tmp_path_factory.mktemp("b")
    result = build(repo_root=REPO_ROOT, out_root=a, use_cache=False)
    build(repo_root=REPO_ROOT, out_root=b, use_cache=False)
    return result, a, b


def test_two_builds_are_byte_identical(builds: tuple[BuildResult, Path, Path]) -> None:
    _, a, b = builds
    ha, hb = _hashes(a), _hashes(b)
    assert ha, "the build wrote nothing"
    assert ha == hb


def test_builds_all_192_frames(builds: tuple[BuildResult, Path, Path]) -> None:
    result, a, _ = builds
    assert len(result.frames) == 192
    counts = {aid: sum(1 for f in result.frames if f.asset_id == aid) for aid in CELLS}
    assert counts == {"veh.sweeper": 64, "veh.sweeper_brush": 128}
    assert len(list(a.rglob("*.png"))) == 192
    assert [f.frame_id for f in result.frames] == sorted(f.frame_id for f in result.frames)
    assert "veh.sweeper:body:h07:0" in {f.frame_id for f in result.frames}
    assert "veh.sweeper:dented:h07:0" in {f.frame_id for f in result.frames}
    assert "veh.sweeper_brush:brush:h07:2" in {f.frame_id for f in result.frames}


def test_frames_are_cell_sized_kerbside32_with_binary_alpha(builds: tuple[BuildResult, Path, Path]) -> None:
    _, a, _ = builds
    pal = {tuple(int(v) for v in c) for c in PALETTE.rgb}
    for png in sorted(a.rglob("*.png")):
        asset_id = png.parent.name
        with Image.open(png) as im:
            assert im.size == CELLS[asset_id], png.name
            rgba = np.asarray(im.convert("RGBA"))
        alpha = rgba[:, :, 3]
        assert set(np.unique(alpha).tolist()) <= {0, 255}, png.name
        colours = {tuple(int(v) for v in c) for c in rgba[alpha == 255][:, :3]}
        assert colours and colours <= pal, png.name


def test_no_opaque_non_ink_pixel_touches_transparency(builds: tuple[BuildResult, Path, Path]) -> None:
    """ART_BIBLE §6.3 over the written PNGs; out-of-frame neighbours count as transparent."""
    _, a, _ = builds
    ink = tuple(int(v) for v in PALETTE.rgb[0])
    for png in sorted(a.rglob("*.png")):
        with Image.open(png) as im:
            rgba = np.asarray(im.convert("RGBA"))
        clear = np.pad(rgba[:, :, 3] == 0, 1, constant_values=True)
        near_clear = clear[:-2, 1:-1] | clear[2:, 1:-1] | clear[1:-1, :-2] | clear[1:-1, 2:]
        is_ink = (rgba[:, :, :3] == np.array(ink, dtype=np.uint8)).all(axis=-1)
        body = (rgba[:, :, 3] == 255) & ~is_ink
        assert not (body & near_clear).any(), png.name


def test_palette_snap_changed_zero_pixels(builds: tuple[BuildResult, Path, Path]) -> None:
    result, _, _ = builds
    assert {a.entry.id: a.snap_changed_px for a in result.assets} == {"veh.sweeper": 0, "veh.sweeper_brush": 0}
    assert {a.entry.id: a.source_off_palette_px for a in result.assets} == {"veh.sweeper": 0, "veh.sweeper_brush": 0}
    assert all(f.snap_changed_px == 0 for f in result.frames)


def test_pngs_have_no_metadata_chunks(builds: tuple[BuildResult, Path, Path]) -> None:
    _, a, _ = builds
    for png in sorted(a.rglob("*.png")):
        data = png.read_bytes()
        chunks = set(png_chunk_types(data))
        assert not chunks & FORBIDDEN_METADATA_CHUNKS, png.name
        assert chunks <= {b"IHDR", b"PLTE", b"tRNS", b"IDAT", b"IEND"}, png.name
        with Image.open(io.BytesIO(data)) as im:
            assert set(im.info) == {"transparency"}, png.name


def test_pivots_come_from_render_json(builds: tuple[BuildResult, Path, Path]) -> None:
    result, _, _ = builds
    for f in result.frames:
        w, h = CELLS[f.asset_id]
        assert f.pivot == (w // 2, h // 2)
        assert f.atlas == "actors"
