---
id: SSP-138
title: "Final npc.market_trader"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, size:M]
depends_on: [SSP-133, SSP-098]
blocks: [SSP-158]
---

# SSP-138: Final npc.market_trader

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets

## Summary

Produce the Market Square trader (one per stall pitch on Tuesday) with the full human frame set.

## Context

People template from the Doris pilot. `npc.market_trader`: adult; apron 26/07 stripes, flat cap 03. Speed is 0 (static at a pitch; 12 on High Street), but the size sheet still requires walk 4, idle 2, startle 2, fall 3, angry 2 per direction (65 authored, 104 IDs). Idle = calling out. Must read beside the 18/07 or 26/07 striped market stall awnings.

## Scope

- Provenance folder, generation, acceptance, ingest
- Author the grid fully
- Review next to `prop.market_stall` in the zoo

## Out of scope

- Market close behaviour (M3)

## Acceptance criteria

- [ ] Provenance folder complete; grid complete with mirrors; no `placeholder`
- [ ] Distinguishable from the stall awning in the zoo (Read, noted)
- [ ] Lint clean

## Verification

- npm run gen:ai -- char.market_trader --candidates 4 (local only), then Read its review.png
- npm run assets:ingest -- char.market_trader
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --only npc.market_trader, then Read build/sheets/only_npc.market_trader.png
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-133](SSP-133-char-doris-pilot.md) Pilot the people pipeline end to end with npc.old_woman (Doris)
- [SSP-098](../M3/SSP-098-placeholder-human-grids-tue.md) Author placeholder grids for businessman, litterbug and market trader

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR

## References

- ../../ASSET_PIPELINE.md#104-human-npc-people-codex--ingest--grid
- ../../ART_BIBLE.md#73-character-colour-keys

## Roadmap tasks covered

- Characters: `npc.shopper` (8 outfit swaps), `npc.old_woman`, `npc.old_man_frame`, `npc.mum_pushchair`, `npc.postie`, `npc.dog_walker`, `npc.businessman`, `npc.litterbug`, `npc.market_trader`. Generate a key-pose sheet with `-i assets-src/ai/ref.people_style/golden.png`, ingest it, then hand-author the remaining frames (walk 4, idle 2, startle 2, fall 3, angry 2) in each grid.
