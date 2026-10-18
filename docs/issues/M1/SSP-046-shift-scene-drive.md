---
id: SSP-046
title: "Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie"
milestone: M1
status: todo
type: feature
estimate: M
labels: [type:feature, area:gameplay, area:render, area:platform, size:M, vertical-slice]
depends_on: [SSP-043, SSP-044, SSP-045, SSP-036, SSP-038, SSP-018, SSP-019, SSP-008, SSP-024]
blocks: [SSP-047, SSP-048, SSP-050, SSP-065, SSP-071, SSP-284, SSP-078, SSP-287, SSP-288, SSP-178, SSP-185, SSP-257]
---

# SSP-046: Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** feature · **Size:** M · **Areas:** gameplay, render, platform · **Vertical slice**

## Summary

Wire everything into a playable `ShiftScene` (drive only). It loads the compiled Puddle Lane, creates a seeded World, steps it at 60 Hz from real input, and renders the city plus Bessie's sprite (32 headings, dented below 40 HP, brush overlay when down) with render interpolation. From here `npm run dev` always launches something drivable.

## Context

ShiftScene (TECHNICAL_DESIGN §6):
- `enter` fetches `assets/levels/puddle_lane.json`, resolved relative to `import.meta.env.BASE_URL` (Vite `base: './'`), decodes it with map.ts and calls `createWorld(level, seed, tuning)`. (In the full flow ShiftIntroScene preloads the level, §6.3; in M1 ShiftScene loads it directly.)
- `fixedUpdate(input)` calls `world.step(input)`.
- `render(alpha)` lerps between the prev and current pose, taking the shortest arc for heading.

Bessie sprite (§12.5, §4):
- A flat quad at y = 0, depth layer 7 (body), with the brush overlay `veh.sweeper_brush` at layer 8.
- Frame `veh.sweeper:body:hNN:0` with `NN = ((round(θ / (2π/32)) % 32) + 32) % 32`. The 2° hysteresis is *proposed* (ART_BIBLE §4.5): optional, and flag it if added.
- Use `veh.sweeper:dented:hNN:0` when HP < 40.
- Draw the brush overlay `veh.sweeper_brush:brush:hNN:0` when `brushDown`. The spin animation is M2; static frame 0 is acceptable.
- Drop shadow +2, +2 px if the M0 batch supports it.
- All references go through FRAME (typed).

Boot: `npm run dev` lands in the drive-only ShiftScene by default (ROADMAP §1 principle 5). With `?test=1` (§18.5):
- `scene=district.puddle_lane`, `seed=<n>`, `tick=<n>`, `freeze=1`
- `window.__ssp.step(n)`
- `window.__ssp.state()`: a JSON-safe snapshot of tick, Bessie x/y/heading/speed, HP
- `readFrame()` and `setCamera()` from M0
Test mode disables audio, look-ahead and zoom springs, and uses a fixed 1/60 render step.

Dev builds record the shift's input log through the World's replay hook (SSP-038) so the dev panel can save it.

The camera follows Bessie (snap to 1/16 m with sub-pixel blit, from M0). Look-ahead and speed zoom come in SSP-047.

## Scope

- src/scenes/ShiftScene.ts (drive-only) registered with SceneManager; the default boot scene in dev
- Bessie sprite instance with heading frame selection, dented state, brush overlay, interpolation
- Basic camera follow using the M0 camera
- testHooks: scene=district.puddle_lane, seed, tick, step(n), state()
- A Playwright spec or scripted frozen capture used for review (no new canonical golden required)
- Define and export a JSON-safe `SimSnapshot` type for `__ssp.state()` with the M1 fields: tick, bessie {x, y, heading, speed} in metres/radians, and hp. Later issues extend this type (SSP-065 M2 fields, SSP-078 complaints)
- Bind `__ssp.step(n)` to the World: advance n ticks synchronously, then render once; this also works with freeze=1
- Document the M1 SimSnapshot fields in TECHNICAL_DESIGN §18.5, noting which milestones add score, tidy and hopper

## Out of scope

- HUD, timer, shift end flow, TallyScene (M2)
- Look-ahead and speed zoom: SSP-047
- Engine and brush audio (M5)

## Acceptance criteria

- [ ] `npm run dev` opens straight into Puddle Lane with Bessie at the depot start facing north, drivable with keyboard and gamepad
- [ ] `?test=1&scene=district.puddle_lane&freeze=1` renders deterministically (two captures identical); `__ssp.step(600)` then `__ssp.state()` returns tick 600
- [ ] At heading π/2, Bessie draws frame h08; below 40 HP the dented frame is used (unit test on the frame-selection function)
- [ ] The rendered pose is lerped between prev and current pose by alpha (unit test on the interpolation helper, including heading wrap at ±π)
- [ ] renderer.info.render.calls ≤ 10 in the scene
- [ ] A frozen capture of Bessie in Puddle Lane was opened with Read and noted in the PR
- [ ] `__ssp.step(n)` advances exactly n ticks and renders exactly once per call (render counter or spy), including with freeze=1
- [ ] `JSON.parse(JSON.stringify(__ssp.state()))` deep-equals `__ssp.state()`, and the snapshot contains tick, bessie.x, bessie.y, bessie.heading, bessie.speed and hp
- [ ] Loading with `?test=1&scene=district.puddle_lane&tick=600` gives `__ssp.state().tick === 600`
- [ ] TECHNICAL_DESIGN §18.5 lists the SimSnapshot fields available from M1

## Verification

- npm run dev
- npm run typecheck
- npm run lint
- npm test
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-043](SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-044](SSP-044-input-devices.md) Implement keyboard and gamepad input producing quantised per-tick InputFrames
- [SSP-045](SSP-045-render-ground-city.md) Render compiled levels: chunked ground layer and full cityMesh cell merge
- [SSP-036](SSP-036-static-collision.md) Resolve Bessie against static geometry with impact damage and TOWED stub
- [SSP-038](SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner
- [SSP-018](../M0/SSP-018-sprite-batch.md) Draw Bessie (32 headings) and the pedestrian via instanced sprite batches
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-008](../M0/SSP-008-blender-bessie.md) Port the probe sweeper onto rig.py and commit Bessie body, dented and brush renders
- [SSP-024](../M0/SSP-024-look-decisions.md) Decide speed zoom, vehicle tilt, 480x270 base and scale sheet (D-01, D-02, D-03, D-07)

**Blocks:**

- [SSP-047](SSP-047-camera-lookahead-zoom.md) Drive camera look-ahead and speed zoom from Bessie's real speed
- [SSP-048](SSP-048-dev-panel.md) Add the F1 dev panel for live tuning, telemetry and Save replay
- [SSP-050](SSP-050-m1-exit-close.md) Verify M1 exit criteria, run the lead handling playtest and open the Close M1 PR
- [SSP-065](../M2/SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-071](../M2/SSP-071-intro-tally-scenes.md) Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry
- [SSP-284](../M2/SSP-284-boot-scene.md) Add BootScene: load atlases, fonts and the palette LUT once, then hand off to the shift flow
- [SSP-078](../M3/SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-287](../M3/SSP-287-pause-overlay.md) Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire
- [SSP-288](../M3/SSP-288-popups-speech-bubbles.md) Add src/ui/popups.ts: world-space score/penalty popups and NPC speech bubbles
- [SSP-178](../M5/SSP-178-music-player.md) Implement music.ts: sample-locked stems, loops, jingles and scene music
- [SSP-185](../M5/SSP-185-m5-exit-evidence.md) Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR
- [SSP-257](../M8/SSP-257-touch-input-device.md) Implement src/input/touch.ts producing the same InputFrame as keyboard and pad

## References

- ../../TECHNICAL_DESIGN.md#6-scenes
- ../../TECHNICAL_DESIGN.md#125-sprites-spritebatchts-spritestackts
- ../../TECHNICAL_DESIGN.md#4-coordinate-systems-and-units
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../TECHNICAL_DESIGN.md#202-vite-configuration
- ../../ART_BIBLE.md#81-bessie-vehsweeper
- ../../ART_BIBLE.md#45-directions-and-headings
- ../../ROADMAP.md#1-planning-principles

## Roadmap tasks covered

- `src/app/loop.ts`, `Game.ts`, `SceneManager.ts`, `events.ts` (typed event bus), and `ShiftScene` (drive-only). [ShiftScene part]
