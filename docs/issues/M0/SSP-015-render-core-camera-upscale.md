---
id: SSP-015
title: "Build the renderer skeleton: perspective camera, sub-pixel snap, upscale and speed zoom"
milestone: M0
status: todo
type: feature
estimate: L
labels: [type:feature, area:render, size:L, vertical-slice]
depends_on: [SSP-002]
blocks: [SSP-016, SSP-045, SSP-047, SSP-069, SSP-070, SSP-286, SSP-299, SSP-255, SSP-256]
---

# SSP-015: Build the renderer skeleton: perspective camera, sub-pixel snap, upscale and speed zoom

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** feature · **Size:** L · **Areas:** render · **Vertical slice**

## Summary

Create the M0 renderer foundation. `camera.ts` is a straight-down PerspectiveCamera with 1/16 m XZ snap and a fractional blit offset. `upscale.ts` handles the adaptive width, integer scale, letterbox and DPR. Add a speed-zoom spring driven by a dev slider, and a minimal render loop drawing into the (W+2)x272 target.

## Context

Camera (TECHNICAL_DESIGN §12.2, §4):
- PerspectiveCamera, vertical FOV 30°, near 1.0, far 45, H = 31.5 m.
- Position (x, H, z) looking at (x, 0, z) with camera.up = (0,0,−1): screen up = −Z = north, screen right = +X = east. Sim XY maps to render XZ.
- Snap camera XZ to the 1/16 m ground-texel grid, keep the fractional remainder (fx, fy) in internal pixels, and offset the upscale blit by fraction x scale device pixels.
- `tiltDeg` default 0 (unused in 1.0).
- Springs integrate on render time, never in the sim.
- Roof magnification H/(H−h): 1.09x / 1.31x / 1.91x for 1/3/6 storeys (accepted).

Fidelity note: the docs say ground is "exactly" 1 texel = 1 px at H = 31.5 m (16.875 m visible height). But 2·31.5·tan(15°) = 16.881 m, i.e. 15.995 px/m, about 0.05 px of drift at the frame edge. Test with a tolerance (≤ 0.1%), do not change H silently, and report the discrepancy in the PR for TECHNICAL_DESIGN §12.2.

Speed zoom: the target H is 31.5 m at or below the brush-down top speed (6.0 m/s, GDD) and 37.8 m at the transit top speed (11.0 m/s), linearly interpolated between. H follows the target on a critically damped spring, ω = 3 rad/s, behind a flag (D-01 may disable it). With no vehicle sim in M0, drive it from a dev speed slider: the seed of `src/debug/devPanel.ts` (F1, dev builds only via `import.meta.env.DEV`, tree-shaken). Keep it tiny; the full panel is M1.

Upscale (§12.1):
- `W = clampEven(round(270 x aspect), 432, 640)`; height always 270.
- Render target (W+2)x272, NearestFilter, no MSAA, no mipmaps.
- Integer scale = floor(min(winW / W, winH / 270)) in DEVICE pixels (CSS x devicePixelRatio).
- Centred; letterbox `#0f0e12` (the single allowed CSS colour, index 00); CSS `image-rendering: pixelated`.
- Recompute on resize and on DPR change (`matchMedia('(resolution: …dppx)')`).
- Expected: 1920x1080 → 4x; 2560x1440 → 5x (1350 tall, 45 px bars); 3840x2160 → 8x; itch embed 960x540 → 2x.

Renderer: WebGLRenderer (WebGL2, not WebGPU). Set `renderer.info.autoReset = false` and call `info.reset()` once per frame (budget ≤ 10 draw calls over all passes). No per-frame `new THREE.*`. A placeholder world pass may blit straight through; the palette pass and MRT come next.

Loop: `src/app/loop.ts` (fixed 60 Hz) is M1. In M0 a plain requestAnimationFrame render loop is fine, with no sim.

Files: `src/render/Renderer.ts`, `camera.ts`, `upscale.ts`, `src/main.ts`, optional `src/debug/devPanel.ts`. Units: metres in the camera maths; px conversion only in src/render (PX_PER_M = 16). Put the pure maths (W, scale, snap, spring) in functions testable without WebGL.

## Scope

- src/render/camera.ts (projection, snap, fractional remainder, speed-zoom spring behind a flag)
- src/render/upscale.ts (W formula, integer scale in device px, letterbox, DPR/resize handling)
- src/render/Renderer.ts skeleton (WebGL2, info.autoReset=false, (W+2)x272 RT, blit with sub-pixel offset)
- Minimal dev speed slider (dev builds only)
- Unit + fast-check tests for the pure maths

## Out of scope

- Palette pass and MRT (SSP-016)
- City mesh, sprites, shadows
- Look-ahead from a real vehicle (M1)
- Fullscreen toggle UI (M7)
- Test hooks (SSP-019)

## Acceptance criteria

- [ ] Unit tests: W = 480 at 1920x1080, W = 432 at 1600x1200 (4:3 clamp), W = 640 at 3440x1440 (clamp)
- [ ] Property test: for random window sizes, W is even and within [432, 640]
- [ ] Unit tests: integer scale 4 at 1920x1080, 5 at 2560x1440, 8 at 3840x2160, 2 at 960x540, and 5 for a 1280x720 CSS window at DPR 2
- [ ] Unit test: at H = 31.5 the projection maps 1 m of ground to 16 px within 0.1%
- [ ] Unit test: snapped camera XZ lies on the 1/16 m grid and the remainder is in [0, 1) internal px
- [ ] Unit test: the spring moves H from 31.5 toward 37.8 with no overshoot, settles within 1%, and the flag disables it
- [ ] `npm run dev` shows a letterboxed canvas with #0f0e12 bars and no console errors; `npm run build` contains no devPanel code (grep dist)
- [ ] `npm run typecheck`, `npm run lint` and `npm test` pass

## Verification

- npm test
- npm run typecheck
- npm run lint
- npm run build && grep -rl devPanel dist (expect no output)
- npm run dev, then open http://localhost:5173/ and check letterboxing at several window sizes

## Dependencies

**Depends on:**

- [SSP-002](SSP-002-node-scaffold.md) Scaffold the Node/TypeScript/Vite repo with exact pins and verify TS 7.0.2 (D-10)

**Blocks:**

- [SSP-016](SSP-016-palette-pass.md) Implement the MRT world target and palette pass (64³ OKLab LUT, night/shadow remap)
- [SSP-045](../M1/SSP-045-render-ground-city.md) Render compiled levels: chunked ground layer and full cityMesh cell merge
- [SSP-047](../M1/SSP-047-camera-lookahead-zoom.md) Drive camera look-ahead and speed zoom from Bessie's real speed
- [SSP-069](../M2/SSP-069-bitmap-text.md) Implement src/ui/bitmapText.ts and the UI render pass
- [SSP-070](../M2/SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-286](../M3/SSP-286-menu-navigation.md) Implement src/ui/menus.ts: keyboard, gamepad and mouse menu navigation plus input-device glyphs
- [SSP-299](../M3/SSP-299-hud-brush-tidy-arrows.md) Add the Brush-o-meter, brush state ring, district name with Tidy % bar, and off-screen depot/hydrant arrows to the HUD
- [SSP-255](../M8/SSP-255-phone-viewport-scaling.md) Make the canvas, viewport and integer scaling phone-ready in landscape
- [SSP-256](../M8/SSP-256-touch-layout-model.md) Define the touch control layout and hit-testing in internal pixel space

## References

- ../../TECHNICAL_DESIGN.md#121-internal-resolution-and-scaling
- ../../TECHNICAL_DESIGN.md#122-camera-rendercamerats
- ../../TECHNICAL_DESIGN.md#4-coordinate-systems-and-units
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../TECHNICAL_DESIGN.md#202-vite-configuration
- ../../ART_BIBLE.md#33-internal-resolution
- ../../ROADMAP.md#32-what-is-in-the-slice

## Roadmap tasks covered

- `src/render/camera.ts`: `PerspectiveCamera`, vertical FOV 30°, H = 31.5 m, XZ snap to 1/16 m, a (W+2)×272 target, fractional blit offset.
- `Speed zoom: H eases 31.5 → 37.8 m on a critically damped spring (ω = 3 rad/s), driven by a SSP-048 speed slider (no vehicle sim yet).`
- `src/render/upscale.ts`: `W = clampEven(round(270 × aspect), 432, 640)`, integer scale, `#0f0e12` letterbox, devicePixelRatio handling.
