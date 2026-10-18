---
id: SSP-257
title: "Implement src/input/touch.ts producing the same InputFrame as keyboard and pad"
milestone: M8
status: todo
type: feature
estimate: L
labels: [type:feature, area:input, area:test, size:L]
depends_on: [SSP-256, SSP-255, SSP-044, SSP-234, SSP-236, SSP-237, SSP-062, SSP-070, SSP-046, SSP-198]
blocks: [SSP-258, SSP-260, SSP-262, SSP-265, SSP-266, SSP-267]
---

# SSP-257: Implement src/input/touch.ts producing the same InputFrame as keyboard and pad

**Milestone:** [M8 Touch & Mobile Web](../README.md#m8) · **Type:** feature · **Size:** L · **Areas:** input, test

## Summary

Add the touch device: multi-touch Pointer Events tracking that turns the steering slider, pedals and buttons into the existing per-tick InputFrame, merged in actions.ts alongside keyboard and gamepad, plus an 'active input device' signal for the UI. The sim never knows touch exists, so replays and determinism are unaffected.

## Context

InputFrame (TECHNICAL_DESIGN §13.1): throttle 0..255, brake 0..255, steer -127..127, buttons (held bitfield: SPRAY, INTERACT, ...), pressed (rising edges since the last tick: BRUSH, HORN, MAP, PAUSE). Values are quantised at the boundary. Edge latching: a press and release between two ticks still produces one pressed edge on the next tick; when several ticks run in one frame the edge goes to the first only. Pause, Map and the dev panel are consumed by the scene layer and never reach the sim.

Touch mapping (GDD §6.1, §6.2):
- Steer: drag on the left-half slider. Analogue, mapped to the target steering angle like stick X; the sim's 120°/s steer and 180°/s return rate limits still apply. Formula (proposed input-layer constants): dx = finger x − origin x in internal px; steer = |dx| ≤ 2 ? 0 : clamp(round(dx / 48 × 127), -127, 127) (dead zone NOT rescaled). steer returns to 0 on release. Floating origin (where the thumb lands) by default; record the choice in the PR.
- Throttle pedal held → throttle 255. Brake pedal held → brake 255. Holding brake at standstill (< 0.2 m/s) engages reverse after a 0.25 s hold; the sim does that, touch only sets brake. Pedals are digital (analogue depth is out of scope).
- Brush → BRUSH pressed edge on pointerdown (toggle). Horn → HORN edge. Map → MAP edge. Pause → PAUSE edge.
- Spray → SPRAY held while the finger is down; if settings access.toggleSpray (M7) is on, apply it exactly as for keyboard.
- Interact/Dump → INTERACT held while the finger is down. The 1.0 s hold, the fill ring and access.instantDump keep their existing logic.

Rules:
- Pointer Events with pointerType 'touch' and setPointerCapture; track by pointerId. A pointer belongs to the control it started on for its whole life (a steering thumb drifting into the right half keeps steering).
- pointercancel, lostpointercapture, window blur and visibilitychange → hidden release every touch control.
- Hit-test with touchLayout.ts. Client coordinates go through the client→internal transform injected by src/app (SSP-255); touch.ts must not import src/render or src/ui (TECHNICAL_DESIGN §2.1).
- Keep a pure, DOM-free reducer (onDown, onMove, onUp, onCancel, sampleForTick) separate from the thin DOM listener wiring, so Vitest runs it in Node without jsdom or happy-dom (CLAUDE.md hard rule 6 and TECHNICAL_DESIGN §21.3 forbid unrequested dependencies). SSP-258 reuses this reducer.
- Do not stopPropagation on touch/pointer events: src/audio/unlock.ts listens for pointerdown and touchend to unlock audio.
- Merge into actions.ts with the precedence rules M1/M7 already use for keyboard + gamepad. If none is defined, take the max of throttle and of brake and the largest-magnitude steer, and document it in TECHNICAL_DESIGN §13.1.
- Expose an 'active input device' signal (keyboard | gamepad | touch), updated on the latest meaningful input (any key, pad input beyond deadzone, any touch). The overlay, HUD adaptation, prompt glyphs (GDD §16.1: glyphs update to the active input device) and the Controls page consume it through src/app.
- Drive input is emitted only while ShiftScene or SkipRunScene is the top scene; elsewhere taps go to menu handling (SSP-262).
- Determinism: no sim changes, so every committed replay hash must stay identical.

## Scope

- src/input/touch.ts: pure reducer plus DOM wiring; multi-touch; steering slider, pedals, buttons and icons per the mapping in context
- actions.ts: merge touch into the per-tick InputFrame with the existing edge-latching semantics
- Active-input-device signal exposed to the app layer
- Wire touch into the composition root (src/app), injecting the layout and the client→internal transform
- Unit tests: tests/unit/touch.test.ts
- Update TECHNICAL_DESIGN §13.2 (Touch bullet) with the final steering mapping, pedal behaviour and pointer-ownership rules, and GDD §6.1/§6.2 if any touch behaviour differs from the table

## Out of scope

- Drawing the controls (SSP-260)
- Menu taps and prompt glyphs (SSP-262)
- The touch replay (SSP-258)
- Haptics via navigator.vibrate (not in the docs)
- Analogue pedal depth
- Any change in src/sim

## Acceptance criteria

- [ ] Unit test: a steer pointer dragged +48 internal px from its origin yields steer = 127, -24 px yields -63 or -64, +2 px yields 0, and release yields 0 on the next sampled tick
- [ ] Unit test: steer, throttle and brush at once (three pointerIds) produce steer ≠ 0, throttle = 255 and a single BRUSH pressed edge in one InputFrame
- [ ] Unit test: a brush tap whose down and up both happen between two samples produces exactly one BRUSH edge, on the first tick only, when two ticks are sampled in one frame
- [ ] Unit test: holding spray sets SPRAY in buttons on every tick until release; holding interact sets INTERACT likewise; with toggleSpray on, a spray tap latches SPRAY as the keyboard path does
- [ ] Unit test: a pointer that starts in the steering zone and moves into the right half keeps steering and never triggers a right-half control
- [ ] Unit test: pointercancel and a visibility-hidden event clear all held state (throttle 0, brake 0, steer 0, buttons 0)
- [ ] Unit test: the active-device signal switches to touch on a touch down and back to keyboard on a key press
- [ ] Existing keyboard and gamepad unit tests pass unmodified
- [ ] npm run test:replay passes with every pre-existing hash unchanged
- [ ] package.json and package-lock.json dependency lists are unchanged

## Verification

- npm run typecheck
- npm run lint
- npm test -- touch
- npm test
- npm run test:replay
- npm run test:e2e (desktop smoke unchanged)

## Dependencies

**Depends on:**

- [SSP-256](SSP-256-touch-layout-model.md) Define the touch control layout and hit-testing in internal pixel space
- [SSP-255](SSP-255-phone-viewport-scaling.md) Make the canvas, viewport and integer scaling phone-ready in landscape
- [SSP-044](../M1/SSP-044-input-devices.md) Implement keyboard and gamepad input producing quantised per-tick InputFrames
- [SSP-234](../M7/SSP-234-settings-store.md) Implement the ssp.settings.v1 store in src/app/settings.ts with storage fallback
- [SSP-236](../M7/SSP-236-input-remapping.md) Add keyboard and gamepad remapping for every action, with persistence
- [SSP-237](../M7/SSP-237-assists-sim.md) Wire auto-brush, +60 s timer, Chill Shift and instant dump into the sim
- [SSP-062](../M2/SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event
- [SSP-070](../M2/SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-046](../M1/SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie
- [SSP-198](../M6/SSP-198-skip-run.md) Implement SkipRunScene: 45 s cone slalom and reverse-park bays with £5/£50 payouts

**Blocks:**

- [SSP-258](SSP-258-touch-replay.md) Add the M8 replay: a Puddle Lane drive driven by scripted touch input
- [SSP-260](SSP-260-touch-controls-overlay.md) Draw the touch control overlay in internal pixel space via the UI pass
- [SSP-262](SSP-262-touch-menus-prompts.md) Make every menu and prompt usable by tap, with touch-aware glyphs
- [SSP-265](SSP-265-mobile-e2e-smoke.md) Add a Playwright mobile-emulation smoke drive with real touch events
- [SSP-266](SSP-266-ios-device-verification.md) Verify audio unlock, background resume and layout on a real iPhone
- [SSP-267](SSP-267-mobile-perf-check.md) Measure frame time and audio memory on a mid-range phone; record M8 budget

## References

- ../../TECHNICAL_DESIGN.md#131-actions-and-the-inputframe
- ../../TECHNICAL_DESIGN.md#132-devices
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom
- ../../TECHNICAL_DESIGN.md#16-save-data-and-settings
- ../../GDD.md#61-bindings
- ../../GDD.md#62-control-design-notes
- ../../GDD.md#87-dumping
- ../../GDD.md#161-principles
- ../../AUDIO_DESIGN.md#124-unlock-and-lifecycle-unlockts
- ../../ROADMAP.md#m8-touch--mobile-web

## Roadmap tasks covered

- `src/input/touch.ts`: left-half drag steering slider, right pedal (throttle), left pedal (brake/reverse), brush, spray and horn buttons, a contextual Interact/Dump button, map and pause icons (see the controls table in GDD.md).
