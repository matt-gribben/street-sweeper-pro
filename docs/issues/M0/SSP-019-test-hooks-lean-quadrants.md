---
id: SSP-019
title: "Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene"
milestone: M0
status: todo
type: feature
estimate: M
labels: [type:feature, area:render, area:test, area:tooling, size:M, vertical-slice]
depends_on: [SSP-017, SSP-018]
blocks: [SSP-020, SSP-021, SSP-022, SSP-023, SSP-043, SSP-046, SSP-065, SSP-066, SSP-069, SSP-070, SSP-071, SSP-073, SSP-284, SSP-287, SSP-298, SSP-118, SSP-145, SSP-173, SSP-175, SSP-185, SSP-301, SSP-186, SSP-232, SSP-251, SSP-255, SSP-260, SSP-265]
---

# SSP-019: Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** feature · **Size:** M · **Areas:** render, test, tooling · **Vertical slice**

## Summary

Implement `src/debug/testHooks.ts` (`?test=1&scene=<id>&freeze=1`, `window.__ssp.readFrame()`, `setCamera()`, a ready flag). Compose the `lean_quadrants` scene: 1/3/6-storey blocks at four screen offsets with Bessie and the pedestrian, deterministic and frozen for screenshots.

## Context

Test hooks are active ONLY with `?test=1`. They stay in release builds but are inert without the flag, so Playwright tests the shipping bundle. Never ship behaviour that depends on them.

Parameters (TECHNICAL_DESIGN §18.5): `seed=<n>`, `scene=<id>` (boot straight into a scene), `tick=<n>`, `freeze=1` (loop renders but never steps).

`window.__ssp`:
- `step(n)` and `state()`: no sim exists in M0, so make them minimal (e.g. step advances the render-frame counter and renders once; state returns { tick, camera }) and document that in code;
- `readFrame(): Uint8Array`: the raw Wx270 palette-mapped RGBA from RT_final's inner window (x 1..W, y 1..270), independent of canvas scale/DPR. WebGL `readRenderTargetPixels` returns rows bottom-up: flip so row 0 is the top of the frame;
- `setCamera(x, y, h)`: pin the camera, springs off;
- `ready`: true once assets are loaded and the first frame is rendered. Visual specs wait for it.

Test mode disables audio, the speed-zoom spring and look-ahead (unless a scene enables them) and uses a fixed 1/60 render step. The Bessie heading cycle must be deterministic: driven by the render-frame counter, which freeze=1 holds at a fixed value, or fixed per instance in the scene.

lean_quadrants: the 1/3/6-storey blocks appear at four screen offsets (one per quadrant), with Bessie and the pedestrian. Leave room for the lamp posts (SSP-020 adds one per quadrant) and the 8° comparison (SSP-024). Location: `src/scenes/LeanQuadrantsScene.ts` (src/scenes/ is canonical; SceneManager is M1, so keep the dispatch to a minimal scene-id switch in main.ts).

scale_1440 (used by SSP-022): the same scene, or a simple one, viewed in a 2560x1440 page to test 5x scale and 45 px letterbox bars. Register it as `scene=scale_1440`.

## Scope

- src/debug/testHooks.ts: URL parsing and window.__ssp (ready, readFrame with row flip, setCamera, minimal step/state)
- src/scenes/LeanQuadrantsScene.ts plus minimal scene dispatch
- scale_1440 scene id
- Unit tests for URL param parsing and the inert behaviour without test=1

## Out of scope

- Playwright specs and goldens (SSP-022)
- The lamp post (SSP-020)
- Zoo scene (review-only scene in SSP-298; zoo golden in SSP-118)
- SceneManager (M1)

## Acceptance criteria

- [ ] Unit test: without test=1 the hook installer does nothing (window.__ssp is undefined)
- [ ] `/?test=1&scene=lean_quadrants&freeze=1` shows the 1/3/6-storey blocks in all four screen quadrants with Bessie and the pedestrian (screenshot under build/, opened with Read)
- [ ] At 1920x1080, `__ssp.readFrame()` returns a Uint8Array of length 480*270*4; every pixel is a Kerbside-32 colour; row 0 is the top of the frame (checked against a known scene feature)
- [ ] Two consecutive readFrame() calls on the frozen scene return identical bytes
- [ ] `__ssp.setCamera(x, y, h)` moves the camera and disables springs
- [ ] npm run typecheck, lint and test pass
- [ ] `__ssp.step(n)` and `__ssp.state()` exist as documented M0 stubs (state() returns { tick, camera }), and a code comment says SSP-046 binds them to the World in M1

## Verification

- npm test
- npm run build && npx vite preview --port 4173, then open http://localhost:4173/?test=1&scene=lean_quadrants&freeze=1
- In the browser console: __ssp.readFrame().length

## Dependencies

**Depends on:**

- [SSP-017](SSP-017-city-mesh-shadows.md) Render merged 1/3/6-storey block meshes with facade ramps and SE shadow polygons
- [SSP-018](SSP-018-sprite-batch.md) Draw Bessie (32 headings) and the pedestrian via instanced sprite batches

**Blocks:**

- [SSP-020](SSP-020-lamp-post-stack.md) Prototype a 4-slice sprite-stack lamp post and add it to lean_quadrants (D-02 input)
- [SSP-021](SSP-021-night-shadow-tuning.md) Tune night[32] and shadow[32] remap tables in the spike scene (D-05, D-06)
- [SSP-022](SSP-022-visual-goldens.md) Add lean_quadrants and scale_1440 visual specs and goldens; prove 10-run stability (D-09)
- [SSP-023](SSP-023-perf-baseline.md) Baseline perf.spec.ts on the dev Mac GPU and set the p99 frame-time budget (D-08)
- [SSP-043](../M1/SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-046](../M1/SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie
- [SSP-065](../M2/SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-066](../M2/SSP-066-grime-ground-shader.md) Sample the grime mask in the ground shader with incremental dirty-rect uploads
- [SSP-069](../M2/SSP-069-bitmap-text.md) Implement src/ui/bitmapText.ts and the UI render pass
- [SSP-070](../M2/SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-071](../M2/SSP-071-intro-tally-scenes.md) Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry
- [SSP-073](../M2/SSP-073-e2e-smoke.md) Add smoke.spec.ts: 60 s scripted sweep and full shift ending on the tally
- [SSP-284](../M2/SSP-284-boot-scene.md) Add BootScene: load atlases, fonts and the palette LUT once, then hand off to the shift flow
- [SSP-287](../M3/SSP-287-pause-overlay.md) Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire
- [SSP-298](../M3/SSP-298-zoo-scene-review.md) Add a minimal test-only ZooScene for in-engine review of actors and items frames
- [SSP-118](../M4/SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-145](../M4/SSP-145-hud-specimen-golden.md) Build the hud_specimen scene and commit its visual golden
- [SSP-173](../M5/SSP-173-mixer-buses-ducking.md) Implement mixer.ts: bus graph, limiter, settings levels and ducking engine
- [SSP-175](../M5/SSP-175-sfx-voice-pool.md) Implement sfx.ts playback: voice pool, variants, pitch ladder and spatial pan
- [SSP-185](../M5/SSP-185-m5-exit-evidence.md) Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR
- [SSP-301](../M5/SSP-301-loudness-meter.md) Add the BS.1770 momentary loudness meter and limiter-engagement readout to the F1 dev panel
- [SSP-186](../M6/SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub
- [SSP-232](../M6/SSP-232-week-spec-e2e.md) Write tests/e2e/week.spec.ts: scripted save from Monday to the Tidy Town Trophy
- [SSP-251](../M7/SSP-251-itch-page.md) Prepare the itch.io page: copy, controls, rating note and screenshots
- [SSP-255](../M8/SSP-255-phone-viewport-scaling.md) Make the canvas, viewport and integer scaling phone-ready in landscape
- [SSP-260](../M8/SSP-260-touch-controls-overlay.md) Draw the touch control overlay in internal pixel space via the UI pass
- [SSP-265](../M8/SSP-265-mobile-e2e-smoke.md) Add a Playwright mobile-emulation smoke drive with real touch events

## References

- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../TECHNICAL_DESIGN.md#184-visual-headless-screenshot-tests
- ../../TECHNICAL_DESIGN.md#2-directory-layout
- ../../ROADMAP.md#m0-foundations--look-spike
- ../../ROADMAP.md#8-m0-spike-decision-log
- ../../ART_BIBLE.md#42-building-lean

## Roadmap tasks covered

- `src/debug/testHooks.ts`: `?test=1&scene=<id>&freeze=1`, `window.__ssp.readFrame()` and `setCamera()`.
