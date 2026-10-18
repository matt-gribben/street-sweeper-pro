"""Tests for forge.outline: 1 px ink, 4-connected, outside the silhouette (ART_BIBLE §6.3)."""

from __future__ import annotations

import numpy as np
import pytest

from forge.outline import INK, add_outline, outline_gaps
from forge.palette import TRANSPARENT

T = TRANSPARENT


def grid(rows: list[str]) -> np.ndarray:
    """'.' transparent, '0' ink, any other digit/letter = that palette index (base 36)."""
    return np.array([[T if c == "." else int(c, 36) for c in r] for r in rows], dtype=np.int16)


def show(a: np.ndarray) -> list[str]:
    return ["".join("." if v == T else np.base_repr(int(v), 36).lower() for v in r) for r in a]


def test_single_pixel_gets_a_plus_shaped_outline() -> None:
    out = add_outline(grid([".....", ".....", "..f..", ".....", "....."]))
    assert show(out) == [".....", "..0..", ".0f0.", "..0..", "....."]


def test_outline_is_4_connected_not_8() -> None:
    out = add_outline(grid(["....", ".ff.", ".ff.", "...."]))
    assert show(out) == [".00.", "0ff0", "0ff0", ".00."]
    assert out[0, 0] == T, "diagonal neighbours are not outlined"


def test_ring_outlines_inside_its_hole_too() -> None:
    src = grid(
        [
            ".......",
            ".fffff.",
            ".f...f.",
            ".f...f.",
            ".f...f.",
            ".fffff.",
            ".......",
        ]
    )
    out = add_outline(src)
    assert show(out) == [
        ".00000.",
        "0fffff0",
        "0f000f0",
        "0f0.0f0",
        "0f000f0",
        "0fffff0",
        ".00000.",
    ]


def test_noop_on_a_grid_with_a_full_ink_border() -> None:
    src = grid(
        [
            "........",
            "..0000..",
            ".0ffff0.",
            ".0fiif0.",
            ".0ffff0.",
            "..0000..",
            "........",
        ]
    )
    out = add_outline(src)
    np.testing.assert_array_equal(out, src)
    assert not outline_gaps(src).any()


def test_ink_never_seeds_more_outline() -> None:
    src = grid(["....", ".00.", "....", "...."])
    np.testing.assert_array_equal(add_outline(src), src)


def test_outline_is_idempotent_and_closes_all_gaps() -> None:
    rng = np.random.Generator(np.random.PCG64(9))
    for _ in range(50):
        a = np.full((12, 12), T, dtype=np.int16)
        inner = rng.integers(-1, 32, size=(8, 8)).astype(np.int16)
        a[2:10, 2:10] = inner
        once = add_outline(a)
        assert not outline_gaps(once).any()
        np.testing.assert_array_equal(add_outline(once), once)
        # Only transparent pixels change, and only to ink.
        changed = once != a
        assert (a[changed] == T).all() and (once[changed] == INK).all()


def test_outline_does_not_modify_its_input() -> None:
    src = grid(["...", ".f.", "..."])
    before = src.copy()
    add_outline(src)
    np.testing.assert_array_equal(src, before)


def test_gaps_count_the_frame_edge_as_transparent() -> None:
    edge = grid(["f..", "...", "..."])
    out = add_outline(edge)
    assert show(out) == ["f0.", "0..", "..."]
    assert outline_gaps(out).tolist() == [[True, False, False], [False] * 3, [False] * 3]


def test_gaps_flag_non_ink_pixels_next_to_transparency() -> None:
    a = grid(["....", ".ff.", "...."])
    assert int(outline_gaps(a).sum()) == 2


@pytest.mark.parametrize("bad", [np.zeros((2, 2, 2), dtype=np.int16), np.zeros((2, 2), dtype=np.float32)])
def test_rejects_non_index_arrays(bad: np.ndarray) -> None:
    with pytest.raises(ValueError):
        add_outline(bad)
    with pytest.raises(ValueError):
        outline_gaps(bad)
