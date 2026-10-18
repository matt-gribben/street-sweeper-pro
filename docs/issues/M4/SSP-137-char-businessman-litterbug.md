---
id: SSP-137
title: "Final npc.businessman and npc.litterbug"
milestone: M4
status: todo
type: asset
estimate: L
labels: [type:asset, area:assets, size:L]
depends_on: [SSP-133, SSP-098]
blocks: [SSP-158]
---

# SSP-137: Final npc.businessman and npc.litterbug

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** L · **Areas:** assets

## Summary

Produce the two Tuesday pedestrians with signature poses: the businessman on his phone and the hooded litterbug.

## Context

People template from the Doris pilot. `npc.businessman`: adult; suit 03/02, shirt 07, tie 18, phone 00/05 at the ear; silhouette = arm up to ear. Suit 02/03 sits close to asphalt (02, L 0.35), so rely on the 07 shirt/18 tie accent plus the ink outline (ART_BIBLE §5.2). `npc.litterbug`: adult; hoodie 04/03, cap 18, hood up, hands in pockets. 65 authored frames each, mirrors, top-lit shading.

## Scope

- Two provenance folders, generation, acceptance, ingest
- Author both grids fully
- Sheet + zoo review with the asphalt contrast check

## Out of scope

- Behaviours (M3)

## Acceptance criteria

- [ ] Both provenance folders complete; grids complete with mirrors; no `placeholder`
- [ ] Both read on asphalt 02 at 1x in a greyscale zoo check (ART_BIBLE §15.1 step 5; Read, noted)
- [ ] Lint clean

## Verification

- npm run gen:ai -- char.businessman --candidates 4 (local only); npm run gen:ai -- char.litterbug --candidates 4 (local only); Read each review.png
- npm run assets:ingest -- char.businessman && npm run assets:ingest -- char.litterbug
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas actors, then Read build/sheets/actors.png
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
- ../../ART_BIBLE.md#52-value-reference
- ../../ART_BIBLE.md#151-review-procedure

## Roadmap tasks covered

- Characters: `npc.shopper` (8 outfit swaps), `npc.old_woman`, `npc.old_man_frame`, `npc.mum_pushchair`, `npc.postie`, `npc.dog_walker`, `npc.businessman`, `npc.litterbug`, `npc.market_trader`. Generate a key-pose sheet with `-i assets-src/ai/ref.people_style/golden.png`, ingest it, then hand-author the remaining frames (walk 4, idle 2, startle 2, fall 3, angry 2) in each grid.
