---
id: SSP-278
title: "Ship the Daily Shift mode: Title entry, intro card, shift, tally, local best"
milestone: M9
status: todo
type: feature
estimate: M
labels: [type:feature, area:gameplay, area:ui, area:save, area:audio, area:test, area:docs, size:M]
depends_on: [SSP-275, SSP-276, SSP-277, SSP-192, SSP-157, SSP-187, SSP-191, SSP-237, SSP-238]
blocks: [SSP-282, SSP-283]
---

# SSP-278: Ship the Daily Shift mode: Title entry, intro card, shift, tally, local best

**Milestone:** [M9 Desktop & Extra Modes](../README.md#m9) · **Type:** feature · **Size:** M · **Areas:** gameplay, ui, save, audio, test, docs

## Summary

Make Daily Shift playable end to end: from the Title, a dated intro card shows today's district and modifiers, then a 240 s seeded shift, then a Mercury tally with today's local best saved to ssp.save.v1.

## Context

**Rules.** GDD §13.4: one seeded shift per UTC day, a random unlocked district, 1–2 modifiers, local best only, no online leaderboard (ROADMAP §7: leaderboards are post-M9). The seed is the UTC date YYYYMMDD, read when the player enters the mode, so a session running past midnight keeps its start date. Timer 240 s.

**Scenes.**
- Title gets a 'Daily Shift' entry that goes straight to ShiftIntroScene (no Week Map).
- Tally exits for Daily are 'Try Again' (same date) and 'Title'. No Skip Run, Workshop or Week Map. Pause → Retire returns to Title.
- Update the mirrored scene-flow diagrams in GDD §15.1 and TECHNICAL_DESIGN §6.2 in the same change (they 'change together').
- ShiftIntroScene reuses Big Pam's card (`portrait.big_pam`, `ui.panel_council`) and shows the date, district and modifier names (British English, Kerbside 5×7 / Bold 8×8 fonts).
- The tally reuses TallyScene (Mercury) with a Daily variant: the date, today's best and a new-best stamp.

**Audio.** Reuse the district `mus.*` song with adaptive stems (drums at ×3, lead under 60 s), plus `jng.shift_start`, `jng.tally` and `jng.sacked`/`jng.towed` (AUDIO_DESIGN §15.1: 'Rival Sweep and Daily Shift reuse existing songs').

**Visual test.** CLAUDE.md §7 requires adding or extending a visual scene for a new visual feature. Add one for the Daily tally variant (proposed `mercury_daily`, or extend `mercury_tally`) and list it in TECHNICAL_DESIGN §18.4.

**Open questions.** The GDD is silent on these. Propose, get the lead's OK, and record in GDD §13.4:
- £, stars, unlocks, collectibles. Proposed: none awarded, like Free Sweep, so the campaign keeps driving the economy.
- Retries. Proposed: unlimited retries on the same date, keeping the best.
- Assists. Proposed: assisted runs are stored separately, mirroring `bestAssisted`, with the tally stamps from GDD §17.1.
- Tutorial beats. Proposed: off.
- Workshop upgrades. Proposed: the player's current loadout applies.
- Modifier display names, run through `ipHygiene.test.ts`. 'Doris Day' is a real performer's name, so ask whether to keep it.

**Save.** Written only at tally commit, via the SSP-275 helpers. The game must still run with storage blocked. In Playwright, block storage with `page.addInitScript` that makes `localStorage` accessors throw.

## Scope

- Title menu entry and SceneParams wiring for Daily Shift
- Intro card variant listing the date, district and modifiers
- Shift start using the date seed, the picked district and the applied modifiers
- Mercury tally variant with today's best and a new-best stamp, saved at tally; tally and pause exits return to Title
- Visual golden for the Daily tally (proposed `mercury_daily`)
- Playwright e2e `tests/e2e/daily.spec.ts` using `?test=1&date=…`
- Update GDD §13.4 (decided rules), GDD §15.1 and TECHNICAL_DESIGN §6.2 diagrams, and TECHNICAL_DESIGN §18.4 scene list

## Out of scope

- Online leaderboards or sharing
- New music or jingles
- New Mercury art (reuse the M6 masthead art; text only)

## Acceptance criteria

- [ ] From the Title, Daily Shift starts a shift in the district, and with the modifiers, that `pickDaily` returns for the current UTC date and the save's unlocked set
- [ ] The intro card shows the date, district name and modifier names, and the tally shows the date and today's best
- [ ] Finishing a run saves that date's best in ssp.save.v1, and a lower score later the same date doesn't overwrite it
- [ ] With `?test=1&date=20270101`, two separate runs get the same district, modifiers and initial litter layout (e2e, compared via `__ssp.state()`)
- [ ] With localStorage throwing (addInitScript), Daily Shift is playable to the tally with no console errors
- [ ] The district's `mus.*` song plays with adaptive stems, and no new audio assets are added (`git diff --stat -- assets-src/audio` is empty)
- [ ] The Daily tally golden passes at pixelmatch threshold 0, and its expected/actual/diff PNGs were Read before approval
- [ ] GDD §15.1 and TECHNICAL_DESIGN §6.2 both include the Daily Shift path and match each other
- [ ] `ipHygiene.test.ts` passes with the new strings, and `npm run test:e2e` passes, including daily.spec.ts

## Verification

- npm run test:e2e
- npm run test:visual
- npm test
- npm run dev → /?test=1&date=20270101 (manual run to tally)

## Dependencies

**Depends on:**

- [SSP-275](SSP-275-mode-plumbing.md) Add Daily Shift and Rival Sweep mode plumbing: params, timer, replay, save
- [SSP-276](SSP-276-daily-seed-picker.md) Derive the Daily Shift seed from the UTC date and pick district + modifiers
- [SSP-277](SSP-277-daily-modifiers.md) Implement Daily Shift modifiers as level knob overrides and extra events
- [SSP-192](../M6/SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-157](../M4/SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art
- [SSP-187](../M6/SSP-187-progression-economy.md) Add districts.json, upgrades.json and pure week progression and £ ledger
- [SSP-191](../M6/SSP-191-week-map-scene.md) Build WeekMapScene: seven district cards, stars, unlock state and Gleaming badges
- [SSP-237](../M7/SSP-237-assists-sim.md) Wire auto-brush, +60 s timer, Chill Shift and instant dump into the sim
- [SSP-238](../M7/SSP-238-assists-tally-save.md) Flag assists on the Mercury tally and store assisted bests separately

**Blocks:**

- [SSP-282](SSP-282-mode-replays.md) Commit deterministic replays for Daily Shift (pinned date) and Rival Sweep
- [SSP-283](SSP-283-m9-release-close.md) Publish desktop builds and both modes on itch.io, then close M9

## References

- ../../GDD.md#134-daily-shift-m9
- ../../GDD.md#132-free-sweep
- ../../GDD.md#151-scene-flow
- ../../GDD.md#153-tally-screen-the-muckleford-mercury
- ../../GDD.md#171-assists-m7
- ../../TECHNICAL_DESIGN.md#62-scene-flow
- ../../TECHNICAL_DESIGN.md#16-save-data-and-settings
- ../../TECHNICAL_DESIGN.md#184-visual-headless-screenshot-tests
- ../../TECHNICAL_DESIGN.md#186-e2e
- ../../AUDIO_DESIGN.md#84-scene--audio-map
- ../../AUDIO_DESIGN.md#151-plan
- ../../../CLAUDE.md#7-testing-expectations

## Roadmap tasks covered

- Daily Shift: seed = UTC date `YYYYMMDD`, random district and modifiers, local best only.
