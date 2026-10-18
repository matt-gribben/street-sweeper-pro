---
id: SSP-246
title: "Verify all 9 songs and 6 jingles ship, and run the full-playthrough mix pass"
milestone: M7
status: todo
type: test
estimate: M
labels: [type:test, area:audio, area:test, area:assets, size:M]
depends_on: [SSP-243, SSP-244, SSP-245, SSP-169, SSP-170, SSP-171, SSP-172, SSP-173, SSP-194, SSP-195, SSP-218, SSP-219, SSP-301]
blocks: [SSP-253, SSP-254, SSP-264, SSP-267]
---

# SSP-246: Verify all 9 songs and 6 jingles ship, and run the full-playthrough mix pass

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** test · **Size:** M · **Areas:** audio, test, assets

## Summary

Prove the 'Audio complete' check: add an automated test that every mus.* and jng.* ID has a source, a music.json entry and encoded files; finish any songs still owed from M6; and do the M7 mix pass on a full playthrough.

## Context

Required IDs:
- 9 songs: mus.title, mus.workshop, mus.puddle_lane, mus.high_street, mus.gasworks, mus.conker_hill, mus.promenade, mus.kebab_mile, mus.civic_quarter.
- 6 jingles: jng.shift_start (transposed per district key, variants in one sprite file), jng.tally, jng.star, jng.sacked, jng.towed, jng.trophy.
Where they live: audio IDs are NOT in assets-src/manifest.json, which covers image assets. Sources are `assets-src/audio/music/<id>.song.json` (AUDIO_DESIGN §10.1). Outputs are Ogg Opus + M4A in `public/assets/audio/music/` plus entries in `public/assets/audio/music.json` (§11.1, §12.1). WAV hashes are in `public/assets/asset-hashes.json`.
ROADMAP M6: any district without its song at M6 exit falls back to mus.workshop, and the song is owed to M7. If mus.gasworks ("Drizzle Dub", 76 half-time / written at 152, A minor with Dorian colour, dub delay send dotted 1/8 feedback 0.35) or mus.conker_hill ("Conker Crunch", 104 dotted crotchet, 6/8 jig) is missing, author it here to its AUDIO_DESIGN §8.2 row. If both are missing, split one into its own issue rather than exceed L.
Mix pass targets (§4.3): in-game mix at default buses during a busy shift −18 to −14 LUFS momentary, with the limiter engaged less than 1% of the time (SSP-048 meter).
Budgets (§12.3): decoded audio resident ≤ 64 MB, Opus download ≈ 20 MB for all songs and jingles and ≈ 0.6 MB SFX. Measure decoded memory as the sum of live AudioBuffer sizes (length × channels × 4 bytes), shown in the dev panel or logged, at the peak point (district song + mus.workshop + SFX).
OPEN A6 (AUDIO_DESIGN §15.2, owned by the M7 UX review): is the gamepad-only "Click or press a key for sound" prompt acceptable, or should the Title require one click? Ask the lead and record the decision.

UPDATE: SSP-173 delivers the F1 SSP-048 loudness meter (BS.1770 momentary LUFS, max since reset, limiter-engaged %) with acceptance criteria. Use its readouts for the −18 to −14 LUFS and < 1% limiter checks.

CORRECTION (supersedes the UPDATE line above): the F1 SSP-048 loudness meter (BS.1770 momentary LUFS, max since reset, limiter-engaged %) is delivered by SSP-301, not SSP-173. Use its readouts for the −18 to −14 LUFS and < 1% limiter checks.

## Scope

- Unit test (tests/unit/): the set of mus.*/jng.* song sources equals the 15 IDs above, and each has a music.json entry and both .ogg and .m4a outputs
- Remove every mus.workshop district fallback, so each district maps to its own song (unit test over districts data)
- Author any owed M6 songs (or split them out)
- Full Mon→Sun playthrough mix pass with the SSP-048 meter. Adjust gain trims only in source JSON, then re-render.
- Measure decoded-memory peak and download size, and record them in the PR
- Record the A6 decision in AUDIO_DESIGN §15.2

## Out of scope

- New SFX
- Mobile memory checks (M8)

## Acceptance criteria

- [ ] The new unit test passes and lists exactly 9 mus.* and 6 jng.* IDs, all rendered
- [ ] No district maps to the mus.workshop fallback (unit test over districts data)
- [ ] npm run assets:verify passes with all WAV hashes
- [ ] Mix-pass notes in the PR show −18 to −14 LUFS momentary on a busy shift and limiter engagement < 1%
- [ ] Decoded audio resident peak ≤ 64 MB, measured and recorded
- [ ] A6 decision recorded in AUDIO_DESIGN §15.2

## Verification

- npm test
- npm run audio
- npm run assets:verify
- Manual: full playthrough in npm run dev with the F1 SSP-048 loudness meter

## Dependencies

**Depends on:**

- [SSP-243](SSP-243-song-promenade.md) Compose and render mus.promenade "Seagull Surf" with adaptive stems
- [SSP-244](SSP-244-song-kebab-mile.md) Compose and render mus.kebab_mile "Kebab O'Clock" with adaptive stems
- [SSP-245](SSP-245-song-civic-trophy.md) Compose mus.civic_quarter "Clipboard March" and the jng.trophy jingle
- [SSP-169](../M5/SSP-169-song-puddle-lane.md) Compose mus.puddle_lane 'Milk Float Shuffle' with base, drums and lead stems
- [SSP-170](../M5/SSP-170-song-title.md) Compose mus.title 'Brush With Greatness' with base, drums and lead stems
- [SSP-171](../M5/SSP-171-song-high-street.md) Compose mus.high_street 'Window Shopping' with base, drums and lead stems
- [SSP-172](../M5/SSP-172-jingles-vs.md) Compose jng.shift_start, jng.tally and jng.sacked jingles
- [SSP-173](../M5/SSP-173-mixer-buses-ducking.md) Implement mixer.ts: bus graph, limiter, settings levels and ducking engine
- [SSP-194](../M6/SSP-194-audio-mus-workshop.md) Compose mus.workshop 'Tea Break' and implement the mus.workshop fallback rule
- [SSP-195](../M6/SSP-195-audio-jingles-star-towed.md) Compose jng.star and jng.towed and wire them to the tally and TOWED end state
- [SSP-218](../M6/SSP-218-audio-mus-gasworks.md) Compose mus.gasworks 'Drizzle Dub' with adaptive stems and dub delay send
- [SSP-219](../M6/SSP-219-audio-mus-conker-hill.md) Compose mus.conker_hill 'Conker Crunch' 6/8 jig with adaptive stems
- [SSP-301](../M5/SSP-301-loudness-meter.md) Add the BS.1770 momentary loudness meter and limiter-engagement readout to the F1 dev panel

**Blocks:**

- [SSP-253](SSP-253-browser-scaling-qa.md) Run cross-browser, scaling and storage-blocked verification for 1.0
- [SSP-254](SSP-254-release-1-0.md) Push 1.0 to itch.io with butler and tag v1.0.0 and m7
- [SSP-264](../M8/SSP-264-ios-audio-unlock.md) Harden unlock.ts for iOS Safari: touchend unlock and background resume
- [SSP-267](../M8/SSP-267-mobile-perf-check.md) Measure frame time and audio memory on a mid-range phone; record M8 budget

## References

- ../../AUDIO_DESIGN.md#82-track-list
- ../../AUDIO_DESIGN.md#83-jingles
- ../../AUDIO_DESIGN.md#101-file
- ../../AUDIO_DESIGN.md#111-pipeline
- ../../AUDIO_DESIGN.md#43-loudness-targets
- ../../AUDIO_DESIGN.md#123-budgets
- ../../AUDIO_DESIGN.md#151-plan
- ../../AUDIO_DESIGN.md#152-open-questions
- ../../ROADMAP.md#m7-10-web-release

## Roadmap tasks covered

- Exit check: Audio complete — all `mus.*` and `jng.*` IDs exist, rendered and verified.
- `Exit criterion: All songs.`
- Remaining songs: `mus.promenade`, `mus.kebab_mile`, `mus.civic_quarter`. Remaining jingles: `jng.trophy`. (completeness verification)
