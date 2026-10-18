---
id: SSP-218
title: "Compose mus.gasworks 'Drizzle Dub' with adaptive stems and dub delay send"
milestone: M6
status: todo
type: asset
estimate: M
labels: [type:asset, area:audio, area:assets, size:M]
depends_on: [SSP-194, SSP-166, SSP-167]
blocks: [SSP-233, SSP-246]
---

# SSP-218: Compose mus.gasworks 'Drizzle Dub' with adaptive stems and dub delay send

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** asset · **Size:** M · **Areas:** audio, assets

## Summary

Author Wednesday's song so Gasworks stops using the mus.workshop fallback.

## Context

AUDIO §8.2: mus.gasworks 'Drizzle Dub', 76 BPM half-time feel written at 152, A minor with Dorian colour (F# allowed), 4/4 one-drop. Damp but wry: a deep, round dub FM bass; pulse2 skanks on the off-beats; a dub delay send (dotted 1/8, feedback 0.35) on pulse2 and the snare; a sparse, melodica-like lead. 24-bar loop (~76 s). Stems: base [pulse2, tri, bass], drums [noise], lead [pulse1]; pulse2 carries a two-bar lead motif so the base stem works alone. Fight fatigue with contrasting halves and a B-section variation in the base stem. Adaptive rules: drums at combo x3+, lead under 60 s. If the tracker (tools/audio/render-music.ts, AUDIO §10) has no send/delay effect, add a deterministic one to the offline synth and to song lint, and document it in AUDIO §10. Render to Opus 96 / AAC 128 with loop points in music.json. The project lead does a listening review (R-04).

## Scope

- assets-src/audio/music/gasworks.song.json and rendered stems
- Deterministic delay-send support in the tracker if missing, with a unit test
- gasworks.level.json music field resolves to mus.gasworks

## Out of scope

- Other songs

## Acceptance criteria

- [ ] npm run audio renders three equal-length stems and passes song lint
- [ ] Rendering twice gives identical WAV hashes (assets:verify)
- [ ] Gasworks no longer falls back to mus.workshop (unit test on music resolution)
- [ ] The lead's listening approval is recorded

## Verification

- npm run audio
- npm run assets:verify
- npm test

## Dependencies

**Depends on:**

- [SSP-194](SSP-194-audio-mus-workshop.md) Compose mus.workshop 'Tea Break' and implement the mus.workshop fallback rule
- [SSP-166](../M5/SSP-166-tracker-core.md) Implement the render-music.ts tracker core: song parsing, instruments, notes, effects
- [SSP-167](../M5/SSP-167-render-music-stems-encode.md) Render music stems, normalise loudness, lint songs, encode and write music.json

**Blocks:**

- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag
- [SSP-246](../M7/SSP-246-audio-complete-audit.md) Verify all 9 songs and 6 jingles ship, and run the full-playthrough mix pass

## References

- ../../AUDIO_DESIGN.md#82-track-list
- ../../AUDIO_DESIGN.md#81-channel-and-stem-conventions-every-song
- ../../AUDIO_DESIGN.md#10-tracker-song-format
- ../../AUDIO_DESIGN.md#9-adaptive-music

## Roadmap tasks covered

- Audio: ... `mus.gasworks` ...
