---
id: SSP-032
title: "Add src/sim/map.ts compiled-level codec, tile/surface/collide ids and solid merge"
milestone: M1
status: done
type: feature
estimate: M
labels: [type:feature, area:sim, area:physics, area:test, size:M, vertical-slice]
depends_on: [SSP-028, SSP-002]
blocks: [SSP-033, SSP-035, SSP-036, SSP-038, SSP-045, SSP-054, SSP-057, SSP-060, SSP-076, SSP-291]
---

# SSP-032: Add src/sim/map.ts compiled-level codec, tile/surface/collide ids and solid merge

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** feature · **Size:** M · **Areas:** sim, physics, test · **Vertical slice**

## Summary

Create the shared compiled-level module `src/sim/map.ts` that both the compiler and the sim import: the v1 compiled types, base64 Uint8 layer encode/decode, the ground/surface/roof/wall id tables, the collide-layer bit constants and the greedy maximal-rectangle solid merge. Splitting this out lets the sim track (World, collision) proceed in parallel with the compiler.

## Context

TECHNICAL_DESIGN §15.2: `src/sim/map.ts` decodes the compiled level into typed arrays once per shift, and the same module is imported by the compiler so encoder and decoder can never disagree. `tools/**` may import `src/sim/**` (§2.1), so map.ts must stay pure (no fs, no DOM) and run under Node 24 type stripping with explicit `.ts` imports.

Compiled schema v1 (§15.2):
- Header: `format: 'ssp.level'`, `version: 1`, `id`, `size` [w, h] in tiles.
- `layers`: base64 raw Uint8, row-major: `ground`, `autotile` (kerb blob 0..46, 255 = none), `surface`, `storeys` (0 = none, 1..8), `roof`, `wall`, `collide`, `route` (1 = counts toward Tidy %), `grimeDensity`, `gutter` (length (w·8)·(h·8)).
- Lists: `solids` [[x0, y0, x1, y1]] in tiles, `props` [{id, x, y, rot}], `sites` [{id, rect}], `frontages`, `lanes` {nodes, edges}, `nav` {nodes, edges}, `spawns`, `schedules`.
- `weather`, `timerS`, `player {x, y, heading}`.
- Encoding must emit a stable key order (the order above) with no timestamps.

Id tables (as `as const` objects plus derived unions, no `enum`):
- Ground ids for every LEVEL_DESIGN §8.3 ground: road, one-way road (4 flows), pavement, cobbles, alley, grass, yard, apron, water, sand, void.
- Surface ids: asphalt, pavement, grass, plus hazard-only surfaces reserved for M3 (wet/puddle, wet leaves, oil). Cobbles and apron use asphalt grip; yard uses pavement grip (§8.3).
- Collide bits (§9.1): `SOLID`, `KERB_EDGE_N`, `KERB_EDGE_E`, `KERB_EDGE_S`, `KERB_EDGE_W`.
- Roof/wall style ids: map compiled ids to `roof.*`/`facade.*` asset ids through a string table stored in the compiled file (propose adding `roofIds`/`wallIds` string arrays to the header; if you add them, update TECHNICAL_DESIGN §15.2 in the same PR), so the render can resolve frames without a hard-coded list.

Units OPEN (flag in the PR, document in TECHNICAL_DESIGN §15.2): the docs do not state units for compiled `props[].x/y` and `player`. The §15.2 example player (8.0, 84.0) only lies inside Puddle Lane's depot rect [0, 38, 14, 10] (tiles) if it is in metres, so propose metres for positions, tiles for rects and `solids`. Note that `level.json` (LEVEL_DESIGN §8.4) uses tile coordinates; the compiler converts.

Solid merge (§9.1): greedy maximal rectangles over SOLID cells, emitted as `[x0, y0, x1, y1]` in tiles (state inclusive/exclusive convention explicitly). Merging removes the internal edges that cause ghost snagging along terraces. It lives here so the compiler, static collision and the property tests share one implementation. Iterate in a fixed row-major order so output is deterministic.

## Scope

- src/sim/map.ts: CompiledLevel types, `encodeLevel`/`decodeLevel` (base64 Uint8 layers ↔ typed arrays), stable key order
- Ground, surface, collide-bit and style id tables as `as const` objects
- Pure base64 helpers usable in Node and the browser (no Buffer dependency in src/sim)
- `mergeSolids(collide, w, h)` greedy maximal-rectangle merge
- Unit tests: encode/decode round trip on a hand-built level; byte-identical re-encode
- tests/property/mergeSolids.prop.test.ts: on random grids up to 32×32, the merged rects cover exactly the SOLID cells with no overlap and no gaps
- Doc update in TECHNICAL_DESIGN §15.2 for units and any header additions

## Out of scope

- Parsing map.txt / level.json and validation: SSP-033
- Autotile and KERB_EDGE computation: SSP-034
- Runtime collision grid buckets: SSP-036

## Acceptance criteria

- [x] decodeLevel(encodeLevel(level)) reproduces every layer and list exactly, and re-encoding gives byte-identical JSON
- [x] The mergeSolids property passes (exact cover, no overlap) over at least 1,000 random grids with a fixed seed
- [x] mergeSolids output is identical across two runs on the same grid
- [x] map.ts imports nothing outside src/sim and runs under `node` type stripping (a tools smoke import or test proves it)
- [x] Units and any schema additions are documented in TECHNICAL_DESIGN §15.2

## Verification

- npm run typecheck
- npm run lint
- npm test -- map
- npm test -- mergeSolids

## Dependencies

**Depends on:**

- [SSP-028](SSP-028-sim-foundations.md) Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type
- [SSP-002](../M0/SSP-002-node-scaffold.md) Scaffold the Node/TypeScript/Vite repo with exact pins and verify TS 7.0.2 (D-10)

**Blocks:**

- [SSP-033](SSP-033-level-compiler-core.md) Build level schema and compile-level.ts core: parse, legend, buildings, M1 checks
- [SSP-035](SSP-035-world-tick-order.md) Add World, EventQueue and fixed tick order with surface grip and kerb jolts
- [SSP-036](SSP-036-static-collision.md) Resolve Bessie against static geometry with impact damage and TOWED stub
- [SSP-038](SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner
- [SSP-045](SSP-045-render-ground-city.md) Render compiled levels: chunked ground layer and full cityMesh cell merge
- [SSP-054](../M2/SSP-054-compile-route-grime-litter-layers.md) Extend compile-level.ts with route, grime density, gutter and litter weight layers
- [SSP-057](../M2/SSP-057-litter-field.md) Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn
- [SSP-060](../M2/SSP-060-grime-mask.md) Implement dirt.ts grime mask, initial selection, footprint erase and Kerb Hugger
- [SSP-076](../M3/SSP-076-compile-lane-nav-graphs.md) Compile the traffic lane graph and pavement nav graph in compile-level.ts
- [SSP-291](../M4/SSP-291-hud-minimap.md) Implement src/ui/minimap.ts: runtime 64×64 district minimap in the single UI draw

## References

- ../../TECHNICAL_DESIGN.md#152-compiled-schema-v1
- ../../TECHNICAL_DESIGN.md#91-static-world
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom
- ../../LEVEL_DESIGN.md#83-default-legend
- ../../LEVEL_DESIGN.md#84-leveljson-schema
- ../../TECHNICAL_DESIGN.md#182-property-tests

## Roadmap tasks covered

- `src/sim/world.ts` and `map.ts`: tile types, building columns, surface lookups. [map.ts part: tile types, building columns]
- Deliverable: the pure sim core: `map.ts`
