---
id: SSP-288
title: "Add src/ui/popups.ts: world-space score/penalty popups and NPC speech bubbles"
milestone: M3
status: done
type: feature
estimate: M
labels: [type:feature, area:ui, area:gameplay, area:test, size:M, vertical-slice]
depends_on: [SSP-285, SSP-069, SSP-063, SSP-078, SSP-082, SSP-083, SSP-084, SSP-087, SSP-089, SSP-046]
blocks: [SSP-109, SSP-156, SSP-184, SSP-240, SSP-242]
---

# SSP-288: Add src/ui/popups.ts: world-space score/penalty popups and NPC speech bubbles

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** ui, gameplay, test · **Vertical slice**

## Summary

Create `src/ui/popups.ts`, an event-bus subscriber that draws two things in the UI pass, anchored to world positions. The first is per-pickup score popups and penalty popups. The second is diegetic NPC speech bubbles: 'Oi!', 'Hmph!', 'Not the cat!', 'Caught!' and the honking car's '!'. The bubble manager here (timing, max 3, same-ID replacement) is the one that SSP-184's captions reuse.

## Context

GDD §15.2: score popups are world-space ('Points float up from the pickup; tier words big and centred'). 'Diegesis where cheap': NPC reactions are speech bubbles in the world, not HUD text. TECHNICAL_DESIGN §7.2 names `ui/popups.ts` as an event-bus subscriber.
Score popups (ART_BIBLE §11) are Kerbside text spawned at the pickup. Each rises 12 px over 36 ticks with ease-out, holds 12 ticks, then blinks out in 3 × 3 ticks. Colour by tier: ×1 07, ×2 23, ×3 28, ×4 16, and ×5 cycling 16→17→20→28→23 every 5 ticks. Penalties use 18 and show negative points (the M3 penalty pipeline, SSP-078). SSP-070 excluded per-pickup world-space popups, so they land here. GDD §15.2 says popups use Kerbside Bold 8×8, which arrives in M4, so use 5×7 for now; SSP-156 restyles them.
Speech bubbles (GDD §18.3): 'Oi!' (shoppers), 'Hmph!' (Doris), 'Not the cat!' (cat hit) and 'Caught!' (litterbug). WAAAH! (chalk kid) is M6. AUDIO_DESIGN §13.2 adds the honking car's '!' bubble. Bubble rules (AUDIO_DESIGN §13.2), owned here and reused by the M5 captions (SSP-184):
- Kerbside 5×7 in chalk on an ink panel with a 1 px outline, anchored above the source.
- Display time is 1.5 s plus 60 ms per character, capped at 3 s.
- At most 3 show at once, and a newer bubble replaces an older one with the same ID.
Use palette names, never hex (CLAUDE.md hard rule 3). GDD §18.3 writes 'Hmph!' and AUDIO_DESIGN §13.2 writes 'HMPH!'. Flag the mismatch, pick one, and fix the other doc in the same PR.
Triggers come from the sim events emitted by the M3 behaviours: SSP-082 reactions/NpcHit, SSP-083 Doris, SSP-084 Caught!, SSP-087 cat hit and SSP-089 traffic honk. If an event lacks what a bubble needs (the entity index and position), add the field without changing sim logic. Events are part of the replay hash, so regenerate hashes only with a stated reason (ROADMAP §5.3).
This is presentation only: src/ui never mutates the sim (TECHNICAL_DESIGN §2.1). src/ui may not import camera.ts, so the composition root (ShiftScene) injects a world→internal-pixel projection. Bubbles follow their source each frame using interpolated positions. Popup timing counts sim ticks, so popups freeze under PauseOverlay. Use preallocated pools and allocate nothing per frame.

## Scope

- src/ui/popups.ts: pooled world-anchored popups with a pure timing/parameter function
- Score popups on litter pickup events with tier colours; penalty popups in 18 on penalty facts
- Speech bubbles for shopper Oi!, Doris Hmph!, cat Not the cat!, litterbug Caught! and the car honk '!', using a bubble panel with a tail (panels.ts)
- Bubble manager: the timing rule, max 3, same-ID replacement, exposed for SSP-184 to extend
- Projection injected from ShiftScene; reconcile the Hmph!/HMPH! wording in the docs
- Unit tests for timing, tiers and replacement; a frozen capture showing a popup and a bubble

## Out of scope

- Sound captions, edge captions, caption modes, caption size and caption settings (SSP-184)
- Final fonts and art for popups (SSP-156)
- Juice/squash on combo popups (SSP-240)
- M6-only bubbles (WAAAH!, seagull, police)

## Acceptance criteria

- [ ] Vitest: a score popup's y offset is 0 at spawn and −12 px at tick 36, holds to tick 48, then blinks in 3-tick steps ending at tick 57; ×3 uses colour 28 and penalties use 18
- [ ] Vitest: a 10-character bubble lasts 2.1 s (1.5 s + 60 ms × 10), and a 40-character bubble is capped at 3.0 s
- [ ] Vitest: with 3 bubbles active, a 4th distinct one removes the oldest; a repeat of an active ID replaces it rather than stacking
- [ ] Unit test: hitting a shopper, a cat hit, a Caught! and a car honk each spawn the documented bubble text above the right entity
- [ ] A frozen capture shows a score popup and a speech bubble on Puddle Lane (frame Read and noted in the PR)
- [ ] Draw calls stay ≤ 10, and popups.ts allocates nothing per frame
- [ ] Grep check: no file under src/ui imports src/render/camera.ts or mutates sim state

## Verification

- npx vitest run tests/unit/popups.test.ts
- npm run test:replay
- npm run test:visual
- npm run typecheck && npm run lint && npm test

## Dependencies

**Depends on:**

- [SSP-285](SSP-285-ui-panels-9slice.md) Implement src/ui/panels.ts 9-slice panels and button states with placeholder panel grids
- [SSP-069](../M2/SSP-069-bitmap-text.md) Implement src/ui/bitmapText.ts and the UI render pass
- [SSP-063](../M2/SSP-063-scoring-combo.md) Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger
- [SSP-078](SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-082](SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-083](SSP-083-behaviour-doris.md) Implement Doris (npc.old_woman): glare, fist-shake slowdown, spray chase, handbag whack
- [SSP-084](SSP-084-behaviour-shopper-businessman-litterbug.md) Implement shopper, businessman and litterbug behaviours, including the Caught! bonus
- [SSP-087](SSP-087-behaviour-cat.md) Implement the cat: perch, dart on approach, groom, bolt, and ride Bessie's roof
- [SSP-089](SSP-089-traffic-lane-following.md) Implement traffic.ts: lane following, queuing behind Bessie, honk, Road Rage, bus stops
- [SSP-046](../M1/SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie

**Blocks:**

- [SSP-109](SSP-109-close-m3.md) Close M3: verify the exit criteria, sync docs, state the frozen entity list, tag m3
- [SSP-156](../M4/SSP-156-hud-final-art.md) Restyle the HUD and score popups with final fonts, icons and panels
- [SSP-184](../M5/SSP-184-captions.md) Add speech-bubble and sound captions for audio cues
- [SSP-240](../M7/SSP-240-juice-squash-popups.md) Juice pass: squash-and-stretch, combo popups and the cat roof-ride
- [SSP-242](../M7/SSP-242-reduce-flashing.md) Implement the Reduce flashing setting across HUD and world effects

## References

- ../../GDD.md#152-hud-layout
- ../../GDD.md#183-writing-samples
- ../../ART_BIBLE.md#11-vfx
- ../../AUDIO_DESIGN.md#132-caption-table
- ../../TECHNICAL_DESIGN.md#72-event-queue
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom
- ../../ROADMAP.md#53-replay-hash-policy

## Roadmap tasks covered

_None._
