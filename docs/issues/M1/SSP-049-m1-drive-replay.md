---
id: SSP-049
title: "Record and commit the m1_drive_puddle_lane replay and its final-state hash"
milestone: M1
status: done
type: test
estimate: S
labels: [type:test, area:test, area:sim, size:S, vertical-slice]
depends_on: [SSP-038, SSP-042, SSP-036, SSP-035]
blocks: [SSP-050, SSP-065, SSP-258]
---

# SSP-049: Record and commit the m1_drive_puddle_lane replay and its final-state hash

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** test · **Size:** S · **Areas:** test, sim · **Vertical slice**

## Summary

Commit the project's first replay: `tests/replay/replays/m1_drive_puddle_lane.json`, a 3,600-tick driving loop of Puddle Lane with checkpoint and final-state hashes. `npm run test:replay` must pass on it locally and in CI. This is the canonical M1 exit proof 'First replay hash committed'.

## Context

Format (TECHNICAL_DESIGN §18.3):
- `format: 'ssp.replay'`, `version: 1`, `district: 'district.puddle_lane'`, `ticks: 3600`
- `seed`: choose one and record it (the level's campaign seed is 1001)
- `inputs`: base64 RLE
- `checkpoints`: every 600 ticks through 3600
- `invariants`: the M1 keys defined in SSP-038, including `minEvents: { Impact: 1, KerbJolt: 1, ReverseBeeper: 1 }` and `maxSolidOverlapM: 0.001`

Coverage: drive a loop of Puddle Lane (the figure-of-eight via Mangle Street, Puddle Lane and Gutter Row) that exercises:
- brush toggles (the 6.0 vs 11.0 m/s top speeds)
- at least one raised-kerb crossing
- one reverse engagement
- at least one wall or prop contact
That way the collision, damage, kerb and event paths all feed the hash.

Produce the inputs by a committed scripted input generator (preferred: reviewable and reproducible), or by recording through the dev panel's Save replay with default tuning. Say which in the PR.

Policy (ROADMAP §5.3, CLAUDE.md §7):
- A deliberate sim change re-records with `npm run test:replay -- --update` in the same commit, giving the reason.
- An unexplained hash change is a determinism bug and blocks the milestone.
- The replay must pass in Node (canonical) and on the CI ubuntu job.

## Scope

- tests/replay/replays/m1_drive_puddle_lane.json with inputs, checkpoints, final hash and invariants
- Optional committed script that generated the inputs, if scripted
- PR note: the route driven and the events exercised (counts of Impact, KerbJolt, ReverseBeeper)

## Out of scope

- Full-shift sweeping replays (M2)
- Changing sim code to make the replay pass (fix bugs in their own issue/commit, with a test)

## Acceptance criteria

- [x] `npm run test:replay` passes with the replay present, and fails if any input byte is altered (checked locally)
- [x] The replay's minEvents invariant asserts at least one EV.Impact, one EV.KerbJolt and one EV.ReverseBeeper over its 3,600 ticks
- [x] Running `npm run test:replay` 3 times gives identical results
- [x] The zero-allocation heap check passes on this replay

## Verification

- npm run test:replay
- npm run test:replay  (repeat, compare output)
- npm test

## Dependencies

**Depends on:**

- [SSP-038](SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner
- [SSP-042](SSP-042-puddle-lane-level.md) Author Puddle Lane map.txt and level.json (64×48) and commit compiled output
- [SSP-036](SSP-036-static-collision.md) Resolve Bessie against static geometry with impact damage and TOWED stub
- [SSP-035](SSP-035-world-tick-order.md) Add World, EventQueue and fixed tick order with surface grip and kerb jolts

**Blocks:**

- [SSP-050](SSP-050-m1-exit-close.md) Verify M1 exit criteria, run the lead handling playtest and open the Close M1 PR
- [SSP-065](../M2/SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-258](../M8/SSP-258-touch-replay.md) Add the M8 replay: a Puddle Lane drive driven by scripted touch input

## References

- ../../TECHNICAL_DESIGN.md#183-deterministic-replay-tests
- ../../ROADMAP.md#53-replay-hash-policy
- ../../ROADMAP.md#m1-drivable-bessie
- ../../../CLAUDE.md#7-testing-expectations

## Roadmap tasks covered

- Exit criteria: First replay hash committed. (`tests/replay/replays/m1_drive_puddle_lane.json` (3,600 ticks) and its final-state hash are committed. `npm run test:replay` passes.)
