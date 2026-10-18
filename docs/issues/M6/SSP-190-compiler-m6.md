---
id: SSP-190
title: "Extend compile-level for M6: skip_run mode, night lamp pools, landmarks, M6 events"
milestone: M6
status: todo
type: feature
estimate: L
labels: [type:feature, area:tooling, area:test, size:L]
depends_on: [SSP-033, SSP-076, SSP-021, SSP-295]
blocks: [SSP-197, SSP-203, SSP-204, SSP-206, SSP-209, SSP-210, SSP-212, SSP-214, SSP-215]
---

# SSP-190: Extend compile-level for M6: skip_run mode, night lamp pools, landmarks, M6 events

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** L · **Areas:** tooling, test

## Summary

Teach tools/levels/compile-level.ts and tools/levels/schema.ts everything the Wed-Sun districts and the Depot Yard need, so district authoring issues only write data.

## Context

Schema: LEVEL_DESIGN §8.4. LevelFile has mode 'shift' | 'skip_run'; timeOfDay includes 'night' and 'inherit'; weather includes 'rain' | 'wind' | 'gusts' | 'inherit'; SkipRunSpec {bays b1..b6 -> NW tile, per-day variants {gates [{at, pass: left|right}], cones, bays}}; par {loadout, star1, star2, star3, perfectMin}.

Validation codes to add or extend (LEVEL_DESIGN §10.3):
- L004: storeys 1-6, up to 8 only with landmark: true.
- L006: campaign timer must be 240 and the Skip Run 45.
- L007: Wed-Sun and the Depot Yard are delivered by M6, so reject entities whose entities.json milestone is later.
- L030/L040/L041 apply to shifts only.
- L060: 3★ par estimate > par.star3 x 1.10, or > 230 s. L061: 100% par < par.perfectMin. L062 warning: 1★ par > 125 s.
- L072: on night levels every hazard and litter hotspot sits inside a lamp pool or is flagged darkOk.
- L080: rejects events that reference unknown anchors or routes that leave the nav or lane graph, and Skip Run gates must sit on concrete (LEVEL_DESIGN §11).

Schema gaps:
(1) The schema only has `darkOk` on LegendEntry, but L072 needs it on placed hazards and litter hotspots. Add optional `darkOk` to hazards.place[] and litter.hotspots[] entries and document it in §8.4.
(2) The docs do not restrict 'inherit'. PROPOSED rule: 'inherit' is legal only for mode skip_run. Implement it and document it in §10.3.
(3) The Depot Yard map has a set-dressing skip (`ss`) near the bays, which would trip L020 ('skip within 40 m of a depot bay'). Proposal: L020-L022 do not apply to skip_run. Document it.

Light pool radius was decided in M0 as 5 m (ROADMAP §8 D-05, LEVEL_DESIGN §13 Q2): it is `LIGHT_POOL_RADIUS_M` in `src/render/lightPools.ts`. Keep it in ONE shared constant used by both the compiler and src/render (move it somewhere both can import if needed; the compiler must not import three).

Skip Run rules (LEVEL_DESIGN §11): par run 30-38 s; 4-8 gates; spacing 10-14 m; lateral offset 2-4 m from the centreline; 3-6 active bays per variant. The par report must print course time per variant. Event types to validate (LEVEL_DESIGN §4.3): rain, leaf_fall, school_out, gust, vehicle_stop, rival_cameo, kicking_out, crossing_patrol, parade, inspection, population_wave and bin_round, plus the existing ones. Output stays byte-deterministic (stable key order, no timestamps), and npm run assets:verify rebuilds levels in CI.

## Scope

- tools/levels/schema.ts: types for SkipRunSpec, inherit values, darkOk on placed hazards and hotspots, and M6 event param shapes
- compile-level.ts: skip_run compile path, landmark storeys, L006/L007/L060-L062/L072/L080 additions, shift-only rules gated by mode
- A shared light-pool radius constant used by both the compiler and the renderer
- A par report section for Skip Run variants (course time, gates, bays)
- A failing fixture for each new or changed rule, plus passing fixtures
- Update LEVEL_DESIGN §8.4 and §10.3 for every scope change (darkOk placement, inherit rule, L020-L022 for skip_run)

## Out of scope

- Authoring any district level (district issues)
- Runtime behaviour of events (each behaviour issue)

## Acceptance criteria

- [ ] npm run levels still compiles puddle_lane and high_street byte-identically to the committed outputs
- [ ] Fixtures: a 7-storey non-landmark building fails L004; an 8-storey landmark passes
- [ ] Fixtures: a skip_run level with timer 44 fails L006; a shift with weather 'inherit' fails (documented rule)
- [ ] Fixtures: a night level with an unlit hazard fails L072; the same hazard with darkOk passes; an unlit litter hotspot with darkOk passes
- [ ] Fixtures: a Skip Run gate on a non-concrete tile fails L080; an inspection route leaving the nav graph fails L080
- [ ] Fixture: a skip_run level with a skip near a bay compiles (L020 exemption)
- [ ] The level compiler round-trip property test still passes
- [ ] The light-pool radius exists as exactly one constant, imported by both tools/levels and src/render

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run levels
- npm run assets:verify

## Dependencies

**Depends on:**

- [SSP-033](../M1/SSP-033-level-compiler-core.md) Build level schema and compile-level.ts core: parse, legend, buildings, M1 checks
- [SSP-076](../M3/SSP-076-compile-lane-nav-graphs.md) Compile the traffic lane graph and pavement nav graph in compile-level.ts
- [SSP-021](../M0/SSP-021-night-shadow-tuning.md) Tune night[32] and shadow[32] remap tables in the spike scene (D-05, D-06)
- [SSP-295](../M5/SSP-295-vertical-slice-gate.md) Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR

**Blocks:**

- [SSP-197](SSP-197-depot-yard-level.md) Author and compile district.depot_yard with all seven Skip Run variants
- [SSP-203](SSP-203-district-high-street-final.md) Bring district.high_street to final M6 quality with collectibles and 3-star replay
- [SSP-204](SSP-204-district-gasworks.md) Author and compile district.gasworks (Wednesday, rain) with its district replay
- [SSP-206](SSP-206-district-conker-hill.md) Author and compile district.conker_hill (Thursday, wind and leaf fall)
- [SSP-209](SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-210](SSP-210-night-lighting.md) Implement night: night remap with street-lamp and headlight light mask
- [SSP-212](SSP-212-district-kebab-mile.md) Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden
- [SSP-214](SSP-214-inspector.md) Implement npc.inspector and the inspection event with frontage deductions
- [SSP-215](SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map

## References

- ../../LEVEL_DESIGN.md#84-leveljson-schema
- ../../LEVEL_DESIGN.md#103-validation-rules
- ../../LEVEL_DESIGN.md#104-par-report
- ../../LEVEL_DESIGN.md#11-skip-run-layout-rules
- ../../LEVEL_DESIGN.md#43-event-catalogue
- ../../LEVEL_DESIGN.md#13-open-questions
- ../../ROADMAP.md#8-m0-spike-decision-log
- ../../ART_BIBLE.md#13-night-weather-and-time-of-day

## Roadmap tasks covered

- Author and compile `high_street` (final), `gasworks`, `conker_hill`, `promenade`, `kebab_mile`, `civic_quarter`, `depot_yard`. (compiler support)
