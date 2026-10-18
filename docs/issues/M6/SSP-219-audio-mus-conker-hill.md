---
id: SSP-219
title: "Compose mus.conker_hill 'Conker Crunch' 6/8 jig with adaptive stems"
milestone: M6
status: todo
type: asset
estimate: M
labels: [type:asset, area:audio, area:assets, size:M]
depends_on: [SSP-194, SSP-166, SSP-177]
blocks: [SSP-233, SSP-246]
---

# SSP-219: Compose mus.conker_hill 'Conker Crunch' 6/8 jig with adaptive stems

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** asset · **Size:** M · **Areas:** audio, assets

## Summary

Author Thursday's song so Conker Hill stops using the mus.workshop fallback.

## Context

AUDIO §8.2: mus.conker_hill 'Conker Crunch', 104 BPM (dotted crotchet), E minor -> G major chorus, a 6/8 jig and a leafy folk romp. Pulse1 plays a tin-whistle melody with ornamented triplets; tri a drone fifth; noise a bodhrán-ish kick and brush pattern. 32-bar loop (~55 s) as two contrasting 16-bar halves. Stems: base [pulse2, tri, bass], drums [noise], lead [pulse1]. If the tracker cannot express 6/8 (row grouping, beat length), add it deterministically and extend song lint (AUDIO §10). Adaptive rules are standard; beat-aligned drum fades need the correct beat length in 6/8. The project lead does a listening review.

## Scope

- assets-src/audio/music/conker_hill.song.json and rendered stems
- 6/8 metre support in the tracker and in the music state machine's beat timing, if missing

## Out of scope

- Other songs

## Acceptance criteria

- [ ] npm run audio renders three equal-length stems and passes song lint
- [ ] Unit test: the drums fade-in starts on a 6/8 beat boundary
- [ ] assets:verify passes; Conker Hill resolves to mus.conker_hill
- [ ] The lead's listening approval is recorded

## Verification

- npm run audio
- npm run assets:verify
- npm test

## Dependencies

**Depends on:**

- [SSP-194](SSP-194-audio-mus-workshop.md) Compose mus.workshop 'Tea Break' and implement the mus.workshop fallback rule
- [SSP-166](../M5/SSP-166-tracker-core.md) Implement the render-music.ts tracker core: song parsing, instruments, notes, effects
- [SSP-177](../M5/SSP-177-music-state-machine.md) Implement the pure adaptive-music state machine for drums and lead stems

**Blocks:**

- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag
- [SSP-246](../M7/SSP-246-audio-complete-audit.md) Verify all 9 songs and 6 jingles ship, and run the full-playthrough mix pass

## References

- ../../AUDIO_DESIGN.md#82-track-list
- ../../AUDIO_DESIGN.md#10-tracker-song-format
- ../../AUDIO_DESIGN.md#93-details

## Roadmap tasks covered

- Audio: ... `mus.conker_hill` ...
