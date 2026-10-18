---
id: SSP-237
title: "Wire auto-brush, +60 s timer, Chill Shift and instant dump into the sim"
milestone: M7
status: todo
type: feature
estimate: L
labels: [type:feature, area:sim, area:gameplay, area:test, size:L]
depends_on: [SSP-234, SSP-059, SSP-062, SSP-058, SSP-053, SSP-078, SSP-211, SSP-196, SSP-214, SSP-079, SSP-071, SSP-287]
blocks: [SSP-238, SSP-257, SSP-262, SSP-278, SSP-281]
---

# SSP-237: Wire auto-brush, +60 s timer, Chill Shift and instant dump into the sim

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** feature · **Size:** L · **Areas:** sim, gameplay, test

## Summary

Implement the three GDD §17.1 assists, plus the instant-dump option, as deterministic sim rules. They are passed to the shift as run configuration, recorded in replays, and leave existing replay hashes unchanged when off.

## Context

Assists (GDD §17.1, owner):
- Auto-brush: the brush LOWERS automatically when litter or grime lies within 6 m ahead of the brushes and speed ≤ 6.0 m/s. It RAISES automatically when nothing collectable has been within 6 m ahead for 1.5 s and throttle is held. Pressing Space still toggles manually, which suspends auto-brush for 5 s. The normal 0.5 s lowering and 0.6 s raising timings apply. Required M7 unit test: with auto-brush on, holding throttle on an empty road reaches > 10 m/s. Transit top speed is 11.0 m/s and brush-down top speed is capped at 6.0 m/s.
- +60 s timer: shift timer 300 s instead of 240 s. The timer is an integer tick count `ticksRemaining` (TECHNICAL_DESIGN §5.1), so 18,000 ticks instead of 14,400. It has no effect in Free Sweep, which has no timer.
- Chill Shift: no complaints, so no SACKED. Free Sweep already runs with no complaints (M6), so reuse that path in complaints.ts. This also covers the police-witness +1 and the Inspector's complaints. Points penalties still apply, and any penalty still resets the chain. GDD only removes complaints. This is a tunable gameplay detail, so do not block on it.
- Instant dump (access.instantDump, GDD §17.2): no 1.0 s hold for interact/dump. It changes a sim rule, so it travels the same run-config path.
Sim purity (CLAUDE §3 rules 1 and 12): src/sim must not read settings or DOM. ShiftScene passes `{ autoBrush, extraTime, chillShift, instantDump }` into the shift alongside seed and district, including on Restart Shift and Try Again. Files: src/sim/brush.ts (auto-brush), shift.ts (timer), complaints.ts (chill), hopper.ts (dump hold). Add tuning.json keys for 6 m, 1.5 s, 5 s, 300 s and the 1.0 s hold rather than hard-coding them, and mirror them in GDD. The canonical tick order (TECHNICAL_DESIGN §5.2) stays unchanged.
DECISION (record in GDD §17.1): flags are LATCHED AT SHIFT START. A change made mid-shift from Pause → Settings applies from the next shift or on Restart Shift. This keeps run = f(seed, district, run config, input log). SSP-235 shows the matching hint.
REPLAY FORMAT: the TECHNICAL_DESIGN §18.3 header has no assists field. Add an optional `assists` object that defaults to all false, so existing replays and hashes are untouched. Update §18.3 in the same change.

## Scope

- Shift run-config type with assist and instantDump flags, threaded from ShiftScene (incl. Restart Shift / Try Again) into World
- Auto-brush controller in src/sim/brush.ts with manual-override suspension
- extraTime → 18,000-tick timer in shift.ts
- chillShift → complaints suppressed in complaints.ts, no SACKED transition
- instantDump → dump with no hold in hopper.ts
- New tuning.json keys with matching GDD mirror values
- Replay header `assists` field (optional, default off), replay runner support, and the TECHNICAL_DESIGN §18.3 update
- Record the latch-at-shift-start decision in GDD §17.1
- Unit tests per assist, plus new committed replays: at least one with auto-brush and one with chillShift + extraTime

## Out of scope

- Tally stamps, the Gleaming rule and bestAssisted save fields (SSP-238)
- Settings UI (SSP-235)
- Changing any assist number from GDD §17.1

## Acceptance criteria

- [ ] Unit test: auto-brush on, throttle held on an empty road, speed exceeds 10 m/s
- [ ] Unit test: auto-brush lowers the brush when litter is 5 m ahead at ≤ 6.0 m/s, and does not when it is 7 m ahead
- [ ] Unit test: with throttle held and nothing collectable within 6 m for 1.5 s (90 ticks), auto-brush raises the brush, and not before
- [ ] Unit test: a manual brush toggle suspends auto-brush for 5 s (300 ticks)
- [ ] Unit test: extraTime gives ticksRemaining = 18,000 at shift start, and the 60 s / 30 s remaining timer events still fire
- [ ] Unit test: with chillShift, five complaint-causing offences leave complaints at 0, no SACKED transition occurs, and the points penalties still apply
- [ ] Unit test: with instantDump, a dump completes without the 1.0 s hold
- [ ] Unit test: changing settings mid-shift does not change the running shift's config
- [ ] All pre-existing replay hashes are unchanged (assists default off)
- [ ] New replays with assists on are committed and pass npm run test:replay
- [ ] simPurity test passes, and src/sim does not import settings.ts

## Verification

- npm run typecheck && npm run lint
- npm test
- npm run test:replay
- npm run test:replay -- --update only to record the NEW replays, with the reason in the commit

## Dependencies

**Depends on:**

- [SSP-234](SSP-234-settings-store.md) Implement the ssp.settings.v1 store in src/app/settings.ts with storage fallback
- [SSP-059](../M2/SSP-059-brush.md) Implement brush.ts state machine, suction, inlet collection and fling roll
- [SSP-062](../M2/SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event
- [SSP-058](../M2/SSP-058-hopper.md) Implement hopper.ts LU accounting, mass coupling and bulldozer state
- [SSP-053](../M2/SSP-053-entities-tuning-seed.md) Seed entities.json with litter, stains and pickups; add M2 values to tuning.json
- [SSP-078](../M3/SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-211](../M6/SSP-211-reveller-police.md) Implement npc.reveller, kicking_out, veh.police witness rule and police_parked
- [SSP-196](../M6/SSP-196-free-sweep.md) Add Free Sweep mode: untimed, no complaints, Pause -> Finish Sweep, cut-down Mercury
- [SSP-214](../M6/SSP-214-inspector.md) Implement npc.inspector and the inspection event with frontage deductions
- [SSP-079](../M3/SSP-079-end-states-sacked-towed.md) End shifts on SACKED (5 complaints) and TOWED (0 HP) with correct tally rules
- [SSP-071](../M2/SSP-071-intro-tally-scenes.md) Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry
- [SSP-287](../M3/SSP-287-pause-overlay.md) Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire

**Blocks:**

- [SSP-238](SSP-238-assists-tally-save.md) Flag assists on the Mercury tally and store assisted bests separately
- [SSP-257](../M8/SSP-257-touch-input-device.md) Implement src/input/touch.ts producing the same InputFrame as keyboard and pad
- [SSP-262](../M8/SSP-262-touch-menus-prompts.md) Make every menu and prompt usable by tap, with touch-aware glyphs
- [SSP-278](../M9/SSP-278-daily-shift-flow.md) Ship the Daily Shift mode: Title entry, intro card, shift, tally, local best
- [SSP-281](../M9/SSP-281-rival-sweep-flow.md) Ship the Rival Sweep mode: district pick, 180 s duel HUD, winner tally

## References

- ../../GDD.md#171-assists-m7
- ../../GDD.md#172-accessibility-features
- ../../GDD.md#113-fail-states
- ../../TECHNICAL_DESIGN.md#51-loop
- ../../TECHNICAL_DESIGN.md#52-fixed-tick-order
- ../../TECHNICAL_DESIGN.md#183-deterministic-replay-tests
- ../../ROADMAP.md#53-replay-hash-policy
- ../../../CLAUDE.md#3-hard-rules-non-negotiable

## Roadmap tasks covered

- Assists wired into `shift.ts` and `complaints.ts`, flagged on the Mercury tally. (sim wiring)
