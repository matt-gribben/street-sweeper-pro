"""A fake Codex CLI for the ``forge gen-ai`` tests. Codex never runs in pytest or CI.

``test_genai.py`` copies this file into a temp dir behind a ``#!<python>`` line, makes it
executable and points ``SSP_CODEX`` at it. ``CODEX_HOME`` (or ``$HOME/.codex``) points at a temp
dir, so the fake ``generated_images/<thread-id>/exec-*.png`` never touches the real one.

Environment knobs:

- ``FAKE_CODEX_VERSION``: what ``--version`` prints (default ``codex-cli 0.160.1``).
- ``FAKE_CODEX_MODE``:
  - ``ok`` (default): "generate" an image into ``generated_images/<thread>/exec-*.png`` and ``cp``
    it into the working dir, logging the ``cp`` like the real probe run;
  - ``nocopy``: generate but do not copy (the wrapper must recover it from generated_images);
  - ``reencode``: generate, then write a re-encoded copy (different bytes) as the output;
  - ``draw``: generate, but draw the output with PIL and log the ``ImageDraw`` command;
  - ``noimage``: generate nothing, reply DONE and exit 0;
  - ``exit1``: print an auth error to stderr and exit 1 with no image.
- ``FAKE_CODEX_OUTPUT``: the output file name to write in the working dir (default ``street.png``).
- ``FAKE_CODEX_THREAD``: the thread id in ``thread.started`` (default a fixed UUID).
- ``FAKE_CODEX_LOG``: a JSON-lines file that gets ``{"argv": [...], "stdin": "...", "stdin_isatty": bool}``
  appended per invocation, so a test can inspect the argv and the bytes on stdin, or prove that
  nothing ran.
"""

from __future__ import annotations

import io
import json
import os
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageDraw

DEFAULT_THREAD = "0199f3a2-7c1e-7b40-9d6a-2f8e1c5b3a70"


def _log(record: dict[str, object]) -> None:
    path = os.environ.get("FAKE_CODEX_LOG")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")


def _emit(event: dict[str, object]) -> None:
    sys.stdout.write(json.dumps(event) + "\n")


def _flag(argv: list[str], name: str) -> str:
    return argv[argv.index(name) + 1]


def _png(colour: tuple[int, int, int, int], size: tuple[int, int] = (64, 32)) -> bytes:
    """A small 'generated' PNG. Each colour gives different bytes."""
    im = Image.new("RGBA", size, (0, 0, 0, 0))
    im.paste(colour, (8, 8, size[0] - 8, size[1] - 8))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def main() -> int:
    argv = sys.argv[1:]
    if argv == ["--version"]:
        _log({"argv": argv, "stdin": None, "stdin_isatty": None})
        print(os.environ.get("FAKE_CODEX_VERSION", "codex-cli 0.160.1"))
        return 0

    stdin = sys.stdin.buffer.read()
    _log({"argv": argv, "stdin": stdin.decode("utf-8"), "stdin_isatty": sys.stdin.isatty()})
    mode = os.environ.get("FAKE_CODEX_MODE", "ok")
    workdir = Path(_flag(argv, "-C"))
    last_message = Path(_flag(argv, "-o"))
    output = workdir / os.environ.get("FAKE_CODEX_OUTPUT", "street.png")
    thread = os.environ.get("FAKE_CODEX_THREAD", DEFAULT_THREAD)
    home = Path(os.environ["CODEX_HOME"]) if os.environ.get("CODEX_HOME") else Path(os.environ["HOME"]) / ".codex"

    _emit({"type": "thread.started", "thread_id": thread})
    _emit({"type": "turn.started"})
    if mode == "exit1":
        sys.stderr.write("Error: not logged in. Run codex login.\n")
        return 1

    gen_dir = home / "generated_images" / thread
    generated: Path | None = None
    if mode != "noimage":
        gen_dir.mkdir(parents=True, exist_ok=True)
        n = len(list(gen_dir.glob("exec-*.png")))
        generated = gen_dir / f"exec-{n:04d}.png"
        generated.write_bytes(_png((255, 39 + 20 * n, 30, 255)))

    def command(item_id: str, cmd: str) -> None:
        item = {"id": item_id, "type": "command_execution", "command": cmd, "aggregated_output": ""}
        _emit({"type": "item.started", "item": {**item, "exit_code": None, "status": "in_progress"}})
        _emit({"type": "item.completed", "item": {**item, "exit_code": 0, "status": "completed"}})

    if generated is not None and mode == "ok":
        shutil.copyfile(generated, output)
        command("item_1", f"/bin/zsh -lc 'cp {generated} ./{output.name}'")
    elif generated is not None and mode == "reencode":
        with Image.open(generated) as im:
            im.convert("RGB").save(output, format="PNG", optimize=True)
        command("item_1", f"/bin/zsh -lc 'cp {generated} ./{output.name}'")
    elif generated is not None and mode == "draw":
        im = Image.new("RGBA", (64, 32), (0, 0, 0, 0))
        ImageDraw.Draw(im).rectangle((4, 4, 60, 28), fill=(242, 193, 46, 255))
        im.save(output, format="PNG")
        command(
            "item_1",
            "/bin/zsh -lc \"python3 -c 'from PIL import Image, ImageDraw; im = Image.new(\\\"RGBA\\\", (64, 32)); "
            f"ImageDraw.Draw(im).rectangle((4, 4, 60, 28), fill=(242, 193, 46)); im.save(\\\"{output.name}\\\")'\"",
        )

    last_message.write_text("DONE", encoding="utf-8")
    _emit({"type": "item.completed", "item": {"id": "item_2", "type": "agent_message", "text": "DONE"}})
    _emit({"type": "turn.completed", "usage": {"input_tokens": 1, "output_tokens": 1}})
    return 0


if __name__ == "__main__":
    sys.exit(main())
