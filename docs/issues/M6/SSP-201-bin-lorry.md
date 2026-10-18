---
id: SSP-201
title: "Implement veh.bin_lorry and the bin_round event"
milestone: M6
status: todo
type: feature
estimate: M
labels: [type:feature, area:ai-npc, area:sim, area:test, size:M]
depends_on: [SSP-089, SSP-091, SSP-092, SSP-100, SSP-295]
blocks: [SSP-204, SSP-206, SSP-215, SSP-222]
---

# SSP-201: Implement veh.bin_lorry and the bin_round event

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** M · **Areas:** ai-npc, sim, test

## Summary

Add Wednesday's friendly bin crew: wheelie bins put out at kerbs at shift start, and lorries that follow a route at 4 m/s, stop at bins and sometimes drop a 50-point bin bag.

## Context

ENTITY_CATALOG §8.1/§8.2: veh.bin_lorry has a 96x96 cell, body 36x84 px (2.25 x 5.25 m) and 32 headings. It drives at 4 m/s, stops at bins, and sometimes drops a litter.bin_bag (50 pts, 8 LU; bursts into 6 small items if hit above 4 m/s). Solid with impact damage; horn; Wed (signature), Thu, Sun; never a parked prop. Event (LEVEL_DESIGN §4.3): bin_round {route (anchors), lorries, startAt, bagDropChance}. Wheelie bins go out at kerbs at shift start, and lorries follow the route and stop at each bin. Wednesday timeline (§4.5): bin_round starts at 15 s with 2 lorries, the second at 70 s, and lorries return to the depot from 200 s. Gasworks places 40 prop.wheelie_bin at kerbs. Thursday and Sunday use a light bin_round (1 lorry). Free Sweep loops bin_round on a 240 s cycle. Following a lorry is a valid strategy but blocks the gutter. Traffic machinery: TECHNICAL_DESIGN §11.4 (lane graph, car-following vMax = sqrt(2 * 3.0 * max(0, gap - 2.5)), per-kind hooks, spawn only outside world.viewRect). Placeholder render: run the Blender rig with flat-colour primitive boxes (as M3 did for traffic) so the 32-heading frame IDs are final; the real model comes in SSP-222. entities.json row milestone M6. Vehicle budget 30; bag drops use the events stream. Open: no bagDropChance value is given. Make it a level param with a TBD (M6 tuning) default and record the tuned value in ENTITY_CATALOG.

## Scope

- traffic.ts bin_lorry hook: 4 m/s cap, stops at bin anchors, bag drop roll
- bin_round event: bins out at start, lorries spawned at startAt, return to depot
- entities.json row; placeholder Blender render and manifest entry
- Unit tests and a replay exercising bin_round on a fixture level

## Out of scope

- Final bin lorry model (SSP-222)
- Gasworks authoring (SSP-204)

## Acceptance criteria

- [ ] Unit test: bin lorry speed never exceeds 4.0 m/s
- [ ] Unit test: the lorry stops at each bin on its route, and bag drops over 10,000 seeded trials match bagDropChance within ±2 percentage points
- [ ] Unit test: bins are placed at kerbs at tick 0 when bin_round is present
- [ ] Placeholder frames exist for all 32 headings under the final frame IDs; assets:lint passes
- [ ] A replay is committed and passing, and the vehicle store never exceeds 30

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:replay
- npm run assets && npm run assets:lint

## Dependencies

**Depends on:**

- [SSP-089](../M3/SSP-089-traffic-lane-following.md) Implement traffic.ts: lane following, queuing behind Bessie, honk, Road Rage, bus stops
- [SSP-091](../M3/SSP-091-traffic-special-kinds.md) Add taxi fare stops, white van pavement parking, bicycle filtering and mobility scooter
- [SSP-092](../M3/SSP-092-knockable-bodies.md) Implement bodies.ts knockable impulse bodies with spills and penalties
- [SSP-100](../M3/SSP-100-placeholder-vehicle-renders.md) Render placeholder traffic vehicles in Blender as primitive boxes at 32 headings
- [SSP-295](../M5/SSP-295-vertical-slice-gate.md) Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR

**Blocks:**

- [SSP-204](SSP-204-district-gasworks.md) Author and compile district.gasworks (Wednesday, rain) with its district replay
- [SSP-206](SSP-206-district-conker-hill.md) Author and compile district.conker_hill (Thursday, wind and leaf fall)
- [SSP-215](SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-222](SSP-222-art-vehicles-m6.md) Art Pass 2: Blender renders for bin lorry, ice cream van, police and Sid's sweeper

## References

- ../../ENTITY_CATALOG.md#82-behaviour-collision-and-districts
- ../../ENTITY_CATALOG.md#81-sprites
- ../../LEVEL_DESIGN.md#43-event-catalogue
- ../../LEVEL_DESIGN.md#45-per-district-event-timelines
- ../../TECHNICAL_DESIGN.md#114-traffic-srcsimtrafficts

## Roadmap tasks covered

- Vehicles: `veh.bin_lorry`, ... (bin_lorry)
