---
id: SSP-222
title: "Art Pass 2: Blender renders for bin lorry, ice cream van, police and Sid's sweeper"
milestone: M6
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, size:M]
depends_on: [SSP-201, SSP-207, SSP-211, SSP-208, SSP-007, SSP-127, SSP-114, SSP-024]
blocks: [SSP-233, SSP-242, SSP-279]
---

# SSP-222: Art Pass 2: Blender renders for bin lorry, ice cream van, police and Sid's sweeper

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** asset · **Size:** M · **Areas:** assets

## Summary

Replace the placeholder box renders with final Blender models at 32 headings, and build Spotless Sid's sweeper as a build-time ramp swap of Bessie.

## Context

Technique (ASSET_PIPELINE §2, §10.1): assets-src/blender/vehicles/<name>.py on rig.py, palette names only via rig.toon_material / rig.pal() (no hex). Unlit toon, straight down, 0 degree tilt unless D-02 approved up to 8 degrees. 32 headings (h00 = north, 11.25 degree steps). npm run assets:blender -- <id> writes assets-src/rendered/<id>/h00..h31.png plus render.json; Read h00/h08/h16/h24. The forge adds the 1 px ink outline.
Sizes (ART_BIBLE §7.1):
- veh.bin_lorry: 96x96 cell, body 36x84 px (2.25 x 5.25 m)
- veh.ice_cream_van: 64x64, 32x62 px (2.0 x 3.875 m)
- veh.police: 64x64, 28x54 px (1.75 x 3.38 m), with the lightbar authored in key index 30 ('off') so swap slots 0/1 flash it
veh.rival_sweeper is NOT a new render: it is a build-time `rival` table applied to Bessie's built frames (body 15->07, 14->06, 16->07, cab 07->22, stripe 26->22; green and white), using runtime slot 1 only for his beacon (ART_BIBLE §5.6). The parked variants veh.police_parked and veh.ice_cream_van_parked reuse the parent frames at a fixed heading (manifest aliases, no renders). Check diagonals on the contact sheet (bounding boxes peak at 45 degrees). No logos or real liveries; the police car must be generic (IP hygiene). Blender runs locally only; commit renders plus render.json. Lint warns 're-render needed' if a script changes without a re-render.

## Scope

- Blender scripts and committed renders for bin_lorry, ice_cream_van and police
- Forge build-time rival swap for veh.rival_sweeper
- Manifest entries and aliases for the parked variants; placeholders removed
- Generated atlases and outputs committed

## Out of scope

- Behaviour changes

## Acceptance criteria

- [ ] npm run assets:blender -- all --check reproduces the committed renders with zero pixel diff
- [ ] Bodies stay within the size-sheet visible bodies at all 32 headings (contact sheet review)
- [ ] veh.rival_sweeper frames are derived from veh.sweeper by the rival table only
- [ ] assets:lint (including the re-render check) and assets:verify pass
- [ ] Contact sheet and zoo reviewed with Read; no placeholder: true left for these IDs

## Verification

- npm run assets:blender -- veh.bin_lorry (local only)
- npm run assets:blender -- all --check
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets (Read build/sheets/actors.png)
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-201](SSP-201-bin-lorry.md) Implement veh.bin_lorry and the bin_round event
- [SSP-207](SSP-207-ice-cream-van.md) Implement veh.ice_cream_van, its parked variant and the vehicle_stop event
- [SSP-211](SSP-211-reveller-police.md) Implement npc.reveller, kicking_out, veh.police witness rule and police_parked
- [SSP-208](SSP-208-rival-sweeper-cameo.md) Implement veh.rival_sweeper Friday cameo and the rival_cameo event
- [SSP-007](../M0/SSP-007-blender-rig-wrapper.md) Implement assets-src/blender/rig.py and the forge blender wrapper with --check
- [SSP-127](../M4/SSP-127-bessie-final.md) Final Bessie renders: body, dented variant and 96x96 brush overlay
- [SSP-114](../M4/SSP-114-ramp-swap-tables.md) Lock ramp-swap key indices and emit the 8 swap tables per atlas
- [SSP-024](../M0/SSP-024-look-decisions.md) Decide speed zoom, vehicle tilt, 480x270 base and scale sheet (D-01, D-02, D-03, D-07)

**Blocks:**

- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag
- [SSP-242](../M7/SSP-242-reduce-flashing.md) Implement the Reduce flashing setting across HUD and world effects
- [SSP-279](../M9/SSP-279-rival-sweeper-sim.md) Give Spotless Sid a full sweeper in the sim: handling, brush, hopper, dumping

## References

- ../../ASSET_PIPELINE.md#101-vehicle-veh-blender
- ../../ART_BIBLE.md#71-size-sheet-locked
- ../../ART_BIBLE.md#82-traffic-and-other-vehicles
- ../../ART_BIBLE.md#56-ramp-swaps-per-instance-palette-variants
- ../../ENTITY_CATALOG.md#81-sprites

## Roadmap tasks covered

- `All Wed–Sun assets, batched by class, each batch reviewed via contact sheets and the zoo. (vehicles)`
