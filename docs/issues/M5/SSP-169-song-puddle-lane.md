---
id: SSP-169
title: "Compose mus.puddle_lane 'Milk Float Shuffle' with base, drums and lead stems"
milestone: M5
status: todo
type: asset
estimate: L
labels: [type:asset, area:audio, area:assets, size:L, vertical-slice]
depends_on: [SSP-167]
blocks: [SSP-185, SSP-246]
---

# SSP-169: Compose mus.puddle_lane 'Milk Float Shuffle' with base, drums and lead stems

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** asset · **Size:** L · **Areas:** audio, assets · **Vertical slice**

## Summary

Write the Monday district song as tracker JSON. It must survive 3–4 loops in a 240 s shift, its base stem must work alone, and it must pass the song lint, loudness targets, evidence review and the lead's listening review.

## Context

Track spec (AUDIO_DESIGN §8.2):
- `mus.puddle_lane`, title 'Milk Float Shuffle'. **112 BPM, G major, 4/4 with 16% swing** (`swing: 0.16`).
- Mood: dawn, chipper and unhurried, a tune that sounds whistled by a milkman. Pulse2 plays skipping thirds; the noise channel plays a clinking-bottle hat pattern.
- Structure: **2-bar pickup + 32-bar loop (≈ 69 s)**, so `loopRow` 32 at rowsPerBeat 4. The music.json example (§12.1) gives lengthSamples 3497143 and loopStartSec 4.285714.
- File: `assets-src/audio/music/mus.puddle_lane.song.json`. The §10.2 schema example is this song's starter (it defines only pattern A; write the rest).

Rules (§8.1, §8.2, §1.5):
- Canonical stems: base = pulse2, tri, bass; drums = noise; lead = pulse1.
- Channel ranges: pulse1 C4–C7, pulse2 C3–C6, tri C2–C5, bass E1–E3.
- Write the loop as **two contrasting 16-bar halves**, with a B-section variation in the base stem.
- Pulse2 always carries a two-bar motif from the lead, so base alone is recognisably the tune. Players hear base alone for most of a calm early shift; drums enter at combo ×3 and lead under 60 s.
- Keep the 1–4 kHz band clear for pickups and barks, and do not write melody in `pickup_small`'s register (~620–1,100 Hz).
- Major key, original melody: no quotes or paraphrases of existing tunes, and no trademarks in `title`.
- Loudness: −16 LUFS ±1 integrated (full mix), TP ≤ −1 dBTP.

Process (R-04 mitigation):
- `node tools/audio/render-music.ts --only mus.puddle_lane --report`.
- Read `mus.puddle_lane.roll.png` and the spectrograms.
- The lead listens via `build/audio-report/index.html`, including base-only and base+drums mixes, and approves in the PR.

Open question A3 (are mono stems too narrow?) is answered at the end of M5. Note the lead's impression in the PR.

## Scope

- `assets-src/audio/music/mus.puddle_lane.song.json` with instruments, patterns, order, loopRow, stems, mixDb and notes
- Rendered stems (.ogg/.m4a), music.json entry and WAV hashes committed
- Review evidence read; lead listening approval recorded

## Out of scope

- Adaptive playback logic (issues SSP-177, SSP-178)
- Other district songs

## Acceptance criteria

- [ ] `npm run audio` passes the song lint for mus.puddle_lane (key G major, ranges, whole-bar loop, stems cover each channel once)
- [ ] music.json shows bpm 112, loopStartSamples 205714 (loopStartSec 4.285714) and lengthSamples 3497143 (a 32-bar loop)
- [ ] The full-mix metrics show −16 ±1 LUFS and TP ≤ −1 dBTP
- [ ] The song's `notes` field documents the two 16-bar halves and where pulse2 quotes the hook
- [ ] The PR contains the §11.5 checklist ticked and the lead's approval (base-only, base+drums and all-stems auditioned), plus the lead's A3 impression

## Verification

- node tools/audio/render-music.ts --only mus.puddle_lane --report
- Read build/audio-report/mus.puddle_lane.roll.png
- npm run audio && npm run assets:verify

## Dependencies

**Depends on:**

- [SSP-167](SSP-167-render-music-stems-encode.md) Render music stems, normalise loudness, lint songs, encode and write music.json

**Blocks:**

- [SSP-185](SSP-185-m5-exit-evidence.md) Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR
- [SSP-246](../M7/SSP-246-audio-complete-audit.md) Verify all 9 songs and 6 jingles ship, and run the full-playthrough mix pass

## References

- ../../AUDIO_DESIGN.md#82-track-list
- ../../AUDIO_DESIGN.md#81-channel-and-stem-conventions-every-song
- ../../AUDIO_DESIGN.md#102-schema
- ../../AUDIO_DESIGN.md#121-formats
- ../../AUDIO_DESIGN.md#15-do-and-dont
- ../../ROADMAP.md#6-risk-register

## Roadmap tasks covered

- `Compose the three songs and three jingles above. Listening review by the project lead (see R-04). (mus.puddle_lane)`
- `Exit criterion: Title + Puddle Lane + High Street songs with adaptive stems. (Puddle Lane)`
