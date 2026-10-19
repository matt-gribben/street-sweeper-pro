---
id: SSP-091
title: "Add taxi fare stops, white van pavement parking, bicycle filtering and mobility scooter"
milestone: M3
status: done
type: feature
estimate: M
labels: [type:feature, area:sim, area:ai-npc, area:gameplay, area:test, size:M, vertical-slice]
depends_on: [SSP-090, SSP-082]
blocks: [SSP-104, SSP-105, SSP-106, SSP-108, SSP-201, SSP-203, SSP-207, SSP-209, SSP-212]
---

# SSP-091: Add taxi fare stops, white van pavement parking, bicycle filtering and mobility scooter

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** sim, ai-npc, gameplay, test · **Vertical slice**

## Summary

Add the per-kind hooks in traffic.ts for the four special M3 traffic kinds. Bicycles and mobility scooters also use the actor-hit penalty rules.

## Context

From ENTITY_CATALOG §8.2 and the ROADMAP M3 task:

veh.taxi (Tue)
- Stops abruptly to pick up fares: the rear-end trap for a following sweeper.
- Open: trigger and deceleration unspecified. Propose a seeded random kerbside stop (traffic stream), or a stop near a waiting pedestrian, with a hard decel value in entities.json; flag it.

veh.van_white (Mon, Tue)
- Parks half on the pavement, blocking the gutter line and forcing Bessie out into traffic.
- LEVEL_DESIGN §9.5: half-on-pavement vans only on `p` bays next to a 2+ tile pavement. Puddle Lane pavements are 1 tile, so expect none there. Moving vans behave like cars.

veh.bicycle (Tue)
- Fast; filters between lanes. Open: speed unspecified, propose one.
- ACTOR for hits: −250, 1 C, ped_oi, closing-speed ≥ 1.0 m/s rule, contact episodes.

veh.mobility_scooter (Mon)
- 1.5 m/s on PAVEMENTS, following the pavement nav graph.
- Actor hit: −500, 2 C, granny_harrumph.
- Keep it in the VehicleStore (it counts toward the 30 vehicle budget; Puddle Lane has 1) with a nav-following mode. Document this choice.

Body sizes (m): bicycle 0.5×1.63, mobility scooter 0.88×1.38.

## Scope

- Per-kind hooks in traffic.ts: taxi abrupt stops, white van half-on-pavement parked placement, bicycle lane filtering, scooter nav following.
- Bicycle and scooter contacts as actor hits with penalties, reusing the closing-speed rule and contact episodes.
- Tests for each kind.

## Out of scope

- Bin lorry, ice cream van, police and rival sweeper (M6).

## Acceptance criteria

- [ ] Test: a taxi performs at least one abrupt stop within a seeded 3,600-tick run, and its deceleration exceeds the car-following deceleration (3.0 m/s²).
- [ ] Test: a parked white van on a bay next to a 2-tile pavement has its OBB overlapping both road and pavement; none is placed beside a 1-tile pavement.
- [ ] Test: a bicycle can overtake a queued car by filtering and never overlaps it.
- [ ] Test: a mobility scooter stays on nav-graph tiles at ≤ 1.5 m/s; hitting it at ≥ 1.0 m/s closing speed costs −500 and 2 C; hitting a bicycle costs −250 and 1 C.
- [ ] Replays pass or are re-recorded with a reason.

## Verification

- npm test
- npm run test:replay
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-090](SSP-090-traffic-parked-collision.md) Add parked cars and Bessie-vs-vehicle collision with dent and impact rules
- [SSP-082](SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping

**Blocks:**

- [SSP-104](SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up
- [SSP-105](SSP-105-high-street-greybox.md) Author and compile the grey-box High Street (80×60) for Tuesday's NPCs
- [SSP-106](SSP-106-npc-stress-budget.md) Prove the NPC budget: 80 NPCs, 30 vehicles, 2,000 litter, allocation-free
- [SSP-108](SSP-108-penalty-table-test.md) Add the table-driven penalty and complaint test against entities.json
- [SSP-201](../M6/SSP-201-bin-lorry.md) Implement veh.bin_lorry and the bin_round event
- [SSP-203](../M6/SSP-203-district-high-street-final.md) Bring district.high_street to final M6 quality with collectibles and 3-star replay
- [SSP-207](../M6/SSP-207-ice-cream-van.md) Implement veh.ice_cream_van, its parked variant and the vehicle_stop event
- [SSP-209](../M6/SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-212](../M6/SSP-212-district-kebab-mile.md) Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden

## References

- ../../ENTITY_CATALOG.md#82-behaviour-collision-and-districts
- ../../ENTITY_CATALOG.md#32-collision-responses
- ../../LEVEL_DESIGN.md#95-traffic
- ../../TECHNICAL_DESIGN.md#114-traffic-srcsimtrafficts

## Roadmap tasks covered

- Behaviours: ... Traffic kinds in `traffic.ts`: taxi (abrupt fare stops), white van (parks half on the pavement), bicycle (filters between lanes), mobility scooter (1.5 m/s on pavements).
