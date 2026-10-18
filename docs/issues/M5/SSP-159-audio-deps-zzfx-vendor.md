---
id: SSP-159
title: "Pin jsfxr 1.4.1, vendor ZzFX buildSamples with seeded RNG, add WAV writer"
milestone: M5
status: todo
type: chore
estimate: M
labels: [type:chore, area:audio, area:tooling, area:build, area:test, size:M, vertical-slice]
depends_on: [SSP-002, SSP-028]
blocks: [SSP-161, SSP-166]
---

# SSP-159: Pin jsfxr 1.4.1, vendor ZzFX buildSamples with seeded RNG, add WAV writer

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** chore · **Size:** M · **Areas:** audio, tooling, build, test · **Vertical slice**

## Summary

Lay the deterministic base for all offline audio rendering. This means an exact-pinned jsfxr, a vendored ZzFX `buildSamples` that takes an injected `sfc32` stream, a seeded `Math.random` swap for jsfxr, and the fixed-header WAV writer. Every later audio tool depends on these producing byte-identical output.

## Context

Facts (AUDIO_DESIGN §5.3, §11.4; TECHNICAL_DESIGN §1.1; ROADMAP M0 task list):
- jsfxr **1.4.1**, imported from `jsfxr/sfxr.mjs`. It imports cleanly in Node 24. Exact pin only (no ^ or ~). The ROADMAP M5 checklist explicitly sanctions adding it; ROADMAP M0 says 'jsfxr 1.4.1 is added in M5, not now'.
- zzfx **1.4.0** constructs an `AudioContext` at import (`ZzFX.js` runs `audioContext: new AudioContext`), so `import 'zzfx'` in Node 24 throws `ReferenceError: AudioContext is not defined` (verified 2026-10-18). **Never install or import the `zzfx` package.** Vendor `buildSamples` (MIT) into `tools/audio/synth/zzfx.ts` with an attribution header (licence text, upstream version 1.4.0). Replace its internal `Math.random` with an injected `sfc32` stream parameter. The module must not touch any browser global at import time, because the runtime ambience player (issue SSP-183) may reuse it in the browser.
- jsfxr uses `Math.random` internally (noise wave, phaser). Provide `withSeededRandom(seed, fn)`, which temporarily swaps `Math.random` for an `sfc32` stream and restores it afterwards. Both streams are seeded from the source file's `seed` plus the variant index.
- `sfc32` lives in `src/sim/rng.ts` (M1). Tools import it with an explicit `.ts` extension, because Node type stripping does not resolve extensionless imports (CLAUDE.md §5.1). `erasableSyntaxOnly` means no enum, namespace or parameter properties. No `any`.
- WAV writer `tools/audio/wav.ts`: PCM 16-bit **mono**, a fixed 44-byte header, no `LIST`/`INFO` chunks. SFX are written at 44.1 kHz, music at 48 kHz.
- WAV hashes are pinned to Node **24.21.0**.
- TECHNICAL_DESIGN §14.3: nothing in `tools/` may import `src/audio`.
- AUDIO_DESIGN §14 puts audio tests under `tests/unit/audio/`. TECHNICAL_DESIGN §18 lists `tests/unit/*.test.ts`; make sure the Vitest unit project glob includes nested folders (`tests/unit/**/*.test.ts`).

Open point: AUDIO_DESIGN §15.1 puts the ZzFX vendoring in M0, but ROADMAP M0 explicitly defers it to M5 ('Audio of any kind (M5)'). Check whether `tools/audio/synth/zzfx.ts` already exists. If it does, audit and test it rather than rewriting it.

## Scope

- Add `"jsfxr": "1.4.1"` (exact) to package.json and update package-lock.json with `npm install --save-exact jsfxr@1.4.1`
- Create `tools/audio/synth/zzfx.ts`: vendored `buildSamples` with an MIT attribution header and an injected `sfc32` parameter in place of `Math.random`; no browser globals at import time
- Add a `withSeededRandom(seed, fn)` helper (e.g. `tools/audio/synth/seededRandom.ts`) that restores `Math.random` in a `finally` block
- Create `tools/audio/wav.ts`: encode a Float32 mono buffer to 16-bit PCM WAV (44-byte header) at a given sample rate, with deterministic clipping and rounding
- Confirm the Vitest unit glob picks up `tests/unit/audio/**`
- Unit tests under `tests/unit/audio/` for zzfx determinism, jsfxr seeding and WAV header bytes

## Out of scope

- render-sfx.ts and any SFX JSON sources (issue SSP-161)
- DSP kernels for the tracker and worklets (issue SSP-160)
- Installing the `zzfx` npm package (forbidden)

## Acceptance criteria

- [ ] package.json lists `jsfxr` at exactly `1.4.1`, and neither package.json nor package-lock.json contains a `zzfx` package
- [ ] `node -e "import('./tools/audio/synth/zzfx.ts').then(()=>console.log('ok'))"` on Node 24.21.0 prints `ok` with no `AudioContext`/DOM globals defined
- [ ] `buildSamples` with the same params and the same `sfc32` seed returns identical Float32 arrays across two calls. With `randomness > 0` and a different seed, the output differs
- [ ] jsfxr rendering of a noise-wave preset inside `withSeededRandom(s, ...)` is identical across two runs with the same `s`, and differs for a different `s`
- [ ] After `withSeededRandom` returns or throws, `Math.random` is the original function (asserted by identity)
- [ ] `wav.ts` output for a fixed fixture buffer of N samples is exactly 44 + 2×N bytes, has RIFF/WAVE/`fmt `/`data` chunks only, the correct sample-rate field (44100 or 48000), 1 channel and 16 bits, and matches a committed sha256
- [ ] The vendored file contains the MIT licence text and states the upstream version 1.4.0
- [ ] `npm test` discovers and runs the new `tests/unit/audio/*.test.ts` files

## Verification

- npm ci
- npm ls jsfxr
- npm run typecheck
- npm run lint
- npm test -- tests/unit/audio

## Dependencies

**Depends on:**

- [SSP-002](../M0/SSP-002-node-scaffold.md) Scaffold the Node/TypeScript/Vite repo with exact pins and verify TS 7.0.2 (D-10)
- [SSP-028](../M1/SSP-028-sim-foundations.md) Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type

**Blocks:**

- [SSP-161](SSP-161-render-sfx-core.md) Implement render-sfx.ts: SFX JSON to WAV sprites, ffmpeg encodes and sfx.json
- [SSP-166](SSP-166-tracker-core.md) Implement the render-music.ts tracker core: song parsing, instruments, notes, effects

## References

- ../../AUDIO_DESIGN.md#53-determinism-rule-for-zzfx-and-jsfxr
- ../../AUDIO_DESIGN.md#114-determinism
- ../../AUDIO_DESIGN.md#14-testing
- ../../TECHNICAL_DESIGN.md#11-versions-exact-pins-verified-2026-10-18
- ../../TECHNICAL_DESIGN.md#12-stack-wide-consequences
- ../../ROADMAP.md#m5-sound--music

## Roadmap tasks covered

- Add `jsfxr` 1.4.1 at an exact pin (imported from `jsfxr/sfxr.mjs`). Vendor ZzFX `buildSamples` from zzfx 1.4.0 into `tools/audio/synth/zzfx.ts` (MIT, with attribution, `Math.random` replaced by an injected `sfc32`)...
- Deliverable: `tools/audio/render-sfx.ts`, `render-music.ts`, `synth/*.ts` and `wav.ts`, run natively on Node 24. (wav.ts, synth/zzfx.ts)
