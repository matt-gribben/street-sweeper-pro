---
id: SSP-208
title: "Implement veh.rival_sweeper Friday cameo and the rival_cameo event"
milestone: M6
status: todo
type: feature
estimate: M
labels: [type:feature, area:ai-npc, area:sim, area:test, size:M]
depends_on: [SSP-200, SSP-059, SSP-057, SSP-089]
blocks: [SSP-209, SSP-222, SSP-279, SSP-281]
---

# SSP-208: Implement veh.rival_sweeper Friday cameo and the rival_cameo event

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** M · **Areas:** ai-npc, sim, test

## Summary

Spotless Sid drives in on Friday, sweeps a fixed route stealing litter with Bessie's own inlet rules, and leaves. The player races him to the eastern Parade.

## Context

ENTITY_CATALOG §8.2: veh.rival_sweeper, Spotless Sid's sweeper, appears as a Friday cameo (Rival Sweep mode is M9 and out of scope). It steals litter using the same inlet rules as Bessie; solid; horn. Event rival_cameo {at, untilS, route} (LEVEL_DESIGN §4.3): Friday 110-170 s on the eastern half of Marine Parade (§5.5). Sid never collides deliberately (GDD §13.5). Stolen litter is removed from both the numerator and the denominator of Tidy % and counted as 'Pinched by Sid' for the Mercury (ENTITY §17 Q6; shared accounting from SSP-200). Sprite: a build-time `rival` swap table applied to Bessie's built frames (body 15->07, 14->06, 16->07, cab 07->22, stripe 26->22; green and white), using runtime slot 1 only for his beacon (ART_BIBLE §5.6); cell 64x64, body 28x52. For this issue a placeholder under the final ID (e.g. Bessie's frames aliased) is enough; the forge table lands in SSP-222. entities.json row milestone M6, districts Fri. Sid's brush collection must reuse the brush.ts inlet geometry deterministically; do not duplicate it.

## Scope

- rival_sweeper route follower with brush-down collection using the shared inlet logic
- rival_cameo event: enter at `at`, sweep the route, leave by untilS
- Pinched-by-Sid count added to the ShiftResult pinched counter
- entities.json row, placeholder sprite, unit tests, replay

## Out of scope

- Rival Sweep mode and AI difficulty (M9)
- Rival swap table art (SSP-222)

## Acceptance criteria

- [ ] Unit test: Sid collects an item placed in his inlet path, and the removal leaves Tidy % unchanged
- [ ] Unit test: Sid enters no earlier than `at` and has left the map by untilS
- [ ] Unit test: Sid's steering avoids Bessie (no contact in a head-on fixture)
- [ ] ShiftResult exposes a pinched count that includes both Sid and seagull thefts
- [ ] A replay with the cameo is committed and passing

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:replay

## Dependencies

**Depends on:**

- [SSP-200](SSP-200-dog-loose-seagull.md) Implement npc.dog_loose chase and npc.seagull chip theft and litter snatching
- [SSP-059](../M2/SSP-059-brush.md) Implement brush.ts state machine, suction, inlet collection and fling roll
- [SSP-057](../M2/SSP-057-litter-field.md) Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn
- [SSP-089](../M3/SSP-089-traffic-lane-following.md) Implement traffic.ts: lane following, queuing behind Bessie, honk, Road Rage, bus stops

**Blocks:**

- [SSP-209](SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-222](SSP-222-art-vehicles-m6.md) Art Pass 2: Blender renders for bin lorry, ice cream van, police and Sid's sweeper
- [SSP-279](../M9/SSP-279-rival-sweeper-sim.md) Give Spotless Sid a full sweeper in the sim: handling, brush, hopper, dumping
- [SSP-281](../M9/SSP-281-rival-sweep-flow.md) Ship the Rival Sweep mode: district pick, 180 s duel HUD, winner tally

## References

- ../../ENTITY_CATALOG.md#82-behaviour-collision-and-districts
- ../../LEVEL_DESIGN.md#43-event-catalogue
- ../../LEVEL_DESIGN.md#55-fri-the-promenade-districtpromenade
- ../../GDD.md#42-cast
- ../../ART_BIBLE.md#56-ramp-swaps-per-instance-palette-variants

## Roadmap tasks covered

- Vehicles: ... `veh.rival_sweeper` (Friday cameo) ...
