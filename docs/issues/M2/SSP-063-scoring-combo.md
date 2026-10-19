---
id: SSP-063
title: "Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger"
milestone: M2
status: done
type: feature
estimate: M
labels: [type:feature, area:sim, area:gameplay, size:M, vertical-slice]
depends_on: [SSP-059, SSP-060, SSP-061, SSP-062, SSP-035]
blocks: [SSP-064, SSP-065, SSP-070, SSP-078, SSP-084, SSP-096, SSP-102, SSP-288, SSP-290, SSP-156, SSP-176, SSP-177, SSP-187, SSP-240]
---

# SSP-063: Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** feature · **Size:** M · **Areas:** sim, gameplay · **Vertical slice**

## Summary

Add `src/sim/scoring.ts` and `src/sim/combo.ts`, which consume each tick's gameplay facts in phase 9 to award item and stain points × combo multiplier, grime points and Kerb Hugger bonuses, and run the 2.0 s chain timer with tier changes and penalty resets.

## Context

Score (GDD §10.1) = Σ (item points × combo multiplier) + grime points + style bonuses − penalties. Item points come from entities.json (`litter.spilled_shopping` is 0 but still counts for the chain and Tidy %). Stains are pickups too: stain points × multiplier, and a stain clean refreshes the chain (ENTITY_CATALOG §17 Q5 default; resolve it here).
Combo (GDD §10.2): every pickup (litter collected, stain cleaned) adds 1 to the chain and refreshes a 2.0 s chain timer (120 ticks). Multipliers: chain 0–9 ×1; 10–24 ×2 'TIDY!'; 25–49 ×3 'SPOTLESS!'; 50–99 ×4 'IMMACULATE!'; 100+ ×5 'SWEEPING BEAUTY!'. Emit `EV.ComboTier` on each tier change. The multiplier applies after the increment: in the GDD §10.4 example the drink can that makes the chain 10 scores 15 × 2 = 30. Use that example as a unit test.
Rules: any penalty resets the chain (penalty API; M2's only penalty is the −20 splat from SSP-061). Grime neither builds nor breaks the chain. The chain timer is frozen while a dump drains (GDD §20 Q4; read `shift.isDraining`). `pwr.flask_of_tea` (timer ×2 to 4.0 s) is M3: expose a timer-multiplier hook.
Grime: 1 pt per cell, 2 pts per gutter cell (from dirt.ts per-tick counts).
Kerb Hugger: +50 per 3 s (180 ticks) of continuous kerb contact (dirt.ts flag). Style bonuses are not multiplied and do not extend the chain (GDD §10.3; §20 Q3 leaning neither; record it).
Clean Sweep +100 is awarded by SSP-064 through this module's bonus API.
This is tick phase 9; it reads facts from this tick's EventQueue/counters, never from render state. `complaints.ts` is M3 (leave its slot empty).

## Scope

- `src/sim/combo.ts` chain, timer, tiers, penalty reset, freeze hook, timer-multiplier hook
- `src/sim/scoring.ts` item, stain, grime, Kerb Hugger, bonus and penalty APIs
- `EV.ComboTier` emission
- Unit tests including the GDD §10.4 worked example; record GDD §20 Q3 and ENTITY_CATALOG §17 Q5 resolutions

## Out of scope

- Near miss, Pigeon Scatter, Caught!, complaints (M3)
- Pickup SFX pitch ladder (M5)
- Score popups (hud)

## Acceptance criteria

- [x] Tier thresholds at chain 10/25/50/100 give ×2..×5; the chain expires exactly 120 ticks after the last pickup
- [x] GDD §10.4 example reproduces 10 then 30 points and a 'TIDY!' `EV.ComboTier` at chain 10
- [x] A cleaned gum stain at ×2 scores 20 and extends the chain
- [x] A penalty resets the chain to 0 and the multiplier to ×1
- [x] The chain timer does not count down while `isDraining` is true
- [x] Grime scores 1 per cell and 2 per gutter cell; Kerb Hugger awards +50 at 180 continuous ticks and nothing at 179
- [x] Style bonuses are neither multiplied nor chain-extending; GDD §20 Q3 and ENTITY_CATALOG §17 Q5 are marked resolved

## Verification

- npx vitest run tests/unit/combo.test.ts tests/unit/scoring.test.ts
- npm test
- npm run test:replay
- npm run typecheck

## Dependencies

**Depends on:**

- [SSP-059](SSP-059-brush.md) Implement brush.ts state machine, suction, inlet collection and fling roll
- [SSP-060](SSP-060-grime-mask.md) Implement dirt.ts grime mask, initial selection, footprint erase and Kerb Hugger
- [SSP-061](SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats
- [SSP-062](SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event
- [SSP-035](../M1/SSP-035-world-tick-order.md) Add World, EventQueue and fixed tick order with surface grip and kerb jolts

**Blocks:**

- [SSP-064](SSP-064-tidy-frontages.md) Compute Tidy %, per-frontage clean % and Clean Sweep bonuses incrementally
- [SSP-065](SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-070](SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-078](../M3/SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-084](../M3/SSP-084-behaviour-shopper-businessman-litterbug.md) Implement shopper, businessman and litterbug behaviours, including the Caught! bonus
- [SSP-096](../M3/SSP-096-power-ups.md) Spawn power-ups on pavements, implement all six pwr.* effects, draw them
- [SSP-102](../M3/SSP-102-fx-placeholder-particles.md) Add placeholder particles in src/render/fx.ts for dust, splash and sparkle
- [SSP-288](../M3/SSP-288-popups-speech-bubbles.md) Add src/ui/popups.ts: world-space score/penalty popups and NPC speech bubbles
- [SSP-290](../M3/SSP-290-tutorial-beats.md) Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events
- [SSP-156](../M4/SSP-156-hud-final-art.md) Restyle the HUD and score popups with final fonts, icons and panels
- [SSP-176](../M5/SSP-176-sfx-event-wiring.md) Wire sim events to sfx cues through a pure audio director
- [SSP-177](../M5/SSP-177-music-state-machine.md) Implement the pure adaptive-music state machine for drums and lead stems
- [SSP-187](../M6/SSP-187-progression-economy.md) Add districts.json, upgrades.json and pure week progression and £ ledger
- [SSP-240](../M7/SSP-240-juice-squash-popups.md) Juice pass: squash-and-stretch, combo popups and the cat roof-ride

## References

- ../../GDD.md#101-points
- ../../GDD.md#102-combo-chain
- ../../GDD.md#103-style-bonuses
- ../../GDD.md#104-example-10-seconds
- ../../GDD.md#91-grime
- ../../TECHNICAL_DESIGN.md#72-event-queue
- ../../TECHNICAL_DESIGN.md#181-unit-tests-examples
- ../../ENTITY_CATALOG.md#17-open-questions

## Roadmap tasks covered

- `src/sim/scoring.ts` and `combo.ts`: item points × multiplier, grime 1 pt per cell (2 for gutter grime), Kerb Hugger +50 per 3 s, Clean Sweep frontage +100 (...). (points, combo, grime, Kerb Hugger)
- `Measurable check: Combo — chain timer 2.0 s; tier thresholds 10/25/50/100; any penalty resets the chain (hook only).`
