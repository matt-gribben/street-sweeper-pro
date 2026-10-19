"""Types shared by the procedural generators and the technique driver (:mod:`forge.procedural`)."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from forge.palette import Palette

__all__ = ["Context", "ProceduralError"]


class ProceduralError(ValueError):
    """A params file or generator cannot produce correct frames."""


@dataclass
class Context:
    """What a ``frames`` generator may use: the repo root, the palette and a dependency log."""

    repo_root: Path
    palette: Palette
    asset_id: str
    cell: tuple[int, int]
    deps: list[Path] = field(default_factory=list)

    def read_dependency(self, rel: str) -> Path:
        """Resolve a repo-relative source the generator reads, and record it for the cache key."""
        p = Path(rel)
        if p.is_absolute() or ".." in p.parts:
            raise ProceduralError(f"{self.asset_id}: dependency {rel!r} must be a repo-relative path")
        path = self.repo_root / p
        if path not in self.deps:
            self.deps.append(path)
        return path
