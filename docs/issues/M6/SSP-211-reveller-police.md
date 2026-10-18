---
id: SSP-211
title: "Implement npc.reveller, kicking_out, veh.police witness rule and police_parked"
milestone: M6
status: todo
type: feature
estimate: M
labels: [type:feature, area:ai-npc, area:sim, area:test, size:M]
depends_on: [SSP-078, SSP-108, SSP-089, SSP-080, SSP-295]
blocks: [SSP-212, SSP-213, SSP-215, SSP-221, SSP-222, SSP-223, SSP-237, SSP-242]
---

# SSP-211: Implement npc.reveller, kicking_out, veh.police witness rule and police_parked

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** M · **Areas:** ai-npc, sim, test

## Summary

Add Saturday's crowd and its consequences: weaving revellers who pour out of the pubs and drop takeaway litter, and patrolling police who add a complaint to any penalty they witness.

## Context

ENTITY_CATALOG §6: npc.reveller, 1.0 m/s. Weaves (a sine offset on the nav path, readable but never straight), sings, and drops pizza boxes and kebab wrappers (litter.kebab_wrapper row and placeholder sprite exist from M2; final art in SSP-223). Hit -250, 1 C, ped_oi; Sat (signature), Sun; walk with sway. Event kicking_out {at, rampS, from, to, anchors} (LEVEL_DESIGN §4.3): on Saturday at 150 s, revellers ramp from 8 to 32 over 30 s from the pub doors. Kebab Mile expects ~80 dynamic items, mostly after 150 s. The reveller drop interval is not specified: TBD (M6 tuning); record the chosen value in entities.json and ENTITY_CATALOG. veh.police (ENTITY §8, §3.3): patrols; a penalty witnessed within 15 m adds +1 extra complaint. When it witnesses one, the beacon flashes (swap slots 0/1, lightbar key index 30) and police_whoop plays. Solid; Sat (signature), Sun; 64x64 cell, body 28x54. Witness = distance from the police vehicle to the penalty location <= 15 m on the tick of the penalty, with no line-of-sight test (document this). veh.police_parked: static parent frames at a fixed heading; denting costs -100 and 5 HP. M3 deferred the police case of the table-driven penalty test to now. Patrol loops are level-authored routes. Placeholder 24x24 reveller grid and placeholder Blender police render under the final IDs (real art in SSP-221 and SSP-222). entities.json rows milestone M6.

## Scope

- src/sim/npc/behaviours/reveller.ts with sway and litter drops, plus its entities.json row
- kicking_out event
- traffic.ts police kind: patrol loop; witness check in complaints.ts adding +1 complaint; witness event for the beacon and whoop
- police_parked variant
- Penalty table test extended with the police rule; unit tests; replay; ENTITY_CATALOG notes (drop interval, witness definition)

## Out of scope

- Parade escort (SSP-213)
- Final art

## Acceptance criteria

- [ ] Unit test: a penalty 14.9 m from a police car adds 1 extra complaint; at 15.1 m it does not
- [ ] Unit test: a witnessed penalty emits a police witness event (for the beacon flash and police_whoop)
- [ ] Unit test: kicking_out ramps the reveller target linearly from 8 to 32 over 30 s, starting at 150 s
- [ ] Unit test: the reveller's lateral offset follows a bounded sine around the nav path
- [ ] Unit test: denting police_parked costs -100 and 5 HP
- [ ] The table-driven penalty test covers police and passes against entities.json
- [ ] A replay is committed and passing

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:replay
- npm run assets && npm run assets:lint

## Dependencies

**Depends on:**

- [SSP-078](../M3/SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-108](../M3/SSP-108-penalty-table-test.md) Add the table-driven penalty and complaint test against entities.json
- [SSP-089](../M3/SSP-089-traffic-lane-following.md) Implement traffic.ts: lane following, queuing behind Bessie, honk, Road Rage, bus stops
- [SSP-080](../M3/SSP-080-npc-store-spawner.md) Add the NPC store, behaviour registry, spawner and phase 7 of the tick
- [SSP-295](../M5/SSP-295-vertical-slice-gate.md) Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR

**Blocks:**

- [SSP-212](SSP-212-district-kebab-mile.md) Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden
- [SSP-213](SSP-213-lollipop-crossing-parade.md) Implement npc.lollipop_lady, site.school_crossing, crossing_patrol and parade
- [SSP-215](SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-221](SSP-221-art-humans-batch-b.md) Art Pass 2: final sprites for npc.lollipop_lady, npc.reveller and npc.inspector
- [SSP-222](SSP-222-art-vehicles-m6.md) Art Pass 2: Blender renders for bin lorry, ice cream van, police and Sid's sweeper
- [SSP-223](SSP-223-art-litter-m6.md) Art Pass 2: final litter sprites for kebab wrapper, leaf pile and lolly stick
- [SSP-237](../M7/SSP-237-assists-sim.md) Wire auto-brush, +60 s timer, Chill Shift and instant dump into the sim
- [SSP-242](../M7/SSP-242-reduce-flashing.md) Implement the Reduce flashing setting across HUD and world effects

## References

- ../../ENTITY_CATALOG.md#61-stats
- ../../ENTITY_CATALOG.md#62-behaviours
- ../../ENTITY_CATALOG.md#33-penalty-multipliers-and-complaint-sources
- ../../ENTITY_CATALOG.md#82-behaviour-collision-and-districts
- ../../LEVEL_DESIGN.md#43-event-catalogue
- ../../TECHNICAL_DESIGN.md#114-traffic-srcsimtrafficts

## Roadmap tasks covered

- People: ... `npc.reveller` ... (reveller)
- Vehicles: ... `veh.police` (+1 complaint within 15 m) ... plus the `_parked` variants of police and ice cream van. (police + parked)
