---
id: SSP-290
title: "Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events"
milestone: M3
status: done
type: feature
estimate: M
labels: [type:feature, area:ui, area:gameplay, area:tooling, area:test, size:M, vertical-slice]
depends_on: [SSP-289, SSP-077, SSP-104, SSP-062, SSP-063, SSP-064, SSP-078, SSP-083, SSP-087, SSP-035, SSP-047, SSP-299]
blocks: [SSP-109, SSP-186, SSP-302, SSP-235, SSP-236, SSP-262]
---

# SSP-290: Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** ui, gameplay, tooling, test · **Vertical slice**

## Summary

Make Monday's Puddle Lane the tutorial. Author the 13 GDD §16.2 beats as `tutorial_beat` events, validate them in the compiler, and add a presentation-side prompt layer. The layer fires each beat on its trigger, shows one prompt at a time through the radio panel with inline key glyphs, drops prompts once the player performs them, and tracks learned beats.

## Context

GDD §16.1:
- Teach by doing in the first real level, with a prompt layer on first play.
- One prompt at a time, triggered by context, delivered as Pam radio barks with the key glyph for the active device inline.
- Prompts never pause the world.
- A prompt disappears once performed and never repeats once learned (tracked per save).
GDD §16.2 is the single owner of beat text and triggers. LEVEL_DESIGN §4.4 authors each beat as a `tutorial_beat` event ({trigger, text}, LEVEL_DESIGN §4.3), copied exactly. Beats show on the first play of Puddle Lane, and again whenever 'Show tips' is on (SSP-235). GDD §17.2 Cognitive (M3): contextual one-line prompts, never simultaneous.
Triggers (GDD §16.2): 1 shift start; 2 moved 10 m; 3 first pickup; 4 first fling; 5 chain reaches 10; 6 first kerb contact; 7 hopper 80%; 8 in depot bay; 9 first cat within 10 m; 10 first Doris encounter; 11 first complaint; 12 first pledge frontage on screen; 13 sim event `timer_remaining<=60`.
Evaluate the triggers presentation-side, from bus events (litter collected, fling, combo tier, complaint, the 60 s timer event from SSP-062, the kerb jolt from SSP-035) and from read-only sim state (distance driven, hopper LU, depot-bay containment, distance to npc.cat or npc.old_woman). Beat 12 uses the camera view rect, which the sim does not have. Keeping all of this outside the sim leaves the sim untouched and replay hashes unchanged. Record the exact definitions of 'encounter' and 'kerb contact' in LEVEL_DESIGN §4.4.
Text tokens: where the GDD bolds a key (W, A/D, Space, E) or the 9 mph speed, the level.json text uses the radio-panel tokens from SSP-289 ({throttle}, {steer}, {brush}, {interact}, {cleanSpeed}). Rendering every beat with the default keyboard bindings must reproduce the GDD §16.2 text exactly, minus the bold markup. Document the token syntax in LEVEL_DESIGN §8.4.
Learned rule (record it in GDD §16.1). Action beats are learned when the taught action is performed: 1 when throttle and steer are used, 2 when the brush is lowered, 8 when a dump starts, 9 when the horn is pressed. Informational beats are learned when shown. A performed beat that is still queued is cancelled, and one already showing is dismissed early.
Persistence: save data is M6. In M3, keep the learned set in memory behind a small interface (load(learned[]) / learned()) and treat every new session as a first play. SSP-186 persists it to `tutorial.learned` (TECHNICAL_DESIGN §16).
Compiler: SSP-077 validates EventSpec generically. Add `tutorial_beat` validation (trigger in the known set, non-empty text, Puddle Lane only) and emit the beats in the compiled schedules.
The GDD §16.1 rule that the timer waits for the first brush-lower on first play needs save data, so it stays a hook (SSP-062).

Beat 3 ('Keep it under 9 mph…') also highlights the Brush-o-meter clean zone (GDD §16.2). SSP-299 exposes the highlight hook. Beat 7 ('the arrow'll show you') relies on that issue's off-screen depot arrow, which appears automatically at hopper ≥ 80%. Barks for Tuesday onward are SSP-302, which extends this prompt layer.

## Scope

- Author 13 tutorial_beat events in assets-src/levels/puddle_lane.level.json with tokenised text; recompile
- compile-level.ts: tutorial_beat validation (known trigger names) and compiled output
- Prompt layer (pure, under src/ui): trigger evaluation from events and read-only state, once-per-shift firing, the learned set, cancel-on-performed, and one prompt at a time via the radio panel
- Beat-12 camera-rect check injected from ShiftScene
- In-memory learned-set interface for SSP-186 to persist
- Doc updates: trigger definitions in LEVEL_DESIGN §4.4, token syntax in §8.4, the learned rule in GDD §16.1
- A unit test per trigger; a GDD text fidelity test; an e2e script for the first minutes
- Beat 3: drive the Brush-o-meter clean-zone highlight through the SSP-299 hook while the beat shows

## Out of scope

- Saving learned beats, and the first-play timer rule (SSP-186 / M6)
- The Show tips setting UI (SSP-235)
- Barks for Tuesday and later (stains, hydrant, etc.), which belong with those districts
- Remapped glyphs (SSP-236) and touch glyphs (SSP-262)
- Tue–Sun 'new idea' barks and their triggers (SSP-302)

## Acceptance criteria

- [ ] Unit test: rendering each of the 13 compiled beats with the default keyboard bindings equals the GDD §16.2 'Pam says' text with the bold markup removed
- [ ] Unit test per trigger: each beat fires exactly once per shift on its trigger and not before (e.g. beat 2 at ≥ 10 m driven, not at 9.9 m; beat 13 on the 60 s timer event)
- [ ] Unit test: when two triggers fire in the same tick, the prompts show one after the other, never together
- [ ] Unit test: lowering the brush while beat 2 is queued or showing cancels or dismisses it and marks 'brush' learned; a learned beat does not fire in the next shift of the same session
- [ ] `npm run levels` rejects a tutorial_beat with an unknown trigger with a named error, and is deterministic (compile twice, same hash)
- [ ] e2e: a scripted Puddle Lane start shows beat 1 at shift start, then beat 2 after driving 10 m, read through a test hook that lists the current prompt
- [ ] npm run test:replay hashes are unchanged (no sim changes)
- [ ] Unit test: while beat 3 shows, the HUD model reports the Brush-o-meter clean-zone highlight; it clears when the beat is dismissed or cancelled

## Verification

- npm run levels
- npm run typecheck && npm run lint && npm test
- npm run test:replay
- npm run test:e2e

## Dependencies

**Depends on:**

- [SSP-289](SSP-289-pam-radio-panel.md) Add Big Pam's HUD radio panel with a one-at-a-time bark queue and inline key glyphs
- [SSP-077](SSP-077-compile-spawn-specs.md) Compile NPC, traffic, hazard, knockable and power-up spawn specs from level.json
- [SSP-104](SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up
- [SSP-062](../M2/SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event
- [SSP-063](../M2/SSP-063-scoring-combo.md) Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger
- [SSP-064](../M2/SSP-064-tidy-frontages.md) Compute Tidy %, per-frontage clean % and Clean Sweep bonuses incrementally
- [SSP-078](SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-083](SSP-083-behaviour-doris.md) Implement Doris (npc.old_woman): glare, fist-shake slowdown, spray chase, handbag whack
- [SSP-087](SSP-087-behaviour-cat.md) Implement the cat: perch, dart on approach, groom, bolt, and ride Bessie's roof
- [SSP-035](../M1/SSP-035-world-tick-order.md) Add World, EventQueue and fixed tick order with surface grip and kerb jolts
- [SSP-047](../M1/SSP-047-camera-lookahead-zoom.md) Drive camera look-ahead and speed zoom from Bessie's real speed
- [SSP-299](SSP-299-hud-brush-tidy-arrows.md) Add the Brush-o-meter, brush state ring, district name with Tidy % bar, and off-screen depot/hydrant arrows to the HUD

**Blocks:**

- [SSP-109](SSP-109-close-m3.md) Close M3: verify the exit criteria, sync docs, state the frozen entity list, tag m3
- [SSP-186](../M6/SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub
- [SSP-302](../M6/SSP-302-district-idea-barks.md) Extend Pam's prompt layer to the Tue–Sun 'new idea' barks and author them per district
- [SSP-235](../M7/SSP-235-settings-scene.md) Build SettingsScene with audio, display, accessibility and assist pages
- [SSP-236](../M7/SSP-236-input-remapping.md) Add keyboard and gamepad remapping for every action, with persistence
- [SSP-262](../M8/SSP-262-touch-menus-prompts.md) Make every menu and prompt usable by tap, with touch-aware glyphs

## References

- ../../GDD.md#161-principles
- ../../GDD.md#162-puddle-lane-first-play-script-proposed-m2m3
- ../../GDD.md#172-accessibility-features
- ../../LEVEL_DESIGN.md#43-event-catalogue
- ../../LEVEL_DESIGN.md#44-tutorial-beats-monday-only
- ../../LEVEL_DESIGN.md#84-leveljson-schema
- ../../TECHNICAL_DESIGN.md#16-save-data-and-settings

## Roadmap tasks covered

_None._
