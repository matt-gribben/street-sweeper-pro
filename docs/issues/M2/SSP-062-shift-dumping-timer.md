---
id: SSP-062
title: "Implement shift.ts dumping FSM, 240 s timer and end-of-shift event"
milestone: M2
status: done
type: feature
estimate: M
labels: [type:feature, area:sim, area:gameplay, size:M, vertical-slice]
depends_on: [SSP-058, SSP-061, SSP-055, SSP-036, SSP-028, SSP-035]
blocks: [SSP-063, SSP-065, SSP-070, SSP-071, SSP-079, SSP-088, SSP-290, SSP-176, SSP-177, SSP-182, SSP-186, SSP-187, SSP-196, SSP-237, SSP-257, SSP-279]
---

# SSP-062: Implement shift.ts dumping FSM, 240 s timer and end-of-shift event

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** feature · **Size:** M · **Areas:** sim, gameplay · **Vertical slice**

## Summary

Build `src/sim/shift.ts` so a shift has a start, a 240 s integer-tick countdown, depot-bay and skip dumping, and a deterministic end (time up, or 0 HP) that raises the end-of-shift event the scenes use to show the tally.

## Context

Timer (TECHNICAL_DESIGN §5.1, LEVEL_DESIGN §4.1): time is an integer tick counter; 240 s = 14,400 ticks (`ticksRemaining`, never a float). Rollout: Bessie starts stationary at `@`, brush up, empty hopper, full water. The timer starts at the first throttle or after 3 s (180 ticks), whichever comes first. LEVEL_DESIGN §13 Q3 is M2's to resolve: confirm and record. The 'first play of Puddle Lane waits for the first brush-lower' rule needs save data (M6), so leave a flag/hook only.
End: at 0 → 'KNOCK-OFF TIME!': driver input is ignored and Bessie coasts to a stop, then `EV.ShiftEnd` (reason TIME_UP). HP ≤ 0 (the M1 TOWED stub) ends the shift through the same path with reason TOWED; the 50% score and no-stars rules arrive in M3. Undumped LU at the end pays nothing (GDD §20 Q10, leaning none; record it).
Dumping (GDD §8.7, TECHNICAL_DESIGN §10.5): FSM Idle → Holding → Draining → Idle, using INTERACT held (E / pad Y).
- Depot bay (`site.depot_bay`): stop inside (speed < 0.5 m/s), hold 1.0 s (60 ticks), drain 2.0 s (120 ticks), refill water to full. Record LU dumped at the depot for the M6 tipping fee (£1 per 5 LU).
- Skip (`site.skip`): stop adjacent, hold 1.0 s, drain 3.0 s (180 ticks), no fee, no water.
- Cancel if speed exceeds 0.5 m/s during Holding; leaving the bay mid-drain cancels the remaining drain (GDD §8.7; LU already drained stays gone, document it).
Emit `EV.DumpStart` (and an end/cancel event if useful). Expose `isDraining` so combo can freeze the chain timer during a drain (GDD §20 Q4, leaning yes).
Open question: what 'inside' a bay and 'adjacent' to a skip mean geometrically (propose: Bessie's OBB centre inside the bay rect; OBB within 1 tile of the skip rect) — document in GDD §8.7. Site rects come from the compiled `sites`. This is tick phase 10.

Hook shape for the first-play rule: a `firstPlay` boolean in the shift start parameters, default false. No caller sets it in M2. SSP-186 (M6) computes it from the save, implements and tests the timer branch (with firstPlay, the timer starts on the first BRUSH press edge, and neither throttle nor the 180-tick fallback starts it), and adds it to the replay header. Implementing the branch here behind the flag is fine if it is cheap and unit-tested, as long as the default path and replay hashes are unchanged.

## Scope

- `src/sim/shift.ts` timer, rollout start rule, knock-off coast, end reasons, `EV.ShiftEnd`
- Dump FSM for depot bays and skips with hopper drain and water refill
- Unit tests for every timing to the tick; record resolved questions in GDD/LEVEL_DESIGN

## Out of scope

- SACKED, complaints, TOWED score rules (M3)
- £ economy, tipping fee payout, wages (M6)
- Free Sweep / Skip Run timers (M6)
- Tally presentation (SSP-071)

## Acceptance criteria

- [x] From timer start, `ticksRemaining` reaches 0 after exactly 14,400 ticks and `EV.ShiftEnd` with reason TIME_UP is emitted on the first tick Bessie's speed is 0 afterwards
- [x] Timer starts on the first tick with throttle > 0, or at tick 180 with no input (unit tests for both)
- [x] Depot dump: stopped in a bay, holding E for 60 ticks starts a drain that empties the hopper over 120 ticks and refills water to full
- [x] Skip dump: 60-tick hold then a 180-tick drain, water unchanged
- [x] Moving above 0.5 m/s during Holding cancels; leaving the bay mid-drain stops the drain
- [x] HP reaching 0 ends the shift with reason TOWED
- [x] LEVEL_DESIGN §13 Q3 and GDD §20 Q4/Q10 are updated with the decisions

## Verification

- npx vitest run tests/unit/shift.test.ts
- npm test
- npm run test:replay
- npm run typecheck

## Dependencies

**Depends on:**

- [SSP-058](SSP-058-hopper.md) Implement hopper.ts LU accounting, mass coupling and bulldozer state
- [SSP-061](SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats
- [SSP-055](SSP-055-compile-frontages-dump-validation.md) Generate frontages and pledges in the compiler and validate dump sites
- [SSP-036](../M1/SSP-036-static-collision.md) Resolve Bessie against static geometry with impact damage and TOWED stub
- [SSP-028](../M1/SSP-028-sim-foundations.md) Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type
- [SSP-035](../M1/SSP-035-world-tick-order.md) Add World, EventQueue and fixed tick order with surface grip and kerb jolts

**Blocks:**

- [SSP-063](SSP-063-scoring-combo.md) Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger
- [SSP-065](SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-070](SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-071](SSP-071-intro-tally-scenes.md) Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry
- [SSP-079](../M3/SSP-079-end-states-sacked-towed.md) End shifts on SACKED (5 complaints) and TOWED (0 HP) with correct tally rules
- [SSP-088](../M3/SSP-088-behaviour-market-trader-pigeon.md) Implement market trader (with market close pile) and pigeon flocks with Pigeon Scatter
- [SSP-290](../M3/SSP-290-tutorial-beats.md) Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events
- [SSP-176](../M5/SSP-176-sfx-event-wiring.md) Wire sim events to sfx cues through a pure audio director
- [SSP-177](../M5/SSP-177-music-state-machine.md) Implement the pure adaptive-music state machine for drums and lead stems
- [SSP-182](../M5/SSP-182-spray-beeper-synth.md) Add spray (sputter, dry pump, refill) and reverse-beeper voices to brushSynth
- [SSP-186](../M6/SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub
- [SSP-187](../M6/SSP-187-progression-economy.md) Add districts.json, upgrades.json and pure week progression and £ ledger
- [SSP-196](../M6/SSP-196-free-sweep.md) Add Free Sweep mode: untimed, no complaints, Pause -> Finish Sweep, cut-down Mercury
- [SSP-237](../M7/SSP-237-assists-sim.md) Wire auto-brush, +60 s timer, Chill Shift and instant dump into the sim
- [SSP-257](../M8/SSP-257-touch-input-device.md) Implement src/input/touch.ts producing the same InputFrame as keyboard and pad
- [SSP-279](../M9/SSP-279-rival-sweeper-sim.md) Give Spotless Sid a full sweeper in the sim: handling, brush, hopper, dumping

## References

- ../../GDD.md#87-dumping
- ../../GDD.md#53-per-shift
- ../../TECHNICAL_DESIGN.md#105-hopper-and-dumping-srcsimhopperts
- ../../TECHNICAL_DESIGN.md#51-loop
- ../../TECHNICAL_DESIGN.md#52-fixed-tick-order
- ../../LEVEL_DESIGN.md#41-phases
- ../../LEVEL_DESIGN.md#13-open-questions
- ../../GDD.md#20-open-design-questions

## Roadmap tasks covered

- Depot and skip dumping in `src/sim/shift.ts`, plus the 240 s timer and end-of-shift event.
- `Measurable check: Dumping — Depot: speed < 0.5 m/s, hold 1.0 s, drain 2.0 s, water refilled to full. Skip: hold 1.0 s, drain 3.0 s, no tipping fee.`
