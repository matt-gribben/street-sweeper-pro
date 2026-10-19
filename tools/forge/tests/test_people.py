"""Acceptance checks over the committed Monday people grids (SSP-097; ART_BIBLE §5.6, §7.1-7.3, §8.3).

Six ``npc.*`` placeholder grids, 24x24, with walk 4, idle 2, startle 2, fall 3 and angry 2 per
direction (S, SW, W, NW, N authored, SE/E/NE mirrored): 65 authored frames and 104 built ones each.
``forge lint`` does not check figure bounds, so these tests pin what it leaves out: every figure
fits 18x22 with its lowest pixel on the pivot row 22 and row 23 clear, the grid draws its own
complete ink outline, the shopper's garments stay in the swap keys, and Doris keeps her ingested
idle frames.
"""

from __future__ import annotations

import hashlib

import numpy as np
import pytest

from forge.build import build_asset
from forge.manifest import load_manifest
from forge.outline import add_outline, outline_gaps
from forge.palette import REPO_ROOT, TRANSPARENT, load_palette
from forge.sprite import SpriteGrid, read_sprite, render_frames

PALETTE = load_palette()
MONDAY = ["npc.dog_walker", "npc.mum_pushchair", "npc.old_man_frame", "npc.old_woman", "npc.postie", "npc.shopper"]
ENTRIES = {e.id: e for e in load_manifest() if e.id in MONDAY}
STATES = {"walk": 4, "idle": 2, "startle": 2, "fall": 3, "angry": 2}
AUTHORED = ["s", "sw", "w", "nw", "n"]
ALL_DIRS = ["s", "sw", "w", "nw", "n", "ne", "e", "se"]


def grid(asset_id: str) -> SpriteGrid:
    return read_sprite(REPO_ROOT / ENTRIES[asset_id].source)


def bbox(frame: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(frame != TRANSPARENT)
    return int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())


def test_six_placeholder_entries_with_the_13_frame_set() -> None:
    assert sorted(ENTRIES) == MONDAY
    for asset_id, e in ENTRIES.items():
        assert e.source == f"assets-src/sprites/npc/{asset_id.removeprefix('npc.')}.sprite.txt"
        assert (e.cell, e.atlas, e.outline, e.placeholder) == ((24, 24), "actors", False, True), asset_id
        assert e.technique == ("ai-ingest" if asset_id == "npc.old_woman" else "grid"), asset_id
        assert dict(e.frames) == STATES, asset_id


@pytest.mark.parametrize("asset_id", MONDAY)
def test_65_authored_frames_and_three_mirrors(asset_id: str) -> None:
    g = grid(asset_id)
    expected = {f"{s}:{d}:{n}" for s, c in STATES.items() for d in AUTHORED for n in range(c)}
    assert set(g.frames) == expected
    assert sorted(g.mirrors) == [("e", "w"), ("ne", "nw"), ("se", "sw")]
    built = build_asset(ENTRIES[asset_id], REPO_ROOT, PALETTE).frames
    assert len(built) == 104
    assert {f.frame_id for f in built} == {
        f"{asset_id}:{s}:{d}:{n}" for s, c in STATES.items() for d in ALL_DIRS for n in range(c)
    }


@pytest.mark.parametrize("asset_id", MONDAY)
def test_every_figure_fits_18x22_with_the_feet_on_row_22(asset_id: str) -> None:
    for fid, f in render_frames(grid(asset_id)).items():
        x0, x1, y0, y1 = bbox(f)
        assert x1 - x0 + 1 <= 18, f"{asset_id}:{fid} is {x1 - x0 + 1} px wide"
        assert y1 - y0 + 1 <= 22, f"{asset_id}:{fid} is {y1 - y0 + 1} px tall"
        assert y1 == 22, f"{asset_id}:{fid}: lowest pixel on row {y1}, not the pivot row 22"
        assert not (f[23] != TRANSPARENT).any(), f"{asset_id}:{fid}: row 23 must stay clear"


@pytest.mark.parametrize("asset_id", MONDAY)
def test_grid_draws_its_own_complete_outline(asset_id: str) -> None:
    for fid, f in grid(asset_id).frames.items():
        assert not outline_gaps(f).any(), f"{asset_id}:{fid} has a body pixel next to transparency"
        np.testing.assert_array_equal(add_outline(f), f, err_msg=f"{asset_id}:{fid}")


@pytest.mark.parametrize("asset_id", MONDAY)
def test_reaction_silhouettes(asset_id: str) -> None:
    """ART_BIBLE §8.3: arms up in startle, a fist above the head in angry, fall lies flat.

    Adults already fill 22 rows standing, so startle 0 is a 1 px flinch and startle 1 rises
    back to full height with the arms up (tools/forge/scripts/people_placeholders.py).
    """
    frames = grid(asset_id).frames
    for d in AUTHORED:
        idle = frames[f"idle:{d}:0"]
        idle_top = bbox(idle)[2]
        assert bbox(frames[f"startle:{d}:0"])[2] <= idle_top + 1, f"startle:{d}:0"
        assert bbox(frames[f"startle:{d}:1"])[2] <= idle_top, f"startle:{d}:1"
        def top_span(f: np.ndarray) -> int:
            top = bbox(f)[2]
            xs = np.nonzero((f[top : top + 4] != TRANSPARENT).any(axis=0))[0]
            return int(xs.max() - xs.min() + 1)

        # arms up beside the head: the top of the silhouette is wider than the idle head
        assert top_span(frames[f"startle:{d}:1"]) > top_span(idle), f"startle:{d}:1 has no raised arms"
        for n in range(2):
            assert bbox(frames[f"angry:{d}:{n}"])[2] <= idle_top, f"angry:{d}:{n}"
        for n in (1, 2):
            x0, x1, y0, y1 = bbox(frames[f"fall:{d}:{n}"])
            assert x1 - x0 > y1 - y0, f"fall:{d}:{n} is not lying down"


def test_elderly_are_18_to_19_px_and_adults_22_px_standing() -> None:
    for asset_id in MONDAY:
        _, _, y0, y1 = bbox(grid(asset_id).frames["walk:s:0"])
        height = y1 - y0 + 1
        if asset_id in ("npc.old_woman", "npc.old_man_frame"):
            assert 18 <= height <= 19, (asset_id, height)
        else:
            assert height == 22, (asset_id, height)


def test_shopper_garments_use_only_the_swap_keys() -> None:
    """ART_BIBLE §5.6: primary 21/22/23, secondary 14/15/16 (<= 4 px of 15), skin 12/11."""
    allowed = {0, 1, 8, 11, 12, 14, 15, 16, 21, 22, 23}  # + ink, shoes 01, hair 08
    for fid, f in grid("npc.shopper").frames.items():
        used = set(np.unique(f[f != TRANSPARENT]).tolist())
        assert used <= allowed, f"{fid} uses {sorted(used - allowed)}"
        assert int((f == 15).sum()) <= 4, fid
        assert not used & {26, 30}, fid


def test_unique_characters_wear_their_colour_keys() -> None:
    """ART_BIBLE §7.3 colour keys appear in the walk frames."""
    keys = {
        "npc.old_woman": {30, 31, 19, 18, 25, 6},
        "npc.old_man_frame": {13, 3, 5, 6, 9},
        "npc.postie": {18, 19, 17},
        "npc.mum_pushchair": {20, 25, 3},
        "npc.dog_walker": {22},
    }
    for asset_id, want in keys.items():
        used = set(np.unique(grid(asset_id).frames["walk:s:0"]).tolist())
        assert want <= used, f"{asset_id} lacks {sorted(want - used)}"


def test_doris_keeps_her_ingested_idle_frames_and_provenance() -> None:
    g = grid("npc.old_woman")
    assert g.origin == "ai/ref.people_style#cell=0,4,5,6,7"
    assert g.ingest_sha256 == "a89918566125847d0f83cb24b82e2381df340cc28f2fb796048364d38a7a4938"
    # The spike frames (SSP-014, D-13) feed the lean_quadrants and scale_sheet goldens: pin a hash.
    spike = b"".join(g.frames[f"idle:{d}:0"].astype("<i2").tobytes() for d in AUTHORED)
    assert hashlib.sha256(spike).hexdigest() == SPIKE_IDLE_SHA256


SPIKE_IDLE_SHA256 = "1d75aab7e3a529aefd08b9cacea43f81afa21852e7b76f6b379a0beb442892b5"
"""The five ``idle:<dir>:0`` frames as committed by SSP-014 (little-endian int16, S SW W NW N)."""
