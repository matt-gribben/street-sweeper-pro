"""Tests for ``forge sheets`` (SSP-011, ASSET_PIPELINE §9.5)."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from forge.build import build_asset
from forge.manifest import load_manifest
from forge.palette import PALETTE_PATH, PALETTE_SIZE, REPO_ROOT, TRANSPARENT, load_palette
from forge.pngio import decode_indexed_png
from forge.sheets import (
    BESSIE_FRAME,
    BG_DARK,
    BG_LIGHT,
    PREVIEW_REPEAT,
    SCALE,
    SheetError,
    cli,
    render_text,
    write_sheets,
)

from test_lint import GRID, SCRIPT, grid_entry, toy_render, write_png

PALETTE = load_palette()


def bessie_entry(**over: Any) -> dict[str, Any]:
    e: dict[str, Any] = {
        "id": "veh.sweeper",
        "class": "veh",
        "technique": "blender",
        "source": "assets-src/rendered/veh.sweeper",
        "cell": [8, 8],
        "states": ["body", "dented"],
        "dirs": "h4",
        "frames": {"body": 1, "dented": 1},
        "atlas": "actors",
        "outline": True,
        "swaps": [],
    }
    e.update(over)
    return e


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    root = tmp_path / "repo"
    (root / "assets-src" / "palette").mkdir(parents=True)
    shutil.copy(PALETTE_PATH, root / "assets-src" / "palette" / "kerbside32.json")
    entries = [grid_entry(technique="grid"), bessie_entry()]
    (root / "assets-src" / "manifest.json").write_text(json.dumps({"assets": entries}), encoding="utf-8")
    src = root / "assets-src" / "rendered" / "veh.sweeper"
    for h in range(4):
        write_png(src / f"h{h:02d}.png", toy_render(8, h))
        write_png(src / f"dented_h{h:02d}.png", toy_render(8, h, dent=True))
    (src / "render.json").write_text(json.dumps({"pivots_px": {f"h{h:02d}": [4, 4] for h in range(4)}}), encoding="utf-8")
    (root / "assets-src" / "blender" / "vehicles").mkdir(parents=True)
    (root / "assets-src" / "blender" / "vehicles" / "sweeper.py").write_text(SCRIPT, encoding="utf-8")
    grid = root / "assets-src" / "sprites" / "npc" / "toy.sprite.txt"
    grid.parent.mkdir(parents=True)
    grid.write_text(GRID, encoding="utf-8")
    return root


def load_sheet(path: Path) -> np.ndarray:
    return decode_indexed_png(path.read_bytes(), PALETTE)


def big(indices: np.ndarray, bg: int) -> np.ndarray:
    out = np.where(indices == TRANSPARENT, bg, indices)
    return np.repeat(np.repeat(out, SCALE, axis=0), SCALE, axis=1)


def test_backgrounds_are_palette_06_and_01() -> None:
    assert (BG_LIGHT, BG_DARK) == (6, 1)
    assert PALETTE.names[BG_LIGHT] == "kerb" and PALETTE.names[BG_DARK] == "tar"


def test_atlas_sheet_labels_every_frame_on_light_and_dark(repo: Path) -> None:
    written = write_sheets(repo)
    assert [p.relative_to(repo).as_posix() for p, _ in written] == ["build/sheets/actors.png"]
    path, sheet = written[0]
    canvas = load_sheet(path)
    assert canvas.shape == (sheet.height, sheet.width)
    assert int(canvas.min()) >= 0, "a sheet is opaque: every pixel is a palette colour"

    frames = {}
    for e in load_manifest(repo / "assets-src" / "manifest.json"):
        frames.update({f.frame_id: f for f in build_asset(e, repo, PALETTE).frames})
    labelled = [t.frame_id for t in sheet.tiles if not t.scale_ref]
    assert sorted(labelled) == sorted(frames), "every frame exactly once"
    for t in sheet.tiles:
        f = frames[t.frame_id]
        assert t.label == (f"scale: {BESSIE_FRAME}" if t.scale_ref else t.frame_id)
        h, w = f.height * SCALE, f.width * SCALE
        for (x, y), bg in ((t.light_xy, BG_LIGHT), (t.dark_xy, BG_DARK)):
            assert np.array_equal(canvas[y : y + h, x : x + w], big(f.indices, bg)), t.frame_id
        lx, ly = t.label_xy
        mask = render_text(t.label)
        region = canvas[ly : ly + mask.shape[0], lx : lx + mask.shape[1]]
        assert np.all(region[mask] == region[mask][0]) and mask.any(), "label painted in one ink"


def test_bessie_h00_is_beside_each_group(repo: Path) -> None:
    (_, sheet), = write_sheets(repo)
    refs = [t for t in sheet.tiles if t.scale_ref]
    assert len(refs) == 2, "one per group (npc.toy and veh.sweeper)"
    assert all(t.frame_id == BESSIE_FRAME for t in refs)
    # The scale tile starts its group's first row: the next tile is on the same row.
    for ref in refs:
        i = sheet.tiles.index(ref)
        assert sheet.tiles[i + 1].label_xy[1] == ref.label_xy[1]


def test_palette_strip_has_all_32_colours(repo: Path) -> None:
    (path, sheet), = write_sheets(repo)
    canvas = load_sheet(path)
    assert [i for i, _ in sheet.swatches] == list(range(PALETTE_SIZE))
    for i, (x, y) in sheet.swatches:
        assert int(canvas[y + 8, x + 8]) == i


def test_animated_frames_read_left_to_right(repo: Path) -> None:
    (_, sheet), = write_sheets(repo)
    pos = {t.frame_id: t.label_xy for t in sheet.tiles if not t.scale_ref}
    a, b = pos["npc.toy:walk:sw:0"], pos["npc.toy:walk:sw:1"]
    assert a[1] == b[1] and a[0] < b[0]


def test_only_writes_a_focused_sheet(repo: Path) -> None:
    written = write_sheets(repo, only=["npc.toy"])
    assert [p.name for p, _ in written] == ["only_npc.toy.png"]
    _, sheet = written[0]
    assert {t.frame_id for t in sheet.tiles if not t.scale_ref} == {
        "npc.toy:walk:se:0",
        "npc.toy:walk:se:1",
        "npc.toy:walk:sw:0",
        "npc.toy:walk:sw:1",
    }
    assert not (repo / "build" / "sheets" / "actors.png").exists()


def test_atlas_filter_and_errors(repo: Path) -> None:
    assert write_sheets(repo, atlas="world") == []
    assert [p.name for p, _ in write_sheets(repo, atlas="actors")] == ["actors.png"]
    with pytest.raises(SheetError, match="not in the manifest"):
        write_sheets(repo, only=["npc.nope"])
    with pytest.raises(SheetError, match="not 'world'"):
        write_sheets(repo, atlas="world", only=["npc.toy"])


def test_sheets_are_byte_stable(repo: Path) -> None:
    (path, _), = write_sheets(repo)
    first = path.read_bytes()
    path.unlink()
    write_sheets(repo)
    assert path.read_bytes() == first


def test_cli_exit_codes(repo: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert cli(argparse.Namespace(atlas=None, only=None), repo_root=repo) == 0
    assert "wrote build/sheets/actors.png" in capsys.readouterr().out
    assert cli(argparse.Namespace(atlas=None, only=["npc.nope"]), repo_root=repo) == 1
    assert "not in the manifest" in capsys.readouterr().err


def test_repo_actors_sheet_and_only_sweeper(tmp_path: Path) -> None:
    written = write_sheets(REPO_ROOT, out_dir=tmp_path)
    assert [p.name for p, _ in written] == ["world.png", "actors.png", "items.png", "ui.png"]
    for (_, sheet), atlas in zip(written, ("world", "actors", "items", "ui"), strict=True):
        # Alias entries (the parked cars, SSP-100) repeat their target's frames, so atlas sheets leave them out.
        n = sum(len(e.frame_ids()) for e in load_manifest() if e.atlas == atlas and not e.is_alias)
        assert len([t for t in sheet.tiles if not t.scale_ref and not t.preview and not t.specimen]) == n
    # The font gets specimen rows (SSP-068): glyph and outline, at 1x and at 4x.
    ui = written[3][1]
    specimens = [t for t in ui.tiles if t.specimen]
    assert [(t.label, t.scale) for t in specimens] == [
        ("specimen font.kerbside5x7 glyph 1x", 1),
        ("specimen font.kerbside5x7 outline 1x", 1),
        ("specimen font.kerbside5x7 glyph 4x", 4),
        ("specimen font.kerbside5x7 outline 4x", 4),
    ]
    (path, only), = write_sheets(REPO_ROOT, only=["veh.sweeper"], out_dir=tmp_path)
    assert path.name == "only_veh.sweeper.png"
    assert len([t for t in only.tiles if not t.scale_ref]) == 64
    # --only on an alias shows its target's frames under the alias's own frame IDs.
    (path, parked), = write_sheets(REPO_ROOT, only=["veh.taxi_parked"], out_dir=tmp_path)
    assert path.name == "only_veh.taxi_parked.png"
    labels = [t.frame_id for t in parked.tiles if not t.scale_ref]
    assert labels == [f"veh.taxi_parked:body:h{i:02d}:0" for i in range(32)]


# ---------------------------------------------------------------------------------------------
# 3x3 previews of wrap tiles (SSP-040, ASSET_PIPELINE §10.8)


def add_tile(repo: Path, asset_id: str, wrap: bool) -> None:
    name = asset_id.split(".")[1]
    entry = {
        "id": asset_id,
        "class": "tile",
        "technique": "procedural",
        "source": f"assets-src/procedural/tiles/{name}.json",
        "cell": [32, 32],
        "states": ["v"],
        "dirs": "-",
        "frames": {"v": 2},
        "atlas": "world",
        "outline": False,
        "swaps": [],
    }
    manifest = repo / "assets-src" / "manifest.json"
    data = json.loads(manifest.read_text(encoding="utf-8"))
    data["assets"] = sorted([*data["assets"], entry], key=lambda e: e["id"])
    manifest.write_text(json.dumps(data), encoding="utf-8")
    params = {"base_index": 2, "speckle": {"indices": [1, 3], "density": 0.05, "max_fraction": 0.08}, "wrap": wrap}
    doc = {"id": asset_id, "generator": "tiles.asphalt", "seed": 5, "cell": [32, 32], "variants": 2, "params": params}
    src = repo / entry["source"]
    src.parent.mkdir(parents=True, exist_ok=True)
    src.write_text(json.dumps(doc), encoding="utf-8")


def test_every_wrap_tile_gets_a_3x3_preview_per_frame(repo: Path) -> None:
    add_tile(repo, "tile.wrapped", wrap=True)
    add_tile(repo, "tile.single", wrap=False)
    written = dict((p.name, s) for p, s in write_sheets(repo, atlas="world"))
    sheet = written["world.png"]
    canvas = load_sheet(repo / "build" / "sheets" / "world.png")
    previews = [t for t in sheet.tiles if t.preview]
    assert [t.frame_id for t in previews] == ["tile.wrapped:v:-:0", "tile.wrapped:v:-:1"]
    frames = {f.frame_id: f for e in load_manifest(repo / "assets-src" / "manifest.json") for f in build_asset(e, repo, PALETTE).frames}
    last_frame_y = max(t.label_xy[1] for t in sheet.tiles if t.frame_id.startswith("tile.wrapped") and not t.preview)
    for t in previews:
        assert t.label == f"3x3 {t.frame_id}"
        assert t.label_xy[1] > last_frame_y, "previews follow the frames"
        tiled = np.tile(frames[t.frame_id].indices, (PREVIEW_REPEAT, PREVIEW_REPEAT))
        h, w = tiled.shape[0] * SCALE, tiled.shape[1] * SCALE
        x, y = t.light_xy
        assert np.array_equal(canvas[y : y + h, x : x + w], big(tiled, BG_LIGHT))
    (_, only), = write_sheets(repo, only=["tile.wrapped"])
    assert sum(t.preview for t in only.tiles) == 2
    (_, single), = write_sheets(repo, only=["tile.single"])
    assert not any(t.preview for t in single.tiles)


def test_a_run_longer_than_a_row_wraps(repo: Path) -> None:
    from forge import sheets

    add_tile(repo, "tile.wrapped", wrap=False)
    old = sheets.MAX_ROW_PX
    sheets.MAX_ROW_PX = 300  # one tile per row
    try:
        (_, sheet), = write_sheets(repo, only=["tile.wrapped"])
    finally:
        sheets.MAX_ROW_PX = old
    ys = [t.label_xy[1] for t in sheet.tiles if not t.scale_ref]
    assert len(ys) == 2 and ys[0] < ys[1]
