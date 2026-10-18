---
id: SSP-232
title: "Write tests/e2e/week.spec.ts: scripted save from Monday to the Tidy Town Trophy"
milestone: M6
status: todo
type: test
estimate: M
labels: [type:test, area:test, area:gameplay, size:M]
depends_on: [SSP-216, SSP-193, SSP-203, SSP-204, SSP-206, SSP-209, SSP-212, SSP-215, SSP-189, SSP-186, SSP-073, SSP-019]
blocks: [SSP-233, SSP-253, SSP-296]
---

# SSP-232: Write tests/e2e/week.spec.ts: scripted save from Monday to the Tidy Town Trophy

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** test · **Size:** M · **Areas:** test, gameplay

## Summary

The canonical 'full playthrough possible' proof: a Playwright test that drives a fresh save through all seven days with replayed inputs, buys the par upgrades and reaches the trophy.

## Context

ROADMAP M6 measurable check: tests/e2e/week.spec.ts drives a scripted save through Mon -> Sun using test hooks (replayed inputs per district) and reaches the trophy. Trophy condition (GDD §12.8): Inspection Score >= 80, where the score is 0.5 x mean best Tidy % Mon-Sat + 0.5 x Inspection pass rate. Unlocks: the next district needs 1★; Sunday needs 1★ on Saturday and >= 12★ across Mon-Sat. Use the committed per-district replays (from the district issues) or the SSP-231 competent runs, and buy each day's par loadout (LEVEL_DESIGN §6.2) through the Workshop UI or a hook. Running 7 x 240 s in real time is too slow for CI (the macos-latest visual job), so drive the sim with __ssp.step(n) (TECHNICAL_DESIGN §18.5) or a new ?test=1-only hook that plays a replay synchronously, then let the scenes run the real Tally -> Week Map flow. Hooks must be inert without ?test=1. Assert: each day unlocks only after the previous day gets >= 1★; the save persists across a page reload mid-week; the Week Map shows the Trophy and the Mercury shows "MUCKLEFORD NAMED BRITAIN'S TIDIEST TOWN (RUNNER-UP)"; there are no console errors. Also check that the game still runs with localStorage throwing by running the first two days with storage blocked; this doubles as the Save exit check.

## Scope

- tests/e2e/week.spec.ts
- Test hook for synchronous replay playback and save inspection (if not already present), documented in TECHNICAL_DESIGN §18.5
- Storage-blocked variant covering at least Monday -> Tuesday

## Out of scope

- Credits and jng.trophy (M7)

## Acceptance criteria

- [ ] week.spec.ts passes locally and within the macos CI job's time budget (runtime documented in the PR)
- [ ] The test fails if any unlock rule is broken (verified by breaking one temporarily, noted in the PR)
- [ ] After Sunday the save has week.trophy = true and the Week Map shows the Trophy
- [ ] Zero console errors across the run
- [ ] The storage-blocked variant passes

## Verification

- npx playwright test tests/e2e/week.spec.ts
- npm run test:e2e
- npm run ci

## Dependencies

**Depends on:**

- [SSP-216](SSP-216-sunday-finale-trophy.md) Implement the Sunday Inspection Score and the Tidy Town Trophy award
- [SSP-193](SSP-193-workshop-liveries.md) Build WorkshopScene with upgrade purchases and Bessie livery ramp swaps
- [SSP-203](SSP-203-district-high-street-final.md) Bring district.high_street to final M6 quality with collectibles and 3-star replay
- [SSP-204](SSP-204-district-gasworks.md) Author and compile district.gasworks (Wednesday, rain) with its district replay
- [SSP-206](SSP-206-district-conker-hill.md) Author and compile district.conker_hill (Thursday, wind and leaf fall)
- [SSP-209](SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-212](SSP-212-district-kebab-mile.md) Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden
- [SSP-215](SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-189](SSP-189-scripted-runs.md) Generalise scripted-run authoring for district replays, balance runs and week e2e
- [SSP-186](SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub
- [SSP-073](../M2/SSP-073-e2e-smoke.md) Add smoke.spec.ts: 60 s scripted sweep and full shift ending on the tally
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene

**Blocks:**

- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag
- [SSP-253](../M7/SSP-253-browser-scaling-qa.md) Run cross-browser, scaling and storage-blocked verification for 1.0
- [SSP-296](../M7/SSP-296-ci-macos-visual-e2e.md) Bring the macos-latest visual/e2e CI job to its 1.0 shape and prove both CI jobs green

## References

- ../../ROADMAP.md#m6-tidy-town-week
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../TECHNICAL_DESIGN.md#186-e2e
- ../../GDD.md#128-the-week-finale
- ../../LEVEL_DESIGN.md#32-unlock-order

## Roadmap tasks covered

_None._
