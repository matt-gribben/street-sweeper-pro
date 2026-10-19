---
id: SSP-088
title: "Implement market trader (with market close pile) and pigeon flocks with Pigeon Scatter"
milestone: M3
status: done
type: feature
estimate: M
labels: [type:feature, area:sim, area:ai-npc, area:gameplay, area:test, size:M]
depends_on: [SSP-082, SSP-062]
blocks: [SSP-105, SSP-106, SSP-108, SSP-200, SSP-203, SSP-209, SSP-215]
---

# SSP-088: Implement market trader (with market close pile) and pigeon flocks with Pigeon Scatter

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** sim, ai-npc, gameplay, test

## Summary

Write marketTrader.ts (a static stall trader whose pitch builds a litter pile at Tuesday closing time, via the market and market_close events) and pigeon.ts (flocks that gather at chip wrappers, scatter at 4 m and award +25 Pigeon Scatter). Both are Tuesday High Street signatures.

## Context

npc.market_trader (ENTITY_CATALOG §6.2)
- Speed 0. Mans a prop.market_stall all shift; idle = calling out. Hit: −250, 1 C. Does not move under HiVis.
- Events (LEVEL_DESIGN §4.3), run in src/sim/shift.ts on the fixed tick with the `events` stream, keyed to elapsed seconds:
  - market: stalls open; a trader at each `m` pitch (param `pitches`, default all `m`); litter and shopper bias around pitches.
  - market_close: params at, buildS, itemsPerPitch, table. Tuesday: at 180 s, about 40 items build over 20 s.
- Each pitch is a 2×1-tile stall plus one tile in front for the trader. Add a minimal event runner for these two types if none exists.

npc.pigeon (ENTITY_CATALOG §7.4)
- Flocks of 6–12 (High Street authors 6–10). Gather around litter.chip_wrapper, pecking.
- Scatter at 4 m from Bessie and land 10 m away (fly ×3).
- Cannot be hit: ghost collision.
- Driving through a flock: +25 Pigeon Scatter once per flock per scatter. Style bonus: not multiplied, does not extend the chain.
- Each bird counts toward the 80-NPC budget. Spawned from level `flocks`.
- 'Drive through' is not defined precisely. Propose: Bessie's OBB overlaps the flock's bounding circle while it is scattering. Flag it.

## Scope

- marketTrader.ts, plus market and market_close handling in shift.ts with the events stream.
- pigeon.ts with shared flock id, chip-wrapper attraction, scatter and land, and the Pigeon Scatter bonus fact.
- tests/unit/behaviours/marketTrader.test.ts and pigeon.test.ts.

## Out of scope

- Seagulls (M6).
- High Street level authoring (SSP-105).

## Acceptance criteria

- [ ] marketTrader.test.ts: the trader never moves (including under HiVis); a hit costs −250 and 1 C; market_close at 180 s spawns itemsPerPitch items per pitch spread over buildS seconds, all counted in litter spawned.
- [ ] pigeon.test.ts: Bessie at 3.9 m makes the flock scatter and birds land 10 ± 1 m away; contact never produces a hit or penalty; driving through a scattering flock awards +25 exactly once per scatter, not multiplied and with chain length unchanged.
- [ ] A flock of 12 counts as 12 toward the NPC cap.
- [ ] Replays pass or are re-recorded with a reason.

## Verification

- npm test
- npm run test:replay
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-082](SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-062](../M2/SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event

**Blocks:**

- [SSP-105](SSP-105-high-street-greybox.md) Author and compile the grey-box High Street (80×60) for Tuesday's NPCs
- [SSP-106](SSP-106-npc-stress-budget.md) Prove the NPC budget: 80 NPCs, 30 vehicles, 2,000 litter, allocation-free
- [SSP-108](SSP-108-penalty-table-test.md) Add the table-driven penalty and complaint test against entities.json
- [SSP-200](../M6/SSP-200-dog-loose-seagull.md) Implement npc.dog_loose chase and npc.seagull chip theft and litter snatching
- [SSP-203](../M6/SSP-203-district-high-street-final.md) Bring district.high_street to final M6 quality with collectibles and 3-star replay
- [SSP-209](../M6/SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-215](../M6/SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map

## References

- ../../ENTITY_CATALOG.md#62-behaviours
- ../../ENTITY_CATALOG.md#74-pigeon-npcpigeon
- ../../LEVEL_DESIGN.md#43-event-catalogue
- ../../LEVEL_DESIGN.md#76-parks-markets-and-squares
- ../../GDD.md#103-style-bonuses

## Roadmap tasks covered

- Behaviours: ... `marketTrader.ts`, `cat.ts`, `pigeon.ts` (marketTrader, pigeon)
- `Horn (8 m radius), near miss (+25), Pigeon Scatter (+25), Caught! (+100), dust coughing (Pigeon Scatter part)`
