---
id: SSP-241
title: "Add screen shake, hit-stop and gamepad rumble with reduce-motion support"
milestone: M7
status: todo
type: feature
estimate: M
labels: [type:feature, area:render, area:input, area:gameplay, size:M]
depends_on: [SSP-234, SSP-036, SSP-090, SSP-082, SSP-078, SSP-044, SSP-043, SSP-024]
blocks: [SSP-248, SSP-253]
---

# SSP-241: Add screen shake, hit-stop and gamepad rumble with reduce-motion support

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** feature · **Size:** M · **Areas:** render, input, gameplay

## Summary

Add impact feedback: screen shake on impacts, 2–4 frames of hit-stop on big impacts, and gamepad rumble. All three honour the screenShake intensity, Reduce motion, Rumble and Reduce loud sounds settings, and none of them can change replays.

## Context

Roadmap: screen shake on impacts (respects a "reduce motion" setting), hit-stop of 2–4 frames on big impacts, rumble where supported.
Settings (read directly from settings.ts): `screenShake` multiplier 0–1 (default 1.0). `access.reduceMotion` disables screen shake, hit-stop AND speed zoom, if D-01 shipped it (GDD §17.2). `access.rumble` (default on). The AUDIO_DESIGN §13.1 Reduce loud sounds field forces rumble off.
Screen shake:
- Apply it in the renderer as a camera/blit offset, using the render-side RNG (never the sim's sfc32).
- Prefer whole-internal-pixel offsets so the sub-pixel camera snapping (TECHNICAL_DESIGN §12.2) does not shimmer.
- Test mode (?test=1) already disables the speed-zoom spring and look-ahead unless a scene enables them (TECHNICAL_DESIGN §18.5). Add shake and hit-stop to that list, so goldens stay stable, and update §18.5.
Hit-stop:
- Implement it in src/app/loop.ts by running zero sim steps for 2–4 ticks' worth of frames and not accumulating time during the stop, which is the same principle as pause. Pause is not part of a replay (TECHNICAL_DESIGN §5.1, §13.1).
- The sim result is a function of the per-tick input log, so replay hashes cannot change. Edge latching must still deliver presses made during the stop on the next tick.
- 'Big impact' reuses the crash vs bump_wall split by normal speed vn that already maps EV.Impact to `sfx.crash` (TECHNICAL_DESIGN §14.2).
Rumble (AUDIO_DESIGN §12.5) in src/input/gamepad.ts uses `vibrationActuator.playEffect('dual-rumble', …)` where supported:
| Cue | Strong / weak | Duration |
|---|---|---|
| crash | 0.9 / 0.6 | 220 ms |
| bump_wall | 0.3–0.6 by impact speed / 0.2 | 90 ms |
| bump_kerb | 0.2 / 0.4 | 70 ms |
| complaint_stamp | 0.6 / 0 | 120 ms |
| dump | 0.1 / 0.3 | drain duration |
| brush down and collecting | 0 / 0.05 | continuous (toggleable) |
Shake amplitude and decay are not documented. Choose values, keep them as named render constants, and note them in the PR. They are tunable later and do not need sign-off to merge.

## Scope

- render: screen shake offset driven by impact events, scaled by screenShake, zero when reduceMotion or ?test=1
- src/app/loop.ts: hit-stop of 2–4 ticks on crash-class impacts, disabled by reduceMotion and in test mode
- src/input/gamepad.ts: rumble cue table, gated by access.rumble and Reduce loud sounds
- Reduce motion also forces speed zoom off, if speed zoom exists
- Update TECHNICAL_DESIGN §18.5 (test mode disables shake and hit-stop)
- Unit tests: shake envelope, hit-stop scheduler, rumble gating. A loop-level test proving replay hashes are unchanged with hit-stop active.

## Out of scope

- Squash-and-stretch and popups (SSP-240)
- Reduce flashing (SSP-242)
- Touch haptics (M8)

## Acceptance criteria

- [ ] A crash-class impact produces a non-zero shake offset, and hit-stop lasts 2–4 ticks (unit test on the hit-stop scheduler)
- [ ] With reduceMotion on: zero shake offset, no hit-stop, speed zoom off (unit test)
- [ ] screenShake = 0 gives zero offset, and 0.5 halves the amplitude (unit test)
- [ ] Rumble fires with the AUDIO_DESIGN §12.5 magnitudes when supported, and never fires when rumble is off or Reduce loud sounds is on (unit test with a fake actuator)
- [ ] A replay driven through the loop with hit-stop active reaches the same final hash as npm run test:replay
- [ ] Visual goldens unchanged (shake and hit-stop disabled in test mode)

## Verification

- npm run typecheck && npm run lint && npm test
- npm run test:replay
- npm run test:visual
- npm run test:e2e
- Manual: gamepad on Chrome, crash into a lamp post, feel rumble, then toggle Reduce motion

## Dependencies

**Depends on:**

- [SSP-234](SSP-234-settings-store.md) Implement the ssp.settings.v1 store in src/app/settings.ts with storage fallback
- [SSP-036](../M1/SSP-036-static-collision.md) Resolve Bessie against static geometry with impact damage and TOWED stub
- [SSP-090](../M3/SSP-090-traffic-parked-collision.md) Add parked cars and Bessie-vs-vehicle collision with dent and impact rules
- [SSP-082](../M3/SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-078](../M3/SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-044](../M1/SSP-044-input-devices.md) Implement keyboard and gamepad input producing quantised per-tick InputFrames
- [SSP-043](../M1/SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-024](../M0/SSP-024-look-decisions.md) Decide speed zoom, vehicle tilt, 480x270 base and scale sheet (D-01, D-02, D-03, D-07)

**Blocks:**

- [SSP-248](SSP-248-perf-optimise.md) Profile and optimise until the M7 performance budgets hold
- [SSP-253](SSP-253-browser-scaling-qa.md) Run cross-browser, scaling and storage-blocked verification for 1.0

## References

- ../../GDD.md#172-accessibility-features
- ../../AUDIO_DESIGN.md#125-haptics
- ../../AUDIO_DESIGN.md#131-settings
- ../../TECHNICAL_DESIGN.md#122-camera-rendercamerats
- ../../TECHNICAL_DESIGN.md#51-loop
- ../../TECHNICAL_DESIGN.md#131-actions-and-the-inputframe
- ../../TECHNICAL_DESIGN.md#132-devices
- ../../TECHNICAL_DESIGN.md#142-event--sound
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../ROADMAP.md#8-m0-spike-decision-log

## Roadmap tasks covered

- `Juice: squash-and-stretch on Bessie and NPC reactions; screen shake on impacts (respects a "reduce motion" setting); hit-stop 2–4 frames on big impacts; rumble where supported. (shake, hit-stop, rumble)`
- `src/scenes/SettingsScene.ts` and `src/app/settings.ts`: remapping, volumes, assists, reduce motion, reduce flashing, Fullscreen toggle. (reduce motion behaviour)
