---
id: SSP-114
title: "Lock ramp-swap key indices and emit the 8 swap tables per atlas"
milestone: M4
status: todo
type: feature
estimate: M
labels: [type:feature, area:tooling, area:assets, area:render, area:test, size:M, vertical-slice]
depends_on: [SSP-113, SSP-118, SSP-005, SSP-021, SSP-097, SSP-099, SSP-100, SSP-297]
blocks: [SSP-127, SSP-128, SSP-134, SSP-147, SSP-193, SSP-222, SSP-242]
---

# SSP-114: Lock ramp-swap key indices and emit the 8 swap tables per atlas

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** feature · **Size:** M · **Areas:** tooling, assets, render, test · **Vertical slice**

## Summary

Define the per-instance ramp-swap tables in `kerbside32.json`, lock the key-index allocation proposed in ART_BIBLE §5.6, emit the tables into the atlas JSON, and confirm the renderer applies them. Car paint, shopper outfits, dog coats and Bessie's beacon flash all depend on this.

## Context

Up to 8 swap tables per atlas. Slot 0 is identity, and each table is a single index->index lookup (never chained). Tables live in `assets-src/palette/kerbside32.json` under `swaps` and are emitted in each atlas JSON under `swaps`; the manifest `swaps` field names which tables apply (ASSET_PIPELINE §6.1, §9.3). Doc conflict to resolve: ASSET_PIPELINE §6.1/§9.3 examples use NAMED per-livery tables (`livery_racing_green`: {15:22, 14:21, 16:23}), while ART_BIBLE §5.6 defines 8 MULTIPLEXED numbered slots. Pick one representation (e.g. tables keyed `slot_0`..`slot_7`, in slot order) and update both docs and the §6.1 `veh.sweeper` example. Key indices on `actors` (ART_BIBLE §5.6, lock in M4): hatchback/saloon paint 21 dark/22 base/23 light, which must not use 14,15,16,17,26,30,12,11. Shopper primary garment 21/22/23 and secondary 14/15/16 (<= 4 px of 15); must not use 26 or 30. Skin (shopper) and the walker's dog coat use 12 lit/11 shade. `veh.sweeper` livery: body 14/15/16, stripe 26, beacon 17; must not use 21-23 or 30. Police lightbar 30. Glass 25/27 is never a swap source. Slot allocation (paint | Bessie livery | flash | skin): 0 green 21/22/23 identity | Council Yellow | - | 12/11. 1 red 19/18/17 | Council Yellow | 17->16, 30->28 | 11/13. 2 blue 25/26/27 | Racing Green 21/22/23, stripe->15 | - | 13/08. 3 white 05/06/07 | Racing Green | 17->16 | 12/11. 4 silver 03/04/05 | Seaside 26/27/28, stripe->20 | - | 11/13. 5 black 01/02/03 | Seaside | 17->16 | 13/08. 6 teal 25/29/28 | Midnight Gold 01/25/26, stripe->15 | - | 12/11. 7 rust 09/10/11 | Midnight Gold | 17->16 | 11/13. Beacon flash (ART_BIBLE §10.2, proposed and tunable later): Bessie alternates her livery's even slot with the next odd slot, 15 ticks on/15 off while the brush is down or dumping. Keep the timing a single named constant. The brush overlay always uses slot 0. Renderer (TECHNICAL_DESIGN §12.5): the `actors`/`items` atlases are converted at load to R8 index textures (a non-palette pixel is a load error), and the fragment shader applies the instance's swap row from a 32x8 swap texture. Liveries other than Council, and the `rival` table, are M6. Slot tables are multiplexed, though, so all 8 `actors` tables are fully defined now.

## Scope

- Write the 8 `actors` swap tables into `kerbside32.json`
- Resolve the named-vs-slot table representation in ASSET_PIPELINE §6.1/§9.3 and ART_BIBLE §5.6, and update the runtime `swaps` parser from SSP-297 if the locked representation differs from its provisional `slot_0`..`slot_7` form
- Forge: validate the tables (<= 8 per atlas, slot 0 identity, 25/27 never a source) and emit them into the atlas JSON
- Add manifest `swaps` entries for veh.hatchback, veh.saloon, npc.shopper and the dog coat (the M3 placeholders ship with `swaps: []`)
- Confirm that the existing R8 index texture + 32x8 swap texture path shows the real tables via the per-instance `swap` attribute
- Beacon flash slot toggling for Bessie per ART_BIBLE §10.2 (timing as a tunable constant)
- Lock ART_BIBLE §5.6 and §17 (remove 'proposed') and mirror the result in `assets-src/STYLE.md`

## Out of scope

- `rival` swap table and `veh.rival_sweeper` frames (M6)
- Livery unlocks and Workshop UI (M6)
- Police lightbar behaviour (M6)

## Acceptance criteria

- [ ] pytest: every table maps only indices 0-31, slot 0 is identity, and 25 and 27 never appear as a source key
- [ ] `public/assets/atlas/actors.json` contains `swaps` with 8 entries matching kerbside32.json, in the documented representation
- [ ] Vitest: the 32x8 swap texture built at load has row k equal to table k
- [ ] A test sprite authored in key indices, drawn at slots 0-7 in the zoo (or a zoo page), shows the 8 documented colourways (Read, noted in PR)
- [ ] Vitest: a non-palette pixel in an atlas fails at load with an error naming the atlas
- [ ] Unit test: Bessie's swap slot toggles every 15 ticks while the brush is down and stays on the even slot in transit
- [ ] ART_BIBLE §5.6, ASSET_PIPELINE §6.1/§9.3 and STYLE.md agree on the locked allocation and representation

## Verification

- uv run --project tools/forge pytest
- npm test
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-113](SSP-113-forge-pack-atlases.md) Lock atlas trimming and the 1 px gutter, cover all five atlases and add the fill-ratio report
- [SSP-118](SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-005](../M0/SSP-005-kerbside32-palette.md) Author kerbside32.json and forge OKLab palette mapping with a shared 4,096-sample fixture
- [SSP-021](../M0/SSP-021-night-shadow-tuning.md) Tune night[32] and shadow[32] remap tables in the spike scene (D-05, D-06)
- [SSP-097](../M3/SSP-097-placeholder-human-grids-mon.md) Author placeholder grids for the six Monday human NPCs (24×24, 13 frames/dir)
- [SSP-099](../M3/SSP-099-placeholder-animal-grids.md) Author placeholder grids for the cat, pigeon and dog (npc.dog_loose grid)
- [SSP-100](../M3/SSP-100-placeholder-vehicle-renders.md) Render placeholder traffic vehicles in Blender as primitive boxes at 32 headings
- [SSP-297](../M1/SSP-297-r8-index-atlases-swap-texture.md) Convert actors/items atlases to R8 index textures with an identity 32x8 swap texture

**Blocks:**

- [SSP-127](SSP-127-bessie-final.md) Final Bessie renders: body, dented variant and 96x96 brush overlay
- [SSP-128](SSP-128-traffic-cars.md) Final Blender cars: hatchback, saloon, taxi, white van, parked aliases
- [SSP-134](SSP-134-char-shopper.md) Final npc.shopper with 8 outfit swaps
- [SSP-147](SSP-147-animals-pigeon-dog.md) Hand-author npc.pigeon and the npc.dog_loose grid with coat swap
- [SSP-193](../M6/SSP-193-workshop-liveries.md) Build WorkshopScene with upgrade purchases and Bessie livery ramp swaps
- [SSP-222](../M6/SSP-222-art-vehicles-m6.md) Art Pass 2: Blender renders for bin lorry, ice cream van, police and Sid's sweeper
- [SSP-242](../M7/SSP-242-reduce-flashing.md) Implement the Reduce flashing setting across HUD and world effects

## References

- ../../ART_BIBLE.md#56-ramp-swaps-per-instance-palette-variants
- ../../ART_BIBLE.md#102-timing-table
- ../../TECHNICAL_DESIGN.md#125-sprites-spritebatchts-spritestackts
- ../../ASSET_PIPELINE.md#61-manifest-assets-srcmanifestjson
- ../../ASSET_PIPELINE.md#93-packing-and-outputs

## Roadmap tasks covered

- `forge build`: `procedural` (tiles, roofs, facades, stains, fx frame generators), `ai-art` (crop, pixelize at the detected period, palette map, optional 4×4 Bayer), swaps (up to 8 per atlas).
