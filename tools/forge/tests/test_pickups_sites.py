"""Tests for the SSP-052 placeholder grids (and SSP-101's five other power-ups): pickups, the hydrant and the site markers.

ART_BIBLE §8.5 (pickups: 12x12 icons on a 16x16 cell bobbing 1 px over 2 frames, on a 1 px ground
halo ring alternating 16/07 with the bob), §8.6 (hydrant 18 with an 06 cap; the skip 17 or 22 steel
with an 01 interior) and ENTITY_CATALOG §11 (depot bay 2x3 tiles, skip 2x1 tiles at 16 px/m).
"""

from __future__ import annotations

import numpy as np
import pytest

from forge.build import build_asset
from forge.lint import ramp_steps
from forge.manifest import AssetEntry, load_manifest
from forge.palette import REPO_ROOT, TRANSPARENT, load_palette

PALETTE = load_palette()
MANIFEST = load_manifest()

PICKUPS = {
    "pwr.flask_of_tea": ("pickup/flask_of_tea", {26, 7}),
    "collect.false_teeth": ("pickup/false_teeth", {7, 20}),
    "collect.golden_crisp": ("pickup/golden_crisp", {15, 16}),
    # SSP-105: the High Street's Lost Property.
    "collect.lost_wallet": ("pickup/lost_wallet", {13, 7}),
    # SSP-101: the other five power-ups.
    "pwr.bacon_butty": ("pickup/bacon_butty", {12, 18}),
    "pwr.hi_vis": ("pickup/hi_vis", {17, 7}),
    "pwr.super_suction": ("pickup/super_suction", {5, 28}),
    "pwr.wrench": ("pickup/wrench", {5, 6}),
    "pwr.water_can": ("pickup/water_can", {22, 28}),
}
"""Pickup ID -> (sprite path stem, colours the icon must show, ART_BIBLE §8.5)."""
FLATS = {
    "prop.hydrant": ("prop/hydrant", (32, 32), True, {18, 6}),
    "site.depot_bay": ("site/depot_bay", (64, 96), False, {7}),
    "site.skip": ("site/skip", (64, 32), True, {22, 1}),
}
"""ID -> (sprite path stem, cell, build-added outline, colours it must show)."""

RING = np.array(
    [
        [c == "#" for c in row]
        for row in (
            ".....######.....",
            "...##......##...",
            "..#..........#..",
            ".#............#.",
            ".#............#.",
            "#..............#",
            "#..............#",
            "#..............#",
            "#..............#",
            "#..............#",
            "#..............#",
            ".#............#.",
            ".#............#.",
            "..#..........#..",
            "...##......##...",
            ".....######.....",
        )
    ]
)


def entry_of(asset_id: str) -> AssetEntry:
    return next(e for e in MANIFEST if e.id == asset_id)


def built(asset_id: str) -> dict[str, np.ndarray]:
    ab = build_asset(entry_of(asset_id), REPO_ROOT, PALETTE)
    return {f.frame_id.split(":", 1)[1]: f.indices for f in ab.frames}


def icon(arr: np.ndarray) -> np.ndarray:
    """The pickup frame without its halo ring pixels (16 or 07 on the ring cells)."""
    out = arr.copy()
    out[RING & np.isin(arr, (16, 7))] = TRANSPARENT
    return out


def near_clear(arr: np.ndarray) -> np.ndarray:
    clear = np.pad(arr == TRANSPARENT, 1, constant_values=True)
    return clear[:-2, 1:-1] | clear[2:, 1:-1] | clear[1:-1, :-2] | clear[1:-1, 2:]


@pytest.mark.parametrize("asset_id", list(PICKUPS))
def test_pickup_entries_are_two_bob_frames_in_the_items_atlas(asset_id: str) -> None:
    e = entry_of(asset_id)
    stem, _ = PICKUPS[asset_id]
    assert (e.technique, e.source, e.cell, e.states, e.dirs, e.frames, e.atlas, e.outline) == (
        "grid",
        f"assets-src/sprites/{stem}.sprite.txt",
        (16, 16),
        ("bob",),
        ("-",),
        {"bob": 2},
        "items",
        False,
    )
    assert sorted(built(asset_id)) == ["bob:-:0", "bob:-:1"]


@pytest.mark.parametrize("asset_id", list(PICKUPS))
def test_pickup_icon_is_12x12_and_bobs_up_1_px(asset_id: str) -> None:
    f = built(asset_id)
    down, up = icon(f["bob:-:0"]), icon(f["bob:-:1"])
    ys, xs = np.nonzero(down != TRANSPARENT)
    assert ys.max() - ys.min() + 1 <= 12 and xs.max() - xs.min() + 1 <= 12
    np.testing.assert_array_equal(up[:-1], down[1:])  # bob 1 = bob 0 moved 1 px up
    assert (up[-1] == TRANSPARENT).all()
    _, colours = PICKUPS[asset_id]
    assert colours <= set(np.unique(down).tolist())


@pytest.mark.parametrize("asset_id", list(PICKUPS))
def test_pickup_halo_ring_alternates_16_and_07_with_the_bob(asset_id: str) -> None:
    f = built(asset_id)
    for local, ring_index in (("bob:-:0", 16), ("bob:-:1", 7)):
        arr = f[local]
        ic = icon(arr)
        free = RING & (ic == TRANSPARENT)
        assert (arr[free] == ring_index).all(), local
        assert int(free.sum()) >= 24, f"{local}: the ring shows around the icon"
        assert not ((arr == ring_index) & ~RING & (ic == TRANSPARENT)).any()


@pytest.mark.parametrize("asset_id", list(PICKUPS))
def test_pickup_icon_draws_its_own_ink_outline_and_keeps_ramps(asset_id: str) -> None:
    for local, arr in built(asset_id).items():
        ic = icon(arr)
        body = (ic != TRANSPARENT) & (ic != 0)
        assert not (body & near_clear(ic)).any(), local
        assert all(len(steps) <= 4 for steps in ramp_steps(arr, PALETTE).values()), local


@pytest.mark.parametrize("asset_id", list(FLATS))
def test_flat_placeholders_have_one_frame_under_the_final_id(asset_id: str) -> None:
    stem, cell, outline, colours = FLATS[asset_id]
    e = entry_of(asset_id)
    assert (e.technique, e.source, e.cell, e.states, e.dirs, e.frames, e.atlas, e.outline) == (
        "grid",
        f"assets-src/sprites/{stem}.sprite.txt",
        cell,
        ("flat",),
        ("-",),
        {"flat": 1},
        "items",
        outline,
    )
    arr = built(asset_id)["flat:-:0"]
    assert arr.shape == (cell[1], cell[0])
    assert colours <= set(np.unique(arr).tolist())
    if outline:
        body = (arr != TRANSPARENT) & (arr != 0)
        assert not (body & near_clear(arr)).any(), "outlined by the build"


def test_hydrant_is_lit_from_the_north_west() -> None:
    arr = built("prop.hydrant")["flat:-:0"]
    ys, xs = np.nonzero(arr == 17)
    sy, sx = np.nonzero(arr == 19)
    assert (xs + ys).mean() < (sx + sy).mean(), "17 lit rim NW, 19 shade SE (ART_BIBLE §6.1)"
    ys, xs = np.nonzero(arr != TRANSPARENT)
    assert xs.max() - xs.min() + 1 <= 18 and ys.max() - ys.min() + 1 <= 14, "about 1 m across at 16 px/m"


def test_site_footprints_match_their_tiles_at_16_px_per_metre() -> None:
    """2x3 and 2x1 tiles of 2 m (ENTITY_CATALOG §11, LEVEL_DESIGN §7.7) at 16 px/m."""
    assert entry_of("site.depot_bay").cell == (2 * 32, 3 * 32)
    assert entry_of("site.skip").cell == (2 * 32, 1 * 32)
    bay = built("site.depot_bay")["flat:-:0"]
    assert (bay[:, :2] != TRANSPARENT).all() and (bay[:, -2:] != TRANSPARENT).all(), "box lines on both sides"
    assert (bay[-1, 2:-2] == TRANSPARENT).all(), "open to the south, where Bessie drives in"
    assert (bay[30:, 4:-4] == TRANSPARENT).mean() > 0.8, "the ground shows through the markings"
    skip = built("site.skip")["flat:-:0"]
    ys, xs = np.nonzero(skip != TRANSPARENT)
    assert xs.max() - xs.min() + 1 >= 58, "a 3.7 m skip is about 59 px long"
