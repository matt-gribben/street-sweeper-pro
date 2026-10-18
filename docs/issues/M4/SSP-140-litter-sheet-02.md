---
id: SSP-140
title: "Generate litter.sheet_02 and ingest the remaining 7 litter items"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, size:M, vertical-slice]
depends_on: [SSP-139, SSP-012]
blocks: [SSP-158]
---

# SSP-140: Generate litter.sheet_02 and ingest the remaining 7 litter items

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets · **Vertical slice**

## Summary

Generate, accept and ingest `litter.sheet_02` for the remaining seven litter IDs, completing all 15 litter items. These include Tuesday's pizza box and chip wrapper and the plastic bottle that Puddle Lane needs.

## Context

Sheet_02 cells (ASSET_PIPELINE §6.5, §8.4 worked example): kebab wrapper, pizza box, lolly stick, chip wrapper / leaf pile, plastic bottle, spilled shopping, empty. The §8.4 prompt.md example is the starting brief: 2:1, 4x2, transparent, seen from directly above, no cast shadows, no label text, pizza box ~14 px largest. Sizes: pizza box 13-14 px, lolly stick 8 px; plastic bottle = longer capsule with a 1 px cap; spilled shopping = dented tin, red apple, torn paper bag, no label text. Same litter rules as sheet_01: one scale per sheet, top-lit symmetric shading, idle + 2 wobble, generated rotations. Reject candidates per §11.1 (fake checkerboard, logos, 3/4 camera, items crossing cells). After 2-3 rejected rounds, revise the prompt and explain why (CLAUDE.md §9).

## Scope

- prompt.md, `npm run gen:ai -- litter.sheet_02 --candidates 4`, review, accept with notes
- ingest.json and ingest; fix grids; author wobble frames
- Sheet + zoo review

## Out of scope

- Additional litter sheets beyond 02

## Acceptance criteria

- [ ] Provenance folder complete; acceptance_notes explain the winner and each rejection
- [ ] 7 grids with `origin:` headers, idle + 2 wobble each; lint clean
- [ ] All 15 litter IDs are now non-placeholder
- [ ] Items are nameable at 1x in the zoo with no lettering or logos (Read, noted); `npm test` (ipHygiene) passes

## Verification

- npm run gen:ai -- litter.sheet_02 --candidates 4 (local only), then Read build/ai-candidates/litter.sheet_02/review.png
- npm run assets:ingest -- litter.sheet_02
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas items, then Read build/sheets/items.png
- npm test && npm run test:visual

## Dependencies

**Depends on:**

- [SSP-139](SSP-139-litter-sheet-01.md) Accept litter.sheet_01, ingest 6 items, hand-draw the can and butts
- [SSP-012](../M0/SSP-012-genai-codex-wrapper.md) Implement forge gen-ai Codex wrapper with preamble v1 and a concept.spike_street smoke run

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR

## References

- ../../ASSET_PIPELINE.md#84-prompt-file-format
- ../../ASSET_PIPELINE.md#106-litter-litter-codex-sheet--ingest--grids
- ../../ASSET_PIPELINE.md#111-candidate-review-ai
- ../../ART_BIBLE.md#84-litter
- ../../ENTITY_CATALOG.md#4-rubbish-litter

## Roadmap tasks covered

- Litter: accept `litter.sheet_01` (and further 4×2 sheets as needed). Ingest at one scale per sheet with the largest item at 14 px. Hand-redraw `litter.drink_can`. Ship `litter.cigarette_butts` as a cluster sprite.
