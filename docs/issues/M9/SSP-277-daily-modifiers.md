---
id: SSP-277
title: "Implement Daily Shift modifiers as level knob overrides and extra events"
milestone: M9
status: todo
type: feature
estimate: L
labels: [type:feature, area:gameplay, area:sim, area:test, area:docs, size:L]
depends_on: [SSP-275, SSP-276, SSP-203, SSP-204, SSP-206, SSP-209, SSP-212, SSP-215, SSP-205, SSP-207, SSP-083]
blocks: [SSP-278]
---

# SSP-277: Implement Daily Shift modifiers as level knob overrides and extra events

**Milestone:** [M9 Desktop & Extra Modes](../README.md#m9) · **Type:** feature · **Size:** L · **Areas:** gameplay, sim, test, docs

## Summary

Implement the Daily Shift modifier pool as a pure transform over the compiled level: knob overrides and extra events, never rule changes. Each modifier gets per-district eligibility and a runtime budget check.

## Context

**Pool.** GDD §13.4 modifier pool (proposed, M9):
- *Bin Strike*: litter density ×1.5
- *Heatwave*: two ice cream vans
- *Gale*: wind gusts in any district
- *Market Day*: Tuesday stalls elsewhere
- *Doris Day*: three Dorises
Use `as const` modifier IDs (proposed `bin_strike`, `heatwave`, `gale`, `market_day`, `doris_day`).

**Mechanism.** LEVEL_DESIGN §4.3 and §6.4: modifiers are 'extra events and knob overrides on top of the level JSON'.
- Bin Strike: `litter.initial × 1.5`.
- Gale: adds `gust` events (`haz.wind_gust`: newspapers, packets and leaves drift 1.5 m/s for 4 s; params `at[]`, `dirDeg`).
- Doris Day: sets `npcs.named[npc.old_woman].count = 3`.
- Heatwave: uses `vehicle_stop` events (`vehicle`, `anchor`, `at`, `stopS`; the ice cream van stops 20 s with chimes and spawns kids, wrappers and lolly sticks).
These non-overridable knobs must never change: vehicle handling, brush geometry, points and penalties, cat dart 40%, star thresholds and the timer.

**Validation** (LEVEL_DESIGN §13 Q8). The default is that modifiers skip L060–L062 (par checks). The budget rules still hold at runtime (L050): peak NPCs ≤ 80, peak vehicles ≤ 30, and `litter.initial` + expected dynamic ≤ 1,000. From LEVEL_DESIGN §6.1:
- Bin Strike worst case is Sun: 300 × 1.5 = 450, plus 40 dynamic.
- Vehicle headroom is tight on Sat (16 + 12 = 28) and Sun (12 + 16 = 28), so Heatwave's extra van must fit.

**Decisions made here** (record in GDD §13.4 and resolve LEVEL_DESIGN §13 Q8):
1. **Entity membership (L005).** The ice cream van is Fri/Sun only (ENTITY_CATALOG §8.2), Doris is Mon/Tue/Thu/Sun (ENTITY_CATALOG §6.1), and gusts are Fri only. Modifiers are exempt from L005 at runtime, but each one is eligible only where its prerequisites exist:
   - Doris Day needs a named `npc.old_woman` with an anchor and route (Mon, Tue, Thu, Sun).
   - Heatwave needs a lane-graph stop anchor for a van, in practice Fri/Sun unless other levels have one.
   - Gale needs nothing and is eligible everywhere.
2. **Market Day.** It needs `m` stall pitches, and only High Street has them (12 pitches, LEVEL_DESIGN §5.2). Adding pitches elsewhere would change campaign maps (out of scope). Default: remove Market Day from the 1.0 pool and record it as deferred in GDD §13.4. The lead may override this in review.
3. **Gale parameters.** Gust times and direction come from the `daily` stream (defined in SSP-276), not from hand-authored values.

Open for the lead (don't block on it): 'Doris Day' is also a real performer's name. The `ipHygiene.test.ts` scan may not catch it, so the display name is decided in SSP-278 (e.g. keep the pun, or 'Triple Doris').

**Placement.** A pure `applyModifiers(level, modifierIds, seed) → level` that runs once at shift start and returns a new object. It must not mutate the cached compiled level. It may live in src/sim.

## Scope

- Modifier registry (`as const` IDs) with an `isEligible(district, modifier)` predicate consumed by the picker
- Pure `applyModifiers` implementing Bin Strike, Heatwave, Gale and Doris Day (Market Day removed from the pool by default)
- Runtime budget validation equivalent to L050 for each applied level
- Unit tests per modifier and an exhaustive (district × eligible modifier and pair) budget test
- Doc updates: GDD §13.4 (final pool and eligibility), LEVEL_DESIGN §13 Q8 resolved, LEVEL_DESIGN §10.3 note on the runtime L005 exemption

## Out of scope

- New entities, new event types or new art (modifiers reuse existing IDs and events)
- Adding market pitches to other districts
- Daily UI and tally
- Changing campaign level JSON

## Acceptance criteria

- [ ] Bin Strike: for each eligible district, the applied `litter.initial` equals round(initial × 1.5), and the spawned initial litter count matches it at tick 0 (unit test)
- [ ] Gale: the applied level contains `gust` events whose `at` and `dirDeg` derive from the seed, and the same seed gives identical events (unit test)
- [ ] Doris Day: the applied level spawns exactly 3 `npc.old_woman`, and the modifier is ineligible in districts without a named Doris
- [ ] Heatwave: the applied level has two ice cream vans with `vehicle_stop` events, and the modifier is ineligible where no stop anchor exists
- [ ] Market Day isn't in the registry, and GDD §13.4 records it as deferred (or it is implemented per a lead decision recorded in the PR)
- [ ] For every (district, eligible modifier) pair and every eligible pair of modifiers, the applied level passes the runtime budget check (≤ 80 NPCs, ≤ 30 vehicles, ≤ 1,000 initial + expected dynamic litter)
- [ ] A unit test asserts that tuning values (handling, brush geometry, points, star thresholds, timer) are identical with and without modifiers
- [ ] The cached compiled level object is deep-equal before and after `applyModifiers` (no mutation)
- [ ] Every committed campaign replay passes `npm run test:replay` unchanged

## Verification

- npm test
- npm run test:replay
- npm run typecheck && npm run lint

## Dependencies

**Depends on:**

- [SSP-275](SSP-275-mode-plumbing.md) Add Daily Shift and Rival Sweep mode plumbing: params, timer, replay, save
- [SSP-276](SSP-276-daily-seed-picker.md) Derive the Daily Shift seed from the UTC date and pick district + modifiers
- [SSP-203](../M6/SSP-203-district-high-street-final.md) Bring district.high_street to final M6 quality with collectibles and 3-star replay
- [SSP-204](../M6/SSP-204-district-gasworks.md) Author and compile district.gasworks (Wednesday, rain) with its district replay
- [SSP-206](../M6/SSP-206-district-conker-hill.md) Author and compile district.conker_hill (Thursday, wind and leaf fall)
- [SSP-209](../M6/SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-212](../M6/SSP-212-district-kebab-mile.md) Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden
- [SSP-215](../M6/SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-205](../M6/SSP-205-wind-leaves-gusts.md) Implement leaf fall, wet leaves and haz.wind_gust litter drift
- [SSP-207](../M6/SSP-207-ice-cream-van.md) Implement veh.ice_cream_van, its parked variant and the vehicle_stop event
- [SSP-083](../M3/SSP-083-behaviour-doris.md) Implement Doris (npc.old_woman): glare, fist-shake slowdown, spray chase, handbag whack

**Blocks:**

- [SSP-278](SSP-278-daily-shift-flow.md) Ship the Daily Shift mode: Title entry, intro card, shift, tally, local best

## References

- ../../GDD.md#134-daily-shift-m9
- ../../LEVEL_DESIGN.md#43-event-catalogue
- ../../LEVEL_DESIGN.md#64-difficulty-knobs
- ../../LEVEL_DESIGN.md#61-per-district-numbers
- ../../LEVEL_DESIGN.md#52-tue-muckleford-high-street-districthigh_street
- ../../LEVEL_DESIGN.md#103-validation-rules
- ../../LEVEL_DESIGN.md#13-open-questions
- ../../LEVEL_DESIGN.md#84-leveljson-schema
- ../../ENTITY_CATALOG.md#82-behaviour-collision-and-districts
- ../../ENTITY_CATALOG.md#63-doris-npcold_woman

## Roadmap tasks covered

- Daily Shift: seed = UTC date `YYYYMMDD`, random district and modifiers, local best only.
