---
id: SSP-065
title: "Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test"
milestone: M2
status: todo
type: feature
estimate: M
labels: [type:feature, area:sim, area:perf, area:test, size:M, vertical-slice]
depends_on: [SSP-062, SSP-063, SSP-064, SSP-060, SSP-061, SSP-035, SSP-038, SSP-049, SSP-019, SSP-027, SSP-292, SSP-046]
blocks: [SSP-066, SSP-067, SSP-070, SSP-071, SSP-072, SSP-073, SSP-078, SSP-080, SSP-106, SSP-185]
---

# SSP-065: Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** feature · **Size:** M · **Areas:** sim, perf, test · **Vertical slice**

## Summary

Fill the empty phase slots of `World.step` with the M2 systems in canonical order, allocate the new stores and run shift setup at shift start, extend the replay hash and test-hook snapshot, re-record the M1 replay hash with a stated reason, and prove the sim hot path stays allocation-free with 2,000 litter items.

## Context

Canonical tick order (TECHNICAL_DESIGN §5.2): 1 Input, 2 Vehicle (+ hopper scaling), 3 Static collision, 4 Knockables (M3, empty), 5 Brush/litter/water (`brush.ts`, `litter.ts`, `water.ts`: gutter, suction, inlet, fling, spray, collection), 6 Dirt (`dirt.ts` footprint erase, plus stain cleaning from SSP-061; dust is M3), 7 NPC (M3, empty), 8 Traffic (M3, empty), 9 Scoring/combo/complaints (`complaints.ts` empty until M3), 10 Shift timer (`shift.ts`), 11 Emit events. Changing the order changes replay hashes and must be called out in the PR.
Stores are allocated once at shift start: litter 2,000, stains 256 (TECHNICAL_DESIGN §7.1). Shift setup: spawn initial litter, init grime, full water, empty hopper.
Replay hash (TECHNICAL_DESIGN §18.3): FNV-1a 32-bit over every store field of every live entity, the grime mask, counters and the tick's event queue, floats quantised to 1e-4 (`Math.round(v * 1e4)` as Int32). Include the litter store, stain store, grime mask, hopper, water, combo, score, tidy counters and shift state.
Replay-hash policy (ROADMAP §5.3): adding litter spawning and grime changes the committed M1 hash for `tests/replay/replays/m1_drive_puddle_lane.json`. Re-record with `npm run test:replay -- --update` in this PR and say why in the commit message and PR. Any other unexplained change is a determinism bug.
Zero-allocation check (ROADMAP M2 Budget row: heap-delta test in Vitest; TECHNICAL_DESIGN §17 describes the same procedure for the replay runner): a stress world with 2,000 litter items, 600-tick warm-up, force GC, run 3,600 ticks, force GC, fail if retained heap grew beyond the threshold. Node needs `--expose-gc`: run the test in the Vitest `forks` pool with `execArgv: ['--expose-gc']` (e.g. a dedicated Vitest project or config for this file) and make the test fail loudly if `globalThis.gc` is undefined. The threshold is `TBD (M0 spike)`: use the M0 value if recorded; otherwise propose one in the PR and write it into TECHNICAL_DESIGN §17. Also log sim step time (initial target ≤ 2 ms p99 on the dev Mac) for information.
`window.__ssp.state()` (TECHNICAL_DESIGN §18.5) must report score, tidy, hopper, hp, tick, positions; add water, combo (chain, multiplier), litter collected/spawned and grime cleaned/initial for the HUD, tally and e2e, and update the §18.5 comment.

UPDATE: the heap-delta test reuses `tests/support/heapDelta.ts` and the gc-enabled Vitest configuration from SSP-292, with the threshold recorded in TECHNICAL_DESIGN §17. `__ssp.state()` and the exported SimSnapshot type are created by SSP-046 (M1); this issue adds the M2 fields to that type.

## Scope

- Phase 5, 6, 9, 10 calls in `src/sim/world.ts` in canonical order
- Shift-start allocation of new stores and shift setup
- Replay hash coverage of all new state; re-recorded M1 hash with reason
- `tests/unit/simAlloc.test.ts` heap-delta stress test with 2,000 litter, run with --expose-gc
- `__ssp.state()` snapshot fields and TECHNICAL_DESIGN §18.5 update

## Out of scope

- New replays (SSP-072)
- Phases 4, 7, 8 (M3)
- Perf spec changes in Playwright

## Acceptance criteria

- [ ] `World.step` calls phases in the documented order (unit test that records call order)
- [ ] Two runs with the same seed and input log produce identical hashes; changing one litter position by 1e-3 m changes the hash
- [ ] The M1 replay passes after a re-record whose reason is stated in the commit message
- [ ] Heap-delta test with 2,000 litter items passes the documented threshold and fails if `gc` is unavailable
- [ ] `__ssp.state()` returns score, tidy, hopper, water, hp, tick, combo and litter/grime counts in test mode
- [ ] `npm run test:replay` and `npm test` pass

## Verification

- npx vitest run tests/unit/simAlloc.test.ts  # config passes --expose-gc via forks execArgv
- npm run test:replay
- npm test
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-062](SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event
- [SSP-063](SSP-063-scoring-combo.md) Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger
- [SSP-064](SSP-064-tidy-frontages.md) Compute Tidy %, per-frontage clean % and Clean Sweep bonuses incrementally
- [SSP-060](SSP-060-grime-mask.md) Implement dirt.ts grime mask, initial selection, footprint erase and Kerb Hugger
- [SSP-061](SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats
- [SSP-035](../M1/SSP-035-world-tick-order.md) Add World, EventQueue and fixed tick order with surface grip and kerb jolts
- [SSP-038](../M1/SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner
- [SSP-049](../M1/SSP-049-m1-drive-replay.md) Record and commit the m1_drive_puddle_lane replay and its final-state hash
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-027](../M0/SSP-027-m0-exit-close.md) Verify M0 exit criteria, complete the decision log and open the Close M0 PR
- [SSP-292](../M0/SSP-292-heap-threshold-spike.md) Measure the zero-allocation heap-growth threshold and add the shared --expose-gc heap-delta helper
- [SSP-046](../M1/SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie

**Blocks:**

- [SSP-066](SSP-066-grime-ground-shader.md) Sample the grime mask in the ground shader with incremental dirty-rect uploads
- [SSP-067](SSP-067-items-sprite-batch.md) Render litter, stains and site markers via the items instance batch
- [SSP-070](SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-071](SSP-071-intro-tally-scenes.md) Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry
- [SSP-072](SSP-072-m2-replays.md) Record the M2 full-shift and dump-cycle replays and commit their hashes
- [SSP-073](SSP-073-e2e-smoke.md) Add smoke.spec.ts: 60 s scripted sweep and full shift ending on the tally
- [SSP-078](../M3/SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-080](../M3/SSP-080-npc-store-spawner.md) Add the NPC store, behaviour registry, spawner and phase 7 of the tick
- [SSP-106](../M3/SSP-106-npc-stress-budget.md) Prove the NPC budget: 80 NPCs, 30 vehicles, 2,000 litter, allocation-free
- [SSP-185](../M5/SSP-185-m5-exit-evidence.md) Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR

## References

- ../../TECHNICAL_DESIGN.md#52-fixed-tick-order
- ../../TECHNICAL_DESIGN.md#71-world-and-stores
- ../../TECHNICAL_DESIGN.md#17-performance-budgets
- ../../TECHNICAL_DESIGN.md#183-deterministic-replay-tests
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../ROADMAP.md#53-replay-hash-policy

## Roadmap tasks covered

- `Fill in tick order steps 5, 6, 9 and 10.`
- `Measurable check: Budget — LitterField stress test: 2,000 items, zero allocations per tick in the sim hot path (heap-delta test in Vitest).`
