---
id: SSP-245
title: "Compose mus.civic_quarter \"Clipboard March\" and the jng.trophy jingle"
milestone: M7
status: todo
type: asset
estimate: L
labels: [type:asset, area:audio, area:assets, size:L]
depends_on: [SSP-166, SSP-170, SSP-176, SSP-215, SSP-216, SSP-192]
blocks: [SSP-246]
---

# SSP-245: Compose mus.civic_quarter "Clipboard March" and the jng.trophy jingle

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** asset · **Size:** L · **Areas:** audio, assets

## Summary

Write the Sunday finale song and the Tidy Town Trophy jingle. Both reprise the mus.title hook, so they are done together, and the week ends where it began.

## Context

mus.civic_quarter (AUDIO_DESIGN §8.2):
- "Clipboard March", Sun, Civic Quarter (inspection).
- 120 BPM, E♭ major, 2/4 march written in 4/4 rows.
- Official, fussy and grand: a reprise of the `mus.title` ("Brush With Greatness", 132 BPM, B♭ major) motif in a stiffer, "inspected" arrangement.
- pulse2 and tri play trumpet-style fanfare thirds.
- Parade-ground rudiment snare.
- Clear quotes of the title hook.
- 4-bar intro + 32-bar loop (≈ 72 s).
- Standard stems, pulse2 motif rule, −16 LUFS ±1, true peak ≤ −1 dBTP.
jng.trophy (AUDIO_DESIGN §8.3):
- Plays when the Tidy Town Trophy is awarded (Sunday win). 9.0 s, B♭ major.
- A full brass-band reprise of the "Brush With Greatness" hook including the drum (noise) channel, ending on a held tonic with a cymbal-noise swell.
- Jingles are single-stem songs (`stems: { base: [all five channels] }`). They never loop: no `loopRow`, and the lint fails if one is set. They play on the jingle bus at −15 LUFS short-term at the loudest point.
- Any jng.* ducks music to −∞ (§4.5).
Tally flow (§8.4): on a win, TallyScene plays jng.trophy instead of the normal tally jingles. Credits then play once after jng.trophy on the first win (SSP-249).
Sources: `assets-src/audio/music/mus.civic_quarter.song.json` and `jng.trophy.song.json`. Outputs: Ogg Opus + M4A under `public/assets/audio/music/` (M5 naming), music.json entries, WAV hashes.
R-04: listening review with the lead for both.

## Scope

- Author the civic_quarter song JSON quoting the mus.title hook
- Author the jng.trophy jingle JSON (single stem, no loop)
- Render both, then commit sources plus generated outputs
- Generate the --report evidence for both and Read it
- Map district.civic_quarter to mus.civic_quarter, and wire jng.trophy into the Trophy tally path if M6 left a placeholder
- Lead listening pass recorded in the PR

## Out of scope

- CreditsScene (SSP-249)
- Changes to mus.title

## Acceptance criteria

- [ ] Song lint passes for both, and jng.trophy has no loopRow
- [ ] mus.civic_quarter: 4-bar intro + 32-bar loop at 120 BPM (≈ 72 s within 20%), −16 ±1 LUFS, true peak ≤ −1 dBTP
- [ ] jng.trophy: 9.0 s ±20%, −15 LUFS short-term at its loudest (metrics.json)
- [ ] Report PNGs were opened with Read: no clicks or aliasing
- [ ] npm run assets:verify passes
- [ ] Unit test on the audio director: the Trophy-win tally cue is jng.trophy and ducks music to −∞
- [ ] Lead approval recorded for both

## Verification

- npm run audio
- node tools/audio/render-music.ts --only mus.civic_quarter --report
- node tools/audio/render-music.ts --only jng.trophy --report
- npm run assets:verify
- npm test
- npm run test:e2e

## Dependencies

**Depends on:**

- [SSP-166](../M5/SSP-166-tracker-core.md) Implement the render-music.ts tracker core: song parsing, instruments, notes, effects
- [SSP-170](../M5/SSP-170-song-title.md) Compose mus.title 'Brush With Greatness' with base, drums and lead stems
- [SSP-176](../M5/SSP-176-sfx-event-wiring.md) Wire sim events to sfx cues through a pure audio director
- [SSP-215](../M6/SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-216](../M6/SSP-216-sunday-finale-trophy.md) Implement the Sunday Inspection Score and the Tidy Town Trophy award
- [SSP-192](../M6/SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden

**Blocks:**

- [SSP-246](SSP-246-audio-complete-audit.md) Verify all 9 songs and 6 jingles ship, and run the full-playthrough mix pass

## References

- ../../AUDIO_DESIGN.md#82-track-list
- ../../AUDIO_DESIGN.md#83-jingles
- ../../AUDIO_DESIGN.md#84-scene--audio-map
- ../../AUDIO_DESIGN.md#45-ducking
- ../../AUDIO_DESIGN.md#43-loudness-targets
- ../../AUDIO_DESIGN.md#105-song-lint-part-of-npm-run-audio
- ../../GDD.md#128-the-week-finale
- ../../LEVEL_DESIGN.md#57-sun-civic-quarter-districtcivic_quarter-finale

## Roadmap tasks covered

- Remaining songs: `mus.promenade`, `mus.kebab_mile`, `mus.civic_quarter`. Remaining jingles: `jng.trophy`. (mus.civic_quarter, jng.trophy)
