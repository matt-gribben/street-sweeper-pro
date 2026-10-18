---
id: SSP-106
title: "Prove the NPC budget: 80 NPCs, 30 vehicles, 2,000 litter, allocation-free"
milestone: M3
status: todo
type: test
estimate: M
labels: [type:test, area:perf, area:test, area:sim, size:M, vertical-slice]
depends_on: [SSP-080, SSP-091, SSP-092, SSP-093, SSP-083, SSP-087, SSP-086, SSP-088, SSP-103, SSP-023, SSP-065, SSP-292]
blocks: [SSP-109, SSP-247, SSP-267]
---

# SSP-106: Prove the NPC budget: 80 NPCs, 30 vehicles, 2,000 litter, allocation-free

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** test · **Size:** M · **Areas:** perf, test, sim · **Vertical slice**

## Summary

Add a stress fixture and tests showing that the sim tick stays allocation-free and inside the step-time budget derived from D-08 with every M3 store at capacity. This is a canonical M3 measurable check and an early warning for R-10.

## Context

M3 measurable check: a stress scene with 80 NPCs + 30 vehicles + 2,000 litter keeps the sim tick allocation-free, and its time fits the budget derived from D-08.

Zero-allocation check (TECHNICAL_DESIGN §17): with --expose-gc, after a 600-tick warm-up force GC, run 3,600 ticks, force GC, fail if retained heap grew beyond the threshold set in M0. M2 measured its LitterField budget with a heap-delta test in Vitest: reuse that exact mechanism (its Vitest project config / execArgv) rather than inventing a new runner.

Sim step time: initial target ≤ 2 ms p99 on the dev Mac; the binding number derives from D-08 (ROADMAP §8). perf.spec.ts (`ci` project) asserts draw calls and sim step time by reading `__ssp` timing counters.

Stress fixture: a synthetic compiled level or High Street with caps overridden. Every store at capacity: NPCs 80 (mixed M3 types including Doris chasing, a cat riding the roof, dog walkers, pigeon flocks), vehicles 30 (moving + parked), litter 2,000, knockables 128, hazards 64.

R-10's contingency (sim LOD, off-screen caps) is NOT to be implemented unless the budget fails: report instead.

UPDATE: the heap-delta mechanism (the `tests/support/heapDelta.ts` helper, the --expose-gc Vitest configuration and the threshold in TECHNICAL_DESIGN §17) comes from SSP-292 and is reused by SSP-065. Use it unchanged.

## Scope

- Stress fixture level and a `?test=1&scene=stress` (or equivalent) test-hook entry.
- Vitest heap-delta test with everything at capacity, using the M2 mechanism.
- Node step-time measurement, plus the perf.spec.ts `ci` assertion via __ssp counters on the stress scene.
- Record the measured p99 in the PR.

## Out of scope

- Optimisation beyond fixing allocations found.
- The GPU frame-time gate (VS and M7).

## Acceptance criteria

- [ ] The heap-delta test passes with 80 NPCs, 30 vehicles and 2,000 litter for 3,600 ticks after a 600-tick warm-up.
- [ ] Measured sim step p99 ≤ the D-08-derived budget (≤ 2 ms initial target) on the dev Mac; the number is recorded in the PR.
- [ ] perf.spec.ts (`ci`) asserts ≤ 10 draw calls and the step-time budget on the stress scene.
- [ ] Any allocation found in a per-tick path is fixed, not suppressed.

## Verification

- npm test
- npm run test:replay
- npm run test:e2e

## Dependencies

**Depends on:**

- [SSP-080](SSP-080-npc-store-spawner.md) Add the NPC store, behaviour registry, spawner and phase 7 of the tick
- [SSP-091](SSP-091-traffic-special-kinds.md) Add taxi fare stops, white van pavement parking, bicycle filtering and mobility scooter
- [SSP-092](SSP-092-knockable-bodies.md) Implement bodies.ts knockable impulse bodies with spills and penalties
- [SSP-093](SSP-093-hazards-grip-jolts.md) Implement hazard grip overrides, jolts, LU spills and the open-manhole hard stop
- [SSP-083](SSP-083-behaviour-doris.md) Implement Doris (npc.old_woman): glare, fist-shake slowdown, spray chase, handbag whack
- [SSP-087](SSP-087-behaviour-cat.md) Implement the cat: perch, dart on approach, groom, bolt, and ride Bessie's roof
- [SSP-086](SSP-086-behaviour-dog-walker.md) Implement the dog walker with a lead line obstacle, Lead Tangle and dog mess drops
- [SSP-088](SSP-088-behaviour-market-trader-pigeon.md) Implement market trader (with market close pile) and pigeon flocks with Pigeon Scatter
- [SSP-103](SSP-103-render-actors-traffic.md) Draw NPCs, animals, traffic, knockables and hazards with state-driven frames
- [SSP-023](../M0/SSP-023-perf-baseline.md) Baseline perf.spec.ts on the dev Mac GPU and set the p99 frame-time budget (D-08)
- [SSP-065](../M2/SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-292](../M0/SSP-292-heap-threshold-spike.md) Measure the zero-allocation heap-growth threshold and add the shared --expose-gc heap-delta helper

**Blocks:**

- [SSP-109](SSP-109-close-m3.md) Close M3: verify the exit criteria, sync docs, state the frozen entity list, tag m3
- [SSP-247](../M7/SSP-247-perf-stress-civic.md) Extend perf.spec.ts to Civic Quarter with the 2,000/80/30 stress load
- [SSP-267](../M8/SSP-267-mobile-perf-check.md) Measure frame time and audio memory on a mid-range phone; record M8 budget

## References

- ../../TECHNICAL_DESIGN.md#17-performance-budgets
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../TECHNICAL_DESIGN.md#186-e2e
- ../../ROADMAP.md#8-m0-spike-decision-log
- ../../ROADMAP.md#6-risk-register

## Roadmap tasks covered

- `Exit (measurable): NPC budget: Stress scene with 80 NPCs + 30 vehicles + 2,000 litter: sim tick stays allocation-free, and its time fits the budget derived from D-08.`
