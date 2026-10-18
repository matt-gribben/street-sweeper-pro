---
id: SSP-045
title: "Render compiled levels: chunked ground layer and full cityMesh cell merge"
milestone: M1
status: todo
type: feature
estimate: L
labels: [type:feature, area:render, area:test, size:L, vertical-slice]
depends_on: [SSP-039, SSP-040, SSP-041, SSP-034, SSP-042, SSP-032, SSP-043, SSP-015, SSP-016, SSP-017, SSP-022]
blocks: [SSP-046, SSP-050, SSP-066, SSP-113, SSP-119, SSP-120, SSP-125]
---

# SSP-045: Render compiled levels: chunked ground layer and full cityMesh cell merge

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** feature · **Size:** L · **Areas:** render, test · **Vertical slice**

## Summary

Replace the spike's simple city with real level rendering. `groundLayer.ts` builds chunked merged ground geometry from the compiled layers, sampling the `world` atlas. `cityMesh.ts` merges building cells, emits only the walls that face lower or open cells, and maps facades with world-metre UVs. Building shadows are built once per district.

## Context

Ground (TECHNICAL_DESIGN §12.4):
- Geometry is generated in 16×16-tile chunks, then concatenated into one BufferGeometry per district with `frustumCulled = false`.
- Per-vertex tile rects come from FRAME: ground type → `tile.*:v:-:n`, kerb autotile index 0..46 → `tile.kerb:blob:-:n` (see SSP-040), speed bumps → `haz.speed_bump`.
- OPEN: the variant choice per cell is unspecified. Proposal: a deterministic hash of (x, y). The sim RNG must not be used.
- A per-vertex flag will disable grime on walls and roofs. Grime itself arrives in M2.
- Markings follow the representation decided in SSP-034.

City:
- Adjacent building cells with equal storeys merge into boxes. Only walls facing lower or open cells are emitted; backface culling handles the rest.
- Storey = 2.5 m (40 px). UVs are in world metres, so 32×40 px facade modules tile at 2 m × 2.5 m (frame layout per SSP-041).
- N/W faces use `lit`, E/S faces use `dark`, roofs use the roof texture (`roof.*`) resolved from the compiled roof/wall style ids.
- The city (ground + walls + roofs) is **one draw call**; the §12.7 budget is ≤ 10 per frame.
- All world materials are GLSL3 ShaderMaterials writing two MRT outputs (colour, plus the R = shadow / G = light mask).

Shadows: build the building-shadow mesh once per district from the storeys layer using M0's shadows.ts. Polygons project SE with length 0.84 × height (sun azimuth 315°, elevation 50°), at y = 0, depth layer 1, drawn with MAX blend into the mask and depth-tested against roofs.

Invariants:
- At H = 31.5 m the ground is exactly 1 texel = 1 px.
- No per-frame `new THREE.*`.
- Render reads sim and level data and never writes it.
- Count draw calls with `renderer.info.autoReset = false` and one reset per frame.

Preview: ShiftScene does not exist yet (it depends on this issue). Add a test-only `level_preview` scene (bootable with `?test=1&scene=level_preview&freeze=1`) that loads compiled Puddle Lane with a pinned camera, for the review capture. SSP-046 may keep or remove it.

Rewriting cityMesh may change the M0 `lean_quadrants` and `scale_1440` goldens. If so, open expected, actual and diff with Read and describe the change before any `test:visual:update`. Never loosen the threshold.

## Scope

- src/render/groundLayer.ts: chunked build, atlas UVs from FRAME, autotile and variant selection, a merged single geometry
- src/render/cityMesh.ts: full cell merge, wall culling to lower/open neighbours, world-metre UVs, lit/base/dark selection by face normal, roofs
- Ground and city combined into one draw; building shadow mesh from the compiled storeys
- Test-only level_preview scene for frozen captures
- A unit test that every autotile index, ground type, roof id and facade id present in compiled Puddle Lane resolves to an existing FRAME entry
- Unit tests of the merge and wall-emission logic on small fixtures (pure functions, no WebGL)

## Out of scope

- Grime mask sampling (M2)
- Roof furniture, landmark roofs, real facades (M4/M6)
- Camera look-ahead and zoom: SSP-047
- ShiftScene: SSP-046

## Acceptance criteria

- [ ] On a fixture of two adjacent 2-storey cells and one 3-storey cell, only the walls facing lower or open cells are emitted (vertex/face count assertion)
- [ ] Every autotile index, ground type, roof and facade id in compiled Puddle Lane resolves to a FRAME id (the test fails on a missing frame)
- [ ] The district city mesh plus ground renders in one draw call; renderer.info.render.calls ≤ 10 for the frame
- [ ] lean_quadrants and scale_1440 pass at threshold 0, or any golden update has its diffs Read and is explained in the commit
- [ ] A frozen capture of `?test=1&scene=level_preview&freeze=1` (via readFrame) is opened with Read and the PR notes kerbs, facades by face direction, and shadows falling SE

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-039](SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end
- [SSP-040](SSP-040-procedural-tiles.md) Generate placeholder ground tiles and the 47-tile kerb blob set with tiles.py
- [SSP-041](SSP-041-placeholder-facades-roofs.md) Add placeholder facade modules, facade sets and roof surfaces for Puddle Lane
- [SSP-034](SSP-034-compiler-autotile-collision.md) Add kerb blob autotile, kerb edges, collision bits and merged solids to compiler
- [SSP-042](SSP-042-puddle-lane-level.md) Author Puddle Lane map.txt and level.json (64×48) and commit compiled output
- [SSP-032](SSP-032-level-map-codec.md) Add src/sim/map.ts compiled-level codec, tile/surface/collide ids and solid merge
- [SSP-043](SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-015](../M0/SSP-015-render-core-camera-upscale.md) Build the renderer skeleton: perspective camera, sub-pixel snap, upscale and speed zoom
- [SSP-016](../M0/SSP-016-palette-pass.md) Implement the MRT world target and palette pass (64³ OKLab LUT, night/shadow remap)
- [SSP-017](../M0/SSP-017-city-mesh-shadows.md) Render merged 1/3/6-storey block meshes with facade ramps and SE shadow polygons
- [SSP-022](../M0/SSP-022-visual-goldens.md) Add lean_quadrants and scale_1440 visual specs and goldens; prove 10-run stability (D-09)

**Blocks:**

- [SSP-046](SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie
- [SSP-050](SSP-050-m1-exit-close.md) Verify M1 exit criteria, run the lead handling playtest and open the Close M1 PR
- [SSP-066](../M2/SSP-066-grime-ground-shader.md) Sample the grime mask in the ground shader with incremental dirty-rect uploads
- [SSP-113](../M4/SSP-113-forge-pack-atlases.md) Lock atlas trimming and the 1 px gutter, cover all five atlases and add the fill-ratio report
- [SSP-119](../M4/SSP-119-tiles-road-surfaces.md) Final procedural road tiles: asphalt, markings, double yellows, zebra, drains, bays
- [SSP-120](../M4/SSP-120-tiles-kerb-blob.md) Final 47-tile kerb blob autotile generated by rule
- [SSP-125](../M4/SSP-125-facades-old-town.md) Old Town terrace facade modules and the pledge rosette (Puddle Lane)

## References

- ../../TECHNICAL_DESIGN.md#124-city-mesh-and-ground-citymeshts-groundlayerts
- ../../TECHNICAL_DESIGN.md#123-frame-graph
- ../../TECHNICAL_DESIGN.md#125-sprites-spritebatchts-spritestackts
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../ART_BIBLE.md#42-building-lean
- ../../ART_BIBLE.md#93-building-language
- ../../ART_BIBLE.md#94-facades
- ../../TECHNICAL_DESIGN.md#184-visual-headless-screenshot-tests

## Roadmap tasks covered

- `src/render/groundLayer.ts`: chunked merged ground geometry sampling the `world` atlas.
- `src/render/cityMesh.ts`: full cell merge, walls only toward lower or open cells, UVs in world metres.
- `Exit criteria: Puddle Lane ... rendered with procedural placeholder tiles and facades.`
