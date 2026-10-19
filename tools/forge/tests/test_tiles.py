"""Tests for the procedural ground tiles and the 47-tile kerb blob (SSP-040, ART_BIBLE §9.1)."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from forge.build import BuildError, asset_cache_key, build, build_asset
from forge.manifest import AssetEntry, load_manifest
from forge.palette import PALETTE_PATH, REPO_ROOT, TRANSPARENT, load_palette
from forge.procedural import ProceduralError, run_procedural, wrap_tile
from forge.procedural import tiles
from forge.procedural.tiles import BLOB_COUNT, reduce_mask

from test_procedural import seam_ok as independent_seam_ok

PALETTE = load_palette()
MANIFEST = load_manifest()
KERB_BLOB = REPO_ROOT / "assets-src" / "procedural" / "tiles" / "kerb_blob.json"

# The tile asset IDs chosen in SSP-040: final from now on (CLAUDE.md §5.4). Value: state, frames.
TILE_IDS: dict[str, tuple[str, int]] = {
    "haz.speed_bump": ("v", 2),
    "tile.apron": ("v", 4),
    "tile.asphalt": ("v", 6),
    "tile.double_yellow": ("v", 4),
    "tile.grass": ("v", 4),
    "tile.kerb": ("blob", 47),
    "tile.lane_marking": ("v", 4),
    "tile.parking_bay": ("v", 4),
    "tile.pavement": ("v", 4),
    "tile.setts": ("v", 4),
    "tile.zebra": ("v", 2),
}
VARIANT_TILES = tuple(i for i, (state, _) in TILE_IDS.items() if state == "v")
OVERLAYS = ("tile.double_yellow", "tile.lane_marking", "tile.parking_bay")
WRAP_TILES = tuple(e.id for e in MANIFEST if e.technique == "procedural" and wrap_tile(REPO_ROOT / e.source))

# Hand-written from ART_BIBLE §9.1 (and §8.7 for the speed bump): every index each tile may use.
# Surfaces stay within one ramp step of their base (the calmness rule).
ALLOWED = {
    "tile.asphalt": {2, 1, 3},
    "tile.pavement": {5, 4, 6},
    "tile.grass": {22, 21, 23},
    "tile.setts": {3, 2, 4},
    "tile.apron": {4, 3, 5},
    "tile.zebra": {2, 1, 3, 7, 6},
    "haz.speed_bump": {2, 1, 3, 4, 7},
    "tile.lane_marking": {TRANSPARENT, 7, 6},
    "tile.double_yellow": {TRANSPARENT, 15, 14},
    "tile.parking_bay": {TRANSPARENT, 7, 6},
    "tile.kerb": {1, 4, 5, 6, 7},
}


def entry_of(asset_id: str) -> AssetEntry:
    return next(e for e in MANIFEST if e.id == asset_id)


def built(asset_id: str) -> dict[str, np.ndarray]:
    ab = build_asset(entry_of(asset_id), REPO_ROOT, PALETTE)
    return {f.frame_id.split(":", 1)[1]: f.indices for f in ab.frames}


def blob_params() -> dict[str, Any]:
    return json.loads(KERB_BLOB.read_text(encoding="utf-8"))["params"]


# ---------------------------------------------------------------------------------------------
# Manifest, determinism, palette


def test_tile_ids_are_in_the_sorted_manifest_under_the_world_atlas() -> None:
    ids = [e.id for e in MANIFEST]
    assert ids == sorted(ids)
    for asset_id, (state, n) in TILE_IDS.items():
        e = entry_of(asset_id)
        assert (e.technique, e.atlas, e.outline, e.cell, e.dirs) == ("procedural", "world", False, (32, 32), ("-",))
        assert (e.states, e.frames) == ((state,), {state: n}), asset_id
        assert e.source.startswith("assets-src/procedural/tiles/")
    # SSP-052 adds the grime overlays (tile.grime_*), tested in test_stains.py.
    grime = {"tile.grime_asphalt", "tile.grime_gutter", "tile.grime_slab"}
    assert {e.id for e in MANIFEST if e.asset_class == "tile"} == {i for i in TILE_IDS if i.startswith("tile.")} | grime


def test_asphalt_follows_the_documented_manifest_example() -> None:
    """ASSET_PIPELINE §6.1/§6.4: tile.asphalt, seed 1031, 6 variants (ART_BIBLE §9.1 says 4; SSP-111 settles it)."""
    doc = json.loads((REPO_ROOT / entry_of("tile.asphalt").source).read_text(encoding="utf-8"))
    assert (doc["generator"], doc["seed"], doc["variants"], doc["params"]["wrap"]) == ("tiles.asphalt", 1031, 6, True)


def test_forge_build_writes_the_same_tile_bytes_twice(tmp_path: Path) -> None:
    trees = []
    for run in ("a", "b"):
        out = tmp_path / run
        build(repo_root=REPO_ROOT, out_root=out, only=list(TILE_IDS), use_cache=False, publish=False)
        trees.append({p.relative_to(out).as_posix(): p.read_bytes() for p in sorted((out / "frames").rglob("*")) if p.is_file()})
    assert trees[0] == trees[1]
    assert len([k for k in trees[0] if k.endswith(".png")]) == sum(n for _, n in TILE_IDS.values())


@pytest.mark.parametrize("asset_id", list(TILE_IDS))
def test_tiles_use_only_their_art_bible_indices(asset_id: str) -> None:
    frames = built(asset_id)
    state, n = TILE_IDS[asset_id]
    assert sorted(frames) == sorted(f"{state}:-:{k}" for k in range(n))
    for local, arr in frames.items():
        assert arr.shape == (32, 32)
        used = set(np.unique(arr).tolist())
        assert used <= ALLOWED[asset_id], (local, used - ALLOWED[asset_id])
        assert (arr != TRANSPARENT).any(), "never an empty frame"
        if asset_id not in OVERLAYS:
            assert (arr != TRANSPARENT).all(), f"{asset_id} is an opaque ground tile"


# ---------------------------------------------------------------------------------------------
# Seams


def test_the_wrap_tiles_are_the_documented_ones() -> None:
    assert set(WRAP_TILES) >= {"tile.asphalt", "tile.pavement", "tile.grass", "tile.setts", "tile.apron", "tile.zebra", "haz.speed_bump"}
    assert not set(WRAP_TILES) & {*OVERLAYS, "tile.kerb"}


@pytest.mark.parametrize("asset_id", WRAP_TILES)
def test_every_wrap_tile_passes_the_seam_rule(asset_id: str) -> None:
    for local, arr in built(asset_id).items():
        assert independent_seam_ok(arr), f"{asset_id}:{local}"
        assert tiles.seam_ok(arr)


def test_seam_ok_flags_a_join_that_is_harsher_than_the_interior() -> None:
    gradient = np.tile(np.repeat(np.arange(4, dtype=np.int16), 8), (32, 1))  # 4 bands: 3 interior steps
    assert tiles.seam_ok(np.zeros((32, 32), dtype=np.int16))
    assert tiles.seam_ok(gradient), "the wrap step (3 -> 0) changes as many pixels as an interior step"
    harsh = np.zeros((32, 32), dtype=np.int16)
    harsh[:, 31] = 1
    harsh[::2, 30] = 1  # interior differences reach 0.5, the wrap edge (31 -> 0) is 1.0
    assert not tiles.seam_ok(harsh)
    assert not independent_seam_ok(harsh)


def test_a_wrap_draw_that_never_seams_is_an_error() -> None:
    harsh = np.zeros((32, 32), dtype=np.uint8)
    harsh[:, 31] = 1
    harsh[::2, 30] = 1
    with pytest.raises(ProceduralError, match="no seamless draw"):
        tiles._seamless({"wrap": True}, lambda: harsh.copy())
    assert tiles._seamless({"wrap": False}, lambda: harsh.copy()) is not None


# ---------------------------------------------------------------------------------------------
# Variant generators: determinism and append stability


def variant_doc(asset_id: str) -> dict[str, Any]:
    return json.loads((REPO_ROOT / entry_of(asset_id).source).read_text(encoding="utf-8"))


def run_doc(tmp_path: Path, doc: dict[str, Any]) -> dict[str, np.ndarray]:
    src = tmp_path / f"{doc['id']}.json"
    src.write_text(json.dumps(doc), encoding="utf-8")
    return run_procedural(doc["id"], src, (32, 32), tmp_path, PALETTE).frames


@pytest.mark.parametrize("asset_id", VARIANT_TILES)
def test_appending_variants_keeps_the_earlier_ones(tmp_path: Path, asset_id: str) -> None:
    doc = variant_doc(asset_id)
    repo_frames = built(asset_id)
    n = doc["variants"]
    if "layouts" in doc["params"]:
        doc["params"]["layouts"] = doc["params"]["layouts"] + doc["params"]["layouts"]
    doc["variants"] = n + 2
    more = run_doc(tmp_path, doc)
    assert len(more) == n + 2
    for k in range(n):
        np.testing.assert_array_equal(more[f"v:-:{k}"], repo_frames[f"v:-:{k}"])


@pytest.mark.parametrize("asset_id", ["tile.asphalt", "tile.pavement", "tile.grass", "tile.setts", "tile.apron"])
def test_variants_differ_and_follow_the_seed(tmp_path: Path, asset_id: str) -> None:
    frames = built(asset_id)
    assert not np.array_equal(frames["v:-:0"], frames["v:-:1"])
    doc = variant_doc(asset_id)
    doc["seed"] += 1
    assert not np.array_equal(run_doc(tmp_path, doc)["v:-:0"], frames["v:-:0"])


# ---------------------------------------------------------------------------------------------
# Surface looks


def components(mask: np.ndarray) -> list[list[tuple[int, int]]]:
    """8-connected components of ``mask`` on the torus (the tile wraps)."""
    h, w = mask.shape
    seen = np.zeros_like(mask)
    out = []
    for y, x in zip(*np.nonzero(mask), strict=True):
        if seen[y, x]:
            continue
        stack, comp = [(int(y), int(x))], []
        seen[y, x] = True
        while stack:
            cy, cx = stack.pop()
            comp.append((cy, cx))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = (cy + dy) % h, (cx + dx) % w
                    if mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
        out.append(comp)
    return out


def test_asphalt_speckle_is_sparse_and_never_clumps_beyond_2x1() -> None:
    for local, arr in built("tile.asphalt").items():
        speckle = arr != 2
        assert 0.02 <= speckle.mean() <= 0.08, local
        assert set(np.unique(arr[speckle]).tolist()) == {1, 3}
        for comp in components(speckle):
            ys = {y for y, _ in comp}
            assert len(comp) <= 2 and len(ys) == 1, (local, comp)
            assert len({int(arr[p]) for p in comp}) == 1, "a clump is one colour"


def test_pavement_slabs_sit_between_04_joints_on_a_10_11_11_rhythm() -> None:
    joints = [0, 11, 22]
    for local, arr in built("tile.pavement").items():
        assert (arr[joints, :] == 4).all() and (arr[:, joints] == 4).all(), local
        slab = np.ones((32, 32), dtype=bool)
        slab[joints, :] = False
        slab[:, joints] = False
        assert set(np.unique(arr[slab]).tolist()) <= {4, 5, 6}
        assert (arr[slab] == 5).mean() > 0.4


def test_grass_tufts_cast_their_shade_to_the_south_east() -> None:
    for arr in built("tile.grass").values():
        assert (arr == 22).mean() > 0.7
        assert (arr == 23).any() and (arr == 21).any()


def test_setts_are_running_bond_blocks_with_02_gaps() -> None:
    for arr in built("tile.setts").values():
        assert (arr[3::4, :] == 2).all(), "a gap row under every course"
        assert (arr[0:3, 7::8] == 2).all() and (arr[4:7, 3::8] == 2).all(), "courses offset by half a block"


def test_apron_has_one_expansion_joint_per_tile() -> None:
    for arr in built("tile.apron").values():
        assert (arr[31, :] == 3).all() and (arr[:, 31] == 3).all()
        assert (arr[:31, :31] == 4).mean() > 0.9


def test_zebra_bars_are_8_px_wide_and_8_px_apart() -> None:
    frames = built("tile.zebra")
    for local, arr in frames.items():
        across = arr if local == "v:-:0" else arr.T  # v0: vertical bars (a zebra across a N-S road)
        bars = np.zeros(32, dtype=bool)
        bars[0:8] = bars[16:24] = True
        assert set(np.unique(across[:, bars]).tolist()) <= {6, 7} and (across[:, bars] == 7).mean() > 0.85
        assert set(np.unique(across[:, ~bars]).tolist()) <= {1, 2, 3}


def test_speed_bump_band_is_lit_north_west_and_shaded_south_east() -> None:
    frames = built("haz.speed_bump")
    for local, arr in frames.items():
        band = arr if local == "v:-:0" else arr.T  # v0: the band runs along x (across a N-S road)
        assert (band[10, :] == 4).all() and (band[21, :] == 1).all(), local
        assert set(np.unique(band[11:21, :]).tolist()) == {3, 7}
        assert set(np.unique(np.concatenate([band[:10], band[22:]])).tolist()) <= {1, 2, 3}
    np.testing.assert_array_equal(frames["v:-:0"][10:22, :], frames["v:-:1"][:, 10:22].T)


def test_markings_are_overlays_with_lines_where_the_markings_bits_say() -> None:
    def painted(asset_id: str, k: int) -> np.ndarray:
        return built(asset_id)[f"v:-:{k}"] != TRANSPARENT

    # Lane marking: CENTRE_NS, CENTRE_EW, CENTRE_E_EDGE, CENTRE_S_EDGE (TECHNICAL_DESIGN §15.2 MARKING).
    for k, (along, first) in enumerate([("y", 15), ("x", 15), ("y", 30), ("x", 30)]):
        expect = np.zeros((32, 32), dtype=bool)
        if along == "y":
            expect[:, first : first + 2] = True
        else:
            expect[first : first + 2, :] = True
        np.testing.assert_array_equal(painted("tile.lane_marking", k), expect)
    # Double yellows on the kerb side N, E, S, W: two 1 px lines, 2 px apart, 2 px from the kerb.
    for k, lines in enumerate([("r", 2, 5), ("c", 29, 26), ("r", 29, 26), ("c", 2, 5)]):
        expect = np.zeros((32, 32), dtype=bool)
        for i in lines[1:]:
            if lines[0] == "r":
                expect[i, :] = True
            else:
                expect[:, i] = True
        np.testing.assert_array_equal(painted("tile.double_yellow", k), expect)
    # Parking bay with the kerb N, E, S, W: a dashed (6 on, 2 off) line along the road-side edge.
    dash = (np.arange(32) % 8) < 6
    for k, (axis, i) in enumerate([("r", 30), ("c", 1), ("r", 1), ("c", 30)]):
        expect = np.zeros((32, 32), dtype=bool)
        if axis == "r":
            expect[i, :] = dash
        else:
            expect[:, i] = dash
        np.testing.assert_array_equal(painted("tile.parking_bay", k), expect)


# ---------------------------------------------------------------------------------------------
# Kerb blob


def test_the_shared_mask_table_is_the_complete_reduced_blob() -> None:
    p = blob_params()
    bits, table = tiles.blob_table(p)
    assert bits == {"n": 1, "ne": 2, "e": 4, "se": 8, "s": 16, "sw": 32, "w": 64, "nw": 128}
    assert table == p["blob_masks"] and table == sorted(table) and len(table) == BLOB_COUNT == 47
    assert sorted({reduce_mask(raw, bits) for raw in range(256)}) == table


def test_kerb_blob_has_exactly_47_frames_matching_the_table() -> None:
    frames = built("tile.kerb")
    assert sorted(frames) == sorted(f"blob:-:{n}" for n in range(47))
    distinct = {frames[f"blob:-:{n}"].tobytes() for n in range(47)}
    assert len(distinct) == 47, "every mask draws a different tile"


def interior() -> np.ndarray:
    return built("tile.pavement")["v:-:0"]


# Per edge: (pixel at depth k along the middle of that edge, the lip colours road side / pavement side).
# A kerb facing north or west catches the sun (07), one facing south or east is in shade (04).
EDGES = {
    "n": (lambda k: (k, 16), (7, 4)),
    "s": (lambda k: (31 - k, 16), (4, 7)),
    "w": (lambda k: (16, k), (7, 4)),
    "e": (lambda k: (16, 31 - k), (4, 7)),
}
CORNERS = {"ne": ("n", "e", 0, 31), "se": ("s", "e", 31, 31), "sw": ("s", "w", 31, 0), "nw": ("n", "w", 0, 0)}


def test_kerb_lip_pixels_match_every_mask() -> None:
    p = blob_params()
    bits = p["mask_bits"]
    inside = interior()
    frames = built("tile.kerb")
    for n, mask in enumerate(p["blob_masks"]):
        arr = frames[f"blob:-:{n}"]
        for edge, (at, (road_lip, back_lip)) in EDGES.items():
            got = [int(arr[at(k)]) for k in range(5)]
            if mask & bits[edge]:
                assert got == [int(inside[at(k)]) for k in range(5)], (n, mask, edge, "no kerb on a non-road edge")
            else:
                assert got[:4] == [1, road_lip, 6, back_lip], (n, mask, edge, got)
                assert got[4] == int(inside[at(4)])
        for corner, (a, b, cy, cx) in CORNERS.items():
            sy = slice(0, 4) if cy == 0 else slice(28, 32)
            sx = slice(0, 4) if cx == 0 else slice(28, 32)
            if not (mask & bits[a] and mask & bits[b]):
                assert arr[cy, cx] == 1, (n, mask, corner, "an outer corner keeps its gutter")
                continue
            if mask & bits[corner]:
                np.testing.assert_array_equal(arr[sy, sx], inside[sy, sx], err_msg=f"{n} {corner} solid corner")
                continue
            # Inner corner: a nub where the two neighbours' kerbs meet; its outer row and column
            # continue those kerbs (road toward the corner's side).
            assert arr[cy, cx] == 1, (n, corner)
            step_x = 1 if cx == 0 else -1
            step_y = 1 if cy == 0 else -1
            along_row = [int(arr[cy, cx + step_x * k]) for k in range(4)]
            along_col = [int(arr[cy + step_y * k, cx]) for k in range(4)]
            assert along_row == ([1, 7, 6, 4] if cx == 0 else [1, 4, 6, 7]), (n, corner, along_row)
            assert along_col == ([1, 7, 6, 4] if cy == 0 else [1, 4, 6, 7]), (n, corner, along_col)
            assert set(np.unique(arr[sy, sx]).tolist()) <= {1, 4, 6, 7}
    np.testing.assert_array_equal(frames["blob:-:46"], inside, err_msg="mask 255: no road neighbour, plain pavement")


def test_kerb_tiles_join_seamlessly_in_any_layout() -> None:
    """Compose a street with every configuration and check each shared edge against the global rule.

    Adjacent kerb tiles must agree along their joint: the two pixel lines facing each other
    across a tile edge are each the continuation the other predicts, which holds when every
    pixel equals the tile its own mask draws and the masks come from one consistent map.
    """
    p = blob_params()
    bits, table = p["mask_bits"], p["blob_masks"]
    frames = built("tile.kerb")
    inside = interior()
    rng = np.random.default_rng(1)
    road = rng.random((14, 14)) < 0.45
    off = {"n": (0, -1), "ne": (1, -1), "e": (1, 0), "se": (1, 1), "s": (0, 1), "sw": (-1, 1), "w": (-1, 0), "nw": (-1, -1)}

    def is_road(x: int, y: int) -> bool:
        return 0 <= x < 14 and 0 <= y < 14 and bool(road[y, x])

    world = np.zeros((14 * 32, 14 * 32), dtype=np.int16)
    for y in range(14):
        for x in range(14):
            if is_road(x, y):
                world[y * 32 : y * 32 + 32, x * 32 : x * 32 + 32] = 2
                continue
            raw = sum(bits[d] for d, (dx, dy) in off.items() if not is_road(x + dx, y + dy))
            world[y * 32 : y * 32 + 32, x * 32 : x * 32 + 32] = frames[f"blob:-:{table.index(reduce_mask(raw, bits))}"]
    # Global reference: d = Chebyshev distance to the nearest road pixel - 1, over the whole map.
    road_px = np.kron(road, np.ones((32, 32), dtype=bool))
    big = 10**6
    d = np.where(road_px, -1, big)
    for _ in range(5):  # distances up to the kerb width are all that matter
        grown = d.copy()
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                grown = np.minimum(grown, np.roll(np.roll(d, dy, 0), dx, 1) + 1)
        d = np.where(road_px, -1, grown)
    raised = ~road_px
    # Every raised pixel within the kerb band carries a kerb colour; everything further is interior.
    band = raised & (d >= 0) & (d <= 3)
    interior_px = raised & (d > 3)
    edge_ok = np.ones_like(raised)
    edge_ok[:4, :] = edge_ok[-4:, :] = edge_ok[:, :4] = edge_ok[:, -4:] = False  # map border: out of map is not road
    np.testing.assert_array_equal(world[band & edge_ok & (d == 0)], 1)
    assert set(np.unique(world[band & edge_ok]).tolist()) <= {1, 4, 6, 7}
    tiled_inside = np.tile(inside, (14, 14))
    np.testing.assert_array_equal(world[interior_px & edge_ok], tiled_inside[interior_px & edge_ok])


def test_editing_the_interior_tile_rebuilds_the_kerbs(tmp_path: Path) -> None:
    repo = tmp_path / "repo"
    (repo / "assets-src" / "palette").mkdir(parents=True)
    shutil.copy(PALETTE_PATH, repo / "assets-src" / "palette" / "kerbside32.json")
    tiles_dir = repo / "assets-src" / "procedural" / "tiles"
    tiles_dir.mkdir(parents=True)
    shutil.copy(KERB_BLOB, tiles_dir / "kerb_blob.json")
    shutil.copy(REPO_ROOT / entry_of("tile.pavement").source, tiles_dir / "pavement.json")
    entry = entry_of("tile.kerb")
    key = asset_cache_key(entry, repo, repo / "assets-src" / "palette" / "kerbside32.json")
    doc = json.loads((tiles_dir / "pavement.json").read_text(encoding="utf-8"))
    doc["seed"] += 1
    (tiles_dir / "pavement.json").write_text(json.dumps(doc), encoding="utf-8")
    assert asset_cache_key(entry, repo, repo / "assets-src" / "palette" / "kerbside32.json") != key
    out = run_procedural("tile.kerb", tiles_dir / "kerb_blob.json", (32, 32), repo, PALETTE)
    assert tiles_dir / "pavement.json" in out.deps


# ---------------------------------------------------------------------------------------------
# Params errors


def write_tile(tmp_path: Path, doc: dict[str, Any], entry_over: dict[str, Any] | None = None) -> Path:
    repo = tmp_path / "repo"
    (repo / "assets-src" / "palette").mkdir(parents=True, exist_ok=True)
    shutil.copy(PALETTE_PATH, repo / "assets-src" / "palette" / "kerbside32.json")
    name = doc["id"].split(".")[1]
    state = "blob" if doc["generator"] == "tiles.kerb_blob" else "v"
    n = 47 if state == "blob" else doc.get("variants", 1)
    entry = {
        "id": doc["id"],
        "class": doc["id"].split(".")[0],
        "technique": "procedural",
        "source": f"assets-src/procedural/tiles/{name}.json",
        "cell": [32, 32],
        "states": [state],
        "dirs": "-",
        "frames": {state: n},
        "atlas": "world",
        "outline": False,
        "swaps": [],
    }
    entry.update(entry_over or {})
    (repo / "assets-src" / "manifest.json").write_text(json.dumps({"assets": [entry]}), encoding="utf-8")
    src = repo / entry["source"]
    src.parent.mkdir(parents=True, exist_ok=True)
    src.write_text(json.dumps(doc), encoding="utf-8")
    return repo


@pytest.mark.parametrize(
    ("asset_id", "edit", "match"),
    [
        ("tile.lane_marking", lambda d: d.update(variants=5), "variant 4 has no params.layouts entry"),
        ("tile.parking_bay", lambda d: d["params"]["layouts"][0][0].update(dash_px=[5, 2]), "a dash every 7 px"),
        ("tile.double_yellow", lambda d: d["params"]["layouts"][1][0].update(offset_px=32), "offset_px must place"),
        ("tile.zebra", lambda d: d["params"].update(bar_px=5), "a zebra bar every 10 px"),
        ("tile.zebra", lambda d: d["params"].update(layouts=["diagonal", "bars_along_x"]), "must be one of bars_along_y"),
        ("tile.setts", lambda d: d["params"].update(block_px=[7, 4]), "must be even"),
        ("tile.pavement", lambda d: d["params"].update(joints_px=[11, 0]), "joints_px must be ascending"),
        ("tile.asphalt", lambda d: d["params"]["speckle"].update(indices=[1, 40]), "palette index"),
        ("tile.asphalt", lambda d: d["params"].update(wrap="yes"), "params.wrap must be true or false"),
    ],
)
def test_variant_params_errors(tmp_path: Path, asset_id: str, edit: Any, match: str) -> None:
    doc = variant_doc(asset_id)
    edit(doc)
    repo = write_tile(tmp_path, doc)
    with pytest.raises(BuildError, match=match):
        build(repo_root=repo, out_root=tmp_path / "o", use_cache=False)


@pytest.mark.parametrize(
    ("edit", "match"),
    [
        (lambda p: p["blob_masks"].pop(), "has 46 entries"),
        (lambda p: p["blob_masks"].__setitem__(1, 2), "is not reduced"),
        (lambda p: p["mask_bits"].update(ne=1), "repeats bit 1"),
        (lambda p: p["style"].update(kerb_px=1), "kerb_px must be at least 2"),
        (lambda p: p["style"].update(interior="assets-src/procedural/tiles/nope.json"), "cannot read it"),
        (lambda p: p["style"].update(interior_variant=9), "has no variant 9"),
    ],
)
def test_kerb_params_errors(tmp_path: Path, edit: Any, match: str) -> None:
    doc = json.loads(KERB_BLOB.read_text(encoding="utf-8"))
    edit(doc["params"])
    repo = write_tile(tmp_path, doc)
    shutil.copy(REPO_ROOT / entry_of("tile.pavement").source, repo / "assets-src" / "procedural" / "tiles" / "pavement.json")
    with pytest.raises(BuildError, match=match):
        build(repo_root=repo, out_root=tmp_path / "o", use_cache=False)
