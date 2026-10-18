"""Kerbside-32: load the palette and map colours to it by nearest colour in OKLab.

``assets-src/palette/kerbside32.json`` is the truth for colour values (CLAUDE.md §2,
ART_BIBLE §5.1). This module never spells a colour value itself: every colour comes from
that file.

- :func:`load_palette`: read and validate ``kerbside32.json`` into a :class:`Palette`.
- :func:`srgb_to_oklab`: 8-bit sRGB -> linear -> OKLab, using Björn Ottosson's published
  matrices (https://bottosson.github.io/posts/oklab/), in float64.
- :func:`nearest_indices` / :func:`nearest_indices_oklab`: nearest palette index by squared
  OKLab distance. The lower index wins an exact tie. No dither.
- :func:`map_image`: an RGB or RGBA image -> an index array (alpha < 128 -> :data:`TRANSPARENT`).
- :func:`remap_violations`: the ramp rule for the ``night`` and ``shadow`` tables.
- :func:`fixture_bytes` / :func:`write_fixture`: the shared 4,096-sample RGB -> index fixture
  that the TypeScript palette pass (SSP-016) must reproduce exactly
  (TECHNICAL_DESIGN §12.6).

Parity with TypeScript: every float operation here is a single, correctly rounded IEEE 754
float64 add, multiply, divide or ``cbrt``/``power`` evaluated left to right; the TS port
(SSP-016) must write them in the same order. Matrix products are spelled out term by term (never ``@``, whose
BLAS summation order is unspecified). The only operations that may differ between numpy and
JavaScript are ``power`` (sRGB decode) and ``cbrt`` (by at most 1 ulp), which can only flip a
near-tie; the committed fixture's smallest best/second-best distance gap is far above that
(see ``tests/test_palette.py``), so no distance quantisation is needed.

Run ``uv run --project tools/forge python -m forge.palette --write-fixture <path>`` to
regenerate the fixture.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import numpy.typing as npt

from forge.pixelize import ALPHA_THRESHOLD

__all__ = [
    "FIXTURE_COUNT",
    "FIXTURE_PATH",
    "FIXTURE_SEED",
    "PALETTE_PATH",
    "PALETTE_SIZE",
    "REMAP_TABLES",
    "TRANSPARENT",
    "Palette",
    "PaletteError",
    "RemapViolation",
    "fixture_bytes",
    "fixture_entries",
    "linear_to_oklab",
    "load_palette",
    "main",
    "map_image",
    "nearest_indices",
    "nearest_indices_oklab",
    "palette_from_data",
    "remap_violations",
    "srgb_to_linear",
    "srgb_to_oklab",
    "write_fixture",
]

U8Array = npt.NDArray[np.uint8]
F64Array = npt.NDArray[np.float64]
I16Array = npt.NDArray[np.int16]

REPO_ROOT = Path(__file__).resolve().parents[3]
PALETTE_PATH = REPO_ROOT / "assets-src" / "palette" / "kerbside32.json"
"""The palette file: the only legal colours (ART_BIBLE §5.1)."""

FIXTURE_PATH = REPO_ROOT / "tests" / "fixtures" / "palette_oklab_4096.json"
"""The committed RGB -> index fixture shared by pytest and Vitest (TECHNICAL_DESIGN §12.6)."""

PALETTE_SIZE = 32
FIXTURE_COUNT = 4096
FIXTURE_SEED = 20261018
"""PCG64 seed of the fixture's random samples (recorded in the fixture file as well)."""

TRANSPARENT = -1
"""Index written by :func:`map_image` for a pixel whose alpha is below 128."""

REMAP_TABLES = ("night", "shadow")
"""The index -> index remap tables validated by the ramp rule."""

_NAME_RE = re.compile(r"^[a-z][a-z0-9]*(_[a-z0-9]+)*$")
_HEX_DIGITS = frozenset("0123456789abcdef")

# Björn Ottosson's OKLab matrices (https://bottosson.github.io/posts/oklab/, 2020).
# M1: linear sRGB -> LMS.
_M1 = (
    (0.4122214708, 0.5363325363, 0.0514459929),
    (0.2119034982, 0.6806995451, 0.1073969566),
    (0.0883024619, 0.2817188376, 0.6299787005),
)
# M2: cube-rooted LMS -> (L, a, b).
_M2 = (
    (0.2104542553, 0.7936177850, -0.0040720468),
    (1.9779984951, -2.4285922050, 0.4505937099),
    (0.0259040371, 0.7827717662, -0.8086757660),
)


class PaletteError(ValueError):
    """``kerbside32.json`` is malformed."""


@dataclass(frozen=True)
class Palette:
    """A loaded, validated Kerbside-32 palette.

    ``rgb`` and ``oklab`` are read-only ``(32, 3)`` arrays (``uint8`` and ``float64``).
    """

    names: tuple[str, ...]
    rgb: U8Array
    oklab: F64Array
    ramps: Mapping[str, tuple[int, ...]]
    night: tuple[int, ...]
    shadow: tuple[int, ...]
    swaps: Mapping[str, object]

    def __len__(self) -> int:
        return len(self.names)

    def index(self, name: str) -> int:
        """The index of the colour called ``name`` (e.g. ``"sweeper_yellow"`` -> 15)."""
        try:
            return self.names.index(name)
        except ValueError:
            raise KeyError(f"no Kerbside-32 colour named {name!r}") from None

    def hex(self, index: int) -> str:
        """The ``#rrggbb`` string of ``index``, lower case, as written in the palette file."""
        r, g, b = (int(v) for v in self.rgb[index])
        return f"#{r:02x}{g:02x}{b:02x}"

    def remap(self, table: str) -> tuple[int, ...]:
        """The ``night`` or ``shadow`` table."""
        if table not in REMAP_TABLES:
            raise KeyError(f"unknown remap table {table!r}; expected one of {REMAP_TABLES}")
        return self.night if table == "night" else self.shadow

    def ramps_of(self, index: int) -> tuple[str, ...]:
        """Names of every ramp that contains ``index`` (an index can belong to several)."""
        return tuple(name for name, members in self.ramps.items() if index in members)


# ---------------------------------------------------------------------------------------------
# Loading


def _parse_hex(text: object, where: str) -> tuple[int, int, int]:
    if not isinstance(text, str) or len(text) != 7 or text[0] != "#" or not set(text[1:]) <= _HEX_DIGITS:
        raise PaletteError(f"{where}: hex must be '#' plus 6 lower-case hex digits, got {text!r}")
    return (int(text[1:3], 16), int(text[3:5], 16), int(text[5:7], 16))


def _index_list(value: object, where: str, length: int | None = None) -> tuple[int, ...]:
    if not isinstance(value, list):
        raise PaletteError(f"{where}: expected a list of indices")
    out: list[int] = []
    for v in value:
        if isinstance(v, bool) or not isinstance(v, int) or not 0 <= v < PALETTE_SIZE:
            raise PaletteError(f"{where}: {v!r} is not an index 0-{PALETTE_SIZE - 1}")
        out.append(v)
    if length is not None and len(out) != length:
        raise PaletteError(f"{where}: expected {length} indices, got {len(out)}")
    return tuple(out)


def palette_from_data(data: object) -> Palette:
    """Validate parsed ``kerbside32.json`` content and build a :class:`Palette`."""
    if not isinstance(data, dict):
        raise PaletteError("palette: top level must be an object")
    expected_keys = {"colors", "ramps", "night", "shadow", "swaps"}
    if set(data) != expected_keys:
        raise PaletteError(f"palette: keys must be exactly {sorted(expected_keys)}, got {sorted(data)}")

    colors = data["colors"]
    if not isinstance(colors, list) or len(colors) != PALETTE_SIZE:
        raise PaletteError(f"colors: expected {PALETTE_SIZE} entries")
    names: list[str] = []
    rgb: list[tuple[int, int, int]] = []
    for i, entry in enumerate(colors):
        where = f"colors[{i}]"
        if not isinstance(entry, dict) or set(entry) != {"name", "hex"}:
            raise PaletteError(f"{where}: expected an object with exactly 'name' and 'hex'")
        name = entry["name"]
        if not isinstance(name, str) or not _NAME_RE.match(name):
            raise PaletteError(f"{where}: name must be snake_case, got {name!r}")
        if name in names:
            raise PaletteError(f"{where}: duplicate name {name!r}")
        names.append(name)
        rgb.append(_parse_hex(entry["hex"], where))

    ramps_raw = data["ramps"]
    if not isinstance(ramps_raw, dict) or not ramps_raw:
        raise PaletteError("ramps: expected a non-empty object of name -> index list")
    ramps: dict[str, tuple[int, ...]] = {}
    for name, members in ramps_raw.items():
        if not _NAME_RE.match(name):
            raise PaletteError(f"ramps: name must be snake_case, got {name!r}")
        idx = _index_list(members, f"ramps.{name}")
        if not idx or len(set(idx)) != len(idx):
            raise PaletteError(f"ramps.{name}: must be non-empty with no repeated index")
        ramps[name] = idx
    in_a_ramp = {i for members in ramps.values() for i in members}
    if in_a_ramp != set(range(PALETTE_SIZE)):
        missing = sorted(set(range(PALETTE_SIZE)) - in_a_ramp)
        raise PaletteError(f"ramps: every index must belong to a ramp; missing {missing}")

    night = _index_list(data["night"], "night", PALETTE_SIZE)
    shadow = _index_list(data["shadow"], "shadow", PALETTE_SIZE)

    swaps = data["swaps"]
    if not isinstance(swaps, dict):
        raise PaletteError("swaps: expected an object")

    rgb_arr = np.array(rgb, dtype=np.uint8)
    lab_arr = srgb_to_oklab(rgb_arr)
    rgb_arr.flags.writeable = False
    lab_arr.flags.writeable = False
    return Palette(
        names=tuple(names),
        rgb=rgb_arr,
        oklab=lab_arr,
        ramps=ramps,
        night=night,
        shadow=shadow,
        swaps=dict(swaps),
    )


def load_palette(path: Path | str = PALETTE_PATH) -> Palette:
    """Load and validate ``kerbside32.json`` (default: the repo's palette file)."""
    with Path(path).open(encoding="utf-8") as f:
        data: object = json.load(f)
    return palette_from_data(data)


# ---------------------------------------------------------------------------------------------
# Colour conversion


def srgb_to_linear(rgb: npt.ArrayLike) -> F64Array:
    """8-bit sRGB values (any shape) -> linear-light float64 in [0, 1] (IEC 61966-2-1)."""
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    return np.where(c <= 0.04045, c / 12.92, np.power((c + 0.055) / 1.055, 2.4))


def linear_to_oklab(lin: npt.ArrayLike) -> F64Array:
    """Linear sRGB ``(..., 3)`` float64 -> OKLab ``(..., 3)`` float64 (L in [0, 1])."""
    x = np.asarray(lin, dtype=np.float64)
    if x.shape[-1:] != (3,):
        raise ValueError(f"expected a trailing axis of 3 channels, got shape {x.shape}")
    r, g, b = x[..., 0], x[..., 1], x[..., 2]
    lms = [np.cbrt(m[0] * r + m[1] * g + m[2] * b) for m in _M1]
    lab = [m[0] * lms[0] + m[1] * lms[1] + m[2] * lms[2] for m in _M2]
    return np.stack(lab, axis=-1)


def srgb_to_oklab(rgb: npt.ArrayLike) -> F64Array:
    """8-bit sRGB ``(..., 3)`` -> OKLab ``(..., 3)`` float64."""
    return linear_to_oklab(srgb_to_linear(rgb))


# ---------------------------------------------------------------------------------------------
# Nearest colour


def _squared_distances(lab: F64Array, palette_lab: F64Array) -> F64Array:
    """``(N, 3)`` x ``(P, 3)`` -> ``(N, P)`` squared OKLab distances, dL² + da² + db² in that order."""
    d = lab[:, None, :] - palette_lab[None, :, :]
    return d[..., 0] * d[..., 0] + d[..., 1] * d[..., 1] + d[..., 2] * d[..., 2]


def nearest_indices_oklab(lab: npt.ArrayLike, palette_lab: npt.ArrayLike) -> npt.NDArray[np.intp]:
    """Index of the nearest ``palette_lab`` row for each OKLab colour ``(..., 3)``.

    Squared Euclidean distance in OKLab. On an exact tie the lower index wins
    (``argmin`` returns the first minimum). No dither.
    """
    q = np.asarray(lab, dtype=np.float64)
    p = np.asarray(palette_lab, dtype=np.float64)
    if q.shape[-1:] != (3,) or p.ndim != 2 or p.shape[1] != 3 or len(p) == 0:
        raise ValueError(f"expected (..., 3) colours and a (P, 3) palette, got {q.shape} and {p.shape}")
    flat = q.reshape(-1, 3)
    return np.argmin(_squared_distances(flat, p), axis=1).reshape(q.shape[:-1])


def nearest_indices(rgb: npt.ArrayLike, palette: Palette) -> npt.NDArray[np.intp]:
    """Nearest Kerbside-32 index for each 8-bit sRGB colour ``(..., 3)``."""
    return nearest_indices_oklab(srgb_to_oklab(rgb), palette.oklab)


def map_image(img: npt.NDArray[np.generic], palette: Palette) -> I16Array:
    """Map an ``(H, W, 3)`` RGB or ``(H, W, 4)`` RGBA ``uint8`` image to an ``(H, W)`` index array.

    Opaque pixels get their nearest palette index (0-31); pixels with alpha < 128 get
    :data:`TRANSPARENT` (-1). RGB images are fully opaque. Each distinct colour is
    resolved once, so large images cost one lookup per unique colour.
    """
    if img.dtype != np.uint8 or img.ndim != 3 or img.shape[2] not in (3, 4):
        raise ValueError(f"expected an (H, W, 3|4) uint8 image, got {img.dtype} {img.shape}")
    h, w = img.shape[:2]
    rgb = img[:, :, :3].reshape(-1, 3).astype(np.uint32)
    keys = (rgb[:, 0] << 16) | (rgb[:, 1] << 8) | rgb[:, 2]
    uniq, inverse = np.unique(keys, return_inverse=True)
    uniq_rgb = np.stack([(uniq >> 16) & 0xFF, (uniq >> 8) & 0xFF, uniq & 0xFF], axis=-1).astype(np.uint8)
    out = nearest_indices(uniq_rgb, palette).astype(np.int16)[inverse.reshape(-1)]
    if img.shape[2] == 4:
        out[img[:, :, 3].reshape(-1) < ALPHA_THRESHOLD] = TRANSPARENT
    return out.reshape(h, w)


# ---------------------------------------------------------------------------------------------
# Ramp rule for the night and shadow remaps


@dataclass(frozen=True)
class RemapViolation:
    """One remap entry that breaks the ramp rule."""

    table: str
    source: int
    target: int
    reason: str

    def __str__(self) -> str:
        return f"{self.table}[{self.source:02d}] = {self.target:02d}: {self.reason}"


def remap_violations(palette: Palette, table: str, entries: Sequence[int] | None = None) -> list[RemapViolation]:
    """Check a remap table against the ramp rule; return every violation (empty = valid).

    The rule (ROADMAP "within its own ramp, or to the next ramp down"; D-05 "stay within its
    ramp or step to a darker ramp"), operationalised with OKLab L (ART_BIBLE §5.2). Entry
    ``source -> target`` is valid when:

    1. ``target == source``; or
    2. ``target`` shares a ramp with ``source`` and is not lighter (L_t <= L_s); or
    3. ``target`` is in a different ramp and is strictly darker (L_t < L_s).

    ``entries`` overrides the table's contents (used to test deliberately bad tables).
    """
    values = tuple(palette.remap(table) if entries is None else entries)
    if len(values) != len(palette):
        return [RemapViolation(table, -1, -1, f"expected {len(palette)} entries, got {len(values)}")]
    lightness = palette.oklab[:, 0]
    out: list[RemapViolation] = []
    for source, target in enumerate(values):
        if not 0 <= target < len(palette):
            out.append(RemapViolation(table, source, target, "target is not a palette index"))
            continue
        if target == source:
            continue
        l_s, l_t = float(lightness[source]), float(lightness[target])
        shared = set(palette.ramps_of(source)) & set(palette.ramps_of(target))
        if shared:
            if l_t > l_s:
                out.append(
                    RemapViolation(
                        table,
                        source,
                        target,
                        f"same ramp ({', '.join(sorted(shared))}) but lighter (L {l_t:.4f} > {l_s:.4f})",
                    )
                )
        elif not l_t < l_s:
            out.append(
                RemapViolation(
                    table,
                    source,
                    target,
                    f"different ramp but not strictly darker (L {l_t:.4f} >= {l_s:.4f})",
                )
            )
    return out


# ---------------------------------------------------------------------------------------------
# Shared fixture


def _fixture_samples(palette: Palette, seed: int, count: int) -> U8Array:
    """The palette colours in index order, then distinct seeded random colours not in the palette."""
    rng = np.random.Generator(np.random.PCG64(seed))
    seen: set[tuple[int, int, int]] = {(int(r), int(g), int(b)) for r, g, b in palette.rgb}
    samples: list[tuple[int, int, int]] = [(int(r), int(g), int(b)) for r, g, b in palette.rgb]
    while len(samples) < count:
        batch = rng.integers(0, 256, size=(count, 3), dtype=np.uint8)
        for r, g, b in batch:
            key = (int(r), int(g), int(b))
            if key in seen:
                continue
            seen.add(key)
            samples.append(key)
            if len(samples) == count:
                break
    return np.array(samples, dtype=np.uint8)


def fixture_entries(palette: Palette, seed: int = FIXTURE_SEED, count: int = FIXTURE_COUNT) -> list[list[int]]:
    """``[r, g, b, expected_index]`` rows: all 32 palette colours, then seeded random colours."""
    if count < len(palette):
        raise ValueError(f"count must be >= {len(palette)}")
    samples = _fixture_samples(palette, seed, count)
    idx = nearest_indices(samples, palette)
    return [[int(r), int(g), int(b), int(i)] for (r, g, b), i in zip(samples, idx, strict=True)]


def fixture_bytes(palette: Palette, seed: int = FIXTURE_SEED, count: int = FIXTURE_COUNT) -> bytes:
    """The fixture file's exact bytes: UTF-8 JSON, 2-space indent, one entry per line, LF endings.

    The layout is what Biome's formatter produces for this structure, so ``biome check`` leaves
    it alone.
    """
    entries = fixture_entries(palette, seed, count)
    header = {
        "description": (
            "Kerbside-32 nearest-colour parity vectors: [r, g, b, expected_index]. Squared OKLab "
            "distance, lower index wins an exact tie, no dither. The first 32 entries are the palette "
            "colours in index order; the rest are distinct seeded random colours not in the palette. "
            "Generated by the forge; do not edit."
        ),
        "generator": "uv run --project tools/forge python -m forge.palette --write-fixture <path>",
        "palette": "assets-src/palette/kerbside32.json",
        "rng": "numpy.random.Generator(numpy.random.PCG64(seed)).integers(0, 256, size=(count, 3), dtype=uint8)",
        "seed": seed,
        "count": len(entries),
    }
    lines = ["{"]
    for key, value in header.items():
        lines.append(f"  {json.dumps(key)}: {json.dumps(value, ensure_ascii=False)},")
    lines.append('  "entries": [')
    for n, entry in enumerate(entries):
        comma = "," if n < len(entries) - 1 else ""
        lines.append(f"    [{entry[0]}, {entry[1]}, {entry[2]}, {entry[3]}]{comma}")
    lines.append("  ]")
    lines.append("}")
    return ("\n".join(lines) + "\n").encode("utf-8")


def write_fixture(
    path: Path | str,
    palette: Palette | None = None,
    seed: int = FIXTURE_SEED,
    count: int = FIXTURE_COUNT,
) -> Path:
    """Write the fixture to ``path`` (parent directories are created) and return the path."""
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(fixture_bytes(palette or load_palette(), seed, count))
    return out


# ---------------------------------------------------------------------------------------------
# Command line


def main(argv: Sequence[str] | None = None) -> int:
    """``python -m forge.palette``: validate the palette, optionally write the fixture."""
    parser = argparse.ArgumentParser(
        prog="python -m forge.palette",
        description="Validate kerbside32.json and (re)generate the shared OKLab parity fixture.",
    )
    parser.add_argument("--palette", type=Path, default=PALETTE_PATH, help="palette JSON (default: the repo's)")
    parser.add_argument(
        "--write-fixture",
        type=Path,
        metavar="PATH",
        help="write the 4,096-sample fixture here (the committed one is tests/fixtures/palette_oklab_4096.json)",
    )
    args = parser.parse_args(argv)
    try:
        palette = load_palette(args.palette)
    except (OSError, ValueError) as exc:
        print(f"forge.palette: {exc}", file=sys.stderr)
        return 1
    status = 0
    for table in REMAP_TABLES:
        for violation in remap_violations(palette, table):
            print(f"forge.palette: ramp rule: {violation}", file=sys.stderr)
            status = 1
    if args.write_fixture is not None:
        out = write_fixture(args.write_fixture, palette)
        print(f"forge.palette: wrote {FIXTURE_COUNT} entries to {out}")
    return status


if __name__ == "__main__":
    sys.exit(main())
