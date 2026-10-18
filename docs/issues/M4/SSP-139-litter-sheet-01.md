---
id: SSP-139
title: "Accept litter.sheet_01, ingest 6 items, hand-draw the can and butts"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, size:M, vertical-slice]
depends_on: [SSP-110, SSP-115, SSP-116, SSP-118, SSP-001, SSP-051, SSP-067]
blocks: [SSP-140, SSP-158, SSP-223]
---

# SSP-139: Accept litter.sheet_01, ingest 6 items, hand-draw the can and butts

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets · **Vertical slice**

## Summary

Accept (or regenerate) the probe rubbish sheet as `litter.sheet_01` and ingest it at one scale factor. Hand-draw the illegible drink can, ship the cigarette butts as a cluster sprite, and author wobble frames. Together with sheet_02's plastic bottle, this covers every litter item Puddle Lane spawns.

## Context

Sheet_01 holds 8 items in reading order: drink can, banana skin, glass bottle, newspaper, crisp packet, bin bag, dog mess, cigarette butts (ASSET_PIPELINE §6.5). M0 imported the probe candidate to `assets-src/ai/litter.sheet_01/golden.png` with a retro-filled meta.json (`tool_version: 'codex-cli 0.160.1'`, `seed: null`, acceptance_notes 'Imported from asset probe (M0)'); probe period 10.8 px. Review per §11.1 and replace the import note with real acceptance_notes. If it fails, regenerate with Codex (4 candidates, ~4 min). ingest.json: `mode 'sheet'`, `grid [4,2]`, `target_cell [16,16]`, `largest_item_px 14`, `frame 'idle:h00:0'`. Map the can and butts cells to `null`, because `litter.drink_can` and `litter.cigarette_butts` are manifest technique `grid` (ENTITY_CATALOG §4.1): the can is redrawn from scratch, and the butts are a cluster of 3-5 butts in 07 with 17 filter tips. The scale factor is still computed over all items so that relative sizes hold. Litter spec (ENTITY_CATALOG §4, ART_BIBLE §8.4): 16x16 cell, visible 8-14 px; `idle x1` + `wobble x2` at h00 only; the forge generates the h08/h16/h24 rotations = 12 frame IDs per item. Top-lit, rotation-symmetric shading only (outline + base + one centred highlight; lint enforces this). Silhouettes: drink can = capsule with silver ends; glass bottle = 22/21 green with a neck; newspaper = 07/06 folded rectangle with 03 text lines; banana skin = 16/15 star with 08 tips; crisp packet 9-10 px. Wobble moves the item by 1 px or rocks one end, never changing the outline by more than 2 px; 12 ticks per frame. Puddle Lane table: crisp packet 30, butts 20, can 15, plastic bottle 15, newspaper 12, dog mess 8 (the plastic bottle is on sheet_02).

## Scope

- Review and accept sheet_01 (acceptance_notes) or regenerate
- ingest.json (can/butts null) and ingest; fix the 6 ingested grids
- Hand-draw `drink_can.sprite.txt` and `cigarette_butts.sprite.txt` as `grid`
- Author `wobble:h00:0..1` for all 8 items
- Sheet + zoo review including the generated rotations

## Out of scope

- Sheet_02 items
- Litter behaviours (M2/M3)

## Acceptance criteria

- [ ] `assets-src/ai/litter.sheet_01/` complete (prompt.md, meta.json with real acceptance_notes, golden.png hash match)
- [ ] 8 grids in `assets-src/sprites/litter/`: 6 `ai-ingest` with `origin:` headers, can and butts `grid`
- [ ] Each item has idle + 2 wobble frames with rotations generated; lint (including rotation symmetry) clean
- [ ] Largest item is 14 px; relative sizes believable; every item nameable at 1x in the zoo (Read, noted)
- [ ] None of the 8 keeps `placeholder: true`

## Verification

- npm run assets:ingest -- litter.sheet_01
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas items, then Read build/sheets/items.png
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-110](SSP-110-forge-ingest-complete.md) Complete forge ingest: full 10-step pipeline, edit protection, dry-run previews
- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-118](SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-001](../M0/SSP-001-probe-ai-goldens-import.md) Import probe Codex sheets as AI golden candidates with retro-filled meta.json
- [SSP-051](../M2/SSP-051-placeholder-litter-sprites.md) Author placeholder grids for all 15 litter IDs and add the items atlas
- [SSP-067](../M2/SSP-067-items-sprite-batch.md) Render litter, stains and site markers via the items instance batch

**Blocks:**

- [SSP-140](SSP-140-litter-sheet-02.md) Generate litter.sheet_02 and ingest the remaining 7 litter items
- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-223](../M6/SSP-223-art-litter-m6.md) Art Pass 2: final litter sprites for kebab wrapper, leaf pile and lolly stick

## References

- ../../ASSET_PIPELINE.md#106-litter-litter-codex-sheet--ingest--grids
- ../../ASSET_PIPELINE.md#65-ai-asset-folder-assets-srcaiasset-id
- ../../ART_BIBLE.md#84-litter
- ../../ENTITY_CATALOG.md#4-rubbish-litter
- ../../ASSET_PIPELINE.md#12-regeneration-procedures

## Roadmap tasks covered

- Litter: accept `litter.sheet_01` (and further 4×2 sheets as needed). Ingest at one scale per sheet with the largest item at 14 px. Hand-redraw `litter.drink_can`. Ship `litter.cigarette_butts` as a cluster sprite.
