"""Tests for ``forge blender`` (SSP-007) and the static rules of ``assets-src/blender/rig.py``.

Blender never runs here: ``SSP_BLENDER`` points at ``fake_blender.py`` (CLAUDE.md §3.5).
"""

from __future__ import annotations

import ast
import hashlib
import json
import math
import re
import shutil
import stat
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from forge import blender
from forge.__main__ import main
from forge.palette import PALETTE_PATH, REPO_ROOT, load_palette

FAKE_SRC = Path(__file__).with_name("fake_blender.py")
RIG = REPO_ROOT / "assets-src" / "blender" / "rig.py"
HEX_RE = re.compile(r"#[0-9a-fA-F]{6}")

SMALL_VEH = '''"""A test vehicle."""
CELL_PX = 8
STATES = {"body": 1, "dented": 1}
'''
SMALL_BRUSH = '''CELL_PX = 12
STATES = {"brush": 4}
'''


# ---------------------------------------------------------------------------------------------
# Fixtures


@pytest.fixture
def fake_blender(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """An executable fake Blender; ``SSP_BLENDER`` points at it for the test."""
    exe = tmp_path / "bin" / "Blender"
    exe.parent.mkdir()
    exe.write_text(f"#!{sys.executable}\n" + FAKE_SRC.read_text(encoding="utf-8"), encoding="utf-8")
    exe.chmod(exe.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    log = tmp_path / "fake.log"
    monkeypatch.setenv("SSP_BLENDER", str(exe))
    monkeypatch.setenv("FAKE_BLENDER_LOG", str(log))
    for var in ("FAKE_BLENDER_VERSION", "FAKE_BLENDER_MODE", "FAKE_BLENDER_PIXEL"):
        monkeypatch.delenv(var, raising=False)
    return exe


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A minimal repo: the real rig.py and palette plus two small vehicle scripts."""
    root = tmp_path / "repo"
    (root / "assets-src" / "blender" / "vehicles").mkdir(parents=True)
    (root / "assets-src" / "palette").mkdir(parents=True)
    shutil.copyfile(RIG, root / "assets-src" / "blender" / "rig.py")
    shutil.copyfile(PALETTE_PATH, root / "assets-src" / "palette" / "kerbside32.json")
    (root / "assets-src" / "blender" / "vehicles" / "testcar.py").write_text(SMALL_VEH, encoding="utf-8")
    (root / "assets-src" / "blender" / "vehicles" / "testcar_brush.py").write_text(SMALL_BRUSH, encoding="utf-8")
    return root


def _fake_log(tmp_path: Path) -> list[str]:
    log = tmp_path / "fake.log"
    return log.read_text(encoding="utf-8").split() if log.exists() else []


def _snapshot(folder: Path) -> dict[str, bytes]:
    return {str(p.relative_to(folder)): p.read_bytes() for p in sorted(folder.rglob("*")) if p.is_file()}


def _committed(repo: Path, asset_id: str = "veh.testcar") -> Path:
    return repo / "assets-src" / "rendered" / asset_id


def _seed_committed(repo: Path, asset_id: str = "veh.testcar") -> dict[str, bytes]:
    """A pre-existing committed folder with sentinel content, to prove it is left untouched."""
    dest = _committed(repo, asset_id)
    dest.mkdir(parents=True)
    Image.new("RGBA", (32, 32), (0, 0, 0, 0)).save(dest / "h00.png")
    (dest / "render.json").write_text('{"sentinel": true}\n', encoding="utf-8")
    return _snapshot(dest)


# ---------------------------------------------------------------------------------------------
# Version gate


@pytest.mark.parametrize(
    ("output", "version"),
    [
        ("Blender 5.2.2 LTS (hash d13f752e3b9c built 2026-09-15 01:49:19)\nBlender 5.2.2 LTS\n", "5.2.2 LTS"),
        ("Blender 5.3.0 (hash abc)\n", "5.3.0"),
        ("Blender 5.2.2\n", "5.2.2"),
        ("Read prefs: x\nBlender 4.2.9 LTS\n", "4.2.9 LTS"),
        ("no version here\n", None),
    ],
)
def test_blender_parse_version(output: str, version: str | None) -> None:
    assert blender.parse_version(output) == version


def test_blender_path_default_and_override() -> None:
    assert blender.blender_path({}) == Path("/Applications/Blender.app/Contents/MacOS/Blender")
    assert blender.blender_path({"SSP_BLENDER": "/opt/b/Blender"}) == Path("/opt/b/Blender")


def test_blender_version_flag_prints_version(fake_blender: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["blender", "--version"]) == 0
    assert capsys.readouterr().out == "Blender 5.2.2 LTS\n"


@pytest.mark.parametrize("version", ["5.3.0", "5.2.2", "4.2.9 LTS", "5.2.1 LTS"])
def test_blender_version_gate_refuses_before_rendering(
    version: str,
    fake_blender: Path,
    repo: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setenv("FAKE_BLENDER_VERSION", version)
    before = _seed_committed(repo)
    assert blender.run("veh.testcar", repo=repo) != 0
    assert blender.run("all", check=True, repo=repo) != 0
    err = capsys.readouterr().err
    assert "version mismatch" in err and version in err
    assert "render" not in _fake_log(tmp_path), "nothing may render after a failed version gate"
    assert not (repo / "build").exists()
    assert _snapshot(_committed(repo)) == before
    # Through the CLI too: --version prints what it found but exits non-zero.
    assert main(["blender", "--version"]) != 0
    assert capsys.readouterr().out == f"Blender {version}\n"
    assert main(["blender", "veh.does_not_matter"]) != 0
    assert "render" not in _fake_log(tmp_path)


def test_blender_missing_binary(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    monkeypatch.setenv("SSP_BLENDER", str(tmp_path / "nope" / "Blender"))
    assert main(["blender", "--version"]) == 1
    assert main(["blender", "veh.sweeper"]) == 1
    assert "not found" in capsys.readouterr().err


# ---------------------------------------------------------------------------------------------
# Script lookup and arguments


def test_blender_find_script_maps_id_to_class_dirs(repo: Path) -> None:
    v = repo / "assets-src" / "blender" / "vehicles"
    assert blender.find_script("veh.testcar", repo) == v / "testcar.py"
    assert blender.find_script("veh.testcar_brush", repo) == v / "testcar_brush.py"
    (repo / "assets-src" / "blender" / "props").mkdir()
    (repo / "assets-src" / "blender" / "props" / "lamp_post.py").write_text("CELL_PX = 32\nSTATES = {'slice': 4}\n")
    (repo / "assets-src" / "blender" / "roofkit").mkdir()
    (repo / "assets-src" / "blender" / "roofkit" / "ac_unit.py").write_text("CELL_PX = 32\nSTATES = ('body',)\n")
    assert blender.find_script("prop.lamp_post", repo).parent.name == "props"
    assert blender.find_script("roof.ac_unit", repo).parent.name == "roofkit"
    assert blender.all_asset_ids(repo) == ["prop.lamp_post", "roof.ac_unit", "veh.testcar", "veh.testcar_brush"]


def test_blender_find_script_errors(repo: Path) -> None:
    with pytest.raises(blender.BlenderError, match="no script for veh.bus"):
        blender.find_script("veh.bus", repo)
    (repo / "assets-src" / "blender" / "props").mkdir()
    (repo / "assets-src" / "blender" / "props" / "testcar.py").write_text(SMALL_VEH)
    with pytest.raises(blender.BlenderError, match="more than one script"):
        blender.find_script("veh.testcar", repo)
    (repo / "assets-src" / "blender" / "props" / "phone_box.py").write_text(SMALL_VEH)
    with pytest.raises(blender.BlenderError, match="class 'veh' scripts live in"):
        blender.find_script("veh.phone_box", repo)
    with pytest.raises(blender.BlenderError, match="not rendered in Blender"):
        blender.find_script("npc.old_woman", repo)
    with pytest.raises(blender.BlenderError, match="not an asset ID"):
        blender.find_script("Veh.Sweeper", repo)


def test_blender_parse_cell_px_and_states() -> None:
    assert blender.parse_cell_px("x = 1\nCELL_PX = 64\n") == 64
    assert blender.parse_cell_px("CELL_PX = 96  # brush overlay\n") == 96
    for bad in ("", "CELL_PX = 64\nCELL_PX = 32\n", "    CELL_PX = 64\n", "CELL_PX = 63\n"):
        with pytest.raises(blender.BlenderError):
            blender.parse_cell_px(bad)
    assert blender.parse_states('STATES = {"body": 1, "dented": 1}') == {"body": 1, "dented": 1}
    assert blender.parse_states('STATES = ("body", "dented")') == {"body": 1, "dented": 1}
    assert blender.parse_states('STATES: dict[str, int] = {"brush": 4}') == {"brush": 4}
    for bad in ("", "STATES = {}", 'STATES = {"Body": 1}', 'STATES = {"body": 0}', "STATES = f()", 'STATES = ("a", "a")'):
        with pytest.raises(blender.BlenderError):
            blender.parse_states(bad)


def test_blender_expected_frames_follow_render_folder_naming() -> None:
    body = blender.expected_frames({"body": 1, "dented": 1}, 32)
    assert len(body) == 64 and "h00.png" in body and "h31.png" in body and "dented_h07.png" in body
    brush = blender.expected_frames({"brush": 4}, 32)
    assert len(brush) == 128 and "brush_h07_2.png" in brush
    assert blender.expected_frames({"slice": 3}, 1) == ["slice_0.png", "slice_1.png", "slice_2.png"]
    assert blender.expected_frames({"body": 1}, 4) == ["h00.png", "h01.png", "h02.png", "h03.png"]
    with pytest.raises(blender.BlenderError):
        blender.expected_frames({"slice": 3}, 32)


def test_blender_load_asset_size_headings_and_argv(repo: Path) -> None:
    a = blender.load_asset("veh.testcar", repo)
    assert (a.cell_px, a.size, a.headings, dict(a.states)) == (8, 32, 32, {"body": 1, "dented": 1})
    assert blender.HEADINGS_BY_CLASS == {"veh": 32, "prop": 1, "roof": 4}
    assert blender.blender_argv("build/tmp/blender/veh.sweeper", 256, 32) == [
        "--out", "build/tmp/blender/veh.sweeper", "--size", "256", "--headings", "32", "--tilt", "0",
    ]  # fmt: skip
    assert blender.blender_command(Path("/B"), "s.py", ["--out", "o"]) == [
        "/B", "-b", "--factory-startup", "--python-exit-code", "1", "-P", "s.py", "--", "--out", "o",
    ]  # fmt: skip


def test_blender_manifest_cross_check(repo: Path) -> None:
    manifest = repo / "assets-src" / "manifest.json"
    entry = {"id": "veh.testcar", "cell": [8, 8], "dirs": "h32", "frames": {"body": 1, "dented": 1}}
    manifest.write_text(json.dumps({"assets": [entry]}))
    blender.load_asset("veh.testcar", repo)
    blender.load_asset("veh.testcar_brush", repo)  # no entry: no cross-check
    manifest.write_text(json.dumps({"assets": [{**entry, "cell": [64, 64]}]}))
    with pytest.raises(blender.BlenderError, match="manifest cell"):
        blender.load_asset("veh.testcar", repo)
    manifest.write_text(json.dumps({"assets": [{**entry, "frames": {"body": 1}}]}))
    with pytest.raises(blender.BlenderError, match="manifest frames"):
        blender.load_asset("veh.testcar", repo)
    manifest.write_text(json.dumps({"assets": [{**entry, "dirs": "h4"}]}))
    with pytest.raises(blender.BlenderError, match="manifest dirs"):
        blender.load_asset("veh.testcar", repo)


# ---------------------------------------------------------------------------------------------
# script_sha256


def _rig_function(name: str, namespace: dict[str, object]) -> object:
    """Pull one pure function out of rig.py (which imports bpy, so it cannot be imported here)."""
    tree = ast.parse(RIG.read_text(encoding="utf-8"))
    fn = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
    module = ast.Module(body=[fn], type_ignores=[])
    exec(compile(module, str(RIG), "exec"), namespace)  # noqa: S102 - a function body from our own rig.py
    return namespace[name]


def test_blender_script_sha256_is_script_nul_rig(tmp_path: Path) -> None:
    script, rig = tmp_path / "s.py", tmp_path / "rig.py"
    script.write_bytes(b"CELL_PX = 64\n")
    rig.write_bytes(b"# rig\n")
    want = hashlib.sha256(b"CELL_PX = 64\n" + b"\0" + b"# rig\n").hexdigest()
    assert blender.script_sha256(script, rig) == want
    assert blender.script_sha256(script, rig) != hashlib.sha256(b"CELL_PX = 64\n# rig\n").hexdigest()


def test_blender_rig_script_sha256_matches_forge(repo: Path) -> None:
    """rig.write_render_json and the wrapper agree on script_sha256."""
    rig_sha = _rig_function("script_sha256", {"hashlib": hashlib, "Path": Path, "REPO": repo})
    script = repo / "assets-src" / "blender" / "vehicles" / "testcar.py"
    rig = repo / "assets-src" / "blender" / "rig.py"
    want = hashlib.sha256(script.read_bytes() + b"\0" + rig.read_bytes()).hexdigest()
    assert rig_sha(script) == want == blender.script_sha256(script, rig)  # type: ignore[operator]


# ---------------------------------------------------------------------------------------------
# Rendering, failure detection and the swap


def test_blender_render_swaps_in_verified_frames(fake_blender: Path, repo: Path, capsys: pytest.CaptureFixture[str]) -> None:
    _seed_committed(repo)
    (_committed(repo) / "h40.png").write_bytes(b"stale")  # a stale frame disappears with the swap
    assert blender.run("veh.testcar", repo=repo) == 0
    assert "veh.testcar: rendered 64 frames (32x32)" in capsys.readouterr().out
    dest = _committed(repo)
    names = sorted(p.name for p in dest.iterdir())
    assert names == sorted([*blender.expected_frames({"body": 1, "dented": 1}, 32), "render.json"])
    data = json.loads((dest / "render.json").read_text())
    script = repo / "assets-src" / "blender" / "vehicles" / "testcar.py"
    assert data["script_sha256"] == blender.script_sha256(script, repo / "assets-src" / "blender" / "rig.py")
    assert data["argv"] == ["--out", "assets-src/rendered/veh.testcar", "--size", "32", "--headings", "32", "--tilt", "0"]
    assert data["blender_version"] == "5.2.2 LTS" and data["tilt_deg"] == 0
    assert data["pivots_px"]["h31"] == [4, 4]
    assert not list((repo / "assets-src" / "rendered").glob(".*")), "no staging folders left behind"
    assert (repo / "build" / "tmp" / "blender" / "veh.testcar" / "stderr.txt").is_file()


def test_blender_brush_overlay_frames(fake_blender: Path, repo: Path) -> None:
    assert blender.run("veh.testcar_brush", repo=repo) == 0
    pngs = list(_committed(repo, "veh.testcar_brush").glob("*.png"))
    assert len(pngs) == 128
    with Image.open(_committed(repo, "veh.testcar_brush") / "brush_h07_2.png") as im:
        assert im.size == (48, 48)


@pytest.mark.parametrize(
    "mode", ["traceback", "exit1", "missing_frame", "extra_frame", "bad_sha", "bad_argv", "no_render_json", "wrong_size"]
)
def test_blender_failed_render_leaves_target_byte_identical(
    mode: str, fake_blender: Path, repo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    before = _seed_committed(repo)
    monkeypatch.setenv("FAKE_BLENDER_MODE", mode)
    assert blender.run("veh.testcar", repo=repo) != 0
    err = capsys.readouterr().err
    assert "forge blender: veh.testcar:" in err
    assert _snapshot(_committed(repo)) == before
    assert not list((repo / "assets-src" / "rendered").glob(".*"))
    if mode == "traceback":
        assert "Traceback in stderr" in err
    if mode == "exit1":
        assert "exit status 1" in err


def test_blender_failed_first_render_creates_nothing(fake_blender: Path, repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAKE_BLENDER_MODE", "traceback")
    assert blender.run("veh.testcar", repo=repo) != 0
    assert not (repo / "assets-src" / "rendered").exists()


def test_blender_all_renders_every_script(fake_blender: Path, repo: Path) -> None:
    assert blender.run("all", repo=repo) == 0
    assert len(list(_committed(repo).glob("*.png"))) == 64
    assert len(list(_committed(repo, "veh.testcar_brush").glob("*.png"))) == 128


def test_blender_all_with_no_scripts(fake_blender: Path, tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    empty = tmp_path / "empty"
    empty.mkdir()
    assert blender.run("all", repo=empty) == 0
    assert "0 asset scripts" in capsys.readouterr().out


# ---------------------------------------------------------------------------------------------
# --check


def test_blender_check_identical_frames_report_zero(
    fake_blender: Path, repo: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    assert blender.run("veh.testcar", repo=repo) == 0
    before = _snapshot(_committed(repo))
    capsys.readouterr()
    assert blender.run("veh.testcar", check=True, repo=repo) == 0
    out = capsys.readouterr().out
    assert "veh.testcar h00.png: 0 changed px" in out
    assert "veh.testcar: 0 changed px in 0 of 64 frames" in out
    assert not (repo / "build" / "tmp" / "blender" / "veh.testcar" / "diff").exists()
    assert _snapshot(_committed(repo)) == before


def test_blender_check_one_pixel_change(
    fake_blender: Path, repo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    assert blender.run("veh.testcar", repo=repo) == 0
    before = _snapshot(_committed(repo))
    monkeypatch.setenv("FAKE_BLENDER_PIXEL", "1,2")
    capsys.readouterr()
    assert blender.run("veh.testcar", check=True, repo=repo) != 0
    out = capsys.readouterr().out
    assert "veh.testcar h00.png: 1 changed px" in out
    assert "veh.testcar: 64 changed px in 64 of 64 frames" in out
    diff = repo / "build" / "tmp" / "blender" / "veh.testcar" / "diff" / "h00.png"
    assert diff.is_file()
    assert _snapshot(_committed(repo)) == before, "--check replaces nothing"


def _png(path: Path, rgba: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba.astype(np.uint8), mode="RGBA").save(path)


def test_blender_compare_frames_on_synthetic_pngs(tmp_path: Path) -> None:
    base = np.zeros((16, 16, 4), dtype=np.uint8)
    base[4:12, 4:12] = (0xF2, 0xC1, 0x2E, 255)
    new, old, diff = tmp_path / "new", tmp_path / "old", tmp_path / "diff"
    _png(new / "h00.png", base)
    _png(old / "h00.png", base)
    report = blender.compare_frames(new, old, ["h00.png"], diff, PALETTE_PATH)
    assert report.clean and report.changed_px == 0 and not diff.exists()

    changed = base.copy()
    changed[0, 3] = (0x0F, 0x0E, 0x12, 255)
    _png(new / "h01.png", changed)
    _png(old / "h01.png", base)
    report = blender.compare_frames(new, old, ["h00.png", "h01.png"], diff, PALETTE_PATH)
    assert [(f.name, f.changed_px, f.status) for f in report.frames] == [("h00.png", 0, "same"), ("h01.png", 1, "changed")]
    assert not report.clean
    img = np.asarray(Image.open(diff / "h01.png").convert("RGBA"))
    pal = load_palette()
    red = pal.rgb[pal.index("postbox_red")]
    assert np.argwhere(np.all(img[..., :3] == red, axis=-1)).tolist() == [[0, 3]]
    assert not (diff / "h00.png").exists()
    # Every diff-PNG colour is a Kerbside-32 colour.
    colours = {tuple(c) for c in img[..., :3].reshape(-1, 3).tolist()}
    assert colours <= {tuple(int(v) for v in c) for c in pal.rgb}

    # An alpha-only change counts too.
    alpha = base.copy()
    alpha[8, 8, 3] = 0
    _png(tmp_path / "new2" / "h02.png", alpha)
    _png(tmp_path / "old2" / "h02.png", base)
    report = blender.compare_frames(tmp_path / "new2", tmp_path / "old2", ["h02.png"], diff, PALETTE_PATH)
    assert report.changed_px == 1 and not report.clean


def test_blender_compare_frames_new_removed_and_resized(tmp_path: Path) -> None:
    new, old, diff = tmp_path / "new", tmp_path / "old", tmp_path / "diff"
    _png(new / "h00.png", np.zeros((8, 8, 4)))
    _png(new / "h01.png", np.zeros((8, 8, 4)))
    _png(old / "h01.png", np.zeros((4, 4, 4)))
    _png(old / "h02.png", np.zeros((4, 4, 4)))
    report = blender.compare_frames(new, old, ["h00.png", "h01.png"], diff, PALETTE_PATH)
    assert [(f.name, f.status, f.changed_px) for f in report.frames] == [
        ("h00.png", "new", 64),
        ("h01.png", "size", 64),
        ("h02.png", "removed", 16),
    ]
    assert not report.clean
    # No committed folder at all: every frame is new.
    report = blender.compare_frames(new, tmp_path / "missing", ["h00.png"], diff, PALETTE_PATH)
    assert [f.status for f in report.frames] == ["new"]


# ---------------------------------------------------------------------------------------------
# Static rules of assets-src/blender (rig.py and every asset script)


def test_blender_sources_have_no_hex_literals() -> None:
    """`grep -rnE '#[0-9a-fA-F]{6}' assets-src/blender` prints nothing (CLAUDE.md §3.3)."""
    root = REPO_ROOT / "assets-src" / "blender"
    hits = [
        f"{p.relative_to(REPO_ROOT)}:{n}: {line.strip()}"
        for p in sorted(root.rglob("*"))
        if p.is_file() and "__pycache__" not in p.parts
        for n, line in enumerate(p.read_text(encoding="utf-8", errors="replace").splitlines(), 1)
        if HEX_RE.search(line)
    ]
    assert hits == []


def _rig_constants() -> dict[str, object]:
    out: dict[str, object] = {}
    for node in ast.parse(RIG.read_text(encoding="utf-8")).body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    try:
                        out[target.id] = ast.literal_eval(node.value)
                    except ValueError:
                        pass
                elif isinstance(target, ast.Tuple) and isinstance(node.value, ast.Tuple):
                    for t, v in zip(target.elts, node.value.elts, strict=True):
                        if isinstance(t, ast.Name):
                            out[t.id] = ast.literal_eval(v)
    return out


def test_blender_rig_constants() -> None:
    c = _rig_constants()
    assert c["SUN_AZIMUTH_DEG"] == 315.0 and c["SUN_ELEVATION_DEG"] == 50.0
    assert c["T_BASE"] == 0.33 and c["T_LIT"] == 0.83  # settled in SSP-008 (ASSET_PIPELINE §7.2)
    assert c["PX_PER_M"] == 16
    assert c["BLENDER_VERSION"] == blender.REQUIRED_VERSION
    # A flat top face scores sin(50 deg) = 0.766, between the thresholds -> base.
    assert c["T_BASE"] < math.sin(math.radians(50.0)) < c["T_LIT"]  # type: ignore[operator]
    # 45 deg chamfers at the 32 headings' sun offsets (0, 11.25, ... deg) keep >= 0.03 from both thresholds.
    el = math.radians(50.0)
    for k in range(17):
        t = math.radians(45.0 + 11.25 * (k - 4))
        dot = math.sin(math.radians(45.0)) * (math.sin(el) + math.cos(el) * math.cos(t))
        assert abs(dot - c["T_BASE"]) >= 0.03 and abs(dot - c["T_LIT"]) >= 0.03  # type: ignore[operator]


def test_blender_rig_render_settings_present() -> None:
    text = RIG.read_text(encoding="utf-8")
    for needle in (
        'cam_data.type = "ORTHO"',
        "cam_data.ortho_scale = cell_px / PX_PER_M",
        'vs.view_transform = "Standard"',
        'vs.look = "None"',
        "vs.exposure = 0.0",
        "vs.gamma = 1.0",
        "r.dither_intensity = 0.0",
        "r.film_transparent = True",
        "scene.eevee.taa_render_samples = 1",
        "r.filter_size = 0.0",
        'r.image_settings.color_mode = "RGBA"',
        'r.image_settings.color_depth = "8"',
        "r.resolution_percentage = 100",
        'ramp.color_ramp.interpolation = "CONSTANT"',
        'type="SUN"',
    ):
        assert needle in text, needle
    assert set(re.findall(r'view_transform\s*=\s*"(\w+)"', text)) == {"Standard"}
    assert set(re.findall(r'\.look\s*=\s*"(\w+)"', text)) == {"None"}
    # Unlit (Emission only), and no shadow catchers or ground planes.
    for banned in ("ShaderNodeBsdf", "primitive_plane_add", "is_shadow_catcher"):
        assert banned not in text, banned


def test_blender_rig_headings_rotate_root_clockwise() -> None:
    heading_rad = _rig_function("heading_rad", {"math": math})
    assert heading_rad(0, 32) == 0.0  # type: ignore[operator]
    assert heading_rad(8, 32) == pytest.approx(-math.pi / 2)  # type: ignore[operator]  # h08 = east
    sun = _rig_function("sun_vector", {"math": math, "SUN_AZIMUTH_DEG": 315.0, "SUN_ELEVATION_DEG": 50.0})()  # type: ignore[operator]
    assert sun[0] < 0 < sun[1] and sun[2] == pytest.approx(math.sin(math.radians(50.0)))  # north-west, up
    assert sum(v * v for v in sun) == pytest.approx(1.0)


def test_blender_rig_pal_reproduces_exact_palette_bytes() -> None:
    """pal() converts sRGB -> linear; 'Standard' encodes linear -> sRGB, which must round-trip every colour."""
    to_linear = _rig_function("_srgb_to_linear", {})
    pal = load_palette()
    for i, name in enumerate(pal.names):
        for channel in range(3):
            v = int(pal.rgb[i][channel])
            lin = to_linear(v / 255)  # type: ignore[operator]
            srgb = lin * 12.92 if lin <= 0.0031308 else 1.055 * lin ** (1 / 2.4) - 0.055
            assert round(srgb * 255) == v, (name, channel)


def test_blender_module_import_is_deferred() -> None:
    """Other forge subcommands never import blender.py: only ``forge blender`` loads it."""
    main_src = (REPO_ROOT / "tools" / "forge" / "forge" / "__main__.py").read_text(encoding="utf-8")
    assert "    from forge import blender" in main_src
    assert not re.search(r"^(from forge import blender|import forge\.blender)", main_src, re.MULTILINE)
