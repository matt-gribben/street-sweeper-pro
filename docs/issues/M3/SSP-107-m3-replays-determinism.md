---
id: SSP-107
title: "Record SACKED and TOWED replays and add the replay-determinism property test"
milestone: M3
status: todo
type: test
estimate: M
labels: [type:test, area:test, area:sim, size:M, vertical-slice]
depends_on: [SSP-079, SSP-104, SSP-038]
blocks: [SSP-109, SSP-293, SSP-294]
---

# SSP-107: Record SACKED and TOWED replays and add the replay-determinism property test

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** test · **Size:** M · **Areas:** test, sim · **Vertical slice**

## Summary

Commit m3_sacked.json and m3_towed.json, which reach their end states deterministically on Puddle Lane, add a fast-check property that replaying any input log on any seed yields the same state hash, and complete the tick-order test for phases 1–11.

## Context

Measurable checks (ROADMAP M3):
- Replays m3_sacked.json and m3_towed.json reach SACKED and TOWED deterministically. TOWED keeps 50% of the score and awards no stars.
- fast-check property: for any seed and random input log, replaying the same log yields the same state hash.

Replay format (TECHNICAL_DESIGN §18.3): {format: 'ssp.replay', version 1, district, seed, ticks, inputs (base64 RLE), checkpoints every 600 ticks, invariants}. Hash: FNV-1a 32-bit over every store field of every live entity, the grime mask, counters and the tick's event queue, floats quantised to 1e-4. Re-record with `npm run test:replay -- --update` and explain why.

Recording: an agent cannot drive the dev panel's Save replay. Generate the input logs with a small committed script (e.g. tests/replay/scripts/) that builds the InputFrame sequence and encodes it with src/sim/replay.ts.
- SACKED: horn spam is the most robust route (Puddle Lane has no litterbugs; with the re-arm rule, 20 honks in quick succession give 5 Noise complaints). Optionally add a real hit.
- TOWED: repeated wall or lamp-post impacts (4 HP per m/s above 2 m/s; 6 m/s = 16 HP, so 7 hits).
- Invariants assert the end reason, TOWED final score = floor(0.5 × score) and stars = 0.
- Replays end at the end state, so `ticks` may be less than 3,600: make the runner support early shift end if it does not, and document it in TECHNICAL_DESIGN §18.3.

Determinism property: random seed and random InputFrame sequence (600–1,200 ticks to keep CI fast), two fresh Worlds, compare the 600-tick checkpoint and final hashes.

Tick-order test: tests/unit/tickOrder.test.ts (created/extended by earlier issues) now asserts all phases 1–11 in canonical order (TECHNICAL_DESIGN §5.2).

## Scope

- Input-generation script, tests/replay/replays/m3_sacked.json and m3_towed.json with end-state invariants.
- Early-ending replay support in the runner if needed, documented.
- tests/property/determinism.prop.test.ts.
- Complete tests/unit/tickOrder.test.ts for phases 1–11.
- Re-record any other drifted hashes with reasons.

## Out of scope

- Cross-engine replays (R-09 contingency).
- Per-district M6 replays.

## Acceptance criteria

- [ ] `npm run test:replay` passes: m3_sacked ends with reason Sacked and m3_towed with reason Towed, at the same tick every run, with stars 0 and the TOWED score halved (floored).
- [ ] The determinism property runs ≥ 100 cases per CI execution and passes.
- [ ] The tick-order test fails if phase 4, 7 or 8 is removed or reordered.
- [ ] Every hash change in the PR has a stated reason.

## Verification

- npm run test:replay
- npm test
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-079](SSP-079-end-states-sacked-towed.md) End shifts on SACKED (5 complaints) and TOWED (0 HP) with correct tally rules
- [SSP-104](SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up
- [SSP-038](../M1/SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner

**Blocks:**

- [SSP-109](SSP-109-close-m3.md) Close M3: verify the exit criteria, sync docs, state the frozen entity list, tag m3
- [SSP-293](../M5/SSP-293-vs-scripted-replays.md) Record the vertical-slice replays vs_slow, vs_fast and vs_practised with a waypoint route follower
- [SSP-294](../M5/SSP-294-vs-automated-checks.md) Automate the vertical-slice technical checks: before/after captures, Puddle Lane perf and the 20-shift soak

## References

- ../../TECHNICAL_DESIGN.md#183-deterministic-replay-tests
- ../../TECHNICAL_DESIGN.md#182-property-tests
- ../../TECHNICAL_DESIGN.md#52-fixed-tick-order
- ../../ROADMAP.md#53-replay-hash-policy
- ../../GDD.md#113-fail-states

## Roadmap tasks covered

- Exit (measurable): End states: Replays `m3_sacked.json` and `m3_towed.json` reach SACKED and TOWED deterministically.
- `Exit (measurable): Determinism: fast-check property: for any seed and random input log, replaying the same log yields the same state hash.`
- `Fill in tick order steps 4, 7 and 8. (verification)`
