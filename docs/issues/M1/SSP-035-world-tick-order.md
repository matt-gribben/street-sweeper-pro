---
id: SSP-035
title: "Add World, EventQueue and fixed tick order with surface grip and kerb jolts"
milestone: M1
status: todo
type: feature
estimate: M
labels: [type:feature, area:sim, area:physics, area:test, size:M, vertical-slice]
depends_on: [SSP-028, SSP-029, SSP-030, SSP-032]
blocks: [SSP-036, SSP-038, SSP-043, SSP-049, SSP-057, SSP-058, SSP-061, SSP-062, SSP-063, SSP-065, SSP-080, SSP-089, SSP-093, SSP-290]
---

# SSP-035: Add World, EventQueue and fixed tick order with surface grip and kerb jolts

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** feature · **Size:** M · **Areas:** sim, physics, test · **Vertical slice**

## Summary

Create `src/sim/world.ts`: the owner of all shift state, a preallocated EventQueue and the canonical 11-phase tick order (phases 1, 2 and 11 real; 3 a call site that SSP-036 fills; 4–10 empty ordered calls). Add per-wheel surface sampling for grip and drag, and §8.2 step 9 kerb crossing.

## Context

World (TECHNICAL_DESIGN §7.1): `createWorld(level, seed, tuning)` takes a decoded level (`src/sim/map.ts` types), a seed and the tuning object (passed in, not imported implicitly, so the dev panel can supply an edited copy). It holds an integer tick counter, the vehicle state and the decoded grids. `prevX`/`prevY`/`prevHeading` are copied at the start of each tick. Renderers get read-only views.

`World.step(input)` phase order (§5.2) is canonical; changing it changes replay hashes:
1. Input: copy the InputFrame and append it to the replay log through a hook that SSP-038 fills
2. Vehicle (+ hopper)
3. Static collision (an empty call until SSP-036 lands)
4. Bodies
5. Brush/litter/water
6. Dirt
7. NPC
8. Traffic
9. Scoring/combo/complaints
10. Shift timer
11. Seal the EventQueue
Phases 4–10 are empty, ordered calls in M1.

EventQueue (§7.2): a preallocated struct-of-arrays ring, 512 events per tick. Fields: `type` Uint16, `entity` Int32, `a`/`b`/`c` Float64.
- `EV` const in M1: `Impact`, `KerbJolt`, `ReverseBeeper`, `ShiftEnd` (TOWED reason, stub). Later milestones add the rest of the §7.2 list.
- Events feed the replay hash.
- Overflow is a programmer error: throw a descriptive error (§21.4). The sim cannot read `import.meta.env`, so do not make this conditional on dev mode.

Surfaces (§8.2 step 7):
- `k` is the average lateral grip under the four wheel contact points, using the provisional wheel geometry from tuning (see SSP-029). Grip values from tuning: asphalt 9.0, pavement 8.0, grass 5.0. Hazard overrides (puddle, oil, wet leaves) are an M3 hook only. Points outside the map read as void (treat as asphalt grip; collision keeps Bessie out).
- Rolling drag ×2.5 on grass. OPEN: average per-wheel multipliers, or majority? Proposal: average. Flag it.

Kerb crossing (§8.2 step 9):
- When the front-axle midpoint crosses a tile edge carrying a KERB_EDGE bit (road ↔ pavement), apply `vLong *= 0.7` and emit `EV.KerbJolt`.
- A rear-axle crossing emits the jolt with no speed loss.
- Dropped kerbs (no KERB_EDGE) do nothing.
- Detect crossings from the previous and current axle-midpoint segment, deterministically (handle a segment crossing two edges in one tick).

Tests build levels directly with `encodeLevel`/hand-built typed arrays from SSP-032; they do not need the file compiler.

The sim never reads the render camera (§7.4). Zero allocations per tick.

## Scope

- src/sim/world.ts: World type, createWorld(level, seed, tuning), step(input) with the 11 phases in order
- EventQueue SoA (512/tick), EV const, per-tick reset and seal, iteration API for the app bus
- Per-wheel surface sampling → k and rollMult passed into stepVehicle
- Kerb crossing (front: 30% loss plus jolt; rear: jolt only), using the KERB_EDGE bits
- EV.ReverseBeeper emission from the vehicle's reverse-engage flag
- Read-only state view accessors for render/UI
- Unit tests: kerb crossing, surface selection, event queue lifecycle, determinism (two worlds, same inputs → identical state)

## Out of scope

- Static collision resolution and damage: SSP-036
- Replay serialisation and hashing: SSP-038
- world.viewRect, NPC/traffic/litter stores (M2/M3)

## Acceptance criteria

- [ ] Driving at 5 m/s across a raised kerb leaves vLong at 3.5 m/s ± 1e-9 immediately after the front-axle crossing (isolating drag, or accounting for it explicitly), with exactly one EV.KerbJolt, and the rear-axle crossing adds one jolt with no speed change
- [ ] Crossing a dropped kerb changes neither speed nor events
- [ ] With all four wheels on grass, k = 5.0 and rollMult = 2.5; with two on asphalt and two on pavement, k = 8.5
- [ ] The phases run in the documented order (verified via an optional phase-trace callback that is null by default)
- [ ] The EventQueue is empty at the start of every tick, and pushing a 513th event in one tick throws
- [ ] Two Worlds stepped with the same 3,600-tick input sequence end in bit-identical state

## Verification

- npm run typecheck
- npm run lint
- npm test -- world

## Dependencies

**Depends on:**

- [SSP-028](SSP-028-sim-foundations.md) Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type
- [SSP-029](SSP-029-tuning-data.md) Create tuning.json vehicle.sweeper block and typed src/sim/tuning.ts
- [SSP-030](SSP-030-vehicle-model.md) Implement Bessie's kinematic bicycle model in src/sim/vehicle.ts
- [SSP-032](SSP-032-level-map-codec.md) Add src/sim/map.ts compiled-level codec, tile/surface/collide ids and solid merge

**Blocks:**

- [SSP-036](SSP-036-static-collision.md) Resolve Bessie against static geometry with impact damage and TOWED stub
- [SSP-038](SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner
- [SSP-043](SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-049](SSP-049-m1-drive-replay.md) Record and commit the m1_drive_puddle_lane replay and its final-state hash
- [SSP-057](../M2/SSP-057-litter-field.md) Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn
- [SSP-058](../M2/SSP-058-hopper.md) Implement hopper.ts LU accounting, mass coupling and bulldozer state
- [SSP-061](../M2/SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats
- [SSP-062](../M2/SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event
- [SSP-063](../M2/SSP-063-scoring-combo.md) Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger
- [SSP-065](../M2/SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-080](../M3/SSP-080-npc-store-spawner.md) Add the NPC store, behaviour registry, spawner and phase 7 of the tick
- [SSP-089](../M3/SSP-089-traffic-lane-following.md) Implement traffic.ts: lane following, queuing behind Bessie, honk, Road Rage, bus stops
- [SSP-093](../M3/SSP-093-hazards-grip-jolts.md) Implement hazard grip overrides, jolts, LU spills and the open-manhole hard stop
- [SSP-290](../M3/SSP-290-tutorial-beats.md) Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events

## References

- ../../TECHNICAL_DESIGN.md#52-fixed-tick-order
- ../../TECHNICAL_DESIGN.md#71-world-and-stores
- ../../TECHNICAL_DESIGN.md#72-event-queue
- ../../TECHNICAL_DESIGN.md#82-per-tick-integration-phase-2
- ../../GDD.md#73-surfaces-and-terrain
- ../../ENTITY_CATALOG.md#32-collision-responses
- ../../ROADMAP.md#m1-drivable-bessie

## Roadmap tasks covered

- `src/sim/world.ts` and `map.ts`: tile types, building columns, surface lookups. [world.ts, surface lookups]
- `Fixed tick order steps 1–3 (input, vehicle, static collision) and step 11 (emit events). The other steps exist as empty, ordered calls.`
- `src/sim/vehicle.ts`: ... per-surface lateral grip decay ... [surface sampling part]
- `Measurable check: kerb crossing loses 30% speed.`
