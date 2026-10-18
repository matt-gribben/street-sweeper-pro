---
id: SSP-030
title: "Implement Bessie's kinematic bicycle model in src/sim/vehicle.ts"
milestone: M1
status: done
type: feature
estimate: M
labels: [type:feature, area:sim, area:physics, area:test, size:M, vertical-slice]
depends_on: [SSP-028, SSP-029]
blocks: [SSP-035, SSP-050, SSP-058, SSP-059, SSP-093, SSP-180, SSP-182, SSP-188, SSP-198, SSP-202, SSP-279]
---

# SSP-030: Implement Bessie's kinematic bicycle model in src/sim/vehicle.ts

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** feature · **Size:** M · **Areas:** sim, physics, test · **Vertical slice**

## Summary

Implement TECHNICAL_DESIGN §8.2 steps 1–8: hopper-scaled handling, top-speed selection, rate-limited steering, drive/brake/reverse, drag, yaw, lateral grip decay and semi-implicit position integration. It is surface-agnostic: the caller passes grip and the rolling-drag multiplier. Unit tests prove the M1 handling numbers.

## Context

State (TECHNICAL_DESIGN §8.1): `x, y, heading, vLong, vLat, steer (δ), yawRate, gear (FWD|REV), brushDown, brushPos, rpm, hp, hopperLU, water`. Store as Float64 (§7.1). Copy `prevX`, `prevY` and `prevHeading` at the start of each tick for render interpolation. In M1, `brushPos`, `rpm`, `hopperLU` and `water` exist but stay at their defaults.

Per tick (DT = 1/60), all values from the tuning object (SSP-029):
1. Fill: `f = hopperLU / capacity`. Then `mass = 4200 + 1500·f`, `accel = 2.4·lerp(1, 0.70, f)`, `vTop = vTopBase·lerp(1, 0.90, f)`, `steerRate = 120°/s·lerp(1, 0.85, f)`.
2. `vTopBase` = 6.0 m/s if `brushDown`, else 11.0 m/s, times a `topSpeedMult` parameter (default 1; Bacon Butty and Engine plug in later).
3. Steering: target `δ* = steerInput·34°/(1 + |vLong|/8)`. `δ` moves toward `δ*` at `steerRate`, or at 180°/s when steer input is 0. An analogue stick maps straight to the target angle.
4. Drive:
   - throttle: `vLong += accel·throttle·DT`, clamped to `vTop`
   - brake: `vLong → 0` at 6.0 m/s²
   - reverse: brake held with |vLong| < 0.2 m/s for 0.25 s (15 ticks) engages REV (max 2.5 m/s, accel 1.5 m/s²). Expose a flag so the World can emit `EV.ReverseBeeper`.
5. Drag: TECHNICAL_DESIGN writes `a = 0.3·sign(v) + 0.012·v²`. Implement it so both terms oppose motion: `a = sign(vLong)·(0.3·rollMult + 0.012·vLong²)`, with `rollMult` from the caller (2.5 on grass). Drag never flips the sign of `vLong`. Note this sign clarification in TECHNICAL_DESIGN §8.2 step 5.
6. Yaw: `yawRate = vLong/2.4·tan(δ)`, then `heading += yawRate·DT`.
7. Grip: re-express the previous world velocity in the new heading frame. The longitudinal part becomes `vLong`; the lateral part decays as `vLat *= exp(−k·DT)`, with `k` passed in by the caller.
8. Position: `pos += (forward·vLong + right·vLat)·DT`.

Because drag is applied after the throttle clamp, the end-of-tick speed at full throttle settles slightly below vTop (≈ vTop − drag·DT: 6.0 − 0.012, 11.0 − 0.029). Tests must allow for that rather than change the order.

Inputs come from the InputFrame: throttle/brake 0..255 → 0..1, steer −127..127 → −1..1. The BRUSH pressed edge toggles `brushDown`. That is a flag only in M1; the 0.5 s brushPos and RPM animation is M2 `brush.ts`.

Turning circle check (TECHNICAL_DESIGN §18.1): diameter at the rear axle = 2·2.4/tan(δmax(v)); at v = 0.1 m/s that is ≈ 7.23 m, at 1.4 m/s ≈ 8.68 m. Measure it by holding vLong at the target speed (a test helper may set vLong each tick) with full steer settled.

OPEN (flag in the PR):
- Brush state at spawn. The docs imply up, since GDD §16.1 starts the timer on the first brush-lower on the first play.
- REV controls. The docs only say 'brake held at standstill engages reverse'. Proposal: in REV, brake accelerates backwards and throttle brakes, returning to FWD at standstill.
- 'Brake 6.0 m/s²' with drag also applied makes the measured deceleration 6.0 + drag. Assert the brake term in isolation, or allow for drag in the test, and say which.
- GDD §7.2 derived times (0→4 m/s in ≈1.7 s) ignore drag. Do not assert them.

Hot path: zero allocations per tick, module-level scratch, fmath for every trig/exp call. The kerb-crossing step and the surface lookup live in the SSP-035 issue.

## Scope

- src/sim/vehicle.ts: vehicle state store, init from tuning, `stepVehicle(state, input, surface {k, rollMult}, params)` implementing §8.2 steps 1–8
- Hopper-fill hook (f from hopperLU/capacity) with the mass/accel/vTop/steerRate scaling
- topSpeedMult and damage-multiplier hooks as plain parameters (no power-up or upgrade logic)
- Reverse engage logic plus a flag for the World to turn into EV.ReverseBeeper
- Unit tests in tests/unit/vehicle.test.ts
- Doc note on the drag sign in TECHNICAL_DESIGN §8.2

## Out of scope

- Kerb crossing (§8.2 step 9) and per-wheel surface sampling: SSP-035
- Scripted impulses (banana spin-out, potholes, speed bumps): M2/M3
- brushPos/RPM animation and collection gating: M2
- Collision response: SSP-036

## Acceptance criteria

- [x] Full throttle with the brush down (k = 9.0, rollMult = 1) never exceeds 6.0 m/s over a 30 s run, and its end-of-tick speed after 10 s is ≥ 5.95 m/s
- [x] Full throttle in transit never exceeds 11.0 m/s and its end-of-tick speed after 20 s is ≥ 10.95 m/s
- [x] Brake-only deceleration is 6.0 m/s² (or the test documents the drag allowance explicitly)
- [x] Reverse engages only after brake is held for ≥ 15 ticks below 0.2 m/s, and reverse speed never exceeds 2.5 m/s
- [x] Turning circle (diameter, rear axle) is 7.1 m ± 0.2 at a held 0.1 m/s and 8.7 m ± 0.3 at a held 1.4 m/s
- [x] Hopper-hook values match the GDD §7.4 table at f = 0.5 (2.04 m/s², 5.7/10.45 m/s, 111°/s), f = 0.8 (1.82, 5.52/10.12, 106°/s) and f = 1.0 (1.68, 5.4/9.9, 102°/s), within 0.01 (steer rate within 1°/s)
- [x] With a centred input, steer returns at 180°/s; otherwise it moves at most steerRate·DT per tick
- [x] vLat decays by exp(−k·DT) per tick with no lateral input (checked at k = 9.0 and k = 1.2)
- [x] Coasting in REV, drag reduces |vLong| (never accelerates it) and never flips its sign
- [x] Running the same input sequence twice produces bit-identical state
- [x] Code review confirms no `new`, array or object literals, closures, or map/filter inside stepVehicle (the heap check arrives with SSP-038)

## Verification

- npm run typecheck
- npm run lint
- npm test -- vehicle

## Dependencies

**Depends on:**

- [SSP-028](SSP-028-sim-foundations.md) Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type
- [SSP-029](SSP-029-tuning-data.md) Create tuning.json vehicle.sweeper block and typed src/sim/tuning.ts

**Blocks:**

- [SSP-035](SSP-035-world-tick-order.md) Add World, EventQueue and fixed tick order with surface grip and kerb jolts
- [SSP-050](SSP-050-m1-exit-close.md) Verify M1 exit criteria, run the lead handling playtest and open the Close M1 PR
- [SSP-058](../M2/SSP-058-hopper.md) Implement hopper.ts LU accounting, mass coupling and bulldozer state
- [SSP-059](../M2/SSP-059-brush.md) Implement brush.ts state machine, suction, inlet collection and fling roll
- [SSP-093](../M3/SSP-093-hazards-grip-jolts.md) Implement hazard grip overrides, jolts, LU spills and the open-manhole hard stop
- [SSP-180](../M5/SSP-180-engine-synth.md) Implement engineSynth.ts: Bessie's diesel with load, misfire and tyre squeal
- [SSP-182](../M5/SSP-182-spray-beeper-synth.md) Add spray (sputter, dry pump, refill) and reverse-beeper voices to brushSynth
- [SSP-188](../M6/SSP-188-upgrade-modifiers.md) Apply upg.* levels to the sim via tuning.ts modifiers and record loadout in replays
- [SSP-198](../M6/SSP-198-skip-run.md) Implement SkipRunScene: 45 s cone slalom and reverse-park bays with £5/£50 payouts
- [SSP-202](../M6/SSP-202-rain-weather.md) Implement rain: road grip 6.0, puddle density, rain FX and amb.rain hookup
- [SSP-279](../M9/SSP-279-rival-sweeper-sim.md) Give Spotless Sid a full sweeper in the sim: handling, brush, hopper, dumping

## References

- ../../TECHNICAL_DESIGN.md#8-vehicle-model
- ../../TECHNICAL_DESIGN.md#82-per-tick-integration-phase-2
- ../../TECHNICAL_DESIGN.md#181-unit-tests-examples
- ../../GDD.md#71-handling-sheet
- ../../GDD.md#74-load-the-hopper-makes-bessie-heavier
- ../../GDD.md#62-control-design-notes
- ../../ROADMAP.md#m1-drivable-bessie
- ../../TECHNICAL_DESIGN.md#17-performance-budgets

## Roadmap tasks covered

- `src/sim/vehicle.ts`: kinematic bicycle model (wheelbase 2.4 m, max steer 34° scaled by `1/(1 + v/8)`, steer rate 120°/s, return 180°/s), drag (0.3 m/s² + 0.012·v²), per-surface lateral grip decay, and mass scaling with hopper fill (hook only; the hopper arrives in M2).
- `Measurable check: Handling matches tuning (top speeds, brake, reverse, turning circles)`
