---
id: SSP-280
title: "Build Sid's Rival Sweep AI on the lane graph and LitterField"
milestone: M9
status: todo
type: feature
estimate: L
labels: [type:feature, area:ai-npc, area:sim, area:gameplay, area:test, size:L]
depends_on: [SSP-279, SSP-089, SSP-080, SSP-197, SSP-203, SSP-204, SSP-206, SSP-209, SSP-212, SSP-215]
blocks: [SSP-281]
---

# SSP-280: Build Sid's Rival Sweep AI on the lane graph and LitterField

**Milestone:** [M9 Desktop & Extra Modes](../README.md#m9) · **Type:** feature · **Size:** L · **Areas:** ai-npc, sim, gameplay, test

## Summary

Write the deterministic controller that drives Sid in Rival Sweep. He picks litter targets, steals litter in front of the player, navigates on the traffic lane graph, sweeps at clean speed, dumps when full, and never collides with Bessie on purpose.

## Context

ROADMAP M9: 'Rival AI reuses the traffic and litter systems.' GDD §13.5: 'Sid uses the same handling model and steals litter in front of you; he never collides deliberately. AI difficulty tiers are TBD (M9).'

**Systems to reuse:**
- Traffic (TECHNICAL_DESIGN §11.4): the compiled lane graph with speed limits and stop lines at `site.zebra`, `site.school_crossing` and `site.bus_stop`. Car-following `vMax = sqrt(2 · 3.0 m/s² · max(0, gap − 2.5 m))`, where the leader can be Bessie projected onto the lane.
- LitterField (TECHNICAL_DESIGN §10.2): spatial hash with 4 m cells, used to score candidate targets.
- NPC-style perception (TECHNICAL_DESIGN §11.1): run the query every 4 ticks, staggered deterministically. It may read Bessie's pose, velocity and predicted path 1.5 s ahead, which drives the 'steal litter in front of you' bias.

**Behaviour outline (proposed):**
- States: SeekTarget → Transit (brush up, lane graph) → Sweep (brush down, ≤ 4.0 m/s, so fling p = 0) → Dump (nearest free depot bay or skip once the hopper reaches a threshold) → back to SeekTarget. Plus Unstick: reverse and replan after a progress watchdog trips.
- Output: the quantised InputFrame-like struct that SSP-279 consumes.
- Table-driven FSM with no classes and no per-tick allocation (TECHNICAL_DESIGN §11.1).
- Tie-breaks always by entity id: no comparator may return 0 for distinct entities (TECHNICAL_DESIGN §7.4).
- No Math.random. Use an sfc32 stream, proposed name `rival`, and add it to the TECHNICAL_DESIGN §7.3 stream list.

**Tuning.** Difficulty tiers stay TBD and are later tuning, not a blocker. Ship one tier with every knob in tuning.json, e.g. `rival.cruiseMps`, `rival.dumpAtLuFrac`, `rival.stealBias`, `rival.perceptionTicks`, `rival.watchdogS`.

Also open, to record in GDD §13.5: whether Sid hitting pedestrians or blocking traffic creates complaints. Proposed: never, for the player. Sid yields to pedestrians at crossings as traffic does.

## Scope

- Table-driven FSM controller for Sid in src/sim (no classes, no per-tick allocation)
- Target scoring over LitterField, with a bias toward litter on Bessie's predicted path
- Lane-graph routing to targets and dump sites; car-following toward Bessie and other vehicles
- Dump threshold, dump-site choice (respecting bay ownership), stuck watchdog and recovery
- Tuning block `rival.*` in tuning.json (single tier); `rival` stream added to TECHNICAL_DESIGN §7.3
- Unit tests per state transition, property and soak tests; GDD §13.5 and ENTITY_CATALOG §8.2 behaviour text updated

## Out of scope

- Multiple difficulty tiers and final balance numbers (later tuning)
- HUD, intro card and tally (SSP-281)
- Changes to ambient traffic behaviour

## Acceptance criteria

- [ ] The same seed, district and player input log give an identical Sid state hash on two runs at every 600-tick checkpoint over 10,800 ticks
- [ ] With Bessie parked out of the way, Sid completes at least one dump within 10,800 ticks in each of the 7 campaign districts (headless soak test, seed 1)
- [ ] In those soak runs, outside the Dump state, Sid is never stationary for more than `rival.watchdogS` + the Unstick recovery window, and he never ends in Unstick
- [ ] Property test (fast-check, random seeds and Bessie positions): when Bessie is the leader on Sid's path, his commanded target speed never exceeds vMax = sqrt(2 · 3.0 · max(0, gap − 2.5)), so within 2.5 m he commands zero forward speed
- [ ] With litter on Bessie's predicted 1.5 s path inside the perception range, Sid's target choice prefers it over equal-value litter elsewhere (unit test)
- [ ] Sid's brush is down only at ≤ 4.0 m/s, so he causes no fling (unit test)
- [ ] Every controller parameter is read from tuning.json, with no numeric literals for behaviour thresholds in the controller module
- [ ] Existing campaign replays pass unchanged, and simPurity passes

## Verification

- npm test
- npm run test:replay
- npm run typecheck && npm run lint

## Dependencies

**Depends on:**

- [SSP-279](SSP-279-rival-sweeper-sim.md) Give Spotless Sid a full sweeper in the sim: handling, brush, hopper, dumping
- [SSP-089](../M3/SSP-089-traffic-lane-following.md) Implement traffic.ts: lane following, queuing behind Bessie, honk, Road Rage, bus stops
- [SSP-080](../M3/SSP-080-npc-store-spawner.md) Add the NPC store, behaviour registry, spawner and phase 7 of the tick
- [SSP-197](../M6/SSP-197-depot-yard-level.md) Author and compile district.depot_yard with all seven Skip Run variants
- [SSP-203](../M6/SSP-203-district-high-street-final.md) Bring district.high_street to final M6 quality with collectibles and 3-star replay
- [SSP-204](../M6/SSP-204-district-gasworks.md) Author and compile district.gasworks (Wednesday, rain) with its district replay
- [SSP-206](../M6/SSP-206-district-conker-hill.md) Author and compile district.conker_hill (Thursday, wind and leaf fall)
- [SSP-209](../M6/SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-212](../M6/SSP-212-district-kebab-mile.md) Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden
- [SSP-215](../M6/SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map

**Blocks:**

- [SSP-281](SSP-281-rival-sweep-flow.md) Ship the Rival Sweep mode: district pick, 180 s duel HUD, winner tally

## References

- ../../GDD.md#135-rival-sweep-m9
- ../../TECHNICAL_DESIGN.md#114-traffic-srcsimtrafficts
- ../../TECHNICAL_DESIGN.md#111-behaviour-system
- ../../TECHNICAL_DESIGN.md#102-litterfield-srcsimlitterts
- ../../TECHNICAL_DESIGN.md#73-randomness
- ../../TECHNICAL_DESIGN.md#74-determinism
- ../../ENTITY_CATALOG.md#83-traffic-car-state-machine
- ../../ENTITY_CATALOG.md#82-behaviour-collision-and-districts

## Roadmap tasks covered

- Rival Sweep: versus `veh.rival_sweeper` (Spotless Sid), most LU dumped in 180 s. Rival AI reuses the traffic and litter systems.
