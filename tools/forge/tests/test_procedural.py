"""Tests for the procedural technique: facade sets (lit/dark ramp shift, assembly) and roof surfaces (SSP-041)."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from forge.build import BuildError, asset_cache_key, build, build_asset
from forge.manifest import AssetEntry, entry_from_data, load_manifest
from forge.palette import PALETTE_PATH, REPO_ROOT, TRANSPARENT, load_palette
from forge.procedural import GENERATORS, ProceduralError, run_procedural
from forge.procedural.facades import (
    GLASS,
    GLINT,
    INK,
    MODULE_CELL,
    derive_variants,
    glass_panes,
    glint_mask,
    ramp_shift_table,
)

PALETTE = load_palette()
MANIFEST = load_manifest()

PUDDLE_LANE_FACADES = (
    "facade.corner_shop",
    "facade.depot_shed",
    "facade.flats_render",
    "facade.parade_brick",
    "facade.terrace_brick",
    "facade.terrace_brick_bay",
)
ROOFS = ("roof.depot", "roof.felt", "roof.slate")

# Hand-written from ART_BIBLE §5.1 ramps and §5.2 OKLab L, independent of the implementation:
# one step toward the light (lit) or away from it (dark) along the index's ramp, clamped at the
# ends; ink 00 and glass 25/27 never shift; the accents 20/29 are not a light ramp. 08-12 follow
# brick/skin (the first ramp that lists them), 13 umber follows the skin tones (08 < 13 < 11 < 12).
EXPECTED_LIT = {
    0: 0, 1: 2, 2: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 7,
    8: 9, 9: 10, 10: 11, 11: 12, 12: 12, 13: 11,
    14: 15, 15: 16, 16: 16, 17: 17, 18: 17, 19: 18, 20: 20,
    21: 22, 22: 23, 23: 24, 24: 24, 25: 25, 26: 27, 27: 27, 28: 28, 29: 29, 30: 31, 31: 31,
}  # fmt: skip
EXPECTED_DARK = {
    0: 0, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6,
    8: 8, 9: 8, 10: 9, 11: 10, 12: 11, 13: 8,
    14: 14, 15: 14, 16: 15, 17: 18, 18: 19, 19: 19, 20: 20,
    21: 21, 22: 21, 23: 22, 24: 23, 25: 25, 26: 25, 27: 27, 28: 27, 29: 29, 30: 30, 31: 30,
}  # fmt: skip


def entry_of(asset_id: str) -> AssetEntry:
    return next(e for e in MANIFEST if e.id == asset_id)


def built(asset_id: str) -> dict[str, np.ndarray]:
    ab = build_asset(entry_of(asset_id), REPO_ROOT, PALETTE)
    return {f.frame_id.split(":", 1)[1]: f.indices for f in ab.frames}


# ---------------------------------------------------------------------------------------------
# Ramp shift


def test_shift_tables_match_the_hand_written_ramp_steps() -> None:
    assert ramp_shift_table(PALETTE, 1) == tuple(EXPECTED_LIT[i] for i in range(32))
    assert ramp_shift_table(PALETTE, -1) == tuple(EXPECTED_DARK[i] for i in range(32))


def test_every_shift_is_one_step_along_a_ramp_of_the_palette_file() -> None:
    """Cross-check the expected tables against kerbside32.json itself (ramps ordered by OKLab L)."""
    data = json.loads(PALETTE_PATH.read_text(encoding="utf-8"))
    light = {name: sorted(m, key=lambda i: PALETTE.oklab[i][0]) for name, m in data["ramps"].items() if name != "accents"}
    for table, step in ((EXPECTED_LIT, 1), (EXPECTED_DARK, -1)):
        for src, dst in table.items():
            if src == INK or src in GLASS or src in (20, 29):
                assert dst == src
                continue
            ramp = next(r for r in light.values() if src in r)
            pos = ramp.index(src)
            want = ramp[min(max(pos + step, 0), len(ramp) - 1)]
            assert dst == want, (src, step)


@pytest.mark.parametrize("asset_id", PUDDLE_LANE_FACADES)
def test_facade_set_lit_and_dark_are_exact_ramp_shifts_of_base(asset_id: str) -> None:
    frames = built(asset_id)
    assert sorted(frames) == ["base:-:0", "dark:-:0", "lit:-:0"]
    base, lit, dark = frames["base:-:0"], frames["lit:-:0"], frames["dark:-:0"]
    assert base.shape == lit.shape == dark.shape == (80, entry_of(asset_id).width)
    glass = np.isin(base, GLASS)
    ink = base == INK
    plain = ~glass & ~ink
    lit_t = np.array([EXPECTED_LIT[i] for i in range(32)])
    dark_t = np.array([EXPECTED_DARK[i] for i in range(32)])
    # Every non-ink, non-glass pixel moves exactly one ramp step (clamped).
    np.testing.assert_array_equal(lit[plain], lit_t[base[plain]])
    np.testing.assert_array_equal(dark[plain], dark_t[base[plain]])
    # Ink never shifts.
    np.testing.assert_array_equal(lit[ink], base[ink])
    np.testing.assert_array_equal(dark[ink], base[ink])
    # Glass never shifts on dark, and gains the 28 glint on lit only.
    np.testing.assert_array_equal(dark[glass], base[glass])
    assert not (dark[glass] == GLINT).any()
    lit_glint = glass & (lit == GLINT)
    assert lit_glint.any(), "every set with glass must show a glint on lit"
    np.testing.assert_array_equal(lit_glint, glint_mask(base))
    np.testing.assert_array_equal(lit[glass & ~lit_glint], base[glass & ~lit_glint])


@pytest.mark.parametrize("asset_id", PUDDLE_LANE_FACADES)
def test_facade_sets_follow_the_art_rules(asset_id: str) -> None:
    for local, frame in built(asset_id).items():
        assert not (frame == TRANSPARENT).any(), f"{local}: walls have no holes"
        assert not (frame == 15).any(), f"{local}: 15 sweeper_yellow is reserved for Bessie (ART_BIBLE §5.3)"
        # ART_BIBLE §5.4: at most 4 steps of any one ramp per sprite.
        present = set(np.unique(frame).tolist())
        for name, members in PALETTE.ramps.items():
            assert len(present & set(members)) <= 4, f"{local}: {len(present & set(members))} steps of {name}"
    # ART_BIBLE §9.4: bold windows, at least one glass pane of 8x12 px or more.
    base = built(asset_id)["base:-:0"]
    glass = np.isin(base, GLASS)

    sizes = [(max(x for _, x in p) - min(x for _, x in p) + 1, max(y for y, _ in p) - min(y for y, _ in p) + 1) for p in glass_panes(glass)]
    assert any(w >= 8 and h >= 12 for w, h in sizes), sizes


def test_glint_and_special_cases_on_a_synthetic_frame() -> None:
    base = np.full((20, 20), 10, dtype=np.int16)
    base[2:14, 2:10] = 25  # an 8x12 pane
    base[13, 2:10] = 27  # its sky reflection row (same pane)
    base[16:18, 14:16] = 27  # a 2x2 pane
    base[0, 0] = INK
    base[19, 19] = 20  # accent
    base[19, 18] = 29  # accent
    v = derive_variants(base, PALETTE)
    lit, dark = v["lit"], v["dark"]
    glints = sorted(zip(*np.nonzero(lit == GLINT), strict=True))
    assert glints == [(3, 5), (4, 4), (5, 3), (16, 14)]
    assert (dark == GLINT).sum() == 0
    assert lit[0, 0] == INK and dark[0, 0] == INK
    assert lit[19, 19] == 20 and dark[19, 19] == 20 and lit[19, 18] == 29 and dark[19, 18] == 29
    assert lit[10, 15] == 11 and dark[10, 15] == 9
    np.testing.assert_array_equal(v["base"], base)
    with pytest.raises(ProceduralError, match="fully opaque"):
        derive_variants(np.full((4, 4), TRANSPARENT, dtype=np.int16), PALETTE)


# ---------------------------------------------------------------------------------------------
# Assembly (synthetic repo)


def module_text(name: str, fill: str, rows: list[str] | None = None) -> str:
    body = rows if rows is not None else [fill * 32] * 40
    return "\n".join([f"id: facade.{name}", "cell: 32x40", "palette: kerbside32", "", "frame base:-:0", *body]) + "\n"


def facade_entry(asset_id: str = "facade.toy", bay: int = 2, **over: Any) -> dict[str, Any]:
    e: dict[str, Any] = {
        "id": asset_id,
        "class": "facade",
        "technique": "procedural",
        "source": f"assets-src/procedural/facades/{asset_id.split('.')[1]}.json",
        "cell": [32 * bay, 80],
        "states": ["lit", "base", "dark"],
        "dirs": "-",
        "frames": {"lit": 1, "base": 1, "dark": 1},
        "atlas": "world",
        "outline": False,
        "swaps": [],
    }
    e.update(over)
    return e


def roof_entry(asset_id: str = "roof.toy", variants: int = 2, **over: Any) -> dict[str, Any]:
    e: dict[str, Any] = {
        "id": asset_id,
        "class": "roof",
        "technique": "procedural",
        "source": f"assets-src/procedural/roofs/{asset_id.split('.')[1]}.json",
        "cell": [32, 32],
        "states": ["v"],
        "dirs": "-",
        "frames": {"v": variants},
        "atlas": "world",
        "outline": False,
        "swaps": [],
    }
    e.update(over)
    return e


SLATE_PARAMS = {
    "base_index": 2,
    "course_index": 3,
    "course_spacing_px": 4,
    "tint": {"index": 25, "density": 0.06},
    "chip": {"index": 3, "density": 0.015},
}


def make_repo(tmp_path: Path, entries: list[dict[str, Any]]) -> Path:
    repo = tmp_path / "repo"
    (repo / "assets-src" / "palette").mkdir(parents=True)
    shutil.copy(PALETTE_PATH, repo / "assets-src" / "palette" / "kerbside32.json")
    (repo / "assets-src" / "manifest.json").write_text(json.dumps({"assets": entries}, indent=2), encoding="utf-8")
    return repo


def write(repo: Path, rel: str, text: str) -> Path:
    p = repo / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    return p


def add_modules(repo: Path) -> None:
    write(repo, "assets-src/sprites/facade/wall.sprite.txt", module_text("wall", "a"))
    write(repo, "assets-src/sprites/facade/door.sprite.txt", module_text("door", "m"))
    pipe = ["." * 30 + "21"] * 40
    write(repo, "assets-src/sprites/facade/pipe.sprite.txt", module_text("pipe", ".", pipe))


def add_set(repo: Path, params: dict[str, Any], asset_id: str = "facade.toy", cell: tuple[int, int] = (64, 80)) -> None:
    doc = {"id": asset_id, "generator": "facades.set", "cell": list(cell), "params": params}
    write(repo, f"assets-src/procedural/facades/{asset_id.split('.')[1]}.json", json.dumps(doc))


def test_facade_set_assembles_upper_over_ground_with_overlays(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [facade_entry()])
    add_modules(repo)
    add_set(repo, {"upper": ["wall", ["wall", "pipe"]], "ground": [["door"], "wall"], "recolour": {"22": 26}})
    result = build(repo_root=repo, out_root=tmp_path / "o", use_cache=False)
    frames = {f.frame_id: f for f in result.frames}
    assert sorted(frames) == ["facade.toy:base:-:0", "facade.toy:dark:-:0", "facade.toy:lit:-:0"]
    base = frames["facade.toy:base:-:0"].indices
    mw, mh = MODULE_CELL
    assert (base[:mh, :mw] == 10).all()  # upper slot 0: wall
    assert (base[:mh, mw : mw + 30] == 10).all() and (base[:mh, mw + 30] == 2).all() and (base[:mh, mw + 31] == 1).all()
    assert (base[mh:, :mw] == 26).all()  # ground slot 0: door 22, recoloured to 26
    assert (base[mh:, mw:] == 10).all()
    assert frames["facade.toy:lit:-:0"].pivot == (32, 40)
    # The world atlas holds the three frames at their full cell, 1 px extruded.
    atlas = next(a for a in result.atlases if a.name == "world")
    assert {(af.frame_id, af.w, af.h) for af in atlas.frames} == {(f, 64, 80) for f in frames}


@pytest.mark.parametrize(
    ("params", "cell", "match"),
    [
        ({"upper": ["wall"], "ground": ["wall", "wall"]}, (64, 80), "upper has 1 slots, ground has 2"),
        ({"upper": ["wall", "wall"], "ground": ["wall", "wall"]}, (96, 80), "a 2-module bay is 64x80"),
        ({"upper": ["pipe", "wall"], "ground": ["wall", "wall"]}, (64, 80), "bottom module 'pipe' must be fully opaque"),
        ({"upper": ["nope", "wall"], "ground": ["wall", "wall"]}, (64, 80), "module grid .*nope.sprite.txt does not exist"),
        ({"upper": ["../x", "wall"], "ground": ["wall", "wall"]}, (64, 80), "bare snake_case name"),
        ({"upper": ["wall", "wall"], "ground": ["wall", "wall"], "rows": 2}, (64, 80), "unknown params"),
        ({"upper": ["wall", "wall"], "ground": ["wall", "wall"], "recolour": {"40": 1}}, (64, 80), "not a palette index"),
        ({"upper": [], "ground": []}, (64, 80), "non-empty list of slots"),
    ],
)
def test_facade_set_errors(tmp_path: Path, params: dict[str, Any], cell: tuple[int, int], match: str) -> None:
    repo = make_repo(tmp_path, [facade_entry(cell=list(cell))])
    add_modules(repo)
    add_set(repo, params, cell=cell)
    with pytest.raises(BuildError, match=match):
        build(repo_root=repo, out_root=tmp_path / "o", use_cache=False)


def test_module_grid_must_be_named_and_shaped_like_a_module(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [facade_entry()])
    add_modules(repo)
    write(repo, "assets-src/sprites/facade/wall.sprite.txt", module_text("other", "a"))
    add_set(repo, {"upper": ["wall", "wall"], "ground": ["wall", "wall"]})
    with pytest.raises(BuildError, match="declares id 'facade.other', expected 'facade.wall'"):
        build(repo_root=repo, out_root=tmp_path / "o", use_cache=False)
    write(repo, "assets-src/sprites/facade/wall.sprite.txt", module_text("wall", "a").replace("frame base", "frame lit"))
    with pytest.raises(BuildError, match="exactly the frame base:-:0"):
        build(repo_root=repo, out_root=tmp_path / "o", use_cache=False)


def test_editing_a_module_grid_invalidates_the_cache(tmp_path: Path) -> None:
    repo = make_repo(tmp_path, [facade_entry()])
    add_modules(repo)
    add_set(repo, {"upper": ["wall", "wall"], "ground": ["door", "wall"]})
    entry = entry_from_data(facade_entry())
    k1 = asset_cache_key(entry, repo, repo / "assets-src" / "palette" / "kerbside32.json")
    write(repo, "assets-src/sprites/facade/pipe.sprite.txt", module_text("pipe", "1"))  # not used: no change
    assert asset_cache_key(entry, repo, repo / "assets-src" / "palette" / "kerbside32.json") == k1
    write(repo, "assets-src/sprites/facade/door.sprite.txt", module_text("door", "n"))
    k2 = asset_cache_key(entry, repo, repo / "assets-src" / "palette" / "kerbside32.json")
    assert k2 != k1
    cache = tmp_path / "cache"
    first = build(repo_root=repo, out_root=tmp_path / "o", cache_dir=cache)
    assert first.assets[0].cache == "miss"
    assert build(repo_root=repo, out_root=tmp_path / "o", cache_dir=cache).assets[0].cache == "hit"
    write(repo, "assets-src/sprites/facade/door.sprite.txt", module_text("door", "m"))
    again = build(repo_root=repo, out_root=tmp_path / "o", cache_dir=cache)
    assert again.assets[0].cache == "miss"
    base = next(f for f in again.frames if f.frame_id == "facade.toy:base:-:0")
    assert (base.indices[40:, :32] == 22).all()


# ---------------------------------------------------------------------------------------------
# Roofs


def seam_ok(a: np.ndarray) -> bool:
    """Wrap-edge difference (fraction of differing pixels) never exceeds the largest interior one."""
    for arr in (a, a.T):
        interior = [float((arr[:, i] != arr[:, i + 1]).mean()) for i in range(arr.shape[1] - 1)]
        wrap = float((arr[:, -1] != arr[:, 0]).mean())
        if wrap > max(interior):
            return False
    return True


@pytest.mark.parametrize(
    ("asset_id", "allowed"),
    [("roof.slate", {2, 3, 25}), ("roof.felt", {1, 2, 3}), ("roof.depot", {4, 5, 6})],
)
def test_roof_surfaces_use_their_art_bible_indices_and_tile_seamlessly(asset_id: str, allowed: set[int]) -> None:
    frames = built(asset_id)
    assert sorted(frames) == [f"v:-:{k}" for k in range(entry_of(asset_id).frames["v"])]
    for local, arr in frames.items():
        assert arr.shape == (32, 32)
        assert set(np.unique(arr).tolist()) <= allowed, (local, set(np.unique(arr).tolist()))
        assert seam_ok(arr), local


def test_slate_has_a_course_every_4_px_and_a_tint() -> None:
    for arr in built("roof.slate").values():
        assert (arr[3::4, :] == 3).all()
        assert (arr == 25).any()
        assert ((arr[0::4] == 2) | (arr[0::4] == 25) | (arr[0::4] == 3)).all()


def roof_repo(tmp_path: Path, seed: int, variants: int) -> tuple[Path, Path]:
    repo = make_repo(tmp_path, [roof_entry(variants=variants)])
    doc = {"id": "roof.toy", "generator": "roofs.slate", "seed": seed, "cell": [32, 32], "variants": variants, "params": SLATE_PARAMS}
    src = write(repo, "assets-src/procedural/roofs/toy.json", json.dumps(doc))
    return repo, src


def test_roofs_are_deterministic_and_appending_a_variant_keeps_the_others(tmp_path: Path) -> None:
    repo, src = roof_repo(tmp_path / "a", 7, 2)
    a = run_procedural("roof.toy", src, (32, 32), repo, PALETTE)
    b = run_procedural("roof.toy", src, (32, 32), repo, PALETTE)
    for k in a.frames:
        np.testing.assert_array_equal(a.frames[k], b.frames[k])
    repo4, src4 = roof_repo(tmp_path / "b", 7, 4)
    c = run_procedural("roof.toy", src4, (32, 32), repo4, PALETTE)
    assert sorted(c.frames) == ["v:-:0", "v:-:1", "v:-:2", "v:-:3"]
    for k in a.frames:
        np.testing.assert_array_equal(a.frames[k], c.frames[k])
    repo8, src8 = roof_repo(tmp_path / "c", 8, 2)
    d = run_procedural("roof.toy", src8, (32, 32), repo8, PALETTE)
    assert not np.array_equal(a.frames["v:-:0"], d.frames["v:-:0"])


@pytest.mark.parametrize(
    ("doc_over", "match"),
    [
        ({"id": "roof.other"}, "declares id 'roof.other'"),
        ({"cell": [16, 16]}, "cell 16x16 != manifest cell 32x32"),
        ({"generator": "roofs.nope"}, "unknown generator 'roofs.nope'"),
        ({"seed": -1}, "seed must be an integer >= 0"),
        ({"variants": 3}, "not in the manifest 1: v:-:2"),
        ({"params": {**SLATE_PARAMS, "course_spacing_px": 5}}, "does not tile a 32x32 cell"),
        ({"params": {**SLATE_PARAMS, "base_index": 32}}, "base_index must be a palette index"),
    ],
)
def test_roof_params_errors(tmp_path: Path, doc_over: dict[str, Any], match: str) -> None:
    repo = make_repo(tmp_path, [roof_entry(variants=2)])
    doc = {"id": "roof.toy", "generator": "roofs.slate", "seed": 1, "cell": [32, 32], "variants": 2, "params": SLATE_PARAMS}
    doc.update(doc_over)
    write(repo, "assets-src/procedural/roofs/toy.json", json.dumps(doc))
    with pytest.raises(BuildError, match=match):
        build(repo_root=repo, out_root=tmp_path / "o", use_cache=False)


# ---------------------------------------------------------------------------------------------
# Repo assets


def test_puddle_lane_wall_and_roof_ids_are_in_the_sorted_manifest() -> None:
    ids = [e.id for e in MANIFEST]
    assert ids == sorted(ids)
    for asset_id in (*PUDDLE_LANE_FACADES, *ROOFS):
        e = entry_of(asset_id)
        assert (e.technique, e.atlas, e.outline) == ("procedural", "world", False)
    for asset_id in PUDDLE_LANE_FACADES:
        assert entry_of(asset_id).states == ("lit", "base", "dark")


def test_module_grids_are_source_ids_that_never_collide_with_manifest_ids() -> None:
    ids = {e.id for e in MANIFEST}
    modules = sorted((REPO_ROOT / "assets-src" / "sprites" / "facade").glob("*.sprite.txt"))
    assert modules
    used = {
        n
        for e in MANIFEST
        if e.asset_class == "facade"
        for row in ("upper", "ground")
        for slot in json.loads((REPO_ROOT / e.source).read_text(encoding="utf-8"))["params"][row]
        for n in ([slot] if isinstance(slot, str) else slot)
    }
    for p in modules:
        name = p.name.removesuffix(".sprite.txt")
        assert f"facade.{name}" not in ids
        assert name in used, f"module {name} is not used by any facade set"


def test_every_generator_is_registered_under_its_module_name() -> None:
    assert list(GENERATORS) == sorted(GENERATORS)
    for name in GENERATORS:
        assert name.split(".")[0] in {"facades", "roofs", "stains", "tiles"}


def test_repo_facades_and_roofs_build_identically_twice(tmp_path: Path) -> None:
    for asset_id in (*PUDDLE_LANE_FACADES, *ROOFS):
        a = built(asset_id)
        b = built(asset_id)
        assert a.keys() == b.keys()
        for k in a:
            np.testing.assert_array_equal(a[k], b[k])
