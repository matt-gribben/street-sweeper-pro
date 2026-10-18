---
id: SSP-180
title: "Implement engineSynth.ts: Bessie's diesel with load, misfire and tyre squeal"
milestone: M5
status: todo
type: feature
estimate: M
labels: [type:feature, area:audio, area:test, size:M, vertical-slice]
depends_on: [SSP-179, SSP-030, SSP-036, SSP-059, SSP-058, SSP-093]
blocks: [SSP-185, SSP-239, SSP-264]
---

# SSP-180: Implement engineSynth.ts: Bessie's diesel with load, misfire and tyre squeal

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** feature · **Size:** M · **Areas:** audio, test · **Vertical slice**

## Summary

Synthesise Bessie's hydrostatic 4-cylinder diesel live. Pitch follows speed, throttle, brush work-RPM and hopper load, with a misfire below 40 HP and a tyre-squeal layer driven by lateral slip. This delivers Pillar 2 by ear.

## Context

**Parameter map** (AUDIO_DESIGN §6.1), as a pure function `engineMap(simView) → params`:
- `rpm = max(idle, workFloor, 750 + 1,650 × max(0.6 × throttle, |v| / 11))`, where idle = 750; `workFloor` = 1,800 while the brush is lowered (ramping over the 0.6 s spin-up), else 0; ceiling **2,400**.
- Firing frequency `f0 = rpm / 60 × 2`, i.e. 25 Hz at idle and 80 Hz at 2,400.
- Hopper fill h (0–1): pitch × (1 − 0.05h), strain-noise layer +2 dB × h, low-pass cutoff × (1 − 0.15h).
- Throttle: LP cutoff = 300 + 1,500 × throttle Hz, Q 0.9.
- HP < 40 (the dented sprite): misfire, i.e. a seeded 1-in-12 cycle dropout, plus a loose-panel rattle (band-passed noise gated at f0/2).
- Lateral slip (`vLat`): tyre squeal = narrow BP at 1.6–2.2 kHz following slip, on noise mixed with a detuned square pair. Gain 0 below 0.8 m/s slip, full at 3 m/s. On `haz.oil_slick` the squeal is a higher 'whee'. This also covers banana spin-out, wet leaves and hard cornering (§5.5).
- Reverse: no engine change.

**Voice:**
1. pulse at f0 (duty 0.3) → soft clipper;
2. saw at 2 × f0, +7 cents;
3. sine sub at f0/2;
4. clatter: noise AM at f0, HP 1.2 kHz, −14 dB.

All four sum through the throttle LP into the `live` bus (−12 dB). The engine is always centred at 0 dB, is muted under the shift intro card, starts with the shift, and freezes on pause. The misfire RNG is an audio-side sfc32, never sim RNG.

**Tests:**
- `tests/unit/audio/engineMap.test.ts`: fixed states (idle, brush down, transit at 11 m/s, full hopper, below 40 HP).
- Exit check: 'Engine pitch follows speed and load (hopper fill)', verified by an OfflineAudioContext render test in Playwright via the SSP-179 audio-lab hook.

**Sim reads** (TECHNICAL_DESIGN §8.1 state): `vLong`, `vLat`, throttle input, `brushDown`/`brushPos`/`rpm`, `hopperLU` (fill = LU / capacity), `hp`, current surface. If surface is not exposed as a read-only view, add a read-only accessor in the render/app layer. Do not write to the sim; any new sim field needed for hashing must be called out.

## Scope

- Pure `engineMap` function plus unit tests
- Engine worklet voice built from the shared kernels (pulse, saw, sine, noise, SVF, soft clip)
- `src/audio/engineSynth.ts` controller: build per shift, read sim view per rendered frame, push params, mute and unmute with the intro card
- Playwright OfflineAudioContext test for speed and load response (e.g. `tests/e2e/engineSynth.spec.ts`)

## Out of scope

- Brush, fan, spray and beeper (other issues)
- Haptics/rumble

## Acceptance criteria

- [ ] engineMap test: idle (v 0, throttle 0, brush up) gives rpm 750 and f0 25 Hz; brush down after spin-up gives rpm ≥ 1,800; |v| = 11 m/s with throttle 1 gives rpm 2,400 (capped) and f0 80 Hz
- [ ] engineMap test: a full hopper (h = 1) gives a pitch factor of 0.95 and a cutoff factor of 0.85 relative to h = 0
- [ ] engineMap test: HP 39 enables misfire; HP 40 does not
- [ ] engineMap test: squeal gain is 0 at 0.8 m/s slip and 1 at 3 m/s
- [ ] Playwright test (throttle 0, brush up): the measured fundamental at v = 2 m/s (expected rpm 1,050) is lower than at v = 8 m/s (expected rpm 1,950), and at v = 8 m/s it is lower with h = 1 than with h = 0
- [ ] The engine produces silence while the shift intro card is shown and resumes after dismiss (unit test on the controller)
- [ ] `npm run test:replay` hashes are unchanged

## Verification

- npm test -- tests/unit/audio/engineMap.test.ts
- npm run test:e2e
- npm run test:replay
- npm run typecheck && npm run lint

## Dependencies

**Depends on:**

- [SSP-179](SSP-179-worklet-infra.md) Set up the AudioWorklet host that shares tools/audio/synth kernels at runtime
- [SSP-030](../M1/SSP-030-vehicle-model.md) Implement Bessie's kinematic bicycle model in src/sim/vehicle.ts
- [SSP-036](../M1/SSP-036-static-collision.md) Resolve Bessie against static geometry with impact damage and TOWED stub
- [SSP-059](../M2/SSP-059-brush.md) Implement brush.ts state machine, suction, inlet collection and fling roll
- [SSP-058](../M2/SSP-058-hopper.md) Implement hopper.ts LU accounting, mass coupling and bulldozer state
- [SSP-093](../M3/SSP-093-hazards-grip-jolts.md) Implement hazard grip overrides, jolts, LU spills and the open-manhole hard stop

**Blocks:**

- [SSP-185](SSP-185-m5-exit-evidence.md) Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR
- [SSP-239](../M7/SSP-239-audio-access-settings.md) Wire audio accessibility settings live: captions via SSP-184, mono, loud sounds, beeper, adaptive music
- [SSP-264](../M8/SSP-264-ios-audio-unlock.md) Harden unlock.ts for iOS Safari: touchend unlock and background resume

## References

- ../../AUDIO_DESIGN.md#61-engine-enginesynthts-bessies-diesel
- ../../AUDIO_DESIGN.md#55-events-with-no-dedicated-sfx
- ../../AUDIO_DESIGN.md#14-testing
- ../../TECHNICAL_DESIGN.md#143-music-and-live-synths
- ../../TECHNICAL_DESIGN.md#81-state

## Roadmap tasks covered

- `engineSynth.ts`, `brushSynth.ts`, spray and beeper synths sharing DSP code with `tools/audio/synth/`. (engine)
- `Measurable check: Live synths — Engine pitch follows speed and load (hopper fill) (OfflineAudioContext render test in Playwright)`
- `Exit criterion: Live engine, brush, spray and beeper synths. (engine)`
