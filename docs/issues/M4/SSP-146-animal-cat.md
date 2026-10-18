---
id: SSP-146
title: "Hand-author the npc.cat grid: walk, sit, dart, leap in 8 directions"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, size:M, vertical-slice]
depends_on: [SSP-115, SSP-116, SSP-118, SSP-099]
blocks: [SSP-158, SSP-240]
---

# SSP-146: Hand-author the npc.cat grid: walk, sit, dart, leap in 8 directions

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets · **Vertical slice**

## Summary

Write the final cat directly as a text grid (no AI), covering all 88 frame IDs. The cat is one of the vertical slice's 'charming chaos' reads.

## Context

`npc.cat` (ENTITY_CATALOG §7.1, ART_BIBLE §7.1-7.3): 16x16 cell, body <= 12x14. 8 dirs (S, SW, W, NW, N authored; SE, E, NE mirrored). Walk 4, sit 2, dart 2, leap 3 = 11 per dir, 88 IDs, 55 authored. `grid` technique in `assets-src/sprites/npc/cat.sprite.txt`, actors atlas. Colours: ginger 11/13 with a 12 belly (or tabby 03/05, 'variant by code'); tail as a 1 px curve. Top-lit symmetric shading; squash and stretch drawn into the leap frames. Timings (ART_BIBLE §10.2): walk 1 frame per 0.12 m; sit frame 0 for 90 ticks, frame 1 (tail flick) for 12; dart 3 ticks each; leap squash 4, stretch 6, land 6. Riding on Bessie's roof uses the same sprite (shadow offset +3,+3 proposed, runtime). Open: 'tabby variant by code' needs a swap that maps 11/13/12 to 03/05/(?), but the skin column of the slot table maps 12/11 to other skin pairs, not tabby. Decide (dedicated slot entries, a second asset, or drop tabby) and record it in ART_BIBLE §7.3. Review: in the zoo, animate at 10 fps and check that the walk does not swim.

## Scope

- Author `cat.sprite.txt` (55 frames + mirror lines)
- Resolve the tabby variant approach
- Manifest upgrade; sheet + zoo review

## Out of scope

- Cat behaviour (M3)

## Acceptance criteria

- [ ] 88 frame IDs resolve in `src/gen/assets.ts`; body <= 12x14; lint clean; no `placeholder`
- [ ] Leap frames show squash and stretch; looping states loop seamlessly (sheet, in sequence)
- [ ] The cat is smaller than the dog and readable on asphalt, slab and grass in the zoo (Read, noted)
- [ ] The tabby decision is documented

## Verification

- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --only npc.cat, then Read build/sheets/only_npc.cat.png
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-118](SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-099](../M3/SSP-099-placeholder-animal-grids.md) Author placeholder grids for the cat, pigeon and dog (npc.dog_loose grid)

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-240](../M7/SSP-240-juice-squash-popups.md) Juice pass: squash-and-stretch, combo popups and the cat roof-ride

## References

- ../../ASSET_PIPELINE.md#105-animal-npccat-npcdog_-npcpigeon-npcseagull-grids
- ../../ART_BIBLE.md#71-size-sheet-locked
- ../../ART_BIBLE.md#73-character-colour-keys
- ../../ART_BIBLE.md#102-timing-table
- ../../ENTITY_CATALOG.md#7-animals-npc-animals

## Roadmap tasks covered

- `npc.cat`, `npc.pigeon`, and the `npc.dog_loose` grid used by the walker's dog with a coat swap (all frames).
