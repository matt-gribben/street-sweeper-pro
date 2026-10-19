"""Tests for the procedural stains and grime overlays (SSP-052, ART_BIBLE §8.7, §9.2)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from numpy.random import PCG64, Generator

from forge.build import build, build_asset
from forge.manifest import AssetEntry, load_manifest
from forge.palette import REPO_ROOT, TRANSPARENT, load_palette
from forge.procedural import ProceduralError, run_procedural, wrap_tile
from forge.procedural import stains

from test_procedural import seam_ok as independent_seam_ok

PALETTE = load_palette()
MANIFEST = load_manifest()

STAIN_VARIANTS = {"stain.chalk_art": 3, "stain.gum": 3, "stain.milkshake": 2, "stain.oil": 2, "stain.splat": 2}
"""The 5 stain IDs of ENTITY_CATALOG §5 and their variant counts (1-3; chalk art 3, ART_BIBLE §8.7)."""
GRIME_VARIANTS = {"tile.grime_asphalt": 4, "tile.grime_gutter": 4, "tile.grime_slab": 4}
"""The grime overlay IDs proposed by SSP-052 (recorded in ART_BIBLE §9.2)."""
ALL = {**STAIN_VARIANTS, **GRIME_VARIANTS}

# Hand-written from ART_BIBLE §8.7 and §9.2: every index each decal may use (plus transparency).
ALLOWED = {
    "stain.gum": {6, 5},
    "stain.milkshake": {20, 7, 13},
    "stain.oil": {1, 30, 29},
    "stain.chalk_art": {7, 20, 27, 16, 31},
    "stain.splat": {8, 13},
    "tile.grime_asphalt": {8, 13, 1},
    "tile.grime_slab": {8, 13, 1},
    "tile.grime_gutter": {8, 1},
}
GRIME_CELL = 4
"""Grime cells are 4x4 px, an 8x8 grid per 32 px tile (ART_BIBLE §9.2, TECHNICAL_DESIGN §10.3)."""
CLEAN_TILE = {"tile.grime_asphalt": "tile.asphalt", "tile.grime_gutter": "tile.asphalt", "tile.grime_slab": "tile.pavement"}
"""The clean tile each overlay is drawn over: roads, gutters (the road strip against the kerb), pavements."""


def entry_of(asset_id: str) -> AssetEntry:
    return next(e for e in MANIFEST if e.id == asset_id)


def built(asset_id: str) -> dict[str, np.ndarray]:
    ab = build_asset(entry_of(asset_id), REPO_ROOT, PALETTE)
    return {f.frame_id.split(":", 1)[1]: f.indices for f in ab.frames}


def doc_of(asset_id: str) -> dict[str, Any]:
    return json.loads((REPO_ROOT / entry_of(asset_id).source).read_text(encoding="utf-8"))


def run_doc(tmp_path: Path, doc: dict[str, Any]) -> dict[str, np.ndarray]:
    src = tmp_path / f"{doc['id']}.json"
    src.write_text(json.dumps(doc), encoding="utf-8")
    return run_procedural(doc["id"], src, (32, 32), tmp_path, PALETTE).frames


def cells(arr: np.ndarray) -> np.ndarray:
    """``arr`` (32x32) as 8x8 grime cells of 16 pixels: shape (8, 8, 16)."""
    h, w = arr.shape
    return arr.reshape(h // GRIME_CELL, GRIME_CELL, w // GRIME_CELL, GRIME_CELL).swapaxes(1, 2).reshape(h // GRIME_CELL, w // GRIME_CELL, -1)


# ---------------------------------------------------------------------------------------------
# Manifest, determinism, palette


def test_stain_and_grime_entries_are_procedural_world_decals() -> None:
    ids = [e.id for e in MANIFEST]
    assert ids == sorted(ids)
    assert {e.id for e in MANIFEST if e.asset_class == "stain"} == set(STAIN_VARIANTS)
    for asset_id, n in ALL.items():
        e = entry_of(asset_id)
        assert (e.technique, e.atlas, e.outline, e.cell, e.dirs) == ("procedural", "world", False, (32, 32), ("-",))
        assert (e.states, e.frames) == (("v",), {"v": n}), asset_id
        folder = "stains" if asset_id.startswith("stain.") else "tiles"
        assert e.source == f"assets-src/procedural/{folder}/{asset_id.split('.', 1)[1]}.json"
        doc = doc_of(asset_id)
        assert doc["variants"] == n and isinstance(doc["seed"], int)
        assert doc["generator"] == ("stains.grime" if asset_id.startswith("tile.") else f"stains.{asset_id.split('.', 1)[1]}")


def test_every_stain_has_one_to_three_variants_and_chalk_art_three() -> None:
    assert all(1 <= n <= 3 for n in STAIN_VARIANTS.values())
    assert STAIN_VARIANTS["stain.chalk_art"] == 3


def _tree(root: Path) -> dict[str, str]:
    return {
        p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted((root / "frames").rglob("*"))
        if p.is_file()
    }


def test_two_builds_give_the_same_sha256_for_every_output(tmp_path: Path) -> None:
    trees = []
    for run in ("a", "b"):
        out = tmp_path / run
        build(repo_root=REPO_ROOT, out_root=out, only=list(ALL), use_cache=False, publish=False)
        trees.append(_tree(out))
    assert trees[0] == trees[1]
    assert len([k for k in trees[0] if k.endswith(".png")]) == sum(ALL.values())


@pytest.mark.parametrize("asset_id", list(ALL))
def test_generator_is_a_pure_function_of_its_params(asset_id: str) -> None:
    a = run_procedural(asset_id, REPO_ROOT / entry_of(asset_id).source, (32, 32), REPO_ROOT, PALETTE).frames
    b = run_procedural(asset_id, REPO_ROOT / entry_of(asset_id).source, (32, 32), REPO_ROOT, PALETTE).frames
    assert a.keys() == b.keys()
    for k in a:
        np.testing.assert_array_equal(a[k], b[k])


@pytest.mark.parametrize("asset_id", list(ALL))
def test_output_is_palette_indices_from_the_art_bible_only(asset_id: str) -> None:
    frames = built(asset_id)
    assert sorted(frames) == [f"v:-:{k}" for k in range(ALL[asset_id])]
    for local, arr in frames.items():
        assert arr.shape == (32, 32) and arr.dtype == np.int16
        used = set(np.unique(arr).tolist())
        assert used <= ALLOWED[asset_id] | {TRANSPARENT}, (local, used - ALLOWED[asset_id])
        assert TRANSPARENT in used, "decals leave the ground visible somewhere"
        assert (arr != TRANSPARENT).any()


@pytest.mark.parametrize("asset_id", list(ALL))
def test_appending_variants_keeps_the_earlier_ones(tmp_path: Path, asset_id: str) -> None:
    doc = doc_of(asset_id)
    repo = built(asset_id)
    n = doc["variants"]
    if "layouts" in doc["params"]:
        doc["params"]["layouts"] = doc["params"]["layouts"] * 2
    doc["variants"] = n + 1
    more = run_doc(tmp_path, doc)
    assert len(more) == n + 1
    for k in range(n):
        np.testing.assert_array_equal(more[f"v:-:{k}"], repo[f"v:-:{k}"])


@pytest.mark.parametrize("asset_id", list(ALL))
def test_variants_differ_and_follow_the_seed(tmp_path: Path, asset_id: str) -> None:
    frames = built(asset_id)
    keys = sorted(frames)
    for a, b in zip(keys, keys[1:], strict=False):
        assert not np.array_equal(frames[a], frames[b])
    doc = doc_of(asset_id)
    doc["seed"] += 1
    assert not np.array_equal(run_doc(tmp_path, doc)["v:-:0"], frames["v:-:0"])


# ---------------------------------------------------------------------------------------------
# Grime overlays (ART_BIBLE §9.2)


@pytest.mark.parametrize("asset_id", list(GRIME_VARIANTS))
def test_grime_wraps_and_passes_the_seam_rule(asset_id: str) -> None:
    assert wrap_tile(REPO_ROOT / entry_of(asset_id).source)
    for local, arr in built(asset_id).items():
        assert independent_seam_ok(arr), local


@pytest.mark.parametrize(
    ("asset_id", "lo", "hi"),
    [("tile.grime_asphalt", 0.60, 0.80), ("tile.grime_slab", 0.60, 0.80), ("tile.grime_gutter", 0.85, 0.95)],
)
def test_grime_covers_its_share_of_every_grime_cell(asset_id: str, lo: float, hi: float) -> None:
    """60-80% of a dirty cell's pixels (asphalt, slab); about 90% for gutter grime (ART_BIBLE §9.2)."""
    for local, arr in built(asset_id).items():
        share = (cells(arr) != TRANSPARENT).mean(axis=-1)
        assert share.min() >= lo and share.max() <= hi, (local, share.min(), share.max())


def test_grime_is_mostly_soot_brown_with_umber_blotches_and_tar_flecks() -> None:
    for asset_id in ("tile.grime_asphalt", "tile.grime_slab"):
        for local, arr in built(asset_id).items():
            covered = arr[arr != TRANSPARENT]
            share = {i: float((covered == i).mean()) for i in (8, 13, 1)}
            assert share[8] > share[13] > share[1] > 0, (asset_id, local, share)
    for local, arr in built("tile.grime_gutter").items():
        covered = arr[arr != TRANSPARENT]
        assert set(np.unique(covered).tolist()) == {8, 1}, local
        assert (covered == 8).mean() > 0.5, "08 soot_brown stays the primary grime colour"


@pytest.mark.parametrize("asset_id", list(GRIME_VARIANTS))
def test_a_fully_dirty_cell_differs_from_the_clean_tile_in_at_least_60_percent(asset_id: str) -> None:
    """ART_BIBLE §9.2 contrast target, for every overlay variant over every clean tile variant.

    A grime pixel replaces the clean pixel under it. It counts as one or more ramp steps away when
    its palette index differs from the clean one: along a shared ramp that is at least one step,
    and a change of ramp (hue shift) counts as a step too (ART_BIBLE §5.4). Checked per 4 px grime
    cell at full intensity, and over the whole 32 px tile.
    """
    clean = built(CLEAN_TILE[asset_id])
    for local, overlay in built(asset_id).items():
        for clean_local, tile in clean.items():
            dirty = np.where(overlay != TRANSPARENT, overlay, tile)
            differs = dirty != tile
            assert differs.mean() >= 0.6, (local, clean_local, differs.mean())
            per_cell = cells(differs).mean(axis=-1)
            assert per_cell.min() >= 0.6, (local, clean_local, per_cell.min())


def test_grime_cells_keep_their_clean_pixels_clumped_not_lined_up() -> None:
    """The fine shape field must not leave a clean row or column along every cell edge (the
    over-smoothed draft did): fewer than half the cells have a fully clean edge line."""
    for asset_id in GRIME_VARIANTS:
        for local, arr in built(asset_id).items():
            clear = cells(arr == TRANSPARENT).reshape(8, 8, GRIME_CELL, GRIME_CELL)
            edge = clear[:, :, 0, :].all(-1) | clear[:, :, -1, :].all(-1) | clear[:, :, :, 0].all(-1) | clear[:, :, :, -1].all(-1)
            assert edge.mean() < 0.5, (asset_id, local, edge.mean())


# ---------------------------------------------------------------------------------------------
# Stain looks (ART_BIBLE §8.7)


def components(mask: np.ndarray) -> list[np.ndarray]:
    out = []
    left = mask.copy()
    while left.any():
        y, x = map(int, np.argwhere(left)[0])
        comp = stains.component(left, (y, x))
        out.append(comp)
        left &= ~comp
    return out


def test_gum_is_small_separate_flattened_discs() -> None:
    doc = doc_of("stain.gum")["params"]
    for local, arr in built("stain.gum").items():
        blobs = components(arr != TRANSPARENT)
        assert doc["count"][0] <= len(blobs) <= doc["count"][1], local
        for b in blobs:
            ys, xs = np.nonzero(b)
            assert max(ys.max() - ys.min(), xs.max() - xs.min()) + 1 in (2, 3), local
            assert int(b.sum()) in (4, 5)
        assert (arr == 6).any() and (arr == 5).any()


def test_milkshake_has_a_core_inside_the_splash_and_a_separate_cup_ring() -> None:
    for local, arr in built("stain.milkshake").items():
        core = arr == 7
        assert core.any()
        pad = np.pad(arr, 1, constant_values=TRANSPARENT)
        neighbours = [pad[:-2, 1:-1], pad[2:, 1:-1], pad[1:-1, :-2], pad[1:-1, 2:]]
        assert all(((n[core] == 20) | (n[core] == 7)).all() for n in neighbours), "the 07 core sits inside the 20 splash"
        cup = arr == 13
        ys, xs = np.nonzero(cup)
        assert int(cup.sum()) >= 12 and np.ptp(ys) == np.ptp(xs) == 6, f"{local}: one 7 px cup ring"
        cy, cx = int(round(ys.mean())), int(round(xs.mean()))
        assert arr[cy, cx] == TRANSPARENT, "the cup is a 1 px outline with a clear middle"
        near = stains._dilate(cup, 1)
        assert not (near & (arr == 20)).any(), "the cup ring sits apart from the splash"


def test_oil_sheen_sits_on_the_north_west_side_of_the_pool() -> None:
    for local, arr in built("stain.oil").items():
        pool = arr != TRANSPARENT
        ys, xs = np.nonzero(pool)
        cy, cx = ys.mean(), xs.mean()
        sy, sx = np.nonzero((arr == 30) | (arr == 29))
        assert len(sy) >= 6 and (arr == 30).any() and (arr == 29).any(), local
        assert ((sx - cx) + (sy - cy) < 0).all(), "sheen only on the NW side (the sun's, ART_BIBLE §6.1)"
        assert (arr[pool] == 1).mean() > 0.8, "mostly a 01 pool"
        depth = stains.inset_distance(pool)
        assert (depth[(arr == 30) | (arr == 29)] >= 2).all(), "sheen stays inside the pool's 01 rim"


def test_chalk_art_draws_three_pictures_in_all_five_chalk_colours() -> None:
    frames = built("stain.chalk_art")
    assert len(frames) == 3 == len(doc_of("stain.chalk_art")["params"]["layouts"])
    used: set[int] = set()
    for arr in frames.values():
        used |= set(np.unique(arr[arr != TRANSPARENT]).tolist())
    assert used == {7, 20, 27, 16, 31}


def test_splat_is_a_brown_body_with_radial_flecks() -> None:
    for local, arr in built("stain.splat").items():
        opaque = arr != TRANSPARENT
        parts = sorted(components(opaque), key=lambda c: -int(c.sum()))
        assert len(parts) >= 4, f"{local}: flecks lie apart from the body"
        body = parts[0]
        assert (arr[body] == 8).mean() > 0.5 and (arr[body] == 13).any(), local
        ys, xs = np.nonzero(body)
        fy, fx = np.nonzero(opaque & ~body)
        r_body = np.sqrt(body.sum() / np.pi)  # the body's mean radius
        assert (np.hypot(fy - ys.mean(), fx - xs.mean()) > r_body).all(), "flecks fly outward"


# ---------------------------------------------------------------------------------------------
# Helpers and params errors


def test_integer_geometry_helpers() -> None:
    for a, b in (((0, 0), (4, 2)), ((5, 1), (1, 6)), ((2, 7), (2, 3))):
        pts = stains._line(a, b)
        assert pts[0] == a and pts[-1] == b
        assert len(pts) == max(abs(b[0] - a[0]), abs(b[1] - a[1])) + 1
        assert all(max(abs(p[0] - q[0]), abs(p[1] - q[1])) == 1 for p, q in zip(pts, pts[1:], strict=False))
    assert stains._line((3, 3), (3, 3)) == [(3, 3)]
    r = stains.ring((16, 16), (8, 8), 3)
    assert r[8, 11] and r[8, 5] and r[5, 8] and r[11, 8] and not r[8, 8]
    mask = np.zeros((7, 7), dtype=bool)
    mask[1:6, 1:6] = True
    d = stains.inset_distance(mask)
    assert d[1, 1] == 1 and d[2, 2] == 2 and d[3, 3] == 3 and d[0, 0] == 0
    assert all(len(v) == 2 and 56 <= v[0] ** 2 + v[1] ** 2 <= 72 for v in stains.DIRECTIONS_16)
    assert len(set(stains.DIRECTIONS_16)) == 16


def test_smooth_noise_is_integer_toroidal_and_seeded() -> None:
    a = stains.smooth_noise(Generator(PCG64(1)), (32, 32), 2)
    b = stains.smooth_noise(Generator(PCG64(1)), (32, 32), 2)
    assert a.dtype == np.int64
    np.testing.assert_array_equal(a, b)
    # Toroidal: the blur of a rolled field is the rolled blur (no edge treatment differs).
    raw = Generator(PCG64(2)).integers(0, 256, size=(32, 32), dtype=np.int64)
    acc = sum(np.roll(raw, (dy, dx), axis=(0, 1)) for dy in (-1, 0, 1) for dx in (-1, 0, 1))
    np.testing.assert_array_equal(stains.smooth_noise(Generator(PCG64(2)), (32, 32), 1), acc)


@pytest.mark.parametrize(
    ("asset_id", "edit", "match"),
    [
        ("stain.gum", lambda p: p.update(sizes_px=[4]), "sizes_px"),
        ("stain.gum", lambda p: p.update(count=[40, 60]), "placed"),
        ("stain.milkshake", lambda p: p["splash"].update(radius_px=[13, 13]), "cup"),
        ("stain.oil", lambda p: p["sheen"].update(indices=[]), "sheen.indices"),
        ("stain.chalk_art", lambda p: p["layouts"][0].append({"shape": "line", "index": 18, "from": [0, 0], "to": [1, 1]}), "chalk palette"),
        ("stain.chalk_art", lambda p: p["layouts"][1].append({"shape": "blob", "index": 7}), "shape must be"),
        ("stain.chalk_art", lambda p: p["layouts"][2].append({"shape": "rect", "index": 7, "rect": [30, 30, 4, 4]}), "inside"),
        ("stain.splat", lambda p: p["flecks"].update(rays=[3, 2]), "flecks.rays"),
        ("tile.grime_asphalt", lambda p: p.update(coverage_px=[12, 17]), "exceeds"),
        ("tile.grime_asphalt", lambda p: p.update(grime_cell_px=5), "does not divide"),
        ("tile.grime_slab", lambda p: p["blotches"].update(fraction=1.5), "blotches.fraction"),
        ("tile.grime_gutter", lambda p: p.update(wrap="yes"), "wrap"),
    ],
)
def test_params_errors(tmp_path: Path, asset_id: str, edit: Any, match: str) -> None:
    doc = doc_of(asset_id)
    edit(doc["params"])
    with pytest.raises(ProceduralError, match=match):
        run_doc(tmp_path, doc)


def test_chalk_variants_must_match_layouts(tmp_path: Path) -> None:
    doc = doc_of("stain.chalk_art")
    doc["variants"] = 4
    with pytest.raises(ProceduralError, match="no params.layouts entry"):
        run_doc(tmp_path, doc)
