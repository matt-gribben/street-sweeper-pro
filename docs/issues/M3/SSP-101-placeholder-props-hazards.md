---
id: SSP-101
title: "Add placeholder sprites for knockables, hazards, SSP-096 and High Street props"
milestone: M3
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, area:test, size:M, vertical-slice]
depends_on: [SSP-040, SSP-039, SSP-052, SSP-298]
blocks: [SSP-096, SSP-103, SSP-105, SSP-115, SSP-123, SSP-130, SSP-131, SSP-148, SSP-149]
---

# SSP-101: Add placeholder sprites for knockables, hazards, SSP-096 and High Street props

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** asset · **Size:** M · **Areas:** assets, test · **Vertical slice**

## Summary

Give every M3 knockable, hazard, power-up and any static prop or tile the M3 levels need a placeholder sprite under its final ID, so the street-life entities are visible before M4.

## Context

From ENTITY_CATALOG §9, §10, §12 and ART_BIBLE §7.1/§8.5–8.7:
- Props: 32×32 per slice, `flat` (1 frame) or `stack` (4–8 slices, frame IDs `prop.<id>:slice:-:<k>`). Atlas items. Slice counts are TBD (M0 spike): use whatever STYLE.md / the M0 decision log recorded.
- Knockables (grid, assets-src/sprites/prop/): wheelie_bin stack (22 or 01 lid), traffic_cone stack (17 with 07 bands), a_board stack (07 with 03 lines), shopping_trolley flat, recycling_box flat (26 with 22 lid).
- Hazards: 32×32 ground decals, atlas world, procedural placeholder params (assets-src/procedural/...): haz.puddle, haz.oil_slick, haz.pothole, haz.broken_glass (2-frame glint), haz.wet_leaves. haz.speed_bump (from `=`) and haz.open_manhole (manhole tile variant) are ground-tile variants. Looks in ART_BIBLE §8.7.
- Power-ups: M2 made placeholders only for the pwr.* Puddle Lane uses (flask_of_tea). Add the missing ones (bacon_butty, hi_vis, super_suction, wrench, water_can): 16×16 cell, 12×12 body, bob ×2, grid in assets-src/sprites/pickup/, atlas items, icons per ART_BIBLE §8.5.
- Static props High Street needs (bus_shelter `u`, planter `g`, market_stall `m`, bench `n`, phone_box `f`, post_box `q`, litter_bin `i`, bollard `!`, roadworks_barrier, tree, lamp_post): check the manifest and add placeholders only for IDs that lack one.
- A cobbles ground tile for `:`: if missing, add it to the M1 procedural placeholder tile set under its final tile.* ID.

Every new manifest entry gets `"placeholder": true`, sorted by id. Kerbside-32 only.

The minimal M3 ZooScene (SSP-298) draws only actors- and items-atlas frames. Frames packed into other atlases (for example world-atlas hazard decals) are reviewed on the contact sheets alone until SSP-118 extends the zoo in M4. Say in the PR which applies.

## Scope

- Knockable grids, hazard decal placeholders, missing pwr.* grids, missing static-prop and cobble placeholders.
- Manifest entries.
- Run `npm run assets`, commit generated outputs, Read the contact sheets and zoo screenshot.

## Out of scope

- Final props, Blender props and roof kit (M4).

## Acceptance criteria

- [ ] Every knockable, hazard and pwr.* ID from the frozen M3 list resolves to FRAME entries in src/gen/assets.ts (typecheck).
- [ ] Every map character used by the M3 maps (puddle_lane and the planned high_street legend) resolves to an existing sprite or tile.
- [ ] `npm run assets:lint` and `npm run assets:verify` pass; contact sheets and `?test=1&scene=zoo` were opened with Read and noted in the PR.
- [ ] `npm run test:visual` passes (existing goldens).

## Verification

- npm run assets
- npm run assets:lint
- npm run assets:verify
- npm run assets:sheets
- npm run typecheck
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-040](../M1/SSP-040-procedural-tiles.md) Generate placeholder ground tiles and the 47-tile kerb blob set with tiles.py
- [SSP-039](../M1/SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end
- [SSP-052](../M2/SSP-052-placeholder-stains-pickups-sites.md) Add stain generator, grime overlays and pickup/collectible/site/hydrant grids
- [SSP-298](SSP-298-zoo-scene-review.md) Add a minimal test-only ZooScene for in-engine review of actors and items frames

**Blocks:**

- [SSP-096](SSP-096-power-ups.md) Spawn power-ups on pavements, implement all six pwr.* effects, draw them
- [SSP-103](SSP-103-render-actors-traffic.md) Draw NPCs, animals, traffic, knockables and hazards with state-driven frames
- [SSP-105](SSP-105-high-street-greybox.md) Author and compile the grey-box High Street (80×60) for Tuesday's NPCs
- [SSP-115](../M4/SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-123](../M4/SSP-123-stains-hazards.md) Procedural stain and hazard ground decals for the Mon-Tue set
- [SSP-130](../M4/SSP-130-blender-props-flat.md) Blender flat props: bench, planter and the skip
- [SSP-131](../M4/SSP-131-blender-props-stacks.md) Blender sprite-stack props: lamp post, phone box, tree, bus shelter, stall
- [SSP-148](../M4/SSP-148-small-props-grids.md) Hand-author small prop grids, including grid sprite stacks
- [SSP-149](../M4/SSP-149-pickups-grids.md) Hand-author power-up and Mon-Tue collectible pickup grids

## References

- ../../ENTITY_CATALOG.md#9-props-and-obstacles-prop
- ../../ENTITY_CATALOG.md#10-hazards-haz
- ../../ENTITY_CATALOG.md#12-power-ups-pwr
- ../../ART_BIBLE.md#71-size-sheet-locked
- ../../ART_BIBLE.md#85-pickups-and-collectibles
- ../../ART_BIBLE.md#86-props
- ../../ART_BIBLE.md#87-stains-and-hazards-ground-decals
- ../../ASSET_PIPELINE.md#107-small-prop-pickup-or-ui-icon-grids
- ../../ROADMAP.md#51-asset-readiness-by-milestone

## Roadmap tasks covered

- `Asset readiness §5.1: props, stains, hazards, pickups are P (placeholder) in M3`
