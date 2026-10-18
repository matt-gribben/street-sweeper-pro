---
id: SSP-078
title: "Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter"
milestone: M3
status: todo
type: feature
estimate: M
labels: [type:feature, area:sim, area:gameplay, area:ui, area:test, size:M, vertical-slice]
depends_on: [SSP-075, SSP-063, SSP-070, SSP-069, SSP-028, SSP-044, SSP-043, SSP-065, SSP-046]
blocks: [SSP-079, SSP-082, SSP-089, SSP-092, SSP-094, SSP-095, SSP-288, SSP-289, SSP-290, SSP-156, SSP-176, SSP-187, SSP-188, SSP-196, SSP-199, SSP-211, SSP-237, SSP-241, SSP-242]
---

# SSP-078: Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** sim, gameplay, ui, test · **Vertical slice**

## Summary

Create src/sim/complaints.ts (a 0–5 meter that never decays) with the horn-spam rule, and one penalty API that every M3 offence uses: it deducts points, adds complaints and resets the combo chain. Emit horn events from input and show the complaints meter on the HUD.

## Context

Two currencies of failure (GDD §11.1): points penalties (−10 to −500, which reset the chain) and Council Complaints (0–5 per shift, never decaying; 5 = SACKED).

Penalty facts are appended during phases 4–8 and consumed in phase 9 (scoring/combo/complaints) of the fixed tick order (TECHNICAL_DESIGN §5.2). Any penalty resets the combo chain; M2 left a hook for this in combo.ts. Each complaint emits EV.Complaint with a reason code (Hit, Noise, RoadRage, Zebra, Splash, Tangle, ...). Audio maps it to sfx.complaint_stamp in M5.

Horn:
- The InputFrame `pressed` bit HORN (key H, pad B) is consumed in the tick whose frame carries the edge; that same tick emits EV.Horn {x, y, radius}.
- Radius 8 m, or 12 m with upg.two_tone_horn (upgrade arrives in M6; read it through a tuning modifier).
- Horn spam: more than 3 honks in any 5 s window (300 ticks) = 1 complaint (Noise). Threshold 5 with the two-tone horn. Proposal (flag in PR): after a Noise complaint the honk window is cleared, so the next Noise complaint needs another 4 honks within 5 s.
- A honk that lands a litterbug Caught! is not counted. Count honks in phase 9, after phase 7 has had the chance to mark the honk as Caught (expose a hook/flag the litterbug behaviour sets).
- Delivering the horn stimulus to NPCs is SSP-082's job.

Police witness (+1 extra complaint within 15 m of veh.police) is tested in M6: leave a no-op hook that takes the penalty position.

HUD (GDD §15.2): top-right, five empty stamp boxes. Each complaint slams in a red COMPLAINT stamp with a 2-frame shake; at 4 complaints the meter shakes. UI reads sim state and never writes it. Use the M2 Kerbside 5×7 draft font and placeholder art.

Zero allocations per tick: use a preallocated ring for honk ticks.

UPDATE: `__ssp.state()` and the SimSnapshot type are created by SSP-046 and extended with M2 fields by SSP-065. Add `complaints` to that type and to TECHNICAL_DESIGN §18.5.

## Scope

- src/sim/complaints.ts: meter, reason codes, horn-spam sliding window with re-arm, police-witness hook (no-op).
- Penalty API (e.g. world.penalties.push(kind, pts, complaints, x, y)) consumed in phase 9: score deduction, combo reset, complaint increment, EV.Complaint.
- Map the HORN pressed edge to EV.Horn with position and radius, and feed the horn-spam window.
- Extend the test-hook state() snapshot with complaints.
- src/ui/hud.ts complaints meter with stamp and shake states driven by EV.Complaint.
- Unit tests for the meter, horn spam, combo reset and complaint events.

## Out of scope

- Specific offences (zebra, road rage, splash, hits): they land with their behaviours.
- The SACKED transition and tally (SSP-079).
- Audio playback (M5) and rubber-stamp final art (M4).
- Pam's 4-complaint radio bark (no radio panel yet).

## Acceptance criteria

- [ ] Unit test: 4 honks within 300 ticks add exactly 1 complaint; 3 honks add none; honks spaced more than 300 ticks apart add none; 8 honks in quick succession add exactly 2 (re-arm rule).
- [ ] Unit test: a honk flagged as Caught! in phase 7 is not counted toward horn spam.
- [ ] Unit test: any penalty fact resets the combo chain to 0 in the same tick, and its pts are subtracted exactly once.
- [ ] Unit test: the complaint count never decreases during a shift and is capped at 5.
- [ ] Unit test: EV.Horn is emitted in the same tick as the HORN pressed edge, with radius 8 m by default.
- [ ] e2e: Playwright presses H four times within 5 s of sim time on Puddle Lane; state().complaints is 1, and a readFrame capture opened with Read shows one stamped box.
- [ ] simPurity passes and the zero-allocation check holds with complaints active.

## Verification

- npm test
- npm run typecheck
- npm run lint
- npm run test:replay
- npm run test:visual
- npm run test:e2e

## Dependencies

**Depends on:**

- [SSP-075](SSP-075-entity-data-freeze.md) Freeze the Mon–Tue entity set in entities.json and add M3 shared tuning
- [SSP-063](../M2/SSP-063-scoring-combo.md) Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger
- [SSP-070](../M2/SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-069](../M2/SSP-069-bitmap-text.md) Implement src/ui/bitmapText.ts and the UI render pass
- [SSP-028](../M1/SSP-028-sim-foundations.md) Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type
- [SSP-044](../M1/SSP-044-input-devices.md) Implement keyboard and gamepad input producing quantised per-tick InputFrames
- [SSP-043](../M1/SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-065](../M2/SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-046](../M1/SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie

**Blocks:**

- [SSP-079](SSP-079-end-states-sacked-towed.md) End shifts on SACKED (5 complaints) and TOWED (0 HP) with correct tally rules
- [SSP-082](SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-089](SSP-089-traffic-lane-following.md) Implement traffic.ts: lane following, queuing behind Bessie, honk, Road Rage, bus stops
- [SSP-092](SSP-092-knockable-bodies.md) Implement bodies.ts knockable impulse bodies with spills and penalties
- [SSP-094](SSP-094-puddle-splash-broken-glass.md) Add puddle splash penalties and broken glass from flung bottles
- [SSP-095](SSP-095-near-miss-dust-coughing.md) Add the near-miss bonus and dust coughing penalties
- [SSP-288](SSP-288-popups-speech-bubbles.md) Add src/ui/popups.ts: world-space score/penalty popups and NPC speech bubbles
- [SSP-289](SSP-289-pam-radio-panel.md) Add Big Pam's HUD radio panel with a one-at-a-time bark queue and inline key glyphs
- [SSP-290](SSP-290-tutorial-beats.md) Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events
- [SSP-156](../M4/SSP-156-hud-final-art.md) Restyle the HUD and score popups with final fonts, icons and panels
- [SSP-176](../M5/SSP-176-sfx-event-wiring.md) Wire sim events to sfx cues through a pure audio director
- [SSP-187](../M6/SSP-187-progression-economy.md) Add districts.json, upgrades.json and pure week progression and £ ledger
- [SSP-188](../M6/SSP-188-upgrade-modifiers.md) Apply upg.* levels to the sim via tuning.ts modifiers and record loadout in replays
- [SSP-196](../M6/SSP-196-free-sweep.md) Add Free Sweep mode: untimed, no complaints, Pause -> Finish Sweep, cut-down Mercury
- [SSP-199](../M6/SSP-199-people-kids-jogger.md) Implement npc.jogger, npc.kid_skateboard, npc.kid_chalk and school_out/population_wave
- [SSP-211](../M6/SSP-211-reveller-police.md) Implement npc.reveller, kicking_out, veh.police witness rule and police_parked
- [SSP-237](../M7/SSP-237-assists-sim.md) Wire auto-brush, +60 s timer, Chill Shift and instant dump into the sim
- [SSP-241](../M7/SSP-241-juice-impact.md) Add screen shake, hit-stop and gamepad rumble with reduce-motion support
- [SSP-242](../M7/SSP-242-reduce-flashing.md) Implement the Reduce flashing setting across HUD and world effects

## References

- ../../GDD.md#11-penalties-complaints-and-fail-states
- ../../GDD.md#102-combo-chain
- ../../GDD.md#152-hud-layout
- ../../ENTITY_CATALOG.md#33-penalty-multipliers-and-complaint-sources
- ../../TECHNICAL_DESIGN.md#52-fixed-tick-order
- ../../TECHNICAL_DESIGN.md#72-event-queue
- ../../TECHNICAL_DESIGN.md#131-actions-and-the-inputframe
- ../../TECHNICAL_DESIGN.md#185-test-hooks

## Roadmap tasks covered

- `src/sim/complaints.ts`: 0–5 meter, horn-spam window, SACKED at 5.
- `Horn (8 m radius), near miss (+25), Pigeon Scatter (+25), Caught! (+100), dust coughing (horn emission part)`
