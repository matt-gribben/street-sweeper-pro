"""``assets-src/manifest.json``: load, validate and expand to frame IDs (ASSET_PIPELINE §6.1).

The manifest is the list of every asset (CLAUDE.md §2). Each entry has exactly the fields
``{ id, class, technique, source, cell:[w,h], states, dirs, frames, atlas, outline, swaps }``.
This module validates the *shape* of each entry (what the build needs to run) and expands an
entry into its expected frame IDs ``<asset-id>:<state>:<dir>:<n>`` (CLAUDE.md §5.4). Policy
checks that do not stop a build (entries sorted by id, provenance) belong to ``forge lint``;
:func:`unsorted_ids` exposes the sort check for it.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from forge.palette import REPO_ROOT

__all__ = [
    "ASSET_CLASSES",
    "ATLASES",
    "COMPASS_DIRS",
    "MANIFEST_PATH",
    "TECHNIQUES",
    "AssetEntry",
    "ManifestError",
    "entry_from_data",
    "expand_dirs",
    "load_manifest",
    "manifest_from_data",
    "unsorted_ids",
]

MANIFEST_PATH = REPO_ROOT / "assets-src" / "manifest.json"

ASSET_CLASSES = frozenset(
    "veh npc litter stain prop haz pwr collect upg site tile roof facade fx ui font art portrait "
    "decal sign concept ref sfx mus jng amb".split()
)
"""Asset class prefixes (CLAUDE.md §5.4)."""

TECHNIQUES = ("grid", "procedural", "blender", "ai-ingest", "ai-art")
ATLASES = ("world", "actors", "items", "ui", "fx")
COMPASS_DIRS = ("s", "sw", "w", "nw", "n", "ne", "e", "se")
"""Actor directions (CLAUDE.md §5.4), in the canonical authoring order."""

FIELDS = ("id", "class", "technique", "source", "cell", "states", "dirs", "frames", "atlas", "outline", "swaps")

_ID_RE = re.compile(r"^([a-z]+)\.([a-z0-9]+(?:_[a-z0-9]+)*)$")
_STATE_RE = re.compile(r"^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$")
_HEADING_RE = re.compile(r"^h(?:[0-2][0-9]|3[01])$")


class ManifestError(ValueError):
    """The manifest (or one entry) is malformed."""


@dataclass(frozen=True)
class AssetEntry:
    """One validated manifest entry. ``dirs`` is already expanded (e.g. ``h32`` -> h00..h31)."""

    id: str
    asset_class: str
    technique: str
    source: str
    cell: tuple[int, int]
    states: tuple[str, ...]
    dirs_spec: str | tuple[str, ...]
    dirs: tuple[str, ...]
    frames: dict[str, int]
    atlas: str
    outline: bool
    swaps: tuple[str, ...]
    raw: dict[str, object]

    @property
    def width(self) -> int:
        return self.cell[0]

    @property
    def height(self) -> int:
        return self.cell[1]

    def frame_ids(self) -> list[str]:
        """Every expected frame ID, sorted (deterministic build order)."""
        return sorted(
            f"{self.id}:{state}:{d}:{n}" for state in self.states for d in self.dirs for n in range(self.frames[state])
        )

    def local_frame_ids(self) -> list[str]:
        """:meth:`frame_ids` without the ``<asset-id>:`` prefix (``state:dir:n``)."""
        return [fid[len(self.id) + 1 :] for fid in self.frame_ids()]


def expand_dirs(dirs: object, where: str = "dirs") -> tuple[str, ...]:
    """``"h32"`` -> h00..h31, ``"h4"`` -> h00..h03, ``"-"`` -> ("-",), a list -> compass dirs, or a
    list of vehicle headings ``hNN`` (00-31) in increasing order, e.g. ``["h00"]`` for a litter item
    whose only authored rotation is ``h00`` (ENTITY_CATALOG §4; the code-generated h08/h16/h24
    rotations arrive with the litter grids in M2/M4). A list never mixes the two kinds."""
    if dirs == "h32":
        return tuple(f"h{i:02d}" for i in range(32))
    if dirs == "h4":
        return tuple(f"h{i:02d}" for i in range(4))
    if dirs == "-":
        return ("-",)
    if isinstance(dirs, list) and dirs:
        if all(isinstance(d, str) and _HEADING_RE.match(d) for d in dirs):
            if list(dirs) != sorted(set(dirs)):
                raise ManifestError(f"{where}: headings must be unique and in increasing order, got {dirs!r}")
            return tuple(dirs)
        out: list[str] = []
        for d in dirs:
            if d not in COMPASS_DIRS:
                raise ManifestError(f"{where}: {d!r} is not a compass dir {COMPASS_DIRS} (or a list of only hNN headings)")
            if d in out:
                raise ManifestError(f"{where}: duplicate dir {d!r}")
            out.append(d)
        return tuple(out)
    raise ManifestError(
        f'{where}: expected "h32", "h4", "-" or a non-empty list of compass dirs or of hNN headings, got {dirs!r}'
    )


def _str_list(value: object, where: str, *, pattern: re.Pattern[str] | None = None, nonempty: bool) -> tuple[str, ...]:
    if not isinstance(value, list) or (nonempty and not value):
        raise ManifestError(f"{where}: expected a {'non-empty ' if nonempty else ''}list of strings")
    out: list[str] = []
    for v in value:
        if not isinstance(v, str) or (pattern is not None and not pattern.match(v)):
            raise ManifestError(f"{where}: invalid entry {v!r}")
        if v in out:
            raise ManifestError(f"{where}: duplicate {v!r}")
        out.append(v)
    return tuple(out)


def entry_from_data(data: object, index: int = 0) -> AssetEntry:
    """Validate one manifest entry."""
    where = f"assets[{index}]"
    if not isinstance(data, dict):
        raise ManifestError(f"{where}: expected an object")
    if set(data) != set(FIELDS):
        missing = sorted(set(FIELDS) - set(data))
        extra = sorted(set(data) - set(FIELDS))
        raise ManifestError(f"{where}: fields must be exactly {list(FIELDS)} (missing {missing}, unknown {extra})")
    asset_id = data["id"]
    if not isinstance(asset_id, str) or not (m := _ID_RE.match(asset_id)):
        raise ManifestError(f"{where}: id must be <class>.<snake_name>, got {asset_id!r}")
    where = f"{where} ({asset_id})"
    cls = data["class"]
    if cls != m.group(1):
        raise ManifestError(f"{where}: class {cls!r} does not match the id prefix {m.group(1)!r}")
    if cls not in ASSET_CLASSES:
        raise ManifestError(f"{where}: unknown asset class {cls!r}")
    technique = data["technique"]
    if technique not in TECHNIQUES:
        raise ManifestError(f"{where}: technique must be one of {TECHNIQUES}, got {technique!r}")
    source = data["source"]
    if not isinstance(source, str) or not source or source.startswith("/") or ".." in Path(source).parts:
        raise ManifestError(f"{where}: source must be a repo-relative path, got {source!r}")
    cell = data["cell"]
    if (
        not isinstance(cell, list)
        or len(cell) != 2
        or not all(isinstance(v, int) and not isinstance(v, bool) and v > 0 for v in cell)
    ):
        raise ManifestError(f"{where}: cell must be [w, h] with positive integers, got {cell!r}")
    states = _str_list(data["states"], f"{where}.states", pattern=_STATE_RE, nonempty=True)
    dirs_raw = data["dirs"]
    dirs = expand_dirs(dirs_raw, f"{where}.dirs")
    frames_raw = data["frames"]
    if not isinstance(frames_raw, dict) or set(frames_raw) != set(states):
        raise ManifestError(f"{where}.frames: keys must be exactly the states {list(states)}")
    frames: dict[str, int] = {}
    for state in states:
        n = frames_raw[state]
        if not isinstance(n, int) or isinstance(n, bool) or n < 1:
            raise ManifestError(f"{where}.frames.{state}: expected a positive integer, got {n!r}")
        frames[state] = n
    atlas = data["atlas"]
    if atlas not in ATLASES:
        raise ManifestError(f"{where}: atlas must be one of {ATLASES}, got {atlas!r}")
    outline = data["outline"]
    if not isinstance(outline, bool):
        raise ManifestError(f"{where}: outline must be true or false")
    swaps = _str_list(data["swaps"], f"{where}.swaps", pattern=_STATE_RE, nonempty=False)
    return AssetEntry(
        id=asset_id,
        asset_class=cls,
        technique=technique,
        source=source,
        cell=(cell[0], cell[1]),
        states=states,
        dirs_spec=tuple(dirs_raw) if isinstance(dirs_raw, list) else str(dirs_raw),
        dirs=dirs,
        frames=frames,
        atlas=atlas,
        outline=outline,
        swaps=swaps,
        raw=dict(data),
    )


def manifest_from_data(data: object) -> list[AssetEntry]:
    """Validate parsed manifest JSON; returns the entries in file order. IDs must be unique."""
    if not isinstance(data, dict) or set(data) != {"assets"} or not isinstance(data["assets"], list):
        raise ManifestError('manifest: top level must be exactly { "assets": [ ... ] }')
    entries = [entry_from_data(e, i) for i, e in enumerate(data["assets"])]
    seen: set[str] = set()
    for e in entries:
        if e.id in seen:
            raise ManifestError(f"manifest: duplicate id {e.id!r}")
        seen.add(e.id)
    return entries


def load_manifest(path: Path | str = MANIFEST_PATH) -> list[AssetEntry]:
    """Load and validate the manifest (default: the repo's ``assets-src/manifest.json``)."""
    with Path(path).open(encoding="utf-8") as f:
        data: object = json.load(f)
    return manifest_from_data(data)


def unsorted_ids(entries: Sequence[AssetEntry]) -> list[str]:
    """IDs that appear before an ID that sorts lower (empty when the manifest is sorted by id)."""
    return [a.id for a, b in zip(entries, entries[1:], strict=False) if a.id >= b.id]
