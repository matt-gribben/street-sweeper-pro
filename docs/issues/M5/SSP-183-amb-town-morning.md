---
id: SSP-183
title: "Add the ambience bed player and author amb.town_morning"
milestone: M5
status: todo
type: feature
estimate: M
labels: [type:feature, area:audio, area:assets, size:M, vertical-slice]
depends_on: [SSP-161, SSP-175, SSP-173, SSP-179, SSP-160, SSP-105, SSP-287, SSP-033, SSP-042]
blocks: [SSP-185, SSP-198, SSP-217]
---

# SSP-183: Add the ambience bed player and author amb.town_morning

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** feature · **Size:** M · **Areas:** audio, assets · **Vertical slice**

## Summary

Implement live-synthesised ambience beds (continuous layers plus seeded sprinkles), validate bed sources into `amb.json`, and author `amb.town_morning` for Puddle Lane and High Street, including Tuesday's market-chatter layer.

## Context

AUDIO_DESIGN §7:
- Beds are **synthesised live**. There are no rendered files, so a bed never audibly loops.
- **Layers** are continuous noise or oscillator sources with a filter and an LFO, e.g. `{name, source: "noise:pink" | "osc:sine:55", filter{type, cutoff, q}, gainDb, lfo{target, rateHz, depthDb}}`. Native WebAudio nodes (buffer noise from the shared pink-noise kernel, OscillatorNode, BiquadFilterNode) are enough; no worklet needed.
- **Sprinkles** are one-off events scheduled from the **audio sfc32** with `perMinute [min, max]`, `gainDb [min, max]`, optional `distance`, random pan, and inline zzfx/jsfxr `params`. They are **not** `sfx.*` IDs and never gameplay-triggered.
- Optional `weatherParam {target, range}`.
- See the `amb/rain.json` example in §7.2 for the schema.

**Build:** `render-sfx.ts` validates every bed in `assets-src/audio/amb/*.json` and writes a combined, minified `public/assets/audio/amb.json`.

**Runtime:** the bed player lives in `src/audio/sfx.ts`; sprinkles use the same voice pool on the `amb` bus (−20 dB, Ambience slider).

**`amb.town_morning`** (§7.1): distant traffic wash, sparrow chirps, a far-off milk float, door chimes. Tuesday (High Street) raises the 'market chatter' layer to 0 dB. Sunday church bells are M7 (Civic Quarter). Used in Puddle Lane (Mon), High Street (Tue), Civic Quarter (Sun) and the Depot Yard after those days (−4 dB, M6). The district picks its bed via the compiled level's `ambience` field (LEVEL_DESIGN §8.4).

**Scenes** (§8.4): ShiftIntro plays the district bed at −6 dB; Shift plays the bed; Pause suspends it; ducks come from complaint_stamp (−6), crash (−6) and horn (−4) via the mixer.

**Open questions (decide and document):**
1. Sprinkles carry inline params, so the runtime must synthesise them. Default: pre-build sprinkle buffers at load with the vendored pure-TS ZzFX `buildSamples` in the browser (allowed by the TECHNICAL_DESIGN §2.1 update from SSP-179). Prefer zzfx-only sprinkles; jsfxr at runtime would make it a runtime dependency.
2. How a district selects bed parameters (Tuesday chatter at 0 dB) is not specified. Default: a `districtOverrides` map in the amb JSON (e.g. `{"district.high_street": {"layer:market_chatter:gainDb": 0}}`), so the level format does not change. Document it in AUDIO_DESIGN §7.2.
3. A4 (positional ambience emitters in the level legend) is 'TBD (M5)'. Default: defer it with no level-format change, and record the decision in AUDIO_DESIGN §7.2 and §15.2.

Process: `npm run audio`, then the lead's listening approval in-game (`npm run dev`), recorded in the PR.

## Scope

- Bed schema validation (hand-written guards) in render-sfx.ts and generation of `public/assets/audio/amb.json`
- Runtime bed player in sfx.ts: layer graph, LFOs, sprinkle scheduler from the audio sfc32, district overrides, intro −6 dB, pause suspend
- Author `assets-src/audio/amb/town_morning.json`
- Doc updates: AUDIO_DESIGN §7.2 (`districtOverrides`, sprinkle synthesis) and §15.2 A4

## Out of scope

- Other ambiences (`amb.rain`, `amb.wind_leaves`, `amb.seafront`, `amb.night_town`, M6)
- Weather parameter use (M6)
- Positional emitters (unless A4 is resolved in favour of them)

## Acceptance criteria

- [ ] `node tools/audio/render-sfx.ts` writes `public/assets/audio/amb.json` containing `amb.town_morning`; an invalid bed (unknown source type, perMinute min > max) fails with the file and field named
- [ ] Test: the sprinkle schedule for a fixed audio seed over 60 s is deterministic and each sprinkle's count falls within its perMinute range
- [ ] Test: in ShiftIntroScene the bed gain target is −6 dB relative to ShiftScene, and the bed is suspended under PauseOverlay
- [ ] Test: resolved layer gains put High Street's market-chatter layer at 0 dB and Puddle Lane's lower
- [ ] A second `npm run audio` gives no git diff
- [ ] The lead's listening approval is recorded in the PR; AUDIO_DESIGN §7.2 and §15.2 A4 are updated

## Verification

- npm run audio
- npm test -- tests/unit/audio
- npm run assets:verify
- npm run dev, then listen in Puddle Lane and High Street

## Dependencies

**Depends on:**

- [SSP-161](SSP-161-render-sfx-core.md) Implement render-sfx.ts: SFX JSON to WAV sprites, ffmpeg encodes and sfx.json
- [SSP-175](SSP-175-sfx-voice-pool.md) Implement sfx.ts playback: voice pool, variants, pitch ladder and spatial pan
- [SSP-173](SSP-173-mixer-buses-ducking.md) Implement mixer.ts: bus graph, limiter, settings levels and ducking engine
- [SSP-179](SSP-179-worklet-infra.md) Set up the AudioWorklet host that shares tools/audio/synth kernels at runtime
- [SSP-160](SSP-160-dsp-kernels.md) Build the shared DSP kernels in tools/audio/synth (oscillators, filters, envelopes, FM)
- [SSP-105](../M3/SSP-105-high-street-greybox.md) Author and compile the grey-box High Street (80×60) for Tuesday's NPCs
- [SSP-287](../M3/SSP-287-pause-overlay.md) Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire
- [SSP-033](../M1/SSP-033-level-compiler-core.md) Build level schema and compile-level.ts core: parse, legend, buildings, M1 checks
- [SSP-042](../M1/SSP-042-puddle-lane-level.md) Author Puddle Lane map.txt and level.json (64×48) and commit compiled output

**Blocks:**

- [SSP-185](SSP-185-m5-exit-evidence.md) Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR
- [SSP-198](../M6/SSP-198-skip-run.md) Implement SkipRunScene: 45 s cone slalom and reverse-park bays with £5/£50 payouts
- [SSP-217](../M6/SSP-217-audio-ambiences-m6.md) Author amb.rain, amb.wind_leaves, amb.seafront and amb.night_town beds

## References

- ../../AUDIO_DESIGN.md#71-assignment
- ../../AUDIO_DESIGN.md#72-ambience-source-schema-assets-srcaudioambnamejson
- ../../AUDIO_DESIGN.md#84-scene--audio-map
- ../../AUDIO_DESIGN.md#152-open-questions
- ../../LEVEL_DESIGN.md#51-mon-puddle-lane-districtpuddle_lane-tutorial
- ../../LEVEL_DESIGN.md#52-tue-muckleford-high-street-districthigh_street
- ../../LEVEL_DESIGN.md#84-leveljson-schema

## Roadmap tasks covered

- Deliverable: Jingles `jng.tally` and `jng.sacked`. Also `jng.shift_start` and `amb.town_morning` for the vertical slice. (amb.town_morning)
