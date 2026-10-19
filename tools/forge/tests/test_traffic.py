"""SSP-100: the M3 placeholder traffic renders and the parked-car alias entries (ASSET_PIPELINE §7.5).

- ``technique: "alias"`` manifest entries: validation against their target (:func:`alias_problems`),
  :func:`forge.pack.add_aliases`, the build (no frames of their own, the target's rects in the atlas
  JSON and ``src/gen/assets.ts``), lint and sheets;
- the committed manifest, renders and generated outputs of the seven vehicles and four aliases.
"""

from __future__ import annotations

import ast
import json
import re
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from test_build import add_toy_renders, blender_entry, make_repo

from forge.blender import CLASS_DIRS, expected_frames, find_script, load_asset, parse_cell_px, parse_states
from forge.build import BuildError, build, build_asset
from forge.lint import lint
from forge.manifest import (
    ALIAS_MIRRORED_FIELDS,
    TECHNIQUES,
    ManifestError,
    alias_problems,
    entry_from_data,
    load_manifest,
    manifest_from_data,
)
from forge.outputs import ASSETS_TS
from forge.pack import Atlas, AtlasFrame, PackError, add_aliases
from forge.palette import REPO_ROOT, TRANSPARENT
from forge.sheets import write_sheets

TRAFFIC = {
    "veh.bicycle": 32,
    "veh.bus": 128,
    "veh.hatchback": 64,
    "veh.mobility_scooter": 32,
    "veh.saloon": 64,
    "veh.taxi": 64,
    "veh.van_white": 96,
}
"""The seven M3 traffic vehicles and their square cells (ENTITY_CATALOG §8.1; the van at 96, SSP-100)."""

VISIBLE_BODY = {
    "veh.bicycle": (8, 26),
    "veh.bus": (38, 116),
    "veh.hatchback": (26, 46),
    "veh.mobility_scooter": (14, 22),
    "veh.saloon": (28, 54),
    "veh.taxi": (28, 54),
    "veh.van_white": (30, 60),
}
"""Visible body w x h in px at h00, without the forge outline (ART_BIBLE §7.1)."""

PARKED = {f"veh.{n}_parked": f"veh.{n}" for n in ("hatchback", "saloon", "taxi", "van_white")}

PAINT_KEY = (21, 22, 23)
"""The hatchback and saloon paint key (ART_BIBLE §5.6)."""
PAINT_FORBIDDEN = (14, 15, 16, 17, 26, 30, 12, 11)
"""Indices the car paint family must not use (the other swap families' keys, ART_BIBLE §5.6)."""

HEX_RE = re.compile(r"#[0-9a-fA-F]{6}\b|0x[0-9a-fA-F]{6}\b")


def alias_entry(alias_id: str = "veh.toy_parked", target: str = "veh.toy", **over: Any) -> dict[str, Any]:
    """An alias of :func:`test_build.blender_entry` (same frame layout)."""
    e = blender_entry(alias_id, technique="alias", source=target)
    e.update(over)
    return e


# ---------------------------------------------------------------------------------------------
# Manifest validation


def test_alias_is_a_technique_with_an_asset_id_source() -> None:
    assert "alias" in TECHNIQUES
    e = entry_from_data(alias_entry())
    assert e.is_alias and e.source == "veh.toy"
    assert e.frame_ids()[0] == "veh.toy_parked:body:h00:0"
    assert e.target_frame_id("veh.toy_parked:dented:h03:0") == "veh.toy:dented:h03:0"
    assert not entry_from_data(blender_entry()).is_alias
    with pytest.raises(ValueError, match="not a frame"):
        e.target_frame_id("veh.toy:body:h00:0")


@pytest.mark.parametrize("source", ["assets-src/rendered/veh.toy", "veh.toy_parked", "Veh.Toy", ""])
def test_alias_source_must_be_another_asset_id(source: str) -> None:
    with pytest.raises(ManifestError, match="alias entry's source"):
        entry_from_data(alias_entry(source=source))


def test_sound_alias_passes() -> None:
    entries = manifest_from_data({"assets": [blender_entry(), alias_entry()]})
    assert alias_problems(entries) == []


@pytest.mark.parametrize(
    ("over", "match"),
    [
        ({"cell": [16, 16]}, "cell"),
        ({"states": ["body"], "frames": {"body": 1}}, "states"),
        ({"dirs": "h32"}, "dirs"),
        ({"frames": {"body": 1, "dented": 2}}, "frames"),
        ({"atlas": "items"}, "atlas"),
        ({"outline": False}, "outline"),
        ({"swaps": ["paint_red"]}, "swaps"),
        ({"placeholder": True}, "placeholder"),
    ],
)
def test_alias_must_mirror_its_target(over: dict[str, Any], match: str) -> None:
    entries = [entry_from_data(blender_entry()), entry_from_data(alias_entry(**over))]
    problems = alias_problems(entries)
    assert len(problems) >= 1 and problems[0][0] == "veh.toy_parked"
    assert any(match in msg for _, msg in problems)
    with pytest.raises(ManifestError, match=f"veh.toy_parked: {match}"):
        manifest_from_data({"assets": [blender_entry(), alias_entry(**over)]})


def test_alias_class_must_match_its_target() -> None:
    target = blender_entry("prop.toy")
    problems = alias_problems([entry_from_data(target), entry_from_data(alias_entry(target="prop.toy"))])
    assert any("class 'veh' differs" in msg for _, msg in problems)
    assert "class" in ALIAS_MIRRORED_FIELDS


def test_alias_target_must_exist_and_not_be_an_alias() -> None:
    assert alias_problems([entry_from_data(alias_entry())]) == [
        ("veh.toy_parked", "alias target 'veh.toy' is not a manifest entry")
    ]
    chain = [
        entry_from_data(blender_entry()),
        entry_from_data(alias_entry()),
        entry_from_data(alias_entry("veh.toy_twice", "veh.toy_parked")),
    ]
    assert [aid for aid, _ in alias_problems(chain)] == ["veh.toy_twice"]


# ---------------------------------------------------------------------------------------------
# Packing


def _atlas(frames: list[AtlasFrame]) -> Atlas:
    ordered = tuple(sorted(frames, key=lambda f: f.frame_id))
    return Atlas("actors", 16, 16, ordered, np.full((16, 16), TRANSPARENT, np.int16))


def test_add_aliases_twins_every_target_frame_on_its_rect() -> None:
    a = _atlas(
        [
            AtlasFrame("veh.toy:body:h00:0", "veh.toy", 1, 2, 8, 8, 4, 4),
            AtlasFrame("npc.x:idle:s:0", "npc.x", 9, 0, 4, 4, 2, 3),
        ]
    )
    (out,) = add_aliases([a], {"veh.toy_parked": "veh.toy"})
    assert [f.frame_id for f in out.frames] == ["npc.x:idle:s:0", "veh.toy:body:h00:0", "veh.toy_parked:body:h00:0"]
    twin = out.frames[2]
    assert (twin.asset_id, twin.x, twin.y, twin.w, twin.h, twin.px, twin.py) == ("veh.toy_parked", 1, 2, 8, 8, 4, 4)
    assert out.indices is a.indices and (out.width, out.height) == (a.width, a.height)
    assert add_aliases([a], {}) == [a]


def test_add_aliases_rejects_a_target_without_frames() -> None:
    a = _atlas([AtlasFrame("npc.x:idle:s:0", "npc.x", 0, 0, 4, 4, 2, 3)])
    with pytest.raises(PackError, match="veh.toy_parked -> veh.toy"):
        add_aliases([a], {"veh.toy_parked": "veh.toy"})


# ---------------------------------------------------------------------------------------------
# Build, lint and sheets on a synthetic repo


@pytest.fixture
def alias_repo(tmp_path: Path) -> Path:
    repo = make_repo(tmp_path, [blender_entry(), alias_entry()])
    add_toy_renders(repo)
    return repo


def test_build_publishes_alias_frames_on_the_target_rects(alias_repo: Path) -> None:
    result = build(repo_root=alias_repo, use_cache=False)
    assert {f.asset_id for f in result.frames} == {"veh.toy"}  # the alias builds no frames
    assert not (alias_repo / "build" / ".forge-cache" / "frames" / "veh.toy_parked").exists()
    rects = json.loads((alias_repo / "public/assets/atlas/actors.json").read_text(encoding="utf-8"))["frames"]
    assert len(rects) == 16
    for state in ("body", "dented"):
        for h in range(4):
            local = f"{state}:h{h:02d}:0"
            assert rects[f"veh.toy_parked:{local}"] == rects[f"veh.toy:{local}"]
    ts = (alias_repo / ASSETS_TS).read_text(encoding="utf-8")
    assert '"veh.toy_parked:body:h03:0": { atlas: "actors"' in ts
    assert 'export type AssetId = "veh.toy" | "veh.toy_parked";' in ts
    with pytest.raises(BuildError, match="alias of veh.toy builds no frames"):
        build_asset(entry_from_data(alias_entry()), alias_repo)


def test_build_refuses_a_broken_alias(alias_repo: Path) -> None:
    (alias_repo / "assets-src" / "manifest.json").write_text(
        json.dumps({"assets": [blender_entry(), alias_entry(cell=[16, 16])]}), encoding="utf-8"
    )
    with pytest.raises(BuildError, match="veh.toy_parked: cell"):
        build(repo_root=alias_repo, use_cache=False)


def test_lint_checks_alias_entries_and_rects(alias_repo: Path) -> None:
    build(repo_root=alias_repo, use_cache=False)
    assert [f for f in lint(alias_repo).findings if f.rule in ("manifest", "shape")] == []
    path = alias_repo / "public/assets/atlas/actors.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    doc["frames"]["veh.toy_parked:body:h01:0"] = doc["frames"]["veh.toy:body:h02:0"]
    path.write_text(json.dumps(doc), encoding="utf-8")
    shape = {f.subject: f.message for f in lint(alias_repo).by_rule("shape")}
    assert "alias target veh.toy:body:h01:0" in shape["veh.toy_parked:body:h01:0"]
    (alias_repo / "assets-src" / "manifest.json").write_text(
        json.dumps({"assets": [blender_entry(), alias_entry(outline=False)]}), encoding="utf-8"
    )
    manifest = {f.subject: f.message for f in lint(alias_repo).by_rule("manifest")}
    assert "outline False differs" in manifest["veh.toy_parked"]


def test_sheets_skip_aliases_but_only_shows_the_target_frames(alias_repo: Path, tmp_path: Path) -> None:
    ((_, sheet),) = write_sheets(alias_repo, out_dir=tmp_path / "sheets")
    assert {t.frame_id.split(":")[0] for t in sheet.tiles} == {"veh.toy"}
    ((_, only),) = write_sheets(alias_repo, only=["veh.toy_parked"], out_dir=tmp_path / "sheets")
    assert sorted(t.frame_id for t in only.tiles) == sorted(entry_from_data(alias_entry()).frame_ids())


# ---------------------------------------------------------------------------------------------
# The committed traffic assets


def test_committed_traffic_entries() -> None:
    by_id = {e.id: e for e in load_manifest()}
    for aid, cell in TRAFFIC.items():
        e = by_id[aid]
        assert e.raw == {
            "id": aid,
            "class": "veh",
            "technique": "blender",
            "source": f"assets-src/rendered/{aid}",
            "cell": [cell, cell],
            "states": ["body"],
            "dirs": "h32",
            "frames": {"body": 1},
            "atlas": "actors",
            "outline": True,
            "swaps": [],  # the hatchback and saloon paint swaps arrive with SSP-114 (M4)
            "placeholder": True,
        }
    for alias_id, target in PARKED.items():
        assert by_id[alias_id].raw == {**by_id[target].raw, "id": alias_id, "technique": "alias", "source": target}


def test_scripts_match_the_manifest_and_use_palette_names_only() -> None:
    for aid, cell in TRAFFIC.items():
        script = find_script(aid)
        assert script.parent.name == CLASS_DIRS["veh"]
        text = script.read_text(encoding="utf-8")
        assert parse_cell_px(text) == cell and parse_states(text) == {"body": 1}
        assert load_asset(aid).size == 4 * cell  # 128 / 256 / 384 / 512
        assert not HEX_RE.search(text), f"{script.name} has a raw hex literal"
        names = {
            kw.value.value
            for node in ast.walk(ast.parse(text))
            if isinstance(node, ast.Call) and getattr(node.func, "attr", None) == "toon_material"
            for kw in node.keywords
            if kw.arg in ("lit", "base", "dark") and isinstance(kw.value, ast.Constant)
        }
        assert names, script.name
    for alias_id in PARKED:
        with pytest.raises(Exception, match="no script"):
            find_script(alias_id)


def test_renders_are_complete_with_cell_centre_pivots_at_zero_tilt() -> None:
    for aid, cell in TRAFFIC.items():
        src = REPO_ROOT / "assets-src" / "rendered" / aid
        assert sorted(p.name for p in src.glob("*.png")) == expected_frames({"body": 1}, 32)
        meta = json.loads((src / "render.json").read_text(encoding="utf-8"))
        assert meta["tilt_deg"] == 0 and meta["blender_version"] == "5.2.2 LTS"
        assert meta["argv"] == [
            *("--out", f"assets-src/rendered/{aid}"),
            *("--size", str(4 * cell), "--headings", "32", "--tilt", "0"),
        ]
        assert meta["pivots_px"] == {f"h{i:02d}": [cell // 2, cell // 2] for i in range(32)}


@pytest.fixture(scope="module")
def traffic_frames() -> dict[str, dict[int, np.ndarray]]:
    by_id = {e.id: e for e in load_manifest()}
    out: dict[str, dict[int, np.ndarray]] = {}
    for aid in TRAFFIC:
        built = build_asset(by_id[aid], REPO_ROOT)
        out[aid] = {int(f.dir[1:]): f.indices for f in built.frames}
    return out


def test_h00_body_is_the_size_sheet_body_inside_its_outline(traffic_frames: dict[str, dict[int, np.ndarray]]) -> None:
    """The opaque bbox is the body plus the 1 px forge outline on every side (ART_BIBLE §6.3), centred.

    Measured on all opaque pixels, because a 00 ink shade bevel (the black cab, ART_BIBLE §8.2) joins the outline."""
    for aid, frames in traffic_frames.items():
        ys, xs = np.nonzero(frames[0] != TRANSPARENT)
        w, h = VISIBLE_BODY[aid]
        assert (xs.max() - xs.min() + 1, ys.max() - ys.min() + 1) == (w + 2, h + 2), aid
        cell = TRAFFIC[aid]
        assert (xs.min() + xs.max() + 1) // 2 == cell // 2 and (ys.min() + ys.max() + 1) // 2 == cell // 2, aid


def test_every_heading_fits_its_cell_with_the_outline(traffic_frames: dict[str, dict[int, np.ndarray]]) -> None:
    for aid, frames in traffic_frames.items():
        assert sorted(frames) == list(range(32))
        for h, f in frames.items():
            opaque = f != TRANSPARENT
            assert opaque.any(), (aid, h)
            # The outline is the outermost ring: no non-ink pixel on the cell edge.
            edge = np.concatenate([f[0], f[-1], f[:, 0], f[:, -1]])
            assert not ((edge != TRANSPARENT) & (edge != 0)).any(), (aid, h)


def test_car_paint_stays_on_its_swap_key(traffic_frames: dict[str, dict[int, np.ndarray]]) -> None:
    for aid in ("veh.hatchback", "veh.saloon"):
        used = set(np.unique(np.concatenate([f.ravel() for f in traffic_frames[aid].values()])).tolist())
        assert set(PAINT_KEY) <= used, aid
        assert not used & set(PAINT_FORBIDDEN), (aid, sorted(used & set(PAINT_FORBIDDEN)))
    taxi = set(np.unique(traffic_frames["veh.taxi"][0]).tolist())
    assert 15 not in taxi and {1, 16} <= taxi  # a black cab, never sweeper yellow (ART_BIBLE §5.3)


def test_generated_frames_have_32_headings_and_parked_twins() -> None:
    frames = dict(re.findall(r'^  "([^"]+)": (\{.*\}),$', (REPO_ROOT / ASSETS_TS).read_text(encoding="utf-8"), re.M))
    for aid, cell in TRAFFIC.items():
        ids = [f"{aid}:body:h{i:02d}:0" for i in range(32)]
        assert [f for f in frames if f.startswith(f"{aid}:")] == ids
        assert f"w: {cell}, h: {cell}, px: {cell // 2}, py: {cell // 2}" in frames[ids[31]]
    assert "veh.bus:body:h31:0" in frames
    rects = json.loads((REPO_ROOT / "public/assets/atlas/actors.json").read_text(encoding="utf-8"))["frames"]
    for alias_id, target in PARKED.items():
        twins = [f for f in frames if f.startswith(f"{alias_id}:")]
        assert twins == [f"{alias_id}:body:h{i:02d}:0" for i in range(32)]
        for fid in twins:
            assert frames[fid] == frames[f"{target}{fid[len(alias_id) :]}"]
            assert rects[fid] == rects[f"{target}{fid[len(alias_id) :]}"]
