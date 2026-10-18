"""Tests for forge.ingest (SSP-013): synthetic sheets with a known pseudo-pixel period."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any

import numpy as np
import numpy.typing as npt
import pytest
from PIL import Image

import forge.palette
from forge.__main__ import main
from forge.ingest import (
    EDITED_MESSAGE,
    IngestConfig,
    IngestError,
    binary_alpha,
    build_grids,
    check_overwrite,
    cli,
    despeckle,
    frames_sha256,
    ingest,
    ingest_sheet,
    parse_config,
    place_in_cell,
    preview_png,
    render_preview,
    sheet_factor,
    slice_cells,
    step_down,
)
from forge.palette import REPO_ROOT, TRANSPARENT, load_palette
from forge.pngio import png_chunk_types
from forge.sprite import DEFAULT_KEY, format_sprite, parse_sprite, read_sprite

PALETTE = load_palette()
MAGENTA = (250, 5, 249)  # the probe key colour, not #ff00ff
PERIOD = 9.3
A, B, INK = 30, 12, 0  # plum, skin_lt, ink

I16 = npt.NDArray[np.int16]


# ---------------------------------------------------------------------------------------------
# Synthetic sheets


def figure(w: int, h: int, a: int = A, b: int = B) -> I16:
    """A ``w`` x ``h`` art-pixel figure: ink outline around a two-colour checkerboard.

    Every pixel shares its index with at least one 8-neighbour, so despeckle leaves it alone,
    and the checkerboard puts a colour edge on every art-pixel boundary for the FFT.
    """
    yy, xx = np.mgrid[0:h, 0:w]
    out = np.where((yy + xx) % 2 == 0, a, b).astype(np.int16)
    out[0, :] = out[-1, :] = out[:, 0] = out[:, -1] = INK
    return out


def upscale(art: I16, period: float) -> npt.NDArray[np.uint8]:
    """Render art pixels as fractional pseudo-pixels: art pixel i spans [round(i*p), round((i+1)*p))."""
    h, w = art.shape
    ys = [round(i * period) for i in range(h + 1)]
    xs = [round(i * period) for i in range(w + 1)]
    out = np.zeros((ys[-1], xs[-1], 4), dtype=np.uint8)
    for y in range(h):
        for x in range(w):
            v = int(art[y, x])
            if v != TRANSPARENT:
                out[ys[y] : ys[y + 1], xs[x] : xs[x + 1], :3] = PALETTE.rgb[v]
                out[ys[y] : ys[y + 1], xs[x] : xs[x + 1], 3] = 255
    return out


def sheet(
    figures: list[I16 | None],
    grid: tuple[int, int],
    cell_px: tuple[int, int] = (320, 420),
    period: float = PERIOD,
    rgba: bool = False,
) -> npt.NDArray[np.uint8]:
    """A golden: each figure upscaled and centred in its cell, on a magenta key (or real alpha)."""
    cols, rows = grid
    cw, ch = cell_px
    out = np.zeros((rows * ch, cols * cw, 4), dtype=np.uint8)
    if not rgba:
        out[:, :, :3] = MAGENTA
        out[:, :, 3] = 255
    for k, fig in enumerate(figures):
        if fig is None:
            continue
        up = upscale(fig, period)
        r, c = divmod(k, cols)
        fh, fw = up.shape[:2]
        y0, x0 = r * ch + (ch - fh) // 2, c * cw + (cw - fw) // 2
        region = out[y0 : y0 + fh, x0 : x0 + fw]
        m = up[:, :, 3] > 0
        region[m] = up[m]
    return out if rgba else np.ascontiguousarray(out[:, :, :3])


def write_golden(root: Path, asset_id: str, img: npt.NDArray[np.uint8], config: dict[str, Any]) -> Path:
    folder = root / "assets-src" / "ai" / asset_id
    folder.mkdir(parents=True, exist_ok=True)
    Image.fromarray(img, "RGBA" if img.shape[2] == 4 else "RGB").save(folder / "golden.png")
    (folder / "ingest.json").write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    return folder


def litter_config(**over: Any) -> dict[str, Any]:
    cfg: dict[str, Any] = {
        "mode": "sheet",
        "grid": [2, 1],
        "cells": ["litter.test_big", "litter.test_small"],
        "frame": "idle:h00:0",
        "target_cell": [24, 24],
        "largest_item_px": 20,
        "period_override": None,
    }
    cfg.update(over)
    return cfg


BIG = figure(16, 20)
SMALL = figure(10, 12, a=18, b=16)


def expected_cell(fig: I16, cell: tuple[int, int] = (24, 24), baseline_row: int | None = None) -> I16:
    tw, th = cell
    h, w = fig.shape
    out = np.full((th, tw), TRANSPARENT, dtype=np.int16)
    x0 = (tw - w) // 2
    y0 = (th - h) // 2 if baseline_row is None else baseline_row + 1 - h
    out[y0 : y0 + h, x0 : x0 + w] = fig
    return out


def args(asset_id: str, force: bool = False, dry_run: bool = False) -> argparse.Namespace:
    return argparse.Namespace(id=asset_id, force=force, dry_run=dry_run, verbose=False)


def tree(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


@pytest.fixture
def litter_repo(tmp_path: Path) -> Path:
    write_golden(tmp_path, "litter.sheet_99", sheet([BIG, SMALL], (2, 1)), litter_config())
    return tmp_path


# ---------------------------------------------------------------------------------------------
# Round trip and step 10


def test_synthetic_sheet_round_trips_to_expected_grids(litter_repo: Path) -> None:
    out = ingest("litter.sheet_99", litter_repo)
    assert abs(out.result.period[0] - PERIOD) < 0.2 and abs(out.result.period[1] - PERIOD) < 0.2
    assert out.result.period_source == "detected"
    assert out.result.factor == 1.0
    big = read_sprite(litter_repo / "assets-src/sprites/litter/test_big.sprite.txt")
    small = read_sprite(litter_repo / "assets-src/sprites/litter/test_small.sprite.txt")
    assert big.cell == small.cell == (24, 24)
    np.testing.assert_array_equal(big.frames["idle:h00:0"], expected_cell(BIG))
    np.testing.assert_array_equal(small.frames["idle:h00:0"], expected_cell(SMALL))
    assert big.origin == "ai/litter.sheet_99#cell=0"
    assert small.origin == "ai/litter.sheet_99#cell=1"
    assert big.ingest_sha256 == frames_sha256(big)


def test_written_grid_uses_default_key_and_provenance_headers(litter_repo: Path) -> None:
    ingest("litter.sheet_99", litter_repo)
    text = (litter_repo / "assets-src/sprites/litter/test_big.sprite.txt").read_text(encoding="utf-8")
    lines = text.splitlines()
    assert lines[:3] == ["id: litter.test_big", "cell: 24x24", "palette: kerbside32"]
    assert lines[3] == "origin: ai/litter.sheet_99#cell=0"
    assert lines[4].startswith("ingest_sha256: ") and len(lines[4].split()[1]) == 64
    assert not any(line.startswith("key:") for line in lines)
    i = lines.index("frame idle:h00:0")
    rows = lines[i + 1 : i + 25]
    assert len(rows) == 24 and all(len(r) == 24 for r in rows)
    assert set("".join(rows)) <= set(DEFAULT_KEY)


def test_people_sheet_writes_named_frames_into_one_grid(tmp_path: Path) -> None:
    figs = [figure(12, 18), None, figure(14, 19), figure(12, 17)]
    cfg = {
        "mode": "sheet",
        "grid": [2, 2],
        "cells": ["npc.test_person:idle:s:0", None, "npc.test_person:walk:s:0", None],
        "target_cell": [24, 24],
        "largest_item_px": 19,
        "period_override": None,
        "baseline_row": 22,
    }
    write_golden(tmp_path, "ref.test_people", sheet(figs, (2, 2)), cfg)
    out = ingest("ref.test_people", tmp_path)
    grid = read_sprite(tmp_path / "assets-src/sprites/npc/test_person.sprite.txt")
    assert list(grid.frames) == ["idle:s:0", "walk:s:0"]
    assert grid.origin == "ai/ref.test_people#cell=0,2"
    np.testing.assert_array_equal(grid.frames["idle:s:0"], expected_cell(figs[0], baseline_row=22))
    np.testing.assert_array_equal(grid.frames["walk:s:0"], expected_cell(figs[2], baseline_row=22))
    for frame in grid.frames.values():  # feet on the pivot row 22, row 23 clear
        rows = np.flatnonzero((frame != TRANSPARENT).any(axis=1))
        assert rows[-1] == 22
    # the null-mapped cell 3 is processed (preview, factor) but never written
    assert [c.index for c in out.result.cells] == [0, 2, 3]
    assert out.result.cells[2].target is None
    assert out.written == [tmp_path / "assets-src/sprites/npc/test_person.sprite.txt"]


def test_real_alpha_golden(tmp_path: Path) -> None:
    write_golden(tmp_path, "litter.sheet_98", sheet([BIG, SMALL], (2, 1), rgba=True), litter_config())
    out = ingest("litter.sheet_98", tmp_path)
    assert out.result.alpha_method == "alpha"
    grid = read_sprite(tmp_path / "assets-src/sprites/litter/test_big.sprite.txt")
    np.testing.assert_array_equal(grid.frames["idle:h00:0"], expected_cell(BIG))


def test_manifest_source_is_the_write_path(litter_repo: Path) -> None:
    entry = {
        "id": "litter.test_big",
        "class": "litter",
        "technique": "ai-ingest",
        "source": "assets-src/sprites/litter/elsewhere.sprite.txt",
        "cell": [24, 24],
        "states": ["idle"],
        "dirs": "h4",
        "frames": {"idle": 1},
        "atlas": "items",
        "outline": False,
        "swaps": [],
    }
    (litter_repo / "assets-src/manifest.json").write_text(json.dumps({"assets": [entry]}), encoding="utf-8")
    ingest("litter.sheet_99", litter_repo)
    assert (litter_repo / "assets-src/sprites/litter/elsewhere.sprite.txt").is_file()
    assert not (litter_repo / "assets-src/sprites/litter/test_big.sprite.txt").exists()


# ---------------------------------------------------------------------------------------------
# Determinism


def test_same_golden_twice_gives_byte_identical_grids(tmp_path: Path) -> None:
    img = sheet([BIG, SMALL], (2, 1))
    roots = [tmp_path / "a", tmp_path / "b"]
    for root in roots:
        write_golden(root, "litter.sheet_99", img, litter_config(largest_item_px=14))
        ingest("litter.sheet_99", root)
    a, b = tree(roots[0]), tree(roots[1])
    assert a == b
    assert "assets-src/sprites/litter/test_big.sprite.txt" in a
    assert "build/tmp/ingest/litter.sheet_99/preview.png" in a


def test_reingest_over_unedited_grid_is_allowed_and_unchanged(litter_repo: Path) -> None:
    ingest("litter.sheet_99", litter_repo)
    before = tree(litter_repo / "assets-src")
    assert cli(args("litter.sheet_99"), litter_repo) == 0
    assert tree(litter_repo / "assets-src") == before


def test_comment_only_changes_do_not_count_as_edits(litter_repo: Path) -> None:
    ingest("litter.sheet_99", litter_repo)
    path = litter_repo / "assets-src/sprites/litter/test_big.sprite.txt"
    path.write_text("# reviewed\n" + path.read_text(encoding="utf-8"), encoding="utf-8")
    assert check_overwrite(path) is None


# ---------------------------------------------------------------------------------------------
# Edited-grid protection


def _edit_one_pixel(path: Path) -> str:
    grid = read_sprite(path)
    frame = grid.frames["idle:h00:0"]
    ys, xs = np.nonzero(frame == A)
    frame[ys[0], xs[0]] = 18
    text = format_sprite(grid)  # keeps the original ingest_sha256
    path.write_text(text, encoding="utf-8")
    return text


def test_reingest_over_hand_edited_grid_exits_non_zero(litter_repo: Path, capsys: pytest.CaptureFixture[str]) -> None:
    ingest("litter.sheet_99", litter_repo)
    path = litter_repo / "assets-src/sprites/litter/test_big.sprite.txt"
    small = litter_repo / "assets-src/sprites/litter/test_small.sprite.txt"
    edited = _edit_one_pixel(path)
    small.unlink()
    assert cli(args("litter.sheet_99"), litter_repo) == 1
    err = capsys.readouterr().err
    assert EDITED_MESSAGE in err and "test_big.sprite.txt" in err
    assert path.read_text(encoding="utf-8") == edited, "the edited grid is untouched"
    assert not small.exists(), "a refusal writes nothing, not even the other grids on the sheet"


def test_force_overwrites_edited_grid(litter_repo: Path, capsys: pytest.CaptureFixture[str]) -> None:
    ingest("litter.sheet_99", litter_repo)
    path = litter_repo / "assets-src/sprites/litter/test_big.sprite.txt"
    _edit_one_pixel(path)
    assert cli(args("litter.sheet_99", force=True), litter_repo) == 0
    assert "discarding hand edits" in capsys.readouterr().err
    np.testing.assert_array_equal(read_sprite(path).frames["idle:h00:0"], expected_cell(BIG))
    assert check_overwrite(path) is None


def test_main_refuses_edited_grid(litter_repo: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(forge.palette, "REPO_ROOT", litter_repo)
    assert main(["ingest", "litter.sheet_99"]) == 0
    _edit_one_pixel(litter_repo / "assets-src/sprites/litter/test_big.sprite.txt")
    assert main(["ingest", "litter.sheet_99"]) != 0
    assert main(["ingest", "litter.sheet_99", "--force"]) == 0


@pytest.mark.parametrize(
    "content",
    [
        "id: litter.test_big\ncell: 24x24\npalette: kerbside32\n",  # no ingest_sha256 (hand-written)
        "not a sprite file\n",
    ],
)
def test_grid_without_valid_provenance_counts_as_edited(litter_repo: Path, content: str) -> None:
    path = litter_repo / "assets-src/sprites/litter/test_big.sprite.txt"
    path.parent.mkdir(parents=True)
    path.write_text(content, encoding="utf-8")
    assert check_overwrite(path) is not None
    assert cli(args("litter.sheet_99"), litter_repo) == 1
    assert path.read_text(encoding="utf-8") == content


# ---------------------------------------------------------------------------------------------
# Dry run and preview


def test_dry_run_writes_preview_and_touches_nothing_in_assets_src(litter_repo: Path) -> None:
    before = tree(litter_repo / "assets-src")
    assert cli(args("litter.sheet_99", dry_run=True), litter_repo) == 0
    assert tree(litter_repo / "assets-src") == before
    preview = litter_repo / "build/tmp/ingest/litter.sheet_99/preview.png"
    data = preview.read_bytes()
    assert set(png_chunk_types(data)) <= {b"IHDR", b"IDAT", b"IEND"}
    report = json.loads((litter_repo / "build/tmp/ingest/litter.sheet_99/report.json").read_text(encoding="utf-8"))
    assert report["factor"] == 1.0 and [c["frame"] for c in report["cells"]] == [
        "litter.test_big:idle:h00:0",
        "litter.test_small:idle:h00:0",
    ]


def test_dry_run_over_edited_grid_still_succeeds(litter_repo: Path) -> None:
    ingest("litter.sheet_99", litter_repo)
    edited = _edit_one_pixel(litter_repo / "assets-src/sprites/litter/test_big.sprite.txt")
    assert cli(args("litter.sheet_99", dry_run=True), litter_repo) == 0
    assert (litter_repo / "assets-src/sprites/litter/test_big.sprite.txt").read_text(encoding="utf-8") == edited


def test_preview_layout_is_four_panels_per_cell_at_8x() -> None:
    cfg = parse_config(litter_config())
    res = ingest_sheet(sheet([BIG, SMALL], (2, 1)), cfg, PALETTE)
    img = render_preview(res, PALETTE)
    pad = 8
    # columns: raw (= native width x8), native x8, mapped and final (24 x 8 each)
    assert img.shape[1] == 16 * 8 * 2 + 24 * 8 * 2 + pad * 5
    assert img.shape[0] == 24 * 8 * 2 + pad * 3
    final_panel = img[pad : pad + 192, pad * 4 + 16 * 8 * 2 + 192 : pad * 4 + 16 * 8 * 2 + 384]
    # the final panel shows the final frame at 8x
    want = expected_cell(BIG)
    ink = PALETTE.rgb[INK]
    assert (final_panel[(want != TRANSPARENT).nonzero()[0][0] * 8, 4 * 8] == ink).all()
    assert preview_png(res, PALETTE) == preview_png(res, PALETTE)


# ---------------------------------------------------------------------------------------------
# One factor per sheet (E10) and step 6


def test_cells_on_one_sheet_share_a_single_scale_factor(tmp_path: Path) -> None:
    big, small = figure(16, 20), figure(8, 10, a=18, b=16)
    write_golden(tmp_path, "litter.sheet_99", sheet([big, small], (2, 1)), litter_config(largest_item_px=10))
    out = ingest("litter.sheet_99", tmp_path)
    assert out.result.factor == pytest.approx(0.5)
    sizes = {c.index: c.stepped_size for c in out.result.cells}
    assert sizes == {0: (8, 10), 1: (4, 5)}, "relative sizes are preserved; the small item is not normalised up"
    for c in out.result.cells:
        assert c.stepped_size[0] == round(c.native_size[0] * out.result.factor)
        assert c.stepped_size[1] == round(c.native_size[1] * out.result.factor)
    small_grid = read_sprite(tmp_path / "assets-src/sprites/litter/test_small.sprite.txt").frames["idle:h00:0"]
    ys, xs = np.nonzero(small_grid != TRANSPARENT)
    assert (ys.max() - ys.min() + 1, xs.max() - xs.min() + 1) == (5, 4)


def test_null_cells_count_towards_the_sheet_factor() -> None:
    figs = [figure(10, 12), figure(16, 24)]
    mapped_only_small = litter_config(cells=["litter.test_small", None], largest_item_px=12)
    res = ingest_sheet(sheet(figs, (2, 1)), parse_config(mapped_only_small), PALETTE)
    assert res.factor == pytest.approx(0.5), "the tallest figure is in the null cell, and it still sets the factor"
    assert res.cells[0].stepped_size == (5, 6)


def test_sheet_factor_rules() -> None:
    assert sheet_factor([(25, 33), (22, 28)], (24, 24), 19) == pytest.approx(19 / 33)
    assert sheet_factor([(30, 12), (10, 10)], (16, 16), 14) == pytest.approx(14 / 30), "largest extent, width or height"
    assert sheet_factor([(10, 10)], (16, 16), 14) == 1.0, "never upscale"
    assert sheet_factor([(20, 30), (24, 10)], (24, 24), None) == pytest.approx(24 / 30)
    assert sheet_factor([(10, 46)], (24, 24), None, baseline_row=22) == pytest.approx(23 / 46)
    with pytest.raises(IngestError):
        sheet_factor([], (24, 24), None)


def test_step_down_is_identity_at_one_and_uses_block_mode() -> None:
    rgba = np.zeros((4, 4, 4), dtype=np.uint8)
    rgba[:, :, 3] = 255
    rgba[:2, :, :3] = PALETTE.rgb[A]
    rgba[2:, :, :3] = PALETTE.rgb[B]
    np.testing.assert_array_equal(step_down(rgba, 1.0), rgba)
    half = step_down(rgba, 0.5)
    assert half.shape == (2, 2, 4)
    assert (half[0, :, :3] == PALETTE.rgb[A]).all() and (half[1, :, :3] == PALETTE.rgb[B]).all()


def test_figure_that_does_not_fit_is_an_error() -> None:
    cfg = parse_config(litter_config(largest_item_px=None, target_cell=[16, 16], baseline_row=None))
    with pytest.raises(IngestError, match="largest|fit"):
        place_in_cell(np.zeros((20, 10, 4), dtype=np.uint8), cfg.target_cell, None)
    with pytest.raises(IngestError, match="baseline"):
        place_in_cell(np.zeros((20, 10, 4), dtype=np.uint8), (24, 24), 18)


def test_largest_item_px_too_big_for_the_cell_is_caught() -> None:
    with pytest.raises(IngestError, match="exceeds the target cell"):
        parse_config(litter_config(largest_item_px=30))


# ---------------------------------------------------------------------------------------------
# period_override (step 4)


def test_period_override_is_honoured(tmp_path: Path) -> None:
    img = sheet([BIG, SMALL], (2, 1))
    write_golden(tmp_path, "litter.sheet_99", img, litter_config(period_override=PERIOD / 2, largest_item_px=None))
    out = ingest("litter.sheet_99", tmp_path, dry_run=True)
    assert out.result.period == (PERIOD / 2, PERIOD / 2)
    assert out.result.period_source == "override"
    assert abs(out.result.period_detected[0] - PERIOD) < 0.2
    assert out.result.cells[0].native_size == (32, 40), "half the period doubles the native size"
    assert out.result.factor == pytest.approx(24 / 40)


def test_period_override_per_axis(tmp_path: Path) -> None:
    write_golden(tmp_path, "litter.sheet_99", sheet([BIG, SMALL], (2, 1)), litter_config(period_override=[PERIOD, PERIOD / 2]))
    out = ingest("litter.sheet_99", tmp_path, dry_run=True)
    assert out.result.period == (PERIOD, PERIOD / 2)
    assert out.result.cells[0].native_size == (16, 40)


def test_period_override_is_never_a_cli_flag() -> None:
    with pytest.raises(SystemExit) as exc:
        main(["ingest", "litter.sheet_99", "--period-override", "9.3"])
    assert exc.value.code == 2


# ---------------------------------------------------------------------------------------------
# Steps 3, 8, 9 in isolation


def test_slice_cells_crops_each_cell_to_its_bbox() -> None:
    rgba = np.zeros((10, 20, 4), dtype=np.uint8)
    rgba[2:5, 3:6, 3] = 255
    rgba[6:9, 12:19, 3] = 255
    cells = slice_cells(rgba, (2, 1))
    assert cells[0] is not None and cells[0][0] == (3, 2, 6, 5) and cells[0][1].shape == (3, 3, 4)
    assert cells[1] is not None and cells[1][0] == (12, 6, 19, 9)
    assert slice_cells(rgba, (2, 2))[0] is not None and slice_cells(rgba, (2, 2))[3] is not None
    assert slice_cells(rgba, (2, 2))[1] is None


def test_despeckle_replaces_specks_and_removes_orphans() -> None:
    f = np.full((5, 5), A, dtype=np.int16)
    f[2, 2] = B  # a speck inside a plum field
    f[0, 0] = TRANSPARENT
    out, n = despeckle(f)
    assert out[2, 2] == A and n == 1
    orphan = np.full((3, 3), TRANSPARENT, dtype=np.int16)
    orphan[1, 1] = B
    out, n = despeckle(orphan)
    assert (out == TRANSPARENT).all() and n == 1


def test_despeckle_keeps_outlines_and_lines() -> None:
    fig = figure(8, 10)
    out, n = despeckle(fig)
    np.testing.assert_array_equal(out, fig)
    assert n == 0
    line = np.full((5, 7), A, dtype=np.int16)
    line[2, 2:4] = INK  # two-pixel eye
    out, _ = despeckle(line)
    np.testing.assert_array_equal(out, line)


def test_despeckle_needs_a_strict_majority() -> None:
    f = np.array([[A, A, B], [B, INK, B], [A, A, B]], dtype=np.int16)
    # INK at the centre: no neighbour shares it; best neighbour A or B has 4 of a 9-pixel window
    out, _ = despeckle(f)
    assert out[1, 1] == INK


def test_binary_alpha_rejects_non_indices() -> None:
    np.testing.assert_array_equal(binary_alpha(np.array([[-1, 0, 31]])), [[-1, 0, 31]])
    with pytest.raises(IngestError):
        binary_alpha(np.array([[32]]))
    with pytest.raises(IngestError):
        binary_alpha(np.array([[-2]]))


def test_every_output_pixel_is_a_palette_index_or_transparent(litter_repo: Path) -> None:
    out = ingest("litter.sheet_99", litter_repo)
    for c in out.result.cells:
        assert c.final.dtype == np.int16
        assert set(np.unique(c.final).tolist()) <= set(range(-1, 32))


# ---------------------------------------------------------------------------------------------
# ingest.json validation


@pytest.mark.parametrize(
    ("over", "match"),
    [
        ({"mode": "art"}, "ai-art"),
        ({"mode": "grid"}, "mode must be 'sheet'"),
        ({"cells": ["litter.a"]}, "exactly 2 x 1"),
        ({"cells": ["litter.a", "litter.a"]}, "both write"),
        ({"cells": ["char.postie", None]}, "unknown asset class"),
        ({"cells": ["Litter.A", None]}, "asset ID"),
        ({"frame": None}, "no top-level 'frame'"),
        ({"frame": "idle"}, "frame must be"),
        ({"period_override": 2}, "within 3-16"),
        ({"period_override": [9.3]}, "period_override"),
        ({"largest_item_px": 0}, "positive integer"),
        ({"baseline_row": 24}, "baseline_row"),
        ({"target_cell": [24]}, "target_cell"),
        ({"extra": 1}, "unknown keys"),
    ],
)
def test_parse_config_rejects(over: dict[str, Any], match: str) -> None:
    with pytest.raises(IngestError, match=match):
        parse_config(litter_config(**over))


def test_parse_config_accepts_the_documented_litter_example() -> None:
    cfg = parse_config(json.loads((REPO_ROOT / "assets-src/ai/litter.sheet_01/ingest.json").read_text(encoding="utf-8")))
    assert isinstance(cfg, IngestConfig)
    assert cfg.grid == (4, 2) and cfg.target_cell == (16, 16) and cfg.largest_item_px == 14
    # SSP-024 ingests only cell 1 (the D-07 scale sample); the other cells stay null until SSP-139.
    assert cfg.cells[1] is not None and cfg.cells[1].frame_id == "litter.banana_skin:idle:h00:0"
    assert [i for i, c in enumerate(cfg.cells) if c is not None] == [1]


def test_missing_folder_is_an_error(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    assert cli(args("litter.nope"), tmp_path) == 1
    assert "ingest.json" in capsys.readouterr().err


def test_mapped_empty_cell_is_an_error(tmp_path: Path) -> None:
    write_golden(tmp_path, "litter.sheet_99", sheet([BIG, None], (2, 1)), litter_config())
    with pytest.raises(IngestError, match="cell 1 .* empty"):
        ingest("litter.sheet_99", tmp_path)


# ---------------------------------------------------------------------------------------------
# The accepted ref.people_style golden (SSP-014): dry run, and the committed hand-repaired grid


def _copy_people_style(tmp_path: Path) -> Path:
    src = REPO_ROOT / "assets-src/ai/ref.people_style"
    dst = tmp_path / "assets-src/ai/ref.people_style"
    dst.mkdir(parents=True)
    for name in ("golden.png", "ingest.json"):
        shutil.copyfile(src / name, dst / name)
    return src


def test_dry_run_on_ref_people_style(tmp_path: Path) -> None:
    src = _copy_people_style(tmp_path)
    before = tree(tmp_path / "assets-src")
    out = ingest("ref.people_style", tmp_path, dry_run=True)
    assert tree(tmp_path / "assets-src") == before
    assert out.preview_path.is_file()
    res = out.result
    assert res.alpha_method == "alpha", "the accepted golden has real alpha"
    # The FFT detector picks a harmonic in x on this golden (ADR 0002 §5.1 would flag it), so
    # ingest.json commits the period measured from colour run lengths (13-14 px on both axes).
    assert res.period_source == "override" and res.period == (13.5, 13.5)
    assert abs(res.period_detected[0] - res.period_detected[1]) > 0.1 * min(res.period_detected)
    assert len(res.cells) == 8, "all eight key poses are processed, mapped or not"
    assert abs(res.factor - 0.9048) < 1e-4, "one sheet factor, 19 / 21"
    tallest = max(c.stepped_size[1] for c in res.cells)
    assert tallest == 19, "largest_item_px 19: the tallest elderly figure is 19 px"
    for c in res.cells:
        rows = np.flatnonzero((c.final != TRANSPARENT).any(axis=1))
        assert rows[-1] == 22 and c.stepped_size[0] <= 18
    cfg = parse_config(json.loads((src / "ingest.json").read_text(encoding="utf-8")))
    assert [None if c is None else c.frame_id for c in cfg.cells] == [
        "npc.old_woman:idle:s:0", None, None, None,
        "npc.old_woman:idle:sw:0", "npc.old_woman:idle:w:0", "npc.old_woman:idle:nw:0", "npc.old_woman:idle:n:0",
    ]


def test_committed_old_woman_grid_is_hand_edited_and_protected(tmp_path: Path) -> None:
    """The committed grid came from this golden (origin, shape) but was hand-repaired (D-13), so a
    plain re-ingest must refuse to overwrite it (CLAUDE.md hard rule 9)."""
    _copy_people_style(tmp_path)
    committed = REPO_ROOT / "assets-src/sprites/npc/old_woman.sprite.txt"
    grid = read_sprite(committed)
    assert grid.origin == "ai/ref.people_style#cell=0,4,5,6,7"
    assert grid.ingest_sha256 is not None
    fresh = build_grids(ingest("ref.people_style", tmp_path, dry_run=True).result, "ref.people_style")["npc.old_woman"]
    assert fresh.ingest_sha256 == grid.ingest_sha256, "ingest_sha256 records the frames as first ingested"
    assert check_overwrite(committed) is not None, "the hand repairs make the grid count as edited"
    repaired = {f: int((grid.frames[f] != fresh.frames[f]).sum()) for f in fresh.frames}
    assert repaired == {"idle:s:0": 13, "idle:sw:0": 12, "idle:w:0": 7, "idle:nw:0": 6, "idle:n:0": 7}, (
        "the per-frame repair counts recorded for D-13 (ROADMAP §8)"
    )

    target = tmp_path / "assets-src/sprites/npc/old_woman.sprite.txt"
    target.parent.mkdir(parents=True)
    shutil.copyfile(committed, target)
    out = ingest("ref.people_style", tmp_path)
    assert target in out.refused and not out.written
    assert target.read_bytes() == committed.read_bytes()


def test_parse_sprite_round_trip_of_ingested_text(litter_repo: Path) -> None:
    ingest("litter.sheet_99", litter_repo)
    path = litter_repo / "assets-src/sprites/litter/test_big.sprite.txt"
    text = path.read_text(encoding="utf-8")
    assert format_sprite(parse_sprite(text)) == text
