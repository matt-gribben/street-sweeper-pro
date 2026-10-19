---
id: SSP-080
title: "Add the NPC store, behaviour registry, spawner and phase 7 of the tick"
milestone: M3
status: done
type: feature
estimate: M
labels: [type:feature, area:sim, area:ai-npc, area:test, area:perf, size:M, vertical-slice]
depends_on: [SSP-075, SSP-077, SSP-035, SSP-028, SSP-038, SSP-065]
blocks: [SSP-081, SSP-082, SSP-103, SSP-106, SSP-188, SSP-199, SSP-200, SSP-211, SSP-213, SSP-214, SSP-280]
---

# SSP-080: Add the NPC store, behaviour registry, spawner and phase 7 of the tick

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** sim, ai-npc, test, perf · **Vertical slice**

## Summary

Build the fixed-capacity NPC store, the table-driven behaviour interface, perception and stimulus plumbing, world.viewRect, and the deterministic population controller that spawns and retires NPCs. Wire it into tick phase 7 so behaviour modules have somewhere to run.

## Context

NpcStore (TECHNICAL_DESIGN §7.1) is struct-of-arrays with capacity 80: kind, state, stateTicks, x, y, prevX, prevY, heading, speed, targetNode, swap, flags (FALLEN, ON_ROOF, YIELDING...).
- Swap-remove; cross-entity links (the dog belonging to its walker) use generation-checked handles (index, gen).
- Sim state uses Float64Array; prev* copied with TypedArray.set at the start of each tick for render interpolation.

Behaviour interface (TECHNICAL_DESIGN §11.1): `{ initial, tick(w, i), onStimulus(w, i, s) }`, states as `as const` objects (no enums). Modules live in src/sim/npc/behaviours/<camelCase>.ts and are looked up by the entities.json `behaviour` key.
- Perception every 4 ticks, staggered by index mod 4, against Bessie's pose, velocity and predicted path 1.5 s ahead.
- Stimuli are pushed, not polled: Horn, Spray, Hit, NearMiss, HiVis, BeaconYield.

world.viewRect (TECHNICAL_DESIGN §7.4): if M1/M2 did not create it, add it now as a deterministic proxy, never the render camera: Bessie's position plus a sim-side look-ahead (up to 3.0 m along her heading, from sim state), expanded to ±28 × ±14.2 m. That rect ALREADY includes the 4 m margin LEVEL_DESIGN §9.4 asks for; do not add another. Spawn/despawn test the entity's full shape against it.

Spawner (LEVEL_DESIGN §9.4):
- Spawn points: map-edge pavement portals, frontage doors and anchors (nav node tags from SSP-076).
- Never spawn inside viewRect. Despawn beyond 40 m from Bessie (and outside viewRect), except named NPCs.
- Every 1.0 s (60 ticks) compare the live ambient count with the current population target and spawn or retire at most 2 ambient NPCs, picking types by `mix` within `caps`.
- Named NPCs spawn at their anchor at spawnAt (s × 60 ticks). Cat perches go on walls, parked car roofs or road (perch placement itself is SSP-087). Flocks count toward the 80 budget one bird at a time.

RNG: the `npc` stream, sfc32(seed ^ hash32('npc')). Add an NPC spatial hash for neighbour queries (the 4 m cell pattern from litter.ts is a good model). Phase 7 is NPC AI in TECHNICAL_DESIGN §5.2.

Zero allocations per tick: no closures, map or filter in per-tick loops; iterate stores by index only.

## Scope

- NpcStore in world.ts, allocated at shift start.
- world.viewRect proxy (if absent).
- Behaviour type, registry keyed by behaviour name, and a no-op default behaviour for tests.
- Preallocated stimulus queue and delivery API, plus staggered perception.
- Population controller, named NPC spawns and flocks, with viewRect-safe spawn and despawn; NPC spatial hash.
- Call phase 7 from World.step in the canonical position.
- Extend the test-hook state() with NPC kinds, positions and states.
- Create tests/unit/tickOrder.test.ts if missing (or extend it) to assert phase 7's position.
- Unit tests for capacity, swap-remove with generation handles, off-screen spawning and spawn-rate limits.

## Out of scope

- Steering and pathing (SSP-081).
- The shared reaction model (SSP-082).
- Per-type behaviours and rendering.

## Acceptance criteria

- [x] Unit test: across 3,600 ticks with population target 22, no NPC is ever spawned with its shape intersecting world.viewRect, and at most 2 ambient spawns or retirements happen per 60-tick window.
- [x] Unit test: swap-removing an NPC invalidates its old handle (generation check fails) and its slot is reused.
- [x] Unit test: a named NPC with spawnAt 70 appears on tick 4,200 at its anchor and is never despawned by distance.
- [x] Unit test: the store never exceeds 80 NPCs, flock birds included.
- [x] Unit test: perception for NPC i runs only on ticks where tick mod 4 == i mod 4.
- [x] tickOrder.test.ts: phase 7 runs after phase 6 (dirt) and before phase 8 (traffic).
- [x] The zero-allocation heap check passes with 80 NPCs active, and simPurity passes.

## Verification

- npm test
- npm run test:replay
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-075](SSP-075-entity-data-freeze.md) Freeze the Mon–Tue entity set in entities.json and add M3 shared tuning
- [SSP-077](SSP-077-compile-spawn-specs.md) Compile NPC, traffic, hazard, knockable and power-up spawn specs from level.json
- [SSP-035](../M1/SSP-035-world-tick-order.md) Add World, EventQueue and fixed tick order with surface grip and kerb jolts
- [SSP-028](../M1/SSP-028-sim-foundations.md) Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type
- [SSP-038](../M1/SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner
- [SSP-065](../M2/SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test

**Blocks:**

- [SSP-081](SSP-081-npc-steering.md) Implement NPC steering: seek, flee, separation, nav paths, zebra crossing
- [SSP-082](SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-103](SSP-103-render-actors-traffic.md) Draw NPCs, animals, traffic, knockables and hazards with state-driven frames
- [SSP-106](SSP-106-npc-stress-budget.md) Prove the NPC budget: 80 NPCs, 30 vehicles, 2,000 litter, allocation-free
- [SSP-188](../M6/SSP-188-upgrade-modifiers.md) Apply upg.* levels to the sim via tuning.ts modifiers and record loadout in replays
- [SSP-199](../M6/SSP-199-people-kids-jogger.md) Implement npc.jogger, npc.kid_skateboard, npc.kid_chalk and school_out/population_wave
- [SSP-200](../M6/SSP-200-dog-loose-seagull.md) Implement npc.dog_loose chase and npc.seagull chip theft and litter snatching
- [SSP-211](../M6/SSP-211-reveller-police.md) Implement npc.reveller, kicking_out, veh.police witness rule and police_parked
- [SSP-213](../M6/SSP-213-lollipop-crossing-parade.md) Implement npc.lollipop_lady, site.school_crossing, crossing_patrol and parade
- [SSP-214](../M6/SSP-214-inspector.md) Implement npc.inspector and the inspection event with frontage deductions
- [SSP-280](../M9/SSP-280-rival-ai-controller.md) Build Sid's Rival Sweep AI on the lane graph and LitterField

## References

- ../../TECHNICAL_DESIGN.md#71-world-and-stores
- ../../TECHNICAL_DESIGN.md#73-randomness
- ../../TECHNICAL_DESIGN.md#74-determinism
- ../../TECHNICAL_DESIGN.md#111-behaviour-system
- ../../TECHNICAL_DESIGN.md#52-fixed-tick-order
- ../../TECHNICAL_DESIGN.md#17-performance-budgets
- ../../LEVEL_DESIGN.md#94-npcs

## Roadmap tasks covered

- `Fill in tick order steps 4, 7 and 8. (step 7)`
