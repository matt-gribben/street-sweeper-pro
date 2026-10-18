---
id: SSP-084
title: "Implement shopper, businessman and litterbug behaviours, including the Caught! bonus"
milestone: M3
status: todo
type: feature
estimate: M
labels: [type:feature, area:sim, area:ai-npc, area:gameplay, area:test, size:M, vertical-slice]
depends_on: [SSP-082, SSP-063]
blocks: [SSP-104, SSP-105, SSP-108, SSP-288, SSP-203, SSP-215]
---

# SSP-084: Implement shopper, businessman and litterbug behaviours, including the Caught! bonus

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** sim, ai-npc, gameplay, test · **Vertical slice**

## Summary

Write shopper.ts (the baseline yielder), businessman.ts (phone-blind until 2 m, crosses without looking) and litterbug.ts (drops litter until honked within 6 m for Caught! +100).

## Context

From ENTITY_CATALOG §6.1–6.2:

npc.shopper
- 1.3 m/s. Wanders pavements on the nav graph, crosses at crossings, sidesteps at 4 m (inside the 6 m awareness radius, GDD §20 Q11). Idles at shop windows (idle at frontage doors).
- 8 outfit swaps: per-instance swap index 0–7 drawn from the npc stream, stored in NpcStore.swap.
- Hit: −250, 1 C, ped_oi.

npc.businessman
- 1.4 m/s. Stares at his phone and ignores Bessie until 2 m, then startles. Crosses without looking (jaywalk opt-in).
- Ignores the awareness radius and the LED beacon; reacts to the horn. Yields under HiVis.
- Hit: −250, 1 C. Districts include Tue.

npc.litterbug
- 1.4 m/s. Drops one item every 3–5 s (180–300 ticks, npc stream) from the district litter table. Drops count toward litter spawned (Tidy % denominator) and respect the 2,000 live-litter cap.
- Honk within 6 m → Caught! +100: he slinks off the map (walk, head down) and stops dropping.
- Caught! is a style bonus: not multiplied by the combo and does not extend the chain (GDD §10.3).
- The honk that lands Caught! does not count toward horn spam: set the hook/flag from SSP-078 in phase 7.
- Hit: −250, 1 C.

Tuesday population waves (litterbug +2 at 90 s; shopper +8 from 120 to 180 s) come from level population and caps, authored in SSP-105.

## Scope

- shopper.ts, businessman.ts and litterbug.ts extending the generic pedestrian behaviour.
- The Caught! style-bonus fact, scored in phase 9 and emitted as an event, with the horn-spam exemption.
- Litterbug dynamic drops through litter.ts within the cap.
- One test file per behaviour under tests/unit/behaviours/.

## Out of scope

- Speech bubbles and popup art.
- Wed–Sun shopper content.

## Acceptance criteria

- [ ] shopper.test.ts: sidesteps when Bessie's predicted path comes within 4 m; the swap index is in 0–7 and identical across reruns with the same seed; a hit costs −250 and 1 C.
- [ ] businessman.test.ts: no Aware or Yield reaction at 5 m even with a 10 m beacon radius; startles at ≤ 2 m; startles on a horn 7 m away; yields under HiVis; a hit costs −250 and 1 C.
- [ ] litterbug.test.ts: drops one item every 180–300 ticks; a honk 5.9 m away awards exactly +100 once, enters the slinking state, stops drops, and is not counted toward horn spam; a honk 6.1 m away awards no Caught! and he keeps dropping.
- [ ] Caught! points are not multiplied by the combo and do not change the chain length.
- [ ] Replays pass or are re-recorded with a reason.

## Verification

- npm test
- npm run test:replay
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-082](SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-063](../M2/SSP-063-scoring-combo.md) Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger

**Blocks:**

- [SSP-104](SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up
- [SSP-105](SSP-105-high-street-greybox.md) Author and compile the grey-box High Street (80×60) for Tuesday's NPCs
- [SSP-108](SSP-108-penalty-table-test.md) Add the table-driven penalty and complaint test against entities.json
- [SSP-288](SSP-288-popups-speech-bubbles.md) Add src/ui/popups.ts: world-space score/penalty popups and NPC speech bubbles
- [SSP-203](../M6/SSP-203-district-high-street-final.md) Bring district.high_street to final M6 quality with collectibles and 3-star replay
- [SSP-215](../M6/SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map

## References

- ../../ENTITY_CATALOG.md#61-stats
- ../../ENTITY_CATALOG.md#62-behaviours
- ../../GDD.md#103-style-bonuses
- ../../GDD.md#20-open-design-questions
- ../../ART_BIBLE.md#56-ramp-swaps-per-instance-palette-variants

## Roadmap tasks covered

- Behaviours: `shopper.ts`, ... `businessman.ts`, `litterbug.ts` ...
- `Horn (8 m radius), near miss (+25), Pigeon Scatter (+25), Caught! (+100), dust coughing (Caught! part)`
