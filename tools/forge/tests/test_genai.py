"""Tests for ``forge gen-ai`` (SSP-012): the Codex wrapper, ``prompt.md`` handling, output
verification, ``--candidates``, ``--accept`` and ``review.png``.

Codex never runs here (CLAUDE.md hard rule 5): ``SSP_CODEX`` points at ``fake_codex.py`` and
``HOME`` / ``CODEX_HOME`` point at temp dirs, so the fake ``~/.codex/generated_images`` is
isolated from the real one.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from forge import genai
from forge.__main__ import EXIT_NOT_IMPLEMENTED, build_parser
from forge.ingest import parse_config
from forge.ipdenylist import DENYLIST_PATH, compile_term, find_blocked_terms, load_denylist
from forge.palette import REPO_ROOT, load_palette

FAKE_SRC = Path(__file__).with_name("fake_codex.py")
PROBE = REPO_ROOT / "assets-src" / "_probe"
PROBE_LOGS = {
    "codex": (PROBE / "codex" / "events.jsonl", "old_woman_sheet.png", "01a14d13-72ab-72a1-9953-765c8a00398c"),
    "codex4": (PROBE / "codex4" / "events.jsonl", "rubbish_sheet.png", "01a14d18-bb2c-7673-8334-e18b37c30684"),
}
ASSET = "concept.test_street"

PROMPT = """# concept.test_street

| Key | Value |
|---|---|
| Asset IDs | concept.test_street |
| Tool | codex |
| Output file | street.png |
| Aspect | 2:1 |
| References | {refs} |
| Preamble | v0 |

Human notes above the marker are never sent.

<!-- forge:send -->
<!-- forge:begin agent-instructions -->
stale instructions
<!-- forge:end agent-instructions -->

<!-- forge:begin preamble v0 -->
stale preamble
<!-- forge:end preamble -->

## Asset brief

{brief}
"""
BRIEF = "A straight-down street with a yellow sweeper truck, seen from directly above."


# ---------------------------------------------------------------------------------------------
# Fixtures and helpers


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    """A minimal repo: the real preamble plus one concept prompt."""
    root = tmp_path / "repo"
    (root / "assets-src" / "ai" / ASSET).mkdir(parents=True)
    shutil.copyfile(REPO_ROOT / genai.PREAMBLE_PATH, root / genai.PREAMBLE_PATH)
    write_prompt(root)
    return root


def write_prompt(root: Path, brief: str = BRIEF, refs: str = "none") -> Path:
    path = root / "assets-src" / "ai" / ASSET / "prompt.md"
    path.write_text(PROMPT.format(brief=brief, refs=refs), encoding="utf-8")
    return path


@pytest.fixture
def env(tmp_path: Path) -> dict[str, str]:
    """Environment for the wrapper: fake codex binary, fake HOME, call log."""
    exe = tmp_path / "bin" / "codex"
    exe.parent.mkdir()
    exe.write_text(f"#!{sys.executable}\n" + FAKE_SRC.read_text(encoding="utf-8"), encoding="utf-8")
    exe.chmod(exe.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    home = tmp_path / "home"
    home.mkdir()
    return {
        "PATH": "/usr/bin:/bin",
        "HOME": str(home),
        "SSP_CODEX": str(exe),
        "FAKE_CODEX_LOG": str(tmp_path / "codex_calls.jsonl"),
    }


def calls(env: dict[str, str]) -> list[dict[str, object]]:
    log = Path(env["FAKE_CODEX_LOG"])
    if not log.exists():
        return []
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]


def exec_calls(env: dict[str, str]) -> list[dict[str, object]]:
    return [c for c in calls(env) if c["argv"] != ["--version"]]


def run(repo: Path, env: dict[str, str], *flags: str) -> int:
    args = build_parser().parse_args(["gen-ai", ASSET, *flags])
    return genai.cli(args, repo_root=repo, env=env)


def run_dir(repo: Path, n: int = 0) -> Path:
    return repo / "build" / "ai-candidates" / ASSET / f"run_{n:02d}"


def sent_bytes(path: Path) -> bytes:
    data = path.read_bytes()
    marker = b"<!-- forge:send -->\n"
    assert data.count(marker) == 1
    return data[data.index(marker) + len(marker) :]


# ---------------------------------------------------------------------------------------------
# argv, stdin, model pin, version gate


def test_genai_argv_pins_model_ends_with_dash_and_pipes_prompt_on_stdin(
    repo: Path, env: dict[str, str], capsys: pytest.CaptureFixture[str]
) -> None:
    assert run(repo, env, "--candidates", "1") == 0, capsys.readouterr().err
    (call,) = exec_calls(env)
    argv = call["argv"]
    assert isinstance(argv, list)
    i = argv.index("-m")
    assert argv[i + 1] == "gpt-6.1-sol" == genai.CODEX_MODEL
    assert argv[-1] == "-", "the prompt must arrive on stdin, never as a positional argument"
    assert argv[0] == "exec"
    for flag in ("--skip-git-repo-check", "--ephemeral", "--json"):
        assert flag in argv
    assert argv[argv.index("-s") + 1] == "workspace-write"
    workdir = run_dir(repo)
    assert Path(argv[argv.index("-C") + 1]) == workdir.resolve()
    assert Path(argv[argv.index("-o") + 1]) == (workdir / "last_message.txt").resolve()
    assert "-i" not in argv, "References: none"
    prompt = repo / "assets-src" / "ai" / ASSET / "prompt.md"
    assert call["stdin"].encode("utf-8") == sent_bytes(prompt), "stdin carries exactly the bytes after the marker"
    assert call["stdin_isatty"] is False
    assert (workdir / "events.jsonl").read_text(encoding="utf-8").startswith('{"type": "thread.started"')
    assert (workdir / "last_message.txt").read_text(encoding="utf-8") == "DONE"
    assert (workdir / "stderr.txt").exists()


def test_genai_codex_argv_shape_with_refs() -> None:
    argv = genai.codex_argv("codex", "m", "w", "w/last.txt", ["a.png", "b.png"])
    assert argv == [
        "codex", "exec", "-m", "m", "--skip-git-repo-check", "--ephemeral", "-s", "workspace-write",
        "-C", "w", "--json", "-o", "w/last.txt", "-i", "a.png", "-i", "b.png", "-",
    ]  # fmt: skip


def test_genai_model_env_override(repo: Path, env: dict[str, str]) -> None:
    env["SSP_CODEX_MODEL"] = "some-other-model"
    assert run(repo, env) == 0
    argv = exec_calls(env)[0]["argv"]
    assert isinstance(argv, list)
    assert argv[argv.index("-m") + 1] == "some-other-model"
    meta = json.loads((run_dir(repo) / "meta.json").read_text(encoding="utf-8"))
    assert meta["model"].startswith("some-other-model (agent, pinned via -m)")


def test_genai_refuses_wrong_codex_version(repo: Path, env: dict[str, str], capsys: pytest.CaptureFixture[str]) -> None:
    env["FAKE_CODEX_VERSION"] = "codex-cli 0.161.0"
    assert run(repo, env) == 1
    assert "codex-cli 0.160.1" in capsys.readouterr().err
    assert exec_calls(env) == [], "no exec after a failed version gate"
    assert [c["argv"] for c in calls(env)] == [["--version"]]


def test_genai_missing_codex_binary(repo: Path, env: dict[str, str], capsys: pytest.CaptureFixture[str]) -> None:
    env["SSP_CODEX"] = str(Path(env["HOME"]) / "nope" / "codex")
    assert run(repo, env) == 1
    assert "Codex CLI not found" in capsys.readouterr().err


def test_genai_default_binary_is_the_absolute_local_path() -> None:
    cfg = genai.resolve_config({"HOME": "/Users/x"})
    assert cfg.binary == Path("/Users/x/.local/bin/codex")
    assert cfg.model == "gpt-6.1-sol"
    assert cfg.generated_images == Path("/Users/x/.codex/generated_images")
    cfg = genai.resolve_config({"HOME": "/Users/x", "CODEX_HOME": "/tmp/ch", "SSP_CODEX": "~/bin/c"})
    assert cfg.generated_images == Path("/tmp/ch/generated_images")
    assert cfg.binary == Path("/Users/x/bin/c")


# ---------------------------------------------------------------------------------------------
# Trademark refusal


def test_genai_denylisted_prompt_is_refused_before_any_subprocess(
    repo: Path, env: dict[str, str], capsys: pytest.CaptureFixture[str]
) -> None:
    prompt = write_prompt(repo, brief=BRIEF + " In the style of Grand Theft Auto.")
    before = prompt.read_bytes()
    assert run(repo, env, "--candidates", "2") == 1
    err = capsys.readouterr().err
    assert "refusing to send" in err and "Grand Theft Auto" in err
    assert calls(env) == [], "not even codex --version may run"
    assert not (repo / "build").exists(), "no run dir is created"
    assert prompt.read_bytes() == before, "prompt.md is not refreshed either"


@pytest.mark.parametrize(
    ("text", "blocked"),
    [
        ("grand_theft_auto", True),
        ("GrandTheftAuto", True),
        ("a GTA-style map", True),
        ("prop.gta_sign", True),
        ("agta", False),
        ("paperboys on bikes", True),
        ("dog walkers and a coke street", False),
    ],
)
def test_genai_denylist_matches_the_shared_rules(text: str, blocked: bool) -> None:
    assert bool(find_blocked_terms(text, load_denylist(DENYLIST_PATH))) is blocked


def test_genai_denylist_word_and_substring_modes() -> None:
    word = compile_term("Sega", "word")
    assert word.pattern.search("SEGA") and not word.pattern.search("segment")
    sub = compile_term("Paperboy", "substring")
    assert sub.pattern.search("xpaperboyx")


# ---------------------------------------------------------------------------------------------
# prompt.md (§8.4)


def test_genai_prompt_sha256_covers_exactly_the_bytes_after_the_marker(repo: Path, env: dict[str, str]) -> None:
    assert run(repo, env) == 0
    prompt = repo / "assets-src" / "ai" / ASSET / "prompt.md"
    meta = json.loads((run_dir(repo) / "meta.json").read_text(encoding="utf-8"))
    assert meta["prompt_sha256"] == hashlib.sha256(sent_bytes(prompt)).hexdigest()
    assert meta["prompt_sha256"] == genai.prompt_sha256(prompt.read_text(encoding="utf-8"))
    # The header is not hashed: editing a human note above the marker keeps the hash.
    text = prompt.read_text(encoding="utf-8").replace("Human notes", "Edited human notes")
    assert genai.prompt_sha256(text) == meta["prompt_sha256"]
    # One byte after the marker changes it.
    assert genai.prompt_sha256(text.replace("yellow sweeper", "yellow  sweeper")) != meta["prompt_sha256"]


def test_genai_refreshes_agent_instructions_and_preamble_in_place(repo: Path, env: dict[str, str]) -> None:
    assert run(repo, env) == 0
    text = (repo / "assets-src" / "ai" / ASSET / "prompt.md").read_text(encoding="utf-8")
    preamble = (repo / genai.PREAMBLE_PATH).read_text(encoding="utf-8").split("\n", 1)[1].rstrip("\n")
    assert "stale" not in text
    assert "| Preamble | v1 |" in text
    assert f"<!-- forge:begin preamble v1 -->\n{preamble}\n<!-- forge:end preamble -->" in text
    expected_agent = (
        "<!-- forge:begin agent-instructions -->\n"
        "Use your built-in image generation tool to create the image described below. Copy the resulting\n"
        "PNG into the current working directory as street.png. Do not draw it with code: do not use Python,\n"
        "PIL, SVG, canvas or any other programmatic method. Do not create or edit any other file.\n"
        "When finished, reply with the single word DONE.\n"
        "<!-- forge:end agent-instructions -->"
    )
    assert expected_agent in text
    assert text.index(expected_agent) < text.index("<!-- forge:begin preamble v1 -->") < text.index("## Asset brief")
    assert text.rstrip().endswith(BRIEF)
    # Idempotent: a second refresh changes nothing.
    assert genai.refresh_prompt(text, genai.load_preamble(repo)).text == text


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda t: t.replace("<!-- forge:send -->\n", ""), "exactly one '<!-- forge:send -->'"),
        (lambda t: t.replace("<!-- forge:send -->\n", "<!-- forge:send -->\n<!-- forge:send -->\n"), "exactly one"),
        (lambda t: t.replace("| Output file | street.png |", "| Output file | ../x.png |"), "Output file"),
        (lambda t: t.replace("<!-- forge:end agent-instructions -->", ""), "agent-instructions"),
        (lambda t: t.replace("<!-- forge:end preamble -->", ""), "preamble"),
        (lambda t: t.replace("## Asset brief", "## Brief"), "## Asset brief"),
        (lambda t: t.replace(BRIEF, "   "), "empty"),
    ],
)
def test_genai_malformed_prompt_is_rejected(mutate, message: str) -> None:  # noqa: ANN001
    text = mutate(PROMPT.format(brief=BRIEF, refs="none"))
    with pytest.raises(genai.GenAiError, match=re.escape(message)):
        genai.refresh_prompt(text, genai.Preamble("v1", "2026-10-18", "body"))


def test_genai_parse_references() -> None:
    assert genai.parse_references("none") == ()
    assert genai.parse_references("none (concept)") == ()
    assert genai.parse_references("`assets-src/ai/ref.people_style/golden.png`, refs/b.png") == (
        "assets-src/ai/ref.people_style/golden.png",
        "refs/b.png",
    )


# ---------------------------------------------------------------------------------------------
# Draft meta.json, --ref


def test_genai_draft_meta(repo: Path, env: dict[str, str], capsys: pytest.CaptureFixture[str]) -> None:
    assert run(repo, env, "--candidates", "1") == 0
    out = capsys.readouterr().out
    assert "build/ai-candidates/concept.test_street/run_00/meta.json" in out
    meta = json.loads((run_dir(repo) / "meta.json").read_text(encoding="utf-8"))
    assert tuple(meta) == genai.META_KEYS
    assert meta["id"] == ASSET
    assert meta["tool"] == "codex"
    assert meta["tool_version"] == "codex-cli 0.160.1"
    assert "gpt-6.1-sol" in meta["model"]
    assert meta["model"] == (
        "gpt-6.1-sol (agent, pinned via -m); image model: Codex built-in image_gen, version not exposed"
    )
    assert meta["seed"] is None
    assert meta["preamble_version"] == "v1"
    assert meta["reference_images"] == []
    assert meta["argv"][:4] == [env["SSP_CODEX"], "exec", "-m", "gpt-6.1-sol"]
    assert "build/ai-candidates/concept.test_street/run_00" in meta["argv"], "argv records repo-relative paths"
    assert meta["argv"][-1] == "-"
    thread = "0199f3a2-7c1e-7b40-9d6a-2f8e1c5b3a70"
    assert meta["original_output_path"] == f"~/.codex/generated_images/{thread}/exec-0000.png"
    assert meta["size"] == [64, 32]
    assert (meta["candidates_generated"], meta["accepted_index"], meta["golden_sha256"]) == (None, None, None)
    assert meta["acceptance_notes"] == ""


def test_genai_refs_default_to_prompt_and_cli_ref_overrides(repo: Path, env: dict[str, str]) -> None:
    ref_dir = repo / "assets-src" / "ai" / "ref.people_style"
    ref_dir.mkdir(parents=True)
    Image.new("RGB", (4, 4), (250, 5, 249)).save(ref_dir / "golden.png")
    other = repo / "other.png"
    Image.new("RGB", (4, 4), (0, 0, 0)).save(other)
    write_prompt(repo, refs="assets-src/ai/ref.people_style/golden.png")

    assert run(repo, env) == 0
    argv = exec_calls(env)[0]["argv"]
    assert isinstance(argv, list)
    assert argv[-3:] == ["-i", str((ref_dir / "golden.png").resolve()), "-"]
    meta = json.loads((run_dir(repo, 0) / "meta.json").read_text(encoding="utf-8"))
    digest = hashlib.sha256((ref_dir / "golden.png").read_bytes()).hexdigest()
    assert meta["reference_images"] == [{"path": "assets-src/ai/ref.people_style/golden.png", "sha256": digest}]

    assert run(repo, env, "--ref", "other.png") == 0
    argv = exec_calls(env)[1]["argv"]
    assert isinstance(argv, list)
    assert argv[-3:] == ["-i", str(other.resolve()), "-"]


def test_genai_missing_ref_fails_before_codex(repo: Path, env: dict[str, str], capsys: pytest.CaptureFixture[str]) -> None:
    assert run(repo, env, "--ref", "missing.png") == 1
    assert "reference image not found" in capsys.readouterr().err
    assert calls(env) == []


# ---------------------------------------------------------------------------------------------
# Output recovery and verification


def test_genai_falls_back_to_generated_images(repo: Path, env: dict[str, str], capsys: pytest.CaptureFixture[str]) -> None:
    env["FAKE_CODEX_MODE"] = "nocopy"
    assert run(repo, env) == 0, capsys.readouterr().err
    out = run_dir(repo) / "street.png"
    gen = Path(env["HOME"]) / ".codex" / "generated_images" / "0199f3a2-7c1e-7b40-9d6a-2f8e1c5b3a70" / "exec-0000.png"
    assert out.read_bytes() == gen.read_bytes()
    v = json.loads((run_dir(repo) / "verify.json").read_text(encoding="utf-8"))
    assert v["status"] == "ok" and v["recovered_from_generated_images"] is True


def test_genai_fallback_takes_the_newest_exec_png(repo: Path, env: dict[str, str], tmp_path: Path) -> None:
    env["FAKE_CODEX_MODE"] = "nocopy"
    env["CODEX_HOME"] = str(tmp_path / "codex_home")
    gen = tmp_path / "codex_home" / "generated_images" / "0199f3a2-7c1e-7b40-9d6a-2f8e1c5b3a70"
    gen.mkdir(parents=True)
    old = gen / "exec-old.png"
    Image.new("RGB", (2, 2)).save(old)
    os.utime(old, (1_000_000, 1_000_000))
    assert run(repo, env) == 0
    out = (run_dir(repo) / "street.png").read_bytes()
    assert out == (gen / "exec-0001.png").read_bytes() != old.read_bytes()


def test_genai_byte_identity_check_rejects_a_reencoded_output(
    repo: Path, env: dict[str, str], capsys: pytest.CaptureFixture[str]
) -> None:
    env["FAKE_CODEX_MODE"] = "reencode"
    assert run(repo, env) == 1
    err = capsys.readouterr().err
    assert "not byte-identical" in err
    v = json.loads((run_dir(repo) / "verify.json").read_text(encoding="utf-8"))
    assert v["status"] == "rejected"
    assert v["drawing"] == [], "the log alone looks clean: only the byte-identity check catches it"


def test_genai_drawn_output_is_rejected(repo: Path, env: dict[str, str], capsys: pytest.CaptureFixture[str]) -> None:
    env["FAKE_CODEX_MODE"] = "draw"
    assert run(repo, env) == 1
    err = capsys.readouterr().err
    assert "drawn or re-encoded with code" in err
    v = json.loads((run_dir(repo) / "verify.json").read_text(encoding="utf-8"))
    assert v["status"] == "rejected"
    assert any("ImageDraw" in d["reason"] or "Image.new" in d["reason"] for d in v["drawing"])
    assert any("not byte-identical" in r for r in v["reasons"])


@pytest.mark.parametrize("mode", ["noimage", "exit1"])
def test_genai_missing_output_fails_loudly(
    mode: str, repo: Path, env: dict[str, str], capsys: pytest.CaptureFixture[str]
) -> None:
    env["FAKE_CODEX_MODE"] = mode
    assert run(repo, env) == 1
    err = capsys.readouterr().err
    assert "no output: street.png is missing" in err
    assert "FAILED" in err
    v = json.loads((run_dir(repo) / "verify.json").read_text(encoding="utf-8"))
    assert v["status"] == "failed"
    if mode == "exit1":
        assert any("codex exited 1" in r for r in v["reasons"])
        assert "not logged in" in (run_dir(repo) / "stderr.txt").read_text(encoding="utf-8")


def test_genai_candidates_number_runs_from_00_and_continue(repo: Path, env: dict[str, str]) -> None:
    assert run(repo, env, "--candidates", "2") == 0
    assert run(repo, env, "--candidates", "1") == 0
    cand = repo / "build" / "ai-candidates" / ASSET
    assert sorted(p.name for p in cand.iterdir() if p.is_dir()) == ["run_00", "run_01", "run_02"]
    assert len(exec_calls(env)) == 3
    assert len(set(hashlib.sha256((cand / f"run_0{k}" / "street.png").read_bytes()).hexdigest() for k in range(3))) == 3


# ---------------------------------------------------------------------------------------------
# Drawing detection on real and synthetic events.jsonl


@pytest.mark.parametrize("name", sorted(PROBE_LOGS))
def test_genai_probe_events_are_not_classified_as_drawn(name: str) -> None:
    path, output, thread = PROBE_LOGS[name]
    events = genai.parse_events(path.read_text(encoding="utf-8"))
    assert events.thread_id == thread
    assert events.malformed_lines == 0
    assert any(cmd.startswith("/bin/zsh -lc 'cp") for cmd in events.commands), "the probe cp'd the image_gen file"
    assert genai.find_drawing(events, output) == []
    assert not genai.is_drawn(events, output)


def test_genai_probe_codex4_includes_the_read_only_pil_check() -> None:
    path, output, _ = PROBE_LOGS["codex4"]
    events = genai.parse_events(path.read_text(encoding="utf-8"))
    pil = [c for c in events.commands if "from PIL import Image" in c]
    assert pil and "getextrema" in pil[0], "a naive 'PIL in a command' rule would reject this run"
    assert genai.find_drawing(events, output) == []


def _log_with(*commands: str, file_changes: tuple[str, ...] = ()) -> genai.EventLog:
    lines = [json.dumps({"type": "thread.started", "thread_id": "t"})]
    for k, cmd in enumerate(commands):
        lines.append(json.dumps({"type": "item.completed", "item": {"id": f"c{k}", "type": "command_execution", "command": cmd}}))
    if file_changes:
        changes = [{"path": p, "kind": "add"} for p in file_changes]
        lines.append(json.dumps({"type": "item.completed", "item": {"id": "f", "type": "file_change", "changes": changes}}))
    return genai.parse_events("\n".join(lines))


@pytest.mark.parametrize(
    "command",
    [
        "/bin/zsh -lc \"python3 -c 'from PIL import Image, ImageDraw; im = Image.new(\\\"RGBA\\\", (1774, 887)); "
        "d = ImageDraw.Draw(im); d.rectangle((0, 0, 10, 10), fill=(255, 0, 0)); im.save(\\\"street.png\\\")'\"",
        "/bin/zsh -lc \"python3 - <<'EOF'\nfrom PIL import Image, ImageDraw\nim = Image.new('RGBA', (64, 64))\n"
        "ImageDraw.Draw(im).ellipse((0, 0, 9, 9), fill='red')\nim.save('street.png')\nEOF\"",
        "/bin/zsh -lc \"python3 -c 'import numpy as np; from PIL import Image; "
        "Image.fromarray(np.zeros((887, 1774, 3), np.uint8)).save(\\\"street.png\\\")'\"",
        "/bin/zsh -lc 'magick -size 1774x887 xc:yellow -draw \"rectangle 0,0 9,9\" street.png'",
        "/bin/zsh -lc 'rsvg-convert street.svg -o street.png'",
        "/bin/zsh -lc 'sips -z 887 1774 exec-1.png --out street.png'",
        "/bin/zsh -lc \"python3 -c 'from PIL import Image; Image.open(\\\"a.png\\\").convert(\\\"P\\\").save(\\\"street.png\\\")'\"",
    ],
)
def test_genai_synthetic_drawing_commands_are_rejected(command: str) -> None:
    findings = genai.find_drawing(_log_with(command), "street.png")
    assert findings, command


def test_genai_imagedraw_writing_the_output_is_rejected_with_reason() -> None:
    log = _log_with(
        "/bin/zsh -lc 'cat SKILL.md'",
        "/bin/zsh -lc \"python3 -c 'from PIL import Image, ImageDraw; im = Image.new(\\\"RGB\\\", (8, 8)); "
        "ImageDraw.Draw(im).point((1, 1)); im.save(\\\"street.png\\\")'\"",
    )
    (finding,) = genai.find_drawing(log, "street.png")
    assert "ImageDraw" in finding.reason and ".save(" in finding.reason


@pytest.mark.parametrize(
    "command",
    [
        "/bin/zsh -lc 'cp ~/.codex/generated_images/t/exec-1.png ./street.png'",
        "/bin/zsh -lc 'cp -n ~/.codex/generated_images/t/exec-1.png ./street.png | sips -g pixelWidth -g pixelHeight ./street.png'",
        "/bin/zsh -lc 'mv exec-1.png street.png && file street.png'",
        "/bin/zsh -lc 'sips -g pixelWidth -g pixelHeight -g hasAlpha street.png'",
        "/bin/zsh -lc \"python3 -c 'from PIL import Image; im = Image.open(\\\"street.png\\\"); print(im.size, im.getchannel(\\\"A\\\").getextrema())'\"",
        "/bin/zsh -lc 'ls -la ~/.codex/generated_images/t/ && shasum -a 256 street.png'",
    ],
)
def test_genai_copy_and_read_only_commands_pass(command: str) -> None:
    assert genai.find_drawing(_log_with(command), "street.png") == []


def test_genai_authored_script_or_svg_is_rejected() -> None:
    log = _log_with("/bin/zsh -lc 'python3 make.py'", file_changes=("/w/make.py",))
    assert any("make.py" in f.reason for f in genai.find_drawing(log, "street.png"))
    log = _log_with(file_changes=("/w/street.svg",))
    assert genai.find_drawing(log, "street.png")


def test_genai_parse_events_tolerates_malformed_lines_and_dedupes_items() -> None:
    text = "\n".join(
        [
            json.dumps({"type": "thread.started", "thread_id": "abc"}),
            "not json",
            json.dumps({"type": "item.started", "item": {"id": "i1", "type": "command_execution", "command": "ls"}}),
            json.dumps({"type": "item.completed", "item": {"id": "i1", "type": "command_execution", "command": "ls"}}),
            json.dumps({"type": "error", "message": "quota exceeded"}),
        ]
    )
    log = genai.parse_events(text)
    assert (log.thread_id, log.commands, log.malformed_lines, log.errors) == ("abc", ["ls"], 1, ["quota exceeded"])


# ---------------------------------------------------------------------------------------------
# --accept


def test_genai_accept_copies_byte_for_byte_and_fills_meta(
    repo: Path, env: dict[str, str], capsys: pytest.CaptureFixture[str]
) -> None:
    assert run(repo, env, "--candidates", "2") == 0
    assert run(repo, env, "--accept", "1") == 0
    assert "acceptance_notes" in capsys.readouterr().out, "the notes are written by hand"
    folder = repo / "assets-src" / "ai" / ASSET
    cand = (run_dir(repo, 1) / "street.png").read_bytes()
    assert (folder / "golden.png").read_bytes() == cand
    meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    assert tuple(meta) == genai.META_KEYS
    assert meta["candidates_generated"] == 2
    assert meta["accepted_index"] == 1
    assert meta["golden_sha256"] == hashlib.sha256(cand).hexdigest()
    assert meta["size"] == [64, 32]
    assert meta["original_output_path"].endswith("/exec-0001.png")
    assert meta["seed"] is None and meta["tool"] == "codex" and meta["acceptance_notes"] == ""
    assert meta["prompt_sha256"] == hashlib.sha256(sent_bytes(folder / "prompt.md")).hexdigest()

    # Hand-written notes survive a re-accept of the same golden.
    meta["acceptance_notes"] = "Run 1 won."
    (folder / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
    assert run(repo, env, "--accept", "1") == 0
    assert json.loads((folder / "meta.json").read_text(encoding="utf-8"))["acceptance_notes"] == "Run 1 won."


def test_genai_accept_refuses_a_rejected_run(repo: Path, env: dict[str, str], capsys: pytest.CaptureFixture[str]) -> None:
    env["FAKE_CODEX_MODE"] = "draw"
    run(repo, env)
    capsys.readouterr()
    assert run(repo, env, "--accept", "0") == 1
    assert "did not pass verification" in capsys.readouterr().err
    assert not (repo / "assets-src" / "ai" / ASSET / "golden.png").exists()


def test_genai_accept_refuses_missing_run_and_changed_prompt(
    repo: Path, env: dict[str, str], capsys: pytest.CaptureFixture[str]
) -> None:
    assert run(repo, env, "--accept", "0") == 1
    assert "no candidate run_00" in capsys.readouterr().err
    assert run(repo, env) == 0
    write_prompt(repo, brief=BRIEF + " With seagulls.")
    capsys.readouterr()
    assert run(repo, env, "--accept", "0") == 1
    assert "prompt.md changed" in capsys.readouterr().err
    assert not (repo / "assets-src" / "ai" / ASSET / "golden.png").exists()


# ---------------------------------------------------------------------------------------------
# review.png


def test_genai_review_png_shows_every_run(repo: Path, env: dict[str, str]) -> None:
    assert run(repo, env, "--candidates", "2") == 0
    review = repo / "build" / "ai-candidates" / ASSET / "review.png"
    with Image.open(review) as im:
        w, h = im.size
    assert w == genai.PAD * 3 + genai.THUMB_BOX[0] * 2
    assert h > 2 * 32, "two rows with thumbnails"


def test_genai_review_png_adds_the_ingest_preview_when_ingest_json_exists(tmp_path: Path) -> None:
    cand = tmp_path / "cand"
    d = cand / "run_00"
    d.mkdir(parents=True)
    # A 2x1 sheet on a magenta key: two 'pixel art' blocks with a 4 px pseudo-pixel period.
    im = Image.new("RGB", (128, 64), (255, 0, 255))
    for x0, colour in ((16, (242, 193, 46)), (80, (46, 90, 156))):
        im.paste((15, 14, 18), (x0, 16, x0 + 32, 48))
        im.paste(colour, (x0 + 4, 20, x0 + 28, 44))
    im.save(d / "sheet.png")
    v = genai.Verification(run="run_00", status="ok", output="sheet.png", size=[128, 64])
    genai.write_json(d / "verify.json", v.to_json())
    config = parse_config(
        {"mode": "sheet", "grid": [2, 1], "cells": ["litter.a", "litter.b"], "frame": "idle:h00:0", "target_cell": [16, 16]}
    )
    plain, with_preview = tmp_path / "plain.png", tmp_path / "preview.png"
    genai.write_review(cand, plain)
    genai.write_review(cand, with_preview, config)
    with Image.open(plain) as a, Image.open(with_preview) as b:
        assert b.height > a.height
        # 4 strips (4x light, 4x dark, 8x light, 8x dark) of 16 px cells.
        assert b.height - a.height >= 2 * 16 * 4 + 2 * 16 * 8
        pal = load_palette()
        colours = {tuple(int(v) for v in c) for c in np.asarray(b.convert("RGB")).reshape(-1, 3)}
        assert tuple(int(c) for c in pal.rgb[pal.index("sweeper_yellow")]) in colours


def test_genai_load_ingest_config_reports_bad_json(tmp_path: Path) -> None:
    assert genai.load_ingest_config(tmp_path) == (None, None)
    (tmp_path / "ingest.json").write_text('{"mode": "art"}', encoding="utf-8")
    config, note = genai.load_ingest_config(tmp_path)
    assert config is None and note is not None and "ingest preview unavailable" in note


# ---------------------------------------------------------------------------------------------
# Cursor, preamble file, committed prompts


def test_genai_tool_cursor_exits_non_zero(repo: Path, env: dict[str, str], capsys: pytest.CaptureFixture[str]) -> None:
    status = run(repo, env, "--tool", "cursor", "--candidates", "1")
    assert status == EXIT_NOT_IMPLEMENTED != 0
    assert "not implemented until needed" in capsys.readouterr().err
    assert calls(env) == []


def test_genai_tool_cursor_via_npm_shape_subprocess() -> None:
    """``npm run gen:ai -- x --tool cursor`` is ``python -m forge gen-ai --tool codex x --tool cursor``."""
    result = subprocess.run(
        [sys.executable, "-m", "forge", "gen-ai", "--tool", "codex", "x", "--tool", "cursor"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode != 0
    assert "not implemented until needed" in result.stderr


def test_genai_style_preamble_is_the_asset_pipeline_block_verbatim() -> None:
    doc = (REPO_ROOT / "docs" / "ASSET_PIPELINE.md").read_text(encoding="utf-8")
    m = re.search(r"```markdown\n(<!-- preamble v1 \(2026-10-18\) -->\n.*?)```", doc, re.DOTALL)
    assert m, "ASSET_PIPELINE §8.4 holds the preamble v1 block"
    assert (REPO_ROOT / genai.PREAMBLE_PATH).read_text(encoding="utf-8") == m.group(1)


def test_genai_style_preamble_lists_all_32_palette_hexes() -> None:
    text = (REPO_ROOT / genai.PREAMBLE_PATH).read_text(encoding="utf-8")
    hexes = re.findall(r"#[0-9a-f]{6}", text)
    pal = load_palette()
    assert set(hexes) == {pal.hex(i).lower() for i in range(len(pal))}
    assert len(set(hexes)) == 32
    p = genai.load_preamble(REPO_ROOT)
    assert (p.version, p.date) == ("v1", "2026-10-18")


def test_genai_committed_prompts_parse_and_pass_the_denylist() -> None:
    preamble = genai.load_preamble(REPO_ROOT)
    path = REPO_ROOT / "assets-src" / "ai" / "concept.spike_street" / "prompt.md"
    spec = genai.refresh_prompt(path.read_text(encoding="utf-8"), preamble)
    assert spec.output_name == "street.png" and spec.aspect == "2:1" and spec.references == ()
    genai.check_denylist(spec.text, "concept.spike_street/prompt.md")
    assert spec.text == path.read_text(encoding="utf-8"), "the committed prompt is already refreshed"
