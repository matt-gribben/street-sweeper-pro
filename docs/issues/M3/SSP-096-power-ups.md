---
id: SSP-096
title: "Spawn power-ups on pavements, implement all six pwr.* effects, draw them"
milestone: M3
status: todo
type: feature
estimate: M
labels: [type:feature, area:sim, area:gameplay, area:render, area:ui, area:test, size:M, vertical-slice]
depends_on: [SSP-075, SSP-077, SSP-082, SSP-101, SSP-063, SSP-059, SSP-058, SSP-061, SSP-067]
blocks: [SSP-104, SSP-105, SSP-156, SSP-181]
---

# SSP-096: Spawn power-ups on pavements, implement all six pwr.* effects, draw them

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** sim, gameplay, render, ui, test · **Vertical slice**

## Summary

Spawn 1–3 power-ups per shift on pavements from the level spawn table or fixed positions, draw them in the world, collect them by body overlap, and apply all six effects with their durations. Show the active power-up and its countdown on the HUD.

## Context

From ENTITY_CATALOG §12, GDD §12.7 and LEVEL_DESIGN §9.6:
- 1–3 per shift on pavement tiles, from powerups.table or fixed `at` positions (placed, not random drops). Capacity: 16 pickups.
- Collected when Bessie's body OBB overlaps the pickup, whatever the brush state. Event for sfx.powerup.
- A timed power-up picked up while the same one is active restarts its timer; no stacking.

Effects:
- pwr.flask_of_tea: chain timer ×2 for 15 s (2.0 → 4.0 s).
- pwr.bacon_butty: top speeds ×1.3 for 10 s (brush down 6.0 → 7.8; transit 11.0 → 14.3 m/s). Clean-pickup speed stays 4.0 m/s.
- pwr.hi_vis: HiVis stimulus (all pedestrians yield and part) for 12 s, via SSP-082.
- pwr.super_suction: suction pull ×2 (3.0 → 6.0 m/s × RPM) and fling threshold 6.0 m/s for 10 s.
- pwr.wrench: +25 HP instantly, capped at 100; can clear the dented threshold (40 HP).
- pwr.water_can: +50 water instantly, capped at tank capacity (100 base).

World rendering: nothing draws pickups yet (M2 deferred power-ups). Draw them in the items batch at layer 3 with the 2-frame bob (24 ticks per frame) and the 1 px ground halo (ART_BIBLE §8.5), using placeholder pwr.* sprites (M2 made only the ones Puddle Lane used; SSP-101 adds the rest).

HUD (GDD §15.2): bottom-left icon plus m:ss countdown (e.g. TEA 0:11).

Open: the RNG stream for table draws is not named (streams: litter, grime, stains, hazards, npc, traffic, events, brush, weather). Propose a dedicated `pickups` stream (adding a stream does not reshuffle others), document it in TECHNICAL_DESIGN §7.3 and LEVEL_DESIGN §9, and flag it.

## Scope

- PickupStore and shift-start spawning (table or fixed positions, pavement-only).
- OBB overlap collection.
- Timed effects with restart-not-stack, applied through tuning modifiers (chain timer, vTop, suction, fling threshold), and instant effects with caps.
- Pickup drawing in the items batch (bob + halo).
- HUD power-up icon and countdown.
- tests/unit/powerups.test.ts.

## Out of scope

- collect.* Lost Property and Golden Crisp rules (not M3 tasks).
- Final pickup art (M4).

## Acceptance criteria

- [ ] Test: a level with powerups.count 2 spawns exactly 2 on pavement tiles, identically on reruns with the same seed.
- [ ] Test: tea makes the chain timer 240 ticks for 900 ticks, then 120; a second tea at tick 600 restarts the 900-tick duration (no 4× timer).
- [ ] Test: butty raises brush-down top speed to 7.8 m/s for 600 ticks; fling probability at 5.0 m/s is unchanged.
- [ ] Test: super suction gives fling probability 0 at 6.0 m/s and a pull speed of 6.0 × RPM.
- [ ] Test: wrench at 90 HP gives 100 HP; water can at 80 gives 100 with tank capacity 100.
- [ ] Test: hi-vis makes Doris yield for 720 ticks.
- [ ] A frozen-frame capture (opened with Read) shows the pickup on the pavement and, after collection, the HUD icon with an m:ss countdown; existing visual goldens pass.

## Verification

- npm test
- npm run test:replay
- npm run typecheck
- npm run lint
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-075](SSP-075-entity-data-freeze.md) Freeze the Mon–Tue entity set in entities.json and add M3 shared tuning
- [SSP-077](SSP-077-compile-spawn-specs.md) Compile NPC, traffic, hazard, knockable and power-up spawn specs from level.json
- [SSP-082](SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-101](SSP-101-placeholder-props-hazards.md) Add placeholder sprites for knockables, hazards, SSP-096 and High Street props
- [SSP-063](../M2/SSP-063-scoring-combo.md) Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger
- [SSP-059](../M2/SSP-059-brush.md) Implement brush.ts state machine, suction, inlet collection and fling roll
- [SSP-058](../M2/SSP-058-hopper.md) Implement hopper.ts LU accounting, mass coupling and bulldozer state
- [SSP-061](../M2/SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats
- [SSP-067](../M2/SSP-067-items-sprite-batch.md) Render litter, stains and site markers via the items instance batch

**Blocks:**

- [SSP-104](SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up
- [SSP-105](SSP-105-high-street-greybox.md) Author and compile the grey-box High Street (80×60) for Tuesday's NPCs
- [SSP-156](../M4/SSP-156-hud-final-art.md) Restyle the HUD and score popups with final fonts, icons and panels
- [SSP-181](../M5/SSP-181-brush-suction-synth.md) Implement brushSynth.ts brush, suction fan, scrub crackle and bulldozer layers

## References

- ../../ENTITY_CATALOG.md#12-power-ups-pwr
- ../../GDD.md#127-power-ups
- ../../LEVEL_DESIGN.md#96-power-ups-and-collectibles
- ../../GDD.md#152-hud-layout
- ../../ART_BIBLE.md#85-pickups-and-collectibles
- ../../ART_BIBLE.md#102-timing-table
- ../../TECHNICAL_DESIGN.md#73-randomness

## Roadmap tasks covered

- `Power-up spawning (1–3 per shift on pavements) and effects with durations.`
