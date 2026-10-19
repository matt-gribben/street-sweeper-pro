---
id: SSP-076
title: "Compile the traffic lane graph and pavement nav graph in compile-level.ts"
milestone: M3
status: done
type: feature
estimate: L
labels: [type:feature, area:tooling, area:sim, area:test, size:L, vertical-slice]
depends_on: [SSP-033, SSP-032, SSP-042, SSP-056]
blocks: [SSP-077, SSP-081, SSP-089, SSP-190, SSP-199]
---

# SSP-076: Compile the traffic lane graph and pavement nav graph in compile-level.ts

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** L · **Areas:** tooling, sim, test · **Vertical slice**

## Summary

Replace the M1 stubs in tools/levels/compile-level.ts with a real directed lane graph for traffic and a pavement nav graph for pedestrians. Emit both in the compiled level JSON and decode them in src/sim/map.ts. Traffic and every NPC behaviour need these graphs.

## Context

M1 stubbed the lane and nav graphs (ROADMAP M1 checklist). Compiled schema v1 (TECHNICAL_DESIGN §15.2):
- "lanes": { "nodes": [[x, y]], "edges": [[from, to, speedLimit, flags]] }
- "nav": { "nodes": [[x, y]], "edges": [[from, to, flags]] }
Output is byte-deterministic (stable key order, no timestamps). src/sim/map.ts is shared by the compiler and the runtime. Tools run on Node 24 type stripping: relative imports need explicit `.ts` extensions, no enums.

Road rules (LEVEL_DESIGN §7.1, §7.4, §8.3):
- Traffic drives on the LEFT. On an east–west road with north up, eastbound traffic uses the northern lane.
- `#` two-way, lanes inferred from width: residential 3 tiles two-way; main road 4 tiles two lanes. One-way roads use > < ^ v (east/west/north/south). Roads narrower than 3 tiles are one-way or carry no traffic.
- Cobbles `:` and aprons `+` are not lanes. Mini-roundabouts circulate clockwise. One tile is 2 m.
- Stop lines/flags on lane edges: site.zebra (`z`), site.school_crossing (`k`, Sunday only but supported), site.bus_stop (`b`, left-hand kerb, 3–4 tiles), parking bays `p` (record bay cells for parked spawning). Map-edge lane portals are where traffic spawns and despawns. Give-way at junctions (level.json `junctions`) is not required by any M3 rule: emitting a flag is enough.

Nav graph (TECHNICAL_DESIGN §11.1, LEVEL_DESIGN §7.2–7.6):
- Built from pavement `.`, cobbles `:`, alleys `;` (drivable and footway) and park paths.
- Road-crossing edges exist only at site.zebra, site.school_crossing and dropped kerbs `d`, flagged by type so jaywalking behaviours can ignore them.
- Tag portal nodes (map-edge pavement tiles), frontage door points (frontage centres) and anchor nodes (digits 0–9, named in level.json `anchors`).

Validation errors (LEVEL_DESIGN §10.3), format `<file>:<row>:<col> Lxxx message` with 1-based row/col:
- L011: two-way traffic on a road narrower than 3 tiles, or a one-way arrow pointing against its neighbours.
- L012: lane graph not strongly connected. Treat map-edge exit portals as connected to entry portals (vehicles despawn and respawn) when checking; document this.
- L013: isolated road tile (example message: `road tile not connected to the lane graph`).

Open: the docs give no per-edge speedLimit. Store a placeholder per road class in tuning.json, mark it as M3 tuning in the PR (gameplay numbers are not blockers).

## Scope

- Lane graph inference from road width and one-way arrows, with drive-on-the-left lane offsets, junction connections and clockwise roundabout circulation.
- Stop-line flags for zebras, school crossings and bus stops; parking-bay records; portal flags at map edges.
- Pavement nav graph with crossing edges only at zebras, school crossings and dropped kerbs, plus anchor, portal and frontage-door node tags.
- L011, L012 and L013 validations with file:row:col errors.
- Decode `lanes` and `nav` in src/sim/map.ts into typed arrays (no per-tick allocation) with node-to-outgoing-edge lookups (CSR-style offsets).
- Recompile puddle_lane and commit the regenerated public/assets/levels/puddle_lane.json.

## Out of scope

- NPC and traffic spawn specs and schedules (SSP-077).
- Runtime following and steering (SSP-089, SSP-081).
- High Street authoring.

## Acceptance criteria

- [ ] `npm run levels` run twice produces byte-identical output.
- [ ] Compiled puddle_lane.json contains non-empty `lanes` and `nav`, and passes L012.
- [ ] Unit test: on a fixture with an east–west 3-tile road, eastbound lane nodes sit north of the centreline and westbound nodes south of it.
- [ ] Unit test: nav edges that cross a road exist only where the fixture has `z`, `k` or `d`, and carry the matching crossing flag.
- [ ] Fixtures that break L011, L012 and L013 each fail with the correct code and 1-based row:col.
- [ ] Property test (fast-check): random legal ASCII maps compile, decode through map.ts and re-encode byte-identically, including lanes and nav (TECHNICAL_DESIGN §18.2).
- [ ] `npm run assets:verify` passes with the regenerated level committed.

## Verification

- npm run levels
- npm test
- npm run typecheck
- npm run lint
- npm run assets:verify
- npm run test:replay

## Dependencies

**Depends on:**

- [SSP-033](../M1/SSP-033-level-compiler-core.md) Build level schema and compile-level.ts core: parse, legend, buildings, M1 checks
- [SSP-032](../M1/SSP-032-level-map-codec.md) Add src/sim/map.ts compiled-level codec, tile/surface/collide ids and solid merge
- [SSP-042](../M1/SSP-042-puddle-lane-level.md) Author Puddle Lane map.txt and level.json (64×48) and commit compiled output
- [SSP-056](../M2/SSP-056-puddle-lane-sweeping-content.md) Author Puddle Lane litter, grime, frontages, pledges and collectibles data

**Blocks:**

- [SSP-077](SSP-077-compile-spawn-specs.md) Compile NPC, traffic, hazard, knockable and power-up spawn specs from level.json
- [SSP-081](SSP-081-npc-steering.md) Implement NPC steering: seek, flee, separation, nav paths, zebra crossing
- [SSP-089](SSP-089-traffic-lane-following.md) Implement traffic.ts: lane following, queuing behind Bessie, honk, Road Rage, bus stops
- [SSP-190](../M6/SSP-190-compiler-m6.md) Extend compile-level for M6: skip_run mode, night lamp pools, landmarks, M6 events
- [SSP-199](../M6/SSP-199-people-kids-jogger.md) Implement npc.jogger, npc.kid_skateboard, npc.kid_chalk and school_out/population_wave

## References

- ../../TECHNICAL_DESIGN.md#151-compile-step
- ../../TECHNICAL_DESIGN.md#152-compiled-schema-v1
- ../../TECHNICAL_DESIGN.md#111-behaviour-system
- ../../TECHNICAL_DESIGN.md#114-traffic-srcsimtrafficts
- ../../TECHNICAL_DESIGN.md#182-property-tests
- ../../LEVEL_DESIGN.md#71-roads
- ../../LEVEL_DESIGN.md#72-pavements-and-kerbs
- ../../LEVEL_DESIGN.md#73-alleys-and-ginnels
- ../../LEVEL_DESIGN.md#74-junctions-and-turning-space
- ../../LEVEL_DESIGN.md#75-crossings-and-stops
- ../../LEVEL_DESIGN.md#83-default-legend
- ../../LEVEL_DESIGN.md#103-validation-rules

## Roadmap tasks covered

- Deliverable: `traffic.ts` with the lane graph. The pavement nav graph is compiled by `compile-level.ts`.
- `Exit (canonical): traffic lane graph (compile part)`
