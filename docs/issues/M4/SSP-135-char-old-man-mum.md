---
id: SSP-135
title: "Final npc.old_man_frame and npc.mum_pushchair"
milestone: M4
status: todo
type: asset
estimate: L
labels: [type:asset, area:assets, size:L, vertical-slice]
depends_on: [SSP-133, SSP-097]
blocks: [SSP-158]
---

# SSP-135: Final npc.old_man_frame and npc.mum_pushchair

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** L · **Areas:** assets · **Vertical slice**

## Summary

Produce the two Monday characters with large carried props: the old man with his walking frame, and the parent with a pushchair.

## Context

People template from the Doris pilot. `npc.old_man_frame`: elderly build 18-19 px; cardigan 13, trousers 03, frame 05/06, flat cap 09; the frame is drawn ahead of his feet (signature silhouette); walk stride 0.15 m; he crosses only at zebras. `npc.mum_pushchair`: adult build 22 px; coat 20; pushchair 25/03 as a rectangle ahead of her (signature). Carried props must fit inside the 24x24 cell (<= 18 px wide). Both: 65 authored frames each, mirror lines, top-lit shading, slot 0 only (unique characters). Hitting them costs the heaviest penalties (-500, 2 complaints), so their silhouettes must read instantly.

## Scope

- Two provenance folders (`char.old_man_frame`, `char.mum_pushchair`), generation, acceptance, ingest
- Author both grids fully (130 authored frames)
- Sheet + zoo review

## Out of scope

- Behaviours (M3)

## Acceptance criteria

- [ ] Both provenance folders complete; grids have `origin:` headers, 65 frames + 3 mirror lines each; no `placeholder`
- [ ] Props stay inside the cell in all directions; figures sit on the locked pivot row
- [ ] Each is identifiable as a 1x silhouette in the zoo (Read, noted)
- [ ] Lint clean

## Verification

- npm run gen:ai -- char.old_man_frame --candidates 4 (local only), then Read its review.png
- npm run gen:ai -- char.mum_pushchair --candidates 4 (local only), then Read its review.png
- npm run assets:ingest -- char.old_man_frame && npm run assets:ingest -- char.mum_pushchair
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas actors, then Read build/sheets/actors.png
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-133](SSP-133-char-doris-pilot.md) Pilot the people pipeline end to end with npc.old_woman (Doris)
- [SSP-097](../M3/SSP-097-placeholder-human-grids-mon.md) Author placeholder grids for the six Monday human NPCs (24×24, 13 frames/dir)

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR

## References

- ../../ASSET_PIPELINE.md#104-human-npc-people-codex--ingest--grid
- ../../ART_BIBLE.md#73-character-colour-keys
- ../../ART_BIBLE.md#72-human-proportions-2424-cell

## Roadmap tasks covered

- Characters: `npc.shopper` (8 outfit swaps), `npc.old_woman`, `npc.old_man_frame`, `npc.mum_pushchair`, `npc.postie`, `npc.dog_walker`, `npc.businessman`, `npc.litterbug`, `npc.market_trader`. Generate a key-pose sheet with `-i assets-src/ai/ref.people_style/golden.png`, ingest it, then hand-author the remaining frames (walk 4, idle 2, startle 2, fall 3, angry 2) in each grid.
