---
id: SSP-090
title: "Add parked cars and Bessie-vs-vehicle collision with dent and impact rules"
milestone: M3
status: done
type: feature
estimate: M
labels: [type:feature, area:sim, area:physics, area:gameplay, area:test, size:M, vertical-slice]
depends_on: [SSP-089, SSP-031, SSP-036, SSP-037]
blocks: [SSP-087, SSP-091, SSP-103, SSP-108, SSP-207, SSP-241]
---

# SSP-090: Add parked cars and Bessie-vs-vehicle collision with dent and impact rules

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** sim, physics, gameplay, test · **Vertical slice**

## Summary

Fill parking bays with veh.*_parked static OBBs, expose their roof points for cats, and resolve Bessie against moving and parked vehicles: moving traffic costs impact HP only, and denting a parked car costs −100 and a flat 5 HP.

## Context

From TECHNICAL_DESIGN §9.1/§9.4, ENTITY_CATALOG §3.2/§8.2, LEVEL_DESIGN §9.5:
- Parked cars fill compiled `p` bays to parkedFill using parkedMix (veh.hatchback_parked, veh.saloon_parked, veh.van_white_parked, veh.taxi_parked), seeded from the `traffic` stream at shift start, at the bay's axis heading, with a seeded paint swap slot for hatchback/saloon (ART_BIBLE §8.2). They live in the VehicleStore (counted in the 30 budget) and are registered as static OBBs in collision/grid.ts buckets. White-van half-on-pavement placement is SSP-091.
- Expose roof perch points (and occupancy) for npc.cat perches.
- Bessie vs moving traffic: OBB vs OBB SAT. Traffic is kinematic and stops; Bessie resolves as against static geometry with restitution 0.2 and damage 4 HP per m/s of normal speed above 2 m/s (×0.6 with upg.bumper via modifier). HP only, no points or complaints (ENTITY_CATALOG §17 Q3 default). EV.Impact as in M1.
- Denting a parked car: −100 pts (penalty API, resets chain) and a flat 5 HP that REPLACES impact damage (Q4 default), once per contact episode (re-arm after separation; flag it). Event for crash SFX later.
- HP reaching 0 hands off to SSP-079 (TOWED).

## Scope

- Parked car placement from bays at shift start with seeded mix and paint slot; static OBB registration.
- Roof perch points API for cats.
- Bessie vs moving and parked vehicle collision with the damage and dent rules.
- tests/unit/parkedCollision.test.ts and an extension of tests/property/collision.prop.test.ts with vehicles.

## Out of scope

- White van pavement parking (SSP-091).
- Police and ice cream van parked variants (M6).

## Acceptance criteria

- [ ] Test: with parkedFill 0.6 over 10 bays exactly 6 bays are filled, identically across reruns with the same seed; moving + parked never exceeds 30.
- [ ] Test: a hit on a parked car at 6 m/s costs −100 and exactly 5 HP (not 16), once per contact episode, and resets the chain.
- [ ] Test: a hit on moving traffic at 6 m/s costs 16 HP and no points or complaints.
- [ ] Property test: Bessie never ends a tick overlapping a vehicle OBB by more than 1 mm.
- [ ] Replays pass or are re-recorded with a reason.

## Verification

- npm test
- npm run test:replay
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-089](SSP-089-traffic-lane-following.md) Implement traffic.ts: lane following, queuing behind Bessie, honk, Road Rage, bus stops
- [SSP-031](../M1/SSP-031-collision-primitives.md) Implement OBB, SAT and sweep sub-step primitives in src/sim/collision
- [SSP-036](../M1/SSP-036-static-collision.md) Resolve Bessie against static geometry with impact damage and TOWED stub
- [SSP-037](../M1/SSP-037-collision-property-tests.md) Add fast-check collision properties: never inside a solid, no tunnelling at 17.2 m/s

**Blocks:**

- [SSP-087](SSP-087-behaviour-cat.md) Implement the cat: perch, dart on approach, groom, bolt, and ride Bessie's roof
- [SSP-091](SSP-091-traffic-special-kinds.md) Add taxi fare stops, white van pavement parking, bicycle filtering and mobility scooter
- [SSP-103](SSP-103-render-actors-traffic.md) Draw NPCs, animals, traffic, knockables and hazards with state-driven frames
- [SSP-108](SSP-108-penalty-table-test.md) Add the table-driven penalty and complaint test against entities.json
- [SSP-207](../M6/SSP-207-ice-cream-van.md) Implement veh.ice_cream_van, its parked variant and the vehicle_stop event
- [SSP-241](../M7/SSP-241-juice-impact.md) Add screen shake, hit-stop and gamepad rumble with reduce-motion support

## References

- ../../TECHNICAL_DESIGN.md#91-static-world
- ../../TECHNICAL_DESIGN.md#92-vehicle-vs-static-phase-3
- ../../TECHNICAL_DESIGN.md#94-dynamic-actors
- ../../TECHNICAL_DESIGN.md#95-property-tests
- ../../ENTITY_CATALOG.md#32-collision-responses
- ../../ENTITY_CATALOG.md#82-behaviour-collision-and-districts
- ../../ENTITY_CATALOG.md#17-open-questions
- ../../LEVEL_DESIGN.md#95-traffic

## Roadmap tasks covered

- Mon–Tue entity scope: `_parked` variants of hatchback, saloon, van_white and taxi (behaviour)
- `src/sim/traffic.ts`: ... (collision with Bessie and parked traffic)
