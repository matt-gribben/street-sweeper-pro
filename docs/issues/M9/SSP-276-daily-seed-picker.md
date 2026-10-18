---
id: SSP-276
title: "Derive the Daily Shift seed from the UTC date and pick district + modifiers"
milestone: M9
status: todo
type: feature
estimate: S
labels: [type:feature, area:gameplay, area:sim, area:test, area:docs, size:S]
depends_on: [SSP-187, SSP-186, SSP-028]
blocks: [SSP-277, SSP-278]
---

# SSP-276: Derive the Daily Shift seed from the UTC date and pick district + modifiers

**Milestone:** [M9 Desktop & Extra Modes](../README.md#m9) · **Type:** feature · **Size:** S · **Areas:** gameplay, sim, test, docs

## Summary

Compute the daily seed (the UTC date as the integer YYYYMMDD) outside the sim, and write a pure, deterministic picker that turns it into one unlocked district and one or two eligible modifiers.

## Context

GDD §13.4: 'One seeded shift per UTC day: random district (from those unlocked) and one or two modifiers.' Seed = UTC date `YYYYMMDD` as an integer (TECHNICAL_DESIGN §7.3, LEVEL_DESIGN §9), e.g. 2027-03-05 → 20270305. Date is banned in src/sim, so the date-to-seed function lives in src/app or src/scenes (composition root, TECHNICAL_DESIGN §2.1). It uses UTC getters (getUTCFullYear and so on), never local time.

**Picker.** The picker is pure and may live in src/sim. Proposed signature: `pickDaily(seed, unlockedIds, modifierIds, isEligible) → { district, modifiers }`. It uses `sfc32` from src/sim/rng.ts on its own stream. Proposed: `sfc32(seed ^ hash32('daily'))`. It is a non-spawn stream like `brush` and `weather`, so add it to the TECHNICAL_DESIGN §7.3 stream list and to the parenthetical in LEVEL_DESIGN §9 that names TECHNICAL_DESIGN's non-spawn streams. The spawn streams never shift.

**Candidates.** Candidates come from `districts.json` order (`district.puddle_lane` … `district.civic_quarter`), filtered by the save's unlocked set (`week.unlocked`). `district.depot_yard` is never a candidate. Modifier count is 1 or 2, distinct, filtered by an injected `isEligible(district, modifier)` predicate (supplied by SSP-277; use a stub in tests). Because the pool depends on the player's unlocks, two players can get different districts on the same date. Document this in GDD §13.4. Replays must therefore record the resolved district and modifiers (SSP-275 fields).

**Testing.** Tests need a date override. Proposed test hook: `?test=1&date=YYYYMMDD` in src/debug/testHooks.ts, added to the TECHNICAL_DESIGN §18.5 table. It is inert without test=1.

## Scope

- UTC date → YYYYMMDD integer helper outside src/sim
- Pure `pickDaily` using a dedicated `daily` sfc32 stream, with candidate order fixed by districts.json and modifier order by ID
- `date=` test hook parameter (test mode only)
- Unit and fast-check property tests
- Docs: add the `daily` stream to TECHNICAL_DESIGN §7.3 and the LEVEL_DESIGN §9 non-spawn parenthetical, the hook to §18.5, and the per-player district note to GDD §13.4

## Out of scope

- The modifier implementations and their eligibility rules (SSP-277)
- UI and tally (SSP-278)

## Acceptance criteria

- [ ] `2027-01-01T23:59:59Z` maps to 20270101 and `2027-01-02T00:00:00Z` to 20270102, whatever the host timezone (unit test with fixed Date inputs under at least two TZ values)
- [ ] For a fixed (seed, unlocked set), the picker returns the same result across 1,000 repeated calls
- [ ] Property test (fast-check): the district is always in the unlocked set and never `district.depot_yard`; modifiers are 1–2 distinct IDs, all eligible for that district
- [ ] With all 7 districts unlocked, the 365 seeds of 2027 pick every district at least once
- [ ] Running the picker leaves the spawn streams untouched: litter and grime spawn output for a fixed level and seed is identical with and without a prior `pickDaily` call (unit test)
- [ ] The `date` hook has no effect without `?test=1`

## Verification

- npm test
- npm run typecheck && npm run lint

## Dependencies

**Depends on:**

- [SSP-187](../M6/SSP-187-progression-economy.md) Add districts.json, upgrades.json and pure week progression and £ ledger
- [SSP-186](../M6/SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub
- [SSP-028](../M1/SSP-028-sim-foundations.md) Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type

**Blocks:**

- [SSP-277](SSP-277-daily-modifiers.md) Implement Daily Shift modifiers as level knob overrides and extra events
- [SSP-278](SSP-278-daily-shift-flow.md) Ship the Daily Shift mode: Title entry, intro card, shift, tally, local best

## References

- ../../GDD.md#134-daily-shift-m9
- ../../TECHNICAL_DESIGN.md#73-randomness
- ../../TECHNICAL_DESIGN.md#74-determinism
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../LEVEL_DESIGN.md#9-spawn-rules
- ../../LEVEL_DESIGN.md#32-unlock-order

## Roadmap tasks covered

- Daily Shift: seed = UTC date `YYYYMMDD`, random district and modifiers, local best only.
