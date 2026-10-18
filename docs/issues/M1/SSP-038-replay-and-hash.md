---
id: SSP-038
title: "Implement replay format, quantised state hash and the npm run test:replay runner"
milestone: M1
status: todo
type: feature
estimate: M
labels: [type:feature, area:sim, area:test, area:tooling, size:M, vertical-slice]
depends_on: [SSP-035, SSP-032, SSP-002, SSP-006, SSP-027, SSP-292]
blocks: [SSP-046, SSP-048, SSP-049, SSP-057, SSP-059, SSP-060, SSP-065, SSP-072, SSP-073, SSP-080, SSP-107, SSP-293, SSP-186, SSP-188, SSP-189, SSP-258, SSP-275, SSP-282]
---

# SSP-038: Implement replay format, quantised state hash and the npm run test:replay runner

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** feature · **Size:** M · **Areas:** sim, test, tooling · **Vertical slice**

## Summary

Build `src/sim/replay.ts` (input log, RLE encoding, FNV-1a state hash over state quantised to 1e-4) and the Vitest replay project behind `npm run test:replay`. It runs every committed replay for 3,600 ticks in Node and checks checkpoint hashes, the final hash, invariants and the zero-allocation heap check.

## Context

Replay file (TECHNICAL_DESIGN §18.3), at `tests/replay/replays/<name>.json`:
- `format: 'ssp.replay'`, `version: 1`, `district`, `seed`, `ticks: 3600`
- `inputs`: base64 RLE of InputFrame changes as `[tickDelta, throttle, brake, steer, buttons, pressed]`
- `checkpoints`: a hash every 600 ticks, e.g. `{ '600': '9f1c2a7e', …, '3600': … }`
- `invariants`

Hash:
- FNV-1a 32-bit over a canonical byte stream: every store field of every live entity (M1: the vehicle state), the counters (tick), and each tick's event queue. M2 adds the grime mask.
- Floats are quantised as `Math.round(v * 1e4)` written as Int32.
- Output is 8 lowercase hex chars.

Runner (`tests/replay/replay.test.ts`, Vitest replay project):
- Loads `public/assets/levels/<district>.json` (district id `district.puddle_lane` → `puddle_lane.json`) through `decodeLevel`, creates a World with the default tuning, feeds the decoded inputs and asserts every checkpoint, the final hash and the invariants.
- Vitest fails a run with no tests, so always include at least one built-in synthetic replay case (hand-built level) alongside the committed files.
- `npm run test:replay -- --update` re-records hashes. Vitest forwards `--update` to its own CLI, and test workers cannot read argv. Suggested mechanism: in `vitest.config.ts`, compute `process.argv.includes('--update')` and pass it to the replay project via `provide`, read with `inject` in the test. It must never be the default.
- Node is the canonical replay environment (R-09 contingency).

Zero-allocation check (§17): run the replay project with `--expose-gc` (Vitest 5.0.5: `pool: 'forks'` plus top-level `execArgv`, as `GC_EXPOSED` in vitest.config.ts; `poolOptions` no longer exists). After a 600-tick warm-up, force GC, run 3,600 ticks, force GC again, and fail if retained heap grew beyond a threshold. The threshold was decided in M0 (SSP-292, TECHNICAL_DESIGN §17): retained and pre-final-GC heap growth each ≤ 32,768 B over 3,600 ticks, checked with `tests/support/heapDelta.ts` (`measureHeapDelta` + `assertHeapDeltaWithinThresholds`).

Recording: dev builds record every shift's input log (the World's phase-1 hook appends to a preallocated log). The dev panel's 'Save replay' (SSP-048 issue) serialises it through this module.

OPEN: the `invariants` schema lists only `minScore` and `minLitterCollected`, which mean nothing in M1. Propose optional M1-relevant keys and document them in TECHNICAL_DESIGN §18.3: `hpMin`, `maxSolidOverlapM` (0.001) and `minEvents` (e.g. `{ Impact: 1, KerbJolt: 1, ReverseBeeper: 1 }`, counted by the runner over the whole replay).

Policy (ROADMAP §5.3): an unexplained hash change is a determinism bug, never something to re-record.

UPDATE: use the threshold(s) recorded in TECHNICAL_DESIGN §17, together with the `tests/support/heapDelta.ts` helper and the --expose-gc Vitest configuration from SSP-292. Do not propose a new threshold. If that spike added a pre-final-GC check (needed to catch transient per-tick allocations), the runner applies it too.

## Scope

- src/sim/replay.ts: InputFrame log (preallocated, append per tick from phase 1), RLE encode/decode, base64, state hasher with 1e-4 quantisation, checkpoint capture
- tests/replay/replay.test.ts runner plus the Vitest `replay` project; `npm run test:replay` wired (replacing the M0 stub), with an explicit `--update` mode
- Built-in synthetic replay case so the project never has zero tests
- Zero-allocation heap-delta check under --expose-gc
- Invariant keys hpMin, maxSolidOverlapM, minEvents implemented in the runner
- Unit tests: RLE round trip, hash stability, quantisation (1.00004 and 1.00006 land in different quanta; 1.00004 and 1.000041 in the same), one changed input changes the hash
- Doc updates: invariants keys and the heap threshold in TECHNICAL_DESIGN §17/§18.3

## Out of scope

- Committing the first real replay: SSP-049
- Dev panel Save replay UI: SSP-048
- Browser-side replay checks

## Acceptance criteria

- [ ] Encoding then decoding a 3,600-tick random input log reproduces it exactly
- [ ] Running a synthetic replay twice in one process gives identical checkpoint and final hashes
- [ ] Changing one input on one tick changes every checkpoint from that tick on
- [ ] `npm run test:replay` exits 0 with no committed replay files (synthetic case only) and non-zero on a hash mismatch, reporting the first diverging checkpoint
- [ ] The heap check runs in `npm run test:replay` and fails when an allocation is deliberately added inside step() (verified locally, then reverted; noted in the PR)
- [ ] `--update` rewrites hashes only when explicitly passed; a plain run never writes files

## Verification

- npm run test:replay
- npm test -- replay
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-035](SSP-035-world-tick-order.md) Add World, EventQueue and fixed tick order with surface grip and kerb jolts
- [SSP-032](SSP-032-level-map-codec.md) Add src/sim/map.ts compiled-level codec, tile/surface/collide ids and solid merge
- [SSP-002](../M0/SSP-002-node-scaffold.md) Scaffold the Node/TypeScript/Vite repo with exact pins and verify TS 7.0.2 (D-10)
- [SSP-006](../M0/SSP-006-npm-scripts-ci-workflow.md) Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow
- [SSP-027](../M0/SSP-027-m0-exit-close.md) Verify M0 exit criteria, complete the decision log and open the Close M0 PR
- [SSP-292](../M0/SSP-292-heap-threshold-spike.md) Measure the zero-allocation heap-growth threshold and add the shared --expose-gc heap-delta helper

**Blocks:**

- [SSP-046](SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie
- [SSP-048](SSP-048-dev-panel.md) Add the F1 dev panel for live tuning, telemetry and Save replay
- [SSP-049](SSP-049-m1-drive-replay.md) Record and commit the m1_drive_puddle_lane replay and its final-state hash
- [SSP-057](../M2/SSP-057-litter-field.md) Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn
- [SSP-059](../M2/SSP-059-brush.md) Implement brush.ts state machine, suction, inlet collection and fling roll
- [SSP-060](../M2/SSP-060-grime-mask.md) Implement dirt.ts grime mask, initial selection, footprint erase and Kerb Hugger
- [SSP-065](../M2/SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-072](../M2/SSP-072-m2-replays.md) Record the M2 full-shift and dump-cycle replays and commit their hashes
- [SSP-073](../M2/SSP-073-e2e-smoke.md) Add smoke.spec.ts: 60 s scripted sweep and full shift ending on the tally
- [SSP-080](../M3/SSP-080-npc-store-spawner.md) Add the NPC store, behaviour registry, spawner and phase 7 of the tick
- [SSP-107](../M3/SSP-107-m3-replays-determinism.md) Record SACKED and TOWED replays and add the replay-determinism property test
- [SSP-293](../M5/SSP-293-vs-scripted-replays.md) Record the vertical-slice replays vs_slow, vs_fast and vs_practised with a waypoint route follower
- [SSP-186](../M6/SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub
- [SSP-188](../M6/SSP-188-upgrade-modifiers.md) Apply upg.* levels to the sim via tuning.ts modifiers and record loadout in replays
- [SSP-189](../M6/SSP-189-scripted-runs.md) Generalise scripted-run authoring for district replays, balance runs and week e2e
- [SSP-258](../M8/SSP-258-touch-replay.md) Add the M8 replay: a Puddle Lane drive driven by scripted touch input
- [SSP-275](../M9/SSP-275-mode-plumbing.md) Add Daily Shift and Rival Sweep mode plumbing: params, timer, replay, save
- [SSP-282](../M9/SSP-282-mode-replays.md) Commit deterministic replays for Daily Shift (pinned date) and Rival Sweep

## References

- ../../TECHNICAL_DESIGN.md#183-deterministic-replay-tests
- ../../TECHNICAL_DESIGN.md#17-performance-budgets
- ../../TECHNICAL_DESIGN.md#74-determinism
- ../../ROADMAP.md#53-replay-hash-policy
- ../../ROADMAP.md#6-risk-register

## Roadmap tasks covered

- `src/sim/replay.ts`: input log format, state hash quantised to 1e-4.
