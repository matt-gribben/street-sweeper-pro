---
id: SSP-023
title: "Baseline perf.spec.ts on the dev Mac GPU and set the p99 frame-time budget (D-08)"
milestone: M0
status: done
type: test
estimate: M
labels: [type:test, area:perf, area:test, size:M, vertical-slice]
depends_on: [SSP-019, SSP-006]
blocks: [SSP-027, SSP-073, SSP-106, SSP-294, SSP-210, SSP-212, SSP-247, SSP-248, SSP-260, SSP-267]
---

# SSP-023: Baseline perf.spec.ts on the dev Mac GPU and set the p99 frame-time budget (D-08)

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** test · **Size:** M · **Areas:** perf, test · **Vertical slice**

## Summary

Create `tests/e2e/perf.spec.ts` with two behaviours. The local headed `gpu` project samples rAF frame times on the spike scene and sets the p99 budget; the SwiftShader `ci` project asserts draw calls ≤ 10. Record the budget (D-08) and the production bundle size.

## Context

TECHNICAL_DESIGN §17/§18.6:
- The `ci` project (SwiftShader, same flags as visual) asserts ONLY draw calls ≤ 10 (`renderer.info.render.calls` with autoReset=false, all passes counted) and sim step time.
- The `gpu` project is headed Chromium with no SwiftShader flags, local only, never in CI. It samples frame times from requestAnimationFrame timestamps and asserts p99 against the M0-calibrated budget.
The final perf scene is dense (Kebab Mile at night, max litter); in M0, baseline the spike scene, then "add headroom for M6 content" and record the number (D-08).

The budget constant lives in `tests/e2e/perf.spec.ts` and replaces `p99 frame time: TBD (M0 spike)` in TECHNICAL_DESIGN §17 (update the doc in the same change).

Draw-call target: 9, plus 1 spare for the dev panel. City 1, building shadows 1, drop shadows 1, actors 1, items 1, fx 1, UI 1, palette pass 1, blit 1. M0 has fewer (no UI/fx).

The page needs a way to report draw calls and frame timings: add `__ssp` timing counters (§17 says perf reads `__ssp` counters), active only with ?test=1. If you add any `__ssp` member beyond the §18.5 list, document it there.

Decisions to record:
(1) There is no sim in M0, so the `ci` project's sim-step assertion and the binding sim-step number (initial target ≤ 2 ms p99 at 2,000 litter / 80 NPCs / 30 vehicles) cannot be measured. Assert draw calls only, and re-defer sim-step (and the §17 zero-allocation heap threshold) to M1/M2 explicitly in D-08 and §17.
(2) The docs give no headroom factor for M6 content. Choose one, justify it from the spike's scene complexity versus the §17 entity counts, and record it.

ADR 0001 §3.2/§4.4 lists the production bundle size as TBD (M0 spike). Record the `npm run build` dist/ size (JS gzip and total) in the D-08 evidence and the ADR 0001 §4.4 table. Perf is not a gate until the vertical slice (VS-7) and M7.

UPDATE: the §17 zero-allocation heap threshold is measured and recorded by SSP-292, not re-deferred here. Decision (1) now re-defers only the sim-step number.

## Scope

- tests/e2e/perf.spec.ts: ci behaviour (draw calls) and gpu behaviour (p99 frame time)
- ?test=1-only __ssp counters for draw calls and frame timing (documented in §18.5)
- A local gpu baseline on the dev Mac; choose the headroom; set the budget constant
- Update TECHNICAL_DESIGN §17 (p99 row; sim-step/heap explicitly re-deferred) and fill in ROADMAP §8 D-08
- Record the bundle size in D-08 and the ADR 0001 §4.4 table

## Out of scope

- smoke.spec.ts (M2)
- Sim step timing (no sim yet)
- Zero-allocation heap check (M1 replay runner)
- Heap-growth threshold measurement (SSP-292)

## Acceptance criteria

- [ ] `npm run test:e2e` (ci project, SwiftShader) passes and asserts draw calls ≤ 10 on lean_quadrants
- [ ] `npx playwright test tests/e2e/perf.spec.ts --project=gpu` runs headed locally and asserts p99 ≤ the recorded budget
- [ ] The gpu project is not run by test:e2e or ci.yml
- [ ] TECHNICAL_DESIGN §17 and ROADMAP §8 D-08 contain the same budget value, the baseline measurement (with sample count) and the headroom rationale. The sim-step threshold is explicitly re-deferred with a milestone; the heap threshold is left to SSP-292 and is not re-deferred here
- [ ] Bundle size (JS gzip + total) is recorded in D-08 and ADR 0001 §4.4

## Verification

- npm run test:e2e
- npx playwright test tests/e2e/perf.spec.ts --project=gpu
- npm run build && du -sh dist && cat dist/assets/*.js | gzip -c | wc -c

## Dependencies

**Depends on:**

- [SSP-019](SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-006](SSP-006-npm-scripts-ci-workflow.md) Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow

**Blocks:**

- [SSP-027](SSP-027-m0-exit-close.md) Verify M0 exit criteria, complete the decision log and open the Close M0 PR
- [SSP-073](../M2/SSP-073-e2e-smoke.md) Add smoke.spec.ts: 60 s scripted sweep and full shift ending on the tally
- [SSP-106](../M3/SSP-106-npc-stress-budget.md) Prove the NPC budget: 80 NPCs, 30 vehicles, 2,000 litter, allocation-free
- [SSP-294](../M5/SSP-294-vs-automated-checks.md) Automate the vertical-slice technical checks: before/after captures, Puddle Lane perf and the 20-shift soak
- [SSP-210](../M6/SSP-210-night-lighting.md) Implement night: night remap with street-lamp and headlight light mask
- [SSP-212](../M6/SSP-212-district-kebab-mile.md) Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden
- [SSP-247](../M7/SSP-247-perf-stress-civic.md) Extend perf.spec.ts to Civic Quarter with the 2,000/80/30 stress load
- [SSP-248](../M7/SSP-248-perf-optimise.md) Profile and optimise until the M7 performance budgets hold
- [SSP-260](../M8/SSP-260-touch-controls-overlay.md) Draw the touch control overlay in internal pixel space via the UI pass
- [SSP-267](../M8/SSP-267-mobile-perf-check.md) Measure frame time and audio memory on a mid-range phone; record M8 budget

## References

- ../../TECHNICAL_DESIGN.md#17-performance-budgets
- ../../TECHNICAL_DESIGN.md#186-e2e
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../ROADMAP.md#8-m0-spike-decision-log
- ../../ROADMAP.md#34-acceptance
- ../../adr/0001-tech-stack.md#44-m0-spike-decisions-this-adr-depends-on

## Roadmap tasks covered

- `tests/e2e/perf.spec.ts` baseline on the dev Mac in the local `gpu` project (headed, real GPU). Record the p99 frame time and set the budget (D-08). The `ci` project asserts only draw calls and sim step time.
- `Fill in D-01 to D-13 in §8 ... [D-08]`
