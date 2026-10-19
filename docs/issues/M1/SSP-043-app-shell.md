---
id: SSP-043
title: "Add the fixed 60 Hz loop, Game, SceneManager and typed event bus"
milestone: M1
status: done
type: feature
estimate: M
labels: [type:feature, area:platform, area:sim, area:test, size:M, vertical-slice]
depends_on: [SSP-035, SSP-019, SSP-022]
blocks: [SSP-044, SSP-045, SSP-046, SSP-067, SSP-069, SSP-070, SSP-071, SSP-284, SSP-078, SSP-102, SSP-287, SSP-298, SSP-118, SSP-157, SSP-173, SSP-176, SSP-186, SSP-191, SSP-235, SSP-241, SSP-263]
---

# SSP-043: Add the fixed 60 Hz loop, Game, SceneManager and typed event bus

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** feature · **Size:** M · **Areas:** platform, sim, test · **Vertical slice**

## Summary

Build the browser composition root: `src/app/loop.ts` (fixed 60 Hz accumulator, at most 5 steps per frame, render interpolation alpha), `Game.ts`, a stack-based `SceneManager.ts`, and `events.ts`, which drains the sim EventQueue after each tick and dispatches typed events to subscribers.

## Context

loop.ts (TECHNICAL_DESIGN §5.1) implements the documented frame function:
- `DT = 1/60`, `MAX_STEPS = 5`, `MAX_FRAME = 0.25` s.
- Each step: `actions.sampleForTick()` → `scenes.fixedUpdate(input)` → `events.drain(world.events)`.
- If `steps === MAX_STEPS && acc > DT`, set `acc = DT` (slow down, never spiral).
- Then `scenes.render(acc / DT)`.
- It is the only place outside src/debug that reads `performance.now()`.
- 60/120/144 Hz displays all run 60 ticks/s.
- On `visibilitychange`, reset the accumulator on resume. The PauseOverlay itself is later work.
- With `?test=1&freeze=1` the loop renders but never steps; `window.__ssp.step(n)` advances synchronously.

SceneManager (§6.1) holds a stack of scenes; the top one receives input, scenes below keep rendering. Interface:
- `readonly id: SceneId`
- `enter(params): Promise<void>`
- `exit(): void`
- `fixedUpdate(input: InputFrame): void`
- `render(alpha: number): void`
- `readonly blocksUpdateBelow: boolean`
It is a class: long-lived resource owners may be classes (§21.1).

events.ts (§7.2): a typed bus. Subscribers (audio, UI, render fx, and gamepad rumble in this milestone) get strongly typed events. Scoring never uses the bus. Render, audio and UI never write sim state (CLAUDE.md §3 rule 2).

Game.ts wires renderer, input, scenes and loop.

Migrate the M0 spike scenes (lean_quadrants, scale_1440, and any ZooScene stub) onto SceneManager without changing their goldens. `main.ts` boots into the default scene; ShiftScene arrives in SSP-046.

Make the loop logic testable with an injected clock (for example a pure `advance(state, frameS)` that returns the step count) so unit tests need no rAF.

## Scope

- src/app/loop.ts with injectable clock/rAF and test-mode freeze
- src/app/Game.ts, src/app/SceneManager.ts (stack, Scene interface, SceneId union)
- src/app/events.ts: typed subscribe/dispatch, drain from the sim EventQueue after each tick
- Port the spike scenes onto SceneManager; main.ts bootstraps Game
- Unit tests: step counts at 30/60/144 Hz frame times, the 0.25 s clamp, the 5-step cap and backlog drop, freeze mode, event dispatch order

## Out of scope

- ShiftScene contents: SSP-046
- PauseOverlay, Title/Boot flow, save/settings (M2+/M6/M7)
- Audio mixer (M5)

## Acceptance criteria

- [ ] Frame times of 1/30 s give 2 steps per frame; 1/144 s frames average 60 steps per simulated second over 10 s
- [ ] A 1 s frame is clamped to 0.25 s, runs at most 5 steps, and leaves acc ≤ DT
- [ ] In freeze mode, render is called but fixedUpdate is not, until __ssp.step(n) runs exactly n ticks
- [ ] Events emitted in a tick reach subscribers once, in emission order, after that tick
- [ ] performance.now() appears only in loop.ts and src/debug (grep test)
- [ ] lean_quadrants and scale_1440 visual goldens still pass

## Verification

- npm run typecheck
- npm run lint
- npm test -- loop
- npm run test:visual
- npm run dev  (spike scenes still load)

## Dependencies

**Depends on:**

- [SSP-035](SSP-035-world-tick-order.md) Add World, EventQueue and fixed tick order with surface grip and kerb jolts
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-022](../M0/SSP-022-visual-goldens.md) Add lean_quadrants and scale_1440 visual specs and goldens; prove 10-run stability (D-09)

**Blocks:**

- [SSP-044](SSP-044-input-devices.md) Implement keyboard and gamepad input producing quantised per-tick InputFrames
- [SSP-045](SSP-045-render-ground-city.md) Render compiled levels: chunked ground layer and full cityMesh cell merge
- [SSP-046](SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie
- [SSP-067](../M2/SSP-067-items-sprite-batch.md) Render litter, stains and site markers via the items instance batch
- [SSP-069](../M2/SSP-069-bitmap-text.md) Implement src/ui/bitmapText.ts and the UI render pass
- [SSP-070](../M2/SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-071](../M2/SSP-071-intro-tally-scenes.md) Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry
- [SSP-284](../M2/SSP-284-boot-scene.md) Add BootScene: load atlases, fonts and the palette LUT once, then hand off to the shift flow
- [SSP-078](../M3/SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-102](../M3/SSP-102-fx-placeholder-particles.md) Add placeholder particles in src/render/fx.ts for dust, splash and sparkle
- [SSP-287](../M3/SSP-287-pause-overlay.md) Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire
- [SSP-298](../M3/SSP-298-zoo-scene-review.md) Add a minimal test-only ZooScene for in-engine review of actors and items frames
- [SSP-118](../M4/SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-157](../M4/SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art
- [SSP-173](../M5/SSP-173-mixer-buses-ducking.md) Implement mixer.ts: bus graph, limiter, settings levels and ducking engine
- [SSP-176](../M5/SSP-176-sfx-event-wiring.md) Wire sim events to sfx cues through a pure audio director
- [SSP-186](../M6/SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub
- [SSP-191](../M6/SSP-191-week-map-scene.md) Build WeekMapScene: seven district cards, stars, unlock state and Gleaming badges
- [SSP-235](../M7/SSP-235-settings-scene.md) Build SettingsScene with audio, display, accessibility and assist pages
- [SSP-241](../M7/SSP-241-juice-impact.md) Add screen shake, hit-stop and gamepad rumble with reduce-motion support
- [SSP-263](../M8/SSP-263-rotate-landscape-prompt.md) Show a 'rotate to landscape' prompt and pause the game in portrait

## References

- ../../TECHNICAL_DESIGN.md#51-loop
- ../../TECHNICAL_DESIGN.md#61-scenemanager
- ../../TECHNICAL_DESIGN.md#72-event-queue
- ../../TECHNICAL_DESIGN.md#31-module-diagram
- ../../TECHNICAL_DESIGN.md#185-test-hooks

## Roadmap tasks covered

- `src/app/loop.ts`, `Game.ts`, `SceneManager.ts`, `events.ts` (typed event bus), and `ShiftScene` (drive-only). [loop, Game, SceneManager, events]
- Deliverable: `src/app/loop.ts`: fixed 60 Hz accumulator, at most 5 steps per frame, render interpolation.
