---
id: SSP-177
title: "Implement the pure adaptive-music state machine for drums and lead stems"
milestone: M5
status: todo
type: feature
estimate: M
labels: [type:feature, area:audio, area:test, size:M, vertical-slice]
depends_on: [SSP-063, SSP-062]
blocks: [SSP-178, SSP-194, SSP-219, SSP-239, SSP-243]
---

# SSP-177: Implement the pure adaptive-music state machine for drums and lead stems

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** feature · **Size:** M · **Areas:** audio, test · **Vertical slice**

## Summary

Encode the adaptive stem rules as a pure, clock-driven state machine that outputs scheduled per-stem gain ramps. It covers drums at combo ×3 with hysteresis and the penalty hard cut, lead under 60 s, the end-of-shift fade, and the adaptive-off toggle. It is unit-testable without WebAudio.

## Context

**Canonical rules** (AUDIO_DESIGN §9.1): `drums` fades in at **combo ×3 or higher** (chain ≥ 25, GDD §10.2); `lead` enters when the **shift timer is under 60 s**; `base` plays throughout. Adaptivity is gain automation only: no tempo change, re-sequencing or branching.

**States:** Base, BaseDrums, BaseLead, AllStems (§9.2).

**Details** (§9.3):
- Drums fade-in starts on the **next beat**, as a 1.0 s linear-in-dB ramp to 0 dB.
- When the multiplier drops below ×3 by chain timeout (2.0 s with no pickup), the drums **hold for 2 bars**; regaining ×3 within the hold changes nothing; otherwise they **fade out over 2.0 s**.
- On a penalty (chain reset), drums **hard cut at the next 1/8 note** with a 15 ms anti-click ramp.
- Lead enters on the next bar line after the timer passes 60.0 s, with a 0.5 s ramp, and **never leaves**.
- `pwr.flask_of_tea` causes no music change.
- At timer 0, all stems fade over 1 bar (capped at 2.0 s), then `jng.tally`.
- SACKED/TOWED: stems cut immediately, then the jingle (`jng.sacked`; `jng.towed` is M6).
- Pause: stems keep their positions (handled by the mixer duck).
- 'Adaptive music' off: base + drums + lead all at 0 dB for the whole shift.

**Inputs:** combo multiplier/chain and whether a drop came from timeout or penalty (read-only combo state or events), ticks remaining (240 s = 14,400 ticks at 60 Hz; 60 s = 3,600 ticks), and the song clock (bpm, beatsPerBar from music.json, song start time, current context time).

**Output:** a list of `{stem, atTime, targetDb, rampSec, kind}` for music.ts to schedule, plus jingle requests.

**Tests:** `tests/unit/audio/director.test.ts` (or a new `tests/unit/audio/musicState.test.ts`) must cover drums hysteresis, the penalty hard cut and lead at 60 s (the 'Adaptive stems' measurable check). Add a property test in `tests/property/audio.prop.test.ts` that stem gains are monotonic over each fade.

**Doc conflict:** TECHNICAL_DESIGN §14.3 says 'Fades are 0.5 s gain ramps aligned to the next bar'. AUDIO_DESIGN (the owner) specifies drums 1.0 s on the next beat and lead 0.5 s on the next bar. Implement AUDIO_DESIGN and update the TECHNICAL_DESIGN mirror in the same PR.

The Free Sweep rules (§9.4) are M6.

Suggested location: a pure module such as `src/audio/musicState.ts` used by `music.ts`.

## Scope

- Pure state machine module with quantisation helpers (next beat, next bar, next 1/8)
- Handling of timeout vs penalty drops, the 2-bar hold window, lead latch, end-of-shift fade, SACKED/TOWED cut, adaptive-off mode
- Unit tests for each §9.3 row plus a fast-check monotonic-fade property
- TECHNICAL_DESIGN §14.3 mirror correction

## Out of scope

- WebAudio scheduling and stem playback (issue SSP-178)
- Free Sweep / `mus.workshop` rules (M6)

## Acceptance criteria

- [ ] Test: at 112 bpm, when the multiplier reaches ×3 at song time t, the drums ramp starts at the next beat boundary ≥ t and lasts 1.0 s to 0 dB
- [ ] Test: a chain-timeout drop below ×3 followed by regaining ×3 within 2 bars schedules no fade; without regain, a 2.0 s fade-out starts exactly 2 bars after the drop
- [ ] Test: a penalty reset while drums play schedules a cut at the next 1/8-note boundary with a 15 ms ramp
- [ ] Test: when ticks remaining crosses 3,600 (60.0 s), lead enters at the next bar line with a 0.5 s ramp, and no later input removes it
- [ ] Test: at timer 0, every stem fades over min(1 bar, 2.0 s) and a `jng.tally` request follows; on SACKED, stems cut immediately and `jng.sacked` is requested
- [ ] Test: with adaptive music off, all stems are at 0 dB from the start and no transitions are emitted
- [ ] Property: for any input sequence, each scheduled fade is monotonic
- [ ] TECHNICAL_DESIGN §14.3 matches AUDIO_DESIGN §9.3

## Verification

- npm test -- tests/unit/audio tests/property/audio.prop.test.ts
- npm run typecheck && npm run lint

## Dependencies

**Depends on:**

- [SSP-063](../M2/SSP-063-scoring-combo.md) Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger
- [SSP-062](../M2/SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event

**Blocks:**

- [SSP-178](SSP-178-music-player.md) Implement music.ts: sample-locked stems, loops, jingles and scene music
- [SSP-194](../M6/SSP-194-audio-mus-workshop.md) Compose mus.workshop 'Tea Break' and implement the mus.workshop fallback rule
- [SSP-219](../M6/SSP-219-audio-mus-conker-hill.md) Compose mus.conker_hill 'Conker Crunch' 6/8 jig with adaptive stems
- [SSP-239](../M7/SSP-239-audio-access-settings.md) Wire audio accessibility settings live: captions via SSP-184, mono, loud sounds, beeper, adaptive music
- [SSP-243](../M7/SSP-243-song-promenade.md) Compose and render mus.promenade "Seagull Surf" with adaptive stems

## References

- ../../AUDIO_DESIGN.md#91-canonical-rules
- ../../AUDIO_DESIGN.md#92-state-machine
- ../../AUDIO_DESIGN.md#93-details
- ../../GDD.md#102-combo-chain
- ../../TECHNICAL_DESIGN.md#143-music-and-live-synths

## Roadmap tasks covered

- Measurable check: Adaptive stems — `drums` fades in at combo ×3 or higher, `lead` enters when the timer is under 60 s (unit test on the music state machine)
- `Exit criterion: Title + Puddle Lane + High Street songs with adaptive stems. (adaptive logic)`
