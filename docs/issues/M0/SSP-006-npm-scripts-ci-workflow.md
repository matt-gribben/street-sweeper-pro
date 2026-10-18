---
id: SSP-006
title: "Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow"
milestone: M0
status: done
type: chore
estimate: M
labels: [type:chore, area:build, area:tooling, area:test, size:M, vertical-slice]
depends_on: [SSP-002, SSP-003, SSP-004]
blocks: [SSP-007, SSP-010, SSP-012, SSP-022, SSP-023, SSP-025, SSP-027, SSP-292, SSP-033, SSP-038, SSP-039, SSP-073, SSP-117, SSP-174, SSP-179, SSP-296, SSP-255, SSP-265]
---

# SSP-006: Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** chore · **Size:** M · **Areas:** build, tooling, test · **Vertical slice**

## Summary

Add every npm script from the README, TECHNICAL_DESIGN §20.1 and ASSET_PIPELINE §5.2 tables. Each is wired to a real implementation or to an honest stub that exits non-zero. Also add playwright.config.ts with the visual/ci/gpu projects and `.github/workflows/ci.yml`, so CI can go green once a remote exists.

## Context

Scripts:
- `dev`=vite, `build`=vite build, `preview`=vite preview
- `typecheck`=tsc --noEmit
- `lint`=biome check ., `format`=biome format --write .
- `test`=Vitest unit+property projects, `test:replay`=Vitest replay project
- `test:visual` / `test:visual:update` = Playwright tests/visual (update rewrites goldens); `test:e2e` = Playwright tests/e2e
- `assets`=`uv run --project tools/forge python -m forge build && npm run audio && npm run levels`
- `assets:verify`, `assets:lint`, `assets:sheets`, `assets:ingest`, `assets:blender` = `uv run --project tools/forge python -m forge verify|lint|sheets|ingest|blender`
- `gen:ai`=`uv run --project tools/forge python -m forge gen-ai --tool codex`
- `audio`=`node tools/audio/render-sfx.ts && node tools/audio/render-music.ts`, `levels`=`node tools/levels/compile-level.ts`
- `ci` = everything both CI jobs run, plus assets:verify and assets:lint (TECHNICAL_DESIGN §19 "Local parity")

Decisions (no longer open; record them in the PR):
(a) `audio`/`levels`: `npm run assets` must succeed in M0 (SSP-010, SSP-014 and SSP-020 all run it). So the three tools are created as input-count guards, not blanket stubs. Each enumerates its sources (`assets-src/audio/sfx/*.json`, `assets-src/audio/music/*.song.json`, `assets-src/levels/*.map.txt`). With zero sources it logs `0 sources; nothing to render` and exits 0. With any source present it exits non-zero with `not implemented until M5` (audio) or `M1` (levels). Each accepts `--out <dir>` for forge verify. This never passes silently when there is work to do. Add a one-line note to ASSET_PIPELINE §5.2.
(b) `test:replay`: a real replay project with `tests/replay/replay.test.ts`, which loads every `tests/replay/replays/*.json` (zero in M0), logs the count, and asserts the directory exists. No `--passWithNoTests`.
(c) Playwright with no specs exits non-zero ("No tests found"). Leave that honest: `test:visual`/`test:e2e`, and therefore `npm run ci`, are expected to fail until SSP-022 and SSP-023 land. Likewise assets:verify/assets:lint until forge-pack-verify/forge-lint-sheets. Do not add --pass-with-no-tests.

playwright.config.ts:
- Chromium only. `webServer`: `npm run build && npx vite preview --port 4173 --strictPort`.
- Project `visual`: headless, `--use-angle=swiftshader --enable-unsafe-swiftshader`, viewport 1920x1080 (W = 480), testDir tests/visual.
- Project `ci` (perf/e2e): the same SwiftShader flags, testDir tests/e2e.
- Project `gpu`: headed, NO SwiftShader flags, local only. Exclude it from `test:e2e` and CI by passing `--project=ci`.

ci.yml (M0 shape; the final M4+ shape is in TECHNICAL_DESIGN §19):
- Job `checks` on ubuntu-latest: checkout → actions/setup-node (24.21.0, npm cache) → npm ci → npm run typecheck → npm run lint → npm test → npm run test:replay.
- Job `visual` on macos-latest (arm64): checkout → setup-node → npm ci → npx playwright install chromium → npm run test:visual → npm run test:e2e → on failure upload test-results/ and playwright-report/.
- Triggers: push to PR branches and main. Cache Playwright browsers keyed on 1.64.1.
- assets:verify/assets:lint (and uv setup) join in **M4**, not now.
- Do not create a GitHub remote.

## Scope

- All npm scripts above in package.json
- tools/audio/render-sfx.ts, tools/audio/render-music.ts, tools/levels/compile-level.ts as input-count guards per decision (a)
- tests/replay/replay.test.ts meta-test per decision (b)
- playwright.config.ts with visual, ci and gpu projects and webServer
- .github/workflows/ci.yml with the checks and visual jobs
- One-line note in ASSET_PIPELINE §5.2 about the M0 guard behaviour

## Out of scope

- Visual specs/goldens (SSP-022)
- perf.spec.ts (SSP-023)
- Adding assets:verify/assets:lint/uv to ci.yml (M4)
- Creating a GitHub remote
- Making `npm run ci` green (SSP-027)

## Acceptance criteria

- [x] Every script named in TECHNICAL_DESIGN §20.1, ASSET_PIPELINE §5.2 and the README 'Commands' tables exists in package.json
- [x] With no sources present, `npm run audio` and `npm run levels` exit 0 and log '0 sources'; adding a dummy file under assets-src/levels/ makes `npm run levels` exit non-zero with 'not implemented until M1' (checked, then removed)
- [x] `npm run typecheck && npm run lint && npm test` exit 0
- [x] `npm run test:replay` exits 0 and logs the replay count (0)
- [x] `npx playwright test --list --project=gpu` and `--project=visual` both resolve; the gpu project config has no swiftshader flag and is not invoked by test:e2e or ci.yml
- [x] ci.yml has jobs `checks` (ubuntu-latest) and `visual` (macos-latest) with the steps listed, and parses as YAML (`ruby -ryaml -e 'YAML.load_file(".github/workflows/ci.yml")'` if ruby is available, otherwise state the inspection in the PR)
- [x] No new dependencies in package.json

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:replay
- npm run audio; echo $?
- npm run levels; echo $?
- npx playwright test --list
- cat .github/workflows/ci.yml

## Dependencies

**Depends on:**

- [SSP-002](SSP-002-node-scaffold.md) Scaffold the Node/TypeScript/Vite repo with exact pins and verify TS 7.0.2 (D-10)
- [SSP-003](SSP-003-lint-purity-ip-tests.md) Add biome.json sim-purity rules plus simPurity and ipHygiene unit tests
- [SSP-004](SSP-004-forge-skeleton-pixelize.md) Create the forge Python package (uv, CLI skeleton) and import pixelize.py with tests

**Blocks:**

- [SSP-007](SSP-007-blender-rig-wrapper.md) Implement assets-src/blender/rig.py and the forge blender wrapper with --check
- [SSP-010](SSP-010-forge-pack-verify.md) Add deterministic atlas packing, generated assets.ts, asset-hashes.json and forge verify
- [SSP-012](SSP-012-genai-codex-wrapper.md) Implement forge gen-ai Codex wrapper with preamble v1 and a concept.spike_street smoke run
- [SSP-022](SSP-022-visual-goldens.md) Add lean_quadrants and scale_1440 visual specs and goldens; prove 10-run stability (D-09)
- [SSP-023](SSP-023-perf-baseline.md) Baseline perf.spec.ts on the dev Mac GPU and set the p99 frame-time budget (D-08)
- [SSP-025](SSP-025-pipeline-determinism-spikes.md) Measure cross-platform PNG identity and ffmpeg encode determinism (D-12, D-11)
- [SSP-027](SSP-027-m0-exit-close.md) Verify M0 exit criteria, complete the decision log and open the Close M0 PR
- [SSP-292](SSP-292-heap-threshold-spike.md) Measure the zero-allocation heap-growth threshold and add the shared --expose-gc heap-delta helper
- [SSP-033](../M1/SSP-033-level-compiler-core.md) Build level schema and compile-level.ts core: parse, legend, buildings, M1 checks
- [SSP-038](../M1/SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner
- [SSP-039](../M1/SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end
- [SSP-073](../M2/SSP-073-e2e-smoke.md) Add smoke.spec.ts: 60 s scripted sweep and full shift ending on the tally
- [SSP-117](../M4/SSP-117-forge-verify-ci.md) Extend forge verify to level and M4 outputs, prove assets idempotence, fill forge pytest gaps and add verify + lint to CI
- [SSP-174](../M5/SSP-174-unlock-codec-loading.md) Add unlock.ts, Opus/AAC codec selection and boot-time audio loading
- [SSP-179](../M5/SSP-179-worklet-infra.md) Set up the AudioWorklet host that shares tools/audio/synth kernels at runtime
- [SSP-296](../M7/SSP-296-ci-macos-visual-e2e.md) Bring the macos-latest visual/e2e CI job to its 1.0 shape and prove both CI jobs green
- [SSP-255](../M8/SSP-255-phone-viewport-scaling.md) Make the canvas, viewport and integer scaling phone-ready in landscape
- [SSP-265](../M8/SSP-265-mobile-e2e-smoke.md) Add a Playwright mobile-emulation smoke drive with real touch events

## References

- ../../TECHNICAL_DESIGN.md#201-scripts
- ../../TECHNICAL_DESIGN.md#19-ci
- ../../TECHNICAL_DESIGN.md#184-visual-headless-screenshot-tests
- ../../TECHNICAL_DESIGN.md#186-e2e
- ../../TECHNICAL_DESIGN.md#183-deterministic-replay-tests
- ../../ASSET_PIPELINE.md#52-packagejson-scripts
- ../../ASSET_PIPELINE.md#51-the-command-table
- ../../../CLAUDE.md#4-commands
- ../../ROADMAP.md#m0-foundations--look-spike

## Roadmap tasks covered

- `vite.config.ts` (`base: './'`), `vitest.config.ts`, `playwright.config.ts` (Chromium; the visual and `ci` perf projects use `--use-angle=swiftshader --enable-unsafe-swiftshader`; ...) [playwright part]
- `npm scripts from the command tables in README.md, wired to real implementations or to stubs that exit non-zero with a "not implemented until Mx" message. A stub must never pass silently.`
- `.github/workflows/ci.yml`: an `ubuntu-latest` job (typecheck, lint, unit, replay) and a `macos-latest` job (Playwright). `assets:verify` and `assets:lint` join CI in M4.
