---
id: SSP-018
title: "Draw Bessie (32 headings) and the pedestrian via instanced sprite batches"
milestone: M0
status: todo
type: feature
estimate: L
labels: [type:feature, area:render, size:L, vertical-slice]
depends_on: [SSP-016, SSP-010, SSP-014]
blocks: [SSP-019, SSP-039, SSP-046, SSP-297, SSP-067, SSP-069, SSP-284, SSP-103, SSP-298, SSP-113, SSP-118]
---

# SSP-018: Draw Bessie (32 headings) and the pedestrian via instanced sprite batches

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** feature · **Size:** L · **Areas:** render · **Vertical slice**

## Summary

Implement `spriteBatch.ts`: one InstancedMesh per atlas, with flat quads at y = 0 reading per-instance frame rects from the generated FRAME table. Draw the Blender-built Bessie cycling all 32 headings, plus the ingested pedestrian, with +2,+2 px drop shadows into the mask.

## Context

Sprites are textured quads LYING FLAT at y = 0 (not billboards), so they share the ground's 1:1 projection.

Layer order uses a clip-space depth offset: `gl_Position.z -= (layer * 8.0 + sortBias) * 1e-5 * gl_Position.w;`. Layers:
- ground 0, building shadows 1, decals 2, litter/pickups 3, drop shadows 4;
- pedestrians/animals 5, traffic 6, Bessie body (veh.sweeper) 7, brush overlay (veh.sweeper_brush) 8;
- cat on roof 9, fx 10.
Within a layer, sortBias ∈ [0,1) grows with (y_sim − camY_sim), so southern actors draw on top. Alpha is binary (alpha test), so no transparency sorting.

Per-instance attributes: offset (vec3), rotation, frameRect (vec4 from FRAME), pivot, swap (uint8), flags. Size instance buffers to capacity once; one needsUpdate per batch per frame; no per-frame allocations.

Atlas load (`public/assets/atlas/<name>.png/json`, URLs relative to `import.meta.env.BASE_URL`): a non-palette pixel is a load-time error. Recommended: implement the documented R8 index-texture path (exact hex → index at load) with an identity 32x8 swap texture, since the swap slots themselves are M4. If you sample RGBA directly instead, keep the load-time palette check and say so in the PR.

Frames: reference them via the typed `FRAME` const from src/gen/assets.ts (e.g. `FRAME['veh.sweeper:body:h07:0']`). Build the 32 heading IDs from a typed table, not from unchecked string assembly.
- Heading → frame: `((round(θ / (2π/32)) % 32) + 32) % 32` → h00…h31, h00 = north, clockwise 11.25°. Forward is (sin θ, −cos θ).
- Pivots come from the atlas JSON px/py: body centre for vehicles (32,32 in a 64 cell; 48,48 for the 96 brush); feet for people.

Drop shadows: the same silhouette offset +2,+2 px SE (0.125 m), one instanced draw able to sample either atlas (per-instance selector), writing R = 1 to the mask (layer 4).

Spike content:
- Bessie body cycling all 32 headings, driven by a render-frame counter so test mode can freeze it deterministically;
- the brush overlay (layer 8, 4 spin frames);
- the npc.old_woman pedestrian (from SSP-014).
Budget: actors + drop shadows add 2 draw calls (≤ 10 total). Once the pedestrian shows in-engine beside Bessie, add the in-engine evidence line to ROADMAP §8 D-04.

SSP-297 delivers the R8 index-texture path and the 32x8 swap texture, and SSP-067, SSP-103 and SSP-114 depend on it. If this spike already implements them, keep the code; that issue then adds the atlas-JSON swap parsing and the tests. RGBA sampling with the load-time palette check is still acceptable for the M0 spike.

## Scope

- src/render/spriteBatch.ts (InstancedMesh per atlas, flat quads, layer/sortBias shader, frameRect from FRAME)
- Atlas loading (PNG + JSON) with a load-time palette check (R8 path recommended)
- Drop-shadow instanced draw into the mask
- Spike: Bessie + brush cycling h00..h31, the pedestrian nearby
- Unit tests: heading → frame mapping, sortBias ordering, palette-check failure
- Add the in-engine evidence line to D-04

## Out of scope

- Sprite stacks (SSP-020)
- Culling via the sim spatial hash (M2+)
- Swap slot tables (M4)
- Interpolation from sim state (M1)

## Acceptance criteria

- [ ] Unit tests: θ = 0 → h00, θ = π/2 → h08, θ = −11.25° → h31, θ = 2π → h00, θ = 5.6° → h00, θ = 5.7° → h01
- [ ] Unit test: of two actors in the same layer, the one with the larger y_sim gets the larger sortBias
- [ ] Unit/integration test: loading an atlas with a non-palette pixel throws at load time
- [ ] In the dev build Bessie visibly cycles 32 distinct headings with a stable centre pivot, and the brush spins (screenshots under build/, opened with Read)
- [ ] The pedestrian renders at 1:1 beside Bessie; drop shadows sit +2,+2 px SE and are remapped through shadow[32]
- [ ] renderer.info.render.calls ≤ 10 in the spike
- [ ] ROADMAP §8 D-04 evidence includes the in-engine screenshot path
- [ ] npm run typecheck, lint and test pass

## Verification

- npm test
- npm run typecheck
- npm run lint
- npm run dev, capture screenshots to build/ and Read them

## Dependencies

**Depends on:**

- [SSP-016](SSP-016-palette-pass.md) Implement the MRT world target and palette pass (64³ OKLab LUT, night/shadow remap)
- [SSP-010](SSP-010-forge-pack-verify.md) Add deterministic atlas packing, generated assets.ts, asset-hashes.json and forge verify
- [SSP-014](SSP-014-people-style-acceptance.md) Accept ref.people_style and ingest the spike pedestrian grid (D-04, D-13)

**Blocks:**

- [SSP-019](SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-039](../M1/SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end
- [SSP-046](../M1/SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie
- [SSP-297](../M1/SSP-297-r8-index-atlases-swap-texture.md) Convert actors/items atlases to R8 index textures with an identity 32x8 swap texture
- [SSP-067](../M2/SSP-067-items-sprite-batch.md) Render litter, stains and site markers via the items instance batch
- [SSP-069](../M2/SSP-069-bitmap-text.md) Implement src/ui/bitmapText.ts and the UI render pass
- [SSP-284](../M2/SSP-284-boot-scene.md) Add BootScene: load atlases, fonts and the palette LUT once, then hand off to the shift flow
- [SSP-103](../M3/SSP-103-render-actors-traffic.md) Draw NPCs, animals, traffic, knockables and hazards with state-driven frames
- [SSP-298](../M3/SSP-298-zoo-scene-review.md) Add a minimal test-only ZooScene for in-engine review of actors and items frames
- [SSP-113](../M4/SSP-113-forge-pack-atlases.md) Lock atlas trimming and the 1 px gutter, cover all five atlases and add the fill-ratio report
- [SSP-118](../M4/SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review

## References

- ../../TECHNICAL_DESIGN.md#125-sprites-spritebatchts-spritestackts
- ../../TECHNICAL_DESIGN.md#4-coordinate-systems-and-units
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../ASSET_PIPELINE.md#93-packing-and-outputs
- ../../ART_BIBLE.md#64-shadows
- ../../ROADMAP.md#8-m0-spike-decision-log
- ../../../CLAUDE.md#51-typescript

## Roadmap tasks covered

- `src/render/spriteBatch.ts`: one `InstancedMesh` per atlas, per-instance frame rects. Bessie drawn from the Blender build at all 32 headings, cycling. One ingested pedestrian.
