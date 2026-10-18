"""Tests for the ``python -m forge`` CLI skeleton (ASSET_PIPELINE §5.3)."""

from __future__ import annotations

import subprocess
import sys

import pytest

from forge.__main__ import EXIT_NOT_IMPLEMENTED, NOT_IMPLEMENTED_UNTIL, _not_implemented, build_parser, main

SUBCOMMANDS = ("build", "ingest", "blender", "gen-ai", "lint", "sheets", "verify")
IMPLEMENTED = frozenset({"blender", "build", "gen-ai", "ingest", "lint", "sheets", "verify"})  # SSP-007
# (test_blender.py), SSP-009 (test_build.py), SSP-010 (test_verify.py), SSP-011 (test_lint.py, test_sheets.py),
# SSP-012 (test_genai.py), SSP-013 (test_ingest.py)

# Each subcommand invoked with every documented flag (ASSET_PIPELINE §5.3).
FULL_INVOCATIONS: dict[str, list[str]] = {
    "build": ["build", "--only", "veh.sweeper", "npc.old_woman", "--out", "build/tmp/x", "--no-cache"],
    "ingest": ["ingest", "litter.sheet_01", "--force", "--dry-run"],
    "blender": ["blender", "all", "--check"],
    "gen-ai": [
        "gen-ai",
        "--tool",
        "codex",
        "litter.sheet_01",
        "--tool",
        "cursor",
        "--candidates",
        "3",
        "--ref",
        "a.png",
        "--ref",
        "b.png",
    ],
    "lint": ["lint", "--only", "veh.sweeper", "--warn-as-error"],
    "sheets": ["sheets", "--atlas", "actors", "--only", "veh.sweeper"],
    "verify": ["verify", "--pixels"],
}

MINIMAL_INVOCATIONS: dict[str, list[str]] = {
    "build": ["build"],
    "ingest": ["ingest", "npc.old_woman"],
    "blender": ["blender", "veh.sweeper"],
    "gen-ai": ["gen-ai", "concept.spike_street"],
    "lint": ["lint"],
    "sheets": ["sheets"],
    "verify": ["verify"],
}


def _run_module(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "forge", *args],
        capture_output=True,
        text=True,
        check=False,
    )


def test_every_documented_subcommand_has_a_real_handler() -> None:
    assert set(IMPLEMENTED) == set(SUBCOMMANDS)
    assert NOT_IMPLEMENTED_UNTIL == {}, "every subcommand has landed; a new stub needs an entry and a test"
    assert set(FULL_INVOCATIONS) == set(SUBCOMMANDS) == set(MINIMAL_INVOCATIONS)
    parser = build_parser()
    for cmd in SUBCOMMANDS:
        assert parser.parse_args(MINIMAL_INVOCATIONS[cmd]).handler is not _not_implemented, cmd


def test_help_lists_every_subcommand() -> None:
    result = _run_module("--help")
    assert result.returncode == 0
    for cmd in SUBCOMMANDS:
        assert cmd in result.stdout


def test_genai_cursor_exits_non_zero_subprocess() -> None:
    result = _run_module("gen-ai", "x", "--tool", "cursor")
    assert result.returncode == EXIT_NOT_IMPLEMENTED
    assert "not implemented until needed" in result.stderr
    assert result.stdout == ""


def test_parsed_flags() -> None:
    parser = build_parser()
    a = parser.parse_args(FULL_INVOCATIONS["build"])
    assert a.only == ["veh.sweeper", "npc.old_woman"] and a.out == "build/tmp/x" and a.no_cache
    a = parser.parse_args(["build", "--only", "a", "--only", "b"])
    assert a.only == ["a", "b"]
    a = parser.parse_args(FULL_INVOCATIONS["gen-ai"])
    assert a.id == "litter.sheet_01"
    assert a.tool == "cursor", "the last --tool wins (npm gen:ai prepends --tool codex)"
    assert (a.candidates, a.accept, a.ref) == (3, None, ["a.png", "b.png"])
    a = parser.parse_args(["gen-ai", "x"])
    assert (a.tool, a.candidates, a.accept) == ("codex", None, None)
    a = parser.parse_args(["gen-ai", "x", "--accept", "0"])
    assert a.accept == 0, "candidate runs are numbered from run_00"
    a = parser.parse_args(FULL_INVOCATIONS["ingest"])
    assert (a.id, a.force, a.dry_run) == ("litter.sheet_01", True, True)
    a = parser.parse_args(FULL_INVOCATIONS["blender"])
    assert (a.id, a.check, a.blender_version) == ("all", True, False)
    a = parser.parse_args(["blender", "--version"])
    assert (a.id, a.check, a.blender_version) == (None, False, True)
    a = parser.parse_args(FULL_INVOCATIONS["lint"])
    assert (a.only, a.warn_as_error) == (["veh.sweeper"], True)
    a = parser.parse_args(FULL_INVOCATIONS["sheets"])
    assert (a.atlas, a.only) == ("actors", ["veh.sweeper"])
    a = parser.parse_args(FULL_INVOCATIONS["verify"])
    assert a.pixels


@pytest.mark.parametrize(
    "argv",
    [
        ["-v", "gen-ai", "x", "--tool", "cursor"],
        ["gen-ai", "x", "-v", "--tool", "cursor"],
        ["--verbose", "gen-ai", "x", "--tool", "codex", "--tool", "cursor"],
    ],
)
def test_global_verbose_before_or_after_subcommand(argv: list[str], capsys: pytest.CaptureFixture[str]) -> None:
    assert build_parser().parse_args(argv).verbose is True
    assert main(argv) == EXIT_NOT_IMPLEMENTED
    err = capsys.readouterr().err
    assert "forge: forge gen-ai: arguments" in err, "-v enables per-step debug logging"


def test_verbose_off_by_default(capsys: pytest.CaptureFixture[str]) -> None:
    assert build_parser().parse_args(["lint"]).verbose is False
    main(["gen-ai", "x", "--tool", "cursor"])
    assert "forge: forge " not in capsys.readouterr().err


@pytest.mark.parametrize(
    "argv",
    [
        [],
        ["unknown"],
        ["ingest"],
        ["blender"],
        ["blender", "--check"],
        ["blender", "--version", "veh.sweeper"],
        ["blender", "--version", "--check"],
        ["gen-ai"],
        ["gen-ai", "x", "--tool", "dalle"],
        ["gen-ai", "x", "--candidates", "0"],
        ["gen-ai", "x", "--accept", "-1"],
        ["gen-ai", "x", "--candidates", "2", "--accept", "1"],
        ["sheets", "--atlas", "nope"],
    ],
)
def test_usage_errors_exit_2(argv: list[str]) -> None:
    with pytest.raises(SystemExit) as exc:
        main(argv)
    assert exc.value.code == 2
