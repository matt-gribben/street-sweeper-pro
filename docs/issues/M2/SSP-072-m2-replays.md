---
id: SSP-072
title: "Record the M2 full-shift and dump-cycle replays and commit their hashes"
milestone: M2
status: todo
type: test
estimate: M
labels: [type:test, area:test, area:sim, size:M, vertical-slice]
depends_on: [SSP-065, SSP-056, SSP-038, SSP-048]
blocks: [SSP-073, SSP-074, SSP-185, SSP-293, SSP-231, SSP-258]
---

# SSP-072: Record the M2 full-shift and dump-cycle replays and commit their hashes

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** test · **Size:** M · **Areas:** test, sim · **Vertical slice**

## Summary

Produce and commit `m2_full_shift_puddle_lane.json` and a dump-cycle replay with checkpoint hashes and invariants, generated from scripted input sequences, so sweeping, scoring and dumping are guarded by deterministic replay tests in CI.

## Context

Replay format (TECHNICAL_DESIGN §18.3): `{ format: 'ssp.replay', version: 1, district, seed, ticks, inputs: base64 RLE of InputFrame changes [tickDelta, throttle, brake, steer, buttons, pressed], checkpoints: { '600': hash, … }, invariants: { minScore, minLitterCollected } }`. `npm run test:replay` asserts the final-state hash, checkpoint hashes every 600 ticks and the invariants. Update hashes with `npm run test:replay -- --update` (state the reason).
Recording: an agent cannot play by hand, so generate inputs programmatically. Add a small scripted-input builder (e.g. `tests/replay/scripts/*.ts` run with `node`, reusing `src/sim/replay.ts` encoding) that emits InputFrame segments (throttle/steer/brush/interact for N ticks, or a simple waypoint follower that runs inside the sim headless) and writes the replay JSON. The dev panel's 'Save replay' remains the human path.
Replays (ROADMAP M2 checklist):
1. `tests/replay/replays/m2_full_shift_puddle_lane.json`: from `@`, lower the brush, sweep up Mangle Street at ≤ 4.0 m/s and continue on a loop, collecting litter, cleaning grime and building a chain. Invariants e.g. minScore ≥ 500 and minLitterCollected ≥ 20 (set from the recorded run with headroom).
2. A dump-cycle replay (`m2_dump_cycle_puddle_lane.json`): collect litter, drive to the skip or a depot bay, hold E, complete the drain. Add invariants proving the dump happened (LU dumped > 0, hopper drained; water full if depot).
Open question (doc conflict): ROADMAP lists the full-shift replay as 3,600 ticks and TECHNICAL_DESIGN §18.3 says the runner runs each replay for 3,600 ticks, but the Full shift check says 'A replay of a full 240 s shift ends on the tally scene' (14,400 ticks plus rollout and coast). Propose: the runner honours each file's `ticks`; the full-shift replay runs to the end of the shift (≈ 14,600 ticks) and asserts a new invariant `shiftEnded: true` (EV.ShiftEnd emitted); the tally scene itself is checked in e2e (flow.spec.ts / smoke.spec.ts). Document the rule in TECHNICAL_DESIGN §18.3 and the README `test:replay` row, and note it in the ROADMAP M2 measurable check.
Replay-hash policy (ROADMAP §5.3): later intentional sim changes regenerate these hashes in the same commit with a reason; unexplained changes are determinism bugs.

## Scope

- Scripted-input builder that produces replay files deterministically
- Commit the two replay files with checkpoints and invariants
- Replay runner support for per-file tick counts and new invariant fields (`shiftEnded`, LU dumped)
- Doc updates for the full-shift replay approach (TECHNICAL_DESIGN §18.3, README, ROADMAP M2 check)

## Out of scope

- SACKED/TOWED replays (M3)
- VS-3 slow/fast route replays (vertical slice gate)
- Browser-side replay checks

## Acceptance criteria

- [ ] Both replay files exist under `tests/replay/replays/` with checkpoint hashes every 600 ticks
- [ ] Re-running the scripted-input builder regenerates byte-identical replay files
- [ ] `npm run test:replay` passes and fails if a single input byte is changed
- [ ] The full-shift replay asserts the shift ended (EV.ShiftEnd TIME_UP)
- [ ] The dump-cycle replay asserts a completed dump (LU dumped > 0, hopper empty after the drain)
- [ ] Invariants include minScore ≥ 1 and minLitterCollected ≥ 20 for the full-shift replay
- [ ] TECHNICAL_DESIGN §18.3 documents the tick-count rule and new invariants

## Verification

- node tests/replay/scripts/build-m2-replays.ts && git diff --exit-code tests/replay/replays/
- npm run test:replay
- npm test
- npm run typecheck

## Dependencies

**Depends on:**

- [SSP-065](SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-056](SSP-056-puddle-lane-sweeping-content.md) Author Puddle Lane litter, grime, frontages, pledges and collectibles data
- [SSP-038](../M1/SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner
- [SSP-048](../M1/SSP-048-dev-panel.md) Add the F1 dev panel for live tuning, telemetry and Save replay

**Blocks:**

- [SSP-073](SSP-073-e2e-smoke.md) Add smoke.spec.ts: 60 s scripted sweep and full shift ending on the tally
- [SSP-074](SSP-074-close-m2.md) Close M2: verify exit criteria, record decisions and tag m2
- [SSP-185](../M5/SSP-185-m5-exit-evidence.md) Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR
- [SSP-293](../M5/SSP-293-vs-scripted-replays.md) Record the vertical-slice replays vs_slow, vs_fast and vs_practised with a waypoint route follower
- [SSP-231](../M6/SSP-231-balance-pass.md) Full-week balance pass: competent runs, £ curve, par constants and score bands
- [SSP-258](../M8/SSP-258-touch-replay.md) Add the M8 replay: a Puddle Lane drive driven by scripted touch input

## References

- ../../TECHNICAL_DESIGN.md#183-deterministic-replay-tests
- ../../ROADMAP.md#53-replay-hash-policy
- ../../ROADMAP.md#m2-sweeping-core
- ../../ROADMAP.md#52-test-and-verification-ramp
- ../../LEVEL_DESIGN.md#51-mon-puddle-lane-districtpuddle_lane-tutorial

## Roadmap tasks covered

- Replays: `m2_full_shift_puddle_lane.json` (3,600 ticks) and a dump-cycle replay. Commit their hashes.
- `Measurable check: Full shift — ... A replay of a full 240 s shift ends on the tally scene. (replay part)`
