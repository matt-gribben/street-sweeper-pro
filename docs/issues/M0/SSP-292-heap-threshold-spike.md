---
id: SSP-292
title: "Measure the zero-allocation heap-growth threshold and add the shared --expose-gc heap-delta helper"
milestone: M0
status: todo
type: spike
estimate: M
labels: [type:spike, area:perf, area:test, area:tooling, size:M, vertical-slice]
depends_on: [SSP-002, SSP-006]
blocks: [SSP-027, SSP-038, SSP-065, SSP-106, SSP-247]
---

# SSP-292: Measure the zero-allocation heap-growth threshold and add the shared --expose-gc heap-delta helper

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** spike · **Size:** M · **Areas:** perf, test, tooling · **Vertical slice**

## Summary

Replace the 'TBD (M0 spike)' heap-growth threshold in TECHNICAL_DESIGN §17 with a measured number. Build the reusable heap-delta helper and the gc-enabled Vitest configuration that the replay runner (SSP-038), the 2,000-litter stress test (SSP-065), the NPC stress test (SSP-106) and the Civic Quarter stress check (SSP-247) all reuse.

## Context

TECHNICAL_DESIGN §17 sets 'Sim hot-path allocations: zero per tick' and enforces it with the replay runner heap check. After a 600-tick warm-up, the runner (run with `node --expose-gc`) forces GC, runs 3,600 ticks and forces GC again. It fails if retained heap grew beyond a threshold, which is still 'TBD (M0 spike)'. No M0 issue measured it before this one: SSP-023 originally re-deferred it, and SSP-038, SSP-065 and SSP-247 each say they 'may have to set it'. This spike sets it once.

There is no sim in M0. Measure with a synthetic stand-in 'tick' that touches preallocated typed arrays sized to the §17 capacities (litter 2,000, NPCs 80, vehicles 30). It reads and writes positions and velocities with plain arithmetic and no allocation. Then measure two deliberately bad variants of the same tick:
(a) transient: allocate one small object (e.g. `{ x, y }`) per tick and drop it;
(b) retained: push one small object per tick into a module-level array.

Open technical question the spike must answer: the documented procedure measures RETAINED heap (GC before and after), so it may miss variant (a), because the final GC collects transient garbage. SSP-038's acceptance criterion requires the heap check to fail when an allocation is deliberately added inside step(). If the retained delta cannot separate (a) from the baseline, also measure the heap used just BEFORE the final GC (garbage still resident) and propose a second threshold on that. Record the outcome and update the §17 procedure text in the same PR.

Harness: Node 24 needs `--expose-gc`. Configure Vitest to run the heap tests in the forks pool with `--expose-gc` in the child's execArgv; check the exact option name against the pinned Vitest 5.0.5 docs. Either give an existing project the flag or add a dedicated project, and make sure `npm test` runs it so CI's `checks` job does too. Fail loudly if `globalThis.gc` is undefined; never skip silently. If a project is added, update the TECHNICAL_DESIGN §18 table and the §20.1 `test` row.

Threshold rule: run each variant at least 20 times. The baseline must pass every run with clear margin, and both bad variants must fail every run. Record the distributions (min, median, max bytes) in the PR and in §17.

## Scope

- tests/support/heapDelta.ts: a helper implementing the §17 procedure (600-tick warm-up, gc, N ticks, gc). It takes a step function and returns the retained delta and the pre-final-GC delta in bytes
- Vitest configuration running the heap tests under --expose-gc in the forks pool, included in `npm test`, with a loud failure when gc is unavailable
- tests/unit/heapDelta.test.ts (or similar): the synthetic allocation-free tick at §17 capacities plus the transient and retained variants, asserted against the chosen threshold(s)
- At least 20 measured runs per variant on the dev Mac, with the distributions recorded
- TECHNICAL_DESIGN §17: replace the heap 'TBD (M0 spike)' with the threshold value(s), units, run count, measurement method and helper path; adjust the procedure text if a pre-GC check is added
- If a Vitest project is added, update the TECHNICAL_DESIGN §18 table and §20.1

## Out of scope

- The replay runner and its heap check wiring (SSP-038)
- The 2,000-litter stress world (SSP-065) and the NPC/vehicle stress tests (SSP-106, SSP-247)
- perf.spec.ts, p99 frame time and the sim-step budget (SSP-023)
- Any src/sim code

## Acceptance criteria

- [ ] The heap-delta tests pass under `npm test`, and the run output shows they executed with gc available
- [ ] Running the heap test file without --expose-gc fails with an explicit message such as 'globalThis.gc is unavailable' (verified once, noted in the PR)
- [ ] The allocation-free synthetic tick passes the threshold in 20 of 20 consecutive runs
- [ ] The transient-allocation variant (one small object per tick) and the retained-allocation variant each fail the documented check in 20 of 20 runs
- [ ] TECHNICAL_DESIGN §17 no longer says 'TBD (M0 spike)' for the heap threshold, and states the value(s) in bytes, the run count, the procedure and the helper path
- [ ] npm run typecheck, npm run lint and npm test pass

## Verification

- npm test
- npx vitest run tests/unit/heapDelta.test.ts
- npm run typecheck
- npm run lint
- grep -n 'TBD (M0 spike)' docs/TECHNICAL_DESIGN.md (the heap row/paragraph must not appear)

## Dependencies

**Depends on:**

- [SSP-002](SSP-002-node-scaffold.md) Scaffold the Node/TypeScript/Vite repo with exact pins and verify TS 7.0.2 (D-10)
- [SSP-006](SSP-006-npm-scripts-ci-workflow.md) Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow

**Blocks:**

- [SSP-027](SSP-027-m0-exit-close.md) Verify M0 exit criteria, complete the decision log and open the Close M0 PR
- [SSP-038](../M1/SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner
- [SSP-065](../M2/SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-106](../M3/SSP-106-npc-stress-budget.md) Prove the NPC budget: 80 NPCs, 30 vehicles, 2,000 litter, allocation-free
- [SSP-247](../M7/SSP-247-perf-stress-civic.md) Extend perf.spec.ts to Civic Quarter with the 2,000/80/30 stress load

## References

- ../../TECHNICAL_DESIGN.md#17-performance-budgets
- ../../TECHNICAL_DESIGN.md#183-deterministic-replay-tests
- ../../TECHNICAL_DESIGN.md#18-testing-strategy
- ../../TECHNICAL_DESIGN.md#201-scripts
- ../../ROADMAP.md#8-m0-spike-decision-log

## Roadmap tasks covered

_None._
