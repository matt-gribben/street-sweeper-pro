---
id: SSP-198
title: "Implement SkipRunScene: 45 s cone slalom and reverse-park bays with \u00a35/\u00a350 payouts"
milestone: M6
status: todo
type: feature
estimate: L
labels: [type:feature, area:gameplay, area:sim, area:ui, area:audio, size:L]
depends_on: [SSP-197, SSP-192, SSP-187, SSP-189, SSP-030, SSP-092, SSP-170, SSP-183]
blocks: [SSP-231, SSP-233, SSP-257]
---

# SSP-198: Implement SkipRunScene: 45 s cone slalom and reverse-park bays with £5/£50 payouts

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** L · **Areas:** gameplay, sim, ui, audio

## Summary

The optional bonus stage after every completed shift: slalom the day's gates, then reverse-park into the active bays, earning £5 per clean bay and £50 for a clean run.

## Context

Spec: GDD §13.3 and LEVEL_DESIGN §11. Offered after every completed shift, never after SACKED or TOWED (LEVEL_DESIGN §3.2). Flow: Tally -> SkipRunScene -> WorkshopScene. Timer 45 s.
- Part 1, slalom: pass each gate (a cone) on its required side. prop.traffic_cone has no penalty, but touching one breaks the clean run.
- Part 2, clean bay (proposed in GDD; adopt it): entered in reverse, body fully inside the 2x3-tile (4 x 6 m) bay, no contact with its lines or cones, stopped below 0.5 m/s. Each clean bay pays £5.
- Clean run: every gate passed on the correct side, every active bay clean, and no cones touched. It pays £50.
The variant is the preceding shift's day. Weather and time of day are inherited from the preceding shift: rain grip 6.0 after Wednesday, and the night remap with the lamp light mask after Saturday. This issue owns resolving the level's 'inherit' fields into concrete weather/timeOfDay scene and sim params; SSP-202 and SSP-210 implement the effects of those params.
Audio (AUDIO §8.4): mus.title base + drums, with the lead entering at 15 s remaining; ambience is the previous district's bed at -4 dB.
Gate and bay detection runs in the sim (pure and deterministic), so Skip Runs can be replayed under replay mode 'skip_run' (field added by SSP-189). Payout goes through progression as a Skip Run ledger line, and skipRun.best is saved. Its units are unspecified: propose £ earned and note it in TECHNICAL_DESIGN §16.
Replay: the exit criteria want 'one committed 3,600-tick replay per district plus the Skip Run', but a Skip Run lasts 2,700 ticks. Proposal: record 3,600 ticks with the post-end ticks idle on the result screen, and note the decision in TECHNICAL_DESIGN §18.3.
Enable the Mercury's Skip Run button (SSP-192 hides it until SkipRunScene is registered).

## Scope

- Sim: gate pass-side detection, cone contact flag, bay occupancy (reverse entry, fully inside, no contact, < 0.5 m/s), clean-run evaluation, 45 s timer, mode 'skip_run'
- src/scenes/SkipRunScene.ts with a HUD (timer, gates, bays) and a result card; flow Tally -> SkipRun -> Workshop
- Resolve inherited weather and time of day from the preceding shift into scene/sim params; choose the variant by day
- Music and ambience per AUDIO §8.4
- Payout through progression; save skipRun.best
- Unit tests per rule; a scripted Skip Run replay for at least the mon variant (tests/replay/replays/m6_skip_run_mon.json)
- Full-map screenshot of the Depot Yard (?test=1&scene=district.depot_yard&freeze=1) reviewed with Read

## Out of scope

- Rain grip and night rendering effects (SSP-202, SSP-210)
- Course authoring (SSP-197)

## Acceptance criteria

- [ ] The Skip Run button is absent after SACKED/TOWED and present after a completed shift (e2e)
- [ ] Unit test: passing a gate on the wrong side fails that gate and the clean run
- [ ] Unit test: a bay entered forwards, with a line touched, or left at >= 0.5 m/s is not clean
- [ ] Unit test: 3 clean bays plus a clean run on the mon variant pays £65; 2 clean bays with a knocked cone pays £10
- [ ] Unit test: a Skip Run after a Wednesday shift passes weather 'rain' to the sim, and after Saturday passes timeOfDay 'night'
- [ ] m6_skip_run_mon.json is committed and passing, with a stable hash across two runs
- [ ] Unit test (music state machine): the lead stem enters at 15 s remaining
- [ ] The Depot Yard screenshot review is noted in the PR

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:replay
- npm run test:e2e

## Dependencies

**Depends on:**

- [SSP-197](SSP-197-depot-yard-level.md) Author and compile district.depot_yard with all seven Skip Run variants
- [SSP-192](SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-187](SSP-187-progression-economy.md) Add districts.json, upgrades.json and pure week progression and £ ledger
- [SSP-189](SSP-189-scripted-runs.md) Generalise scripted-run authoring for district replays, balance runs and week e2e
- [SSP-030](../M1/SSP-030-vehicle-model.md) Implement Bessie's kinematic bicycle model in src/sim/vehicle.ts
- [SSP-092](../M3/SSP-092-knockable-bodies.md) Implement bodies.ts knockable impulse bodies with spills and penalties
- [SSP-170](../M5/SSP-170-song-title.md) Compose mus.title 'Brush With Greatness' with base, drums and lead stems
- [SSP-183](../M5/SSP-183-amb-town-morning.md) Add the ambience bed player and author amb.town_morning

**Blocks:**

- [SSP-231](SSP-231-balance-pass.md) Full-week balance pass: competent runs, £ curve, par constants and score bands
- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag
- [SSP-257](../M8/SSP-257-touch-input-device.md) Implement src/input/touch.ts producing the same InputFrame as keyboard and pad

## References

- ../../GDD.md#133-skip-run
- ../../LEVEL_DESIGN.md#11-skip-run-layout-rules
- ../../LEVEL_DESIGN.md#32-unlock-order
- ../../LEVEL_DESIGN.md#58-the-depot-yard-districtdepot_yard
- ../../AUDIO_DESIGN.md#84-scene--audio-map
- ../../TECHNICAL_DESIGN.md#183-deterministic-replay-tests
- ../../ENTITY_CATALOG.md#11-sites-site

## Roadmap tasks covered

- Skip Run (45 s, cone slalom, reverse-park bays, £5 per clean bay, £50 per clean run) on `district.depot_yard`.
