---
id: SSP-124
title: "Final procedural roof surfaces: felt, gravel, slate, corrugated"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, area:tooling, area:render, size:M, vertical-slice]
depends_on: [SSP-111, SSP-115, SSP-116, SSP-017, SSP-041]
blocks: [SSP-132, SSP-158, SSP-228]
---

# SSP-124: Final procedural roof surfaces: felt, gravel, slate, corrugated

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets, tooling, render · **Vertical slice**

## Summary

Final procedural roof textures aligned to the tile grid, including the low-frequency variants for 4+ storey buildings and the 1 px roof-edge line that separates roofs from the street.

## Context

ART_BIBLE §9.5: Felt (flat) 01/02 with 03 patches (Gasworks, flat-roof shops). Gravel (flat) 04/05 speckle on 03 (office, civic). Slate (pitched) 02/03 courses every 4 px, with a 25 tint on the lit slope (Old Town terraces; Puddle Lane uses `roof.slate`). Corrugated 05/06 stripes every 2 px (industrial, depot sheds). Procedural at 16 px/m, aligned to the tile grid, params in `assets-src/procedural/roofs/*.json`. Low-frequency rule: for 4+ storeys, speckle density halves and features are >= 2 px (magnification reaches 1.91x at 6 storeys; High Street is 4-5 storeys). Roof edge (§9.3): every roof has a 1 px parapet/eave line, 06 or the roof's lit step on NW edges and the dark step on SE edges. Open: decide whether the edge line is baked into roof texture variants or drawn by `cityMesh`, and record it. Roofs are not outlined. Roof params also host the `furniture` list consumed by the roofkit layout (SSP-132). Keep the M1 placeholder roof IDs.

## Scope

- `tools/forge/forge/procedural/roofs.py` generators and the four params files
- Low-frequency variants or params for 4+ storeys
- Roof edge line implementation (texture or mesh) and documentation
- Manifest upgrade, sheet + `lean_quadrants`/zoo review

## Out of scope

- Roof furniture and its layout (SSP-132)
- Landmark roofs (M6)

## Acceptance criteria

- [ ] Four roof families build procedurally; Mon-Tue roof entries have no `placeholder: true`
- [ ] pytest: 4+ storey variants have half the speckle density and no isolated single-pixel features
- [ ] Roofs show a 1 px edge line in `lean_quadrants` (Read actual)
- [ ] The edge-line approach is recorded in ART_BIBLE §9.3 or TECHNICAL_DESIGN §12.4
- [ ] Lint clean; `npm run test:visual` passes, or reviewed updates are committed with a reason

## Verification

- uv run --project tools/forge pytest
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas world, then Read build/sheets/world.png
- npm run test:visual, Read lean_quadrants expected/actual/diff if changed

## Dependencies

**Depends on:**

- [SSP-111](SSP-111-forge-build-procedural.md) Harden the procedural technique: generator registry, params validation, fx play frames and a shared seam metric
- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-017](../M0/SSP-017-city-mesh-shadows.md) Render merged 1/3/6-storey block meshes with facade ramps and SE shadow polygons
- [SSP-041](../M1/SSP-041-placeholder-facades-roofs.md) Add placeholder facade modules, facade sets and roof surfaces for Puddle Lane

**Blocks:**

- [SSP-132](SSP-132-roofkit-layout.md) Blender roof kit and the seeded roof-furniture layout script
- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-228](../M6/SSP-228-art-landmark-roofs.md) Art Pass 2: landmark roofs for the Town Hall, Pier and Depot via Codex goldens

## References

- ../../ART_BIBLE.md#95-roofs
- ../../ART_BIBLE.md#93-building-language
- ../../ASSET_PIPELINE.md#108-ground-tile-roof-surface-stain-or-vfx-procedural
- ../../TECHNICAL_DESIGN.md#124-city-mesh-and-ground-citymeshts-groundlayerts

## Roadmap tasks covered

- `Roof surfaces: felt, gravel, slate, corrugated.`
