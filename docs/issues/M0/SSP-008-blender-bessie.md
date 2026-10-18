---
id: SSP-008
title: "Port the probe sweeper onto rig.py and commit Bessie body, dented and brush renders"
milestone: M0
status: done
type: asset
estimate: L
labels: [type:asset, area:assets, size:L, vertical-slice]
depends_on: [SSP-007]
blocks: [SSP-009, SSP-024, SSP-026, SSP-039, SSP-046, SSP-067, SSP-116, SSP-127]
---

# SSP-008: Port the probe sweeper onto rig.py and commit Bessie body, dented and brush renders

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** asset · **Size:** L · **Areas:** assets · **Vertical slice**

## Summary

Refactor `_probe/blender/sweeper_v2.py` into `vehicles/sweeper.py` (veh.sweeper: body + dented) and `vehicles/sweeper_brush.py` (veh.sweeper_brush: 4-frame spin overlay), on the shared rig at 0° tilt with Kerbside-32 names. Settle the toon thresholds, render and review with Read, commit as goldens, and prove `--check` reproduces them with zero diff.

## Context

The probe script (`assets-src/_probe/blender/sweeper_v2.py`, 142 lines) differs from the target in every respect that matters:
- 22° tilt and 8 frames rotating counter-clockwise;
- its own Diffuse→ShaderToRGB toon;
- raw hex (#F2B21B, #EDEDED, #2B3A55, #202020, #C23B22, #FF7A00, #1E6FD9);
- a 4.4 x 2.0 m body;
- a docstring naming a trademark ("GTA2-ish").
All of that must go. Use 0° tilt, 32 clockwise headings, rig.toon_material and rig.pal() names only, and the locked body size **1.75 x 3.25 m (28x52 px)**. Do not carry the trademark comment over (IP hygiene).

Bessie livery (ART_BIBLE §8.1, ASSET_PIPELINE §7.4):
- body 15 sweeper_yellow (shade 14 ochre, lit 16 lemon);
- cab roof 07 chalk;
- stripe 26 council_blue, 2 px along both flanks;
- beacon 17 hivis_orange, 2x2 px centred near the back of the cab roof;
- windscreen band 25 navy with a 27 sky highlight on its NW edge, 2-3 px deep;
- tyres 00/01 peeking 1-2 px at the corners;
- rear door seam 1 px 14 with 05 hinges;
- brushes 18 postbox_red (shade 19 maroon).

veh.sweeper: CELL_PX 64, `--size 256`, ortho_scale 4 m, front = h00 = north.
- State `body` → h00..h31.png.
- State `dented` → dented_h00..dented_h31.png (shown below 40 HP): crumpled rear-left panel with two 14/01 notch pixels, a dangling 05 bumper corner, hopper door ajar 1 px. Use literal offsets, no randomness.
- Diagonal check: a 45° body is about 57x57 px including outline, inside 64.

veh.sweeper_brush: a separate script with CELL_PX 96, `--size 384`, ortho_scale 6 m and the same centre pivot.
- Two discs either side of the front with a 05 suction mouth between them.
- Each disc has 4 radial bristle bars in 19 on 18.
- Output brush_hNN_<f>.png: 32 headings x 4 spin frames, 22.5° per frame (seamless).
- The discs reach y=+2.2 m at h00 and 2.40 m at diagonals, so they do not fit in 64 px.
- 192 frames in total: 32 body + 32 dented + 128 brush.

Asset-script rules (§7.4): model in metres, Z up, facing +Y, centred at ground level, everything parented to an empty `root`; declare CELL_PX and STATES and nothing else global; one script per asset ID.

Toon thresholds: the defaults are 0.35/0.85 and the final values are TBD (M0 spike). Settle them from test renders BEFORE the final committed render: editing rig.py changes script_sha256 and needs a re-render. Record the chosen values in rig.py, ASSET_PIPELINE §7.2 (replacing the TBD) and the PR, for SSP-026.

Review (CLAUDE.md hard rule 8; ASSET_PIPELINE §11.2): Read at least h00, h08, h16 and h24, plus the diagonals h04/h12, dented frames and brush frames, before committing.

The 8° tilt comparison for D-02 is produced in SSP-024, not here. Committed goldens are 0°.

## Scope

- assets-src/blender/vehicles/sweeper.py (body + dented) refactored onto rig.py
- assets-src/blender/vehicles/sweeper_brush.py (96 px cell, 4 spin frames)
- Settle toon thresholds; update rig.py and ASSET_PIPELINE §7.2
- Render via `npm run assets:blender -- veh.sweeper` and `-- veh.sweeper_brush`; commit assets-src/rendered/veh.sweeper/ and veh.sweeper_brush/ with render.json
- Read and review the renders

## Out of scope

- Building renders into atlases (SSP-009 / SSP-010)
- The 8° D-02 comparison (SSP-024)
- Liveries/swap tables and veh.rival_sweeper (M4)

## Acceptance criteria

- [ ] assets-src/rendered/veh.sweeper/ contains h00..h31.png and dented_h00..dented_h31.png (256x256 RGBA) plus render.json with tilt_deg 0 and blender_version "5.2.2 LTS"
- [ ] assets-src/rendered/veh.sweeper_brush/ contains brush_h00_0..brush_h31_3.png (128 files, 384x384) plus render.json
- [ ] `npm run assets:blender -- veh.sweeper --check` and `-- veh.sweeper_brush --check` report 0 changed pixels on every frame
- [ ] `grep -rniE '#[0-9a-fA-F]{6}|gta' assets-src/blender` prints nothing
- [ ] Every render pixel has alpha 0 or 255, and every opaque pixel is exactly a Kerbside-32 colour (one-off check using forge.palette, run with uv)
- [ ] At h00 the opaque body bounding box (excluding brushes) is 28±1 x 52±1 px after 4x reduction
- [ ] The PR lists the frames opened with Read and the chosen toon thresholds; ASSET_PIPELINE §7.2 no longer says TBD for them

## Verification

- npm run assets:blender -- veh.sweeper
- npm run assets:blender -- veh.sweeper_brush
- npm run assets:blender -- veh.sweeper --check
- npm run assets:blender -- veh.sweeper_brush --check
- Read assets-src/rendered/veh.sweeper/h00.png, h04.png, h08.png, h16.png, h24.png, dented_h00.png and veh.sweeper_brush/brush_h00_0..3.png

## Dependencies

**Depends on:**

- [SSP-007](SSP-007-blender-rig-wrapper.md) Implement assets-src/blender/rig.py and the forge blender wrapper with --check

**Blocks:**

- [SSP-009](SSP-009-forge-build-grid-blender.md) Implement forge build for grid and blender techniques with outline and byte-stable PNGs
- [SSP-024](SSP-024-look-decisions.md) Decide speed zoom, vehicle tilt, 480x270 base and scale sheet (D-01, D-02, D-03, D-07)
- [SSP-026](SSP-026-style-lock.md) Write assets-src/STYLE.md v1 locking scale, palette and people style; mirror ART_BIBLE
- [SSP-039](../M1/SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end
- [SSP-046](../M1/SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie
- [SSP-067](../M2/SSP-067-items-sprite-batch.md) Render litter, stains and site markers via the items instance batch
- [SSP-116](../M4/SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-127](../M4/SSP-127-bessie-final.md) Final Bessie renders: body, dented variant and 96x96 brush overlay

## References

- ../../ASSET_PIPELINE.md#74-skeleton-an-asset-script-assets-srcblendervehiclessweeperpy
- ../../ASSET_PIPELINE.md#72-rig-rules-enforced-in-rigpy
- ../../ASSET_PIPELINE.md#112-render-review-blender
- ../../ART_BIBLE.md#81-bessie-vehsweeper
- ../../ART_BIBLE.md#71-size-sheet-locked
- ../../ART_BIBLE.md#43-vehicles-are-pure-overhead
- ../../adr/0002-ai-authored-asset-pipeline.md#2-evidence-the-asset-probe-2026-10-18
- ../../../CLAUDE.md#3-hard-rules-non-negotiable

## Roadmap tasks covered

- Copy `assets-src/_probe/blender/sweeper_v2.py` → `assets-src/blender/vehicles/sweeper.py` (body and dented) plus `sweeper_brush.py` (the 96×96 brush overlay). Refactor them onto `assets-src/blender/rig.py`, at 0° tilt, with Kerbside-32 palette names via `rig.toon_material`/`rig.pal()` (no hex literals).
