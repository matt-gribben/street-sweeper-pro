"""Tests for forge.pixelize, pinned to the asset probe's measured values.

Expected periods come from assets-src/_probe/reports/post.report.json (old woman, E2) and
post_rub.report.json (rubbish, E5); ADR 0002 §2. The reports round to 0.01 px, so each axis
is asserted separately within PERIOD_TOLERANCE_PX = 0.02 px.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

from forge.pixelize import (
    alpha_bbox,
    bbox_crop,
    block_mode_keys,
    block_mode_resize,
    detect_period,
    key_bg,
    pixel_period,
    resample_at_period,
    rgb555_keys,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
PROBE = REPO_ROOT / "assets-src" / "_probe"
OLD_WOMAN = PROBE / "codex" / "old_woman_sheet.png"
RUBBISH = PROBE / "codex4" / "rubbish_sheet.png"

PERIOD_TOLERANCE_PX = 0.02


def _load(path: Path) -> np.ndarray:
    with Image.open(path) as im:
        return np.asarray(im).copy()


# --------------------------------------------------------------------------- period


@pytest.mark.parametrize(
    ("sheet", "method", "period_x", "period_y"),
    [
        pytest.param(OLD_WOMAN, "border", 9.22, 9.38, id="old_woman_sheet"),
        pytest.param(RUBBISH, "alpha", 10.81, 10.87, id="rubbish_sheet"),
    ],
)
def test_period_matches_probe_reports(sheet: Path, method: str, period_x: float, period_y: float) -> None:
    keyed = key_bg(_load(sheet))
    assert keyed.method == method
    px, py = detect_period(keyed.rgba)
    assert abs(px - period_x) <= PERIOD_TOLERANCE_PX, f"period_x {px:.4f} != {period_x}"
    assert abs(py - period_y) <= PERIOD_TOLERANCE_PX, f"period_y {py:.4f} != {period_y}"


def test_old_woman_border_key_matches_probe_report() -> None:
    keyed = key_bg(_load(OLD_WOMAN))
    assert keyed.bg_rgb is not None
    assert [round(v) for v in keyed.bg_rgb] == [250, 5, 249]


@pytest.mark.parametrize(
    ("sheet", "native_r0c0"),
    [
        pytest.param(OLD_WOMAN, (25, 33), id="old_woman_sheet"),
        pytest.param(RUBBISH, (15, 24), id="rubbish_sheet"),
    ],
)
def test_native_cell_size_matches_probe_reports(sheet: Path, native_r0c0: tuple[int, int]) -> None:
    """End-to-end over the 4x2 sheet's first cell, as the probe did (native_cell_px)."""
    rgba = key_bg(_load(sheet)).rgba
    px, py = detect_period(rgba)
    h, w = rgba.shape[:2]
    cell = bbox_crop(rgba[: h // 2, : w // 4])
    native = resample_at_period(cell, (px + py) / 2)
    assert (native.shape[1], native.shape[0]) == native_r0c0
    assert set(np.unique(native[:, :, 3]).tolist()) <= {0, 255}


def _synthetic_pixel_art(period: float, seed: int, blocks_x: int = 40, blocks_y: int = 20) -> np.ndarray:
    """Random-coloured square pseudo-pixels of a (possibly fractional) size, upscaled by floor()."""
    rng = np.random.Generator(np.random.PCG64(seed))
    xb = (np.arange(int(period * blocks_x)) / period).astype(np.int64)
    yb = (np.arange(int(period * blocks_y)) / period).astype(np.int64)
    colours = rng.integers(0, 256, size=(int(yb[-1]) + 1, int(xb[-1]) + 1, 3), dtype=np.uint8)
    return colours[yb][:, xb]


@pytest.mark.parametrize("period", [3.6, 4.5, 6.3, 9.22, 10.81, 14.7, 15.5])
@pytest.mark.parametrize("seed", [0, 1])
def test_pixel_period_recovers_synthetic_fractional_grid(period: float, seed: int) -> None:
    """AI sheets have fractional pseudo-pixel sizes; the detector recovers them within 1 %."""
    rgb = _synthetic_pixel_art(period, seed)
    assert abs(pixel_period(rgb, 1) - period) <= 0.01 * period
    assert abs(pixel_period(rgb, 0) - period) <= 0.01 * period


def test_pixel_period_exact_integer_grid_can_lock_to_a_harmonic() -> None:
    """Known limitation (ASSET_PIPELINE §9.1 step 4): a perfectly regular integer grid has
    equal-strength harmonics, so the detector may report period/k. That is what the committed
    ``period_override`` in ingest.json is for. Pinned so a change in behaviour is noticed."""
    detected = pixel_period(_synthetic_pixel_art(12, seed=0), 1)
    assert detected == pytest.approx(4.0)
    assert 12 / detected == pytest.approx(round(12 / detected))


def test_pixel_period_rejects_bad_axis() -> None:
    with pytest.raises(ValueError):
        pixel_period(np.zeros((8, 8, 3), np.uint8), 2)


# --------------------------------------------------------------------------- key_bg


def test_key_bg_rgb_keys_median_border_colour() -> None:
    bg = (250, 5, 249)
    img = np.empty((10, 12, 3), np.uint8)
    img[:] = bg
    img[0, 0] = (0, 0, 0)  # one odd border pixel does not move the median
    img[3:7, 4:8] = (40, 40, 40)  # far from the key: foreground
    img[8, 1] = (250 - 60, 5 + 60, 249 - 60)  # distance ~103.9 <= 110: background
    img[1, 10] = (250 - 64, 5 + 64, 249 - 64)  # distance ~110.85 > 110: foreground

    keyed = key_bg(img)

    assert keyed.method == "border"
    assert keyed.bg_rgb == (250.0, 5.0, 249.0)
    assert keyed.rgba.shape == (10, 12, 4)
    assert keyed.rgba.dtype == np.uint8
    alpha = keyed.rgba[:, :, 3]
    expected = np.zeros((10, 12), np.uint8)
    expected[3:7, 4:8] = 255
    expected[0, 0] = 255
    expected[1, 10] = 255
    np.testing.assert_array_equal(alpha, expected)
    np.testing.assert_array_equal(keyed.rgba[:, :, :3], img)


def test_key_bg_rgba_with_real_alpha_thresholds_at_128() -> None:
    img = np.zeros((4, 4, 4), np.uint8)
    img[:, :, :3] = (10, 20, 30)
    # 11 of 16 pixels fully transparent (> 20 %): real alpha
    img[0, :, 3] = [0, 1, 127, 128]
    img[1, :, 3] = [253, 255, 0, 0]
    img[2:, :, 3] = 0

    keyed = key_bg(img)

    assert keyed.method == "alpha"
    assert keyed.bg_rgb is None
    np.testing.assert_array_equal(
        keyed.rgba[:, :, 3],
        np.array([[0, 0, 0, 255], [255, 255, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]], np.uint8),
    )
    np.testing.assert_array_equal(keyed.rgba[:, :, :3], img[:, :, :3])
    assert img[0, 1, 3] == 1, "input must not be modified"


def test_key_bg_rgba_without_meaningful_alpha_falls_back_to_border_key() -> None:
    img = np.zeros((6, 6, 4), np.uint8)
    img[:, :, :3] = (255, 0, 255)
    img[:, :, 3] = 255
    img[2:4, 2:4, :3] = (20, 120, 40)
    img[0, 0, 3] = 0  # 1/36 transparent: not meaningful alpha

    keyed = key_bg(img)

    assert keyed.method == "border"
    expected = np.zeros((6, 6), np.uint8)
    expected[2:4, 2:4] = 255
    np.testing.assert_array_equal(keyed.rgba[:, :, 3], expected)


def test_key_bg_rejects_non_uint8() -> None:
    with pytest.raises(ValueError):
        key_bg(np.zeros((4, 4, 3), np.float32))


# --------------------------------------------------------------------------- bbox


def test_bbox_crop_matches_pillow_getbbox() -> None:
    rgba = np.zeros((9, 11, 4), np.uint8)
    rgba[2:5, 3:9] = (1, 2, 3, 255)
    rgba[6, 4, 3] = 1  # any non-zero alpha counts, like Pillow's getbbox
    pil_box = Image.fromarray(rgba, "RGBA").getchannel("A").getbbox()
    assert alpha_bbox(rgba) == pil_box == (3, 2, 9, 7)
    assert bbox_crop(rgba).shape == (5, 6, 4)


def test_bbox_crop_fully_transparent_is_unchanged() -> None:
    rgba = np.zeros((3, 5, 4), np.uint8)
    assert alpha_bbox(rgba) is None
    np.testing.assert_array_equal(bbox_crop(rgba), rgba)


# --------------------------------------------------------------------------- block mode


def test_block_mode_keys_tie_goes_to_lowest_key() -> None:
    """A 2x2 block with keys {7, 7, 3, 3}: a 2-2 tie resolves to 3 (lower palette index)."""
    keys = np.array([[7, 3, 5, 5], [3, 7, 5, 9]], np.int64)
    opaque = np.ones_like(keys, dtype=bool)
    out, out_opaque = block_mode_keys(keys, opaque, 2, 1)
    np.testing.assert_array_equal(out, [[3, 5]])
    np.testing.assert_array_equal(out_opaque, [[True, True]])


def test_block_mode_keys_ignores_transparent_pixels_and_uses_alpha_majority() -> None:
    keys = np.array([[1, 2, 4, 4], [2, 2, 4, 4]], np.int64)
    opaque = np.array([[True, False, False, False], [True, False, True, False]])
    out, out_opaque = block_mode_keys(keys, opaque, 2, 1)
    # left block: 2 of 4 opaque (exact half -> opaque); opaque keys {1, 2}: tie -> 1.
    # right block: 1 of 4 opaque -> transparent.
    np.testing.assert_array_equal(out_opaque, [[True, False]])
    np.testing.assert_array_equal(out, [[1, -1]])


def test_block_mode_resize_rgb_tie_uses_lowest_rgb555_key() -> None:
    red = (200, 16, 16)
    blue = (16, 16, 200)
    rgba = np.zeros((2, 2, 4), np.uint8)
    rgba[0, 0, :3] = red
    rgba[1, 1, :3] = red
    rgba[0, 1, :3] = blue
    rgba[1, 0, :3] = blue
    rgba[:, :, 3] = 255
    assert rgb555_keys(np.array(blue, np.uint8)) < rgb555_keys(np.array(red, np.uint8))

    out = block_mode_resize(rgba, 1, 1)

    np.testing.assert_array_equal(out[0, 0], [*blue, 255])


def test_block_mode_resize_averages_winning_bucket_and_binarises_alpha() -> None:
    rgba = np.zeros((2, 4, 4), np.uint8)
    # left block: bucket (12>>3)=1 holds 9, 10, 15 in R (three px), plus one odd pixel
    rgba[0, 0] = (9, 0, 0, 255)
    rgba[0, 1] = (10, 0, 0, 200)
    rgba[1, 0] = (15, 0, 0, 128)
    rgba[1, 1] = (250, 250, 250, 255)
    # right block: only one opaque pixel of four -> transparent
    rgba[0, 2] = (1, 2, 3, 255)
    rgba[0, 3] = (1, 2, 3, 127)

    out = block_mode_resize(rgba, 2, 1)

    np.testing.assert_array_equal(out[0, 0], [(9 + 10 + 15) // 3, 0, 0, 255])
    np.testing.assert_array_equal(out[0, 1], [0, 0, 0, 0])


def test_block_mode_resize_identity_at_native_size() -> None:
    rng = np.random.Generator(np.random.PCG64(4))
    rgba = rng.integers(0, 256, size=(5, 7, 4), dtype=np.uint8)
    rgba[:, :, 3] = np.where(rgba[:, :, 3] >= 128, 255, 0)
    out = block_mode_resize(rgba, 7, 5)
    np.testing.assert_array_equal(out[:, :, 3], rgba[:, :, 3])
    opaque = rgba[:, :, 3] == 255
    np.testing.assert_array_equal(out[opaque], rgba[opaque])


def test_block_mode_resize_is_deterministic() -> None:
    rgba = bbox_crop(key_bg(_load(RUBBISH)).rgba[:443, :443])
    a = resample_at_period(rgba, 10.84)
    b = resample_at_period(rgba, 10.84)
    assert a.tobytes() == b.tobytes()


# --------------------------------------------------------------------------- purity


def test_import_has_no_side_effects(tmp_path: Path) -> None:
    """Importing forge.pixelize reads no argv, writes no file and prints nothing."""
    code = "import sys; sys.argv = ['pixelize.py', 'OUTDIR', 'notanint', 'x']; import forge.pixelize"
    env = {k: v for k, v in os.environ.items() if k != "PALETTE"}
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    result = subprocess.run(
        [sys.executable, "-c", code],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout == ""
    assert result.stderr == ""
    assert list(tmp_path.iterdir()) == []
