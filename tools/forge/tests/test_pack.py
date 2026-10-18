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
    MAX_ATLAS_SIZE,
    PADDING,
    MaxRects,
    PackError,
    PackItem,
    Placement,
    atlas_json,
    candidate_sizes,
    compose_atlas,
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
    other = tmp_path / "public" / "assets" / "fonts" / "x.json"
    other.parent.mkdir(parents=True)
    other.write_bytes(b"{}")
    files = {f"{ATLAS_DIR}/actors.png": b"png", ASSETS_TS: b"ts"}
    assert write_outputs(tmp_path, files) == [f"{ATLAS_DIR}/actors.png", ASSETS_TS]
    assert not stale.exists()
    assert other.exists(), "only public/assets/atlas/ is owned by the packer"
    assert write_outputs(tmp_path, files) == []


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
