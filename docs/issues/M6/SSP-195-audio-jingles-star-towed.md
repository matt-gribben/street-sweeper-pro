---
id: SSP-195
title: "Compose jng.star and jng.towed and wire them to the tally and TOWED end state"
milestone: M6
status: todo
type: asset
estimate: S
labels: [type:asset, area:audio, area:assets, size:S]
depends_on: [SSP-192, SSP-166, SSP-167, SSP-173]
blocks: [SSP-233, SSP-246]
---

# SSP-195: Compose jng.star and jng.towed and wire them to the tally and TOWED end state

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** asset · **Size:** S · **Areas:** audio, assets

## Summary

Add the two M6 jingles: the star-stamp fanfare on the Mercury, and the tow-truck jingle when Bessie's Dignity reaches 0.

## Context

AUDIO §8.3: jingles are single-stem tracker songs (stems: base = all five channels); they play on the jingle bus and never loop. jng.star: 0.8 s, F major, a bright 3-note fanfare. Star 1 plays at the root, star 2 at +4 semitones and star 3 at +7, by playback-rate transposition, as each star stamps onto the tally page. jng.towed: 3.5 s chromatic slide: a tow-truck 'winch' (pulse with a rising duty sweep) and a deflating tuba slide, ending on a dry 'honk'. On TOWED the stems cut immediately and then the jingle plays (AUDIO §9.3). Music ducks under jingles (mixer). Render through render-music.ts; WAV hashes are verified. The project lead does a listening review (R-04).

## Scope

- Song sources for jng.star and jng.towed (file names per the existing convention) and their rendered outputs
- TallyScene: play jng.star per star with +0/+4/+7 transposition
- TOWED flow: cut stems, then play jng.towed

## Out of scope

- jng.trophy (M7)

## Acceptance criteria

- [ ] npm run audio renders both jingles, each within 0.1 s of its target length (0.8 s and 3.5 s)
- [ ] Unit test: the star playback rates are 1, 2^(4/12) and 2^(7/12)
- [ ] On a TOWED fixture the music stems stop before jng.towed starts (music state machine unit test)
- [ ] assets:verify passes, and the lead's listening approval is recorded

## Verification

- npm run audio
- npm run assets:verify
- npm test

## Dependencies

**Depends on:**

- [SSP-192](SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-166](../M5/SSP-166-tracker-core.md) Implement the render-music.ts tracker core: song parsing, instruments, notes, effects
- [SSP-167](../M5/SSP-167-render-music-stems-encode.md) Render music stems, normalise loudness, lint songs, encode and write music.json
- [SSP-173](../M5/SSP-173-mixer-buses-ducking.md) Implement mixer.ts: bus graph, limiter, settings levels and ducking engine

**Blocks:**

- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag
- [SSP-246](../M7/SSP-246-audio-complete-audit.md) Verify all 9 songs and 6 jingles ship, and run the full-playthrough mix pass

## References

- ../../AUDIO_DESIGN.md#83-jingles
- ../../AUDIO_DESIGN.md#93-details
- ../../AUDIO_DESIGN.md#84-scene--audio-map

## Roadmap tasks covered

- Audio: ... `jng.star`, `jng.towed` ...
