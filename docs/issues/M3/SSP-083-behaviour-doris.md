---
id: SSP-083
title: "Implement Doris (npc.old_woman): glare, fist-shake slowdown, spray chase, handbag whack"
milestone: M3
status: todo
type: feature
estimate: M
labels: [type:feature, area:sim, area:ai-npc, area:gameplay, area:test, size:M, vertical-slice]
depends_on: [SSP-082, SSP-061]
blocks: [SSP-104, SSP-105, SSP-106, SSP-108, SSP-288, SSP-290, SSP-215, SSP-277]
---

# SSP-083: Implement Doris (npc.old_woman): glare, fist-shake slowdown, spray chase, handbag whack

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** sim, ai-npc, gameplay, test · **Vertical slice**

## Summary

Write src/sim/npc/behaviours/oldWoman.ts so Doris never yields, glares in Bessie's path, slows down when honked, chases and whacks when sprayed, and scatters her shopping when knocked over. She is the mascot antagonist and VS-4 (Charming Chaos) depends on her.

## Context

Doris, from TECHNICAL_DESIGN §11.2 (machinery) and ENTITY_CATALOG §6.3 (behaviour owner):
- Walk at 0.6 m/s with her trolley.
- Walk → Glare when Bessie blocks her path within 4 m (TECHNICAL_DESIGN §11.2; the catalog says 'within awareness radius' but also that she ignores the awareness radius, so use 4 m and align the catalog wording in the PR). She stops and faces Bessie (idle frames). Glare → Walk when the path has been clear for 1 s (60 ticks).
- Glare + Horn → FistShake (angry frames), then after 1.5 s (90 ticks) a slower walk at 0.4 m/s. The slowed duration is TBD (M3 tuning): pick a value, store it in entities.json, record it in the catalog.
- Spray (Walk or Glare) → Chase at 1.2 m/s. Whack every 1.0 s (60 ticks) when in reach, 2 HP per hit to Bessie. Give up when Bessie is more than 8 m away. She can only catch a stationary or reversing Bessie: that is the joke.
- Hit (Walk, Glare or Chase) → Fallen → GetUp → Angry → Walk (shared timings). Penalty −500, 2 C, 6 litter.spilled_shopping (SSP-082 handles drops from data).
- Never yields; ignores BeaconYield and the awareness radius. Only HiVis makes her part, grudgingly, for its 12 s.

The Spray stimulus comes from the M2 water spray cone (2.6 m ahead, 6 units/s). Add delivery of Spray to NPCs inside the cone if water.ts does not already do it. Spraying other pedestrians has no defined effect: deliver to everyone, only Doris reacts.

Open: the handbag reach distance is unspecified. Propose one from her radius (0.3 m) plus a small margin to Bessie's OBB edge, store it in entities.json, and flag it.

Puddle Lane: named spawn at anchor `1` (doris_home) at 70 s, walking to the zebra and corner shop and back (authored in SSP-104). One test file per behaviour is an M3 measurable check.

## Scope

- oldWoman.ts with state constants Walk, Glare, FistShake, SlowWalk, Chase, Fallen, GetUp, Angry and the transitions above.
- Spray stimulus delivery from water.ts to NPCs inside the cone (if missing).
- Handbag whack HP applied to Bessie (event for later SFX), clamped at 0; it can contribute to TOWED.
- tests/unit/behaviours/oldWoman.test.ts covering every rule.

## Out of scope

- A dedicated handbag-whack SFX (ENTITY_CATALOG §17 Q11, M5).
- Portrait and final sprite (M4/M6).
- The tutorial bark.

## Acceptance criteria

- [ ] Test: Doris never enters Yield under BeaconYield or awareness, and does enter Yield under HiVis.
- [ ] Test: with Bessie stopped 3 m ahead on her path, Doris enters Glare; once the path has been clear for 60 ticks she returns to Walk.
- [ ] Test: a horn during Glare leads to FistShake for 90 ticks, then a walk speed of 0.4 m/s.
- [ ] Test: spray leads to Chase at 1.2 m/s; a stationary Bessie in reach loses 2 HP every 60 ticks; Bessie more than 8 m away returns her to Walk.
- [ ] Test: a hit at ≥ 1.0 m/s closing speed costs −500 pts, adds 2 complaints and spawns 6 spilled shopping.
- [ ] `npm run test:replay` passes, with any hash change re-recorded and explained.

## Verification

- npm test
- npm run test:replay
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-082](SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-061](../M2/SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats

**Blocks:**

- [SSP-104](SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up
- [SSP-105](SSP-105-high-street-greybox.md) Author and compile the grey-box High Street (80×60) for Tuesday's NPCs
- [SSP-106](SSP-106-npc-stress-budget.md) Prove the NPC budget: 80 NPCs, 30 vehicles, 2,000 litter, allocation-free
- [SSP-108](SSP-108-penalty-table-test.md) Add the table-driven penalty and complaint test against entities.json
- [SSP-288](SSP-288-popups-speech-bubbles.md) Add src/ui/popups.ts: world-space score/penalty popups and NPC speech bubbles
- [SSP-290](SSP-290-tutorial-beats.md) Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events
- [SSP-215](../M6/SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-277](../M9/SSP-277-daily-modifiers.md) Implement Daily Shift modifiers as level knob overrides and extra events

## References

- ../../ENTITY_CATALOG.md#63-doris-npcold_woman
- ../../TECHNICAL_DESIGN.md#112-example-doris-npcold_woman
- ../../TECHNICAL_DESIGN.md#104-water-stains-and-dust
- ../../ART_BIBLE.md#102-timing-table

## Roadmap tasks covered

- Behaviours: `shopper.ts`, `oldWoman.ts`, `oldManFrame.ts`, ... (oldWoman.ts)
- `Exit (measurable): Behaviours: e.g. Doris never yields; horn makes her slower; spray makes her chase at 1.2 m/s with 2 HP per handbag hit.`
