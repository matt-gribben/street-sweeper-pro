---
id: SSP-253
title: "Run cross-browser, scaling and storage-blocked verification for 1.0"
milestone: M7
status: todo
type: test
estimate: M
labels: [type:test, area:test, area:platform, area:render, area:input, size:M]
depends_on: [SSP-235, SSP-236, SSP-238, SSP-239, SSP-240, SSP-241, SSP-242, SSP-248, SSP-246, SSP-249, SSP-251, SSP-022, SSP-232, SSP-233]
blocks: [SSP-254, SSP-255]
---

# SSP-253: Run cross-browser, scaling and storage-blocked verification for 1.0

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** test · **Size:** M · **Areas:** test, platform, render, input

## Summary

Carry out and record the Browsers, Scaling and Remapping exit checks: a manual pass on four desktop browsers with keyboard and gamepad, the scale_1440 golden, resolution spot checks, the Fullscreen toggle and the storage-blocked run.

## Context

Browsers (ROADMAP M7 checks): manual pass on desktop Chrome, Firefox, Safari and Edge with keyboard AND a standard-mapping gamepad, recorded in the release PR (browser versions, OS, pad model).
Scaling: the `scale_1440` golden passes (a 2560×1440 page screenshot: 1440p → 5×, 1350 px tall, 45 px bars). Spot checks:
- 1080p fullscreen → 4×
- 1080p windowed → 3× (viewport ≈ 1920×950)
- itch.io 960×540 embed → 2×
- 4K → 8×
The Fullscreen toggle works (TECHNICAL_DESIGN §12.1). The letterbox is #0f0e12 and the canvas uses image-rendering: pixelated.
Remapping: every action rebinds on keyboard and gamepad and persists across reloads. The game still runs with storage blocked.
Audio (AUDIO_DESIGN §12.1, §12.4):
- unlock on the first pointerdown/keydown
- gamepad-only players see "Click or press a key for sound"
- Safari takes the .m4a path, Chrome/Firefox the .ogg Opus path
Flow targets (GDD §15.1, proposed M7), to measure and record:
- cold boot to driving on a returning save ≤ 4 inputs
- tally → next shift's intro ≤ 3 inputs
- every screen works by keyboard, gamepad and mouse
Also check on each browser: assists, settings, reduce motion, reduce flashing, audio accessibility settings, juice, and credits.
Test `npm run build && npx vite preview` locally, then the restricted itch page (iframe, sub-path) for the embed check.
File any bug as a follow-up issue, and fix blockers before SSP-254.

## Scope

- Manual matrix: 4 browsers × (keyboard, gamepad) × a full shift plus menus, settings, remap and credits, recorded as a table in the release PR
- npm run test:visual including scale_1440. Resolution spot checks with screenshots opened with Read.
- Storage-blocked run in each browser (private window or blocked site data)
- Measure and record the flow-target input counts

## Out of scope

- Mobile browsers and touch (M8)
- Desktop wrappers (M9)

## Acceptance criteria

- [ ] The release PR has a table showing pass/fail for Chrome, Firefox, Safari and Edge with keyboard and gamepad, with versions
- [ ] scale_1440 passes at threshold 0
- [ ] Recorded spot checks show integer scales 4×, 3×, 2× and 8× at the four listed sizes, with #0f0e12 letterboxing
- [ ] The Fullscreen toggle works in all four browsers
- [ ] Remaps persist across reload, and the game runs and plays a full shift with storage blocked, in all four browsers
- [ ] Safari plays the .m4a set and Chrome/Firefox the .ogg set (network panel)
- [ ] Flow-target input counts recorded (≤ 4 and ≤ 3, or a deviation noted for the lead)
- [ ] No open blocker bugs

## Verification

- npm run build && npx vite preview --port 4173 --strictPort
- npm run test:visual
- npm run test:e2e
- Manual browser matrix, recorded in the PR

## Dependencies

**Depends on:**

- [SSP-235](SSP-235-settings-scene.md) Build SettingsScene with audio, display, accessibility and assist pages
- [SSP-236](SSP-236-input-remapping.md) Add keyboard and gamepad remapping for every action, with persistence
- [SSP-238](SSP-238-assists-tally-save.md) Flag assists on the Mercury tally and store assisted bests separately
- [SSP-239](SSP-239-audio-access-settings.md) Wire audio accessibility settings live: captions via SSP-184, mono, loud sounds, beeper, adaptive music
- [SSP-240](SSP-240-juice-squash-popups.md) Juice pass: squash-and-stretch, combo popups and the cat roof-ride
- [SSP-241](SSP-241-juice-impact.md) Add screen shake, hit-stop and gamepad rumble with reduce-motion support
- [SSP-242](SSP-242-reduce-flashing.md) Implement the Reduce flashing setting across HUD and world effects
- [SSP-248](SSP-248-perf-optimise.md) Profile and optimise until the M7 performance budgets hold
- [SSP-246](SSP-246-audio-complete-audit.md) Verify all 9 songs and 6 jingles ship, and run the full-playthrough mix pass
- [SSP-249](SSP-249-credits-scene.md) Build CreditsScene with pipeline and tool-version provenance
- [SSP-251](SSP-251-itch-page.md) Prepare the itch.io page: copy, controls, rating note and screenshots
- [SSP-022](../M0/SSP-022-visual-goldens.md) Add lean_quadrants and scale_1440 visual specs and goldens; prove 10-run stability (D-09)
- [SSP-232](../M6/SSP-232-week-spec-e2e.md) Write tests/e2e/week.spec.ts: scripted save from Monday to the Tidy Town Trophy
- [SSP-233](../M6/SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag

**Blocks:**

- [SSP-254](SSP-254-release-1-0.md) Push 1.0 to itch.io with butler and tag v1.0.0 and m7
- [SSP-255](../M8/SSP-255-phone-viewport-scaling.md) Make the canvas, viewport and integer scaling phone-ready in landscape

## References

- ../../ROADMAP.md#m7-10-web-release
- ../../TECHNICAL_DESIGN.md#121-internal-resolution-and-scaling
- ../../TECHNICAL_DESIGN.md#184-visual-headless-screenshot-tests
- ../../TECHNICAL_DESIGN.md#16-save-data-and-settings
- ../../GDD.md#151-scene-flow
- ../../AUDIO_DESIGN.md#121-formats
- ../../AUDIO_DESIGN.md#124-unlock-and-lifecycle-unlockts
- ../../GDD.md#3-audience-platforms-and-rating

## Roadmap tasks covered

- `Exit check: Browsers — manual pass on desktop Chrome, Firefox, Safari and Edge, with keyboard and gamepad, recorded in the release PR.`
- Exit check: Scaling — `scale_1440` golden passes. Spot checks at 1080p fullscreen (4×), 1080p windowed (3×), the itch.io 960×540 embed (2×) and 4K (8×). The Fullscreen toggle works.
- `Exit check: Remapping — every action is rebindable for keyboard and gamepad and persists across reloads. The game still runs with storage blocked.`
