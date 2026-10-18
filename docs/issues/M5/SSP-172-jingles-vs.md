---
id: SSP-172
title: "Compose jng.shift_start, jng.tally and jng.sacked jingles"
milestone: M5
status: todo
type: asset
estimate: M
labels: [type:asset, area:audio, area:assets, size:M, vertical-slice]
depends_on: [SSP-167]
blocks: [SSP-185, SSP-192, SSP-246]
---

# SSP-172: Compose jng.shift_start, jng.tally and jng.sacked jingles

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** asset · **Size:** M · **Areas:** audio, assets · **Vertical slice**

## Summary

Write the three single-stem jingles the vertical slice needs: the shift-start flourish (transposed per district), the tally fanfare and the comic SACKED descent.

## Context

AUDIO_DESIGN §8.3. Jingles are single-stem tracker songs (`stems: { base: [pulse1, pulse2, tri, noise, bass] }`), play on the `jingle` bus (−8 dB), never loop (no `loopRow`), and target −15 LUFS short-term at the loudest point.

- `jng.shift_start`: 2.5 s, in the tonic of the district song. An 'on your marks' brass flourish **ending on the dominant**, so the district song's first downbeat resolves it. Transposition uses the song-level `variants` field documented by SSP-167 (one render per district, variants in one sprite file). M5 needs `district.puddle_lane` (G major) and `district.high_street` (D major). It plays when the shift intro card is dismissed and the timer starts.
- `jng.tally`: 4.0 s, F major (it leads into 'Tea Break', `mus.workshop`, in M6). A printing-press rhythm on the noise channel, then a 'hot off the press' fanfare. The doc says it plays when the Mercury front page appears; in M5 the tally is still the M2 numbers page, so it plays on TallyScene entry.
- `jng.sacked`: 3.0 s, minor, descending. A comic 'wah-wah-wah-waaah' trombone-style descent on pulse1 with pitch bends (`1xx`/`2xx`/`3xx`). Silly, not cruel. It follows `complaint_stamp` when complaints reach 5. The lint needs a declared `key`; choose a minor key and state it in `notes`.

Files: `assets-src/audio/music/jng.shift_start.song.json`, `jng.tally.song.json`, `jng.sacked.song.json`.

Process: `--report`, Read the evidence, lead listening approval in the PR (R-04).

## Scope

- Three jingle song files
- `variants` for district.puddle_lane (G major) and district.high_street (D major) on jng.shift_start
- Rendered .ogg/.m4a, music.json entries and hashes committed; review and lead approval

## Out of scope

- `jng.star`, `jng.towed` (M6); `jng.trophy` (M7)
- Playback timing and ducking (issue SSP-178)

## Acceptance criteria

- [ ] All three files pass the song lint, and none sets `loopRow`
- [ ] Rendered durations (per variant for jng.shift_start) are 2.5 s, 4.0 s and 3.0 s, each within ±20%
- [ ] Loudest-point short-term loudness is −15 ±1 LUFS for each (metrics.json)
- [ ] jng.shift_start has variants named `district.puddle_lane` and `district.high_street` in one sprite file, with offsets in music.json; each ends on the dominant of its key (stated in `notes`, visible in the roll)
- [ ] jng.sacked declares a minor key
- [ ] The PR has the §11.5 checklist ticked and the lead's listening approval

## Verification

- node tools/audio/render-music.ts --only jng.shift_start --report
- node tools/audio/render-music.ts --only jng.tally --report
- node tools/audio/render-music.ts --only jng.sacked --report
- Read build/audio-report/jng.shift_start.roll.png
- npm run audio && npm run assets:verify

## Dependencies

**Depends on:**

- [SSP-167](SSP-167-render-music-stems-encode.md) Render music stems, normalise loudness, lint songs, encode and write music.json

**Blocks:**

- [SSP-185](SSP-185-m5-exit-evidence.md) Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR
- [SSP-192](../M6/SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-246](../M7/SSP-246-audio-complete-audit.md) Verify all 9 songs and 6 jingles ship, and run the full-playthrough mix pass

## References

- ../../AUDIO_DESIGN.md#83-jingles
- ../../AUDIO_DESIGN.md#84-scene--audio-map
- ../../AUDIO_DESIGN.md#43-loudness-targets

## Roadmap tasks covered

- `Compose the three songs and three jingles above. Listening review by the project lead (see R-04). (jng.shift_start, jng.tally, jng.sacked)`
- Deliverable: Jingles `jng.tally` and `jng.sacked`. Also `jng.shift_start` ... for the vertical slice. (jingles)
- `Exit criterion: Tally and sacked jingles.`
