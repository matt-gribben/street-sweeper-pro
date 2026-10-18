"""``forge verify [--pixels]``: rebuild into a temp root and compare with the committed outputs.

ASSET_PIPELINE §5.2/§5.3/§13.5. Steps:

1. Empty ``build/tmp/verify/`` and run ``forge build --no-cache --out build/tmp/verify/`` (always
   cold, so a stale cache can never hide a difference).
2. Run the audio and level tools (``tools/audio/render-sfx.ts``, ``tools/audio/render-music.ts``,
   ``tools/levels/compile-level.ts``) with ``--out build/tmp/verify``. In M0 they are input-count
   guards (SSP-006): a non-zero exit (sources present, not implemented yet) fails verify.
3. Compare, path by path, the generated tree of the rebuild with the committed one. The
   generated tree is every file under ``public/assets/`` plus ``src/gen/assets.ts``, and the
   paths listed in the committed ``public/assets/asset-hashes.json`` join the set. A path fails
   when:

   - its rebuilt and committed bytes differ (``--pixels``: see below);
   - it was generated but is not committed (**missing**), or is committed but not generated
     (**stale**);
   - it is generated but not listed in the committed ``asset-hashes.json`` (**unlisted**), is
     listed but not generated, or its committed bytes do not match the listed SHA-256.

``--pixels`` (D-12): a PNG whose bytes differ is decoded on both sides and compared as RGBA.
Identical pixels pass and are reported as ``pixels identical, bytes differ``; otherwise the
number of differing pixels is reported. JSON and TS are still byte-compared, except that the
SHA-256 entries in ``asset-hashes.json`` of PNGs found pixel-identical may differ (they are
hashes of encoder output, so encoder drift changes them too).

The exit status is 0 when every path passes and 1 otherwise; every path gets one report line.
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import shutil
import subprocess
import sys
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image

from forge.build import BuildError, build
from forge.outputs import ASSETS_TS, HASHES_JSON, sha256_hex
from forge.palette import REPO_ROOT

__all__ = [
    "GENERATED_DIRS",
    "GENERATED_FILES",
    "PIXELS_IDENTICAL",
    "TOOL_SCRIPTS",
    "VERIFY_DIR",
    "FileReport",
    "VerifyReport",
    "cli",
    "compare_trees",
    "generated_tree",
    "run_tools",
    "tool_commands",
    "verify",
]

log = logging.getLogger("forge")

VERIFY_DIR = Path("build") / "tmp" / "verify"
"""Temp root of the rebuild, relative to the repo root."""

GENERATED_DIRS = ("public/assets",)
"""Directories whose every file is a generated output."""

GENERATED_FILES = (ASSETS_TS,)
"""Generated files outside :data:`GENERATED_DIRS`."""

TOOL_SCRIPTS = (
    "tools/audio/render-sfx.ts",
    "tools/audio/render-music.ts",
    "tools/levels/compile-level.ts",
)
"""The Node tools ``npm run assets`` runs after ``forge build`` (each takes ``--out <dir>``)."""

PIXELS_IDENTICAL = "pixels identical, bytes differ"

Runner = Callable[[Sequence[str]], int]
"""Runs one command line and returns its exit status (injectable for tests)."""


@dataclass
class FileReport:
    """The verdict for one generated path."""

    path: str
    problems: list[str] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.problems

    def line(self) -> str:
        if self.problems:
            return f"FAIL  {self.path}: {'; '.join(self.problems + self.notes)}"
        return f"ok    {self.path}" + (f": {'; '.join(self.notes)}" if self.notes else "")


@dataclass
class VerifyReport:
    """Everything ``forge verify`` found."""

    files: list[FileReport] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    """Failures that are not about one file (build error, tool failure)."""

    @property
    def ok(self) -> bool:
        return not self.errors and all(f.ok for f in self.files)

    @property
    def failed(self) -> list[FileReport]:
        return [f for f in self.files if not f.ok]


# ---------------------------------------------------------------------------------------------
# Trees


def generated_tree(root: Path) -> dict[str, Path]:
    """Every generated file under ``root``, keyed by its ``/``-separated path relative to ``root``."""
    out: dict[str, Path] = {}
    for d in GENERATED_DIRS:
        base = root / d
        if base.is_dir():
            for p in base.rglob("*"):
                if p.is_file():
                    out[p.relative_to(root).as_posix()] = p
    for f in GENERATED_FILES:
        if (root / f).is_file():
            out[f] = root / f
    return dict(sorted(out.items()))


def _load_hashes(data: bytes) -> dict[str, str]:
    doc = json.loads(data.decode("utf-8"))
    if not isinstance(doc, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in doc.items()):
        raise ValueError("expected an object mapping paths to SHA-256 strings")
    return dict(doc)


def _decode_rgba(data: bytes) -> np.ndarray:
    with Image.open(io.BytesIO(data)) as im:
        im.load()
        return np.asarray(im.convert("RGBA"), dtype=np.uint8).copy()


def _pixel_verdict(committed: bytes, rebuilt: bytes) -> str | None:
    """``None`` when the decoded RGBA pixels are identical, else a description of the difference."""
    try:
        a = _decode_rgba(committed)
    except Exception as exc:  # any decode failure is a real difference
        return f"committed PNG cannot be decoded ({exc})"
    try:
        b = _decode_rgba(rebuilt)
    except Exception as exc:  # any decode failure is a real difference
        return f"rebuilt PNG cannot be decoded ({exc})"
    if a.shape != b.shape:
        return f"size differs (committed {a.shape[1]}x{a.shape[0]}, rebuilt {b.shape[1]}x{b.shape[0]})"
    diff = int((a != b).any(axis=-1).sum())
    return None if diff == 0 else f"{diff} pixel(s) differ"


def compare_trees(committed_root: Path, rebuilt_root: Path, *, pixels: bool = False) -> list[FileReport]:
    """Compare the generated files of two roots (see the module docstring for the rules)."""
    committed = generated_tree(committed_root)
    rebuilt = generated_tree(rebuilt_root)

    listing: dict[str, str] | None = None
    listing_error: str | None = None
    if HASHES_JSON in committed:
        try:
            listing = _load_hashes(committed[HASHES_JSON].read_bytes())
        except (ValueError, UnicodeDecodeError) as exc:
            listing_error = f"committed asset-hashes.json is unreadable ({exc})"
    listed = set(listing or {})

    reports: dict[str, FileReport] = {}
    pixel_ok: set[str] = set()
    paths = sorted(set(committed) | set(rebuilt) | listed)
    for path in paths:
        rep = reports[path] = FileReport(path)
        in_c, in_r = path in committed, path in rebuilt
        if in_r and not in_c:
            rep.problems.append("missing: generated by the rebuild but not committed (run `npm run assets`)")
        elif in_c and not in_r:
            rep.problems.append("stale: committed but not generated by the rebuild")
        elif in_c and in_r and path != HASHES_JSON:
            c_bytes, r_bytes = committed[path].read_bytes(), rebuilt[path].read_bytes()
            if c_bytes != r_bytes:
                if pixels and path.endswith(".png"):
                    verdict = _pixel_verdict(c_bytes, r_bytes)
                    if verdict is None:
                        rep.notes.append(PIXELS_IDENTICAL)
                        pixel_ok.add(path)
                    else:
                        rep.problems.append(f"pixels differ: {verdict}")
                else:
                    rep.problems.append(
                        f"bytes differ (committed sha256 {sha256_hex(c_bytes)[:12]}, rebuilt {sha256_hex(r_bytes)[:12]})"
                    )

    # The hash listing.
    for path in paths:
        if path == HASHES_JSON:
            continue
        rep = reports[path]
        if listing is None:
            continue
        if path in rebuilt and path not in listed:
            rep.problems.append("unlisted: generated but not listed in public/assets/asset-hashes.json")
        elif path in listed and path not in rebuilt:
            rep.problems.append("listed in public/assets/asset-hashes.json but not generated")
        elif path in listed and path in committed:
            actual = sha256_hex(committed[path].read_bytes())
            if actual != listing[path]:
                if path in pixel_ok:
                    rep.notes.append("committed bytes do not match asset-hashes.json (pixels identical)")
                else:
                    rep.problems.append("committed bytes do not match their asset-hashes.json entry")

    # asset-hashes.json itself.
    if HASHES_JSON in committed and HASHES_JSON in rebuilt:
        rep = reports[HASHES_JSON]
        if listing_error:
            rep.problems.append(listing_error)
        else:
            c_bytes, r_bytes = committed[HASHES_JSON].read_bytes(), rebuilt[HASHES_JSON].read_bytes()
            if c_bytes != r_bytes:
                tolerated = False
                if pixels and listing is not None:
                    try:
                        fresh = _load_hashes(r_bytes)
                    except (ValueError, UnicodeDecodeError):
                        fresh = None
                    if fresh is not None and set(fresh) == set(listing):
                        differing = {k for k in fresh if fresh[k] != listing[k]}
                        tolerated = differing <= pixel_ok
                        if tolerated:
                            rep.notes.append(
                                f"differs only in the hashes of {len(differing)} PNG(s) whose pixels are identical"
                            )
                if not tolerated:
                    rep.problems.append(
                        f"bytes differ (committed sha256 {sha256_hex(c_bytes)[:12]}, rebuilt {sha256_hex(r_bytes)[:12]})"
                    )
    elif HASHES_JSON in committed and listing_error:
        reports[HASHES_JSON].problems.append(listing_error)

    return [reports[p] for p in paths]


# ---------------------------------------------------------------------------------------------
# Tools


def tool_commands(repo_root: Path, out_root: Path, node: str | None = None) -> list[list[str]]:
    """The audio and level tool command lines, each with ``--out <out_root>``."""
    exe = node or shutil.which("node") or "node"
    return [[exe, str(repo_root / script), "--out", str(out_root)] for script in TOOL_SCRIPTS]


def _subprocess_runner(cwd: Path) -> Runner:
    def run(cmd: Sequence[str]) -> int:
        log.debug("forge verify: running %s", " ".join(cmd))
        try:
            proc = subprocess.run(list(cmd), cwd=cwd, check=False, capture_output=True, text=True)
        except FileNotFoundError as exc:
            print(f"forge verify: cannot run {cmd[0]}: {exc}", file=sys.stderr)
            return 127
        for line in (proc.stdout + proc.stderr).splitlines():
            print(f"  {line}", file=sys.stderr)
        return proc.returncode

    return run


def run_tools(commands: Sequence[Sequence[str]], runner: Runner) -> list[str]:
    """Run each command; returns one error line per command that exited non-zero."""
    errors: list[str] = []
    for cmd in commands:
        status = runner(cmd)
        if status != 0:
            name = Path(cmd[1]).name if len(cmd) > 1 else cmd[0]
            errors.append(f"{name} exited {status} (with --out under the verify root)")
    return errors


# ---------------------------------------------------------------------------------------------
# Entry points


def verify(
    *,
    repo_root: Path = REPO_ROOT,
    pixels: bool = False,
    tmp_root: Path | None = None,
    commands: Sequence[Sequence[str]] | None = None,
    runner: Runner | None = None,
) -> VerifyReport:
    """Rebuild into ``tmp_root`` (default ``<repo_root>/build/tmp/verify``) and compare.

    ``commands`` defaults to :func:`tool_commands`; ``runner`` defaults to a subprocess runner
    with ``cwd=repo_root``.
    """
    tmp_root = tmp_root or repo_root / VERIFY_DIR
    if tmp_root.exists():
        shutil.rmtree(tmp_root)
    tmp_root.mkdir(parents=True)
    report = VerifyReport()
    try:
        build(repo_root=repo_root, out_root=tmp_root, use_cache=False)
    except BuildError as exc:
        report.errors.append(f"forge build failed: {exc}")
        return report
    cmds = tool_commands(repo_root, tmp_root) if commands is None else commands
    report.errors.extend(run_tools(cmds, runner or _subprocess_runner(repo_root)))
    report.files = compare_trees(repo_root, tmp_root, pixels=pixels)
    return report


def cli(args: argparse.Namespace) -> int:
    """``forge verify [--pixels]``."""
    report = verify(pixels=bool(args.pixels))
    mode = "decoded RGBA for PNGs, bytes for JSON/TS" if args.pixels else "bytes"
    print(f"forge verify: comparing {len(report.files)} generated file(s) with a rebuild in {VERIFY_DIR} ({mode})")
    for f in report.files:
        print(f"forge verify: {f.line()}")
    for e in report.errors:
        print(f"forge verify: error: {e}", file=sys.stderr)
    if report.ok:
        print("forge verify: OK")
        return 0
    failed = report.failed
    if failed:
        print(
            f"forge verify: {len(failed)} file(s) differ from a clean rebuild: {', '.join(f.path for f in failed)}",
            file=sys.stderr,
        )
        print("forge verify: run `npm run assets` and commit the outputs, or fix the non-determinism", file=sys.stderr)
    return 1
