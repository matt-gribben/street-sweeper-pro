"""Text-grid sprites (``*.sprite.txt``): the shared parser and writer (ASSET_PIPELINE §6.2).

``forge build`` (grid / ai-ingest techniques) reads grids with :func:`parse_sprite`;
``forge ingest`` writes them with :func:`format_sprite`. Both go through this module so the
grammar exists once.

Grammar (one item per line; trailing whitespace and CR are ignored):

- ``# ...``: a comment line, anywhere (rows can never start with ``#``).
- Blank lines are ignored.
- Header, before the first ``frame``/``mirror`` line, as ``name: value``:

  - ``id: <class>.<snake_name>`` (required)
  - ``cell: WxH`` (required)
  - ``palette: kerbside32`` (required; the only palette)
  - ``origin: <text>`` and ``ingest_sha256: <64 hex>`` (optional, written by ``forge ingest``,
    read and preserved verbatim)
  - ``key: <c>=<v> [<c>=<v> ...]`` (optional, repeatable): a custom key map. ``<c>`` is one
    printable ASCII character other than space, ``#`` or ``:``; ``<v>`` is a palette index
    ``0``-``31`` (decimal, zero padding allowed) or ``-`` for transparent. **A custom key
    replaces the default key entirely.** Without ``key:`` lines the default key applies:
    ``.`` = transparent, ``0``-``9`` = 00-09, ``a``-``v`` = 10-31.

- ``frame <state>:<dir>:<n>`` followed by exactly H rows of W key characters (comment and
  blank lines between rows are skipped). ``<dir>`` is ``h00``-``h31``, a compass dir
  (``s sw w nw n ne e se``) or ``-``.
- ``mirror <dst> from <src>``: every authored frame in dir ``<src>`` also exists in dir
  ``<dst>``, flipped left-right. ``<dst>`` must have no authored frames and appear in only one
  mirror line; ``<src>`` must have authored frames (mirrors never chain).

Frames are ``(H, W)`` ``int16`` arrays of palette indices with ``-1``
(:data:`forge.palette.TRANSPARENT`) for transparent pixels. Comments are not preserved by the
writer; everything else round-trips exactly.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import numpy.typing as npt

from forge.palette import PALETTE_SIZE, TRANSPARENT

__all__ = [
    "DEFAULT_KEY",
    "PALETTE_NAME",
    "SpriteError",
    "SpriteGrid",
    "format_frames",
    "format_sprite",
    "parse_sprite",
    "read_sprite",
    "render_frames",
    "write_sprite",
]

PALETTE_NAME = "kerbside32"

I16Array = npt.NDArray[np.int16]


def _default_key() -> dict[str, int]:
    key = {".": TRANSPARENT}
    for i in range(10):
        key[str(i)] = i
    for i in range(10, PALETTE_SIZE):
        key[chr(ord("a") + i - 10)] = i
    return key


DEFAULT_KEY: Mapping[str, int] = _default_key()
"""``.`` = transparent, ``0``-``9`` = indices 00-09, ``a``-``v`` = indices 10-31."""

_ID_RE = re.compile(r"^[a-z]+\.[a-z0-9]+(?:_[a-z0-9]+)*$")
_STATE = r"[a-z][a-z0-9]*(?:_[a-z0-9]+)*"
_DIR = r"h(?:0[0-9]|[12][0-9]|3[01])|s|sw|w|nw|n|ne|e|se|-"
_FRAME_RE = re.compile(rf"^frame ({_STATE}):({_DIR}):(0|[1-9][0-9]*)$")
_MIRROR_RE = re.compile(rf"^mirror ({_DIR}) from ({_DIR})$")
_HEADER_RE = re.compile(r"^([a-z_0-9]+):(?: (.*))?$")
_CELL_RE = re.compile(r"^([1-9][0-9]*)x([1-9][0-9]*)$")
_SHA_RE = re.compile(r"^[0-9a-f]{64}$")
_KEY_PAIR_RE = re.compile(r"^([!-~])=(-|[0-9]{1,2})$")
_FORBIDDEN_KEY_CHARS = frozenset("#: ")

_KNOWN_HEADERS = ("id", "cell", "palette", "origin", "ingest_sha256", "key")


class SpriteError(ValueError):
    """A ``.sprite.txt`` file is malformed (the message carries ``<source>:<line>``)."""


@dataclass
class SpriteGrid:
    """A parsed text grid.

    ``frames`` maps local frame IDs (``state:dir:n``) to authored frames, in file order.
    ``mirrors`` holds ``(dst, src)`` dir pairs, in file order. ``key`` is ``None`` for the
    default key, else the custom key map (character -> index, ``-1`` = transparent).
    """

    id: str
    cell: tuple[int, int]
    frames: dict[str, I16Array] = field(default_factory=dict)
    mirrors: list[tuple[str, str]] = field(default_factory=list)
    key: dict[str, int] | None = None
    origin: str | None = None
    ingest_sha256: str | None = None
    palette: str = PALETTE_NAME

    @property
    def width(self) -> int:
        return self.cell[0]

    @property
    def height(self) -> int:
        return self.cell[1]

    def effective_key(self) -> Mapping[str, int]:
        return DEFAULT_KEY if self.key is None else self.key


def _split_frame_id(fid: str) -> tuple[str, str, str]:
    state, d, n = fid.split(":")
    return state, d, n


def _check_mirrors(grid: SpriteGrid) -> str | None:
    """Return a problem with ``grid.mirrors``, or ``None``."""
    authored_dirs = {_split_frame_id(fid)[1] for fid in grid.frames}
    dsts: set[str] = set()
    for dst, src in grid.mirrors:
        if "-" in (dst, src):
            return f"mirror {dst} from {src}: undirected frames cannot be mirrored"
        if dst == src:
            return f"mirror {dst} from {src}: a dir cannot mirror itself"
        if dst in dsts:
            return f"mirror {dst} from {src}: {dst} is already a mirror target"
        if dst in authored_dirs:
            return f"mirror {dst} from {src}: {dst} already has authored frames"
        if src not in authored_dirs:
            return f"mirror {dst} from {src}: {src} has no authored frames (mirrors never chain)"
        dsts.add(dst)
    return None


def _parse_key(value: str, where: str, key: dict[str, int]) -> None:
    pairs = value.split()
    if not pairs:
        raise SpriteError(f"{where}: key: expected '<char>=<index|->' pairs")
    for pair in pairs:
        m = _KEY_PAIR_RE.match(pair)
        if not m or m.group(1) in _FORBIDDEN_KEY_CHARS:
            raise SpriteError(f"{where}: key: bad pair {pair!r} (expected <char>=<0-31|->, char not '#' or ':')")
        ch, v = m.group(1), m.group(2)
        idx = TRANSPARENT if v == "-" else int(v)
        if not TRANSPARENT <= idx < PALETTE_SIZE:
            raise SpriteError(f"{where}: key: index {v} out of range 0-{PALETTE_SIZE - 1}")
        if ch in key:
            raise SpriteError(f"{where}: key: character {ch!r} defined twice")
        key[ch] = idx


def parse_sprite(text: str, source: str = "<sprite>") -> SpriteGrid:
    """Parse ``.sprite.txt`` text. Raises :class:`SpriteError` on any grammar violation."""
    headers: dict[str, str] = {}
    custom_key: dict[str, int] = {}
    frames: dict[str, I16Array] = {}
    mirrors: list[tuple[str, str]] = []
    in_body = False
    grid: SpriteGrid | None = None
    pending: tuple[str, int, list[list[int]]] | None = None  # (frame id, line, rows so far)

    def start_body(lineno: int) -> SpriteGrid:
        where = f"{source}:{lineno}"
        for name in ("id", "cell", "palette"):
            if name not in headers:
                raise SpriteError(f"{where}: missing '{name}:' header before the first frame")
        if not _ID_RE.match(headers["id"]):
            raise SpriteError(f"{source}: id must be <class>.<snake_name>, got {headers['id']!r}")
        cm = _CELL_RE.match(headers["cell"])
        if not cm:
            raise SpriteError(f"{source}: cell must be WxH, got {headers['cell']!r}")
        if headers["palette"] != PALETTE_NAME:
            raise SpriteError(f"{source}: palette must be {PALETTE_NAME!r}, got {headers['palette']!r}")
        sha = headers.get("ingest_sha256")
        if sha is not None and not _SHA_RE.match(sha):
            raise SpriteError(f"{source}: ingest_sha256 must be 64 lower-case hex digits")
        return SpriteGrid(
            id=headers["id"],
            cell=(int(cm.group(1)), int(cm.group(2))),
            key=dict(custom_key) if custom_key else None,
            origin=headers.get("origin"),
            ingest_sha256=sha,
        )

    lines = text.split("\n")
    for lineno, raw in enumerate(lines, start=1):
        line = raw.rstrip(" \t\r")
        where = f"{source}:{lineno}"
        if not line or line.lstrip().startswith("#"):
            continue
        if pending is not None:
            assert grid is not None
            fid, _, rows = pending
            key = grid.effective_key()
            if len(line) != grid.width:
                raise SpriteError(
                    f"{where}: frame {fid}: row {len(rows) + 1} has {len(line)} chars, expected {grid.width}"
                )
            try:
                rows.append([key[ch] for ch in line])
            except KeyError as exc:
                raise SpriteError(f"{where}: frame {fid}: character {exc.args[0]!r} is not in the key") from None
            if len(rows) == grid.height:
                frames[fid] = np.array(rows, dtype=np.int16)
                pending = None
            continue
        if fm := _FRAME_RE.match(line):
            if not in_body:
                grid = start_body(lineno)
                in_body = True
            fid = f"{fm.group(1)}:{fm.group(2)}:{int(fm.group(3))}"
            if fid in frames:
                raise SpriteError(f"{where}: duplicate frame {fid}")
            pending = (fid, lineno, [])
            continue
        if mm := _MIRROR_RE.match(line):
            if not in_body:
                grid = start_body(lineno)
                in_body = True
            mirrors.append((mm.group(1), mm.group(2)))
            continue
        if in_body:
            raise SpriteError(f"{where}: expected 'frame ...', 'mirror ...' or a comment, got {line!r}")
        hm = _HEADER_RE.match(line)
        if not hm:
            raise SpriteError(f"{where}: expected a 'name: value' header, got {line!r}")
        name, value = hm.group(1), (hm.group(2) or "").strip()
        if name not in _KNOWN_HEADERS:
            raise SpriteError(f"{where}: unknown header {name!r} (known: {', '.join(_KNOWN_HEADERS)})")
        if name == "key":
            _parse_key(value, where, custom_key)
            continue
        if name in headers:
            raise SpriteError(f"{where}: duplicate header {name!r}")
        if not value:
            raise SpriteError(f"{where}: header {name!r} has no value")
        headers[name] = value

    if pending is not None:
        fid, start, rows = pending
        assert grid is not None
        raise SpriteError(f"{source}:{start}: frame {fid} has {len(rows)} rows, expected {grid.height}")
    if grid is None:
        grid = start_body(len(lines))
    grid.frames = frames
    grid.mirrors = mirrors
    if problem := _check_mirrors(grid):
        raise SpriteError(f"{source}: {problem}")
    return grid


def read_sprite(path: Path | str) -> SpriteGrid:
    """Read and parse a ``.sprite.txt`` file (UTF-8)."""
    p = Path(path)
    return parse_sprite(p.read_text(encoding="utf-8"), str(p))


def render_frames(grid: SpriteGrid) -> dict[str, I16Array]:
    """Authored frames plus mirrored ones, keyed by local frame ID and sorted by it."""
    if problem := _check_mirrors(grid):
        raise SpriteError(f"{grid.id}: {problem}")
    out: dict[str, I16Array] = {fid: arr.copy() for fid, arr in grid.frames.items()}
    for dst, src in grid.mirrors:
        for fid, arr in grid.frames.items():
            state, d, n = _split_frame_id(fid)
            if d == src:
                out[f"{state}:{dst}:{n}"] = np.ascontiguousarray(arr[:, ::-1])
    return {fid: out[fid] for fid in sorted(out)}


def _inverse_key(grid: SpriteGrid) -> dict[int, str]:
    inv: dict[int, str] = {}
    for ch, idx in grid.effective_key().items():
        inv.setdefault(idx, ch)
    return inv


def _format_key(key: Mapping[str, int]) -> list[str]:
    pairs = [f"{ch}=-" if idx == TRANSPARENT else f"{ch}={idx:02d}" for ch, idx in key.items()]
    return [f"key: {' '.join(pairs[i : i + 8])}" for i in range(0, len(pairs), 8)]


def format_frames(grid: SpriteGrid) -> str:
    """The frame blocks and mirror lines exactly as :func:`format_sprite` writes them.

    This is the text ``forge ingest`` hashes into ``ingest_sha256`` (ASSET_PIPELINE §6.2).
    """
    inv = _inverse_key(grid)
    parts: list[str] = []
    for fid, arr in grid.frames.items():
        if arr.shape != (grid.height, grid.width):
            raise SpriteError(f"{grid.id}: frame {fid} is {arr.shape[1]}x{arr.shape[0]}, cell is {grid.width}x{grid.height}")
        try:
            rows = ["".join(inv[int(v)] for v in row) for row in arr]
        except KeyError as exc:
            raise SpriteError(f"{grid.id}: frame {fid}: index {exc.args[0]} has no key character") from None
        parts.append("\n".join([f"frame {fid}", *rows]) + "\n")
    if grid.mirrors:
        parts.append("".join(f"mirror {dst} from {src}\n" for dst, src in grid.mirrors))
    return "\n".join(parts)


def format_sprite(grid: SpriteGrid) -> str:
    """Canonical ``.sprite.txt`` text for ``grid`` (LF line endings, trailing newline)."""
    if grid.palette != PALETTE_NAME:
        raise SpriteError(f"{grid.id}: palette must be {PALETTE_NAME!r}")
    head = [f"id: {grid.id}", f"cell: {grid.width}x{grid.height}", f"palette: {grid.palette}"]
    if grid.origin is not None:
        head.append(f"origin: {grid.origin}")
    if grid.ingest_sha256 is not None:
        head.append(f"ingest_sha256: {grid.ingest_sha256}")
    if grid.key is not None:
        head.extend(_format_key(grid.key))
    body = format_frames(grid)
    return "\n".join(head) + "\n" + ("\n" + body if body else "")


def write_sprite(path: Path | str, grid: SpriteGrid) -> Path:
    """Write :func:`format_sprite` output to ``path`` (UTF-8, LF), creating parent directories."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(format_sprite(grid).encode("utf-8"))
    return p
