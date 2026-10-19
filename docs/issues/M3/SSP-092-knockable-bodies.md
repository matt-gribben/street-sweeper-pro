---
id: SSP-092
title: "Implement bodies.ts knockable impulse bodies with spills and penalties"
milestone: M3
status: done
type: feature
estimate: M
labels: [type:feature, area:sim, area:physics, area:gameplay, area:test, size:M, vertical-slice]
depends_on: [SSP-075, SSP-077, SSP-078, SSP-031, SSP-036, SSP-057]
blocks: [SSP-103, SSP-104, SSP-105, SSP-106, SSP-108, SSP-176, SSP-198, SSP-201]
---

# SSP-092: Implement bodies.ts knockable impulse bodies with spills and penalties

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** sim, physics, gameplay, test · **Vertical slice**

## Summary

Write src/sim/bodies.ts (tick phase 4) so wheelie bins, cones, A-boards, trolleys and recycling boxes slide and spin when Bessie hits them. Bins and recycling boxes spill litter on the first hit, and the per-prop penalties apply.

## Context

TECHNICAL_DESIGN §9.3 and ENTITY_CATALOG §9.1:
- Circles or small OBBs with linear and angular velocity, ground friction and restitution against the static grid. Bessie is an infinite-mass mover. Bodies do not stack.
- Sub-step a body when its displacement exceeds half its smallest extent, so a flung cone (about 0.4 m) cannot tunnel through a bollard.
- Capacity: 128 knockables.

Props: wheelie_bin 30 kg, −50, spills 4; traffic_cone 2 kg, free; a_board −25; shopping_trolley free; recycling_box −25, spills 2. Masses for A-board, trolley and recycling box come from entities.json (chosen in SSP-075).

Spills spawn litter through litter.ts on the FIRST hit only, drawn from the district small-litter table, worth normal points and counted in litter spawned.

A prop with a penalty resets the combo chain. Free props (cone, trolley) do not. Knockables never damage Bessie or slow her meaningfully. Emit an event for later SFX (bin_knock, cone_knock).

Second hits are unspecified: propose that the penalty, like the spill, applies only on a prop's first hit; document it in ENTITY_CATALOG §9.1 and flag it.

Placement: compiled level `knockables` ({id, at}). Collision shape = opaque bounding box of the lowest slice, as an OBB. Note prop.traffic_cone is not allowed in Mon/Tue districts (L005), so tests use fixtures.

Phase 4 sits between static collision (3) and brush/litter (5).

## Scope

- KnockableStore and bodies.ts with friction, restitution and sub-stepping.
- Bessie contact impulses, first-hit spills and penalty facts.
- Spawn knockables from the compiled level.
- Call phase 4 in World.step; extend tests/unit/tickOrder.test.ts (create if missing).
- tests/unit/bodies.test.ts and tests/property/knockables.prop.test.ts.

## Out of scope

- Static props (solid since M1).
- Placeholder art (SSP-101).

## Acceptance criteria

- [ ] Test: hitting a wheelie bin costs −50, resets the chain and spills exactly 4 items; a second hit on the same bin spills and costs nothing.
- [ ] Test: a recycling box spills 2 and costs −25; an A-board costs −25; a cone or trolley costs 0 and does not reset the chain.
- [ ] Test: Bessie's speed loss from hitting a 30 kg bin at 6 m/s is < 5%, and HP is unchanged.
- [ ] Property test: over 10,000 generated impacts up to 17.2 m/s, a cone never passes through a 0.3 m bollard or a 1-tile wall.
- [ ] tickOrder.test.ts confirms phase 4 runs between phases 3 and 5.
- [ ] The zero-allocation check passes with 128 bodies.

## Verification

- npm test
- npm run test:replay
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-075](SSP-075-entity-data-freeze.md) Freeze the Mon–Tue entity set in entities.json and add M3 shared tuning
- [SSP-077](SSP-077-compile-spawn-specs.md) Compile NPC, traffic, hazard, knockable and power-up spawn specs from level.json
- [SSP-078](SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-031](../M1/SSP-031-collision-primitives.md) Implement OBB, SAT and sweep sub-step primitives in src/sim/collision
- [SSP-036](../M1/SSP-036-static-collision.md) Resolve Bessie against static geometry with impact damage and TOWED stub
- [SSP-057](../M2/SSP-057-litter-field.md) Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn

**Blocks:**

- [SSP-103](SSP-103-render-actors-traffic.md) Draw NPCs, animals, traffic, knockables and hazards with state-driven frames
- [SSP-104](SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up
- [SSP-105](SSP-105-high-street-greybox.md) Author and compile the grey-box High Street (80×60) for Tuesday's NPCs
- [SSP-106](SSP-106-npc-stress-budget.md) Prove the NPC budget: 80 NPCs, 30 vehicles, 2,000 litter, allocation-free
- [SSP-108](SSP-108-penalty-table-test.md) Add the table-driven penalty and complaint test against entities.json
- [SSP-176](../M5/SSP-176-sfx-event-wiring.md) Wire sim events to sfx cues through a pure audio director
- [SSP-198](../M6/SSP-198-skip-run.md) Implement SkipRunScene: 45 s cone slalom and reverse-park bays with £5/£50 payouts
- [SSP-201](../M6/SSP-201-bin-lorry.md) Implement veh.bin_lorry and the bin_round event

## References

- ../../TECHNICAL_DESIGN.md#93-knockables-phase-4
- ../../ENTITY_CATALOG.md#91-knockable-props
- ../../TECHNICAL_DESIGN.md#52-fixed-tick-order
- ../../TECHNICAL_DESIGN.md#95-property-tests

## Roadmap tasks covered

- `src/sim/bodies.ts`: knockable impulse bodies with masses and spill counts from `entities.json`.
- `Fill in tick order steps 4, 7 and 8. (step 4)`
