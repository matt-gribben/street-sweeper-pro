---
id: SSP-164
title: "Author the 10 prop, hazard, animal and people bark SFX sources"
milestone: M5
status: todo
type: asset
estimate: M
labels: [type:asset, area:audio, area:assets, size:M, vertical-slice]
depends_on: [SSP-161, SSP-162]
blocks: [SSP-168]
---

# SSP-164: Author the 10 prop, hazard, animal and people bark SFX sources

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** asset · **Size:** M · **Areas:** audio, assets · **Vertical slice**

## Summary

Write, render and review the JSON sources for the knockable/hazard sounds and the synthesised gibberish voice barks of animals and people, which carry the Charming Chaos pillar.

## Context

AUDIO_DESIGN §5.4. Columns: engine | variants | jitter | bus | priority | voices/cooldown ms. The `N + named` forms use the mixed-variant `count` form documented in AUDIO_DESIGN §5.2 by issue SSP-161.

**Props and hazards:**
- `cone_knock`: zzfx | `cone`, `a_board`ᴺ, `trolley`ᴺ, `box`ᴺ | 50 | sfx | 2 | 3/60 | cone = hollow plastic bonk 520 Hz 120 ms; a_board = woody clack at −4 semitones; trolley = rattly wire noise grains 350 ms; box = plastic slap plus spill rattle.
- `bin_knock`: zzfx layers | `bin`, `burst`ᴺ | 40 | sfx | 3 | 2/100 | bin = 140 Hz plastic boom, lid clap at 80 ms, spill rattle, 500 ms; burst = wet plastic rip (fast HP sweep) plus 6 small taps.
- `splash`: zzfx | 3 + `soak`ᴺ, `refill`ᴺ | 60 | sfx | 3 | 2/150 | noise BP at 1.8 kHz, fast decay, seeded droplet pips, 400 ms; soak +3 dB with a longer tail; refill −9 dB and gurgly.

**Animals:**
- `cat_yowl`: jsfxr | 2 + `hiss`ᴺ | 80 | voice | 4 | 1/400 | yowl 'MRRROWW': square with heavy vibrato 600→1,100→500 Hz, 650 ms; hiss = HP noise 250 ms.
- `dog_bark`: jsfxr | 4 + `settle`ᴺ | 120 | voice | 4 | 2/250 | Yap: 70 ms square, drop 1.4 kHz→700 Hz, noise breath; settle = lower, rising 'wuff?'.
- `pigeon_flap`: zzfx | 3 | 70 | sfx | 2 | 2/300 | noise grains AM at 18 Hz, 600 ms, soft coo pip at the start.
- `seagull_squawk`: jsfxr | 3 | 90 | voice | 3 | 2/500 | falling sawtooth with an arpeggio stutter, 700 ms.

**People** (3–6 formant-ish square syllables with vibrato; never sampled speech; nothing pained or screaming):
- `ped_oi`: jsfxr | 6 + `cough`ᴺ, `tut`ᴺ, `huh`ᴺ | 60 | voice | 4 | 2/250 | 'Oi!' ≈ 330→440→260 Hz, 280 ms; cough = 3 noise bursts; tut = 2 dry clicks; huh = single rising blip.
- `granny_harrumph`: jsfxr | 3 + `whack`ᴺ | 40 | voice | 4 | 1/600 | Hmph: low nasal pulse, falling pitch, breathy tail, 400 ms, **preceded by 150 ms of rendered silence**; whack = noise thump + 200 Hz body.
- `kid_waah`: jsfxr | 2 | 50 | voice | 4 | 1/1000 | rising-then-falling square wail, wide vibrato, 1.1 s, starting ≈700 Hz.

Runtime bark pitch offsets are applied by the player, not baked in. Rating guard (PEGI 7, CLAUDE.md rule 11): no pain or scream sounds. Some of these (seagull, loose-dog barks, kids) are only triggered from M6, but **all must be rendered in M5** ('All `sfx.*` rendered').

Process: run `--report`, Read the evidence, get the lead's listening approval recorded in the PR.

## Scope

- 10 JSON sources under `assets-src/audio/sfx/` with the variants above
- Rendered outputs, sfx.json entries and WAV hashes committed
- Extend the source unit test (`tests/unit/audio/sfxSources.test.ts` or equivalent) for these IDs
- Review evidence read; lead listening sign-off

## Out of scope

- Renderer or schema changes (issue SSP-161)
- Bark pitch offsets per character and triggering (issue SSP-176)
- Captions (issue captions)

## Acceptance criteria

- [ ] All 10 files exist: cone_knock, bin_knock, splash, cat_yowl, dog_bark, pigeon_flap, seagull_squawk, ped_oi, granny_harrumph, kid_waah
- [ ] Bus is `voice` for cat_yowl, dog_bark, seagull_squawk, ped_oi, granny_harrumph and kid_waah, and `sfx` for the others (unit test)
- [ ] Named variants, variant counts, priority and voices/cooldown match the §5.4 table (unit test reading the JSON)
- [ ] granny_harrumph's `metrics.json` `variants` entries show leadingSilenceMs of 150 ±5 for every non-`whack` variant
- [ ] Durations are within 20% of the §5.4 targets (from `metrics.json` `variants`, listed in the PR)
- [ ] A second render produces no git diff; the PR has the §11.5 checklist ticked and the lead's approval

## Verification

- node tools/audio/render-sfx.ts --report
- Read build/audio-report/<name>.spec.png and <name>.wave.png for the 10 IDs
- npm test -- tests/unit/audio
- npm run assets:verify

## Dependencies

**Depends on:**

- [SSP-161](SSP-161-render-sfx-core.md) Implement render-sfx.ts: SFX JSON to WAV sprites, ffmpeg encodes and sfx.json
- [SSP-162](SSP-162-audio-review-report.md) Add --report review evidence: spectrograms, waveforms, metrics, listening page

**Blocks:**

- [SSP-168](SSP-168-audio-verify-coverage.md) Wire audio into assets:verify and add SFX coverage and reference tests

## References

- ../../AUDIO_DESIGN.md#54-full-sfx-list
- ../../AUDIO_DESIGN.md#12-tone-pillars-mapped-to-the-design-pillars
- ../../AUDIO_DESIGN.md#15-do-and-dont
- ../../AUDIO_DESIGN.md#115-review-evidence-what-claude-reads-before-accepting-audio

## Roadmap tasks covered

- Author all 32 SFX JSON sources, with variants and `pitchJitterCents`. (10 of 32: props, hazards, animals, people)
