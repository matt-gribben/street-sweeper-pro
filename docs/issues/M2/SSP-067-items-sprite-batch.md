---
id: SSP-067
title: "Render litter, stains and site markers via the items instance batch"
milestone: M2
status: done
type: feature
estimate: M
labels: [type:feature, area:render, area:perf, size:M, vertical-slice]
depends_on: [SSP-057, SSP-051, SSP-052, SSP-061, SSP-065, SSP-018, SSP-008, SSP-043, SSP-297]
blocks: [SSP-074, SSP-096, SSP-103, SSP-298, SSP-113, SSP-118, SSP-139]
---

# SSP-067: Render litter, stains and site markers via the items instance batch

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** feature · **Size:** M · **Areas:** render, perf · **Vertical slice**

## Summary

Extend `src/render/spriteBatch.ts` with an `items` atlas InstancedMesh that draws every visible litter item with its rotation frame and suction wobble, plus stains, the hydrant and skip markers, and drive the brush overlay spin from RPM, so the player can see what they are sweeping.

## Context

Sprites (TECHNICAL_DESIGN §12.5): actors and items are flat textured quads at y = 0 (not billboards), one InstancedMesh per atlas, per-instance `offset`, `rotation`, `frameRect` (from `FRAME`), `pivot`, `swap`, `flags`. Layer order is a clip-space depth offset: `gl_Position.z -= (layer * 8.0 + sortBias) * 1e-5 * gl_Position.w;` with layers ground 0, building shadows 1, road decals/stains 2, litter/pickups 3, drop shadows 4, … Bessie body 7, brush overlay 8. Alpha-tested, no transparency sort. The items atlas is converted to an R8 index texture at load.
Litter frames: rotation is a frame choice, not an instance rotation: `litter.<name>:idle:h00|h08|h16|h24:0` from the store's `rot`. Wobble (ART_BIBLE §10.2): 2 frames, 12 ticks each, while IN_SUCTION (wind/gust later); otherwise `idle`. Interpolate positions with prevX/prevY and the render alpha. Flung items draw at their arc position (still flat at y = 0).
Culling: query the litter spatial hash with the camera's ground rect plus a 4 m margin; write only visible instances; instance buffers sized to capacity once; one `needsUpdate` per batch per frame; no per-frame allocations.
Draw calls (TECHNICAL_DESIGN §12.7): items atlas = draw #5 in a total ≤ 10. Open question: stains are `world`-atlas decals on layer 2, but the allocation table has no stain draw. Options: per-instance atlas selection in the items draw, packing stain frames into `items`, or drawing stains in the city mesh pass. Choose, document in TECHNICAL_DESIGN §12.5/§12.7 (and ASSET_PIPELINE §9.3 if the atlas changes), and stay ≤ 10 calls.
Also draw static flat markers from the compiled level: `prop.hydrant` and `site.skip` placeholders (items), and depot bay markings. Brush overlay (`veh.sweeper_brush`, M0 Blender asset, layer 8): 4 spin frames at 3 ticks per frame at 100% RPM scaled by 1/RPM, frozen on frame 0 below 10% RPM (ART_BIBLE §10.2).
Evidence: no M2 golden covers items (`zoo` is M4). Capture frozen frames with `tests/e2e/helpers/saveFrame.ts` (create it if missing) at `/?test=1&seed=1&scene=district.puddle_lane&freeze=1` and Read them.

## Scope

- Items InstancedMesh with litter frames, wobble and interpolation
- Spatial-hash culling of visible litter
- Stain rendering approach within the draw-call budget, documented
- Static hydrant/skip/depot-bay markers and RPM-driven brush overlay frames
- Frozen-frame evidence

## Out of scope

- Power-up and collectible rendering (M3 spawns them)
- Sprite stacks for tall props beyond what M0/M1 delivered
- Fling debris particles and VFX (M3)

## Acceptance criteria

- [ ] A frozen frame at Puddle Lane start shows litter in all four rotations, hydrants and the skip (frame Read and attached)
- [ ] Unit test on the frame-selection helper: an IN_SUCTION item alternates wobble frames 0/1 every 12 ticks; otherwise idle; rot 0..3 maps to h00/h08/h16/h24
- [ ] Unit test on the culling helper: only items inside the camera rect + 4 m are written to the instance buffer
- [ ] Brush overlay frame index follows the 3-ticks-per-frame/RPM rule and is frozen at frame 0 below 10% RPM (unit test)
- [ ] Draw calls stay ≤ 10 with litter and stains on screen
- [ ] No `new` or array/object literals in the batch update path
- [ ] Existing visual goldens still pass

## Verification

- npx vitest run tests/unit/itemsBatch.test.ts
- npm run test:e2e  # frozen frames saved to test-results/, then Read them
- npm run test:visual
- npm run typecheck && npm run lint && npm test

## Dependencies

**Depends on:**

- [SSP-057](SSP-057-litter-field.md) Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn
- [SSP-051](SSP-051-placeholder-litter-sprites.md) Author placeholder grids for all 15 litter IDs and add the items atlas
- [SSP-052](SSP-052-placeholder-stains-pickups-sites.md) Add stain generator, grime overlays and pickup/collectible/site/hydrant grids
- [SSP-061](SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats
- [SSP-065](SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-018](../M0/SSP-018-sprite-batch.md) Draw Bessie (32 headings) and the pedestrian via instanced sprite batches
- [SSP-008](../M0/SSP-008-blender-bessie.md) Port the probe sweeper onto rig.py and commit Bessie body, dented and brush renders
- [SSP-043](../M1/SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-297](../M1/SSP-297-r8-index-atlases-swap-texture.md) Convert actors/items atlases to R8 index textures with an identity 32x8 swap texture

**Blocks:**

- [SSP-074](SSP-074-close-m2.md) Close M2: verify exit criteria, record decisions and tag m2
- [SSP-096](../M3/SSP-096-power-ups.md) Spawn power-ups on pavements, implement all six pwr.* effects, draw them
- [SSP-103](../M3/SSP-103-render-actors-traffic.md) Draw NPCs, animals, traffic, knockables and hazards with state-driven frames
- [SSP-298](../M3/SSP-298-zoo-scene-review.md) Add a minimal test-only ZooScene for in-engine review of actors and items frames
- [SSP-113](../M4/SSP-113-forge-pack-atlases.md) Lock atlas trimming and the 1 px gutter, cover all five atlases and add the fill-ratio report
- [SSP-118](../M4/SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-139](../M4/SSP-139-litter-sheet-01.md) Accept litter.sheet_01, ingest 6 items, hand-draw the can and butts

## References

- ../../TECHNICAL_DESIGN.md#125-sprites-spritebatchts-spritestackts
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../ART_BIBLE.md#102-timing-table
- ../../ENTITY_CATALOG.md#4-rubbish-litter
- ../../ART_BIBLE.md#71-size-sheet-locked
- ../../ASSET_PIPELINE.md#93-packing-and-outputs

## Roadmap tasks covered

- `src/render/spriteBatch.ts`: an `items` atlas instance batch for litter. Per-instance 4 rotations and the 2-frame wobble.
