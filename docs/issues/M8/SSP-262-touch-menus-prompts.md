---
id: SSP-262
title: "Make every menu and prompt usable by tap, with touch-aware glyphs"
milestone: M8
status: todo
type: feature
estimate: M
labels: [type:feature, area:ui, area:input, area:gameplay, size:M]
depends_on: [SSP-257, SSP-255, SSP-259, SSP-191, SSP-192, SSP-193, SSP-235, SSP-249, SSP-237, SSP-239, SSP-286, SSP-287, SSP-290]
blocks: [SSP-265, SSP-266, SSP-267, SSP-268]
---

# SSP-262: Make every menu and prompt usable by tap, with touch-aware glyphs

**Milestone:** [M8 Touch & Mobile Web](../README.md#m8) · **Type:** feature · **Size:** M · **Areas:** ui, input, gameplay

## Summary

Let a phone player get from the Title to a shift and back with taps only: tap-to-select on all menu items, tap-to-continue on cards, touch-operable Settings sliders and toggles, and prompt text and glyphs that switch to touch wording when touch is the active device.

## Context

Menus already support mouse clicks on all items (GDD §6.1 'Mouse clicks work on all menu items'; GDD §15.1 flow targets: every screen responds to keyboard, gamepad and mouse, no hover-only information). Touch must reach the same handlers; use Pointer Events so mouse and touch share code. If M3 handlers use 'click', note that preventDefault on touchstart/pointerdown (from SSP-255 / SSP-257) can suppress synthesised clicks, so handle pointerup directly. Screens (GDD §15.4, TECHNICAL_DESIGN §6.2): Title (Continue / Tidy Town Week / Free Sweep / Settings / Credits), Week Map, Shift intro card ('Press Space to start'), Workshop, Tally (Skip Run, Workshop, Try Again, Week Map), PauseOverlay (Resume, Restart Shift, Settings, Controls, Retire to Week Map, Finish Sweep in Free Sweep only), SettingsScene (volume sliders 0–10, assists, accessibility, display), Credits.

Prompt glyphs: GDD §16.1 — tutorial barks show 'the relevant key glyph inline (glyphs update to the active input device)'. In touch mode show the matching touch control icon (brush, spray, horn, dump, etc.) and touch verbs ('Tap to start' instead of 'Press Space to start'). Kerbside fonts, British English, no trademarks, rating guard. GDD §16.3: the Pause Controls page shows bindings for the active device; in touch mode show the Touch column of GDD §6.1 (touch controls are not remappable).

Hit-testing: menu items are drawn in internal pixels, so map taps with the client→internal transform (SSP-255). Minimum tap target 32×32 internal px (proposed, as in SSP-256); pad hit rects rather than change the art.

Audio: the first tap must count as the unlock gesture. unlock.ts listens for pointerdown and touchend (AUDIO_DESIGN §12.4), so handlers must not stopPropagation.

Fullscreen (M7 toggle, element.requestFullscreen on the canvas container): iPhone Safari is expected to lack element fullscreen; feature-detect (document.fullscreenEnabled / requestFullscreen presence) and hide or disable the option instead of failing silently.

Tests: add the tap-flow cases to tests/e2e/mobile.spec.ts in the 'mobile' Playwright project created by SSP-255.

menus.ts (SSP-286) already selects on pointerup via Pointer Events and owns the active-device signal and glyphs.ts. Add 'touch' as a device and the touch icon glyphs there.

## Scope

- Pointer/tap handling for every screen listed, reusing the existing mouse paths
- Tap-to-continue on the Shift intro card and other 'press to continue' moments
- Touch-operable Settings sliders and toggles (tap left/right of the value, or drag)
- Active-device-aware prompt text and inline icons in barks, the intro card and the Pause Controls page
- Fullscreen option feature-detected and hidden or disabled where unsupported
- Tap-flow cases in tests/e2e/mobile.spec.ts

## Out of scope

- Touch remapping or custom layouts
- New screens
- The portrait prompt (SSP-263)
- Localisation
- Driving a shift by touch in e2e (SSP-265)

## Acceptance criteria

- [ ] In the 'mobile' Playwright project, a tap-only script goes Title → Tidy Town Week → Week Map card → intro card → ShiftScene, then Pause icon → PauseOverlay → Retire to Week Map, with no page.keyboard or page.mouse calls
- [ ] A unit test over the menu layout data asserts every menu item's hit rect is at least 32×32 internal px
- [ ] With touch active, the intro card reads 'Tap to start' (or the agreed wording recorded in the PR) and tutorial barks show touch icons; with keyboard active they show key glyphs exactly as before
- [ ] A volume slider changed by tap in Settings persists in ssp.settings.v1 across reload, and the game still runs with storage access throwing
- [ ] With fullscreen unsupported (stubbed in a unit test), the Fullscreen option is hidden or disabled
- [ ] No existing desktop golden changes with keyboard active; mercury_tally and hud_specimen still pass
- [ ] ipHygiene.test.ts passes with the new strings

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:visual
- npm run test:e2e
- npx playwright test --project=mobile

## Dependencies

**Depends on:**

- [SSP-257](SSP-257-touch-input-device.md) Implement src/input/touch.ts producing the same InputFrame as keyboard and pad
- [SSP-255](SSP-255-phone-viewport-scaling.md) Make the canvas, viewport and integer scaling phone-ready in landscape
- [SSP-259](SSP-259-touch-ui-icons.md) Author 16×16 touch-control icons as text-grid UI sprites
- [SSP-191](../M6/SSP-191-week-map-scene.md) Build WeekMapScene: seven district cards, stars, unlock state and Gleaming badges
- [SSP-192](../M6/SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-193](../M6/SSP-193-workshop-liveries.md) Build WorkshopScene with upgrade purchases and Bessie livery ramp swaps
- [SSP-235](../M7/SSP-235-settings-scene.md) Build SettingsScene with audio, display, accessibility and assist pages
- [SSP-249](../M7/SSP-249-credits-scene.md) Build CreditsScene with pipeline and tool-version provenance
- [SSP-237](../M7/SSP-237-assists-sim.md) Wire auto-brush, +60 s timer, Chill Shift and instant dump into the sim
- [SSP-239](../M7/SSP-239-audio-access-settings.md) Wire audio accessibility settings live: captions via SSP-184, mono, loud sounds, beeper, adaptive music
- [SSP-286](../M3/SSP-286-menu-navigation.md) Implement src/ui/menus.ts: keyboard, gamepad and mouse menu navigation plus input-device glyphs
- [SSP-287](../M3/SSP-287-pause-overlay.md) Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire
- [SSP-290](../M3/SSP-290-tutorial-beats.md) Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events

**Blocks:**

- [SSP-265](SSP-265-mobile-e2e-smoke.md) Add a Playwright mobile-emulation smoke drive with real touch events
- [SSP-266](SSP-266-ios-device-verification.md) Verify audio unlock, background resume and layout on a real iPhone
- [SSP-267](SSP-267-mobile-perf-check.md) Measure frame time and audio memory on a mid-range phone; record M8 budget
- [SSP-268](SSP-268-m8-close-release.md) Close M8: verify exit criteria, ship the mobile web update, tag m8

## References

- ../../GDD.md#61-bindings
- ../../GDD.md#151-scene-flow
- ../../GDD.md#154-other-screens
- ../../GDD.md#161-principles
- ../../GDD.md#163-controls-reference
- ../../TECHNICAL_DESIGN.md#62-scene-flow
- ../../TECHNICAL_DESIGN.md#121-internal-resolution-and-scaling
- ../../AUDIO_DESIGN.md#124-unlock-and-lifecycle-unlockts
- ../../TECHNICAL_DESIGN.md#16-save-data-and-settings

## Roadmap tasks covered

- `src/input/touch.ts`: left-half drag steering slider, right pedal (throttle), left pedal (brake/reverse), brush, spray and horn buttons, a contextual Interact/Dump button, map and pause icons (see the controls table in GDD.md).
