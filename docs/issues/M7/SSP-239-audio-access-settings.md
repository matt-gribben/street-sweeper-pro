---
id: SSP-239
title: "Wire audio accessibility settings live: captions via SSP-184, mono, loud sounds, beeper, adaptive music"
milestone: M7
status: todo
type: feature
estimate: M
labels: [type:feature, area:audio, area:ui, size:M]
depends_on: [SSP-234, SSP-173, SSP-184, SSP-182, SSP-177, SSP-178, SSP-180, SSP-181]
blocks: [SSP-253, SSP-262, SSP-264]
---

# SSP-239: Wire audio accessibility settings live: captions via SSP-184, mono, loud sounds, beeper, adaptive music

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** feature · **Size:** M · **Areas:** audio, ui

## Summary

Make the AUDIO_DESIGN §13.1 settings in ssp.settings.v1 apply live, without a reload. Captions and caption size connect to SSP-184's caption manager, which already implements every caption rule. Mono audio, reduce loud sounds, the reversing beeper and adaptive music connect to their M5 implementations; only real gaps are filled. AUDIO_DESIGN §15.1 assigns 'Accessibility settings complete' to M7.

## Context

Captions are owned by SSP-184 (M5). It builds on the popups.ts bubble manager from SSP-288, which implements display time (1.5 s + 60 ms per character, max 3 s), the at-most-3 limit and same-ID replacement. SSP-184 adds mode filtering (Off / Speech / Speech + sounds), the caption tables, edge captions with arrow glyphs and caption size 1×/2× (Kerbside 5×7 at double scale, or Bold 8×8 when space is short), all with unit tests. Do not re-implement or re-test any of that. This issue only subscribes the caption manager to the `captions` and `captionSize` fields of the settings store (SSP-234) so changes take effect live. Wire it through the composition root, because `src/ui/**` may not import `src/audio` (TECHNICAL_DESIGN §2.1).

The other settings and their effects (AUDIO_DESIGN §13.1), with where the M5 code lives:
- Mono audio forces all pans to 0 (§3.4). Spatial pan is in sfx.ts (SSP-175). Implement the forcing if no M5 issue added it.
- Reduce loud sounds sets `crash`, `horn`, `police_whoop`, `jng.sacked` and `jng.towed` to −6 dB and the limiter threshold to −6 dB (default limiter: thr −3 dB, ratio 20, attack 1 ms, release 100 ms; §4.1). The limiter is in mixer.ts (SSP-173), the sfx trims in sfx.ts (SSP-175) and the jingle trims in music.ts (SSP-178). The setting also turns rumble off, which SSP-241 implements by reading the setting directly.
- Reversing beeper Classic/Broadband/Off (§6.4): the voices are in brushSynth.ts (SSP-182). With the beeper off, the on-screen reverse chevrons carry the cue.
- Adaptive music On/Off: Off holds base, drums and lead at 0 dB for the whole shift (§9.3), in the music state machine (SSP-177).
The mixer must not import settings.ts (SSP-173); the composition root passes the values in. Audit what exists, list the gaps in the PR, and fill only those.

Tests never construct an AudioContext, and `?test=1` uses a null mixer (TECHNICAL_DESIGN §14.3). Put the logic in pure functions and test them the way `tests/unit/audio/director.test.ts` does.

## Scope

- Composition-root wiring from settings.ts (`captions`, `captionSize`) to SSP-184's caption manager, applied live
- Audit the M5 mono, reduce-loud, beeper and adaptive-music implementations against AUDIO_DESIGN §13.1, wire each to settings changes live, and implement only the gaps (listed in the PR)
- Unit tests for each setting's live effect

## Out of scope

- Caption logic: timing, max-3 and replacement (popups.ts bubble manager, SSP-288), mode filtering, placement and caption-size rendering (SSP-184)
- SettingsScene controls (SSP-235)
- Rumble (SSP-241)
- New SFX or captions not in AUDIO_DESIGN §13.2

## Acceptance criteria

- [ ] Each of the six AUDIO_DESIGN §13.1 settings changes runtime behaviour live when the settings store changes, without a reload
- [ ] Unit test: switching `captions` from Speech to Speech+sounds in the store makes the next `cat_yowl` cue reach SSP-184's manager in Speech+sounds mode ('[Cat yowls]'); switching to Off suppresses new captions
- [ ] Unit test: switching caption size from 1× to 2× in the store changes the caption manager's size parameter with no reload
- [ ] Unit test: Reduce loud sounds gives the five listed IDs −6 dB and sets the limiter threshold to −6 dB, and turning it off restores −3 dB
- [ ] Unit test: Mono audio forces every pan to 0
- [ ] Unit test: with Adaptive music Off, all three stems stay at 0 dB across combo and timer changes
- [ ] Unit test: Beeper Off produces no beeper voice, and Broadband selects the noise voice; the reverse chevrons still show
- [ ] No caption timing, max-3 or replacement logic is added outside popups.ts and SSP-184's caption manager (review/grep)
- [ ] The e2e smoke test still passes muted

## Verification

- npm run typecheck && npm run lint && npm test
- npm run test:e2e
- Manual: npm run dev, toggle each setting during a shift and listen

## Dependencies

**Depends on:**

- [SSP-234](SSP-234-settings-store.md) Implement the ssp.settings.v1 store in src/app/settings.ts with storage fallback
- [SSP-173](../M5/SSP-173-mixer-buses-ducking.md) Implement mixer.ts: bus graph, limiter, settings levels and ducking engine
- [SSP-184](../M5/SSP-184-captions.md) Add speech-bubble and sound captions for audio cues
- [SSP-182](../M5/SSP-182-spray-beeper-synth.md) Add spray (sputter, dry pump, refill) and reverse-beeper voices to brushSynth
- [SSP-177](../M5/SSP-177-music-state-machine.md) Implement the pure adaptive-music state machine for drums and lead stems
- [SSP-178](../M5/SSP-178-music-player.md) Implement music.ts: sample-locked stems, loops, jingles and scene music
- [SSP-180](../M5/SSP-180-engine-synth.md) Implement engineSynth.ts: Bessie's diesel with load, misfire and tyre squeal
- [SSP-181](../M5/SSP-181-brush-suction-synth.md) Implement brushSynth.ts brush, suction fan, scrub crackle and bulldozer layers

**Blocks:**

- [SSP-253](SSP-253-browser-scaling-qa.md) Run cross-browser, scaling and storage-blocked verification for 1.0
- [SSP-262](../M8/SSP-262-touch-menus-prompts.md) Make every menu and prompt usable by tap, with touch-aware glyphs
- [SSP-264](../M8/SSP-264-ios-audio-unlock.md) Harden unlock.ts for iOS Safari: touchend unlock and background resume

## References

- ../../AUDIO_DESIGN.md#131-settings
- ../../AUDIO_DESIGN.md#132-caption-table
- ../../AUDIO_DESIGN.md#34-spatialisation-top-down
- ../../AUDIO_DESIGN.md#41-bus-graph
- ../../AUDIO_DESIGN.md#64-reverse-beeper
- ../../AUDIO_DESIGN.md#9-adaptive-music
- ../../AUDIO_DESIGN.md#151-plan
- ../../TECHNICAL_DESIGN.md#141-mixer-audiomixerts

## Roadmap tasks covered

- `src/scenes/SettingsScene.ts` and `src/app/settings.ts`: remapping, volumes, assists, reduce motion, reduce flashing, Fullscreen toggle. (audio accessibility applied at runtime)
