---
id: SSP-044
title: "Implement keyboard and gamepad input producing quantised per-tick InputFrames"
milestone: M1
status: todo
type: feature
estimate: M
labels: [type:feature, area:input, area:test, size:M, vertical-slice]
depends_on: [SSP-028, SSP-043]
blocks: [SSP-046, SSP-050, SSP-071, SSP-073, SSP-078, SSP-286, SSP-287, SSP-289, SSP-300, SSP-174, SSP-236, SSP-241, SSP-256, SSP-257]
---

# SSP-044: Implement keyboard and gamepad input producing quantised per-tick InputFrames

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** feature · **Size:** M · **Areas:** input, test · **Vertical slice**

## Summary

Add `src/input/actions.ts`, `keyboard.ts` and `gamepad.ts`. They merge devices into exactly one quantised InputFrame per sim tick, with edge latching, so replays record exactly what the sim saw. Keyboard and standard-mapping gamepad are both in the vertical slice.

## Context

InputFrame (TECHNICAL_DESIGN §13.1): `throttle` 0..255, `brake` 0..255, `steer` −127..127, `buttons` (held: SPRAY, INTERACT), `pressed` (rising edges: BRUSH, HORN, MAP, PAUSE).
- Quantised at the boundary: analogue values stored as integers. Document the rounding rule (Math.round).
- Edge latching: a press and release between two ticks still produces one edge on the next tick. When several ticks run in one frame, the edge goes to the first only.
- Pause, Map and DevPanel are consumed by the scene layer and never reach the sim.

Bindings (TECHNICAL_DESIGN §13.1, GDD §6.1):
| Action | Keyboard | Gamepad |
|---|---|---|
| throttle | W / ↑ | RT `buttons[7].value` |
| brake (reverse when held at standstill) | S / ↓ | LT `buttons[6].value` |
| steer | A, D / ←, → | left stick X, deadzone 0.15, rescaled to full range outside it |
| brush (toggle) | Space | A (south) |
| spray (hold) | Left Shift | X (west) |
| horn | H | B (east) |
| interact / dump (hold) | E | Y (north) |
| map | Tab | View/Back |
| pause | Esc / P | Start/Menu |
| devPanel (dev only) | F1 | — |

Keyboard (§13.2): listen on `KeyboardEvent.code` (layout independent). Digital steering ramps to full over 80 ms. Call `preventDefault` for bound keys only.

Gamepad: poll once per rendered frame via `navigator.getGamepads()`. The first connected pad with `mapping === 'standard'` wins. Rumble via `vibrationActuator.playEffect('dual-rumble', …)` where supported, driven by the `EV.Impact` magnitude from the event bus (SSP-043). Handle disconnects gracefully (recover, never throw: §21.4).

Deadzone rescale: `s = sign(x)·max(0, |x| − 0.15)/0.85`, so x = 0.575 → 0.5 → 63.5 → 64 with Math.round.

`src/input/**` may import only the InputFrame type from src/sim (plus DOM). Remapping (stored in `ssp.settings.v1`) is M7; touch is M8.

## Scope

- src/input/actions.ts: device merge, quantisation, edge latching, sampleForTick(), scene-layer actions (pause/map/devPanel) kept out of the sim frame
- src/input/keyboard.ts: code-based bindings, 80 ms digital steer ramp, selective preventDefault
- src/input/gamepad.ts: standard mapping, triggers, deadzone rescale, button edges, rumble on EV.Impact
- Unit tests with fake KeyboardEvent and fake Gamepad objects

## Out of scope

- Remapping UI and settings persistence (M7)
- Touch controls (M8)
- Menu navigation (M3+)

## Acceptance criteria

- [ ] Stick X = 0.15 gives steer 0; stick X = 1.0 gives 127; stick X = 0.575 gives 64; stick X = −1.0 gives −127
- [ ] Holding D moves steer from 0 to 127 over 80 ms (± one tick) and never jumps straight to 127
- [ ] Space pressed and released between two ticks gives BRUSH in `pressed` on exactly one tick
- [ ] When 3 ticks run in one frame, a new edge appears only in the first tick's frame
- [ ] Esc/P, Tab and F1 never set bits in the sim InputFrame
- [ ] Triggers RT/LT map to throttle/brake 0..255 as integers
- [ ] Only bound keys call preventDefault (a test covers an unbound key)
- [ ] Disconnecting the gamepad mid-sample yields a neutral frame without throwing

## Verification

- npm run typecheck
- npm run lint
- npm test -- input
- npm run dev  (manual: keyboard and a standard gamepad both drive Bessie once SSP-046 lands)

## Dependencies

**Depends on:**

- [SSP-028](SSP-028-sim-foundations.md) Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type
- [SSP-043](SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus

**Blocks:**

- [SSP-046](SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie
- [SSP-050](SSP-050-m1-exit-close.md) Verify M1 exit criteria, run the lead handling playtest and open the Close M1 PR
- [SSP-071](../M2/SSP-071-intro-tally-scenes.md) Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry
- [SSP-073](../M2/SSP-073-e2e-smoke.md) Add smoke.spec.ts: 60 s scripted sweep and full shift ending on the tally
- [SSP-078](../M3/SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-286](../M3/SSP-286-menu-navigation.md) Implement src/ui/menus.ts: keyboard, gamepad and mouse menu navigation plus input-device glyphs
- [SSP-287](../M3/SSP-287-pause-overlay.md) Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire
- [SSP-289](../M3/SSP-289-pam-radio-panel.md) Add Big Pam's HUD radio panel with a one-at-a-time bark queue and inline key glyphs
- [SSP-300](../M4/SSP-300-shift-map-overlay.md) Add the Tab shift map overlay: district map with frontage status, depot, skips and hydrants, without pausing
- [SSP-174](../M5/SSP-174-unlock-codec-loading.md) Add unlock.ts, Opus/AAC codec selection and boot-time audio loading
- [SSP-236](../M7/SSP-236-input-remapping.md) Add keyboard and gamepad remapping for every action, with persistence
- [SSP-241](../M7/SSP-241-juice-impact.md) Add screen shake, hit-stop and gamepad rumble with reduce-motion support
- [SSP-256](../M8/SSP-256-touch-layout-model.md) Define the touch control layout and hit-testing in internal pixel space
- [SSP-257](../M8/SSP-257-touch-input-device.md) Implement src/input/touch.ts producing the same InputFrame as keyboard and pad

## References

- ../../TECHNICAL_DESIGN.md#131-actions-and-the-inputframe
- ../../TECHNICAL_DESIGN.md#132-devices
- ../../GDD.md#61-bindings
- ../../GDD.md#62-control-design-notes
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom

## Roadmap tasks covered

- `src/input/actions.ts`, `keyboard.ts`, `gamepad.ts` (standard mapping, left-stick deadzone 0.15).
- `Deliverable: Keyboard and gamepad input.`
