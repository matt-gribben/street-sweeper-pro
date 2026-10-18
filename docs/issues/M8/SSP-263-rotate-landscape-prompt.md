---
id: SSP-263
title: "Show a 'rotate to landscape' prompt and pause the game in portrait"
milestone: M8
status: todo
type: feature
estimate: S
labels: [type:feature, area:ui, area:platform, area:test, size:S]
depends_on: [SSP-255, SSP-259, SSP-043, SSP-144, SSP-142, SSP-143, SSP-287]
blocks: [SSP-265, SSP-266, SSP-268]
---

# SSP-263: Show a 'rotate to landscape' prompt and pause the game in portrait

**Milestone:** [M8 Touch & Mobile Web](../README.md#m8) · **Type:** feature · **Size:** S · **Areas:** ui, platform, test

## Summary

Portrait play is on the 'not now' list, so when a touch device's viewport is taller than it is wide, show an in-engine 'rotate to landscape' panel and pause any running shift. Play resumes deliberately from the PauseOverlay after rotating back.

## Context

Portrait-orientation play is on ROADMAP §7 'not now' ('The camera and HUD are designed for landscape'; not planned) and M8 explicitly defers it. M8 task: 'A "rotate to landscape" prompt in portrait.'

In portrait W clamps to 432 (any aspect < 1.6 gives 432). Example: 390×844 CSS at DPR 3 = 1170×2532 device px → scale floor(min(1170/432, 2532/270)) = floor(min(2.71, 9.38)) = 2, so the frame is 864×540 device px mid-screen. The prompt must be legible there: Kerbside Bold 8×8 headline plus ui.icon_rotate on ui.panel_council, centred.

Render it in internal pixel space through the UI pass, not as a DOM/CSS overlay (CSS colours other than #0f0e12 break CLAUDE.md hard rule 3). Detection: innerWidth < innerHeight after the visualViewport-aware layout (SSP-255), or matchMedia('(orientation: portrait)'), re-evaluated on every re-layout, and only on touch-capable devices (matchMedia('(pointer: coarse)')). A narrow desktop window letterboxes as today without the prompt (proposed; record it).

Behaviour: if ShiftScene is running, open PauseOverlay underneath via the same path as visibilitychange → hidden (TECHNICAL_DESIGN §5.1), so no shift time is lost; the accumulator resets on resume. Apply the same to SkipRunScene if it supports pausing; otherwise block it the same way. The prompt blocks input to scenes below it and is shown over menus too (simplest, consistent). On rotating back, remove the prompt and leave the player on PauseOverlay to resume deliberately. Optional: screen.orientation.lock('landscape') only after a successful fullscreen request; ignore failures. Copy: British English, e.g. 'Turn your phone sideways' (proposed).

Tests: add portrait cases to tests/e2e/mobile.spec.ts ('mobile' project from SSP-255). Add a rotate_prompt visual golden via readFrame (W = 432) with the scene lists updated in TECHNICAL_DESIGN §18.4, GLOSSARY, CLAUDE.md §7 and ROADMAP §5.2. If (pointer: coarse) does not match under Playwright touch emulation, add a ?test=1 hook parameter that forces touch-capable detection and document it in TECHNICAL_DESIGN §18.5.

Use ShiftScene.requestPause(reason) from SSP-287, the same path visibilitychange uses.

## Scope

- Portrait detection hooked into the re-layout path, gated on (pointer: coarse)
- A RotatePromptOverlay (proposed, src/scenes/) or a UI layer drawn on top of the scene stack
- Auto-pause of a running shift via PauseOverlay; input blocking while shown
- Portrait e2e cases in tests/e2e/mobile.spec.ts and a rotate_prompt visual golden with doc scene lists updated

## Out of scope

- Portrait gameplay or a portrait HUD
- DOM/CSS overlays
- Requiring fullscreen

## Acceptance criteria

- [ ] In the 'mobile' project at 390×844 (portrait, hasTouch) during a shift, the prompt is shown and __ssp.state().tick does not advance over 120 rendered frames
- [ ] Resizing to 844×390 removes the prompt with PauseOverlay on top, and Resume continues the shift with the same ticksRemaining as before rotation
- [ ] A 600×900 desktop context without touch shows no prompt (or the PR records a different decision)
- [ ] The rotate_prompt golden passes at pixelmatch threshold 0 and its first version was Read before approval; existing goldens are unchanged
- [ ] ipHygiene.test.ts passes with the new string

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:visual
- npm run test:e2e
- npx playwright test --project=mobile

## Dependencies

**Depends on:**

- [SSP-255](SSP-255-phone-viewport-scaling.md) Make the canvas, viewport and integer scaling phone-ready in landscape
- [SSP-259](SSP-259-touch-ui-icons.md) Author 16×16 touch-control icons as text-grid UI sprites
- [SSP-043](../M1/SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-144](../M4/SSP-144-ui-icons-panels.md) HUD icons, 9-slice panels, button states and complaint stamp grids
- [SSP-142](../M4/SSP-142-font-kerbside-5x7.md) Finalise Kerbside 5x7 glyphs, metrics and kerning
- [SSP-143](../M4/SSP-143-font-kerbside-bold-8x8.md) Write Kerbside Bold 8x8 glyphs, metrics and kerning
- [SSP-287](../M3/SSP-287-pause-overlay.md) Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire

**Blocks:**

- [SSP-265](SSP-265-mobile-e2e-smoke.md) Add a Playwright mobile-emulation smoke drive with real touch events
- [SSP-266](SSP-266-ios-device-verification.md) Verify audio unlock, background resume and layout on a real iPhone
- [SSP-268](SSP-268-m8-close-release.md) Close M8: verify exit criteria, ship the mobile web update, tag m8

## References

- ../../ROADMAP.md#m8-touch--mobile-web
- ../../ROADMAP.md#7-not-now-list
- ../../TECHNICAL_DESIGN.md#51-loop
- ../../TECHNICAL_DESIGN.md#61-scenemanager
- ../../TECHNICAL_DESIGN.md#121-internal-resolution-and-scaling
- ../../TECHNICAL_DESIGN.md#184-visual-headless-screenshot-tests
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../ART_BIBLE.md#123-panels-buttons-and-icons

## Roadmap tasks covered

- `A "rotate to landscape" prompt in portrait.`
