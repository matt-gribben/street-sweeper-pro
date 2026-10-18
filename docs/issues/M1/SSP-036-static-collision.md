---
id: SSP-036
title: "Resolve Bessie against static geometry with impact damage and TOWED stub"
milestone: M1
status: todo
type: feature
estimate: M
labels: [type:feature, area:sim, area:physics, area:gameplay, area:test, size:M, vertical-slice]
depends_on: [SSP-031, SSP-035, SSP-032, SSP-029]
blocks: [SSP-037, SSP-046, SSP-049, SSP-050, SSP-060, SSP-062, SSP-070, SSP-079, SSP-081, SSP-090, SSP-092, SSP-180, SSP-295, SSP-240, SSP-241]
---

# SSP-036: Resolve Bessie against static geometry with impact damage and TOWED stub

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** feature · **Size:** M · **Areas:** sim, physics, gameplay, test · **Vertical slice**

## Summary

Implement tick phase 3: `collision/grid.ts` holds the static world (merged solid rects plus prop shapes bucketed per tile), and Bessie is resolved against it with SAT/MTV, restitution 0.2 and 4 HP per m/s of normal speed above 2 m/s. Health is 100 HP, with a stub TOWED event at 0.

## Context

grid.ts (TECHNICAL_DESIGN §9.1):
- Built from the decoded level's `solids` (merged rects, in tiles → metres) and `props`, plus the map boundary as solid.
- Static props (`prop.lamp_post`, `prop.bollard`, `prop.bench`, `prop.bus_shelter`, `prop.phone_box`, `prop.post_box`, `prop.hydrant`, `prop.tree`, `prop.planter`, `prop.market_stall`, `prop.litter_bin`, `prop.roadworks_barrier`) are OBBs or circles, registered in one bucket per tile.
- Prop footprints are not specified: ENTITY_CATALOG §9 says 'opaque bbox of the lowest slice', and slice counts are TBD (M0 spike). OPEN: add one provisional footprint table in one place (proposal: tuning.json → `propFootprints`, keyed by prop id, moving to entities.json in M2), flagged provisional until M4 art. Use a 0.3 m-diameter circle for `prop.bollard` (TECHNICAL_DESIGN §9.5 property uses a 0.3 m bollard). Extend tuning.ts type guards accordingly.
- Parked vehicles (`veh.<type>_parked`) are static OBBs, but they arrive with M3 spawns.

Phase 3 (§9.2):
1. Build Bessie's OBB (1.75 × 3.25 m) at the integrated pose.
2. Sub-step when displacement > 1.0 m (`ceil(d / 1.0)` steps).
3. Query the grid cells overlapped by the OBB's AABB into a preallocated candidate list.
4. SAT against each candidate; keep the minimum-penetration axis.
5. Resolve by MTV, iterating up to 4 times for corners. Then:
   - normal speed `vn = v·n`, reflected with restitution 0.2
   - damage = 4 HP per m/s of vn above 2 m/s, times a `damageMult` param (0.6 with `upg.bumper` later)
   - emit `EV.Impact {vn, x, y}` (a = x, b = y, c = vn)
6. HP ≤ 0 ends the shift with TOWED: in M1, emit a stub `EV.ShiftEnd` (reason TOWED) exactly once. The end-of-shift flow arrives in M2/M3.

Velocity: decompose the world velocity into normal and tangent, reflect the normal part, keep the tangent part, then re-express as vLong/vLat. HP is clamped to [0, 100] (§18.2 property).

OPEN: continuous scraping along a wall would emit EV.Impact every tick. Proposal: emit only for contacts where the incoming normal speed is approaching (vn > 0 before reflection); flag it.

Reference damage numbers (GDD §7.2, ROADMAP VS-2):
- head-on at 11 m/s → 36 HP
- 4 m/s → 8 HP
- 6 m/s lamp post → 16 HP
- ≤ 2 m/s → 0
- with the bumper, 11 m/s → 21.6 HP

Zero allocations per tick. All trig through fmath.

## Scope

- src/sim/collision/grid.ts: static grid built from the decoded level (solid rects, map boundary, provisional prop footprints), per-tile buckets, AABB query into a preallocated candidate list
- Provisional prop footprint table in tuning.json with type guards
- Phase 3 resolution in world.step: sub-step, SAT candidates, MTV iterations (≤ 4), restitution, damage, EV.Impact
- HP 100 init from tuning, clamp to [0, 100], stub TOWED via EV.ShiftEnd once at 0
- Unit tests: damage formula examples, restitution, corner resolution, TOWED emitted exactly once, HP never negative

## Out of scope

- Knockables (M3 bodies.ts), dynamic actors and traffic (M3)
- SACKED/TOWED end-of-shift flow and TallyScene (M2/M3)
- Property tests: SSP-037

## Acceptance criteria

- [ ] Unit test: normal impacts at 11, 6, 4 and 2 m/s cost 36, 16, 8 and 0 HP; with damageMult 0.6, 11 m/s costs 21.6 HP
- [ ] After an impact, the outgoing normal speed is 0.2 × the incoming normal speed (±1e-9), and the tangential speed is unchanged
- [ ] Driving into an inside corner of two merged rects ends the tick with penetration ≤ 1 mm
- [ ] Each resolved approaching contact emits exactly one EV.Impact carrying vn, x and y
- [ ] HP reaching 0 emits a single EV.ShiftEnd (TOWED), and further impacts keep HP at 0 with no extra ShiftEnd
- [ ] Sliding while pressed against a 20-tile merged terrace wall produces only contact normals equal to the wall's outward normal (no ghost-edge normals) and no tangential speed loss from contacts
- [ ] Bessie cannot leave the map: driving at the map edge resolves against the boundary

## Verification

- npm run typecheck
- npm run lint
- npm test -- collision

## Dependencies

**Depends on:**

- [SSP-031](SSP-031-collision-primitives.md) Implement OBB, SAT and sweep sub-step primitives in src/sim/collision
- [SSP-035](SSP-035-world-tick-order.md) Add World, EventQueue and fixed tick order with surface grip and kerb jolts
- [SSP-032](SSP-032-level-map-codec.md) Add src/sim/map.ts compiled-level codec, tile/surface/collide ids and solid merge
- [SSP-029](SSP-029-tuning-data.md) Create tuning.json vehicle.sweeper block and typed src/sim/tuning.ts

**Blocks:**

- [SSP-037](SSP-037-collision-property-tests.md) Add fast-check collision properties: never inside a solid, no tunnelling at 17.2 m/s
- [SSP-046](SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie
- [SSP-049](SSP-049-m1-drive-replay.md) Record and commit the m1_drive_puddle_lane replay and its final-state hash
- [SSP-050](SSP-050-m1-exit-close.md) Verify M1 exit criteria, run the lead handling playtest and open the Close M1 PR
- [SSP-060](../M2/SSP-060-grime-mask.md) Implement dirt.ts grime mask, initial selection, footprint erase and Kerb Hugger
- [SSP-062](../M2/SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event
- [SSP-070](../M2/SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-079](../M3/SSP-079-end-states-sacked-towed.md) End shifts on SACKED (5 complaints) and TOWED (0 HP) with correct tally rules
- [SSP-081](../M3/SSP-081-npc-steering.md) Implement NPC steering: seek, flee, separation, nav paths, zebra crossing
- [SSP-090](../M3/SSP-090-traffic-parked-collision.md) Add parked cars and Bessie-vs-vehicle collision with dent and impact rules
- [SSP-092](../M3/SSP-092-knockable-bodies.md) Implement bodies.ts knockable impulse bodies with spills and penalties
- [SSP-180](../M5/SSP-180-engine-synth.md) Implement engineSynth.ts: Bessie's diesel with load, misfire and tyre squeal
- [SSP-295](../M5/SSP-295-vertical-slice-gate.md) Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR
- [SSP-240](../M7/SSP-240-juice-squash-popups.md) Juice pass: squash-and-stretch, combo popups and the cat roof-ride
- [SSP-241](../M7/SSP-241-juice-impact.md) Add screen shake, hit-stop and gamepad rumble with reduce-motion support

## References

- ../../TECHNICAL_DESIGN.md#91-static-world
- ../../TECHNICAL_DESIGN.md#92-vehicle-vs-static-phase-3
- ../../GDD.md#72-what-those-numbers-feel-like
- ../../ENTITY_CATALOG.md#32-collision-responses
- ../../ENTITY_CATALOG.md#92-static-props
- ../../ROADMAP.md#34-acceptance

## Roadmap tasks covered

- `src/sim/collision/obb.ts`, `sat.ts`, `grid.ts` (static collision grid from the compiled level), `sweep.ts` (sub-step when speed > 0.5 tile/tick). [grid.ts part]
- `Health: 100 HP, with a stub "TOWED!" event at 0 (the end-of-shift flow arrives in M2/M3).`
- `Measurable check: Damage — 4 HP per m/s of normal impact speed above 2 m/s, with restitution 0.2 (unit test).`
