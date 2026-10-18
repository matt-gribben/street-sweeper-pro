---
id: SSP-188
title: "Apply upg.* levels to the sim via tuning.ts modifiers and record loadout in replays"
milestone: M6
status: todo
type: feature
estimate: M
labels: [type:feature, area:sim, area:physics, area:test, size:M]
depends_on: [SSP-187, SSP-029, SSP-030, SSP-038, SSP-058, SSP-059, SSP-061, SSP-078, SSP-080]
blocks: [SSP-189, SSP-193, SSP-204, SSP-206, SSP-209, SSP-212, SSP-215]
---

# SSP-188: Apply upg.* levels to the sim via tuning.ts modifiers and record loadout in replays

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** M · **Areas:** sim, physics, test

## Summary

Make every upgrade change the deterministic sim through src/sim/tuning.ts at shift start, and add the loadout to the replay format, so that a run remains a function of seed, district, loadout and input log.

## Context

Values (ENTITY_CATALOG §14.1, mirrored in src/data/upgrades.json):
- hopper 100 -> 140 -> 180 LU
- suction pull 3.0 -> 3.75 -> 4.5 m/s x RPM (zone +25%/+50%)
- gutter brooms reach +0.15/+0.30 m per side, swept width 2.6 -> 2.9 -> 3.2 m
- water tank 100 -> 150 -> 200
- engine: transit top speed 11.0 -> 12.1 -> 13.2 m/s and accel 2.4 -> 2.64 -> 2.88 m/s²
- tyres: all grip x1.15 (asphalt 9.0 -> 10.35, oil 1.2 -> 1.38, puddle 4.0 -> 4.6, wet leaves 3.0 -> 3.45, rain road 6.0 -> 6.9)
- bumper: impact damage x0.6 (4 -> 2.4 HP per m/s above 2 m/s)
- two-tone horn: radius 8 -> 12 m, horn-spam threshold 3 -> 5 honks
- LED beacon: pedestrian awareness 6 -> 10 m (Doris and the businessman are unaffected)

The full-hopper penalties (accel x0.70, top speed x0.90, steer x0.85, +1,500 kg) scale with FILL FRACTION, so a bigger hopper is lighter at any given LU. Design rules (GDD §12.4): no upgrade changes the 4.0 m/s clean-pickup speed or the fling ramp, p_fling(v) = clamp((v - 4.0)/2.0, 0, 1) (GDD §8.3), and upgrades take effect from the next shift. The collision property test already uses 17.2 m/s (transit 11 x engine L2 1.2 x Bacon Butty 1.3); keep it passing.

Replay format (TECHNICAL_DESIGN §18.3) gains an optional `loadout` object (upg id -> level). Absent means stock, and every existing replay hash must stay byte-identical. Par loadouts per day (LEVEL_DESIGN §6.2): Mon stock; Tue hopper L1; Wed same; Thu + gutter brooms L1; Fri + engine L1; Sat + suction L1; Sun + hopper L2. District replays will use these. Sim purity rules apply: no per-tick allocation, no Math.random/Date.

## Scope

- src/sim/tuning.ts: build an effective tuning object from tuning.json plus a loadout, once at shift start (no per-tick allocation)
- Wire each modifier into its owning sim module: hopper, brush, water, vehicle, collision damage, horn/complaints, NPC awareness radius
- Optional replay `loadout` field, read and written by the replay runner and the SSP-048 recorder
- Unit test per upgrade level asserting the values above
- Property test: at every level, hopper LU never exceeds capacity and water never exceeds tank size
- Commit a new replay with every upgrade at max level, with its hash

## Out of scope

- WorkshopScene UI and purchasing (SSP-193)
- Visible upgrade overlays on Bessie (GDD §12.4 proposed, not a roadmap task)
- Price changes

## Acceptance criteria

- [ ] All existing replays pass with unchanged hashes (stock loadout)
- [ ] Unit tests confirm each ENTITY_CATALOG §14.1 value for L1 and L2
- [ ] Unit test: with upg.tyres, rain road grip is 6.9 and oil is 1.38
- [ ] Unit test: with upg.led_beacon a shopper becomes Aware at 10 m while Doris does not
- [ ] Unit test: at every loadout the clean-pickup speed is 4.0 m/s and p_fling is 0 at 4.0 m/s, 0.5 at 5.0 m/s and 1 at 6.0 m/s
- [ ] tests/replay/replays/m6_max_loadout.json is committed and passing
- [ ] simPurity and the zero-allocation replay heap check still pass

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:replay

## Dependencies

**Depends on:**

- [SSP-187](SSP-187-progression-economy.md) Add districts.json, upgrades.json and pure week progression and £ ledger
- [SSP-029](../M1/SSP-029-tuning-data.md) Create tuning.json vehicle.sweeper block and typed src/sim/tuning.ts
- [SSP-030](../M1/SSP-030-vehicle-model.md) Implement Bessie's kinematic bicycle model in src/sim/vehicle.ts
- [SSP-038](../M1/SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner
- [SSP-058](../M2/SSP-058-hopper.md) Implement hopper.ts LU accounting, mass coupling and bulldozer state
- [SSP-059](../M2/SSP-059-brush.md) Implement brush.ts state machine, suction, inlet collection and fling roll
- [SSP-061](../M2/SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats
- [SSP-078](../M3/SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-080](../M3/SSP-080-npc-store-spawner.md) Add the NPC store, behaviour registry, spawner and phase 7 of the tick

**Blocks:**

- [SSP-189](SSP-189-scripted-runs.md) Generalise scripted-run authoring for district replays, balance runs and week e2e
- [SSP-193](SSP-193-workshop-liveries.md) Build WorkshopScene with upgrade purchases and Bessie livery ramp swaps
- [SSP-204](SSP-204-district-gasworks.md) Author and compile district.gasworks (Wednesday, rain) with its district replay
- [SSP-206](SSP-206-district-conker-hill.md) Author and compile district.conker_hill (Thursday, wind and leaf fall)
- [SSP-209](SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-212](SSP-212-district-kebab-mile.md) Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden
- [SSP-215](SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map

## References

- ../../ENTITY_CATALOG.md#141-upgrades
- ../../GDD.md#124-upgrades
- ../../GDD.md#83-the-fling-curve-pillar-3-in-one-formula
- ../../LEVEL_DESIGN.md#62-par-times-the-target-times
- ../../TECHNICAL_DESIGN.md#183-deterministic-replay-tests
- ../../ROADMAP.md#53-replay-hash-policy

## Roadmap tasks covered

- `WorkshopScene`: all `upg.*` from ENTITY_CATALOG.md, applied through `tuning.ts` modifiers. (sim modifiers part)
