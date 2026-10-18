---
id: SSP-061
title: "Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats"
milestone: M2
status: todo
type: feature
estimate: M
labels: [type:feature, area:sim, area:gameplay, size:M, vertical-slice]
depends_on: [SSP-053, SSP-057, SSP-059, SSP-028, SSP-042, SSP-035]
blocks: [SSP-062, SSP-063, SSP-065, SSP-067, SSP-070, SSP-083, SSP-086, SSP-095, SSP-096, SSP-299, SSP-300, SSP-182, SSP-188, SSP-199, SSP-302]
---

# SSP-061: Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** feature · **Size:** M · **Areas:** sim, gameplay · **Vertical slice**

## Summary

Add `src/sim/water.ts` and a stain store: a water tank drained by holding Spray, a spray cone that cleans `stain.*` over time, hydrant refills, and the dog-mess brush-up rule that creates `stain.splat` with a −20 penalty, so spraying is a real mechanic in Puddle Lane.

## Context

Water (GDD §8.5, TECHNICAL_DESIGN §10.4): tank 100 units (`upg.water_tank` later); holding SPRAY (Left Shift / pad X, `buttons` held bit) uses 6 units/s (0.1 per tick) over a 2.6 m cone ahead; no effect when empty; never negative. Hydrant (`prop.hydrant`, positions from the compiled `props`): stop adjacent, refill 25 units/s (an empty base tank refills in 4 s). Depot bay refills to full on dump (called from shift.ts).
Tick phases (TECHNICAL_DESIGN §5.2): spray consumption and the cone test run in phase 5 (`water.ts`); stain cleaning progress is listed under phase 6 (Dirt). Expose a `cleanStainsInCone()`-style function that SSP-065 calls in phase 6.
Stains: store capacity 256 (TECHNICAL_DESIGN §7.1); fields position, kind, cleanProgress (seconds of spray received). A stain is cleaned when cleanProgress reaches its spray time from entities.json (1.0 s gum, 1.5 s milkshake, 2.0 s oil/chalk, splat = gum). Scored once, removed, emits a stain-cleaned event carrying kind and pts (scoring applies points and the chain).
Splat (ENTITY_CATALOG §4.2, §5; GDD §8.2): driving over `litter.dog_mess` while the brush is Raised removes the dog mess, creates `stain.splat` at that spot and applies −20 points via a scoring penalty hook (which also resets the combo chain). 'Driven over' = the item centre is inside Bessie's body OBB (1.75 × 3.25 m); document this in GDD §8.2. Cleaning a splat scores 0 and refunds nothing (ENTITY_CATALOG §17 Q8 default; resolve it here).
Puddle Lane has no authored stains (spraying is taught on Tuesday), but splats can appear there, and the vertical slice lists `stain.splat` spraying as M2.
Open questions (decide, put in tuning.json, update GDD §8.5; tunable later): spray cone geometry (propose apex at the front bumper y +1.625, 2.6 m long, widening to the 2.6 m brush band at its end); hydrant 'adjacent' (propose speed < 0.5 m/s and the hydrant within 1.5 m of Bessie's OBB).
Deferred: dust suppression and coughing (M3), spraying `haz.oil_slick` for +30 (M3), spraying pedestrians or Doris (M3), `pwr.water_can` (M3), spray VFX (M3) and synth (M5).

## Scope

- `src/sim/water.ts` tank, spray consumption, cone test, hydrant refill
- Stain store with spawn/clean/remove and a stain-cleaned event
- Dog-mess brush-up rule → `stain.splat` + −20 penalty via a scoring penalty hook
- Unit tests and a fast-check property (water never negative, never above capacity)
- Close ENTITY_CATALOG §17 Q8; document cone, adjacency and 'driven over' choices in GDD §8.2/§8.5

## Out of scope

- Authored stain spawning for other districts (M3/M6)
- Dust, oil slick, NPC spray reactions (M3)
- Visual/audio feedback for spray
- Combo/score arithmetic for stains (SSP-063)

## Acceptance criteria

- [ ] Holding Spray for 60 ticks uses exactly 6.0 units; spraying has no effect at 0 units
- [ ] Stopped next to a hydrant, an empty tank reaches 100 in 240 ticks (4.0 s) and never exceeds capacity
- [ ] A gum stain inside the cone is cleaned after 60 ticks of spray and emits exactly one stain-cleaned event; a stain outside the cone is untouched
- [ ] Driving brush-up over a dog mess removes it, creates a splat at its position and calls the penalty hook with −20
- [ ] Property test: 0 ≤ water ≤ capacity for any input sequence
- [ ] ENTITY_CATALOG §17 Q8 is marked resolved

## Verification

- npx vitest run tests/unit/water.test.ts tests/property/water.prop.test.ts
- npm test
- npm run test:replay
- npm run typecheck

## Dependencies

**Depends on:**

- [SSP-053](SSP-053-entities-tuning-seed.md) Seed entities.json with litter, stains and pickups; add M2 values to tuning.json
- [SSP-057](SSP-057-litter-field.md) Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn
- [SSP-059](SSP-059-brush.md) Implement brush.ts state machine, suction, inlet collection and fling roll
- [SSP-028](../M1/SSP-028-sim-foundations.md) Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type
- [SSP-042](../M1/SSP-042-puddle-lane-level.md) Author Puddle Lane map.txt and level.json (64×48) and commit compiled output
- [SSP-035](../M1/SSP-035-world-tick-order.md) Add World, EventQueue and fixed tick order with surface grip and kerb jolts

**Blocks:**

- [SSP-062](SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event
- [SSP-063](SSP-063-scoring-combo.md) Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger
- [SSP-065](SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-067](SSP-067-items-sprite-batch.md) Render litter, stains and site markers via the items instance batch
- [SSP-070](SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-083](../M3/SSP-083-behaviour-doris.md) Implement Doris (npc.old_woman): glare, fist-shake slowdown, spray chase, handbag whack
- [SSP-086](../M3/SSP-086-behaviour-dog-walker.md) Implement the dog walker with a lead line obstacle, Lead Tangle and dog mess drops
- [SSP-095](../M3/SSP-095-near-miss-dust-coughing.md) Add the near-miss bonus and dust coughing penalties
- [SSP-096](../M3/SSP-096-power-ups.md) Spawn power-ups on pavements, implement all six pwr.* effects, draw them
- [SSP-299](../M3/SSP-299-hud-brush-tidy-arrows.md) Add the Brush-o-meter, brush state ring, district name with Tidy % bar, and off-screen depot/hydrant arrows to the HUD
- [SSP-300](../M4/SSP-300-shift-map-overlay.md) Add the Tab shift map overlay: district map with frontage status, depot, skips and hydrants, without pausing
- [SSP-182](../M5/SSP-182-spray-beeper-synth.md) Add spray (sputter, dry pump, refill) and reverse-beeper voices to brushSynth
- [SSP-188](../M6/SSP-188-upgrade-modifiers.md) Apply upg.* levels to the sim via tuning.ts modifiers and record loadout in replays
- [SSP-199](../M6/SSP-199-people-kids-jogger.md) Implement npc.jogger, npc.kid_skateboard, npc.kid_chalk and school_out/population_wave
- [SSP-302](../M6/SSP-302-district-idea-barks.md) Extend Pam's prompt layer to the Tue–Sun 'new idea' barks and author them per district

## References

- ../../GDD.md#85-water
- ../../TECHNICAL_DESIGN.md#104-water-stains-and-dust
- ../../TECHNICAL_DESIGN.md#52-fixed-tick-order
- ../../ENTITY_CATALOG.md#5-stains-stain
- ../../ENTITY_CATALOG.md#42-behaviours-and-brush-up-rules
- ../../ENTITY_CATALOG.md#17-open-questions
- ../../GDD.md#82-brush-states

## Roadmap tasks covered

- `src/sim/water.ts`: tank, 2.6 m spray cone, hydrant refill, stain clearing.
- Measurable check: Water — 100 units; spray uses 6/s; hydrant refills 25/s when adjacent; required to clear `stain.*`.
