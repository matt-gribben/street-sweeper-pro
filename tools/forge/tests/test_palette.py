"""Tests for forge.palette: kerbside32.json, OKLab nearest colour, the shared fixture, the ramp rule.

The palette file is checked against the tables in docs/ART_BIBLE.md §5.1 (colours, ramps) and
§5.2 (OKLab L), parsed from the doc itself, so the JSON and the doc cannot drift apart.
"""

from __future__ import annotations

import copy
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import numpy as np
import pytest

from forge import palette as palette_module
from forge.palette import (
    FIXTURE_COUNT,
    FIXTURE_PATH,
    FIXTURE_SEED,
    PALETTE_PATH,
    TRANSPARENT,
    Palette,
    PaletteError,
    fixture_bytes,
    fixture_entries,
    load_palette,
    map_image,
    nearest_indices,
    nearest_indices_oklab,
    palette_from_data,
    remap_violations,
    srgb_to_oklab,
    write_fixture,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
ART_BIBLE = REPO_ROOT / "docs" / "ART_BIBLE.md"

# Bessie's body colour (ART_BIBLE §5.1) and the value separation needed at 1x (§5.2).
SWEEPER_YELLOW = 15
LEMON = 16
SEPARATE_AT_1X_L = 0.12


@pytest.fixture(scope="module")
def pal() -> Palette:
    return load_palette()


@pytest.fixture(scope="module")
def raw() -> dict[str, Any]:
    data: dict[str, Any] = json.loads(PALETTE_PATH.read_text(encoding="utf-8"))
    return data


def _section(title_prefix: str) -> str:
    text = ART_BIBLE.read_text(encoding="utf-8")
    start = text.index(f"\n### {title_prefix}")
    end = text.index("\n### ", start + 1)
    return text[start:end]


def _art_bible_colours() -> dict[int, tuple[str, str]]:
    """{index: (name without parenthetical gloss, hex)} from the §5.1 table."""
    out: dict[int, tuple[str, str]] = {}
    row = re.compile(r"\|\s*(\d{2})\s*\|\s*([a-z_]+)(?:\s*\([^)]*\))?\s*\|\s*`(#[0-9a-f]{6})`\s*")
    for line in _section("5.1").splitlines():
        for m in row.finditer(line):
            out[int(m.group(1))] = (m.group(2), m.group(3))
    return out


def _art_bible_ramps() -> dict[str, list[int]]:
    """{snake_case ramp name: indices} from the §5.1 ramp table."""
    out: dict[str, list[int]] = {}
    section = _section("5.1")
    table = section[section.index("**Ramps:**") :]
    for line in table.splitlines():
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if len(cells) != 2 or not re.search(r"\d{2}", cells[1]):
            continue
        key = re.sub(r"[^a-z]+", "_", cells[0].lower()).strip("_")
        out[key] = [int(d) for d in re.findall(r"\d{2}", cells[1])]
    return out


def _art_bible_remaps() -> dict[str, list[int]]:
    """{"night": [...], "shadow": [...]} from the §5.7 tuned-table mirror (rows `| 02 | asphalt | 01 tar | 01 tar |`)."""
    night: dict[int, int] = {}
    shadow: dict[int, int] = {}
    row = re.compile(r"^\|\s*(\d{2})\s*\|\s*([a-z_]+)\s*\|\s*(\d{2}) [a-z_]+\s*\|\s*(\d{2}) [a-z_]+\s*\|$")
    for line in _section("5.7").splitlines():
        m = row.match(line.strip())
        if m:
            night[int(m.group(1))] = int(m.group(3))
            shadow[int(m.group(1))] = int(m.group(4))
    return {"night": [night[i] for i in sorted(night)], "shadow": [shadow[i] for i in sorted(shadow)]}


def _art_bible_lightness() -> dict[int, float]:
    out: dict[int, float] = {}
    for m in re.finditer(r"\|\s*(\d{2})\s*\|\s*(0\.\d{2})\s*(?=\|)", _section("5.2")):
        out[int(m.group(1))] = float(m.group(2))
    return out


# --- kerbside32.json ----------------------------------------------------------------------------


def test_palette_file_shape(raw: dict[str, Any]) -> None:
    assert list(raw) == ["colors", "ramps", "night", "shadow", "swaps"]
    assert len(raw["colors"]) == 32 and len(raw["night"]) == 32 and len(raw["shadow"]) == 32
    assert all(list(c) == ["name", "hex"] for c in raw["colors"])
    assert raw["swaps"] == {}, "swap tables arrive in M4 (SSP-114)"


def test_palette_matches_art_bible_table(raw: dict[str, Any]) -> None:
    doc = _art_bible_colours()
    assert sorted(doc) == list(range(32)), "ART_BIBLE §5.1 table should list indices 00-31"
    ours = {i: (c["name"], c["hex"]) for i, c in enumerate(raw["colors"])}
    assert ours == doc
    assert ours[0] == ("ink", "#0f0e12") and ours[7][0] == "chalk", "names drop the glosses"


def test_palette_names_used_by_rig_pal(pal: Palette) -> None:
    assert pal.index("lemon") == 16
    assert pal.index("sweeper_yellow") == 15
    assert pal.index("chalk") == 7
    assert pal.index("kerb") == 6
    with pytest.raises(KeyError):
        pal.index("chalk (white)")


def test_palette_ramps_match_art_bible(pal: Palette) -> None:
    assert {k: list(v) for k, v in pal.ramps.items()} == _art_bible_ramps()
    assert set(pal.ramps_of(11)) == {"brick_skin", "skin_tones"}
    assert set(pal.ramps_of(12)) == {"brick_skin", "skin_tones"}


def test_hex_roundtrip(pal: Palette, raw: dict[str, Any]) -> None:
    assert [pal.hex(i) for i in range(32)] == [c["hex"] for c in raw["colors"]]


def test_oklab_lightness_matches_art_bible_value_table(pal: Palette) -> None:
    doc = _art_bible_lightness()
    assert sorted(doc) == list(range(32))
    ours = {i: round(float(pal.oklab[i, 0]), 2) for i in range(32)}
    assert ours == doc


def test_oklab_reference_points() -> None:
    lab = srgb_to_oklab(np.array([[0, 0, 0], [255, 255, 255], [255, 0, 0]], dtype=np.uint8))
    assert lab.dtype == np.float64
    np.testing.assert_allclose(lab[0], [0.0, 0.0, 0.0], atol=1e-12)
    np.testing.assert_allclose(lab[1], [1.0, 0.0, 0.0], atol=1e-6)
    # Ottosson's published OKLab for sRGB red.
    np.testing.assert_allclose(lab[2], [0.627955, 0.224863, 0.125846], atol=1e-5)


# --- nearest colour -----------------------------------------------------------------------------


def test_palette_identity(pal: Palette) -> None:
    np.testing.assert_array_equal(nearest_indices(pal.rgb, pal), np.arange(32))
    img = pal.rgb.reshape(4, 8, 3)
    np.testing.assert_array_equal(map_image(img, pal), np.arange(32).reshape(4, 8))


def test_constructed_tie_lower_index_wins() -> None:
    # The query sits exactly half-way between entries 1 and 2 (distances are both exactly 0.01).
    palette_lab = np.array([[0.9, 0.0, 0.0], [0.5, 0.1, 0.0], [0.5, -0.1, 0.0], [0.1, 0.0, 0.0]])
    query = np.array([[0.5, 0.0, 0.0]])
    d = ((query[:, None, :] - palette_lab[None]) ** 2).sum(-1)[0]
    assert d[1] == d[2] and d[1] < d[0] and d[1] < d[3], "the constructed tie must be exact"
    assert nearest_indices_oklab(query, palette_lab).tolist() == [1]
    # Swap the two tied colours: the winner is still the lower *index*, not a particular colour.
    swapped = palette_lab[[0, 2, 1, 3]]
    assert nearest_indices_oklab(query, swapped).tolist() == [1]


def test_tie_between_duplicate_palette_colours_lower_index_wins(raw: dict[str, Any]) -> None:
    data = copy.deepcopy(raw)
    data["colors"][20]["hex"] = data["colors"][5]["hex"]  # 05 and 20 now share a colour
    dup = palette_from_data(data)
    assert nearest_indices(dup.rgb[[5, 20]], dup).tolist() == [5, 5]


def test_map_image_alpha_threshold(pal: Palette) -> None:
    sweeper = pal.rgb[15]
    img = np.zeros((1, 4, 4), dtype=np.uint8)
    img[0, :, :3] = sweeper
    img[0, :, 3] = [0, 127, 128, 255]
    out = map_image(img, pal)
    assert out.dtype == np.int16
    assert out.tolist() == [[TRANSPARENT, TRANSPARENT, 15, 15]]


def test_map_image_matches_per_pixel_nearest(pal: Palette) -> None:
    rng = np.random.Generator(np.random.PCG64(7))
    img = rng.integers(0, 256, size=(37, 23, 3), dtype=np.uint8)
    img[::3, ::2] = img[0, 0]  # plenty of repeated colours
    expected = nearest_indices(img.reshape(-1, 3), pal).reshape(37, 23)
    np.testing.assert_array_equal(map_image(img, pal), expected)
    assert map_image(img, pal).min() >= 0, "RGB images are fully opaque"


def test_map_image_rejects_bad_input(pal: Palette) -> None:
    with pytest.raises(ValueError):
        map_image(np.zeros((2, 2, 3), dtype=np.float32), pal)
    with pytest.raises(ValueError):
        map_image(np.zeros((2, 2), dtype=np.uint8), pal)


# --- shared fixture -----------------------------------------------------------------------------


def test_fixture_regeneration_is_byte_identical(tmp_path: Path, pal: Palette) -> None:
    a = write_fixture(tmp_path / "a.json", pal).read_bytes()
    b = write_fixture(tmp_path / "b.json", load_palette()).read_bytes()
    assert a == b
    assert a == FIXTURE_PATH.read_bytes(), "committed fixture is stale: regenerate it"


def test_fixture_cli_reproduces_committed_file(tmp_path: Path) -> None:
    out = tmp_path / "nested" / "palette_oklab_4096.json"
    result = subprocess.run(
        [sys.executable, "-m", "forge.palette", "--write-fixture", str(out)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert out.read_bytes() == FIXTURE_PATH.read_bytes()


def test_fixture_contents(pal: Palette) -> None:
    data = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    entries = data["entries"]
    assert data["seed"] == FIXTURE_SEED
    assert data["count"] == FIXTURE_COUNT == len(entries) == 4096
    assert all(len(e) == 4 and all(isinstance(v, int) for v in e) for e in entries)
    rgb = np.array([e[:3] for e in entries], dtype=np.uint8)
    expected = np.array([e[3] for e in entries])
    assert entries[:32] == [[*map(int, pal.rgb[i]), i] for i in range(32)]
    assert len({tuple(e[:3]) for e in entries}) == 4096, "samples are distinct"
    np.testing.assert_array_equal(nearest_indices(rgb, pal), expected)
    assert set(expected.tolist()) == set(range(32)), "every palette index is exercised"


def test_fixture_has_no_near_ties(pal: Palette) -> None:
    """A 1-ulp cbrt/pow difference between numpy and JavaScript cannot flip any fixture entry.

    If this ever fails after a palette change, quantise squared distances identically in the
    forge and the TS LUT builder (e.g. round to 1e-12) and document it (SSP-005 risk note).
    """
    data = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    rgb = np.array([e[:3] for e in data["entries"]], dtype=np.uint8)
    lab = srgb_to_oklab(rgb)
    d = ((lab[:, None, :] - pal.oklab[None]) ** 2).sum(-1)
    d.sort(axis=1)
    assert float((d[:, 1] - d[:, 0]).min()) > 1e-9


def test_fixture_is_seed_dependent(pal: Palette) -> None:
    assert fixture_entries(pal, seed=1, count=64) != fixture_entries(pal, seed=2, count=64)
    assert fixture_bytes(pal, seed=1, count=64) == fixture_bytes(pal, seed=1, count=64)


# --- ramp rule for night and shadow -------------------------------------------------------------


def test_tuned_remaps_match_art_bible_mirror(raw: dict[str, Any]) -> None:
    # SSP-021 (D-05/D-06): kerbside32.json is the truth, ART_BIBLE §5.7 mirrors it row for row.
    doc = _art_bible_remaps()
    assert len(doc["night"]) == 32 and len(doc["shadow"]) == 32
    assert doc == {"night": raw["night"], "shadow": raw["shadow"]}


@pytest.mark.parametrize("table", ["night", "shadow"])
def test_remaps_keep_value_order_within_every_ramp(pal: Palette, table: str) -> None:
    # A lighter source never maps darker than a darker source of the same ramp, so lit/base/dark shading
    # survives the remap (ties allowed: two steps may merge).
    lightness = pal.oklab[:, 0]
    remap = pal.remap(table)
    for name, ramp in pal.ramps.items():
        for a in ramp:
            for b in ramp:
                if lightness[a] < lightness[b]:
                    assert lightness[remap[a]] <= lightness[remap[b]], f"{table} inverts {a} < {b} in {name}"


def test_shadow_darkens_every_colour_but_ink(pal: Palette) -> None:
    lightness = pal.oklab[:, 0]
    for i, t in enumerate(pal.shadow):
        if i == 0:
            assert t == 0
        else:
            assert lightness[t] < lightness[i], f"shadow[{i:02d}] = {t:02d} is not darker"


def test_night_keeps_bessie_the_brightest_non_light_colour(pal: Palette) -> None:
    # ART_BIBLE §5.7: under night Bessie's body stays the brightest non-light object, by at least the 0.12 L
    # that separates colours at 1x; only her own highlight (16 lemon) may share her night colour.
    lightness = pal.oklab[:, 0]
    body = pal.night[SWEEPER_YELLOW]
    assert {i for i, t in enumerate(pal.night) if t == body} == {SWEEPER_YELLOW, LEMON}
    for i, t in enumerate(pal.night):
        if t != body:
            assert lightness[t] + SEPARATE_AT_1X_L <= lightness[body], f"night[{i:02d}] = {t:02d} is too bright"


def test_night_keeps_blues_blue(pal: Palette) -> None:
    for i in pal.ramps["blue"]:
        assert pal.night[i] in pal.ramps["blue"]


@pytest.mark.parametrize("table", ["night", "shadow"])
def test_remaps_obey_ramp_rule(pal: Palette, table: str) -> None:
    assert remap_violations(pal, table) == []


@pytest.mark.parametrize(
    ("table", "source", "target", "why"),
    [
        ("shadow", 2, 7, "same ramp, lighter"),  # asphalt -> chalk
        ("night", 15, 16, "same ramp, lighter"),  # sweeper_yellow -> lemon
        ("shadow", 2, 16, "different ramp, lighter"),  # asphalt -> lemon
        ("night", 21, 30, "different ramp, lighter"),  # hedge_dk (0.32) -> plum (0.37)
        ("shadow", 0, 32, "out of range"),
    ],
)
def test_ramp_rule_rejects_bad_entry(pal: Palette, table: str, source: int, target: int, why: str) -> None:
    bad = list(pal.remap(table))
    bad[source] = target
    violations = remap_violations(pal, table, bad)
    assert [(v.source, v.target) for v in violations] == [(source, target)], why


@pytest.mark.parametrize(
    ("source", "target"),
    [
        (15, 19),  # sweeper_yellow -> maroon: different ramp, strictly darker
        (12, 13),  # skin_lt -> umber: shares the skin_tones ramp, darker
        (10, 8),  # brick -> soot_brown: same ramp, two steps down
        (27, 30),  # sky -> plum: different ramp, darker
    ],
)
def test_ramp_rule_accepts_good_entry(pal: Palette, source: int, target: int) -> None:
    table = list(pal.night)
    table[source] = target
    assert remap_violations(pal, "night", table) == []


def test_ramp_rule_rejects_wrong_length(pal: Palette) -> None:
    assert remap_violations(pal, "night", list(range(31)))


def test_cli_fails_on_ramp_rule_violation(tmp_path: Path, raw: dict[str, Any]) -> None:
    data = copy.deepcopy(raw)
    data["shadow"][2] = 7
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps(data), encoding="utf-8")
    result = subprocess.run(
        [sys.executable, "-m", "forge.palette", "--palette", str(bad)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 1
    assert "shadow[02] = 07" in result.stderr


# --- loader validation --------------------------------------------------------------------------


def _mutate(raw: dict[str, Any], path: tuple[Any, ...], value: Any) -> dict[str, Any]:
    data = copy.deepcopy(raw)
    node: Any = data
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = value
    return data


@pytest.mark.parametrize(
    ("path", "value"),
    [
        (("colors", 0, "name"), "ink (outline)"),
        (("colors", 0, "name"), "Ink"),
        (("colors", 1, "name"), "ink"),
        (("colors", 0, "hex"), "0f0e12"),
        (("colors", 0, "hex"), "#0F0E12"),
        (("colors", 0, "hex"), "#0f0e1"),
        (("night",), list(range(31))),
        (("shadow", 3), 32),
        (("shadow", 3), True),
        (("ramps", "accents"), [20]),
        (("swaps",), []),
    ],
)
def test_loader_rejects_malformed_palette(raw: dict[str, Any], path: tuple[Any, ...], value: Any) -> None:
    with pytest.raises(PaletteError):
        palette_from_data(_mutate(raw, path, value))


def test_loader_rejects_wrong_colour_count(raw: dict[str, Any]) -> None:
    data = copy.deepcopy(raw)
    data["colors"].pop()
    with pytest.raises(PaletteError):
        palette_from_data(data)


def test_palette_arrays_are_read_only(pal: Palette) -> None:
    with pytest.raises(ValueError):
        pal.rgb[0, 0] = 1
    with pytest.raises(ValueError):
        pal.oklab[0, 0] = 1.0


def test_palette_module_has_no_hex_literals() -> None:
    source = Path(palette_module.__file__).read_text(encoding="utf-8")
    assert re.findall(r"#[0-9a-fA-F]{6}", source) == []
