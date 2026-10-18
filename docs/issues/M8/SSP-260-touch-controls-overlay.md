---
id: SSP-260
title: "Draw the touch control overlay in internal pixel space via the UI pass"
milestone: M8
status: todo
type: feature
estimate: M
labels: [type:feature, area:ui, area:render, area:test, size:M]
depends_on: [SSP-256, SSP-259, SSP-257, SSP-144, SSP-069, SSP-113, SSP-019, SSP-023, SSP-212, SSP-242, SSP-285, SSP-300]
blocks: [SSP-261, SSP-265, SSP-266, SSP-267]
---

# SSP-260: Draw the touch control overlay in internal pixel space via the UI pass

**Milestone:** [M8 Touch & Mobile Web](../README.md#m8) · **Type:** feature · **Size:** M · **Areas:** ui, render, test

## Summary

Render the steering slider, pedals, buttons and icons as UI instances in the W×270 frame, using the 9-slice panels and the new icons, so they go through the palette pass and integer upscale like the rest of the HUD. The overlay shows only when touch is the active input device, with pressed, held and contextual states.

## Context

Rendering rules: UI renders in the same internal pixel space with an orthographic camera after a depth clear, into RT_world, writing mask (0, 1) ('lit, unshadowed') so night and shadow remaps never darken it; then palette pass and integer upscale (TECHNICAL_DESIGN §12.3, §12.6). UI is one instanced draw from the ui atlas (draw #7 of 9 in §12.7). The overlay must not add a draw call: budget ≤ 10 (9 allocated plus 1 spare for the dev panel in dev builds). Nothing in the UI is scaled by non-integer factors (ART_BIBLE §12.1). No DOM or CSS controls: CSS colours other than #0f0e12 break CLAUDE.md hard rule 3.

Geometry comes only from the layout object (SSP-256) passed in by src/app. src/ui may import src/render/spriteBatch.ts, src/sim (read-only) and src/app/events.ts, and must not import src/input (TECHNICAL_DESIGN §2.1); touch state and the active-device signal arrive as plain data from src/app.

Visual states (ART_BIBLE §12.3 button states): normal = 26 fill (ui.panel_council); pressed = 25 fill with content shifted 1 px down-right; disabled = 03 fill with 04 content. No focus state for touch.
- Steering slider: track plus ui.touch_knob at the current finger offset; with a floating origin the track appears where the thumb landed; a faint idle hint in the left half when no finger is down (proposed).
- Interact/Dump is contextual: enabled only when an interaction is available (stopped < 0.5 m/s inside site.depot_bay, or stopped adjacent to site.skip, GDD §8.7). Read this from sim state read-only; if no accessor exists, add a read-only view without moving logic out of the sim. Otherwise hidden (recommended, saves space; record the decision). While held it shows the same 1.0 s fill ring as the keyboard prompt.
- Map and Pause icons at the layout positions.
- Visibility: only in ShiftScene and SkipRunScene when the active device is touch; hidden on the next rendered frame after keyboard or gamepad input.
- access.reduceFlashing (M7) applies: no flashing pressed effects.

Visual test (CLAUDE.md §7: add a visual scene for a visual feature): a touch_hud scene (?test=1&seed=1&scene=touch_hud&freeze=1) on Puddle Lane with the overlay forced on in a fixed state (steer +64, throttle held, brush lowered, interact enabled), captured with readFrame at a 1168×540 viewport (aspect 2.163 → W = 584). Add the scene to TECHNICAL_DESIGN §18.4, GLOSSARY 'Visual golden', CLAUDE.md §7 and ROADMAP §5.2. Extend src/debug/testHooks.ts (?test=1 only) so a spec can force the overlay and a touch state without pointer events, and document any new parameter in the TECHNICAL_DESIGN §18.5 table.

## Scope

- src/ui/touchControls.ts (proposed): draws the overlay from the injected layout and touch state, using panels.ts 9-slice and FRAME icon IDs, inside the existing UI instanced draw
- Contextual Interact/Dump plus the hold ring
- Active-device-driven visibility
- Test-hook support to force the overlay and its state (documented in TECHNICAL_DESIGN §18.5); the touch_hud visual spec and golden; scene lists updated

## Out of scope

- Moving existing HUD elements out of the touch zones (SSP-261)
- Input handling (SSP-257)
- Menu screens (SSP-262)
- New icon art (SSP-259)

## Acceptance criteria

- [ ] The touch_hud golden at W = 584 passes at pixelmatch threshold 0, and its first version was Read and judged against the ART_BIBLE §12.3 button states before approval
- [ ] perf.spec.ts (ci project) still reports ≤ 10 draw calls, including a run with the overlay forced on via the test hook
- [ ] Rendering the same forced overlay state on district.kebab_mile at night and in a day district gives identical colours for the overlay's opaque pixels (UI writes mask (0, 1))
- [ ] In a test-hook state with Bessie stopped inside site.depot_bay the Interact/Dump button is drawn enabled; with Bessie moving on open road it is hidden (or disabled, as recorded)
- [ ] With keyboard active (the default), no overlay is drawn: hud_specimen, zoo and every other existing golden are unchanged
- [ ] After a keyboard event the overlay is gone on the next rendered frame (e2e or unit test on the visibility logic)

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:visual (Read expected/actual/diff before any npm run test:visual:update)
- npm run test:e2e

## Dependencies

**Depends on:**

- [SSP-256](SSP-256-touch-layout-model.md) Define the touch control layout and hit-testing in internal pixel space
- [SSP-259](SSP-259-touch-ui-icons.md) Author 16×16 touch-control icons as text-grid UI sprites
- [SSP-257](SSP-257-touch-input-device.md) Implement src/input/touch.ts producing the same InputFrame as keyboard and pad
- [SSP-144](../M4/SSP-144-ui-icons-panels.md) HUD icons, 9-slice panels, button states and complaint stamp grids
- [SSP-069](../M2/SSP-069-bitmap-text.md) Implement src/ui/bitmapText.ts and the UI render pass
- [SSP-113](../M4/SSP-113-forge-pack-atlases.md) Lock atlas trimming and the 1 px gutter, cover all five atlases and add the fill-ratio report
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-023](../M0/SSP-023-perf-baseline.md) Baseline perf.spec.ts on the dev Mac GPU and set the p99 frame-time budget (D-08)
- [SSP-212](../M6/SSP-212-district-kebab-mile.md) Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden
- [SSP-242](../M7/SSP-242-reduce-flashing.md) Implement the Reduce flashing setting across HUD and world effects
- [SSP-285](../M3/SSP-285-ui-panels-9slice.md) Implement src/ui/panels.ts 9-slice panels and button states with placeholder panel grids
- [SSP-300](../M4/SSP-300-shift-map-overlay.md) Add the Tab shift map overlay: district map with frontage status, depot, skips and hydrants, without pausing

**Blocks:**

- [SSP-261](SSP-261-touch-hud-adaptation.md) Adapt the HUD layout so it never sits under the thumbs in touch mode
- [SSP-265](SSP-265-mobile-e2e-smoke.md) Add a Playwright mobile-emulation smoke drive with real touch events
- [SSP-266](SSP-266-ios-device-verification.md) Verify audio unlock, background resume and layout on a real iPhone
- [SSP-267](SSP-267-mobile-perf-check.md) Measure frame time and audio memory on a mid-range phone; record M8 budget

## References

- ../../TECHNICAL_DESIGN.md#123-frame-graph
- ../../TECHNICAL_DESIGN.md#126-lighting-night-and-the-palette-pass-shadowsts-fxts-palettepassts
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom
- ../../TECHNICAL_DESIGN.md#184-visual-headless-screenshot-tests
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../ART_BIBLE.md#121-style
- ../../ART_BIBLE.md#123-panels-buttons-and-icons
- ../../GDD.md#87-dumping
- ../../GDD.md#152-hud-layout
- ../../../CLAUDE.md#7-testing-expectations

## Roadmap tasks covered

- `Touch UI drawn in internal pixel space with the 9-slice panels, so it passes through the palette pass like everything else.`
