---
id: SSP-178
title: "Implement music.ts: sample-locked stems, loops, jingles and scene music"
milestone: M5
status: todo
type: feature
estimate: L
labels: [type:feature, area:audio, area:ui, area:test, size:L, vertical-slice]
depends_on: [SSP-177, SSP-173, SSP-174, SSP-167, SSP-179, SSP-071, SSP-046, SSP-079, SSP-033, SSP-042, SSP-287]
blocks: [SSP-185, SSP-194, SSP-239, SSP-264]
---

# SSP-178: Implement music.ts: sample-locked stems, loops, jingles and scene music

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** feature · **Size:** L · **Areas:** audio, ui, test · **Vertical slice**

## Summary

Play songs as sample-locked looping stems with encoder-delay-corrected loop points, drive their gains from the adaptive state machine, play jingles over ducked music, and map scenes to music per the scene → audio table.

## Context

**Stems** (TECHNICAL_DESIGN §14.3, AUDIO_DESIGN §9.1, §12.1): start all stems of a song (`base`, `drums`, `lead`) as looping `AudioBufferSourceNode`s at the **same** `ctx.currentTime + 0.1`. Decode to AudioBuffers and set `loopStart`/`loopEnd` in seconds from `public/assets/audio/music.json`, corrected by `encoderDelaySamples[codec]`. Never use `<audio loop>`. A Playwright audio-offset test guards the correction; M0 (SSP-025, `node tools/spikes/audioDecodeOffset.ts`) measured 0 for OGG and M4A in Playwright Chromium and WebKit only, and re-deferred the rest of A2 here, so measure it with real stems in every available browser: write the measured values into render-music (so music.json carries them) and into AUDIO_DESIGN §12.1/§15.2 A2.

**Jingles:** play on the jingle bus, never loop; any `jng.*` ducks music to −∞ (120 ms attack, hold for the jingle length), then music resumes per §9. `jng.shift_start` picks the variant named after the current district ID from its sprite offsets. 'Reduce loud sounds' trims `jng.sacked` (and `jng.towed`, M6) by −6 dB (§13.1).

**Scene map** (§8.4) for M5 scenes:
- BootScene: none.
- TitleScene: `mus.title`, all stems, starting on the first unlock gesture.
- ShiftIntroScene: no music; district bed at −6 dB; `jng.shift_start` on dismiss.
- ShiftScene: the district song, adaptive. The district → song mapping is the compiled level's `music` field (LEVEL_DESIGN §8.4: Puddle Lane → `mus.puddle_lane`, High Street → `mus.high_street`).
- TallyScene: `jng.tally` (on entry; the Mercury arrives in M6) then `mus.workshop` base at −6 dB. `mus.workshop` is M6, so play silence after the jingle until then. On SACKED, `jng.sacked`; `jng.towed` is M6, so TOWED cuts stems and plays nothing until then.
- PauseOverlay: duck via the mixer; stems keep their positions.

**Loading:** Title loads the `mus.title` stems. TECHNICAL_DESIGN §6.3 loads district music stems in ShiftIntroScene, decoded in the background while the briefing card shows; release the previous song's buffers on exit. (The AUDIO_DESIGN §12.2 tally-time prefetch of the next district is M6 week flow.) Decoded-audio budget ≤ **64 MB** (mono 48 kHz float32 = 0.19 MB/s).

**Visibility:** on visible, resume and re-sync stems; the context clock keeps them locked.

**Test hook:** expose the current music state and per-stem target gains as a read-only field on `window.__ssp` under `?test=1`, so the M5 exit e2e can show stems switching even though test mode uses a null mixer. Add it to the TECHNICAL_DESIGN §18.5 hook list in the same PR.

**Playwright** tests the built bundle (`npm run build && npx vite preview`, TECHNICAL_DESIGN §20.2). The offset test can decode a fixture stem with an `OfflineAudioContext` through a `?test=1` hook (see issue SSP-179's audio test hook).

## Scope

- `src/audio/music.ts`: song loading, synchronised stem start, loop points with encoder-delay correction, gain scheduling from musicState outputs
- Jingle playback with music duck and resume; jng.shift_start variant selection by district ID; reduce-loud jingle trim
- Scene integration for Title, ShiftIntro, Shift, Tally and Pause; load at ShiftIntroScene and release buffers on exit
- Encoder-delay measurement for Opus and AAC in Chromium (and WebKit if the project exists), written into render-music and AUDIO_DESIGN §12.1/§15.2
- A read-only test-hook view of music state; TECHNICAL_DESIGN §18.5 updated
- Playwright audio-offset/loop test (e.g. `tests/e2e/audioLoop.spec.ts`)

## Out of scope

- The state machine rules themselves (issue SSP-177)
- `mus.workshop`, `jng.star`, `jng.towed` (M6); Skip Run music (M6)
- Stereo stems (open question A3, decided at the M5 exit)

## Acceptance criteria

- [ ] All stems of a song start at an identical `when` time (unit test with a fake context recording start calls)
- [ ] loopStart and loopEnd equal music.json `loopStartSec`/`loopEndSec` adjusted by `encoderDelaySamples[codec] / sampleRate` (unit test)
- [ ] The Playwright test shows the decoded loop boundary of a fixture stem is within 1 ms of the intended loop point after correction, in Chromium
- [ ] music.json `encoderDelaySamples` holds measured numbers (not a placeholder or TBD; 0 is valid when measured, as SSP-025 measured in Playwright Chromium and WebKit), and AUDIO_DESIGN §15.2 A2 records them
- [ ] Starting a jingle schedules a music duck to silence with a 120 ms attack and restores music state after the jingle length (unit test against the mixer API)
- [ ] Entering a Puddle Lane shift loads `mus.puddle_lane` stems during ShiftIntroScene and starts base at 0 dB with drums and lead silent; leaving releases the buffers
- [ ] Under `?test=1`, `window.__ssp` exposes the music state ('Base' / 'BaseDrums' / 'BaseLead' / 'AllStems') without constructing an AudioContext
- [ ] `npm run test:e2e` smoke passes muted with no console errors from `src/audio/`

## Verification

- npm test -- tests/unit/audio
- npm run test:e2e
- npm run typecheck && npm run lint
- npm run dev, then play Puddle Lane and listen (dev check)

## Dependencies

**Depends on:**

- [SSP-177](SSP-177-music-state-machine.md) Implement the pure adaptive-music state machine for drums and lead stems
- [SSP-173](SSP-173-mixer-buses-ducking.md) Implement mixer.ts: bus graph, limiter, settings levels and ducking engine
- [SSP-174](SSP-174-unlock-codec-loading.md) Add unlock.ts, Opus/AAC codec selection and boot-time audio loading
- [SSP-167](SSP-167-render-music-stems-encode.md) Render music stems, normalise loudness, lint songs, encode and write music.json
- [SSP-179](SSP-179-worklet-infra.md) Set up the AudioWorklet host that shares tools/audio/synth kernels at runtime
- [SSP-071](../M2/SSP-071-intro-tally-scenes.md) Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry
- [SSP-046](../M1/SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie
- [SSP-079](../M3/SSP-079-end-states-sacked-towed.md) End shifts on SACKED (5 complaints) and TOWED (0 HP) with correct tally rules
- [SSP-033](../M1/SSP-033-level-compiler-core.md) Build level schema and compile-level.ts core: parse, legend, buildings, M1 checks
- [SSP-042](../M1/SSP-042-puddle-lane-level.md) Author Puddle Lane map.txt and level.json (64×48) and commit compiled output
- [SSP-287](../M3/SSP-287-pause-overlay.md) Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire

**Blocks:**

- [SSP-185](SSP-185-m5-exit-evidence.md) Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR
- [SSP-194](../M6/SSP-194-audio-mus-workshop.md) Compose mus.workshop 'Tea Break' and implement the mus.workshop fallback rule
- [SSP-239](../M7/SSP-239-audio-access-settings.md) Wire audio accessibility settings live: captions via SSP-184, mono, loud sounds, beeper, adaptive music
- [SSP-264](../M8/SSP-264-ios-audio-unlock.md) Harden unlock.ts for iOS Safari: touchend unlock and background resume

## References

- ../../AUDIO_DESIGN.md#84-scene--audio-map
- ../../AUDIO_DESIGN.md#9-adaptive-music
- ../../AUDIO_DESIGN.md#121-formats
- ../../AUDIO_DESIGN.md#122-loading-strategy
- ../../AUDIO_DESIGN.md#123-budgets
- ../../AUDIO_DESIGN.md#152-open-questions
- ../../TECHNICAL_DESIGN.md#143-music-and-live-synths
- ../../TECHNICAL_DESIGN.md#63-loading
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../LEVEL_DESIGN.md#84-leveljson-schema

## Roadmap tasks covered

- `mixer.ts`: ... music ducking under jingles and big events. (jingle duck integration)
- `Exit criterion: Title + Puddle Lane + High Street songs with adaptive stems. (playback)`
