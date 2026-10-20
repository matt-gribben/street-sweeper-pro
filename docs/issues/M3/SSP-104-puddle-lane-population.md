---
id: SSP-104
title: "Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up"
milestone: M3
status: done
type: feature
estimate: M
labels: [type:feature, area:gameplay, area:ai-npc, area:tooling, area:test, size:M, vertical-slice]
depends_on: [SSP-077, SSP-083, SSP-084, SSP-085, SSP-086, SSP-087, SSP-091, SSP-092, SSP-093, SSP-094, SSP-095, SSP-096, SSP-042, SSP-056]
blocks: [SSP-103, SSP-107, SSP-290, SSP-158, SSP-293, SSP-294, SSP-231, SSP-258]
---

# SSP-104: Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** gameplay, ai-npc, tooling, test · **Vertical slice**

## Summary

Author the M3 sections of assets-src/levels/puddle_lane.level.json (NPC schedules and mix, named Doris, postie and dog walker, cat perches, traffic, puddles, power-up, knockables) to the LEVEL_DESIGN §5.1 values, and recompile, so the vertical slice's Monday street comes alive.

## Context

LEVEL_DESIGN §5.1 and §4.5 (all values initial).

NPC peaks:
- npc.shopper 9, concentrated on the Puddle Lane parade.
- npc.old_woman (Doris) 1: named spawn at anchor `1` (doris_home) at 70 s, scripted walk to the zebra and the corner shop and back.
- npc.old_man_frame 1: crosses only at the zebra.
- npc.postie 1: frontage round from 10 s.
- npc.mum_pushchair 2.
- npc.dog_walker 1: from 120 s, loops Pump Green.
- npc.cat 4: 2 on garden walls (`w`), 2 on parked car roofs.

Traffic: 6 moving (veh.hatchback 55, veh.saloon 30, veh.van_white 15) plus 1 veh.mobility_scooter on pavements; parked 14 in bays on Puddle Lane and Drain Close, parkedFill 0.6. *Note (SSP-090):* a parked car takes a 2-tile bay, so the map's 24 `p` tiles are 12 bays (0.6 → 8 parked, 12 at most); 14 parked needs at least 24 bays at 0.58, or 28 at 0.5 (more `p` tiles). The scooter lives in the vehicle store (SSP-091), so the peak vehicle count can be 21.

Other content:
- Hazards: 8 haz.puddle (kerbside, near drains; rule kerbside_low_points); 3 speed-bump rows (`=`, already in the map).
- Power-ups: 1, pwr.flask_of_tea. Peaks: NPCs 22/80.
- Knockables: no Puddle Lane counts in the docs. Mon allows prop.wheelie_bin and prop.recycling_box (NOT traffic cones, A-boards or trolleys: L005). Place a small number, flag counts as initial values, keep the first 10–15 s from @ hazard-free.
- Last big event at or before 200 s (L081). The `dawn` event is M6.

The par report goes into the PR. Adding street life changes the committed m1 and m2 replay hashes: re-record them in the same commit with the reason (ROADMAP §5.3). Visual review with actors happens in SSP-103 (which depends on this issue); here, verify through test-hook state().

## Scope

- npcs (population, mix, caps, named, perches), traffic, hazards, powerups and knockables sections, plus anchors (1 = doris_home) and routes.
- Recompile, commit public/assets/levels/puddle_lane.json, paste the par report into the PR.
- Re-record affected replay hashes with a reason.
- A seed-1 test-hook (or replay-project) check of named spawns.

## Out of scope

- The `dawn` event (M6, LEVEL_DESIGN Q5).
- Tutorial beats.
- Final tuning (M6).

## Acceptance criteria

- [ ] `npm run levels` passes with no errors; the par report shows peak NPC ≤ 22/80 and peak vehicles ≤ 21/30.
- [ ] A seed-1 run shows Doris spawned at tick 4,200 at anchor 1, the postie active from tick 600 and the dog walker spawned at tick 7,200 (state() or a sim test).
- [ ] `npm run test:e2e` smoke passes with no console errors and score > 0.
- [ ] `npm run test:replay` passes, with re-recorded hashes and the reason in the commit.
- [ ] `npm run assets:verify` passes.

## Verification

- npm run levels
- npm run assets:verify
- npm run test:replay
- npm run test:e2e
- npm test

## Dependencies

**Depends on:**

- [SSP-077](SSP-077-compile-spawn-specs.md) Compile NPC, traffic, hazard, knockable and power-up spawn specs from level.json
- [SSP-083](SSP-083-behaviour-doris.md) Implement Doris (npc.old_woman): glare, fist-shake slowdown, spray chase, handbag whack
- [SSP-084](SSP-084-behaviour-shopper-businessman-litterbug.md) Implement shopper, businessman and litterbug behaviours, including the Caught! bonus
- [SSP-085](SSP-085-behaviour-old-man-mum-postie.md) Implement old man, mum with pushchair and postie, and the occupied-zebra penalty
- [SSP-086](SSP-086-behaviour-dog-walker.md) Implement the dog walker with a lead line obstacle, Lead Tangle and dog mess drops
- [SSP-087](SSP-087-behaviour-cat.md) Implement the cat: perch, dart on approach, groom, bolt, and ride Bessie's roof
- [SSP-091](SSP-091-traffic-special-kinds.md) Add taxi fare stops, white van pavement parking, bicycle filtering and mobility scooter
- [SSP-092](SSP-092-knockable-bodies.md) Implement bodies.ts knockable impulse bodies with spills and penalties
- [SSP-093](SSP-093-hazards-grip-jolts.md) Implement hazard grip overrides, jolts, LU spills and the open-manhole hard stop
- [SSP-094](SSP-094-puddle-splash-broken-glass.md) Add puddle splash penalties and broken glass from flung bottles
- [SSP-095](SSP-095-near-miss-dust-coughing.md) Add the near-miss bonus and dust coughing penalties
- [SSP-096](SSP-096-power-ups.md) Spawn power-ups on pavements, implement all six pwr.* effects, draw them
- [SSP-042](../M1/SSP-042-puddle-lane-level.md) Author Puddle Lane map.txt and level.json (64×48) and commit compiled output
- [SSP-056](../M2/SSP-056-puddle-lane-sweeping-content.md) Author Puddle Lane litter, grime, frontages, pledges and collectibles data

**Blocks:**

- [SSP-103](SSP-103-render-actors-traffic.md) Draw NPCs, animals, traffic, knockables and hazards with state-driven frames
- [SSP-107](SSP-107-m3-replays-determinism.md) Record SACKED and TOWED replays and add the replay-determinism property test
- [SSP-290](SSP-290-tutorial-beats.md) Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events
- [SSP-158](../M4/SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-293](../M5/SSP-293-vs-scripted-replays.md) Record the vertical-slice replays vs_slow, vs_fast and vs_practised with a waypoint route follower
- [SSP-294](../M5/SSP-294-vs-automated-checks.md) Automate the vertical-slice technical checks: before/after captures, Puddle Lane perf and the 20-shift soak
- [SSP-231](../M6/SSP-231-balance-pass.md) Full-week balance pass: competent runs, £ curve, par constants and score bands
- [SSP-258](../M8/SSP-258-touch-replay.md) Add the M8 replay: a Puddle Lane drive driven by scripted touch input

## References

- ../../LEVEL_DESIGN.md#51-mon-puddle-lane-districtpuddle_lane-tutorial
- ../../LEVEL_DESIGN.md#45-per-district-event-timelines
- ../../LEVEL_DESIGN.md#84-leveljson-schema
- ../../LEVEL_DESIGN.md#12-level-design-checklist
- ../../ROADMAP.md#53-replay-hash-policy

## Roadmap tasks covered

- `Vertical slice street life (§3.2): Puddle Lane NPCs, traffic, puddles, speed bumps, knockable props, SSP-096`
