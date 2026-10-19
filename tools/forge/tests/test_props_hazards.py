"""Tests for the SSP-101 placeholders: knockable and static prop grids, hazard decals.

ART_BIBLE §7.1 (props 32x32 per slice, hazards on the 32x32 stain cell), §8.6 (prop looks), §8.7 (hazard
looks), STYLE.md v1 §8 (slice counts) and ENTITY_CATALOG §9-§10. The power-up grids are covered with the
other pickups in test_pickups_sites.py; cobbles and the open manhole tile with the tiles in test_tiles.py.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from forge.build import build_asset
from forge.lint import ramp_steps
from forge.manifest import AssetEntry, load_manifest
from forge.palette import REPO_ROOT, TRANSPARENT, load_palette
from forge.procedural import ProceduralError, run_procedural

PALETTE = load_palette()
MANIFEST = load_manifest()

PROPS: dict[str, tuple[str | int, set[int]]] = {
    "prop.wheelie_bin": (4, {22, 1}),
    "prop.traffic_cone": (4, {17, 7}),
    "prop.a_board": (4, {7, 3}),
    "prop.shopping_trolley": ("flat", {6, 26}),
    "prop.recycling_box": ("flat", {26, 22}),
    "prop.bollard": (4, {1, 7}),
    "prop.bench": ("flat", {13, 1}),
    "prop.bus_shelter": (8, {5, 28, 26}),
    "prop.phone_box": (4, {18, 25}),
    "prop.post_box": (4, {18, 0}),
    "prop.tree": (8, {21, 22, 23, 13}),
    "prop.planter": ("flat", {5, 22}),
    "prop.market_stall": (8, {18, 7}),
    "prop.litter_bin": (4, {1, 15}),
    "prop.roadworks_barrier": (4, {18, 7}),
}
"""Prop ID -> (render: ``flat`` or the STYLE.md v1 §8 slice count, colours it must show, ART_BIBLE §8.6)."""

HAZARDS: dict[str, tuple[str, int, set[int]]] = {
    "haz.puddle": ("hazards/puddle", 2, {25, 27, 28}),
    "haz.oil_slick": ("hazards/oil_slick", 2, {1, 30, 29}),
    "haz.pothole": ("hazards/pothole", 2, {0, 1, 3, 4}),
    "haz.wet_leaves": ("hazards/wet_leaves", 2, {1, 14, 11, 13}),
    "haz.broken_glass": ("hazards/broken_glass", 2, {28, 27, 7}),
}
"""Decal ID -> (params stem, frames, exactly the indices it uses besides transparency, ART_BIBLE §8.7)."""


def entry_of(asset_id: str) -> AssetEntry:
    return next(e for e in MANIFEST if e.id == asset_id)


def built(asset_id: str) -> dict[str, np.ndarray]:
    ab = build_asset(entry_of(asset_id), REPO_ROOT, PALETTE)
    return {f.frame_id.split(":", 1)[1]: f.indices for f in ab.frames}


def near_clear(arr: np.ndarray) -> np.ndarray:
    clear = np.pad(arr == TRANSPARENT, 1, constant_values=True)
    return clear[:-2, 1:-1] | clear[2:, 1:-1] | clear[1:-1, :-2] | clear[1:-1, 2:]


# ---------------------------------------------------------------------------------------------
# Props


@pytest.mark.parametrize("asset_id", list(PROPS))
def test_prop_entries_are_outlined_items_grids_under_the_final_id(asset_id: str) -> None:
    render, _ = PROPS[asset_id]
    e = entry_of(asset_id)
    state, n = ("flat", 1) if render == "flat" else ("slice", int(render))
    assert (e.technique, e.source, e.cell, e.states, e.dirs, e.frames, e.atlas, e.outline, e.placeholder) == (
        "grid",
        f"assets-src/sprites/prop/{asset_id.split('.', 1)[1]}.sprite.txt",
        (32, 32),
        (state,),
        ("-",),
        {state: n},
        "items",
        True,
        True,
    )
    assert sorted(built(asset_id)) == sorted(f"{state}:-:{k}" for k in range(n))


@pytest.mark.parametrize("asset_id", list(PROPS))
def test_prop_frames_are_outlined_and_keep_their_colours_and_ramps(asset_id: str) -> None:
    _, colours = PROPS[asset_id]
    frames = built(asset_id)
    used: set[int] = set()
    for local, arr in frames.items():
        assert arr.shape == (32, 32)
        body = (arr != TRANSPARENT) & (arr != 0)
        assert body.any(), local
        assert not (body & near_clear(arr)).any(), f"{local}: outlined by the build"
        assert all(len(steps) <= 4 for steps in ramp_steps(arr, PALETTE).values()), local
        used |= set(np.unique(arr).tolist())
    assert colours <= used, colours - used


@pytest.mark.parametrize("asset_id", [i for i, (r, _) in PROPS.items() if r != "flat"])
def test_stack_slices_line_up_on_the_cell_centre(asset_id: str) -> None:
    """STYLE.md v1 §8: slices must line up vertically when the camera is centred over them (no wobbling stack)."""
    for local, arr in built(asset_id).items():
        ys, xs = np.nonzero(arr != TRANSPARENT)
        cx, cy = (xs.min() + xs.max() + 1) / 2, (ys.min() + ys.max() + 1) / 2
        assert abs(cx - 16) <= 1.5 and abs(cy - 16) <= 1.5, f"{local}: bounding box centred near (16, 16), got ({cx}, {cy})"


def test_prop_footprints_follow_the_size_sheet_at_16_px_per_metre() -> None:
    """Narrowest members from STYLE.md v1 §8 (outline included) and the catalogue sizes at 16 px/m."""

    def width(asset_id: str, local: str) -> int:
        arr = built(asset_id)[local]
        xs = np.nonzero((arr != TRANSPARENT).any(axis=0))[0]
        return int(xs.max() - xs.min() + 1)

    assert width("prop.bollard", "slice:-:1") == 6  # a 5 px post nominal: 4 px body + outline
    assert width("prop.litter_bin", "slice:-:2") == 10
    assert width("prop.post_box", "slice:-:1") == 10
    assert width("prop.wheelie_bin", "slice:-:2") == 12
    assert width("prop.phone_box", "slice:-:3") == 16
    assert 26 <= width("prop.bench", "flat:-:0") <= 30  # about 1.6 m
    assert width("prop.tree", "slice:-:1") <= 7  # the trunk


def test_the_top_slice_covers_the_body_from_above() -> None:
    """Seen straight down the top slice is what shows: a bin's lid, a cone's tip, a stall's awning."""
    top = built("prop.wheelie_bin")["slice:-:3"]
    assert (top == 1).sum() > (top == 22).sum(), "the 01 lid"
    awning = built("prop.market_stall")["slice:-:7"]
    assert (awning == 18).sum() > 200 and (awning == 7).sum() > 200, "18/07 striped awning"
    roof = built("prop.bus_shelter")["slice:-:7"]
    assert (roof == 26).sum() > 250, "26 roof"


# ---------------------------------------------------------------------------------------------
# Hazards


@pytest.mark.parametrize("asset_id", list(HAZARDS))
def test_hazard_entries_are_unoutlined_world_decals(asset_id: str) -> None:
    stem, n, _ = HAZARDS[asset_id]
    e = entry_of(asset_id)
    assert (e.technique, e.source, e.cell, e.states, e.dirs, e.frames, e.atlas, e.outline, e.placeholder) == (
        "procedural",
        f"assets-src/procedural/{stem}.json",
        (32, 32),
        ("v",),
        ("-",),
        {"v": n},
        "world",
        False,
        True,
    )


@pytest.mark.parametrize("asset_id", list(HAZARDS))
def test_hazard_decals_use_exactly_their_art_bible_indices(asset_id: str) -> None:
    _, n, colours = HAZARDS[asset_id]
    frames = built(asset_id)
    assert sorted(frames) == [f"v:-:{k}" for k in range(n)]
    for local, arr in frames.items():
        used = set(np.unique(arr).tolist()) - {TRANSPARENT}
        assert used <= colours, (local, used - colours)
        assert (arr == TRANSPARENT).any(), f"{local}: a decal lets the ground show through"
        assert (arr[[0, -1], :] == TRANSPARENT).all() and (arr[:, [0, -1]] == TRANSPARENT).all(), f"{local}: inside the cell"
    assert colours <= set().union(*(set(np.unique(a).tolist()) for a in frames.values()))


def test_puddle_has_its_inner_rim_on_the_north_west() -> None:
    for arr in built("haz.puddle").values():
        ys, xs = np.nonzero(arr == 27)
        by, bx = np.nonzero(arr == 25)
        assert (xs + ys).mean() < (bx + by).mean() - 4
        assert (arr == 28).sum() in (4, 6), "two or three 2 px glints"


def test_pothole_core_sits_inside_its_bowl_and_the_rim_outside() -> None:
    for arr in built("haz.pothole").values():
        core = arr == 0
        assert core.sum() >= 4
        pad = np.pad(core, 1)
        neighbours = pad[:-2, 1:-1] | pad[2:, 1:-1] | pad[1:-1, :-2] | pad[1:-1, 2:]
        assert not (neighbours & (arr == TRANSPARENT)).any(), "the core never touches the ground"
        assert (arr == 3).sum() >= 10 and (arr == 4).sum() >= 3


def test_broken_glass_frames_show_the_same_shards_and_move_the_glint() -> None:
    f = built("haz.broken_glass")
    a, b = f["v:-:0"], f["v:-:1"]
    np.testing.assert_array_equal(a != TRANSPARENT, b != TRANSPARENT)
    assert (a == 7).sum() == 2 and (b == 7).sum() == 2
    assert not ((a == 7) & (b == 7)).any(), "a different pair of shards glints in each frame"
    differ = a != b
    assert set(np.unique(a[differ]).tolist()) | set(np.unique(b[differ]).tolist()) <= {7, 27, 28}


def test_wet_leaves_lie_on_a_darkened_patch() -> None:
    for arr in built("haz.wet_leaves").values():
        leaves = np.isin(arr, (14, 11, 13))
        assert 20 <= leaves.sum() <= 48
        assert (arr == 1).sum() > 3 * leaves.sum()


def test_oil_slick_reuses_the_oil_stain_generator() -> None:
    doc = json.loads((REPO_ROOT / entry_of("haz.oil_slick").source).read_text(encoding="utf-8"))
    assert doc["generator"] == "stains.oil"


def _doc(stem: str) -> dict[str, Any]:
    return json.loads((REPO_ROOT / "assets-src" / "procedural" / f"{stem}.json").read_text(encoding="utf-8"))


def _run(tmp_path: Path, doc: dict[str, Any]) -> dict[str, np.ndarray]:
    src = tmp_path / "p.json"
    src.write_text(json.dumps(doc), encoding="utf-8")
    return run_procedural(doc["id"], src, (32, 32), tmp_path, PALETTE).frames


def test_hazard_generators_are_pure_functions_of_their_params(tmp_path: Path) -> None:
    for stem in ("hazards/puddle", "hazards/pothole", "hazards/wet_leaves", "hazards/broken_glass"):
        doc = _doc(stem)
        first, second = _run(tmp_path, doc), _run(tmp_path, doc)
        for k in first:
            np.testing.assert_array_equal(first[k], second[k])
        reseeded = json.loads(json.dumps(doc))
        if "seed" in reseeded:
            reseeded["seed"] += 1
        else:
            reseeded["params"]["seed"] += 1
        assert not np.array_equal(_run(tmp_path, reseeded)["v:-:0"], first["v:-:0"]), stem


@pytest.mark.parametrize(
    ("stem", "edit", "match"),
    [
        ("hazards/puddle", lambda d: d["params"]["glints"].update(count=[60, 60]), "placed .* of 60 glints"),
        ("hazards/puddle", lambda d: d["params"]["body"].update(radius_px=[2, 2]), "radius_px must be"),
        ("hazards/pothole", lambda d: d["params"]["core"].update(offset_px=[1]), "offset_px must be"),
        ("hazards/wet_leaves", lambda d: d["params"]["leaves"].update(count=[200, 200]), "placed .* of 200 leaves"),
        ("hazards/broken_glass", lambda d: d["params"]["glints"].update(per_frame=9), "needs that many shards"),
        ("hazards/broken_glass", lambda d: d["params"]["shards"].update(index=40), "palette index"),
    ],
)
def test_hazard_params_errors(tmp_path: Path, stem: str, edit: Any, match: str) -> None:
    doc = _doc(stem)
    edit(doc)
    with pytest.raises(ProceduralError, match=match):
        _run(tmp_path, doc)
