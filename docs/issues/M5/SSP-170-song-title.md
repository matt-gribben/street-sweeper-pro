---
id: SSP-170
title: "Compose mus.title 'Brush With Greatness' with base, drums and lead stems"
milestone: M5
status: todo
type: asset
estimate: M
labels: [type:asset, area:audio, area:assets, size:M, vertical-slice]
depends_on: [SSP-167]
blocks: [SSP-185, SSP-198, SSP-245, SSP-246]
---

# SSP-170: Compose mus.title 'Brush With Greatness' with base, drums and lead stems

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** asset · **Size:** M · **Areas:** audio, assets · **Vertical slice**

## Summary

Write the title theme: a pompous brass-band march with a chiptune bounce. Its hook is quoted later by `mus.civic_quarter` and `jng.trophy`, so it must be memorable and documented.

## Context

Track spec (AUDIO_DESIGN §8.2):
- `mus.title`, title 'Brush With Greatness'. **132 BPM, B♭ major, 4/4** brass-band march with a chiptune bounce.
- Mood: pompous and heroic, like a civic parade for a road sweeper. Pulse1 plays a cornet-like hook with 1/16 grace notes. The FM bass plays a tuba 'oom-pah'. Drums: a snare roll and a bass drum on beats 1 and 3.
- Structure: **4-bar intro + 24-bar loop (≈ 51 s)**, so `loopRow` 64 at rowsPerBeat 4. Intro = 16 beats × 60/132 s = 7.2727 s.
- Used in TitleScene (all stems, starting on the first unlock gesture) and, from M6, in Skip Run (base + drums, lead at 15 s remaining).
- File: `assets-src/audio/music/mus.title.song.json`.
- Note cells use sharps only, so B♭ is written `A#`. Use the flat key-string form the lint accepts (SSP-167 open question 3).

Rules:
- Canonical stems; channel ranges as §8.1; pulse2 carries a two-bar lead motif.
- Original melody; no trademark in `title`.
- −16 LUFS ±1, TP ≤ −1 dBTP.
- Document the hook (bars and notes) in `notes` for later reprises: `mus.civic_quarter` (M7) and `jng.trophy` (M7) quote it.

Process: `--report`, Read the roll and spectrograms, lead listening approval in the PR (R-04).

## Scope

- `assets-src/audio/music/mus.title.song.json`
- Rendered stems, music.json entry and hashes committed
- Review evidence and lead approval

## Out of scope

- Skip Run usage (M6)
- `jng.trophy` and `mus.civic_quarter` reprises (M7)

## Acceptance criteria

- [ ] The song lint passes (key B♭ major, ranges, whole-bar loop, stems)
- [ ] music.json shows bpm 132, loopStartSec 7.272727 ±0.000001 (4-bar intro) and a 24-bar loop (loopEnd − loopStart = 96 beats)
- [ ] The full mix is −16 ±1 LUFS with TP ≤ −1 dBTP
- [ ] `notes` names the hook bars and notes for later quotation
- [ ] The PR has the §11.5 checklist ticked and the lead's listening approval

## Verification

- node tools/audio/render-music.ts --only mus.title --report
- Read build/audio-report/mus.title.roll.png
- npm run audio && npm run assets:verify

## Dependencies

**Depends on:**

- [SSP-167](SSP-167-render-music-stems-encode.md) Render music stems, normalise loudness, lint songs, encode and write music.json

**Blocks:**

- [SSP-185](SSP-185-m5-exit-evidence.md) Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR
- [SSP-198](../M6/SSP-198-skip-run.md) Implement SkipRunScene: 45 s cone slalom and reverse-park bays with £5/£50 payouts
- [SSP-245](../M7/SSP-245-song-civic-trophy.md) Compose mus.civic_quarter "Clipboard March" and the jng.trophy jingle
- [SSP-246](../M7/SSP-246-audio-complete-audit.md) Verify all 9 songs and 6 jingles ship, and run the full-playthrough mix pass

## References

- ../../AUDIO_DESIGN.md#82-track-list
- ../../AUDIO_DESIGN.md#84-scene--audio-map
- ../../AUDIO_DESIGN.md#81-channel-and-stem-conventions-every-song
- ../../AUDIO_DESIGN.md#103-note-cell-format-nno-ii-vvv-exx

## Roadmap tasks covered

- `Compose the three songs and three jingles above. Listening review by the project lead (see R-04). (mus.title)`
- `Exit criterion: Title + Puddle Lane + High Street songs with adaptive stems. (Title)`
