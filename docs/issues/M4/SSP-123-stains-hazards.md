---
id: SSP-123
title: "Procedural stain and hazard ground decals for the Mon-Tue set"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, area:tooling, size:M, vertical-slice]
depends_on: [SSP-111, SSP-115, SSP-116, SSP-118, SSP-052, SSP-101]
blocks: [SSP-158, SSP-225]
---

# SSP-123: Procedural stain and hazard ground decals for the Mon-Tue set

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets, tooling · **Vertical slice**

## Summary

Replace the placeholder `stain.*` and `haz.*` decals with final procedural 32x32 ground decals, including the speed bump and open manhole tile variants.

## Context

Cell 32x32, atlas `world`, technique `procedural` (for hazards this is proposed; confirm it), not outlined, state `v` (ART_BIBLE §8.7; ENTITY_CATALOG §5, §10). Stains (1-3 variants each): `stain.gum` scattered 2-3 px 06/05 flattened blobs; `stain.milkshake` 20 splash with a 07 core and a 1 px 13 cup outline nearby; `stain.oil` 01 pool with 30 and 29 sheen pixels on the NW side; `stain.chalk_art` 07, 20, 27, 16, 31 child drawings (hopscotch, sun, stick cat), 3 variants; `stain.splat` 08/13 brown splat with radial flecks. Hazards (the frozen M3 Mon-Tue scope): `haz.puddle` 25 body, 27 inner rim NW, 28 glints (2 px), irregular edge; `haz.oil_slick` as stain.oil; `haz.pothole` 00 core, 01 bowl, 03 broken rim, 04 crumbs; `haz.speed_bump` tile-wide band of 03 with 07 or 15 chevrons ('rendered as a ground tile variant'); `haz.wet_leaves` 14/11/13 leaves over a 01-darkened patch; `haz.broken_glass` 28/07/27 shards with a 2-frame glint; `haz.open_manhole` 00 hole, 03 rim, lid 04 slid aside ('tile variant of the manhole ground tile'). `haz.wind_gust` has no sprite. Open: broken glass needs a 2-frame animated state, but the state vocabulary only lists `v` for haz. Either animate `v` 0-1, or add a `glint` state to ART_BIBLE §14.4 and the manifest in the same PR (§14.4 requires that). Rating guard: no gore in any decal.

## Scope

- Generators + params for the 5 stains and 7 hazards above
- pytest for determinism and palette subsets
- Resolve the broken-glass animation state
- Manifest upgrade, sheet + zoo review

## Out of scope

- Rain ripples and weather variants (M6)
- Hazard gameplay (M3)

## Acceptance criteria

- [ ] All 5 `stain.*` and the 7 listed `haz.*` build procedurally; none keeps `placeholder: true`
- [ ] `stain.chalk_art` has 3 variants; every stain has 1-3
- [ ] pytest: each decal uses only its documented indices
- [ ] Lint clean (decals are not outlined)
- [ ] Each decal reads on asphalt 02 and slab 05 in the zoo (Read, noted in PR)
- [ ] The broken-glass state decision is recorded in ART_BIBLE §14.4

## Verification

- uv run --project tools/forge pytest
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas world, then Read build/sheets/world.png
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-111](SSP-111-forge-build-procedural.md) Harden the procedural technique: generator registry, params validation, fx play frames and a shared seam metric
- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-118](SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-052](../M2/SSP-052-placeholder-stains-pickups-sites.md) Add stain generator, grime overlays and pickup/collectible/site/hydrant grids
- [SSP-101](../M3/SSP-101-placeholder-props-hazards.md) Add placeholder sprites for knockables, hazards, SSP-096 and High Street props

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-225](../M6/SSP-225-art-world-tiles-m6.md) Art Pass 2: procedural ground tiles, hazard decals and stains for Wed-Sun

## References

- ../../ART_BIBLE.md#87-stains-and-hazards-ground-decals
- ../../ENTITY_CATALOG.md#5-stains-stain
- ../../ENTITY_CATALOG.md#10-hazards-haz
- ../../ART_BIBLE.md#144-naming-conventions

## Roadmap tasks covered

- `Stains and grime variants.`
