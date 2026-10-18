---
id: SSP-179
title: "Set up the AudioWorklet host that shares tools/audio/synth kernels at runtime"
milestone: M5
status: todo
type: feature
estimate: M
labels: [type:feature, area:audio, area:build, area:test, size:M, vertical-slice]
depends_on: [SSP-160, SSP-173, SSP-002, SSP-006, SSP-003]
blocks: [SSP-178, SSP-180, SSP-181, SSP-182, SSP-183, SSP-264]
---

# SSP-179: Set up the AudioWorklet host that shares tools/audio/synth kernels at runtime

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** feature · **Size:** M · **Areas:** audio, build, test · **Vertical slice**

## Summary

Settle the AudioWorklet module import form under Vite 8.3.4 (open question A5) and build the processor host. It imports the shared DSP kernels, receives k-rate parameters at 60 Hz with 30 ms smoothing, and can be rendered in an OfflineAudioContext from Playwright for live-synth tests.

## Context

**AUDIO_DESIGN §6:**
- Continuous sounds are synthesised in an **AudioWorklet**. DSP kernels in `tools/audio/synth/*.ts` are shared by the offline renderer and the runtime worklet.
- 'The exact Vite import form for the worklet module is settled in M5' (open question A5). Candidates: `audioWorklet.addModule(new URL('./x.worklet.ts', import.meta.url))`, or Vite's `?worker&url` / `?url` import. It must work in `npm run dev` and in `vite build` with `base: './'` (itch.io iframe sub-path).
- Parameters are pushed from the main thread at 60 Hz through k-rate `AudioParam`s and smoothed in the worklet with **τ = 30 ms**; `setTargetAtTime` τ 30 ms on the main side (§3.2).
- CPU budget: all live voices ≤ **0.6 ms per 128-frame quantum** on the M0 reference Mac.
- Pause freezes the worklets. The shift intro mutes the live bus.
- Live synths are built once per shift (TECHNICAL_DESIGN §14.3). Parameters are set per rendered frame from read-only sim state (`vLong`, throttle, rpm, brushPos, spray on) with render interpolation.

**Import rules:** TECHNICAL_DESIGN §2.1 lists what `src/audio/**` may import (WebAudio, src/sim read-only, src/app/events.ts) and does not mention `tools/audio/synth`. AUDIO_DESIGN §6 requires the sharing, so update the §2.1 table in the same PR to allow `src/audio/**` → `tools/audio/synth/**` (Node-free kernels and the vendored zzfx.ts only). Biome restricted imports must allow it.

**Test harness:** the exit criterion needs 'an `OfflineAudioContext` render test in Playwright' for each live synth. Playwright's `webServer` serves the **built** bundle (`npm run build && npx vite preview --port 4173 --strictPort`, TECHNICAL_DESIGN §20.2), so a harness page under `tests/e2e/` would not be served. Instead add a test hook (e.g. `src/debug/audioLab.ts`, dynamically imported only when `?test=1`) exposing something like `window.__ssp.audioLab.render(voice, automation, seconds, sampleRate)`: it loads the real worklet module into an `OfflineAudioContext`, applies scripted parameter automation, and returns samples to the spec. Spec files and analysis helpers (zero-crossing/FFT pitch, RMS envelope) live under `tests/e2e/`. Test mode's 'no AudioContext' rule is respected because only an OfflineAudioContext is created. Document the hook in TECHNICAL_DESIGN §18.5.

## Scope

- Decide and implement the worklet module loading form; record the answer in AUDIO_DESIGN §6 and §15.2 A5
- A generic processor host that instantiates kernel voices, declares k-rate params and applies one-pole smoothing (τ 30 ms)
- Main-thread controller base: build once per shift, connect to the live bus, push params per rendered frame, freeze on pause
- The `?test=1` audio-lab hook (lazy-loaded) plus Playwright analysis helpers and a trivial sine-voice spec
- A CPU timing probe (dev only) to check the 0.6 ms/quantum budget
- TECHNICAL_DESIGN §2.1 import-table and §18.5 hook updates; Biome config allowance

## Out of scope

- Engine, brush, spray and beeper voices (their own issues)

## Acceptance criteria

- [ ] The worklet loads in `npm run dev` and in `npm run build && npx vite preview --port 4173 --strictPort` with no 404 for the module, including when `dist/` is served from a sub-path
- [ ] The Playwright spec renders 1 s of a test sine voice through the audio-lab hook in an OfflineAudioContext and measures its frequency within 1% of the requested value
- [ ] A step change in a k-rate param produces an exponential approach with τ = 30 ms ±10% in the rendered output
- [ ] The worklet bundle imports kernels from `tools/audio/synth/` without pulling Node modules (build passes; a bundle scan finds no `node:` specifiers)
- [ ] Without `?test=1` the audio-lab module is never fetched (Playwright request log)
- [ ] AUDIO_DESIGN §15.2 A5 is answered, and TECHNICAL_DESIGN §2.1 and §18.5 list the new import and hook

## Verification

- npm run build && npx vite preview --port 4173 --strictPort
- npm run test:e2e
- npm run typecheck && npm run lint

## Dependencies

**Depends on:**

- [SSP-160](SSP-160-dsp-kernels.md) Build the shared DSP kernels in tools/audio/synth (oscillators, filters, envelopes, FM)
- [SSP-173](SSP-173-mixer-buses-ducking.md) Implement mixer.ts: bus graph, limiter, settings levels and ducking engine
- [SSP-002](../M0/SSP-002-node-scaffold.md) Scaffold the Node/TypeScript/Vite repo with exact pins and verify TS 7.0.2 (D-10)
- [SSP-006](../M0/SSP-006-npm-scripts-ci-workflow.md) Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow
- [SSP-003](../M0/SSP-003-lint-purity-ip-tests.md) Add biome.json sim-purity rules plus simPurity and ipHygiene unit tests

**Blocks:**

- [SSP-178](SSP-178-music-player.md) Implement music.ts: sample-locked stems, loops, jingles and scene music
- [SSP-180](SSP-180-engine-synth.md) Implement engineSynth.ts: Bessie's diesel with load, misfire and tyre squeal
- [SSP-181](SSP-181-brush-suction-synth.md) Implement brushSynth.ts brush, suction fan, scrub crackle and bulldozer layers
- [SSP-182](SSP-182-spray-beeper-synth.md) Add spray (sputter, dry pump, refill) and reverse-beeper voices to brushSynth
- [SSP-183](SSP-183-amb-town-morning.md) Add the ambience bed player and author amb.town_morning
- [SSP-264](../M8/SSP-264-ios-audio-unlock.md) Harden unlock.ts for iOS Safari: touchend unlock and background resume

## References

- ../../AUDIO_DESIGN.md#6-live-synthesis
- ../../AUDIO_DESIGN.md#152-open-questions
- ../../TECHNICAL_DESIGN.md#143-music-and-live-synths
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../TECHNICAL_DESIGN.md#202-vite-configuration

## Roadmap tasks covered

- `engineSynth.ts`, `brushSynth.ts`, spray and beeper synths sharing DSP code with `tools/audio/synth/`. (worklet host and test harness)
