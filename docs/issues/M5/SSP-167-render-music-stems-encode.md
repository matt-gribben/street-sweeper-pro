---
id: SSP-167
title: "Render music stems, normalise loudness, lint songs, encode and write music.json"
milestone: M5
status: todo
type: feature
estimate: L
labels: [type:feature, area:audio, area:tooling, area:assets, size:L, vertical-slice]
depends_on: [SSP-166, SSP-162, SSP-161, SSP-025]
blocks: [SSP-168, SSP-169, SSP-170, SSP-171, SSP-172, SSP-178, SSP-194, SSP-195, SSP-218, SSP-243, SSP-244]
---

# SSP-167: Render music stems, normalise loudness, lint songs, encode and write music.json

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** feature · **Size:** L · **Areas:** audio, tooling, assets · **Vertical slice**

## Summary

Complete `render-music.ts`. It groups channels into `base`/`drums`/`lead` stems, normalises the full mix, runs the song lint, writes 48 kHz WAVs, encodes Opus 96k and AAC-LC 128k, and generates `public/assets/audio/music.json` with sample-exact loop points. It also handles jingles, including the per-district transposition of `jng.shift_start`.

## Context

**Stems** (AUDIO_DESIGN §8.1): canonical `{ base: [pulse2, tri, bass], drums: [noise], lead: [pulse1] }`. All stems are complete, equal-length loops. Jingles use `stems: { base: [all five] }`, never set `loopRow`, and never loop.

**Loudness** (§4.3):
- Full song mix (the three stems summed): **−16 LUFS integrated ±1**, true peak ≤ **−1 dBTP**. The normalisation gain is computed by render-music.ts and applied **equally to every stem**.
- Jingles: −15 LUFS short-term at the loudest point.

**Paths:**
- WAVs: `build/tmp/audio/music/<id>.<stem>.wav` (48 kHz, 16-bit, mono).
- Songs: `public/assets/audio/music/<id>.<stem>.{ogg,m4a}`. Jingles: `public/assets/audio/music/<id>.{ogg,m4a}`.
- Encodes use the same flags as SFX with different bitrates: Opus `-b:a 96k`, AAC-LC `-b:a 128k`, `-bitexact -map_metadata -1`, native `aac`. Reuse the shared ffmpeg helper from SSP-161.

**music.json entry** (generated, §12.1), e.g. mus.puddle_lane: `bpm 112, beatsPerBar 4, sampleRate 48000, lengthSamples 3497143, loopStartSamples 205714, loopEndSamples 3497143, loopStartSec 4.285714, loopEndSec 72.857143, stems [base, drums, lead], stemPan {base 0, drums 0, lead 0.15}, encoderDelaySamples {ogg, m4a}`. The doc shows `encoderDelaySamples` as 'TBD (M0 spike)' (open question A2), and ROADMAP M0 defers all audio, so expect it to be unmeasured: emit `0` with a code comment, and the SSP-178 issue measures the real constants and writes them here. The song schema has no metre field; default `beatsPerBar` to 4 and accept an optional `beatsPerBar` field (needed for 6/8 in M6), documented in §10.2.

**Song lint** (§10.5) fails on any of:
- a note outside `key` (except patterns in `allowChromatic`);
- a note outside channel range (pulse1 C4–C7, pulse2 C3–C6, tri C2–C5, bass E1–E3);
- an unknown instrument;
- a row ≥ `rows`;
- `loopRow` outside the order;
- stems not covering every channel exactly once (a waiver must be in `notes`);
- a loop length that is not whole bars;
- a jingle with `loopRow`;
- a full-mix true peak > −1 dBTP after normalisation.

The lint is part of `npm run audio`.

**`jng.shift_start`** (§8.3): one render per district key, with the variants concatenated into one sprite file like SFX variants (offsets in music.json). The song schema has no field for this. Proposal: an optional song-level `variants: [{ "name": "district.puddle_lane", "semitones": 0 }, ...]` keyed by district ID (so the player can select by district), documented in AUDIO_DESIGN §10.2. The key lint runs on the untransposed song.

**Flags:** `--only <id>`, `--out <dir>` (same layout rules as render-sfx), and `--report`, which adds `<id>.roll.png` (a pure-TS piano roll via pngjs 7.0.0 showing voice ranges, register clashes, the 16-bar halves and the stem split) plus per-stem and full-mix audio to the shared report.

**Open questions (flag in the PR):**
1. The LUFS and true-peak method is not specified. Proposal: implement ITU-R BS.1770 K-weighted gated loudness and 4× oversampled true peak in TS, so the WAV hashes stay reproducible without depending on ffmpeg's measurement. Cross-check against `ffmpeg -af ebur128=peak=true` in `--report` (expect within 0.5 LU).
2. Which district keys to render for `jng.shift_start` in M5. Default: the M5 districts only, G major (Puddle Lane) and D major (High Street). Add the other districts when their songs land in M6/M7.
3. The key string format for flats (e.g. `"Bb major"` for `mus.title`): note cells use sharps only. Accept `Bb`/`B♭` key names and map them to sharps for the lint.

## Scope

- Stem grouping and summing; full-mix loudness and true-peak measurement; equal normalisation gain across stems
- The song lint (§10.5), with errors naming file, pattern and row
- WAV writing, ffmpeg encode wrapper reuse (96k/128k), WAV sha256 into asset-hashes.json
- music.json generation with sample-exact loop points, beatsPerBar and encoderDelaySamples
- Jingle mode, and the song-level `variants` transposition into one sprite file for `jng.shift_start`
- AUDIO_DESIGN §10.2 updated for `variants` and `beatsPerBar`
- `--only`, `--out` and `--report` (piano roll via pngjs) flags
- Make `npm run audio` pass end to end

## Out of scope

- Composing the songs and jingles (song issues)
- Runtime loop playback and measuring encoder delay (issue SSP-178)

## Acceptance criteria

- [ ] `node tools/audio/render-music.ts` on a fixture song writes three equal-length stem WAVs (48000 Hz, mono, 16-bit) plus .ogg/.m4a, and a music.json entry with all the fields listed above
- [ ] Test: the summed full mix of a normalised fixture measures −16 ±1 LUFS integrated with true peak ≤ −1 dBTP; the gain applied is identical for all stems
- [ ] Test: each §10.5 lint rule has a failing fixture that makes the tool exit non-zero with a message naming the rule
- [ ] Test: for a song with a 2-bar pickup and a 32-bar loop at 112 bpm, `loopStartSamples` = 205714, `loopStartSec` = 4.285714 and `lengthSamples` = 3497143 (matching AUDIO_DESIGN §12.1)
- [ ] A jingle fixture with two `variants` renders into a single file, with per-variant offsets in music.json
- [ ] `npm run audio` exits 0 and a second run produces no git diff
- [ ] `--report` writes `<id>.roll.png`, which opens with Read

## Verification

- npm run audio
- node tools/audio/render-music.ts --only <fixture-id> --report
- Read build/audio-report/<fixture-id>.roll.png
- npm test -- tests/unit/audio
- npm run typecheck && npm run lint
- npm run audio && git status --porcelain

## Dependencies

**Depends on:**

- [SSP-166](SSP-166-tracker-core.md) Implement the render-music.ts tracker core: song parsing, instruments, notes, effects
- [SSP-162](SSP-162-audio-review-report.md) Add --report review evidence: spectrograms, waveforms, metrics, listening page
- [SSP-161](SSP-161-render-sfx-core.md) Implement render-sfx.ts: SFX JSON to WAV sprites, ffmpeg encodes and sfx.json
- [SSP-025](../M0/SSP-025-pipeline-determinism-spikes.md) Measure cross-platform PNG identity and ffmpeg encode determinism (D-12, D-11)

**Blocks:**

- [SSP-168](SSP-168-audio-verify-coverage.md) Wire audio into assets:verify and add SFX coverage and reference tests
- [SSP-169](SSP-169-song-puddle-lane.md) Compose mus.puddle_lane 'Milk Float Shuffle' with base, drums and lead stems
- [SSP-170](SSP-170-song-title.md) Compose mus.title 'Brush With Greatness' with base, drums and lead stems
- [SSP-171](SSP-171-song-high-street.md) Compose mus.high_street 'Window Shopping' with base, drums and lead stems
- [SSP-172](SSP-172-jingles-vs.md) Compose jng.shift_start, jng.tally and jng.sacked jingles
- [SSP-178](SSP-178-music-player.md) Implement music.ts: sample-locked stems, loops, jingles and scene music
- [SSP-194](../M6/SSP-194-audio-mus-workshop.md) Compose mus.workshop 'Tea Break' and implement the mus.workshop fallback rule
- [SSP-195](../M6/SSP-195-audio-jingles-star-towed.md) Compose jng.star and jng.towed and wire them to the tally and TOWED end state
- [SSP-218](../M6/SSP-218-audio-mus-gasworks.md) Compose mus.gasworks 'Drizzle Dub' with adaptive stems and dub delay send
- [SSP-243](../M7/SSP-243-song-promenade.md) Compose and render mus.promenade "Seagull Surf" with adaptive stems
- [SSP-244](../M7/SSP-244-song-kebab-mile.md) Compose and render mus.kebab_mile "Kebab O'Clock" with adaptive stems

## References

- ../../AUDIO_DESIGN.md#81-channel-and-stem-conventions-every-song
- ../../AUDIO_DESIGN.md#83-jingles
- ../../AUDIO_DESIGN.md#43-loudness-targets
- ../../AUDIO_DESIGN.md#102-schema
- ../../AUDIO_DESIGN.md#105-song-lint-part-of-npm-run-audio
- ../../AUDIO_DESIGN.md#113-encoding-exact-ffmpeg-invocations-wrapped-by-the-renderers
- ../../AUDIO_DESIGN.md#115-review-evidence-what-claude-reads-before-accepting-audio
- ../../AUDIO_DESIGN.md#121-formats
- ../../AUDIO_DESIGN.md#152-open-questions

## Roadmap tasks covered

- `render-music.ts`: ... stems → WAV → Opus 96 kbps + AAC 128 kbps; loop points in `public/assets/audio/music.json`.
