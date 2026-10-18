---
id: SSP-054
title: "Extend compile-level.ts with route, grime density, gutter and litter weight layers"
milestone: M2
status: todo
type: feature
estimate: M
labels: [type:feature, area:tooling, area:sim, size:M, vertical-slice]
depends_on: [SSP-053, SSP-033, SSP-034, SSP-032, SSP-042]
blocks: [SSP-055, SSP-056, SSP-057, SSP-060, SSP-077, SSP-105]
---

# SSP-054: Extend compile-level.ts with route, grime density, gutter and litter weight layers

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** feature · **Size:** M · **Areas:** tooling, sim · **Vertical slice**

## Summary

Teach the level compiler to bake the layers M2's sim needs: the route-area mask used by Tidy %, per-tile grime density, the per-grime-cell gutter mask and the litter spawn weight field, plus budget validation, so grime and litter can spawn deterministically at shift start.

## Context

Compiled schema v1 (TECHNICAL_DESIGN §15.2): base64 raw Uint8 row-major layers `route` (w·h, 1 = counts toward Tidy %), `grimeDensity` (w·h), `gutter` ((w·8)·(h·8), one byte per 4 px grime cell). `src/sim/map.ts` is the shared encoder/decoder imported by the compiler, so extend it, never a copy. `npm run levels` = `node tools/levels/compile-level.ts` on Node 24 type stripping.
Route area (LEVEL_DESIGN §8.3 legend): yes for road `#`, one-way arrows `>` `<` `^` `v`, pavement `.`, `:`, `%`, and `;` when ≥ 2 wide; no for `,` grass, `+` apron, `~`, `_`, void. Grime never spawns under solid props, on grass, on aprons or in footways (LEVEL_DESIGN §9.2).
Grime spec in level.json (LEVEL_DESIGN §8.4 `GrimeSpec`): `{ cells, gutterShare, zones: [{ rect? | near?, radius?, density }], speckle }`. Gutter grime is the dense strip along kerbs, 4–8 px wide (ART_BIBLE §9.2); kerb edges come from the `collide` layer KERB_EDGE bits. Open question: exact gutter band width. Propose 2 grime cells (8 px) on the road side of a kerb edge and record it in LEVEL_DESIGN §9.2.
Litter weight field (LEVEL_DESIGN §9.1): candidates are route-area non-solid tiles split into 4×4 sub-cells (0.5 m). Base weight: road gutter (within 1 tile of a kerb) 3.0, pavement 1.5, alley 2.0, precinct 1.5, road centre 0.4, yard 1.0. `gutterBias` rescales the gutter weight so that share lands there; `hotspots` (`{ near, radius, mult }`) multiply weights within a radius (litter bins ×2, takeaway/shop frontages ×2.5–3, bus stops ×2, benches ×1.5, market pitches ×3). Sampling happens at runtime (seed-dependent `litter` stream), so the compiler emits weights, not placements. TECHNICAL_DESIGN §15.2 shows `spawns.litter: [...]` without a shape: define it (e.g. a base64 weight grid quantised to Uint8/Uint16 plus the type table and constraint masks) and document it in §15.2.
Open question (doc conflict): TECHNICAL_DESIGN §10.3 says the compiler bakes per-cell grime scores; LEVEL_DESIGN §9.2 adds `speckle × valueNoise` seeded from the runtime `grime` stream. Propose: the compiler bakes the deterministic zone + gutter components; `dirt.ts` adds seeded noise and selects at shift start. Update both docs to agree.
Validation (LEVEL_DESIGN §10.3): L050 error when `litter.initial` + expected dynamic litter > 1,000 (expected dynamic litter is derived from NPC/event specs, which are absent until M3, so it is 0 now; add peak NPC/vehicle checks only if M1 has them); L051 error when `grime.cells` exceeds available route-area grime cells. Message format `puddle_lane.map.txt:8:23 L051 ...` (1-based row, column). Output stays byte-deterministic (stable key order, no timestamps).

## Scope

- `route`, `grimeDensity`, `gutter` layers and litter weight data in compiled output
- Encoder/decoder support in `src/sim/map.ts`
- `tools/levels/schema.ts` types for `LitterSpec` and `GrimeSpec` if not present
- L050 and L051 validation with file:row:col messages
- Unit tests on small fixture maps; doc updates for the `spawns.litter` shape, gutter band width and the grime-score split

## Out of scope

- Frontages, pledges and dump/hydrant distance checks (SSP-055)
- Lane graph and pavement nav graph (M3)
- Par estimation (L060–L062)
- Authoring Puddle Lane's values (SSP-056)

## Acceptance criteria

- [ ] A fixture map compiles to a `route` layer that is 1 exactly on route-area characters and 0 on grass, aprons, water and void
- [ ] The gutter mask marks only cells in the agreed band on the road side of kerb edges (fixture test)
- [ ] Litter weights follow the base weights and a hotspot multiplier (unit test on a fixture with one `prop.litter_bin` hotspot)
- [ ] L050 and L051 fire with the documented code and file:row:col format on crafted bad fixtures
- [ ] `npm run levels` run twice produces byte-identical output; the compiler round-trip property test still passes
- [ ] TECHNICAL_DESIGN §15.2/§10.3 and LEVEL_DESIGN §9.2 describe the chosen shapes, band width and grime-score split

## Verification

- npm run levels && shasum public/assets/levels/*.json > /tmp/a && npm run levels && shasum public/assets/levels/*.json | diff /tmp/a -
- npm test
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-053](SSP-053-entities-tuning-seed.md) Seed entities.json with litter, stains and pickups; add M2 values to tuning.json
- [SSP-033](../M1/SSP-033-level-compiler-core.md) Build level schema and compile-level.ts core: parse, legend, buildings, M1 checks
- [SSP-034](../M1/SSP-034-compiler-autotile-collision.md) Add kerb blob autotile, kerb edges, collision bits and merged solids to compiler
- [SSP-032](../M1/SSP-032-level-map-codec.md) Add src/sim/map.ts compiled-level codec, tile/surface/collide ids and solid merge
- [SSP-042](../M1/SSP-042-puddle-lane-level.md) Author Puddle Lane map.txt and level.json (64×48) and commit compiled output

**Blocks:**

- [SSP-055](SSP-055-compile-frontages-dump-validation.md) Generate frontages and pledges in the compiler and validate dump sites
- [SSP-056](SSP-056-puddle-lane-sweeping-content.md) Author Puddle Lane litter, grime, frontages, pledges and collectibles data
- [SSP-057](SSP-057-litter-field.md) Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn
- [SSP-060](SSP-060-grime-mask.md) Implement dirt.ts grime mask, initial selection, footprint erase and Kerb Hugger
- [SSP-077](../M3/SSP-077-compile-spawn-specs.md) Compile NPC, traffic, hazard, knockable and power-up spawn specs from level.json
- [SSP-105](../M3/SSP-105-high-street-greybox.md) Author and compile the grey-box High Street (80×60) for Tuesday's NPCs

## References

- ../../TECHNICAL_DESIGN.md#151-compile-step
- ../../TECHNICAL_DESIGN.md#152-compiled-schema-v1
- ../../TECHNICAL_DESIGN.md#103-grime-mask-srcsimdirtts
- ../../LEVEL_DESIGN.md#83-default-legend
- ../../LEVEL_DESIGN.md#84-leveljson-schema
- ../../LEVEL_DESIGN.md#91-litter
- ../../LEVEL_DESIGN.md#92-grime
- ../../LEVEL_DESIGN.md#103-validation-rules
- ../../ART_BIBLE.md#92-grime-and-the-clean-reveal

## Roadmap tasks covered

- Puddle Lane `level.json`: litter density, spawn tables, frontages and pledge list. (compiler support for litter and grime)
