"""Tests for forge.build on synthetic sources (grid and blender techniques, cache, CLI)."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from PIL import Image

from forge.build import (
    ASSET_JSON,
    BuildError,
    asset_cache_key,
    build,
    grid_pivot,
    parse_render_name,
    reduce_render,
)
from forge.manifest import entry_from_data
from forge.outline import outline_gaps
from forge.palette import PALETTE_PATH, TRANSPARENT, load_palette
from forge.pixelize import block_mode_keys, block_mode_keys_factor
from forge.pngio import decode_indexed_png, png_chunk_types

PALETTE = load_palette()
FORGE_ROOT = Path(__file__).resolve().parents[1]


def rgba_of(index: int) -> list[int]:
    return [*(int(v) for v in PALETTE.rgb[index]), 255]


CLEAR = [0, 0, 0, 0]


# ---------------------------------------------------------------------------------------------
# Synthetic repo


def blender_entry(asset_id: str = "veh.toy", cell: int = 8, **over: Any) -> dict[str, Any]:
    e: dict[str, Any] = {
        "id": asset_id,
        "class": asset_id.split(".")[0],
        "technique": "blender",
        "source": f"assets-src/rendered/{asset_id}",
        "cell": [cell, cell],
        "states": ["body", "dented"],
        "dirs": "h4",
        "frames": {"body": 1, "dented": 1},
        "atlas": "actors",
        "outline": True,
        "swaps": [],
    }
    e.update(over)
    return e


def toy_render(cell: int, heading: int, colour: int = 15, dent: bool = False) -> np.ndarray:
    """A 4x render: a (cell/2)-px square of ``colour`` at the centre, a 1 px tar mark at heading."""
    size = cell * 4
    img = np.zeros((size, size, 4), dtype=np.uint8)
    lo, hi = size // 4, size - size // 4
    img[lo:hi, lo:hi] = rgba_of(colour)
    mark = [(lo, lo), (lo, hi - 4), (hi - 4, hi - 4), (hi - 4, lo)][heading]
    img[mark[0] : mark[0] + 4, mark[1] : mark[1] + 4] = rgba_of(1)
    if dent:
        img[lo + 4 : lo + 8, lo + 4 : lo + 8] = rgba_of(14)
    return img


def write_png(path: Path, rgba: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(path)


def make_repo(tmp_path: Path, entries: list[dict[str, Any]]) -> Path:
    repo = tmp_path / "repo"
    (repo / "assets-src" / "palette").mkdir(parents=True)
    shutil.copy(PALETTE_PATH, repo / "assets-src" / "palette" / "kerbside32.json")
    (repo / "assets-src" / "manifest.json").write_text(json.dumps({"assets": entries}, indent=2), encoding="utf-8")
    return repo


def add_toy_renders(repo: Path, asset_id: str = "veh.toy", cell: int = 8, headings: int = 4) -> Path:
    src = repo / "assets-src" / "rendered" / asset_id
    for h in range(headings):
        write_png(src / f"h{h:02d}.png", toy_render(cell, h))
        write_png(src / f"dented_h{h:02d}.png", toy_render(cell, h, dent=True))
    pivots = {f"h{h:02d}": [cell // 2, cell // 2] for h in range(headings)}
    (src / "render.json").write_text(json.dumps({"pivots_px": pivots}), encoding="utf-8")
    return src


GRID = """\
id: npc.toy
cell: 6x5
palette: kerbside32
# A tiny walker: SW authored, SE mirrored.

frame walk:sw:0
......
..ff..
.fcf..
..ff..
......

frame walk:sw:1
......
..ff..
..fcf.
..ff..
......

mirror se from sw
"""


def grid_entry(**over: Any) -> dict[str, Any]:
    e: dict[str, Any] = {
        "id": "npc.toy",
        "class": "npc",
        "technique": "grid",
        "source": "assets-src/sprites/npc/toy.sprite.txt",
        "cell": [6, 5],
        "states": ["walk"],
        "dirs": ["sw", "se"],
        "frames": {"walk": 2},
        "atlas": "actors",
        "outline": True,
        "swaps": [],
    }
    e.update(over)
    return e


def add_grid(repo: Path, text: str = GRID, name: str = "toy") -> Path:
    p = repo / "assets-src" / "sprites" / "npc" / f"{name}.sprite.txt"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


# ---------------------------------------------------------------------------------------------
# Render naming and block mode


@pytest.mark.parametrize(
    ("name", "parsed"),
    [
        ("h07.png", ("body", "h07", 0)),
        ("h31.png", ("body", "h31", 0)),
        ("dented_h07.png", ("dented", "h07", 0)),
        ("brush_h07_2.png", ("brush", "h07", 2)),
        ("slice_0.png", ("slice", "-", 0)),
        ("slice_12.png", ("slice", "-", 12)),
        ("big_wave_h03_1.png", ("big_wave", "h03", 1)),
        ("h32.png", None),
        ("render.png", None),
        ("dented_h7.png", None),
        ("brush_h07_02.png", None),
    ],
)
def test_parse_render_name(name: str, parsed: tuple[str, str, int] | None) -> None:
    assert parse_render_name(name) == parsed


def test_block_mode_factor_matches_the_reference_loop() -> None:
    rng = np.random.Generator(np.random.PCG64(2026))
    for trial in range(40):
        f = int(rng.integers(1, 5))
        h, w = f * int(rng.integers(1, 7)), f * int(rng.integers(1, 7))
        keys = rng.integers(0, 4 if trial % 2 else 40, size=(h, w))
        opaque = rng.random((h, w)) < rng.random()
        ref_k, ref_o = block_mode_keys(keys, opaque, w // f, h // f)
        got_k, got_o = block_mode_keys_factor(keys, opaque, f)
        np.testing.assert_array_equal(got_o, ref_o)
        np.testing.assert_array_equal(got_k, ref_k)


def test_block_mode_factor_rejects_non_divisible_sizes() -> None:
    with pytest.raises(ValueError, match="divisible"):
        block_mode_keys_factor(np.zeros((6, 8), dtype=np.int64), np.ones((6, 8), dtype=bool), 4)


def _render_from_blocks(blocks: list[list[list[list[int]]]]) -> np.ndarray:
    """Assemble a render from a grid of 4x4 blocks, each given as 16 RGBA pixels (row-major)."""
    rows = []
    for brow in blocks:
        rows.append(np.concatenate([np.array(b, dtype=np.uint8).reshape(4, 4, 4) for b in brow], axis=1))
    return np.concatenate(rows, axis=0)


def test_reduce_render_majority_ties_alpha_and_snap() -> None:
    yellow, chalk, lemon = rgba_of(15), rgba_of(7), rgba_of(16)
    off = [250, 200, 40, 255]  # not a Kerbside-32 colour; nearest is a yellow
    blocks = [
        [
            [yellow] * 10 + [chalk] * 6,  # majority -> 15
            [yellow] * 8 + [chalk] * 8,  # tie -> lower index 7
            [lemon] * 8 + [CLEAR] * 8,  # exactly half opaque -> opaque
        ],
        [
            [lemon] * 7 + [CLEAR] * 9,  # under half -> transparent
            [off] * 9 + [yellow] * 7,  # off-palette majority -> snapped, counted
            [[*yellow[:3], 127]] * 16,  # alpha 127 is transparent (threshold 128)
        ],
    ]
    render = _render_from_blocks(blocks)
    idx, snap_changed, off_src = reduce_render(render, (3, 2), PALETTE)
    expect_snap = int(np.argmin(((PALETTE.oklab - _oklab(off[:3])) ** 2).sum(axis=1)))
    assert idx.tolist() == [[15, 7, 16], [TRANSPARENT, expect_snap, TRANSPARENT]]
    assert snap_changed == 1
    assert off_src == 9


def _oklab(rgb: list[int]) -> np.ndarray:
    from forge.palette import srgb_to_oklab

    return srgb_to_oklab(np.array(rgb, dtype=np.uint8))


def test_reduce_render_4x4_blocks_of_a_synthetic_render() -> None:
    """A clean 4x render (every block one colour) reduces to exactly the drawn 1 px image."""
    rng = np.random.Generator(np.random.PCG64(5))
    small = rng.integers(-1, 32, size=(16, 12)).astype(np.int16)
    render = np.zeros((64, 48, 4), dtype=np.uint8)
    for y in range(16):
        for x in range(12):
            if small[y, x] >= 0:
                render[y * 4 : y * 4 + 4, x * 4 : x * 4 + 4] = rgba_of(int(small[y, x]))
    idx, snap, off = reduce_render(render, (12, 16), PALETTE)
    np.testing.assert_array_equal(idx, small)
    assert (snap, off) == (0, 0)


def test_reduce_render_checks_the_4x_size() -> None:
    with pytest.raises(BuildError, match="expected 32x32"):
        reduce_render(np.zeros((30, 32, 4), dtype=np.uint8), (8, 8), PALETTE)


# ---------------------------------------------------------------------------------------------
# Blender technique end to end


def test_blender_build_writes_outlined_indexed_frames(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [blender_entry()])
    add_toy_renders(repo)
    out = tmp_path / "out"
    result = build(repo_root=repo, out_root=out, use_cache=False)
    assert [a.entry.id for a in result.assets] == ["veh.toy"]
    fids = [f.frame_id for f in result.frames]
    assert fids == sorted(f"veh.toy:{s}:h{h:02d}:0" for s in ("body", "dented") for h in range(4))
    asset_dir = out / "frames" / "veh.toy"
    files = sorted(p.name for p in asset_dir.iterdir())
    assert files == sorted([*(f"{fid}.png" for fid in fids), ASSET_JSON])
    for f in result.frames:
        assert f.indices.shape == (8, 8)
        assert f.pivot == (4, 4)
        assert not outline_gaps(f.indices).any()
        data = (asset_dir / f.filename).read_bytes()
        np.testing.assert_array_equal(decode_indexed_png(data, PALETTE), f.indices)
        assert set(png_chunk_types(data)) <= {b"IHDR", b"PLTE", b"tRNS", b"IDAT", b"IEND"}
    body = next(f for f in result.frames if f.frame_id == "veh.toy:body:h00:0").indices
    # 4x4 body square at (2..5) with the tar mark at its NW pixel, ink ring outside it.
    assert body[2:6, 2:6].tolist() == [[1, 15, 15, 15], [15, 15, 15, 15], [15, 15, 15, 15], [15, 15, 15, 15]]
    assert body[1, 2:6].tolist() == [0, 0, 0, 0] and body[1, 1] == TRANSPARENT
    meta = json.loads((asset_dir / ASSET_JSON).read_text(encoding="utf-8"))
    assert meta["snap_changed_px"] == 0 and meta["frame_count"] == 8
    assert meta["frames"][0] == {"id": fids[0], "file": f"{fids[0]}.png", "pivot": [4, 4], "snap_changed_px": 0}


def test_blender_build_without_outline_keeps_the_silhouette(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [blender_entry(outline=False)])
    add_toy_renders(repo)
    result = build(repo_root=repo, out_root=tmp_path / "o", use_cache=False)
    assert all(int((f.indices == 0).sum()) == 0 for f in result.frames)


def test_blender_build_rejects_a_frame_list_mismatch(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [blender_entry()])
    src = add_toy_renders(repo)
    (src / "dented_h03.png").unlink()
    write_png(src / "scuffed_h00.png", toy_render(8, 0))
    with pytest.raises(BuildError, match=r"missing 1: dented:h03:0; not in the manifest 1: scuffed:h00:0"):
        build(repo_root=repo, out_root=tmp_path / "o", use_cache=False)


@pytest.mark.parametrize(
    ("mutate", "match"),
    [
        (lambda src: write_png(src / "h00_0.png", toy_render(8, 0)), "both map to frame body:h00:0"),
        (lambda src: write_png(src / "notes.png", toy_render(8, 0)), "not a render frame name"),
        (lambda src: (src / "render.json").unlink(), "render.json"),
        (lambda src: (src / "render.json").write_text('{"pivots_px": {}}'), "no entry for 'h00'"),
        (lambda src: (src / "render.json").write_text('{"pivots_px": {"h00": [99, 0]}}'), "inside the cell"),
        (lambda src: write_png(src / "h01.png", np.zeros((32, 32, 4), dtype=np.uint8)), "frame is empty"),
        (lambda src: write_png(src / "h01.png", np.zeros((28, 28, 4), dtype=np.uint8)), "expected 32x32"),
    ],
)
def test_blender_build_errors(tmp_path: Path, mutate: Any, match: str) -> None:
    repo = make_repo(tmp_path, [blender_entry()])
    src = add_toy_renders(repo)
    mutate(src)
    with pytest.raises(BuildError, match=match):
        build(repo_root=repo, out_root=tmp_path / "o", use_cache=False)


def test_body_touching_the_cell_edge_fails_when_outline_is_true(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [blender_entry(dirs="-", states=["body"], frames={"body": 1})])
    src = repo / "assets-src" / "rendered" / "veh.toy"
    img = toy_render(8, 0)
    img[0:4, 12:16] = rgba_of(15)  # one body pixel on the top row
    write_png(src / "h00.png", img)
    (src / "render.json").write_text('{"pivots_px": {"-": [4, 4]}}')
    # A bare hNN.png maps to dir h00, which the "-" entry does not expect.
    with pytest.raises(BuildError, match="frame list"):
        build(repo_root=repo, out_root=tmp_path / "o", use_cache=False)
    repo2 = make_repo(tmp_path / "2", [blender_entry(dirs="h4")])
    src2 = add_toy_renders(repo2)
    write_png(src2 / "h02.png", img)
    with pytest.raises(BuildError, match="touch the cell edge"):
        build(repo_root=repo2, out_root=tmp_path / "o2", use_cache=False)


def test_slice_frames_use_the_undirected_dir(tmp_path: Path) -> None:
    entry = blender_entry("prop.toy_stack", states=["slice"], dirs="-", frames={"slice": 3}, atlas="items")
    repo = make_repo(tmp_path, [entry])
    src = repo / "assets-src" / "rendered" / "prop.toy_stack"
    for k in range(3):
        write_png(src / f"slice_{k}.png", toy_render(8, k))
    (src / "render.json").write_text('{"pivots_px": {"-": [4, 6]}}')
    result = build(repo_root=repo, out_root=tmp_path / "o", use_cache=False)
    assert [f.frame_id for f in result.frames] == [f"prop.toy_stack:slice:-:{k}" for k in range(3)]
    assert {f.pivot for f in result.frames} == {(4, 6)}
    assert {f.atlas for f in result.frames} == {"items"}


# ---------------------------------------------------------------------------------------------
# Grid technique end to end


def test_grid_build_renders_mirrors_and_outlines(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [grid_entry()])
    add_grid(repo)
    result = build(repo_root=repo, out_root=tmp_path / "o", use_cache=False)
    by_id = {f.frame_id: f for f in result.frames}
    assert sorted(by_id) == ["npc.toy:walk:se:0", "npc.toy:walk:se:1", "npc.toy:walk:sw:0", "npc.toy:walk:sw:1"]
    sw0 = by_id["npc.toy:walk:sw:0"].indices
    se0 = by_id["npc.toy:walk:se:0"].indices
    np.testing.assert_array_equal(se0, sw0[:, ::-1])
    assert sw0.tolist()[1] == [TRANSPARENT, 0, 15, 15, 0, TRANSPARENT]
    assert sw0.tolist()[0] == [TRANSPARENT, TRANSPARENT, 0, 0, TRANSPARENT, TRANSPARENT]
    assert all(not outline_gaps(f.indices).any() for f in result.frames)
    # npc grids pivot on the feet: x = w // 2, row h - 2 with the last row clear (SSP-018).
    assert {f.pivot for f in result.frames} == {(3, 3)}


@pytest.mark.parametrize(
    ("asset_class", "cell", "pivot"),
    [("npc", (24, 24), (12, 22)), ("npc", (16, 16), (8, 14)), ("litter", (16, 16), (8, 8)), ("prop", (32, 32), (16, 16))],
)
def test_grid_pivot_is_feet_for_creatures_and_centre_otherwise(
    asset_class: str, cell: tuple[int, int], pivot: tuple[int, int]
) -> None:
    entry = entry_from_data(
        grid_entry(id=f"{asset_class}.toy", source=f"assets-src/sprites/{asset_class}/toy.sprite.txt", cell=list(cell))
        | {"class": asset_class}
    )
    assert grid_pivot(entry) == pivot


def test_grid_with_full_ink_border_is_unchanged_by_the_outline(tmp_path: Path) -> None:
    text = "id: npc.toy\ncell: 4x4\npalette: kerbside32\n\nframe idle:-:0\n.00.\n0ff0\n0ff0\n.00.\n"
    entry = grid_entry(cell=[4, 4], states=["idle"], dirs="-", frames={"idle": 1})
    repo = make_repo(tmp_path, [entry])
    add_grid(repo, text)
    on = build(repo_root=repo, out_root=tmp_path / "a", use_cache=False).frames[0].indices
    repo_off = make_repo(tmp_path / "off", [{**entry, "outline": False}])
    add_grid(repo_off, text)
    off = build(repo_root=repo_off, out_root=tmp_path / "b", use_cache=False).frames[0].indices
    np.testing.assert_array_equal(on, off)
    assert (tmp_path / "a" / "frames" / "npc.toy" / "npc.toy:idle:-:0.png").read_bytes() == (
        tmp_path / "b" / "frames" / "npc.toy" / "npc.toy:idle:-:0.png"
    ).read_bytes()


def test_ai_ingest_is_built_exactly_like_grid(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [grid_entry(technique="ai-ingest")])
    add_grid(repo)
    a = build(repo_root=repo, out_root=tmp_path / "a", use_cache=False)
    repo2 = make_repo(tmp_path / "g", [grid_entry()])
    add_grid(repo2)
    b = build(repo_root=repo2, out_root=tmp_path / "b", use_cache=False)
    for fa, fb in zip(a.frames, b.frames, strict=True):
        np.testing.assert_array_equal(fa.indices, fb.indices)


@pytest.mark.parametrize(
    ("entry_over", "text", "match"),
    [
        ({}, GRID.replace("id: npc.toy", "id: npc.other"), "declares id 'npc.other'"),
        ({"cell": [6, 6]}, GRID, "cell 6x5 != manifest cell 6x6"),
        ({"frames": {"walk": 3}}, GRID, "missing 2: walk:se:2, walk:sw:2"),
        ({"dirs": ["sw"]}, GRID, "not in the manifest 2"),
        ({}, GRID.replace("..fcf.", "..fxf."), "not in the key"),
        ({"source": "assets-src/sprites/npc/toy.txt"}, GRID, "must be a .sprite.txt"),
        ({"source": "assets-src/sprites/npc/nope.sprite.txt"}, GRID, "does not exist"),
        ({"technique": "procedural"}, GRID, "not implemented yet"),
        ({}, GRID.replace("frame walk:sw:1\n......\n..ff..", "frame walk:sw:1\n..f...\n..ff.."), "touch the cell edge"),
    ],
)
def test_grid_build_errors(tmp_path: Path, entry_over: dict[str, Any], text: str, match: str) -> None:
    repo = make_repo(tmp_path, [grid_entry(**entry_over)])
    add_grid(repo, text)
    with pytest.raises(BuildError, match=match):
        build(repo_root=repo, out_root=tmp_path / "o", use_cache=False)


# ---------------------------------------------------------------------------------------------
# --only, stale outputs, cache


def test_only_builds_the_named_assets_and_rejects_unknown_ids(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [grid_entry(), blender_entry()])
    add_grid(repo)
    add_toy_renders(repo)
    out = tmp_path / "o"
    result = build(repo_root=repo, out_root=out, only=["veh.toy"], use_cache=False)
    assert [a.entry.id for a in result.assets] == ["veh.toy"]
    assert sorted(p.name for p in (out / "frames").iterdir()) == ["veh.toy"]
    with pytest.raises(BuildError, match="not in the manifest: veh.nope"):
        build(repo_root=repo, out_root=out, only=["veh.nope"], use_cache=False)


def test_full_build_assets_are_sorted_and_stale_outputs_removed(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [blender_entry(), grid_entry()])  # unsorted on purpose
    add_grid(repo)
    add_toy_renders(repo)
    out = tmp_path / "o"
    (out / "frames" / "veh.gone").mkdir(parents=True)
    (out / "frames" / "veh.toy").mkdir(parents=True)
    (out / "frames" / "veh.toy" / "veh.toy:old:h00:0.png").write_bytes(b"stale")
    result = build(repo_root=repo, out_root=out, use_cache=False)
    assert [a.entry.id for a in result.assets] == ["npc.toy", "veh.toy"]
    assert sorted(p.name for p in (out / "frames").iterdir()) == ["npc.toy", "veh.toy"]
    assert not (out / "frames" / "veh.toy" / "veh.toy:old:h00:0.png").exists()


def _tree(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def test_cache_hit_gives_identical_output_and_frames(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [blender_entry(), grid_entry()])
    add_grid(repo)
    add_toy_renders(repo)
    cache = tmp_path / "cache"
    first = build(repo_root=repo, out_root=tmp_path / "a", cache_dir=cache)
    assert [a.cache for a in first.assets] == ["miss", "miss"]
    second = build(repo_root=repo, out_root=tmp_path / "b", cache_dir=cache)
    assert [a.cache for a in second.assets] == ["hit", "hit"]
    assert _tree(tmp_path / "a") == _tree(tmp_path / "b")
    for f1, f2 in zip(first.frames, second.frames, strict=True):
        assert (f1.frame_id, f1.pivot, f1.atlas, f1.snap_changed_px) == (f2.frame_id, f2.pivot, f2.atlas, f2.snap_changed_px)
        np.testing.assert_array_equal(f1.indices, f2.indices)
    nocache = build(repo_root=repo, out_root=tmp_path / "c", cache_dir=cache, use_cache=False)
    assert [a.cache for a in nocache.assets] == ["off", "off"]
    assert _tree(tmp_path / "a") == _tree(tmp_path / "c")
    # Default out is the cache dir itself.
    build(repo_root=repo, cache_dir=cache)
    assert _tree(cache / "frames") == _tree(tmp_path / "a" / "frames")


def test_no_cache_neither_reads_nor_writes_the_cache(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [grid_entry()])
    add_grid(repo)
    cache = tmp_path / "cache"
    build(repo_root=repo, out_root=tmp_path / "a", cache_dir=cache, use_cache=False)
    assert not (cache / "entries").exists()


def test_cache_key_tracks_source_manifest_and_palette(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [grid_entry()])
    grid_path = add_grid(repo)
    entry = entry_from_data(grid_entry())
    pal = repo / "assets-src" / "palette" / "kerbside32.json"
    k0 = asset_cache_key(entry, repo, pal)
    assert asset_cache_key(entry, repo, pal) == k0
    grid_path.write_text(GRID.replace("..fcf.", "..fff."), encoding="utf-8")
    k1 = asset_cache_key(entry, repo, pal)
    assert k1 != k0
    assert asset_cache_key(entry_from_data(grid_entry(outline=False)), repo, pal) != k1
    pal.write_bytes(pal.read_bytes() + b"\n")
    assert asset_cache_key(entry, repo, pal) != k1


def test_cache_detects_a_changed_source_and_rebuilds(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [grid_entry()])
    grid_path = add_grid(repo)
    cache = tmp_path / "cache"
    build(repo_root=repo, out_root=tmp_path / "a", cache_dir=cache)
    grid_path.write_text(GRID.replace("..fcf.", "..fff."), encoding="utf-8")
    result = build(repo_root=repo, out_root=tmp_path / "a", cache_dir=cache)
    assert result.assets[0].cache == "miss"
    assert result.frames[2].indices[2, 3] == 15
    # Only the newest entry per asset is kept.
    assert len(list((cache / "entries" / "npc.toy").iterdir())) == 1


def test_corrupt_cache_entry_is_rebuilt(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [grid_entry()])
    add_grid(repo)
    cache = tmp_path / "cache"
    build(repo_root=repo, out_root=tmp_path / "a", cache_dir=cache)
    (entry_dir,) = (cache / "entries" / "npc.toy").iterdir()
    next(entry_dir.glob("*.png")).write_bytes(b"not a png")
    result = build(repo_root=repo, out_root=tmp_path / "b", cache_dir=cache)
    assert result.assets[0].cache == "miss"
    assert _tree(tmp_path / "a") == _tree(tmp_path / "b")


def test_bad_manifest_is_a_build_error(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [grid_entry(atlas="nowhere")])
    with pytest.raises(BuildError, match="manifest: .*atlas must be"):
        build(repo_root=repo, out_root=tmp_path / "o", use_cache=False)


# ---------------------------------------------------------------------------------------------
# CLI


def _forge(*args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, "-m", "forge", *args], capture_output=True, text=True, check=False, cwd=cwd)


def test_cli_build_only_out_no_cache(tmp_path: Path) -> None:
    out = tmp_path / "out"
    proc = _forge("build", "--only", "veh.sweeper", "--no-cache", "--out", str(out), cwd=FORGE_ROOT)
    assert proc.returncode == 0, proc.stderr
    assert "forge build: veh.sweeper: 64 frames (blender, cache off); palette snap changed 0 px" in proc.stdout
    assert len(list((out / "frames" / "veh.sweeper").glob("*.png"))) == 64


def test_cli_build_error_exits_1(tmp_path: Path) -> None:
    proc = _forge("build", "--only", "veh.nope", "--no-cache", "--out", str(tmp_path), cwd=FORGE_ROOT)
    assert proc.returncode == 1
    assert "forge build: error: --only: not in the manifest: veh.nope" in proc.stderr
