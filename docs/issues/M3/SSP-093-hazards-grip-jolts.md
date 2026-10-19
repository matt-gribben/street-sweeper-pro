---
id: SSP-093
title: "Implement hazard grip overrides, jolts, LU spills and the open-manhole hard stop"
milestone: M3
status: done
type: feature
estimate: M
labels: [type:feature, area:sim, area:physics, area:gameplay, area:test, size:M, vertical-slice]
depends_on: [SSP-075, SSP-077, SSP-030, SSP-035, SSP-058, SSP-059, SSP-057]
blocks: [SSP-094, SSP-103, SSP-104, SSP-106, SSP-155, SSP-176, SSP-180, SSP-202, SSP-204, SSP-205]
---

# SSP-093: Implement hazard grip overrides, jolts, LU spills and the open-manhole hard stop

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** sim, physics, gameplay, test · **Vertical slice**

## Summary

Add the hazard store and shift-start spawning, and wire hazard footprints into vehicle.ts and world.ts. Puddles, oil and wet leaves override grip; potholes and fast speed bumps jolt Bessie and spill hopper LU behind her; open manholes cost HP and stop her dead.

## Context

ENTITY_CATALOG §10 and TECHNICAL_DESIGN §8.2:

Grip overrides (lateral grip k): hazard footprints override the surface: haz.puddle 4.0, haz.oil_slick 1.2, haz.wet_leaves 3.0 (asphalt 9.0, pavement 8.0). upg.tyres ×1.15 arrives in M6: read it through the tuning modifier.

Jolts (one per crossing episode, so effects never repeat every tick):
- haz.pothole: −2 HP and spills 2 LU from the hopper BEHIND Bessie as small litter items. Event for bump_kerb.
- haz.speed_bump (ground tile variant from `=`): above 6 m/s spills 3 LU; at or below 6 m/s nothing.
- haz.open_manhole (within roadworks, ringed by prop.roadworks_barrier): −10 HP and a hard stop (vLong = 0). Event for crash.

LU spills reduce hopperLU (never below 0) and spawn items from the district small-litter table behind the vehicle via litter.ts; they count toward litter spawned.

haz.oil_slick and stain.oil always share one tile; spraying the slick gives the +30 stain award once (M2 water and stains).

haz.wet_leaves creation: driving brush-up through litter.leaf_pile leaves haz.wet_leaves (ENTITY_CATALOG §4.2). Implement the hook (spawn at the pile's tile) with a unit test; no M3 level places leaf piles.

Capacity: 64 hazards. Spawn at shift start from compiled `hazards.place` and `hazards.random` with the `hazards` sfc32 stream. Rules (LEVEL_DESIGN §9.3): kerbside_low_points (puddles beside drains and kerbs), carriageway (potholes in wheel tracks, never on zebras), near_parking (oil within 2 tiles of bays); never within 3 tiles of @, on a zebra, in a depot bay or next to a hydrant.

Footprint: 32×32 px ground decal (2 × 2 m); exact shape unspecified, use the tile.

Puddle splash and broken glass are SSP-094.

## Scope

- HazardStore and shift-start spawning from compiled specs.
- Hazard surface overrides in the surface lookup used by vehicle.ts grip.
- Pothole, speed bump and open manhole jolts with HP changes, hard stop and LU spill; events.
- Leaf-pile brush-up → haz.wet_leaves hook.
- tests/unit/hazards.test.ts and a property test over seeds.

## Out of scope

- haz.wind_gust (M6).
- Puddle splash and broken glass (separate issue).
- Hazard art (SSP-101).

## Acceptance criteria

- [x] Test: with Bessie's wheels on haz.oil_slick the grip k used is 1.2; on a puddle 4.0; on wet leaves 3.0.
- [x] Test: crossing a pothole costs exactly 2 HP and moves exactly 2 LU from the hopper into litter items behind Bessie, once per crossing.
- [x] Test: a speed bump at 6.5 m/s spills 3 LU; at 6.0 m/s it spills 0.
- [x] Test: entering an open manhole sets vLong to 0 and costs 10 HP.
- [x] Test: driving brush-up through a leaf pile creates one haz.wet_leaves.
- [x] Property test over seeds: no randomly placed hazard lies within 3 tiles of @, on a zebra, in a depot bay or next to a hydrant; hopper LU stays ≥ 0 and HP in [0, 100].

## Verification

- npm test
- npm run test:replay
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-075](SSP-075-entity-data-freeze.md) Freeze the Mon–Tue entity set in entities.json and add M3 shared tuning
- [SSP-077](SSP-077-compile-spawn-specs.md) Compile NPC, traffic, hazard, knockable and power-up spawn specs from level.json
- [SSP-030](../M1/SSP-030-vehicle-model.md) Implement Bessie's kinematic bicycle model in src/sim/vehicle.ts
- [SSP-035](../M1/SSP-035-world-tick-order.md) Add World, EventQueue and fixed tick order with surface grip and kerb jolts
- [SSP-058](../M2/SSP-058-hopper.md) Implement hopper.ts LU accounting, mass coupling and bulldozer state
- [SSP-059](../M2/SSP-059-brush.md) Implement brush.ts state machine, suction, inlet collection and fling roll
- [SSP-057](../M2/SSP-057-litter-field.md) Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn

**Blocks:**

- [SSP-094](SSP-094-puddle-splash-broken-glass.md) Add puddle splash penalties and broken glass from flung bottles
- [SSP-103](SSP-103-render-actors-traffic.md) Draw NPCs, animals, traffic, knockables and hazards with state-driven frames
- [SSP-104](SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up
- [SSP-106](SSP-106-npc-stress-budget.md) Prove the NPC budget: 80 NPCs, 30 vehicles, 2,000 litter, allocation-free
- [SSP-155](../M4/SSP-155-vfx-reactions.md) Procedural VFX for reactions and damage: impact star, cough, anger, smoke
- [SSP-176](../M5/SSP-176-sfx-event-wiring.md) Wire sim events to sfx cues through a pure audio director
- [SSP-180](../M5/SSP-180-engine-synth.md) Implement engineSynth.ts: Bessie's diesel with load, misfire and tyre squeal
- [SSP-202](../M6/SSP-202-rain-weather.md) Implement rain: road grip 6.0, puddle density, rain FX and amb.rain hookup
- [SSP-204](../M6/SSP-204-district-gasworks.md) Author and compile district.gasworks (Wednesday, rain) with its district replay
- [SSP-205](../M6/SSP-205-wind-leaves-gusts.md) Implement leaf fall, wet leaves and haz.wind_gust litter drift

## References

- ../../ENTITY_CATALOG.md#10-hazards-haz
- ../../ENTITY_CATALOG.md#42-behaviours-and-brush-up-rules
- ../../TECHNICAL_DESIGN.md#82-per-tick-integration-phase-2
- ../../LEVEL_DESIGN.md#93-stains-and-hazards
- ../../LEVEL_DESIGN.md#78-ramps-and-level-changes

## Roadmap tasks covered

- Hazards in `world.ts`/`vehicle.ts`: grip overrides, jolts, LU spills behind the vehicle, the broken-glass HP drain, open-manhole hard stop. (all but broken glass)
