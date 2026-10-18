---
id: SSP-199
title: "Implement npc.jogger, npc.kid_skateboard, npc.kid_chalk and school_out/population_wave"
milestone: M6
status: todo
type: feature
estimate: L
labels: [type:feature, area:ai-npc, area:sim, area:test, size:L]
depends_on: [SSP-081, SSP-080, SSP-082, SSP-076, SSP-095, SSP-078, SSP-061, SSP-053, SSP-295]
blocks: [SSP-204, SSP-206, SSP-207, SSP-209, SSP-213, SSP-215, SSP-220]
---

# SSP-199: Implement npc.jogger, npc.kid_skateboard, npc.kid_chalk and school_out/population_wave

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** L · **Areas:** ai-npc, sim, test

## Summary

Add the three Wed-Sun pedestrians that use the existing steering core, plus the school_out and population_wave events that bring them onto the street.

## Context

Stats and behaviours (ENTITY_CATALOG §6.1/§6.2):
- npc.jogger: 3.5 m/s. Runs along the kerb gutter (exactly where the gutter brush wants to be) and swerves into the road around parked cars and bins. Prime near-miss source (+25). Hit -250, 1 complaint, ped_oi. Districts Thu, Fri (signature), Sun. Walk = run cycle.
- npc.kid_skateboard: 5.0 m/s. Fast on pavements; ollies off kerbs into the road, telegraphed by a crouch frame (startle 0) just before leaving the kerb. Hit -250, 1 C, kid_waah. Wed, Thu, Fri, Sun. Walk = push cycle, startle = crouch/ollie.
- npc.kid_chalk: stationary. Draws stain.chalk_art and leaves after 60-90 s. Spraying the chalk while the kid is present = -100 + 1 C ('WAAAH!', kid_waah). The chalk art is worth +30 once the kid has left (stain spray time 2.0 s proposed). Thu (signature), Sun. Idle = drawing, angry = wail.
pwr.hi_vis does not move stationary NPCs. Jogger swerves and skateboarders may jaywalk (TECHNICAL_DESIGN §11.1).
Events (LEVEL_DESIGN §4.3): school_out {at, anchor, mix, count} (Thu 75 s: 4 chalkers, 3 skaters; also Sun); population_wave {at, untilS, npc, delta} (e.g. Wed skater wave +3 at 140 s, Tue litterbug +2 at 90 s). Reuse population_wave if M3 already built it.
Machinery: one table-driven FSM per kind in src/sim/npc/behaviours/ (jogger.ts, kidSkateboard.ts, kidChalk.ts). Shared states map 1:1 to the 13-frame set (walk 4, idle 2, startle 2, fall 3, angry 2). Perception runs every 4 ticks, staggered by index mod 4. Stats come from entities.json. Add entities.json rows (milestone 'M6', districts lists from the catalog). stain.chalk_art already has an entities.json row and placeholder params from M2. Add placeholder 24x24 grids under the final frame IDs (placeholder-first rule; real art in SSP-220). Spawns use the npc/events sfc32 streams and never appear on screen (viewRect + 4 m).

## Scope

- Behaviour modules jogger.ts, kidSkateboard.ts and kidChalk.ts, with their entities.json rows
- Chalk drawing creates stain.chalk_art; spray-while-present penalty; 60-90 s departure timer
- school_out and population_wave events in shift.ts
- Placeholder grids and manifest entries for the three NPCs
- One unit test file per behaviour covering every catalog rule; extended table-driven penalty test
- A short committed replay exercising school_out

## Out of scope

- Final character art (SSP-220)
- District placement (district issues)

## Acceptance criteria

- [ ] Unit test: the jogger stays within the gutter band and moves into the road only around an obstacle
- [ ] Unit test: a skateboarder shows startle frame 0 for at least one perception cycle before leaving a kerb
- [ ] Unit test: spraying chalk with its kid present gives -100 and +1 complaint and does not clean it; after the kid leaves, cleaning awards +30 once
- [ ] Unit test: kid_chalk leaves 60-90 s after arrival (seeded)
- [ ] Unit test: school_out at 75 s spawns the configured mix and count off screen
- [ ] The penalty table test asserts jogger and skater hits = -250 and 1 complaint, read from entities.json
- [ ] entityCatalog, simPurity and the zero-allocation check pass

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:replay
- npm run assets && npm run assets:lint

## Dependencies

**Depends on:**

- [SSP-081](../M3/SSP-081-npc-steering.md) Implement NPC steering: seek, flee, separation, nav paths, zebra crossing
- [SSP-080](../M3/SSP-080-npc-store-spawner.md) Add the NPC store, behaviour registry, spawner and phase 7 of the tick
- [SSP-082](../M3/SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-076](../M3/SSP-076-compile-lane-nav-graphs.md) Compile the traffic lane graph and pavement nav graph in compile-level.ts
- [SSP-095](../M3/SSP-095-near-miss-dust-coughing.md) Add the near-miss bonus and dust coughing penalties
- [SSP-078](../M3/SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-061](../M2/SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats
- [SSP-053](../M2/SSP-053-entities-tuning-seed.md) Seed entities.json with litter, stains and pickups; add M2 values to tuning.json
- [SSP-295](../M5/SSP-295-vertical-slice-gate.md) Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR

**Blocks:**

- [SSP-204](SSP-204-district-gasworks.md) Author and compile district.gasworks (Wednesday, rain) with its district replay
- [SSP-206](SSP-206-district-conker-hill.md) Author and compile district.conker_hill (Thursday, wind and leaf fall)
- [SSP-207](SSP-207-ice-cream-van.md) Implement veh.ice_cream_van, its parked variant and the vehicle_stop event
- [SSP-209](SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-213](SSP-213-lollipop-crossing-parade.md) Implement npc.lollipop_lady, site.school_crossing, crossing_patrol and parade
- [SSP-215](SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-220](SSP-220-art-humans-batch-a.md) Art Pass 2: final sprites for npc.jogger, npc.kid_skateboard and npc.kid_chalk

## References

- ../../ENTITY_CATALOG.md#61-stats
- ../../ENTITY_CATALOG.md#62-behaviours
- ../../ENTITY_CATALOG.md#5-stains-stain
- ../../TECHNICAL_DESIGN.md#111-behaviour-system
- ../../LEVEL_DESIGN.md#43-event-catalogue
- ../../LEVEL_DESIGN.md#94-npcs

## Roadmap tasks covered

- People: `npc.jogger`, `npc.kid_skateboard`, `npc.kid_chalk`, `npc.lollipop_lady`, `npc.reveller`, `npc.inspector`. (jogger, kid_skateboard, kid_chalk)
