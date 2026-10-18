---
id: SSP-207
title: "Implement veh.ice_cream_van, its parked variant and the vehicle_stop event"
milestone: M6
status: todo
type: feature
estimate: M
labels: [type:feature, area:ai-npc, area:sim, area:test, size:M]
depends_on: [SSP-199, SSP-091, SSP-090]
blocks: [SSP-209, SSP-215, SSP-222, SSP-223, SSP-277]
---

# SSP-207: Implement veh.ice_cream_van, its parked variant and the vehicle_stop event

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** M · **Areas:** ai-npc, sim, test

## Summary

Add the mess-making ice cream van that arrives, stops for 20 s with chimes and spawns kids and lolly-stick litter, plus its static parked variant.

## Context

ENTITY_CATALOG §8: veh.ice_cream_van has a 64x64 cell, body 32x62 px (2.0 x 3.88 m) and 32 headings. It stops for 20 s with chimes (ice_cream_chime) and spawns kids, wrappers and lolly sticks (litter.lolly_stick: 10 pts, 0.5 LU, spawned around a stationary van; its entities.json row and placeholder sprite exist from M2, final art in SSP-223). Solid; Fri (signature), Sun. veh.ice_cream_van_parked: static, reuses the parent frames at a fixed heading (no new art), solid; denting it costs -100 and 5 HP (crash); cats perch on its roof. Event vehicle_stop {vehicle, anchor, at, stopS} (LEVEL_DESIGN §4.3): a vehicle arrives on the lane graph and stops at an anchor for a fixed time. Fri stops at 55 s and 165 s; Sun at 45 s. Free Sweep loops vehicle_stop every 240 s. OPEN: 'spawns kids' and 'wrappers' are not tied to IDs. Proposal: kids = npc.kid_skateboard (via a temporary population bump); wrappers = items from the district's small-litter table plus lolly sticks. Record the choice in ENTITY_CATALOG. Placeholder Blender flat-box render for 32 headings; the real model comes in SSP-222. entities.json rows (milestone M6).

## Scope

- traffic.ts ice_cream_van hook: arrive, stop for stopS at the anchor with a chime event, spawn litter and kids, depart
- vehicle_stop event (generic over vehicle ID)
- ice_cream_van_parked as a parked variant with standard parked rules
- entities.json rows, placeholder render, unit tests, replay; ENTITY_CATALOG note on the kids/wrappers choice

## Out of scope

- Final van model (SSP-222)
- Lolly stick final art (SSP-223)
- Daily Shift Heatwave modifier (M9)

## Acceptance criteria

- [ ] Unit test: the van is stationary for exactly 20 s (1,200 ticks) at its anchor and emits an ice_cream_chime event when the stop starts
- [ ] Unit test: lolly sticks spawn within a fixed radius of the stationary van and count toward litter spawned
- [ ] Unit test: denting ice_cream_van_parked costs -100 and 5 HP
- [ ] Placeholder frames exist for 32 headings; assets:lint passes
- [ ] A replay with a vehicle_stop is committed and passing

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:replay
- npm run assets && npm run assets:lint

## Dependencies

**Depends on:**

- [SSP-199](SSP-199-people-kids-jogger.md) Implement npc.jogger, npc.kid_skateboard, npc.kid_chalk and school_out/population_wave
- [SSP-091](../M3/SSP-091-traffic-special-kinds.md) Add taxi fare stops, white van pavement parking, bicycle filtering and mobility scooter
- [SSP-090](../M3/SSP-090-traffic-parked-collision.md) Add parked cars and Bessie-vs-vehicle collision with dent and impact rules

**Blocks:**

- [SSP-209](SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-215](SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-222](SSP-222-art-vehicles-m6.md) Art Pass 2: Blender renders for bin lorry, ice cream van, police and Sid's sweeper
- [SSP-223](SSP-223-art-litter-m6.md) Art Pass 2: final litter sprites for kebab wrapper, leaf pile and lolly stick
- [SSP-277](../M9/SSP-277-daily-modifiers.md) Implement Daily Shift modifiers as level knob overrides and extra events

## References

- ../../ENTITY_CATALOG.md#82-behaviour-collision-and-districts
- ../../ENTITY_CATALOG.md#81-sprites
- ../../ENTITY_CATALOG.md#41-stats
- ../../LEVEL_DESIGN.md#43-event-catalogue
- ../../TECHNICAL_DESIGN.md#114-traffic-srcsimtrafficts

## Roadmap tasks covered

- Vehicles: ... `veh.ice_cream_van` ... plus the `_parked` variants of police and ice cream van. (ice cream van + parked)
