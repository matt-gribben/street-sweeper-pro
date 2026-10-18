---
id: SSP-081
title: "Implement NPC steering: seek, flee, separation, nav paths, zebra crossing"
milestone: M3
status: todo
type: feature
estimate: L
labels: [type:feature, area:sim, area:ai-npc, area:test, size:L, vertical-slice]
depends_on: [SSP-076, SSP-080, SSP-028, SSP-036]
blocks: [SSP-082, SSP-089, SSP-199, SSP-213]
---

# SSP-081: Implement NPC steering: seek, flee, separation, nav paths, zebra crossing

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** L · **Areas:** sim, ai-npc, test · **Vertical slice**

## Summary

Write src/sim/npc/steering.ts, the steering core every pedestrian and animal shares: seek/arrive, flee, separation, path following on the pavement nav graph, sidestepping Bessie's predicted path, and crossing only at crossings unless a behaviour opts into jaywalking. Expose per-zebra occupancy for traffic and penalties.

## Context

TECHNICAL_DESIGN §11.1 steering:
- Seek and arrive along the pavement nav graph (compiled `nav`).
- Separation from other NPCs via the NPC spatial hash.
- Sidestep Bessie's predicted path (1.5 s ahead).
- Crossings only at nav-graph crossing edges (site.zebra, site.school_crossing, dropped kerbs). Behaviours that explicitly jaywalk opt out: in M3 the cat and the businessman (skater and jogger swerves are M6).

Zebra crossing: before crossing, an NPC waits at the kerb node; while any NPC is on the zebra it is OCCUPIED (a per-zebra counter). Readers:
- traffic, which stops at the zebra stop line (SSP-089);
- the running-an-occupied-zebra penalty (−200 + 1 C, SSP-085);
- npc.old_man_frame, who crosses only at zebras and takes 15 s for a 6 m two-lane crossing (0.4 m/s).
The wait-at-kerb gap check needs an approaching-vehicle query; until traffic exists, make it a hook that returns clear.

Pathing must be deterministic and allocation-free: preallocated open/closed buffers, ties broken by node index, paths stored as a node cursor (targetNode) per NPC. Transcendental maths goes through src/sim/fmath.ts. Units: metres, seconds, radians; heading 0 = forward (0, −1).

Open: NPC acceleration and turn rate are not in the docs. Add starting values to tuning.json and flag them as M3 tuning.

## Scope

- Seek, arrive, flee, separation and sidestep primitives operating on NpcStore by index.
- Deterministic shortest-path search on the nav graph with preallocated buffers, plus path following with an arrive radius.
- Zebra crossing: wait-at-kerb gap check hook, per-zebra occupancy counter exposed on World, jaywalk opt-in flag per behaviour.
- Unit and property tests.

## Out of scope

- Reaction states (SSP-082).
- Per-NPC rules.
- Traffic stopping (SSP-089 reads the occupancy).

## Acceptance criteria

- [ ] Property test (fast-check): on random compiled fixture maps, a non-jaywalking NPC following a path never has its centre on a road tile except while traversing a crossing edge, and never ends a tick inside a solid.
- [ ] Unit test: a path request between two nav nodes returns the same node sequence on repeated runs and in a fresh World.
- [ ] Unit test: while an NPC is on a zebra its occupancy is > 0, and it returns to 0 after the NPC leaves.
- [ ] Unit test: two NPCs seeking the same point keep centre separation ≥ 0.6 m (2 × 0.3 m) after settling.
- [ ] Unit test: an NPC standing in Bessie's predicted path 1.5 s ahead moves laterally away from it.
- [ ] Unit test: a jaywalk-flagged NPC may cross a road away from crossings; an unflagged one may not.
- [ ] No allocations per tick (heap check); simPurity passes.

## Verification

- npm test
- npm run test:replay
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-076](SSP-076-compile-lane-nav-graphs.md) Compile the traffic lane graph and pavement nav graph in compile-level.ts
- [SSP-080](SSP-080-npc-store-spawner.md) Add the NPC store, behaviour registry, spawner and phase 7 of the tick
- [SSP-028](../M1/SSP-028-sim-foundations.md) Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type
- [SSP-036](../M1/SSP-036-static-collision.md) Resolve Bessie against static geometry with impact damage and TOWED stub

**Blocks:**

- [SSP-082](SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-089](SSP-089-traffic-lane-following.md) Implement traffic.ts: lane following, queuing behind Bessie, honk, Road Rage, bus stops
- [SSP-199](../M6/SSP-199-people-kids-jogger.md) Implement npc.jogger, npc.kid_skateboard, npc.kid_chalk and school_out/population_wave
- [SSP-213](../M6/SSP-213-lollipop-crossing-parade.md) Implement npc.lollipop_lady, site.school_crossing, crossing_patrol and parade

## References

- ../../TECHNICAL_DESIGN.md#111-behaviour-system
- ../../TECHNICAL_DESIGN.md#74-determinism
- ../../ENTITY_CATALOG.md#34-generic-pedestrian-reaction-model
- ../../ENTITY_CATALOG.md#62-behaviours
- ../../LEVEL_DESIGN.md#75-crossings-and-stops

## Roadmap tasks covered

- `src/sim/npc/steering.ts`: seek, flee, separation, path following on the pavement nav graph, crossing logic at `site.zebra`.
