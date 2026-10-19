"""Glyph files and the font builder (SSP-068; ASSET_PIPELINE §6.3, ART_BIBLE §12.5).

Covers the glyph-file parser (grammar, errors with file and line), the committed Kerbside 5x7
draft (exactly 101 glyphs, every starter kerning pair, kerned pairs never touching), the
8-connected outline (grows each glyph by exactly 1 px per side, diagonal coverage), the frames
and pivots, the metrics JSON and the build integration (cell checks, ui atlas, two builds
byte-identical).
"""

from __future__ import annotations

import dataclasses
import json
import shutil
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from test_build import make_repo

from forge.build import BuildError, build, build_asset, font_outputs
from forge.glyphs import (
    CHARSET,
    INK_COLOUR,
    ORIGIN,
    OUTLINE_COLOUR,
    Glyph,
    GlyphError,
    check_charset,
    font_frames,
    frame_chars,
    metrics_json,
    outline_ring,
    parse_glyphs,
    read_glyphs,
    render_glyph,
    typeset,
)
from forge.lint import lint
from forge.manifest import entry_from_data, load_manifest
from forge.palette import REPO_ROOT, TRANSPARENT

FONT_PATH = REPO_ROOT / "assets-src" / "fonts" / "kerbside5x7.glyphs.txt"
FONT_ID = "font.kerbside5x7"
STARTER_PAIRS = "AV AW AT AY LT LY PA TA VA WA YA Fo To Te Ty r. r, ££".split()

HEADER = "font: Toy 3x3\nglyph: 3x3\ncell: 4x4\nbaseline: 3\nadvance: 4\n"


def toy(body: str, header: str = HEADER) -> str:
    return header + "\n" + body


# ---------------------------------------------------------------------------------------------
# Parser


def test_parses_header_glyphs_comments_quotes_and_kerning() -> None:
    text = toy(
        '// a comment\nglyph "A"\n.#.\n#.#\n###\n\nglyph """\n#.#\n#.#\n...\n'
        'glyph "\\"\n#..\n.#.\n..#\nglyph " "\n...\n...\n...\nkern "A"" -1\nkern "\\A" +2\n'
    )
    font = parse_glyphs(text, "toy.glyphs.txt")
    assert font.name == "Toy 3x3"
    assert (font.glyph_size, font.cell, font.baseline, font.advance) == ((3, 3), (4, 4), 3, 4)
    assert list(font.glyphs) == ["A", '"', "\\", " "]
    assert font.glyphs["A"].rows == (".#.", "#.#", "###")
    assert font.glyphs["A"].line == 8
    assert not font.glyphs[" "].inked
    assert font.kerning == {'A"': -1, "\\A": 2}


@pytest.mark.parametrize(
    ("body", "header", "match"),
    [
        ('glyph "A"\n.#.\n#.#', HEADER, r"toy:10: glyph 'A' ends after 2 of 3 rows"),
        ('glyph "A"\n.#.\n#.\n###\n', HEADER, r"toy:9: glyph 'A' row 2 is 2 wide, glyph is 3"),
        ('glyph "A"\n.#.\n#x#\n###\n', HEADER, r"toy:9: glyph 'A' row 2 must be 3 characters"),
        ('glyph "A"\n.#.\n\n###\n', HEADER, r"toy:9: glyph 'A' row 2 must be"),
        ('glyph "A"\n...\n...\n...\nglyph "A"\n...\n...\n...\n', HEADER, r"toy:11: duplicate glyph 'A' \(first on line 7\)"),
        ('glyph "AB"\n', HEADER, r'toy:7: expected glyph "<c>"'),
        ('glyph "A"\n...\n...\n...\nkern "AA" x\n', HEADER, r'toy:11: expected glyph "<c>" or kern'),
        ('glyph "A"\n...\n...\n...\nkern "AA" -1\nkern "AA" 0\n', HEADER, r"toy:12: duplicate kerning pair 'AA'"),
        ('glyph "A"\n...\n...\n...\nkern "AB" -1\n', HEADER, r"toy:11: kerning pair 'AB' names undefined glyph 'B'"),
        ("hello\n", HEADER, r"toy:7: unrecognised line 'hello'"),
        ("", HEADER + "colour: 7\n", r"toy:6: unknown header 'colour'"),
        ("", HEADER + "advance: 5\n", r"toy:6: duplicate header 'advance'"),
        ('glyph "A"\n', "font: Toy\nglyph: 3x3\n", r"toy:4: glyph before the header is complete \(missing cell, baseline, advance\)"),
        ("", "font: Toy\n", r"toy: header incomplete"),
        ("", HEADER.replace("cell: 4x4", "cell: 2x4"), r"toy:3: cell 2x4 is smaller than the glyph 3x3"),
        ("", HEADER.replace("glyph: 3x3", "glyph: 3by3"), r"toy:2: glyph: expected <w>x<h>"),
        ("", HEADER.replace("baseline: 3", "baseline: 4"), r"toy:4: baseline must be 1..3"),
        ("", HEADER.replace("advance: 4", "advance: 0"), r"toy:5: advance must be at least 1"),
    ],
)
def test_parse_errors_name_the_file_and_line(body: str, header: str, match: str) -> None:
    with pytest.raises(GlyphError, match=match):
        parse_glyphs(toy(body, header), "toy")


def test_header_after_a_glyph_is_an_error() -> None:
    with pytest.raises(GlyphError, match="toy:11: header 'advance' after the first glyph"):
        parse_glyphs(toy('glyph "A"\n...\n...\n...\nadvance: 5\n'), "toy")


def test_check_charset_reports_missing_and_extra_glyphs() -> None:
    font = parse_glyphs(toy('glyph "A"\n...\n...\n...\nglyph "é"\n...\n...\n...\n'), "toy")
    with pytest.raises(GlyphError, match=r"missing 100: .*not in the character set 1: 'é'"):
        check_charset(font)
    check_charset(font, ("A", "é"))


# ---------------------------------------------------------------------------------------------
# The committed Kerbside 5x7 draft


@pytest.fixture(scope="module")
def kerbside() -> Any:
    return read_glyphs(FONT_PATH)


def test_kerbside_has_exactly_the_101_glyphs_and_every_starter_pair(kerbside: Any) -> None:
    assert len(CHARSET) == 101
    assert set(CHARSET) == {chr(c) for c in range(32, 127)} | set("£★→←↑↓")
    check_charset(kerbside)
    assert len(kerbside.glyphs) == 101
    assert (kerbside.name, kerbside.glyph_size, kerbside.cell) == ("Kerbside 5x7", (5, 7), (6, 8))
    assert (kerbside.baseline, kerbside.advance) == (7, 6)
    assert sorted(kerbside.kerning) == sorted(STARTER_PAIRS)
    assert kerbside.kerning["AV"] == -1  # SSP-069's layout test relies on it
    assert all(v in (-1, 0) for v in kerbside.kerning.values())


def test_kerbside_design_rules(kerbside: Any) -> None:
    """ART_BIBLE §12.5: only the space is blank; ★ fills all 7 rows; £ sits on the baseline with a
    cap-height ascender; descenders end on row 7; x-height letters start on row 3."""
    blank = [c for c, g in kerbside.glyphs.items() if not g.inked]
    assert blank == [" "]

    def rows_used(c: str) -> list[int]:
        return [i for i, row in enumerate(kerbside.glyphs[c].rows) if "#" in row]

    assert rows_used("★") == list(range(7))
    assert rows_used("£")[0] == 0 and rows_used("£")[-1] == 6
    for c in "gjpqy":
        assert rows_used(c)[-1] == 6, c
    for c in "acemnorsuvwxz":
        assert rows_used(c) == [2, 3, 4, 5, 6], c
    for c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789":
        assert rows_used(c) == list(range(7)), c


def _touches(left: Glyph, right: Glyph, dx: int) -> bool:
    """True when ``right`` drawn ``dx`` px right of ``left`` overlaps it or sits 4-adjacent to it."""
    a, b = left.mask, right.mask
    h, w = a.shape
    canvas_a = np.zeros((h, w + dx + w), dtype=np.bool_)
    canvas_b = np.zeros_like(canvas_a)
    canvas_a[:, :w] = a
    canvas_b[:, dx : dx + w] = b
    grown = canvas_a.copy()
    grown[:, 1:] |= canvas_a[:, :-1]
    grown[:, :-1] |= canvas_a[:, 1:]
    grown[1:, :] |= canvas_a[:-1, :]
    grown[:-1, :] |= canvas_a[1:, :]
    return bool((grown & canvas_b).any())


def test_kerned_pairs_never_touch_and_unkerned_pairs_would(kerbside: Any) -> None:
    """The draft's kerning rule (glyph file comment): -1 only where the two glyphs keep a gap; the
    pairs left at 0 are exactly those that would touch at -1."""
    for pair, value in kerbside.kerning.items():
        left, right = kerbside.glyphs[pair[0]], kerbside.glyphs[pair[1]]
        assert not _touches(left, right, kerbside.advance + value), pair
        if value == 0:
            assert _touches(left, right, kerbside.advance - 1), pair


def test_confusable_glyphs_differ(kerbside: Any) -> None:
    g = kerbside.glyphs
    for a, b in (("0", "O"), ("1", "l"), ("1", "I"), ("l", "I"), ("5", "S"), ("8", "B"), ("2", "Z")):
        assert g[a].rows != g[b].rows, (a, b)


# ---------------------------------------------------------------------------------------------
# Outline


def test_outline_of_one_pixel_is_its_8_neighbours() -> None:
    ring = outline_ring(np.array([[True]]))
    np.testing.assert_array_equal(ring, [[True, True, True], [True, False, True], [True, True, True]])


def test_outline_covers_diagonals_of_a_diagonal_stroke() -> None:
    mask = np.eye(3, dtype=np.bool_)
    ring = outline_ring(mask)
    expected = np.array(
        [
            [1, 1, 1, 0, 0],
            [1, 0, 1, 1, 0],
            [1, 1, 0, 1, 1],
            [0, 1, 1, 0, 1],
            [0, 0, 1, 1, 1],
        ],
        dtype=np.bool_,
    )
    np.testing.assert_array_equal(ring, expected)


def _bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def test_every_outline_is_8_connected_and_grows_each_glyph_by_1px_per_side(kerbside: Any) -> None:
    """For every inked glyph: the outline is exactly the 8-neighbourhood ring (every outline pixel
    has ink among its 8 neighbours, every empty pixel with ink among its 8 neighbours is outline),
    and the outlined glyph's box is the glyph's box grown by exactly 1 px on every side."""
    for c in frame_chars(kerbside):
        glyph = kerbside.glyphs[c]
        plain = render_glyph(glyph, outlined=False)
        outlined = render_glyph(glyph, outlined=True)
        ink = plain == INK_COLOUR
        assert set(np.unique(plain).tolist()) == {TRANSPARENT, INK_COLOUR}, c
        assert set(np.unique(outlined).tolist()) == {TRANSPARENT, OUTLINE_COLOUR, INK_COLOUR}, c
        np.testing.assert_array_equal(outlined == INK_COLOUR, ink, err_msg=c)
        padded = np.pad(ink, 1)
        near = np.zeros_like(ink)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                near |= padded[1 + dy : 1 + dy + ink.shape[0], 1 + dx : 1 + dx + ink.shape[1]]
        np.testing.assert_array_equal(outlined == OUTLINE_COLOUR, near & ~ink, err_msg=c)
        x0, y0, x1, y1 = _bbox(ink)
        assert _bbox(outlined != TRANSPARENT) == (x0 - 1, y0 - 1, x1 + 1, y1 + 1), c


def test_frames_put_the_glyph_at_the_origin_inside_a_7x9_frame(kerbside: Any) -> None:
    frames = font_frames(kerbside)
    assert len(frames) == 200
    chars = frame_chars(kerbside)
    assert chars[0] == "!" and chars[-6:] == ["£", "←", "↑", "→", "↓", "★"]
    a = chars.index("A")
    plain = frames[f"glyph:-:{a}"]
    assert plain.shape == (9, 7)
    ox, oy = ORIGIN
    np.testing.assert_array_equal(plain[oy : oy + 7, ox : ox + 5] == INK_COLOUR, kerbside.glyphs["A"].mask)
    assert (plain[0, :] == TRANSPARENT).all() and (plain[:, 0] == TRANSPARENT).all()
    assert (plain[8, :] == TRANSPARENT).all() and (plain[:, 6] == TRANSPARENT).all()


# ---------------------------------------------------------------------------------------------
# Metrics


def test_metrics_list_advance_kerning_and_frames_for_both_variants(kerbside: Any) -> None:
    doc = json.loads(metrics_json(kerbside, FONT_ID, "ui", "assets-src/fonts/kerbside5x7.glyphs.txt"))
    assert doc["id"] == FONT_ID and doc["atlas"] == "ui" and doc["font"] == "Kerbside 5x7"
    assert doc["glyph"] == {"w": 5, "h": 7} and doc["cell"] == {"w": 6, "h": 8}
    assert doc["frame"] == {"w": 7, "h": 9} and doc["origin"] == {"x": 1, "y": 1}
    assert doc["baseline"] == 7 and doc["colours"] == {"ink": 7, "outline": 0}
    plain, outline = doc["variants"]["plain"], doc["variants"]["outline"]
    assert (plain["state"], plain["advance"], plain["lineHeight"]) == ("glyph", 6, {"hud": 8, "paragraph": 9})
    assert (outline["state"], outline["advance"], outline["lineHeight"]) == ("outline", 7, {"hud": 9, "paragraph": 10})
    chars = sorted(CHARSET, key=ord)
    for variant, state, advance in ((plain, "glyph", 6), (outline, "outline", 7)):
        assert list(variant["glyphs"]) == chars
        assert variant["glyphs"][" "] == {"advance": advance, "frame": None}
        for n, c in enumerate(frame_chars(kerbside)):
            assert variant["glyphs"][c] == {"advance": advance, "frame": f"{FONT_ID}:{state}:-:{n}"}
        assert variant["kerning"] == kerbside.kerning
        assert list(variant["kerning"]) == sorted(kerbside.kerning, key=lambda p: (ord(p[0]), ord(p[1])))


def test_typeset_applies_advance_kerning_and_paints_outlines_under_ink(kerbside: Any) -> None:
    av = typeset(kerbside, ["AV"], outlined=False)
    assert av.shape == (9, 6 - 1 + 7)  # V is kerned 1 px left
    ax = typeset(kerbside, ["AX"], outlined=False)
    assert ax.shape == (9, 6 + 7)
    two = typeset(kerbside, ["A", "A"], outlined=True)
    assert two.shape == (9 + 9, 7)
    # A diagonal neighbour's outline never covers ink: with AV kerned until V's ring reaches A's ink
    # (outlined advance 7 - 2), both glyphs' ink still survives in full.
    tight = dataclasses.replace(kerbside, kerning={**kerbside.kerning, "AV": -2})
    out = typeset(tight, ["AV"], outlined=True)
    ink = int(kerbside.glyphs["A"].mask.sum() + kerbside.glyphs["V"].mask.sum())
    assert int((out == INK_COLOUR).sum()) == ink
    rings = outline_ring(kerbside.glyphs["V"].mask)
    a_ink = np.argwhere(kerbside.glyphs["A"].mask) + 1  # frame coordinates of A's ink
    v_ring = {(int(y), int(x) + 5) for y, x in np.argwhere(rings)}  # V's frame is 5 px right of A's
    assert v_ring & {(int(y), int(x)) for y, x in a_ink}, "the fixture must make V's ring reach A's ink"


# ---------------------------------------------------------------------------------------------
# Build integration


def font_entry(**over: Any) -> dict[str, Any]:
    e: dict[str, Any] = {
        "id": "font.toy",
        "class": "font",
        "technique": "grid",
        "source": "assets-src/fonts/toy.glyphs.txt",
        "cell": [7, 9],
        "states": ["glyph", "outline"],
        "dirs": "-",
        "frames": {"glyph": 100, "outline": 100},
        "atlas": "ui",
        "outline": False,
        "swaps": [],
    }
    e.update(over)
    return e


def font_repo(tmp_path: Path, **over: Any) -> Path:
    repo = make_repo(tmp_path, [font_entry(**over)])
    (repo / "assets-src" / "fonts").mkdir(parents=True)
    shutil.copy(FONT_PATH, repo / "assets-src" / "fonts" / "toy.glyphs.txt")
    return repo


def test_build_writes_ui_atlas_frames_and_metrics(tmp_path: Path) -> None:
    repo = font_repo(tmp_path)
    result = build(repo_root=repo, use_cache=False)
    [ab] = result.assets
    assert len(ab.frames) == 200
    assert all(f.pivot == ORIGIN and f.atlas == "ui" for f in ab.frames)
    assert [a.name for a in result.atlases] == ["ui"]
    metrics = repo / "public" / "assets" / "fonts" / "toy.json"
    assert metrics.is_file()
    hashes = json.loads((repo / "public" / "assets" / "asset-hashes.json").read_text(encoding="utf-8"))
    assert "public/assets/fonts/toy.json" in hashes
    ui = json.loads((repo / "public" / "assets" / "atlas" / "ui.json").read_text(encoding="utf-8"))
    doc = json.loads(metrics.read_text(encoding="utf-8"))
    for variant in doc["variants"].values():
        for g in variant["glyphs"].values():
            assert g["frame"] is None or (g["frame"] in ui["frames"] and ui["frames"][g["frame"]]["w"] == 7)
    # A stale file in the forge-owned fonts folder is removed on the next build.
    (metrics.parent / "old.json").write_text("{}", encoding="utf-8")
    build(repo_root=repo, use_cache=False)
    assert sorted(p.name for p in metrics.parent.iterdir()) == ["toy.json"]


@pytest.mark.parametrize(
    ("over", "match"),
    [
        ({"cell": [6, 8]}, r"manifest cell 6x8 != the font's frame 7x9"),
        ({"outline": True}, r"must have outline: false"),
        ({"frames": {"glyph": 101, "outline": 101}}, r"glyph file frame list does not match the manifest"),
        ({"technique": "ai-ingest"}, r"needs technique 'grid'"),
        ({"dirs": ["s"]}, r'must have dirs "-"'),
        ({"source": "assets-src/fonts/none.glyphs.txt"}, r"glyph file .* does not exist"),
    ],
)
def test_build_rejects_bad_font_entries(tmp_path: Path, over: dict[str, Any], match: str) -> None:
    repo = font_repo(tmp_path, **over)
    entry = entry_from_data(font_entry(**over))
    with pytest.raises(BuildError, match=match):
        build_asset(entry, repo)


def test_build_rejects_a_glyph_file_with_a_missing_glyph(tmp_path: Path) -> None:
    repo = font_repo(tmp_path)
    path = repo / "assets-src" / "fonts" / "toy.glyphs.txt"
    text = path.read_text(encoding="utf-8")
    start = text.index('glyph "~"')
    path.write_text(text[:start] + text[start + len('glyph "~"\n') + 7 * 6 :], encoding="utf-8")
    with pytest.raises(BuildError, match=r"font.toy: assets-src/fonts/toy.glyphs.txt: .*missing 1: '~'"):
        build_asset(entry_from_data(font_entry()), repo)


def test_committed_font_metrics_match_a_fresh_build() -> None:
    [entry] = [e for e in load_manifest() if e.id == FONT_ID]
    assert (entry.cell, entry.atlas, entry.outline, entry.frames) == ((7, 9), "ui", False, {"glyph": 100, "outline": 100})
    out = font_outputs([entry], REPO_ROOT)
    assert list(out) == ["public/assets/fonts/kerbside5x7.json"]
    assert (REPO_ROOT / "public" / "assets" / "fonts" / "kerbside5x7.json").read_bytes() == out[
        "public/assets/fonts/kerbside5x7.json"
    ]


def test_lint_requires_the_committed_metrics_to_match_the_glyph_file(tmp_path: Path) -> None:
    repo = font_repo(tmp_path)
    build(repo_root=repo, use_cache=False)
    assert lint(repo).errors == []
    metrics = repo / "public" / "assets" / "fonts" / "toy.json"
    metrics.write_text("{}\n", encoding="utf-8")
    assert [(f.rule, f.subject) for f in lint(repo).errors] == [("shape", "font.toy")]
    assert "does not match the glyph file" in lint(repo).errors[0].message
    metrics.unlink()
    assert "is missing" in lint(repo).errors[0].message
