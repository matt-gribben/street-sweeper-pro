---
id: SSP-176
title: "Wire sim events to sfx cues through a pure audio director"
milestone: M5
status: todo
type: feature
estimate: M
labels: [type:feature, area:audio, area:gameplay, area:test, size:M, vertical-slice]
depends_on: [SSP-175, SSP-173, SSP-043, SSP-058, SSP-059, SSP-062, SSP-063, SSP-078, SSP-082, SSP-092, SSP-093, SSP-075, SSP-286]
blocks: [SSP-184, SSP-185, SSP-245]
---

# SSP-176: Wire sim events to sfx cues through a pure audio director

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** feature · **Size:** M · **Areas:** audio, gameplay, test · **Vertical slice**

## Summary

Implement the pure `(event, audioState) → cue[]` director and subscribe it to the typed event bus, so every Mon–Tue gameplay event plays the right `sfx.*` variant and triggers the right ducks. Audio reads the bus and state, and never writes sim state.

## Context

**Director:** the pure function `(event, audioState) → cue[]` lives in `src/audio/sfx.ts` (AUDIO_DESIGN §3.2). It is unit-tested with no WebAudio in `tests/unit/audio/director.test.ts`. Event names in `src/app/events.ts` are authoritative.

**Known events:** TECHNICAL_DESIGN §7.2 lists `EV.LitterCollected`, `EV.Fling`, `EV.Impact` (magnitude = normal speed `vn`, x, y), `EV.NpcHit`, `EV.Complaint`, `EV.ComboTier`, `EV.HopperFull`, `EV.DumpStart`, `EV.Horn`, `EV.ShiftEnd`; §8.2 adds `EV.KerbJolt` and `EV.ReverseBeeper`.

**Mapping** (§5.4, §5.5):
- LitterCollected → `pickup_small` (LU ≤ 1), `pickup_big` (LU ≥ 2), `pickup_glass` (`litter.glass_bottle` or swept `haz.broken_glass`), with the chain passed for the ladder.
- Fling → `fling`; a glass fling adds `pickup_glass:smash`.
- Impact: `bump_wall` for normal speed 0.5–3 m/s (gain −12 dB at 0.5 → 0 dB at 3), `crash` above 3 m/s, for any vehicle hit, at `haz.open_manhole` and at TOWED.
- KerbJolt / pothole / speed bump → `bump_kerb`.
- Complaint → `complaint_stamp`; the 5th triggers `jng.sacked` through music.
- ComboTier → `combo_tier:x2..x5`; style bonuses → `combo_tier:bonus`, plus every 3 s of Kerb Hugger contact.
- HopperFull → `hopper_full:full`, `:warn` at 80%, `:clunk` per shoved item (≤ 1 per 400 ms).
- DumpStart → `dump` (skip: durationScale 0.667).
- Horn → `horn:bessie` (`two_tone` with `upg.two_tone_horn`, M6); traffic blocked 3 s → `horn:car` (positional).
- Brush toggle → `brush_lower` / `brush_raise`.
- Puddle > 3 m/s → `splash`; `:soak` with `ped_oi` if a pedestrian is within 1.5 m; hydrant refill start → `splash:refill`.
- Knockables → `cone_knock` (cone / a_board / trolley / box); `bin_knock` / `:burst`.
- NPC hits and reactions → `entities.json` `sfx.hit` / `sfx.horn` (e.g. Doris `granny_harrumph`, `:whack` per handbag hit), `cat_yowl` / `:hiss`, `pigeon_flap` once per flock (gain −6 dB at 6 birds, 0 dB at 12), `ped_oi` (+ `cough`, `tut`, `huh`).
- `pwr.*` → `powerup`; `:expire` 1 s before end; `collect.*` → `powerup:collect`, `collect.golden_crisp` → `:golden`.
- Timer → `timer_warn:thirty` at 30 s, `:tick` at 10..4 s, `:final` at 3, 2, 1 s.
- §5.5 reuse rules: Lead Tangle = `dog_bark` + `ped_oi` 120 ms later; occupied zebra = `ped_oi` + `complaint_stamp`; horn-spam complaint = `complaint_stamp`; Road Rage = `horn:car` at 3, 6, 9 s then `complaint_stamp`.

**Bark pitch offsets** (semitones): `npc.kid_*` +5, `npc.shopper` ±2 by outfit swap index, `npc.jogger` +1, `npc.businessman` −3, `npc.old_man_frame` −5, `npc.reveller` −2 (+40 cents of wobble), `npc.inspector` −4, `npc.lollipop_lady` +2, everyone else 0.

**Ducks** (via the mixer): complaint_stamp, voice barks, crash, combo_tier, powerup, timer_warn (tick/final), horn.

**Resolve ENTITY_CATALOG §17 Q11** (SFX gaps) using the §5.5 mappings: banana spin-out = engine tyre-squeal layer; Lead Tangle as above; seagull snatch = `seagull_squawk`; handbag whack = `granny_harrumph:whack`; pothole/speed-bump spill = `bump_kerb`. Update the catalog row in the same PR.

**Conflict to resolve:** ENTITY_CATALOG §3.2 says `crash` plays 'above the damage threshold' (2 m/s), while AUDIO_DESIGN §5.4 says above 3 m/s. AUDIO_DESIGN owns audio (CLAUDE.md §2), so use 3 m/s and fix the catalog sentence in the same PR.

**If an event is missing** (brush toggle, splash, timer thresholds): prefer deriving it in audio from read-only state diffs. Adding a new EV type changes the event queue, which is part of the replay hash input (TECHNICAL_DESIGN §7.2), so it needs re-recorded hashes and a stated reason (ROADMAP §5.3).

Entities that arrive in M6 (police, ice-cream van, seagull, loose dog, kids, coin payouts) are mapped in the table and unit-tested only.

**UI navigation sounds** (GDD §6.1 menu navigation; AUDIO_DESIGN §5.4 UI rows): SSP-286 emits typed `UiMove` / `UiSelect` / `UiBack` events on `src/app/events.ts` and plays nothing. The director maps them to `ui_move`, `ui_select` and `ui_back` on the `ui` bus (1 voice each; 40 / 80 / 80 ms cooldowns from the sources). AUDIO_DESIGN's 'denied' case (cannot afford) plays `ui_back` twice, 90 ms apart. Accept an optional `denied` flag on UiBack (or a UiDenied event) and document it in `events.ts` so the Workshop (SSP-193) can emit it. These are app-bus events, not sim EV entries, so they are outside the replay hash. They play in every scene once audio is unlocked (dropped before unlock, TECHNICAL_DESIGN §14.1). They still play under PauseOverlay, because the pause mix silences sfx, voice, live and amb but not the ui bus.

## Scope

- Pure director with a typed cue table keyed by the 32-ID union
- Bus subscription in sfx.ts (gated by unlock), dispatching cues to the voice pool and ducks to the mixer
- Bark pitch offsets, impact-speed gain mapping, rate-limited clunk, timer threshold detection
- ENTITY_CATALOG Q11 resolution and the crash-threshold sentence fix (doc edits)
- `tests/unit/audio/director.test.ts`
- UiMove / UiSelect / UiBack (from SSP-286) → `ui_move` / `ui_select` / `ui_back` cues on the ui bus, including the doubled 'denied' `ui_back`

## Out of scope

- Live synth state mapping (synth issues)
- Music stem state changes (issue SSP-177)
- Captions (issue captions); haptics/rumble

## Acceptance criteria

- [ ] Test: LitterCollected with LU 1 at chain 27 yields `pickup_small` with ladder +5 semitones; with LU 2 it yields `pickup_big`; for glass_bottle it yields `pickup_glass`
- [ ] Test: Impact vn = 0.5, 2.0 and 3.5 m/s yields bump_wall at −12 dB, bump_wall at the linearly interpolated gain, and crash; vn < 0.5 yields no cue
- [ ] Test: the 5th Complaint yields `complaint_stamp` plus a request to music for `jng.sacked`
- [ ] Test: timer cues fire exactly at 30 s (thirty), 10–4 s (tick) and 3, 2, 1 s (final), once each
- [ ] Test: a Lead Tangle produces dog_bark then ped_oi 120 ms later
- [ ] Test: the director is pure (same inputs give the same outputs; inputs are not mutated); the import scan shows src/audio imports from `src/sim` only types and read-only views
- [ ] `npm run test:replay` hashes are unchanged, or re-recorded with a stated reason if an EV type was added
- [ ] ENTITY_CATALOG §17 row 11 and the §3.2 crash sentence are updated
- [ ] Test: UiMove, UiSelect and UiBack each yield exactly one cue (`ui_move`, `ui_select`, `ui_back`) routed to the ui bus; a denied UiBack yields two `ui_back` cues 90 ms apart
- [ ] Test: with the mixer in Pause mode, a UiSelect cue is still dispatched to the ui bus (not gated by the pause mix)

## Verification

- npm test -- tests/unit/audio/director.test.ts
- npm run test:replay
- npm run test:e2e (smoke runs muted with no console errors from src/audio)
- npm run typecheck && npm run lint

## Dependencies

**Depends on:**

- [SSP-175](SSP-175-sfx-voice-pool.md) Implement sfx.ts playback: voice pool, variants, pitch ladder and spatial pan
- [SSP-173](SSP-173-mixer-buses-ducking.md) Implement mixer.ts: bus graph, limiter, settings levels and ducking engine
- [SSP-043](../M1/SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-058](../M2/SSP-058-hopper.md) Implement hopper.ts LU accounting, mass coupling and bulldozer state
- [SSP-059](../M2/SSP-059-brush.md) Implement brush.ts state machine, suction, inlet collection and fling roll
- [SSP-062](../M2/SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event
- [SSP-063](../M2/SSP-063-scoring-combo.md) Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger
- [SSP-078](../M3/SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-082](../M3/SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-092](../M3/SSP-092-knockable-bodies.md) Implement bodies.ts knockable impulse bodies with spills and penalties
- [SSP-093](../M3/SSP-093-hazards-grip-jolts.md) Implement hazard grip overrides, jolts, LU spills and the open-manhole hard stop
- [SSP-075](../M3/SSP-075-entity-data-freeze.md) Freeze the Mon–Tue entity set in entities.json and add M3 shared tuning
- [SSP-286](../M3/SSP-286-menu-navigation.md) Implement src/ui/menus.ts: keyboard, gamepad and mouse menu navigation plus input-device glyphs

**Blocks:**

- [SSP-184](SSP-184-captions.md) Add speech-bubble and sound captions for audio cues
- [SSP-185](SSP-185-m5-exit-evidence.md) Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR
- [SSP-245](../M7/SSP-245-song-civic-trophy.md) Compose mus.civic_quarter "Clipboard March" and the jng.trophy jingle

## References

- ../../AUDIO_DESIGN.md#32-data-flow
- ../../AUDIO_DESIGN.md#54-full-sfx-list
- ../../AUDIO_DESIGN.md#55-events-with-no-dedicated-sfx
- ../../AUDIO_DESIGN.md#45-ducking
- ../../TECHNICAL_DESIGN.md#72-event-queue
- ../../TECHNICAL_DESIGN.md#82-per-tick-integration-phase-2
- ../../TECHNICAL_DESIGN.md#142-event--sound
- ../../ENTITY_CATALOG.md#17-open-questions
- ../../ENTITY_CATALOG.md#32-collision-responses
- ../../ROADMAP.md#53-replay-hash-policy

## Roadmap tasks covered

- Wire `sfx.*` to sim events through the event bus. Audio never writes sim state.
