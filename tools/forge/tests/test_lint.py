"""Tests for ``forge lint`` (SSP-011, the M0 rule subset of ASSET_PIPELINE §9.4).

Every rule is proven on a synthetic repo built from scratch in ``tmp_path``: one Blender
vehicle (renders + script + rig + render.json), one ``ai-ingest`` grid with its AI folder and
the generated atlas outputs from ``forge build``. The clean fixture lints with no findings;
each test breaks one thing and expects exactly that rule to fire.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from PIL import Image

from forge.blender import script_sha256
from forge.genai import prompt_sha256
from forge.build import build
from forge.lint import (
    Finding,
    cli,
    darkest_step_shares,
    lint,
    outline_ink,
    pixel_violations,
    ramp_steps,
    retro_allowed,
    rotation_shading_problems,
)
from forge.sprite import parse_sprite
from forge.palette import PALETTE_PATH, REPO_ROOT, load_palette

PALETTE = load_palette()
YELLOW = 15
TAR = 1


def rgba_of(index: int, alpha: int = 255) -> list[int]:
    return [*(int(v) for v in PALETTE.rgb[index]), alpha]


def write_png(path: Path, rgba: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, "RGBA").save(path)


def toy_render(cell: int, heading: int, dent: bool = False) -> np.ndarray:
    size = cell * 4
    img = np.zeros((size, size, 4), dtype=np.uint8)
    lo, hi = size // 4, size - size // 4
    img[lo:hi, lo:hi] = rgba_of(YELLOW)
    mark = [(lo, lo), (lo, hi - 4), (hi - 4, hi - 4), (hi - 4, lo)][heading]
    img[mark[0] : mark[0] + 4, mark[1] : mark[1] + 4] = rgba_of(TAR)
    if dent:
        img[lo + 4 : lo + 8, lo + 4 : lo + 8] = rgba_of(14)
    return img


SCRIPT = "# toy vehicle script (never run by tests)\nCELL_PX = 8\nSTATES = {'body': 1, 'dented': 1}\n"
RIG = "# toy rig\n"

GRID = """\
id: npc.toy
cell: 6x5
palette: kerbside32
origin: ai/ref.toy_style#cell=0,1
# key omitted: default key applies

frame walk:sw:0
......
.0ff0.
.0cf0.
.0ff0.
......

frame walk:sw:1
......
.0ff0.
.0fc0.
.0ff0.
......

mirror se from sw
"""

RETRO_NOTES = "Imported from asset probe (M0). Retro-filled meta.json for a CANDIDATE."


def blender_entry(**over: Any) -> dict[str, Any]:
    e: dict[str, Any] = {
        "id": "veh.toy",
        "class": "veh",
        "technique": "blender",
        "source": "assets-src/rendered/veh.toy",
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


def grid_entry(**over: Any) -> dict[str, Any]:
    e: dict[str, Any] = {
        "id": "npc.toy",
        "class": "npc",
        "technique": "ai-ingest",
        "source": "assets-src/sprites/npc/toy.sprite.txt",
        "cell": [6, 5],
        "states": ["walk"],
        "dirs": ["sw", "se"],
        "frames": {"walk": 2},
        "atlas": "actors",
        "outline": False,
        "swaps": [],
    }
    e.update(over)
    return e


def write_manifest(repo: Path, entries: list[dict[str, Any]]) -> None:
    (repo / "assets-src" / "manifest.json").write_text(json.dumps({"assets": entries}, indent=2), encoding="utf-8")


def golden_png() -> bytes:
    img = np.zeros((4, 8, 3), dtype=np.uint8)
    img[:, :, 0] = 250
    buf = io.BytesIO()
    Image.fromarray(img, "RGB").save(buf, format="PNG")
    return buf.getvalue()


def write_ai_folder(repo: Path, folder_id: str, **meta_over: Any) -> Path:
    folder = repo / "assets-src" / "ai" / folder_id
    folder.mkdir(parents=True, exist_ok=True)
    golden = golden_png()
    (folder / "golden.png").write_bytes(golden)
    (folder / "prompt.md").write_text(f"# {folder_id}\n\n<!-- forge:send -->\nA toy prompt.\n", encoding="utf-8")
    meta: dict[str, Any] = {
        "id": folder_id,
        "tool": "codex",
        "tool_version": "codex-cli 0.160.1",
        "model": "toy",
        "date": "2026-10-19",
        "argv": ["~/.local/bin/codex", "exec", "-"],
        "prompt_sha256": "a" * 64,
        "preamble_version": "v1",
        "reference_images": [],
        "original_output_path": "~/x.png",
        "candidates_generated": 1,
        "accepted_index": 0,
        "acceptance_notes": "Run 0 accepted: reads at final scale.",
        "golden_sha256": hashlib.sha256(golden).hexdigest(),
        "size": [8, 4],
        "seed": None,
    }
    meta.update(meta_over)
    (folder / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    return folder


def write_render_json(repo: Path, script_hash: str | None = None) -> None:
    src = repo / "assets-src" / "rendered" / "veh.toy"
    if script_hash is None:
        script_hash = script_sha256(
            repo / "assets-src" / "blender" / "vehicles" / "toy.py", repo / "assets-src" / "blender" / "rig.py"
        )
    doc = {
        "blender_version": "5.2.2 LTS",
        "script_sha256": script_hash,
        "argv": [],
        "tilt_deg": 0,
        "pivots_px": {f"h{h:02d}": [4, 4] for h in range(4)},
    }
    (src / "render.json").write_text(json.dumps(doc), encoding="utf-8")


def publish(repo: Path) -> None:
    build(repo_root=repo, use_cache=False)


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A clean synthetic repo: lints with zero findings."""
    root = tmp_path / "repo"
    (root / "assets-src" / "palette").mkdir(parents=True)
    shutil.copy(PALETTE_PATH, root / "assets-src" / "palette" / "kerbside32.json")
    write_manifest(root, [grid_entry(), blender_entry()])
    blender = root / "assets-src" / "blender"
    (blender / "vehicles").mkdir(parents=True)
    (blender / "vehicles" / "toy.py").write_text(SCRIPT, encoding="utf-8")
    (blender / "rig.py").write_text(RIG, encoding="utf-8")
    src = root / "assets-src" / "rendered" / "veh.toy"
    for h in range(4):
        write_png(src / f"h{h:02d}.png", toy_render(8, h))
        write_png(src / f"dented_h{h:02d}.png", toy_render(8, h, dent=True))
    write_render_json(root)
    grid = root / "assets-src" / "sprites" / "npc" / "toy.sprite.txt"
    grid.parent.mkdir(parents=True)
    grid.write_text(GRID, encoding="utf-8")
    write_ai_folder(root, "ref.toy_style")
    (root / "assets-src" / "ai" / "_style_preamble.md").write_text("preamble v1\n", encoding="utf-8")
    publish(root)
    return root


def rules(findings: list[Finding], severity: str = "error") -> set[str]:
    return {f.rule for f in findings if f.severity == severity}


def run_cli(repo: Path, *argv: str) -> int:
    only: list[str] | None = None
    warn = False
    args = list(argv)
    if "--warn-as-error" in args:
        warn = True
        args.remove("--warn-as-error")
    if args and args[0] == "--only":
        only = args[1:]
    return cli(argparse.Namespace(only=only, warn_as_error=warn), repo_root=repo)


# ---------------------------------------------------------------------------------------------
# Clean


def test_clean_fixture_has_no_findings(repo: Path) -> None:
    report = lint(repo)
    assert report.findings == []
    assert report.assets == ["npc.toy", "veh.toy"]
    assert report.ai_folders == ["ref.toy_style"], "folders starting with _ are not AI asset folders"
    assert run_cli(repo) == 0
    assert run_cli(repo, "--warn-as-error") == 0


def test_the_repo_lints_clean_with_the_retro_probe_folder_and_the_accepted_people_style() -> None:
    report = lint(REPO_ROOT)
    assert report.errors == [], [f.line() for f in report.errors]
    assert report.warnings == [], [f.line() for f in report.warnings]
    assert {"ref.people_style", "litter.sheet_01"} <= set(report.ai_folders)
    ai = REPO_ROOT / "assets-src" / "ai"
    meta = json.loads((ai / "litter.sheet_01" / "meta.json").read_text(encoding="utf-8"))
    assert meta["prompt_sha256"] is None and meta["preamble_version"] is None, "the retro probe form"
    assert retro_allowed(meta)
    # SSP-014 (D-04): ref.people_style is a fresh gen-ai golden with complete provenance (VS-5).
    meta = json.loads((ai / "ref.people_style" / "meta.json").read_text(encoding="utf-8"))
    assert meta["accepted_index"] is not None and meta["acceptance_notes"].strip()
    assert meta["preamble_version"] == "v1" and meta["argv"][0] != "RECONSTRUCTED"
    assert meta["prompt_sha256"] == prompt_sha256((ai / "ref.people_style" / "prompt.md").read_text(encoding="utf-8"))
    assert meta["golden_sha256"] == hashlib.sha256((ai / "ref.people_style" / "golden.png").read_bytes()).hexdigest()


# ---------------------------------------------------------------------------------------------
# Palette


def test_pixel_violations_masks() -> None:
    img = np.zeros((1, 4, 4), dtype=np.uint8)
    img[0, 0] = rgba_of(YELLOW)
    img[0, 1] = [1, 2, 3, 255]  # off-palette
    img[0, 2] = rgba_of(YELLOW, 128)  # semi-transparent
    img[0, 3] = [1, 2, 3, 0]  # fully transparent: RGB does not matter
    rgb = PALETTE.rgb.astype(np.int64)
    keys = np.unique((rgb[:, 0] << 16) | (rgb[:, 1] << 8) | rgb[:, 2])
    off, semi = pixel_violations(img, keys)
    assert off.tolist() == [[False, True, False, False]]
    assert semi.tolist() == [[False, False, True, False]]


def test_off_palette_render_pixel_is_an_error(repo: Path) -> None:
    path = repo / "assets-src" / "rendered" / "veh.toy" / "h01.png"
    img = np.asarray(Image.open(path).convert("RGBA")).copy()
    img[9, 9] = [12, 200, 34, 255]  # one lone pixel: loses its 4x4 block, so the snap is untouched
    write_png(path, img)
    report = lint(repo)
    palette_errors = report.by_rule("palette")
    assert len(palette_errors) == 1 and "1 off-palette pixel" in palette_errors[0].message
    assert "h01.png" in palette_errors[0].subject
    assert rules(report.findings) == {"palette"}
    assert run_cli(repo) == 1


def test_alpha_128_render_pixel_is_an_error(repo: Path) -> None:
    path = repo / "assets-src" / "rendered" / "veh.toy" / "h00.png"
    img = np.asarray(Image.open(path).convert("RGBA")).copy()
    img[10, 10, 3] = 128  # the build would treat it as opaque; lint still refuses it
    write_png(path, img)
    report = lint(repo)
    msgs = [f.message for f in report.by_rule("palette")]
    assert len(msgs) == 1 and "1 semi-transparent pixel" in msgs[0] and "rgba(" in msgs[0] and ",128)" in msgs[0]
    assert rules(report.findings) == {"palette"}


def test_off_palette_and_semi_transparent_atlas_pixels_are_errors(repo: Path) -> None:
    path = repo / "public" / "assets" / "atlas" / "actors.png"
    img = np.asarray(Image.open(path).convert("RGBA")).copy()
    img[0, 0] = [12, 200, 34, 255]
    img[0, 1] = rgba_of(YELLOW, 128)
    Image.fromarray(img, "RGBA").save(path)
    report = lint(repo)
    msgs = sorted(f.message for f in report.by_rule("palette"))
    assert len(msgs) == 2
    assert msgs[0].startswith("1 off-palette pixel(s): (0,0) rgba(12,200,34,255)")
    assert msgs[1].startswith("1 semi-transparent pixel(s): (1,0)")
    assert all(f.subject == "public/assets/atlas/actors.png" for f in report.by_rule("palette"))


# ---------------------------------------------------------------------------------------------
# Shape


def test_frame_count_mismatch_is_a_shape_error(repo: Path) -> None:
    (repo / "assets-src" / "rendered" / "veh.toy" / "dented_h03.png").unlink()
    report = lint(repo)
    shape = report.by_rule("shape")
    assert len(shape) == 1 and shape[0].subject == "veh.toy" and "dented:h03:0" in shape[0].message
    assert rules(report.findings) == {"shape"}


def test_size_mismatch_is_a_shape_error(repo: Path) -> None:
    entries = [grid_entry(cell=[7, 5]), blender_entry()]
    write_manifest(repo, entries)
    report = lint(repo)
    shape = [f for f in report.by_rule("shape") if f.subject == "npc.toy"]
    assert shape and "cell 6x5 != manifest cell 7x5" in shape[0].message


def test_empty_frame_is_a_shape_error(repo: Path) -> None:
    grid = repo / "assets-src" / "sprites" / "npc" / "toy.sprite.txt"
    head, _, _ = GRID.partition("frame walk:sw:1\n")
    grid.write_text(head + "frame walk:sw:1\n" + "......\n" * 5 + "\nmirror se from sw\n", encoding="utf-8")
    report = lint(repo)
    assert any("frame is empty" in f.message for f in report.by_rule("shape")), [f.line() for f in report.findings]


def test_atlas_json_out_of_date_is_a_shape_error(repo: Path) -> None:
    path = repo / "public" / "assets" / "atlas" / "actors.json"
    doc = json.loads(path.read_text(encoding="utf-8"))
    del doc["frames"]["veh.toy:body:h00:0"]
    doc["frames"]["npc.toy:walk:se:0"]["w"] = 9
    path.write_text(json.dumps(doc), encoding="utf-8")
    report = lint(repo)
    msgs = {f.subject: f.message for f in report.by_rule("shape")}
    assert "veh.toy:body:h00:0" in msgs["veh.toy"]
    assert "9x5" in msgs["npc.toy:walk:se:0"]


# ---------------------------------------------------------------------------------------------
# Manifest


def test_unsorted_manifest_is_an_error(repo: Path) -> None:
    write_manifest(repo, [blender_entry(), grid_entry()])
    report = lint(repo)
    errs = report.by_rule("manifest")
    assert len(errs) == 1 and "not sorted" in errs[0].message
    assert rules(report.findings) == {"manifest"}
    assert run_cli(repo) == 1


def test_duplicate_id_is_an_error(repo: Path) -> None:
    write_manifest(repo, [grid_entry(), blender_entry(), blender_entry()])
    errs = lint(repo).by_rule("manifest")
    assert any("duplicate id" in f.message and f.subject == "veh.toy" for f in errs)


def test_unknown_class_prefix_is_an_error(repo: Path) -> None:
    write_manifest(repo, [grid_entry(), blender_entry(), blender_entry(id="zzz.toy", **{"class": "zzz"})])
    errs = lint(repo).by_rule("manifest")
    assert [f.subject for f in errs] == ["zzz.toy"]
    assert "unknown class prefix 'zzz'" in errs[0].message


# ---------------------------------------------------------------------------------------------
# Provenance


def test_golden_hash_mismatch_is_an_error(repo: Path) -> None:
    write_ai_folder(repo, "ref.toy_style", golden_sha256="0" * 64)
    report = lint(repo)
    prov = report.by_rule("provenance")
    subjects = {f.subject for f in prov}
    assert "assets-src/ai/ref.toy_style" in subjects
    assert any("golden.png SHA-256" in f.message and "!= meta.json golden_sha256 " + "0" * 64 in f.message for f in prov)
    assert any(f.subject == "npc.toy" and "origin folder" in f.message for f in prov), "the ai-ingest origin must be hash-valid"
    assert rules(report.findings) == {"provenance"}


def test_missing_meta_json_is_an_error(repo: Path) -> None:
    (repo / "assets-src" / "ai" / "ref.toy_style" / "meta.json").unlink()
    prov = lint(repo).by_rule("provenance")
    assert any(f.message == "meta.json is missing" for f in prov)


def test_retro_meta_passes(repo: Path) -> None:
    write_ai_folder(
        repo, "ref.toy_style", prompt_sha256=None, preamble_version=None, accepted_index=None, acceptance_notes=RETRO_NOTES
    )
    assert lint(repo).findings == []


def test_null_prompt_without_retro_note_is_an_error(repo: Path) -> None:
    write_ai_folder(repo, "ref.toy_style", prompt_sha256=None)
    prov = lint(repo).by_rule("provenance")
    assert any("prompt_sha256 is null" in f.message and "retro" in f.message for f in prov)


def test_retro_rule_is_generic_not_a_folder_list() -> None:
    assert retro_allowed({"acceptance_notes": "Retro-filled meta.json"})
    assert retro_allowed({"acceptance_notes": "retro note"})
    assert not retro_allowed({"acceptance_notes": "Run 2 accepted; metro station sign"})
    assert not retro_allowed({"acceptance_notes": None})
    assert not retro_allowed({})


def test_ai_ingest_grid_needs_an_origin(repo: Path) -> None:
    grid = repo / "assets-src" / "sprites" / "npc" / "toy.sprite.txt"
    grid.write_text(GRID.replace("origin: ai/ref.toy_style#cell=0,1\n", ""), encoding="utf-8")
    prov = lint(repo).by_rule("provenance")
    assert [f.subject for f in prov] == ["npc.toy"] and "no origin" in prov[0].message


def test_ai_ingest_origin_must_exist(repo: Path) -> None:
    grid = repo / "assets-src" / "sprites" / "npc" / "toy.sprite.txt"
    grid.write_text(GRID.replace("ref.toy_style", "ref.nope"), encoding="utf-8")
    prov = lint(repo).by_rule("provenance")
    assert [f.subject for f in prov] == ["npc.toy"] and "does not exist" in prov[0].message


def test_grid_technique_needs_no_origin(repo: Path) -> None:
    grid = repo / "assets-src" / "sprites" / "npc" / "toy.sprite.txt"
    grid.write_text(GRID.replace("origin: ai/ref.toy_style#cell=0,1\n", ""), encoding="utf-8")
    write_manifest(repo, [grid_entry(technique="grid"), blender_entry()])
    assert lint(repo).findings == []


# ---------------------------------------------------------------------------------------------
# Ramps and rotation-symmetric litter shading (SSP-051)

LITTER_TOPLIT = """\
id: litter.toy
cell: 8x8
palette: kerbside32

frame idle:h00:0
........
.000000.
.055550.
.056650.
.056650.
.055550.
.000000.
........
"""
"""Top-lit litter: ink outline, slab (05) base, one centred kerb (06) highlight."""

LITTER_NW_SHADED = """\
id: litter.toy
cell: 8x8
palette: kerbside32

frame idle:h00:0
........
.000000.
.066660.
.065540.
.065540.
.064440.
.000000.
........
"""
"""The deliberately NW-shaded fixture: a lighter (06) NW bevel and a darker (04) SE bevel on a 05 base."""

LITTER_NW_GLINT = """\
id: litter.toy
cell: 8x8
palette: kerbside32

frame idle:h00:0
........
.000000.
.066650.
.065550.
.065550.
.055550.
.000000.
........
"""
"""Only a lighter NW glint (06 on the N and W rims) on a 05 base, no darker edge."""


def litter_grid_entry(**over: Any) -> dict[str, Any]:
    e = grid_entry(
        id="litter.toy",
        technique="grid",
        source="assets-src/sprites/litter/toy.sprite.txt",
        cell=[8, 8],
        states=["idle"],
        dirs="rot4",
        frames={"idle": 1},
        atlas="items",
    )
    e["class"] = "litter"
    e.update(over)
    return e


def frame_of(text: str) -> np.ndarray:
    return parse_sprite(text).frames["idle:h00:0"]


def add_litter(repo: Path, text: str, **over: Any) -> None:
    path = repo / "assets-src" / "sprites" / "litter" / "toy.sprite.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    write_manifest(repo, [litter_grid_entry(**over), grid_entry(), blender_entry()])
    publish(repo)


def test_outline_ink_is_ink_next_to_transparency_or_the_cell_edge() -> None:
    a = np.array([[0, 0, 0, -1], [0, 0, 5, 0], [0, 5, 5, 0], [0, 0, 0, 0]], dtype=np.int16)
    mask = outline_ink(a)
    assert mask[0, 0] and mask[3, 3] and mask[1, 3]
    assert not mask[1, 1], "ink enclosed by body and ink is interior fill"
    assert ramp_steps(a, PALETTE)["neutral_grey"] == (0, 5)


def test_toplit_litter_has_no_rotation_shading_problem() -> None:
    a = frame_of(LITTER_TOPLIT)
    assert ramp_steps(a, PALETTE) == {"neutral_grey": (5, 6)}
    darkest, shares = darkest_step_shares(a, PALETTE)["neutral_grey"]
    assert darkest == 5 and shares == {"N": 1.0, "E": 1.0, "S": 1.0, "W": 1.0}
    for k in range(4):
        assert rotation_shading_problems(np.rot90(a, k), PALETTE) == []


@pytest.mark.parametrize("text", [LITTER_NW_SHADED, LITTER_NW_GLINT], ids=["nw-bevel-se-shade", "nw-glint"])
def test_nw_shaded_litter_fails_the_rotation_symmetry_check(text: str) -> None:
    a = frame_of(text)
    problems = rotation_shading_problems(a, PALETTE)
    assert problems and all("neutral_grey" in p and "90° turn" in p for p in problems)
    # A 90° turn really does move the darkest step to another edge: the rotated frame's shares differ.
    _, shares = darkest_step_shares(a, PALETTE)["neutral_grey"]
    _, turned = darkest_step_shares(np.rot90(a, -1), PALETTE)["neutral_grey"]
    assert shares != turned


def test_single_step_ramps_and_edges_without_the_ramp_are_not_compared() -> None:
    # A can: council_blue (26) body with a centred sky (27) stripe and kerb (06) ends. The blue
    # ramp has no E or W rim (the silver ends sit there), so only N and S are compared.
    text = (
        "id: litter.toy\ncell: 8x7\npalette: kerbside32\n\nframe idle:h00:0\n"
        ".000000.\n06qqqq60\n06rrrr60\n06qqqq60\n.000000.\n........\n........\n"
    )
    a = frame_of(text)
    assert darkest_step_shares(a, PALETTE)["blue"] == (26, {"N": 1.0, "E": None, "S": 1.0, "W": None})
    assert rotation_shading_problems(a, PALETTE) == []


def test_litter_lint_passes_a_toplit_grid(repo: Path) -> None:
    add_litter(repo, LITTER_TOPLIT)
    report = lint(repo)
    assert report.findings == [], [f.line() for f in report.findings]
    assert "litter.toy" in report.assets


def test_nw_shaded_litter_fixture_is_a_litter_shading_error(repo: Path) -> None:
    add_litter(repo, LITTER_NW_SHADED)
    report = lint(repo)
    assert rules(report.findings) == {"litter-shading"}
    assert {f.subject for f in report.errors} == {"litter.toy:idle:h00:0"}, "only the authored h00 frame is reported"
    assert run_cli(repo) == 1


def test_litter_dirs_must_be_rot4(repo: Path) -> None:
    add_litter(repo, LITTER_TOPLIT, dirs=["h00"])
    errors = lint(repo).by_rule("litter-shading")
    assert [f.subject for f in errors] == ["litter.toy"] and '"rot4"' in errors[0].message


def test_more_than_four_steps_of_a_ramp_is_a_ramps_error(repo: Path) -> None:
    five = LITTER_TOPLIT.replace(".056650.\n.056650.", ".023450.\n.056650.")  # 02 03 04 05 06
    add_litter(repo, five)
    ramps = lint(repo).by_rule("ramps")
    assert [f.subject for f in ramps] == [f"litter.toy:idle:{d}:0" for d in ("h00", "h08", "h16", "h24")]
    assert "5 steps of ramp neutral_grey (02 03 04 05 06)" in ramps[0].message


def test_outline_ink_does_not_count_as_a_ramp_step_but_interior_ink_does(repo: Path) -> None:
    four = LITTER_TOPLIT.replace(".056650.\n.056650.", ".034650.\n.056650.")  # 03 04 05 06 + outline ink
    add_litter(repo, four)
    assert lint(repo).by_rule("ramps") == []
    interior = four.replace(".056650.\n.055550.", ".050650.\n.055550.")  # one enclosed ink pixel
    add_litter(repo, interior)
    assert "litter.toy:idle:h00:0" in {f.subject for f in lint(repo).by_rule("ramps")}


def test_ramps_rule_checks_grid_and_ai_ingest_entries_only(repo: Path) -> None:
    # The clean fixture's toy vehicle is a blender entry: SSP-115 (M4) extends the rule to every technique.
    assert lint(repo).by_rule("ramps") == []
    grid = repo / "assets-src" / "sprites" / "npc" / "toy.sprite.txt"
    grid.write_text(GRID.replace(".0cf0.", ".23456"), encoding="utf-8")  # 02-06: 5 neutral steps in walk:sw:0
    publish(repo)
    assert {f.subject for f in lint(repo).by_rule("ramps")} == {"npc.toy:walk:sw:0", "npc.toy:walk:se:0"}


# ---------------------------------------------------------------------------------------------
# Blender drift and snap


def test_stale_script_hash_warns_and_errors_only_with_warn_as_error(repo: Path) -> None:
    script = repo / "assets-src" / "blender" / "vehicles" / "toy.py"
    script.write_text(SCRIPT + "# tweaked after the render\n", encoding="utf-8")
    report = lint(repo)
    assert report.errors == []
    assert len(report.warnings) == 1
    w = report.warnings[0]
    assert (w.rule, w.subject) == ("blender-drift", "veh.toy") and w.message.startswith("re-render needed")
    assert not report.failed() and report.failed(warn_as_error=True)
    assert run_cli(repo) == 0
    assert run_cli(repo, "--warn-as-error") == 1


def test_rig_change_also_marks_the_render_stale(repo: Path) -> None:
    (repo / "assets-src" / "blender" / "rig.py").write_text(RIG + "# new light\n", encoding="utf-8")
    assert [f.message[:16] for f in lint(repo).warnings] == ["re-render needed"]


def test_missing_script_is_an_error(repo: Path) -> None:
    (repo / "assets-src" / "blender" / "vehicles" / "toy.py").unlink()
    errs = lint(repo).by_rule("blender-drift")
    assert len(errs) == 1 and errs[0].severity == "error" and "no script" in errs[0].message


def test_palette_snap_change_is_an_error(repo: Path) -> None:
    path = repo / "assets-src" / "rendered" / "veh.toy" / "h02.png"
    img = np.asarray(Image.open(path).convert("RGBA")).copy()
    img[12:16, 12:16] = [250, 190, 40, 255]  # a whole 4x4 block of an off-palette yellow: the snap fires
    write_png(path, img)
    report = lint(repo)
    snap = report.by_rule("blender-snap")
    assert [f.subject for f in snap] == ["veh.toy:body:h02:0"] and "changed 1 px" in snap[0].message
    assert rules(report.findings) == {"blender-snap", "palette"}


# ---------------------------------------------------------------------------------------------
# --only and the probe exclusion


def test_only_restricts_per_asset_rules(repo: Path) -> None:
    (repo / "assets-src" / "rendered" / "veh.toy" / "dented_h03.png").unlink()
    assert lint(repo, only=["npc.toy"]).errors == []
    assert lint(repo, only=["npc.toy"]).assets == ["npc.toy"]
    assert rules(lint(repo, only=["veh.toy"]).findings) == {"shape"}
    assert run_cli(repo, "--only", "npc.toy") == 0
    assert run_cli(repo, "--only", "veh.toy") == 1


def test_only_accepts_ai_folder_ids_and_rejects_unknown(repo: Path) -> None:
    report = lint(repo, only=["ref.toy_style"])
    assert report.findings == [] and report.ai_folders == ["ref.toy_style"] and report.assets == []
    errs = lint(repo, only=["veh.nope"]).errors
    assert [f.subject for f in errs] == ["veh.nope"]


def test_only_ai_ingest_entry_checks_its_origin_folder(repo: Path) -> None:
    write_ai_folder(repo, "ref.toy_style", golden_sha256="0" * 64)
    report = lint(repo, only=["npc.toy"])
    assert report.ai_folders == ["ref.toy_style"]
    assert any(f.subject == "npc.toy" for f in report.by_rule("provenance"))


def test_probe_is_never_linted(repo: Path) -> None:
    probe = repo / "assets-src" / "_probe"
    # Everything in here would fail several rules if lint ever looked at it.
    write_png(probe / "codex" / "sheet.png", np.full((4, 4, 4), 128, dtype=np.uint8))
    write_png(probe / "rendered" / "veh.toy" / "h00.png", np.full((4, 4, 4), 77, dtype=np.uint8))
    (probe / "ai" / "ref.broken").mkdir(parents=True)
    (probe / "ai" / "ref.broken" / "golden.png").write_bytes(b"not a png")
    (probe / "ai" / "ref.broken" / "meta.json").write_text("{ not json", encoding="utf-8")
    (probe / "manifest.json").write_text('{"assets": [{"id": "zzz.bad"}]}', encoding="utf-8")
    report = lint(repo)
    assert report.findings == []
    assert report.files, "lint records what it reads"
    assert not [p for p in report.files if p.startswith("assets-src/_probe")]


def test_manifest_entry_inside_the_probe_is_rejected_unread(repo: Path) -> None:
    probe_src = repo / "assets-src" / "_probe" / "rendered" / "veh.probe"
    write_png(probe_src / "h00.png", np.full((32, 32, 4), 77, dtype=np.uint8))
    write_manifest(
        repo,
        [grid_entry(), blender_entry(id="veh.probe", source="assets-src/_probe/rendered/veh.probe"), blender_entry()],
    )
    report = lint(repo)
    errs = report.by_rule("manifest")
    assert [f.subject for f in errs] == ["veh.probe"] and "_probe" in errs[0].message
    assert "veh.probe" not in report.assets
    assert not [p for p in report.files if p.startswith("assets-src/_probe")]


def test_python_m_forge_lint_exits_0_on_the_repo() -> None:
    result = subprocess.run([sys.executable, "-m", "forge", "lint"], capture_output=True, text=True, check=False)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "0 error(s), 0 warning(s)" in result.stdout
