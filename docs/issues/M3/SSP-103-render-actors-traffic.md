---
id: SSP-103
title: "Draw NPCs, animals, traffic, knockables and hazards with state-driven frames"
milestone: M3
status: done
type: feature
estimate: L
labels: [type:feature, area:render, area:test, size:L, vertical-slice]
depends_on: [SSP-080, SSP-089, SSP-090, SSP-092, SSP-093, SSP-087, SSP-086, SSP-104, SSP-097, SSP-098, SSP-099, SSP-100, SSP-101, SSP-018, SSP-067, SSP-297]
blocks: [SSP-106, SSP-109, SSP-118, SSP-136]
---

# SSP-103: Draw NPCs, animals, traffic, knockables and hazards with state-driven frames

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** L · **Areas:** render, test · **Vertical slice**

## Summary

Extend spriteBatch so the street is visible: NPC and animal frames picked from sim state and stateTicks, traffic on its 32 headings, the cat riding on Bessie, the dog lead as a 1 px line, and knockables and hazard decals in their layers, all inside the existing draw-call budget. Add the entities.json sprite-resolution test.

## Context

TECHNICAL_DESIGN §12.5:
- Flat textured quads, one InstancedMesh per atlas, per-instance offset, rotation, frameRect (from FRAME), pivot, swap (uint8), flags.
- Layers: decals/stains 2, litter/pickups 3, drop shadows 4, pedestrians/animals 5, traffic 6, Bessie 7, brush 8, cat riding on roof 9, fx 10. sortBias grows with y_sim − camY_sim.
- Drop shadows +2,+2 px into the mask; cats on walls and car roofs use +3,+3 (proposed, ART_BIBLE §8.3).
- Ramp swaps: R8 index atlas and 32×8 swap texture. Shopper outfits from NpcStore.swap, car paint from the vehicle swap slot; unique characters slot 0; the walker's dog uses a coat slot.

Frame selection, from sim ticks only (ART_BIBLE §10):
- Walk is distance-driven: one frame per 0.30 m (adults), 0.18 m (Doris), 0.15 m (old man), 0.12 m (cat), 0.35 m (dog).
- Idle: 36 ticks per frame with a per-instance phase from the render-side seeded RNG.
- Startle, fall, angry and leap timings per §10.2 (fall: 3 × 5 ticks then hold frame 2).
- Directions: 8 sectors for humans/cats/dogs (10° hysteresis proposed), 4 for pigeons, h00–h31 for vehicles (2° hysteresis proposed). Heading 90° → dir e / h08.
- Interpolate with prevX/prevY and alpha, shortest arc for angles.

Cat on roof: sit frames on layer 9 at Bessie's roof, offset in her local frame.
Dog lead (ART_BIBLE §8.3): 1 px line in index 18 postbox_red from the walker's hand to the dog's collar, +2,+2 drop shadow, readable on asphalt and slab. It must fit an existing batch (e.g. thin quads in the actors batch); flag the approach.
Knockables and stacks go in the items batch; hazard decals at layer 2 with the world atlas; parked cars at their fixed heading.
Culling: query the sim spatial hashes with the camera ground rect plus 4 m.
Draw calls ≤ 10 (9 allocated).

Sprite resolution (ENTITY_CATALOG §15): add a unit test that every entities.json `sprite` is an AssetId in src/gen/assets.ts; all placeholder-* issues have landed by now. SSP-075 left a `PENDING_PLACEHOLDER_SPRITES` list in tests/unit/entityCatalog.test.ts (the M3 sprites SSP-097 to SSP-101 add, which it tolerates while unresolved): delete it so every non-site sprite must resolve.

Ramp-swap status in M3: SSP-297 provides the R8 index atlases and a 32x8 swap texture that stays identity until SSP-114 (M4) fills the tables. This issue writes the correct per-instance `swap` index: the shopper outfit from NpcStore.swap, the hatchback/saloon paint slot from the vehicle store, slot 0 for unique characters, and the coat slot for the walker's dog. All slots render identically until M4.

## Scope

- Actors-batch instances for NpcStore and VehicleStore with unit-tested state-to-frame mapping functions.
- Cat on Bessie's roof (layer 9) and the dog lead line with its shadow.
- Knockable, parked car and hazard decal instances.
- Per-instance swaps and interpolation; culling via spatial hashes.
- entities.json sprite-resolution unit test.
- Puddle Lane screenshot check via test hooks, reviewed with Read.
- Write the per-instance `swap` attribute from NpcStore.swap and the vehicle paint slot (identity tables until SSP-114)

## Out of scope

- Juice (M7).
- Speech bubbles.
- Final art.
- Visible outfit, paint and coat colourways (swap tables are filled by SSP-114, M4)

## Acceptance criteria

- [ ] Unit test: frameFor(Fallen, stateTicks 7) returns fall frame 1; at stateTicks 20 it returns the held frame 2.
- [ ] Unit test: walk frames advance once per 0.30 m travelled for an adult, independent of speed.
- [ ] Unit test: heading 90° maps to dir e for actors and h08 for vehicles.
- [ ] Unit test: every entities.json `sprite` resolves to an AssetId.
- [ ] perf.spec.ts (`ci` project) reports ≤ 10 draw calls with NPCs, traffic, knockables and hazards on screen.
- [ ] A capture of `?test=1&seed=1&scene=district.puddle_lane&tick=7800&freeze=1` (with __ssp.setCamera pinned where needed) was opened with Read: pedestrians, a cat, moving and parked cars, the dog lead and puddle decals are visible and correctly layered (noted in the PR).
- [ ] Existing visual goldens pass, or changes are approved after Read with a stated reason.
- [ ] Unit test: a shopper instance's `swap` attribute equals its NpcStore.swap, a moving or parked hatchback/saloon instance's equals its seeded paint slot, and unique characters use slot 0.

## Verification

- npm test
- npm run test:visual
- npm run test:e2e
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-080](SSP-080-npc-store-spawner.md) Add the NPC store, behaviour registry, spawner and phase 7 of the tick
- [SSP-089](SSP-089-traffic-lane-following.md) Implement traffic.ts: lane following, queuing behind Bessie, honk, Road Rage, bus stops
- [SSP-090](SSP-090-traffic-parked-collision.md) Add parked cars and Bessie-vs-vehicle collision with dent and impact rules
- [SSP-092](SSP-092-knockable-bodies.md) Implement bodies.ts knockable impulse bodies with spills and penalties
- [SSP-093](SSP-093-hazards-grip-jolts.md) Implement hazard grip overrides, jolts, LU spills and the open-manhole hard stop
- [SSP-087](SSP-087-behaviour-cat.md) Implement the cat: perch, dart on approach, groom, bolt, and ride Bessie's roof
- [SSP-086](SSP-086-behaviour-dog-walker.md) Implement the dog walker with a lead line obstacle, Lead Tangle and dog mess drops
- [SSP-104](SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up
- [SSP-097](SSP-097-placeholder-human-grids-mon.md) Author placeholder grids for the six Monday human NPCs (24×24, 13 frames/dir)
- [SSP-098](SSP-098-placeholder-human-grids-tue.md) Author placeholder grids for businessman, litterbug and market trader
- [SSP-099](SSP-099-placeholder-animal-grids.md) Author placeholder grids for the cat, pigeon and dog (npc.dog_loose grid)
- [SSP-100](SSP-100-placeholder-vehicle-renders.md) Render placeholder traffic vehicles in Blender as primitive boxes at 32 headings
- [SSP-101](SSP-101-placeholder-props-hazards.md) Add placeholder sprites for knockables, hazards, SSP-096 and High Street props
- [SSP-018](../M0/SSP-018-sprite-batch.md) Draw Bessie (32 headings) and the pedestrian via instanced sprite batches
- [SSP-067](../M2/SSP-067-items-sprite-batch.md) Render litter, stains and site markers via the items instance batch
- [SSP-297](../M1/SSP-297-r8-index-atlases-swap-texture.md) Convert actors/items atlases to R8 index textures with an identity 32x8 swap texture

**Blocks:**

- [SSP-106](SSP-106-npc-stress-budget.md) Prove the NPC budget: 80 NPCs, 30 vehicles, 2,000 litter, allocation-free
- [SSP-109](SSP-109-close-m3.md) Close M3: verify the exit criteria, sync docs, state the frozen entity list, tag m3
- [SSP-118](../M4/SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-136](../M4/SSP-136-char-postie-dog-walker.md) Final npc.postie and npc.dog_walker

## References

- ../../TECHNICAL_DESIGN.md#125-sprites-spritebatchts-spritestackts
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../ART_BIBLE.md#102-timing-table
- ../../ART_BIBLE.md#83-people-and-animals
- ../../ART_BIBLE.md#45-directions-and-headings
- ../../ART_BIBLE.md#56-ramp-swaps-per-instance-palette-variants
- ../../ENTITY_CATALOG.md#15-entitiesjson-shape

## Roadmap tasks covered

- `Exit (canonical): reaction animations (placeholders allowed)`
- `Deliverable: Reaction animations: ... every state (walk, idle, startle, fall, angry) exists as frames under the final frame IDs. (runtime use)`
