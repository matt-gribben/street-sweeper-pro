"""Tests for forge.manifest and the committed assets-src/manifest.json (ASSET_PIPELINE §6.1)."""

from __future__ import annotations

import copy
import json
from typing import Any

import pytest

from forge.manifest import (
    FIELDS,
    MANIFEST_PATH,
    ManifestError,
    entry_from_data,
    expand_dirs,
    load_manifest,
    manifest_from_data,
    unsorted_ids,
)

SWEEPER: dict[str, Any] = {
    "id": "veh.sweeper",
    "class": "veh",
    "technique": "blender",
    "source": "assets-src/rendered/veh.sweeper",
    "cell": [64, 64],
    "states": ["body", "dented"],
    "dirs": "h32",
    "frames": {"body": 1, "dented": 1},
    "atlas": "actors",
    "outline": True,
    "swaps": [],
}


def test_committed_manifest_is_valid_sorted_and_has_the_m0_entries() -> None:
    entries = load_manifest()
    ids = [e.id for e in entries]
    assert ids == sorted(ids), "manifest entries must be sorted by id"
    assert unsorted_ids(entries) == []
    assert ids == [
        "facade.corner_shop",
        "facade.depot_shed",
        "facade.flats_render",
        "facade.parade_brick",
        "facade.terrace_brick",
        "facade.terrace_brick_bay",
        "font.kerbside5x7",
        "haz.speed_bump",
        "litter.banana_skin",
        "npc.old_woman",
        "prop.lamp_post",
        "roof.depot",
        "roof.felt",
        "roof.slate",
        "tile.apron",
        "tile.asphalt",
        "tile.double_yellow",
        "tile.grass",
        "tile.kerb",
        "tile.lane_marking",
        "tile.parking_bay",
        "tile.pavement",
        "tile.setts",
        "tile.zebra",
        "veh.sweeper",
        "veh.sweeper_brush",
    ]
    raw = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    by_id = {a["id"]: a for a in raw["assets"]}
    assert by_id["litter.banana_skin"] == {
        "id": "litter.banana_skin",
        "class": "litter",
        "technique": "ai-ingest",
        "source": "assets-src/sprites/litter/banana_skin.sprite.txt",
        "cell": [16, 16],
        "states": ["idle"],
        "dirs": ["h00"],
        "frames": {"idle": 1},
        "atlas": "items",
        "outline": False,
        "swaps": [],
    }
    assert by_id["npc.old_woman"] == {
        "id": "npc.old_woman",
        "class": "npc",
        "technique": "ai-ingest",
        "source": "assets-src/sprites/npc/old_woman.sprite.txt",
        "cell": [24, 24],
        "states": ["idle"],
        "dirs": ["s", "sw", "w", "nw", "n", "ne", "e", "se"],
        "frames": {"idle": 1},
        "atlas": "actors",
        "outline": False,
        "swaps": [],
    }
    assert by_id["prop.lamp_post"] == {
        "id": "prop.lamp_post",
        "class": "prop",
        "technique": "blender",
        "source": "assets-src/rendered/prop.lamp_post",
        "cell": [32, 32],
        "states": ["slice"],
        "dirs": "-",
        "frames": {"slice": 4},
        "atlas": "items",
        "outline": True,
        "swaps": [],
    }
    assert by_id["veh.sweeper"] == SWEEPER
    assert by_id["veh.sweeper_brush"] == {
        "id": "veh.sweeper_brush",
        "class": "veh",
        "technique": "blender",
        "source": "assets-src/rendered/veh.sweeper_brush",
        "cell": [96, 96],
        "states": ["brush"],
        "dirs": "h32",
        "frames": {"brush": 4},
        "atlas": "actors",
        "outline": True,
        "swaps": [],
    }
    assert sum(len(e.frame_ids()) for e in entries) == 517  # 205 M0 frames + 27 SSP-041 facade and roof frames + 85 SSP-040 ground tiles + 200 SSP-068 font frames
    for e in raw["assets"]:
        assert list(e) == list(FIELDS), "fields in the documented order"
        assert not e["id"].startswith(("concept.", "_probe")), "_probe and concept.* are never in the manifest"


def test_frame_ids_expand_states_dirs_and_frames() -> None:
    e = entry_from_data(SWEEPER)
    fids = e.frame_ids()
    assert len(fids) == 64
    assert fids == sorted(fids)
    assert "veh.sweeper:body:h07:0" in fids and "veh.sweeper:dented:h31:0" in fids
    assert e.local_frame_ids()[0] == "body:h00:0"
    brush = entry_from_data({**SWEEPER, "id": "veh.sweeper_brush", "states": ["brush"], "frames": {"brush": 4}})
    assert len(brush.frame_ids()) == 128 and "veh.sweeper_brush:brush:h07:2" in brush.frame_ids()


def test_expand_dirs() -> None:
    assert expand_dirs("h32") == tuple(f"h{i:02d}" for i in range(32))
    assert expand_dirs("h4") == ("h00", "h01", "h02", "h03")
    assert expand_dirs("-") == ("-",)
    assert expand_dirs(["s", "sw", "w"]) == ("s", "sw", "w")
    assert expand_dirs(["h00"]) == ("h00",)
    assert expand_dirs(["h00", "h08", "h16", "h24"]) == ("h00", "h08", "h16", "h24")
    for bad in ("h8", [], ["x"], ["s", "s"], 3, ["h32"], ["h08", "h00"], ["h00", "h00"], ["h00", "s"], ["h7"]):
        with pytest.raises(ManifestError):
            expand_dirs(bad)


def _mutate(**changes: Any) -> dict[str, Any]:
    d = copy.deepcopy(SWEEPER)
    for k, v in changes.items():
        if v is KeyError:
            del d[k]
        else:
            d[k] = v
    return d


@pytest.mark.parametrize(
    ("data", "match"),
    [
        (_mutate(swaps=KeyError), "fields must be exactly"),
        ({**SWEEPER, "extra": 1}, "fields must be exactly"),
        (_mutate(id="Veh.Sweeper"), "id must be"),
        (_mutate(**{"class": "npc"}), "does not match the id prefix"),
        (_mutate(id="car.sweeper", **{"class": "car"}), "unknown asset class"),
        (_mutate(technique="photoshop"), "technique must be"),
        (_mutate(source="/abs/path"), "repo-relative"),
        (_mutate(source="../x"), "repo-relative"),
        (_mutate(cell=[64]), "cell must be"),
        (_mutate(cell=[0, 64]), "cell must be"),
        (_mutate(cell=[True, 64]), "cell must be"),
        (_mutate(states=[]), "non-empty list"),
        (_mutate(states=["body", "body"]), "duplicate"),
        (_mutate(dirs="h16"), "expected"),
        (_mutate(frames={"body": 1}), "keys must be exactly"),
        (_mutate(frames={"body": 0, "dented": 1}), "positive integer"),
        (_mutate(atlas="cars"), "atlas must be"),
        (_mutate(outline="yes"), "outline must be"),
        (_mutate(swaps="none"), "list of strings"),
    ],
)
def test_entry_validation_errors(data: dict[str, Any], match: str) -> None:
    with pytest.raises(ManifestError, match=match):
        entry_from_data(data)


def test_manifest_level_validation() -> None:
    with pytest.raises(ManifestError, match="top level"):
        manifest_from_data({"assets": {}})
    with pytest.raises(ManifestError, match="duplicate id"):
        manifest_from_data({"assets": [SWEEPER, SWEEPER]})
    later = {**SWEEPER, "id": "veh.aardvark"}
    entries = manifest_from_data({"assets": [SWEEPER, later]})
    assert unsorted_ids(entries) == ["veh.sweeper"]
