---
id: SSP-002
title: "Scaffold the Node/TypeScript/Vite repo with exact pins and verify TS 7.0.2 (D-10)"
milestone: M0
status: todo
type: chore
estimate: M
labels: [type:chore, area:build, area:tooling, size:M, vertical-slice]
depends_on: []
blocks: [SSP-003, SSP-006, SSP-015, SSP-292, SSP-028, SSP-029, SSP-032, SSP-033, SSP-038, SSP-157, SSP-159, SSP-160, SSP-179, SSP-266]
---

# SSP-002: Scaffold the Node/TypeScript/Vite repo with exact pins and verify TS 7.0.2 (D-10)

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** chore · **Size:** M · **Areas:** build, tooling · **Vertical slice**

## Summary

Create the JS/TS foundation: package.json with exact pins, the lockfile, tsconfig, Vite and Vitest configs, the canonical .gitignore, .nvmrc/.npmrc, a minimal index.html + src/main.ts and a tiny src/sim/constants.ts. Prove that TypeScript 7.0.2 works with tsc, Vite, Vitest and Biome, and that Node 24 type stripping runs a tool importing src/sim. Record the result as D-10.

## Context

Exact pins, written without ^ or ~:
- `dependencies`: three 0.186.1 (runtime).
- `devDependencies`: @types/three 0.186.0, vite 8.3.4, vitest 5.0.5, fast-check 4.10.2, @playwright/test 1.64.1, pixelmatch 8.0.0, pngjs 7.0.0, @biomejs/biome 2.5.15, typescript 7.0.2, @types/node 24.19.2.
- That is 11 packages in total. Node 24.21.0 / npm 11.19.0.
- `.nvmrc` = `24.21.0`. `.npmrc` contains `save-exact=true`.
- Use npm only (Bun is installed but must not be used). package-lock.json is the only lockfile.
- Do NOT install jsfxr 1.4.1 (added in M5) or zzfx (never installed; its buildSamples is vendored in M5).
- Do not add @types/pngjs or any other package: missing types are handled with a local .d.ts where needed (see SSP-022).
- Set `"type": "module"` in package.json so .ts files are ESM under nodenext and under Node type stripping (an implementation necessity; note it in the PR).

tsconfig.json (one project covering src/, tools/ and tests/; TECHNICAL_DESIGN §21.1):
- strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes, erasableSyntaxOnly, verbatimModuleSyntax, resolveJsonModule, noEmit, allowImportingTsExtensions, module/moduleResolution "nodenext".
- Relative imports carry explicit `.ts` extensions everywhere.
- No enum, namespace or parameter properties: use `as const` plus a derived union. Named exports only, no barrels.
- JSON imports use `with { type: 'json' }`.

vite.config.ts (§20.2): `base: './'`, output dist/, `define` `__SSP_VERSION__` (package.json version) and `__SSP_COMMIT__` (short git SHA). vitest.config.ts: `unit` (tests/unit/*.test.ts) and `property` (tests/property/*.prop.test.ts) projects, plus a separate `replay` project (tests/replay/).

.gitignore must be EXACTLY these six lines (ROADMAP + TECHNICAL_DESIGN §2): `node_modules/`, `dist/`, `build/`, `test-results/`, `playwright-report/`, `tools/forge/.venv/`. The current .gitignore from the first commit does NOT match: it has `node_modules/ dist/ .DS_Store *.log .env .env.*`. Replace it. If you believe .DS_Store or .env should stay ignored, update TECHNICAL_DESIGN §2 and ROADMAP first in the same change and say why; do not silently diverge.

Type-stripping proof (decided, no longer open): create `src/sim/constants.ts`, which M1 extends, with only documented values: `SIM_HZ = 60`, `DT_S = 1 / SIM_HZ` and `MAX_STEPS_PER_FRAME = 5` (TECHNICAL_DESIGN §2/§17). Add `tools/check-type-strip.ts`, which imports `../src/sim/constants.ts` and prints the values; `node tools/check-type-strip.ts` must run with no tsx. This also gives SSP-003 a non-empty src/sim to scan.

D-10: if tsc, Vite, Vitest or Biome breaks on TS 7.0.2, pin typescript 6.0.3. Record what broke in ROADMAP §8 D-10 (Decision, Evidence, Date). If you fall back, update the pin owners and mirrors in the same change: TECHNICAL_DESIGN §1.1, ADR 0001 §2.3, README.

## Scope

- package.json (three in dependencies, 10 devDependencies, type module, minimal scripts needed to run the tools) + package-lock.json via npm install --save-exact
- .nvmrc (24.21.0) and .npmrc (save-exact=true)
- tsconfig.json per TECHNICAL_DESIGN §21.1
- vite.config.ts and vitest.config.ts (unit, property and replay projects)
- index.html + src/main.ts (blank canvas is fine)
- Replace .gitignore with the exact canonical six lines
- src/sim/constants.ts (SIM_HZ, DT_S, MAX_STEPS_PER_FRAME) and tools/check-type-strip.ts
- One trivial unit test (e.g. tests/unit/constants.test.ts asserting DT_S = 1/60)
- Run tsc, vite build, vitest and biome on TS 7.0.2; fall back to 6.0.3 if needed; fill in D-10
- vite.config.ts `define` for __SSP_VERSION__ (the package.json version) and __SSP_COMMIT__ (the short git SHA from `git rev-parse --short HEAD` at config time, with a documented fallback such as 'unknown' when git is unavailable), shared with vitest.config.ts
- A global declaration file (e.g. src/globals.d.ts) typing both constants as string

## Out of scope

- biome.json rules and the purity/IP tests (SSP-003)
- The full npm script table, playwright.config.ts and the CI workflow (SSP-006)
- Renderer code
- jsfxr/zzfx

## Acceptance criteria

- [ ] `npm ls --depth=0` lists exactly the 11 pinned packages at the pinned versions and nothing else
- [ ] `grep -E '"[~^]' package.json` prints nothing
- [ ] `npx tsc --noEmit` exits 0
- [ ] `npx vite build` produces dist/ whose index.html references assets with relative ./ URLs
- [ ] `npx vitest run` exits 0 with at least one real test (no --passWithNoTests)
- [ ] `node tools/check-type-strip.ts` runs on plain Node 24.21.0 and prints values imported from src/sim/constants.ts
- [ ] `npx biome --version` reports 2.5.15 and `npx biome check .` runs (formatting failures may be fixed in SSP-003)
- [ ] .gitignore is byte-for-byte the six canonical lines, or the docs were updated first with a stated reason
- [ ] ROADMAP §8 D-10 has a Decision (7.0.2 or 6.0.3), Evidence and Date
- [ ] After `npx vite build`, the dist JS contains the package.json version string and the current short SHA (grep check)
- [ ] `npx tsc --noEmit` passes with src/main.ts referencing both constants, and a Vitest test can read them

## Verification

- npm ci
- npm ls --depth=0
- grep -E '"[~^]' package.json (expect no output)
- npx tsc --noEmit
- npx vite build
- npx vitest run
- npx biome --version
- node tools/check-type-strip.ts
- cat .gitignore

## Dependencies

**Depends on:**

_None._

**Blocks:**

- [SSP-003](SSP-003-lint-purity-ip-tests.md) Add biome.json sim-purity rules plus simPurity and ipHygiene unit tests
- [SSP-006](SSP-006-npm-scripts-ci-workflow.md) Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow
- [SSP-015](SSP-015-render-core-camera-upscale.md) Build the renderer skeleton: perspective camera, sub-pixel snap, upscale and speed zoom
- [SSP-292](SSP-292-heap-threshold-spike.md) Measure the zero-allocation heap-growth threshold and add the shared --expose-gc heap-delta helper
- [SSP-028](../M1/SSP-028-sim-foundations.md) Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type
- [SSP-029](../M1/SSP-029-tuning-data.md) Create tuning.json vehicle.sweeper block and typed src/sim/tuning.ts
- [SSP-032](../M1/SSP-032-level-map-codec.md) Add src/sim/map.ts compiled-level codec, tile/surface/collide ids and solid merge
- [SSP-033](../M1/SSP-033-level-compiler-core.md) Build level schema and compile-level.ts core: parse, legend, buildings, M1 checks
- [SSP-038](../M1/SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner
- [SSP-157](../M4/SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art
- [SSP-159](../M5/SSP-159-audio-deps-zzfx-vendor.md) Pin jsfxr 1.4.1, vendor ZzFX buildSamples with seeded RNG, add WAV writer
- [SSP-160](../M5/SSP-160-dsp-kernels.md) Build the shared DSP kernels in tools/audio/synth (oscillators, filters, envelopes, FM)
- [SSP-179](../M5/SSP-179-worklet-infra.md) Set up the AudioWorklet host that shares tools/audio/synth kernels at runtime
- [SSP-266](../M8/SSP-266-ios-device-verification.md) Verify audio unlock, background resume and layout on a real iPhone

## References

- ../../ROADMAP.md#m0-foundations--look-spike
- ../../ROADMAP.md#8-m0-spike-decision-log
- ../../TECHNICAL_DESIGN.md#11-versions-exact-pins-verified-2026-10-18
- ../../TECHNICAL_DESIGN.md#12-stack-wide-consequences
- ../../TECHNICAL_DESIGN.md#2-directory-layout
- ../../TECHNICAL_DESIGN.md#202-vite-configuration
- ../../TECHNICAL_DESIGN.md#211-typescript
- ../../TECHNICAL_DESIGN.md#5-game-loop-and-fixed-timestep
- ../../adr/0001-tech-stack.md#23-pinned-versions-verified-2026-10-18
- ../../../CLAUDE.md#51-typescript

## Roadmap tasks covered

- `package.json` with exact pins for `three` 0.186.1, `@types/three` 0.186.0, `vite` 8.3.4, `vitest` 5.0.5, `fast-check` 4.10.2, ... Also `.nvmrc` = `24.21.0`.
- `jsfxr` 1.4.1 is added in M5, not now (nothing uses it yet). `zzfx` is never installed ...
- `tsconfig.json` (one project for `src/`, `tools/`, `tests/`): strict, `erasableSyntaxOnly: true`, `noEmit`, ... Confirm that `node tools/...ts` runs through native type stripping, including a tool that imports `src/sim`.
- `Verify TypeScript 7.0.2 with Vite, Vitest and Biome. Fall back to 6.0.3 if any tool breaks, and record the outcome in D-10.`
- `vite.config.ts` (`base: './'`), `vitest.config.ts`, `playwright.config.ts` ... [vite + vitest parts]
- `.gitignore` exactly: `node_modules/`, `dist/`, `build/`, `test-results/`, `playwright-report/`, `tools/forge/.venv/`.
