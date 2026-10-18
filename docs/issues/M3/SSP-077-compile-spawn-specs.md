---
id: SSP-077
title: "Compile NPC, traffic, hazard, knockable and power-up spawn specs from level.json"
milestone: M3
status: todo
type: feature
estimate: M
labels: [type:feature, area:tooling, area:sim, area:test, size:M, vertical-slice]
depends_on: [SSP-075, SSP-076, SSP-056, SSP-054, SSP-055]
blocks: [SSP-080, SSP-089, SSP-092, SSP-093, SSP-096, SSP-104, SSP-105, SSP-290]
---

# SSP-077: Compile NPC, traffic, hazard, knockable and power-up spawn specs from level.json

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** tooling, sim, test · **Vertical slice**

## Summary

Extend the level schema and compiler so level.json `npcs`, `traffic`, `hazards`, `knockables`, `powerups`, `anchors` and `events` are validated and written to the compiled `spawns` and `schedules` blocks. Add the budget, membership and milestone checks that guard M3 content.

## Context

Schema types (type-only) live in tools/levels/schema.ts (LEVEL_DESIGN §8.4):
- NpcSpec: population [{from, to, target}], mix, caps, named [{id, anchor, spawnAt, route, loop, count}], perches {id: npc.cat, count, on: walls|carRoofs|road}, flocks [{id, count, size [min,max], near}].
- TrafficSpec: densityPerKm, mix, parkedFill, parkedMix, taxiRank, busRoute, busEveryS (or { none: true }).
- hazards: { place: [{id, at}], random: [{id, count, rule}] }. Named rules: kerbside_low_points, carriageway, near_parking.
- knockables: [{id, at}]. powerups: {count 1|2|3, table, at?}. events: EventSpec [{type, at?, untilS?, ...params}].

Compiled output (TECHNICAL_DESIGN §15.2): "spawns": { litter, npc, traffic, pickups } and "schedules".

Spawning itself is a pure function of (seed, compiled level, elapsed ticks, sim state) and happens at RUNTIME, using sfc32 streams per subsystem (npc, traffic, hazards, events). The compiler validates the specs and emits them plus any candidate cells the runtime needs (e.g. puddle candidates beside drains and kerbs). Hazard placement rules (LEVEL_DESIGN §9.3): no hazard within 3 tiles of @, on a site.zebra, inside a depot bay or on the tile next to a hydrant.

Validations (LEVEL_DESIGN §10.3); the compiler should report all errors, not stop at the first:
- L005: an ID that is not canonical, or whose entities.json `districts` excludes this district.
- L007: an entity whose entities.json `milestone` is later than the milestone that delivers this district (Mon–Tue: M3; Wed–Sun and the Depot Yard: M6).
- L040: power-up count outside 1–3 (shifts).
- L050: peak NPCs > 80, peak vehicles (moving + parked) > 30, or litter.initial + expected dynamic litter > 1,000.
- L080: an event or route referring to an unknown anchor, or a route that leaves the nav or lane graph.
- L081 (warning): last scheduled event later than 200 s elapsed.

Note for tests: every real M6 entity is also excluded from Mon/Tue by `districts`, so a real-ID fixture trips L005. Test L007 with an injected entities table in which a test entity has milestone M6 and districts that include the fixture district.

Par report line (LEVEL_DESIGN §10.4): `peak NPC n/80   peak vehicles n/30`. Peak estimation is unspecified: use max over population windows of (target, bounded by caps) + named NPCs + flock sizes (max) + dog-walker dogs; vehicles = moving density × lane-km (rounded up) + parked bays × parkedFill (rounded up) + pavement vehicles from the mix. Document the method in LEVEL_DESIGN §10.4.

## Scope

- Add NpcSpec, TrafficSpec, hazards, knockables, powerups, anchors and EventSpec types to tools/levels/schema.ts, with runtime type guards.
- Emit compiled `spawns.npc`, `spawns.traffic`, `spawns.pickups` and `schedules`, plus hazard and knockable placements and candidate cells.
- Add the L005, L007, L040, L050, L080 and L081 checks.
- Add the peak NPC and peak vehicle lines to the par report and document the estimation method.
- Add matching decoders in src/sim/map.ts.

## Out of scope

- Runtime spawners (SSP-080, SSP-089, SSP-090, SSP-093, SSP-092, SSP-096).
- Authoring Puddle Lane and High Street content (separate issues).

## Acceptance criteria

- [ ] Unit test with an injected entities table: a level spawning a test entity whose milestone is M6 and whose districts include the level fails with L007.
- [ ] A fixture that spawns npc.pigeon in Puddle Lane fails with L005 (pigeon districts are Tue, Fri, Sun).
- [ ] Fixtures with 4 SSP-096, or with a peak of 81 NPCs, fail with L040 and L050 respectively.
- [ ] A named NPC whose route refers to an undefined anchor fails with L080; a fixture whose last event is at 210 s prints L081 as a warning and still compiles.
- [ ] A fixture with two errors reports both.
- [ ] The par report shows the peak NPC and peak vehicle lines.
- [ ] Compilation stays byte-deterministic and the round-trip property test still passes.

## Verification

- npm run levels
- npm test
- npm run typecheck
- npm run lint
- npm run assets:verify

## Dependencies

**Depends on:**

- [SSP-075](SSP-075-entity-data-freeze.md) Freeze the Mon–Tue entity set in entities.json and add M3 shared tuning
- [SSP-076](SSP-076-compile-lane-nav-graphs.md) Compile the traffic lane graph and pavement nav graph in compile-level.ts
- [SSP-056](../M2/SSP-056-puddle-lane-sweeping-content.md) Author Puddle Lane litter, grime, frontages, pledges and collectibles data
- [SSP-054](../M2/SSP-054-compile-route-grime-litter-layers.md) Extend compile-level.ts with route, grime density, gutter and litter weight layers
- [SSP-055](../M2/SSP-055-compile-frontages-dump-validation.md) Generate frontages and pledges in the compiler and validate dump sites

**Blocks:**

- [SSP-080](SSP-080-npc-store-spawner.md) Add the NPC store, behaviour registry, spawner and phase 7 of the tick
- [SSP-089](SSP-089-traffic-lane-following.md) Implement traffic.ts: lane following, queuing behind Bessie, honk, Road Rage, bus stops
- [SSP-092](SSP-092-knockable-bodies.md) Implement bodies.ts knockable impulse bodies with spills and penalties
- [SSP-093](SSP-093-hazards-grip-jolts.md) Implement hazard grip overrides, jolts, LU spills and the open-manhole hard stop
- [SSP-096](SSP-096-power-ups.md) Spawn power-ups on pavements, implement all six pwr.* effects, draw them
- [SSP-104](SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up
- [SSP-105](SSP-105-high-street-greybox.md) Author and compile the grey-box High Street (80×60) for Tuesday's NPCs
- [SSP-290](SSP-290-tutorial-beats.md) Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events

## References

- ../../LEVEL_DESIGN.md#84-leveljson-schema
- ../../LEVEL_DESIGN.md#9-spawn-rules
- ../../LEVEL_DESIGN.md#93-stains-and-hazards
- ../../LEVEL_DESIGN.md#94-npcs
- ../../LEVEL_DESIGN.md#95-traffic
- ../../LEVEL_DESIGN.md#96-power-ups-and-collectibles
- ../../LEVEL_DESIGN.md#103-validation-rules
- ../../LEVEL_DESIGN.md#104-par-report
- ../../TECHNICAL_DESIGN.md#152-compiled-schema-v1

## Roadmap tasks covered

- Deliverable: `npm run levels` also compiles a first grey-box High Street (80×60) (compiler support)
