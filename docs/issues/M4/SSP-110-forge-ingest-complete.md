---
id: SSP-110
title: "Complete forge ingest: full 10-step pipeline, edit protection, dry-run previews"
milestone: M4
status: todo
type: feature
estimate: L
labels: [type:feature, area:tooling, area:assets, area:test, size:L, vertical-slice]
depends_on: [SSP-013, SSP-004, SSP-005, SSP-012, SSP-001]
blocks: [SSP-117, SSP-133, SSP-139, SSP-150, SSP-151, SSP-220, SSP-221, SSP-223, SSP-227, SSP-228]
---

# SSP-110: Complete forge ingest: full 10-step pipeline, edit protection, dry-run previews

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** feature · **Size:** L · **Areas:** tooling, assets, test · **Vertical slice**

## Summary

Take the M0 `forge ingest` prototype to the full 10-step golden-to-grid pipeline in ASSET_PIPELINE §9.1. That means one scale factor per sheet, refusing to overwrite edited grids, and the 8x dry-run preview that gen-ai review sheets reuse. Every Codex-ingested class (people, litter, decals, signs) depends on this.

## Context

Steps (ASSET_PIPELINE §9.1): (1) load golden.png; (2) alpha: use real alpha thresholded at 128, else key out the median border colour (RGB distance > 110); (3) slice by the ingest.json grid and crop each cell to its bbox; (4) FFT edge profile -> pseudo-pixel period, 3-16 px per axis. Measured so far: Codex characters 9.22/9.38 px, rubbish sheet 10.8 px. A harmonic such as 4.6 or 18.6 px means setting `period_override` in ingest.json, never a CLI flag. (5) Block-mode resample, majority vote, ties -> lower palette index, ONE factor per sheet. (6) Step down if larger than the target cell, using the same per-sheet factor (litter: factor chosen so the largest item = `largest_item_px`, 14). (7) Nearest Kerbside-32 colour in OKLab, no dither. (8) Despeckle: 3x3 majority on opaque pixels. (9) Binary alpha. (10) Write `assets-src/sprites/<class>/<name>.sprite.txt` with `origin: ai/<asset-id>#cell=<k>` and `ingest_sha256: <hex>` headers. Never normalise height per cell. Sheet-mode ingest.json (§6.5): `{mode:'sheet', grid:[4,2], cells:[asset ids or null], frame:'idle:h00:0', target_cell:[16,16], largest_item_px:14, period_override:null}`. For people (§10.4) the cells map to frames of ONE asset (e.g. `npc.postie` `idle:s:0` ... `walk:n:0`, grid [5,2], target_cell [24,24]) while the provenance folder is `char.postie`. The docs do not say how ingest.json names the target asset, so define it (e.g. an `asset` field, or full frame IDs in `cells`) and document it in §6.5. `char` is not in the CLAUDE.md §5.4 class list, so it stays a provenance-only folder prefix and never becomes a manifest ID. `ingest_sha256` is the hash of the frame blocks as first written. If the current content differs, the grid counts as edited, and ingest exits non-zero with `ingest: grid edited, refusing to overwrite` unless `--force` is given (§13.4). The docs leave open what happens to an existing grid with NO `ingest_sha256` (an M1-M3 placeholder). Define it: overwrite only when its manifest entry has `placeholder: true`, otherwise refuse. Document this in §6.2. `--dry-run` writes `build/tmp/ingest/<id>/preview.png` at 8x (raw cell | resampled | palette-mapped | final) and touches nothing in assets-src/. `forge gen-ai` must run the same preview for every candidate and write `build/ai-candidates/<id>/review.png` (raw image downsized, plus the ingest preview at final cell size at 4x and 8x, on light #c3c1c0 and dark #24222a; §11.1). Probe fixtures: `assets-src/_probe/codex4/rubbish_sheet.png` and `assets-src/_probe/codex/old_woman_sheet.png` (git-tracked; excluded from manifest and lint). Python rules (CLAUDE.md §5.2): numpy + Pillow only, PNGs written with no metadata, `Generator(PCG64(seed))` for any randomness.

## Scope

- Implement all 10 steps in `tools/forge/forge/ingest.py`, reusing `pixelize.py` (FFT period) and `palette.py` (OKLab mapping)
- Multi-asset sheets (litter, decals): one grid per non-null cell. Single-asset sheets (people): all cells written as named frames into one grid
- Target-asset field for single-asset sheets, documented in ASSET_PIPELINE §6.5
- `ingest_sha256` computation, edited-grid detection, placeholder-grid rule, `--force` and `--dry-run`
- Honour `period_override` from ingest.json only
- Wire the per-candidate ingest preview into `forge gen-ai` so it writes `review.png`
- pytest `tools/forge/tests/test_ingest.py` with fixtures for each step

## Out of scope

- Generating any production golden (done in the class issues)
- The `ai-art` build path (SSP-112)
- Cursor wrapper (`--tool cursor` stays not-implemented)

## Acceptance criteria

- [ ] pytest: ingesting `assets-src/_probe/codex4/rubbish_sheet.png` detects a period within 10.8 +/- 0.2 px; `assets-src/_probe/codex/old_woman_sheet.png` detects per-axis periods within +/- 0.2 px of 9.22 / 9.38 px
- [ ] Running ingest twice on the same golden produces byte-identical .sprite.txt files
- [ ] After one pixel of an ingested grid is hand-edited, re-ingest exits non-zero with `ingest: grid edited, refusing to overwrite`; with `--force` it overwrites
- [ ] A grid with no `ingest_sha256` is overwritten only when its manifest entry has `placeholder: true` (pytest covers both cases)
- [ ] `--dry-run` writes `build/tmp/ingest/<id>/preview.png` and `git status --short assets-src/` stays empty
- [ ] Every output pixel is a Kerbside-32 index and alpha is binary
- [ ] pytest: a sheet whose cells differ in size is scaled by one shared factor (no per-cell normalisation)
- [ ] `forge gen-ai <id> --candidates N` with a mocked Codex writes `review.png` containing every candidate's ingest preview
- [ ] pytest has at least one test per pipeline step (10 steps)

## Verification

- uv run --project tools/forge pytest tools/forge/tests/test_ingest.py
- uv run --project tools/forge python -m forge ingest <test-id> --dry-run -v, then Read build/tmp/ingest/<test-id>/preview.png
- npm run assets:verify (must still pass: no committed outputs change)

## Dependencies

**Depends on:**

- [SSP-013](../M0/SSP-013-ingest-prototype.md) Prototype forge ingest (steps 1-10) to turn an AI golden into an indexed sprite grid
- [SSP-004](../M0/SSP-004-forge-skeleton-pixelize.md) Create the forge Python package (uv, CLI skeleton) and import pixelize.py with tests
- [SSP-005](../M0/SSP-005-kerbside32-palette.md) Author kerbside32.json and forge OKLab palette mapping with a shared 4,096-sample fixture
- [SSP-012](../M0/SSP-012-genai-codex-wrapper.md) Implement forge gen-ai Codex wrapper with preamble v1 and a concept.spike_street smoke run
- [SSP-001](../M0/SSP-001-probe-ai-goldens-import.md) Import probe Codex sheets as AI golden candidates with retro-filled meta.json

**Blocks:**

- [SSP-117](SSP-117-forge-verify-ci.md) Extend forge verify to level and M4 outputs, prove assets idempotence, fill forge pytest gaps and add verify + lint to CI
- [SSP-133](SSP-133-char-doris-pilot.md) Pilot the people pipeline end to end with npc.old_woman (Doris)
- [SSP-139](SSP-139-litter-sheet-01.md) Accept litter.sheet_01, ingest 6 items, hand-draw the can and butts
- [SSP-150](SSP-150-shop-signs.md) High Street shop signs: Codex blank boards plus Kerbside lettering
- [SSP-151](SSP-151-road-decals.md) Road decals for High Street: oil, posters and graffiti via Codex ingest
- [SSP-220](../M6/SSP-220-art-humans-batch-a.md) Art Pass 2: final sprites for npc.jogger, npc.kid_skateboard and npc.kid_chalk
- [SSP-221](../M6/SSP-221-art-humans-batch-b.md) Art Pass 2: final sprites for npc.lollipop_lady, npc.reveller and npc.inspector
- [SSP-223](../M6/SSP-223-art-litter-m6.md) Art Pass 2: final litter sprites for kebab wrapper, leaf pile and lolly stick
- [SSP-227](../M6/SSP-227-art-signs-decals-m6.md) Art Pass 2: shop signs and road decals for the Wed-Sun districts
- [SSP-228](../M6/SSP-228-art-landmark-roofs.md) Art Pass 2: landmark roofs for the Town Hall, Pier and Depot via Codex goldens

## References

- ../../ASSET_PIPELINE.md#91-forge-ingest-id-ai-golden--indexed-grid
- ../../ASSET_PIPELINE.md#65-ai-asset-folder-assets-srcaiasset-id
- ../../ASSET_PIPELINE.md#62-text-grid-sprite-spritetxt
- ../../ASSET_PIPELINE.md#104-human-npc-people-codex--ingest--grid
- ../../ASSET_PIPELINE.md#111-candidate-review-ai
- ../../ASSET_PIPELINE.md#134-ingest-and-build
- ../../ROADMAP.md#m4-art-pass-1

## Roadmap tasks covered

- `forge ingest`: full 10-step pipeline, one scale factor per sheet, refusal to overwrite an edited grid without `--force`.
