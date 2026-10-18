---
id: SSP-275
title: "Add Daily Shift and Rival Sweep mode plumbing: params, timer, replay, save"
milestone: M9
status: todo
type: feature
estimate: M
labels: [type:feature, area:gameplay, area:sim, area:save, area:test, area:docs, size:M]
depends_on: [SSP-196, SSP-186, SSP-192, SSP-038, SSP-048]
blocks: [SSP-277, SSP-278, SSP-279, SSP-281]
---

# SSP-275: Add Daily Shift and Rival Sweep mode plumbing: params, timer, replay, save

**Milestone:** [M9 Desktop & Extra Modes](../README.md#m9) · **Type:** feature · **Size:** M · **Areas:** gameplay, sim, save, test, docs

## Summary

Extend the existing shift-mode plumbing (campaign and Free Sweep from M6) with `daily` and `rival` modes: mode-specific timer data, replay-file fields that reproduce a mode run, and additive save fields for local bests. Both mode flows then build on one foundation.

## Context

Free Sweep is already 'ShiftScene with no timer' (AUDIO_DESIGN §8.4), so a mode parameter flows through ShiftIntroScene → ShiftScene → TallyScene via SceneParams (TECHNICAL_DESIGN §6.1). Use an `as const` object plus a derived union for the mode. No `enum`, because of erasableSyntaxOnly (CLAUDE.md §5.1). The sim stays pure: the scene layer resolves mode config into plain data (timer seconds, seed, modifier list, rival on/off) before the sim starts. No Date in src/sim.

**Timer.** The 240 s shift timer is global tuning, never a level override (LEVEL_DESIGN §6.4). Compiler rule L006 rejects a campaign `timer` ≠ 240 (LEVEL_DESIGN §10.3). Rival Sweep is 180 s (GDD §13.5), so store it as mode data in tuning. Proposed: `tuning.json → modes.rival.timerS = 180`. How the +60 s assist (300 s, GDD §17.1) interacts with Rival Sweep is open. Proposed: the assist doesn't apply in Rival Sweep, recorded in GDD §13.5.

**Seeds** (LEVEL_DESIGN §9). Campaign and Free Sweep use `level.json → seed`. Daily Shift uses the UTC date `YYYYMMDD` as an integer (TECHNICAL_DESIGN §7.3).

**Replay format** (TECHNICAL_DESIGN §18.3): `{format:'ssp.replay', version:1, district, seed, ticks, inputs, checkpoints, invariants}`. Add optional `mode` (default 'campaign'), `modifiers` (modifier IDs, default []) and any rival config needed to rebuild the run. Proposal: additive optional fields keep `version: 1`, mirroring the save rule ('adding fields with defaults does not bump v'). Existing replays must parse unchanged, and their hashes must not change.

**Save** (TECHNICAL_DESIGN §16). Only the keys `ssp.save.v1` and `ssp.settings.v1` may exist. Add fields with defaults (no version bump), keep every access in try/catch, and keep hand-written structural validation (no zod). The shape is open. Proposed:
- `"daily": { "date": 20270101, "best": 0, "bestAssisted": 0, "tidyBest": 0, "allTimeBest": 0 }`
- `"rival": { "<districtId>": { "wins": 0, "losses": 0, "draws": 0, "bestLu": 0 } }`
Writes happen only at tally commit, never mid-shift.

## Scope

- Mode union and SceneParams plumbing for `daily` and `rival` through the intro, shift and tally scenes (no UI entries yet)
- Mode-level tuning data for the Rival Sweep 180 s timer, consumed by src/sim/shift.ts
- Replay file: optional `mode`, `modifiers` and rival config fields with defaults; runner and recorder support
- ssp.save.v1: additive `daily` and `rival` fields with defaults, validation and write-at-tally helpers
- Unit tests for replay defaults, save defaults and validation, and the storage-throws fallback
- Doc updates: TECHNICAL_DESIGN §16 (save example) and §18.3 (replay fields); GDD §13.5 (assist rule)

## Out of scope

- Daily seed and district/modifier selection (SSP-276)
- Modifier implementations (SSP-277)
- Sid's sim and AI (SSP-279, SSP-280)
- Title menu entries, HUD and tally variants (the flow issues)

## Acceptance criteria

- [ ] Every committed replay (M1–M7, including the per-district and Skip Run replays) passes `npm run test:replay` with no `--update` (hashes unchanged)
- [ ] A replay file without `mode`/`modifiers` loads as mode 'campaign' with no modifiers (unit test)
- [ ] The sim reads its timer from mode data: a unit test with mode 'rival' emits EV.ShiftEnd at exactly 180 × 60 = 10,800 ticks, and campaign still ends at 14,400
- [ ] Loading an ssp.save.v1 document without `daily`/`rival` fills defaults without bumping `v` (unit test)
- [ ] With a fake Storage whose methods throw, the mode save helpers fall back to in-memory state without throwing (unit test)
- [ ] tests/unit/simPurity.test.ts passes, and no Date, Math.random or performance appears in src/sim
- [ ] TECHNICAL_DESIGN §16 and §18.3 document the new fields

## Verification

- npm run typecheck && npm run lint
- npm test
- npm run test:replay

## Dependencies

**Depends on:**

- [SSP-196](../M6/SSP-196-free-sweep.md) Add Free Sweep mode: untimed, no complaints, Pause -> Finish Sweep, cut-down Mercury
- [SSP-186](../M6/SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub
- [SSP-192](../M6/SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-038](../M1/SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner
- [SSP-048](../M1/SSP-048-dev-panel.md) Add the F1 dev panel for live tuning, telemetry and Save replay

**Blocks:**

- [SSP-277](SSP-277-daily-modifiers.md) Implement Daily Shift modifiers as level knob overrides and extra events
- [SSP-278](SSP-278-daily-shift-flow.md) Ship the Daily Shift mode: Title entry, intro card, shift, tally, local best
- [SSP-279](SSP-279-rival-sweeper-sim.md) Give Spotless Sid a full sweeper in the sim: handling, brush, hopper, dumping
- [SSP-281](SSP-281-rival-sweep-flow.md) Ship the Rival Sweep mode: district pick, 180 s duel HUD, winner tally

## References

- ../../GDD.md#13-modes
- ../../GDD.md#135-rival-sweep-m9
- ../../GDD.md#171-assists-m7
- ../../TECHNICAL_DESIGN.md#61-scenemanager
- ../../TECHNICAL_DESIGN.md#16-save-data-and-settings
- ../../TECHNICAL_DESIGN.md#183-deterministic-replay-tests
- ../../LEVEL_DESIGN.md#64-difficulty-knobs
- ../../LEVEL_DESIGN.md#103-validation-rules
- ../../LEVEL_DESIGN.md#9-spawn-rules
- ../../ROADMAP.md#53-replay-hash-policy

## Roadmap tasks covered

- Daily Shift: seed = UTC date `YYYYMMDD`, random district and modifiers, local best only.
- Rival Sweep: versus `veh.rival_sweeper` (Spotless Sid), most LU dumped in 180 s. Rival AI reuses the traffic and litter systems.
