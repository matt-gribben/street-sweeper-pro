"""The shared trademark denylist, ``tools/ipDenylist.json`` (CLAUDE.md hard rule 7).

The same file is read by ``tests/unit/ipHygiene.test.ts`` (via ``tests/unit/ipHygieneScan.ts``). This
module is the Python port of that scanner's matcher, following the "matching" rules stated in the
file itself, so the forge and the TypeScript scan agree on what is blocked:

- case-insensitive (ASCII only, like a JavaScript ``/i`` regex without the ``u`` flag);
- each run of non-alphanumerics inside a term matches zero or more non-alphanumerics in the text;
- ``word`` terms must not touch a letter or digit on either side; ``substring`` terms may.

``forge gen-ai`` uses it to refuse a prompt before any subprocess starts (ASSET_PIPELINE §8.2).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DENYLIST_PATH = REPO_ROOT / "tools" / "ipDenylist.json"

MATCH_MODES = ("word", "substring")


class DenylistError(ValueError):
    """``tools/ipDenylist.json`` is malformed."""


@dataclass(frozen=True)
class Term:
    term: str
    match: str
    pattern: re.Pattern[str]


@dataclass(frozen=True)
class Hit:
    term: str
    line: int
    excerpt: str


def compile_term(term: str, match: str) -> Term:
    """Compile one denylist entry exactly as ``compileTerm`` in ``ipHygieneScan.ts`` does."""
    if match not in MATCH_MODES:
        raise DenylistError(f"unknown match mode {match!r} for term {term!r}")
    parts = [re.escape(p) for p in re.split(r"[^a-z0-9]+", term, flags=re.IGNORECASE) if p]
    if not parts:
        raise DenylistError(f"term {term!r} has no letters or digits")
    body = "[^a-z0-9]*".join(parts)
    source = f"(?<![a-z0-9]){body}(?![a-z0-9])" if match == "word" else body
    return Term(term=term, match=match, pattern=re.compile(source, re.IGNORECASE | re.ASCII))


def parse_denylist(data: object) -> tuple[Term, ...]:
    """Validate the parsed JSON and compile every term. Raises :class:`DenylistError`."""
    if not isinstance(data, dict) or data.get("format") != "ssp.ip_denylist" or not isinstance(data.get("terms"), list):
        raise DenylistError('expected { "format": "ssp.ip_denylist", "terms": [...] }')
    terms: list[Term] = []
    for k, entry in enumerate(data["terms"]):
        if not isinstance(entry, dict) or not isinstance(entry.get("term"), str) or entry.get("match") not in MATCH_MODES:
            raise DenylistError(f'terms[{k}] must be {{ "term": "<text>", "match": "word"|"substring" }}')
        terms.append(compile_term(entry["term"], entry["match"]))
    if not terms:
        raise DenylistError("the term list is empty")
    return tuple(terms)


def load_denylist(path: Path | str = DENYLIST_PATH) -> tuple[Term, ...]:
    """Load and compile ``tools/ipDenylist.json``."""
    p = Path(path)
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DenylistError(f"{p}: {exc}") from exc
    return parse_denylist(data)


def find_blocked_terms(text: str, terms: tuple[Term, ...]) -> list[Hit]:
    """Every blocked-term hit in ``text``, in order of appearance (1-based line numbers)."""
    hits: list[tuple[int, Hit]] = []
    for t in terms:
        for m in t.pattern.finditer(text):
            line = text.count("\n", 0, m.start()) + 1
            hits.append((m.start(), Hit(term=t.term, line=line, excerpt=m.group(0))))
    hits.sort(key=lambda h: h[0])
    return [h for _, h in hits]
