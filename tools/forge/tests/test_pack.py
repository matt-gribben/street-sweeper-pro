"""Tests for forge.pack (deterministic maxrects) and forge.outputs (atlas JSON, assets.ts, hashes)."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pytest
from numpy.random import PCG64, Generator
from test_build import add_grid, add_toy_renders, blender_entry, grid_entry, make_repo

from forge.build import BuildError, build
from forge.outputs import (
    ASSETS_TS,
    ASSETS_TS_HEADER,
    ATLAS_DIR,
    HASHES_JSON,
    asset_hashes_json,
    assets_ts,
    generated_files,
    write_outputs,
)
from forge.pack import (
    EXTRUDE,
    EXTRUDED_CLASSES,
    EXTRUDED_IDS,
    MAX_ATLAS_SIZE,
    PADDING,
    AtlasFrame,
    MaxRects,
    PackError,
    PackItem,
    Placement,
    atlas_json,
    candidate_sizes,
    compose_atlas,
    extrude,
    extrusion,
    pack_atlases,
    pack_items,
    pack_order,
)
from forge.palette import TRANSPARENT, load_palette
from forge.pngio import decode_indexed_png

PALETTE = load_palette()


@dataclass(frozen=True)
class F:
    """A minimal frame for packing tests."""

    frame_id: str
    asset_id: str
    atlas: str
    indices: np.ndarray
    pivot: tuple[int, int]


def frame(fid: str, w: int, h: int, colour: int = 15, atlas: str = "actors") -> F:
    return F(fid, fid.split(":")[0], atlas, np.full((h, w), colour, dtype=np.int16), (w // 2, h // 2))


def assert_no_overlap(placed: list[Placement], size: tuple[int, int], padding: int = PADDING) -> None:
    w, h = size
    for p in placed:
        assert 0 <= p.x and 0 <= p.y and p.x + p.w <= w and p.y + p.h <= h, p
    for i, a in enumerate(placed):
        for b in placed[i + 1 :]:
            # Inflate each rect by the padding to the right/bottom: inflated rects must not intersect.
            apart = (
                a.x + a.w + padding <= b.x
                or b.x + b.w + padding <= a.x
                or a.y + a.h + padding <= b.y
                or b.y + b.h + padding <= a.y
            )
            assert apart, (a, b)


# ---------------------------------------------------------------------------------------------
# Order, sizes, maxrects


def test_pack_order_is_area_descending_then_frame_id() -> None:
    items = [PackItem("b", 4, 4), PackItem("a", 4, 4), PackItem("c", 2, 8), PackItem("d", 8, 8), PackItem("e", 1, 1)]
    assert [it.id for it in pack_order(items)] == ["d", "a", "b", "c", "e"]


def test_candidate_sizes_are_powers_of_two_in_area_order() -> None:
    sizes = candidate_sizes()
    assert sizes[0] == (16, 16)
    assert sizes[-1] == (MAX_ATLAS_SIZE, MAX_ATLAS_SIZE)
    areas = [w * h for w, h in sizes]
    assert areas == sorted(areas)
    # Same area: the squarer one first, then the wider one.
    assert sizes.index((32, 32)) < sizes.index((64, 16)) < sizes.index((16, 64))
    assert all(w & (w - 1) == 0 and h & (h - 1) == 0 for w, h in sizes)


def test_maxrects_fills_a_bin_exactly_and_then_refuses() -> None:
    b = MaxRects(4, 4)
    spots = [b.insert(2, 2) for _ in range(4)]
    assert spots == [(0, 0), (2, 0), (0, 2), (2, 2)]
    assert b.insert(1, 1) is None
    assert b.free == []


def test_maxrects_best_short_side_fit() -> None:
    b = MaxRects(10, 10)
    assert b.insert(10, 6) == (0, 0)
    # Free space is a 10x4 strip; a 4x4 fits it with short-side leftover 0.
    assert b.insert(4, 4) == (0, 6)
    assert b.insert(7, 4) is None
    assert b.insert(6, 4) == (4, 6)


def test_padding_keeps_neighbours_one_pixel_apart_but_allows_the_atlas_edge() -> None:
    (w, h), placed = pack_items([PackItem("a", 16, 16), PackItem("b", 16, 16)])
    # 16 + 1 + 16 = 33 > 32, so 32x32 cannot hold both; the next size by area is 64x16.
    assert (w, h) == (64, 16)
    assert placed == [Placement("a", 0, 0, 16, 16), Placement("b", 17, 0, 16, 16)]
    assert_no_overlap(placed, (w, h))
    # Without padding the two frames share an edge and 32x16 suffices.
    assert pack_items([PackItem("a", 16, 16), PackItem("b", 16, 16)], padding=0) == (
        (32, 16),
        [Placement("a", 0, 0, 16, 16), Placement("b", 16, 0, 16, 16)],
    )


def test_single_item_gets_the_smallest_atlas_that_holds_it() -> None:
    assert pack_items([PackItem("a", 16, 16)])[0] == (16, 16)
    assert pack_items([PackItem("a", 17, 16)])[0] == (32, 16)
    assert pack_items([PackItem("a", 64, 64)])[0] == (64, 64)


def test_random_layouts_never_overlap_and_are_input_order_independent() -> None:
    rng = Generator(PCG64(20261019))
    for trial in range(25):
        n = int(rng.integers(1, 60))
        items = [
            PackItem(f"x.t{trial}:s:-:{i}", int(rng.integers(1, 100)), int(rng.integers(1, 100))) for i in range(n)
        ]
        size, placed = pack_items(items)
        assert len(placed) == n
        assert_no_overlap(placed, size)
        shuffled = [items[i] for i in rng.permutation(n)]
        assert pack_items(shuffled) == (size, placed)
        # Placements are reported in placement order.
        assert [p.id for p in placed] == [it.id for it in pack_order(items)]


def test_overflow_is_an_error_naming_the_atlas() -> None:
    with pytest.raises(PackError, match="atlas 'actors' exceeds 2048×2048"):
        pack_items([PackItem("big", 2049, 8)], name="actors")
    with pytest.raises(PackError, match="atlas 'items' exceeds 32×32"):
        pack_items([PackItem(f"i{k}", 16, 16) for k in range(4)], name="items", max_size=32)
    with pytest.raises(PackError, match="no frames"):
        pack_items([], name="fx")
    with pytest.raises(PackError, match="duplicate"):
        pack_items([PackItem("a", 1, 1), PackItem("a", 2, 2)])


def test_the_m0_bessie_set_fits_one_atlas() -> None:
    items = [PackItem(f"veh.sweeper_brush:brush:h{h:02d}:{n}", 96, 96) for h in range(32) for n in range(4)]
    items += [PackItem(f"veh.sweeper:{s}:h{h:02d}:0", 64, 64) for s in ("body", "dented") for h in range(32)]
    size, placed = pack_items(items)
    assert size == (2048, 1024)
    assert_no_overlap(placed, size)


# ---------------------------------------------------------------------------------------------
# Atlases


def test_compose_atlas_blits_frames_and_leaves_padding_transparent() -> None:
    frames = [frame("veh.a:s:-:0", 3, 2, colour=15), frame("veh.b:s:-:0", 2, 2, colour=1)]
    atlas = compose_atlas("actors", frames)
    assert [af.frame_id for af in atlas.frames] == ["veh.a:s:-:0", "veh.b:s:-:0"]
    assert atlas.indices.shape == (atlas.height, atlas.width) == (16, 16)
    for af, f in zip(atlas.frames, frames, strict=True):
        np.testing.assert_array_equal(atlas.indices[af.y : af.y + af.h, af.x : af.x + af.w], f.indices)
        assert (af.px, af.py) == f.pivot
    assert int((atlas.indices != TRANSPARENT).sum()) == 3 * 2 + 2 * 2


def test_pack_atlases_routes_by_atlas_and_skips_empty_ones() -> None:
    frames = [
        frame("litter.can:s:-:0", 4, 4, atlas="items"),
        frame("veh.a:s:-:0", 8, 8, atlas="actors"),
        frame("veh.a:s:-:1", 8, 8, atlas="actors"),
    ]
    atlases = pack_atlases(frames)
    assert [a.name for a in atlases] == ["actors", "items"]
    assert [len(a.frames) for a in atlases] == [2, 1]
    assert pack_atlases([]) == []
    with pytest.raises(PackError, match="unknown atlas"):
        pack_atlases([frame("veh.a:s:-:0", 2, 2, atlas="moon")])


def test_atlas_json_shape_and_format() -> None:
    atlas = compose_atlas("actors", [frame("veh.b:s:-:0", 2, 4), frame("veh.a:s:h07:0", 4, 2)])
    text = atlas_json(atlas).decode("utf-8")
    doc = json.loads(text)
    assert list(doc) == ["frames", "swaps"] and doc["swaps"] == {}
    assert list(doc["frames"]) == ["veh.a:s:h07:0", "veh.b:s:-:0"]
    for af in atlas.frames:
        assert doc["frames"][af.frame_id] == {"x": af.x, "y": af.y, "w": af.w, "h": af.h, "px": af.px, "py": af.py}
    lines = text.splitlines()
    assert lines[2].startswith('    "veh.a:s:h07:0": { "x": ') and lines[2].endswith(' "px": 2, "py": 1 },')
    assert text.endswith("}\n")


# ---------------------------------------------------------------------------------------------
# assets.ts and hashes


def test_assets_ts_layout() -> None:
    atlases = pack_atlases([frame("veh.b:s:h01:0", 4, 4), frame("litter.c:s:-:0", 2, 2, atlas="items")])
    text = assets_ts(atlases, ["veh.b", "litter.c", "npc.z"]).decode("utf-8")
    lines = text.splitlines()
    assert lines[0] == ASSETS_TS_HEADER
    assert lines[1] == "export const FRAME = {"
    assert lines[2].startswith('  "litter.c:s:-:0": { atlas: "items", x: ')
    assert lines[3].startswith('  "veh.b:s:h01:0": { atlas: "actors", x: ')
    assert lines[3].endswith("w: 4, h: 4, px: 2, py: 2 },")
    assert lines[4:] == [
        "} as const;",
        "export type FrameId = keyof typeof FRAME;",
        'export type AssetId = "litter.c" | "npc.z" | "veh.b";',
    ]


def test_assets_ts_with_no_frames_or_assets_still_compiles_shape() -> None:
    assert assets_ts([], []).decode("utf-8").splitlines() == [
        ASSETS_TS_HEADER,
        "export const FRAME = {} as const;",
        "export type FrameId = keyof typeof FRAME;",
        "export type AssetId = never;",
    ]


def test_generated_files_and_hashes() -> None:
    atlases = pack_atlases([frame("veh.b:s:-:0", 4, 4), frame("litter.c:s:-:0", 2, 2, atlas="items")])
    files = generated_files(atlases, ["litter.c", "veh.b"], PALETTE)
    assert list(files) == sorted(
        [
            f"{ATLAS_DIR}/actors.json",
            f"{ATLAS_DIR}/actors.png",
            f"{ATLAS_DIR}/items.json",
            f"{ATLAS_DIR}/items.png",
            ASSETS_TS,
            HASHES_JSON,
        ]
    )
    hashes = json.loads(files[HASHES_JSON])
    assert list(hashes) == sorted(hashes)
    assert set(hashes) == set(files) - {HASHES_JSON}
    for path, digest in hashes.items():
        assert digest == hashlib.sha256(files[path]).hexdigest()
    assert asset_hashes_json({"b": b"2", "a": b"1"}).decode().splitlines()[1].startswith('  "a": ')
    png = decode_indexed_png(files[f"{ATLAS_DIR}/items.png"], PALETTE)
    assert png.shape == (16, 16)


def test_write_outputs_removes_stale_atlas_files_and_skips_unchanged(tmp_path: Path) -> None:
    stale = tmp_path / ATLAS_DIR / "items.png"
    stale.parent.mkdir(parents=True)
    stale.write_bytes(b"old")
    stale_font = tmp_path / "public" / "assets" / "fonts" / "x.json"
    stale_font.parent.mkdir(parents=True)
    stale_font.write_bytes(b"{}")
    other = tmp_path / "public" / "assets" / "levels" / "x.json"
    other.parent.mkdir(parents=True)
    other.write_bytes(b"{}")
    files = {f"{ATLAS_DIR}/actors.png": b"png", ASSETS_TS: b"ts"}
    assert write_outputs(tmp_path, files) == [f"{ATLAS_DIR}/actors.png", ASSETS_TS]
    assert not stale.exists()
    assert not stale_font.exists(), "public/assets/fonts/ is owned by the forge too (SSP-068)"
    assert other.exists(), "only public/assets/atlas/ and public/assets/fonts/ are owned by the forge"
    assert write_outputs(tmp_path, files) == []


def test_generated_files_take_font_metrics_into_the_hash_listing() -> None:
    files = generated_files([], [], PALETTE, extra={"public/assets/fonts/f.json": b"{}\n"})
    assert files["public/assets/fonts/f.json"] == b"{}\n"
    assert "public/assets/fonts/f.json" in json.loads(files[HASHES_JSON])
    with pytest.raises(ValueError, match="must be a new file"):
        generated_files([], [], PALETTE, extra={"public/assets/other.json": b"{}"})


# ---------------------------------------------------------------------------------------------
# Through forge build


def test_build_publishes_atlases_assets_ts_and_hashes(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [blender_entry(), grid_entry(atlas="items")])
    add_toy_renders(repo)
    add_grid(repo)
    result = build(repo_root=repo, use_cache=False)
    assert result.publish_root == repo
    assert [a.name for a in result.atlases] == ["actors", "items"]
    for rel, data in result.outputs.items():
        assert (repo / rel).read_bytes() == data
    ts = (repo / ASSETS_TS).read_text(encoding="utf-8")
    assert ts.count('atlas: "actors"') == 8 and ts.count('atlas: "items"') == 4
    assert 'export type AssetId = "npc.toy" | "veh.toy";' in ts
    # Same build into --out: identical bytes, nothing written to the repo.
    out = tmp_path / "out"
    again = build(repo_root=repo, out_root=out, use_cache=False)
    assert again.publish_root == out
    for rel, data in result.outputs.items():
        assert (out / rel).read_bytes() == data


def test_only_still_packs_every_atlas(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [blender_entry(), grid_entry(atlas="items")])
    add_toy_renders(repo)
    add_grid(repo)
    full = build(repo_root=repo, out_root=tmp_path / "a", use_cache=False)
    only = build(repo_root=repo, out_root=tmp_path / "b", only=["npc.toy"], use_cache=False)
    assert [a.entry.id for a in only.assets] == ["npc.toy"]
    assert only.outputs == full.outputs
    cached = build(repo_root=repo, out_root=tmp_path / "c", only=["veh.toy"], cache_dir=tmp_path / "cache")
    assert cached.outputs == full.outputs


def test_an_atlas_that_loses_its_frames_is_removed(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [blender_entry(), grid_entry(atlas="items")])
    add_toy_renders(repo)
    add_grid(repo)
    build(repo_root=repo, use_cache=False)
    assert (repo / ATLAS_DIR / "items.png").exists()
    (repo / "assets-src" / "manifest.json").write_text(json.dumps({"assets": [blender_entry()]}), encoding="utf-8")
    result = build(repo_root=repo, use_cache=False)
    assert [a.name for a in result.atlases] == ["actors"]
    assert sorted(p.name for p in (repo / ATLAS_DIR).iterdir()) == ["actors.json", "actors.png"]
    assert set(json.loads((repo / HASHES_JSON).read_text(encoding="utf-8"))) == {
        f"{ATLAS_DIR}/actors.json",
        f"{ATLAS_DIR}/actors.png",
        ASSETS_TS,
    }


def test_build_reports_overflow_as_a_build_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    repo = make_repo(tmp_path, [blender_entry()])
    add_toy_renders(repo)
    import forge.pack as pack

    monkeypatch.setattr(pack, "candidate_sizes", lambda *a, **k: [(16, 16)])
    with pytest.raises(BuildError, match="atlas 'actors' exceeds 2048×2048"):
        build(repo_root=repo, out_root=tmp_path / "o", use_cache=False)


def test_publish_false_writes_frames_only(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [grid_entry()])
    add_grid(repo)
    result = build(repo_root=repo, out_root=tmp_path / "o", use_cache=False, publish=False)
    assert result.atlases == [] and result.outputs == {} and result.publish_root is None
    assert not (tmp_path / "o" / "public").exists()


# ---------------------------------------------------------------------------------------------
# World atlas: 1 px extrusion of tiling surfaces (SSP-039, ART_BIBLE §14.6)


def pattern_frame(fid: str, w: int, h: int, seed: int, atlas: str = "world") -> F:
    """A fully opaque frame whose every pixel (edges included) is a random palette index."""
    rng = Generator(PCG64(seed))
    return F(fid, fid.split(":")[0], atlas, rng.integers(0, 32, size=(h, w)).astype(np.int16), (w // 2, h // 2))


def assert_extruded(indices: np.ndarray, af: AtlasFrame, cell: np.ndarray) -> None:
    """The rect holds exactly the cell, and the 1 px ring around it duplicates the cell's edge pixels."""
    assert (af.w, af.h) == (cell.shape[1], cell.shape[0])
    assert af.x >= EXTRUDE and af.y >= EXTRUDE, "the border must fit inside the atlas"
    assert af.x + af.w + EXTRUDE <= indices.shape[1] and af.y + af.h + EXTRUDE <= indices.shape[0]
    np.testing.assert_array_equal(indices[af.y : af.y + af.h, af.x : af.x + af.w], cell)
    block = indices[af.y - 1 : af.y + af.h + 1, af.x - 1 : af.x + af.w + 1]
    np.testing.assert_array_equal(block[0, 1:-1], cell[0])  # top row
    np.testing.assert_array_equal(block[-1, 1:-1], cell[-1])  # bottom row
    np.testing.assert_array_equal(block[1:-1, 0], cell[:, 0])  # left column
    np.testing.assert_array_equal(block[1:-1, -1], cell[:, -1])  # right column
    corners = [block[0, 0], block[0, -1], block[-1, 0], block[-1, -1]]
    assert corners == [cell[0, 0], cell[0, -1], cell[-1, 0], cell[-1, -1]], "corners repeat the corner pixel"


def assert_not_extruded(indices: np.ndarray, af: AtlasFrame, cell: np.ndarray) -> None:
    """The rect holds the cell, and every pixel just outside it (inside the atlas) is transparent."""
    np.testing.assert_array_equal(indices[af.y : af.y + af.h, af.x : af.x + af.w], cell)
    h, w = indices.shape
    outside = [(af.y - 1, x) for x in range(af.x - 1, af.x + af.w + 1)]
    outside += [(af.y + af.h, x) for x in range(af.x - 1, af.x + af.w + 1)]
    outside += [(y, af.x - 1) for y in range(af.y, af.y + af.h)]
    outside += [(y, af.x + af.w) for y in range(af.y, af.y + af.h)]
    for y, x in outside:
        if 0 <= y < h and 0 <= x < w:
            assert indices[y, x] == TRANSPARENT, (af.frame_id, y, x)


def blocks_of(frames: tuple[AtlasFrame, ...]) -> list[Placement]:
    """Each frame's rect grown by its extruded border: what the packer actually placed."""
    return [
        Placement(af.frame_id, af.x - b, af.y - b, af.w + 2 * b, af.h + 2 * b)
        for af in frames
        for b in (extrusion(af.asset_id),)
    ]


def test_extruded_classes_are_tiles_facades_and_roofs() -> None:
    assert EXTRUDE == 1
    assert EXTRUDED_CLASSES == {"tile", "facade", "roof"}
    assert EXTRUDED_IDS == {"haz.speed_bump"}, "a hazard drawn as a ground tile (SSP-040)"
    assert [extrusion(a) for a in ("tile.asphalt", "facade.terrace_brick", "roof.slate", "haz.speed_bump")] == [1] * 4
    assert [extrusion(a) for a in ("stain.oil", "veh.sweeper", "npc.cat", "litter.can", "prop.bin", "haz.puddle")] == [0] * 6


def test_extrude_duplicates_edges_and_corners() -> None:
    cell = np.array([[1, 2, 3], [4, 5, 6]], dtype=np.int16)
    np.testing.assert_array_equal(
        extrude(cell, 1),
        [[1, 1, 2, 3, 3], [1, 1, 2, 3, 3], [4, 4, 5, 6, 6], [4, 4, 5, 6, 6]],
    )
    assert extrude(cell, 0) is cell


def test_compose_atlas_extrudes_tiles_facades_and_roofs_but_not_stains_or_actors() -> None:
    frames = [
        pattern_frame("tile.toy:v:-:0", 8, 8, 1),
        pattern_frame("tile.toy:v:-:1", 8, 8, 2),
        pattern_frame("facade.toy:base:-:0", 8, 10, 3),
        pattern_frame("roof.toy:v:-:0", 6, 6, 4),
        pattern_frame("stain.toy:v:-:0", 5, 5, 5),
        pattern_frame("veh.toy:body:h00:0", 7, 7, 6),
    ]
    atlas = compose_atlas("world", frames)
    by_id = {af.frame_id: af for af in atlas.frames}
    for f in frames:
        if extrusion(f.asset_id):
            assert_extruded(atlas.indices, by_id[f.frame_id], f.indices)
        else:
            assert_not_extruded(atlas.indices, by_id[f.frame_id], f.indices)
    # Extruded blocks (rect + border) keep the 1 px transparent padding between each other.
    assert_no_overlap(blocks_of(atlas.frames), (atlas.width, atlas.height))
    # Opaque pixels = every cell plus the rings of the extruded ones, nothing else.
    rings = sum(2 * (f.indices.shape[0] + f.indices.shape[1]) + 4 for f in frames if extrusion(f.asset_id))
    assert int((atlas.indices != TRANSPARENT).sum()) == sum(f.indices.size for f in frames) + rings


def test_extruded_random_layouts_never_overlap() -> None:
    rng = Generator(PCG64(39))
    classes = ("tile", "facade", "roof", "stain")
    for trial in range(20):
        n = int(rng.integers(1, 40))
        frames = [
            pattern_frame(
                f"{classes[int(rng.integers(0, 4))]}.t{trial}_{i}:v:-:0",
                int(rng.integers(1, 40)),
                int(rng.integers(1, 40)),
                trial * 100 + i,
            )
            for i in range(n)
        ]
        atlas = compose_atlas("world", frames)
        assert_no_overlap(blocks_of(atlas.frames), (atlas.width, atlas.height))
        by_id = {f.frame_id: f for f in frames}
        for af in atlas.frames:
            if extrusion(af.asset_id):
                assert_extruded(atlas.indices, af, by_id[af.frame_id].indices)
            else:
                assert_not_extruded(atlas.indices, af, by_id[af.frame_id].indices)


# Through forge build, with a fixture manifest (the repo has no world frames until SSP-040/041).

TILE_GRID = """\
id: tile.toy
cell: 4x3
palette: kerbside32

frame v:-:0
1234
5678
9abc

frame v:-:1
2222
2332
2222
"""

FACADE_GRID = """\
id: facade.toy
cell: 3x4
palette: kerbside32

frame base:-:0
def
ghi
jkl
mno
"""

BLOCK_GRID = """\
id: veh.block
cell: 3x3
palette: kerbside32

frame body:h00:0
fed
cba
987
"""


def sprite_entry(asset_id: str, cell: tuple[int, int], state: str, n: int, dirs: object, atlas: str) -> dict[str, object]:
    cls, name = asset_id.split(".")
    return {
        "id": asset_id,
        "class": cls,
        "technique": "grid",
        "source": f"assets-src/sprites/{cls}/{name}.sprite.txt",
        "cell": list(cell),
        "states": [state],
        "dirs": dirs,
        "frames": {state: n},
        "atlas": atlas,
        "outline": False,
        "swaps": [],
    }


def add_sprite(repo: Path, asset_id: str, text: str) -> None:
    cls, name = asset_id.split(".")
    p = repo / "assets-src" / "sprites" / cls / f"{name}.sprite.txt"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def world_repo(tmp_path: Path) -> Path:
    entries = [
        sprite_entry("facade.toy", (3, 4), "base", 1, "-", "world"),
        sprite_entry("tile.toy", (4, 3), "v", 2, "-", "world"),
        sprite_entry("veh.block", (3, 3), "body", 1, ["h00"], "actors"),
    ]
    repo = make_repo(tmp_path, entries)
    add_sprite(repo, "tile.toy", TILE_GRID)
    add_sprite(repo, "facade.toy", FACADE_GRID)
    add_sprite(repo, "veh.block", BLOCK_GRID)
    return repo


def grid_cell(rows: str) -> np.ndarray:
    """Rows written with the default grid key (``0``-``9``, ``a``-``v``) as an index array."""
    key = {str(i): i for i in range(10)} | {chr(ord("a") + i - 10): i for i in range(10, 32)}
    return np.array([[key[c] for c in row] for row in rows.split()], dtype=np.int16)


def rect_of(doc: dict[str, dict[str, dict[str, int]]], fid: str) -> AtlasFrame:
    r = doc["frames"][fid]
    return AtlasFrame(fid, fid.split(":")[0], r["x"], r["y"], r["w"], r["h"], r["px"], r["py"])


def test_build_packs_world_entries_into_an_extruded_world_atlas(tmp_path: Path) -> None:
    repo = world_repo(tmp_path)
    result = build(repo_root=repo, use_cache=False)
    assert [a.name for a in result.atlases] == ["world", "actors"]
    assert (repo / ATLAS_DIR / "world.png").is_file() and (repo / ATLAS_DIR / "world.json").is_file()
    cells = {
        "tile.toy:v:-:0": grid_cell("1234 5678 9abc"),
        "tile.toy:v:-:1": grid_cell("2222 2332 2222"),
        "facade.toy:base:-:0": grid_cell("def ghi jkl mno"),
    }
    doc = json.loads((repo / ATLAS_DIR / "world.json").read_text(encoding="utf-8"))
    assert sorted(doc["frames"]) == sorted(cells)
    world = decode_indexed_png((repo / ATLAS_DIR / "world.png").read_bytes(), PALETTE)
    for fid, cell in cells.items():
        # The JSON rect is exactly the interior cell; the duplicated border lies outside it.
        assert_extruded(world, rect_of(doc, fid), cell)
    # The actor in the same build lands in `actors` and is not extruded.
    actors_doc = json.loads((repo / ATLAS_DIR / "actors.json").read_text(encoding="utf-8"))
    actors = decode_indexed_png((repo / ATLAS_DIR / "actors.png").read_bytes(), PALETTE)
    assert_not_extruded(actors, rect_of(actors_doc, "veh.block:body:h00:0"), grid_cell("fed cba 987"))
    # src/gen/assets.ts mirrors the interior rects, and the hashes cover the world atlas.
    ts = (repo / ASSETS_TS).read_text(encoding="utf-8")
    for fid, r in doc["frames"].items():
        assert f'"{fid}": {{ atlas: "world", x: {r["x"]}, y: {r["y"]}, w: {r["w"]}, h: {r["h"]},' in ts
    hashes = json.loads((repo / HASHES_JSON).read_text(encoding="utf-8"))
    assert {f"{ATLAS_DIR}/world.json", f"{ATLAS_DIR}/world.png"} <= set(hashes)


def test_world_atlas_is_byte_identical_across_builds(tmp_path: Path) -> None:
    repo = world_repo(tmp_path)
    first = build(repo_root=repo, out_root=tmp_path / "a", use_cache=False)
    second = build(repo_root=repo, out_root=tmp_path / "b", use_cache=False)
    for name in ("world.png", "world.json"):
        a = (tmp_path / "a" / ATLAS_DIR / name).read_bytes()
        assert a == (tmp_path / "b" / ATLAS_DIR / name).read_bytes()
        assert a == first.outputs[f"{ATLAS_DIR}/{name}"] == second.outputs[f"{ATLAS_DIR}/{name}"]
    assert first.outputs == second.outputs


def test_no_world_entries_emit_no_world_atlas(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [sprite_entry("veh.block", (3, 3), "body", 1, ["h00"], "actors")])
    add_sprite(repo, "veh.block", BLOCK_GRID)
    result = build(repo_root=repo, use_cache=False)
    assert [a.name for a in result.atlases] == ["actors"]
    assert not (repo / ATLAS_DIR / "world.png").exists()
    assert not (repo / ATLAS_DIR / "world.json").exists()
    assert not any("world" in path for path in result.outputs)
    assert 'atlas: "world"' not in result.outputs[ASSETS_TS].decode("utf-8")
