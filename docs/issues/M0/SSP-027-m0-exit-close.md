---
id: SSP-027
title: "Verify M0 exit criteria, complete the decision log and open the Close M0 PR"
milestone: M0
status: done
type: release
estimate: M
labels: [type:release, area:release, area:docs, size:M]
depends_on: [SSP-026, SSP-022, SSP-023, SSP-025, SSP-024, SSP-012, SSP-011, SSP-006, SSP-292]
blocks: [SSP-038, SSP-050, SSP-065, SSP-247]
---

# SSP-027: Verify M0 exit criteria, complete the decision log and open the Close M0 PR

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** release · **Size:** M · **Areas:** release, docs

## Summary

Close M0 with evidence. Confirm D-01..D-13 are all filled in, resolve or explicitly re-defer every remaining `TBD (M0 spike)`, add the first in-engine screenshot to the README, run every measurable exit check, re-score the risks, and open the `Close M0: Foundations & Look Spike` PR. Tag `m0` after the lead approves.

## Context

Canonical exit criteria: repo scaffolded with pinned versions; CI green; forge, Blender and Codex wrappers working; probe artefacts imported; Kerbside-32 night and shadow tables, the scale sheet and the ref.people_style golden locked in STYLE.md; a spike scene of 1/3/6-storey blocks with the Blender Bessie and one Codex pedestrian in-engine, with palette pass, sub-pixel camera and speed zoom; decisions recorded on zoom, tilt and 480x270; headless SwiftShader visual golden passing.

Measurable checks:
- `npm ls --depth=0` matches the pin table; .npmrc has save-exact=true; uv.lock is committed; `forge blender --version` = Blender 5.2.2 LTS.
- `npm run ci` exits 0 on the dev Mac; ci.yml has the ubuntu-latest + macos-latest jobs.
- `npm run assets:blender -- veh.sweeper --check` shows zero diff; `npm run gen:ai -- concept.spike_street --candidates 1` produces a candidate + draft meta.json.
- STYLE.md v1 merged; kerbside32.json has 32 colours, ramps, night and shadow.
- `?test=1&scene=lean_quadrants` shows the blocks at four offsets with Bessie and the pedestrian.
- lean_quadrants and scale_1440 pass at threshold 0, 10 runs in a row.

Decision log (ROADMAP §8): all of D-01..D-13 need a Decision, Evidence and Date. D-11 is measured in M0 and applied in M5. Pending CI-only halves (D-09/D-11/D-12 without a remote) must be stated plainly.

Docs with M0 TBDs to resolve or re-defer (with milestone + reason). Most were already handled by the spike issues; verify each:
- TECHNICAL_DESIGN §12.2 speed-zoom flag; §17 p99, sim-step and heap thresholds; §19 ffmpeg/verify mode;
- GDD open item 7 (speed zoom);
- LEVEL_DESIGN transit view/telegraph if zoom is off (line ~722), and the light-pool radius;
- the ADR 0001 §4.4 table and its bundle-size line;
- ASSET_PIPELINE §7.2 toon thresholds and §14 timings;
- AUDIO_DESIGN A1/A2 and encoderDelaySamples;
- ART_BIBLE/ENTITY_CATALOG (SSP-026).
Also record the agreed deviations: pack.py and FRAME generation were pulled forward from M1 (SSP-010), and the audio/levels input-count guards (SSP-006). Annotate the M1 checklist accordingly.

README: the screenshot placeholder says the first in-engine image is the M0 spike scene at 480x270 through the palette pass, saved at `docs/img/m0-spike.png`. Add it (from readFrame, or a 4x nearest upscale) and replace the note. Update the README 'Status: pre-alpha, documentation only' and '(planned)' headings where now untrue, and the CLAUDE.md 'Repo status (2026-10-18): the repo is empty' line.

Risk register: re-score it at milestone close (ROADMAP §9), especially R-01, R-02, R-05, R-06, R-11, R-12 and R-14. Retired risks stay in the table with a note.

The PR title is exactly `Close M0: Foundations & Look Spike`. It ticks each criterion with a link to its evidence, and covers the §1.1 definition-of-done items, noting that there is no zoo scene until M4. Create the `m0` git tag only after the project lead approves the exit. Use Conventional Commits and the repo's commit attribution rules.

## Scope

- Run every measurable check above and record the results
- Verify or complete ROADMAP §8 D-01..D-13
- Sweep docs for `TBD (M0 spike)` and resolve or explicitly re-defer each
- Add docs/img/m0-spike.png; update the README screenshot/status text and the CLAUDE.md repo status
- Re-score the risk register
- Tick the M0 checklist in ROADMAP §4 (annotating deviations, including the M1 pack pull-forward) and open the Close M0 PR; tag m0 after lead approval

## Out of scope

- Any new feature work (file follow-up issues instead)
- Starting M1 tasks
- Creating the m0 tag before the lead approves

## Acceptance criteria

- [x] `npm run ci` exits 0 on the dev Mac (log attached to the PR)
- [x] `npm ls --depth=0` output matches the TECHNICAL_DESIGN §1.1 pins exactly
- [x] `uv run --project tools/forge python -m forge blender --version` prints Blender 5.2.2 LTS
- [x] `npm run assets:blender -- veh.sweeper --check` reports 0 changed pixels
- [x] 10 consecutive `npx playwright test tests/visual --project=visual` runs pass with identical logged hashes
- [x] ROADMAP §8 has no `TBD (M0 spike)` Decision cell among D-01..D-13
- [x] `grep -rn 'TBD (M0 spike)' docs` returns only items re-deferred with a named milestone and reason (plus legend/definition lines)
- [x] docs/img/m0-spike.png exists, was opened with Read, and the README references it; the CLAUDE.md repo-status line is updated
- [x] The risk register shows re-scored values or 'unchanged at M0 close' notes
- [x] Every M0 checklist item in ROADMAP §4 is ticked or annotated with the issue that changed it
- [x] The PR is titled `Close M0: Foundations & Look Spike` and links evidence for each exit criterion

## Verification

- npm ci && uv sync --project tools/forge && npx playwright install chromium
- npm run ci
- npm ls --depth=0
- uv run --project tools/forge python -m forge blender --version
- npm run assets:blender -- veh.sweeper --check
- npm run gen:ai -- concept.spike_street --candidates 1
- for i in $(seq 1 10); do npx playwright test tests/visual --project=visual || break; done
- grep -rn 'TBD (M0 spike)' docs
- Read docs/img/m0-spike.png

## Dependencies

**Depends on:**

- [SSP-026](SSP-026-style-lock.md) Write assets-src/STYLE.md v1 locking scale, palette and people style; mirror ART_BIBLE
- [SSP-022](SSP-022-visual-goldens.md) Add lean_quadrants and scale_1440 visual specs and goldens; prove 10-run stability (D-09)
- [SSP-023](SSP-023-perf-baseline.md) Baseline perf.spec.ts on the dev Mac GPU and set the p99 frame-time budget (D-08)
- [SSP-025](SSP-025-pipeline-determinism-spikes.md) Measure cross-platform PNG identity and ffmpeg encode determinism (D-12, D-11)
- [SSP-024](SSP-024-look-decisions.md) Decide speed zoom, vehicle tilt, 480x270 base and scale sheet (D-01, D-02, D-03, D-07)
- [SSP-012](SSP-012-genai-codex-wrapper.md) Implement forge gen-ai Codex wrapper with preamble v1 and a concept.spike_street smoke run
- [SSP-011](SSP-011-forge-lint-sheets.md) Implement minimal forge lint and forge sheets for M0 asset review
- [SSP-006](SSP-006-npm-scripts-ci-workflow.md) Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow
- [SSP-292](SSP-292-heap-threshold-spike.md) Measure the zero-allocation heap-growth threshold and add the shared --expose-gc heap-delta helper

**Blocks:**

- [SSP-038](../M1/SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner
- [SSP-050](../M1/SSP-050-m1-exit-close.md) Verify M1 exit criteria, run the lead handling playtest and open the Close M1 PR
- [SSP-065](../M2/SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-247](../M7/SSP-247-perf-stress-civic.md) Extend perf.spec.ts to Civic Quarter with the 2,000/80/30 stress load

## References

- ../../ROADMAP.md#m0-foundations--look-spike
- ../../ROADMAP.md#8-m0-spike-decision-log
- ../../ROADMAP.md#11-definition-of-done-every-task-every-milestone
- ../../ROADMAP.md#6-risk-register
- ../../ROADMAP.md#9-changing-this-roadmap
- ../../ROADMAP.md#m1-drivable-bessie
- ../../adr/0001-tech-stack.md#44-m0-spike-decisions-this-adr-depends-on
- ../../../CLAUDE.md#8-definition-of-done

## Roadmap tasks covered

- Fill in D-01 to D-13 in §8, each with evidence (screenshots under `build/`, attached to the PR and summarised in the log). [final verification of all rows]
