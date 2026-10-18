---
id: SSP-243
title: "Compose and render mus.promenade \"Seagull Surf\" with adaptive stems"
milestone: M7
status: todo
type: asset
estimate: M
labels: [type:asset, area:audio, area:assets, size:M]
depends_on: [SSP-166, SSP-167, SSP-177, SSP-209]
blocks: [SSP-246]
---

# SSP-243: Compose and render mus.promenade "Seagull Surf" with adaptive stems

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** asset · **Size:** M · **Areas:** audio, assets

## Summary

Write the Friday district song as a tracker song JSON, render its base/drums/lead stems through the deterministic pipeline, and get the lead's listening approval.

## Context

Spec (AUDIO_DESIGN §8.2):
- `mus.promenade`, "Seagull Surf", Fri, The Promenade (golden hour, gusts).
- 148 BPM, E major, 4/4 surf-rock.
- pulse1 plays a "tremolo-picked" lead (32nd-note volume retrigs).
- pulse2 plays reverby-sounding echo arpeggios.
- Driving floor-tom noise kit.
- A seagull-cry pitch bend in the lead every 16 bars.
- 32-bar loop (≈ 52 s).
Every district song (§8.1, §8.2): two contrasting 16-bar halves with a B-section variation in the base stem, to fight fatigue over the 3–4 loops of a 240 s shift. Stems: `{ base: ["pulse2","tri","bass"], drums: ["noise"], lead: ["pulse1"] }`. pulse2 must carry a two-bar lead motif so the base stem alone is recognisable. Channel ranges: pulse1 C4–C7, pulse2 C3–C6, tri C2–C5, bass E1–E3.
Loudness (§4.3): full mix −16 LUFS integrated ±1, true peak ≤ −1 dBTP. Normalisation is applied equally to all stems.
Source: `assets-src/audio/music/mus.promenade.song.json` (format AUDIO_DESIGN §10).
Generated outputs, committed with the source: Ogg Opus + M4A stems under `public/assets/audio/music/` (follow the M5 stem file naming), a `public/assets/audio/music.json` entry with loop points, and WAV hashes in `public/assets/asset-hashes.json`.
Evidence: `node tools/audio/render-music.ts --only mus.promenade --report` writes the roll.png, spec.png, wave.png, metrics.json and index.html to build/audio-report/. Read the PNGs.
Risk R-04: the lead listens before merge. If M6 left district.promenade on the `mus.workshop` fallback, switch it to this song.
The 'Used in' and mood notes are internal. Never name real songs or artists in any source.

## Scope

- Author the promenade song JSON to the spec above
- npm run audio to render, then commit source plus generated outputs together
- Generate the --report evidence and Read every PNG
- Map district.promenade to mus.promenade (remove any fallback)
- Lead listening pass recorded in the PR (AUDIO_DESIGN §11.5 checklist)

## Out of scope

- Other songs
- Synth or renderer changes, unless a bug is found (separate issue)

## Acceptance criteria

- [ ] Song lint passes (AUDIO_DESIGN §10.5): in key, in range, stems cover each channel exactly once, loop is a whole number of bars
- [ ] metrics.json shows −16 ±1 LUFS integrated and true peak ≤ −1 dBTP for the summed mix
- [ ] The loop is 32 bars at 148 BPM (≈ 52 s, within 20%)
- [ ] Roll, spectrogram and waveform were opened with Read: no clicks, no aliasing
- [ ] npm run assets:verify passes (WAV hashes)
- [ ] In-game, Friday plays mus.promenade, with drums at ×3 and lead under 60 s
- [ ] The lead's approval is recorded in the PR

## Verification

- npm run audio
- node tools/audio/render-music.ts --only mus.promenade --report
- npm run assets:verify
- npm test

## Dependencies

**Depends on:**

- [SSP-166](../M5/SSP-166-tracker-core.md) Implement the render-music.ts tracker core: song parsing, instruments, notes, effects
- [SSP-167](../M5/SSP-167-render-music-stems-encode.md) Render music stems, normalise loudness, lint songs, encode and write music.json
- [SSP-177](../M5/SSP-177-music-state-machine.md) Implement the pure adaptive-music state machine for drums and lead stems
- [SSP-209](../M6/SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)

**Blocks:**

- [SSP-246](SSP-246-audio-complete-audit.md) Verify all 9 songs and 6 jingles ship, and run the full-playthrough mix pass

## References

- ../../AUDIO_DESIGN.md#82-track-list
- ../../AUDIO_DESIGN.md#81-channel-and-stem-conventions-every-song
- ../../AUDIO_DESIGN.md#10-tracker-song-format
- ../../AUDIO_DESIGN.md#105-song-lint-part-of-npm-run-audio
- ../../AUDIO_DESIGN.md#43-loudness-targets
- ../../AUDIO_DESIGN.md#115-review-evidence-what-claude-reads-before-accepting-audio
- ../../LEVEL_DESIGN.md#55-fri-the-promenade-districtpromenade
- ../../ROADMAP.md#6-risk-register

## Roadmap tasks covered

- Remaining songs: `mus.promenade`, `mus.kebab_mile`, `mus.civic_quarter`. Remaining jingles: `jng.trophy`. (mus.promenade)
