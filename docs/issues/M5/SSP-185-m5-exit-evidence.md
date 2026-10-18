---
id: SSP-185
title: "Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR"
milestone: M5
status: todo
type: test
estimate: M
labels: [type:test, area:audio, area:test, area:docs, area:release, size:M, vertical-slice]
depends_on: [SSP-168, SSP-169, SSP-170, SSP-171, SSP-172, SSP-176, SSP-178, SSP-180, SSP-181, SSP-182, SSP-183, SSP-174, SSP-073, SSP-072, SSP-019, SSP-065, SSP-046, SSP-173, SSP-301]
blocks: [SSP-295]
---

# SSP-185: Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** test · **Size:** M · **Areas:** audio, test, docs, release · **Vertical slice**

## Summary

Gather evidence for every canonical M5 exit criterion, including an e2e run that shows the adaptive stems switching during a scripted Puddle Lane shift. Re-score the audio risks, answer the end-of-M5 open questions, and open the milestone-close PR for the lead's approval and the `m5` tag.

## Context

**Canonical exit:** 'All `sfx.*` rendered. Live engine, brush, spray and beeper synths. Mixer with ducking. Title + Puddle Lane + High Street songs with adaptive stems. Tally and sacked jingles.'

**Key proof** (ROADMAP §2): 'All `sfx.*` rendered; adaptive stems demonstrably switching.'

**Measurable checks → proofs:**
- All SFX → `sfxCoverage.test.ts`.
- Reproducible → `npm run assets:verify` (WAV hashes and audio JSON indexes; encoded files per D-11).
- Adaptive stems → music state machine unit tests.
- Pitch rise → sfx parameter function test.
- Live synths → Playwright OfflineAudioContext tests (engine pitch vs speed and load, brush vs RPM, beeper while reversing, spray loop while held).
- Codec choice → the Chromium + WebKit Playwright spec.

**Demonstration:** add an e2e spec (e.g. `tests/e2e/audioStems.spec.ts`) that drives a scripted Puddle Lane shift under `?test=1&seed=1` using `window.__ssp.step(n)` and the music-state test hook from SSP-178. It asserts Base → BaseDrums when the chain reaches 25 (×3), a cut on a penalty, and lead entry once ticks remaining < 3,600. Test mode uses a null mixer, so the assertion is on state and scheduled gains, not sound.

**The muted smoke** (`tests/e2e/smoke.spec.ts`) must pass with no console errors from `src/audio/` (AUDIO_DESIGN §14).

**Vertical-slice audio row** (ROADMAP §3.2): every `sfx.*` triggered in Puddle Lane; live engine, brush, spray and reverse-beeper synths; `mus.title`; `mus.puddle_lane` with adaptive drums and lead; `amb.town_morning`; `jng.shift_start`, `jng.tally`, `jng.sacked`. Confirm each in the PR.

**Housekeeping:**
- Re-score R-04 (music quality) and R-14 (ffmpeg determinism) in ROADMAP §6 (ROADMAP §9: re-scored at every milestone close).
- Answer AUDIO_DESIGN §15.2 A3 (mono stems too narrow?) with the lead, due at the end of M5.
- Confirm A2, A4 and A5 are recorded.
- Record the captions disposition (done in M5, or moved to M7 by the lead).
- Tick the M5 task checklist in ROADMAP.
- Collect links to every listening sign-off (32 SFX, 3 songs, 3 jingles, amb).
- Check the in-game mix against §4.3 (−18 to −14 LUFS momentary during a busy shift, limiter engaged < 1%) via the F1 SSP-048 meter, and note the reading.
- Run the CLAUDE.md §8 definition of done and report each item.

**Process** (ROADMAP §1 principle 6): the PR is titled `Close M5: Sound & Music`; it ticks each criterion with a link to its evidence. The git tag `m5` is applied after the lead approves. Do not tag without approval.

UPDATE: `__ssp.step(n)` and `state()` are bound to the World by SSP-046 (M1) and extended by SSP-065. SSP-173 delivers the F1 SSP-048 loudness meter (BS.1770 momentary LUFS and limiter engagement %). The vertical-slice gate (VS-1..VS-10) is the separate issue SSP-295, which depends on this one.

CORRECTION (supersedes the UPDATE line above): the BS.1770 momentary-LUFS meter and limiter-engaged % readout were split out of SSP-173 into SSP-301. Take the AUDIO_DESIGN §4.3 busy-shift reading (−18 to −14 LUFS momentary, limiter engaged < 1%) from that meter's F1 readout.

## Scope

- `tests/e2e/audioStems.spec.ts` (or similar) demonstrating stem switching via test hooks
- Run the full `npm run ci` plus the e2e and audio checks; collect the outputs
- Two consecutive `npm run audio` runs → zero diff
- Doc updates: ROADMAP §6 re-score, M5 checklist ticks, AUDIO_DESIGN §15.2 answers (A3; confirm A2, A4, A5)
- Evidence table in the Close M5 PR description

## Out of scope

- Fixing defects found (open follow-up issues instead, unless trivial)
- Vertical-slice gate acceptance (VS-1..VS-10), which is a separate gate after M5
- iOS device verification (M8)

## Acceptance criteria

- [ ] `npm run ci` exits 0
- [ ] `npm run audio` run twice leaves `git status --porcelain` empty
- [ ] The stems e2e spec passes and asserts BaseDrums at chain ≥ 25, a drums cut after a penalty, and lead with ticks remaining < 3,600
- [ ] `npm run test:e2e` passes in the chromium and webkit projects with no console errors from src/audio
- [ ] The PR description maps each of the 5 canonical exit clauses and 6 measurable checks to a passing test or recorded sign-off, with links
- [ ] ROADMAP §6 shows updated R-04 and R-14 scores with notes, and AUDIO_DESIGN §15.2 A3 has a recorded answer
- [ ] The `m5` tag is not created before the lead's approval is recorded on the PR

## Verification

- npm run ci
- npm run audio && npm run audio && git status --porcelain
- npm run test:e2e
- npm run assets:verify
- gh pr create --title "Close M5: Sound & Music"

## Dependencies

**Depends on:**

- [SSP-168](SSP-168-audio-verify-coverage.md) Wire audio into assets:verify and add SFX coverage and reference tests
- [SSP-169](SSP-169-song-puddle-lane.md) Compose mus.puddle_lane 'Milk Float Shuffle' with base, drums and lead stems
- [SSP-170](SSP-170-song-title.md) Compose mus.title 'Brush With Greatness' with base, drums and lead stems
- [SSP-171](SSP-171-song-high-street.md) Compose mus.high_street 'Window Shopping' with base, drums and lead stems
- [SSP-172](SSP-172-jingles-vs.md) Compose jng.shift_start, jng.tally and jng.sacked jingles
- [SSP-176](SSP-176-sfx-event-wiring.md) Wire sim events to sfx cues through a pure audio director
- [SSP-178](SSP-178-music-player.md) Implement music.ts: sample-locked stems, loops, jingles and scene music
- [SSP-180](SSP-180-engine-synth.md) Implement engineSynth.ts: Bessie's diesel with load, misfire and tyre squeal
- [SSP-181](SSP-181-brush-suction-synth.md) Implement brushSynth.ts brush, suction fan, scrub crackle and bulldozer layers
- [SSP-182](SSP-182-spray-beeper-synth.md) Add spray (sputter, dry pump, refill) and reverse-beeper voices to brushSynth
- [SSP-183](SSP-183-amb-town-morning.md) Add the ambience bed player and author amb.town_morning
- [SSP-174](SSP-174-unlock-codec-loading.md) Add unlock.ts, Opus/AAC codec selection and boot-time audio loading
- [SSP-073](../M2/SSP-073-e2e-smoke.md) Add smoke.spec.ts: 60 s scripted sweep and full shift ending on the tally
- [SSP-072](../M2/SSP-072-m2-replays.md) Record the M2 full-shift and dump-cycle replays and commit their hashes
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-065](../M2/SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-046](../M1/SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie
- [SSP-173](SSP-173-mixer-buses-ducking.md) Implement mixer.ts: bus graph, limiter, settings levels and ducking engine
- [SSP-301](SSP-301-loudness-meter.md) Add the BS.1770 momentary loudness meter and limiter-engagement readout to the F1 dev panel

**Blocks:**

- [SSP-295](SSP-295-vertical-slice-gate.md) Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR

## References

- ../../ROADMAP.md#m5-sound--music
- ../../ROADMAP.md#3-vertical-slice
- ../../ROADMAP.md#6-risk-register
- ../../ROADMAP.md#9-changing-this-roadmap
- ../../ROADMAP.md#11-definition-of-done-every-task-every-milestone
- ../../AUDIO_DESIGN.md#14-testing
- ../../AUDIO_DESIGN.md#152-open-questions
- ../../TECHNICAL_DESIGN.md#185-test-hooks

## Roadmap tasks covered

- Exit criteria (canonical): All `sfx.*` rendered. Live engine, brush, spray and beeper synths. Mixer with ducking. Title + Puddle Lane + High Street songs with adaptive stems. Tally and sacked jingles.
- Key proof of exit: All `sfx.*` rendered; adaptive stems demonstrably switching
