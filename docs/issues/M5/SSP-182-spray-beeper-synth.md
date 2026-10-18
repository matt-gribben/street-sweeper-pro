---
id: SSP-182
title: "Add spray (sputter, dry pump, refill) and reverse-beeper voices to brushSynth"
milestone: M5
status: todo
type: feature
estimate: M
labels: [type:feature, area:audio, area:test, size:M, vertical-slice]
depends_on: [SSP-179, SSP-181, SSP-061, SSP-062, SSP-030]
blocks: [SSP-185, SSP-239]
---

# SSP-182: Add spray (sputter, dry pump, refill) and reverse-beeper voices to brushSynth

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** feature · **Size:** M · **Areas:** audio, test · **Vertical slice**

## Summary

Finish the live synths with the water-spray loop and its low-water states, the hydrant refill gurgle, and the reverse beeper with its classic, broadband and off modes.

## Context

**Water spray** (AUDIO_DESIGN §6.3):
- Spraying with water > 10%: noise HP 1.5 kHz + LP 6 kHz, a 0.7 Hz LFO on the cutoff (±400 Hz), plus a pump hum (120 Hz square at −18 dB).
- Water ≤ 10%: **sputter**, the spray layer gated by a seeded random 6–14 Hz gate.
- Water = 0: **dry pump**, the hum plus a 4 Hz click and no spray noise. The caption '[Water empty]' (issue captions) and the HUD flash are the visual pairs.
- Refilling (hydrant 25/s, depot full refill): a gurgle of band-passed noise at 400–900 Hz with pitch rising as the tank fills, plus `splash:refill` at the start (one-shot via the director).
- Water tank: 100 units, spray uses 6/s (GDD values; read them from tuning, not constants).

**Reverse beeper** (§6.4):
- Active while Bessie moves backwards faster than **0.05 m/s**.
- **Classic** (default): 1,050 Hz square, 450 ms on / 450 ms off, at −6 dB on the `live` bus, with 5 ms attack and release so it never clicks.
- **Broadband** (accessibility option): band-limited white-noise 'shh-shh' bursts on the same 450/450 ms cadence.
- **Off:** relies on the on-screen reverse chevrons.
- The setting lives in `ssp.settings.v1` (default 'classic'; the UI comes in M7), passed in from the composition root.

The sim also emits `EV.ReverseBeeper` when REV engages (TECHNICAL_DESIGN §8.2). Use state (`vLong < −0.05`) as the authority for the beeper loop.

**Exit checks:** 'Reverse beeper plays while reversing. Spray loops while held', each verified by an OfflineAudioContext render test in Playwright via the SSP-179 audio-lab hook.

These voices live in `src/audio/brushSynth.ts` (AUDIO_DESIGN §3.1), so this issue follows SSP-181 to avoid conflicting edits.

## Scope

- Pure `sprayMap` and `beeperMap` functions with unit tests
- Spray, sputter, dry-pump and refill-gurgle worklet voices; beeper voice with classic and broadband modes and off
- Controller integration in brushSynth.ts reading water level, spray input, refill state, vLong and the beeper setting
- Playwright OfflineAudioContext tests for beeper cadence and the spray loop

## Out of scope

- HUD water flash and 'REFILL AT HYDRANT' hint (UI)
- Settings UI for the beeper mode (M7)

## Acceptance criteria

- [ ] beeperMap test: vLong −0.04 m/s → off; −0.06 m/s → on
- [ ] Playwright test: a classic beeper rendered over 3 s shows on/off segments of 450 ms ±3 ms with a fundamental of 1,050 Hz ±1%, and no sample-to-sample jump at segment edges larger than the threshold defined in the test
- [ ] Playwright test: broadband mode has the same cadence and no spectral peak more than 10 dB above the median of the 0.5–8 kHz band
- [ ] Playwright test: spray with water 50% held for 2 s produces continuous output (no gap > 20 ms); with water 5%, gating at 6–14 Hz is detected; with water 0, the 1.5–6 kHz spray-band energy drops by ≥ 20 dB while the 120 Hz hum remains
- [ ] The beeper respects the setting value 'off' (no output) and defaults to 'classic' when storage is unavailable (unit test)

## Verification

- npm test -- tests/unit/audio
- npm run test:e2e
- npm run typecheck && npm run lint

## Dependencies

**Depends on:**

- [SSP-179](SSP-179-worklet-infra.md) Set up the AudioWorklet host that shares tools/audio/synth kernels at runtime
- [SSP-181](SSP-181-brush-suction-synth.md) Implement brushSynth.ts brush, suction fan, scrub crackle and bulldozer layers
- [SSP-061](../M2/SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats
- [SSP-062](../M2/SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event
- [SSP-030](../M1/SSP-030-vehicle-model.md) Implement Bessie's kinematic bicycle model in src/sim/vehicle.ts

**Blocks:**

- [SSP-185](SSP-185-m5-exit-evidence.md) Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR
- [SSP-239](../M7/SSP-239-audio-access-settings.md) Wire audio accessibility settings live: captions via SSP-184, mono, loud sounds, beeper, adaptive music

## References

- ../../AUDIO_DESIGN.md#63-water-spray
- ../../AUDIO_DESIGN.md#64-reverse-beeper
- ../../AUDIO_DESIGN.md#131-settings
- ../../TECHNICAL_DESIGN.md#82-per-tick-integration-phase-2

## Roadmap tasks covered

- `engineSynth.ts`, `brushSynth.ts`, spray and beeper synths sharing DSP code with `tools/audio/synth/`. (spray and beeper)
- `Measurable check: Live synths — Reverse beeper plays while reversing. Spray loops while held (OfflineAudioContext render tests in Playwright)`
- `Exit criterion: Live engine, brush, spray and beeper synths. (spray, beeper)`
