---
id: SSP-189
title: "Generalise scripted-run authoring for district replays, balance runs and week e2e"
milestone: M6
status: todo
type: chore
estimate: M
labels: [type:chore, area:tooling, area:test, size:M]
depends_on: [SSP-188, SSP-038, SSP-293]
blocks: [SSP-196, SSP-198, SSP-203, SSP-204, SSP-206, SSP-209, SSP-212, SSP-215, SSP-231, SSP-232]
---

# SSP-189: Generalise scripted-run authoring for district replays, balance runs and week e2e

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** chore · **Size:** M · **Areas:** tooling, test

## Summary

M6 needs a committed 3,600-tick replay per district, 'competent' runs for the balance check, and per-district inputs for week.spec.ts. Give agents one deterministic way to produce those input logs without driving by hand, and add the replay `mode` field that later modes plug into.

## Context

Replay format and runner (TECHNICAL_DESIGN §18.3): format `ssp.replay` version 1; 3,600 ticks; checkpoint hashes every 600 ticks; invariants; FNV-1a 32-bit hash over state quantised to 1e-4. Re-record with `npm run test:replay -- --update` and explain why. The vertical slice already needed scripted replays: VS-3 `tests/replay/replays/vs_slow.json` / `vs_fast.json`, and VS-6 a 'practised' replay reaching >= 92 Tidy %. FIRST find out how those were produced and extend that mechanism; build something new only if they were hand-authored input. Proposed design if needed: a route file (district, seed, loadout, mode, ordered waypoints with brush up/down, target speeds, dump and refill stops) consumed by a deterministic waypoint-following controller. The controller reads sim state each tick, emits an InputFrame, runs in Node and writes the replay JSON. It is a test tool, so it must live outside src/sim; tools/ may import src/sim (TECHNICAL_DESIGN §2.1). Proposed paths: tools/replay/record-route.ts, with route files in tests/replay/routes/. Note the new tools/ subdirectory in TECHNICAL_DESIGN §2 in the same PR. The `loadout` field comes from SSP-188. This issue also adds an optional replay `mode` field ('shift' default | 'free_sweep' | 'skip_run') that is passed to sim init. Only 'shift' changes behaviour now: SSP-196 and SSP-198 implement the other modes, so they can depend on this tool without a cycle.

UPDATE: vs_slow.json, vs_fast.json and vs_practised.json were produced in M5 by SSP-293. That issue added a closed-loop waypoint route follower, with route files under tests/replay/routes/, by extending SSP-072's scripted-input builder in tests/replay/scripts/. Generalise that tool (loadout, mode, other districts; optionally move it to tools/replay/) rather than building a parallel one. The vs_* routes already re-express the Puddle Lane replays.

## Scope

- Audit the VS scripted-replay mechanism and document it in TECHNICAL_DESIGN §18.3
- Route-file format plus a deterministic controller that produces an input log and a replay JSON, or an extension of the existing mechanism
- Optional replay `mode` field (default 'shift'), passed through to sim init and preserved by the runner
- An npm script or documented node command that records a replay from a route file
- Re-express one existing Puddle Lane replay as a route file and show the generated replay is deterministic (two runs, identical hash)

## Out of scope

- Authoring the per-district routes (each district issue)
- Free Sweep and Skip Run behaviour (SSP-196, SSP-198)
- Balance tuning (SSP-231)

## Acceptance criteria

- [ ] Running the recorder twice on the same route file produces byte-identical replay JSON
- [ ] The generated Puddle Lane replay passes npm run test:replay
- [ ] Route files can set seed, loadout and mode, and these appear in the replay JSON
- [ ] Replays without a `mode` field run as 'shift' and keep their existing hashes
- [ ] The controller imports no three or DOM modules and changes sim state only through InputFrame
- [ ] TECHNICAL_DESIGN §18.3 documents how to author and record a scripted run

## Verification

- npm run typecheck
- npm run lint
- npm run test:replay
- node tools/replay/record-route.ts tests/replay/routes/<route>.json run twice, then compare the outputs with shasum -a 256

## Dependencies

**Depends on:**

- [SSP-188](SSP-188-upgrade-modifiers.md) Apply upg.* levels to the sim via tuning.ts modifiers and record loadout in replays
- [SSP-038](../M1/SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner
- [SSP-293](../M5/SSP-293-vs-scripted-replays.md) Record the vertical-slice replays vs_slow, vs_fast and vs_practised with a waypoint route follower

**Blocks:**

- [SSP-196](SSP-196-free-sweep.md) Add Free Sweep mode: untimed, no complaints, Pause -> Finish Sweep, cut-down Mercury
- [SSP-198](SSP-198-skip-run.md) Implement SkipRunScene: 45 s cone slalom and reverse-park bays with £5/£50 payouts
- [SSP-203](SSP-203-district-high-street-final.md) Bring district.high_street to final M6 quality with collectibles and 3-star replay
- [SSP-204](SSP-204-district-gasworks.md) Author and compile district.gasworks (Wednesday, rain) with its district replay
- [SSP-206](SSP-206-district-conker-hill.md) Author and compile district.conker_hill (Thursday, wind and leaf fall)
- [SSP-209](SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-212](SSP-212-district-kebab-mile.md) Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden
- [SSP-215](SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-231](SSP-231-balance-pass.md) Full-week balance pass: competent runs, £ curve, par constants and score bands
- [SSP-232](SSP-232-week-spec-e2e.md) Write tests/e2e/week.spec.ts: scripted save from Monday to the Tidy Town Trophy

## References

- ../../TECHNICAL_DESIGN.md#183-deterministic-replay-tests
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom
- ../../ROADMAP.md#34-acceptance
- ../../ROADMAP.md#53-replay-hash-policy

## Roadmap tasks covered

_None._
