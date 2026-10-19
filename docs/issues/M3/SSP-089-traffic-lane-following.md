---
id: SSP-089
title: "Implement traffic.ts: lane following, queuing behind Bessie, honk, Road Rage, bus stops"
milestone: M3
status: done
type: feature
estimate: L
labels: [type:feature, area:sim, area:ai-npc, area:gameplay, area:test, size:L, vertical-slice]
depends_on: [SSP-076, SSP-077, SSP-078, SSP-081, SSP-035, SSP-031]
blocks: [SSP-090, SSP-103, SSP-288, SSP-201, SSP-203, SSP-204, SSP-208, SSP-209, SSP-211, SSP-213, SSP-280]
---

# SSP-089: Implement traffic.ts: lane following, queuing behind Bessie, honk, Road Rage, bus stops

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** L · **Areas:** sim, ai-npc, gameplay, test · **Vertical slice**

## Summary

Build the vehicle store and src/sim/traffic.ts (tick phase 8). Moving traffic follows the compiled lane graph, slows and queues behind Bessie and other obstacles, honks after 3 s blocked, files a Road Rage complaint after more than 10 s, stops for occupied zebras, and buses dwell 5 s at stops.

## Context

TECHNICAL_DESIGN §11.4 and ENTITY_CATALOG §8.2–8.3:

Store and movement
- VehicleStore: capacity 30 (moving + parked), struct-of-arrays, swap-remove.
- Follow lane edges (speed limit, stop lines at site.zebra, site.school_crossing, site.bus_stop).
- Car following: vMax = sqrt(2 · 3.0 m/s² · max(0, gap − 2.5 m)); the leader may be Bessie projected onto the lane.
- Stop at an occupied zebra (occupancy from SSP-081); also wire the SSP-081 wait-at-kerb gap hook to real vehicles.

State machine: Cruise → Queue (obstacle ahead: Bessie, bus, zebra) → Honk (blocked by Bessie ≥ 3 s) → RoadRage (> 10 s: +1 complaint, reason RoadRage) → Cruise when the path clears.
- The block timer resets when the path clears. Each continuous block of more than 10 s by the same queue costs ONE complaint.
- Audio later (AUDIO_DESIGN §5.5): rising car honks at 3, 6 and 9 s, then complaint_stamp. Emit a car-honk event (e.g. EV.Horn with a car flag) at 180, 360 and 540 ticks; it never feeds the player's horn-spam window and is never delivered as an NPC Horn stimulus.

Buses dwell 5 s at each site.bus_stop on busRoute, every busEveryS seconds (Tue: 45 s from 20 s).

Spawning
- Spawn/despawn only at map-edge lane portals with the full OBB outside world.viewRect (±28 × ±14.2 m, already including the margin).
- Density = densityPerKm × lane-km; mix by weight; `traffic` sfc32 stream. Moving count never exceeds 30 minus the parked count.
- Add a vehicle spatial lookup (grid buckets) usable by collision and render culling.

Vehicle body sizes (m): hatchback 1.63×2.88, saloon 1.75×3.38, taxi 1.75×3.38, van_white 1.88×3.75, bus 2.38×7.25.

Open: acceleration and cruise speeds are unspecified. Use the lane speedLimit and a tuning value flagged as M3 tuning.

## Scope

- VehicleStore and traffic.ts: lane following, car following, zebra and bus-stop stop lines, Queue/Honk/RoadRage FSM with per-queue block timers.
- Bus route dwell.
- Portal spawn and despawn outside viewRect; vehicle spatial lookup.
- Call phase 8 in World.step; extend tests/unit/tickOrder.test.ts (create if missing).
- tests/unit/traffic.test.ts.

## Out of scope

- Parked cars and Bessie-vs-vehicle collision (SSP-090).
- Taxi fare stops, white van parking, bicycle filtering, mobility scooter (SSP-091).
- Police witness (M6). Rendering (SSP-103).

## Acceptance criteria

- [ ] Test: a car approaching a stationary Bessie in its lane stops with gap ≥ 2.5 m and never overlaps her.
- [ ] Test: blocked by Bessie, a car emits car-honk events at 180, 360 and 540 ticks and adds exactly 1 Road Rage complaint at tick 601; staying blocked to 1,200 ticks adds no second complaint; clearing and re-blocking for more than 600 ticks adds another.
- [ ] Test: car honks never change the player's horn-spam count.
- [ ] Test: a bus stops 300 ticks at each bus stop on its route.
- [ ] Test: cars stop for an occupied zebra and proceed once it is clear.
- [ ] Test: no vehicle spawns or despawns while its OBB intersects viewRect.
- [ ] tickOrder.test.ts confirms phase 8 follows phase 7 and precedes phase 9.

## Verification

- npm test
- npm run test:replay
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-076](SSP-076-compile-lane-nav-graphs.md) Compile the traffic lane graph and pavement nav graph in compile-level.ts
- [SSP-077](SSP-077-compile-spawn-specs.md) Compile NPC, traffic, hazard, knockable and power-up spawn specs from level.json
- [SSP-078](SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-081](SSP-081-npc-steering.md) Implement NPC steering: seek, flee, separation, nav paths, zebra crossing
- [SSP-035](../M1/SSP-035-world-tick-order.md) Add World, EventQueue and fixed tick order with surface grip and kerb jolts
- [SSP-031](../M1/SSP-031-collision-primitives.md) Implement OBB, SAT and sweep sub-step primitives in src/sim/collision

**Blocks:**

- [SSP-090](SSP-090-traffic-parked-collision.md) Add parked cars and Bessie-vs-vehicle collision with dent and impact rules
- [SSP-103](SSP-103-render-actors-traffic.md) Draw NPCs, animals, traffic, knockables and hazards with state-driven frames
- [SSP-288](SSP-288-popups-speech-bubbles.md) Add src/ui/popups.ts: world-space score/penalty popups and NPC speech bubbles
- [SSP-201](../M6/SSP-201-bin-lorry.md) Implement veh.bin_lorry and the bin_round event
- [SSP-203](../M6/SSP-203-district-high-street-final.md) Bring district.high_street to final M6 quality with collectibles and 3-star replay
- [SSP-204](../M6/SSP-204-district-gasworks.md) Author and compile district.gasworks (Wednesday, rain) with its district replay
- [SSP-208](../M6/SSP-208-rival-sweeper-cameo.md) Implement veh.rival_sweeper Friday cameo and the rival_cameo event
- [SSP-209](../M6/SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-211](../M6/SSP-211-reveller-police.md) Implement npc.reveller, kicking_out, veh.police witness rule and police_parked
- [SSP-213](../M6/SSP-213-lollipop-crossing-parade.md) Implement npc.lollipop_lady, site.school_crossing, crossing_patrol and parade
- [SSP-280](../M9/SSP-280-rival-ai-controller.md) Build Sid's Rival Sweep AI on the lane graph and LitterField

## References

- ../../TECHNICAL_DESIGN.md#114-traffic-srcsimtrafficts
- ../../TECHNICAL_DESIGN.md#74-determinism
- ../../ENTITY_CATALOG.md#82-behaviour-collision-and-districts
- ../../ENTITY_CATALOG.md#83-traffic-car-state-machine
- ../../LEVEL_DESIGN.md#95-traffic
- ../../AUDIO_DESIGN.md#55-events-with-no-dedicated-sfx

## Roadmap tasks covered

- `src/sim/traffic.ts`: lane graph following, stopping behind Bessie, honk after 3 s blocked, the 10 s Road Rage complaint, bus stops at `site.bus_stop` for 5 s.
- `Fill in tick order steps 4, 7 and 8. (step 8)`
- `Exit (measurable): Complaints: Blocking traffic over 10 s = 1 complaint.`
