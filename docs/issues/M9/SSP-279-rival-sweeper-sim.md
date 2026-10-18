---
id: SSP-279
title: "Give Spotless Sid a full sweeper in the sim: handling, brush, hopper, dumping"
milestone: M9
status: todo
type: feature
estimate: M
labels: [type:feature, area:sim, area:physics, area:gameplay, area:test, size:M]
depends_on: [SSP-275, SSP-208, SSP-222, SSP-030, SSP-059, SSP-057, SSP-058, SSP-062]
blocks: [SSP-280]
---

# SSP-279: Give Spotless Sid a full sweeper in the sim: handling, brush, hopper, dumping

**Milestone:** [M9 Desktop & Extra Modes](../README.md#m9) · **Type:** feature · **Size:** M · **Areas:** sim, physics, gameplay, test

## Summary

Extend the M6 Friday-cameo rival into a full second sweeper for Rival Sweep. Sid uses Bessie's handling model, brush and inlet rules, a hopper and depot/skip dumping, driven by a synthetic InputFrame, with per-sweeper LU-dumped counters.

## Context

**Existing entity.** GDD §13.5: 'Sid uses the same handling model and steals litter in front of you; he never collides deliberately.' ENTITY_CATALOG §8.2: `veh.rival_sweeper` steals litter 'using the same inlet rules as Bessie'. It is solid and uses SFX `horn`. It appears in the Friday cameo (`rival_cameo` event: enters, sweeps a fixed route, leaves; LEVEL_DESIGN §4.3) and in Rival Sweep. The sprite already exists from M6: a build-time `rival` ramp swap of Bessie's frames (green and white), 64×64 cell, 28×52 px body, 32 headings, beacon on runtime slot 1 (ART_BIBLE §5.6).

**Rules to reuse unchanged:**
- Brush: swept width 2.6 m (±1.30 m); inlet 1.0 × 0.4 m at y +1.2; collection needs brush down and RPM ≥ 80%. Fling probability p = (v − 4)/2 between 4.0 and 6.0 m/s (ENTITY_CATALOG §3.1).
- Dumping (GDD §8.7, TECHNICAL_DESIGN §10.5): depot bay, stop < 0.5 m/s, hold 1.0 s, drain 2.0 s; skip, hold 1.0 s, drain 3.0 s. FSM `Idle → Holding → Draining → Idle`.
- Undumped hopper contents score nothing (GDD §20 Q10).
- Hopper weight changes handling exactly as it does for Bessie.

**Decisions to record (GDD §13.5):**
- Sid's hopper: base 100 LU (GDD §8.4) with no upgrades, as tuning data (proposed `rival.hopperLu: 100`).
- Sid's dumps pay the player no tipping fee.
- A depot bay or skip serves one sweeper at a time. The first to enter `Holding` owns it, with ties broken by entity id.

**Design.** The AI (SSP-280) emits a quantised InputFrame-shaped struct each tick (TECHNICAL_DESIGN §13.1), so the code in `src/sim/vehicle.ts`, brush and hopper is reused for a second sweeper index rather than duplicated. This issue provides a scripted test driver in place of the AI.

**Tidy %.** Litter Sid takes leaves both the numerator and the denominator, and the Mercury shows a 'Pinched by Sid/gulls' count (ENTITY_CATALOG §17 Q6, decided in M6). Sid's pickups give the player no points and don't refresh the player's chain.

**Constraints:**
- Zero allocations per tick (heap check, TECHNICAL_DESIGN §17).
- Sid counts against the 30-vehicle store.
- His state joins the replay hash only when he is present.
- The sim stays pure.
- The Friday cameo's behaviour and the Promenade replay hash must not change (ROADMAP §5.3: an unintended hash change is a bug).

## Scope

- Second-sweeper support in the sim (vehicle pose, brush state, hopper LU, dump state) for veh.rival_sweeper
- Synthetic per-tick control input for Sid, plus a scripted test driver
- Per-sweeper `luDumped` counters and events (e.g. dump events tagged with the sweeper)
- Dump-site ownership (one sweeper per bay or skip) and no player fee for Sid's dumps
- Tuning entries for Sid's hopper (proposed `rival.hopperLu: 100`)
- Unit and property tests, with the collision property tests extended to Sid; GDD §13.5 notes

## Out of scope

- Sid's decision-making and navigation (SSP-280)
- Rival Sweep UI, HUD and tally (SSP-281)
- Changes to the Friday cameo behaviour or art

## Acceptance criteria

- [ ] Handling parity: given the same start pose and scripted input sequence in an otherwise empty world, Sid's pose matches Bessie's pose tick for tick over 600 ticks (unit test)
- [ ] An item in Sid's inlet with his brush down at RPM ≥ 80% is collected and added to Sid's hopper, not the player's (unit test)
- [ ] Sid stopping in a depot bay adds his hopper LU to his `luDumped` after the 1.0 s hold + 2.0 s drain, and at a skip after 1.0 s + 3.0 s. The player's £ is unchanged (unit tests)
- [ ] While Bessie is Holding or Draining at a bay, Sid can't start dumping there, and vice versa (unit test)
- [ ] Litter Sid takes leaves the player's score and chain untouched and is removed from both Tidy % numerator and denominator (unit test)
- [ ] Property test: Sid never ends a tick inside a solid and never tunnels at top speed, using the same collision invariants as Bessie
- [ ] Every committed replay, including the Promenade (Friday cameo), passes `npm run test:replay` without `--update`
- [ ] The zero-allocation heap check passes with Sid active

## Verification

- npm test
- npm run test:replay
- npm run typecheck && npm run lint

## Dependencies

**Depends on:**

- [SSP-275](SSP-275-mode-plumbing.md) Add Daily Shift and Rival Sweep mode plumbing: params, timer, replay, save
- [SSP-208](../M6/SSP-208-rival-sweeper-cameo.md) Implement veh.rival_sweeper Friday cameo and the rival_cameo event
- [SSP-222](../M6/SSP-222-art-vehicles-m6.md) Art Pass 2: Blender renders for bin lorry, ice cream van, police and Sid's sweeper
- [SSP-030](../M1/SSP-030-vehicle-model.md) Implement Bessie's kinematic bicycle model in src/sim/vehicle.ts
- [SSP-059](../M2/SSP-059-brush.md) Implement brush.ts state machine, suction, inlet collection and fling roll
- [SSP-057](../M2/SSP-057-litter-field.md) Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn
- [SSP-058](../M2/SSP-058-hopper.md) Implement hopper.ts LU accounting, mass coupling and bulldozer state
- [SSP-062](../M2/SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event

**Blocks:**

- [SSP-280](SSP-280-rival-ai-controller.md) Build Sid's Rival Sweep AI on the lane graph and LitterField

## References

- ../../GDD.md#135-rival-sweep-m9
- ../../GDD.md#84-hopper
- ../../GDD.md#87-dumping
- ../../ENTITY_CATALOG.md#82-behaviour-collision-and-districts
- ../../ENTITY_CATALOG.md#31-how-litter-is-collected
- ../../ENTITY_CATALOG.md#17-open-questions
- ../../ART_BIBLE.md#56-ramp-swaps-per-instance-palette-variants
- ../../TECHNICAL_DESIGN.md#8-vehicle-model
- ../../TECHNICAL_DESIGN.md#105-hopper-and-dumping-srcsimhopperts
- ../../TECHNICAL_DESIGN.md#131-actions-and-the-inputframe
- ../../TECHNICAL_DESIGN.md#71-world-and-stores
- ../../TECHNICAL_DESIGN.md#17-performance-budgets
- ../../ROADMAP.md#53-replay-hash-policy

## Roadmap tasks covered

- Rival Sweep: versus `veh.rival_sweeper` (Spotless Sid), most LU dumped in 180 s. Rival AI reuses the traffic and litter systems.
