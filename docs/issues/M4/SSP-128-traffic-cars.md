---
id: SSP-128
title: "Final Blender cars: hatchback, saloon, taxi, white van, parked aliases"
milestone: M4
status: todo
type: asset
estimate: L
labels: [type:asset, area:assets, area:tooling, size:L, vertical-slice]
depends_on: [SSP-114, SSP-115, SSP-116, SSP-118, SSP-100, SSP-007]
blocks: [SSP-158]
---

# SSP-128: Final Blender cars: hatchback, saloon, taxi, white van, parked aliases

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** L · **Areas:** assets, tooling · **Vertical slice**

## Summary

Replace the M3 flat-box placeholder renders of the 64x64 traffic vehicles with final Blender models, including paint swap keys and `_parked` alias frames.

## Context

64x64 cells (`--size 256`, ortho 4 m) except `veh.van_white`, which SSP-100 moved to 96x96 (`--size 384`, ortho 6 m: its 30x60 body overflows 64 px at the near-diagonal headings, ART_BIBLE §7.1); 32 headings, state `body`, outline true, actors atlas (ENTITY_CATALOG §8.1, ART_BIBLE §8.2). `veh.hatchback` 26x46 px (1.63 x 2.88 m), 8 paint swaps; `veh.saloon` 28x54 px (1.75 x 3.38 m), 8 paint swaps. Both: rounded boxy shapes, body in paint key 21 dark/22 base/23 light (must not use 14,15,16,17,26,30,12,11), glass 25/27, flat base roofs, 07 headlight dots, 18 tail lights. `veh.taxi` 28x54: a black cab with 01 body, 02 base roof, 00 shade and a 16 roof sign; not yellow (15 is reserved for Bessie). `veh.van_white` 30x60 (1.88 x 3.75 m): 07/06 box, 25 windscreen, 05 ladder rack. Use 'Dave's Plumbing' lettering only if legible at 1x, otherwise a 26 stripe; any lettering must come from Kerbside glyphs, never the render. Parked variants `veh.<type>_parked` for hatchback, saloon, van_white and taxi (the M4 scope; police and ice cream van parked variants are M6): they reuse the parent's frames at the axis headings with a seeded paint slot and need no re-render (ENTITY_CATALOG §8.2). The forge emits them since SSP-100 (manifest `technique: "alias"`, ASSET_PIPELINE §7.5); the M4 swaps must be added to the alias entries too, because an alias must mirror its target's `swaps`. Keep the M3 frame IDs. Check diagonals, not h00.

## Scope

- `assets-src/blender/vehicles/{hatchback,saloon,taxi,van_white}.py` final models
- Renders + render.json committed; manifest entries final with swaps
- Parked alias frame IDs emitted by the forge (implement alias support if missing, with pytest)
- Review: h00/h08/h16/h24 + diagonals; sheet swap row with all 8 paint slots; zoo

## Out of scope

- Police, ice cream van, bin lorry and their parked variants (M6)
- Traffic behaviour (M3)

## Acceptance criteria

- [ ] Each of the 4 vehicles passes `npm run assets:blender -- <id> --check` with 0 changed pixels
- [ ] Visible bodies stay within the documented sizes at all 32 headings (sheet, diagonals checked)
- [ ] Hatchback and saloon show 8 distinct paint colourways on the sheet swap row; their body paint uses only the 21/22/23 keys
- [ ] `_parked` frame IDs for the 4 types resolve in `src/gen/assets.ts` and point at the parent's atlas rects (pytest), with no extra renders
- [ ] No vehicle body area uses 15; lint clean; sheet + zoo read and noted

## Verification

- npm run assets:blender -- veh.hatchback --check (repeat for veh.saloon, veh.taxi, veh.van_white)
- uv run --project tools/forge pytest
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas actors, then Read build/sheets/actors.png
- npm run typecheck && npm run test:visual

## Dependencies

**Depends on:**

- [SSP-114](SSP-114-ramp-swap-tables.md) Lock ramp-swap key indices and emit the 8 swap tables per atlas
- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-118](SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-100](../M3/SSP-100-placeholder-vehicle-renders.md) Render placeholder traffic vehicles in Blender as primitive boxes at 32 headings
- [SSP-007](../M0/SSP-007-blender-rig-wrapper.md) Implement assets-src/blender/rig.py and the forge blender wrapper with --check

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR

## References

- ../../ART_BIBLE.md#82-traffic-and-other-vehicles
- ../../ENTITY_CATALOG.md#81-sprites
- ../../ENTITY_CATALOG.md#82-behaviour-collision-and-districts
- ../../ASSET_PIPELINE.md#101-vehicle-veh-blender
- ../../ART_BIBLE.md#56-ramp-swaps-per-instance-palette-variants

## Roadmap tasks covered

- `veh.hatchback` (8 paint swaps), `veh.saloon`, `veh.van_white`, `veh.taxi`, `veh.bus`, `veh.bicycle`, `veh.mobility_scooter`, and the `_parked` aliases of hatchback, saloon, van_white and taxi.
