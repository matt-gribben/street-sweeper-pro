---
id: SSP-181
title: "Implement brushSynth.ts brush, suction fan, scrub crackle and bulldozer layers"
milestone: M5
status: todo
type: feature
estimate: M
labels: [type:feature, area:audio, area:test, size:M, vertical-slice]
depends_on: [SSP-179, SSP-059, SSP-060, SSP-058, SSP-096]
blocks: [SSP-182, SSP-185, SSP-239, SSP-264]
---

# SSP-181: Implement brushSynth.ts brush, suction fan, scrub crackle and bulldozer layers

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** feature · **Size:** M · **Areas:** audio, test · **Vertical slice**

## Summary

Make cleaning audibly satisfying. Synthesise the gutter brushes, the suction fan, the grime-driven scrub crackle, the Kerb Hugger scrape, the litter rustle and the full-hopper bulldozer rumble, all driven live from read-only sim state.

## Context

Layers (AUDIO_DESIGN §6.2):
- **Gutter brushes:** two voices panned ±0.3. Noise → BP 2.5 kHz (Q 0.8), AM at the bristle rate `rpmFrac × 4 rev/s × 8 tufts` (32 Hz at full). L and R detuned 3% so they beat gently. Driven by brush lowered and RPM fraction (0.6 s spin-up / spin-down).
- **Suction fan:** sine + quiet triangle at `180 Hz × rpmFrac`, a whine partial at `1,200 Hz × rpmFrac` (−12 dB), winding down over 1.2 s after raising. `pwr.super_suction` adds +3 semitones and +2 dB while active; `upg.suction` adds +1 semitone per level (upgrades arrive in M6; read the level, default 0).
- **Scrub crackle** (the Pillar 1 sound): impulses at `min(400, 6 × cellsErasedPerSecond)` per second, each a 2 ms band-passed click at a seeded random centre of 3–6 kHz. Driven by grime cells erased this tick.
- **Gutter scrape:** the crackle doubled and brightened (+4 kHz shelf, +3 dB) during Kerb Hugger contact.
- **Litter rustle:** granular crinkle (short noise grains with a fast decay) at a density proportional to the items inside the suction zone.
- **Bulldozer load:** low-passed noise at 200 Hz while the hopper is full, the brush is lowered and Bessie is moving.

The collection layers (crackle, scrape, rustle) are **muted when RPM < 80%**, an audible cue for the spin-up rule (TECHNICAL_DESIGN §8.3: collecting requires `brushPos == 1 && rpm >= 0.8`). All of this runs on the `live` bus with seeded randomness from the audio sfc32.

**Exit check:** 'Brush whirr follows RPM', verified by an OfflineAudioContext render test in Playwright via the SSP-179 audio-lab hook.

**Sim reads:** brush state/RPM fraction, grime cells erased per tick, Kerb Hugger contact, suction-zone item count, hopper full, speed, active SSP-096. If a value such as cells erased per tick is not already exposed read-only, expose it without changing the replay hash; if it must become sim state, call out the hash change (ROADMAP §5.3).

`brushSynth.ts` also hosts the spray and beeper voices (issue SSP-182), so design the controller to accept more voices.

## Scope

- Pure `brushMap(simView) → params` with unit tests
- Worklet voices: dual gutter brushes, fan, crackle, scrape, rustle, bulldozer
- `src/audio/brushSynth.ts` controller (build per shift, per-frame params, pause freeze)
- Playwright OfflineAudioContext test for RPM response and the < 80% mute

## Out of scope

- Spray and reverse beeper (issue SSP-182)
- Upgrade purchase UI (M6)

## Acceptance criteria

- [ ] brushMap test: rpmFrac 1 gives a bristle AM rate of 32 Hz and a fan frequency of 180 Hz; rpmFrac 0.5 gives 16 Hz and 90 Hz
- [ ] brushMap test: crackle rate = min(400, 6 × cellsErasedPerSecond), e.g. 10 cells/s → 60/s and 100 cells/s → 400/s
- [ ] brushMap test: at rpmFrac 0.79 the crackle, scrape and rustle gains are 0; at 0.8 they are non-zero when their drivers are non-zero
- [ ] brushMap test: super_suction active raises the fan by +3 semitones and +2 dB
- [ ] Playwright test: the measured AM rate of the rendered brush tracks the expected bristle rate within 5% at rpmFrac 0.5 and 1.0
- [ ] Playwright test: after raising, the fan level decays to < −40 dB relative within 1.2 s ±0.1 s
- [ ] `npm run test:replay` hashes are unchanged unless a stated sim change was needed

## Verification

- npm test -- tests/unit/audio
- npm run test:e2e
- npm run test:replay
- npm run typecheck && npm run lint

## Dependencies

**Depends on:**

- [SSP-179](SSP-179-worklet-infra.md) Set up the AudioWorklet host that shares tools/audio/synth kernels at runtime
- [SSP-059](../M2/SSP-059-brush.md) Implement brush.ts state machine, suction, inlet collection and fling roll
- [SSP-060](../M2/SSP-060-grime-mask.md) Implement dirt.ts grime mask, initial selection, footprint erase and Kerb Hugger
- [SSP-058](../M2/SSP-058-hopper.md) Implement hopper.ts LU accounting, mass coupling and bulldozer state
- [SSP-096](../M3/SSP-096-power-ups.md) Spawn power-ups on pavements, implement all six pwr.* effects, draw them

**Blocks:**

- [SSP-182](SSP-182-spray-beeper-synth.md) Add spray (sputter, dry pump, refill) and reverse-beeper voices to brushSynth
- [SSP-185](SSP-185-m5-exit-evidence.md) Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR
- [SSP-239](../M7/SSP-239-audio-access-settings.md) Wire audio accessibility settings live: captions via SSP-184, mono, loud sounds, beeper, adaptive music
- [SSP-264](../M8/SSP-264-ios-audio-unlock.md) Harden unlock.ts for iOS Safari: touchend unlock and background resume

## References

- ../../AUDIO_DESIGN.md#62-brush-and-suction-brushsynthts
- ../../AUDIO_DESIGN.md#12-tone-pillars-mapped-to-the-design-pillars
- ../../TECHNICAL_DESIGN.md#143-music-and-live-synths
- ../../TECHNICAL_DESIGN.md#83-brush-mechanics-state

## Roadmap tasks covered

- `engineSynth.ts`, `brushSynth.ts`, spray and beeper synths sharing DSP code with `tools/audio/synth/`. (brush and suction)
- `Measurable check: Live synths — Brush whirr follows RPM (OfflineAudioContext render test in Playwright)`
- `Exit criterion: Live engine, brush, spray and beeper synths. (brush)`
