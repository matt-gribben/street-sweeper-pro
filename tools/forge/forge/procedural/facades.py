"""Facade sets: module grids assembled into wall frames, plus the forge-derived ``lit``/``dark`` ramps.

ART_BIBLE §9.4, ASSET_PIPELINE §10.9. A **module** is a 32x40 px text grid (2 m x 1 storey) in
``assets-src/sprites/facade/<name>.sprite.txt`` with id ``facade.<name>`` and the single frame
``base:-:0``, drawn in base ramp values only. Modules are source grids, not manifest assets: the
manifest lists **sets** (the ``facade.*`` IDs a ``level.json`` building names as its ``wall``),
whose params file (``assets-src/procedural/facades/<set>.json``) says how modules tile a wall:

.. code-block:: json

    { "id": "facade.terrace_brick", "generator": "facades.set", "cell": [64, 80],
      "params": {
        "upper":  [["window_sash"], ["window_sash", "drainpipe"]],
        "ground": [["door_terrace"], ["window_sash", "drainpipe"]],
        "recolour": { "13": 22 } } }

**Frame layout (the cityMesh contract).** Every set has exactly the frames ``lit:-:0``,
``base:-:0`` and ``dark:-:0``, each one **bay**: ``B`` modules wide and two storeys tall, so the
cell is ``[32 * B, 80]`` (``B`` = the number of slots per row, 1-4). The top 40 rows are the
``upper`` storey, the bottom 40 rows the ``ground`` storey. A wall maps it with world-metre UVs:
``u`` (metres along the wall, left to right seen from outside) repeats every ``2 * B`` m, the
ground storey (0-2.5 m) samples the bottom half, and every higher storey samples the top half,
repeating every 2.5 m. N and W walls use ``lit``, E and S walls ``dark``; ``base`` is the
authored values (ART_BIBLE §9.4, TECHNICAL_DESIGN §12.4).

A **slot** is a list of module names composited bottom first: the first module must be fully
opaque (the wall), later ones are overlays whose ``.`` pixels let the layers below show
(the drainpipe). The assembled bay must be fully opaque. ``recolour`` (optional) maps palette
indices before the ramp shift, so one module set serves several sets (a green fascia instead of
a brown one); its targets must still be base values.

**Ramp shift (ART_BIBLE §5.4).** ``lit`` moves every index one step toward the light along its
ramp, ``dark`` one step away, clamped at the ramp ends. An index's ramp is the first ramp of
``kerbside32.json`` that contains it (so 08-12 shift along brick/skin and 13 umber along the skin
tones), with members ordered by OKLab L, because ramp lists are written in either direction.
Special cases:

- ink (00) never shifts: it is outline and crevice, never a shading step;
- glass (25 navy, 27 sky) never shifts; on ``lit`` only, each 4-connected glass pane gains a
  28 spray glint: a 3 px diagonal streak one pixel in from the pane's top-left corner, or the
  pane's first pixel when the pane is smaller than 5x5;
- the ``accents`` pair (20, 29) is not a light ramp, so accents never shift.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

import numpy as np
import numpy.typing as npt

from forge.palette import PALETTE_SIZE, TRANSPARENT, Palette
from forge.procedural.common import Context, ProceduralError
from forge.sprite import SpriteError, read_sprite, render_frames

__all__ = [
    "GLASS",
    "GLINT",
    "INK",
    "MODULE_CELL",
    "MODULE_DIR",
    "MODULE_FRAME",
    "NON_LIGHT_RAMPS",
    "ROWS",
    "STATES",
    "derive_variants",
    "facade_set",
    "glass_panes",
    "glint_mask",
    "module_path",
    "ramp_of",
    "ramp_shift_table",
    "set_dependencies",
]

I16Array = npt.NDArray[np.int16]
BoolArray = npt.NDArray[np.bool_]

MODULE_DIR = "assets-src/sprites/facade"
"""Where module grids live (ASSET_PIPELINE §3)."""

MODULE_CELL = (32, 40)
"""A module is 32x40 px: 2 m wide, one 2.5 m storey tall (ART_BIBLE §9.4)."""

MODULE_FRAME = "base:-:0"
"""The one frame of a module grid: authored at base ramp values."""

STATES = ("lit", "base", "dark")
"""Facade frame states (ART_BIBLE §14.4): lit for N/W faces, dark for E/S faces."""

ROWS = ("upper", "ground")
"""Storey rows of a bay frame, top to bottom."""

MAX_BAY_MODULES = 4

INK = 0
GLASS = (25, 27)
GLINT = 28
NON_LIGHT_RAMPS = frozenset({"accents"})
"""Ramps in ``kerbside32.json`` that group colours without being light steps (never shifted)."""

LIT_STEP = 1
DARK_STEP = -1


# ---------------------------------------------------------------------------------------------
# Ramp shift


def ramp_of(palette: Palette, index: int) -> tuple[int, ...] | None:
    """The light ramp ``index`` shifts along, lightest last (OKLab L ascending), or ``None``.

    The ramp is the first one in ``kerbside32.json`` order containing ``index``, skipping
    :data:`NON_LIGHT_RAMPS`. Ties in L (none in Kerbside-32) fall back to index order.
    """
    for name, members in palette.ramps.items():
        if name in NON_LIGHT_RAMPS or index not in members:
            continue
        return tuple(sorted(members, key=lambda i: (float(palette.oklab[i][0]), i)))
    return None


def ramp_shift_table(palette: Palette, step: int) -> tuple[int, ...]:
    """Index -> index after moving ``step`` ramp steps (+1 lighter, -1 darker), clamped.

    Ink and glass map to themselves (their special rules live in :func:`derive_variants`).
    """
    table: list[int] = []
    for i in range(PALETTE_SIZE):
        ramp = ramp_of(palette, i)
        if i == INK or i in GLASS or ramp is None:
            table.append(i)
            continue
        pos = min(max(ramp.index(i) + step, 0), len(ramp) - 1)
        table.append(ramp[pos])
    return tuple(table)


def glass_panes(glass: BoolArray) -> list[list[tuple[int, int]]]:
    """4-connected components of ``glass``, in raster order of their first pixel."""
    h, w = glass.shape
    seen = np.zeros_like(glass)
    panes: list[list[tuple[int, int]]] = []
    for y in range(h):
        for x in range(w):
            if not glass[y, x] or seen[y, x]:
                continue
            pane: list[tuple[int, int]] = []
            stack = [(y, x)]
            seen[y, x] = True
            while stack:
                cy, cx = stack.pop()
                pane.append((cy, cx))
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < h and 0 <= nx < w and glass[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = True
                        stack.append((ny, nx))
            panes.append(sorted(pane))
    return panes


def glint_mask(base: I16Array) -> BoolArray:
    """The glass pixels that become 28 on ``lit``: one NW glint per 4-connected pane."""
    glass = np.isin(base, GLASS)
    mask = np.zeros(base.shape, dtype=np.bool_)
    for pane in glass_panes(glass):
        ys = [p[0] for p in pane]
        xs = [p[1] for p in pane]
        y0, x0 = min(ys), min(xs)
        members = set(pane)
        streak = [(y0 + 1, x0 + 3), (y0 + 2, x0 + 2), (y0 + 3, x0 + 1)]
        if max(ys) - y0 + 1 >= 5 and max(xs) - x0 + 1 >= 5 and all(p in members for p in streak):
            for p in streak:
                mask[p] = True
        else:
            mask[pane[0]] = True
    return mask


def derive_variants(base: I16Array, palette: Palette) -> dict[str, I16Array]:
    """``{lit, base, dark}`` from a base-ramp frame by the ART_BIBLE §9.4 ramp shift."""
    if (base == TRANSPARENT).any():
        raise ProceduralError("facade frames must be fully opaque before the ramp shift")
    lit_t = np.array(ramp_shift_table(palette, LIT_STEP), dtype=np.int16)
    dark_t = np.array(ramp_shift_table(palette, DARK_STEP), dtype=np.int16)
    lit = lit_t[base]
    lit[glint_mask(base)] = GLINT
    return {"lit": lit, "base": base.copy(), "dark": dark_t[base]}


# ---------------------------------------------------------------------------------------------
# Set assembly


def module_path(name: str) -> str:
    """Repo-relative path of module ``name``'s grid."""
    return f"{MODULE_DIR}/{name}.sprite.txt"


def _slots(params: Mapping[str, object], row: str) -> list[list[str]]:
    raw = params.get(row)
    if not isinstance(raw, list) or not raw:
        raise ProceduralError(f"params.{row} must be a non-empty list of slots")
    slots: list[list[str]] = []
    for i, slot in enumerate(raw):
        names = [slot] if isinstance(slot, str) else slot
        if not isinstance(names, list) or not names or not all(isinstance(n, str) and n for n in names):
            raise ProceduralError(f"params.{row}[{i}] must be a module name or a non-empty list of names")
        for n in names:
            if "/" in n or "." in n:
                raise ProceduralError(f"params.{row}[{i}]: module name {n!r} must be a bare snake_case name")
        slots.append(list(names))
    return slots


def set_dependencies(params: Mapping[str, object]) -> list[str]:
    """Every module grid a set reads, sorted and unique (repo-relative paths)."""
    names = sorted({n for row in ROWS for slot in _slots(params, row) for n in slot})
    return [module_path(n) for n in names]


def _recolour(params: Mapping[str, object]) -> npt.NDArray[np.int16]:
    table = np.arange(PALETTE_SIZE, dtype=np.int16)
    raw = params.get("recolour", {})
    if not isinstance(raw, dict):
        raise ProceduralError("params.recolour must be an object of index -> index")
    for k in sorted(raw):
        v = raw[k]
        if not (isinstance(k, str) and k.isdigit() and 0 <= int(k) < PALETTE_SIZE):
            raise ProceduralError(f"params.recolour: key {k!r} is not a palette index 0-{PALETTE_SIZE - 1}")
        if not isinstance(v, int) or isinstance(v, bool) or not 0 <= v < PALETTE_SIZE:
            raise ProceduralError(f"params.recolour[{k}]: {v!r} is not a palette index 0-{PALETTE_SIZE - 1}")
        table[int(k)] = v
    return table


def _load_module(ctx: Context, name: str, cache: dict[str, I16Array]) -> I16Array:
    if name in cache:
        return cache[name]
    rel = module_path(name)
    path = ctx.read_dependency(rel)
    if not path.is_file():
        raise ProceduralError(f"{ctx.asset_id}: module grid {rel} does not exist")
    try:
        grid = read_sprite(path)
        frames = render_frames(grid)
    except SpriteError as exc:
        raise ProceduralError(f"{ctx.asset_id}: {exc}") from None
    if grid.id != f"facade.{name}":
        raise ProceduralError(f"{ctx.asset_id}: {rel} declares id {grid.id!r}, expected 'facade.{name}'")
    if grid.cell != MODULE_CELL:
        raise ProceduralError(f"{ctx.asset_id}: {rel} cell is {grid.width}x{grid.height}, modules are 32x40")
    if list(frames) != [MODULE_FRAME]:
        raise ProceduralError(f"{ctx.asset_id}: {rel} must hold exactly the frame {MODULE_FRAME}, got {list(frames)}")
    cache[name] = frames[MODULE_FRAME]
    return cache[name]


def _compose_slot(ctx: Context, names: Sequence[str], cache: dict[str, I16Array], where: str) -> I16Array:
    out = _load_module(ctx, names[0], cache).copy()
    if (out == TRANSPARENT).any():
        raise ProceduralError(f"{ctx.asset_id}: {where}: the bottom module {names[0]!r} must be fully opaque")
    for name in names[1:]:
        layer = _load_module(ctx, name, cache)
        out = np.where(layer == TRANSPARENT, out, layer).astype(np.int16)
    return out


def facade_set(params: Mapping[str, object], ctx: Context) -> dict[str, I16Array]:
    """Assemble one bay (upper storey over ground storey) and derive ``lit``/``base``/``dark``."""
    rows = {row: _slots(params, row) for row in ROWS}
    bay = len(rows["upper"])
    if len(rows["ground"]) != bay:
        raise ProceduralError(f"{ctx.asset_id}: upper has {bay} slots, ground has {len(rows['ground'])}")
    if not 1 <= bay <= MAX_BAY_MODULES:
        raise ProceduralError(f"{ctx.asset_id}: a bay is 1-{MAX_BAY_MODULES} modules wide, got {bay}")
    mw, mh = MODULE_CELL
    want = (mw * bay, mh * len(ROWS))
    if ctx.cell != want:
        raise ProceduralError(
            f"{ctx.asset_id}: a {bay}-module bay is {want[0]}x{want[1]}, but the cell is {ctx.cell[0]}x{ctx.cell[1]}"
        )
    unknown = sorted(set(params) - {*ROWS, "recolour"})
    if unknown:
        raise ProceduralError(f"{ctx.asset_id}: unknown params {unknown}")
    cache: dict[str, I16Array] = {}
    base = np.full((want[1], want[0]), TRANSPARENT, dtype=np.int16)
    for r, row in enumerate(ROWS):
        for s, names in enumerate(rows[row]):
            base[r * mh : (r + 1) * mh, s * mw : (s + 1) * mw] = _compose_slot(ctx, names, cache, f"{row}[{s}]")
    base = _recolour(params)[base]
    variants = derive_variants(base, ctx.palette)
    return {f"{state}:-:0": variants[state] for state in STATES}
