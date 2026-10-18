"""Tests for forge.sprite: the shared .sprite.txt parser/writer (ASSET_PIPELINE §6.2)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from forge.palette import TRANSPARENT
from forge.sprite import (
    DEFAULT_KEY,
    SpriteError,
    SpriteGrid,
    format_frames,
    format_sprite,
    parse_sprite,
    read_sprite,
    render_frames,
    write_sprite,
)

# The ASSET_PIPELINE §6.2 crisp packet example, with headers, comments and two frames.
CRISP = """\
id: litter.crisp_packet
cell: 16x16
palette: kerbside32
origin: ai/litter.sheet_01#cell=4
ingest_sha256: 9b1f0c6e2d7a4b38c5e1f7a90d2c6b4e8a3f1d5c7b9e0a2c4d6f8b1a3c5e7d90
# key omitted: default key applies

frame idle:h00:0
................
................
................
..000000000000..
..0iiiiiiiiii0..
..0iiiiiiiiii0..
..0iiiggggiii0..
..0iiggggggii0..
..0iiggggggii0..
..0iiiggggiii0..
..0iiiiiiiiii0..
..0iiiiiiiiii0..
..000000000000..
................
................
................

frame wobble:h00:0
# a comment inside a block is skipped
................
................
................
..000000000000..
..0iiiiiiiiii0..
..0iiiiiiiiii0..
..0iiiiiiiiii0..
..0iiiggggiii0..
..0iiggggggii0..
..0iiggggggii0..
..0iiiggggiii0..
..0iiiiiiiiii0..
..000000000000..
................
................
................
"""

# An asymmetric 4x3 actor with SW and W authored and SE/E mirrored.
ACTOR = """\
id: npc.test_walker
cell: 4x3
palette: kerbside32

frame walk:sw:0
0f..
0ff.
0000

frame walk:sw:1
.0f.
.0ff
.000

frame idle:w:0
1234
5678
9abc

mirror se from sw
mirror e from w
"""


def test_default_key_covers_32_indices_and_transparent() -> None:
    assert DEFAULT_KEY["."] == TRANSPARENT
    assert DEFAULT_KEY["0"] == 0 and DEFAULT_KEY["9"] == 9
    assert DEFAULT_KEY["a"] == 10 and DEFAULT_KEY["f"] == 15 and DEFAULT_KEY["v"] == 31
    assert sorted(v for v in DEFAULT_KEY.values() if v >= 0) == list(range(32))
    assert len(DEFAULT_KEY) == 33


def test_parse_crisp_packet_example() -> None:
    g = parse_sprite(CRISP, "crisp")
    assert g.id == "litter.crisp_packet"
    assert g.cell == (16, 16)
    assert g.palette == "kerbside32"
    assert g.origin == "ai/litter.sheet_01#cell=4"
    assert g.ingest_sha256 == "9b1f0c6e2d7a4b38c5e1f7a90d2c6b4e8a3f1d5c7b9e0a2c4d6f8b1a3c5e7d90"
    assert g.key is None
    assert list(g.frames) == ["idle:h00:0", "wobble:h00:0"]
    idle = g.frames["idle:h00:0"]
    assert idle.shape == (16, 16) and idle.dtype == np.int16
    assert idle[0, 0] == TRANSPARENT
    assert idle[3, 2] == 0  # ink
    assert idle[4, 3] == 18  # i = postbox_red
    assert idle[6, 6] == 16  # g = lemon


def test_write_parse_round_trip_preserves_headers_frames_and_mirrors(tmp_path: Path) -> None:
    for text in (CRISP, ACTOR):
        g = parse_sprite(text)
        out = format_sprite(g)
        g2 = parse_sprite(out)
        assert (g2.id, g2.cell, g2.origin, g2.ingest_sha256, g2.key, g2.mirrors) == (
            g.id,
            g.cell,
            g.origin,
            g.ingest_sha256,
            g.key,
            g.mirrors,
        )
        assert list(g2.frames) == list(g.frames)
        for fid in g.frames:
            np.testing.assert_array_equal(g2.frames[fid], g.frames[fid])
        # The canonical form is a fixed point of the writer.
        assert format_sprite(g2) == out
        path = write_sprite(tmp_path / "x" / "g.sprite.txt", g)
        assert path.read_bytes() == out.encode("utf-8")
        assert format_sprite(read_sprite(path)) == out


def test_writer_canonical_layout() -> None:
    out = format_sprite(parse_sprite(ACTOR))
    assert out.startswith("id: npc.test_walker\ncell: 4x3\npalette: kerbside32\n\nframe walk:sw:0\n0f..\n")
    assert out.endswith("\nmirror se from sw\nmirror e from w\n")
    assert "\r" not in out
    crisp = format_sprite(parse_sprite(CRISP))
    assert crisp.splitlines()[3:5] == [
        "origin: ai/litter.sheet_01#cell=4",
        "ingest_sha256: 9b1f0c6e2d7a4b38c5e1f7a90d2c6b4e8a3f1d5c7b9e0a2c4d6f8b1a3c5e7d90",
    ]
    assert "#" not in crisp.split("ingest_sha256")[1], "comments are not preserved"
    assert format_frames(parse_sprite(ACTOR)) in out


def test_mirrors_flip_left_right_and_render_sorted() -> None:
    g = parse_sprite(ACTOR)
    frames = render_frames(g)
    assert list(frames) == sorted(
        ["walk:sw:0", "walk:sw:1", "idle:w:0", "walk:se:0", "walk:se:1", "idle:e:0"]
    )
    np.testing.assert_array_equal(frames["walk:se:0"], g.frames["walk:sw:0"][:, ::-1])
    np.testing.assert_array_equal(frames["walk:se:1"], g.frames["walk:sw:1"][:, ::-1])
    np.testing.assert_array_equal(frames["idle:e:0"], g.frames["idle:w:0"][:, ::-1])
    assert frames["idle:e:0"][0].tolist() == [4, 3, 2, 1]
    # Mirroring never mutates the authored frames.
    assert g.frames["idle:w:0"][0].tolist() == [1, 2, 3, 4]


def test_custom_key_replaces_default_and_round_trips() -> None:
    text = """\
id: prop.test_box
cell: 3x2
palette: kerbside32
key: _=- K=00 Y=15
key: L=16

frame idle:-:0
_KY
LY_
"""
    g = parse_sprite(text)
    assert g.key == {"_": TRANSPARENT, "K": 0, "Y": 15, "L": 16}
    assert g.frames["idle:-:0"].tolist() == [[TRANSPARENT, 0, 15], [16, 15, TRANSPARENT]]
    out = format_sprite(g)
    assert "key: _=- K=00 Y=15 L=16\n" in out
    assert parse_sprite(out).frames["idle:-:0"].tolist() == g.frames["idle:-:0"].tolist()
    # The default key no longer applies once a key map is given.
    with pytest.raises(SpriteError, match="not in the key"):
        parse_sprite(text.replace("_KY", ".KY"))


def test_grid_without_frames_parses() -> None:
    g = parse_sprite("id: ui.blank\ncell: 2x2\npalette: kerbside32\n")
    assert g.frames == {} and g.mirrors == []
    assert format_sprite(g) == "id: ui.blank\ncell: 2x2\npalette: kerbside32\n"


def test_writer_rejects_index_without_key_character() -> None:
    g = SpriteGrid(id="prop.x", cell=(1, 1), key={"A": 3}, frames={"idle:-:0": np.array([[4]], dtype=np.int16)})
    with pytest.raises(SpriteError, match="no key character"):
        format_sprite(g)


HEADER = "id: prop.bad\ncell: 2x2\npalette: kerbside32\n"


@pytest.mark.parametrize(
    ("text", "match"),
    [
        ("cell: 2x2\npalette: kerbside32\nframe a:-:0\n..\n..\n", "missing 'id:'"),
        ("id: prop.bad\npalette: kerbside32\nframe a:-:0\n..\n..\n", "missing 'cell:'"),
        ("id: prop.bad\ncell: 2x2\nframe a:-:0\n..\n..\n", "missing 'palette:'"),
        ("id: prop.bad\ncell: 2x2\npalette: pico8\nframe a:-:0\n..\n..\n", "palette must be"),
        ("id: Bad\ncell: 2x2\npalette: kerbside32\n", "id must be"),
        ("id: prop.bad\ncell: 2by2\npalette: kerbside32\n", "cell must be WxH"),
        (HEADER + "colour: red\n", "unknown header"),
        (HEADER + "id: prop.again\n", "duplicate header"),
        (HEADER + "ingest_sha256: abc\n", "64 lower-case hex"),
        (HEADER + "key: #=01\n", "bad pair"),
        (HEADER + "key: A=32\n", "out of range"),
        (HEADER + "key: A=1 A=2\n", "defined twice"),
        (HEADER + "frame a:-:0\n..\n...\n", "has 3 chars, expected 2"),
        (HEADER + "frame a:-:0\n..\n.x\n", "'x' is not in the key"),
        (HEADER + "frame a:-:0\n..\n", "has 1 rows, expected 2"),
        (HEADER + "frame a:-:0\n..\n..\nframe a:-:0\n..\n..\n", "duplicate frame"),
        (HEADER + "frame a:-:0\n..\n..\nid: prop.late\n", "expected 'frame"),
        (HEADER + "frame A:-:0\n..\n..\n", "expected a .name: value. header"),
        (HEADER + "frame a:x:0\n..\n..\n", "expected a .name: value. header"),
        (HEADER + "frame a:w:0\n..\n..\nmirror e from sw\n", "sw has no authored frames"),
        (HEADER + "frame a:w:0\n..\n..\nframe a:e:0\n..\n..\nmirror e from w\n", "e already has authored frames"),
        (HEADER + "frame a:w:0\n..\n..\nmirror e from w\nmirror e from w\n", "already a mirror target"),
        (HEADER + "frame a:-:0\n..\n..\nmirror e from -\n", "undirected"),
        (HEADER + "frame a:w:0\n..\n..\nmirror w from w\n", "cannot mirror itself"),
    ],
)
def test_parse_errors(text: str, match: str) -> None:
    with pytest.raises(SpriteError, match=match):
        parse_sprite(text, "bad.sprite.txt")


def test_error_messages_carry_source_and_line() -> None:
    with pytest.raises(SpriteError, match=r"^bad\.sprite\.txt:6: "):
        parse_sprite(HEADER + "frame a:-:0\n..\n.x\n", "bad.sprite.txt")


def test_crlf_and_trailing_whitespace_are_ignored() -> None:
    text = ACTOR.replace("\n", "  \r\n")
    g = parse_sprite(text)
    assert format_sprite(g) == format_sprite(parse_sprite(ACTOR))
