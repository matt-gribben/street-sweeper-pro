---
id: SSP-174
title: "Add unlock.ts, Opus/AAC codec selection and boot-time audio loading"
milestone: M5
status: todo
type: feature
estimate: M
labels: [type:feature, area:audio, area:platform, area:ui, area:test, size:M, vertical-slice]
depends_on: [SSP-173, SSP-161, SSP-157, SSP-142, SSP-144, SSP-044, SSP-006, SSP-284]
blocks: [SSP-175, SSP-178, SSP-185, SSP-264, SSP-272, SSP-273]
---

# SSP-174: Add unlock.ts, Opus/AAC codec selection and boot-time audio loading

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** feature · **Size:** M · **Areas:** audio, platform, ui, test · **Vertical slice**

## Summary

Create the AudioContext suspended and resume it on the first user gesture. Drop events until then, handle tab visibility, show the gamepad-only 'Click or press a key for sound' prompt, and pick one codec set at boot. Also load and decode the audio indexes and SFX sprites.

## Context

**Unlock and lifecycle** (AUDIO_DESIGN §12.4):
1. Create the `AudioContext` at boot, **suspended**, with `latencyHint: 'interactive'` and the device's native sample rate.
2. Resume on the first `pointerdown`, `keydown` or `touchend`. Gamepad presses are **not** user activation, so a gamepad-only player sees a speaker icon plus 'Click or press a key for sound' on the Title screen. The game is fully playable without sound.
3. `visibilitychange`: hidden → suspend the context; visible → resume and re-sync stems (the context clock is preserved).
4. iOS Safari: also resume inside the first `touchend` and play a silent 1-sample buffer in the same handler. Implement it now; **device verification is M8**.
5. Wrap all audio-setting storage in try/catch.

Until unlock, events are **dropped, not queued**, so no burst plays on unlock (TECHNICAL_DESIGN §14.1).

**Codec** (§12.1; TECHNICAL_DESIGN §14.1 says 'non-empty', which is equivalent): once at boot, `new Audio().canPlayType('audio/ogg; codecs=opus')` returning 'probably' or 'maybe' → `.ogg`, otherwise `.m4a`. Only one codec set is ever downloaded.

**Loading** (§12.2): at boot, load `public/assets/audio/sfx.json`, `amb.json` (if present), `music.json` and **all** SFX sprites, decode them once and keep them for the session. The title loads `mus.title` stems (issue SSP-178). Resolve URLs relative to `import.meta.env.BASE_URL` (`base: './'`).

**Test mode:** `?test=1` uses a null mixer and no audio output, but the codec choice and loader must still run so they can be tested: fetch the chosen codec's files and decode via an `OfflineAudioContext` (no `AudioContext` is constructed).

**Measurable check:** 'At runtime, `canPlayType('audio/ogg; codecs=opus')` picks `.ogg` or `.m4a`, tested in Chromium and in WebKit (Playwright).'

Notes:
- Playwright's `webServer` runs `npm run build && npx vite preview --port 4173 --strictPort` (TECHNICAL_DESIGN §20.2), so specs test the built bundle.
- The M0 `playwright.config.ts` is Chromium-only. Add a WebKit project (same @playwright/test 1.64.1, so no new npm dependency; requires `npx playwright install webkit` locally and in the macOS CI job). Update TECHNICAL_DESIGN §18/§19 and the CLAUDE.md §4.1 setup line in the same PR, and flag the CI change.
- The test asserts that the chosen extension matches the browser's own `canPlayType` answer, and that a chosen SFX file fetches and decodes. Do not hard-code which codec each engine picks.
- The prompt uses existing UI text rendering (`src/ui/bitmapText.ts`, Kerbside 5×7) and palette colours by name (CLAUDE.md hard rule 3).
- Budget discrepancy: TECHNICAL_DESIGN §6.3 says SFX < 500 KB total, but AUDIO_DESIGN §12.2/§12.3 says ≈ 0.6 MB. Report the measured size per codec and flag it.
- A6 (prompt vs requiring one click on the Title) is an M7 UX question; implement the prompt.

BootScene exists (SSP-284). Add codec selection and SFX decoding to its parallel load list rather than creating a second loader.

## Scope

- `src/audio/unlock.ts`: suspended creation, gesture listeners (pointerdown/keydown/touchend), one-shot resume, the silent-buffer trick, visibility handling, an `isUnlocked` gate the event dispatch uses
- Codec selection helper and an audio asset loader (indexes + SFX sprites decoded at BootScene; OfflineAudioContext decode in test mode)
- Title-screen speaker icon + 'Click or press a key for sound' prompt, shown when a gamepad is connected and audio is still locked
- Add a Playwright WebKit project and a spec (e.g. `tests/e2e/audioCodec.spec.ts`) testing codec choice and decode in Chromium and WebKit
- Doc updates: TECHNICAL_DESIGN §18.6/§19 and CLAUDE.md §4.1 for WebKit

## Out of scope

- Real-device iOS verification (M8)
- Music stem loading and re-sync logic (issue SSP-178)
- SettingsScene (M7)

## Acceptance criteria

- [ ] Before any gesture, `ctx.state === 'suspended'` and events produce no scheduled sources (unit test with a fake context)
- [ ] After a synthetic `keydown`, the context resumes once and the gesture listeners are removed
- [ ] Events emitted before unlock are not played after unlock (unit test)
- [ ] The Playwright spec passes in both the chromium and webkit projects: the chosen extension is '.ogg' if canPlayType returns 'probably'/'maybe', else '.m4a', and one SFX sprite decodes via `decodeAudioData`
- [ ] Only one codec's audio files are requested during boot (asserted from the Playwright request log)
- [ ] With a gamepad connected and audio locked, the Title shows the prompt; after a click it disappears (unit or e2e test)
- [ ] `visibilitychange` to hidden calls `suspend()`, and visible calls `resume()` (unit test)
- [ ] The PR reports the measured SFX download size per codec

## Verification

- npx playwright install webkit
- npm run test:e2e
- npm test -- tests/unit/audio
- npm run test:visual (if the Title prompt changes a golden; Read expected/actual/diff before updating)

## Dependencies

**Depends on:**

- [SSP-173](SSP-173-mixer-buses-ducking.md) Implement mixer.ts: bus graph, limiter, settings levels and ducking engine
- [SSP-161](SSP-161-render-sfx-core.md) Implement render-sfx.ts: SFX JSON to WAV sprites, ffmpeg encodes and sfx.json
- [SSP-157](../M4/SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art
- [SSP-142](../M4/SSP-142-font-kerbside-5x7.md) Finalise Kerbside 5x7 glyphs, metrics and kerning
- [SSP-144](../M4/SSP-144-ui-icons-panels.md) HUD icons, 9-slice panels, button states and complaint stamp grids
- [SSP-044](../M1/SSP-044-input-devices.md) Implement keyboard and gamepad input producing quantised per-tick InputFrames
- [SSP-006](../M0/SSP-006-npm-scripts-ci-workflow.md) Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow
- [SSP-284](../M2/SSP-284-boot-scene.md) Add BootScene: load atlases, fonts and the palette LUT once, then hand off to the shift flow

**Blocks:**

- [SSP-175](SSP-175-sfx-voice-pool.md) Implement sfx.ts playback: voice pool, variants, pitch ladder and spatial pan
- [SSP-178](SSP-178-music-player.md) Implement music.ts: sample-locked stems, loops, jingles and scene music
- [SSP-185](SSP-185-m5-exit-evidence.md) Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR
- [SSP-264](../M8/SSP-264-ios-audio-unlock.md) Harden unlock.ts for iOS Safari: touchend unlock and background resume
- [SSP-272](../M9/SSP-272-macos-desktop-builds.md) Produce macOS arm64 and x64 Tauri bundles and verify platform parity
- [SSP-273](../M9/SSP-273-windows-desktop-build.md) Produce the Windows x64 Tauri installer and verify parity on WebView2

## References

- ../../AUDIO_DESIGN.md#124-unlock-and-lifecycle-unlockts
- ../../AUDIO_DESIGN.md#121-formats
- ../../AUDIO_DESIGN.md#122-loading-strategy
- ../../TECHNICAL_DESIGN.md#141-mixer-audiomixerts
- ../../TECHNICAL_DESIGN.md#63-loading
- ../../TECHNICAL_DESIGN.md#186-e2e
- ../../TECHNICAL_DESIGN.md#202-vite-configuration

## Roadmap tasks covered

- `unlock.ts`: resume the `AudioContext` on the first `pointerdown`, `keydown` or `touchend`; gamepad-only players get the "Click or press a key for sound" prompt.
- Measurable check: Codec choice — `canPlayType('audio/ogg; codecs=opus')` picks `.ogg` or `.m4a`, tested in Chromium and WebKit
