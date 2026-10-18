---
id: SSP-217
title: "Author amb.rain, amb.wind_leaves, amb.seafront and amb.night_town beds"
milestone: M6
status: todo
type: asset
estimate: M
labels: [type:asset, area:audio, area:assets, size:M]
depends_on: [SSP-205, SSP-183, SSP-161]
blocks: [SSP-233]
---

# SSP-217: Author amb.rain, amb.wind_leaves, amb.seafront and amb.night_town beds

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** asset · **Size:** M · **Areas:** audio, assets

## Summary

Author the four live-synthesised ambience beds for Wednesday, Thursday, Friday and Saturday, including gust swells and Depot Yard inheritance.

## Context

Characters (AUDIO §7.1):
- amb.rain (Wed): steady rain (pink noise low-passed at 5 kHz), gutter drips, distant tower-block hum, an occasional far-off van splash.
- amb.wind_leaves (Thu): wind (noise through a slowly swept band-pass), leaf skitters, a crow, far-off dogs; gusts swell 6 dB.
- amb.seafront (Fri): waves (low-passed noise with a 0.12 Hz swell envelope), distant gulls, arcade bleeps, rattling rigging; haz.wind_gust swells the wind layer.
- amb.night_town (Sat): low urban hum, distant pub singing (a filtered gibberish 'choir'), taxi idles, a far-off siren every 60-120 s, chip-shop sign buzz.
Schema (AUDIO §7.2): assets-src/audio/amb/<name>.json with layers (noise or oscillator source, filter, LFO) and sprinkles (inline zzfx/jsfxr params scheduled from the audio sfc32 stream; not sfx.* IDs and never triggered by gameplay), plus an optional weatherParam. Beds are synthesised live (no rendered files). render-sfx.ts validates every bed and writes the combined public/assets/audio/amb.json. The Depot Yard uses the preceding shift's bed at -4 dB, and ShiftIntroScene plays the district bed at -6 dB (AUDIO §8.4). Gust swells listen for the gust events from SSP-205. The project lead does a listening review.

## Scope

- Four amb JSON sources, validated and combined into amb.json
- Gust swell hook for wind_leaves (+6 dB) and the seafront wind layer
- Depot Yard -4 dB inheritance of the preceding bed
- Unit tests for bed validation and level -> ambience mapping

## Out of scope

- Positional ambience emitters (AUDIO §15.2 A4)
- Music

## Acceptance criteria

- [ ] npm run audio validates all four beds and writes amb.json; assets:verify passes
- [ ] Every district level's ambience field resolves to an existing bed (unit test over the compiled levels)
- [ ] Unit test: a gust event raises the wind layer gain on amb.wind_leaves by 6 dB
- [ ] Unit test: a Skip Run after Wednesday selects amb.rain at -4 dB
- [ ] The lead's listening approval is recorded in the PR

## Verification

- npm run audio
- npm run assets:verify
- npm test

## Dependencies

**Depends on:**

- [SSP-205](SSP-205-wind-leaves-gusts.md) Implement leaf fall, wet leaves and haz.wind_gust litter drift
- [SSP-183](../M5/SSP-183-amb-town-morning.md) Add the ambience bed player and author amb.town_morning
- [SSP-161](../M5/SSP-161-render-sfx-core.md) Implement render-sfx.ts: SFX JSON to WAV sprites, ffmpeg encodes and sfx.json

**Blocks:**

- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag

## References

- ../../AUDIO_DESIGN.md#71-assignment
- ../../AUDIO_DESIGN.md#72-ambience-source-schema-assets-srcaudioambnamejson
- ../../AUDIO_DESIGN.md#84-scene--audio-map
- ../../AUDIO_DESIGN.md#151-plan

## Roadmap tasks covered

- `Audio: ... and the four ambiences above.`
- Rain: grip override 6.0, puddle density, rain particles, `amb.rain`. (amb.rain bed)
