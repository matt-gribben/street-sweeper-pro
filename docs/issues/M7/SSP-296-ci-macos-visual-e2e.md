---
id: SSP-296
title: "Bring the macos-latest visual/e2e CI job to its 1.0 shape and prove both CI jobs green"
milestone: M7
status: todo
type: chore
estimate: M
labels: [type:chore, area:build, area:test, area:tooling, area:release, size:M]
depends_on: [SSP-006, SSP-117, SSP-022, SSP-025, SSP-073, SSP-232, SSP-247]
blocks: [SSP-254, SSP-265]
---

# SSP-296: Bring the macos-latest visual/e2e CI job to its 1.0 shape and prove both CI jobs green

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** chore · **Size:** M · **Areas:** build, test, tooling, release

## Summary

SSP-006 wrote ci.yml in M0, but it has never run because no GitHub remote exists, and nothing since then has checked the macos-latest `visual` job against the M6/M7 specs. Audit the workflow against TECHNICAL_DESIGN §19, make sure `npm run test:e2e` covers every ci-project spec that exists at 1.0, and, with the lead, get a real green run of both jobs with `main` protected. Close the CI halves of D-09/D-11/D-12.

## Context

TECHNICAL_DESIGN §19, 'GitHub Actions, once a remote exists':
- `checks` (ubuntu-latest): checkout → setup-node (Node 24.21.0, npm cache) → npm ci → typecheck → lint → npm test → test:replay → setup uv 0.12.23 + Python 3.13.15 → `uv sync --project tools/forge` → assets:verify → assets:lint.
- `visual` (macos-latest, arm64): checkout → setup-node → npm ci → `npx playwright install chromium` → `npm run test:visual` → `npm run test:e2e` → on failure, upload test-results/ and playwright-report/.
- Triggers: every push to a PR branch and to main. 'main is protected: both jobs must pass.' Playwright browsers are cached under the version key 1.64.1. `npm run ci` gives local parity.

History: SSP-006 created the M0 shape, and SSP-117 added verify and lint to `checks` in M4. SSP-022 and SSP-025 left the CI halves of D-09 (same SwiftShader frame on macos-latest), D-12 (Pillow PNG identity on ubuntu) and possibly D-11 (ffmpeg determinism) pending, because there was no remote.

By M7, test:e2e includes the smoke and flow specs; the perf.spec.ts ci scenarios (Puddle Lane, Kebab Mile night, Civic Quarter stress from SSP-247); week.spec.ts (SSP-232); the VS soak and before/after specs (SSP-294); and the audio specs. The `gpu` project must never run in CI (§18.6). M8 adds a `mobile` project (SSP-265), so make the test:e2e project selection easy to extend and note how in §19.

The remote and branch protection are lead decisions. The agent never creates a GitHub remote, changes repository visibility or edits branch protection without the lead's explicit approval in this session; the lead may do those steps. If the lead decides 1.0 ships without a remote, record that decision in TECHNICAL_DESIGN §19, and SSP-254 relies on `npm run ci` alone.

R-05 contingency (SSP-022): if macos-latest frames differ from the dev-Mac goldens, keep threshold 0 and apply the documented fallback rather than loosening it.

## Scope

- Audit .github/workflows/ci.yml against TECHNICAL_DESIGN §19 and fix any drift (steps, triggers, artefact upload, Playwright cache key 1.64.1)
- Make sure `npm run test:e2e` runs every ci-project e2e spec present at M7 and never the gpu project; record the visual job's wall time
- With the lead: a real GitHub Actions run on a PR with both jobs green, and the lead enables main protection requiring `checks` and `visual`
- A throwaway-branch check that a broken golden fails `visual` and uploads the expected/actual/diff artefacts
- Record the CI halves of D-09, D-12 and (if still pending) D-11 in ROADMAP §8, and add notes to TECHNICAL_DESIGN §19

## Out of scope

- Creating the remote or changing protection without the lead's explicit approval
- The mobile Playwright project (SSP-265)
- Tauri/desktop CI jobs (M9)
- Fixing failing specs beyond CI configuration (reopen the owning issue)

## Acceptance criteria

- [ ] ci.yml has jobs `checks` (ubuntu-latest) and `visual` (macos-latest) whose steps match TECHNICAL_DESIGN §19 (step-by-step checklist in the PR), and the file parses as YAML
- [ ] `npx playwright test --list` for the CI invocation lists every tests/e2e spec except gpu-only runs, and neither ci.yml nor test:e2e invokes `--project=gpu`
- [ ] A GitHub Actions run URL on a PR shows `checks` and `visual` both green; if the lead declined a remote, TECHNICAL_DESIGN §19 records that decision instead
- [ ] If a remote exists: on a throwaway branch with one golden pixel changed, the `visual` job fails and uploads test-results/ containing expected.png, actual.png and diff.png
- [ ] ROADMAP §8 D-09 (plus D-12, and D-11 if still pending) has its CI half filled in, or explicitly marked 'no remote' by lead decision
- [ ] If a remote exists, `gh api repos/<owner>/<repo>/branches/main/protection` shows both jobs as required checks

## Verification

- npm run ci
- ruby -ryaml -e 'YAML.load_file(".github/workflows/ci.yml")'
- npx playwright test --list --project=ci
- gh run list --workflow ci.yml
- gh api repos/<owner>/<repo>/branches/main/protection

## Dependencies

**Depends on:**

- [SSP-006](../M0/SSP-006-npm-scripts-ci-workflow.md) Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow
- [SSP-117](../M4/SSP-117-forge-verify-ci.md) Extend forge verify to level and M4 outputs, prove assets idempotence, fill forge pytest gaps and add verify + lint to CI
- [SSP-022](../M0/SSP-022-visual-goldens.md) Add lean_quadrants and scale_1440 visual specs and goldens; prove 10-run stability (D-09)
- [SSP-025](../M0/SSP-025-pipeline-determinism-spikes.md) Measure cross-platform PNG identity and ffmpeg encode determinism (D-12, D-11)
- [SSP-073](../M2/SSP-073-e2e-smoke.md) Add smoke.spec.ts: 60 s scripted sweep and full shift ending on the tally
- [SSP-232](../M6/SSP-232-week-spec-e2e.md) Write tests/e2e/week.spec.ts: scripted save from Monday to the Tidy Town Trophy
- [SSP-247](SSP-247-perf-stress-civic.md) Extend perf.spec.ts to Civic Quarter with the 2,000/80/30 stress load

**Blocks:**

- [SSP-254](SSP-254-release-1-0.md) Push 1.0 to itch.io with butler and tag v1.0.0 and m7
- [SSP-265](../M8/SSP-265-mobile-e2e-smoke.md) Add a Playwright mobile-emulation smoke drive with real touch events

## References

- ../../TECHNICAL_DESIGN.md#19-ci
- ../../TECHNICAL_DESIGN.md#184-visual-headless-screenshot-tests
- ../../TECHNICAL_DESIGN.md#186-e2e
- ../../ROADMAP.md#8-m0-spike-decision-log
- ../../ROADMAP.md#m7-10-web-release
- ../../ASSET_PIPELINE.md#135-verify-ci

## Roadmap tasks covered

_None._
