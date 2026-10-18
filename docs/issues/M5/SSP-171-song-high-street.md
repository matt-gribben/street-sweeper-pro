---
id: SSP-171
title: "Compose mus.high_street 'Window Shopping' with base, drums and lead stems"
milestone: M5
status: todo
type: asset
estimate: M
labels: [type:asset, area:audio, area:assets, size:M]
depends_on: [SSP-167]
blocks: [SSP-185, SSP-203, SSP-246]
---

# SSP-171: Compose mus.high_street 'Window Shopping' with base, drums and lead stems

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** asset · **Size:** M · **Areas:** audio, assets

## Summary

Write the Tuesday market-day district song: a bouncy 80s-pop sitcom theme whose base stem stands alone and survives a 240 s shift.

## Context

Track spec (AUDIO_DESIGN §8.2):
- `mus.high_street`, title 'Window Shopping'. **124 BPM, D major, 4/4**, bouncy 80s-pop / sitcom theme.
- Mood: busy and bright. Syncopated pulse2 stabs, a slap-bass FM patch, and a lead full of 'ka-ching' arpeggios. A 'market bell' motif returns every 8 bars.
- Structure: **32-bar loop (≈ 62 s)** with no intro, so `loopRow` 0.
- File: `assets-src/audio/music/mus.high_street.song.json`. LEVEL_DESIGN §5.2 assigns this song to `district.high_street`.

Rules:
- Two contrasting 16-bar halves with a base B-section variation; pulse2 carries a two-bar lead motif.
- Canonical stems and channel ranges.
- Keep 1–4 kHz clear for pickups; avoid pickup_small's register in the lead.
- −16 LUFS ±1, TP ≤ −1 dBTP. Original melody, no trademarks.

Process: `--report`, Read the roll and spectrograms, lead approval (R-04). If R-04's contingency triggers (districts share a track), record that decision in the PR and ROADMAP §6.

## Scope

- `assets-src/audio/music/mus.high_street.song.json`
- Rendered stems, music.json entry and hashes committed
- Review evidence and lead approval

## Out of scope

- High Street level art or behaviour

## Acceptance criteria

- [ ] The song lint passes (D major, ranges, whole-bar loop, stems)
- [ ] music.json shows bpm 124, loopStartSamples 0 and a 32-bar loop length (128 beats = 2,972,903 ±1 samples at 48 kHz)
- [ ] The full mix is −16 ±1 LUFS with TP ≤ −1 dBTP
- [ ] `notes` documents the 8-bar market-bell motif positions and the 16-bar halves
- [ ] The PR has the §11.5 checklist ticked and the lead's listening approval

## Verification

- node tools/audio/render-music.ts --only mus.high_street --report
- Read build/audio-report/mus.high_street.roll.png
- npm run audio && npm run assets:verify

## Dependencies

**Depends on:**

- [SSP-167](SSP-167-render-music-stems-encode.md) Render music stems, normalise loudness, lint songs, encode and write music.json

**Blocks:**

- [SSP-185](SSP-185-m5-exit-evidence.md) Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR
- [SSP-203](../M6/SSP-203-district-high-street-final.md) Bring district.high_street to final M6 quality with collectibles and 3-star replay
- [SSP-246](../M7/SSP-246-audio-complete-audit.md) Verify all 9 songs and 6 jingles ship, and run the full-playthrough mix pass

## References

- ../../AUDIO_DESIGN.md#82-track-list
- ../../AUDIO_DESIGN.md#81-channel-and-stem-conventions-every-song
- ../../LEVEL_DESIGN.md#52-tue-muckleford-high-street-districthigh_street

## Roadmap tasks covered

- `Compose the three songs and three jingles above. Listening review by the project lead (see R-04). (mus.high_street)`
- `Exit criterion: Title + Puddle Lane + High Street songs with adaptive stems. (High Street)`
