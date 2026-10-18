---
id: SSP-240
title: "Juice pass: squash-and-stretch, combo popups and the cat roof-ride"
milestone: M7
status: todo
type: feature
estimate: M
labels: [type:feature, area:render, area:ui, area:gameplay, size:M]
depends_on: [SSP-087, SSP-082, SSP-036, SSP-070, SSP-063, SSP-127, SSP-133, SSP-146, SSP-142, SSP-143, SSP-288]
blocks: [SSP-242, SSP-248, SSP-253, SSP-261]
---

# SSP-240: Juice pass: squash-and-stretch, combo popups and the cat roof-ride

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** feature · **Size:** M · **Areas:** render, ui, gameplay

## Summary

Add the render-only half of the M7 juice pass: squash-and-stretch on Bessie and NPC reactions, combo/score popups to the ART_BIBLE spec, and a polished cat roof-ride. All of it reads sim state and events and never changes the sim.

## Context

Rules (ART_BIBLE §10.1):
- Animation is driven by sim ticks, so goldens stay deterministic.
- Squash and stretch is drawn into frames where the size sheet provides them (cat leap: squash 4, stretch 6, land 6 ticks).
- Runtime quad scaling is allowed ONLY for juice and lasts at most 12 ticks (200 ms), because it creates mixels.
Sprites are flat instanced quads (TECHNICAL_DESIGN §12.5). The listed per-instance attributes (offset, rotation, frameRect, pivot, swap, flags) have no scale, so one may need adding. Keep the same draw calls (≤ 10 budget, 9 allocated in §12.7).
Cat roof-ride (ENTITY_CATALOG §7.2, TECHNICAL_DESIGN §11.3): on a hit the cat leaps onto Bessie's roof (squash and stretch, `cat_yowl`), rides for 3 s, then hops off. While riding it uses `sit` frames offset to Bessie's local frame, on depth layer 9 (above the brush overlay on layer 8). The sim states LeapOnRoof/RideRoof/HopOff exist from M3. M7 adds the visual squash on landing and hop-off. The cat is never hurt.
NPC reactions (ART_BIBLE §10.2/§10.3): startle frame 0 for 4 ticks (the hop), fall 3 frames at 5 ticks, hold 72 ticks, get up, then the angry fist shake. Add squash on the startle hop and the fall landing.
Combo/score popups (ART_BIBLE §11; GDD §15.2: tier words big and centred, popups in Kerbside Bold 8×8): Kerbside text spawned at the pickup rises 12 px over 36 ticks with ease-out, holds 12 ticks, then blinks out 3 × 3 ticks.
| Tier | Word | Colour |
|---|---|---|
| ×1 | points only | 07 |
| ×2 | TIDY! | 23 |
| ×3 | SPOTLESS! | 28 |
| ×4 | IMMACULATE! | 16 |
| ×5 | SWEEPING BEAUTY! | cycles 16→17→20→28→23 every 5 ticks |
| penalty | e.g. −250 | 18 |
Thresholds are ×1–×5 at chains of 10/25/50/100 (GDD §10.2). The existing src/ui/popups.ts (subscribed to the event bus) already shows tier text; bring it to this spec.
Squash amplitudes for Bessie (impacts, dump start) and NPCs are not documented. Choose values, keep them as named render-side constants (not tuning.json, which holds gameplay numbers), and note them in the PR. They are tunable later and do not need sign-off to merge.
Rating guard: pratfalls are comic and no injury is implied.

## Scope

- Per-instance scale (or an equivalent) in spriteBatch, with a juice envelope helper capped at 12 ticks
- Bessie squash on EV.Impact and dump start. NPC squash on startle and fall landing.
- Cat roof-ride render: layer 9, sit frames in Bessie's local frame, landing and hop-off squash
- src/ui/popups.ts brought to the ART_BIBLE §11 timing and colour spec, including the ×5 colour cycle
- Unit tests for envelope duration ≤ 12 ticks and popup timing. Visual check of a frozen test-hook frame, reviewed with Read.

## Out of scope

- Screen shake, hit-stop, rumble (SSP-241)
- Reduce-flashing variant of the ×5 colour cycle (SSP-242)
- Any sim or tuning change. The cat ride stays 3 s.

## Acceptance criteria

- [ ] No runtime quad scale lasts longer than 12 ticks (unit test on the envelope)
- [ ] Popups rise 12 px over 36 ticks, hold 12 and blink 3×3, with the tier colours above (unit test on the popup state function)
- [ ] Hitting the cat shows it riding Bessie's roof above the brush overlay for 3 s, then hopping off (Read a frozen frame at ?test=1&seed=<n>&scene=<district>&tick=<n>&freeze=1)
- [ ] Draw calls unchanged: perf.spec.ts ci project still ≤ 10
- [ ] npm run test:replay hashes unchanged (render-only change)
- [ ] Existing visual goldens pass, or any update was opened with Read and justified in the commit

## Verification

- npm run typecheck && npm run lint && npm test
- npm run test:replay
- npm run test:visual
- npm run test:e2e
- Manual: npm run dev, hit the cat and chain to ×5

## Dependencies

**Depends on:**

- [SSP-087](../M3/SSP-087-behaviour-cat.md) Implement the cat: perch, dart on approach, groom, bolt, and ride Bessie's roof
- [SSP-082](../M3/SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-036](../M1/SSP-036-static-collision.md) Resolve Bessie against static geometry with impact damage and TOWED stub
- [SSP-070](../M2/SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-063](../M2/SSP-063-scoring-combo.md) Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger
- [SSP-127](../M4/SSP-127-bessie-final.md) Final Bessie renders: body, dented variant and 96x96 brush overlay
- [SSP-133](../M4/SSP-133-char-doris-pilot.md) Pilot the people pipeline end to end with npc.old_woman (Doris)
- [SSP-146](../M4/SSP-146-animal-cat.md) Hand-author the npc.cat grid: walk, sit, dart, leap in 8 directions
- [SSP-142](../M4/SSP-142-font-kerbside-5x7.md) Finalise Kerbside 5x7 glyphs, metrics and kerning
- [SSP-143](../M4/SSP-143-font-kerbside-bold-8x8.md) Write Kerbside Bold 8x8 glyphs, metrics and kerning
- [SSP-288](../M3/SSP-288-popups-speech-bubbles.md) Add src/ui/popups.ts: world-space score/penalty popups and NPC speech bubbles

**Blocks:**

- [SSP-242](SSP-242-reduce-flashing.md) Implement the Reduce flashing setting across HUD and world effects
- [SSP-248](SSP-248-perf-optimise.md) Profile and optimise until the M7 performance budgets hold
- [SSP-253](SSP-253-browser-scaling-qa.md) Run cross-browser, scaling and storage-blocked verification for 1.0
- [SSP-261](../M8/SSP-261-touch-hud-adaptation.md) Adapt the HUD layout so it never sits under the thumbs in touch mode

## References

- ../../ART_BIBLE.md#101-principles
- ../../ART_BIBLE.md#102-timing-table
- ../../ART_BIBLE.md#103-pedestrian-reaction-flow
- ../../ART_BIBLE.md#11-vfx
- ../../ENTITY_CATALOG.md#72-cat-npccat
- ../../TECHNICAL_DESIGN.md#113-example-cat-npccat
- ../../TECHNICAL_DESIGN.md#125-sprites-spritebatchts-spritestackts
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../GDD.md#102-combo-chain
- ../../GDD.md#152-hud-layout
- ../../GDD.md#182-comedy-mechanics

## Roadmap tasks covered

- `Juice: squash-and-stretch on Bessie and NPC reactions; screen shake on impacts (respects a "reduce motion" setting); hit-stop 2–4 frames on big impacts; rumble where supported. (squash-and-stretch, combo popups, cat roof-ride)`
