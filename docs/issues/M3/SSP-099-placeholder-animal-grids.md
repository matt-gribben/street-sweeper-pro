---
id: SSP-099
title: "Author placeholder grids for the cat, pigeon and dog (npc.dog_loose grid)"
milestone: M3
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, area:test, size:M, vertical-slice]
depends_on: [SSP-009, SSP-039, SSP-298]
blocks: [SSP-103, SSP-114, SSP-115, SSP-146, SSP-147]
---

# SSP-099: Author placeholder grids for the cat, pigeon and dog (npc.dog_loose grid)

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** asset · **Size:** M · **Areas:** assets, test · **Vertical slice**

## Summary

Write placeholder text grids under the final frame IDs for npc.cat (16×16), npc.pigeon (12×12) and npc.dog_loose (20×20). The dog grid is needed now because the dog walker's dog uses it with a coat swap.

## Context

From ART_BIBLE §7.1/§7.3/§10.2 and ENTITY_CATALOG §7.1:
- npc.cat: cell 16×16, body ≤ 12×14. 8 directions (S, SW, W, NW, N authored, rest mirrored). walk 4, sit 2, dart 2, leap 3 = 11 per direction, 88 IDs. Ginger 11/13 with 12 belly (tabby 03/05 by code); tail as a 1 px curve. The leap frames carry squash and stretch (squash 4, stretch 6, land 6 ticks).
- npc.pigeon: cell 12×12, body ≤ 10×8. 4 directions (S, W, N authored; `mirror e from w`). peck 2, fly 3 = 5 per direction, 20 IDs. Body 04/05, neck sheen 29, feet 17.
- npc.dog_loose: cell 20×20, body ≤ 16×18. 8 directions. walk 4, sit 2, bark 2 = 8 per direction, 64 IDs. Jack Russell 07 with 11/12 patches, 18 collar. Patches in the skin key (12/11) so the coat swap works for the walker's dog.

Technique `grid`, written directly in assets-src/sprites/npc/<name>.sprite.txt; atlas actors; manifest `"placeholder": true` (in M4 animals stay grids but are upgraded to final quality).

Swap tables arrive in SSP-114 (M4). Until then, the renderer's 32x8 swap texture is identity (SSP-297). So in M3, check only that the dog's patches are drawn in key indices 12/11; the visible coat-swap check belongs to SSP-147. Zoo review uses the minimal M3 ZooScene (`&asset=npc.dog_loose`).

## Scope

- cat.sprite.txt, pigeon.sprite.txt and dog_loose.sprite.txt with authored directions and mirror lines.
- Manifest entries.
- Run `npm run assets`, commit the generated outputs, Read the contact sheets and zoo screenshot.

## Out of scope

- Seagull (M6).
- dog_loose behaviour (M6).
- Seeing the coat swap change colour in-engine (swap tables are SSP-114; the visible check is in SSP-147, M4)

## Acceptance criteria

- [ ] src/gen/assets.ts has 88 cat, 20 pigeon and 64 dog frame IDs (e.g. FRAME['npc.cat:dart:w:1']).
- [ ] `npm run assets:lint` and `npm run assets:verify` pass.
- [ ] The contact sheets and `?test=1&scene=zoo` (including `&asset=npc.cat` and `&asset=npc.dog_loose`) were opened with Read, and the PR notes that the cat's leap frames show squash and stretch.
- [ ] The dog's patch pixels use only key indices 12/11, so SSP-114's coat swap applies (a script or grep output over dog_loose.sprite.txt in the PR).
- [ ] `npm run test:visual` passes (existing goldens).

## Verification

- npm run assets
- npm run assets:lint
- npm run assets:verify
- npm run assets:sheets
- npm run typecheck
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-009](../M0/SSP-009-forge-build-grid-blender.md) Implement forge build for grid and blender techniques with outline and byte-stable PNGs
- [SSP-039](../M1/SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end
- [SSP-298](SSP-298-zoo-scene-review.md) Add a minimal test-only ZooScene for in-engine review of actors and items frames

**Blocks:**

- [SSP-103](SSP-103-render-actors-traffic.md) Draw NPCs, animals, traffic, knockables and hazards with state-driven frames
- [SSP-114](../M4/SSP-114-ramp-swap-tables.md) Lock ramp-swap key indices and emit the 8 swap tables per atlas
- [SSP-115](../M4/SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-146](../M4/SSP-146-animal-cat.md) Hand-author the npc.cat grid: walk, sit, dart, leap in 8 directions
- [SSP-147](../M4/SSP-147-animals-pigeon-dog.md) Hand-author npc.pigeon and the npc.dog_loose grid with coat swap

## References

- ../../ART_BIBLE.md#71-size-sheet-locked
- ../../ART_BIBLE.md#73-character-colour-keys
- ../../ART_BIBLE.md#56-ramp-swaps-per-instance-palette-variants
- ../../ENTITY_CATALOG.md#71-stats-and-sprites
- ../../ASSET_PIPELINE.md#105-animal-npccat-npcdog_-npcpigeon-npcseagull-grids

## Roadmap tasks covered

- Placeholder grids for all M3 NPCs: ... cat 16×16; pigeon 12×12; the walker's dog 20×20 (`npc.dog_loose` grid).
