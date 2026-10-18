---
id: SSP-013
title: "Prototype forge ingest (steps 1-10) to turn an AI golden into an indexed sprite grid"
milestone: M0
status: todo
type: feature
estimate: L
labels: [type:feature, area:tooling, area:assets, size:L, vertical-slice]
depends_on: [SSP-009, SSP-001]
blocks: [SSP-014, SSP-110]
---

# SSP-013: Prototype forge ingest (steps 1-10) to turn an AI golden into an indexed sprite grid

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** feature · **Size:** L · **Areas:** tooling, assets · **Vertical slice**

## Summary

Implement `forge ingest <id>` well enough to turn `ref.people_style` (the probe old-woman sheet) into one `.sprite.txt` grid. The steps are key/alpha, slice, FFT period, block-mode resample with one factor per sheet, step-down, OKLab palette map, despeckle, binary alpha, and a grid write with provenance headers.

## Context

The 10 steps (ASSET_PIPELINE §9.1):
1. load golden.png;
2. alpha: real alpha thresholded at 128, else key out the median border colour (RGB distance > 110). The old-woman sheet is RGB with a magenta key of about rgb(250,5,249);
3. slice by the ingest.json grid and crop each cell to its bbox;
4. FFT edge-profile pseudo-pixel period, 3-16 px per axis (old woman 9.22/9.38). If a harmonic is picked (e.g. 4.6 or 18.6), set `period_override` in ingest.json, never as a CLI flag;
5. block-mode resample (majority, ties → lower index), ONE factor per sheet, never per-cell height normalisation (E10);
6. step down if larger than the target, using the same per-sheet factor;
7. nearest Kerbside-32 in OKLab, no dither (forge.palette);
8. despeckle: 3x3 majority on opaque pixels;
9. binary alpha;
10. write `assets-src/sprites/<class>/<name>.sprite.txt` with `origin: ai/<asset-id>#cell=<k>` and `ingest_sha256: <hash of frame blocks as first written>`, using the shared forge/sprite.py writer.

Gap in the docs, which this issue resolves. For litter the per-sheet step-down factor is set by `largest_item_px` (14), but §10.4's people ingest.json (`grid`, `target_cell: [24,24]`, `cells`) defines no factor. Fitting to the 24 px cell would leave figures 24 px tall, but they must be ≤ 22 (adult) or 18-19 (elderly), including outline.
- Proposed: reuse `largest_item_px` for people as the tallest figure height in the sheet (e.g. 19 for the elderly old woman, 22 for adults).
- Document it in ASSET_PIPELINE §6.5/§9.1 in the same change.
- Probe natives are 22-27 x 28-34 art px; D-13 expects a step-down of about 0.7x.

Pivot: bottom-centre of the feet at row 22 (ART_BIBLE §7.2, proposed). Align feet to that baseline when placing the stepped-down figure in the cell.

`--dry-run` writes `build/tmp/ingest/<id>/preview.png` at 8x (raw cell | resampled | palette-mapped | final) and touches nothing under assets-src/. Expose the preview as a function gen-ai can reuse for review.png. Refuse to overwrite a grid whose current frame blocks differ from its ingest_sha256 unless `--force` is given (CLAUDE.md hard rule 9).

This issue delivers the code plus pytest on synthetic sheets, and may run `--dry-run` on ref.people_style. Committing and judging the npc grid belongs to SSP-014.

## Scope

- tools/forge/forge/ingest.py implementing steps 1-10, --dry-run, --force
- ingest.json `mode: sheet` support: grid, cells (null = empty), frame, target_cell, largest_item_px (litter and people), period_override
- Reusable 8x preview function
- ASSET_PIPELINE §6.5/§9.1 note on largest_item_px for people
- `npm run assets:ingest` wired to the real implementation
- pytest: a synthetic sheet with a known pseudo-pixel period round-trips to the expected grid; edited-grid refusal; period_override honoured; one factor per sheet; deterministic output

## Out of scope

- ai-art mode (M4)
- Committing/accepting the people grid (SSP-014)
- Litter ingest beyond what D-07 needs (SSP-024)
- Animation authoring

## Acceptance criteria

- [ ] `npm run assets:ingest -- ref.people_style --dry-run` (with a draft ingest.json) writes build/tmp/ingest/ref.people_style/preview.png and `git status --short assets-src` is unchanged
- [ ] A real ingest of a synthetic fixture writes a .sprite.txt whose frames match target_cell, use only default-key characters, and carry origin: and ingest_sha256: headers
- [ ] Re-running ingest over a hand-edited grid exits non-zero without --force
- [ ] Ingesting the same golden twice gives byte-identical grids
- [ ] pytest proves cells on one sheet share a single scale factor (relative sizes are preserved)
- [ ] `uv run --project tools/forge pytest -k ingest` passes

## Verification

- uv run --project tools/forge pytest -k ingest
- npm run assets:ingest -- ref.people_style --dry-run
- Read build/tmp/ingest/ref.people_style/preview.png

## Dependencies

**Depends on:**

- [SSP-009](SSP-009-forge-build-grid-blender.md) Implement forge build for grid and blender techniques with outline and byte-stable PNGs
- [SSP-001](SSP-001-probe-ai-goldens-import.md) Import probe Codex sheets as AI golden candidates with retro-filled meta.json

**Blocks:**

- [SSP-014](SSP-014-people-style-acceptance.md) Accept ref.people_style and ingest the spike pedestrian grid (D-04, D-13)
- [SSP-110](../M4/SSP-110-forge-ingest-complete.md) Complete forge ingest: full 10-step pipeline, edit protection, dry-run previews

## References

- ../../ASSET_PIPELINE.md#91-forge-ingest-id-ai-golden--indexed-grid
- ../../ASSET_PIPELINE.md#62-text-grid-sprite-spritetxt
- ../../ASSET_PIPELINE.md#65-ai-asset-folder-assets-srcaiasset-id
- ../../ASSET_PIPELINE.md#104-human-npc-people-codex--ingest--grid
- ../../ART_BIBLE.md#72-human-proportions-2424-cell
- ../../adr/0002-ai-authored-asset-pipeline.md#36-grids-are-the-truth-after-ingest

## Roadmap tasks covered

- `forge/ingest.py` prototype: steps 1–10 of the ingest spec, enough to turn `ref.people_style` into one grid.
