---
id: SSP-073
title: "Add smoke.spec.ts: 60 s scripted sweep and full shift ending on the tally"
milestone: M2
status: todo
type: test
estimate: M
labels: [type:test, area:test, area:tooling, size:M, vertical-slice]
depends_on: [SSP-065, SSP-071, SSP-056, SSP-072, SSP-070, SSP-006, SSP-023, SSP-019, SSP-044, SSP-038]
blocks: [SSP-074, SSP-185, SSP-294, SSP-232, SSP-296, SSP-255, SSP-265]
---

# SSP-073: Add smoke.spec.ts: 60 s scripted sweep and full shift ending on the tally

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** test · **Size:** M · **Areas:** test, tooling · **Vertical slice**

## Summary

Create `tests/e2e/smoke.spec.ts`, which drives a canned 60 s sweep on Puddle Lane in the built game and asserts no console errors, score > 0 and a non-empty hopper, then runs a full shift to the tally scene. It is the first e2e smoke test and the main proof for M2's 'complete 240 s shift' exit criterion.

## Context

Spec (TECHNICAL_DESIGN §18.6, ROADMAP M2 Full shift check): 60 s scripted drive on Puddle Lane with a canned input sequence; asserts no console errors, score > 0, hopper filled (LU > 0). Playwright 1.64.1, Chromium; `webServer` runs `npm run build && npx vite preview --port 4173 --strictPort` (TECHNICAL_DESIGN §20.2); CI runs `npm run test:e2e` on `macos-latest`.
Test hooks (TECHNICAL_DESIGN §18.5): `?test=1&seed=<n>&scene=<id>&tick=<n>&freeze=1`, `__ssp.step(n)`, `__ssp.state()`, `__ssp.readFrame()`, plus the scene-id hook from SSP-071. Test mode disables audio, the speed-zoom spring and look-ahead and uses a fixed 1/60 render step.
Input injection: there is no hook for a canned input sequence. Add a test-mode hook that loads a replay's input log (reusing the M1 replay decoder) and feeds it to the sim during `step(n)`, e.g. `__ssp.loadInputs(base64)`; reuse the first 3,600 ticks of `m2_full_shift_puddle_lane.json`. Document the hook in TECHNICAL_DESIGN §18.5. (Driving real keyboard events in wall-clock time is slower and flakier.)
Canned route: from `@` on the south-west depot, roll north up Mangle Street (dense gutter grime and litter), lower the brush, keep speed ≤ 4.0 m/s.
Full shift: after the smoke assertions, step to the end of the shift (≈ 14,400 ticks + rollout + coast) and assert the active scene is the tally; save and Read a tally frame with `tests/e2e/helpers/saveFrame.ts`.
Draw calls: `perf.spec.ts` drives a dense scene that does not exist until M6 (Kebab Mile); keep whatever scene M0 baselined passing, and also assert `renderer.info.render.calls ≤ 10` in smoke.spec.ts on Puddle Lane with litter and HUD on screen (via a test-mode counter in `__ssp`, documented in §18.5).

## Scope

- `tests/e2e/smoke.spec.ts` with the 60 s sweep, draw-call and full-shift-to-tally checks
- Input-injection test hook documented in TECHNICAL_DESIGN §18.5
- Draw-call counter exposed in test mode if not already present
- README command table note if `test:e2e` behaviour text changes

## Out of scope

- VS-8 20-shift soak (vertical slice gate)
- `week.spec.ts` (M6)
- GPU perf budget enforcement (vertical slice / M7)

## Acceptance criteria

- [ ] `npm run test:e2e` runs smoke.spec.ts green against the production build
- [ ] The smoke test fails if any console error is logged, score is 0 or hopper LU is 0 after 3,600 ticks
- [ ] Draw calls ≤ 10 are asserted during the sweep
- [ ] The full-shift step ends with the tally scene active and its numbers matching `__ssp.state()`; the tally frame was Read
- [ ] Three consecutive runs give identical final `__ssp.state()` values
- [ ] perf.spec.ts `ci` project still passes

## Verification

- npx playwright install chromium
- npm run test:e2e
- npm run test:e2e -- --repeat-each=3 tests/e2e/smoke.spec.ts

## Dependencies

**Depends on:**

- [SSP-065](SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-071](SSP-071-intro-tally-scenes.md) Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry
- [SSP-056](SSP-056-puddle-lane-sweeping-content.md) Author Puddle Lane litter, grime, frontages, pledges and collectibles data
- [SSP-072](SSP-072-m2-replays.md) Record the M2 full-shift and dump-cycle replays and commit their hashes
- [SSP-070](SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-006](../M0/SSP-006-npm-scripts-ci-workflow.md) Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow
- [SSP-023](../M0/SSP-023-perf-baseline.md) Baseline perf.spec.ts on the dev Mac GPU and set the p99 frame-time budget (D-08)
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-044](../M1/SSP-044-input-devices.md) Implement keyboard and gamepad input producing quantised per-tick InputFrames
- [SSP-038](../M1/SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner

**Blocks:**

- [SSP-074](SSP-074-close-m2.md) Close M2: verify exit criteria, record decisions and tag m2
- [SSP-185](../M5/SSP-185-m5-exit-evidence.md) Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR
- [SSP-294](../M5/SSP-294-vs-automated-checks.md) Automate the vertical-slice technical checks: before/after captures, Puddle Lane perf and the 20-shift soak
- [SSP-232](../M6/SSP-232-week-spec-e2e.md) Write tests/e2e/week.spec.ts: scripted save from Monday to the Tidy Town Trophy
- [SSP-296](../M7/SSP-296-ci-macos-visual-e2e.md) Bring the macos-latest visual/e2e CI job to its 1.0 shape and prove both CI jobs green
- [SSP-255](../M8/SSP-255-phone-viewport-scaling.md) Make the canvas, viewport and integer scaling phone-ready in landscape
- [SSP-265](../M8/SSP-265-mobile-e2e-smoke.md) Add a Playwright mobile-emulation smoke drive with real touch events

## References

- ../../TECHNICAL_DESIGN.md#186-e2e
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../TECHNICAL_DESIGN.md#202-vite-configuration
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../ROADMAP.md#m2-sweeping-core
- ../../LEVEL_DESIGN.md#51-mon-puddle-lane-districtpuddle_lane-tutorial

## Roadmap tasks covered

- Measurable check: Full shift — `tests/e2e/smoke.spec.ts`: a 60 s scripted run with no console errors, score > 0 and the hopper filled. A replay of a full 240 s shift ends on the tally scene.
- `Exit criterion: A complete 240 s shift with tally numbers on screen.`
