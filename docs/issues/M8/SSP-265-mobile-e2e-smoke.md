---
id: SSP-265
title: "Add a Playwright mobile-emulation smoke drive with real touch events"
milestone: M8
status: todo
type: test
estimate: M
labels: [type:test, area:test, area:input, area:tooling, size:M]
depends_on: [SSP-255, SSP-257, SSP-260, SSP-262, SSP-263, SSP-073, SSP-006, SSP-019, SSP-022, SSP-296]
blocks: [SSP-268]
---

# SSP-265: Add a Playwright mobile-emulation smoke drive with real touch events

**Milestone:** [M8 Touch & Mobile Web](../README.md#m8) · **Type:** test · **Size:** M · **Areas:** test, input, tooling

## Summary

Extend tests/e2e/mobile.spec.ts into a full smoke test: boot the shipping build in a landscape phone viewport with touch enabled, play part of a Puddle Lane shift using dispatched touch events only, and assert the same outcomes as the desktop smoke test plus the phone-specific width and portrait behaviour.

## Context

Harness (TECHNICAL_DESIGN §18.4–18.6, §20.2): Playwright 1.64.1, Chromium headless with --use-angle=swiftshader --enable-unsafe-swiftshader; webServer runs npm run build && npx vite preview --port 4173 --strictPort, so tests hit the shipping bundle. smoke.spec.ts is a 60 s scripted drive on Puddle Lane asserting no console errors, score > 0 and hopper LU > 0. The CI 'visual' job (macos-latest) installs only Chromium and runs npm run test:e2e.

The 'mobile' Playwright project (Chromium, 844×390, deviceScaleFactor 3, isMobile, hasTouch, testMatch tests/e2e/mobile.spec.ts) and the first mobile.spec.ts cases are created by SSP-255; SSP-262 and SSP-263 add tap-flow and portrait cases. This issue adds the touch-driven drive and makes the spec a coherent smoke test.

Touch events: drive through real input, not __ssp shortcuts, so touch.ts is exercised. Use CDP Input.dispatchTouchEvent via page.context().newCDPSession(page) for multi-touch (steer + throttle at once) and page.touchscreen.tap for single taps. CDP coordinates are CSS px: convert internal-pixel targets with the inverse transform — at W = 584, scale 4, DPR 3, one internal px = 4/3 CSS px and the frame starts at (98/3, 45/3) = (32.67, 15) CSS px.

Test hooks (?test=1, TECHNICAL_DESIGN §18.5) may be used for seed=1, readiness (__ssp.ready) and reading __ssp.state() (score, tidy, hopper, hp, tick, positions), and W = readFrame().length / 1080, but driving input must come from touch events. Test mode mutes audio (AUDIO_DESIGN §14), which is expected. Keep it deterministic: fixed seed, fixed input timeline, assertions on outcomes (score > 0, LU > 0), not hashes. No new dependency.

UPDATE: SSP-296 audits the macos-latest `visual` job that runs `npm run test:e2e` and proves it green (the remote exists since 2026-10-20). Extend its test:e2e project selection to include `mobile`.

## Scope

- tests/e2e/mobile.spec.ts: boot with ?test=1&seed=1, tap through Title → Week Map → intro card ('Tap to start'), lower the brush by tap, drive with simultaneous steer and throttle touches for about 60 s, open and close Pause by tap
- Assertions on W, overlay visibility, outcomes and console errors
- Consolidate the earlier mobile cases (re-layout, zoom/scroll, tap flow, portrait) so the spec runs reliably as one smoke suite
- Confirm npm run test:e2e (and so npm run ci and the CI visual job) runs the 'mobile' project

## Out of scope

- Real-device testing (SSP-266, SSP-267)
- WebKit or Firefox Playwright projects
- Frame-time assertions (SwiftShader frame time is meaningless, TECHNICAL_DESIGN §18.6)

## Acceptance criteria

- [ ] npx playwright test --project=mobile --repeat-each=3 passes
- [ ] The spec asserts W = 584 via readFrame().length / 1080 at 844×390
- [ ] After about 60 s of touch-driven play on district.puddle_lane with seed 1: score > 0, hopper LU > 0, and no console errors
- [ ] At least one step holds two touch points at once (steer + throttle), and Bessie's positions from __ssp.state() show a change of travel direction of at least 15° while moving
- [ ] grep -nE 'page\.(keyboard|mouse)' tests/e2e/mobile.spec.ts finds nothing
- [ ] The portrait step asserts the rotate prompt is shown and __ssp.state().tick does not advance
- [ ] Desktop smoke.spec.ts and perf.spec.ts results are unchanged

## Verification

- npm run test:e2e
- npx playwright test --project=mobile --repeat-each=3
- grep -nE 'page\.(keyboard|mouse)' tests/e2e/mobile.spec.ts (expect no output)
- npm run ci

## Dependencies

**Depends on:**

- [SSP-255](SSP-255-phone-viewport-scaling.md) Make the canvas, viewport and integer scaling phone-ready in landscape
- [SSP-257](SSP-257-touch-input-device.md) Implement src/input/touch.ts producing the same InputFrame as keyboard and pad
- [SSP-260](SSP-260-touch-controls-overlay.md) Draw the touch control overlay in internal pixel space via the UI pass
- [SSP-262](SSP-262-touch-menus-prompts.md) Make every menu and prompt usable by tap, with touch-aware glyphs
- [SSP-263](SSP-263-rotate-landscape-prompt.md) Show a 'rotate to landscape' prompt and pause the game in portrait
- [SSP-073](../M2/SSP-073-e2e-smoke.md) Add smoke.spec.ts: 60 s scripted sweep and full shift ending on the tally
- [SSP-006](../M0/SSP-006-npm-scripts-ci-workflow.md) Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-022](../M0/SSP-022-visual-goldens.md) Add lean_quadrants and scale_1440 visual specs and goldens; prove 10-run stability (D-09)
- [SSP-296](../M7/SSP-296-ci-macos-visual-e2e.md) Bring the macos-latest visual/e2e CI job to its 1.0 shape and prove both CI jobs green

**Blocks:**

- [SSP-268](SSP-268-m8-close-release.md) Close M8: verify exit criteria, ship the mobile web update, tag m8

## References

- ../../TECHNICAL_DESIGN.md#186-e2e
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../TECHNICAL_DESIGN.md#184-visual-headless-screenshot-tests
- ../../TECHNICAL_DESIGN.md#19-ci
- ../../TECHNICAL_DESIGN.md#202-vite-configuration
- ../../AUDIO_DESIGN.md#14-testing

## Roadmap tasks covered

- `Playwright mobile-emulation smoke test (touch events, viewport).`
- Adaptive width at phone aspect ratios: confirm `clampEven(round(270 × aspect), 432, 640)` letterboxes cleanly on 19.5:9 screens.
