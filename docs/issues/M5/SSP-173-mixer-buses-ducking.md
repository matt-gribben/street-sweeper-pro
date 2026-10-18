---
id: SSP-173
title: "Implement mixer.ts: bus graph, limiter, settings levels and ducking engine"
milestone: M5
status: todo
type: feature
estimate: M
labels: [type:feature, area:audio, size:M, vertical-slice]
depends_on: [SSP-043, SSP-019]
blocks: [SSP-174, SSP-175, SSP-176, SSP-178, SSP-179, SSP-183, SSP-185, SSP-301, SSP-192, SSP-194, SSP-195, SSP-234, SSP-239, SSP-246, SSP-264]
---

# SSP-173: Implement mixer.ts: bus graph, limiter, settings levels and ducking engine

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** feature · **Size:** M · **Areas:** audio · **Vertical slice**

## Summary

Build the ~200-line WebAudio mixer: eight buses with their default levels, a safety limiter, 0–10 settings sliders, the slap delay, and a deterministic event-driven ducking engine whose 'deepest wins' resolver is testable without WebAudio.

## Context

**Buses** (AUDIO_DESIGN §4.1–4.2): master 0 dB, music −10, jingle −8, sfx −4, voice −6, live −12, amb −20, ui −8.

**Limiter:** master → DynamicsCompressor (threshold −3 dB, ratio 20, attack 1 ms, release 100 ms) → destination.

**Sliders:**
- 0–10 in `ssp.settings.v1.volume {master, music, sfx, amb}`. Step n → (n − 10) × 3 dB; 0 = mute. Defaults: Master 8, Music 7, Sound effects 8, Ambience 7.
- Slider → buses: Master→master; Music→music + jingle; Sound effects→sfx + voice + live + ui; Ambience→amb.
- Wrap all storage access in try/catch; defaults apply without storage (TECHNICAL_DESIGN §16).

**Import rule** (TECHNICAL_DESIGN §2.1): `src/audio/**` may import only WebAudio, `src/sim` (read-only) and `src/app/events.ts`. So the mixer must not import `src/app/settings.ts`. The composition root (`src/app/Game.ts`) reads settings and passes volumes and accessibility flags into the mixer (setter or constructor).

**Slap delay:** one global 'street' slap delay on the sfx bus: 85 ms, −20 dB, low-passed at 3 kHz. Gasworks uses 120 ms / −16 dB from M6, so make it a parameter.

**Ducking** (§4.5): gain automation, not a sidechain. When ducks overlap on one bus, the **deepest wins**; they never add. Attack, hold and release use `setTargetAtTime` with τ = time/3. Table:
- any `jng.*` → music −∞, 120 ms attack, hold for the jingle length, then music resumes per §9;
- `complaint_stamp` → music and amb −6 dB, 20/400/600 ms;
- voice bark (ped_oi, granny_harrumph, kid_waah, cat_yowl) → music −4, live −6, 15 ms, hold for the bark length, 300 ms release;
- `crash` → music −4, amb −6, live −3, 5/250/500 ms;
- `combo_tier` → music −3, 10/250/400;
- `powerup` → music −3, 10/300/400;
- `timer_warn` (final 10 s only: `tick`/`final`, not `thirty`) → music −2, 5/120/200;
- `horn` → amb −4, 5/300/300;
- Pause → music −9 dB plus a 900 Hz low-pass (150 ms in, 250 ms out); sfx, voice, live and amb at gain 0 with worklets frozen (the ui bus is not silenced, so menu sounds still play);
- Shift intro card → live muted, 400 ms release on dismiss.

**Accessibility:** 'Reduce loud sounds' moves the limiter threshold to −6 dB. The per-sound trims live in sfx.ts and music.ts.

**Test mode:** TECHNICAL_DESIGN §14.3 says tests never construct an `AudioContext`, and `?test=1` uses a **null mixer** with the same interface.

**Libraries:** none (Howler and Tone.js were rejected in ADR 0001; ROADMAP §7).

**Meter tap:** AUDIO_DESIGN §4.3 targets (−18 to −14 LUFS momentary, limiter engaged < 1%) are checked with a SSP-048 meter. The meter is a separate issue (SSP-301). This issue only exposes a read-only `meterTap()` that returns the post-limiter output node and the limiter's DynamicsCompressorNode, so the meter can attach without changing the graph. The null mixer returns null. Do not build any meter, K-weighting or SSP-048 UI here.

**Open:** `src/app/settings.ts` is listed in TECHNICAL_DESIGN §2, but its UI is M7 (SettingsScene). If the file does not exist yet, add a minimal typed reader there for `volume` and the audio accessibility fields, with defaults: mono off, reduceLoud off, beeper 'classic', adaptiveMusic on, captions 'speech'. Adding fields with defaults does not bump `v`. M7 extends it.

## Scope

- `src/audio/mixer.ts`: AudioContext graph, bus GainNodes, limiter, slap-delay send on sfx, master output
- Pure duck resolver (active ducks + time → per-bus target dB), then scheduling via setTargetAtTime with τ = time/3
- Pause and shift-intro modes; reduce-loud limiter threshold
- Settings binding (slider steps → dB) injected from `src/app/Game.ts`; a minimal `src/app/settings.ts` reader if needed, with storage try/catch
- Null mixer used under `?test=1`
- Read-only `meterTap()` accessor (post-limiter node + limiter DynamicsCompressorNode; null on the null mixer) for SSP-301
- Unit tests for slider mapping and the duck resolver; property test that bus gains stay within [−∞, 0] dB

## Out of scope

- SettingsScene UI and sliders (M7)
- Which events trigger ducks (issues SSP-176 and SSP-178)
- Gasworks slap settings (M6)
- BS.1770 momentary loudness meter, limiter-engaged %, and the F1 SSP-048 readout (SSP-301)

## Acceptance criteria

- [ ] Test: slider steps 10, 5, 1 and 0 map to 0, −15, −27 dB and mute
- [ ] Test: with complaint_stamp (−6) and crash (−4) active on music at the same time, the resolver returns −6 dB for music (deepest wins), and returns to 0 dB after the longest release
- [ ] Test: `timer_warn:thirty` produces no duck; `timer_warn:tick` ducks music −2 dB
- [ ] Test (fast-check, `tests/property/audio.prop.test.ts`): for any sequence of duck events, every bus target stays within [−∞, 0] dB
- [ ] Test: in Pause mode the resolver sets sfx, voice, live and amb to gain 0 and leaves the ui bus at its settings level
- [ ] With storage throwing (fake Storage), settings resolve to Master 8, Music 7, Sfx 8, Amb 7 and the mixer initialises
- [ ] Under `?test=1` no AudioContext is constructed (unit test with a constructor spy, or the null mixer type), and the null mixer's `meterTap()` returns null
- [ ] Unit test with a fake AudioContext: `meterTap()` returns the node connected after the limiter and the limiter node itself
- [ ] `src/audio/mixer.ts` imports nothing from `three` or `src/app/settings.ts`, and never writes sim state (lint/import scan passes)

## Verification

- npm test -- tests/unit/audio tests/property/audio.prop.test.ts
- npm run typecheck && npm run lint
- npm run dev, then open the F1 panel and confirm the meter updates (dev build)

## Dependencies

**Depends on:**

- [SSP-043](../M1/SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene

**Blocks:**

- [SSP-174](SSP-174-unlock-codec-loading.md) Add unlock.ts, Opus/AAC codec selection and boot-time audio loading
- [SSP-175](SSP-175-sfx-voice-pool.md) Implement sfx.ts playback: voice pool, variants, pitch ladder and spatial pan
- [SSP-176](SSP-176-sfx-event-wiring.md) Wire sim events to sfx cues through a pure audio director
- [SSP-178](SSP-178-music-player.md) Implement music.ts: sample-locked stems, loops, jingles and scene music
- [SSP-179](SSP-179-worklet-infra.md) Set up the AudioWorklet host that shares tools/audio/synth kernels at runtime
- [SSP-183](SSP-183-amb-town-morning.md) Add the ambience bed player and author amb.town_morning
- [SSP-185](SSP-185-m5-exit-evidence.md) Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR
- [SSP-301](SSP-301-loudness-meter.md) Add the BS.1770 momentary loudness meter and limiter-engagement readout to the F1 dev panel
- [SSP-192](../M6/SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-194](../M6/SSP-194-audio-mus-workshop.md) Compose mus.workshop 'Tea Break' and implement the mus.workshop fallback rule
- [SSP-195](../M6/SSP-195-audio-jingles-star-towed.md) Compose jng.star and jng.towed and wire them to the tally and TOWED end state
- [SSP-234](../M7/SSP-234-settings-store.md) Implement the ssp.settings.v1 store in src/app/settings.ts with storage fallback
- [SSP-239](../M7/SSP-239-audio-access-settings.md) Wire audio accessibility settings live: captions via SSP-184, mono, loud sounds, beeper, adaptive music
- [SSP-246](../M7/SSP-246-audio-complete-audit.md) Verify all 9 songs and 6 jingles ship, and run the full-playthrough mix pass
- [SSP-264](../M8/SSP-264-ios-audio-unlock.md) Harden unlock.ts for iOS Safari: touchend unlock and background resume

## References

- ../../AUDIO_DESIGN.md#41-bus-graph
- ../../AUDIO_DESIGN.md#42-default-bus-levels-and-settings
- ../../AUDIO_DESIGN.md#43-loudness-targets
- ../../AUDIO_DESIGN.md#45-ducking
- ../../AUDIO_DESIGN.md#34-spatialisation-top-down
- ../../AUDIO_DESIGN.md#131-settings
- ../../TECHNICAL_DESIGN.md#141-mixer-audiomixerts
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom
- ../../TECHNICAL_DESIGN.md#16-save-data-and-settings

## Roadmap tasks covered

- `mixer.ts`: master, music, jingle, sfx, voice, live, amb and ui buses ([AUDIO_DESIGN §4.1]); music ducking under jingles and big events.
- `Exit criterion: Mixer with ducking.`
