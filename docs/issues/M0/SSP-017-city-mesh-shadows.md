---
id: SSP-017
title: "Render merged 1/3/6-storey block meshes with facade ramps and SE shadow polygons"
milestone: M0
status: todo
type: feature
estimate: M
labels: [type:feature, area:render, size:M, vertical-slice]
depends_on: [SSP-016]
blocks: [SSP-019, SSP-045, SSP-118, SSP-124, SSP-132]
---

# SSP-017: Render merged 1/3/6-storey block meshes with facade ramps and SE shadow polygons

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** feature · **Size:** M · **Areas:** render · **Vertical slice**

## Summary

A simple `cityMesh.ts` builds the spike's 1-, 3- and 6-storey blocks as merged boxes with `_lit`/`_base`/`_dark` placeholder facade and roof textures. `shadows.ts` projects SE building shadows (0.84 x height) into the mask with MAX blending.

## Context

World scale: 16 px/m, 2 m map cells (32 px tiles), storey = 2.5 m = 40 px of facade, facade module 32x40 px (2 m x 1 storey). UVs are in world metres so modules tile. Face variants: N/W faces `_lit`, E/S faces `_dark`, roofs `_base`.

With a straight-down camera a wall is visible exactly when the camera is on its outward side. Back faces are culled, and only walls facing lower or open cells are emitted. Buildings extrude along +Y; sim XY → render XZ (x east, sim y south = render +Z).

Placeholder textures: code-defined, flat or simple banding, Kerbside-32 indices only, built from kerbside32.json colours. For example brick 09/10/11 for dark/base/lit, a slate roof 02/03 with a 1 px parapet line (06 on NW edges, the roof's dark step on SE edges; ART_BIBLE §9.3). Real facades are M4 and procedural facades M1: do not build a generic facade system. Ground is a flat placeholder (02 asphalt / 05 slab); procedural tiles are M1.

The city is ONE draw call: one BufferGeometry, frustumCulled = false.

Building shadows:
- polygons projected toward the SE with length 0.84 x height (sun azimuth 315°, elevation 50°; 1/tan 50° = 0.839);
- one mesh at y = 0 with depth layer 1;
- drawn with MaxEquation writing R = 1 to the mask and vec4(0) to colour;
- depth-tested so roofs occlude them; shadows onto lower roofs are not modelled;
- masked pixels are remapped through shadow[32].

Depth layer offset (vertex shader): `gl_Position.z -= (layer * 8.0 + sortBias) * 1e-5 * gl_Position.w;`. Walls and roofs keep their real heights.

Spike layout input: a cell-grid description with 1-, 3- and 6-storey blocks (2.5 / 7.5 / 15 m). SSP-019 places them at four screen offsets.

## Scope

- src/render/cityMesh.ts: cell-grid input → merged boxes, outward walls only, metre UVs, lit/base/dark by face normal
- Code-defined placeholder facade/roof textures from palette indices
- src/render/shadows.ts: SE shadow polygons (0.84 x h) into the mask via MaxEquation, depth layer 1
- Flat placeholder ground
- Unit tests: wall-emission rules, face-variant selection, shadow polygon geometry

## Out of scope

- Full cell merge from compiled levels, groundLayer.ts and grime (M1/M2)
- Real facade or roof art (M4)
- Roof furniture

## Acceptance criteria

- [ ] Unit tests: no wall between equal-height neighbours; walls emitted toward lower/open cells; N/W walls get _lit, E/S _dark, roofs _base
- [ ] Unit test: a shadow polygon's far edge is offset 0.84 x h along the SE unit vector (+x, +y_sim)
- [ ] City mesh + building shadows add exactly 2 draw calls (renderer.info.render.calls delta)
- [ ] In the dev build a block in the top half of the screen shows its south face and one on the left shows its east face (screenshot under build/, opened with Read)
- [ ] No hex literals in the new files; all colours come from palette indices
- [ ] npm run typecheck, lint and test pass

## Verification

- npm test
- npm run typecheck
- npm run lint
- npm run dev, capture a screenshot to build/ and Read it

## Dependencies

**Depends on:**

- [SSP-016](SSP-016-palette-pass.md) Implement the MRT world target and palette pass (64³ OKLab LUT, night/shadow remap)

**Blocks:**

- [SSP-019](SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-045](../M1/SSP-045-render-ground-city.md) Render compiled levels: chunked ground layer and full cityMesh cell merge
- [SSP-118](../M4/SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-124](../M4/SSP-124-roof-surfaces.md) Final procedural roof surfaces: felt, gravel, slate, corrugated
- [SSP-132](../M4/SSP-132-roofkit-layout.md) Blender roof kit and the seeded roof-furniture layout script

## References

- ../../TECHNICAL_DESIGN.md#124-city-mesh-and-ground-citymeshts-groundlayerts
- ../../TECHNICAL_DESIGN.md#125-sprites-spritebatchts-spritestackts
- ../../ART_BIBLE.md#31-locked-world-scale
- ../../ART_BIBLE.md#42-building-lean
- ../../ART_BIBLE.md#61-the-sun
- ../../ART_BIBLE.md#64-shadows

## Roadmap tasks covered

- `src/render/cityMesh.ts` (simple): merged boxes for 1-, 3- and 6-storey blocks, `_lit`/`_base`/`_dark` facade ramp variants, flat placeholder facade and roof textures.
- `src/render/shadows.ts`: SE shadow polygons (length 0.84 × height) into the mask target.
