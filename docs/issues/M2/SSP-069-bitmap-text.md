---
id: SSP-069
title: "Implement src/ui/bitmapText.ts and the UI render pass"
milestone: M2
status: todo
type: feature
estimate: M
labels: [type:feature, area:ui, area:render, size:M, vertical-slice]
depends_on: [SSP-068, SSP-015, SSP-016, SSP-018, SSP-019, SSP-043]
blocks: [SSP-070, SSP-071, SSP-284, SSP-078, SSP-285, SSP-286, SSP-288, SSP-289, SSP-299, SSP-141, SSP-156, SSP-291, SSP-300, SSP-260]
---

# SSP-069: Implement src/ui/bitmapText.ts and the UI render pass

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** feature · **Size:** M · **Areas:** ui, render · **Vertical slice**

## Summary

Add `src/ui/bitmapText.ts`, which lays out and draws Kerbside 5×7 strings from the ui atlas as instanced quads in the orthographic UI pass, with alignment, kerning, the outlined variant and palette colours. It is the text foundation for the HUD and tally.

## Context

UI pass (TECHNICAL_DESIGN §12.3, §12.6): UI renders in the same internal pixel space (W×270, W = clampEven(round(270 × aspect), 432, 640)) with an orthographic camera after a depth clear, writing mask `(0, 1)` ('lit, unshadowed') so the HUD is never darkened; it is one instanced draw from the `ui` atlas (draw #7 of ≤ 10, §12.7). If M0/M1 did not create this pass, create it now.
Text layout: metrics JSON `public/assets/fonts/kerbside5x7.json` (advance 6 default, narrow glyphs 2–4, kerning pairs, line height 8 HUD / 9 paragraphs); outlined variant has advance +1. Integer pixel positions only; no non-integer scaling. Alignment left/centre/right anchored to a point.
Colour: UI text is mostly 07 chalk; tier popups use 23, 28, 16 and a cycle; penalties 18 (ART_BIBLE §11). Colours come from Kerbside-32 by index or name (no hex in code). Proposal: per-instance ramp-swap rows (up to 8 swap tables per atlas, TECHNICAL_DESIGN §12.5) or palette-indexed glyph frames; document the choice in TECHNICAL_DESIGN §12.5.
Module rules (TECHNICAL_DESIGN §2.1): `src/ui/**` may import `src/render/spriteBatch.ts`, sim read-only and `src/app/events.ts`; it never mutates the sim. No per-frame allocation: reuse instance buffers; measure strings without creating arrays per frame.
Unknown characters render as a fallback glyph ('?') and warn once in dev builds.
Evidence: capture frames with `tests/e2e/helpers/saveFrame.ts` (create it if missing) from a test-only scene or the shift scene with sample text, and Read them.

## Scope

- `src/ui/bitmapText.ts`: measure, layout, draw, alignment, kerning, outlined variant, colour selection
- UI orthographic pass writing mask (0, 1), if not already present
- Unit tests for layout widths and kerning

## Out of scope

- HUD elements (SSP-070)
- 9-slice panels and menus (`panels.ts`, `menus.ts`): SSP-285 and SSP-286
- Kerbside Bold 8×8 (M4)

## Acceptance criteria

- [ ] Unit test: measuring 'AV' applies the −1 kern; 'Hi!' width uses the narrow advances from the metrics; the outlined variant adds 1 per glyph
- [ ] A captured frame shows a string in 07 and in 18, plain and outlined, at integer positions (frame Read and attached)
- [ ] UI text pixels are unchanged when the shadow/night mask would darken the world (mask written as (0, 1))
- [ ] Total draw calls remain ≤ 10 with text on screen
- [ ] No `new` or array literals in the per-frame draw path
- [ ] `npm run test:visual` still passes

## Verification

- npx vitest run tests/unit/bitmapText.test.ts
- npm run test:e2e  # frame with sample text saved to test-results/, then Read
- npm run test:visual
- npm run typecheck && npm run lint

## Dependencies

**Depends on:**

- [SSP-068](SSP-068-kerbside5x7-font.md) Draft Kerbside 5×7 glyphs and add the forge font builder and ui atlas
- [SSP-015](../M0/SSP-015-render-core-camera-upscale.md) Build the renderer skeleton: perspective camera, sub-pixel snap, upscale and speed zoom
- [SSP-016](../M0/SSP-016-palette-pass.md) Implement the MRT world target and palette pass (64³ OKLab LUT, night/shadow remap)
- [SSP-018](../M0/SSP-018-sprite-batch.md) Draw Bessie (32 headings) and the pedestrian via instanced sprite batches
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-043](../M1/SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus

**Blocks:**

- [SSP-070](SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-071](SSP-071-intro-tally-scenes.md) Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry
- [SSP-284](SSP-284-boot-scene.md) Add BootScene: load atlases, fonts and the palette LUT once, then hand off to the shift flow
- [SSP-078](../M3/SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-285](../M3/SSP-285-ui-panels-9slice.md) Implement src/ui/panels.ts 9-slice panels and button states with placeholder panel grids
- [SSP-286](../M3/SSP-286-menu-navigation.md) Implement src/ui/menus.ts: keyboard, gamepad and mouse menu navigation plus input-device glyphs
- [SSP-288](../M3/SSP-288-popups-speech-bubbles.md) Add src/ui/popups.ts: world-space score/penalty popups and NPC speech bubbles
- [SSP-289](../M3/SSP-289-pam-radio-panel.md) Add Big Pam's HUD radio panel with a one-at-a-time bark queue and inline key glyphs
- [SSP-299](../M3/SSP-299-hud-brush-tidy-arrows.md) Add the Brush-o-meter, brush state ring, district name with Tidy % bar, and off-screen depot/hydrant arrows to the HUD
- [SSP-141](../M4/SSP-141-font-builder-outline-kerning.md) Font builder: per-glyph advance syntax, kerning validation and Kerbside Bold 8x8 support
- [SSP-156](../M4/SSP-156-hud-final-art.md) Restyle the HUD and score popups with final fonts, icons and panels
- [SSP-291](../M4/SSP-291-hud-minimap.md) Implement src/ui/minimap.ts: runtime 64×64 district minimap in the single UI draw
- [SSP-300](../M4/SSP-300-shift-map-overlay.md) Add the Tab shift map overlay: district map with frontage status, depot, skips and hydrants, without pausing
- [SSP-260](../M8/SSP-260-touch-controls-overlay.md) Draw the touch control overlay in internal pixel space via the UI pass

## References

- ../../TECHNICAL_DESIGN.md#123-frame-graph
- ../../TECHNICAL_DESIGN.md#126-lighting-night-and-the-palette-pass-shadowsts-fxts-palettepassts
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../TECHNICAL_DESIGN.md#125-sprites-spritebatchts-spritestackts
- ../../ART_BIBLE.md#125-pixel-fonts
- ../../ART_BIBLE.md#11-vfx
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom

## Roadmap tasks covered

- `src/ui/bitmapText.ts` with a first draft of `assets-src/fonts/kerbside5x7.glyphs.txt` (ASCII 32–126 plus £ ★ → ← ↑ ↓). (runtime part)
