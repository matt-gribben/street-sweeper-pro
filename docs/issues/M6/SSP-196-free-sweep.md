---
id: SSP-196
title: "Add Free Sweep mode: untimed, no complaints, Pause -> Finish Sweep, cut-down Mercury"
milestone: M6
status: todo
type: feature
estimate: M
labels: [type:feature, area:gameplay, area:sim, area:ui, size:M]
depends_on: [SSP-192, SSP-191, SSP-194, SSP-187, SSP-189, SSP-062, SSP-078, SSP-079, SSP-287]
blocks: [SSP-203, SSP-204, SSP-206, SSP-209, SSP-212, SSP-215, SSP-233, SSP-237, SSP-275]
---

# SSP-196: Add Free Sweep mode: untimed, no complaints, Pause -> Finish Sweep, cut-down Mercury

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** M · **Areas:** gameplay, sim, ui

## Summary

A relaxation and practice mode for any unlocked district: no timer, no complaints, no fail states, no stars or £. The player ends it from the pause menu and gets a cut-down Mercury.

## Context

Spec: GDD §13.2 (proposed values; adopt them). Each district unlocks for Free Sweep once it is unlocked in the week. Flow: Title -> Free Sweep -> WeekMapScene to choose a district (GDD §15.1). There is no timer, no complaints, no SACKED and no TOWED; damage is shown but HP never drops below 1. Score and Tidy % are shown but not recorded as personal bests, and there are no stars and no £. Collectibles can be found and kept and count toward Golden Crisp and Gleaming tracking, but Lost Property pays no £25. The seed is the campaign seed (LEVEL_DESIGN §9). Events (LEVEL_DESIGN §4.3): one-off events (market_close, kicking_out, inspection, parade, dawn) are skipped, and recurring ones (gust, vehicle_stop, bin_round, leaf_fall, NPC schedules) loop on a 240 s cycle. Music is mus.workshop with the Free Sweep stem rule (AUDIO §9.4). Ending (GDD §13.2, TECHNICAL_DESIGN §6.2): PauseOverlay gains 'Finish Sweep' (Free Sweep only), which leads to a cut-down Mercury in TallyScene showing Tidy % and collectibles found, with no £ or stars. The mode is a sim input (it changes complaints, the HP floor and the timer). SSP-189 adds the replay `mode` field; this issue makes the sim honour mode 'free_sweep'. Open: the docs do not say whether the HUD hides the timer and complaints meter or shows them blank. Proposal: hide both, and record it in GDD §15.2.

PauseOverlay (SSP-287) has a data-driven entry list with visibility predicates. Add 'Finish Sweep' to it, visible only when the mode is free_sweep.

## Scope

- Sim honours mode 'free_sweep' from ShiftScene and the replay `mode` field: shift.ts timer disabled, complaints.ts inert, HP floor 1
- Event scheduler: skip one-off events and loop recurring ones every 240 s in Free Sweep
- Title 'Free Sweep' entry and Week Map district selection in Free Sweep mode
- PauseOverlay 'Finish Sweep' button (Free Sweep only)
- Cut-down Mercury variant in TallyScene; progression applied with mode = free_sweep
- HUD hides the timer and complaints meter (documented in GDD §15.2)
- Unit tests, plus a scripted, committed Free Sweep replay on Puddle Lane

## Out of scope

- Daily Shift and Rival Sweep (M9)
- Assists such as Chill Shift (M7)

## Acceptance criteria

- [ ] Unit test: in Free Sweep, penalties that would add complaints leave the meter at 0 and no SACKED event fires
- [ ] Unit test: HP is clamped to >= 1 after any impact sequence that would reach 0
- [ ] Unit test: the timer never ends the shift; a recurring event fires again 240 s after its first firing; a one-off event never fires
- [ ] Finish Sweep appears only in Free Sweep pause menus and leads to a cut-down Mercury with no £ and no stars (e2e)
- [ ] After Finish Sweep the save has unchanged money, stars and best, and a found Golden Crisp is recorded
- [ ] tests/replay/replays/m6_free_sweep_puddle_lane.json (mode free_sweep) is committed and passing

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:replay
- npm run test:e2e

## Dependencies

**Depends on:**

- [SSP-192](SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-191](SSP-191-week-map-scene.md) Build WeekMapScene: seven district cards, stars, unlock state and Gleaming badges
- [SSP-194](SSP-194-audio-mus-workshop.md) Compose mus.workshop 'Tea Break' and implement the mus.workshop fallback rule
- [SSP-187](SSP-187-progression-economy.md) Add districts.json, upgrades.json and pure week progression and £ ledger
- [SSP-189](SSP-189-scripted-runs.md) Generalise scripted-run authoring for district replays, balance runs and week e2e
- [SSP-062](../M2/SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event
- [SSP-078](../M3/SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-079](../M3/SSP-079-end-states-sacked-towed.md) End shifts on SACKED (5 complaints) and TOWED (0 HP) with correct tally rules
- [SSP-287](../M3/SSP-287-pause-overlay.md) Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire

**Blocks:**

- [SSP-203](SSP-203-district-high-street-final.md) Bring district.high_street to final M6 quality with collectibles and 3-star replay
- [SSP-204](SSP-204-district-gasworks.md) Author and compile district.gasworks (Wednesday, rain) with its district replay
- [SSP-206](SSP-206-district-conker-hill.md) Author and compile district.conker_hill (Thursday, wind and leaf fall)
- [SSP-209](SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-212](SSP-212-district-kebab-mile.md) Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden
- [SSP-215](SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag
- [SSP-237](../M7/SSP-237-assists-sim.md) Wire auto-brush, +60 s timer, Chill Shift and instant dump into the sim
- [SSP-275](../M9/SSP-275-mode-plumbing.md) Add Daily Shift and Rival Sweep mode plumbing: params, timer, replay, save

## References

- ../../GDD.md#132-free-sweep
- ../../LEVEL_DESIGN.md#43-event-catalogue
- ../../AUDIO_DESIGN.md#94-free-sweep-and-tea-break
- ../../TECHNICAL_DESIGN.md#62-scene-flow
- ../../GDD.md#152-hud-layout
- ../../GDD.md#20-open-design-questions

## Roadmap tasks covered

- Free Sweep: no timer, no complaints, `mus.workshop` ("Tea Break"), ended from Pause → Finish Sweep with a cut-down Mercury (GDD §13.2).
