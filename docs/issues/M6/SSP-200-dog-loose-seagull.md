---
id: SSP-200
title: "Implement npc.dog_loose chase and npc.seagull chip theft and litter snatching"
milestone: M6
status: todo
type: feature
estimate: M
labels: [type:feature, area:ai-npc, area:sim, area:test, size:M]
depends_on: [SSP-080, SSP-088, SSP-082, SSP-147, SSP-064, SSP-057, SSP-295]
blocks: [SSP-204, SSP-206, SSP-208, SSP-209, SSP-215, SSP-224]
---

# SSP-200: Implement npc.dog_loose chase and npc.seagull chip theft and litter snatching

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** M · **Areas:** ai-npc, sim, test

## Summary

Add the two remaining animals: the loose Jack Russell that chases Bessie, and the seagull that steals chips and snatches litter. This includes the Tidy % accounting for stolen litter.

## Context

ENTITY_CATALOG §7.1/§7.3/§7.5.
- npc.dog_loose: 20x20 cell (<= 16x18), 8 directions with walk 4 / sit 2 / bark 2. Chases within 12 m, barking (bark frames, dog_bark), at 7.0 m/s, which out-runs Bessie at any brush-down speed (top 6.0). Horn -> sits for 3 s. With the brush raised (11.0 m/s) Bessie escapes. Hit: -300, 1 complaint; it rolls over (sit frames) and resumes the chase. Districts Wed, Thu (signature), Sun. Its grid already exists from M4 (the walker's dog with a coat swap); only the behaviour is new.
- npc.seagull: 16x16 (<= 14x10), 4 directions with walk 2 / fly 3. Steals chips from pedestrians (the pedestrian drops a litter.chip_wrapper and plays startle). Snatches litter just ahead of the brush: it picks a target item in front of the suction zone and flies off with it (seagull_squawk); the item is gone and scores nothing. No penalty and no collision. Spawned as flocks (NpcSpec flocks); Fri (signature), Sun.
Tidy % (ENTITY §17 Q6 default; adopt it): stolen litter is removed from both the numerator and the denominator. Keep a 'pinched' counter in the shift result for the Mercury ('Pinched by Sid/gulls'); SSP-208 reuses this accounting.
Open: the docs do not say which pedestrians carry chips. Proposal: a per-instance 'has chips' flag for shoppers spawned near takeaway/chip-shop frontages; document it in ENTITY_CATALOG.
Add a placeholder seagull grid if none exists (real art in SSP-224). Add entities.json rows (milestone M6) and one behaviour file each (dogLoose.ts, seagull.ts).

## Scope

- src/sim/npc/behaviours/dogLoose.ts and seagull.ts, with entities.json rows
- Stolen litter removed from the Tidy % numerator and denominator, plus a pinched counter in ShiftResult
- Chip-carrying pedestrian flag and the chip-theft drop of litter.chip_wrapper
- Placeholder seagull grid and manifest entry, if missing
- Unit tests per rule; Tidy % property test updated for theft

## Out of scope

- Seagull final art (SSP-224)
- Rival sweeper theft (SSP-208)

## Acceptance criteria

- [ ] Unit test: the dog starts chasing when Bessie is within 12 m and moves at 7.0 m/s
- [ ] Unit test: a horn within radius makes the dog sit for 3 s (180 ticks)
- [ ] Unit test: a dog hit gives -300 and 1 complaint, and the dog resumes chasing after the roll-over
- [ ] Unit test: a seagull snatch removes the item, awards 0 points, and the removal leaves Tidy % unchanged
- [ ] Unit test: chip theft spawns exactly one litter.chip_wrapper at the pedestrian and triggers startle
- [ ] Property test: Tidy % stays in [0,1] with theft events
- [ ] entityCatalog, simPurity and replay tests pass; ENTITY_CATALOG documents the chip-carrier rule

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:replay

## Dependencies

**Depends on:**

- [SSP-080](../M3/SSP-080-npc-store-spawner.md) Add the NPC store, behaviour registry, spawner and phase 7 of the tick
- [SSP-088](../M3/SSP-088-behaviour-market-trader-pigeon.md) Implement market trader (with market close pile) and pigeon flocks with Pigeon Scatter
- [SSP-082](../M3/SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-147](../M4/SSP-147-animals-pigeon-dog.md) Hand-author npc.pigeon and the npc.dog_loose grid with coat swap
- [SSP-064](../M2/SSP-064-tidy-frontages.md) Compute Tidy %, per-frontage clean % and Clean Sweep bonuses incrementally
- [SSP-057](../M2/SSP-057-litter-field.md) Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn
- [SSP-295](../M5/SSP-295-vertical-slice-gate.md) Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR

**Blocks:**

- [SSP-204](SSP-204-district-gasworks.md) Author and compile district.gasworks (Wednesday, rain) with its district replay
- [SSP-206](SSP-206-district-conker-hill.md) Author and compile district.conker_hill (Thursday, wind and leaf fall)
- [SSP-208](SSP-208-rival-sweeper-cameo.md) Implement veh.rival_sweeper Friday cameo and the rival_cameo event
- [SSP-209](SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-215](SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-224](SSP-224-art-grids-m6.md) Art Pass 2: seagull, loose dog, remaining collectibles, upgrade icons and small props

## References

- ../../ENTITY_CATALOG.md#71-stats-and-sprites
- ../../ENTITY_CATALOG.md#73-loose-dog-npcdog_loose
- ../../ENTITY_CATALOG.md#75-seagull-npcseagull
- ../../ENTITY_CATALOG.md#17-open-questions
- ../../TECHNICAL_DESIGN.md#111-behaviour-system

## Roadmap tasks covered

- Animals: `npc.dog_loose` (behaviour), `npc.seagull` (chip theft, litter snatching).
