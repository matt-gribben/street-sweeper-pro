---
id: SSP-003
title: "Add biome.json sim-purity rules plus simPurity and ipHygiene unit tests"
milestone: M0
status: done
type: test
estimate: M
labels: [type:test, area:tooling, area:test, size:M, vertical-slice]
depends_on: [SSP-002]
blocks: [SSP-006, SSP-012, SSP-028, SSP-053, SSP-150, SSP-179, SSP-252]
---

# SSP-003: Add biome.json sim-purity rules plus simPurity and ipHygiene unit tests

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** test · **Size:** M · **Areas:** tooling, test · **Vertical slice**

## Summary

Enforce hard rules 1 (sim purity) and 7 (IP hygiene) from day one. Add a Biome config with a `src/sim/**` override and two Vitest scans that fail loudly on violations and never pass vacuously.

## Context

Biome 2.5.15 formatting (TECHNICAL_DESIGN §21.4): 2-space indent, single quotes, trailing commas, 110-column lines. No Prettier or ESLint. Generated files (`src/gen/assets.ts`, `public/assets/**`) are excluded from formatting.

Override for `src/sim/**` (TECHNICAL_DESIGN §21.3 excerpt; the exact option shape follows the Biome 2.5 docs, using `includes`):
- `style.noRestrictedImports`: ban `three` and DOM-facing modules.
- `style.noRestrictedGlobals`: deny `Date`, `performance`, `window`, `document`, `requestAnimationFrame`, `setTimeout`.
Biome cannot see `Math.random` (a member access), which is why the Vitest scan exists.

`tests/unit/simPurity.test.ts` reads every .ts file under `src/sim/` (src/sim/constants.ts exists from SSP-002) and fails on:
- imports of `three` or DOM modules;
- the regex `\bMath\.random\b|\bDate\b|\bperformance\b`;
- any import outside `src/sim/` or `src/data/`, except a type-only import of `src/gen/assets.ts`.
It must fail if src/sim has no .ts files or is unreadable, so it never passes silently. Factor the scanner into a pure function and self-test it on in-memory fixture strings.

`tests/unit/ipHygiene.test.ts` fails if any of these contains a blocked trademark term:
- `assets-src/ai/**/prompt.md`;
- `assets-src/ai/_style_preamble.md`;
- `src/data/*.json`;
- asset IDs (the manifest.json `id`s, once the file exists).
CLAUDE.md names "GTA", "Grand Theft Auto" and "Paperboy" "or any other trademark, real brand or logo". Missing paths are skipped with a logged count, never silently. The retro prompt.md files from SSP-001 are in scope.

Denylist (decided shape, location proposed in the PR): ONE shared JSON list that both this TS test and the Python gen-ai wrapper read (SSP-012 refuses prompts containing these terms).
- Suggested path: `tools/ipDenylist.json`.
- It must NOT live under src/data/ or assets-src/ai/, which would make the scan flag its own list.
- Start with the three named terms plus any obvious real brands the team agrees on, and list the additions in the PR.
- Never scan docs/** (internal docs may name inspirations) or assets-src/_probe/.
- Matching: case-insensitive; whole-word for short acronyms such as GTA.

## Scope

- biome.json: formatter settings, generated-file excludes, src/sim/** override with restricted imports + globals
- tests/unit/simPurity.test.ts with fixture self-tests
- tests/unit/ipHygiene.test.ts scanning prompts, the preamble, src/data/*.json and manifest IDs
- Shared trademark denylist JSON (location proposed in the PR)
- Fix any formatting reported by `biome check .` in existing files

## Out of scope

- The Python wrapper's use of the denylist (SSP-012)
- npm scripts and CI wiring (SSP-006)

## Acceptance criteria

- [x] `npx biome check .` exits 0 on the repo
- [x] Adding `import * as THREE from 'three'` or `Date.now()` to src/sim/constants.ts makes `npx biome check .` fail (checked, then reverted)
- [x] simPurity self-tests prove the scanner fails on `Math.random()`, `performance.now()`, `new Date()`, `import x from 'three'` and `import { a } from '../render/x.ts'`, and passes `import type { FrameId } from '../gen/assets.ts'`
- [x] simPurity fails when pointed at an empty directory
- [x] ipHygiene self-tests prove that 'gta' and 'Grand Theft Auto' (any case) fail, that 'agta' does not match as a whole word, and that a clean prompt passes
- [x] The denylist file is read by the test (no inline duplicate list) and is not inside a scanned path
- [x] `npx vitest run tests/unit` exits 0 on the clean repo

## Verification

- npx biome check .
- npx vitest run tests/unit/simPurity.test.ts tests/unit/ipHygiene.test.ts
- Temporarily add `Math.random()` to src/sim/constants.ts, confirm simPurity fails, then revert

## Dependencies

**Depends on:**

- [SSP-002](SSP-002-node-scaffold.md) Scaffold the Node/TypeScript/Vite repo with exact pins and verify TS 7.0.2 (D-10)

**Blocks:**

- [SSP-006](SSP-006-npm-scripts-ci-workflow.md) Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow
- [SSP-012](SSP-012-genai-codex-wrapper.md) Implement forge gen-ai Codex wrapper with preamble v1 and a concept.spike_street smoke run
- [SSP-028](../M1/SSP-028-sim-foundations.md) Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type
- [SSP-053](../M2/SSP-053-entities-tuning-seed.md) Seed entities.json with litter, stains and pickups; add M2 values to tuning.json
- [SSP-150](../M4/SSP-150-shop-signs.md) High Street shop signs: Codex blank boards plus Kerbside lettering
- [SSP-179](../M5/SSP-179-worklet-infra.md) Set up the AudioWorklet host that shares tools/audio/synth kernels at runtime
- [SSP-252](../M7/SSP-252-content-ip-review.md) Run the PEGI 7 / ESRB E10+ content review and extend IP hygiene checks

## References

- ../../TECHNICAL_DESIGN.md#213-enforced-rules
- ../../TECHNICAL_DESIGN.md#214-style
- ../../TECHNICAL_DESIGN.md#181-unit-tests-examples
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom
- ../../../CLAUDE.md#3-hard-rules-non-negotiable
- ../../ROADMAP.md#m0-foundations--look-spike

## Roadmap tasks covered

- `biome.json` with the `noRestrictedImports` override on `src/sim/**` (bans `three` and DOM modules) and bans on the `Math.random`, `Date` and `performance` globals.
- `tests/unit/simPurity.test.ts` (as in TECHNICAL_DESIGN §18.1): scans every file under `src/sim/` and fails on imports of `three` ...
- `tests/unit/ipHygiene.test.ts`: fails if `assets-src/ai/**/prompt.md`, `_style_preamble.md`, `src/data/*.json` or asset IDs contain a blocked trademark term.
