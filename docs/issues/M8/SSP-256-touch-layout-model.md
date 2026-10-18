---
id: SSP-256
title: "Define the touch control layout and hit-testing in internal pixel space"
milestone: M8
status: todo
type: feature
estimate: S
labels: [type:feature, area:input, area:ui, size:S]
depends_on: [SSP-044, SSP-015]
blocks: [SSP-257, SSP-260, SSP-261]
---

# SSP-256: Define the touch control layout and hit-testing in internal pixel space

**Milestone:** [M8 Touch & Mobile Web](../README.md#m8) · **Type:** feature · **Size:** S · **Areas:** input, ui

## Summary

Write the single source of geometry for the on-screen touch controls: rectangles in internal pixels as a function of W (432–640), plus a hit-test function. Input (touch.ts) and drawing (the touch overlay) both consume it, so what the player sees is exactly what they can press.

## Context

Controls come from GDD §6.1 (Touch column): drag wheel slider on the left half for steer; right pedal = throttle; left pedal = brake, then reverse when held at standstill; Brush button (toggle); Spray button (hold); Horn button; a contextual Interact/Dump button (hold 1.0 s); a Map icon; a Pause icon. TECHNICAL_DESIGN §13.2: 'drag wheel slider on the left half, pedals and buttons on the right'. So both pedals sit in the right half, brake to the left of throttle.

Frame: W×270 internal px, with W from 432 to 640 (584 on a typical 19.5:9 phone). Safe margin is 4 px from every edge at all widths (ART_BIBLE §12.2).

Target size (proposed, not in the docs): at 4× scale on a DPR-3 phone, 1 internal px ≈ 1.33 CSS px, so Apple's 44 pt guideline is about 33 internal px. Proposed minimum HIT rect is 32×32 internal px (the drawn icon can stay 16×16 inside it). Pedals larger, for example 48×64 (proposed). Every size is a named constant with a 'why' comment. These are input-layer constants, not sim tuning, so they do not go in tuning.json.

Open questions to record in the PR (propose an answer, do not block):
1. Where Map and Pause go. Top-left holds the timer, top-centre score and combo, top-right the five 16×16 complaint slots. Proposal: Pause at top-right with Map beside it; SSP-261 moves the complaints.
2. Fixed slider track vs a floating origin where the thumb lands. The layout must support a floating origin anywhere inside the left-half zone (SSP-257 implements floating by default).

Architecture: src/input may import only DOM and the InputFrame type, and src/ui may not import src/input (TECHNICAL_DESIGN §2.1). Put geometry and hit-test as pure, DOM-free functions in src/input/touchLayout.ts (proposed file). src/app computes the layout for the current W and passes the plain-data object to both touch.ts and the UI draw code; the UI declares a structural type for it and does not import src/input. Named exports only, as-const objects instead of enums, explicit .ts import extensions (CLAUDE.md §5.1).

## Scope

- src/input/touchLayout.ts (proposed): ControlId as-const union (steer, throttle, brake, brush, spray, horn, interact, map, pause), computeTouchLayout(W) returning rects in internal px, and hitTest(layout, x, y) returning ControlId or null
- Steering zone = the left half (x < W/2) minus any other control rect
- Named size constants with rationale comments; open questions recorded in the PR description
- Unit tests in tests/unit/touchLayout.test.ts

## Out of scope

- DOM event handling (SSP-257)
- Drawing the controls (SSP-260)
- Moving HUD elements (SSP-261)
- User-customisable touch layouts

## Acceptance criteria

- [ ] For W ∈ {432, 480, 584, 600, 640}, every control rect lies inside the frame with at least a 4 px margin, and no two control rects overlap
- [ ] Every button and icon hit rect is at least 32×32 internal px, and each pedal rect is at least as large as a button rect
- [ ] hitTest returns the right ControlId for each rect's centre, null for a point in a right-half gap between controls, and 'steer' for any left-half point not covered by another control
- [ ] Throttle lies right of brake and both lie entirely in the right half (x ≥ W/2) for every tested W
- [ ] touchLayout.ts has no imports outside src/input except type-only imports from src/sim, and npm run lint passes

## Verification

- npm run typecheck
- npm run lint
- npm test -- touchLayout

## Dependencies

**Depends on:**

- [SSP-044](../M1/SSP-044-input-devices.md) Implement keyboard and gamepad input producing quantised per-tick InputFrames
- [SSP-015](../M0/SSP-015-render-core-camera-upscale.md) Build the renderer skeleton: perspective camera, sub-pixel snap, upscale and speed zoom

**Blocks:**

- [SSP-257](SSP-257-touch-input-device.md) Implement src/input/touch.ts producing the same InputFrame as keyboard and pad
- [SSP-260](SSP-260-touch-controls-overlay.md) Draw the touch control overlay in internal pixel space via the UI pass
- [SSP-261](SSP-261-touch-hud-adaptation.md) Adapt the HUD layout so it never sits under the thumbs in touch mode

## References

- ../../GDD.md#61-bindings
- ../../GDD.md#62-control-design-notes
- ../../TECHNICAL_DESIGN.md#132-devices
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom
- ../../ART_BIBLE.md#122-hud-layout-480270-reference-anchored-to-corners-for-other-widths
- ../../../CLAUDE.md#51-typescript

## Roadmap tasks covered

- `src/input/touch.ts`: left-half drag steering slider, right pedal (throttle), left pedal (brake/reverse), brush, spray and horn buttons, a contextual Interact/Dump button, map and pause icons
