---
id: SSP-056
title: "Author Puddle Lane litter, grime, frontages, pledges and collectibles data"
milestone: M2
status: todo
type: feature
estimate: M
labels: [type:feature, area:gameplay, area:assets, size:M, vertical-slice]
depends_on: [SSP-053, SSP-054, SSP-055, SSP-042]
blocks: [SSP-057, SSP-060, SSP-072, SSP-073, SSP-076, SSP-077, SSP-104]
---

# SSP-056: Author Puddle Lane litter, grime, frontages, pledges and collectibles data

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** feature · **Size:** M · **Areas:** gameplay, assets · **Vertical slice**

## Summary

Fill in Puddle Lane's `level.json` with the M2 sweeping data (litter density and table, grime zones, building uses, pledges, power-up and collectible placements) and fix the map where needed so it passes every M2 compiler rule.

## Context

Puddle Lane (LEVEL_DESIGN §5.1, all values initial): 64×48 tiles; depot on the south-west edge; rollout north up Mangle Street (straight 3-tile two-way road with long kerbs). The first 30 m of Mangle Street is dense gutter grime with a straight kerb so the first 15 s teach the brush and Kerb Hugger.
Litter (`LitterSpec`, LEVEL_DESIGN §8.4): `initial` 130 (≈ 150 LU), `table` crisp_packet 30, cigarette_butts 20, drink_can 15, plastic_bottle 15, newspaper 12, dog_mess 8; `minSpacingM` 0.5. `gutterBias` (required) and `hotspots` have no documented value: choose initial values (e.g. gutterBias 0.4, hotspots on litter bins and the corner shop), mark them *(initial)* in LEVEL_DESIGN §5.1 and flag them in the PR; they are tunable later. Do not add an 'expected dynamic' field: the schema has none (the par report's '+20 dyn' comes from NPC specs in M3).
Grime (`GrimeSpec`): `cells` 9,000, `gutterShare` 0.15, `zones` (dense zone on the first 30 m of Mangle Street; others by judgement), `speckle` 0..0.1. Stains: none at start.
Frontages / pledges: 46 / 8. Spread pledges so no street holds more than a third; put at least two where they compete with something (LEVEL_DESIGN §7.10). Buildings need a `use` field (2-storey terraces `house`; the 3-storey parade has shops including the corner shop) for frontage generation. If the generated count is not exactly 46, adjust uses/widths sensibly or record the real count in LEVEL_DESIGN §5.1 (it is an initial value).
Power-ups: `powerups: { count: 1, table: { "pwr.flask_of_tea": 1 } }` (L040 needs 1–3; behaviour arrives in M3). Collectibles: `lostProperty: { id: "collect.false_teeth", at }` on the Pump Green path beside the bench; `goldenCrisp: { at }` at the dead end of the Gutter Row alley behind the skip.
Skips / hydrants: 1 / 2. Depot needs ≥ 2 `site.depot_bay` (`$`, 2×3 tiles) for L020. Place the skip so the player's first hopper warning (around 80–100 s) happens within 150 m of it.
Not in M2: hazards (8 puddles; speed bump rows stay map `=` only), NPC and traffic specs (M3), par values (M3/M6), tutorial beats.
Output: `public/assets/levels/puddle_lane.json` regenerated and committed with the source; paste the compiler report into the PR (LEVEL_DESIGN §10.4).

## Scope

- `assets-src/levels/puddle_lane.level.json`: litter, grime, building `use`, pledges, powerups, collectibles
- Map edits to `puddle_lane.map.txt` only where needed for M2 rules (e.g. a second depot bay)
- Regenerated compiled level committed
- LEVEL_DESIGN §5.1 updated with any new *(initial)* values or the real frontage count
- Compiler report (route tiles, grime cells, litter, dump/hydrant distances) pasted into the PR

## Out of scope

- NPC, traffic, hazard and event specs (M3)
- Tutorial beats (`tutorial_beat` events)
- Par tuning

## Acceptance criteria

- [ ] `npm run levels` passes with no errors for Puddle Lane
- [ ] Compiled level reflects litter initial 130 with the documented table, grime cells 9,000 and gutterShare 0.15
- [ ] Exactly 8 pledges, all valid frontage IDs, with no L031 warning (or the warning justified in the PR)
- [ ] At least 2 depot bays, 1 skip, 2 hydrants; L020–L022 and L040–L041 pass
- [ ] Compile output is byte-identical across two runs and `npm run assets:verify` passes

## Verification

- npm run levels
- npm run assets:verify
- npm test

## Dependencies

**Depends on:**

- [SSP-053](SSP-053-entities-tuning-seed.md) Seed entities.json with litter, stains and pickups; add M2 values to tuning.json
- [SSP-054](SSP-054-compile-route-grime-litter-layers.md) Extend compile-level.ts with route, grime density, gutter and litter weight layers
- [SSP-055](SSP-055-compile-frontages-dump-validation.md) Generate frontages and pledges in the compiler and validate dump sites
- [SSP-042](../M1/SSP-042-puddle-lane-level.md) Author Puddle Lane map.txt and level.json (64×48) and commit compiled output

**Blocks:**

- [SSP-057](SSP-057-litter-field.md) Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn
- [SSP-060](SSP-060-grime-mask.md) Implement dirt.ts grime mask, initial selection, footprint erase and Kerb Hugger
- [SSP-072](SSP-072-m2-replays.md) Record the M2 full-shift and dump-cycle replays and commit their hashes
- [SSP-073](SSP-073-e2e-smoke.md) Add smoke.spec.ts: 60 s scripted sweep and full shift ending on the tally
- [SSP-076](../M3/SSP-076-compile-lane-nav-graphs.md) Compile the traffic lane graph and pavement nav graph in compile-level.ts
- [SSP-077](../M3/SSP-077-compile-spawn-specs.md) Compile NPC, traffic, hazard, knockable and power-up spawn specs from level.json
- [SSP-104](../M3/SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up

## References

- ../../LEVEL_DESIGN.md#51-mon-puddle-lane-districtpuddle_lane-tutorial
- ../../LEVEL_DESIGN.md#61-per-district-numbers
- ../../LEVEL_DESIGN.md#84-leveljson-schema
- ../../LEVEL_DESIGN.md#710-frontages
- ../../LEVEL_DESIGN.md#77-depot-skips-and-hydrants
- ../../LEVEL_DESIGN.md#104-par-report

## Roadmap tasks covered

- Puddle Lane `level.json`: litter density, spawn tables, frontages and pledge list.
