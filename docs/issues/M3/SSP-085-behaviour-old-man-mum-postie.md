---
id: SSP-085
title: "Implement old man, mum with pushchair and postie, and the occupied-zebra penalty"
milestone: M3
status: done
type: feature
estimate: M
labels: [type:feature, area:sim, area:ai-npc, area:gameplay, area:test, size:M, vertical-slice]
depends_on: [SSP-082, SSP-055]
blocks: [SSP-104, SSP-105, SSP-108, SSP-206, SSP-213, SSP-215]
---

# SSP-085: Implement old man, mum with pushchair and postie, and the occupied-zebra penalty

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** sim, ai-npc, gameplay, test · **Vertical slice**

## Summary

Write oldManFrame.ts (crosses only at zebras, painfully slowly), mumPushchair.ts (wide, slow footprint) and postie.ts (stops at doors for 3 s). Add the running-an-occupied-zebra penalty that the old man makes bite.

## Context

From ENTITY_CATALOG §6.1–6.2 and §11:

npc.old_man_frame
- 0.4 m/s, shuffle-frame-shuffle walk. Crosses ONLY at site.zebra; a 6 m two-lane crossing takes 15 s.
- Hit: −500, 2 C, ped_oi.

Occupied zebra
- Bessie must wait at an occupied site.zebra. Running it costs −200 + 1 C, on top of any hit (GDD §11.2).
- Use the zebra occupancy from SSP-081: Bessie's OBB entering the zebra rect while occupancy > 0 is one offence per entry episode (re-arm when her OBB has fully left the zebra).
- Audio later: ped_oi + complaint_stamp (AUDIO_DESIGN §5.5).

npc.mum_pushchair
- 1.1 m/s, wide and slow: the pushchair widens her footprint so she blocks most of a pavement. Hit: −500, 2 C.
- Open: footprint shape/size unspecified (ART_BIBLE §7.2 signature: pushchair rectangle ahead of her; sprite ≤ 18 px wide). Propose a capsule or OBB in entities.json and flag it.

npc.postie
- 1.2 m/s. Walks frontage to frontage and stops at doors for 3 s (180 ticks), often leaving the trolley on the pavement edge. Hit: −250, 1 C. In Puddle Lane he starts at 10 s.
- Open: whether the trolley is collidable is unspecified. Default to visual-only (no new entity ID; IDs are frozen) and flag it.

## Scope

- oldManFrame.ts with zebra-only route planning.
- Occupied-zebra offence detection as a penalty fact with a complaint (reason Zebra).
- mumPushchair.ts with a widened footprint used by contact and separation.
- postie.ts with the frontage round and 3 s door idles.
- One test file per behaviour, plus a zebra-offence test.

## Out of scope

- Traffic stopping for occupied zebras (SSP-089).
- The lollipop lady and school crossing (M6).

## Acceptance criteria

- [ ] oldManFrame.test.ts: a route between nodes on opposite sides of a road always uses a zebra edge; crossing a 6 m zebra takes 900 ± 30 ticks; a hit costs −500 and 2 C.
- [ ] Zebra test: Bessie entering an occupied zebra costs −200 and 1 C exactly once per entry; an unoccupied zebra costs nothing; a hit on the crosser adds its own penalty on top.
- [ ] mumPushchair.test.ts: the contact footprint is wider than a 0.3 m pedestrian circle; a hit costs −500 and 2 C.
- [ ] postie.test.ts: stops 180 ticks at each frontage door on the round, then continues; a hit costs −250 and 1 C.
- [ ] Replays pass or are re-recorded with a reason.

## Verification

- npm test
- npm run test:replay
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-082](SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-055](../M2/SSP-055-compile-frontages-dump-validation.md) Generate frontages and pledges in the compiler and validate dump sites

**Blocks:**

- [SSP-104](SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up
- [SSP-105](SSP-105-high-street-greybox.md) Author and compile the grey-box High Street (80×60) for Tuesday's NPCs
- [SSP-108](SSP-108-penalty-table-test.md) Add the table-driven penalty and complaint test against entities.json
- [SSP-206](../M6/SSP-206-district-conker-hill.md) Author and compile district.conker_hill (Thursday, wind and leaf fall)
- [SSP-213](../M6/SSP-213-lollipop-crossing-parade.md) Implement npc.lollipop_lady, site.school_crossing, crossing_patrol and parade
- [SSP-215](../M6/SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map

## References

- ../../ENTITY_CATALOG.md#62-behaviours
- ../../ENTITY_CATALOG.md#11-sites-site
- ../../GDD.md#112-penalty-summary
- ../../LEVEL_DESIGN.md#710-frontages
- ../../AUDIO_DESIGN.md#55-events-with-no-dedicated-sfx

## Roadmap tasks covered

- Behaviours: ... `oldManFrame.ts`, `mumPushchair.ts`, `postie.ts` ...
- `Exit (measurable): Complaints: Running an occupied zebra = −200 + 1 complaint.`
