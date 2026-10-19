---
id: SSP-047
title: "Drive camera look-ahead and speed zoom from Bessie's real speed"
milestone: M1
status: done
type: feature
estimate: M
labels: [type:feature, area:render, area:test, size:M, vertical-slice]
depends_on: [SSP-046, SSP-024, SSP-015]
blocks: [SSP-050, SSP-289, SSP-290, SSP-299, SSP-175]
---

# SSP-047: Drive camera look-ahead and speed zoom from Bessie's real speed

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** feature · **Size:** M · **Areas:** render, test · **Vertical slice**

## Summary

Extend `src/render/camera.ts` so the camera leads Bessie by up to 3.0 m along her velocity on a damped spring, and (if D-01 kept zoom) eases height from 31.5 m to 37.8 m with real speed on a critically damped spring. Prove the ground is exactly 1 texel = 1 px at or below 6.0 m/s.

## Context

Camera (TECHNICAL_DESIGN §12.2, GDD §7.5):
- PerspectiveCamera, vertical FOV 30°, near 1.0, far 45.
- Sweep height H = 31.5 m gives 1 texel = 1 px.
- Look-ahead: lead the sweeper by up to 3.0 m along its velocity, on a damped spring.
- Speed zoom: H eases from 31.5 m (at or below the brush-down top speed, 6.0 m/s) to 37.8 m (at the transit top speed, 11.0 m/s) on a critically damped spring, ω = 3 rad/s.
- The zoom sits behind a flag. M0 decision D-01 says whether it is on. If off, look-ahead only.
- OPEN: the speed→H mapping between 6 and 11 m/s is unspecified. Proposal: linear in speed (8.5 m/s → 34.65 m). Flag it.
- Snap camera XZ to 1/16 m and keep the fractional remainder for the upscale blit offset (M0).
- Camera state lives in the renderer. Springs integrate on render time from interpolated sim state, never in the sim (§7.4: the sim never reads the camera).
- Test mode disables springs and look-ahead unless a scene enables them; `setCamera` pins the camera.

Accepted artefacts: ground shimmer while zoomed; roof magnification H/(H − h) (1.09×/1.31×/1.91× for 1/3/6 storeys).

LEVEL_DESIGN §7.9 sight lines: the transit telegraph distance is 20 m with zoom and 24 m without it (decided by D-01, LEVEL_DESIGN §13 Q1). Make sure LEVEL_DESIGN reflects the D-01 outcome.

The camera exit check (ROADMAP M1): look-ahead leads by up to 3.0 m; at or below 6.0 m/s the ground renders at exactly 1 texel = 1 px, verified at a frozen tick.

## Scope

- Look-ahead spring (≤ 3.0 m along velocity) and the speed-zoom spring (ω = 3 rad/s, 31.5→37.8 m) behind the D-01 flag
- Speed input taken from interpolated sim state (vLong), read-only
- Unit tests: target H at 0, 6.0, 8.5 and 11.0 m/s; critically damped spring converges without overshoot; look-ahead clamped to 3.0 m
- A Playwright frozen-tick check of 1:1 ground at ≤ 6.0 m/s
- LEVEL_DESIGN §7.9 updated to the D-01 outcome if it still reads TBD

## Out of scope

- Camera tilt (camera.tiltDeg > 0 is post-1.0, on the not-now list)
- Screen shake (M7 juice)
- Changing the D-01 decision

## Acceptance criteria

- [x] Target H is 31.5 m for any speed ≤ 6.0 m/s and 37.8 m at ≥ 11.0 m/s (only when D-01 keeps zoom)
- [x] The spring response to a step change shows no overshoot (critically damped, ω = 3)
- [x] Look-ahead offset magnitude never exceeds 3.0 m
- [x] At a frozen tick with Bessie at ≤ 6.0 m/s, a 32×32 ground region of readFrame() away from shadows and sprites matches the corresponding world-atlas tile frame (after palette mapping) pixel-for-pixel in a Playwright check
- [x] With D-01 = off, H stays at 31.5 m at all speeds and look-ahead still works
- [x] The sim has no import of render or camera state (purity tests pass)

## Verification

- npm run typecheck
- npm run lint
- npm test -- camera
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-046](SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie
- [SSP-024](../M0/SSP-024-look-decisions.md) Decide speed zoom, vehicle tilt, 480x270 base and scale sheet (D-01, D-02, D-03, D-07)
- [SSP-015](../M0/SSP-015-render-core-camera-upscale.md) Build the renderer skeleton: perspective camera, sub-pixel snap, upscale and speed zoom

**Blocks:**

- [SSP-050](SSP-050-m1-exit-close.md) Verify M1 exit criteria, run the lead handling playtest and open the Close M1 PR
- [SSP-289](../M3/SSP-289-pam-radio-panel.md) Add Big Pam's HUD radio panel with a one-at-a-time bark queue and inline key glyphs
- [SSP-290](../M3/SSP-290-tutorial-beats.md) Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events
- [SSP-299](../M3/SSP-299-hud-brush-tidy-arrows.md) Add the Brush-o-meter, brush state ring, district name with Tidy % bar, and off-screen depot/hydrant arrows to the HUD
- [SSP-175](../M5/SSP-175-sfx-voice-pool.md) Implement sfx.ts playback: voice pool, variants, pitch ladder and spatial pan

## References

- ../../TECHNICAL_DESIGN.md#122-camera-rendercamerats
- ../../GDD.md#75-camera-behaviour-as-a-handling-aid
- ../../ART_BIBLE.md#41-the-camera
- ../../LEVEL_DESIGN.md#79-sight-lines-and-the-camera
- ../../ROADMAP.md#8-m0-spike-decision-log
- ../../ROADMAP.md#m1-drivable-bessie

## Roadmap tasks covered

- `src/render/camera.ts`: look-ahead (up to 3.0 m, damped spring) and speed zoom from real speed.
- `Exit criteria: Camera and look-ahead done.`
- `Measurable check (Camera): look-ahead up to 3.0 m; 1 texel = 1 px at ≤ 6.0 m/s at a frozen tick`
