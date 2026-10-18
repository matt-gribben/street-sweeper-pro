---
id: SSP-247
title: "Extend perf.spec.ts to Civic Quarter with the 2,000/80/30 stress load"
milestone: M7
status: todo
type: test
estimate: M
labels: [type:test, area:perf, area:test, size:M]
depends_on: [SSP-023, SSP-027, SSP-106, SSP-215, SSP-292]
blocks: [SSP-248, SSP-296, SSP-267]
---

# SSP-247: Extend perf.spec.ts to Civic Quarter with the 2,000/80/30 stress load

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** test · **Size:** M · **Areas:** perf, test

## Summary

Make perf.spec.ts and the heap check measure the M7 budgets on the heaviest district: Civic Quarter, 128×96, loaded with 2,000 litter, 80 NPCs and 30 vehicles. This is the evidence harness for 'Performance budgets met'.

## Context

Budgets (TECHNICAL_DESIGN §17):
- Sim 60 Hz fixed, max 5 steps per frame.
- Store capacities: litter 2,000, NPCs 80, vehicles 30.
- Draw calls ≤ 10 per frame (9 allocated, §12.7), asserted via renderer.info with autoReset = false and reset() once per frame.
- Zero sim hot-path allocations per tick: replay runner under `node --expose-gc`, 600-tick warm-up, GC, 3,600 ticks, GC, fail if retained heap grows beyond the threshold set in M0.
- 5 atlases, each ≤ 2048².
- p99 frame time = the D-08 budget calibrated in M0 (read ROADMAP §8 and tests/e2e/perf.spec.ts).
- Sim step ≤ 2 ms p99 initial target, read from the `__ssp` timing counters. The binding number comes from M0.
Playwright projects (TECHNICAL_DESIGN §18.6):
- `ci`: SwiftShader. Asserts draw calls and sim step time only.
- `gpu`: headed Chromium, no SwiftShader flags, local only, not in CI. Asserts p99 from requestAnimationFrame timestamps.
CONFLICT, resolved: TECHNICAL_DESIGN §18.6 says perf.spec.ts drives Kebab Mile at night with max litter, while ROADMAP M7 names Civic Quarter (128×96) as the heaviest district. Run BOTH scenarios: Civic Quarter is the largest map with every NPC type, and Kebab Mile night adds light cookies. Update TECHNICAL_DESIGN §18.6 in the same change.
The M3 stress scene (80 NPCs + 30 vehicles + 2,000 litter) exists. Reuse it on district.civic_quarter via test hooks (`?test=1&seed=<n>&scene=<id>`). If a new hook parameter is needed, add it to TECHNICAL_DESIGN §18.5. The heap check runs over a replay, so commit a new Civic Quarter stress replay. Adding a replay does not change existing hashes.

UPDATE: the heap-delta threshold and helper come from SSP-292 (TECHNICAL_DESIGN §17, `tests/support/heapDelta.ts`).

## Scope

- perf.spec.ts scenario for district.civic_quarter with the full stress load, in both ci and gpu projects
- Keep or add the Kebab Mile night scenario. Update TECHNICAL_DESIGN §18.6 to describe both.
- Commit a Civic Quarter stress replay and run the zero-allocation heap check over it
- Record baseline numbers (p99, sim step p99, draw calls, heap delta) in the PR

## Out of scope

- Optimisation work (SSP-248)
- Mobile performance (M8)

## Acceptance criteria

- [ ] `npm run test:e2e` runs the Civic Quarter stress scenario in the ci project and asserts draw calls ≤ 10 and sim step time within budget
- [ ] The gpu project runs the same scenario locally and reports p99 frame time against D-08
- [ ] The stress scene really holds 2,000 litter, 80 NPCs and 30 vehicles (asserted from __ssp.state())
- [ ] The heap-delta check runs over the new Civic Quarter stress replay
- [ ] TECHNICAL_DESIGN §18.6 names both perf scenarios
- [ ] Baseline numbers are recorded in the PR. A budget may still fail at this stage; fixing it is SSP-248's job.

## Verification

- npm run test:e2e
- npx playwright test tests/e2e/perf.spec.ts --project=gpu (local, headed)
- npm run test:replay

## Dependencies

**Depends on:**

- [SSP-023](../M0/SSP-023-perf-baseline.md) Baseline perf.spec.ts on the dev Mac GPU and set the p99 frame-time budget (D-08)
- [SSP-027](../M0/SSP-027-m0-exit-close.md) Verify M0 exit criteria, complete the decision log and open the Close M0 PR
- [SSP-106](../M3/SSP-106-npc-stress-budget.md) Prove the NPC budget: 80 NPCs, 30 vehicles, 2,000 litter, allocation-free
- [SSP-215](../M6/SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-292](../M0/SSP-292-heap-threshold-spike.md) Measure the zero-allocation heap-growth threshold and add the shared --expose-gc heap-delta helper

**Blocks:**

- [SSP-248](SSP-248-perf-optimise.md) Profile and optimise until the M7 performance budgets hold
- [SSP-296](SSP-296-ci-macos-visual-e2e.md) Bring the macos-latest visual/e2e CI job to its 1.0 shape and prove both CI jobs green
- [SSP-267](../M8/SSP-267-mobile-perf-check.md) Measure frame time and audio memory on a mid-range phone; record M8 budget

## References

- ../../TECHNICAL_DESIGN.md#17-performance-budgets
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../TECHNICAL_DESIGN.md#186-e2e
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../TECHNICAL_DESIGN.md#183-deterministic-replay-tests
- ../../LEVEL_DESIGN.md#57-sun-civic-quarter-districtcivic_quarter-finale
- ../../ROADMAP.md#8-m0-spike-decision-log
- ../../ROADMAP.md#m7-10-web-release

## Roadmap tasks covered

- `Profiling and optimisation pass until budgets hold. Fix any allocation in the hot path. (measurement harness)`
- `Exit check: Budgets — perf.spec.ts on the heaviest district (Civic Quarter, 128×96) ... 2,000 litter, 80 NPCs, 30 vehicles in the stress scene.`
