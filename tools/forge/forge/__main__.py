"""``python -m forge``: the forge command line (ASSET_PIPELINE §5.3).

Every subcommand and flag in the §5.3 reference is accepted now. A subcommand whose
implementation has not landed yet exits with :data:`EXIT_NOT_IMPLEMENTED` and prints
``forge <cmd>: not implemented until <issue key>`` to stderr. It never exits 0.
"""

from __future__ import annotations

import argparse
import logging
import sys
from collections.abc import Callable, Sequence

from forge import __version__

EXIT_NOT_IMPLEMENTED = 3
"""Exit status of a subcommand that is not implemented yet (argparse usage errors use 2)."""

ATLASES = ("world", "actors", "items", "ui", "fx")
GENAI_TOOLS = ("codex", "cursor")

NOT_IMPLEMENTED_UNTIL: dict[str, str] = {
    "gen-ai": "SSP-012",
    "lint": "SSP-011",
    "sheets": "SSP-011",
    "verify": "SSP-010",
}
"""Issue that delivers each subcommand. Remove an entry when its real handler lands."""

log = logging.getLogger("forge")

Handler = Callable[[argparse.Namespace], int]


def _not_implemented(args: argparse.Namespace) -> int:
    cmd: str = args.command
    issue = NOT_IMPLEMENTED_UNTIL[cmd]
    log.debug("forge %s: arguments %s", cmd, _describe(args))
    print(f"forge {cmd}: not implemented until {issue}", file=sys.stderr)
    return EXIT_NOT_IMPLEMENTED


def _describe(args: argparse.Namespace) -> dict[str, object]:
    return {k: v for k, v in sorted(vars(args).items()) if k not in ("handler", "verbose", "usage_error")}


def _blender(args: argparse.Namespace) -> int:
    """``forge blender <id|all> [--check]`` or ``forge blender --version`` (SSP-007)."""
    if args.blender_version:
        if args.id is not None or args.check:
            args.usage_error("--version takes no asset ID and no --check")
    elif args.id is None:
        args.usage_error("the following arguments are required: id|all")
    from forge import blender  # deferred so other subcommands never import it

    return blender.cli(args)


def _build(args: argparse.Namespace) -> int:
    """``forge build [--only <id>...] [--out <dir>] [--no-cache]`` (SSP-009)."""
    from forge import build  # deferred so other subcommands never import it

    return build.cli(args)


def _ingest(args: argparse.Namespace) -> int:
    """``forge ingest <id> [--force] [--dry-run]`` (SSP-013)."""
    from forge import ingest  # deferred so other subcommands never import it

    return ingest.cli(args)


def _positive_int(text: str) -> int:
    try:
        value = int(text)
    except ValueError:
        raise argparse.ArgumentTypeError(f"expected an integer, got {text!r}") from None
    if value < 1:
        raise argparse.ArgumentTypeError(f"expected an integer >= 1, got {value}")
    return value


def _add_only(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--only",
        nargs="+",
        action="extend",
        metavar="ID",
        help="restrict to these asset IDs (repeatable)",
    )


def build_parser() -> argparse.ArgumentParser:
    """The full ``forge`` argument parser (ASSET_PIPELINE §5.3)."""
    # -v is accepted both before and after the subcommand. The subcommand copy uses
    # SUPPRESS as its default so it never resets a -v given before the subcommand.
    verbose_parent = argparse.ArgumentParser(add_help=False)
    verbose_parent.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        default=argparse.SUPPRESS,
        help="per-step logging",
    )

    parser = argparse.ArgumentParser(
        prog="forge",
        description="Street Sweeper Pro deterministic asset forge.",
    )
    parser.add_argument("-v", "--verbose", action="store_true", default=False, help="per-step logging")
    parser.add_argument("--version", action="version", version=f"forge {__version__}")
    sub = parser.add_subparsers(dest="command", metavar="<command>", required=True)

    def add(name: str, help_text: str, handler: Handler = _not_implemented) -> argparse.ArgumentParser:
        p = sub.add_parser(name, help=help_text, description=help_text, parents=[verbose_parent])
        p.set_defaults(handler=handler)
        return p

    p = add("build", "Build public/assets/** and src/gen/assets.ts from assets-src/ (pure).", _build)
    _add_only(p)
    p.add_argument(
        "--out",
        metavar="DIR",
        help="output root; frames go to <out>/frames/<id>/ (default: build/.forge-cache/)",
    )
    p.add_argument("--no-cache", action="store_true", help="neither read nor write build/.forge-cache/entries/")

    p = add("ingest", "AI golden -> indexed text grid (assets-src/sprites/).", _ingest)
    p.add_argument("id", help="asset ID")
    p.add_argument("--force", action="store_true", help="overwrite an edited grid (discards the edits)")
    p.add_argument("--dry-run", action="store_true", help="write previews to build/tmp/ingest/<id>/ only")

    p = add("blender", "Re-render Blender goldens (local only).", _blender)
    p.add_argument("id", metavar="id|all", nargs="?", help="asset ID, or 'all'")
    p.add_argument("--check", action="store_true", help="report pixel diffs against committed renders")
    p.add_argument(
        "--version",
        dest="blender_version",
        action="store_true",
        help="print the Blender version (must be 5.2.2 LTS) and exit",
    )
    p.set_defaults(usage_error=p.error)

    p = add("gen-ai", "Generate AI golden candidates (local only, never CI).")
    p.add_argument("id", help="asset ID")
    p.add_argument("--tool", choices=GENAI_TOOLS, default="codex", help="image tool (default: codex)")
    p.add_argument("--candidates", type=_positive_int, metavar="N", help="number of candidates")
    p.add_argument("--accept", type=_positive_int, metavar="n", help="promote candidate n to golden.png")
    p.add_argument(
        "--ref",
        action="append",
        metavar="PATH",
        help="reference image (repeatable; default: what prompt.md declares)",
    )

    p = add("lint", "Check palette, shape, outline, provenance and manifest rules.")
    _add_only(p)
    p.add_argument("--warn-as-error", action="store_true", help="treat warnings as errors")

    p = add("sheets", "Write contact sheets to build/sheets/.")
    p.add_argument("--atlas", choices=ATLASES, help="one atlas only")
    _add_only(p)

    p = add("verify", "Rebuild to build/tmp/verify/ and compare with committed outputs.")
    p.add_argument("--pixels", action="store_true", help="compare decoded RGBA instead of PNG bytes")

    return parser


def main(argv: Sequence[str] | None = None) -> int:
    """Parse ``argv`` (default ``sys.argv[1:]``), run the subcommand, return its exit status."""
    args = build_parser().parse_args(argv)
    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.WARNING,
        format="forge: %(message)s",
        stream=sys.stderr,
        force=True,
    )
    handler: Handler = args.handler
    return handler(args)


if __name__ == "__main__":
    sys.exit(main())
