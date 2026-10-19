"""Glyph files (``*.glyphs.txt``) and the font builder (ASSET_PIPELINE §6.3, ART_BIBLE §12.5).

A glyph file is a header, ``glyph "X"`` blocks and ``kern "XY" N`` lines::

    font: Kerbside 5x7
    glyph: 5x7
    cell: 6x8
    baseline: 7
    advance: 6

    glyph "A"
    ..#..
    ...          (exactly glyph-height rows of glyph-width characters: "#" ink, "." empty)

    kern "AV" -1

Blank lines are ignored and ``//`` starts a comment line (``#`` is ink, so it cannot start a
comment). The quoted character is everything between the first and the last quote, so
``glyph`` followed by three double quotes is the double quote and ``glyph "\\"`` the
backslash; no escapes exist. The rows of a block follow its ``glyph`` line directly (no blank
or comment line inside a block).

The font builder turns a parsed file into frames of the manifest entry (technique ``grid``, a
``.glyphs.txt`` source, ``outline: false``):

- **Frame numbering.** Every glyph with ink gets frame ``n``: its position among the inked
  glyphs sorted by code point. The space has no ink and so no frame (an empty frame is a build
  and lint error); its metrics entry has ``"frame": null``.
- **Frame size.** Both states use the outlined box, the glyph grown by
  :data:`OUTLINE_PX` on every side (7x9 for a 5x7 glyph), so the manifest cell is
  ``[glyph w + 2, glyph h + 2]`` and the glyph's top-left sits at :data:`ORIGIN` in either
  frame. That point is also the frame pivot, so a renderer places the pivot on the pen.
- **State** ``glyph``: the glyph's ink in :data:`INK_COLOUR` (07 chalk) on transparent.
- **State** ``outline``: the same, plus a 1 px :data:`OUTLINE_COLOUR` (00 ink) ring that is
  **8-connected**: every empty pixel whose 3x3 neighbourhood holds glyph ink (ART_BIBLE §12.5:
  thin strokes need diagonal coverage). It grows each glyph by exactly 1 px per side.
- **Metrics** (:func:`metrics_json`) go to ``public/assets/fonts/<name>.json`` (``<name>`` is
  the asset id minus its class): per variant, each glyph's advance and frame id, the kerning
  pairs and the line heights. The outlined variant's advance and line heights are the plain
  ones +1, so neighbouring outlines merge.

Everything is a pure function of the file text: no clock, no unordered iteration.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt

from forge.palette import TRANSPARENT

__all__ = [
    "CHARSET",
    "FONTS_DIR",
    "GLYPHS_SUFFIX",
    "GLYPH_STATE",
    "INK_COLOUR",
    "ORIGIN",
    "OUTLINE_COLOUR",
    "OUTLINE_PX",
    "OUTLINE_STATE",
    "Glyph",
    "GlyphError",
    "GlyphFont",
    "check_charset",
    "font_frames",
    "frame_chars",
    "frame_size",
    "metrics_json",
    "metrics_path",
    "outline_ring",
    "parse_glyphs",
    "read_glyphs",
    "render_glyph",
    "specimen_lines",
    "typeset",
]

GLYPHS_SUFFIX = ".glyphs.txt"
"""A manifest ``grid`` entry whose source ends with this is built by the font builder."""

FONTS_DIR = "public/assets/fonts"
"""Where the metrics JSON of every font goes (owned by the forge, like ``public/assets/atlas``)."""

CHARSET: tuple[str, ...] = (*(chr(c) for c in range(32, 127)), "£", "★", "→", "←", "↑", "↓")
"""Every Kerbside font covers exactly ASCII 32-126 plus £ ★ → ← ↑ ↓: 101 glyphs (ART_BIBLE §12.5)."""

GLYPH_STATE = "glyph"
"""Frame state of the plain variant."""

OUTLINE_STATE = "outline"
"""Frame state of the outlined variant (ASSET_PIPELINE §6.3)."""

INK_COLOUR = 7
"""Glyph pixels: palette 07 ``chalk``. Renderers recolour text by palette index (SSP-069)."""

OUTLINE_COLOUR = 0
"""Outline pixels: palette 00 ``ink`` (``#0f0e12``)."""

OUTLINE_PX = 1
"""The outlined variant grows each glyph by this many pixels on every side."""

ORIGIN = (OUTLINE_PX, OUTLINE_PX)
"""Top-left of the glyph inside either frame, and the frame pivot: draw a frame at pen - ORIGIN."""

FALLBACK = "?"
"""The glyph a renderer draws for a character the font does not have (SSP-069)."""

PARAGRAPH_EXTRA = 1
"""Paragraph line height = cell height + 1 (HUD line height = cell height; ART_BIBLE §12.5: 8 / 9)."""

HEADER_KEYS = ("font", "glyph", "cell", "baseline", "advance")

BoolArray = npt.NDArray[np.bool_]
I16Array = npt.NDArray[np.int16]

_HEADER_RE = re.compile(r"^([a-z]+):\s*(.*)$")
_GLYPH_RE = re.compile(r'^glyph "(.)"$')
_KERN_RE = re.compile(r'^kern "(..)" ([+-]?[0-9]+)$')
_SIZE_RE = re.compile(r"^([1-9][0-9]*)x([1-9][0-9]*)$")
_INT_RE = re.compile(r"^(0|[1-9][0-9]*)$")


class GlyphError(ValueError):
    """A glyph file is malformed. The message starts with ``<file>:<line>:``."""


@dataclass(frozen=True)
class Glyph:
    """One glyph: its character, the line of its ``glyph`` header and its rows of ``#``/``.``."""

    char: str
    line: int
    rows: tuple[str, ...]

    @property
    def mask(self) -> BoolArray:
        """``(H, W)`` ink mask."""
        return np.array([[c == "#" for c in row] for row in self.rows], dtype=np.bool_)

    @property
    def inked(self) -> bool:
        return any("#" in row for row in self.rows)


@dataclass(frozen=True)
class GlyphFont:
    """A parsed glyph file. ``glyphs`` and ``kerning`` keep file order."""

    source: str
    name: str
    glyph_size: tuple[int, int]
    cell: tuple[int, int]
    baseline: int
    advance: int
    glyphs: dict[str, Glyph]
    kerning: dict[str, int]

    @property
    def glyph_w(self) -> int:
        return self.glyph_size[0]

    @property
    def glyph_h(self) -> int:
        return self.glyph_size[1]


# ---------------------------------------------------------------------------------------------
# Parsing


def _size(value: str, where: str, key: str) -> tuple[int, int]:
    m = _SIZE_RE.match(value)
    if not m:
        raise GlyphError(f"{where}: {key}: expected <w>x<h>, got {value!r}")
    return int(m.group(1)), int(m.group(2))


def _int(value: str, where: str, key: str) -> int:
    if not _INT_RE.match(value):
        raise GlyphError(f"{where}: {key}: expected a non-negative integer, got {value!r}")
    return int(value)


def parse_glyphs(text: str, source: str = "<glyphs>") -> GlyphFont:
    """Parse the text of a glyph file. Errors name ``source`` and the 1-based line."""
    lines = text.split("\n")
    header: dict[str, str] = {}
    header_line: dict[str, int] = {}
    glyphs: dict[str, Glyph] = {}
    kerning: dict[str, int] = {}
    kern_line: dict[str, int] = {}
    size: tuple[int, int] | None = None
    i = 0
    while i < len(lines):
        lineno = i + 1
        where = f"{source}:{lineno}"
        line = lines[i].rstrip()
        i += 1
        if not line or line.startswith("//"):
            continue
        if m := _GLYPH_RE.match(line):
            if size is None:
                missing = [k for k in HEADER_KEYS if k not in header]
                raise GlyphError(f"{where}: glyph before the header is complete (missing {', '.join(missing)})")
            char = m.group(1)
            if char in glyphs:
                raise GlyphError(f"{where}: duplicate glyph {char!r} (first on line {glyphs[char].line})")
            w, h = size
            rows: list[str] = []
            for k in range(h):
                row_no = lineno + 1 + k
                if i >= len(lines):
                    raise GlyphError(f"{source}:{row_no}: glyph {char!r} ends after {k} of {h} rows")
                row = lines[i].rstrip()
                if not row or any(c not in "#." for c in row):
                    raise GlyphError(
                        f"{source}:{row_no}: glyph {char!r} row {k + 1} must be {w} characters of '#' or '.', "
                        f"got {row!r}"
                    )
                if len(row) != w:
                    raise GlyphError(f"{source}:{row_no}: glyph {char!r} row {k + 1} is {len(row)} wide, glyph is {w}")
                rows.append(row)
                i += 1
            glyphs[char] = Glyph(char=char, line=lineno, rows=tuple(rows))
            continue
        if m := _KERN_RE.match(line):
            pair, value = m.group(1), int(m.group(2))
            if pair in kerning:
                raise GlyphError(f"{where}: duplicate kerning pair {pair!r} (first on line {kern_line[pair]})")
            kerning[pair] = value
            kern_line[pair] = lineno
            continue
        if m := _HEADER_RE.match(line):
            key, value = m.group(1), m.group(2).strip()
            if key not in HEADER_KEYS:
                raise GlyphError(f"{where}: unknown header {key!r} (expected {', '.join(HEADER_KEYS)})")
            if glyphs or kerning:
                raise GlyphError(f"{where}: header {key!r} after the first glyph or kern line")
            if key in header:
                raise GlyphError(f"{where}: duplicate header {key!r} (first on line {header_line[key]})")
            header[key] = value
            header_line[key] = lineno
            if all(k in header for k in HEADER_KEYS):
                size = _validate_header(header, header_line, source)
            continue
        if line.startswith(("glyph", "kern")):
            raise GlyphError(f'{where}: expected glyph "<c>" or kern "<c><c>" <int>, got {line!r}')
        raise GlyphError(f"{where}: unrecognised line {line!r}")

    if size is None:
        missing = [k for k in HEADER_KEYS if k not in header]
        raise GlyphError(f"{source}: header incomplete (missing {', '.join(missing)})")
    for pair, line_no in kern_line.items():
        undefined = [c for c in pair if c not in glyphs]
        if undefined:
            raise GlyphError(f"{source}:{line_no}: kerning pair {pair!r} names undefined glyph {undefined[0]!r}")
    return GlyphFont(
        source=source,
        name=header["font"],
        glyph_size=size,
        cell=_size(header["cell"], f"{source}:{header_line['cell']}", "cell"),
        baseline=int(header["baseline"]),
        advance=int(header["advance"]),
        glyphs=glyphs,
        kerning=kerning,
    )


def _validate_header(header: Mapping[str, str], header_line: Mapping[str, int], source: str) -> tuple[int, int]:
    def at(key: str) -> str:
        return f"{source}:{header_line[key]}"

    if not header["font"]:
        raise GlyphError(f"{at('font')}: font: the name is empty")
    gw, gh = _size(header["glyph"], at("glyph"), "glyph")
    cw, ch = _size(header["cell"], at("cell"), "cell")
    if cw < gw or ch < gh:
        raise GlyphError(f"{at('cell')}: cell {cw}x{ch} is smaller than the glyph {gw}x{gh}")
    baseline = _int(header["baseline"], at("baseline"), "baseline")
    if not 1 <= baseline <= gh:
        raise GlyphError(f"{at('baseline')}: baseline must be 1..{gh} (rows from the glyph top), got {baseline}")
    advance = _int(header["advance"], at("advance"), "advance")
    if advance < 1:
        raise GlyphError(f"{at('advance')}: advance must be at least 1")
    return gw, gh


def read_glyphs(path: Path | str, display: str | None = None) -> GlyphFont:
    """Read and parse a glyph file (UTF-8). ``display`` replaces the path in error messages."""
    p = Path(path)
    try:
        text = p.read_bytes().decode("utf-8")
    except UnicodeDecodeError as exc:
        raise GlyphError(f"{display or p}: not UTF-8 ({exc})") from None
    return parse_glyphs(text, display or str(p))


def check_charset(font: GlyphFont, charset: tuple[str, ...] = CHARSET) -> None:
    """Raise :class:`GlyphError` unless the font has exactly the glyphs of ``charset``."""
    missing = [c for c in charset if c not in font.glyphs]
    extra = sorted((c for c in font.glyphs if c not in charset), key=ord)
    if missing or extra:
        parts = []
        if missing:
            parts.append(f"missing {len(missing)}: {' '.join(repr(c) for c in missing)}")
        if extra:
            parts.append(f"not in the character set {len(extra)}: {' '.join(repr(c) for c in extra)}")
        raise GlyphError(
            f"{font.source}: the font must have exactly the {len(charset)} glyphs ASCII 32-126 plus £ ★ → ← ↑ ↓ "
            f"({'; '.join(parts)})"
        )


# ---------------------------------------------------------------------------------------------
# Rendering


def outline_ring(mask: BoolArray) -> BoolArray:
    """The 8-connected 1 px ring around ``mask``, on a canvas grown by 1 px per side.

    Returns an ``(H + 2, W + 2)`` mask: every pixel that is not ink and has ink among its 8
    neighbours (the 3x3 dilation minus the ink itself).
    """
    if mask.ndim != 2:
        raise ValueError(f"expected an (H, W) mask, got shape {mask.shape}")
    h, w = mask.shape
    pad = OUTLINE_PX
    ink = np.zeros((h + 2 * pad, w + 2 * pad), dtype=np.bool_)
    ink[pad : pad + h, pad : pad + w] = mask
    grown = np.zeros_like(ink)
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            src = ink[max(0, -dy) : ink.shape[0] - max(0, dy), max(0, -dx) : ink.shape[1] - max(0, dx)]
            grown[max(0, dy) : ink.shape[0] - max(0, -dy), max(0, dx) : ink.shape[1] - max(0, -dx)] |= src
    return grown & ~ink


def frame_size(font: GlyphFont) -> tuple[int, int]:
    """``(w, h)`` of every frame of the font: the glyph grown by :data:`OUTLINE_PX` per side."""
    return font.glyph_w + 2 * OUTLINE_PX, font.glyph_h + 2 * OUTLINE_PX


def render_glyph(glyph: Glyph, outlined: bool) -> I16Array:
    """The frame of one glyph: ink in 07 at :data:`ORIGIN`, plus the 00 ring when ``outlined``."""
    mask = glyph.mask
    h, w = mask.shape
    out = np.full((h + 2 * OUTLINE_PX, w + 2 * OUTLINE_PX), TRANSPARENT, dtype=np.int16)
    if outlined:
        out[outline_ring(mask)] = OUTLINE_COLOUR
    ox, oy = ORIGIN
    out[oy : oy + h, ox : ox + w][mask] = INK_COLOUR
    return out


def frame_chars(font: GlyphFont) -> list[str]:
    """The inked glyphs in code-point order; a glyph's position here is its frame ``n``."""
    return sorted((c for c, g in font.glyphs.items() if g.inked), key=ord)


def font_frames(font: GlyphFont) -> dict[str, I16Array]:
    """Every frame as ``{"<state>:-:<n>": indices}``, states ``glyph`` and ``outline``."""
    frames: dict[str, I16Array] = {}
    for n, c in enumerate(frame_chars(font)):
        g = font.glyphs[c]
        frames[f"{GLYPH_STATE}:-:{n}"] = render_glyph(g, outlined=False)
        frames[f"{OUTLINE_STATE}:-:{n}"] = render_glyph(g, outlined=True)
    return frames


# ---------------------------------------------------------------------------------------------
# Metrics


def metrics_path(asset_id: str) -> str:
    """``public/assets/fonts/<name>.json`` for ``font.<name>``."""
    return f"{FONTS_DIR}/{asset_id.split('.', 1)[1]}.json"


def _variant(font: GlyphFont, asset_id: str, state: str, extra: int) -> dict[str, object]:
    n_of = {c: n for n, c in enumerate(frame_chars(font))}
    glyphs: dict[str, object] = {}
    for c in sorted(font.glyphs, key=ord):
        frame = f"{asset_id}:{state}:-:{n_of[c]}" if c in n_of else None
        glyphs[c] = {"advance": font.advance + extra, "frame": frame}
    return {
        "state": state,
        "advance": font.advance + extra,
        "lineHeight": {"hud": font.cell[1] + extra, "paragraph": font.cell[1] + PARAGRAPH_EXTRA + extra},
        "glyphs": glyphs,
        "kerning": {pair: font.kerning[pair] for pair in sorted(font.kerning, key=lambda p: (ord(p[0]), ord(p[1])))},
    }


def metrics_json(font: GlyphFont, asset_id: str, atlas: str, source: str) -> bytes:
    """The metrics JSON of a font (ASSET_PIPELINE §6.3): sorted, ``\\n`` endings, UTF-8."""
    fw, fh = frame_size(font)
    doc = {
        "id": asset_id,
        "font": font.name,
        "source": source,
        "atlas": atlas,
        "glyph": {"w": font.glyph_w, "h": font.glyph_h},
        "cell": {"w": font.cell[0], "h": font.cell[1]},
        "frame": {"w": fw, "h": fh},
        "origin": {"x": ORIGIN[0], "y": ORIGIN[1]},
        "baseline": font.baseline,
        "fallback": FALLBACK,
        "colours": {"ink": INK_COLOUR, "outline": OUTLINE_COLOUR},
        "variants": {
            "plain": _variant(font, asset_id, GLYPH_STATE, 0),
            "outline": _variant(font, asset_id, OUTLINE_STATE, OUTLINE_PX),
        },
    }
    return (json.dumps(doc, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


# ---------------------------------------------------------------------------------------------
# Typesetting (review specimens; the game's layout is src/ui/bitmapText.ts)


SPECIMEN_SAMPLE = "SPOTLESS! COMPLAINT x3 3:42 £1,250 0O 1lI"
"""A sample line for review specimens: HUD words, digits, £ and the easily confused glyphs."""


def specimen_lines(font: GlyphFont, per_line: int = 32) -> list[str]:
    """Review text: every glyph in code-point order (``per_line`` a line), the kerning pairs and a sample."""
    chars = sorted(font.glyphs, key=ord)
    lines = ["".join(chars[i : i + per_line]) for i in range(0, len(chars), per_line)]
    pairs = sorted(font.kerning, key=lambda p: (ord(p[0]), ord(p[1])))
    if pairs:
        lines.append(" ".join(pairs))
    lines.append(SPECIMEN_SAMPLE)
    return lines


def typeset(font: GlyphFont, lines: list[str], *, outlined: bool, line_height: int | None = None) -> I16Array:
    """Lay ``lines`` out with the font's advances and kerning and paint them as one index array.

    Outlines are painted before any ink, so a diagonal neighbour's outline never covers ink.
    Unknown characters use :data:`FALLBACK`. Used by ``forge sheets`` for the 1x specimen.
    """
    extra = OUTLINE_PX if outlined else 0
    advance = font.advance + extra
    lh = line_height if line_height is not None else font.cell[1] + extra
    fw, fh = frame_size(font)
    placed: list[tuple[int, int, Glyph]] = []
    width = fw
    for row, text in enumerate(lines):
        x = 0
        prev = ""
        for c in text:
            g = font.glyphs.get(c) or font.glyphs[FALLBACK]
            if prev:
                x += font.kerning.get(prev + g.char, 0)
            placed.append((x, row * lh, g))
            width = max(width, x + fw)
            x += advance
            prev = g.char
    canvas = np.full((max(0, len(lines) - 1) * lh + fh, width), TRANSPARENT, dtype=np.int16)
    frames = [(x, y, render_glyph(g, outlined)) for x, y, g in placed]
    for colour in (OUTLINE_COLOUR, INK_COLOUR) if outlined else (INK_COLOUR,):
        for x, y, f in frames:
            region = canvas[y : y + fh, x : x + fw]
            region[f == colour] = colour
    return canvas
