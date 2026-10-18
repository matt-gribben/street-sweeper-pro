---
id: SSP-236
title: "Add keyboard and gamepad remapping for every action, with persistence"
milestone: M7
status: todo
type: feature
estimate: L
labels: [type:feature, area:input, area:ui, area:save, size:L]
depends_on: [SSP-234, SSP-235, SSP-044, SSP-286, SSP-287, SSP-290]
blocks: [SSP-253, SSP-257, SSP-272, SSP-273]
---

# SSP-236: Add keyboard and gamepad remapping for every action, with persistence

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** feature · **Size:** L · **Areas:** input, ui, save

## Summary

Make every player action rebindable for keyboard and gamepad. Persist bindings in ssp.settings.v1, reject conflicts, allow restoring defaults, and fill the SettingsScene Controls tab. Also add the toggle-spray option in the input layer.

## Context

Actions and defaults (TECHNICAL_DESIGN §13.1 / GDD §6.1). Standard-mapping indices are in brackets:
| Action | Keyboard | Gamepad |
|---|---|---|
| throttle | W / ↑ | RT (buttons[7].value) |
| brake/reverse | S / ↓ | LT (buttons[6].value) |
| steer | A, D / ←, → | left stick X (axes[0]), deadzone 0.15 |
| brush (toggle) | Space | A [0] |
| spray (hold) | Left Shift | X [2] |
| horn | H | B [1] |
| interact/dump (hold) | E | Y [3] |
| map | Tab | View/Back [8] |
| pause | Esc / P | Start/Menu [9] |
devPanel F1 is dev-only and not rebindable.
Keyboard bindings store `KeyboardEvent.code`, which is layout independent. Gamepad bindings store standard-mapping indices (`padBindings`). Conflicts are rejected in the UI and defaults are restorable (TECHNICAL_DESIGN §13.2). Keep the 80 ms ramp on digital keyboard steering.
Devices never talk to the sim. Everything goes through `actions.ts` → `InputFrame`, so replays are unaffected.
DECISIONS (defaults; record them in GDD §6.1):
(a) The exit check requires every action to be rebindable on gamepad, so analogue actions get a source choice. steer: left stick X / right stick X (axes[2]) / D-pad left-right. throttle and brake: RT / LT / any button, where a button acts as 0 or 255. Extend the `padBindings` shape in TECHNICAL_DESIGN §16 to express this. It is an additive field with a default, so `v` stays 1.
(b) Menu navigation (arrows/Enter/Esc, D-pad/A/B; GDD §6.1) is fixed and not remappable. That way a player can always reach Settings → Controls → Restore defaults, even after a bad remap.
(c) Each keyboard action holds up to two codes, as the defaults do (W and ↑). Each gamepad action holds one source.
Toggle spray (access.toggleSpray, GDD §17.2 motor): do it in actions.ts. A press toggles a latched SPRAY held bit in the InputFrame, so the replay still records exactly what the sim saw.
GDD §16.3: the Pause menu Controls page shows current bindings for the active device. GDD §16.1: Pam's tutorial glyphs follow the active device. Both must show remapped keys. If the Pause Controls page does not exist yet, add it here as a read-only list.
With storage blocked, bindings live in memory only and the game keeps running.

The read-only Pause → Controls page (SSP-287) and the glyph lookup src/ui/glyphs.ts (SSP-286) already exist and use the default bindings. Make glyphs.ts read the live bindings so the Controls page, the radio-panel keycaps and the tutorial barks all show remapped keys. Do not build a new Controls page.

## Scope

- src/input/keyboard.ts and gamepad.ts read bindings from settings.ts instead of constants, and react live to changes
- Remap model: per-action keyboard codes (max 2) and one gamepad source, conflict detection, restore defaults
- SettingsScene Controls tab: per-device list, 'press a key/button' capture with a cancel timeout, conflict rejection (sfx.ui_back), restore defaults
- Toggle-spray option implemented in actions.ts
- Pause Controls page and tutorial key glyphs read the live bindings
- Update the TECHNICAL_DESIGN §16 padBindings shape and the GDD §6.1 remapping decisions
- Unit tests for binding resolution, conflicts and toggle-spray latching. Playwright tests for remap persistence across reload and for running with localStorage throwing.

## Out of scope

- Touch controls (M8)
- Instant dump (it changes a sim rule, so it is in SSP-237)
- Changing default bindings
- Remapping menu navigation keys

## Acceptance criteria

- [ ] Every action except devPanel can be rebound on keyboard and on gamepad from SettingsScene → Controls, including steer/throttle/brake through the source choices
- [ ] Binding a key or button already used by another action is rejected with sfx.ui_back, and the existing binding is kept (unit test + e2e)
- [ ] 'Restore defaults' brings back exactly the TECHNICAL_DESIGN §13.1 table (unit test)
- [ ] A rebound key drives the game immediately, and the binding persists after a page reload (Playwright)
- [ ] With localStorage throwing (Playwright init script), remapping works for the session and the game runs without console errors
- [ ] With toggle spray on, one press of the spray binding holds SPRAY in the InputFrame until the next press (unit test)
- [ ] Pause → Controls and Pam's tutorial glyphs show the remapped key for the active device
- [ ] npm run test:replay hashes unchanged

## Verification

- npm run typecheck && npm run lint && npm test
- npm run test:replay
- npm run test:e2e (remap persistence + storage-blocked spec)
- Manual: rebind brush to a gamepad button and to KeyB, reload, confirm it still works

## Dependencies

**Depends on:**

- [SSP-234](SSP-234-settings-store.md) Implement the ssp.settings.v1 store in src/app/settings.ts with storage fallback
- [SSP-235](SSP-235-settings-scene.md) Build SettingsScene with audio, display, accessibility and assist pages
- [SSP-044](../M1/SSP-044-input-devices.md) Implement keyboard and gamepad input producing quantised per-tick InputFrames
- [SSP-286](../M3/SSP-286-menu-navigation.md) Implement src/ui/menus.ts: keyboard, gamepad and mouse menu navigation plus input-device glyphs
- [SSP-287](../M3/SSP-287-pause-overlay.md) Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire
- [SSP-290](../M3/SSP-290-tutorial-beats.md) Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events

**Blocks:**

- [SSP-253](SSP-253-browser-scaling-qa.md) Run cross-browser, scaling and storage-blocked verification for 1.0
- [SSP-257](../M8/SSP-257-touch-input-device.md) Implement src/input/touch.ts producing the same InputFrame as keyboard and pad
- [SSP-272](../M9/SSP-272-macos-desktop-builds.md) Produce macOS arm64 and x64 Tauri bundles and verify platform parity
- [SSP-273](../M9/SSP-273-windows-desktop-build.md) Produce the Windows x64 Tauri installer and verify parity on WebView2

## References

- ../../TECHNICAL_DESIGN.md#131-actions-and-the-inputframe
- ../../TECHNICAL_DESIGN.md#132-devices
- ../../TECHNICAL_DESIGN.md#16-save-data-and-settings
- ../../GDD.md#61-bindings
- ../../GDD.md#62-control-design-notes
- ../../GDD.md#161-principles
- ../../GDD.md#163-controls-reference
- ../../GDD.md#172-accessibility-features

## Roadmap tasks covered

- `src/scenes/SettingsScene.ts` and `src/app/settings.ts`: remapping, volumes, assists, reduce motion, reduce flashing, Fullscreen toggle. (remapping)
- `Exit check: Remapping — every action is rebindable for keyboard and gamepad and persists across reloads. The game still runs with storage blocked.`
