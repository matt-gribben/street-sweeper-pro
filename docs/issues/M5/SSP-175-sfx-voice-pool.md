---
id: SSP-175
title: "Implement sfx.ts playback: voice pool, variants, pitch ladder and spatial pan"
milestone: M5
status: todo
type: feature
estimate: L
labels: [type:feature, area:audio, area:test, size:L, vertical-slice]
depends_on: [SSP-173, SSP-174, SSP-161, SSP-028, SSP-019, SSP-047]
blocks: [SSP-176, SSP-183]
---

# SSP-175: Implement sfx.ts playback: voice pool, variants, pitch ladder and spatial pan

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** feature · **Size:** L · **Areas:** audio, test · **Vertical slice**

## Summary

Build the one-shot playback engine. It covers sprite-offset buffers, random and named variants, the chain pitch ladder and jitter from the audio-only RNG, a 24-voice pool with priority stealing and per-ID limits, and screen-space pan and distance attenuation. The allocation logic is pure and testable without WebAudio.

## Context

**Voices** (AUDIO_DESIGN §4.4): a pool of **24** one-shot voices; live synths are not pooled. When the pool is full, a new sound steals the **oldest voice of the lowest priority below its own**; if there is none, the new sound is dropped. Each ID has `maxVoices` and `cooldownMs` limits from sfx.json, with per-variant `meta` overrides (e.g. `horn:car` 3/300).

**Pitch ladder** (pickups with `pitchLadder: "chain"`): `playbackRate = 2^(min(⌊chain/5⌋, 12)/12)`, with jitter on top. **Exit check:** a unit test on this parameter function proves +1 semitone every 5 chain, capped at +12.

**Variants and jitter:** jitter is uniform ±`pitchJitterCents` (per-variant override where present). Unnamed calls choose randomly among variants without `named: true`; named calls play that variant; IDs that are all-named play nothing on an unnamed call. `durationScale` sets playbackRate (the skip dump uses 0.667). Loop playback with loop points serves `ice_cream_chime`: it loops while the van is stopped and fades over 1 s.

**RNG:** randomness comes from the audio's **own** `sfc32` (from `src/sim/rng.ts`), seeded once per session, from `?seed=` in test mode. Never draw from the sim RNG streams (TECHNICAL_DESIGN §7.3).

**Spatial** (§3.4):
- Pan = `clamp((x_screen − W/2)/(W/2), −1, 1) × 0.6` through a StereoPannerNode.
- Distance gain: 0 dB within 8 m of the camera centre, falling linearly to −18 dB at 24 m, culled beyond 24 m.
- Bessie-attached sources (engine, brush, spray, beeper, horn, pickups) are centred at 0 dB.
- `npc.dog_loose` and `veh.police` barks are never culled within 24 m (M6 entities, but implement the flag).
- Doppler ±60 cents from closing speed, for `police_whoop` and traffic horns (`horn:car`) only.
- Mono setting → pan 0.
- Reduce loud sounds → crash, horn and police_whoop −6 dB (the jingle trims are in music.ts).

**Gain** = bus routing per the sfx.json `bus` + `gainDb` + distance.

The ambience bed player lives in sfx.ts too (issue SSP-183); its sprinkles share this pool.

**Tests:**
- `tests/property/audio.prop.test.ts` (fast-check 4.10.2): for any event sequence, active voices never exceed 24 and no ID exceeds `maxVoices`.
- Pure allocator and parameter functions in Vitest, with no AudioContext.

## Scope

- Buffer cache that slices decoded sprites by sfx.json offsets
- Pure voice allocator (priority stealing, maxVoices, cooldownMs, per-variant meta) plus a WebAudio voice implementation
- Variant picker, pitch ladder function, jitter, durationScale, loop/fade-out support
- Spatial pan/attenuation with Bessie-centred and never-cull flags, simple Doppler for whitelisted IDs, mono and reduce-loud settings (injected from the composition root)
- Audio-only sfc32 stream seeded per session / from `?seed=`
- Unit and property tests

## Out of scope

- Event → cue mapping (issue SSP-176)
- The coin tally ladder (M6 economy)
- The ambience bed scheduler (issue SSP-183)

## Acceptance criteria

- [ ] Test: pitch ladder semitones for chain 0, 4, 5, 9, 10, 59, 60, 1000 are 0, 0, 1, 1, 2, 11, 12, 12, and playbackRate = 2^(s/12)
- [ ] Property test: for random play requests (IDs, priorities, times), active voices ≤ 24 and per-ID active ≤ maxVoices at all times
- [ ] Test: when the pool is full of priority-3 voices, a priority-5 request steals the oldest priority-3 voice; a priority-2 request is dropped
- [ ] Test: a second request for an ID within its cooldownMs is ignored; `horn:car` uses 3/300 while `horn:bessie` uses 1/120
- [ ] Test: pan for x_screen = 0, W/2 and W is −0.6, 0 and +0.6; distance gain at 8 m, 16 m and 24 m is 0, −9 and −18 dB, and a source at 25 m is culled
- [ ] Test: unnamed play of `timer_warn` (all named-only) plays nothing and logs nothing at error level; a named play of `tick` plays
- [ ] Variant and jitter choices are identical across two sessions with the same `?seed=`, and `npm run test:replay` hashes are unchanged

## Verification

- npm test -- tests/unit/audio tests/property/audio.prop.test.ts
- npm run test:replay
- npm run typecheck && npm run lint

## Dependencies

**Depends on:**

- [SSP-173](SSP-173-mixer-buses-ducking.md) Implement mixer.ts: bus graph, limiter, settings levels and ducking engine
- [SSP-174](SSP-174-unlock-codec-loading.md) Add unlock.ts, Opus/AAC codec selection and boot-time audio loading
- [SSP-161](SSP-161-render-sfx-core.md) Implement render-sfx.ts: SFX JSON to WAV sprites, ffmpeg encodes and sfx.json
- [SSP-028](../M1/SSP-028-sim-foundations.md) Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-047](../M1/SSP-047-camera-lookahead-zoom.md) Drive camera look-ahead and speed zoom from Bessie's real speed

**Blocks:**

- [SSP-176](SSP-176-sfx-event-wiring.md) Wire sim events to sfx cues through a pure audio director
- [SSP-183](SSP-183-amb-town-morning.md) Add the ambience bed player and author amb.town_morning

## References

- ../../AUDIO_DESIGN.md#44-voice-management
- ../../AUDIO_DESIGN.md#34-spatialisation-top-down
- ../../AUDIO_DESIGN.md#32-data-flow
- ../../AUDIO_DESIGN.md#52-sfx-source-schema
- ../../AUDIO_DESIGN.md#131-settings
- ../../TECHNICAL_DESIGN.md#142-event--sound
- ../../TECHNICAL_DESIGN.md#73-randomness

## Roadmap tasks covered

- Wire `sfx.*` to sim events through the event bus. Audio never writes sim state. (playback engine half)
- `Measurable check: Pitch rise — pickup SFX pitch rises one semitone every 5 chain, capped at +12 (unit test on the sfx parameter function)`
