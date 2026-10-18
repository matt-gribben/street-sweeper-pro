---
id: SSP-160
title: "Build the shared DSP kernels in tools/audio/synth (oscillators, filters, envelopes, FM)"
milestone: M5
status: todo
type: feature
estimate: M
labels: [type:feature, area:audio, area:tooling, area:test, size:M, vertical-slice]
depends_on: [SSP-002, SSP-028]
blocks: [SSP-166, SSP-179, SSP-183]
---

# SSP-160: Build the shared DSP kernels in tools/audio/synth (oscillators, filters, envelopes, FM)

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** feature · **Size:** M · **Areas:** audio, tooling, test · **Vertical slice**

## Summary

Write the pure-TypeScript DSP building blocks that the offline tracker renderer and the runtime AudioWorklet synths both use. Sharing them means a kernel bug shows up in Vitest, not only in the browser.

## Context

AUDIO_DESIGN §6, §6.1–6.3, §7.2 and §10.4:
- **Oscillators** (`tools/audio/synth/osc.ts`): band-limited (polyBLEP) pulse (with `duty`) and saw; `triangle` (stepped 4-bit in the 8-bit style, optional `smooth: true`); `sine`.
- **Noise:** console-style **15-bit LFSR** with `noiseMode: "long" | "short"` (tracker), plus seeded white noise and pink noise (the live synths use band-passed noise; ambience layers use `noise:pink`). Noise takes an `sfc32` stream, never `Math.random`.
- **Filters and shaping:** state-variable filter (lowpass, highpass, bandpass, with Q); a high-shelf (the brush 'gutter scrape' uses a +4 kHz shelf); a soft clipper (the engine pulse feeds one); ADSR `[attack s, decay s, sustain level, release s]` with note-off release; a one-pole smoother (worklets smooth params with τ = 30 ms); `fm2` (2-operator FM: carrier + modulator with `ratio`, `index`, `indexDecay`); an optional `bitcrush`.
- Other file names are free (suggested: `noise.ts`, `filter.ts`, `env.ts`, `fm.ts`, `smooth.ts`, `shape.ts`).
- **Runtime constraints:** kernels must use no Node APIs, no DOM and no wall clock, so an AudioWorklet module can import them. Per-sample loops must not allocate. All live voices together get ≤ **0.6 ms per 128-frame render quantum** on the M0 reference Mac (under 25% of the 2.9 ms quantum at 44.1 kHz).
- **Sample rates:** music renders at 48 kHz, SFX at 44.1 kHz, and the browser may run at its native rate. Kernels take the sample rate as a parameter.
- **Tests** (AUDIO_DESIGN §14): `tests/unit/audio/synth.test.ts` must cover oscillators being band-limited, ADSR timings to ±1 sample, the LFSR period, and FM index decay. The doc's wording 'no energy above Nyquist/2 for a test tone' cannot be literal for a pulse wave (its legitimate harmonics extend to Nyquist), so test aliasing instead: render a tone whose harmonics do not alias on to each other (e.g. 1,234 Hz at 48 kHz), and require every FFT bin that is not a harmonic of the fundamental to sit ≥ 40 dB below the fundamental. Document this interpretation in the test.

Note on naming: the AudioWorkletProcessor API itself has a `process()` method, so the 'no Node globals' check must target the Node `process.` object, `node:` imports and `require(`, not the identifier `process`.

Open: the short-mode LFSR period is not specified. Implement the console-style tap and assert whatever period the implementation documents.

## Scope

- `tools/audio/synth/osc.ts`: polyBLEP pulse/saw, stepped and smooth triangle, sine, as stateful per-voice generators
- Noise: 15-bit LFSR (long and short modes), seeded white and pink noise
- SVF filter, high-shelf, soft clipper, ADSR with note-off release, one-pole smoother, fm2 operator pair, optional bitcrush
- Allocation-free block APIs (e.g. `render(out: Float32Array, start, end)`) that both an offline renderer and an AudioWorkletProcessor can call
- `tests/unit/audio/synth.test.ts` covering every kernel

## Out of scope

- The tracker/song parser (issue SSP-166)
- The AudioWorklet processor and Vite wiring (issue SSP-179)
- Engine/brush/spray/beeper parameter maps (synth issues)

## Acceptance criteria

- [ ] A unit test scans every file under `tools/audio/synth/` (other than the vendored zzfx.ts) and fails on `node:` imports, `require(`, or the tokens `process.`, `window`, `document`, `AudioContext`, `Date`, `performance` or `Math.random`
- [ ] Test: a 1,234 Hz polyBLEP pulse (duty 0.25) and saw rendered at 48 kHz have every non-harmonic FFT bin ≥ 40 dB below the fundamental
- [ ] Test: ADSR attack, decay and release reach their targets within ±1 sample of the specified times at 44.1 and 48 kHz
- [ ] Test: the long-mode LFSR period equals 32,767 steps; the short-mode period equals the value documented in the code
- [ ] Test: the fm2 modulation index follows its `indexDecay` curve (checked at three time points within 1%)
- [ ] Test: the soft clipper output never exceeds ±1 for inputs up to ±10, and the high-shelf gives the requested gain ±0.5 dB well above its corner
- [ ] Two renders of the same kernel graph with the same inputs and seed are bit-identical
- [ ] A micro-benchmark test logs the time per 128-frame block for the kernels (informational, no hard threshold in CI)

## Verification

- npm run typecheck
- npm run lint
- npm test -- tests/unit/audio/synth.test.ts

## Dependencies

**Depends on:**

- [SSP-002](../M0/SSP-002-node-scaffold.md) Scaffold the Node/TypeScript/Vite repo with exact pins and verify TS 7.0.2 (D-10)
- [SSP-028](../M1/SSP-028-sim-foundations.md) Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type

**Blocks:**

- [SSP-166](SSP-166-tracker-core.md) Implement the render-music.ts tracker core: song parsing, instruments, notes, effects
- [SSP-179](SSP-179-worklet-infra.md) Set up the AudioWorklet host that shares tools/audio/synth kernels at runtime
- [SSP-183](SSP-183-amb-town-morning.md) Add the ambience bed player and author amb.town_morning

## References

- ../../AUDIO_DESIGN.md#6-live-synthesis
- ../../AUDIO_DESIGN.md#104-instrument-waves
- ../../AUDIO_DESIGN.md#72-ambience-source-schema-assets-srcaudioambnamejson
- ../../AUDIO_DESIGN.md#14-testing

## Roadmap tasks covered

- `engineSynth.ts`, `brushSynth.ts`, spray and beeper synths sharing DSP code with `tools/audio/synth/`. (shared kernel half)
- `render-music.ts`: tracker with `pulse1`, `pulse2`, `tri`, `noise` and `bass` (2-op FM) channels... (oscillator/FM kernels)
