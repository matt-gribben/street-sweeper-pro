---
id: SSP-134
title: "Final npc.shopper with 8 outfit swaps"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, size:M, vertical-slice]
depends_on: [SSP-133, SSP-114, SSP-097]
blocks: [SSP-158]
---

# SSP-134: Final npc.shopper with 8 outfit swaps

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets · **Vertical slice**

## Summary

Produce the final shopper, the most common pedestrian on Monday and Tuesday. It is authored in swap key indices so the 8 outfit slots give the crowd variety.

## Context

Follow the people template from the Doris pilot (ASSET_PIPELINE §10.4). Adult build: 22 px tall (head 8, torso 7, legs 7), width 10 / <= 18 with props; 65 authored frames, 104 IDs; walk stride 0.30 m. Swap keys (ART_BIBLE §5.6): primary garment 21/22/23; secondary garment 14/15/16 (<= 4 px of 15); skin 12 lit/11 shade; must not use 26 or 30. Each slot maps the primary to the car-paint column colour and the secondary to the Bessie-livery column colour (slots 0-1 keep 14/15/16), and moves skin through the pairs (12,11), (11,13), (13,08). The reviewer must check all 8 slots on the sheet swap row and in the zoo for clashes and contrast (dominant colour >= 0.12 L from asphalt 02 and slab 05, or accent + outline). Peaks: 9 on Puddle Lane, 18-26 on High Street.

## Scope

- `assets-src/ai/char.shopper/` prompt, generation, acceptance notes, ingest
- Author `shopper.sprite.txt` (65 frames + mirrors) in swap keys
- Manifest swaps set; review all 8 slots

## Out of scope

- Shopper behaviour (M3)

## Acceptance criteria

- [ ] Provenance folder complete with acceptance_notes for every candidate
- [ ] The grid uses only key indices for swapped parts, and never 26 or 30; lint clean; no `placeholder`
- [ ] All 8 outfit slots read distinctly on asphalt and slab on the sheet swap row and in the zoo (Read, noted)
- [ ] The figure stays within 18x22 on the locked pivot row

## Verification

- npm run gen:ai -- char.shopper --candidates 4 (local only), then Read build/ai-candidates/char.shopper/review.png
- npm run assets:ingest -- char.shopper
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --only npc.shopper, then Read build/sheets/only_npc.shopper.png
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-133](SSP-133-char-doris-pilot.md) Pilot the people pipeline end to end with npc.old_woman (Doris)
- [SSP-114](SSP-114-ramp-swap-tables.md) Lock ramp-swap key indices and emit the 8 swap tables per atlas
- [SSP-097](../M3/SSP-097-placeholder-human-grids-mon.md) Author placeholder grids for the six Monday human NPCs (24×24, 13 frames/dir)

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR

## References

- ../../ASSET_PIPELINE.md#104-human-npc-people-codex--ingest--grid
- ../../ART_BIBLE.md#56-ramp-swaps-per-instance-palette-variants
- ../../ART_BIBLE.md#72-human-proportions-2424-cell
- ../../ENTITY_CATALOG.md#6-pedestrians-npc-people

## Roadmap tasks covered

- Characters: `npc.shopper` (8 outfit swaps), `npc.old_woman`, `npc.old_man_frame`, `npc.mum_pushchair`, `npc.postie`, `npc.dog_walker`, `npc.businessman`, `npc.litterbug`, `npc.market_trader`. Generate a key-pose sheet with `-i assets-src/ai/ref.people_style/golden.png`, ingest it, then hand-author the remaining frames (walk 4, idle 2, startle 2, fall 3, angry 2) in each grid.
