---
id: SSP-130
title: "Blender flat props: bench, planter and the skip"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, area:tooling, size:M, vertical-slice]
depends_on: [SSP-115, SSP-116, SSP-118, SSP-052, SSP-101]
blocks: [SSP-158, SSP-209]
---

# SSP-130: Blender flat props: bench, planter and the skip

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets, tooling · **Vertical slice**

## Summary

Model and render the single-frame volumetric props that are not sprite stacks: the bench, the planter, and the skip used by `site.skip`.

## Context

Blender, straight down, same rig and sun, `--headings 1`, state `flat`, dir `-`, atlas `items`, outline true (ASSET_PIPELINE §2, §10.2; ENTITY_CATALOG §9.2). `prop.bench`: 13 slats, 01 frame (Mon, Tue). `prop.planter`: Blender is proposed in the catalog (Tue). Skip: 17 or 22 steel with a 01 interior. The `site.skip` visual is 'Blender prop (skip)', and the docs name no separate sprite ID. Prefer `site.skip` itself as the asset ID (no new ID). Otherwise add one per CLAUDE.md §5.4 (entities.json + ENTITY_CATALOG + manifest together). Size gap: props are '32x32 per slice' (ENTITY_CATALOG §9), but at 16 px/m a skip (~3.6 x 1.7 m) is ~58x27 px and cannot fit. Decide the skip's cell (e.g. 64x32 or 64x64) and record it in ART_BIBLE §7.1 and ENTITY_CATALOG §9. The size sheet was signed off in M0 (D-07), so flag the change for the lead in the PR. Open: flat props render at 1 heading, but benches and skips are placed along kerbs in different orientations. Decide between code rotation in 90-degree steps (which breaks NW lighting) and rendering `h4` like the roof kit, and record it in ASSET_PIPELINE §7.5.

## Scope

- `assets-src/blender/props/{bench,planter,skip}.py`, renders and render.json
- Decide the skip asset ID, its cell size and orientation handling; document them
- Manifest entries, sheet + zoo review

## Out of scope

- Stacked props (SSP-131)
- Depot props for Skip Run (M6)

## Acceptance criteria

- [ ] All three props render via `npm run assets:blender` and pass `--check` with 0 changed pixels
- [ ] The skip asset ID, cell size and orientation decision are documented in ASSET_PIPELINE §7.5 / ART_BIBLE §7.1 / ENTITY_CATALOG as applicable
- [ ] Placed instances keep NW lighting in a Puddle Lane capture (Read, noted)
- [ ] No Mon-Tue entry for these props keeps `placeholder: true`; lint clean; sheet + zoo read

## Verification

- npm run assets:blender -- prop.bench --check (repeat for prop.planter and the skip ID)
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas items, then Read build/sheets/items.png
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-118](SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-052](../M2/SSP-052-placeholder-stains-pickups-sites.md) Add stain generator, grime overlays and pickup/collectible/site/hydrant grids
- [SSP-101](../M3/SSP-101-placeholder-props-hazards.md) Add placeholder sprites for knockables, hazards, SSP-096 and High Street props

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-209](../M6/SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)

## References

- ../../ART_BIBLE.md#86-props
- ../../ART_BIBLE.md#71-size-sheet-locked
- ../../ENTITY_CATALOG.md#92-static-props
- ../../ENTITY_CATALOG.md#11-sites-site
- ../../ASSET_PIPELINE.md#102-volumetric-or-tall-prop-prop-blender--sprite-stack
- ../../ASSET_PIPELINE.md#75-special-cases

## Roadmap tasks covered

- `assets-src/blender/props/*.py`: bus shelter, phone box, bench, tree canopy, market stall, skip, with sprite-stack slices for tall props (lamp posts, phone boxes, trees).
