"""A fake Blender binary for the ``forge blender`` tests. Blender never runs in pytest or CI.

``test_blender.py`` copies this file into a temp dir behind a ``#!<python>`` line, makes it
executable and points ``SSP_BLENDER`` at it. Environment knobs:

- ``FAKE_BLENDER_VERSION``: what ``--version`` reports (default ``5.2.2 LTS``).
- ``FAKE_BLENDER_MODE``: ``ok`` (default), ``traceback`` (renders everything, prints a
  Traceback to stderr, exits 0), ``exit1`` (renders everything, exits 1), ``missing_frame``,
  ``extra_frame``, ``bad_sha``, ``bad_argv``, ``no_render_json``, ``wrong_size``.
- ``FAKE_BLENDER_PIXEL``: ``x,y`` of one pixel to change in every frame.
- ``FAKE_BLENDER_LOG``: a file that gets one line appended per invocation (``version`` or
  ``render``), so a test can prove nothing was rendered.

The render mode reimplements the rig contract independently of ``forge.blender``: frame names
from the script's ``STATES``, ``render.json`` with sha256(script + NUL + rig.py).
"""

from __future__ import annotations

import ast
import hashlib
import json
import os
import re
import sys
from pathlib import Path

from PIL import Image


def _log(event: str) -> None:
    path = os.environ.get("FAKE_BLENDER_LOG")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(event + "\n")


def _frame_names(states: dict[str, int], headings: int) -> list[str]:
    names = []
    for state, n in states.items():
        if state == "slice":
            names += [f"slice_{k}.png" for k in range(n)]
            continue
        prefix = "" if state == "body" else f"{state}_"
        for i in range(headings):
            names += [f"{prefix}h{i:02d}.png"] if n == 1 else [f"{prefix}h{i:02d}_{f}.png" for f in range(n)]
    return names


def _states(script_text: str) -> dict[str, int]:
    for node in ast.parse(script_text).body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "STATES" for t in node.targets):
            value = ast.literal_eval(node.value)
            return value if isinstance(value, dict) else dict.fromkeys(value, 1)
    raise SystemExit("fake blender: no STATES")


def _render(argv: list[str]) -> int:
    _log("render")
    mode = os.environ.get("FAKE_BLENDER_MODE", "ok")
    script = Path(argv[argv.index("-P") + 1])
    args = argv[argv.index("--") + 1 :]
    opts = dict(zip(args[::2], args[1::2], strict=True))
    out, size, headings = Path(opts["--out"]), int(opts["--size"]), int(opts["--headings"])
    text = script.read_text(encoding="utf-8")
    cell = int(re.search(r"^CELL_PX\s*=\s*(\d+)", text, re.MULTILINE).group(1))  # type: ignore[union-attr]
    names = _frame_names(_states(text), headings)
    if mode == "missing_frame":
        names = names[:-1]
    if mode == "extra_frame":
        names = [*names, "h99.png"]
    pixel = os.environ.get("FAKE_BLENDER_PIXEL")
    out.mkdir(parents=True, exist_ok=True)
    for k, name in enumerate(names):
        side = size + 1 if mode == "wrong_size" else size
        im = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        # A deterministic opaque block, different per frame, in Kerbside-32 15 sweeper_yellow.
        q = side // 4
        for y in range(q, 3 * q):
            for x in range(q + k % q, 3 * q):
                im.putpixel((x, y), (0xF2, 0xC1, 0x2E, 255))
        if pixel:
            px, py = (int(v) for v in pixel.split(","))
            im.putpixel((px, py), (0x0F, 0x0E, 0x12, 255))
        im.save(out / name, format="PNG")
    rig = script.parent.parent / "rig.py"
    sha = hashlib.sha256(script.read_bytes() + b"\0" + rig.read_bytes()).hexdigest()
    if mode == "bad_sha":
        sha = "0" * 64
    data = {
        "blender_version": "5.2.2 LTS",
        "script_sha256": sha,
        "argv": args if mode != "bad_argv" else [*args[:-1], "8"],
        "tilt_deg": 0,
        "pivots_px": {f"h{i:02d}": [cell // 2, cell // 2] for i in range(headings)},
    }
    if mode != "no_render_json":
        (out / "render.json").write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    print("Fra:1 Mem:12.00M | Rendering | fake")
    if mode == "traceback":
        print("Traceback (most recent call last):\n  File x, line 1\nRuntimeError: boom", file=sys.stderr)
        return 0
    if mode == "exit1":
        print("Error: script failed", file=sys.stderr)
        return 1
    return 0


def main(argv: list[str]) -> int:
    if "--version" in argv:
        _log("version")
        version = os.environ.get("FAKE_BLENDER_VERSION", "5.2.2 LTS")
        print(f"Blender {version} (hash 0000000 built 2026-09-15 01:49:19)\nBlender {version}\n\tbuild date: fake")
        return 0
    if argv[:5] != ["-b", "--factory-startup", "--python-exit-code", "1", "-P"]:
        print(f"fake blender: unexpected command line {argv}", file=sys.stderr)
        return 64
    return _render(argv)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
