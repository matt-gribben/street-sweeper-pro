---
id: SSP-129
title: "Final Blender bus (128x128), bicycle and mobility scooter (32x32)"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, area:tooling, size:M, vertical-slice]
depends_on: [SSP-115, SSP-116, SSP-118, SSP-100]
blocks: [SSP-158]
---

# SSP-129: Final Blender bus (128x128), bicycle and mobility scooter (32x32)

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets, tooling · **Vertical slice**

## Summary

Final Blender models for the bus and the two small vehicles, with riders modelled in, replacing the M3 placeholders under the same frame IDs. The mobility scooter is in the vertical slice; the bus and bicycle are Tuesday.

## Context

`veh.bus`: 128x128 cell, `--size 512`, ortho_scale 8 m, visible 38x116 px (2.38 x 7.25 m), peaking at ~109 px on diagonal headings. Look: 18 red with a 07 roof band, 25 window strips along both flanks, 06 roof vents. `veh.bicycle`: 32x32 cell, `--size 128`, ortho 2 m, visible 8x26 px (0.5 x 1.63 m), 05 frame, rider 29 top and 07 helmet modelled in. `veh.mobility_scooter`: 32x32, `--size 128`, visible 14x22 px (0.88 x 1.38 m), 26 body, rider 30 coat and 06 hair modelled in. All 32 headings, state `body`, outline true (ART_BIBLE §7.1, §8.2; ASSET_PIPELINE §7.5). The bicycle and scooter are tiny, so silhouette and contrast matter most: dominant colour >= 0.12 L from 02 and 05, or an accent plus outline (ART_BIBLE §5.2). The bus appears on Tuesday (2 buses, every 45 s), the scooter on Monday pavements, the bicycle on Tuesday.

## Scope

- `assets-src/blender/vehicles/{bus,bicycle,mobility_scooter}.py`
- Renders + render.json; manifest entries final
- Review including diagonal headings; sheet + zoo

## Out of scope

- Bin lorry (M6)
- Rider animation (riders are static, modelled in)

## Acceptance criteria

- [ ] `npm run assets:blender -- <id> --check` reports 0 changed pixels for all three
- [ ] The bus fits its 128x128 cell with outline at diagonals; the small vehicles fit 32x32
- [ ] Bicycle and scooter are identifiable as 1x silhouettes in the zoo (Read, noted)
- [ ] Lint clean; `forge build` reports the `actors` fill ratio below 85%

## Verification

- npm run assets:blender -- veh.bus --check (repeat for veh.bicycle, veh.mobility_scooter)
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas actors, then Read build/sheets/actors.png
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-118](SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-100](../M3/SSP-100-placeholder-vehicle-renders.md) Render placeholder traffic vehicles in Blender as primitive boxes at 32 headings

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR

## References

- ../../ART_BIBLE.md#82-traffic-and-other-vehicles
- ../../ART_BIBLE.md#71-size-sheet-locked
- ../../ART_BIBLE.md#52-value-reference
- ../../ASSET_PIPELINE.md#75-special-cases
- ../../ENTITY_CATALOG.md#81-sprites

## Roadmap tasks covered

- `veh.hatchback` (8 paint swaps), `veh.saloon`, `veh.van_white`, `veh.taxi`, `veh.bus`, `veh.bicycle`, `veh.mobility_scooter`, and the `_parked` aliases of hatchback, saloon, van_white and taxi.
