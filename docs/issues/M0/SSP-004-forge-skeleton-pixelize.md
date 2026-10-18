---
id: SSP-004
title: "Create the forge Python package (uv, CLI skeleton) and import pixelize.py with tests"
milestone: M0
status: done
type: feature
estimate: M
labels: [type:feature, area:tooling, area:assets, area:test, size:M, vertical-slice]
depends_on: []
blocks: [SSP-005, SSP-006, SSP-007, SSP-012, SSP-039, SSP-040, SSP-068, SSP-110, SSP-112]
---

# SSP-004: Create the forge Python package (uv, CLI skeleton) and import pixelize.py with tests

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** feature · **Size:** M · **Areas:** tooling, assets, test · **Vertical slice**

## Summary

Stand up `tools/forge/` as a uv-managed Python 3.13 package with pinned deps. Add a `python -m forge` CLI exposing every documented subcommand, and refactor the probe's pixelize.py into an importable module. pytest pins the FFT period detector to the probe's measured values.

## Context

`tools/forge/pyproject.toml`: `requires-python ==3.13.*`, numpy ==2.5.4, pillow ==13.0.0, pytest ==9.1.1 (dev group). Commit `uv.lock`.
- Python 3.13.15, uv 0.12.23. The venv is `tools/forge/.venv/`.
- Never commit .venv. If SSP-002 has not landed yet, make the same canonical .gitignore change here (the identical six lines).
- Only numpy + Pillow are allowed: no OpenCV, scikit-image, sharp or image-q.
- Randomness only via `numpy.random.Generator(PCG64(seed))`. Type-hint public functions.

CLI `forge/__main__.py` (argparse) with subcommands `build`, `ingest`, `blender`, `gen-ai`, `lint`, `sheets` and `verify` (`npm run assets:verify` calls `forge verify`, ASSET_PIPELINE §5.2). Use the flags in ASSET_PIPELINE §5.3:
- build `[--only <id>...] [--out <dir>] [--no-cache]`
- verify `[--pixels]`
- lint `[--only] [--warn-as-error]`
- sheets `[--atlas] [--only]`
- ingest `<id> [--force] [--dry-run]`
- blender `<id|all> [--check]`
- gen-ai `<id> [--tool] [--candidates N] [--accept <n>] [--ref <path>]`
A global `-v` enables per-step logging. Every subcommand not yet implemented exits non-zero with `not implemented until <issue key>`, never 0.

pixelize import: `assets-src/_probe/tools/pixelize.py` (137 lines) goes to `tools/forge/forge/pixelize.py`.
- The probe file is a script: it reads `sys.argv` at import time (line 14) and builds a median-cut palette (line 122).
- Median cut was REJECTED (ADR 0002 E8); palette mapping belongs to forge/palette.py (SSP-005).
- Keep and turn into pure functions with no import-time side effects:
  - `key_bg`: real alpha >= 128, else key the median border colour with RGB distance > 110;
  - `pixel_period`: FFT of the edge profile; only frequencies between 1/16 and 1/3, i.e. periods 3-16 px;
  - `bbox_crop`;
  - `block_mode_resize`: majority over opaque pixels (alpha >= 128); ties go to the lower palette index once indices exist, and before that use a documented deterministic rule.

pytest expectations (reports/post.report.json and post_rub.report.json; ADR 0002 E2/E5):
- old_woman_sheet.png: period_x 9.22, period_y 9.38;
- rubbish_sheet.png: period_x 10.81, period_y 10.87.
Assert each axis separately against these exact values with a stated tolerance (suggested ±0.02 px; the reports round to 0.01). Do NOT assert 10.8 on both axes with ±0.05: y is 10.87. Tests may read the _probe PNGs directly, since _probe is git-tracked.

## Scope

- tools/forge/pyproject.toml + uv.lock
- forge/__init__.py and forge/__main__.py with all seven subcommands and their documented flags (stubs exit non-zero)
- forge/pixelize.py refactored from the probe (no argv parsing at import, no median cut)
- tools/forge/tests/test_pixelize.py: period on both probe sheets per axis, key_bg on synthetic RGB and RGBA arrays, block-mode on a synthetic array with a known tie
- tools/forge/tests/test_cli.py: every stub exits non-zero with the message

## Out of scope

- palette.py / OKLab mapping (SSP-005)
- Real build/ingest/blender/gen-ai/lint/sheets/verify implementations (later issues)
- npm script wiring (SSP-006)

## Acceptance criteria

- [x] `uv sync --project tools/forge` builds the venv from the committed uv.lock with numpy 2.5.4, Pillow 13.0.0 and pytest 9.1.1
- [x] `uv run --project tools/forge python -m forge --help` lists build, ingest, blender, gen-ai, lint, sheets, verify
- [x] Every unimplemented subcommand exits non-zero and prints 'not implemented until ...'
- [x] pytest asserts period (x, y) = (9.22, 9.38) on old_woman_sheet.png and (10.81, 10.87) on rubbish_sheet.png within the stated tolerance
- [x] `python -c 'import forge.pixelize'` has no side effects: no argv read, no file written, no output
- [x] pyproject.toml declares only numpy and Pillow as runtime dependencies (pytest in dev)

## Verification

- uv sync --project tools/forge
- uv run --project tools/forge pytest
- uv run --project tools/forge python -m forge --help
- uv run --project tools/forge python -m forge lint; echo $? (non-zero until implemented)
- git status --short tools/forge (no .venv listed)

## Dependencies

**Depends on:**

_None._

**Blocks:**

- [SSP-005](SSP-005-kerbside32-palette.md) Author kerbside32.json and forge OKLab palette mapping with a shared 4,096-sample fixture
- [SSP-006](SSP-006-npm-scripts-ci-workflow.md) Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow
- [SSP-007](SSP-007-blender-rig-wrapper.md) Implement assets-src/blender/rig.py and the forge blender wrapper with --check
- [SSP-012](SSP-012-genai-codex-wrapper.md) Implement forge gen-ai Codex wrapper with preamble v1 and a concept.spike_street smoke run
- [SSP-039](../M1/SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end
- [SSP-040](../M1/SSP-040-procedural-tiles.md) Generate placeholder ground tiles and the 47-tile kerb blob set with tiles.py
- [SSP-068](../M2/SSP-068-kerbside5x7-font.md) Draft Kerbside 5×7 glyphs and add the forge font builder and ui atlas
- [SSP-110](../M4/SSP-110-forge-ingest-complete.md) Complete forge ingest: full 10-step pipeline, edit protection, dry-run previews
- [SSP-112](../M4/SSP-112-forge-build-ai-art.md) Add the ai-art build technique: crop, pixelize at detected period, palette map

## References

- ../../ASSET_PIPELINE.md#4-one-time-setup
- ../../ASSET_PIPELINE.md#53-forge-subcommands-full-reference
- ../../ASSET_PIPELINE.md#91-forge-ingest-id-ai-golden--indexed-grid
- ../../adr/0002-ai-authored-asset-pipeline.md#2-evidence-the-asset-probe-2026-10-18
- ../../../CLAUDE.md#52-python-forge
- ../../../assets-src/_probe/README.md

## Roadmap tasks covered

- Copy `assets-src/_probe/tools/pixelize.py` → `tools/forge/forge/pixelize.py`, with pytest coverage of the FFT period detector (expect 9.22/9.38 px on the old-woman sheet, 10.8 px on the rubbish sheet).
- `pyproject.toml` pinning `python ==3.13.*`, `numpy ==2.5.4`, `pillow ==13.0.0`, `pytest ==9.1.1` (dev). Commit `uv.lock`.
- `forge/__main__.py` CLI: `build`, `ingest`, `blender`, `gen-ai`, `lint`, `sheets` (lint and sheets can be minimal for now). [CLI skeleton]
