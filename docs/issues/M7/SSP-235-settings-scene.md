---
id: SSP-235
title: "Build SettingsScene with audio, display, accessibility and assist pages"
milestone: M7
status: todo
type: feature
estimate: L
labels: [type:feature, area:ui, area:render, area:audio, size:L]
depends_on: [SSP-234, SSP-157, SSP-043, SSP-113, SSP-142, SSP-143, SSP-144, SSP-070, SSP-024, SSP-285, SSP-286, SSP-287, SSP-290]
blocks: [SSP-236, SSP-253, SSP-255, SSP-262, SSP-272, SSP-273, SSP-281]
---

# SSP-235: Build SettingsScene with audio, display, accessibility and assist pages

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** feature · **Size:** L · **Areas:** ui, render, audio

## Summary

Add src/scenes/SettingsScene.ts, reachable from the Title and from the PauseOverlay. It covers volume sliders, assist toggles, accessibility options and display options, including the Fullscreen toggle needed for 4× at 1080p, and wires the display settings that have no other owner (speed units, speed zoom, show tips). The Controls/remapping page is filled by SSP-236.

## Context

Scene flow (GDD §15.1 / TECHNICAL_DESIGN §6.2): Title → Settings and Pause → Settings. Settings returns to its caller.
GDD §15.4 Settings row: volume sliders (master, music, sound effects, ambience), controls and remapping, assists, accessibility, and display (Fullscreen, mph/km/h, speed zoom if shipped). Everything is stored in ssp.settings.v1 through src/app/settings.ts.
Audio (AUDIO_DESIGN §8.4): the underlying music plays on unchanged, and each slider previews its bus with `sfx.ui_move`.
Menu navigation (GDD §6.1):
- arrows/WASD or D-pad/left stick move
- Enter/Space or A selects
- Esc/Backspace or B goes back
- mouse clicks work on every item
- `sfx.ui_move`, `sfx.ui_select` and `sfx.ui_back` accompany each action
- no hover-only information (GDD §15.1 flow targets)
Art (ART_BIBLE §12.3):
- 9-slice panels: `ui.panel_council` for menus, `ui.panel_dark` for the pause overlay
- buttons have normal/focus/pressed/disabled states
- focus shows a 17 border plus a `→` cursor glyph, so it does not rely on colour
- all UI is drawn in the W×270 internal pixel space through the palette pass, with Kerbside 5×7 / Bold 8×8 fonts
Fullscreen (TECHNICAL_DESIGN §12.1):
- `element.requestFullscreen()` on the canvas container, plus an F11 hint
- render/upscale.ts recomputes the integer scale = floor(min(winW/W, winH/270)) in device pixels
- windowed 1080p (viewport ≈ 1920×950) gives 3×, fullscreen 1080p gives 4×
- browsers only allow requestFullscreen on a user gesture, so a stored `display.fullscreen: true` cannot be re-applied at boot. Keep the stored flag in sync with `fullscreenchange`, and do not try to auto-enter fullscreen.
Assists (GDD §17.1): off by default, never hidden, never called "easy mode" in UI text. Labels: "Auto-brush", "+60 s timer", "Chill Shift". Assists and instant dump are latched at shift start (decision fixed in SSP-237). When Settings is opened from Pause, show a one-line hint under those toggles: "Takes effect from the next shift (or Restart Shift)".
Accessibility controls: reduce motion, reduce flashing, toggle spray, instant dump, rumble, show tips, screen shake intensity (screenShake 0–1), plus the AUDIO_DESIGN §13.1 audio items (captions, caption size, mono, reduce loud sounds, reversing beeper, adaptive music).
Display wiring owned here:
- speedUnits: the HUD Brush-o-meter speed text shows mph (m/s × 2.23694) or km/h (m/s × 3.6). GDD §7.2: 4.0 m/s ≈ 9 mph.
- speedZoom: render/camera.ts honours display.speedZoom, but only if M0 decision D-01 shipped speed zoom. Read ROADMAP §8 D-01 and do not re-decide it. If D-01 is Off, hide the control.
- showTips: no doc defines it. Default meaning: when on, Pam's contextual tutorial barks play again even if already learned (GDD §16.1). Record this in GDD §17.2.
All strings are British English.
Page structure (no doc gives one): tabs Audio / Controls / Assists / Accessibility / Display.

Add the 'Settings' entry to the PauseOverlay entry list (SSP-287; it stays hidden until this issue lands). The M3 tutorial layer (SSP-290) reads access.showTips. The {cleanSpeed} bark token from SSP-289 follows display.speedUnits.

## Scope

- src/scenes/SettingsScene.ts with tab navigation, using the ui/menus.ts and ui/panels.ts primitives
- Entry points from TitleScene and PauseOverlay, returning to the caller
- Volume sliders (0–10) with live bus preview via sfx.ui_move
- Toggles and selectors for every assists.*, access.*, display.* and audio-accessibility field, each written through settings.ts immediately
- Fullscreen toggle via requestFullscreen/exitFullscreen on the canvas container, synced with fullscreenchange, plus the F11 hint
- HUD speed readout honours display.speedUnits. Camera honours display.speedZoom (if D-01 shipped). The prompt layer honours access.showTips.
- An empty 'Controls' tab for SSP-236 to fill
- Unit test for the integer-scale function; e2e spec for navigation and persistence

## Out of scope

- Key/button capture and conflict handling (SSP-236)
- Making assists change gameplay (SSP-237) or applying reduce motion / reduce flashing to effects (SSP-241, SSP-242)
- Applying audio accessibility behaviour inside the mixer and captions (SSP-239)
- A UI for scaleOverride

## Acceptance criteria

- [ ] SettingsScene opens from Title and from Pause, and Back returns to the scene that opened it (e2e)
- [ ] Every field of ssp.settings.v1 except bindings, padBindings and scaleOverride has a control, and a changed value survives a page reload (e2e)
- [ ] Each volume slider step plays sfx.ui_move on its own bus, and the stored value stays an integer 0–10
- [ ] Unit test: the scale function returns 4 for 1920×1080, 3 for 1920×950, 2 for 960×540 and 8 for 3840×2160 at W = 480
- [ ] The Fullscreen toggle enters and leaves fullscreen, and display.fullscreen tracks fullscreenchange (manual at 1080p: 3× windowed → 4× fullscreen)
- [ ] Every control can be reached and changed by keyboard alone, by gamepad alone (e2e with a stubbed navigator.getGamepads via an init script) and by mouse alone
- [ ] Focus is visible through the → cursor glyph, not colour alone
- [ ] The HUD speed readout switches between mph and km/h (unit test on the formatter)
- [ ] No UI string calls assists "easy", and all strings are British English
- [ ] The speed-zoom control appears only if D-01 shipped speed zoom

## Verification

- npm run typecheck && npm run lint && npm test
- npm run test:e2e (new settings navigation and persistence spec)
- npm run test:visual (existing goldens unchanged)
- Manual: npm run dev, open Settings from Title and Pause, toggle Fullscreen at 1080p, Read a screenshot of each tab

## Dependencies

**Depends on:**

- [SSP-234](SSP-234-settings-store.md) Implement the ssp.settings.v1 store in src/app/settings.ts with storage fallback
- [SSP-157](../M4/SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art
- [SSP-043](../M1/SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-113](../M4/SSP-113-forge-pack-atlases.md) Lock atlas trimming and the 1 px gutter, cover all five atlases and add the fill-ratio report
- [SSP-142](../M4/SSP-142-font-kerbside-5x7.md) Finalise Kerbside 5x7 glyphs, metrics and kerning
- [SSP-143](../M4/SSP-143-font-kerbside-bold-8x8.md) Write Kerbside Bold 8x8 glyphs, metrics and kerning
- [SSP-144](../M4/SSP-144-ui-icons-panels.md) HUD icons, 9-slice panels, button states and complaint stamp grids
- [SSP-070](../M2/SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-024](../M0/SSP-024-look-decisions.md) Decide speed zoom, vehicle tilt, 480x270 base and scale sheet (D-01, D-02, D-03, D-07)
- [SSP-285](../M3/SSP-285-ui-panels-9slice.md) Implement src/ui/panels.ts 9-slice panels and button states with placeholder panel grids
- [SSP-286](../M3/SSP-286-menu-navigation.md) Implement src/ui/menus.ts: keyboard, gamepad and mouse menu navigation plus input-device glyphs
- [SSP-287](../M3/SSP-287-pause-overlay.md) Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire
- [SSP-290](../M3/SSP-290-tutorial-beats.md) Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events

**Blocks:**

- [SSP-236](SSP-236-input-remapping.md) Add keyboard and gamepad remapping for every action, with persistence
- [SSP-253](SSP-253-browser-scaling-qa.md) Run cross-browser, scaling and storage-blocked verification for 1.0
- [SSP-255](../M8/SSP-255-phone-viewport-scaling.md) Make the canvas, viewport and integer scaling phone-ready in landscape
- [SSP-262](../M8/SSP-262-touch-menus-prompts.md) Make every menu and prompt usable by tap, with touch-aware glyphs
- [SSP-272](../M9/SSP-272-macos-desktop-builds.md) Produce macOS arm64 and x64 Tauri bundles and verify platform parity
- [SSP-273](../M9/SSP-273-windows-desktop-build.md) Produce the Windows x64 Tauri installer and verify parity on WebView2
- [SSP-281](../M9/SSP-281-rival-sweep-flow.md) Ship the Rival Sweep mode: district pick, 180 s duel HUD, winner tally

## References

- ../../GDD.md#154-other-screens
- ../../GDD.md#151-scene-flow
- ../../GDD.md#61-bindings
- ../../GDD.md#171-assists-m7
- ../../GDD.md#172-accessibility-features
- ../../GDD.md#72-what-those-numbers-feel-like
- ../../GDD.md#161-principles
- ../../TECHNICAL_DESIGN.md#121-internal-resolution-and-scaling
- ../../TECHNICAL_DESIGN.md#62-scene-flow
- ../../ART_BIBLE.md#123-panels-buttons-and-icons
- ../../AUDIO_DESIGN.md#84-scene--audio-map
- ../../AUDIO_DESIGN.md#131-settings
- ../../ROADMAP.md#8-m0-spike-decision-log

## Roadmap tasks covered

- `src/scenes/SettingsScene.ts` and `src/app/settings.ts`: remapping, volumes, assists, reduce motion, reduce flashing, Fullscreen toggle. (scene, volumes, toggles, Fullscreen)
