---
id: SSP-166
title: "Implement the render-music.ts tracker core: song parsing, instruments, notes, effects"
milestone: M5
status: todo
type: feature
estimate: L
labels: [type:feature, area:audio, area:tooling, area:test, size:L, vertical-slice]
depends_on: [SSP-160, SSP-159]
blocks: [SSP-167, SSP-194, SSP-195, SSP-218, SSP-219, SSP-243, SSP-244, SSP-245]
---

# SSP-166: Implement the render-music.ts tracker core: song parsing, instruments, notes, effects

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** feature · **Size:** L · **Areas:** audio, tooling, test · **Vertical slice**

## Summary

Build the deterministic 5-channel tracker synth that turns `*.song.json` into per-channel sample buffers. This covers the schema, instruments, the note-cell grammar, effects, swing, the delay send and the order list, using the shared DSP kernels.

## Context

**Song schema** (AUDIO_DESIGN §10.2): `id, title, bpm, rowsPerBeat` (canonical 4: a row is a 1/16 note in 4/4), `swing` (delays odd rows by swing × row length, default 0), `key, sampleRate` (48000), `channels` (`pulse1, pulse2, tri, noise, bass`), `instruments` keyed by two hex digits, `fx.delay {time "3/16", feedback, lowpass, sends{channel: amount}}`, `patterns{name: {rows, <channel>: sparse {row: cell} OR full array of rows strings}}`, `order[]`, `loopRow`, `stems`, `mixDb{channel: dB}`, `notes`, and the lint's `allowChromatic` list.

**Instruments:** `wave` is pulse (duty) / triangle (stepped 4-bit, optional smooth) / saw / sine / noise (`noiseMode` long|short, optional `pitchEnv {from, to, time}`) / fm2 (`ratio, index, indexDecay`). Each has `adsr [a, d, s, r]`, an optional `filter {type, cutoff, q}`, optional `vibrato {depthCents, rateHz, delay}` and optional `bitcrush`.

**Note cell** `"NNO II vVV [EXX]"` (§10.3):
- Note uses sharps only (`C-4`, `C#4`); for noise, the note selects the noise period (higher = brighter).
- `II` is the instrument (hex). `vVV` is the volume in hex, `v00`–`v40` (0–64).
- `===` is note off (release). `---` or an absent row means continue.

**Effects:**
- `Axy` arpeggio: root, +x, +y semitones at 1/3 row each.
- `1xx`/`2xx` slide up/down xx cents per row; `3xx` portamento at xx cents per row.
- `4xy` vibrato depth x×4 cents, rate y Hz.
- `7xy` retrig every x/8 row, depth y.
- `Dxx` duty xx/100; `Cxx` cut after xx ticks (**6 ticks per row**).

One voice per channel; the voice cap is 5.

**loopRow:** the doc defines it as 'pattern index × rows + row', which assumes every pattern has the same `rows`. The §10.2 example's 2-bar pickup `I` (32 rows) followed by 64-row patterns breaks that. Compute absolute rows as the sum of the preceding order entries' `rows` (identical when patterns are uniform) and correct the §10.2 comment in the same PR.

**Determinism:** pure TS, no browser globals, no wall clock, sfc32 for any randomness, Node 24.21.0. Hand-written type guards (no zod).

**Tests:** `tests/unit/audio/render.test.ts` pins the sha256 of a **2-bar fixture song** (put it under a test fixtures path such as `tests/unit/audio/fixtures/`, not `assets-src`).

**Parser fixture caveat:** the §10.2 example is JSONC (comments) and defines only pattern `A`, while `order` references `I`, `B`, `C` and `D`. Use it as a fixture only after stripping comments and adding stub patterns; a song whose order references an undefined pattern must be rejected.

## Scope

- Song JSON loader with hand-written type guards and clear error messages (file, pattern, channel, row)
- Pattern expansion (sparse and array forms), order list traversal, absolute-row loopRow bookkeeping, swing timing at 48 kHz
- Instrument voices built on the tools/audio/synth kernels: pulse/triangle/saw/sine/noise/fm2 with ADSR, filter, vibrato, pitchEnv, bitcrush
- Effects Axy, 1xx, 2xx, 3xx, 4xy, 7xy, Dxx, Cxx; note-off; volume scaling; mixDb
- Delay send fx (tempo-synced time, feedback, lowpass)
- Render API returning per-channel Float32 buffers plus the timing map (row → sample)
- A 2-bar fixture song and its pinned sha256 test
- Correct the §10.2 loopRow comment

## Out of scope

- Stem grouping, loudness normalisation, song lint, encoding and music.json (issue SSP-167)
- Composing real songs (song issues)

## Acceptance criteria

- [ ] The §10.2 example (comments stripped, stub patterns I/B/C/D added) parses; the unmodified order with undefined patterns is rejected; malformed cells (`H-4 01 v40`, `C-4 zz v40`, `C-4 01 v41`) are rejected with the pattern, channel and row in the message
- [ ] Test: with `bpm` 120 and `rowsPerBeat` 4, row n starts at sample round(n × 6000) at 48 kHz; with `swing` 0.16, odd rows are delayed by 0.16 × row length
- [ ] Test: with a 32-row pattern followed by 64-row patterns, loopRow 32 maps to the first row of the second order entry
- [ ] Test: `Cxx` cuts at xx/6 of a row; `Axy` cycles 3 pitches per row; `Dxx` changes the pulse duty (verified on the rendered buffer)
- [ ] Test: an `fm2` instrument renders deterministically, and the index decays per `indexDecay`
- [ ] The 2-bar fixture song renders to a pinned sha256 on Node 24.21.0 twice in a row
- [ ] No import of `src/audio` or any browser API from `tools/audio/` (import scan test)

## Verification

- npm test -- tests/unit/audio
- npm run typecheck && npm run lint

## Dependencies

**Depends on:**

- [SSP-160](SSP-160-dsp-kernels.md) Build the shared DSP kernels in tools/audio/synth (oscillators, filters, envelopes, FM)
- [SSP-159](SSP-159-audio-deps-zzfx-vendor.md) Pin jsfxr 1.4.1, vendor ZzFX buildSamples with seeded RNG, add WAV writer

**Blocks:**

- [SSP-167](SSP-167-render-music-stems-encode.md) Render music stems, normalise loudness, lint songs, encode and write music.json
- [SSP-194](../M6/SSP-194-audio-mus-workshop.md) Compose mus.workshop 'Tea Break' and implement the mus.workshop fallback rule
- [SSP-195](../M6/SSP-195-audio-jingles-star-towed.md) Compose jng.star and jng.towed and wire them to the tally and TOWED end state
- [SSP-218](../M6/SSP-218-audio-mus-gasworks.md) Compose mus.gasworks 'Drizzle Dub' with adaptive stems and dub delay send
- [SSP-219](../M6/SSP-219-audio-mus-conker-hill.md) Compose mus.conker_hill 'Conker Crunch' 6/8 jig with adaptive stems
- [SSP-243](../M7/SSP-243-song-promenade.md) Compose and render mus.promenade "Seagull Surf" with adaptive stems
- [SSP-244](../M7/SSP-244-song-kebab-mile.md) Compose and render mus.kebab_mile "Kebab O'Clock" with adaptive stems
- [SSP-245](../M7/SSP-245-song-civic-trophy.md) Compose mus.civic_quarter "Clipboard March" and the jng.trophy jingle

## References

- ../../AUDIO_DESIGN.md#10-tracker-song-format
- ../../AUDIO_DESIGN.md#102-schema
- ../../AUDIO_DESIGN.md#103-note-cell-format-nno-ii-vvv-exx
- ../../AUDIO_DESIGN.md#104-instrument-waves
- ../../AUDIO_DESIGN.md#81-channel-and-stem-conventions-every-song
- ../../AUDIO_DESIGN.md#14-testing

## Roadmap tasks covered

- `render-music.ts`: tracker with `pulse1`, `pulse2`, `tri`, `noise` and `bass` (2-op FM) channels; instruments; note-string patterns; order list; loop row; ...
