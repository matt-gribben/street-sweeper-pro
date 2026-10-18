---
id: SSP-287
title: "Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire"
milestone: M3
status: todo
type: feature
estimate: M
labels: [type:feature, area:ui, area:gameplay, area:platform, area:test, size:M, vertical-slice]
depends_on: [SSP-043, SSP-044, SSP-046, SSP-071, SSP-016, SSP-019, SSP-285, SSP-286]
blocks: [SSP-109, SSP-157, SSP-300, SSP-178, SSP-183, SSP-191, SSP-196, SSP-235, SSP-236, SSP-237, SSP-262, SSP-263]
---

# SSP-287: Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** ui, gameplay, platform, test · **Vertical slice**

## Summary

Create `src/scenes/PauseOverlay.ts`. It is pushed over ShiftScene on the Pause action or when the tab is hidden. It freezes the sim under a dimmed palette and offers Resume, Restart Shift, a read-only Controls page and Retire. The entry list is data-driven, so later issues can add Settings (SSP-235) and Finish Sweep (SSP-196).

## Context

GDD §17.2 Cognitive (M3): 'the game can be paused at any time'. Scene flow (GDD §15.1, TECHNICAL_DESIGN §6.2): Shift ↔ Pause on Esc / P (keyboard) or Start/Menu (pad button 9). From Pause the player can go to Settings, Restart Shift, Retire (to the Week Map) or Finish Sweep (Free Sweep only).
GDD §15.4 lists the Pause entries in this order: Resume, Restart Shift, Settings, Controls, Retire to Week Map, Finish Sweep (Free Sweep only). The world freezes under a dimmed palette. The proposal is to apply the shadow remap to the whole frame: add a SSP-016 uniform that forces the shadow remap on world pixels, leaving UI pixels (mask (0, 1)) unaffected.
SceneManager (§6.1): PauseOverlay sets `blocksUpdateBelow = true`, so ShiftScene keeps rendering but never steps. The PAUSE edge is consumed by the scene layer and is never part of a replay (§13.1).
Tab hidden (§5.1): when `visibilitychange` reports hidden, ShiftScene opens the PauseOverlay. SSP-043 already resets the accumulator on resume. Expose one `requestPause(reason)` path on ShiftScene; visibilitychange uses it now, and the M8 rotate prompt (SSP-263) reuses it.
Entries in M3:
- Resume (also Esc/B, or the Pause key again).
- Restart Shift restarts the same seed and district directly into ShiftScene (§6.2 PAUSE → SHIFT), reusing the SSP-071 Try Again path.
- Controls is a read-only page listing the current bindings for the active device, from glyphs.ts (GDD §16.3). SSP-236 later makes it show remapped keys.
- Retire: WeekMapScene does not exist until M6, so for now it returns to the ShiftIntroScene card as a stand-in, as SSP-071 does for 'quit'. SSP-157 (M4) points the stand-in at TitleScene, and SSP-191 (M6) rewires it to WeekMapScene.
Settings and Finish Sweep appear only once their scenes or modes exist; each entry carries a visibility predicate.
Art: `ui.panel_dark` (ART_BIBLE §12.3) drawn through panels.ts (SSP-285). Menu behaviour comes from menus.ts (SSP-286).
Audio is owned by M5: AUDIO_DESIGN §4.5 ducks music −9 dB with a 900 Hz low-pass and suspends sfx/voice/live/amb while paused. Emit pause and resume events on the app event bus so SSP-173, SSP-178 and SSP-183 can hook in.

## Scope

- src/scenes/PauseOverlay.ts on the SceneManager stack with blocksUpdateBelow = true
- PAUSE edge (Esc/P, pad Start) in ShiftScene, plus the visibilitychange → hidden auto-pause, both through a shared requestPause(reason)
- Palette-pass uniform for the whole-frame shadow-remap dim while paused (UI unaffected)
- Data-driven entry list with visibility predicates: Resume, Restart Shift, Controls (read-only bindings page), Retire (stand-in target until SSP-191)
- PauseOpened / PauseClosed events on the app event bus for later audio ducking
- Test hook exposing the active scene stack; e2e spec for pause, freeze, resume, restart and auto-pause
- Record the dim decision in GDD §15.4 if it changes from the proposal

## Out of scope

- Settings entry and SettingsScene (SSP-235)
- Finish Sweep entry (SSP-196)
- Audio ducking implementation (SSP-173, SSP-178, SSP-183)
- Remapped bindings on the Controls page (SSP-236)
- Rotate-to-landscape pause (SSP-263)

## Acceptance criteria

- [ ] e2e: pressing Esc in a running shift opens PauseOverlay; `__ssp.state().tick` and ticksRemaining do not change over 120 rendered frames; Resume continues from the same tick
- [ ] e2e: dispatching visibilitychange with document.visibilityState 'hidden' opens PauseOverlay, and on 'visible' the overlay stays open until the player resumes
- [ ] Unit test: the pad Start button (index 9) and the P key open and close the overlay, and the PAUSE edge never appears in a recorded replay's input log
- [ ] e2e: Restart Shift restarts the same seed at tick 0 with the intro skipped
- [ ] Unit test on the page model: the Controls page lists every GDD §6.1 action with keyboard labels when the keyboard is active and pad labels when the gamepad is active
- [ ] With the overlay open, world pixels in a captured frame match the shadow-remapped colours and HUD/overlay pixels are unchanged (frame Read and noted); the existing goldens still pass
- [ ] Unit test: entries whose visibility predicate is false (Settings, Finish Sweep) are not shown and cannot take focus
- [ ] npm run test:replay hashes are unchanged

## Verification

- npm run typecheck && npm run lint && npm test
- npm run test:replay
- npm run test:e2e
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-043](../M1/SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-044](../M1/SSP-044-input-devices.md) Implement keyboard and gamepad input producing quantised per-tick InputFrames
- [SSP-046](../M1/SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie
- [SSP-071](../M2/SSP-071-intro-tally-scenes.md) Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry
- [SSP-016](../M0/SSP-016-palette-pass.md) Implement the MRT world target and palette pass (64³ OKLab LUT, night/shadow remap)
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-285](SSP-285-ui-panels-9slice.md) Implement src/ui/panels.ts 9-slice panels and button states with placeholder panel grids
- [SSP-286](SSP-286-menu-navigation.md) Implement src/ui/menus.ts: keyboard, gamepad and mouse menu navigation plus input-device glyphs

**Blocks:**

- [SSP-109](SSP-109-close-m3.md) Close M3: verify the exit criteria, sync docs, state the frozen entity list, tag m3
- [SSP-157](../M4/SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art
- [SSP-300](../M4/SSP-300-shift-map-overlay.md) Add the Tab shift map overlay: district map with frontage status, depot, skips and hydrants, without pausing
- [SSP-178](../M5/SSP-178-music-player.md) Implement music.ts: sample-locked stems, loops, jingles and scene music
- [SSP-183](../M5/SSP-183-amb-town-morning.md) Add the ambience bed player and author amb.town_morning
- [SSP-191](../M6/SSP-191-week-map-scene.md) Build WeekMapScene: seven district cards, stars, unlock state and Gleaming badges
- [SSP-196](../M6/SSP-196-free-sweep.md) Add Free Sweep mode: untimed, no complaints, Pause -> Finish Sweep, cut-down Mercury
- [SSP-235](../M7/SSP-235-settings-scene.md) Build SettingsScene with audio, display, accessibility and assist pages
- [SSP-236](../M7/SSP-236-input-remapping.md) Add keyboard and gamepad remapping for every action, with persistence
- [SSP-237](../M7/SSP-237-assists-sim.md) Wire auto-brush, +60 s timer, Chill Shift and instant dump into the sim
- [SSP-262](../M8/SSP-262-touch-menus-prompts.md) Make every menu and prompt usable by tap, with touch-aware glyphs
- [SSP-263](../M8/SSP-263-rotate-landscape-prompt.md) Show a 'rotate to landscape' prompt and pause the game in portrait

## References

- ../../GDD.md#154-other-screens
- ../../GDD.md#151-scene-flow
- ../../GDD.md#163-controls-reference
- ../../GDD.md#172-accessibility-features
- ../../TECHNICAL_DESIGN.md#61-scenemanager
- ../../TECHNICAL_DESIGN.md#62-scene-flow
- ../../TECHNICAL_DESIGN.md#51-loop
- ../../TECHNICAL_DESIGN.md#131-actions-and-the-inputframe
- ../../ART_BIBLE.md#123-panels-buttons-and-icons
- ../../AUDIO_DESIGN.md#45-ducking

## Roadmap tasks covered

_None._
