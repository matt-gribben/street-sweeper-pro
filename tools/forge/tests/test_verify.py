"""Tests for ``forge verify`` (byte and ``--pixels`` modes) on a synthetic repo.

The audio and level tools are replaced by a recording runner, so these tests never depend
on Node; the real guards are exercised by ``npm run assets:verify``.
"""

from __future__ import annotations

import argparse
import io
import json
from collections.abc import Sequence
from pathlib import Path

import numpy as np
import pytest
from PIL import Image
from test_build import add_grid, add_toy_renders, blender_entry, grid_entry, make_repo

from forge import verify as verify_mod
from forge.build import build
from forge.outputs import ASSETS_TS, ATLAS_DIR, HASHES_JSON, sha256_hex
from forge.verify import PIXELS_IDENTICAL, TOOL_SCRIPTS, VERIFY_DIR, VerifyReport, compare_trees, tool_commands, verify

ACTORS_PNG = f"{ATLAS_DIR}/actors.png"
ACTORS_JSON = f"{ATLAS_DIR}/actors.json"


class Recorder:
    """A fake subprocess runner: records each command line and returns a fixed status."""

    def __init__(self, status: int = 0) -> None:
        self.status = status
        self.calls: list[list[str]] = []

    def __call__(self, cmd: Sequence[str]) -> int:
        self.calls.append(list(cmd))
        return self.status


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A synthetic repo whose committed outputs come from a normal ``forge build``."""
    r = make_repo(tmp_path, [blender_entry(), grid_entry(atlas="items")])
    add_toy_renders(r)
    add_grid(r)
    build(repo_root=r, use_cache=False)
    return r


def run(repo: Path, *, pixels: bool = False, status: int = 0) -> tuple[VerifyReport, Recorder]:
    rec = Recorder(status)
    report = verify(repo_root=repo, pixels=pixels, runner=rec)
    return report, rec


def by_path(report: VerifyReport) -> dict[str, verify_mod.FileReport]:
    return {f.path: f for f in report.files}


def reencode(path: Path, *, compress_level: int = 1, poke: tuple[int, int] | None = None) -> None:
    """Re-encode a PNG with other zlib settings (same pixels unless ``poke`` changes one)."""
    with Image.open(path) as im:
        im.load()
        out = im.copy()
        transparency = im.info.get("transparency")
    if poke is not None:
        x, y = poke
        out.putpixel((x, y), (int(out.getpixel((x, y))) + 1) % 32)
    buf = io.BytesIO()
    out.save(buf, format="PNG", compress_level=compress_level, transparency=transparency)
    assert buf.getvalue() != path.read_bytes() or poke is not None
    path.write_bytes(buf.getvalue())


def rewrite_hashes(repo: Path) -> None:
    """Make the committed asset-hashes.json match the committed bytes (as another machine would)."""
    hashes = json.loads((repo / HASHES_JSON).read_text(encoding="utf-8"))
    fresh = {k: sha256_hex((repo / k).read_bytes()) for k in sorted(hashes)}
    (repo / HASHES_JSON).write_text(json.dumps(fresh, indent=2) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------------------------


def test_clean_checkout_verifies(repo: Path) -> None:
    report, rec = run(repo)
    assert report.ok, [f.line() for f in report.files] + report.errors
    assert sorted(by_path(report)) == sorted(
        [ACTORS_JSON, ACTORS_PNG, f"{ATLAS_DIR}/items.json", f"{ATLAS_DIR}/items.png", ASSETS_TS, HASHES_JSON]
    )
    assert all(f.line().startswith("ok    ") for f in report.files)
    # The rebuild went to build/tmp/verify/ with the same layout.
    tmp = repo / VERIFY_DIR
    assert (tmp / ACTORS_PNG).read_bytes() == (repo / ACTORS_PNG).read_bytes()
    assert (tmp / "frames" / "veh.toy").is_dir()
    assert not (repo / "build" / ".forge-cache" / "entries").exists(), "verify always rebuilds cold"


def test_tools_run_with_out_under_the_verify_root(repo: Path) -> None:
    _, rec = run(repo)
    tmp = str(repo / VERIFY_DIR)
    assert [c[1] for c in rec.calls] == [str(repo / s) for s in TOOL_SCRIPTS]
    for c in rec.calls:
        assert c[-2:] == ["--out", tmp]


def test_a_failing_tool_fails_verify(repo: Path) -> None:
    report, _ = run(repo, status=3)
    assert not report.ok
    assert report.errors[0] == "render-sfx.ts exited 3 (with --out under the verify root)"
    assert len(report.errors) == 3


def test_default_tool_commands() -> None:
    cmds = tool_commands(Path("/r"), Path("/r/build/tmp/verify"), node="/bin/node")
    assert cmds == [
        ["/bin/node", "/r/tools/audio/render-sfx.ts", "--out", "/r/build/tmp/verify"],
        ["/bin/node", "/r/tools/audio/render-music.ts", "--out", "/r/build/tmp/verify"],
        ["/bin/node", "/r/tools/levels/compile-level.ts", "--out", "/r/build/tmp/verify"],
    ]


def test_one_changed_byte_fails_naming_the_file(repo: Path) -> None:
    png = repo / ACTORS_PNG
    data = bytearray(png.read_bytes())
    data[len(data) // 2] ^= 0x01
    png.write_bytes(bytes(data))
    report, _ = run(repo)
    assert not report.ok
    assert [f.path for f in report.failed] == [ACTORS_PNG]
    line = by_path(report)[ACTORS_PNG].line()
    assert line.startswith(f"FAIL  {ACTORS_PNG}: bytes differ")
    assert "do not match their asset-hashes.json entry" in line
    # --pixels decodes it: a corrupted PNG is a real difference, not encoder drift.
    report, _ = run(repo, pixels=True)
    assert [f.path for f in report.failed] == [ACTORS_PNG]
    assert "pixels differ" in by_path(report)[ACTORS_PNG].line()


def test_reencoded_png_is_pixels_identical_bytes_differ(repo: Path) -> None:
    reencode(repo / ACTORS_PNG)
    report, _ = run(repo)
    assert [f.path for f in report.failed] == [ACTORS_PNG], "byte mode fails"
    report, _ = run(repo, pixels=True)
    assert report.ok, [f.line() for f in report.files]
    assert PIXELS_IDENTICAL in by_path(report)[ACTORS_PNG].notes
    assert by_path(report)[ACTORS_PNG].line().startswith(f"ok    {ACTORS_PNG}: {PIXELS_IDENTICAL}")


def test_encoder_drift_in_the_hash_listing_is_tolerated_only_with_pixels(repo: Path) -> None:
    # As if the outputs were committed from a machine whose encoder writes other bytes.
    reencode(repo / ACTORS_PNG)
    rewrite_hashes(repo)
    report, _ = run(repo)
    assert sorted(f.path for f in report.failed) == sorted([ACTORS_PNG, HASHES_JSON])
    report, _ = run(repo, pixels=True)
    assert report.ok, [f.line() for f in report.files]
    assert "whose pixels are identical" in by_path(report)[HASHES_JSON].line()
    # A JSON difference is never tolerated.
    (repo / ACTORS_JSON).write_text((repo / ACTORS_JSON).read_text(encoding="utf-8").replace('"x": ', '"x":  '))
    rewrite_hashes(repo)
    report, _ = run(repo, pixels=True)
    assert sorted(f.path for f in report.failed) == sorted([ACTORS_JSON, HASHES_JSON])


def test_real_pixel_difference_is_reported_with_pixels(repo: Path) -> None:
    pixels = np.asarray(Image.open(repo / ACTORS_PNG))
    y, x = (int(v[0]) for v in np.nonzero(pixels < 32))
    reencode(repo / ACTORS_PNG, compress_level=9, poke=(x, y))
    report, _ = run(repo, pixels=True)
    assert [f.path for f in report.failed] == [ACTORS_PNG]
    assert "pixels differ: 1 pixel(s) differ" in by_path(report)[ACTORS_PNG].line()


def test_missing_stale_and_unlisted_files(repo: Path) -> None:
    (repo / ACTORS_JSON).unlink()
    extra = repo / "public" / "assets" / "fonts" / "old.json"
    extra.parent.mkdir(parents=True)
    extra.write_text("{}\n", encoding="utf-8")
    report, _ = run(repo)
    rows = by_path(report)
    assert "missing: generated by the rebuild but not committed" in rows[ACTORS_JSON].line()
    assert "stale: committed but not generated" in rows["public/assets/fonts/old.json"].line()
    assert not report.ok


def test_generated_file_not_in_the_listing_is_reported(repo: Path) -> None:
    hashes = json.loads((repo / HASHES_JSON).read_text(encoding="utf-8"))
    del hashes[ASSETS_TS]
    hashes["public/assets/atlas/ghost.png"] = "0" * 64
    (repo / HASHES_JSON).write_text(json.dumps(hashes, indent=2) + "\n", encoding="utf-8")
    report, _ = run(repo)
    rows = by_path(report)
    assert "unlisted: generated but not listed" in rows[ASSETS_TS].line()
    assert "listed in public/assets/asset-hashes.json but not generated" in rows["public/assets/atlas/ghost.png"].line()
    assert not rows[HASHES_JSON].ok


def test_unreadable_hash_listing(repo: Path) -> None:
    (repo / HASHES_JSON).write_text("[1, 2]\n", encoding="utf-8")
    report, _ = run(repo)
    assert "asset-hashes.json is unreadable" in by_path(report)[HASHES_JSON].line()


def test_build_error_fails_verify(repo: Path) -> None:
    (repo / "assets-src" / "manifest.json").write_text('{"assets": [{"id": "bad"}]}', encoding="utf-8")
    report, rec = run(repo)
    assert not report.ok and report.files == [] and rec.calls == []
    assert report.errors[0].startswith("forge build failed: manifest:")


def test_compare_trees_directly(tmp_path: Path) -> None:
    a, b = tmp_path / "a", tmp_path / "b"
    for root in (a, b):
        (root / "src" / "gen").mkdir(parents=True)
        (root / ASSETS_TS).write_text("x\n", encoding="utf-8")
    assert [f.ok for f in compare_trees(a, b)] == [True]
    (b / ASSETS_TS).write_text("y\n", encoding="utf-8")
    (only,) = compare_trees(a, b, pixels=True)
    assert only.problems and only.problems[0].startswith("bytes differ"), "TS is byte-compared even with --pixels"


def _cli(repo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], *argv: str) -> tuple[int, str, str]:
    def fake(*, pixels: bool = False) -> VerifyReport:
        return verify(repo_root=repo, pixels=pixels, runner=Recorder())

    monkeypatch.setattr(verify_mod, "verify", fake)
    status = verify_mod.cli(argparse.Namespace(pixels="--pixels" in argv))
    out = capsys.readouterr()
    return status, out.out, out.err


def test_cli_reports_every_file_and_exit_status(
    repo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    status, out, _ = _cli(repo, monkeypatch, capsys)
    assert status == 0
    assert f"forge verify: ok    {ACTORS_PNG}" in out and out.rstrip().endswith("forge verify: OK")
    reencode(repo / ACTORS_PNG)
    status, out, err = _cli(repo, monkeypatch, capsys)
    assert status == 1
    assert f"forge verify: FAIL  {ACTORS_PNG}" in out
    assert f"1 file(s) differ from a clean rebuild: {ACTORS_PNG}" in err
    status, out, _ = _cli(repo, monkeypatch, capsys, "--pixels")
    assert status == 0
    assert f"{ACTORS_PNG}: {PIXELS_IDENTICAL}" in out
