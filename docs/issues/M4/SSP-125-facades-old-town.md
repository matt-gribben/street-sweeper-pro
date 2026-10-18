---
id: SSP-125
title: "Old Town terrace facade modules and the pledge rosette (Puddle Lane)"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, area:tooling, size:M, vertical-slice]
depends_on: [SSP-111, SSP-115, SSP-116, SSP-118, SSP-041, SSP-045]
blocks: [SSP-126, SSP-158, SSP-215, SSP-226]
---

# SSP-125: Old Town terrace facade modules and the pledge rosette (Puddle Lane)

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets, tooling · **Vertical slice**

## Summary

Author the 32x40 Old Town facade modules and the terrace facade set for Puddle Lane with forge-derived lit/dark variants, plus the pledge rosette door module and doorstep decal.

## Context

Modules are 32x40 px (2 m x 1 storey) text grids in `assets-src/sprites/facade/*.sprite.txt`, authored at base ramp values only, and assembled by a set such as `assets-src/procedural/facades/terrace_brick.json`. The forge derives `lit` (N/W faces) and `dark` (E/S faces) (ART_BIBLE §9.4; cityMesh picks the variant by face normal, TECHNICAL_DESIGN §12.4). Typical set (proposed): plain brick, sash window, bay window, terrace door, drainpipe overlay, ground-floor rendered band, gable end. Foreshortening rule: windows are bold 25 blocks of at least 8x12 px with 06/07 frames and a 1 px sill; every storey has a horizontal band (sill line or string course); no brick-by-brick texture, only sparse 1 px 09 mortar at 4 px spacing. Puddle Lane colour key: 09, 10, 11 brick terraces, 2-storey terraces and a 3-storey parade with a corner shop. Pledge frontages (`site.pledge_frontage`, 8 in Puddle Lane) show the green rosette (23/22 with a 07 centre) twice: on the door module, and as a 6x6 doorstep decal on the pavement. Open: the doorstep decal has no asset ID, and `decal.*` is an ai-ingest class. Propose an ID (e.g. a frame of a facade/tile asset, or a new ID added per CLAUDE.md §5.4 to the manifest and docs) and how it is placed (level compile from `site.pledge_frontage`). Facades are not outlined. Review: facades must read when squeezed to 25% width; check `lean_quadrants`.

## Scope

- Old Town module grids (set above) and the terrace facade set JSON
- Pledge rosette door module and 6x6 doorstep decal (ID and placement decided and documented)
- Manifest upgrade; contact sheet, zoo and `lean_quadrants` review

## Out of scope

- High Street shopfronts and signs
- Wed-Sun facade styles (M6)

## Acceptance criteria

- [ ] All Puddle Lane facades build from final modules; no Old Town facade entry keeps `placeholder: true`
- [ ] Windows >= 8x12 px and each storey has a horizontal band (checked on the sheet, noted in PR)
- [ ] Lit/dark variants are forge-derived; no `lit`/`dark` grid is hand-authored
- [ ] The pledge rosette is visible on the door module and the doorstep decal in a Puddle Lane capture opened with Read
- [ ] Lint clean; visual goldens pass or reviewed updates are committed

## Verification

- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas world, then Read build/sheets/world.png
- npm run test:visual (lean_quadrants, zoo)

## Dependencies

**Depends on:**

- [SSP-111](SSP-111-forge-build-procedural.md) Harden the procedural technique: generator registry, params validation, fx play frames and a shared seam metric
- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-118](SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-041](../M1/SSP-041-placeholder-facades-roofs.md) Add placeholder facade modules, facade sets and roof surfaces for Puddle Lane
- [SSP-045](../M1/SSP-045-render-ground-city.md) Render compiled levels: chunked ground layer and full cityMesh cell merge

**Blocks:**

- [SSP-126](SSP-126-facades-high-street.md) High Street shopfront facade modules and facade sets
- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-215](../M6/SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-226](../M6/SSP-226-art-facades-m6.md) Art Pass 2: facade module sets for every remaining building style

## References

- ../../ART_BIBLE.md#94-facades
- ../../ASSET_PIPELINE.md#109-facade-module-grid--procedural-assembly
- ../../LEVEL_DESIGN.md#51-mon-puddle-lane-districtpuddle_lane-tutorial
- ../../ENTITY_CATALOG.md#11-sites-site
- ../../TECHNICAL_DESIGN.md#124-city-mesh-and-ground-citymeshts-groundlayerts

## Roadmap tasks covered

- Facades for Old Town terraces and High Street shopfronts, `_lit`/`_base`/`_dark`.
