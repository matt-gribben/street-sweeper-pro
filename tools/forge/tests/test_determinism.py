"""Determinism and acceptance checks over a real build of the committed M0 assets (SSP-009, SSP-010, SSP-014,
SSP-020, SSP-024).

Builds ``assets-src/manifest.json`` twice with the cache off, into two temp dirs, and checks
that every output file has the same SHA-256 (frames, atlas PNG/JSON, ``src/gen/assets.ts``,
``asset-hashes.json``); then inspects the built frames: 205 of them, 64x64 Bessie / 96x96
brush / 24x24 npc.old_woman (8 idle directions, 3 of them mirrored) / 32x32 prop.lamp_post
(4 sprite-stack slices) / 16x16 litter.banana_skin (the D-07 scale sample, h00 only), Kerbside-32 colours only with binary alpha, the outline rule, no
metadata chunks, and a palette snap that changed 0 pixels; and the packed ``actors`` and
``items`` atlases.
"""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from forge.build import BuildResult, build
from forge.outputs import ASSETS_TS, ATLAS_DIR, HASHES_JSON
from forge.palette import REPO_ROOT, load_palette
from forge.pngio import FORBIDDEN_METADATA_CHUNKS, decode_indexed_png, png_chunk_types

PALETTE = load_palette()
CELLS = {
    "litter.banana_skin": (16, 16),
    "npc.old_woman": (24, 24),
    "prop.lamp_post": (32, 32),
    "veh.sweeper": (64, 64),
    "veh.sweeper_brush": (96, 96),
}
FRAME_COUNT = 205
ATLAS_OF = {
    "litter.banana_skin": "items",
    "npc.old_woman": "actors",
    "prop.lamp_post": "items",
    "veh.sweeper": "actors",
    "veh.sweeper_brush": "actors",
}


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


def test_builds_all_m0_frames(builds: tuple[BuildResult, Path, Path]) -> None:
    result, a, _ = builds
    assert len(result.frames) == FRAME_COUNT
    counts = {aid: sum(1 for f in result.frames if f.asset_id == aid) for aid in CELLS}
    assert counts == {"litter.banana_skin": 1, "npc.old_woman": 8, "prop.lamp_post": 4, "veh.sweeper": 64, "veh.sweeper_brush": 128}
    assert len(list((a / "frames").rglob("*.png"))) == FRAME_COUNT
    assert [f.frame_id for f in result.frames] == sorted(f.frame_id for f in result.frames)
    assert "veh.sweeper:body:h07:0" in {f.frame_id for f in result.frames}
    assert "veh.sweeper:dented:h07:0" in {f.frame_id for f in result.frames}
    assert "veh.sweeper_brush:brush:h07:2" in {f.frame_id for f in result.frames}
    assert "npc.old_woman:idle:s:0" in {f.frame_id for f in result.frames}
    assert "prop.lamp_post:slice:-:3" in {f.frame_id for f in result.frames}


def test_frames_are_cell_sized_kerbside32_with_binary_alpha(builds: tuple[BuildResult, Path, Path]) -> None:
    _, a, _ = builds
    pal = {tuple(int(v) for v in c) for c in PALETTE.rgb}
    for png in sorted((a / "frames").rglob("*.png")):
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
    for png in sorted((a / "frames").rglob("*.png")):
        with Image.open(png) as im:
            rgba = np.asarray(im.convert("RGBA"))
        clear = np.pad(rgba[:, :, 3] == 0, 1, constant_values=True)
        near_clear = clear[:-2, 1:-1] | clear[2:, 1:-1] | clear[1:-1, :-2] | clear[1:-1, 2:]
        is_ink = (rgba[:, :, :3] == np.array(ink, dtype=np.uint8)).all(axis=-1)
        body = (rgba[:, :, 3] == 255) & ~is_ink
        assert not (body & near_clear).any(), png.name


def test_palette_snap_changed_zero_pixels(builds: tuple[BuildResult, Path, Path]) -> None:
    result, _, _ = builds
    zero = {aid: 0 for aid in CELLS}
    assert {a.entry.id: a.snap_changed_px for a in result.assets} == zero
    assert {a.entry.id: a.source_off_palette_px for a in result.assets} == zero
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


def test_pivots_body_centre_for_vehicles_and_feet_for_people(builds: tuple[BuildResult, Path, Path]) -> None:
    """Vehicles and the lamp post's slices take the cell centre from render.json (slices through the
    h00 fallback, SSP-020); the pedestrian grid pivots on its feet, row 22 of the 24x24 cell
    (ART_BIBLE §4.4, §7.2; SSP-018)."""
    result, _, _ = builds
    for f in result.frames:
        w, h = CELLS[f.asset_id]
        expected = (12, 22) if f.asset_id == "npc.old_woman" else (w // 2, h // 2)
        assert f.pivot == expected, f.frame_id
        assert f.atlas == ATLAS_OF[f.asset_id]


def test_old_woman_mirrors_and_feet_on_the_pivot_row(builds: tuple[BuildResult, Path, Path]) -> None:
    """SSP-014: SE/E/NE are left-right flips of SW/W/NW, and every figure fits 18x22 with its
    feet (lowest opaque row) on row 22, row 23 clear (ART_BIBLE §7.2)."""
    result, _, _ = builds
    by_id = {f.frame_id: f.indices for f in result.frames if f.asset_id == "npc.old_woman"}
    for dst, src in (("se", "sw"), ("e", "w"), ("ne", "nw")):
        np.testing.assert_array_equal(by_id[f"npc.old_woman:idle:{dst}:0"], by_id[f"npc.old_woman:idle:{src}:0"][:, ::-1])
    for fid, idx in by_id.items():
        ys, xs = np.nonzero(idx != -1)
        assert ys.max() == 22, fid
        assert xs.max() - xs.min() + 1 <= 18 and ys.max() - ys.min() + 1 <= 22, fid


def test_two_clean_builds_give_byte_identical_atlas_png_and_json(builds: tuple[BuildResult, Path, Path]) -> None:
    _, a, b = builds
    outputs = [
        f"{ATLAS_DIR}/actors.png",
        f"{ATLAS_DIR}/actors.json",
        f"{ATLAS_DIR}/items.png",
        f"{ATLAS_DIR}/items.json",
        ASSETS_TS,
        HASHES_JSON,
    ]
    for rel in outputs:
        assert (a / rel).is_file(), rel
        assert (a / rel).read_bytes() == (b / rel).read_bytes(), rel
    # M0: only the actors and items atlases have frames, and an atlas with no frames is not emitted.
    names = sorted(p.name for p in (a / ATLAS_DIR).iterdir())
    assert names == ["actors.json", "actors.png", "items.json", "items.png"]


@pytest.mark.parametrize(("name", "count"), [("actors", 200), ("items", 5)])
def test_atlas_holds_every_frame_at_its_rect(
    builds: tuple[BuildResult, Path, Path], name: str, count: int
) -> None:
    result, a, _ = builds
    assert [x.name for x in result.atlases] == ["actors", "items"]
    atlas = next(x for x in result.atlases if x.name == name)
    frames = [f for f in result.frames if f.atlas == name]
    assert len(atlas.frames) == len(frames) == count
    assert atlas.width <= 2048 and atlas.height <= 2048
    pixels = decode_indexed_png((a / ATLAS_DIR / f"{name}.png").read_bytes(), PALETTE)
    assert pixels.shape == (atlas.height, atlas.width)
    doc = json.loads((a / ATLAS_DIR / f"{name}.json").read_text(encoding="utf-8"))
    assert set(doc) == {"frames", "swaps"} and doc["swaps"] == {}
    assert list(doc["frames"]) == sorted(f.frame_id for f in frames)
    by_id = {f.frame_id: f for f in frames}
    for fid, r in doc["frames"].items():
        f = by_id[fid]
        assert (r["w"], r["h"]) == (f.width, f.height)
        assert (r["px"], r["py"]) == f.pivot
        np.testing.assert_array_equal(pixels[r["y"] : r["y"] + r["h"], r["x"] : r["x"] + r["w"]], f.indices)
