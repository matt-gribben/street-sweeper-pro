"""Tests for forge.manifest and the committed assets-src/manifest.json (ASSET_PIPELINE §6.1)."""

from __future__ import annotations

import copy
import json
from typing import Any

import pytest

from forge.manifest import (
    FIELDS,
    MANIFEST_PATH,
    OPTIONAL_FIELDS,
    ROTATION_SPEC,
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


LITTER_IDS = [
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
"""The 15 litter IDs of ENTITY_CATALOG §4.1, sorted (SSP-051)."""


def test_committed_manifest_is_valid_sorted_and_has_the_m0_entries() -> None:
    entries = load_manifest()
    ids = [e.id for e in entries]
    assert ids == sorted(ids), "manifest entries must be sorted by id"
    assert unsorted_ids(entries) == []
    assert ids == [
        "collect.false_teeth",
        "collect.golden_crisp",
        "collect.lost_wallet",
        "facade.corner_shop",
        "facade.depot_shed",
        "facade.flats_render",
        "facade.parade_brick",
        "facade.terrace_brick",
        "facade.terrace_brick_bay",
        "font.kerbside5x7",
        "haz.broken_glass",
        "haz.oil_slick",
        "haz.open_manhole",
        "haz.pothole",
        "haz.puddle",
        "haz.speed_bump",
        "haz.wet_leaves",
        *LITTER_IDS,
        "npc.businessman",
        "npc.cat",
        "npc.dog_loose",
        "npc.dog_walker",
        "npc.litterbug",
        "npc.market_trader",
        "npc.mum_pushchair",
        "npc.old_man_frame",
        "npc.old_woman",
        "npc.pigeon",
        "npc.postie",
        "npc.shopper",
        "prop.a_board",
        "prop.bench",
        "prop.bollard",
        "prop.bus_shelter",
        "prop.hydrant",
        "prop.lamp_post",
        "prop.litter_bin",
        "prop.market_stall",
        "prop.phone_box",
        "prop.planter",
        "prop.post_box",
        "prop.recycling_box",
        "prop.roadworks_barrier",
        "prop.shopping_trolley",
        "prop.traffic_cone",
        "prop.tree",
        "prop.wheelie_bin",
        "pwr.bacon_butty",
        "pwr.flask_of_tea",
        "pwr.hi_vis",
        "pwr.super_suction",
        "pwr.water_can",
        "pwr.wrench",
        "roof.depot",
        "roof.felt",
        "roof.slate",
        "site.depot_bay",
        "site.skip",
        "stain.chalk_art",
        "stain.gum",
        "stain.milkshake",
        "stain.oil",
        "stain.splat",
        "tile.apron",
        "tile.asphalt",
        "tile.cobbles",
        "tile.double_yellow",
        "tile.grass",
        "tile.grime_asphalt",
        "tile.grime_gutter",
        "tile.grime_slab",
        "tile.kerb",
        "tile.lane_marking",
        "tile.parking_bay",
        "tile.pavement",
        "tile.setts",
        "tile.zebra",
        "ui.bar_fill",
        "ui.brush_meter",
        "ui.brush_needle",
        "ui.brush_state",
        "ui.dump_ring",
        "ui.offscreen_arrow",
        "ui.panel_council",
        "ui.panel_dark",
        "ui.panel_paper",
        "ui.powerup_icon",
        "veh.bicycle",
        "veh.bus",
        "veh.hatchback",
        "veh.hatchback_parked",
        "veh.mobility_scooter",
        "veh.saloon",
        "veh.saloon_parked",
        "veh.sweeper",
        "veh.sweeper_brush",
        "veh.taxi",
        "veh.taxi_parked",
        "veh.van_white",
        "veh.van_white_parked",
    ]
    raw = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    by_id = {a["id"]: a for a in raw["assets"]}
    for lid in LITTER_IDS:
        name = lid.removeprefix("litter.")
        # SSP-051 placeholders are hand-authored grids; the banana skin keeps its SSP-024 ingest provenance.
        assert by_id[lid] == {
            "id": lid,
            "class": "litter",
            "technique": "ai-ingest" if name == "banana_skin" else "grid",
            "source": f"assets-src/sprites/litter/{name}.sprite.txt",
            "cell": [16, 16],
            "states": ["idle", "wobble"],
            "dirs": "rot4",
            "frames": {"idle": 1, "wobble": 2},
            "atlas": "items",
            "outline": False,
            "swaps": [],
        }
    for name in (
        "businessman",
        "dog_walker",
        "litterbug",
        "market_trader",
        "mum_pushchair",
        "old_man_frame",
        "old_woman",
        "postie",
        "shopper",
    ):
        # SSP-097 and SSP-098 placeholders; Doris keeps her SSP-014 ingest provenance (origin: ref.people_style).
        assert by_id[f"npc.{name}"] == {
            "id": f"npc.{name}",
            "class": "npc",
            "technique": "ai-ingest" if name == "old_woman" else "grid",
            "source": f"assets-src/sprites/npc/{name}.sprite.txt",
            "cell": [24, 24],
            "states": ["walk", "idle", "startle", "fall", "angry"],
            "dirs": ["s", "sw", "w", "nw", "n", "ne", "e", "se"],
            "frames": {"walk": 4, "idle": 2, "startle": 2, "fall": 3, "angry": 2},
            "atlas": "actors",
            "outline": False,
            "swaps": [],
            "placeholder": True,
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
    # 205 M0 frames + 27 SSP-041 facade and roof frames + 85 SSP-040 ground tiles, then SSP-051: the banana
    # skin's 1 frame becomes 12 and 14 more litter IDs add 12 each (180 litter frames in all); SSP-052 adds 12
    # stain variants, 12 grime overlay variants, 3 pickups x 2 bob frames and 3 flat placeholders (33 frames);
    # + 200 SSP-068 font frames + the 3 SSP-285 placeholder 9-slice panels + the SSP-070 HUD bar fill (1) and
    # dump ring (9) + the SSP-299 Brush-o-meter (3), needle (1), brush state (11) and off-screen arrows (16)
    # + SSP-101: 60 prop placeholder frames, 10 power-up bob frames, 11 hazard frames and 4 cobble tiles
    # + SSP-097: 616 frames for the six Monday people (104 each, replacing old_woman's 8 idle frames)
    # + SSP-098: 312 frames for the businessman, litterbug and market trader (104 each)
    # + SSP-099: 172 placeholder animal frames (cat 88, dog_loose 64, pigeon 20)
    # + SSP-100: 7 traffic vehicles x 32 headings (224 built frames) and 4 parked aliases x 32 (128 frame IDs on
    # their targets' rects, no frames of their own).
    # + SSP-105: the 2 bob frames of collect.lost_wallet.
    assert sum(len(e.frame_ids()) for e in entries if not e.is_alias) == 2190
    assert sum(len(e.frame_ids()) for e in entries if e.is_alias) == 128
    assert sum(len(e.frame_ids()) for e in entries if e.asset_class == "litter") == 180
    for e in raw["assets"]:
        assert list(e) == list(FIELDS) + [k for k in OPTIONAL_FIELDS if k in e], "fields in the documented order"
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


def test_rot4_litter_entry_expands_to_twelve_heading_frame_ids() -> None:
    litter = entry_from_data(
        {
            **SWEEPER,
            "id": "litter.pizza_box",
            "class": "litter",
            "technique": "grid",
            "source": "assets-src/sprites/litter/pizza_box.sprite.txt",
            "cell": [16, 16],
            "states": ["idle", "wobble"],
            "dirs": "rot4",
            "frames": {"idle": 1, "wobble": 2},
            "atlas": "items",
            "outline": False,
        }
    )
    assert litter.rotated and litter.dirs_spec == "rot4"
    assert litter.dirs == ("h00", "h08", "h16", "h24")
    fids = litter.frame_ids()
    assert len(fids) == 12 and "litter.pizza_box:wobble:h08:1" in fids  # ENTITY_CATALOG §1.3's example
    assert not entry_from_data(SWEEPER).rotated
    assert not entry_from_data({**SWEEPER, "dirs": ["h00", "h08", "h16", "h24"]}).rotated  # a list is all authored


def test_expand_dirs() -> None:
    assert expand_dirs("h32") == tuple(f"h{i:02d}" for i in range(32))
    assert expand_dirs("h4") == ("h00", "h01", "h02", "h03")
    assert expand_dirs("-") == ("-",)
    assert expand_dirs(["s", "sw", "w"]) == ("s", "sw", "w")
    assert expand_dirs(["h00"]) == ("h00",)
    assert expand_dirs(["h00", "h08", "h16", "h24"]) == ("h00", "h08", "h16", "h24")
    assert expand_dirs(ROTATION_SPEC) == ("h00", "h08", "h16", "h24")
    for bad in ("h8", "rot", "rot8", [], ["x"], ["s", "s"], 3, ["h32"], ["h08", "h00"], ["h00", "h00"], ["h00", "s"], ["h7"]):
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
        (_mutate(placeholder="yes"), "placeholder must be true or false"),
        (_mutate(placeholder=1), "placeholder must be true or false"),
    ],
)
def test_entry_validation_errors(data: dict[str, Any], match: str) -> None:
    with pytest.raises(ManifestError, match=match):
        entry_from_data(data)


def test_placeholder_is_an_optional_boolean() -> None:
    assert entry_from_data(SWEEPER).placeholder is False
    assert entry_from_data({**SWEEPER, "placeholder": True}).placeholder is True
    assert entry_from_data({**SWEEPER, "placeholder": False}).placeholder is False


def test_ssp285_panels_are_placeholders_in_the_ui_atlas() -> None:
    by_id = {e.id: e for e in load_manifest()}
    for name in ("council", "dark", "paper"):
        e = by_id[f"ui.panel_{name}"]
        assert e.placeholder is True
        assert (e.technique, e.atlas, e.cell, e.outline) == ("grid", "ui", (24, 24), False)
        assert e.frame_ids() == [f"ui.panel_{name}:panel:-:0"]


def test_manifest_level_validation() -> None:
    with pytest.raises(ManifestError, match="top level"):
        manifest_from_data({"assets": {}})
    with pytest.raises(ManifestError, match="duplicate id"):
        manifest_from_data({"assets": [SWEEPER, SWEEPER]})
    later = {**SWEEPER, "id": "veh.aardvark"}
    entries = manifest_from_data({"assets": [SWEEPER, later]})
    assert unsorted_ids(entries) == ["veh.sweeper"]
