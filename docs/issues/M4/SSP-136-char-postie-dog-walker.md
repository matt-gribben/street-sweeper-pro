---
id: SSP-136
title: "Final npc.postie and npc.dog_walker"
milestone: M4
status: todo
type: asset
estimate: L
labels: [type:asset, area:assets, area:render, size:L, vertical-slice]
depends_on: [SSP-133, SSP-097, SSP-086, SSP-103]
blocks: [SSP-158]
---

# SSP-136: Final npc.postie and npc.dog_walker

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** L · **Areas:** assets, render · **Vertical slice**

## Summary

Produce the postie and the dog walker for Monday. The walker's lead is a runtime line, so the hand anchor must be consistent across frames.

## Context

People template from the Doris pilot. `npc.postie`: adult; jacket 18/19, hi-vis 17 band, trolley 18, post bag 18. `npc.dog_walker`: adult; coat 22. The lead is NOT a sprite: it is a 1 px runtime line in 18 from the walker's hand to the dog's collar, with its own +2,+2 drop shadow, and must read on asphalt and slab (ART_BIBLE §8.3). The dog is the `npc.dog_loose` grid with a coat swap (SSP-147, which defines the collar anchor). Open: the docs do not say how the hand position is known at runtime. Keep the hand on a fixed per-direction/per-frame pixel, record the offsets (e.g. in the manifest or a small JSON consumed by the renderer), and document the approach. 65 authored frames each.

## Scope

- Two provenance folders, generation, acceptance, ingest
- Author both grids fully
- Define and document the lead hand anchor; adjust the runtime lead line to use it
- Sheet + zoo review

## Out of scope

- Dog grid and collar anchor (SSP-147)
- Lead Tangle behaviour (M3)

## Acceptance criteria

- [ ] Both provenance folders complete; grids complete with mirrors; no `placeholder`
- [ ] A unit test asserts that the hand anchor exists for every walker frame ID
- [ ] The runtime lead starts at the walker's hand in all 8 directions in the zoo or a Puddle Lane capture (Read)
- [ ] Lint clean; figures on the locked pivot row

## Verification

- npm run gen:ai -- char.postie --candidates 4 (local only); npm run gen:ai -- char.dog_walker --candidates 4 (local only); Read each review.png
- npm run assets:ingest -- char.postie && npm run assets:ingest -- char.dog_walker
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas actors, then Read build/sheets/actors.png
- npm run typecheck && npm test && npm run test:visual

## Dependencies

**Depends on:**

- [SSP-133](SSP-133-char-doris-pilot.md) Pilot the people pipeline end to end with npc.old_woman (Doris)
- [SSP-097](../M3/SSP-097-placeholder-human-grids-mon.md) Author placeholder grids for the six Monday human NPCs (24×24, 13 frames/dir)
- [SSP-086](../M3/SSP-086-behaviour-dog-walker.md) Implement the dog walker with a lead line obstacle, Lead Tangle and dog mess drops
- [SSP-103](../M3/SSP-103-render-actors-traffic.md) Draw NPCs, animals, traffic, knockables and hazards with state-driven frames

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR

## References

- ../../ASSET_PIPELINE.md#104-human-npc-people-codex--ingest--grid
- ../../ART_BIBLE.md#83-people-and-animals
- ../../ART_BIBLE.md#73-character-colour-keys

## Roadmap tasks covered

- Characters: `npc.shopper` (8 outfit swaps), `npc.old_woman`, `npc.old_man_frame`, `npc.mum_pushchair`, `npc.postie`, `npc.dog_walker`, `npc.businessman`, `npc.litterbug`, `npc.market_trader`. Generate a key-pose sheet with `-i assets-src/ai/ref.people_style/golden.png`, ingest it, then hand-author the remaining frames (walk 4, idle 2, startle 2, fall 3, angry 2) in each grid.
