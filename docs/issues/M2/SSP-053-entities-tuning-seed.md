---
id: SSP-053
title: "Seed entities.json with litter, stains and pickups; add M2 values to tuning.json"
milestone: M2
status: todo
type: feature
estimate: M
labels: [type:feature, area:sim, area:gameplay, area:test, area:docs, size:M, vertical-slice]
depends_on: [SSP-051, SSP-052, SSP-029, SSP-003]
blocks: [SSP-054, SSP-056, SSP-057, SSP-058, SSP-061, SSP-075, SSP-168, SSP-199, SSP-237]
---

# SSP-053: Seed entities.json with litter, stains and pickups; add M2 values to tuning.json

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** feature · **Size:** M · **Areas:** sim, gameplay, test, docs · **Vertical slice**

## Summary

Create `src/data/entities.json` with every `litter.*` and `stain.*` entry from ENTITY_CATALOG (plus the minimal pickup entries Puddle Lane's level must reference), add the M2 sweeping, hopper, water, dumping, combo, scoring and shift values to `src/data/tuning.json`, and give the sim typed, validated access. From this commit the JSON is the truth and the catalog is a mirror kept in sync by a test.

## Context

Shape (ENTITY_CATALOG §15): keyed by canonical ID; fields `class`, `name`, `pts`, `lu`, `sprite` (an AssetId), `sfx: { pickup }`, `districts` (district IDs), `rules`, `milestone`.
Litter pts / LU (ENTITY_CATALOG §4.1): crisp_packet 10/1, drink_can 15/1, plastic_bottle 15/1, glass_bottle 20/1, newspaper 10/2, cigarette_butts 5/0.5, banana_skin 20/1, chip_wrapper 15/1, pizza_box 25/3, kebab_wrapper 15/1, leaf_pile 5/2, dog_mess 40/1, bin_bag 50/8, lolly_stick 10/0.5, spilled_shopping 0/1. Pickup SFX `pickup_small`, except glass_bottle `pickup_glass` and pizza_box, leaf_pile, bin_bag `pickup_big`. District codes map per ENTITY_CATALOG §1.2 (Mon = district.puddle_lane, Tue = district.high_street, Wed = district.gasworks, Thu = district.conker_hill, Fri = district.promenade, Sat = district.kebab_mile, Sun = district.civic_quarter, Yard = district.depot_yard; 'All except Yard' = the seven shift districts; 'Any' = all eight).
Rules to encode (ENTITY_CATALOG §4.2): banana_skin brush-up 180° spin-out; leaf_pile brush-up leaves haz.wet_leaves; dog_mess brush-up creates stain.splat and −20; bin_bag bursts into 6 small items above 4 m/s; glass_bottle flung → haz.broken_glass; crisp_packet and newspaper drift 1.5 m/s for 4 s in gusts.
Stains (ENTITY_CATALOG §5): pts gum 10, milkshake 20, oil 30, chalk_art 30, splat 0. Spray time is `TBD (M2 tuning)` with proposed defaults 1.0 s gum, 1.5 s milkshake, 2.0 s oil and chalk, splat = gum. Adopt the defaults in the JSON (they stay tunable later) and replace the TBD in ENTITY_CATALOG §5 and §17 Q10 in the same PR.
Pickups: LEVEL_DESIGN §8.4 says every ID in a level must be a canonical ID from `entities.json`, and L005/L007 check `districts` and `milestone`. Puddle Lane's M2 level.json references `pwr.flask_of_tea` and `collect.false_teeth` (and the Golden Crisp, `collect.golden_crisp`). Add minimal entries for these three (class, name, sprite, sfx `powerup`, districts per ENTITY_CATALOG §12/§13, `milestone: "M3"`, effect values only where the catalog gives them: flask chain timer ×2 for 15 s; false teeth +250; golden crisp +500).
Tuning additions (owner GDD until JSON exists; values GDD §8, §10, §12.1, TECHNICAL_DESIGN §10): brush raise/lower 0.5 s, RPM spin-up 0.6 s, collect at RPM ≥ 0.8; gutter circles r 0.45 m at (±0.85, +1.75); suction rect x ∈ [−1.3, 1.3], y ∈ [+1.6, +2.8], pull 3.0 m/s × rpm × mult; inlet 1.0 × 0.4 m at (0, +1.2); grime footprint x ∈ [−1.3, 1.3], y ∈ [+1.3, +2.2]; Kerb Hugger distance 0.2 m; fling t0 4.0 m/s, ramp width 2.0 m/s, arc 1.5–3 m; hopper capacity 100 LU, warn 0.8, +1,500 kg, accel ×0.70, top speed ×0.90, steer ×0.85 at full; water tank 100, spray 6/s, cone 2.6 m, hydrant 25/s; depot hold 1.0 s / drain 2.0 s / max speed 0.5 m/s; skip hold 1.0 s / drain 3.0 s; combo chain 2.0 s, tiers 10/25/50/100 → ×2..×5; grime 1 pt (gutter 2), Kerb Hugger +50 per 3 s, Clean Sweep +100; shift 240 s, rollout 3 s; stars 0.60/0.80/0.92; Tidy weights 0.6/0.4. Skip any value M1 already put under `vehicle.sweeper`. Values later issues decide (sweep-in speed, cone shape, etc.) are added by those issues.
Loader: hand-written type guards (no zod), fail loudly on a missing required field (no defaults). Sim purity (CLAUDE.md §3, M0 `simPurity` test): `src/sim/**` may import only `src/sim/`, `src/data/` and type-only `src/gen/assets.ts`, so the sprite check against `AssetId` happens in a test, not at sim runtime.
Open questions: (1) ENTITY_CATALOG §15 says a unit test asserts every `sfx` value exists in `assets-src/audio/sfx/`, but audio sources arrive in M5. Validate against the canonical list in ENTITY_CATALOG §1.4 until M5 and note that in §15. (2) `milestone` per litter ID: L007 rejects entities whose milestone is later than the district's (Mon–Tue: M3). Use `"M2"` for all litter and stains; brush-up rules delivered later are still listed in `rules`.

## Scope

- `src/data/entities.json` with 15 litter + 5 stain entries and minimal `pwr.flask_of_tea`, `collect.false_teeth`, `collect.golden_crisp` entries
- Sweeping/hopper/water/dumping/combo/scoring/shift/stars sections in `src/data/tuning.json`
- Typed accessors and guards in `src/sim/tuning.ts` (or a sibling loader it re-exports)
- `tests/unit/entityCatalog.test.ts` parsing the ENTITY_CATALOG §4.1 and §5 tables and diffing IDs, pts and LU against the JSON
- Update ENTITY_CATALOG §5/§15/§17 Q10 (spray times, sfx validation note)

## Out of scope

- NPC, vehicle, prop, hazard entries and the other power-ups/collectibles (M3 and later)
- `upgrades.json`, `districts.json` beyond what M1 created
- Power-up and collectible behaviour (M3)

## Acceptance criteria

- [ ] `entities.json` contains all 15 litter and 5 stain IDs with pts and LU matching ENTITY_CATALOG §4.1/§5, plus the 3 pickup entries, and no other IDs
- [ ] A test asserts every `sprite` value is an AssetId present in `src/gen/assets.ts`
- [ ] A test asserts every `sfx` value is in the canonical SFX list (ENTITY_CATALOG §1.4)
- [ ] Loading a copy of the JSON with a required field removed throws a descriptive error (unit test)
- [ ] `entityCatalog.test.ts` passes, and fails if a catalog pts/LU value is edited without the JSON
- [ ] Stain spray times are numbers in the JSON and ENTITY_CATALOG §5 no longer says TBD for them
- [ ] `simPurity` test still passes

## Verification

- npm run typecheck
- npm run lint
- npx vitest run tests/unit/entityCatalog.test.ts tests/unit/simPurity.test.ts
- npm test
- npm run test:replay

## Dependencies

**Depends on:**

- [SSP-051](SSP-051-placeholder-litter-sprites.md) Author placeholder grids for all 15 litter IDs and add the items atlas
- [SSP-052](SSP-052-placeholder-stains-pickups-sites.md) Add stain generator, grime overlays and pickup/collectible/site/hydrant grids
- [SSP-029](../M1/SSP-029-tuning-data.md) Create tuning.json vehicle.sweeper block and typed src/sim/tuning.ts
- [SSP-003](../M0/SSP-003-lint-purity-ip-tests.md) Add biome.json sim-purity rules plus simPurity and ipHygiene unit tests

**Blocks:**

- [SSP-054](SSP-054-compile-route-grime-litter-layers.md) Extend compile-level.ts with route, grime density, gutter and litter weight layers
- [SSP-056](SSP-056-puddle-lane-sweeping-content.md) Author Puddle Lane litter, grime, frontages, pledges and collectibles data
- [SSP-057](SSP-057-litter-field.md) Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn
- [SSP-058](SSP-058-hopper.md) Implement hopper.ts LU accounting, mass coupling and bulldozer state
- [SSP-061](SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats
- [SSP-075](../M3/SSP-075-entity-data-freeze.md) Freeze the Mon–Tue entity set in entities.json and add M3 shared tuning
- [SSP-168](../M5/SSP-168-audio-verify-coverage.md) Wire audio into assets:verify and add SFX coverage and reference tests
- [SSP-199](../M6/SSP-199-people-kids-jogger.md) Implement npc.jogger, npc.kid_skateboard, npc.kid_chalk and school_out/population_wave
- [SSP-237](../M7/SSP-237-assists-sim.md) Wire auto-brush, +60 s timer, Chill Shift and instant dump into the sim

## References

- ../../ENTITY_CATALOG.md#15-entitiesjson-shape
- ../../ENTITY_CATALOG.md#41-stats
- ../../ENTITY_CATALOG.md#42-behaviours-and-brush-up-rules
- ../../ENTITY_CATALOG.md#5-stains-stain
- ../../ENTITY_CATALOG.md#12-power-ups-pwr
- ../../ENTITY_CATALOG.md#13-collectibles-collect
- ../../ENTITY_CATALOG.md#16-changing-this-catalog
- ../../ENTITY_CATALOG.md#14-sfx-notation
- ../../GDD.md#8-sweeping-hopper-water-and-dumping
- ../../TECHNICAL_DESIGN.md#10-brush-litterfield-grime-and-hopper
- ../../LEVEL_DESIGN.md#84-leveljson-schema
- ../../../CLAUDE.md#2-where-truth-lives

## Roadmap tasks covered

- `src/data/entities.json` seeded with every `litter.*` and `stain.*` from ENTITY_CATALOG.md (points, LU, notes).
