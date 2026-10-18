---
id: SSP-194
title: "Compose mus.workshop 'Tea Break' and implement the mus.workshop fallback rule"
milestone: M6
status: todo
type: asset
estimate: M
labels: [type:asset, area:audio, area:assets, size:M]
depends_on: [SSP-166, SSP-167, SSP-177, SSP-178, SSP-173, SSP-025, SSP-295]
blocks: [SSP-196, SSP-218, SSP-219, SSP-246]
---

# SSP-194: Compose mus.workshop 'Tea Break' and implement the mus.workshop fallback rule

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** asset · **Size:** M · **Areas:** audio, assets

## Summary

Author the hub and Free Sweep song, and make it the fallback for any district whose own song is not rendered yet, so every M6 district has music.

## Context

Track (AUDIO §8.2): mus.workshop 'Tea Break', 92 BPM, F major, 4/4 gentle bossa / light-music lounge. Pulse2 plays jazzy 6th and 9th arpeggios, tri a walking bass and pulse1 a lazy vibrato melody; drums are rim-click and shaker. It is a 32-bar loop (~83 s) written as two contrasting 16-bar halves. Stems: base [pulse2, tri, bass], drums [noise], lead [pulse1]; pulse2 carries a two-bar lead motif. Uses (AUDIO §8.4): WeekMapScene base + lead; WorkshopScene all stems; TallyScene bed of base at -6 dB after jingles; Free Sweep (§9.4) base always, drums at combo x3+ (same hold and cut rules), and lead on every other loop counted from the song clock. Fallback (ROADMAP M6): any district without its song at M6 exit falls back to mus.workshop. mus.promenade, mus.kebab_mile and mus.civic_quarter are owed to M7. Proposal to note in AUDIO_DESIGN: in a timed shift the fallback uses the standard adaptive rules (drums at x3, lead under 60 s). Pipeline: assets-src/audio/music/workshop.song.json -> tools/audio/render-music.ts -> WAV stems -> Opus 96 kbps / AAC-LC 128 kbps with -bitexact -map_metadata -1. Loop points go in public/assets/audio/music.json, and song lint runs inside npm run audio. assets:verify compares WAV hashes (encoded files only if D-11 found ffmpeg deterministic). R-04: the project lead does a listening review before merge (a human gate); attach the AUDIO §11.5 review evidence.

## Scope

- assets-src/audio/music/workshop.song.json and its rendered outputs
- src/audio/music.ts: fall back to mus.workshop when a level's `music` ID is missing from music.json
- Free Sweep stem rule (lead every other loop) in the music state machine, behind a mode flag
- Unit tests for fallback selection and the every-other-loop lead rule
- AUDIO_DESIGN note on the fallback's adaptive behaviour

## Out of scope

- mus.promenade, mus.kebab_mile, mus.civic_quarter (M7)
- Other M6 songs (separate issues)

## Acceptance criteria

- [ ] npm run audio renders mus.workshop with base, drums and lead stems of equal length and passes song lint
- [ ] public/assets/audio/music.json contains loop points for mus.workshop
- [ ] Unit test: a level whose music ID is absent plays mus.workshop
- [ ] Unit test: in Free Sweep mode the lead stem is on for loops 1, 3, 5... and off for 2, 4, 6... (or the documented parity)
- [ ] assets:verify passes (WAV hashes)
- [ ] The project lead's listening approval is recorded in the PR

## Verification

- npm run audio
- npm run assets:verify
- npm test
- npm run typecheck && npm run lint

## Dependencies

**Depends on:**

- [SSP-166](../M5/SSP-166-tracker-core.md) Implement the render-music.ts tracker core: song parsing, instruments, notes, effects
- [SSP-167](../M5/SSP-167-render-music-stems-encode.md) Render music stems, normalise loudness, lint songs, encode and write music.json
- [SSP-177](../M5/SSP-177-music-state-machine.md) Implement the pure adaptive-music state machine for drums and lead stems
- [SSP-178](../M5/SSP-178-music-player.md) Implement music.ts: sample-locked stems, loops, jingles and scene music
- [SSP-173](../M5/SSP-173-mixer-buses-ducking.md) Implement mixer.ts: bus graph, limiter, settings levels and ducking engine
- [SSP-025](../M0/SSP-025-pipeline-determinism-spikes.md) Measure cross-platform PNG identity and ffmpeg encode determinism (D-12, D-11)
- [SSP-295](../M5/SSP-295-vertical-slice-gate.md) Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR

**Blocks:**

- [SSP-196](SSP-196-free-sweep.md) Add Free Sweep mode: untimed, no complaints, Pause -> Finish Sweep, cut-down Mercury
- [SSP-218](SSP-218-audio-mus-gasworks.md) Compose mus.gasworks 'Drizzle Dub' with adaptive stems and dub delay send
- [SSP-219](SSP-219-audio-mus-conker-hill.md) Compose mus.conker_hill 'Conker Crunch' 6/8 jig with adaptive stems
- [SSP-246](../M7/SSP-246-audio-complete-audit.md) Verify all 9 songs and 6 jingles ship, and run the full-playthrough mix pass

## References

- ../../AUDIO_DESIGN.md#82-track-list
- ../../AUDIO_DESIGN.md#84-scene--audio-map
- ../../AUDIO_DESIGN.md#94-free-sweep-and-tea-break
- ../../AUDIO_DESIGN.md#10-tracker-song-format
- ../../AUDIO_DESIGN.md#115-review-evidence-what-claude-reads-before-accepting-audio
- ../../ROADMAP.md#6-risk-register

## Roadmap tasks covered

- Audio: `mus.workshop` (Free Sweep, Workshop and the fallback track) ... Any district without its song at M6 exit falls back to `mus.workshop`, and the song is owed to M7.
