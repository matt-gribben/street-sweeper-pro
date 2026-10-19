---
id: SSP-100
title: "Render placeholder traffic vehicles in Blender as primitive boxes at 32 headings"
milestone: M3
status: done
type: asset
estimate: M
labels: [type:asset, area:assets, area:tooling, size:M, vertical-slice]
depends_on: [SSP-007, SSP-024, SSP-039, SSP-298]
blocks: [SSP-103, SSP-114, SSP-115, SSP-128, SSP-129, SSP-201]
---

# SSP-100: Render placeholder traffic vehicles in Blender as primitive boxes at 32 headings

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** asset · **Size:** M · **Areas:** assets, tooling · **Vertical slice**

## Summary

Write flat-colour primitive-box Blender scripts for the seven M3 traffic vehicles and render them through the forge wrapper at 32 headings, so the vehicle frame IDs are final from day one and the _parked aliases resolve to them.

## Context

From ENTITY_CATALOG §8.1, ART_BIBLE §7.1/§8.2 and ASSET_PIPELINE §7. Cell / visible body px (m):
- veh.hatchback: 64×64 / 26×46 (1.63 × 2.88), paint key 21/22/23, 8 paint swaps.
- veh.saloon: 64×64 / 28×54 (1.75 × 3.38), paint key 21/22/23, 8 paint swaps.
- veh.taxi: 64×64 / 28×54. Black cab: body 01, roof 02, shade 00, sign 16.
- veh.van_white: 64×64 / 30×60 (1.88 × 3.75). Box 07/06, windscreen 25. *(As built: 96×96, `--size 384`. The 30×60 body's half-diagonal is 33.5 px, so it spans 67 px at h06 and cannot fit a 64 px cell with its outline. Lead decision recorded in ART_BIBLE §7.1.)*
- veh.bus: 128×128 / 38×116 (2.38 × 7.25). Red 18, roof band 07, window strips 25.
- veh.bicycle: 32×32 / 8×26 (0.5 × 1.63). Frame 05, rider top 29, helmet 07 modelled in.
- veh.mobility_scooter: 32×32 / 14×22 (0.88 × 1.38). Body 26, rider coat 30, hair 06 modelled in.

Rules:
- Scripts in assets-src/blender/vehicles/<name>.py, built on assets-src/blender/rig.py. Use rig.toon_material with palette NAMES only; raw hex literals in bpy are forbidden.
- Orthographic straight-down camera; sun azimuth 315°, elevation 50°; rotate the model root, not the camera; h00 = north, 11.25° clockwise steps. Tilt per decision D-02 (default 0°).
- Command: `npm run assets:blender -- veh.hatchback`. Size is 4× the cell: 256 for 64 px, 512 for the bus, 128 for bicycle and scooter.
- LOCAL ONLY: Blender 5.2.2 at /Applications/Blender.app/Contents/MacOS/Blender via the forge wrapper. Never in CI.
- Output: assets-src/rendered/<id>/h00..h31.png plus render.json, committed.
- Manifest: technique blender, dirs h32, outline true (visible body ≤ cell − 2 px), atlas actors, `"placeholder": true`, swaps for hatchback and saloon.
- veh.hatchback_parked, veh.saloon_parked, veh.van_white_parked and veh.taxi_parked are alias frame IDs on the moving vehicle's rects, with no re-render (ASSET_PIPELINE §7.5).
- Check diagonals fit the cell (the bus peaks at about 109 px in 128).

Swap tables do not exist until SSP-114 (M4): kerbside32.json `swaps` is `{}` (SSP-005), and the runtime swap texture is identity (SSP-297). So the hatchback and saloon manifest entries ship with `swaps: []`, as veh.sweeper does in SSP-009, with paint materials on the 21/22/23 key so the M4 tables apply unchanged. SSP-114 adds the manifest `swaps` entries. Zoo review uses the minimal M3 ZooScene (`&asset=veh.hatchback`, etc.).

## Scope

- Seven primitive-box vehicle scripts at true size with palette-name materials (hatchback/saloon paint on the 21/22/23 key).
- Render via assets:blender; commit the renders and render.json.
- Manifest entries (with `swaps: []` for the hatchback and saloon until SSP-114) and _parked aliases.
- Run `npm run assets` and commit the actors atlas and assets.ts; Read h00/h08/h16/h24, the contact sheet and the zoo screenshot.

## Out of scope

- Final vehicle models (M4).
- M6 vehicles.
- Manifest `swaps` entries and the 8 paint tables for the hatchback and saloon (SSP-114, M4)

## Acceptance criteria

- [ ] `npm run assets:blender -- <id> --check` reports zero pixel diff for all seven against the committed renders (local).
- [ ] FRAME has 32 heading frames per vehicle (e.g. FRAME['veh.bus:body:h31:0']) and alias IDs for the four _parked variants.
- [ ] `npm run assets:lint` passes (palette, continuous outline, no 're-render needed' warning) and `npm run assets:verify` passes.
- [ ] No hex literal appears in the new bpy scripts (grep).
- [ ] The PR notes the Read review of h00, h08, h16 and h24 per vehicle, the contact sheet and `?test=1&scene=zoo`.
- [ ] `npm run test:visual` passes (existing goldens).

## Verification

- npm run assets:blender -- veh.hatchback --check
- npm run assets
- npm run assets:lint
- npm run assets:verify
- npm run assets:sheets
- npm run typecheck
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-007](../M0/SSP-007-blender-rig-wrapper.md) Implement assets-src/blender/rig.py and the forge blender wrapper with --check
- [SSP-024](../M0/SSP-024-look-decisions.md) Decide speed zoom, vehicle tilt, 480x270 base and scale sheet (D-01, D-02, D-03, D-07)
- [SSP-039](../M1/SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end
- [SSP-298](SSP-298-zoo-scene-review.md) Add a minimal test-only ZooScene for in-engine review of actors and items frames

**Blocks:**

- [SSP-103](SSP-103-render-actors-traffic.md) Draw NPCs, animals, traffic, knockables and hazards with state-driven frames
- [SSP-114](../M4/SSP-114-ramp-swap-tables.md) Lock ramp-swap key indices and emit the 8 swap tables per atlas
- [SSP-115](../M4/SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-128](../M4/SSP-128-traffic-cars.md) Final Blender cars: hatchback, saloon, taxi, white van, parked aliases
- [SSP-129](../M4/SSP-129-traffic-bus-bike-scooter.md) Final Blender bus (128x128), bicycle and mobility scooter (32x32)
- [SSP-201](../M6/SSP-201-bin-lorry.md) Implement veh.bin_lorry and the bin_round event

## References

- ../../ENTITY_CATALOG.md#81-sprites
- ../../ART_BIBLE.md#71-size-sheet-locked
- ../../ART_BIBLE.md#82-traffic-and-other-vehicles
- ../../ART_BIBLE.md#56-ramp-swaps-per-instance-palette-variants
- ../../ASSET_PIPELINE.md#71-the-exact-command
- ../../ASSET_PIPELINE.md#72-rig-rules-enforced-in-rigpy
- ../../ASSET_PIPELINE.md#75-special-cases
- ../../ASSET_PIPELINE.md#101-vehicle-veh-blender
- ../../ROADMAP.md#8-m0-spike-decision-log

## Roadmap tasks covered

- Placeholder renders for `veh.hatchback`, `veh.saloon`, `veh.van_white`, `veh.taxi`, `veh.bus`, `veh.bicycle`, `veh.mobility_scooter`: run the Blender rig with flat-colour primitive boxes ...
