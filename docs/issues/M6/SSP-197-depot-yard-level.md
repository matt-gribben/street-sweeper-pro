---
id: SSP-197
title: "Author and compile district.depot_yard with all seven Skip Run variants"
milestone: M6
status: todo
type: feature
estimate: M
labels: [type:feature, area:gameplay, area:assets, size:M]
depends_on: [SSP-190, SSP-033, SSP-041]
blocks: [SSP-198, SSP-210, SSP-226, SSP-228, SSP-248, SSP-280]
---

# SSP-197: Author and compile district.depot_yard with all seven Skip Run variants

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** M · **Areas:** gameplay, assets

## Summary

Commit the Depot Yard level (the complete map is already in LEVEL_DESIGN) and author the Tue-Sun Skip Run variants, so the Skip Run has a course for every day.

## Context

LEVEL_DESIGN §8.6 gives the complete 32x24 assets-src/levels/depot_yard.map.txt and the level.json: seed 7001, mode skip_run, timer 45, timeOfDay/weather 'inherit', start heading 0, depot rect [0,0,32,22]. Building P is the 2-storey depot shed (roof.depot landmark, facade.depot_shed, use depot). Q is the 1-storey workshop (roof.corrugated, facade.workshop, roofkit [vent]). Bays b1..b6 sit at [2,6],[5,6],[8,6],[11,6],[14,6],[17,6], 2x3 tiles each, and are reversed into from the south. The slalom area is rows 9-20 (60 x 24 m). Lamp posts `l` stand at the yard edges; one skip and one hydrant are set dressing; there is no music field. Only the mon variant is written out: 4 gates at [8,16] left, [14,14] right, [20,16] left and [26,14] right; cones [8,16], [14,14], [20,16], [26,14], [28.5,10.5], [28.5,12.5]; bays b4-b6. Author the rest per LEVEL_DESIGN §11:
- tue: 5 gates / 3 bays / 12 m
- wed: 5 / 4 / 12 m (rain grip, so braking points move)
- thu: 6 / 4 / 11 m
- fri: 6 / 5 / 11 m, with bays spread to both ends
- sat: 7 / 5 / 10 m, with gates inside lamp pools (night)
- sun: 8 / 6 / 10 m, using every bay
Offset gates 2-4 m from the centreline; the par run must take 30-38 s. If roof.depot, facade.depot_shed or facade.workshop are missing from assets-src/manifest.json, add placeholder entries (placeholder: true) so L004 passes; SSP-228 and SSP-226 replace them. The in-game screenshot review happens in SSP-198, because the runtime cannot load a skip_run level until then.

## Scope

- assets-src/levels/depot_yard.map.txt and depot_yard.level.json with all 7 variants
- Placeholder manifest entries for any missing roof.*/facade.* IDs
- Compiled public/assets/levels/depot_yard.json committed
- Par report for every variant pasted in the PR

## Out of scope

- Skip Run gameplay logic and the in-game screenshot (SSP-198)
- Final depot art (SSP-228, SSP-226)

## Acceptance criteria

- [ ] npm run levels compiles depot_yard with no errors, and the committed output matches (assets:verify)
- [ ] The map file is byte-identical to the LEVEL_DESIGN §8.6 map
- [ ] Each of the 7 variants has the gate count, bay count and spacing in LEVEL_DESIGN §11 and a par course time of 30-38 s in the par report
- [ ] Every sat-variant gate is within the shared light-pool radius of a lamp post (checked by a unit test over the compiled level)

## Verification

- npm run levels
- npm run assets:verify
- npm run assets:lint
- npm test

## Dependencies

**Depends on:**

- [SSP-190](SSP-190-compiler-m6.md) Extend compile-level for M6: skip_run mode, night lamp pools, landmarks, M6 events
- [SSP-033](../M1/SSP-033-level-compiler-core.md) Build level schema and compile-level.ts core: parse, legend, buildings, M1 checks
- [SSP-041](../M1/SSP-041-placeholder-facades-roofs.md) Add placeholder facade modules, facade sets and roof surfaces for Puddle Lane

**Blocks:**

- [SSP-198](SSP-198-skip-run.md) Implement SkipRunScene: 45 s cone slalom and reverse-park bays with £5/£50 payouts
- [SSP-210](SSP-210-night-lighting.md) Implement night: night remap with street-lamp and headlight light mask
- [SSP-226](SSP-226-art-facades-m6.md) Art Pass 2: facade module sets for every remaining building style
- [SSP-228](SSP-228-art-landmark-roofs.md) Art Pass 2: landmark roofs for the Town Hall, Pier and Depot via Codex goldens
- [SSP-248](../M7/SSP-248-perf-optimise.md) Profile and optimise until the M7 performance budgets hold
- [SSP-280](../M9/SSP-280-rival-ai-controller.md) Build Sid's Rival Sweep AI on the lane graph and LitterField

## References

- ../../LEVEL_DESIGN.md#86-worked-example-2-the-depot-yard-complete
- ../../LEVEL_DESIGN.md#11-skip-run-layout-rules
- ../../LEVEL_DESIGN.md#58-the-depot-yard-districtdepot_yard
- ../../LEVEL_DESIGN.md#12-level-design-checklist

## Roadmap tasks covered

- Author and compile `high_street` (final), `gasworks`, `conker_hill`, `promenade`, `kebab_mile`, `civic_quarter`, `depot_yard`. (depot_yard)
