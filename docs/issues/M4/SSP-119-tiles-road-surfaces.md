---
id: SSP-119
title: "Final procedural road tiles: asphalt, markings, double yellows, zebra, drains, bays"
milestone: M4
status: todo
type: asset
estimate: L
labels: [type:asset, area:assets, area:tooling, size:L, vertical-slice]
depends_on: [SSP-111, SSP-115, SSP-116, SSP-118, SSP-040, SSP-045, SSP-066]
blocks: [SSP-122, SSP-158, SSP-225]
---

# SSP-119: Final procedural road tiles: asphalt, markings, double yellows, zebra, drains, bays

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** L · **Areas:** assets, tooling · **Vertical slice**

## Summary

Replace the M1 placeholder road tiles with final seeded procedural generators: asphalt, lane markings, double yellows, zebra crossings, drains and manholes. Also cover the road-edge markings that Mon-Tue maps use (parking bays, bus stop boxes, depot bay hatching, concrete apron). Each one passes the seam lint.

## Context

World atlas, 32x32 cells, not outlined, state `v` (variant n). Generators live in `tools/forge/forge/procedural/tiles.py`, params in `assets-src/procedural/tiles/*.json` (ART_BIBLE §9.1). Asphalt: 02 base, 03 and 01 aggregate speckle <= 8% of pixels, single pixels and never clumps larger than 2x1, occasional 01 patch repairs (variant count per the SSP-111 resolution of 4 vs 6). Lane markings: 07 worn to 06; centre dashes 2 px x 32 px with 32 px gaps (proposed). Double yellows: 15 with 14 shade, 1 px each line, 2 px apart, 2 px from the kerb (15 is allowed here; reserved otherwise, ART_BIBLE §5.3). Zebra: 07 bars 8 px wide (0.5 m) on 02, plus 07 zig-zag lines on approaches. Drains and manholes: 01 grid slots with 00, 04 rim. Map legend (LEVEL_DESIGN §8.3) also uses `p` parking bay, `b` bus stop (High Street has a painted bus box), `$` `site.depot_bay` ('procedural bay markings'; Depot Yard key 15/14 bay hatching, ART_BIBLE §5.5), and `+` concrete apron (depot yards; every shift has a depot on its edge). Calmness rule: internal contrast stays within one ramp step. Clean tiles are slightly crisper than the average street (fresh 07 markings, tidy speckle). Seam rule: wrap-edge diff <= interior diff. Keep the M1 placeholder asset IDs and frame IDs (only `tile.asphalt` is named in the docs) and remove `placeholder: true` per entry. Give-way/SLOW lettering tiles need Kerbside Bold scaled into the tile, and are only required if the Mon-Tue maps use them.

## Scope

- Generators and params for asphalt, lane markings, double yellows, zebra (bars + zig-zags), drains, manholes
- Parking bay, bus stop box, depot bay hatching and concrete apron, using whatever tile IDs M1 used
- pytest per generator: determinism, seam, speckle <= 8%, allowed index set per family
- Manifest entries upgraded (technique procedural, placeholder removed)
- Review on contact sheet (3x3 preview) and in the zoo; PR notes per ASSET_PIPELINE §11.4

## Out of scope

- Kerbs (47-tile blob), slabs, grass, cobbles, setts, tactile (separate issues)
- Speed bump and open manhole hazard variants (SSP-123)
- Give-way/SLOW lettering unless a Mon-Tue map uses it

## Acceptance criteria

- [ ] All listed families build via procedural generators; no Mon-Tue road tile entry keeps `placeholder: true`
- [ ] pytest: asphalt speckle <= 8% of pixels, no speckle clump larger than 2x1
- [ ] pytest: double yellows use only 15/14 on their lines and lie 2 px from the kerb edge
- [ ] `npm run assets:lint` is clean, including the seam rule for every `wrap: true` tile
- [ ] Frame IDs are identical to the M1 placeholders, except an asphalt variant count changed by SSP-111
- [ ] Contact sheet and zoo opened with Read; the PR lists the ART_BIBLE §15.2 tile checks

## Verification

- uv run --project tools/forge pytest
- npm run assets && npm run assets && git status --short
- npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --only tile.asphalt, then Read build/sheets/only_tile.asphalt.png
- npm run assets:sheets -- --atlas world, then Read build/sheets/world.png
- npm run test:visual (approve zoo/lean_quadrants changes only after reading expected/actual/diff)

## Dependencies

**Depends on:**

- [SSP-111](SSP-111-forge-build-procedural.md) Harden the procedural technique: generator registry, params validation, fx play frames and a shared seam metric
- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-118](SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-040](../M1/SSP-040-procedural-tiles.md) Generate placeholder ground tiles and the 47-tile kerb blob set with tiles.py
- [SSP-045](../M1/SSP-045-render-ground-city.md) Render compiled levels: chunked ground layer and full cityMesh cell merge
- [SSP-066](../M2/SSP-066-grime-ground-shader.md) Sample the grime mask in the ground shader with incremental dirty-rect uploads

**Blocks:**

- [SSP-122](SSP-122-grime-overlays.md) Procedural grime overlay patterns for asphalt, slab and gutter
- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-225](../M6/SSP-225-art-world-tiles-m6.md) Art Pass 2: procedural ground tiles, hazard decals and stains for Wed-Sun

## References

- ../../ART_BIBLE.md#91-ground-tiles
- ../../ART_BIBLE.md#55-district-colour-keys
- ../../ASSET_PIPELINE.md#108-ground-tile-roof-surface-stain-or-vfx-procedural
- ../../ASSET_PIPELINE.md#64-procedural-params-assets-srcproceduraljson
- ../../LEVEL_DESIGN.md#83-default-legend
- ../../ART_BIBLE.md#152-the-checklist

## Roadmap tasks covered

- `Final ground tiles: asphalt, lane markings, double yellows, kerbs (47-tile blob), pavement slabs, zebra, drains, manholes, grass, cobbles, tactile paving. Each passes the wrap-edge seam lint.`
