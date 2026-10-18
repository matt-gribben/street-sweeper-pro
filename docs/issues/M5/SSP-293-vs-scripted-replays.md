---
id: SSP-293
title: "Record the vertical-slice replays vs_slow, vs_fast and vs_practised with a waypoint route follower"
milestone: M5
status: todo
type: test
estimate: L
labels: [type:test, area:test, area:tooling, area:sim, size:L, vertical-slice]
depends_on: [SSP-038, SSP-072, SSP-064, SSP-104, SSP-107, SSP-109]
blocks: [SSP-294, SSP-295, SSP-189, SSP-231]
---

# SSP-293: Record the vertical-slice replays vs_slow, vs_fast and vs_practised with a waypoint route follower

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** test · **Size:** L · **Areas:** test, tooling, sim · **Vertical slice**

## Summary

Produce the three scripted Puddle Lane replays the vertical-slice gate needs: VS-3 (`tests/replay/replays/vs_slow.json` and `vs_fast.json`) and VS-6 (a 'practised' run reaching Tidy % >= 92). Add the replay test that proves the VS-3 trade-off and the VS-6 3-star claim. The deterministic route follower built here is the mechanism SSP-189 later generalises.

## Context

ROADMAP §3.4:
- VS-3 Thorough vs. Fast: 'Two scripted replays on seed 1: a slow route (≤ 4.0 m/s) and a fast route (brush-up transit between hotspots). The slow route has higher Tidy %, the fast route covers more tiles, and neither is strictly better on score.' Proof: `tests/replay/replays/vs_slow.json`, `vs_fast.json`.
- VS-6 Difficulty: 'A practised player can reach 3★ (Tidy % ≥ 92) in Puddle Lane.' The proof includes 'a scripted "practised" replay reaching ≥ 92'. The docs give no file name, so use `tests/replay/replays/vs_practised.json` (proposed) on seed 1.

Stars (GDD §12.1): 1★ at Tidy ≥ 60, 2★ at ≥ 80, 3★ at ≥ 92. Tidy % (GDD §9.2) = 0.6 × grime cleaned/initial + 0.4 × litter collected/spawned, over the route area.

Replay format and runner (TECHNICAL_DESIGN §18.3; SSP-038): `ssp.replay` v1, checkpoints every 600 ticks, FNV-1a hash over state quantised to 1e-4. Full-shift replays follow the per-file `ticks` rule and the `shiftEnded` invariant introduced by SSP-072 (about 14,600 ticks to the end of the 240 s shift).

Mechanism: an agent cannot drive by hand. SSP-072 added a scripted-input builder (`tests/replay/scripts/*.ts`). Extend it with a closed-loop waypoint follower. A route file (e.g. `tests/replay/routes/vs_slow.route.json`) holds the district, the seed and an ordered list of waypoints, with brush up/down, a target speed, and dump/refill stops. Each tick the follower reads sim state (read-only) and emits an InputFrame, and the result is written as replay JSON. The follower lives outside src/sim, changes the sim only through InputFrame, and imports no three or DOM modules. Running it twice must produce byte-identical JSON. SSP-189 (M6) generalises this tool (loadout, mode, other districts); do not build a second mechanism.

Routes:
- vs_slow: brush down for the whole route, speed capped at 4.0 m/s (fling probability is 0 at 4.0 m/s, TECHNICAL_DESIGN §18.1). It hugs kerbs and works the frontages.
- vs_fast: brush up for transit between litter/grime hotspots at up to 11.0 m/s, brush down at each hotspot.
- vs_practised: the best route you can author, aiming for Tidy ≥ 0.92 at shift end, with 0 complaints if possible.

Metrics, computed by the replay test outside the sim:
- tiles covered: the distinct 32 px (2 m) map tiles that contain Bessie's centre at any tick;
- the maximum |v| over the run;
- the final Tidy % and score.

Add optional invariant keys `minTidy` and `maxSpeed` to the runner and document them in §18.3.

Open question for the lead: how to encode 'neither is strictly better on score'. The proposed rule is |score_slow − score_fast| ≤ 15% of the larger score. Record the agreed rule in §18.3 next to the test.

If vs_practised cannot reach 0.92 through route changes alone, do NOT change `src/data/tuning.json`, entity data or level data here. Report the best value and the attempts in the PR. The tuning loop belongs to SSP-295, run with the lead (ROADMAP §3.4: tune before producing more content).

Replay-hash policy (ROADMAP §5.3): adding replays does not change existing hashes. A later intentional sim change re-records these files in the same commit, with a reason.

## Scope

- Waypoint route follower and route-file format, extending SSP-072's scripted-input builder; deterministic and outside src/sim
- Route files and committed replays: tests/replay/replays/vs_slow.json, vs_fast.json and vs_practised.json (seed 1, district.puddle_lane, full shift)
- Runner support for the optional invariants `minTidy` and `maxSpeed`
- tests/replay/vsSlice.test.ts (Vitest replay project): asserts the VS-3 and VS-6 relations from the replays' final states
- TECHNICAL_DESIGN §18.3: route-follower usage, the new invariant keys, the tiles-covered definition and the agreed VS-3 score rule

## Out of scope

- Tuning, entity or level changes to make a route pass (the tuning loop in SSP-295)
- Other districts, loadouts and replay modes (SSP-189)
- The 20-shift soak, the perf scenario and the before/after captures (SSP-294)
- Lead playtest judgements

## Acceptance criteria

- [ ] Running the recorder twice on each route file produces byte-identical replay JSON (sha256 match)
- [ ] `npm run test:replay` passes with vs_slow.json, vs_fast.json and vs_practised.json committed, each with checkpoints every 600 ticks and `shiftEnded: true`
- [ ] vsSlice test: vs_slow's maximum |v| is ≤ 4.0 m/s, and its final Tidy % is higher than vs_fast's
- [ ] vsSlice test: vs_fast covers more distinct 2 m tiles than vs_slow and has at least one brush-up segment above 6.0 m/s
- [ ] vsSlice test: the score relation follows the lead-confirmed 'neither strictly better' rule recorded in TECHNICAL_DESIGN §18.3
- [ ] vs_practised ends with Tidy % ≥ 0.92 (asserted through `minTidy: 0.92`)
- [ ] The follower imports nothing from three, the DOM or src/render, and changes sim state only through InputFrame (import scan or simPurity-style test)
- [ ] Existing replay hashes are unchanged

## Verification

- npm run test:replay
- node tests/replay/scripts/<recorder>.ts tests/replay/routes/vs_slow.route.json run twice, then shasum -a 256 the outputs
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-038](../M1/SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner
- [SSP-072](../M2/SSP-072-m2-replays.md) Record the M2 full-shift and dump-cycle replays and commit their hashes
- [SSP-064](../M2/SSP-064-tidy-frontages.md) Compute Tidy %, per-frontage clean % and Clean Sweep bonuses incrementally
- [SSP-104](../M3/SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up
- [SSP-107](../M3/SSP-107-m3-replays-determinism.md) Record SACKED and TOWED replays and add the replay-determinism property test
- [SSP-109](../M3/SSP-109-close-m3.md) Close M3: verify the exit criteria, sync docs, state the frozen entity list, tag m3

**Blocks:**

- [SSP-294](SSP-294-vs-automated-checks.md) Automate the vertical-slice technical checks: before/after captures, Puddle Lane perf and the 20-shift soak
- [SSP-295](SSP-295-vertical-slice-gate.md) Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR
- [SSP-189](../M6/SSP-189-scripted-runs.md) Generalise scripted-run authoring for district replays, balance runs and week e2e
- [SSP-231](../M6/SSP-231-balance-pass.md) Full-week balance pass: competent runs, £ curve, par constants and score bands

## References

- ../../ROADMAP.md#34-acceptance
- ../../ROADMAP.md#53-replay-hash-policy
- ../../TECHNICAL_DESIGN.md#183-deterministic-replay-tests
- ../../TECHNICAL_DESIGN.md#181-unit-tests-examples
- ../../GDD.md#121-stars-per-district
- ../../GDD.md#92-tidy-
- ../../LEVEL_DESIGN.md#51-mon-puddle-lane-districtpuddle_lane-tutorial

## Roadmap tasks covered

- `VS-3 Thorough vs. Fast: tests/replay/replays/vs_slow.json, vs_fast.json`
- `VS-6 Difficulty: a scripted 'practised' replay reaching ≥ 92`
