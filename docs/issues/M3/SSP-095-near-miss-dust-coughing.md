---
id: SSP-095
title: "Add the near-miss bonus and dust coughing penalties"
milestone: M3
status: done
type: feature
estimate: S
labels: [type:feature, area:sim, area:gameplay, area:test, size:S, vertical-slice]
depends_on: [SSP-082, SSP-078, SSP-060, SSP-061]
blocks: [SSP-102, SSP-104, SSP-108, SSP-155, SSP-199, SSP-204]
---

# SSP-095: Add the near-miss bonus and dust coughing penalties

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** S · **Areas:** sim, gameplay, test · **Vertical slice**

## Summary

Award +25 for passing within 0.5 m of a pedestrian at more than 3 m/s without contact. Penalise dust: −10 per pedestrian per 2 s within 3 m of a dust cloud. Add dust cloud emission if M2 did not.

## Context

Near miss (ENTITY_CATALOG §3.4, GDD §10.3)
- Within 0.5 m of a pedestrian at > 3 m/s without contact = +25; the pedestrian plays Startle (NearMiss stimulus).
- Style bonus: not multiplied, does not extend the chain.
- One award per pedestrian per pass: award at closest approach while within 0.5 m with no contact; re-arm after the distance exceeds a margin (propose 1.5 m; flag it). A contact in the same pass is a hit, not a near miss.

Dust (GDD §8.6, TECHNICAL_DESIGN §10.4)
- Brush down on dusty tiles without spray emits a dust cloud. Dusty ground: `%` (yard/gravel, LEVEL_DESIGN §8.3) plus roadworks.
- Emission: one cloud per brush every 7 ticks (matching fx.dust_puff, ART_BIBLE §11). Cloud lifetime is unspecified: propose 30 ticks (the puff's 6 × 5 ticks); flag it.
- Pedestrians within 3 m of a live cloud cough (startle frames; fx.cough event): −10 per pedestrian per 2 s, no complaint. Timer: the first cough after 120 continuous ticks in range, then every 120 ticks; leaving range resets it.
- Coughs are penalties, so they reset the chain (GDD §10.2; §20 Q8).
- Spray suppresses dust.
- M2 deferred coughing (needs NPCs). If dirt.ts (phase 6) does not emit dust clouds, add emission here.

## Scope

- Near-miss detection in phase 7, style bonus fact and NearMiss stimulus.
- Dust cloud emission in dirt.ts (if missing) and the per-pedestrian cough timer with its penalty fact.
- Events for the fx and audio layers.
- Tests.

## Out of scope

- Gasworks dust content (M6).
- VFX art (SSP-102 consumes these events).

## Acceptance criteria

- [x] Test: passing a pedestrian at 0.4 m and 3.5 m/s awards +25 once and startles them; at 0.6 m, or at 2.9 m/s, no award; contact gives a hit, not a near miss.
- [x] Test: the near-miss bonus is not multiplied and does not change the chain length.
- [x] Test: a pedestrian standing 2.5 m from continuously emitted dust for 240 ticks costs exactly −20, resets the chain, and adds no complaint.
- [x] Test: brushing a dusty tile while spraying emits no dust cloud.

## Verification

- npm test
- npm run test:replay
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-082](SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-078](SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-060](../M2/SSP-060-grime-mask.md) Implement dirt.ts grime mask, initial selection, footprint erase and Kerb Hugger
- [SSP-061](../M2/SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats

**Blocks:**

- [SSP-102](SSP-102-fx-placeholder-particles.md) Add placeholder particles in src/render/fx.ts for dust, splash and sparkle
- [SSP-104](SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up
- [SSP-108](SSP-108-penalty-table-test.md) Add the table-driven penalty and complaint test against entities.json
- [SSP-155](../M4/SSP-155-vfx-reactions.md) Procedural VFX for reactions and damage: impact star, cough, anger, smoke
- [SSP-199](../M6/SSP-199-people-kids-jogger.md) Implement npc.jogger, npc.kid_skateboard, npc.kid_chalk and school_out/population_wave
- [SSP-204](../M6/SSP-204-district-gasworks.md) Author and compile district.gasworks (Wednesday, rain) with its district replay

## References

- ../../ENTITY_CATALOG.md#34-generic-pedestrian-reaction-model
- ../../GDD.md#103-style-bonuses
- ../../GDD.md#86-dust
- ../../GDD.md#102-combo-chain
- ../../TECHNICAL_DESIGN.md#104-water-stains-and-dust
- ../../ART_BIBLE.md#11-vfx

## Roadmap tasks covered

- `Horn (8 m radius), near miss (+25), Pigeon Scatter (+25), Caught! (+100), dust coughing (−10 per pedestrian per 2 s). (near miss, dust)`
- `Deliverable: near-miss detection, dust coughing`
