---
id: SSP-108
title: "Add the table-driven penalty and complaint test against entities.json"
milestone: M3
status: todo
type: test
estimate: S
labels: [type:test, area:test, area:gameplay, size:S, vertical-slice]
depends_on: [SSP-083, SSP-084, SSP-085, SSP-086, SSP-087, SSP-088, SSP-091, SSP-090, SSP-092, SSP-094, SSP-095, SSP-079]
blocks: [SSP-109, SSP-211]
---

# SSP-108: Add the table-driven penalty and complaint test against entities.json

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** test · **Size:** S · **Areas:** test, gameplay · **Vertical slice**

## Summary

Write one table-driven test that triggers every M3 hit and offence in a minimal World fixture and asserts points and complaints against entities.json and tuning.json, plus a complaints-rules test and a meta-test that each behaviour has its own test file.

## Context

Measurable checks (ROADMAP M3):
- Penalties: a table-driven test asserts every hit penalty and complaint count against entities.json. Police '+1 extra complaint within 15 m' is tested in M6.
- Complaints: horn spam (> 3 honks in 5 s) = 1; blocking traffic over 10 s = 1; running an occupied zebra = −200 + 1; 5 complaints = SACKED.
- Behaviours: one unit test file per behaviour.

Rows (expected pts, complaints):
- Shopper, businessman, litterbug, postie, market trader: −250, 1.
- Doris: −500, 2, plus 6 spilled shopping. Old man, mum: −500, 2.
- Dog walker hit: −300, 1. Lead Tangle: −150, 1. Cat: −300, 1.
- Bicycle: −250, 1. Mobility scooter: −500, 2.
- Wheelie bin −50 (spills 4); A-board −25; recycling box −25 (spills 2); cone and trolley 0.
- Parked car dent: −100 and 5 HP.
- Puddle splash: −50 per pedestrian (3rd = 1 C). Dust cough: −10 per 2 s. Occupied zebra: −200, 1.

Rows with a penalty assert the combo chain reset; rows with none (cone, trolley) assert it is not reset. Expected values are READ from entities.json/tuning.json; to prove nothing is hard-coded, each row also runs against a fixture copy of the data with altered values (e.g. pts ×2, complaints +1) and the sim must apply the altered values. The catalog mirror is covered separately by entityCatalog.test.ts.

## Scope

- tests/unit/penalties.test.ts with a fixture builder per row and the altered-data variant.
- tests/unit/complaints.rules.test.ts.
- A meta-test listing the expected behaviour test files: shopper, oldWoman, oldManFrame, mumPushchair, postie, dogWalker, businessman, litterbug, marketTrader, cat, pigeon.

## Out of scope

- The police witness rule (M6).
- Inspector rules (M6).

## Acceptance criteria

- [ ] Every row passes with the real data and with the altered-data fixture.
- [ ] The complaints rules test passes: 4 honks in 300 ticks give 1; a 601-tick block gives 1; an occupied zebra gives −200 and 1; the 5th complaint ends the shift with reason Sacked.
- [ ] The meta-test confirms all 11 behaviour test files exist under tests/unit/behaviours/ and are non-empty.

## Verification

- npm test
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-083](SSP-083-behaviour-doris.md) Implement Doris (npc.old_woman): glare, fist-shake slowdown, spray chase, handbag whack
- [SSP-084](SSP-084-behaviour-shopper-businessman-litterbug.md) Implement shopper, businessman and litterbug behaviours, including the Caught! bonus
- [SSP-085](SSP-085-behaviour-old-man-mum-postie.md) Implement old man, mum with pushchair and postie, and the occupied-zebra penalty
- [SSP-086](SSP-086-behaviour-dog-walker.md) Implement the dog walker with a lead line obstacle, Lead Tangle and dog mess drops
- [SSP-087](SSP-087-behaviour-cat.md) Implement the cat: perch, dart on approach, groom, bolt, and ride Bessie's roof
- [SSP-088](SSP-088-behaviour-market-trader-pigeon.md) Implement market trader (with market close pile) and pigeon flocks with Pigeon Scatter
- [SSP-091](SSP-091-traffic-special-kinds.md) Add taxi fare stops, white van pavement parking, bicycle filtering and mobility scooter
- [SSP-090](SSP-090-traffic-parked-collision.md) Add parked cars and Bessie-vs-vehicle collision with dent and impact rules
- [SSP-092](SSP-092-knockable-bodies.md) Implement bodies.ts knockable impulse bodies with spills and penalties
- [SSP-094](SSP-094-puddle-splash-broken-glass.md) Add puddle splash penalties and broken glass from flung bottles
- [SSP-095](SSP-095-near-miss-dust-coughing.md) Add the near-miss bonus and dust coughing penalties
- [SSP-079](SSP-079-end-states-sacked-towed.md) End shifts on SACKED (5 complaints) and TOWED (0 HP) with correct tally rules

**Blocks:**

- [SSP-109](SSP-109-close-m3.md) Close M3: verify the exit criteria, sync docs, state the frozen entity list, tag m3
- [SSP-211](../M6/SSP-211-reveller-police.md) Implement npc.reveller, kicking_out, veh.police witness rule and police_parked

## References

- ../../GDD.md#112-penalty-summary
- ../../ENTITY_CATALOG.md#33-penalty-multipliers-and-complaint-sources
- ../../ENTITY_CATALOG.md#61-stats
- ../../ENTITY_CATALOG.md#91-knockable-props

## Roadmap tasks covered

- Exit (measurable): Penalties: A table-driven test asserts every hit penalty and complaint count against `entities.json`.
- `Exit (measurable): Complaints: Horn spam ... Blocking traffic ... occupied zebra ... 5 complaints = SACKED.`
- `Exit (measurable): Behaviours: One unit test file per behaviour ...`
