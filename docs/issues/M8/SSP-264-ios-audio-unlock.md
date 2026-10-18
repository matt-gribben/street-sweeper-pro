---
id: SSP-264
title: "Harden unlock.ts for iOS Safari: touchend unlock and background resume"
milestone: M8
status: todo
type: feature
estimate: M
labels: [type:feature, area:audio, area:platform, area:test, size:M]
depends_on: [SSP-173, SSP-174, SSP-178, SSP-179, SSP-180, SSP-181, SSP-246, SSP-239]
blocks: [SSP-266]
---

# SSP-264: Harden unlock.ts for iOS Safari: touchend unlock and background resume

**Milestone:** [M8 Touch & Mobile Web](../README.md#m8) · **Type:** feature · **Size:** M · **Areas:** audio, platform, test

## Summary

Implement the iOS-specific parts of the audio lifecycle: resume plus a silent 1-sample buffer inside the first touchend, robust suspend and resume around backgrounding (including WebKit's 'interrupted' state and bfcache restores), and the R-16 'tap for sound' fallback. Everything is unit-tested with a fake AudioContext, ready for real-device verification.

## Context

AUDIO_DESIGN §12.4 (lifecycle contract):
1. The AudioContext is created at boot, suspended, with latencyHint 'interactive' and the native sample rate.
2. It resumes on the first pointerdown, keydown or touchend. Gamepad presses are not user activation; gamepad-only players see a speaker icon with 'Click or press a key for sound' on the Title.
3. visibilitychange → hidden: suspend. Visible: resume and re-sync stems (the context clock is preserved, so stems stay locked).
4. iOS Safari (M8): the context is also resumed INSIDE the first touchend handler, and a silent 1-sample buffer is played in the same handler.
5. All audio-settings localStorage access is in try/catch.
TECHNICAL_DESIGN §14.1: until unlock, events are dropped, not queued.

Risk R-16 (ROADMAP §6): 'iOS Safari audio fails to unlock or resume after backgrounding' (L2 × I2 = 4). Mitigation: unlock.ts resumes on first gesture, plus visibility-change handling. Contingency: a 'tap for sound' prompt.

M8 work:
- Step 4 with resume() and the silent-buffer start called synchronously in the touchend handler (no await before them).
- Handle the context reporting 'interrupted' (WebKit, after calls, Siri or backgrounding) or 'suspended' after it had been running: call resume() again on the next pointerdown or touchend. Do not assume one unlock lasts the session.
- Treat pagehide/pageshow (bfcache restore, event.persisted) like visibilitychange.
- After resume, music.ts re-syncs stems as in step 3. Live synths (engineSynth, brushSynth AudioWorklets) stay frozen while paused (AUDIO_DESIGN §4.5, Pause overlay row).
- R-16 contingency: if the context is not 'running' after the first gesture on the Title or in a shift, show the speaker icon with touch wording ('Tap for sound') when matchMedia('(pointer: coarse)') matches, reusing the existing gamepad-only prompt path. The game stays fully playable muted.
- Tests never construct a real AudioContext (TECHNICAL_DESIGN §14.3; '?test=1 uses a null mixer'). Inject a fake context with a mutable state and resume/suspend/createBuffer spies.

Note for device testing (SSP-266): AudioWorklet needs a secure context (HTTPS), so plain http://<LAN-IP> will not load the engine synths; use an HTTPS host such as the restricted itch.io page (ROADMAP §2.2).

## Scope

- src/audio/unlock.ts: iOS touchend resume + silent 1-sample buffer, re-resume after interrupted/suspended states, pagehide/pageshow handling
- src/audio/music.ts: confirm stem re-sync after resume (fix if needed)
- 'Tap for sound' prompt wording for touch, reusing the gamepad-only prompt UI
- Unit tests: tests/unit/audio/unlock.test.ts with a fake AudioContext and synthetic events
- Update AUDIO_DESIGN §12.4 with any lifecycle details added (interrupted state, pageshow)

## Out of scope

- Real-device verification (SSP-266)
- Changing the mixer, buses or ducking
- Native audio session APIs or a Capacitor wrapper (deferred indefinitely)

## Acceptance criteria

- [ ] Unit test: on the first touchend, resume() and a 1-sample buffer source start() are both called before the handler returns
- [ ] Unit test: events emitted before unlock produce no cues after unlock (dropped, not queued)
- [ ] Unit test: visibility hidden → suspend() called; visible → resume() called and the stem re-sync routine invoked once
- [ ] Unit test: a context that reports 'interrupted' or 'suspended' after having been running is resumed on the next pointerdown or touchend
- [ ] Unit test: pageshow with persisted = true triggers the same resume path as visibility visible
- [ ] Unit test: if the state is not 'running' after the first gesture, the 'Tap for sound' prompt flag is raised, and it clears when the state becomes 'running'
- [ ] tests/e2e/smoke.spec.ts still passes muted with no console errors from src/audio/
- [ ] AUDIO_DESIGN §12.4 matches the implemented lifecycle

## Verification

- npm run typecheck
- npm run lint
- npm test -- audio
- npm run test:e2e

## Dependencies

**Depends on:**

- [SSP-173](../M5/SSP-173-mixer-buses-ducking.md) Implement mixer.ts: bus graph, limiter, settings levels and ducking engine
- [SSP-174](../M5/SSP-174-unlock-codec-loading.md) Add unlock.ts, Opus/AAC codec selection and boot-time audio loading
- [SSP-178](../M5/SSP-178-music-player.md) Implement music.ts: sample-locked stems, loops, jingles and scene music
- [SSP-179](../M5/SSP-179-worklet-infra.md) Set up the AudioWorklet host that shares tools/audio/synth kernels at runtime
- [SSP-180](../M5/SSP-180-engine-synth.md) Implement engineSynth.ts: Bessie's diesel with load, misfire and tyre squeal
- [SSP-181](../M5/SSP-181-brush-suction-synth.md) Implement brushSynth.ts brush, suction fan, scrub crackle and bulldozer layers
- [SSP-246](../M7/SSP-246-audio-complete-audit.md) Verify all 9 songs and 6 jingles ship, and run the full-playthrough mix pass
- [SSP-239](../M7/SSP-239-audio-access-settings.md) Wire audio accessibility settings live: captions via SSP-184, mono, loud sounds, beeper, adaptive music

**Blocks:**

- [SSP-266](SSP-266-ios-device-verification.md) Verify audio unlock, background resume and layout on a real iPhone

## References

- ../../AUDIO_DESIGN.md#124-unlock-and-lifecycle-unlockts
- ../../AUDIO_DESIGN.md#31-modules-srcaudio
- ../../AUDIO_DESIGN.md#45-ducking
- ../../AUDIO_DESIGN.md#14-testing
- ../../TECHNICAL_DESIGN.md#141-mixer-audiomixerts
- ../../TECHNICAL_DESIGN.md#143-music-and-live-synths
- ../../ROADMAP.md#6-risk-register

## Roadmap tasks covered

- iOS Safari: verify `unlock.ts` on a real device, plus audio resume after the app is backgrounded.
