---
id: SSP-059
title: "Implement brush.ts state machine, suction, inlet collection and fling roll"
milestone: M2
status: done
type: feature
estimate: L
labels: [type:feature, area:sim, area:gameplay, area:test, size:L, vertical-slice]
depends_on: [SSP-057, SSP-058, SSP-028, SSP-030, SSP-038]
blocks: [SSP-060, SSP-061, SSP-063, SSP-093, SSP-096, SSP-299, SSP-176, SSP-180, SSP-181, SSP-188, SSP-208, SSP-237, SSP-279]
---

# SSP-059: Implement brush.ts state machine, suction, inlet collection and fling roll

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** feature · **Size:** L · **Areas:** sim, gameplay, test · **Vertical slice**

## Summary

Build `src/sim/brush.ts`: raise/lower and RPM spin-up, the gutter sweep-in, suction pull and inlet collection against the LitterField, the speed-based fling roll and bulldozing at a full hopper. This is the heart of Pillar 3 (thorough vs fast).

## Context

Geometry (vehicle-local, origin at body centre, +y forward, metres; TECHNICAL_DESIGN §10.1): gutter brushes are circles r 0.45 at (±0.85, +1.75), reach ±1.30, swept width 2.6 m (≈ 42 px), pushing item velocity toward x = 0 and slightly backward; suction rect x ∈ [−1.3, 1.3], y ∈ [+1.6, +2.8], pulling items toward the inlet centre at 3.0 m/s × rpm × suctionMult (base 1); inlet rect 1.0 × 0.4 m centred at (0, +1.2), an item whose centre enters is collected unless the hopper is full. Body front is y +1.625.
Timing (TECHNICAL_DESIGN §8.3, GDD §8.2): raise/lower 0.5 s (30 ticks, brushPos 0↔1), RPM spin-up 0.6 s (36 ticks). Collecting requires `brushPos == 1 && rpm >= 0.8`. States Raised → Lowering → SpinningUp → Collecting → Bulldozing (at full) → Raising (GDD §8.2 state diagram), using the `as const` object + union pattern (no enums). BRUSH input is a `pressed` edge (toggle, Space / pad A). The 6.0 m/s brush-down top speed applies once lowering starts (GDD §8.2, proposed); M1's vehicle already selects vTopBase 6.0/11.0, so feed it the brush state.
Fling (GDD §8.3, TECHNICAL_DESIGN §10.2): the first time an item touches the brush or suction zone in a contact episode, roll `p = clamp((v − t0) / 2.0, 0, 1)` on the `brush` stream (`sfc32(seed ^ hash32('brush'))`), t0 = 4.0 m/s (6.0 under `pwr.super_suction`: expose the hook; the power-up is M3). v is Bessie's speed |vLong|. On a fling, call litter.ts to start the arc and emit `EV.Fling`.
Collection: emit `EV.LitterCollected` (entity, x, y, kind), add LU to the hopper, increment `litterCollected`, swap-remove the item. Set IN_SUCTION on items inside the suction zone (drives the wobble animation).
Bulldozer (TECHNICAL_DESIGN §10.2): at full hopper, items reaching the inlet are PINNED just ahead of the front bumper and pushed along.
Open questions (choose a value, put it in tuning.json, note it in GDD §8.2 and the PR; all are tunable later): the gutter sweep-in velocity magnitude; RPM on raise (propose rpm drops to 0 when Raising starts); when a 'contact episode' ends (propose when the item leaves both brush circles and the suction rect).
Performance: one rotation per candidate item into vehicle-local space; no allocations per tick.

## Scope

- `src/sim/brush.ts` state machine, timers, geometry tests, suction, inlet collection, fling roll, bulldozing
- Brush-state-driven top speed selection in the vehicle step
- Events `EV.LitterCollected`, `EV.Fling`
- Unit tests for geometry and timing; fast-check fling property test

## Out of scope

- Grime erasing (SSP-060) and spray (SSP-061)
- Brush-up litter rules (banana spin-out, bin bag burst, leaf piles); dog mess is in SSP-061
- Upgrades (`upg.suction`, `upg.gutter_brooms`) and SSP-096 beyond exposed multipliers
- Brush SFX (M5)

## Acceptance criteria

- [x] Unit tests assert the gutter circle centres/radius, 2.6 m swept width, suction rect y +1.6 to +2.8 and inlet 1.0 × 0.4 m at y +1.2
- [x] An item placed in the inlet at rpm = 1 and brushPos = 1 is collected in one tick; no item is collected while rpm < 0.8 or brushPos < 1
- [x] From a Space press, lowering takes 30 ticks and spin-up 36 ticks (unit test)
- [x] Fling property test, 10,000 seeded trials per speed: 0 flings at v = 3.0 and 4.0 m/s, all flung at 6.0 m/s, and fling rate 0.25 ± 0.02 at 4.5, 0.50 ± 0.02 at 5.0, 0.75 ± 0.02 at 5.5 m/s
- [x] Each item rolls at most once per contact episode (unit test)
- [x] With the hopper full, inlet items become PINNED and are pushed ahead instead of collected, and no LU is added
- [x] Same seed and inputs give identical collection/fling results

## Verification

- npx vitest run tests/unit/brush.test.ts tests/property/fling.prop.test.ts
- npm test
- npm run test:replay
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-057](SSP-057-litter-field.md) Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn
- [SSP-058](SSP-058-hopper.md) Implement hopper.ts LU accounting, mass coupling and bulldozer state
- [SSP-028](../M1/SSP-028-sim-foundations.md) Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type
- [SSP-030](../M1/SSP-030-vehicle-model.md) Implement Bessie's kinematic bicycle model in src/sim/vehicle.ts
- [SSP-038](../M1/SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner

**Blocks:**

- [SSP-060](SSP-060-grime-mask.md) Implement dirt.ts grime mask, initial selection, footprint erase and Kerb Hugger
- [SSP-061](SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats
- [SSP-063](SSP-063-scoring-combo.md) Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger
- [SSP-093](../M3/SSP-093-hazards-grip-jolts.md) Implement hazard grip overrides, jolts, LU spills and the open-manhole hard stop
- [SSP-096](../M3/SSP-096-power-ups.md) Spawn power-ups on pavements, implement all six pwr.* effects, draw them
- [SSP-299](../M3/SSP-299-hud-brush-tidy-arrows.md) Add the Brush-o-meter, brush state ring, district name with Tidy % bar, and off-screen depot/hydrant arrows to the HUD
- [SSP-176](../M5/SSP-176-sfx-event-wiring.md) Wire sim events to sfx cues through a pure audio director
- [SSP-180](../M5/SSP-180-engine-synth.md) Implement engineSynth.ts: Bessie's diesel with load, misfire and tyre squeal
- [SSP-181](../M5/SSP-181-brush-suction-synth.md) Implement brushSynth.ts brush, suction fan, scrub crackle and bulldozer layers
- [SSP-188](../M6/SSP-188-upgrade-modifiers.md) Apply upg.* levels to the sim via tuning.ts modifiers and record loadout in replays
- [SSP-208](../M6/SSP-208-rival-sweeper-cameo.md) Implement veh.rival_sweeper Friday cameo and the rival_cameo event
- [SSP-237](../M7/SSP-237-assists-sim.md) Wire auto-brush, +60 s timer, Chill Shift and instant dump into the sim
- [SSP-279](../M9/SSP-279-rival-sweeper-sim.md) Give Spotless Sid a full sweeper in the sim: handling, brush, hopper, dumping

## References

- ../../TECHNICAL_DESIGN.md#101-brush-hitbox
- ../../TECHNICAL_DESIGN.md#102-litterfield-srcsimlitterts
- ../../TECHNICAL_DESIGN.md#83-brush-mechanics-state
- ../../GDD.md#81-brush-geometry
- ../../GDD.md#82-brush-states
- ../../GDD.md#83-the-fling-curve-pillar-3-in-one-formula
- ../../ENTITY_CATALOG.md#31-how-litter-is-collected
- ../../TECHNICAL_DESIGN.md#131-actions-and-the-inputframe

## Roadmap tasks covered

- `src/sim/brush.ts`: raise/lower 0.5 s, RPM spin-up 0.6 s, gutter sweep-in, suction pull at 3.0 m/s × RPM × multiplier, inlet collection.
- `Measurable check: Brush geometry — gutter circles r = 0.45 m at (±0.85, +1.75); swept width 2.6 m; suction rect y +1.6 to +2.8; inlet 1.0 × 0.4 m at y +1.2. Collects only with RPM ≥ 80%.`
- `Measurable check: Fling — pickup probability is 1 at ≤ 4.0 m/s, 0 at ≥ 6.0 m/s, and linear in between (10,000 seeded trials).`
