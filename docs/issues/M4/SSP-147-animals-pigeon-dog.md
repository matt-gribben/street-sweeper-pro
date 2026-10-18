---
id: SSP-147
title: "Hand-author npc.pigeon and the npc.dog_loose grid with coat swap"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, size:M, vertical-slice]
depends_on: [SSP-114, SSP-115, SSP-116, SSP-118, SSP-099]
blocks: [SSP-158, SSP-200]
---

# SSP-147: Hand-author npc.pigeon and the npc.dog_loose grid with coat swap

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets · **Vertical slice**

## Summary

Write the pigeon grid (Tuesday flocks) and the `npc.dog_loose` grid, which the dog walker's dog reuses with a coat ramp swap.

## Context

`npc.pigeon` (ENTITY_CATALOG §7.1, ART_BIBLE §7.1): 12x12 cell, body <= 10x8. 4 dirs s, w, n, e (S, W, N authored; E mirrored from W). Peck 2, fly 3 = 5 per dir, 20 IDs, 15 authored. Colours: 04/05 body, 29 neck sheen, 17 feet. Timings: peck frame 0 held 12-30 ticks (seeded), frame 1 for 6 ticks; fly 3 frames x 4 ticks. No drop shadow while airborne (proposed). `npc.dog_loose`: 20x20 cell, body <= 16x18. 8 dirs (5 authored). Walk 4, sit 2, bark 2 = 8 per dir, 64 IDs, 40 authored. Jack Russell 07 with 11/12 patches (patches in the skin key 12/11, so swaps recolour the coat), collar 18. Walk 1 frame per 0.35 m, sit 30 ticks, bark 6 ticks (`sfx.dog_bark` on frame 1). The walker's dog uses this grid with a coat swap; `npc.dog_loose` behaviour itself is M6. Define the collar pixel per frame for the runtime lead (the anchor format matches the hand anchor in SSP-136).

## Scope

- Author `pigeon.sprite.txt` and `dog_loose.sprite.txt` with mirror lines
- Confirm dog coat swaps via the slot table's skin column
- Collar anchor per frame for the runtime lead
- Manifest upgrade; sheet + zoo review

## Out of scope

- `npc.seagull` (M6)
- Loose-dog behaviour (M6)

## Acceptance criteria

- [ ] 20 pigeon and 64 dog frame IDs resolve; lint clean; no `placeholder`
- [ ] Dog coat patches recolour across swap slots on the sheet swap row, while collar and body stay unchanged (Read)
- [ ] The dog is larger than the cat; the pigeon stays within 10x8
- [ ] A collar anchor exists for every dog frame ID (unit test)

## Verification

- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas actors, then Read build/sheets/actors.png
- npm test && npm run test:visual

## Dependencies

**Depends on:**

- [SSP-114](SSP-114-ramp-swap-tables.md) Lock ramp-swap key indices and emit the 8 swap tables per atlas
- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-118](SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-099](../M3/SSP-099-placeholder-animal-grids.md) Author placeholder grids for the cat, pigeon and dog (npc.dog_loose grid)

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-200](../M6/SSP-200-dog-loose-seagull.md) Implement npc.dog_loose chase and npc.seagull chip theft and litter snatching

## References

- ../../ASSET_PIPELINE.md#105-animal-npccat-npcdog_-npcpigeon-npcseagull-grids
- ../../ENTITY_CATALOG.md#7-animals-npc-animals
- ../../ART_BIBLE.md#73-character-colour-keys
- ../../ART_BIBLE.md#56-ramp-swaps-per-instance-palette-variants
- ../../ART_BIBLE.md#102-timing-table

## Roadmap tasks covered

- `npc.cat`, `npc.pigeon`, and the `npc.dog_loose` grid used by the walker's dog with a coat swap (all frames).
