---
id: SSP-234
title: "Implement the ssp.settings.v1 store in src/app/settings.ts with storage fallback"
milestone: M7
status: todo
type: feature
estimate: M
labels: [type:feature, area:save, area:ui, area:audio, size:M]
depends_on: [SSP-186, SSP-173]
blocks: [SSP-235, SSP-236, SSP-237, SSP-239, SSP-241, SSP-242, SSP-257, SSP-269]
---

# SSP-234: Implement the ssp.settings.v1 store in src/app/settings.ts with storage fallback

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** feature · **Size:** M · **Areas:** save, ui, audio

## Summary

Create (or finish, if M5 left a partial version) the typed, versioned settings store behind every M7 setting: volumes, bindings, assists, accessibility and display. Every later M7 settings, juice and assist issue reads from it, so it lands first.

## Context

Owner of the schema: TECHNICAL_DESIGN §16. Key `ssp.settings.v1`. The only localStorage keys allowed anywhere are `ssp.save.v1` and `ssp.settings.v1` (CLAUDE §5.1).
Documented shape: { v:1, volume:{master:8,music:7,sfx:8,amb:7}, bindings:{throttle:["KeyW","ArrowUp"], brush:["Space"], ...}, padBindings:{brush:0, spray:2, ...}, screenShake:1.0, assists:{autoBrush:false, extraTime:false, chillShift:false}, access:{reduceFlashing:false, reduceMotion:false, toggleSpray:false, instantDump:false, rumble:true, showTips:false}, display:{speedUnits:"mph", speedZoom:true, fullscreen:false}, scaleOverride:null }. Keep `scaleOverride` in the schema. No UI is planned for it in M7.
Volume (AUDIO_DESIGN §4.2): sliders are 0–10 steps. Step n maps to (n − 10) × 3 dB, so 10 = 0 dB, 5 = −15 dB, 1 = −27 dB and 0 = mute. Defaults: Master 8, Music 7, Sound effects 8, Ambience 7. Slider → bus: Master → master; Music → music and jingle; Sound effects → sfx, voice, live and ui; Ambience → amb. mixer.ts already has a 'settings binding' from M5, so keep how it combines slider gain with the default bus gains.
GAP TO CLOSE: AUDIO_DESIGN §13.1 lists audio accessibility settings that TECHNICAL_DESIGN §16 does not include. Add them with these defaults (default in bold): captions Off/**Speech**/Speech+sounds, caption size **1×**/2×, mono audio **Off**, reduce loud sounds **Off**, reversing beeper **Classic**/Broadband/Off, adaptive music **On**. Added fields with defaults do not bump `v`, because the loader fills missing fields from defaults. Update the TECHNICAL_DESIGN §16 JSON in the same change.
Storage: TECHNICAL_DESIGN §16 defines a two-method storage interface, `read(key)` / `write(key, json)`, which the M9 Tauri adapter will also implement. If M6 save.ts already uses such an adapter, reuse it rather than calling localStorage directly.
Rules (TECHNICAL_DESIGN §16):
- Wrap every access in try/catch.
- If storage is unavailable, keep in-memory state, reuse the M6 one-time notice "Progress won't be saved in this browser" (GDD §15.5), and keep running.
- Validate with hand-written structural guards (no zod).
- An invalid or unparsable document is logged, replaced by defaults, and the player is told.
- Run a migration chain `migrations[v]`.
Write policy: 'settings change' is a listed save point, so write ssp.settings.v1 on every committed settings change. That includes changes made from Pause → Settings, because the sim is not ticking while paused. Never write from a per-tick path.
The store needs a subscribe/notify API so the mixer, input layer and renderer can react live without importing scenes. src/sim must never import it (CLAUDE §3 rule 1). Gameplay-affecting flags (assists, instantDump) reach the sim as shift run config, which is the SSP-237 issue.

## Scope

- src/app/settings.ts: typed Settings type, DEFAULT_SETTINGS, load/save through the storage adapter with try/catch, structural validation, migration chain stub, fill-missing-from-defaults, subscribe(listener) API
- Add the AUDIO_DESIGN §13.1 audio accessibility fields with their defaults
- Bind the volume fields to the mixer buses using the (n − 10) × 3 dB mapping and the slider → bus table. Reuse the M5 mapping if it already exists.
- Update the TECHNICAL_DESIGN §16 settings JSON to match the implemented schema
- Unit tests in tests/unit/ for: round trip, corrupted JSON, wrong types, missing fields, a Storage fake whose methods throw, and the volume step → dB mapping

## Out of scope

- Any SettingsScene UI (SSP-235)
- Remapping logic and capture UI (SSP-236)
- Applying assists to the sim (SSP-237)
- Applying audio accessibility behaviour (SSP-239)
- Changes to ssp.save.v1 beyond reusing its storage-unavailable notice

## Acceptance criteria

- [ ] src/app/settings.ts exports a typed settings API, with no `any` and named exports only
- [ ] A fresh profile loads exactly the documented defaults: volume 8/7/8/7, screenShake 1.0, all assists false, rumble true, speedUnits mph, captions Speech, caption size 1×, mono off, reduce loud sounds off, beeper Classic, adaptive music on (unit test)
- [ ] An unparsable or structurally invalid `ssp.settings.v1` value is replaced by defaults and logged to the console (unit test)
- [ ] With a Storage whose getItem/setItem throw, load returns defaults, save does not throw, and the in-memory value persists for the session (unit test)
- [ ] A stored v1 document missing the new fields loads with them filled from defaults, without bumping `v` (unit test)
- [ ] Volume step n produces (n − 10) × 3 dB on the mapped buses, and step 0 is mute (unit test)
- [ ] subscribe() listeners fire once per committed change (unit test)
- [ ] No localStorage key other than `ssp.save.v1` / `ssp.settings.v1` is used anywhere in src/
- [ ] TECHNICAL_DESIGN §16 settings JSON matches the implemented schema

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:replay (hashes must be unchanged)
- grep -rn "localStorage" src/ (only the storage adapter / save.ts / settings.ts)

## Dependencies

**Depends on:**

- [SSP-186](../M6/SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub
- [SSP-173](../M5/SSP-173-mixer-buses-ducking.md) Implement mixer.ts: bus graph, limiter, settings levels and ducking engine

**Blocks:**

- [SSP-235](SSP-235-settings-scene.md) Build SettingsScene with audio, display, accessibility and assist pages
- [SSP-236](SSP-236-input-remapping.md) Add keyboard and gamepad remapping for every action, with persistence
- [SSP-237](SSP-237-assists-sim.md) Wire auto-brush, +60 s timer, Chill Shift and instant dump into the sim
- [SSP-239](SSP-239-audio-access-settings.md) Wire audio accessibility settings live: captions via SSP-184, mono, loud sounds, beeper, adaptive music
- [SSP-241](SSP-241-juice-impact.md) Add screen shake, hit-stop and gamepad rumble with reduce-motion support
- [SSP-242](SSP-242-reduce-flashing.md) Implement the Reduce flashing setting across HUD and world effects
- [SSP-257](../M8/SSP-257-touch-input-device.md) Implement src/input/touch.ts producing the same InputFrame as keyboard and pad
- [SSP-269](../M9/SSP-269-tauri-scaffold.md) Wrap dist/ in a Tauri 2.12.3 desktop shell (ADR, src-tauri/, scripts)

## References

- ../../TECHNICAL_DESIGN.md#16-save-data-and-settings
- ../../AUDIO_DESIGN.md#42-default-bus-levels-and-settings
- ../../AUDIO_DESIGN.md#131-settings
- ../../TECHNICAL_DESIGN.md#141-mixer-audiomixerts
- ../../GDD.md#155-save-behaviour
- ../../ROADMAP.md#m7-10-web-release
- ../../../CLAUDE.md#51-typescript

## Roadmap tasks covered

- `src/scenes/SettingsScene.ts` and `src/app/settings.ts`: remapping, volumes, assists, reduce motion, reduce flashing, Fullscreen toggle. (settings.ts store part)
