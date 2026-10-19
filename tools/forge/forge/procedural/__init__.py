"""The ``procedural`` technique: params JSON -> palette-index frames (ASSET_PIPELINE §6.4, §9.2).

A procedural manifest entry's ``source`` is a params file under ``assets-src/procedural/``:

.. code-block:: json

    { "id": "roof.slate", "generator": "roofs.slate", "seed": 4101, "cell": [32, 32],
      "variants": 4, "params": { ... } }

``id`` and ``cell`` must equal the manifest entry's; ``generator`` names an entry of
:data:`GENERATORS`. Two kinds of generator exist:

``variant``
    ``fn(params, rng, cell, variant) -> (h, w) uint8`` (the ASSET_PIPELINE §6.4 shape), used by
    surfaces whose frames are seeded variants (``roofs.*``, ``tiles.*``). Overlays (the road
    markings) return ``int16`` with ``TRANSPARENT`` (-1) for the pixels they leave clear.
    The params file needs an integer ``seed`` and ``variants``; the manifest entry must have the
    single state ``v`` with ``frames.v == variants``. One ``numpy.random.Generator(PCG64(seed))``
    is shared by every variant in order, so variant ``k`` draws after variants ``0..k-1`` and
    appending a variant never changes the earlier ones.
``frames``
    ``fn(params, ctx) -> {local frame id: (h, w) int16}``, used where frames are assembled
    rather than drawn at random (``facades.set``: module grids plus the lit/dark ramp shift;
    ``tiles.kerb_blob``: the 47 kerb tiles ``blob:-:n`` drawn by rule over the pavement).
    No ``seed`` or ``variants``; the generator reports every extra file it reads through
    :meth:`Context.read_dependency` so the build cache can hash it.

Generators are pure: no ``random``, no clock, no unordered iteration, randomness only from the
``rng`` they are given. They return palette indices, never RGB. The generator registry with
params validation is hardened in M4 (SSP-111); this module is the M1 minimum.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import numpy as np
import numpy.typing as npt
from numpy.random import PCG64, Generator

from forge.palette import PALETTE_SIZE, TRANSPARENT, Palette
from forge.procedural import facades, roofs, tiles
from forge.procedural.common import Context, ProceduralError

__all__ = [
    "GENERATORS",
    "Context",
    "GeneratorSpec",
    "ProceduralError",
    "ProceduralOutput",
    "dependencies",
    "load_params",
    "run_procedural",
    "wrap_tile",
]

I16Array = npt.NDArray[np.int16]
U8Array = npt.NDArray[np.uint8]

VARIANT_STATE = "v"
"""The frame state of seeded surface variants (ART_BIBLE §14.4: ``tile.*``, ``roof.*`` -> ``v``)."""


IndexArray = U8Array | I16Array
"""A variant frame: ``uint8`` indices for an opaque surface, or ``int16`` with ``TRANSPARENT`` (-1)
where an overlay (the ``tiles.markings`` road markings) lets the ground below show through."""

VariantFn = Callable[[Mapping[str, object], Generator, tuple[int, int], int], IndexArray]
FramesFn = Callable[[Mapping[str, object], Context], dict[str, I16Array]]
DepsFn = Callable[[Mapping[str, object]], list[str]]


@dataclass(frozen=True)
class GeneratorSpec:
    """One registry entry. ``deps`` lists the repo-relative files a ``frames`` generator reads."""

    kind: Literal["variant", "frames"]
    variant: VariantFn | None = None
    frames: FramesFn | None = None
    deps: DepsFn | None = None


GENERATORS: Mapping[str, GeneratorSpec] = {
    "facades.set": GeneratorSpec("frames", frames=facades.facade_set, deps=facades.set_dependencies),
    "roofs.depot_placeholder": GeneratorSpec("variant", variant=roofs.depot_placeholder),
    "roofs.felt": GeneratorSpec("variant", variant=roofs.felt),
    "roofs.slate": GeneratorSpec("variant", variant=roofs.slate),
    "tiles.apron": GeneratorSpec("variant", variant=tiles.apron),
    "tiles.asphalt": GeneratorSpec("variant", variant=tiles.asphalt),
    "tiles.grass": GeneratorSpec("variant", variant=tiles.grass),
    "tiles.kerb_blob": GeneratorSpec("frames", frames=tiles.kerb_blob, deps=tiles.kerb_dependencies),
    "tiles.markings": GeneratorSpec("variant", variant=tiles.markings),
    "tiles.pavement": GeneratorSpec("variant", variant=tiles.pavement),
    "tiles.setts": GeneratorSpec("variant", variant=tiles.setts),
    "tiles.speed_bump": GeneratorSpec("variant", variant=tiles.speed_bump),
    "tiles.zebra": GeneratorSpec("variant", variant=tiles.zebra),
}
"""Generator name (``<module>.<function>``) -> :class:`GeneratorSpec`, sorted by name."""


@dataclass(frozen=True)
class ProceduralOutput:
    """Frames of one procedural entry (local frame id -> indices) and every file they came from."""

    frames: dict[str, I16Array]
    deps: tuple[Path, ...]


def load_params(path: Path, asset_id: str, cell: tuple[int, int]) -> dict[str, object]:
    """Read and validate the common fields of a params file against its manifest entry."""
    if not path.is_file():
        raise ProceduralError(f"{asset_id}: params file {path} does not exist")
    try:
        data: object = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ProceduralError(f"{asset_id}: {path.name} is not valid JSON: {exc}") from None
    if not isinstance(data, dict):
        raise ProceduralError(f"{asset_id}: {path.name} must be a JSON object")
    if data.get("id") != asset_id:
        raise ProceduralError(f"{asset_id}: {path.name} declares id {data.get('id')!r}")
    c = data.get("cell")
    if not (isinstance(c, list) and len(c) == 2 and all(isinstance(v, int) and not isinstance(v, bool) for v in c)):
        raise ProceduralError(f"{asset_id}: {path.name} cell must be [w, h]")
    if (c[0], c[1]) != cell:
        raise ProceduralError(f"{asset_id}: {path.name} cell {c[0]}x{c[1]} != manifest cell {cell[0]}x{cell[1]}")
    gen = data.get("generator")
    if not isinstance(gen, str) or gen not in GENERATORS:
        raise ProceduralError(f"{asset_id}: unknown generator {gen!r} (known: {', '.join(GENERATORS)})")
    params = data.get("params")
    if not isinstance(params, dict):
        raise ProceduralError(f"{asset_id}: {path.name} params must be an object")
    return data


def _int_field(data: Mapping[str, object], key: str, asset_id: str, minimum: int) -> int:
    v = data.get(key)
    if not isinstance(v, int) or isinstance(v, bool) or v < minimum:
        raise ProceduralError(f"{asset_id}: {key} must be an integer >= {minimum}, got {v!r}")
    return v


def _check_indices(asset_id: str, local: str, arr: npt.NDArray[np.generic], cell: tuple[int, int]) -> I16Array:
    if arr.shape != (cell[1], cell[0]):
        raise ProceduralError(f"{asset_id}:{local}: generator returned {arr.shape[1]}x{arr.shape[0]}, cell is {cell[0]}x{cell[1]}")
    out = np.asarray(arr).astype(np.int16)
    if out.size and (int(out.min()) < TRANSPARENT or int(out.max()) >= PALETTE_SIZE):
        raise ProceduralError(f"{asset_id}:{local}: generator returned indices outside -1..{PALETTE_SIZE - 1}")
    return out


def run_procedural(
    asset_id: str,
    source: Path,
    cell: tuple[int, int],
    repo_root: Path,
    palette: Palette,
) -> ProceduralOutput:
    """Run the generator a params file names; returns its frames (sorted by local id) and deps."""
    data = load_params(source, asset_id, cell)
    spec = GENERATORS[str(data["generator"])]
    params = data["params"]
    assert isinstance(params, dict)
    frames: dict[str, I16Array] = {}
    if spec.kind == "variant":
        assert spec.variant is not None
        seed = _int_field(data, "seed", asset_id, 0)
        variants = _int_field(data, "variants", asset_id, 1)
        rng = Generator(PCG64(seed))
        for k in range(variants):
            local = f"{VARIANT_STATE}:-:{k}"
            frames[local] = _check_indices(asset_id, local, spec.variant(params, rng, cell, k), cell)
        deps: tuple[Path, ...] = (source,)
    else:
        assert spec.frames is not None
        ctx = Context(repo_root=repo_root, palette=palette, asset_id=asset_id, cell=cell)
        out = spec.frames(params, ctx)
        for local in sorted(out):
            frames[local] = _check_indices(asset_id, local, out[local], cell)
        deps = (source, *ctx.deps)
    return ProceduralOutput(frames=dict(sorted(frames.items())), deps=deps)


def dependencies(source: Path, repo_root: Path) -> list[Path]:
    """Every file besides ``source`` that a params file's generator reads (for the cache key).

    A params file that cannot be read yields no extra dependencies; the build reports it.
    """
    try:
        data: object = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return []
    if not isinstance(data, dict):
        return []
    gen = data.get("generator")
    params = data.get("params")
    if not isinstance(gen, str) or gen not in GENERATORS or not isinstance(params, dict):
        return []
    spec = GENERATORS[gen]
    if spec.deps is None:
        return []
    try:
        rels = spec.deps(params)
    except ProceduralError:
        return []
    return [repo_root / r for r in rels]


def wrap_tile(source: Path) -> bool:
    """Whether a procedural params file promises a seamless tile (``params.wrap`` is ``true``).

    ``forge sheets`` draws a 3x3 tiled preview for these (ASSET_PIPELINE §10.8). An unreadable
    file is not a wrap tile; the build reports it.
    """
    try:
        data: object = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        return False
    if not isinstance(data, dict):
        return False
    params = data.get("params")
    return isinstance(params, dict) and params.get("wrap") is True
