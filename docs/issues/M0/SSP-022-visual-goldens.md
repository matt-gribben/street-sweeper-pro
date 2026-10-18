---
id: SSP-022
title: "Add lean_quadrants and scale_1440 visual specs and goldens; prove 10-run stability (D-09)"
milestone: M0
status: todo
type: test
estimate: M
labels: [type:test, area:test, area:render, size:M, vertical-slice]
depends_on: [SSP-019, SSP-020, SSP-006, SSP-021]
blocks: [SSP-024, SSP-027, SSP-039, SSP-043, SSP-045, SSP-297, SSP-066, SSP-118, SSP-145, SSP-253, SSP-296, SSP-255, SSP-265]
---

# SSP-022: Add lean_quadrants and scale_1440 visual specs and goldens; prove 10-run stability (D-09)

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** test · **Size:** M · **Areas:** test, render · **Vertical slice**

## Summary

Write Playwright visual specs for `lean_quadrants` (readFrame vs golden, pixelmatch threshold 0) and `scale_1440` (a 2560x1440 page screenshot for letterboxing). Commit dev-Mac goldens after Read review, prove 10 consecutive byte-identical runs, and record D-09.

## Context

Spec flow (TECHNICAL_DESIGN §18.4):
- Chromium headless with `--use-angle=swiftshader --enable-unsafe-swiftshader`, viewport 1920x1080 (W = 480).
- Open `/?test=1&seed=1&scene=lean_quadrants&freeze=1`, wait for `__ssp.ready`, call `__ssp.readFrame()` (Wx270 palette-mapped RGBA), encode with pngjs 7.0.0 and compare with pixelmatch 8.0.0 at **threshold 0** against `tests/visual/__goldens__/lean_quadrants.png`.
- `scale_1440`: a 2560x1440 PAGE screenshot (deviceScaleFactor 1) compared at threshold 0 to `__goldens__/scale_1440.png`. Also assert 5x scale: a 1350 px tall image area with 45 px #0f0e12 bars top and bottom.
- On failure write expected.png, actual.png and diff.png to test-results/; Claude opens all three with Read before deciding.
- `npm run test:visual:update` approves only after reading the diffs, with a one-line reason in the commit.
Canonical goldens come from the dev Mac (arm64, Playwright 1.64.1 Chromium, SwiftShader flags). Never lower the threshold or skip a test to get green.

Types: pngjs 7.0.0 ships no TypeScript types. Do NOT add @types/pngjs (no new dependencies without a request). Add a minimal local declaration (e.g. `tests/types/pngjs.d.ts`) covering only what the helper uses. Check whether pixelmatch 8.0.0 bundles its own types and do the same if it does not.

This issue runs after SSP-021, so the goldens include the tuned shadow table. If D-02 later approves 8° or another look decision changes the scene, SSP-024 re-approves them.

Exit criterion: "`lean_quadrants` and `scale_1440` pass at threshold 0, 10 runs in a row with byte-identical frames (determinism check for D-09)". Prove it with 10 SEPARATE Playwright invocations (fresh browser each), logging the SHA-256 of each readFrame buffer/screenshot. `--repeat-each=10` within one process is supplementary.

D-09 also asks for "same frame on macos-latest once a remote exists". No remote exists: record the local result and mark the CI half pending (or run it if a remote has appeared). R-05 contingency if frames differ: keep threshold 0 but compare palette INDICES rather than RGB; last resort is a pinned self-hosted Mac.

## Scope

- tests/visual/lean_quadrants.spec.ts and tests/visual/scale_1440.spec.ts
- Shared helper: readFrame → PNG → pixelmatch with failure artefacts and a SHA-256 log line
- Minimal local type declarations where packages lack types
- Goldens in tests/visual/__goldens__/ after Read review
- A 10-invocation stability loop with hashes logged
- Fill in ROADMAP §8 D-09

## Out of scope

- zoo and hud_specimen goldens (M4)
- Running on macos-latest without a remote
- perf.spec.ts (SSP-023)

## Acceptance criteria

- [ ] `npm run test:visual` passes on the dev Mac at pixelmatch threshold 0
- [ ] 10 separate invocations of both specs pass, and the logged SHA-256 is identical across all 10 runs for each spec
- [ ] scale_1440 asserts 5x scale and 45 px #0f0e12 letterbox bars
- [ ] The goldens were opened with Read before commit, and the commit message describes what they show
- [ ] A deliberate 1 px scene change makes lean_quadrants fail and writes expected/actual/diff PNGs, which were Read (checked, then reverted)
- [ ] No new package in package.json
- [ ] ROADMAP §8 D-09 has a Decision, Evidence (flags, hashes) and Date, with CI parity marked pending if there is no remote

## Verification

- npx playwright install chromium
- npm run test:visual
- for i in $(seq 1 10); do npx playwright test tests/visual --project=visual || break; done (hashes in the output)
- Read tests/visual/__goldens__/lean_quadrants.png and scale_1440.png

## Dependencies

**Depends on:**

- [SSP-019](SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-020](SSP-020-lamp-post-stack.md) Prototype a 4-slice sprite-stack lamp post and add it to lean_quadrants (D-02 input)
- [SSP-006](SSP-006-npm-scripts-ci-workflow.md) Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow
- [SSP-021](SSP-021-night-shadow-tuning.md) Tune night[32] and shadow[32] remap tables in the spike scene (D-05, D-06)

**Blocks:**

- [SSP-024](SSP-024-look-decisions.md) Decide speed zoom, vehicle tilt, 480x270 base and scale sheet (D-01, D-02, D-03, D-07)
- [SSP-027](SSP-027-m0-exit-close.md) Verify M0 exit criteria, complete the decision log and open the Close M0 PR
- [SSP-039](../M1/SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end
- [SSP-043](../M1/SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-045](../M1/SSP-045-render-ground-city.md) Render compiled levels: chunked ground layer and full cityMesh cell merge
- [SSP-297](../M1/SSP-297-r8-index-atlases-swap-texture.md) Convert actors/items atlases to R8 index textures with an identity 32x8 swap texture
- [SSP-066](../M2/SSP-066-grime-ground-shader.md) Sample the grime mask in the ground shader with incremental dirty-rect uploads
- [SSP-118](../M4/SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-145](../M4/SSP-145-hud-specimen-golden.md) Build the hud_specimen scene and commit its visual golden
- [SSP-253](../M7/SSP-253-browser-scaling-qa.md) Run cross-browser, scaling and storage-blocked verification for 1.0
- [SSP-296](../M7/SSP-296-ci-macos-visual-e2e.md) Bring the macos-latest visual/e2e CI job to its 1.0 shape and prove both CI jobs green
- [SSP-255](../M8/SSP-255-phone-viewport-scaling.md) Make the canvas, viewport and integer scaling phone-ready in landscape
- [SSP-265](../M8/SSP-265-mobile-e2e-smoke.md) Add a Playwright mobile-emulation smoke drive with real touch events

## References

- ../../TECHNICAL_DESIGN.md#184-visual-headless-screenshot-tests
- ../../TECHNICAL_DESIGN.md#121-internal-resolution-and-scaling
- ../../ROADMAP.md#m0-foundations--look-spike
- ../../ROADMAP.md#6-risk-register
- ../../ROADMAP.md#8-m0-spike-decision-log
- ../../../CLAUDE.md#7-testing-expectations

## Roadmap tasks covered

- Visual specs and goldens for `lean_quadrants` and `scale_1440`.
- `Fill in D-01 to D-13 in §8 ... [D-09]`
