"""Size-sheet checks over the committed human grids (SSP-098; ART_BIBLE §7.1-7.2, §8.3, §10.2).

forge lint does not check figure bounds, so this does, for every 24x24 ``npc.*`` grid in the manifest: each
built frame fits 18x22 px including its ink outline, the feet sit on the pivot row 22 (the startle hop,
frame 0, may lift them to row 21), row 23 stays clear, and SE/E/NE are exact left-right flips of SW/W/NW.
The placeholder people (``placeholder: true``) must also carry the full 13-frames-per-direction set under
the final frame IDs, so M4 can swap the art without code changes.
"""

from __future__ import annotations

import numpy as np
import pytest

from forge.build import build_asset
from forge.manifest import load_manifest
from forge.palette import TRANSPARENT

PEOPLE = [e for e in load_manifest() if e.asset_class == "npc" and tuple(e.cell) == (24, 24)]
FULL_SET = {"walk": 4, "idle": 2, "startle": 2, "fall": 3, "angry": 2}
DIRS = ["s", "sw", "w", "nw", "n", "ne", "e", "se"]
TUESDAY = ("npc.businessman", "npc.litterbug", "npc.market_trader")


def _frames(entry_id: str) -> dict[str, np.ndarray]:
    entry = next(e for e in PEOPLE if e.id == entry_id)
    return {f.frame_id: f.indices for f in build_asset(entry).frames}


def test_the_tuesday_cast_is_in_the_manifest_as_placeholders() -> None:
    by_id = {e.id: e for e in PEOPLE}
    for aid in TUESDAY:
        entry = by_id[aid]
        assert entry.technique == "grid" and entry.placeholder, aid
        assert entry.atlas == "actors" and not entry.outline, aid


@pytest.mark.parametrize("entry_id", [e.id for e in PEOPLE])
def test_people_fit_the_size_sheet_with_feet_on_the_pivot_row(entry_id: str) -> None:
    frames = _frames(entry_id)
    for fid, idx in frames.items():
        ys, xs = np.nonzero(idx != TRANSPARENT)
        w, h = int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)
        assert w <= 18 and h <= 22, f"{fid}: {w}x{h}"
        hop = fid.split(":")[1] == "startle" and fid.endswith(":0")
        assert int(ys.max()) in ((21, 22) if hop else (22,)), f"{fid}: feet on row {ys.max()}"


@pytest.mark.parametrize("entry_id", [e.id for e in PEOPLE])
def test_people_mirror_se_e_ne_from_sw_w_nw(entry_id: str) -> None:
    frames = _frames(entry_id)
    for fid, idx in frames.items():
        _, state, d, n = fid.split(":")
        src = {"se": "sw", "e": "w", "ne": "nw"}.get(d)
        if src is not None:
            np.testing.assert_array_equal(idx, frames[f"{entry_id}:{state}:{src}:{n}"][:, ::-1], err_msg=fid)


@pytest.mark.parametrize("entry_id", TUESDAY)
def test_placeholder_people_have_all_104_frame_ids(entry_id: str) -> None:
    expected = {f"{entry_id}:{s}:{d}:{n}" for s, count in FULL_SET.items() for d in DIRS for n in range(count)}
    assert set(_frames(entry_id)) == expected
    assert len(expected) == 104
