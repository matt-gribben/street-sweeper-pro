---
id: SSP-286
title: "Implement src/ui/menus.ts: keyboard, gamepad and mouse menu navigation plus input-device glyphs"
milestone: M3
status: todo
type: feature
estimate: M
labels: [type:feature, area:ui, area:input, area:test, size:M, vertical-slice]
depends_on: [SSP-044, SSP-069, SSP-071, SSP-015, SSP-285]
blocks: [SSP-109, SSP-287, SSP-289, SSP-157, SSP-176, SSP-191, SSP-192, SSP-193, SSP-235, SSP-236, SSP-262]
---

# SSP-286: Implement src/ui/menus.ts: keyboard, gamepad and mouse menu navigation plus input-device glyphs

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** ui, input, test · **Vertical slice**

## Summary

Add `src/ui/menus.ts`, the shared menu model and navigation used by every screen. Keyboard, gamepad and mouse clicks all work, focus is visible and disabled items are skipped. Add an active-input-device signal and a binding-to-glyph lookup for prompts. Move the M2 intro card and tally buttons onto it.

## Context

GDD §6.1 'Menu navigation (proposed, M3)':
- arrows/WASD, D-pad or left stick move the focus;
- Enter/Space or A selects;
- Esc/Backspace or B goes back;
- mouse clicks work on every menu item;
- `sfx.ui_move`, `sfx.ui_select` and `sfx.ui_back` accompany each action.
GDD §15.1 flow targets: every screen responds to keyboard, gamepad and mouse, and nothing is shown on hover only. Menu navigation keys are fixed and never remappable, so a player can always recover from a bad remap (decision in SSP-236).
Menu input is consumed by the scene layer and never reaches the sim or a replay (TECHNICAL_DESIGN §13.1). Sample it from the keyboard and gamepad devices (SSP-044) as rising edges per tick. Add stick and D-pad repeat so a held direction keeps stepping the focus; pick the repeat timing and record it in GDD §6.1.
Mouse: use Pointer Events on the canvas. Map client coordinates to internal pixels with the inverse of the integer-scale and letterbox transform from render/upscale.ts (TECHNICAL_DESIGN §12.1). A click focuses and selects the item under the pointer. Select on `pointerup`, not 'click', so the M8 touch work (SSP-262) can reuse the same path. Never call stopPropagation, because the M5 audio unlock listens for `pointerdown`.
Audio hook: the audio engine arrives in M5. Emit typed `UiMove` / `UiSelect` / `UiBack` events on `src/app/events.ts` so audio can map them to the sfx later. Nothing plays now.
Active device and glyphs: track the last device that produced input (keyboard/mouse or gamepad). Add `src/ui/glyphs.ts` (proposed name), a pure lookup from action to display label for the active device, built from the SSP-044 default bindings. Keyboard labels are 'W', 'A/D', 'Space', 'E', 'H', 'Left Shift' and 'Esc'. Pad labels follow the standard-mapping names used in GDD §6.1: 'A', 'B', 'X', 'Y', 'RT', 'LT' and 'Start'. Never use controller brand logos. SSP-236 later makes the lookup read remapped bindings, and SSP-262 adds touch.
Art: buttons and focus come from panels.ts (SSP-285). Text comes from bitmapText (SSP-069).

## Scope

- src/ui/menus.ts: a menu model (items with a label, enabled and visible predicates, and onSelect), vertical navigation with wrap, a back handler, and focus and pressed states drawn through panels.ts
- Menu input sampler (keyboard and standard gamepad edges with hold-repeat), separate from the sim InputFrame
- Pointer Events hit-testing in internal pixels via the upscale transform; select on pointerup
- Typed UiMove / UiSelect / UiBack events on the app event bus
- Active-input-device signal and the src/ui/glyphs.ts action → label lookup
- Move the SSP-071 TallyScene buttons and the intro card's continue prompt onto menus.ts
- Unit tests for navigation, skipping disabled items, wrap, hit-testing and the glyph lookup; e2e for mouse selection

## Out of scope

- Remapping and live binding glyphs (SSP-236)
- Touch/tap handling and touch glyphs (SSP-262)
- Playing UI sounds (M5)
- Settings sliders (SSP-235)

## Acceptance criteria

- [ ] Unit test: Down/S/D-pad down/stick down move focus to the next enabled, visible item, skipping disabled ones and wrapping at the ends; Enter/Space/A selects; Esc/Backspace/B calls back
- [ ] Unit test: a held stick or D-pad direction repeats focus steps at the documented rate
- [ ] Unit test: at integer scales 2, 3 and 4 with letterbox offsets, the client→internal transform maps a click at the centre of an item's on-screen rect to that item
- [ ] e2e: on the TallyScene, a mouse click on Try Again restarts the shift with no keyboard input
- [ ] Unit test: each navigation action emits exactly one UiMove/UiSelect/UiBack event
- [ ] Unit test: the glyph lookup returns 'Space' for brush with the keyboard active and 'A' with the gamepad active; the active device switches on the first input from the other device
- [ ] Menu input never changes the sim InputFrame, and replay hashes are unchanged (npm run test:replay)

## Verification

- npm run typecheck && npm run lint && npm test
- npm run test:replay
- npm run test:e2e

## Dependencies

**Depends on:**

- [SSP-044](../M1/SSP-044-input-devices.md) Implement keyboard and gamepad input producing quantised per-tick InputFrames
- [SSP-069](../M2/SSP-069-bitmap-text.md) Implement src/ui/bitmapText.ts and the UI render pass
- [SSP-071](../M2/SSP-071-intro-tally-scenes.md) Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry
- [SSP-015](../M0/SSP-015-render-core-camera-upscale.md) Build the renderer skeleton: perspective camera, sub-pixel snap, upscale and speed zoom
- [SSP-285](SSP-285-ui-panels-9slice.md) Implement src/ui/panels.ts 9-slice panels and button states with placeholder panel grids

**Blocks:**

- [SSP-109](SSP-109-close-m3.md) Close M3: verify the exit criteria, sync docs, state the frozen entity list, tag m3
- [SSP-287](SSP-287-pause-overlay.md) Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire
- [SSP-289](SSP-289-pam-radio-panel.md) Add Big Pam's HUD radio panel with a one-at-a-time bark queue and inline key glyphs
- [SSP-157](../M4/SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art
- [SSP-176](../M5/SSP-176-sfx-event-wiring.md) Wire sim events to sfx cues through a pure audio director
- [SSP-191](../M6/SSP-191-week-map-scene.md) Build WeekMapScene: seven district cards, stars, unlock state and Gleaming badges
- [SSP-192](../M6/SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-193](../M6/SSP-193-workshop-liveries.md) Build WorkshopScene with upgrade purchases and Bessie livery ramp swaps
- [SSP-235](../M7/SSP-235-settings-scene.md) Build SettingsScene with audio, display, accessibility and assist pages
- [SSP-236](../M7/SSP-236-input-remapping.md) Add keyboard and gamepad remapping for every action, with persistence
- [SSP-262](../M8/SSP-262-touch-menus-prompts.md) Make every menu and prompt usable by tap, with touch-aware glyphs

## References

- ../../GDD.md#61-bindings
- ../../GDD.md#151-scene-flow
- ../../TECHNICAL_DESIGN.md#131-actions-and-the-inputframe
- ../../TECHNICAL_DESIGN.md#132-devices
- ../../TECHNICAL_DESIGN.md#121-internal-resolution-and-scaling
- ../../ART_BIBLE.md#123-panels-buttons-and-icons

## Roadmap tasks covered

_None._
