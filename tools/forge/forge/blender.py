"""``forge blender``: run headless Blender 5.2.2 LTS safely (ASSET_PIPELINE §7.1).

Local only: never called by ``forge build``, tests or CI (CLAUDE.md §3.5). What the
wrapper adds to the raw command:

- **Version gate.** Refuses to run unless ``<blender> -b --factory-startup --version``
  reports ``Blender 5.2.2 LTS``. ``SSP_BLENDER`` overrides the binary path.
- **Script lookup.** ``<class>.<name>`` -> ``assets-src/blender/{vehicles,props,roofkit}/<name>.py``
  (exactly one match). ``--size`` = 4 x the script's ``CELL_PX``; ``--headings`` by class
  (veh 32, prop 1, roof 4); the expected frames come from the script's ``STATES``. Both are
  cross-checked against ``assets-src/manifest.json`` when it has an entry for the ID.
- **Temp render + atomic swap.** Blender renders into ``build/tmp/blender/<id>/``. Only after
  it exits 0 with no ``Traceback`` in stderr, the frame set is exactly the expected one and
  ``render.json`` verifies, the frames are staged and swapped into
  ``assets-src/rendered/<id>/`` with two renames. Any failure leaves the target untouched.
- **render.json verification.** ``{blender_version, script_sha256, argv, tilt_deg, pivots_px}``
  is written by the rig (``rig.write_render_json``) and checked here; ``script_sha256`` is
  sha256(script bytes + NUL + rig.py bytes). The ``--out`` value in ``argv`` is rewritten
  from the temp dir to ``assets-src/rendered/<id>`` so committed provenance is
  machine-independent.
- **--check.** Renders to the temp dir, prints per-frame changed-pixel counts against the
  committed renders, writes diff PNGs to ``build/tmp/blender/<id>/diff/``, replaces nothing
  and exits non-zero if any pixel changed.
"""

from __future__ import annotations

import argparse
import ast
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
import numpy.typing as npt
from PIL import Image

from forge.palette import REPO_ROOT, load_palette

__all__ = [
    "BLENDER_ENV",
    "CLASS_DIRS",
    "DEFAULT_BLENDER",
    "HEADINGS_BY_CLASS",
    "REQUIRED_VERSION",
    "AssetScript",
    "BlenderError",
    "CheckReport",
    "FrameDiff",
    "all_asset_ids",
    "blender_argv",
    "blender_path",
    "blender_version",
    "check_version",
    "compare_frames",
    "expected_frames",
    "find_script",
    "load_asset",
    "parse_cell_px",
    "parse_states",
    "render_asset",
    "run",
    "script_sha256",
]

log = logging.getLogger("forge")

DEFAULT_BLENDER = Path("/Applications/Blender.app/Contents/MacOS/Blender")
BLENDER_ENV = "SSP_BLENDER"
REQUIRED_VERSION = "5.2.2 LTS"

HEADINGS_BY_CLASS: Mapping[str, int] = {"veh": 32, "prop": 1, "roof": 4}
"""Headings rendered per asset class (ASSET_PIPELINE §7.1)."""

CLASS_DIRS: Mapping[str, str] = {"veh": "vehicles", "prop": "props", "roof": "roofkit"}
"""Script directory under ``assets-src/blender/`` per class (and back, for ``all``)."""

MANIFEST_DIRS: Mapping[str, int] = {"h32": 32, "h4": 4, "-": 1}
"""Manifest ``dirs`` value -> heading count, for the manifest cross-check."""

SIZE_FACTOR = 4
"""Renders are 4x the target cell (ASSET_PIPELINE §7.1)."""

TILT_DEG = 0
VERSION_TIMEOUT_S = 60
RENDER_TIMEOUT_S = 900
RENDER_JSON_KEYS = frozenset({"blender_version", "script_sha256", "argv", "tilt_deg", "pivots_px"})

BLENDER_SRC = Path("assets-src") / "blender"
RENDERED = Path("assets-src") / "rendered"
TMP_ROOT = Path("build") / "tmp" / "blender"

_ID_RE = re.compile(r"^([a-z]+)\.([a-z0-9_]+)$")
_CELL_PX_RE = re.compile(r"^CELL_PX\s*=\s*(\d+)\s*(?:#.*)?$", re.MULTILINE)
_VERSION_RE = re.compile(r"^Blender (\d+(?:\.\d+)+(?: LTS)?)(?:\s|$)")
_FRAME_STATE_RE = re.compile(r"^[a-z][a-z0-9_]*$")

U8Array = npt.NDArray[np.uint8]


class BlenderError(RuntimeError):
    """A ``forge blender`` failure. The message is printed to stderr as-is."""


# ---------------------------------------------------------------------------------------------
# Binary and version gate


def blender_path(env: Mapping[str, str] | None = None) -> Path:
    """The Blender binary: ``$SSP_BLENDER`` if set, else the dev Mac's absolute path."""
    env = os.environ if env is None else env
    override = env.get(BLENDER_ENV, "").strip()
    return Path(override) if override else DEFAULT_BLENDER


def _child_env() -> dict[str, str]:
    """The environment for Blender: the caller's, minus anything that could steer its Python."""
    return {k: v for k, v in os.environ.items() if not k.startswith("PYTHON") and k != "VIRTUAL_ENV"}


def parse_version(output: str) -> str | None:
    """``"5.2.2 LTS"`` from ``Blender 5.2.2 LTS (hash ...)``, or ``None`` if no version line."""
    for line in output.splitlines():
        m = _VERSION_RE.match(line.strip())
        if m:
            return m.group(1)
    return None


def blender_version(binary: Path) -> str:
    """Run ``<binary> -b --factory-startup --version`` and return the reported version."""
    if not binary.is_file() or not os.access(binary, os.X_OK):
        raise BlenderError(
            f"forge blender: Blender not found or not executable at {binary} "
            f"(set {BLENDER_ENV}=/path/to/Blender for a non-standard install)"
        )
    try:
        proc = subprocess.run(
            [str(binary), "-b", "--factory-startup", "--version"],
            capture_output=True,
            text=True,
            timeout=VERSION_TIMEOUT_S,
            env=_child_env(),
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise BlenderError(f"forge blender: could not run {binary} --version: {exc}") from exc
    version = parse_version(proc.stdout) or parse_version(proc.stderr)
    if proc.returncode != 0 or version is None:
        raise BlenderError(
            f"forge blender: {binary} --version failed (exit {proc.returncode}): "
            f"{(proc.stderr or proc.stdout).strip()[:500]}"
        )
    return version


def check_version(binary: Path) -> str:
    """The version gate: return the version, or raise unless it is exactly 5.2.2 LTS."""
    version = blender_version(binary)
    if version != REQUIRED_VERSION:
        raise BlenderError(
            f"forge blender: version mismatch: {binary} reports 'Blender {version}', "
            f"required 'Blender {REQUIRED_VERSION}' (a different Blender changes pixels)"
        )
    return version


# ---------------------------------------------------------------------------------------------
# Asset scripts


@dataclass(frozen=True)
class AssetScript:
    """One Blender asset: its script and the render parameters derived from it."""

    asset_id: str
    script: Path
    cell_px: int
    states: Mapping[str, int]
    headings: int

    @property
    def size(self) -> int:
        return SIZE_FACTOR * self.cell_px

    @property
    def frames(self) -> list[str]:
        return expected_frames(self.states, self.headings)


def split_id(asset_id: str) -> tuple[str, str]:
    """``("veh", "sweeper")`` from ``veh.sweeper``; only Blender classes are accepted."""
    m = _ID_RE.match(asset_id)
    if not m:
        raise BlenderError(f"forge blender: {asset_id!r} is not an asset ID of the form <class>.<snake_name>")
    cls, name = m.group(1), m.group(2)
    if cls not in HEADINGS_BY_CLASS:
        raise BlenderError(
            f"forge blender: class {cls!r} of {asset_id} is not rendered in Blender "
            f"(Blender classes: {', '.join(sorted(HEADINGS_BY_CLASS))})"
        )
    return cls, name


def find_script(asset_id: str, repo: Path = REPO_ROOT) -> Path:
    """The single ``assets-src/blender/{vehicles,props,roofkit}/<name>.py`` for ``asset_id``."""
    cls, name = split_id(asset_id)
    matches = [
        repo / BLENDER_SRC / d / f"{name}.py" for d in sorted(CLASS_DIRS.values()) if (repo / BLENDER_SRC / d / f"{name}.py").is_file()
    ]
    if not matches:
        dirs = ", ".join(f"{BLENDER_SRC}/{d}/" for d in sorted(CLASS_DIRS.values()))
        raise BlenderError(f"forge blender: no script for {asset_id}: expected {name}.py in one of {dirs}")
    if len(matches) > 1:
        found = ", ".join(str(p.relative_to(repo)) for p in matches)
        raise BlenderError(f"forge blender: {asset_id} matches more than one script: {found}")
    script = matches[0]
    if script.parent.name != CLASS_DIRS[cls]:
        raise BlenderError(
            f"forge blender: {asset_id} resolves to {script.relative_to(repo)}, but class {cls!r} "
            f"scripts live in {BLENDER_SRC}/{CLASS_DIRS[cls]}/"
        )
    return script


def parse_cell_px(text: str, where: str = "script") -> int:
    """``CELL_PX = <int>`` at module level, by regex (exactly one assignment)."""
    found = _CELL_PX_RE.findall(text)
    if len(found) != 1:
        raise BlenderError(f"forge blender: {where} must assign CELL_PX = <int> exactly once at module level")
    cell = int(found[0])
    if cell < 1 or cell % 2:
        raise BlenderError(f"forge blender: {where}: CELL_PX must be a positive even integer, got {cell}")
    return cell


def parse_states(text: str, where: str = "script") -> dict[str, int]:
    """``STATES`` at module level: ``{"body": 1, "dented": 1}`` (state -> frames per heading).

    A tuple or list of names means one frame per heading each. Read with ``ast`` (never
    executed). Order is kept, but the frame set is what is checked.
    """
    try:
        tree = ast.parse(text)
    except SyntaxError as exc:
        raise BlenderError(f"forge blender: {where} is not valid Python: {exc}") from exc
    values: list[ast.expr] = []
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "STATES" for t in node.targets):
            values.append(node.value)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == "STATES":
            if node.value is not None:
                values.append(node.value)
    if len(values) != 1:
        raise BlenderError(f"forge blender: {where} must assign STATES exactly once at module level")
    try:
        raw: object = ast.literal_eval(values[0])
    except ValueError as exc:
        raise BlenderError(f"forge blender: {where}: STATES must be a literal dict or tuple") from exc
    if isinstance(raw, (tuple, list)):
        raw = dict.fromkeys(raw, 1) if len(set(raw)) == len(raw) else None
    if not isinstance(raw, dict) or not raw:
        raise BlenderError(f"forge blender: {where}: STATES must be a non-empty dict of state -> frames per heading")
    states: dict[str, int] = {}
    for k, v in raw.items():
        if not isinstance(k, str) or not _FRAME_STATE_RE.match(k):
            raise BlenderError(f"forge blender: {where}: state name {k!r} must be snake_case")
        if isinstance(v, bool) or not isinstance(v, int) or v < 1:
            raise BlenderError(f"forge blender: {where}: STATES[{k!r}] must be an integer >= 1")
        states[k] = v
    return states


def expected_frames(states: Mapping[str, int], headings: int) -> list[str]:
    """Sorted PNG names a script must write (ASSET_PIPELINE §6.6).

    - ``body`` with 1 frame -> ``hNN.png``;
    - ``slice`` (sprite-stack props, 1 heading) -> ``slice_<k>.png``;
    - any other state with 1 frame -> ``<state>_hNN.png``;
    - n > 1 frames -> ``<state>_hNN_<f>.png`` (``hNN_<f>.png`` for ``body``).
    """
    names: list[str] = []
    for state, n in states.items():
        if state == "slice":
            if headings != 1:
                raise BlenderError("forge blender: the 'slice' state needs --headings 1 (sprite-stack props)")
            names += [f"slice_{k}.png" for k in range(n)]
            continue
        prefix = "" if state == "body" else f"{state}_"
        for i in range(headings):
            if n == 1:
                names.append(f"{prefix}h{i:02d}.png")
            else:
                names += [f"{prefix}h{i:02d}_{f}.png" for f in range(n)]
    if len(set(names)) != len(names):
        raise BlenderError("forge blender: STATES produce duplicate frame names")
    return sorted(names)


def _load_manifest_entry(asset_id: str, repo: Path) -> Mapping[str, object] | None:
    path = repo / "assets-src" / "manifest.json"
    if not path.is_file():
        return None
    try:
        data: object = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise BlenderError(f"forge blender: {path.relative_to(repo)} is not valid JSON: {exc}") from exc
    assets = data.get("assets") if isinstance(data, dict) else None
    if not isinstance(assets, list):
        raise BlenderError(f"forge blender: {path.relative_to(repo)} has no 'assets' list")
    for entry in assets:
        if isinstance(entry, dict) and entry.get("id") == asset_id:
            return entry
    return None


def _cross_check_manifest(asset: AssetScript, repo: Path) -> None:
    entry = _load_manifest_entry(asset.asset_id, repo)
    if entry is None:
        log.debug("forge blender: %s has no manifest entry; skipping the cross-check", asset.asset_id)
        return
    problems: list[str] = []
    cell = entry.get("cell")
    if cell is not None and cell != [asset.cell_px, asset.cell_px]:
        problems.append(f"manifest cell {cell} != script CELL_PX {asset.cell_px} (render --size {asset.size})")
    frames = entry.get("frames")
    if frames is not None and frames != dict(asset.states):
        problems.append(f"manifest frames {frames} != script STATES {dict(asset.states)}")
    dirs = entry.get("dirs")
    if isinstance(dirs, str) and MANIFEST_DIRS.get(dirs, asset.headings) != asset.headings:
        problems.append(f"manifest dirs {dirs!r} != {asset.headings} headings for its class")
    if problems:
        raise BlenderError(f"forge blender: {asset.asset_id}: " + "; ".join(problems))


def load_asset(asset_id: str, repo: Path = REPO_ROOT) -> AssetScript:
    """Resolve ``asset_id`` to its script and render parameters (cross-checked with the manifest)."""
    cls, _ = split_id(asset_id)
    script = find_script(asset_id, repo)
    text = script.read_text(encoding="utf-8")
    where = str(script.relative_to(repo))
    asset = AssetScript(
        asset_id=asset_id,
        script=script,
        cell_px=parse_cell_px(text, where),
        states=parse_states(text, where),
        headings=HEADINGS_BY_CLASS[cls],
    )
    expected_frames(asset.states, asset.headings)  # validates the state/heading combination
    _cross_check_manifest(asset, repo)
    return asset


def all_asset_ids(repo: Path = REPO_ROOT) -> list[str]:
    """Every asset ID with a script under ``assets-src/blender/{vehicles,props,roofkit}/``, sorted."""
    ids = [
        f"{cls}.{p.stem}"
        for cls, d in CLASS_DIRS.items()
        for p in (repo / BLENDER_SRC / d).glob("*.py")
        if not p.name.startswith("_")
    ]
    return sorted(ids)


# ---------------------------------------------------------------------------------------------
# Provenance


def script_sha256(script: Path, rig: Path) -> str:
    """sha256(asset script bytes + NUL + rig.py bytes) (ASSET_PIPELINE §6.6)."""
    h = hashlib.sha256(script.read_bytes())
    h.update(b"\0")
    h.update(rig.read_bytes())
    return h.hexdigest()


def blender_argv(out: str, size: int, headings: int, tilt: int = TILT_DEG) -> list[str]:
    """The script arguments after ``--`` (ASSET_PIPELINE §7.1)."""
    return ["--out", out, "--size", str(size), "--headings", str(headings), "--tilt", str(tilt)]


def blender_command(binary: Path, script_rel: str, argv: Sequence[str]) -> list[str]:
    """The exact command line: ``-b --factory-startup --python-exit-code 1 -P <script> -- ...``."""
    return [str(binary), "-b", "--factory-startup", "--python-exit-code", "1", "-P", script_rel, "--", *argv]


def _render_json_text(data: Mapping[str, object]) -> str:
    """Serialised exactly as ``rig.write_render_json`` writes it."""
    return json.dumps(data, indent=2) + "\n"


def verify_render_json(tmp_dir: Path, asset: AssetScript, rig: Path, argv: Sequence[str]) -> dict[str, object]:
    """Check the rig-written ``render.json`` in ``tmp_dir``; return it parsed."""
    path = tmp_dir / "render.json"
    if not path.is_file():
        raise BlenderError(f"forge blender: {asset.asset_id}: the script wrote no render.json")
    try:
        data: object = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise BlenderError(f"forge blender: {asset.asset_id}: render.json is not valid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise BlenderError(f"forge blender: {asset.asset_id}: render.json is not an object")
    problems: list[str] = []
    if set(data) != RENDER_JSON_KEYS:
        problems.append(f"keys {sorted(data)} != {sorted(RENDER_JSON_KEYS)}")
    if data.get("blender_version") != REQUIRED_VERSION:
        problems.append(f"blender_version {data.get('blender_version')!r} != {REQUIRED_VERSION!r}")
    want_sha = script_sha256(asset.script, rig)
    if data.get("script_sha256") != want_sha:
        problems.append(f"script_sha256 {data.get('script_sha256')!r} != {want_sha}")
    if data.get("argv") != list(argv):
        problems.append(f"argv {data.get('argv')!r} != {list(argv)}")
    tilt = data.get("tilt_deg")
    if isinstance(tilt, bool) or not isinstance(tilt, (int, float)) or tilt != TILT_DEG:
        problems.append(f"tilt_deg {tilt!r} != {TILT_DEG}")
    c = asset.cell_px // 2
    want_pivots = {f"h{i:02d}": [c, c] for i in range(asset.headings)}
    if data.get("pivots_px") != want_pivots:
        problems.append(f"pivots_px != {{h00..h{asset.headings - 1:02d}: [{c}, {c}]}}")
    if problems:
        raise BlenderError(f"forge blender: {asset.asset_id}: render.json does not verify: " + "; ".join(problems))
    return data


def committed_render_json(data: Mapping[str, object], asset_id: str) -> str:
    """``render.json`` text for the committed folder: ``--out`` names the destination, not the temp dir."""
    raw = data["argv"]
    if not isinstance(raw, list):
        raise BlenderError(f"forge blender: {asset_id}: render.json argv is not a list")
    argv = [str(a) for a in raw]
    i = argv.index("--out")
    argv[i + 1] = f"{RENDERED.as_posix()}/{asset_id}"
    return _render_json_text({**data, "argv": argv})


# ---------------------------------------------------------------------------------------------
# Running Blender


def run_blender(cmd: Sequence[str], cwd: Path, log_dir: Path, asset_id: str) -> None:
    """Run Blender; raise on a non-zero exit, a timeout or ``Traceback`` in stderr.

    stdout and stderr are kept in ``log_dir/stdout.txt`` and ``log_dir/stderr.txt``.
    """
    log.debug("forge blender: %s", " ".join(cmd))
    try:
        proc = subprocess.run(
            list(cmd),
            cwd=cwd,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=RENDER_TIMEOUT_S,
            env=_child_env(),
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise BlenderError(f"forge blender: {asset_id}: Blender timed out after {RENDER_TIMEOUT_S} s") from exc
    except OSError as exc:
        raise BlenderError(f"forge blender: {asset_id}: could not run Blender: {exc}") from exc
    log_dir.mkdir(parents=True, exist_ok=True)
    (log_dir / "stdout.txt").write_text(proc.stdout, encoding="utf-8")
    (log_dir / "stderr.txt").write_text(proc.stderr, encoding="utf-8")
    reasons = []
    if proc.returncode != 0:
        reasons.append(f"exit status {proc.returncode}")
    if "Traceback" in proc.stderr:
        reasons.append("Traceback in stderr")
    if reasons:
        tail = "\n".join(proc.stderr.strip().splitlines()[-15:])
        raise BlenderError(
            f"forge blender: {asset_id}: render failed ({', '.join(reasons)}); "
            f"full log: {(log_dir / 'stderr.txt').relative_to(cwd)}\n{tail}"
        )


def verify_frames(tmp_dir: Path, asset: AssetScript) -> None:
    """The PNGs in ``tmp_dir`` must be exactly the expected set, each a square RGBA ``--size`` image."""
    want = set(asset.frames)
    got = {p.name for p in tmp_dir.glob("*.png") if p.is_file()}
    missing, extra = sorted(want - got), sorted(got - want)
    if missing or extra:
        parts = []
        if missing:
            parts.append(f"{len(missing)} missing ({', '.join(missing[:5])}{', ...' if len(missing) > 5 else ''})")
        if extra:
            parts.append(f"{len(extra)} unexpected ({', '.join(extra[:5])}{', ...' if len(extra) > 5 else ''})")
        raise BlenderError(
            f"forge blender: {asset.asset_id}: wrote {len(got)} frames, expected {len(want)} "
            f"(STATES {dict(asset.states)} x {asset.headings} headings): " + "; ".join(parts)
        )
    for name in sorted(want):
        with Image.open(tmp_dir / name) as im:
            if im.format != "PNG" or im.mode != "RGBA" or im.size != (asset.size, asset.size):
                raise BlenderError(
                    f"forge blender: {asset.asset_id}: {name} is {im.format} {im.mode} {im.size[0]}x{im.size[1]}, "
                    f"expected PNG RGBA {asset.size}x{asset.size}"
                )


def swap_in(tmp_dir: Path, dest: Path, frames: Sequence[str], render_json: str) -> None:
    """Replace ``dest`` with the verified frames + ``render.json`` using two renames.

    The new folder is staged next to ``dest`` (same filesystem), the old one is renamed aside,
    the staged one is renamed into place, and the old one is deleted. If the second rename
    fails, the old folder is put back.
    """
    parent = dest.parent
    parent.mkdir(parents=True, exist_ok=True)
    staging = parent / f".{dest.name}.staging"
    old = parent / f".{dest.name}.old"
    for stale in (staging, old):
        if stale.exists():
            shutil.rmtree(stale)
    staging.mkdir()
    for name in frames:
        shutil.copyfile(tmp_dir / name, staging / name)
    (staging / "render.json").write_text(render_json, encoding="utf-8")
    had_old = dest.exists()
    if had_old:
        os.replace(dest, old)
    try:
        os.replace(staging, dest)
    except OSError:
        if had_old:
            os.replace(old, dest)
        raise
    if had_old:
        shutil.rmtree(old)


# ---------------------------------------------------------------------------------------------
# --check


@dataclass(frozen=True)
class FrameDiff:
    """Changed pixels in one frame. ``status`` is ``same``, ``changed``, ``new``, ``removed`` or ``size``."""

    name: str
    changed_px: int
    status: str
    diff_png: Path | None = None


@dataclass
class CheckReport:
    frames: list[FrameDiff] = field(default_factory=list)

    @property
    def changed_px(self) -> int:
        return sum(f.changed_px for f in self.frames)

    @property
    def changed_frames(self) -> list[FrameDiff]:
        return [f for f in self.frames if f.status != "same"]

    @property
    def clean(self) -> bool:
        return not self.changed_frames


def _read_rgba(path: Path) -> U8Array:
    with Image.open(path) as im:
        return np.asarray(im.convert("RGBA"), dtype=np.uint8)


def _write_png(path: Path, rgba: U8Array) -> None:
    """Pillow PNG with no metadata and fixed encoder parameters (CLAUDE.md §5.2)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(rgba, mode="RGBA").save(path, format="PNG", optimize=False, compress_level=9)


def _diff_image(new: U8Array, old: U8Array, changed: npt.NDArray[np.bool_], colours: Mapping[str, U8Array]) -> U8Array:
    """Changed pixels in ``postbox_red``; unchanged silhouette in ``slab_dk``; empty in ``ink``."""
    out = np.empty(new.shape, dtype=np.uint8)
    out[..., 3] = 255
    out[..., :3] = colours["ink"]
    silhouette = (new[..., 3] > 0) | (old[..., 3] > 0)
    out[silhouette, :3] = colours["slab_dk"]
    out[changed, :3] = colours["postbox_red"]
    return out


def compare_frames(new_dir: Path, committed_dir: Path, frames: Sequence[str], diff_dir: Path, palette_path: Path) -> CheckReport:
    """Per-frame changed-pixel counts (any RGBA channel differs) of ``new_dir`` vs ``committed_dir``.

    Compares the expected ``frames`` plus any PNG only present in ``committed_dir``. Writes a
    diff PNG per changed frame of equal size to ``diff_dir`` (which is emptied first).
    """
    if diff_dir.exists():
        shutil.rmtree(diff_dir)
    pal = load_palette(palette_path)
    colours = {n: pal.rgb[pal.index(n)] for n in ("ink", "slab_dk", "postbox_red")}
    committed = {p.name for p in committed_dir.glob("*.png")} if committed_dir.is_dir() else set()
    report = CheckReport()
    for name in sorted(set(frames) | committed):
        new_path, old_path = new_dir / name, committed_dir / name
        if name not in committed:
            new = _read_rgba(new_path)
            report.frames.append(FrameDiff(name, int(new.shape[0] * new.shape[1]), "new"))
            continue
        if name not in frames:
            old = _read_rgba(old_path)
            report.frames.append(FrameDiff(name, int(old.shape[0] * old.shape[1]), "removed"))
            continue
        new, old = _read_rgba(new_path), _read_rgba(old_path)
        if new.shape != old.shape:
            report.frames.append(FrameDiff(name, int(max(new.shape[0] * new.shape[1], old.shape[0] * old.shape[1])), "size"))
            continue
        changed = np.any(new != old, axis=-1)
        n = int(np.count_nonzero(changed))
        if n == 0:
            report.frames.append(FrameDiff(name, 0, "same"))
            continue
        diff_png = diff_dir / name
        _write_png(diff_png, _diff_image(new, old, changed, colours))
        report.frames.append(FrameDiff(name, n, "changed", diff_png))
    return report


_STATUS_NOTE = {
    "same": "",
    "changed": "",
    "new": " (new: no committed render)",
    "removed": " (removed: committed but no longer rendered)",
    "size": " (size differs)",
}


def _print_check(asset_id: str, report: CheckReport, repo: Path, rendered: Path, tmp_json: Mapping[str, object]) -> None:
    for f in report.frames:
        print(f"{asset_id} {f.name}: {f.changed_px} changed px{_STATUS_NOTE[f.status]}")
    old_json = rendered / "render.json"
    if old_json.is_file():
        try:
            old_sha = json.loads(old_json.read_text(encoding="utf-8")).get("script_sha256")
        except (json.JSONDecodeError, AttributeError):
            old_sha = None
        if old_sha != tmp_json.get("script_sha256"):
            print(f"{asset_id} render.json: script_sha256 differs from the committed render (script or rig.py changed)")
    n_changed = len(report.changed_frames)
    summary = f"{asset_id}: {report.changed_px} changed px in {n_changed} of {len(report.frames)} frames"
    if any(f.diff_png for f in report.frames):
        diff_pngs = [f.diff_png for f in report.frames if f.diff_png is not None]
        summary += f"; diff PNGs in {diff_pngs[0].parent.relative_to(repo)}/"
    print(summary)


# ---------------------------------------------------------------------------------------------
# Entry points


def render_asset(asset: AssetScript, *, check: bool, binary: Path, repo: Path = REPO_ROOT) -> int:
    """Render one asset (version already gated). Returns 0, or 1 when ``--check`` found changes."""
    tmp_rel = TMP_ROOT / asset.asset_id
    tmp_dir = repo / tmp_rel
    if tmp_dir.exists():
        shutil.rmtree(tmp_dir)
    tmp_dir.mkdir(parents=True)
    argv = blender_argv(tmp_rel.as_posix(), asset.size, asset.headings)
    script_rel = asset.script.relative_to(repo).as_posix()
    rig = repo / BLENDER_SRC / "rig.py"
    t0 = time.monotonic()
    run_blender(blender_command(binary, script_rel, argv), repo, tmp_dir, asset.asset_id)
    data = verify_render_json(tmp_dir, asset, rig, argv)
    verify_frames(tmp_dir, asset)
    elapsed = time.monotonic() - t0
    dest = repo / RENDERED / asset.asset_id
    if check:
        report = compare_frames(tmp_dir, dest, asset.frames, tmp_dir / "diff", repo / "assets-src/palette/kerbside32.json")
        _print_check(asset.asset_id, report, repo, dest, data)
        return 0 if report.clean else 1
    swap_in(tmp_dir, dest, asset.frames, committed_render_json(data, asset.asset_id))
    print(
        f"{asset.asset_id}: rendered {len(asset.frames)} frames ({asset.size}x{asset.size}) -> "
        f"{(RENDERED / asset.asset_id).as_posix()}/ in {elapsed:.1f} s"
    )
    return 0


def run(target: str, *, check: bool = False, repo: Path = REPO_ROOT, env: Mapping[str, str] | None = None) -> int:
    """``forge blender <id|all> [--check]``. Returns the process exit status."""
    try:
        binary = blender_path(env)
        version = check_version(binary)
        log.debug("forge blender: %s reports Blender %s", binary, version)
        ids = all_asset_ids(repo) if target == "all" else [target]
        if not ids:
            print("forge blender: 0 asset scripts; nothing to render")
            return 0
        assets = [load_asset(i, repo) for i in ids]
    except BlenderError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    status = 0
    for asset in assets:
        try:
            status |= render_asset(asset, check=check, binary=binary, repo=repo)
        except BlenderError as exc:
            print(str(exc), file=sys.stderr)
            status = 1
    return status


def print_version(env: Mapping[str, str] | None = None) -> int:
    """``forge blender --version``: print the Blender version; non-zero unless it is 5.2.2 LTS."""
    binary = blender_path(env)
    try:
        version = blender_version(binary)
    except BlenderError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(f"Blender {version}")
    if version != REQUIRED_VERSION:
        print(f"forge blender: version mismatch: required 'Blender {REQUIRED_VERSION}'", file=sys.stderr)
        return 1
    return 0


def cli(args: argparse.Namespace) -> int:
    """Handler for ``python -m forge blender``."""
    if args.blender_version:
        return print_version()
    return run(args.id, check=args.check)
