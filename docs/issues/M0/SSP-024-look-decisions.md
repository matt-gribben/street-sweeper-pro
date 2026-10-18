---
id: SSP-024
title: "Decide speed zoom, vehicle tilt, 480x270 base and scale sheet (D-01, D-02, D-03, D-07)"
milestone: M0
status: todo
type: spike
estimate: M
labels: [type:spike, area:render, area:assets, size:M, vertical-slice]
depends_on: [SSP-020, SSP-022, SSP-008]
blocks: [SSP-026, SSP-027, SSP-046, SSP-047, SSP-100, SSP-127, SSP-131, SSP-222, SSP-235, SSP-241]
---

# SSP-024: Decide speed zoom, vehicle tilt, 480x270 base and scale sheet (D-01, D-02, D-03, D-07)

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** spike · **Size:** M · **Areas:** render, assets · **Vertical slice**

## Summary

Run the four look experiments in the spike scene and record each decision with Read-reviewed evidence. They are: zoom shimmer at transit speed (D-01); 0° vs 8° Bessie against leaning blocks and the lamp-post stack (D-02, including producing the 8° render); readability at 1080p 4x, 1440p 5x and 4K 8x (D-03); and side-by-side scale at 1:1 (D-07).

## Context

From ROADMAP §8 and ADR 0001 §4.4:

D-01 speed zoom: On (H 31.5 → 37.8 m, ω = 3 rad/s) or Off (look-ahead only). Pan and zoom at transit speed and judge shimmer and readability at 4x. Shimmer while zoomed is accepted (ART_BIBLE §4.2); R-02's contingency is to disable zoom. If Off, LEVEL_DESIGN notes the transit view shrinks to 11.4 m and the telegraph distance rises to 24 m (SSP-027 updates GDD open item 7 and LEVEL_DESIGN). Set the speed-zoom flag default in code and in TECHNICAL_DESIGN §12.2.

D-02 vehicle tilt: 0° (default) or up to 8°.
- Produce the 8° comparison here: run the raw ASSET_PIPELINE §7.1 Blender command (allowed for debugging) with `--tilt 8 --out build/tmp/tilt8/veh.sweeper` (and veh.sweeper_brush if needed).
- Build it into a temporary, uncommitted atlas or a spike-only path under build/; never overwrite assets-src/rendered/ with an unapproved tilt.
- Show 0° and 8° Bessie in lean_quadrants beside the 1/3/6 blocks and the lamp post in all four quadrants, and pick the one whose lean matches the buildings. The probe's 22° clashed (E12).
- If 8° wins: re-render veh.sweeper/veh.sweeper_brush through `npm run assets:blender` at --tilt 8, regenerate the outputs, re-approve the visual goldens, and update ART_BIBLE §4.3/ASSET_PIPELINE §7.1.

D-03 base resolution: 480x270 (adaptive 432-640). Check the readability of 24x24 humans and 16x16 litter at 1080p (4x) and 1440p (5x), plus 4K (8x) per ADR 0001 §4.4, and the scale_1440 letterbox.

D-07 scale sheet sign-off, as locked (16 px/m, 32x32 tiles, 32x40 facade module, sprite size sheet). Show Bessie (28x52), a 24x24 human and a 16x16 litter item side by side on asphalt and pavement at 1:1. M0 has no litter sprite: ingest one cell of the litter.sheet_01 candidate (allowed by M0's deferred list as "the imported litter candidate") into a grid with a manifest entry, or use the documented crisp_packet grid from ASSET_PIPELINE §6.2. Say which. Flat 02/05 placeholder ground is acceptable for asphalt/pavement.

All reviews at 1:1 (Wx270) using ?test=1 frozen frames and setCamera. Evidence screenshots go under build/, are attached to the PR and summarised in the log. SSP-026 mirrors the look decisions into STYLE.md.

## Scope

- D-01: capture zoomed vs unzoomed frames at transit speed; decide; set the speed-zoom flag default (code + TECHNICAL_DESIGN §12.2)
- D-02: produce the 8° render; compare in-engine in all four quadrants with the lamp post; decide; re-render/re-approve if 8° wins
- D-03: 4x, 5x and 8x captures plus the scale_1440 letterbox check; decide
- D-07: side-by-side scale capture (Bessie, human, litter on 02/05); decide
- Fill in ROADMAP §8 D-01, D-02, D-03, D-07

## Out of scope

- STYLE.md write-up (SSP-026)
- Look-ahead implementation (M1)
- Litter art beyond one sample for D-07
- GDD/LEVEL_DESIGN updates (SSP-027)

## Acceptance criteria

- [ ] ROADMAP §8 rows D-01, D-02, D-03 and D-07 each have a Decision, Evidence (screenshot paths and descriptions) and Date
- [ ] Every evidence screenshot was opened with Read, and the PR lists them
- [ ] The speed-zoom flag default in code and in TECHNICAL_DESIGN §12.2 match D-01
- [ ] Committed render.json tilt_deg for veh.sweeper and veh.sweeper_brush matches D-02, and `npm run assets:blender -- veh.sweeper --check` reports 0 changed pixels
- [ ] No 8° render was committed unless D-02 chose 8°
- [ ] `npm run test:visual`, `npm run assets:lint` and `npm run assets:verify` pass after any resulting changes; a golden re-approval states its reason in the commit

## Verification

- Open /?test=1&scene=lean_quadrants&freeze=1 at 1920x1080, 2560x1440 and 3840x2160 and capture to build/
- npm run assets:blender -- veh.sweeper --check
- npm run test:visual
- npm run assets:lint && npm run assets:verify
- Read every build/ evidence screenshot

## Dependencies

**Depends on:**

- [SSP-020](SSP-020-lamp-post-stack.md) Prototype a 4-slice sprite-stack lamp post and add it to lean_quadrants (D-02 input)
- [SSP-022](SSP-022-visual-goldens.md) Add lean_quadrants and scale_1440 visual specs and goldens; prove 10-run stability (D-09)
- [SSP-008](SSP-008-blender-bessie.md) Port the probe sweeper onto rig.py and commit Bessie body, dented and brush renders

**Blocks:**

- [SSP-026](SSP-026-style-lock.md) Write assets-src/STYLE.md v1 locking scale, palette and people style; mirror ART_BIBLE
- [SSP-027](SSP-027-m0-exit-close.md) Verify M0 exit criteria, complete the decision log and open the Close M0 PR
- [SSP-046](../M1/SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie
- [SSP-047](../M1/SSP-047-camera-lookahead-zoom.md) Drive camera look-ahead and speed zoom from Bessie's real speed
- [SSP-100](../M3/SSP-100-placeholder-vehicle-renders.md) Render placeholder traffic vehicles in Blender as primitive boxes at 32 headings
- [SSP-127](../M4/SSP-127-bessie-final.md) Final Bessie renders: body, dented variant and 96x96 brush overlay
- [SSP-131](../M4/SSP-131-blender-props-stacks.md) Blender sprite-stack props: lamp post, phone box, tree, bus shelter, stall
- [SSP-222](../M6/SSP-222-art-vehicles-m6.md) Art Pass 2: Blender renders for bin lorry, ice cream van, police and Sid's sweeper
- [SSP-235](../M7/SSP-235-settings-scene.md) Build SettingsScene with audio, display, accessibility and assist pages
- [SSP-241](../M7/SSP-241-juice-impact.md) Add screen shake, hit-stop and gamepad rumble with reduce-motion support

## References

- ../../ROADMAP.md#8-m0-spike-decision-log
- ../../ROADMAP.md#6-risk-register
- ../../ART_BIBLE.md#31-locked-world-scale
- ../../ART_BIBLE.md#33-internal-resolution
- ../../ART_BIBLE.md#42-building-lean
- ../../ART_BIBLE.md#43-vehicles-are-pure-overhead
- ../../ART_BIBLE.md#71-size-sheet-locked
- ../../ASSET_PIPELINE.md#71-the-exact-command
- ../../TECHNICAL_DESIGN.md#122-camera-rendercamerats
- ../../adr/0001-tech-stack.md#44-m0-spike-decisions-this-adr-depends-on

## Roadmap tasks covered

- Fill in D-01 to D-13 in §8, each with evidence (screenshots under `build/`, attached to the PR and summarised in the log). [D-01, D-02, D-03, D-07]
