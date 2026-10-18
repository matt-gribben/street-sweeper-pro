---
id: SSP-231
title: "Full-week balance pass: competent runs, \u00a3 curve, par constants and score bands"
milestone: M6
status: todo
type: test
estimate: L
labels: [type:test, area:gameplay, area:test, size:L]
depends_on: [SSP-203, SSP-204, SSP-206, SSP-209, SSP-212, SSP-215, SSP-198, SSP-187, SSP-189, SSP-104, SSP-072, SSP-293]
blocks: [SSP-233]
---

# SSP-231: Full-week balance pass: competent runs, £ curve, par constants and score bands

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** test · **Size:** L · **Areas:** gameplay, test

## Summary

Prove and tune the week's economy and difficulty with scripted 'competent' runs: per-shift and first-week £ in range, par times confirmed, and scores inside the target bands.

## Context

ROADMAP M6 balance check: a 'competent' scripted run earns £250-450 per shift (Monday at the low end) and £2,100-2,600 over a first week including Skip Runs (target about £2,500, GDD §12.3). Progression target (GDD §12.3), cumulative: ~£300 Mon, ~£650 Tue, ~£1,000 Wed, ~£1,350 Thu, ~£1,750 Fri, ~£2,100 Sat, ~£2,500 Sun, buying hopper L1 (Mon), gutter brooms L1 (Wed), engine L1 (Thu), suction L1 (Fri) and hopper L2 (Sat). Monday reference: a solid first Monday earns about £280 (the £283 worked example). Competent runs use each day's par loadout (LEVEL_DESIGN §6.2) and include a Skip Run after each shift (£15-65 typical). Score bands (LEVEL_DESIGN §6.3): an M6 playtest more than 25% outside a band sends the district back for another pass. Par: LEVEL_DESIGN §13 Q6 (par constants: 3.6 m/s average sweep, 3.4 in rain, 10 s per dump, x1.10 slack) and Q7 (all initial values) resolve in M6. Par is meant to be 'confirmed by a recorded human replay in M6', so ask the project lead to record the human par replays the agent cannot make (R-17), and record the outcomes. Tune with per-level knobs only (LEVEL_DESIGN §6.4); never override global rules (handling, points, penalties, star thresholds, the 240 s timer) per level. PROJECT LEAD DECISION (GDD §20 Q1): the £7,350 vs £6,500 'buy everything' gap is deferred as a later tunable; do not change prices to close it. Every intentional sim change re-records the affected replay hashes in the same commit with a reason (ROADMAP §5.3). Implement the check as an automated test in the Vitest replay project (tests/replay/balance.test.ts) that runs the competent replays, feeds the results through the progression ledger and asserts the ranges.

## Scope

- Competent route files and replays for all seven districts, plus a Skip Run per day
- Automated balance test asserting per-shift and first-week £ ranges through the progression ledger
- Level knob tuning where runs or bands fall outside targets; replay hashes re-recorded with reasons
- Update the LEVEL_DESIGN §6 tables with tuned values and resolve §13 Q6/Q7; note GDD §12.3 outcomes

## Out of scope

- Economy total reconciliation (deferred by the project lead)
- Changing global tuning rules per district
- M7 juice and assists

## Acceptance criteria

- [ ] Balance test: every competent shift earns £250-450, and Monday's is the lowest
- [ ] Balance test: the first week including Skip Runs totals £2,100-2,600
- [ ] Each district's competent and 3★ replay scores are within ±25% of its LEVEL_DESIGN §6.3 band
- [ ] Every level still compiles with 3★ par <= par.star3 (and <= 230 s) and 100% par > 260 s
- [ ] LEVEL_DESIGN §13 Q6 and Q7 are marked resolved, with the evidence (human par replays or the lead's recorded waiver)
- [ ] Every replay hash change has a stated reason in its commit message

## Verification

- npm run test:replay
- npm run test:replay -- tests/replay/balance.test.ts
- npm run levels
- npm run assets:verify

## Dependencies

**Depends on:**

- [SSP-203](SSP-203-district-high-street-final.md) Bring district.high_street to final M6 quality with collectibles and 3-star replay
- [SSP-204](SSP-204-district-gasworks.md) Author and compile district.gasworks (Wednesday, rain) with its district replay
- [SSP-206](SSP-206-district-conker-hill.md) Author and compile district.conker_hill (Thursday, wind and leaf fall)
- [SSP-209](SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-212](SSP-212-district-kebab-mile.md) Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden
- [SSP-215](SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-198](SSP-198-skip-run.md) Implement SkipRunScene: 45 s cone slalom and reverse-park bays with £5/£50 payouts
- [SSP-187](SSP-187-progression-economy.md) Add districts.json, upgrades.json and pure week progression and £ ledger
- [SSP-189](SSP-189-scripted-runs.md) Generalise scripted-run authoring for district replays, balance runs and week e2e
- [SSP-104](../M3/SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up
- [SSP-072](../M2/SSP-072-m2-replays.md) Record the M2 full-shift and dump-cycle replays and commit their hashes
- [SSP-293](../M5/SSP-293-vs-scripted-replays.md) Record the vertical-slice replays vs_slow, vs_fast and vs_practised with a waypoint route follower

**Blocks:**

- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag

## References

- ../../ROADMAP.md#m6-tidy-town-week
- ../../GDD.md#122-currency--wages-and-tips
- ../../GDD.md#123-progression-curve-target
- ../../LEVEL_DESIGN.md#62-par-times-the-target-times
- ../../LEVEL_DESIGN.md#63-target-score-bands
- ../../LEVEL_DESIGN.md#64-difficulty-knobs
- ../../LEVEL_DESIGN.md#13-open-questions
- ../../ROADMAP.md#53-replay-hash-policy

## Roadmap tasks covered

_None._
