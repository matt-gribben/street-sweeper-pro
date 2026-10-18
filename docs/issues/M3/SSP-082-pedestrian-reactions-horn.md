---
id: SSP-082
title: "Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping"
milestone: M3
status: todo
type: feature
estimate: M
labels: [type:feature, area:sim, area:ai-npc, area:gameplay, area:test, size:M, vertical-slice]
depends_on: [SSP-078, SSP-080, SSP-081, SSP-057, SSP-064]
blocks: [SSP-083, SSP-084, SSP-085, SSP-086, SSP-087, SSP-088, SSP-091, SSP-094, SSP-095, SSP-096, SSP-288, SSP-155, SSP-176, SSP-199, SSP-200, SSP-240, SSP-241]
---

# SSP-082: Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** sim, ai-npc, gameplay, test · **Vertical slice**

## Summary

Implement the generic reaction model all people share (Walk, Idle, Cross, Startle, Fallen, GetUp, Angry, Yield), Bessie-vs-actor contact with the closing-speed rule, horn/hi-vis/beacon stimulus delivery, and penalty application from entities.json. Knocked-over NPCs drop litter.spilled_shopping per their data.

## Context

Reaction model (ENTITY_CATALOG §3.4):
- Wander → Aware when the sweeper is within the awareness radius (6 m, or 10 m with upg.led_beacon). Aware → Yield if the type yields; back to Wander when the sweeper leaves.
- Horn within the horn radius (8 m, or 12 m with the two-tone horn) → Startle → Yield. The catalog diagram draws the horn edge only from Aware, but the horn radius exceeds the awareness radius and the businessman reacts only to the horn, so deliver Horn to Wander and Aware pedestrians alike; note this in the PR.
- Contact → Hit → Fall ×3 → Angry ×2 (shakes fist) → Wander.
- Shared human states (TECHNICAL_DESIGN §11.1): Walk, Idle, Cross, Startle, Fallen, GetUp, Angry, Yield; they map 1:1 to animation states (walk 4, idle 2, startle 2, fall 3, angry 2 frames), so the renderer picks frames from state and stateTicks alone.

Timings in ticks (ART_BIBLE §10.2, TECHNICAL_DESIGN §11.2):
- Startle: frame 0 for 4 ticks, frame 1 held while sidestepping.
- Fallen: 3 frames × 5 ticks, then hold frame 2 for 72 ticks (15 + 72). GetUp: frames 1, 0 at 5 ticks each (10). Angry: 9 ticks × 6 alternations = 54.

Contact (TECHNICAL_DESIGN §9.4, ENTITY_CATALOG §3.2):
- Bessie's OBB (1.75 × 3.25 m) vs circle (human r = 0.3 m). No physics push.
- A hit only when Bessie's closing speed toward the actor is ≥ 1.0 m/s; otherwise the actor bumps off and plays Startle with no penalty.
- Penalty once per contact episode; contact is then ignored for 1.5 s (90 ticks).
- On a hit: penalty from entities.json `hit` via the penalty API (which also resets the chain); emit EV.NpcHit (SFX in M5).
- Drops from `hit.drops`: Doris 6 litter.spilled_shopping (0 pts, 1 LU, counts toward Tidy % litter spawned/collected); everyone else 0 (Q7 default). Spawn through litter.ts using the npc stream.

Stimuli:
- HiVis (pwr.hi_vis, 12 s): every pedestrian yields and parts, including Doris and the businessman. Stationary NPCs (market_trader) do not move.
- BeaconYield: ignored by Doris and the businessman.

Rating guard (CLAUDE.md rule 11): nobody is injured. NPCs fall over cartoonishly, get up and shake a fist.

## Scope

- Shared human state constants and transitions with tick-accurate durations.
- Bessie vs actor-circle contact in phase 7 with the closing-speed threshold, contact episodes and the 1.5 s ignore window.
- Deliver Horn stimuli (from EV.Horn facts) to NPCs within the radius; deliver HiVis and BeaconYield.
- Apply penalties, emit EV.NpcHit, spawn drops from entities.json.
- A default generic-pedestrian behaviour that per-type modules extend.

## Out of scope

- Per-type overrides (behaviour issues).
- Near miss and dust (SSP-095).
- Cat roof-ride hit response (SSP-087).

## Acceptance criteria

- [ ] Unit test: Bessie driving into a generic pedestrian at 2 m/s produces one hit with the entities.json pts and complaints and a combo reset; holding contact for 60 more ticks adds no second penalty.
- [ ] Unit test: a pedestrian walking into a stationary Bessie (closing speed < 1.0 m/s) plays Startle with no penalty.
- [ ] Unit test: after a hit the states run Fallen (87 ticks) → GetUp (10) → Angry (54) → Walk, with exact tick counts.
- [ ] Unit test: a horn 7.9 m away moves a Wander or Aware pedestrian to Startle; a horn 8.5 m away does not.
- [ ] Unit test: knocking Doris over spawns exactly 6 litter.spilled_shopping worth 0 pts and 1 LU each, counted in litter spawned; knocking a shopper over spawns 0.
- [ ] Unit test: under HiVis a non-yielding type enters Yield; a stationary type does not move.

## Verification

- npm test
- npm run test:replay
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-078](SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-080](SSP-080-npc-store-spawner.md) Add the NPC store, behaviour registry, spawner and phase 7 of the tick
- [SSP-081](SSP-081-npc-steering.md) Implement NPC steering: seek, flee, separation, nav paths, zebra crossing
- [SSP-057](../M2/SSP-057-litter-field.md) Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn
- [SSP-064](../M2/SSP-064-tidy-frontages.md) Compute Tidy %, per-frontage clean % and Clean Sweep bonuses incrementally

**Blocks:**

- [SSP-083](SSP-083-behaviour-doris.md) Implement Doris (npc.old_woman): glare, fist-shake slowdown, spray chase, handbag whack
- [SSP-084](SSP-084-behaviour-shopper-businessman-litterbug.md) Implement shopper, businessman and litterbug behaviours, including the Caught! bonus
- [SSP-085](SSP-085-behaviour-old-man-mum-postie.md) Implement old man, mum with pushchair and postie, and the occupied-zebra penalty
- [SSP-086](SSP-086-behaviour-dog-walker.md) Implement the dog walker with a lead line obstacle, Lead Tangle and dog mess drops
- [SSP-087](SSP-087-behaviour-cat.md) Implement the cat: perch, dart on approach, groom, bolt, and ride Bessie's roof
- [SSP-088](SSP-088-behaviour-market-trader-pigeon.md) Implement market trader (with market close pile) and pigeon flocks with Pigeon Scatter
- [SSP-091](SSP-091-traffic-special-kinds.md) Add taxi fare stops, white van pavement parking, bicycle filtering and mobility scooter
- [SSP-094](SSP-094-puddle-splash-broken-glass.md) Add puddle splash penalties and broken glass from flung bottles
- [SSP-095](SSP-095-near-miss-dust-coughing.md) Add the near-miss bonus and dust coughing penalties
- [SSP-096](SSP-096-power-ups.md) Spawn power-ups on pavements, implement all six pwr.* effects, draw them
- [SSP-288](SSP-288-popups-speech-bubbles.md) Add src/ui/popups.ts: world-space score/penalty popups and NPC speech bubbles
- [SSP-155](../M4/SSP-155-vfx-reactions.md) Procedural VFX for reactions and damage: impact star, cough, anger, smoke
- [SSP-176](../M5/SSP-176-sfx-event-wiring.md) Wire sim events to sfx cues through a pure audio director
- [SSP-199](../M6/SSP-199-people-kids-jogger.md) Implement npc.jogger, npc.kid_skateboard, npc.kid_chalk and school_out/population_wave
- [SSP-200](../M6/SSP-200-dog-loose-seagull.md) Implement npc.dog_loose chase and npc.seagull chip theft and litter snatching
- [SSP-240](../M7/SSP-240-juice-squash-popups.md) Juice pass: squash-and-stretch, combo popups and the cat roof-ride
- [SSP-241](../M7/SSP-241-juice-impact.md) Add screen shake, hit-stop and gamepad rumble with reduce-motion support

## References

- ../../ENTITY_CATALOG.md#32-collision-responses
- ../../ENTITY_CATALOG.md#34-generic-pedestrian-reaction-model
- ../../TECHNICAL_DESIGN.md#94-dynamic-actors
- ../../TECHNICAL_DESIGN.md#111-behaviour-system
- ../../ART_BIBLE.md#102-timing-table
- ../../ART_BIBLE.md#103-pedestrian-reaction-flow
- ../../../CLAUDE.md#3-hard-rules-non-negotiable

## Roadmap tasks covered

- `litter.spilled_shopping` drops on knocked-over NPCs (0 points).
- `Horn (8 m radius), near miss (+25), Pigeon Scatter (+25), Caught! (+100), dust coughing (horn stimulus part)`
