---
id: SSP-282
title: "Commit deterministic replays for Daily Shift (pinned date) and Rival Sweep"
milestone: M9
status: todo
type: test
estimate: S
labels: [type:test, area:test, area:sim, size:S]
depends_on: [SSP-278, SSP-281, SSP-038]
blocks: [SSP-283]
---

# SSP-282: Commit deterministic replays for Daily Shift (pinned date) and Rival Sweep

**Milestone:** [M9 Desktop & Extra Modes](../README.md#m9) · **Type:** test · **Size:** S · **Areas:** test, sim

## Summary

Record and commit replays that put both M9 modes under the replay tripwire. The Daily Shift replay pins a fixed date seed with its resolved district and modifiers. The Rival Sweep replay covers Sid's AI through a full 180 s duel.

## Context

ROADMAP M9: 'Replays for both modes. The Daily Shift replay pins a fixed date seed.' The milestone proof column (ROADMAP §2) says 'mode replays'.

**Format** (TECHNICAL_DESIGN §18.3): `tests/replay/replays/<name>.json`. The hash is FNV-1a 32-bit over every live store field, the grime mask, counters and each tick's event queue, with floats quantised to 1e-4. Checkpoints every 600 ticks, plus invariants. The file gains `mode`/`modifiers` fields from SSP-275.

**Length.** TECHNICAL_DESIGN §18.3 and CLAUDE.md §4.2 currently say the runner runs each replay for **3,600 ticks**, even though the file has a `ticks` field. The rival replay needs 10,800 ticks. Make the runner honour `ticks` (default 3,600) if it doesn't already, and update the wording in TECHNICAL_DESIGN §18.3 and CLAUDE.md §4.2. The zero-allocation heap check (TECHNICAL_DESIGN §17) keeps its 3,600-tick window.

**Naming.** Follow the existing milestone-prefixed convention (`m1_drive_puddle_lane.json`, `m2_full_shift_puddle_lane.json`, `m3_sacked.json`).
- `m9_daily_20270101.json`: mode 'daily', seed 20270101, with the district and modifiers that `pickDaily` resolves for a fixed unlocked set recorded explicitly. 3,600 ticks. Invariants e.g. `minScore ≥ 1`, plus a modifier invariant such as the initial litter count under Bin Strike.
- `m9_rival_puddle_lane.json`: mode 'rival', seed 1, 10,800 ticks (the full 180 s, so the winner and Sid's dumps are covered). Invariants e.g. Sid `luDumped > 0`, and the player's `minLitterCollected`.

**Recording.** Record inputs with the dev panel's 'Save replay'. Re-record only with `npm run test:replay -- --update` and a reason in the PR (ROADMAP §5.3). Replays run in Node, the canonical environment (R-09).

## Scope

- Make the replay runner honour the file's `ticks` (default 3,600) and update TECHNICAL_DESIGN §18.3 and CLAUDE.md §4.2 wording
- Record and commit `m9_daily_20270101.json` with a pinned date seed and explicit district/modifiers
- Record and commit the full-length `m9_rival_puddle_lane.json`
- Invariants for both, as described
- Make sure the runner reconstructs mode, modifiers and Sid from the file alone

## Out of scope

- Browser-side replay checks
- Re-recording unrelated campaign replays

## Acceptance criteria

- [ ] tests/replay/replays/ contains `m9_daily_20270101.json` with `seed: 20270101` and explicit `district` and `modifiers`, and `m9_rival_puddle_lane.json` with `ticks: 10800`
- [ ] `npm run test:replay` passes and asserts final and checkpoint hashes and invariants for both, and the rival replay really runs 10,800 ticks (its last checkpoint key is 10800)
- [ ] Running each new replay twice in one process gives identical hashes (determinism test)
- [ ] The daily replay doesn't depend on the current date or the local save: it passes with a mocked clock on a different date and an empty save
- [ ] Every pre-existing replay still passes without --update, and the heap check still passes

## Verification

- npm run test:replay
- npm test

## Dependencies

**Depends on:**

- [SSP-278](SSP-278-daily-shift-flow.md) Ship the Daily Shift mode: Title entry, intro card, shift, tally, local best
- [SSP-281](SSP-281-rival-sweep-flow.md) Ship the Rival Sweep mode: district pick, 180 s duel HUD, winner tally
- [SSP-038](../M1/SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner

**Blocks:**

- [SSP-283](SSP-283-m9-release-close.md) Publish desktop builds and both modes on itch.io, then close M9

## References

- ../../TECHNICAL_DESIGN.md#183-deterministic-replay-tests
- ../../TECHNICAL_DESIGN.md#17-performance-budgets
- ../../ROADMAP.md#53-replay-hash-policy
- ../../ROADMAP.md#m9-desktop--extra-modes
- ../../ROADMAP.md#6-risk-register

## Roadmap tasks covered

- `Replays for both modes. The Daily Shift replay pins a fixed date seed.`
