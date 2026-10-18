---
id: SSP-127
title: "Final Bessie renders: body, dented variant and 96x96 brush overlay"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, area:tooling, size:M, vertical-slice]
depends_on: [SSP-114, SSP-115, SSP-116, SSP-118, SSP-007, SSP-008, SSP-024]
blocks: [SSP-158, SSP-193, SSP-222, SSP-240]
---

# SSP-127: Final Bessie renders: body, dented variant and 96x96 brush overlay

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets, tooling · **Vertical slice**

## Summary

Bring `veh.sweeper` and `veh.sweeper_brush` from the M0 spike render to final art per the livery spec, including the dented variant below 40 HP and visible brush spin.

## Context

`veh.sweeper`: 64x64 cell, visible body 28x52 px (1.75 x 3.25 m), states `body` and `dented`, 32 headings each, `--size 256`, ortho_scale 4 m. `veh.sweeper_brush`: a separate asset with a 96x96 cell, `--size 384`, ortho_scale 6 m, the same centre pivot, and state `brush` at 32 headings x 4 spin frames (22.5 degrees per frame; 4 radial bristle bars in 19 maroon on 18 postbox_red per disc). 192 frame IDs in total, e.g. `veh.sweeper:body:h07:0` and `veh.sweeper_brush:brush:h07:2`. Render files (§6.6): `h00..h31.png`, `dented_hNN.png`, `brush_hNN_n.png`, `render.json`. Livery (ART_BIBLE §8.1): front ~14 px cab; roof 07 chalk with a 2x2 17 beacon near the back of the cab roof; windscreen band 25 with a 27 highlight along its NW edge (2-3 px deep, full cab width); hopper body 15 with 14 shade on the SE bevels; 26 stripe 2 px along both flanks; rear door shown as a 1 px 14 seam with 05 hinges; tyres 00/01 peeking 1-2 px at each corner; brushes 18 shade 19 with a 05 suction mouth. Dented: crumpled rear-left panel (two 14/01 notch pixels), a dangling 05 bumper corner, and the hopper door ajar by 1 px. Swap keys: body 14/15/16, stripe 26, beacon 17; must not use 21-23 or 30. Manifest `swaps` per the SSP-114 representation. Rig: unlit toon materials via `rig.toon_material`/`rig.pal()` (no hex), sun 315/50, toon thresholds per M0, tilt per D-02 (default 0). A full render takes ~13 s. The diagonal bbox is ~57x57 including the outline. Bessie must stay the brightest, most saturated object. Changing Bessie changes the `lean_quadrants` golden.

## Scope

- Final `assets-src/blender/vehicles/sweeper.py` (body + dented) and `sweeper_brush.py`
- Re-render via `npm run assets:blender -- veh.sweeper` and `-- veh.sweeper_brush`; commit renders + render.json
- Manifest entries final (`blender`, outline true, swaps listed)
- Review h00/h08/h16/h24 and a diagonal; sheet, zoo, `lean_quadrants`

## Out of scope

- Racing Green, Seaside Stripes and Midnight Gold liveries (M6, ramp swaps)
- `veh.rival_sweeper` (M6)
- `fx.engine_smoke` (SSP-155)

## Acceptance criteria

- [ ] `npm run assets:blender -- veh.sweeper --check` and `-- veh.sweeper_brush --check` report 0 changed pixels against the committed renders
- [ ] `npm run assets:lint` shows no 're-render needed' warning
- [ ] The body stays within 28x52 at h00 and within the 64x64 cell including outline at diagonal headings (sheet check)
- [ ] The 4 brush spin frames differ visibly and loop seamlessly (sheet, frames in sequence)
- [ ] Dented frames show the three documented damage cues
- [ ] No body pixel outside the 14/15/16, 26, 17 swap keys falls in the 21-23 or 30 range (pytest or lint check on built frames)
- [ ] Sheet, zoo and `lean_quadrants` opened with Read; goldens re-approved with a reason

## Verification

- npm run assets:blender -- veh.sweeper --check && npm run assets:blender -- veh.sweeper_brush --check
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --only veh.sweeper, then Read build/sheets/only_veh.sweeper.png
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-114](SSP-114-ramp-swap-tables.md) Lock ramp-swap key indices and emit the 8 swap tables per atlas
- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-118](SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-007](../M0/SSP-007-blender-rig-wrapper.md) Implement assets-src/blender/rig.py and the forge blender wrapper with --check
- [SSP-008](../M0/SSP-008-blender-bessie.md) Port the probe sweeper onto rig.py and commit Bessie body, dented and brush renders
- [SSP-024](../M0/SSP-024-look-decisions.md) Decide speed zoom, vehicle tilt, 480x270 base and scale sheet (D-01, D-02, D-03, D-07)

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-193](../M6/SSP-193-workshop-liveries.md) Build WorkshopScene with upgrade purchases and Bessie livery ramp swaps
- [SSP-222](../M6/SSP-222-art-vehicles-m6.md) Art Pass 2: Blender renders for bin lorry, ice cream van, police and Sid's sweeper
- [SSP-240](../M7/SSP-240-juice-squash-popups.md) Juice pass: squash-and-stretch, combo popups and the cat roof-ride

## References

- ../../ART_BIBLE.md#81-bessie-vehsweeper
- ../../ASSET_PIPELINE.md#74-skeleton-an-asset-script-assets-srcblendervehiclessweeperpy
- ../../ASSET_PIPELINE.md#72-rig-rules-enforced-in-rigpy
- ../../ASSET_PIPELINE.md#66-blender-render-folder-assets-srcrenderedasset-id
- ../../ENTITY_CATALOG.md#81-sprites
- ../../ASSET_PIPELINE.md#112-render-review-blender

## Roadmap tasks covered

- `veh.sweeper` final: body at 32 headings and dented variant below 40 HP (64×64), plus `veh.sweeper_brush`, the brush overlay at 32 headings × 4 spin frames (96×96, rendered `--size 384`, bristle bars 19 on 18).
