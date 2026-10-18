---
id: SSP-132
title: "Blender roof kit and the seeded roof-furniture layout script"
milestone: M4
status: todo
type: asset
estimate: L
labels: [type:asset, area:assets, area:tooling, area:render, size:L, vertical-slice]
depends_on: [SSP-111, SSP-124, SSP-115, SSP-116, SSP-017, SSP-007, SSP-033]
blocks: [SSP-158]
---

# SSP-132: Blender roof kit and the seeded roof-furniture layout script

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** L · **Areas:** assets, tooling, render · **Vertical slice**

## Summary

Model the roof furniture kit in Blender at 4 headings, and implement the seeded forge layout that places it on roofs so roofs never read as empty slabs (especially chimneys on the Puddle Lane terraces).

## Context

Roof furniture (ASSET_PIPELINE §2, §7.5, §10.3): AC units, vents, skylights, water tanks, chimneys, stair housings. Blender, rendered straight down, `--headings 4` (h00-h03 in 90-degree steps, manifest `dirs: 'h4'`), scripts in `assets-src/blender/roofkit/*.py`. IDs are in the `roof.*` class: `roof.water_tank` is named; name the others (e.g. `roof.ac_unit`, `roof.chimney`) and add them to the manifest. The seeded `tools/forge/forge/procedural/roof_layout.py` places units on whole-tile roof cells and picks one of the 4 headings so lighting stays correct. Furniture is registered via `assets-src/procedural/roofs/*.json` -> `"furniture": [{"id": "roof.water_tank", "weight": 2}]`. Target at least 1 piece per 3 roof cells (proposed). Chimney pots use 11 terracotta. Roof kit frames go to the `world` atlas (§12 lists world for the roof kit). Open questions to resolve and record in ASSET_PIPELINE §10.3 and TECHNICAL_DESIGN §12.4: (1) the roof-kit cell size is unspecified (propose 32x32, `--size 128`). (2) Data flow: roof geometry comes from level maps compiled by `tools/levels/compile-level.ts` (TS), yet the layout script is Python in the forge. Decide whether roof_layout.py reads `assets-src/levels/*.map.txt`, or emits per-roof-style placement rules that compile-level consumes, keeping determinism. (3) How placed furniture is drawn at roof height while the city stays one draw call; baking it into the city mesh as textured quads at roof height is the likely answer (TECHNICAL_DESIGN §12.4/§12.7). The low-frequency rule for 4+ storey roofs applies (features >= 2 px).

## Scope

- Six roofkit scripts, renders and render.json
- Blender build support for `h4` dirs if missing
- `roof_layout.py` seeded with PCG64 from params; pytest for determinism and whole-tile placement
- Rendering of placed furniture on roofs within the draw-call budget
- Document cell size, layout data flow and rendering approach
- Review in `lean_quadrants`, zoo and a Puddle Lane capture

## Out of scope

- Landmark roofs (M6)
- Night lighting on roofs

## Acceptance criteria

- [ ] All six kit items render at 4 headings and pass `--check` with 0 changed pixels
- [ ] pytest: the same seed gives an identical layout; every piece sits on a whole-tile roof cell; density is >= 1 per 3 roof cells on Puddle Lane
- [ ] `npm run test:e2e` perf `ci` project still asserts draw calls <= 10
- [ ] Puddle Lane roofs show chimneys and furniture in a 1x capture opened with Read
- [ ] Cell size, data flow and render approach are documented; lint clean; goldens updated only after reading diffs

## Verification

- npm run assets:blender -- roof.water_tank --check (repeat for each kit item)
- uv run --project tools/forge pytest
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run test:visual && npm run test:e2e

## Dependencies

**Depends on:**

- [SSP-111](SSP-111-forge-build-procedural.md) Harden the procedural technique: generator registry, params validation, fx play frames and a shared seam metric
- [SSP-124](SSP-124-roof-surfaces.md) Final procedural roof surfaces: felt, gravel, slate, corrugated
- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-017](../M0/SSP-017-city-mesh-shadows.md) Render merged 1/3/6-storey block meshes with facade ramps and SE shadow polygons
- [SSP-007](../M0/SSP-007-blender-rig-wrapper.md) Implement assets-src/blender/rig.py and the forge blender wrapper with --check
- [SSP-033](../M1/SSP-033-level-compiler-core.md) Build level schema and compile-level.ts core: parse, legend, buildings, M1 checks

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR

## References

- ../../ASSET_PIPELINE.md#103-roof-furniture-roof-blender-kit
- ../../ASSET_PIPELINE.md#75-special-cases
- ../../ART_BIBLE.md#95-roofs
- ../../TECHNICAL_DESIGN.md#124-city-mesh-and-ground-citymeshts-groundlayerts
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation

## Roadmap tasks covered

- `assets-src/blender/roofkit/*.py`: AC units, vents, skylights, water tanks, chimneys, stair housings, plus the seeded roof layout script.
