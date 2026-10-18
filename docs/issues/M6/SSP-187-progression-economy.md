---
id: SSP-187
title: "Add districts.json, upgrades.json and pure week progression and \u00a3 ledger"
milestone: M6
status: todo
type: feature
estimate: L
labels: [type:feature, area:gameplay, area:save, area:test, size:L]
depends_on: [SSP-186, SSP-062, SSP-063, SSP-064, SSP-055, SSP-078, SSP-079, SSP-149]
blocks: [SSP-188, SSP-191, SSP-192, SSP-193, SSP-196, SSP-198, SSP-216, SSP-224, SSP-231, SSP-238, SSP-276, SSP-278]
---

# SSP-187: Add districts.json, upgrades.json and pure week progression and £ ledger

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** L · **Areas:** gameplay, save, test

## Summary

Create the data files and a pure, unit-tested module that turns a finished shift into stars, unlocks, badges, collectible tracking and an itemised £ ledger, then applies the result to the save. Every meta scene reads this module instead of re-implementing the rules.

## Context

Data: create `src/data/districts.json` exactly as in LEVEL_DESIGN §3.2: 7 entries, mon..sun. puddle_lane is always unlocked; each next district needs 1★ on the previous one; civic_quarter needs 1★ on kebab_mile AND totalStarsMonSat >= 12. Also add `pamTarget` per district: the 3★ score band from LEVEL_DESIGN §6.3 (Mon 14,000; Tue 20,000; Wed 22,000; Thu 20,000; Fri 23,000; Sat 28,500; Sun 30,000). This field is a proposal, so document it in LEVEL_DESIGN §3.2. Create `src/data/upgrades.json` from ENTITY_CATALOG §14: upg.hopper 140/180 LU £300/£800; upg.suction +25%/+50% £250/£700; upg.gutter_brooms +0.15/+0.30 m per side £300/£750; upg.water_tank 150/200 £200/£500; upg.engine +10%/+20% £400/£1,000; upg.tyres grip +15% £350; upg.bumper damage -40% £300; upg.two_tone_horn £150; upg.led_beacon £200. Liveries: upg.livery_council (default), upg.livery_racing_green £150, upg.livery_seaside £150, and upg.livery_midnight_gold, unlocked by all 7 Golden Crisps. Total = £6,500 (upgrades £6,200 + liveries £300). PROJECT LEAD DECISION (2026-10-18, already recorded in GDD §20 Q1): the £7,350 vs £6,500 gap is a tunable gameplay number to revisit later. Do NOT change prices; assert against the upgrades.json sum. Rules (GDD §12.1): 1★/2★/3★ at Tidy % >= 60/80/92. Stars are a best-ever record per district. Gleaming = 3★ + 0 complaints + Lost Property returned. £ sources (GDD §12.2): wage £60 per completed shift; pledge tip £10 per pledge frontage at >= 90%; tipping fee £1 per 5 LU dumped at the depot (skips pay nothing); star bonus £50 per star, first time only (tracked by save.starBonusPaid); Lost Property £25; Skip Run £5 per clean bay and £50 per clean run. Test fixture (GDD §12.2 worked example): wage 60 + 7 of 8 pledges (70) + 140 LU dumped (28) + 2★ first time (100) + Lost Property (25) = £283. Replaying the same shift without new stars or Lost Property earns £158 (60 + 70 + 28), which implies Lost Property pays only once. Free Sweep (GDD §13.2): no stars, no £ and no personal bests. Collectibles found still count toward Golden Crisp and Gleaming tracking, but Lost Property pays no £25. Midnight Gold unlocks when goldenCrisp is true for all 7 districts. Pam's Target (GDD §12.1, proposed M6): beating pamTarget earns a 'Top Tipper' stamp only; the £50 bonus in GDD §20 Q12 stays undecided, so it pays no £. Monday's collectibles (collect.false_teeth, golden crisp) were already placed in Puddle Lane before M6 (LEVEL_DESIGN §5.1/§8.5); Wed-Sun collectibles need entities.json rows and placeholder pickup grids (placeholder-first rule; final art in SSP-224). OPEN QUESTIONS to settle and record in the GDD in this PR: (a) Do SACKED/TOWED shifts pay wage, pledge tips or tipping fees? GDD only says 'wage per completed shift', and TOWED keeps 50% of the score with no stars. Proposal: SACKED/TOWED pay nothing and award no stars; flag this for the lead. (b) Tipping-fee rounding: per dump, or a floor of the cumulative LU over the shift (140 LU -> £28 either way)? Proposal: floor(luDepot/5) over the shift. The docs do not name a module location; propose src/app/progression.ts and src/app/economy.ts (pure, no DOM). The sim must expose a ShiftResult (tidy, complaints, pledges >= 90%, LU dumped at the depot, Lost Property and Golden Crisp collected, score, end state). This may need a depot-LU counter in shift.ts. ENTITY §16: tests/unit/entityCatalog.test.ts must diff upgrades.json against the catalog tables.

## Scope

- src/data/districts.json (with pamTarget) and src/data/upgrades.json, each with a typed loader and hand-written guards
- Extend tests/unit/entityCatalog.test.ts to cover upgrades.json prices and values
- entities.json rows and placeholder 16x16 pickup grids for collect.hard_hat, collect.cat_collar, collect.bucket_and_spade, collect.lost_shoe and collect.mayors_chain, if missing
- A ShiftResult type emitted at shift end. Add a depot-LU counter if missing, and re-record replay hashes only if sim state changes, with a stated reason
- Pure functions: isUnlocked(district, save), starsFor(tidy), applyShiftResult(save, result, mode) -> {save, ledger}, gleaming, Golden Crisp count, Midnight Gold unlock, topTipper(best, pamTarget), Skip Run payout
- Itemised ledger lines (wage, pledge tips, tipping fees, star bonus, Lost Property, Skip Run, total) for the Mercury
- Unit tests: unlock rules, every £ source, star bonus first time only, Lost Property first time only, Free Sweep pays nothing, Midnight Gold at 7 crisps, sum of upgrades.json = £6,500
- Record the open-question decisions in GDD §12.2 / §20 in the same PR

## Out of scope

- Changing any upgrade or livery price (deferred by the project lead)
- Applying upgrades inside the sim (SSP-188)
- Inspection Score and Trophy (SSP-216)
- Scenes and UI

## Acceptance criteria

- [ ] src/data/districts.json matches LEVEL_DESIGN §3.2 in ids, days, level names and unlock rules
- [ ] entityCatalog.test.ts fails if any upgrades.json price or value differs from ENTITY_CATALOG §14
- [ ] Unit test: with 1★ on every day Mon-Sat (6 total) Sunday is locked; with 12★ including at least 1 on Saturday it is unlocked; with 12★ but 0 on Saturday it is locked
- [ ] Unit test reproduces the £283 Monday worked example and the £158 replay example
- [ ] Unit test: re-earning 2★ after 3★ were paid gives a £0 star bonus; going from 2★ to 3★ pays £50
- [ ] Unit test: a Free Sweep result changes no stars, best, money or starBonusPaid, but does record goldenCrisp/lostProperty flags
- [ ] Unit test: buying the full upgrade and livery list costs exactly the upgrades.json sum (£6,500)
- [ ] Unit test: Midnight Gold is unlocked only when all 7 goldenCrisp flags are true
- [ ] applyShiftResult is pure (same input gives same output, no I/O) and lives outside src/sim
- [ ] The GDD records the chosen answers for SACKED/TOWED payouts and tipping-fee rounding; LEVEL_DESIGN §3.2 documents pamTarget

## Verification

- npm run typecheck
- npm run lint
- npm test -- tests/unit/progression.test.ts tests/unit/economy.test.ts tests/unit/entityCatalog.test.ts
- npm run test:replay
- npm run assets && npm run assets:lint

## Dependencies

**Depends on:**

- [SSP-186](SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub
- [SSP-062](../M2/SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event
- [SSP-063](../M2/SSP-063-scoring-combo.md) Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger
- [SSP-064](../M2/SSP-064-tidy-frontages.md) Compute Tidy %, per-frontage clean % and Clean Sweep bonuses incrementally
- [SSP-055](../M2/SSP-055-compile-frontages-dump-validation.md) Generate frontages and pledges in the compiler and validate dump sites
- [SSP-078](../M3/SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-079](../M3/SSP-079-end-states-sacked-towed.md) End shifts on SACKED (5 complaints) and TOWED (0 HP) with correct tally rules
- [SSP-149](../M4/SSP-149-pickups-grids.md) Hand-author power-up and Mon-Tue collectible pickup grids

**Blocks:**

- [SSP-188](SSP-188-upgrade-modifiers.md) Apply upg.* levels to the sim via tuning.ts modifiers and record loadout in replays
- [SSP-191](SSP-191-week-map-scene.md) Build WeekMapScene: seven district cards, stars, unlock state and Gleaming badges
- [SSP-192](SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-193](SSP-193-workshop-liveries.md) Build WorkshopScene with upgrade purchases and Bessie livery ramp swaps
- [SSP-196](SSP-196-free-sweep.md) Add Free Sweep mode: untimed, no complaints, Pause -> Finish Sweep, cut-down Mercury
- [SSP-198](SSP-198-skip-run.md) Implement SkipRunScene: 45 s cone slalom and reverse-park bays with £5/£50 payouts
- [SSP-216](SSP-216-sunday-finale-trophy.md) Implement the Sunday Inspection Score and the Tidy Town Trophy award
- [SSP-224](SSP-224-art-grids-m6.md) Art Pass 2: seagull, loose dog, remaining collectibles, upgrade icons and small props
- [SSP-231](SSP-231-balance-pass.md) Full-week balance pass: competent runs, £ curve, par constants and score bands
- [SSP-238](../M7/SSP-238-assists-tally-save.md) Flag assists on the Mercury tally and store assisted bests separately
- [SSP-276](../M9/SSP-276-daily-seed-picker.md) Derive the Daily Shift seed from the UTC date and pick district + modifiers
- [SSP-278](../M9/SSP-278-daily-shift-flow.md) Ship the Daily Shift mode: Title entry, intro card, shift, tally, local best

## References

- ../../GDD.md#121-stars-per-district
- ../../GDD.md#122-currency--wages-and-tips
- ../../GDD.md#123-progression-curve-target
- ../../GDD.md#126-collectibles
- ../../GDD.md#132-free-sweep
- ../../GDD.md#20-open-design-questions
- ../../LEVEL_DESIGN.md#32-unlock-order
- ../../LEVEL_DESIGN.md#63-target-score-bands
- ../../ENTITY_CATALOG.md#141-upgrades
- ../../ENTITY_CATALOG.md#142-liveries-upglivery_
- ../../ENTITY_CATALOG.md#13-collectibles-collect
- ../../ENTITY_CATALOG.md#16-changing-this-catalog

## Roadmap tasks covered

- Lost Property `collect.*` and one `collect.golden_crisp` placed per district. Collecting all 7 unlocks Midnight Gold. (tracking, entity rows and the unlock rule)
