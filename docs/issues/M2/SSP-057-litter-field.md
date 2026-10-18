---
id: SSP-057
title: "Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn"
milestone: M2
status: todo
type: feature
estimate: L
labels: [type:feature, area:sim, area:perf, size:L, vertical-slice]
depends_on: [SSP-053, SSP-054, SSP-056, SSP-028, SSP-035, SSP-032, SSP-038]
blocks: [SSP-059, SSP-061, SSP-064, SSP-067, SSP-082, SSP-092, SSP-093, SSP-094, SSP-200, SSP-205, SSP-208, SSP-279]
---

# SSP-057: Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** feature · **Size:** L · **Areas:** sim, perf · **Vertical slice**

## Summary

Build `src/sim/litter.ts`: a fixed-capacity struct-of-arrays litter store with an incrementally maintained 4 m spatial hash, kinematic fling arcs and a wind drift hook, plus deterministic initial spawning from the compiled weight field on the `litter` stream.

## Context

Store (TECHNICAL_DESIGN §10.2, §7.1): fields `x, y, vx, vy, kind, flags (FLUNG, IN_SUCTION, PINNED), arcT, arcDur, rot`, plus `prevX/prevY` for render interpolation (copied at tick start with `TypedArray.set`). Capacity 2,000; sim state in `Float64Array`. Removal is swap-remove with the last live slot. Zero allocations per tick: preallocate everything; no `new`, array/object literals, closures or `map/filter` in per-tick code (TECHNICAL_DESIGN §17).
Spatial hash: 4 m cells; an item re-buckets only when it crosses a cell boundary. Brush query transforms the brush AABB to world space and visits only overlapped cells (typically 2–4). Iteration order must be deterministic (no unordered collections).
Fling: when told to fling (by brush.ts), give the item a kinematic arc 1.5–3 m sideways, side by the sign of its vehicle-local x; it is uncollectable until it lands (FLUNG). A flung `litter.glass_bottle` lands as `haz.broken_glass`; the hazard store arrives in M3 and Puddle Lane spawns no glass, so emit an event/hook only. Arc distance within 1.5–3 m is drawn from the `brush` stream (caller passes it). Use `src/sim/fmath.ts` for trig if M1 provides it.
Drift hook: a function applying 1.5 m/s for 4 s to drifting kinds (`litter.newspaper`, `litter.crisp_packet`). No caller until gusts in M6.
Spawn (LEVEL_DESIGN §9.1): stream `sfc32(seed ^ hash32('litter'))`. Weighted sampling without replacement over 0.5 m sub-cells in fixed row-major order, `minSpacingM` (default 0.5 m) between items, at most 6 items per tile; type from `litter.table` filtered by constraints (`leaf_pile` only within 4 m of `prop.tree`; `bin_bag` only within 2 tiles of a kerb; `dog_mess` only on pavement and grass); rotation 0–3 (h00/h08/h16/h24) from the same stream. Maintain `litterSpawned` (initial + dynamic) and `litterCollected` for Tidy %. Dynamic litter uses the same add API later.

## Scope

- `src/sim/litter.ts` store, spatial hash, add/remove/query APIs, arc integration, drift hook
- Shift-start spawner reading the compiled weight field
- `litterSpawned` / `litterCollected` counters exposed read-only
- Unit and fast-check property tests

## Out of scope

- Brush contact, suction and the fling roll (brush)
- Rendering (SSP-067)
- Bin bag burst, banana spin-out, hazards from glass (later milestones)

## Acceptance criteria

- [ ] Property test: for random item sets and random AABBs, the hash query returns exactly the items a brute-force scan finds
- [ ] An item moving inside one cell is not re-bucketed; crossing a boundary moves it to the new cell (unit test)
- [ ] Swap-remove keeps the hash consistent (property test over random add/remove sequences)
- [ ] Spawning Puddle Lane with the same seed twice gives identical stores; a different seed gives a different layout; count equals `litter.initial` (130)
- [ ] Spawned items respect minSpacingM 0.5 m, ≤ 6 per tile and the type constraints (unit test)
- [ ] A flung item lands 1.5–3 m sideways on the side given by the sign of its local x and is uncollectable until it lands
- [ ] No `new`, literals, closures or map/filter inside per-tick functions (code review; heap test in SSP-065)

## Verification

- npx vitest run tests/unit/litter.test.ts tests/property/litter.prop.test.ts
- npm test
- npm run test:replay
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-053](SSP-053-entities-tuning-seed.md) Seed entities.json with litter, stains and pickups; add M2 values to tuning.json
- [SSP-054](SSP-054-compile-route-grime-litter-layers.md) Extend compile-level.ts with route, grime density, gutter and litter weight layers
- [SSP-056](SSP-056-puddle-lane-sweeping-content.md) Author Puddle Lane litter, grime, frontages, pledges and collectibles data
- [SSP-028](../M1/SSP-028-sim-foundations.md) Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type
- [SSP-035](../M1/SSP-035-world-tick-order.md) Add World, EventQueue and fixed tick order with surface grip and kerb jolts
- [SSP-032](../M1/SSP-032-level-map-codec.md) Add src/sim/map.ts compiled-level codec, tile/surface/collide ids and solid merge
- [SSP-038](../M1/SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner

**Blocks:**

- [SSP-059](SSP-059-brush.md) Implement brush.ts state machine, suction, inlet collection and fling roll
- [SSP-061](SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats
- [SSP-064](SSP-064-tidy-frontages.md) Compute Tidy %, per-frontage clean % and Clean Sweep bonuses incrementally
- [SSP-067](SSP-067-items-sprite-batch.md) Render litter, stains and site markers via the items instance batch
- [SSP-082](../M3/SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-092](../M3/SSP-092-knockable-bodies.md) Implement bodies.ts knockable impulse bodies with spills and penalties
- [SSP-093](../M3/SSP-093-hazards-grip-jolts.md) Implement hazard grip overrides, jolts, LU spills and the open-manhole hard stop
- [SSP-094](../M3/SSP-094-puddle-splash-broken-glass.md) Add puddle splash penalties and broken glass from flung bottles
- [SSP-200](../M6/SSP-200-dog-loose-seagull.md) Implement npc.dog_loose chase and npc.seagull chip theft and litter snatching
- [SSP-205](../M6/SSP-205-wind-leaves-gusts.md) Implement leaf fall, wet leaves and haz.wind_gust litter drift
- [SSP-208](../M6/SSP-208-rival-sweeper-cameo.md) Implement veh.rival_sweeper Friday cameo and the rival_cameo event
- [SSP-279](../M9/SSP-279-rival-sweeper-sim.md) Give Spotless Sid a full sweeper in the sim: handling, brush, hopper, dumping

## References

- ../../TECHNICAL_DESIGN.md#102-litterfield-srcsimlitterts
- ../../TECHNICAL_DESIGN.md#71-world-and-stores
- ../../TECHNICAL_DESIGN.md#73-randomness
- ../../TECHNICAL_DESIGN.md#74-determinism
- ../../TECHNICAL_DESIGN.md#17-performance-budgets
- ../../LEVEL_DESIGN.md#91-litter
- ../../ENTITY_CATALOG.md#42-behaviours-and-brush-up-rules
- ../../../CLAUDE.md#51-typescript

## Roadmap tasks covered

- `src/sim/litter.ts`: struct-of-arrays store, 4 m spatial hash, kinematic fling arc (1.5–3 m sideways), wind drift hook (used by `litter.newspaper` and `litter.crisp_packet` later).
