"""``forge gen-ai``: the reproducible Codex image-generation wrapper (ASSET_PIPELINE §8).

Local only, never CI (CLAUDE.md hard rule 5). One candidate is one ``codex exec`` call:

    printf '%s' "$PROMPT" | ~/.local/bin/codex exec -m "$SSP_CODEX_MODEL" --skip-git-repo-check --ephemeral \\
      -s workspace-write -C "$WORKDIR" --json -o "$WORKDIR/last_message.txt" [-i <ref.png>]... - \\
      > "$WORKDIR/events.jsonl" 2> "$WORKDIR/stderr.txt"

with ``WORKDIR = build/ai-candidates/<id>/run_NN``. The gotchas it encodes (§8.2):

- The prompt always arrives on stdin and the last argument is ``-``: ``-i`` is variadic and would
  swallow a positional prompt, and an unredirected stdin can hang the run.
- The model is pinned with ``-m`` (:data:`CODEX_MODEL`, overridable with ``SSP_CODEX_MODEL``), and the
  CLI version must be :data:`CODEX_VERSION`.
- ``image_gen`` is invisible in ``--json`` events. The wrapper checks ``$WORKDIR/<output>.png`` and
  otherwise recovers the newest ``$CODEX_HOME/generated_images/<thread-id>/exec-*.png`` (thread id from
  the ``thread.started`` event; ``CODEX_HOME`` defaults to ``~/.codex``, as in Codex itself).
- The agent must not draw the PNG with code. Primary check: the output is byte-identical to an
  ``exec-*.png`` of its thread. Secondary check: no logged shell command writes an image by drawing,
  or writes the output with an image encoder instead of copying it. Read-only checks (``sips -g``,
  ``Image.open(...).getextrema()``) are allowed: the probe's accepted litter run did exactly that.
- No seed or size control: ``seed`` is always ``null`` and the aspect ratio is requested in words.
- A prompt that contains a term from ``tools/ipDenylist.json`` is refused before any subprocess.

``prompt.md`` (§8.4) is a human header table, then a ``<!-- forge:send -->`` line. Every byte after that
line is piped to Codex, and ``prompt_sha256`` is the SHA-256 of exactly those bytes. The sent text holds
the wrapper-managed agent instructions, the style preamble (both refreshed in place before sending)
and the ``## Asset brief``.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from forge.ingest import IngestConfig, IngestError, ingest_sheet, load_config
from forge.ipdenylist import DENYLIST_PATH, find_blocked_terms, load_denylist
from forge.palette import Palette, load_palette
from forge.pngio import encode_rgba_png, indices_to_rgba

log = logging.getLogger("forge")

REPO_ROOT = Path(__file__).resolve().parents[3]

# ---------------------------------------------------------------------------------------------
# Pins and environment

CODEX_MODEL = "gpt-6.1-sol"
"""The agent model passed with ``-m`` (confirmed by the lead for M0). ``SSP_CODEX_MODEL`` overrides it."""

CODEX_VERSION = "codex-cli 0.160.1"
"""The only Codex CLI version the wrapper runs (``codex --version``)."""

CODEX_BIN_DEFAULT = "~/.local/bin/codex"
"""Codex is not on PATH; the forge always uses this absolute path. ``SSP_CODEX`` overrides it."""

CODEX_TIMEOUT_S = 900
"""Hard limit per candidate. A normal run takes about 60 s."""

ENV_MODEL = "SSP_CODEX_MODEL"
ENV_BINARY = "SSP_CODEX"
ENV_CODEX_HOME = "CODEX_HOME"

MODEL_DESCRIPTION = "{model} (agent, pinned via -m); image model: Codex built-in image_gen, version not exposed"
"""The ``meta.json`` ``model`` string (ASSET_PIPELINE §6.5 example)."""

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_NOT_IMPLEMENTED = 3

CURSOR_NOT_IMPLEMENTED = (
    "forge gen-ai: --tool cursor is not implemented until needed "
    "(the raw cursor-agent command for manual concept work is in docs/ASSET_PIPELINE.md §8.3)"
)

# ---------------------------------------------------------------------------------------------
# prompt.md format (§8.4)

SEND_MARKER = "<!-- forge:send -->"
AGENT_BEGIN = "<!-- forge:begin agent-instructions -->"
AGENT_END = "<!-- forge:end agent-instructions -->"
PREAMBLE_END = "<!-- forge:end preamble -->"
BRIEF_HEADING = "## Asset brief"

_SEND_LINE_RE = re.compile(r"^<!-- forge:send -->[ \t]*\r?\n", re.MULTILINE)
_AGENT_BLOCK_RE = re.compile(
    r"^<!-- forge:begin agent-instructions -->[ \t]*\n.*?^<!-- forge:end agent-instructions -->[ \t]*$",
    re.MULTILINE | re.DOTALL,
)
_PREAMBLE_BLOCK_RE = re.compile(
    r"^<!-- forge:begin preamble (v\d+) -->[ \t]*\n.*?^<!-- forge:end preamble -->[ \t]*$",
    re.MULTILINE | re.DOTALL,
)
_BRIEF_RE = re.compile(r"^## Asset brief[ \t]*$", re.MULTILINE)
_HEADER_ROW_RE = re.compile(r"^\|\s*([^|]+?)\s*\|\s*(.*?)\s*\|\s*$")
_PREAMBLE_STAMP_RE = re.compile(r"^<!-- preamble (v\d+) \((\d{4}-\d{2}-\d{2})\) -->$")
_OUTPUT_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]*\.png$")
_ASSET_ID_RE = re.compile(r"^[a-z]+\.[a-z0-9]+(?:_[a-z0-9]+)*$")
_RUN_DIR_RE = re.compile(r"^run_(\d{2,})$")

PREAMBLE_PATH = Path("assets-src") / "ai" / "_style_preamble.md"

AGENT_INSTRUCTIONS_CODEX = """\
Use your built-in image generation tool to create the image described below. Copy the resulting
PNG into the current working directory as {output}. Do not draw it with code: do not use Python,
PIL, SVG, canvas or any other programmatic method. Do not create or edit any other file.
When finished, reply with the single word DONE."""
"""Section 1 of the sent text for Codex (ASSET_PIPELINE §8.4), with the header's output file name."""

ASPECT_SIZES: dict[str, tuple[int, int]] = {"2:1": (1774, 887), "1:1": (1254, 1254)}
"""What Codex's ``image_gen`` returns for each aspect requested in words (§8.1). A mismatch is a warning."""

RUN_FILES = frozenset({"last_message.txt", "events.jsonl", "stderr.txt", "meta.json", "verify.json"})
"""Files the wrapper itself writes into a run directory (besides the output PNG)."""


class GenAiError(RuntimeError):
    """A gen-ai failure that must stop the command with a clear message (exit 1)."""


@dataclass(frozen=True)
class Preamble:
    version: str
    date: str
    body: str


@dataclass(frozen=True)
class PromptSpec:
    """A parsed (and possibly refreshed) ``prompt.md``."""

    text: str
    header: Mapping[str, str]
    output_name: str
    aspect: str | None
    references: tuple[str, ...]
    preamble_version: str

    @property
    def send_text(self) -> str:
        return split_send(self.text)[1]

    @property
    def send_bytes(self) -> bytes:
        return self.send_text.encode("utf-8")

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.send_bytes).hexdigest()


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def split_send(text: str) -> tuple[str, str]:
    """Split ``prompt.md`` into (header, sent text) at its single ``<!-- forge:send -->`` line.

    The sent text starts right after the marker line's newline; it is piped to the tool byte-for-byte.
    """
    matches = list(_SEND_LINE_RE.finditer(text))
    if len(matches) != 1:
        raise GenAiError(f"prompt.md must contain exactly one '{SEND_MARKER}' line, found {len(matches)}")
    m = matches[0]
    return text[: m.start()], text[m.end() :]


def prompt_sha256(text: str) -> str:
    """SHA-256 of the bytes after the ``<!-- forge:send -->`` line (what ``meta.json`` records)."""
    return sha256_bytes(split_send(text)[1].encode("utf-8"))


def parse_header(header_text: str) -> dict[str, str]:
    """The ``| Key | Value |`` rows of the human header (separator and ``Key`` rows skipped)."""
    rows: dict[str, str] = {}
    for line in header_text.splitlines():
        m = _HEADER_ROW_RE.match(line.strip())
        if not m:
            continue
        key, value = m.group(1), m.group(2)
        if key == "Key" or set(key) <= set("-: "):
            continue
        rows[key] = value
    return rows


def _strip_code(value: str) -> str:
    return value.strip().strip("`").strip()


def parse_references(value: str | None) -> tuple[str, ...]:
    """``References`` header value: ``none`` (optionally with a note) or comma-separated repo paths."""
    if value is None:
        return ()
    v = value.strip()
    if not v or v.lower().startswith("none"):
        return ()
    return tuple(_strip_code(p) for p in v.split(",") if _strip_code(p))


def load_preamble(root: Path) -> Preamble:
    """Load ``assets-src/ai/_style_preamble.md``: a version stamp line, then the preamble text."""
    path = root / PREAMBLE_PATH
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise GenAiError(f"cannot read {PREAMBLE_PATH}: {exc}") from exc
    first, _, rest = text.partition("\n")
    m = _PREAMBLE_STAMP_RE.match(first.strip())
    if not m:
        raise GenAiError(f"{PREAMBLE_PATH}: first line must be '<!-- preamble vN (YYYY-MM-DD) -->'")
    body = rest.rstrip("\n")
    if not body.strip():
        raise GenAiError(f"{PREAMBLE_PATH}: the preamble text is empty")
    return Preamble(version=m.group(1), date=m.group(2), body=body)


def agent_instructions(output_name: str) -> str:
    return AGENT_INSTRUCTIONS_CODEX.format(output=output_name)


def refresh_prompt(text: str, preamble: Preamble) -> PromptSpec:
    """Refresh sections 1 (agent instructions) and 2 (preamble) in place and parse the result.

    Raises :class:`GenAiError` if the file does not follow §8.4: one send marker, then exactly one
    agent-instructions block, one preamble block and a non-empty ``## Asset brief``, in that order.
    """
    header_text, send = split_send(text)
    header = parse_header(header_text)

    output_name = _strip_code(header.get("Output file", ""))
    if not _OUTPUT_NAME_RE.match(output_name):
        raise GenAiError(
            f"prompt.md header needs '| Output file | <name>.png |' (a plain file name), got {output_name!r}"
        )

    agent_blocks = list(_AGENT_BLOCK_RE.finditer(send))
    preamble_blocks = list(_PREAMBLE_BLOCK_RE.finditer(send))
    briefs = list(_BRIEF_RE.finditer(send))
    if len(agent_blocks) != 1:
        raise GenAiError(f"prompt.md needs exactly one '{AGENT_BEGIN}' ... '{AGENT_END}' block after the marker")
    if len(preamble_blocks) != 1:
        raise GenAiError(
            f"prompt.md needs exactly one '<!-- forge:begin preamble vN -->' ... '{PREAMBLE_END}' block"
        )
    if len(briefs) != 1:
        raise GenAiError(f"prompt.md needs exactly one '{BRIEF_HEADING}' heading after the preamble")
    a, p, b = agent_blocks[0], preamble_blocks[0], briefs[0]
    if not a.end() <= p.start() < p.end() <= b.start():
        raise GenAiError("prompt.md sections are out of order: agent instructions, preamble, then '## Asset brief'")
    if not send[b.end() :].strip():
        raise GenAiError("prompt.md: the '## Asset brief' section is empty")

    new_agent = f"{AGENT_BEGIN}\n{agent_instructions(output_name)}\n{AGENT_END}"
    new_preamble = f"<!-- forge:begin preamble {preamble.version} -->\n{preamble.body}\n{PREAMBLE_END}"
    new_send = send[: a.start()] + new_agent + send[a.end() : p.start()] + new_preamble + send[p.end() :]

    new_header = re.sub(
        r"^(\|\s*Preamble\s*\|\s*)[^|]*?(\s*\|\s*)$",
        lambda m: f"{m.group(1)}{preamble.version}{m.group(2)}",
        header_text,
        count=1,
        flags=re.MULTILINE,
    )
    marker_line = _SEND_LINE_RE.search(text)
    assert marker_line is not None  # split_send succeeded
    new_text = new_header + marker_line.group(0) + new_send

    aspect = _strip_code(header.get("Aspect", "")) or None
    return PromptSpec(
        text=new_text,
        header=parse_header(new_header),
        output_name=output_name,
        aspect=aspect,
        references=parse_references(header.get("References")),
        preamble_version=preamble.version,
    )


def check_denylist(text: str, label: str, denylist_path: Path = DENYLIST_PATH) -> None:
    """Refuse (raise) if ``text`` contains a term from the shared trademark denylist."""
    hits = find_blocked_terms(text, load_denylist(denylist_path))
    if hits:
        listed = "; ".join(f"line {h.line}: '{h.excerpt}' ({h.term})" for h in hits)
        raise GenAiError(
            f"refusing to send {label}: it contains denylisted trademark term(s) from tools/ipDenylist.json: "
            f"{listed}. Describe the look instead (CLAUDE.md hard rule 7)."
        )


# ---------------------------------------------------------------------------------------------
# Codex configuration and argv


@dataclass(frozen=True)
class CodexConfig:
    binary: Path
    model: str
    codex_home: Path
    model_from_env: bool = False

    @property
    def generated_images(self) -> Path:
        return self.codex_home / "generated_images"


def resolve_config(env: Mapping[str, str]) -> CodexConfig:
    """Binary, model and Codex home from the environment (``SSP_CODEX``, ``SSP_CODEX_MODEL``, ``CODEX_HOME``)."""
    home = Path(env.get("HOME") or Path.home())

    def expand(p: str) -> Path:
        return home / p[2:] if p.startswith("~/") else Path(p)

    binary = expand(env.get(ENV_BINARY) or CODEX_BIN_DEFAULT)
    model = env.get(ENV_MODEL) or CODEX_MODEL
    codex_home = expand(env[ENV_CODEX_HOME]) if env.get(ENV_CODEX_HOME) else home / ".codex"
    return CodexConfig(binary=binary, model=model, codex_home=codex_home, model_from_env=bool(env.get(ENV_MODEL)))


def codex_argv(binary: str, model: str, workdir: str, last_message: str, refs: Sequence[str]) -> list[str]:
    """The ``codex exec`` argv for one candidate. It always ends with ``-`` (prompt on stdin)."""
    argv = [
        binary,
        "exec",
        "-m",
        model,
        "--skip-git-repo-check",
        "--ephemeral",
        "-s",
        "workspace-write",
        "-C",
        workdir,
        "--json",
        "-o",
        last_message,
    ]
    for ref in refs:
        argv += ["-i", ref]
    argv.append("-")
    return argv


def display_path(path: Path, root: Path, home: Path) -> str:
    """Repo-relative if under ``root``, ``~/...`` if under ``home``, else absolute (for ``meta.json``)."""
    p = Path(os.path.abspath(path))
    for base, prefix in ((Path(os.path.abspath(root)), ""), (Path(os.path.abspath(home)), "~/")):
        try:
            rel = p.relative_to(base)
        except ValueError:
            continue
        return prefix + rel.as_posix()
    return p.as_posix()


def check_codex_version(cfg: CodexConfig, env: Mapping[str, str]) -> str:
    """Run ``codex --version`` and require :data:`CODEX_VERSION`."""
    if not cfg.binary.is_file() or not os.access(cfg.binary, os.X_OK):
        raise GenAiError(f"Codex CLI not found or not executable at {cfg.binary} (set {ENV_BINARY} to override)")
    try:
        result = subprocess.run(
            [str(cfg.binary), "--version"],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=60,
            env=dict(env),
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise GenAiError(f"'{cfg.binary} --version' failed: {exc}") from exc
    version = result.stdout.strip()
    if result.returncode != 0 or version != CODEX_VERSION:
        raise GenAiError(
            f"'{cfg.binary} --version' reported {version!r} (exit {result.returncode}); the forge requires "
            f"{CODEX_VERSION!r} (ASSET_PIPELINE §4)"
        )
    return version


# ---------------------------------------------------------------------------------------------
# events.jsonl analysis


@dataclass
class EventLog:
    thread_id: str | None = None
    commands: list[str] = field(default_factory=list)
    file_changes: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    malformed_lines: int = 0


def parse_events(text: str) -> EventLog:
    """Parse ``codex exec --json`` output. Shell commands are taken once per item id (last state wins)."""
    out = EventLog()
    commands: dict[str, str] = {}
    order: list[str] = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            out.malformed_lines += 1
            continue
        if not isinstance(event, dict):
            out.malformed_lines += 1
            continue
        etype = event.get("type")
        if etype == "thread.started" and isinstance(event.get("thread_id"), str) and out.thread_id is None:
            out.thread_id = event["thread_id"]
        elif etype in ("error", "turn.failed"):
            err = event.get("message") or event.get("error")
            out.errors.append(json.dumps(err) if not isinstance(err, str) else err)
        item = event.get("item")
        if not isinstance(item, dict):
            continue
        itype = item.get("type")
        if itype == "command_execution" and isinstance(item.get("command"), str):
            key = str(item.get("id", f"#{len(order)}"))
            if key not in commands:
                order.append(key)
            commands[key] = item["command"]
        elif itype == "file_change":
            for change in item.get("changes") or []:
                if isinstance(change, dict) and isinstance(change.get("path"), str):
                    path = change["path"]
                    if path not in out.file_changes:
                        out.file_changes.append(path)
        elif itype == "error" and isinstance(item.get("message"), str):
            out.errors.append(item["message"])
    out.commands = [commands[k] for k in order]
    return out


# Drawing APIs and image synthesis. On their own they prove nothing (a read-only check may import
# numpy); they matter only in a command that also writes an image.
_DRAW_RE = re.compile(
    r"ImageDraw|ImageFont|Image\s*\.\s*new\s*\(|Image\s*\.\s*fromarray|\.putpixel\s*\(|\.putdata\s*\("
    r"|\.paste\s*\(|cairo|svgwrite|<svg|\.svg\b|canvas|matplotlib|pyplot|turtle|pygame|skia"
    r"|\bnp\s*\.\s*(?:zeros|ones|full|empty)\b|\bnumpy\s*\.\s*(?:zeros|ones|full|empty)\b"
    r"|\bxc:|\bgradient:|\bplasma:|\s-draw\b",
    re.IGNORECASE,
)
# Commands that encode or rewrite an image file (as opposed to cp/mv, which keep the bytes).
_WRITE_RE = re.compile(
    r"\.save\s*\(|savefig|imwrite|imsave|write_png|\.tofile\s*\(|writeFile|toFile"
    r"|\bopen\s*\([^)]*['\"][wa]b?\+?['\"]"
    r"|(?<![.\w-])magick\b|(?<![.\w-])convert\s|rsvg-convert|cairosvg|inkscape|(?<![.\w-])ffmpeg\b"
    r"|(?<![.\w-])sips\b[^\n|;&]*?(?:\s-[szZrfcp]\b|\s--out\b|\s--resample|\s--crop|\s--pad|\s--rotate|\s--flip"
    r"|\s--setProperty)",
    re.IGNORECASE,
)
# A shell redirect into a PNG. A plain `cat a.png > b.png` keeps the bytes, so this counts only
# together with a drawing marker.
_REDIRECT_PNG_RE = re.compile(r">\s*['\"]?[^\s'\"|;&<>]*\.png\b", re.IGNORECASE)

SCRIPT_SUFFIXES = frozenset({".py", ".js", ".mjs", ".cjs", ".ts", ".sh", ".rb", ".pl"})
VECTOR_SUFFIXES = frozenset({".svg", ".html", ".htm"})


@dataclass(frozen=True)
class DrawFinding:
    command: str
    reason: str


def find_drawing(log_: EventLog, output_name: str) -> list[DrawFinding]:
    """Commands or file changes that show the agent drew or re-encoded the image (§8.2 secondary check).

    A command is rejected when it writes an image *and* either uses a drawing API, or names the
    output file (an encoder writing the output instead of a byte copy). ``cp``/``mv`` of the
    ``image_gen`` file and read-only inspection (``sips -g``, ``Image.open(...).getextrema()``) pass.
    """
    findings: list[DrawFinding] = []
    out_lower = output_name.lower()
    for cmd in log_.commands:
        write = _WRITE_RE.search(cmd)
        redirect = _REDIRECT_PNG_RE.search(cmd)
        draw = _DRAW_RE.search(cmd)
        writer = write or redirect
        if draw and writer:
            how = writer.group(0).strip()
            findings.append(DrawFinding(cmd, f"draws with {draw.group(0).strip()!r} and writes an image ({how!r})"))
        elif write and out_lower in cmd.lower():
            findings.append(
                DrawFinding(cmd, f"writes {output_name} with {write.group(0).strip()!r} instead of copying the image_gen file")
            )
    for path in log_.file_changes:
        suffix = Path(path).suffix.lower()
        name = Path(path).name
        if suffix in VECTOR_SUFFIXES:
            findings.append(DrawFinding(f"(file change) {path}", f"authored vector/canvas source {name}"))
        elif suffix in SCRIPT_SUFFIXES and any(name in cmd for cmd in log_.commands):
            findings.append(DrawFinding(f"(file change) {path}", f"authored and ran the script {name}"))
    return findings


def is_drawn(log_: EventLog, output_name: str) -> bool:
    return bool(find_drawing(log_, output_name))


# ---------------------------------------------------------------------------------------------
# Output recovery and verification


def thread_images(cfg: CodexConfig, thread_id: str) -> list[Path]:
    """``exec-*.png`` files of one thread, newest first (mtime, then name, for a stable order)."""
    d = cfg.generated_images / thread_id
    if not d.is_dir():
        return []
    files = [p for p in d.glob("exec-*.png") if p.is_file()]
    return sorted(files, key=lambda p: (p.stat().st_mtime_ns, p.name), reverse=True)


@dataclass
class Verification:
    run: str
    status: str = "failed"  # ok | rejected | failed
    reasons: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    exit_code: int | None = None
    duration_s: float | None = None
    thread_id: str | None = None
    output: str = ""
    output_sha256: str | None = None
    recovered_from_generated_images: bool = False
    original_output_path: str | None = None
    size: list[int] | None = None
    drawing: list[dict[str, str]] = field(default_factory=list)
    generated_images: list[str] = field(default_factory=list)

    def to_json(self) -> dict[str, object]:
        return {
            "run": self.run,
            "status": self.status,
            "reasons": self.reasons,
            "warnings": self.warnings,
            "exit_code": self.exit_code,
            "duration_s": self.duration_s,
            "thread_id": self.thread_id,
            "output": self.output,
            "output_sha256": self.output_sha256,
            "recovered_from_generated_images": self.recovered_from_generated_images,
            "original_output_path": self.original_output_path,
            "size": self.size,
            "drawing": self.drawing,
            "generated_images": self.generated_images,
        }


def verify_run(
    workdir: Path,
    output_name: str,
    cfg: CodexConfig,
    root: Path,
    home: Path,
    aspect: str | None,
    exit_code: int | None,
) -> Verification:
    """Recover the output if needed, then apply the byte-identity and drawing checks."""
    v = Verification(run=workdir.name, output=output_name, exit_code=exit_code)
    events_path = workdir / "events.jsonl"
    events = parse_events(events_path.read_text(encoding="utf-8", errors="replace")) if events_path.exists() else EventLog()
    v.thread_id = events.thread_id
    if exit_code not in (0, None):
        v.reasons.append(f"codex exited {exit_code}; see {workdir.name}/stderr.txt (auth or quota: codex login)")
    if events.errors:
        v.warnings.extend(f"codex error event: {e}" for e in events.errors)
    if events.malformed_lines:
        v.warnings.append(f"{events.malformed_lines} malformed line(s) in events.jsonl")

    images = thread_images(cfg, events.thread_id) if events.thread_id else []
    v.generated_images = [display_path(p, root, home) for p in images]
    out_path = workdir / output_name
    if not out_path.is_file():
        if images:
            shutil.copyfile(images[0], out_path)
            v.recovered_from_generated_images = True
            v.warnings.append(f"{output_name} was not in the run dir; recovered {display_path(images[0], root, home)}")
        else:
            where = f"{cfg.generated_images}/{events.thread_id}/" if events.thread_id else "generated_images (no thread.started event)"
            v.reasons.append(
                f"no output: {output_name} is missing from {workdir.name}/ and there is no exec-*.png under {where}; "
                f"check {workdir.name}/stderr.txt"
            )
            v.status = "failed"
            return v

    data = out_path.read_bytes()
    v.output_sha256 = sha256_bytes(data)
    try:
        with Image.open(out_path) as im:
            v.size = [im.width, im.height]
            if im.format != "PNG":
                v.reasons.append(f"{output_name} is {im.format}, not PNG")
    except OSError as exc:
        v.reasons.append(f"{output_name} is not a readable image: {exc}")

    match = next((p for p in images if p.read_bytes() == data), None)
    if match is None:
        v.reasons.append(
            f"{output_name} is not byte-identical to any exec-*.png of thread {events.thread_id} "
            "(drawn, re-encoded or edited instead of copied from image_gen)"
        )
    else:
        v.original_output_path = display_path(match, root, home)

    findings = find_drawing(events, output_name)
    v.drawing = [{"command": f.command, "reason": f.reason} for f in findings]
    if findings:
        v.reasons.append(f"events.jsonl shows the image was drawn or re-encoded with code ({len(findings)} command(s))")

    extra = sorted(p.name for p in workdir.iterdir() if p.name not in RUN_FILES and p.name != output_name)
    if extra:
        v.warnings.append(f"unexpected file(s) in the run dir: {', '.join(extra)}")
    if aspect in ASPECT_SIZES and v.size is not None and tuple(v.size) != ASPECT_SIZES[aspect]:
        w, h = ASPECT_SIZES[aspect]
        v.warnings.append(f"size {v.size[0]}x{v.size[1]} is not the usual {w}x{h} for aspect {aspect}")

    if v.reasons:
        v.status = "failed" if exit_code not in (0, None) or v.size is None else "rejected"
    else:
        v.status = "ok"
    return v


# ---------------------------------------------------------------------------------------------
# meta.json


META_KEYS = (
    "id",
    "tool",
    "tool_version",
    "model",
    "date",
    "argv",
    "prompt_sha256",
    "preamble_version",
    "reference_images",
    "original_output_path",
    "candidates_generated",
    "accepted_index",
    "acceptance_notes",
    "golden_sha256",
    "size",
    "seed",
)
"""The fixed ``meta.json`` schema, in order (ASSET_PIPELINE §6.5)."""


def write_json(path: Path, data: Mapping[str, object]) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def draft_meta(
    asset_id: str,
    version: str,
    model: str,
    date: str,
    argv: list[str],
    spec: PromptSpec,
    refs: list[dict[str, str]],
    v: Verification,
) -> dict[str, object]:
    meta: dict[str, object] = {
        "id": asset_id,
        "tool": "codex",
        "tool_version": version,
        "model": MODEL_DESCRIPTION.format(model=model),
        "date": date,
        "argv": argv,
        "prompt_sha256": spec.sha256,
        "preamble_version": spec.preamble_version,
        "reference_images": refs,
        "original_output_path": v.original_output_path,
        "candidates_generated": None,
        "accepted_index": None,
        "acceptance_notes": "",
        "golden_sha256": None,
        "size": v.size,
        "seed": None,
    }
    assert tuple(meta) == META_KEYS
    return meta


# ---------------------------------------------------------------------------------------------
# Paths


def validate_id(asset_id: str) -> None:
    if not _ASSET_ID_RE.match(asset_id):
        raise GenAiError(f"{asset_id!r} is not an asset ID of the form <class>.<snake_name> (CLAUDE.md §5.4)")


def ai_dir(root: Path, asset_id: str) -> Path:
    return root / "assets-src" / "ai" / asset_id


def candidates_dir(root: Path, asset_id: str) -> Path:
    return root / "build" / "ai-candidates" / asset_id


def run_dirs(cand: Path) -> list[tuple[int, Path]]:
    if not cand.is_dir():
        return []
    found = []
    for p in cand.iterdir():
        m = _RUN_DIR_RE.match(p.name)
        if m and p.is_dir():
            found.append((int(m.group(1)), p))
    return sorted(found)


def load_spec(root: Path, asset_id: str) -> tuple[Path, str, PromptSpec]:
    """Read ``prompt.md`` and return (path, original text, refreshed spec)."""
    path = ai_dir(root, asset_id) / "prompt.md"
    try:
        original = path.read_bytes().decode("utf-8")
    except OSError as exc:
        raise GenAiError(f"no prompt: cannot read {display_path(path, root, root)} ({exc.strerror})") from exc
    except UnicodeDecodeError as exc:
        raise GenAiError(f"{display_path(path, root, root)} is not valid UTF-8: {exc}") from exc
    return path, original, refresh_prompt(original, load_preamble(root))


def resolve_refs(root: Path, spec: PromptSpec, cli_refs: Sequence[str] | None) -> list[Path]:
    """``--ref`` paths if given, else the ``References`` declared in ``prompt.md``. Each must exist."""
    raw = list(cli_refs) if cli_refs else list(spec.references)
    refs: list[Path] = []
    for r in raw:
        p = Path(r)
        p = p if p.is_absolute() else root / p
        if not p.is_file():
            raise GenAiError(f"reference image not found: {r}")
        refs.append(p)
    return refs


# ---------------------------------------------------------------------------------------------
# --candidates N


def run_candidates(
    root: Path,
    asset_id: str,
    count: int,
    cli_refs: Sequence[str] | None = None,
    env: Mapping[str, str] | None = None,
    today: str | None = None,
    timeout_s: float = CODEX_TIMEOUT_S,
) -> int:
    """Generate ``count`` candidates into ``build/ai-candidates/<id>/run_NN/`` and write ``review.png``."""
    env = dict(os.environ if env is None else env)
    validate_id(asset_id)
    prompt_path, original, spec = load_spec(root, asset_id)

    # Refuse before any subprocess (including `codex --version`) and before touching any file.
    check_denylist(spec.text, display_path(prompt_path, root, root))

    refs = resolve_refs(root, spec, cli_refs)
    cfg = resolve_config(env)
    home = Path(env.get("HOME") or Path.home())

    if spec.text != original:
        prompt_path.write_bytes(spec.text.encode("utf-8"))
        log.info("refreshed agent instructions and preamble %s in %s", spec.preamble_version, prompt_path)
        print(f"forge gen-ai: refreshed sections 1-2 (agent instructions, preamble {spec.preamble_version}) in prompt.md")

    version = check_codex_version(cfg, env)
    date = today or _dt.date.today().isoformat()
    ref_records = [{"path": display_path(p, root, home), "sha256": sha256_file(p)} for p in refs]
    send_bytes = spec.send_bytes

    cand = candidates_dir(root, asset_id)
    cand.mkdir(parents=True, exist_ok=True)
    existing = run_dirs(cand)
    first = existing[-1][0] + 1 if existing else 0
    results: list[Verification] = []
    for k in range(first, first + count):
        workdir = cand / f"run_{k:02d}"
        workdir.mkdir()
        argv = codex_argv(
            str(cfg.binary), cfg.model, str(workdir.resolve()), str((workdir / "last_message.txt").resolve()),
            [str(p.resolve()) for p in refs],
        )
        shown = codex_argv(
            display_path(cfg.binary, root, home),
            cfg.model,
            display_path(workdir, root, home),
            display_path(workdir / "last_message.txt", root, home),
            [display_path(p, root, home) for p in refs],
        )
        print(f"forge gen-ai: {asset_id} {workdir.name}: running codex ({cfg.model}); about 60 s per image", flush=True)
        log.info("argv: %s", argv)
        start = time.monotonic()
        exit_code: int | None
        with (workdir / "events.jsonl").open("wb") as out, (workdir / "stderr.txt").open("wb") as err:
            try:
                proc = subprocess.run(
                    argv, input=send_bytes, stdout=out, stderr=err, cwd=root, env=env, timeout=timeout_s, check=False
                )
                exit_code = proc.returncode
            except subprocess.TimeoutExpired:
                exit_code = -1
                err.write(f"\nforge gen-ai: killed after {timeout_s} s\n".encode())
        duration = round(time.monotonic() - start, 1)
        v = verify_run(workdir, spec.output_name, cfg, root, home, spec.aspect, exit_code)
        v.duration_s = duration
        write_json(workdir / "verify.json", v.to_json())
        write_json(workdir / "meta.json", draft_meta(asset_id, version, cfg.model, date, shown, spec, ref_records, v))
        results.append(v)
        _report_run(v, workdir, root, home)

    review = cand / "review.png"
    ingest_config, ingest_note = load_ingest_config(ai_dir(root, asset_id))
    write_review(cand, review, ingest_config, ingest_note)
    print(f"forge gen-ai: review image {display_path(review, root, home)}; Read it before --accept <n>")
    print(f"forge gen-ai: draft meta.json in each run dir, e.g. {display_path(cand / results[0].run / 'meta.json', root, home)}")
    bad = [v for v in results if v.status != "ok"]
    if bad:
        print(
            f"forge gen-ai: {len(bad)} of {len(results)} candidate(s) failed verification: "
            + ", ".join(f"{v.run} {v.status}" for v in bad),
            file=sys.stderr,
        )
        return EXIT_FAILED
    return EXIT_OK


def _report_run(v: Verification, workdir: Path, root: Path, home: Path) -> None:
    where = display_path(workdir / v.output, root, home)
    size = f"{v.size[0]}x{v.size[1]}" if v.size else "no image"
    how = "recovered from generated_images" if v.recovered_from_generated_images else "copied by the agent"
    stream = sys.stdout if v.status == "ok" else sys.stderr
    print(f"forge gen-ai: {v.run}: {v.status.upper()} {where} ({size}, {how}, {v.duration_s} s)", file=stream)
    for r in v.reasons:
        print(f"forge gen-ai:   reason: {r}", file=stream)
    for d in v.drawing:
        print(f"forge gen-ai:   drawing: {d['reason']}: {d['command'][:200]}", file=stream)
    for w in v.warnings:
        print(f"forge gen-ai:   warning: {w}", file=stream)


# ---------------------------------------------------------------------------------------------
# review.png (§11.1)

THUMB_BOX = (448, 448)
PAD = 8
LABEL_H = 18
PREVIEW_SCALES = (4, 8)
"""The ingest preview shows every cell's final grid at these magnifications (§11.1)."""

_STATUS_TINT = {"ok": "grass_lt", "rejected": "postbox_red", "failed": "hivis_orange"}


def _thumbnail(path: Path) -> Image.Image:
    with Image.open(path) as im:
        rgba = im.convert("RGBA")
    rgba.thumbnail(THUMB_BOX, Image.Resampling.LANCZOS)
    return rgba


def load_ingest_config(folder: Path) -> tuple[IngestConfig | None, str | None]:
    """``ingest.json`` of an AI folder, if any: (config, None), (None, error) or (None, None)."""
    path = folder / "ingest.json"
    if not path.is_file():
        return None, None
    try:
        return load_config(path), None
    except IngestError as exc:
        return None, f"ingest preview unavailable: {exc}"


def ingest_preview(image_path: Path, config: IngestConfig, pal: Palette) -> Image.Image:
    """The ingest preview of one candidate: every cell's final grid at 4x and 8x, light then dark.

    Four strips, top to bottom: 4x on light, 4x on dark, 8x on light, 8x on dark (backgrounds
    ``kerb`` and ``tar``, as in the contact sheets). It runs :func:`forge.ingest.ingest_sheet`, so it
    shows exactly what ``forge ingest`` would write if this candidate became the golden.
    Raises :class:`IngestError` when the candidate cannot be ingested.
    """
    with Image.open(image_path) as im:
        im.load()
        mode = "RGBA" if "A" in im.getbands() or "transparency" in im.info else "RGB"
        arr = np.asarray(im.convert(mode), dtype=np.uint8).copy()
    result = ingest_sheet(arr, config, pal)
    if not result.cells:
        raise IngestError("no cell with content")
    tw, th = config.target_cell
    backgrounds = (tuple(int(c) for c in pal.rgb[pal.index("kerb")]), tuple(int(c) for c in pal.rgb[pal.index("tar")]))
    strips: list[Image.Image] = []
    for scale in PREVIEW_SCALES:
        cw, ch = tw * scale, th * scale
        for bg in backgrounds:
            strip = Image.new("RGBA", (len(result.cells) * (cw + PAD) - PAD, ch), bg + (255,))
            for k, cell in enumerate(result.cells):
                rgba = indices_to_rgba(cell.final, pal)
                big = np.repeat(np.repeat(rgba, scale, axis=0), scale, axis=1)
                strip.alpha_composite(Image.fromarray(big, "RGBA"), (k * (cw + PAD), 0))
            strips.append(strip)
    width = max(s.width for s in strips)
    out = Image.new("RGBA", (width, sum(s.height for s in strips) + PAD * (len(strips) - 1)), (0, 0, 0, 0))
    y = 0
    for s in strips:
        out.alpha_composite(s, (0, y))
        y += s.height + PAD
    return out


@dataclass
class _ReviewRow:
    label: str
    status: str
    thumb: Image.Image | None
    preview: Image.Image | None = None
    note: str | None = None


def write_review(cand: Path, out: Path, ingest_config: IngestConfig | None = None, ingest_note: str | None = None) -> None:
    """``review.png``: one row per run with its label, then the raw image downsized on a light and a
    dark background, then (when the asset has an ``ingest.json``) the ingest preview at final cell
    size, 4x and 8x, on light and dark (ASSET_PIPELINE §11.1). ``concept.*`` and other assets with
    no ``ingest.json`` get the raw thumbnails only.
    """
    pal = load_palette()
    colour = {name: tuple(int(c) for c in pal.rgb[pal.index(name)]) + (255,) for name in pal.names}
    rows: list[_ReviewRow] = []
    for _, d in run_dirs(cand):
        vpath = d / "verify.json"
        if not vpath.exists():
            continue
        info = json.loads(vpath.read_text(encoding="utf-8"))
        status = str(info.get("status", "failed"))
        img_path = d / str(info.get("output", ""))
        has_image = bool(info.get("size")) and img_path.is_file()
        size = info.get("size")
        label = f"{d.name}  {status.upper()}"
        if isinstance(size, list):
            label += f"  {size[0]}x{size[1]}"
        reasons = info.get("reasons") or []
        if reasons:
            label += f"  - {str(reasons[0])[:90]}"
        row = _ReviewRow(label, status, _thumbnail(img_path) if has_image else None, note=ingest_note)
        if has_image and ingest_config is not None:
            try:
                row.preview = ingest_preview(img_path, ingest_config, pal)
                row.note = "ingest preview: final cells at 4x and 8x, light and dark"
            except (IngestError, OSError, ValueError) as exc:
                row.note = f"ingest preview failed: {str(exc)[:110]}"
        rows.append(row)

    def row_height(r: _ReviewRow) -> int:
        h = LABEL_H + (r.thumb.height if r.thumb else 24) + PAD
        if r.note:
            h += LABEL_H
        if r.preview is not None:
            h += r.preview.height + PAD
        return h

    width = max([PAD * 3 + THUMB_BOX[0] * 2] + [PAD * 2 + r.preview.width for r in rows if r.preview is not None])
    heights = [row_height(r) for r in rows]
    height = PAD + sum(heights) if rows else PAD * 2 + LABEL_H
    sheet = Image.new("RGBA", (width, height), colour["asphalt"])
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    if not rows:
        draw.text((PAD, PAD), "no candidates", fill=colour["chalk"], font=font)
    y = PAD
    for r, h in zip(rows, heights, strict=True):
        tint = colour[_STATUS_TINT.get(r.status, "chalk")]
        draw.text((PAD, y + 2), r.label, fill=tint, font=font)
        top = y + LABEL_H
        if r.thumb is not None:
            for k, bg in enumerate(("kerb", "tar")):
                x = PAD + k * (THUMB_BOX[0] + PAD)
                panel = Image.new("RGBA", r.thumb.size, colour[bg])
                panel.alpha_composite(r.thumb)
                sheet.paste(panel, (x, top))
                if r.status != "ok":
                    draw.rectangle((x - 2, top - 2, x + r.thumb.width + 1, top + r.thumb.height + 1), outline=tint, width=2)
            top += r.thumb.height + PAD
        else:
            draw.text((PAD, top + 4), "(no image)", fill=tint, font=font)
            top += 24 + PAD
        if r.note:
            draw.text((PAD, top), r.note, fill=colour["chalk"], font=font)
            top += LABEL_H
        if r.preview is not None:
            sheet.alpha_composite(r.preview, (PAD, top))
        y += h
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(encode_rgba_png(np.asarray(sheet, dtype=np.uint8)))


# ---------------------------------------------------------------------------------------------
# --accept <n>


def accept_candidate(root: Path, asset_id: str, index: int, env: Mapping[str, str] | None = None) -> int:
    """Copy ``run_NN/<output>`` byte-for-byte to ``golden.png`` and complete ``meta.json``."""
    env = dict(os.environ if env is None else env)
    home = Path(env.get("HOME") or Path.home())
    validate_id(asset_id)
    cand = candidates_dir(root, asset_id)
    runs = run_dirs(cand)
    by_index = dict(runs)
    if index not in by_index:
        have = ", ".join(str(k) for k, _ in runs) or "none"
        raise GenAiError(f"no candidate run_{index:02d} under {display_path(cand, root, home)} (have: {have})")
    workdir = by_index[index]
    try:
        info = json.loads((workdir / "verify.json").read_text(encoding="utf-8"))
        draft = json.loads((workdir / "meta.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise GenAiError(f"{workdir.name} has no readable verify.json/meta.json: {exc}") from exc
    if info.get("status") != "ok":
        raise GenAiError(f"{workdir.name} did not pass verification ({info.get('status')}): {info.get('reasons')}")

    src = workdir / str(info["output"])
    data = src.read_bytes()
    if sha256_bytes(data) != info.get("output_sha256"):
        raise GenAiError(f"{display_path(src, root, home)} changed since it was verified; refusing to accept it")

    prompt_path = ai_dir(root, asset_id) / "prompt.md"
    current = prompt_sha256(prompt_path.read_bytes().decode("utf-8"))
    if current != draft.get("prompt_sha256"):
        raise GenAiError(
            f"prompt.md changed since {workdir.name} was generated (prompt_sha256 {current} != "
            f"{draft.get('prompt_sha256')}); generate new candidates from the current prompt"
        )
    for ref in draft.get("reference_images") or []:
        rp = Path(ref["path"])
        rp = home / ref["path"][2:] if ref["path"].startswith("~/") else (rp if rp.is_absolute() else root / rp)
        if not rp.is_file() or sha256_file(rp) != ref["sha256"]:
            raise GenAiError(f"reference image {ref['path']} changed or vanished since {workdir.name} was generated")

    dest_dir = ai_dir(root, asset_id)
    golden = dest_dir / "golden.png"
    shutil.copyfile(src, golden)
    if golden.read_bytes() != data:
        raise GenAiError("golden.png is not byte-identical to the candidate after copying")
    with Image.open(golden) as im:
        size = [im.width, im.height]

    golden_sha = sha256_bytes(data)
    notes = ""
    meta_path = dest_dir / "meta.json"
    if meta_path.exists():
        try:
            old = json.loads(meta_path.read_text(encoding="utf-8"))
            if old.get("golden_sha256") == golden_sha and isinstance(old.get("acceptance_notes"), str):
                notes = old["acceptance_notes"]
        except json.JSONDecodeError:
            pass
    meta = dict(draft)
    meta.update(
        {
            "original_output_path": info.get("original_output_path"),
            "candidates_generated": sum(1 for _, d in runs if (d / "verify.json").exists()),
            "accepted_index": index,
            "acceptance_notes": notes,
            "golden_sha256": golden_sha,
            "size": size,
            "seed": None,
        }
    )
    write_json(meta_path, {k: meta[k] for k in META_KEYS})
    print(f"forge gen-ai: accepted {workdir.name} -> {display_path(golden, root, home)} ({size[0]}x{size[1]})")
    if not notes:
        print(
            f"forge gen-ai: write acceptance_notes in {display_path(meta_path, root, home)} by hand: why "
            f"{workdir.name} won and one clause per rejected candidate (ASSET_PIPELINE §11.1)"
        )
    return EXIT_OK


# ---------------------------------------------------------------------------------------------
# CLI entry


def cli(args: argparse.Namespace, repo_root: Path | None = None, env: Mapping[str, str] | None = None) -> int:
    """``forge gen-ai <id> [--tool codex|cursor] [--candidates N | --accept <n>] [--ref PATH]...``."""
    root = (repo_root if repo_root is not None else REPO_ROOT).resolve()
    shown = {k: getattr(args, k, None) for k in ("id", "tool", "candidates", "accept", "ref")}
    log.debug("forge gen-ai: arguments %s", shown)
    if args.tool == "cursor":
        print(CURSOR_NOT_IMPLEMENTED, file=sys.stderr)
        return EXIT_NOT_IMPLEMENTED
    try:
        if args.accept is not None:
            if args.ref:
                print("forge gen-ai: --ref is ignored with --accept (references are recorded per run)", file=sys.stderr)
            return accept_candidate(root, args.id, args.accept, env=env)
        return run_candidates(root, args.id, args.candidates or 1, cli_refs=args.ref, env=env)
    except GenAiError as exc:
        print(f"forge gen-ai: {exc}", file=sys.stderr)
        return EXIT_FAILED
