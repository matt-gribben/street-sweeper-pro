---
id: SSP-079
title: "End shifts on SACKED (5 complaints) and TOWED (0 HP) with correct tally rules"
milestone: M3
status: todo
type: feature
estimate: M
labels: [type:feature, area:sim, area:gameplay, area:ui, area:test, size:M, vertical-slice]
depends_on: [SSP-078, SSP-036, SSP-062, SSP-071]
blocks: [SSP-107, SSP-108, SSP-178, SSP-187, SSP-196, SSP-237]
---

# SSP-079: End shifts on SACKED (5 complaints) and TOWED (0 HP) with correct tally rules

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** sim, gameplay, ui, test · **Vertical slice**

## Summary

Make shift.ts (phase 10) end the shift with SACKED! when complaints reach 5 and TOWED! when HP reaches 0, replacing the M1 TOWED stub. Show each end state on the tally screen with its score and star rules, and support a fast retry.

## Context

Fail states (GDD §11.3, LEVEL_DESIGN §4.1):
- SACKED!: complaints reach 5. The shift fails and you retry. Nothing from the shift is banked (proposed); the £ economy does not exist until M6, so the tally shows the failure and no stars.
- TOWED!: Bessie's Dignity reaches 0 HP. The shift ends immediately, keeps 50% of the score, earns no stars.
- Time up: 240 s = 14,400 ticks.

Phase 10 runs after phase 9 (complaints). A tick that both reaches 5 complaints and 0 HP needs a deterministic precedence; the docs do not specify one. Propose SACKED first, document it in GDD §11.3 and test it.

EV.ShiftEnd carries the reason (TimeUp | Sacked | Towed). M5 maps jng.sacked/jng.towed: no audio now.

TOWED score rounding is unspecified: use floor to an integer, record it in GDD §11.3 in the same PR, and flag it.

Tally (M2 TallyScene, numbers only) must show the end reason, Tidy %, score (50% after TOWED) and stars (none after TOWED or SACKED). After SACKED or TOWED, Try Again is the default focus and restarts the same shift in under 3 s, skipping the intro card (GDD §11.3/§15.3, TECHNICAL_DESIGN §6.2). Mercury headlines are M6.

The e2e test reaches SACKED by real input: horn spam (with the re-arm rule from SSP-078, 20 honks in quick succession give 5 Noise complaints; Puddle Lane has no litterbugs).

The deterministic replays m3_sacked.json and m3_towed.json are recorded in SSP-107.

## Scope

- shift.ts: Sacked and Towed transitions, precedence rule, EV.ShiftEnd reason, sim frozen at shift end.
- Final score rule (TOWED ×0.5, floored) and stars suppressed for TOWED and SACKED.
- TallyScene shows the end-reason title (SACKED! / TOWED! / time up) and adjusted numbers; Try Again is default focus after a fail.
- Try Again path from the tally that skips ShiftIntroScene.
- Record the precedence and rounding decisions in GDD §11.3.
- Unit tests for all transitions and score rules.

## Out of scope

- Mercury headlines and £ banking (M6).
- jng.sacked and jng.towed (M5).
- The 4-complaint Pam bark (radio panel).

## Acceptance criteria

- [ ] Unit test: reaching 5 complaints ends the shift that tick with reason Sacked, and further step() calls do not change sim state.
- [ ] Unit test: HP ≤ 0 ends the shift with reason Towed; final score = floor(0.5 × score); stars = 0 even when Tidy % ≥ 92.
- [ ] Unit test: when complaints and HP fail in the same tick, the documented precedence wins.
- [ ] The M1 stub TOWED! event is removed or replaced (grep finds no stub).
- [ ] e2e: horn spam on Puddle Lane reaches SACKED, the tally shows SACKED!, and Try Again reaches a running ShiftScene within 3 s without showing the intro card.
- [ ] GDD §11.3 records the rounding and precedence decisions.

## Verification

- npm test
- npm run test:e2e
- npm run typecheck
- npm run lint
- npm run test:replay

## Dependencies

**Depends on:**

- [SSP-078](SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-036](../M1/SSP-036-static-collision.md) Resolve Bessie against static geometry with impact damage and TOWED stub
- [SSP-062](../M2/SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event
- [SSP-071](../M2/SSP-071-intro-tally-scenes.md) Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry

**Blocks:**

- [SSP-107](SSP-107-m3-replays-determinism.md) Record SACKED and TOWED replays and add the replay-determinism property test
- [SSP-108](SSP-108-penalty-table-test.md) Add the table-driven penalty and complaint test against entities.json
- [SSP-178](../M5/SSP-178-music-player.md) Implement music.ts: sample-locked stems, loops, jingles and scene music
- [SSP-187](../M6/SSP-187-progression-economy.md) Add districts.json, upgrades.json and pure week progression and £ ledger
- [SSP-196](../M6/SSP-196-free-sweep.md) Add Free Sweep mode: untimed, no complaints, Pause -> Finish Sweep, cut-down Mercury
- [SSP-237](../M7/SSP-237-assists-sim.md) Wire auto-brush, +60 s timer, Chill Shift and instant dump into the sim

## References

- ../../GDD.md#113-fail-states
- ../../LEVEL_DESIGN.md#41-phases
- ../../TECHNICAL_DESIGN.md#52-fixed-tick-order
- ../../TECHNICAL_DESIGN.md#62-scene-flow
- ../../TECHNICAL_DESIGN.md#92-vehicle-vs-static-phase-3

## Roadmap tasks covered

- `Exit: SACKED and TOWED states`
- `src/sim/complaints.ts`: 0–5 meter, horn-spam window, SACKED at 5. (SACKED transition)
