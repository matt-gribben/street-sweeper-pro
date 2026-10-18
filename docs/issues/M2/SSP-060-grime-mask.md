---
id: SSP-060
title: "Implement dirt.ts grime mask, initial selection, footprint erase and Kerb Hugger"
milestone: M2
status: todo
type: feature
estimate: L
labels: [type:feature, area:sim, area:gameplay, area:perf, size:L, vertical-slice]
depends_on: [SSP-054, SSP-056, SSP-059, SSP-034, SSP-036, SSP-032, SSP-028, SSP-038]
blocks: [SSP-063, SSP-064, SSP-065, SSP-066, SSP-095, SSP-122, SSP-291, SSP-181]
---

# SSP-060: Implement dirt.ts grime mask, initial selection, footprint erase and Kerb Hugger

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** feature · **Size:** L · **Areas:** sim, gameplay, perf · **Vertical slice**

## Summary

Build `src/sim/dirt.ts`: the per-district Uint8 grime mask, exact deterministic initial grime selection, per-tick erasing under the brush footprint, gutter grime cleaned only by Kerb Hugger contact, incremental counters and a dirty rectangle for the GPU upload. Pillar 1 (Visibly Satisfying Clean) depends on it.

## Context

Mask (TECHNICAL_DESIGN §10.3): each 32 px tile holds 8×8 grime cells of 4 px (0.25 m). Mask size (tilesW·8)×(tilesH·8): Puddle Lane 64×48 → 512×384 = 196,608 bytes. Encoding: 0 = clean; bits 0–6 = intensity 1–127 (drives shader overlay strength); bit 7 = gutter grime (2 pts).
Initial state (LEVEL_DESIGN §9.2): score every route-area cell from the compiled components (zone density + gutter bonus, per the split agreed in SSP-054) plus `speckle × valueNoise` seeded from the `grime` stream (hand-written lattice value noise, no dependency); sort by (score desc, index asc); take exactly `grime.cells` (Puddle Lane 9,000), topping gutter-band cells up to `gutterShare` (0.15). The count is therefore identical on every attempt (Tidy % denominator).
Erase (TECHNICAL_DESIGN §10.3, GDD §9.1): while collecting (`brushPos == 1 && rpm >= 0.8`), rasterise the rotated footprint rect x ∈ [−1.3, 1.3], y ∈ [+1.3, +2.2] into cells every tick (cell included if its centre is inside). At 6 m/s Bessie moves 0.1 m/tick and the band is 0.9 m deep, so there must be no gaps. A single pass clears a cell (GDD §20 Q2, leaning single pass; record the decision). Grime is erased while Bulldozing too (GDD §8.2, proposed).
Kerb Hugger (GDD §8.1): gutter grime is collected only when a gutter brush centre is within 0.2 m of a kerb edge (kerb edges from the collision grid KERB_EDGE bits). Propose: the hugging brush's circle clears gutter cells under it; the normal footprint clears only non-gutter cells. Expose a per-tick 'kerb contact' flag for the +50 per 3 s bonus in scoring.
Counters (incremental; nothing rescans the mask): initialCells, cleanedCells, cleanedGutterCells, plus per-tick cleaned and gutter counts for scoring. Record a dirty bounding rectangle per tick for `render/groundLayer.ts`. The mask is part of the replay hash input. This is tick phase 6.

## Scope

- `src/sim/dirt.ts` mask allocation, initial selection, value noise, footprint rasteriser, Kerb Hugger check
- Counters and per-tick facts for scoring/Tidy %
- Dirty-rect tracking API for the renderer
- Unit and property tests; GDD §20 Q2 resolution

## Out of scope

- Stain cleaning (SSP-061) and dust (M3)
- GPU upload and shader (SSP-066)
- Points and Tidy % formulas (SSP-063, SSP-064)
- Heavy multi-pass grime

## Acceptance criteria

- [ ] Puddle Lane initialises exactly 9,000 grime cells for at least 3 different seeds, with gutter cells ≥ 15% of them (unit test)
- [ ] Initial selection is identical for a given seed and cells never land on grass, aprons, solid props or footways
- [ ] Property test: driving straight at any speed up to 6.0 m/s and any heading with the brush collecting leaves no uncleaned non-gutter cell whose centre lies inside the swept band
- [ ] Gutter cells are cleared when a gutter brush centre is 0.19 m from a kerb edge and not at 0.21 m (unit tests)
- [ ] The per-tick dirty rectangle contains every cell changed that tick (property test)
- [ ] No `new`, literals or closures inside per-tick functions; GDD §20 Q2 records the single-pass decision

## Verification

- npx vitest run tests/unit/dirt.test.ts tests/property/dirt.prop.test.ts
- npm test
- npm run test:replay
- npm run typecheck

## Dependencies

**Depends on:**

- [SSP-054](SSP-054-compile-route-grime-litter-layers.md) Extend compile-level.ts with route, grime density, gutter and litter weight layers
- [SSP-056](SSP-056-puddle-lane-sweeping-content.md) Author Puddle Lane litter, grime, frontages, pledges and collectibles data
- [SSP-059](SSP-059-brush.md) Implement brush.ts state machine, suction, inlet collection and fling roll
- [SSP-034](../M1/SSP-034-compiler-autotile-collision.md) Add kerb blob autotile, kerb edges, collision bits and merged solids to compiler
- [SSP-036](../M1/SSP-036-static-collision.md) Resolve Bessie against static geometry with impact damage and TOWED stub
- [SSP-032](../M1/SSP-032-level-map-codec.md) Add src/sim/map.ts compiled-level codec, tile/surface/collide ids and solid merge
- [SSP-028](../M1/SSP-028-sim-foundations.md) Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type
- [SSP-038](../M1/SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner

**Blocks:**

- [SSP-063](SSP-063-scoring-combo.md) Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger
- [SSP-064](SSP-064-tidy-frontages.md) Compute Tidy %, per-frontage clean % and Clean Sweep bonuses incrementally
- [SSP-065](SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-066](SSP-066-grime-ground-shader.md) Sample the grime mask in the ground shader with incremental dirty-rect uploads
- [SSP-095](../M3/SSP-095-near-miss-dust-coughing.md) Add the near-miss bonus and dust coughing penalties
- [SSP-122](../M4/SSP-122-grime-overlays.md) Procedural grime overlay patterns for asphalt, slab and gutter
- [SSP-291](../M4/SSP-291-hud-minimap.md) Implement src/ui/minimap.ts: runtime 64×64 district minimap in the single UI draw
- [SSP-181](../M5/SSP-181-brush-suction-synth.md) Implement brushSynth.ts brush, suction fan, scrub crackle and bulldozer layers

## References

- ../../TECHNICAL_DESIGN.md#103-grime-mask-srcsimdirtts
- ../../GDD.md#91-grime
- ../../GDD.md#81-brush-geometry
- ../../LEVEL_DESIGN.md#92-grime
- ../../TECHNICAL_DESIGN.md#73-randomness
- ../../GDD.md#20-open-design-questions

## Roadmap tasks covered

- `src/sim/dirt.ts`: an 8×8 grid of 4 px grime cells per tile, a `Uint8` mask per district, gutter grime strip along kerbs, the Kerb Hugger check (gutter brush within 0.2 m of a kerb edge).
