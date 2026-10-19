---
id: SSP-058
title: "Implement hopper.ts LU accounting, mass coupling and bulldozer state"
milestone: M2
status: done
type: feature
estimate: S
labels: [type:feature, area:sim, area:physics, size:S, vertical-slice]
depends_on: [SSP-053, SSP-030, SSP-035]
blocks: [SSP-059, SSP-062, SSP-070, SSP-093, SSP-096, SSP-299, SSP-176, SSP-180, SSP-181, SSP-188, SSP-237, SSP-279]
---

# SSP-058: Implement hopper.ts LU accounting, mass coupling and bulldozer state

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** feature · **Size:** S · **Areas:** sim, physics · **Vertical slice**

## Summary

Add `src/sim/hopper.ts` to track litter units, feed fill fraction into the M1 vehicle handling hook, flag the bulldozer state at full and expose a drain API for dumping.

## Context

Rules (GDD §8.4, TECHNICAL_DESIGN §10.5): base capacity 100 LU (from tuning; `upg.hopper` raises it later); HUD warning at 80%; at full the brush bulldozes instead of collecting and `EV.HopperFull` fires once per fill (clunk SFX later).
Mass coupling (TECHNICAL_DESIGN §8.2, GDD §7.4): `f = hopperLU / capacity`; mass = 4200 + 1500·f; accel = 2.4·lerp(1, 0.70, f); vTop = vTopBase·lerp(1, 0.90, f); steerRate = 120°/s·lerp(1, 0.85, f). Expected (GDD §7.4): 50% → 2.04 m/s², 5.7 / 10.45 m/s, 111°/s; 80% → 1.82 m/s², 5.52 / 10.12 m/s, 106°/s; 100% → 1.68 m/s², 5.4 / 9.9 m/s, 102°/s. Penalties scale with fill fraction, not absolute LU.
Drain API for `shift.ts`: LU removed linearly over the drain time; bulldozer state clears after a dump. Track total LU dumped (and at the depot separately) for later tipping fees (£1 per 5 LU, M6 economy).
Open question: overflow when an item's LU would push past capacity (e.g. 99.5 LU + a 1 LU item). TECHNICAL_DESIGN §18.2 requires 'hopper LU never exceeds capacity', and 'full' must be reachable (with 0.5/1/2/3/8 LU items a fits-only rule can leave the hopper stuck below 100 and never fire HopperFull). Propose: the item is collected and scored, LU is clamped to capacity (excess lost), and the hopper becomes full. Document the rule in GDD §8.4.
The 80% warning needs no new event: the HUD reads state. Spills from potholes and speed bumps are M3.

## Scope

- `src/sim/hopper.ts` with add, drain, fill fraction, isFull, warn flag, LU-dumped counters
- Wire fill fraction into the M1 `vehicle.ts` hook
- Emit `EV.HopperFull` once per fill
- Unit tests for the GDD §7.4 table and a fast-check property for LU bounds
- Document the overflow rule in GDD §8.4

## Out of scope

- Dump site logic (SSP-062)
- Upgrades and hopper spills (M3/M6)
- Hopper SFX (M5)

## Acceptance criteria

- [x] Unit tests reproduce the GDD §7.4 table at 0/50/80/100% within 0.01
- [x] Property test: for any sequence of adds and drains, 0 ≤ hopperLU ≤ capacity
- [x] Adding a 1 LU item at 99.5 LU leaves the hopper at exactly 100 and full (unit test)
- [x] `EV.HopperFull` fires exactly once per transition to full and again only after a dump empties it below capacity
- [x] The overflow rule is documented in GDD §8.4

## Verification

- npx vitest run tests/unit/hopper.test.ts tests/property/hopper.prop.test.ts
- npm test
- npm run test:replay
- npm run typecheck

## Dependencies

**Depends on:**

- [SSP-053](SSP-053-entities-tuning-seed.md) Seed entities.json with litter, stains and pickups; add M2 values to tuning.json
- [SSP-030](../M1/SSP-030-vehicle-model.md) Implement Bessie's kinematic bicycle model in src/sim/vehicle.ts
- [SSP-035](../M1/SSP-035-world-tick-order.md) Add World, EventQueue and fixed tick order with surface grip and kerb jolts

**Blocks:**

- [SSP-059](SSP-059-brush.md) Implement brush.ts state machine, suction, inlet collection and fling roll
- [SSP-062](SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event
- [SSP-070](SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-093](../M3/SSP-093-hazards-grip-jolts.md) Implement hazard grip overrides, jolts, LU spills and the open-manhole hard stop
- [SSP-096](../M3/SSP-096-power-ups.md) Spawn power-ups on pavements, implement all six pwr.* effects, draw them
- [SSP-299](../M3/SSP-299-hud-brush-tidy-arrows.md) Add the Brush-o-meter, brush state ring, district name with Tidy % bar, and off-screen depot/hydrant arrows to the HUD
- [SSP-176](../M5/SSP-176-sfx-event-wiring.md) Wire sim events to sfx cues through a pure audio director
- [SSP-180](../M5/SSP-180-engine-synth.md) Implement engineSynth.ts: Bessie's diesel with load, misfire and tyre squeal
- [SSP-181](../M5/SSP-181-brush-suction-synth.md) Implement brushSynth.ts brush, suction fan, scrub crackle and bulldozer layers
- [SSP-188](../M6/SSP-188-upgrade-modifiers.md) Apply upg.* levels to the sim via tuning.ts modifiers and record loadout in replays
- [SSP-237](../M7/SSP-237-assists-sim.md) Wire auto-brush, +60 s timer, Chill Shift and instant dump into the sim
- [SSP-279](../M9/SSP-279-rival-sweeper-sim.md) Give Spotless Sid a full sweeper in the sim: handling, brush, hopper, dumping

## References

- ../../GDD.md#84-hopper
- ../../GDD.md#74-load-the-hopper-makes-bessie-heavier
- ../../TECHNICAL_DESIGN.md#105-hopper-and-dumping-srcsimhopperts
- ../../TECHNICAL_DESIGN.md#82-per-tick-integration-phase-2
- ../../TECHNICAL_DESIGN.md#182-property-tests

## Roadmap tasks covered

- `src/sim/hopper.ts`: LU accounting, mass coupling into `vehicle.ts`, bulldozer state.
- `Measurable check: Hopper — 100 LU capacity; 80% HUD warning; bulldozer when full; mass +1,500 kg, accel ×0.70, top speed ×0.90, steer ×0.85`
