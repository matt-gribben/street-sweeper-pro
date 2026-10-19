"""Acceptance checks over the committed litter grids (SSP-051; ENTITY_CATALOG §4, ART_BIBLE §7.1, §8.4).

The 15 ``litter.*`` IDs each have a hand-authored (or, for the banana skin, ingested and hand-repaired)
16x16 grid with ``idle:h00:0`` and ``wobble:h00:0..1``; the build turns each into 12 frames. These
tests pin what the grids must satisfy beyond what ``forge lint`` checks: a complete ink outline drawn
by the grid itself (``outline: false``), the 8-14 px visible body and the documented relative sizes,
wobble frames that move the item without changing its outline by more than 2 px, and the
sweeper_yellow reservation.
"""

from __future__ import annotations

import numpy as np
import pytest

from forge.build import build_asset
from forge.lint import rotation_shading_problems
from forge.manifest import load_manifest
from forge.outline import add_outline, outline_gaps
from forge.palette import REPO_ROOT, TRANSPARENT, load_palette
from forge.sprite import read_sprite

PALETTE = load_palette()
ENTRIES = {e.id: e for e in load_manifest() if e.asset_class == "litter"}
LITTER_IDS = sorted(ENTRIES)
SWEEPER_YELLOW = 15


def authored(asset_id: str) -> dict[str, np.ndarray]:
    return read_sprite(REPO_ROOT / ENTRIES[asset_id].source).frames


def extent(frame: np.ndarray) -> tuple[int, int]:
    ys, xs = np.nonzero(frame != TRANSPARENT)
    return int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)


def test_all_fifteen_litter_ids_have_a_grid_and_an_entry() -> None:
    assert LITTER_IDS == [
        "litter.banana_skin",
        "litter.bin_bag",
        "litter.chip_wrapper",
        "litter.cigarette_butts",
        "litter.crisp_packet",
        "litter.dog_mess",
        "litter.drink_can",
        "litter.glass_bottle",
        "litter.kebab_wrapper",
        "litter.leaf_pile",
        "litter.lolly_stick",
        "litter.newspaper",
        "litter.pizza_box",
        "litter.plastic_bottle",
        "litter.spilled_shopping",
    ]
    for lid, e in ENTRIES.items():
        assert e.source == f"assets-src/sprites/litter/{lid.removeprefix('litter.')}.sprite.txt"
        assert (e.cell, e.dirs_spec, e.atlas, e.outline) == ((16, 16), "rot4", "items", False)
        assert sorted(authored(lid)) == ["idle:h00:0", "wobble:h00:0", "wobble:h00:1"], lid


@pytest.mark.parametrize("lid", LITTER_IDS)
def test_grid_draws_its_own_complete_outline(lid: str) -> None:
    for fid, frame in authored(lid).items():
        assert not outline_gaps(frame).any(), f"{lid}:{fid} has a body pixel next to transparency"
        np.testing.assert_array_equal(add_outline(frame), frame, err_msg=f"{lid}:{fid}")


@pytest.mark.parametrize("lid", LITTER_IDS)
def test_visible_body_is_8_to_14_px(lid: str) -> None:
    for fid, frame in authored(lid).items():
        assert 8 <= max(extent(frame)) <= 14, f"{lid}:{fid} is {extent(frame)}"


def test_relative_sizes_pizza_box_over_crisp_packet_over_lolly_stick() -> None:
    size = {lid: max(extent(authored(lid)["idle:h00:0"])) for lid in LITTER_IDS}
    assert 13 <= size["litter.pizza_box"] <= 14
    assert 9 <= size["litter.crisp_packet"] <= 10
    assert size["litter.lolly_stick"] == 8
    assert size["litter.pizza_box"] == max(size.values()), "nothing is bigger than the pizza box"


def _hausdorff_px(a: np.ndarray, b: np.ndarray) -> int:
    """Largest Chebyshev distance from an opaque pixel of one frame to the nearest of the other."""
    pa = np.argwhere(a != TRANSPARENT)
    pb = np.argwhere(b != TRANSPARENT)
    d = np.abs(pa[:, None, :] - pb[None, :, :]).max(axis=2)
    return int(max(d.min(axis=1).max(), d.min(axis=0).max()))


@pytest.mark.parametrize("lid", LITTER_IDS)
def test_wobble_moves_the_item_without_changing_its_outline_by_more_than_2_px(lid: str) -> None:
    frames = authored(lid)
    idle = frames["idle:h00:0"]
    for n in (0, 1):
        wobble = frames[f"wobble:h00:{n}"]
        assert not np.array_equal(wobble, idle), f"{lid} wobble {n} is the idle frame"
        assert 1 <= _hausdorff_px(idle, wobble) <= 2, lid
    assert not np.array_equal(frames["wobble:h00:0"], frames["wobble:h00:1"])


@pytest.mark.parametrize("lid", LITTER_IDS)
def test_every_built_frame_is_rotation_symmetric_and_in_palette(lid: str) -> None:
    built = build_asset(ENTRIES[lid], REPO_ROOT, PALETTE).frames
    assert len(built) == 12
    for f in built:
        assert int(f.indices.min()) >= TRANSPARENT and int(f.indices.max()) < 32
        assert rotation_shading_problems(f.indices, PALETTE) == [], f.frame_id


def test_sweeper_yellow_is_kept_off_litter_except_the_banana_skin() -> None:
    # ART_BIBLE §5.3 reserves 15 for Bessie; §8.4 documents the banana skin as a 16/15 star.
    for lid in LITTER_IDS:
        uses = any((frame == SWEEPER_YELLOW).any() for frame in authored(lid).values())
        assert uses == (lid == "litter.banana_skin"), lid
