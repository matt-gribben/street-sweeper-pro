---
id: SSP-117
title: "Extend forge verify to level and M4 outputs, prove assets idempotence, fill forge pytest gaps and add verify + lint to CI"
milestone: M4
status: todo
type: feature
estimate: M
labels: [type:feature, area:tooling, area:build, area:test, size:M, vertical-slice]
depends_on: [SSP-110, SSP-111, SSP-112, SSP-113, SSP-115, SSP-116, SSP-006, SSP-025, SSP-033, SSP-039, SSP-010, SSP-042]
blocks: [SSP-158, SSP-161, SSP-168, SSP-295, SSP-221, SSP-249, SSP-296, SSP-259, SSP-270]
---

# SSP-117: Extend forge verify to level and M4 outputs, prove assets idempotence, fill forge pytest gaps and add verify + lint to CI

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** feature · **Size:** M · **Areas:** tooling, build, test · **Vertical slice**

## Summary

SSP-010 already implements `forge verify` (temp-dir rebuild, byte and `--pixels` modes, per-file report). This issue extends it. The temp-root rebuild now covers the real level compiler output and every M4 atlas and font output. `npm run assets` is proven idempotent, and every forge subcommand gets pytest coverage. `assets:verify` and `assets:lint -- --warn-as-error` join the ubuntu-latest `checks` job. Together these close the 'Forge complete', 'Verify' and 'Lint in CI' exit checks.

## Context

Owner: SSP-010 (M0) implemented tools/forge/forge/verify.py per ASSET_PIPELINE §5.2/§5.3. It runs `forge build --out build/tmp/verify/`, then the audio and level tools with `--out` under the same temp root. It byte-compares every file in `public/assets/asset-hashes.json` plus `src/gen/assets.ts`, reports generated files that are not listed, and exits non-zero with a per-file report. With `--pixels` it decodes mismatching PNGs and compares RGBA, reporting 'pixels identical, bytes differ' (§13.5); JSON and TS are still byte-compared. Its tests cover a byte mismatch and a re-encoded PNG. Do not re-implement these. Extend them.

What changed since M0:
- The level compiler is real (SSP-033, `--out <dir>`), and compiled levels are committed under `public/assets/levels/` (SSP-042 puddle_lane.json).
- The `world` (SSP-039), `items`, `ui` (SSP-068, with `public/assets/fonts/*.json`) and `fx` atlases now exist or can exist.
- Trimming and the gutter rule landed (SSP-113).
Verify must hash and compare all of these.

Audio: `npm run assets` = `forge build && npm run audio && npm run levels`. Since SSP-006 (M0), `tools/audio/render-sfx.ts` and `render-music.ts` are input-count guards. With zero sources under `assets-src/audio/{sfx,music}` they log '0 sources; nothing to render' and exit 0. With any source present they exit non-zero with 'not implemented until M5'. Both accept `--out <dir>`. No audio sources exist before M5, so verify runs the guards honestly. They never pass silently when there is work to do, so no M5 renderer is needed here. The real renderers replace the guards in SSP-161/SSP-167, and SSP-168 adds audio outputs to the comparison under the WAV-hash rule (D-11).

CI (TECHNICAL_DESIGN §19), `checks` job on ubuntu-latest: checkout -> setup-node (Node 24.21.0) -> npm ci -> typecheck -> lint -> npm test -> test:replay -> setup uv 0.12.23 + Python 3.13.15 -> `uv sync --project tools/forge` -> `npm run assets:verify` -> `npm run assets:lint`. CI uses `forge verify --pixels` only if M0 decision D-12 (SSP-025) recorded cross-platform Pillow encoder drift. Lint runs with `--warn-as-error`, which by design leaves 're-render needed' as a warning. `npm run ci` must run the same checks locally.

'Forge complete' exit check: pytest under `tools/forge/tests/` covers each command (build, ingest, lint, sheets, verify, blender `--check`, gen-ai with mocked tools). Tests and CI never invoke Blender or Codex. Running `npm run assets` twice in a row must produce zero diff.

## Scope

- Extend verify.py (from SSP-010) so the temp-root rebuild runs the real `tools/levels/compile-level.ts --out` and compares the compiled level JSON under public/assets/levels/
- Make sure asset-hashes.json lists every file under public/assets/atlas/, public/assets/fonts/ and public/assets/levels/, and that verify still reports unlisted generated files
- Idempotence check: running `npm run assets` twice leaves no diff
- Fill the pytest gaps so every forge subcommand has a test module (Blender and Codex mocked, never invoked)
- Add verify (mode per D-12) and `assets:lint -- --warn-as-error` to `.github/workflows/ci.yml` after uv setup, and to `npm run ci`

## Out of scope

- Re-implementing the temp-dir rebuild, byte compare, --pixels decode or per-file report (SSP-010)
- Audio WAV-hash and encoded-file comparison (SSP-168, D-11); real audio renderers (SSP-161, SSP-167)
- Running Blender or image generation in CI (never)

## Acceptance criteria

- [ ] Changing one byte of public/assets/levels/puddle_lane.json (checked, then restored) makes `npm run assets:verify` exit non-zero, naming that file
- [ ] asset-hashes.json has an entry for every file under public/assets/atlas/, public/assets/fonts/ and public/assets/levels/ (pytest or script check)
- [ ] `npm run assets && npm run assets && git status --short` prints nothing
- [ ] `forge verify` invokes both audio tools and the level compiler with `--out` under `build/tmp/verify/` (pytest asserts the command lines through a mocked subprocess runner); with no audio sources the audio tools log '0 sources' and exit 0
- [ ] Adding a dummy `assets-src/audio/sfx/dummy.json` makes `npm run assets:verify` exit non-zero with the 'not implemented until M5' message (checked locally, then removed; noted in the PR)
- [ ] The `.github/workflows/ci.yml` `checks` job runs `npm run assets:verify` (or `forge verify --pixels` if D-12 says so) and `npm run assets:lint -- --warn-as-error` after setting up uv 0.12.23 / Python 3.13.15 and running `uv sync --project tools/forge`; the YAML parses
- [ ] `npm run ci` runs the same verify and lint steps and exits 0 locally
- [ ] `tools/forge/tests/` has at least one test module per subcommand: build, verify, lint, sheets, ingest, blender, gen-ai; Blender and Codex are mocked and never invoked
- [ ] SSP-010's existing verify tests (byte mismatch, 'pixels identical, bytes differ') still pass unchanged

## Verification

- uv run --project tools/forge pytest
- npm run assets && npm run assets && git status --short
- npm run assets:verify
- npm run ci

## Dependencies

**Depends on:**

- [SSP-110](SSP-110-forge-ingest-complete.md) Complete forge ingest: full 10-step pipeline, edit protection, dry-run previews
- [SSP-111](SSP-111-forge-build-procedural.md) Harden the procedural technique: generator registry, params validation, fx play frames and a shared seam metric
- [SSP-112](SSP-112-forge-build-ai-art.md) Add the ai-art build technique: crop, pixelize at detected period, palette map
- [SSP-113](SSP-113-forge-pack-atlases.md) Lock atlas trimming and the 1 px gutter, cover all five atlases and add the fill-ratio report
- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-006](../M0/SSP-006-npm-scripts-ci-workflow.md) Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow
- [SSP-025](../M0/SSP-025-pipeline-determinism-spikes.md) Measure cross-platform PNG identity and ffmpeg encode determinism (D-12, D-11)
- [SSP-033](../M1/SSP-033-level-compiler-core.md) Build level schema and compile-level.ts core: parse, legend, buildings, M1 checks
- [SSP-039](../M1/SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end
- [SSP-010](../M0/SSP-010-forge-pack-verify.md) Add deterministic atlas packing, generated assets.ts, asset-hashes.json and forge verify
- [SSP-042](../M1/SSP-042-puddle-lane-level.md) Author Puddle Lane map.txt and level.json (64×48) and commit compiled output

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-161](../M5/SSP-161-render-sfx-core.md) Implement render-sfx.ts: SFX JSON to WAV sprites, ffmpeg encodes and sfx.json
- [SSP-168](../M5/SSP-168-audio-verify-coverage.md) Wire audio into assets:verify and add SFX coverage and reference tests
- [SSP-295](../M5/SSP-295-vertical-slice-gate.md) Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR
- [SSP-221](../M6/SSP-221-art-humans-batch-b.md) Art Pass 2: final sprites for npc.lollipop_lady, npc.reveller and npc.inspector
- [SSP-249](../M7/SSP-249-credits-scene.md) Build CreditsScene with pipeline and tool-version provenance
- [SSP-296](../M7/SSP-296-ci-macos-visual-e2e.md) Bring the macos-latest visual/e2e CI job to its 1.0 shape and prove both CI jobs green
- [SSP-259](../M8/SSP-259-touch-ui-icons.md) Author 16×16 touch-control icons as text-grid UI sprites
- [SSP-270](../M9/SSP-270-desktop-app-icon.md) Author the desktop app icon as a pipeline asset and wire it into Tauri

## References

- ../../ASSET_PIPELINE.md#52-packagejson-scripts
- ../../ASSET_PIPELINE.md#53-forge-subcommands-full-reference
- ../../ASSET_PIPELINE.md#135-verify-ci
- ../../TECHNICAL_DESIGN.md#19-ci
- ../../ROADMAP.md#8-m0-spike-decision-log
- ../../ROADMAP.md#21-dependency-graph

## Roadmap tasks covered

- `npm run assets:verify`, and add it plus `assets:lint` to `.github/workflows/ci.yml`.
