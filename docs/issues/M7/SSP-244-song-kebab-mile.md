---
id: SSP-244
title: "Compose and render mus.kebab_mile \"Kebab O'Clock\" with adaptive stems"
milestone: M7
status: todo
type: asset
estimate: M
labels: [type:asset, area:audio, area:assets, size:M]
depends_on: [SSP-166, SSP-167, SSP-212]
blocks: [SSP-246]
---

# SSP-244: Compose and render mus.kebab_mile "Kebab O'Clock" with adaptive stems

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** asset · **Size:** M · **Areas:** audio, assets

## Summary

Write the Saturday night district song as a tracker song JSON, render its stems, and get the lead's listening approval.

## Context

Spec (AUDIO_DESIGN §8.2):
- `mus.kebab_mile`, "Kebab O'Clock", Sat, Kebab Mile (night).
- 118 BPM, C minor, 4/4 late-night disco / UK garage shuffle.
- Octave-jumping FM disco bass.
- Offbeat open hats.
- A lead with "wobbly" pitch bends.
- pulse2 plays minor-7th stabs.
- 32-bar loop (≈ 65 s).
Same conventions as every song:
- two contrasting 16-bar halves with a B-section in the base stem
- stems `{ base: [pulse2,tri,bass], drums: [noise], lead: [pulse1] }`, and pulse2 carries a two-bar lead motif
- channel ranges pulse1 C4–C7, pulse2 C3–C6, tri C2–C5, bass E1–E3
- −16 LUFS ±1 integrated, true peak ≤ −1 dBTP
Source: `assets-src/audio/music/mus.kebab_mile.song.json`. Outputs: Ogg Opus + M4A stems under `public/assets/audio/music/` (M5 naming), a music.json entry, and WAV hashes in asset-hashes.json. Evidence: `node tools/audio/render-music.ts --only mus.kebab_mile --report`.
Rating guard (GDD §3): night revellers are "singing", never drunk on screen. The "a bit tipsy" / "had a few" wording in AUDIO_DESIGN is internal mood direction only and must not appear in any player-facing text or song notes that ship. If M6 left district.kebab_mile on the mus.workshop fallback, switch it to this song.

## Scope

- Author the kebab_mile song JSON to the spec
- Render, then commit source plus generated outputs
- Generate the --report evidence and Read it
- Map district.kebab_mile to mus.kebab_mile
- Lead listening pass recorded in the PR

## Out of scope

- Other songs
- amb.night_town changes

## Acceptance criteria

- [ ] Song lint passes
- [ ] Summed mix at −16 ±1 LUFS integrated, true peak ≤ −1 dBTP (metrics.json)
- [ ] 32-bar loop at 118 BPM (≈ 65 s, within 20%)
- [ ] Report PNGs were opened with Read: no clicks or aliasing
- [ ] npm run assets:verify passes
- [ ] Saturday plays mus.kebab_mile with adaptive drums and lead
- [ ] Lead approval recorded in the PR

## Verification

- npm run audio
- node tools/audio/render-music.ts --only mus.kebab_mile --report
- npm run assets:verify
- npm test

## Dependencies

**Depends on:**

- [SSP-166](../M5/SSP-166-tracker-core.md) Implement the render-music.ts tracker core: song parsing, instruments, notes, effects
- [SSP-167](../M5/SSP-167-render-music-stems-encode.md) Render music stems, normalise loudness, lint songs, encode and write music.json
- [SSP-212](../M6/SSP-212-district-kebab-mile.md) Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden

**Blocks:**

- [SSP-246](SSP-246-audio-complete-audit.md) Verify all 9 songs and 6 jingles ship, and run the full-playthrough mix pass

## References

- ../../AUDIO_DESIGN.md#82-track-list
- ../../AUDIO_DESIGN.md#81-channel-and-stem-conventions-every-song
- ../../AUDIO_DESIGN.md#105-song-lint-part-of-npm-run-audio
- ../../AUDIO_DESIGN.md#43-loudness-targets
- ../../AUDIO_DESIGN.md#115-review-evidence-what-claude-reads-before-accepting-audio
- ../../LEVEL_DESIGN.md#56-sat-kebab-mile-districtkebab_mile
- ../../GDD.md#3-audience-platforms-and-rating

## Roadmap tasks covered

- Remaining songs: `mus.promenade`, `mus.kebab_mile`, `mus.civic_quarter`. Remaining jingles: `jng.trophy`. (mus.kebab_mile)
