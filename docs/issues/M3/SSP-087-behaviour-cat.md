---
id: SSP-087
title: "Implement the cat: perch, dart on approach, groom, bolt, and ride Bessie's roof"
milestone: M3
status: done
type: feature
estimate: M
labels: [type:feature, area:sim, area:ai-npc, area:gameplay, area:test, size:M, vertical-slice]
depends_on: [SSP-082, SSP-090]
blocks: [SSP-103, SSP-104, SSP-106, SSP-108, SSP-288, SSP-290, SSP-206, SSP-212, SSP-215, SSP-240]
---

# SSP-087: Implement the cat: perch, dart on approach, groom, bolt, and ride Bessie's roof

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** sim, ai-npc, gameplay, test · **Vertical slice**

## Summary

Write src/sim/npc/behaviours/cat.ts so the cat perches on walls and parked car roofs, darts across the road when Bessie approaches (40%, rolled once per approach), grooms mid-road, bolts at the horn, and when hit leaps onto Bessie's roof and rides it for 3 s.

## Context

From ENTITY_CATALOG §7.2 and TECHNICAL_DESIGN §11.3:
- States: `CAT = { Perch, Dart, Groom, Bolt, LeapOnRoof, RideRoof, HopOff }` as const.
- Perch → Dart when Bessie is 6–10 m away, 40% roll ONCE per approach (npc stream) so it cannot be farmed. Approach = entering the 6–10 m band; the roll re-arms only after Bessie goes beyond 10 m.
- Dart crosses the road at 6.0 m/s (jaywalk) and returns to Perch on the far side.
- Perch → Groom on an idle timer when a mid-road spot is available.
- Groom → Bolt on a horn or Bessie within 4 m. Perch → Bolt on a horn. Bolt (dart frames, away from Bessie) → Perch at cover.
- Hit during Dart or Groom (closing speed ≥ 1.0 m/s) → LeapOnRoof (leap 3 frames: squash 4, stretch 6, land 6 ticks = 16) → RideRoof for 3 s (180 ticks), pose parented to Bessie's local frame (ON_ROOF flag + local offset) → HopOff → Perch.
- Penalty −300, 1 C ('Not the cat!', cat_yowl). The cat is never hurt. Cat circle r = 0.2 m.
- Perches: walls `w` and parked car roofs (veh.*_parked roof points from SSP-090), from level `perches`.
- While riding, the renderer draws it on layer 9 using sit frames (SSP-103).
- Puddle Lane has 4 cats: 2 on garden walls, 2 on parked car roofs.

The groom idle timer and bolt speed are not given: propose values, store them in entities.json, flag them.

## Scope

- cat.ts with all states, the once-per-approach roll, and roof parenting.
- Perch placement on walls and parked car roofs at spawn.
- tests/unit/behaviours/cat.test.ts.

## Out of scope

- Squash-and-stretch juice beyond the authored leap frames (M7).
- Cat sprite (SSP-099).

## Acceptance criteria

- [ ] Test: over 10,000 seeded approaches the dart rate is 40% ± 2%, and staying inside the band never re-rolls.
- [ ] Test: a dart moves at 6.0 m/s.
- [ ] Test: a horn while Grooming or Perched enters Bolt; Bessie within 4 m of a grooming cat enters Bolt.
- [ ] Test: a hit during Dart costs −300 and 1 C, enters LeapOnRoof for 16 ticks, then RideRoof for exactly 180 ticks during which the cat's world pose follows Bessie, then HopOff and Perch.
- [ ] Test: perch placement puts cats only on `w` tiles or parked car roof points.
- [ ] Replays pass or are re-recorded with a reason.

## Verification

- npm test
- npm run test:replay
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-082](SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-090](SSP-090-traffic-parked-collision.md) Add parked cars and Bessie-vs-vehicle collision with dent and impact rules

**Blocks:**

- [SSP-103](SSP-103-render-actors-traffic.md) Draw NPCs, animals, traffic, knockables and hazards with state-driven frames
- [SSP-104](SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up
- [SSP-106](SSP-106-npc-stress-budget.md) Prove the NPC budget: 80 NPCs, 30 vehicles, 2,000 litter, allocation-free
- [SSP-108](SSP-108-penalty-table-test.md) Add the table-driven penalty and complaint test against entities.json
- [SSP-288](SSP-288-popups-speech-bubbles.md) Add src/ui/popups.ts: world-space score/penalty popups and NPC speech bubbles
- [SSP-290](SSP-290-tutorial-beats.md) Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events
- [SSP-206](../M6/SSP-206-district-conker-hill.md) Author and compile district.conker_hill (Thursday, wind and leaf fall)
- [SSP-212](../M6/SSP-212-district-kebab-mile.md) Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden
- [SSP-215](../M6/SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-240](../M7/SSP-240-juice-squash-popups.md) Juice pass: squash-and-stretch, combo popups and the cat roof-ride

## References

- ../../ENTITY_CATALOG.md#72-cat-npccat
- ../../TECHNICAL_DESIGN.md#113-example-cat-npccat
- ../../ART_BIBLE.md#102-timing-table
- ../../LEVEL_DESIGN.md#94-npcs

## Roadmap tasks covered

- Behaviours: ... `cat.ts` ...
- `Exit (measurable): The cat darts at 6–10 m with 40% probability; a hit makes it ride the roof for 3 s.`
