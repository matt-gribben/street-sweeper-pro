---
id: SSP-163
title: "Author the 14 sweeping, hopper and vehicle SFX sources"
milestone: M5
status: todo
type: asset
estimate: L
labels: [type:asset, area:audio, area:assets, size:L, vertical-slice]
depends_on: [SSP-161, SSP-162]
blocks: [SSP-168]
---

# SSP-163: Author the 14 sweeping, hopper and vehicle SFX sources

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** asset · **Size:** L · **Areas:** audio, assets · **Vertical slice**

## Summary

Write, render and review the JSON sources for the 8 sweeping/hopper and 6 vehicle sound effects: Bessie's core feedback sounds plus traffic and van cues. Each one gets evidence review and a listening sign-off from the lead.

## Context

Sources: `assets-src/audio/sfx/<name>.json` (AUDIO_DESIGN §5.4). Columns: engine | variants | jitter cents | bus | priority | voices/cooldown ms | design. Variant forms (`count`, per-variant `meta`) are as documented in AUDIO_DESIGN §5.2 by issue SSP-161.

**Sweeping and hopper:**
- `pickup_small`: zzfx | 4 | 25 | sfx | 3 | 4/35 | square blip sliding 620→1,100 Hz, pitch jump at 30 ms, 70 ms long, plus a 10 ms noise tick. `pitchLadder: "chain"`. The §5.2 example is the starting point.
- `pickup_big`: zzfx | 3 | 30 | sfx | 3 | 2/60 | sine 300→90 Hz over 180 ms, low-passed noise gulp, cardboard flap at 40 ms. Ladder.
- `pickup_glass`: jsfxr | 3 + `smash`ᴺ | 40 | sfx | 3 | 2/50 | 2.4 kHz triangle clink, fast upward arpeggio tail, 220 ms. Ladder. The named `smash` variant follows a glass-bottle fling (§5.4 `fling` row).
- `fling`: zzfx | 3 | 50 | sfx | 2 | 3/40 | noise HP swept 3 kHz→800 Hz, then a falling A4→E4 blip, 140 ms.
- `hopper_full`: zzfx | `full`, `warn`ᴺ, `clunk`ᴺ | 0/0/40 | sfx | 4 | 1/400 | `full` = sawtooth 220→165 Hz, 600 ms; `warn` = same at +5 semitones and −6 dB, 400 ms; `clunk` = 110 Hz square thump with 1.3/2.1 kHz partials, 120 ms.
- `dump`: zzfx | 1 | 0 | sfx | 4 | 1/0 | noise grains ~25/s, LP falling 2 kHz→600 Hz, tin-can clatter, final thunk; rendered at 2.0 s (the skip plays it with `durationScale` 0.667, giving 3.0 s and about −7 semitones).
- `brush_lower`: zzfx | 2 | 20 | sfx | 3 | 1/100 | band-passed hiss 400 ms falling, rubbery clunk at 450 ms.
- `brush_raise`: zzfx | 2 | 20 | sfx | 3 | 1/100 | the mirror: clunk at 0 ms, then a rising hiss.

**Vehicle:**
- `horn`: jsfxr | `bessie`, `two_tone`ᴺ, `car`ᴺ | 0/0/30 | sfx | 4 | 1/120 (Bessie), 3/300 (car) via per-variant `meta` | bessie = nasal square PARP ~390 Hz with slight vibrato, 350 ms; two_tone = 390/494 Hz, 430 ms; car = a higher, shorter meep. The §5.2 example is the starting point.
- `bump_wall`: zzfx | 3 | 60 | sfx | 3 | 2/80 | hollow 90 Hz square thunk plus a 2-partial panel rattle.
- `bump_kerb`: zzfx | 3 | 40 | sfx | 3 | 1/150 | 70 Hz sine thud 90 ms plus a narrow-duty pulse creak 200 ms.
- `crash`: zzfx layers | 3 | 30 | sfx | 5 | 2/200 | noise burst 0–60 ms, metallic clang (3 inharmonic partials, 400 ms decay), hubcap 'boing-oing' from 150 ms, tinkly debris to 900 ms. Comic, not violent.
- `police_whoop`: jsfxr | 2 | 0 | sfx | 5 | 1/1500 | square sweep 600→1,300 Hz twice, 700 ms.
- `ice_cream_chime`: zzfx layers + `loop` | 1 | 0 | sfx | 2 | 1/0 | **original** 8-bar music-box phrase in F major at 132 bpm (~3.6 s), triangle + sine bells with slight detune, loop at the phrase boundary. Must not quote any existing van tune.

ᴺ = named-only (`"named": true`).

**Rules:**
- Every zzfx base has `randomness: 0`; spread comes from the `mutate` block.
- Leave the 1–4 kHz band clear of the music lead (AUDIO_DESIGN §1.5).
- No trademarks in `id`, names or any field (CLAUDE.md hard rule 7).
- Run `--report`, Read spec.png and wave.png, and get lead approval via `build/audio-report/index.html`, recorded in the PR.
- Re-pin the `pickup_small` sha256 in `tests/unit/audio/render.test.ts` with a reason if the source changes from the §5.2 example.

## Scope

- 14 JSON sources under `assets-src/audio/sfx/` with variants, `mutate` and seeds, `pitchJitterCents`, bus, gainDb, priority, maxVoices, cooldownMs (per-variant `meta` for horn and hopper_full)
- Rendered .ogg/.m4a, sfx.json entries and WAV hashes committed with the sources
- A unit test (e.g. `tests/unit/audio/sfxSources.test.ts`) asserting variant names/counts, bus and priority against the §5.4 table for these IDs
- Review evidence read for each sound; lead listening sign-off recorded in the PR

## Out of scope

- Renderer or schema changes (issue SSP-161)
- Triggering these sounds in game (issue SSP-176)
- Live engine/brush/spray/beeper synths (synth issues)
- Final in-game mix levels beyond the per-file gainDb

## Acceptance criteria

- [ ] All 14 files exist: pickup_small, pickup_big, pickup_glass, fling, hopper_full, dump, brush_lower, brush_raise, horn, bump_wall, bump_kerb, crash, police_whoop, ice_cream_chime
- [ ] Each file passes render-sfx lint, and its variant count, named variants, bus, priority and voices/cooldown match the §5.4 table (unit test reading the JSON)
- [ ] pickup_small, pickup_big and pickup_glass declare `"pitchLadder": "chain"`; pickup_glass has a named `smash` variant
- [ ] horn's sfx.json entry carries maxVoices/cooldownMs 1/120 for bessie and 3/300 for car; hopper_full's jitter is 0/0/40 and horn's 0/0/30
- [ ] Each rendered variant's duration is within 20% of its §5.4 target where one is given (from `metrics.json` `variants`, listed in the PR)
- [ ] `ice_cream_chime` declares a `loop` whose start and end fall on the phrase boundary
- [ ] A second render produces no git diff
- [ ] The PR contains the §11.5 acceptance checklist ticked, plus the lead's listening approval

## Verification

- node tools/audio/render-sfx.ts --report
- Read build/audio-report/<name>.spec.png and <name>.wave.png for each of the 14
- npm test -- tests/unit/audio
- npm run assets:verify

## Dependencies

**Depends on:**

- [SSP-161](SSP-161-render-sfx-core.md) Implement render-sfx.ts: SFX JSON to WAV sprites, ffmpeg encodes and sfx.json
- [SSP-162](SSP-162-audio-review-report.md) Add --report review evidence: spectrograms, waveforms, metrics, listening page

**Blocks:**

- [SSP-168](SSP-168-audio-verify-coverage.md) Wire audio into assets:verify and add SFX coverage and reference tests

## References

- ../../AUDIO_DESIGN.md#54-full-sfx-list
- ../../AUDIO_DESIGN.md#52-sfx-source-schema
- ../../AUDIO_DESIGN.md#15-do-and-dont
- ../../AUDIO_DESIGN.md#115-review-evidence-what-claude-reads-before-accepting-audio

## Roadmap tasks covered

- Author all 32 SFX JSON sources, with variants and `pitchJitterCents`. (14 of 32: sweeping, hopper, vehicle)
