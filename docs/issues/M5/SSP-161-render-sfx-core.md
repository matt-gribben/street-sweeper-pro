---
id: SSP-161
title: "Implement render-sfx.ts: SFX JSON to WAV sprites, ffmpeg encodes and sfx.json"
milestone: M5
status: todo
type: feature
estimate: L
labels: [type:feature, area:audio, area:tooling, area:assets, size:L, vertical-slice]
depends_on: [SSP-159, SSP-025, SSP-010, SSP-117]
blocks: [SSP-162, SSP-163, SSP-164, SSP-165, SSP-167, SSP-168, SSP-174, SSP-175, SSP-183, SSP-217]
---

# SSP-161: Implement render-sfx.ts: SFX JSON to WAV sprites, ffmpeg encodes and sfx.json

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** feature · **Size:** L · **Areas:** audio, tooling, assets · **Vertical slice**

## Summary

Build the offline SFX renderer. It reads `assets-src/audio/sfx/*.json`, generates samples deterministically with zzfx or jsfxr, writes 44.1 kHz 16-bit mono WAV sprites, encodes Opus and AAC with bit-exact ffmpeg flags, and emits the `public/assets/audio/sfx.json` index and WAV hashes. It also settles the two schema extensions the §5.4 table needs (mixed integer + named variants, per-variant metadata).

## Context

**Schema** (AUDIO_DESIGN §5.2): `{ id, engine: "zzfx"|"jsfxr", params, variants, pitchJitterCents, pitchLadder?, bus, gainDb, priority (1–5), maxVoices, cooldownMs, caption }`.
- `variants` is either an integer N (N seeded mutations driven by a `mutate` block of ± relative ranges, plus `seed`) or a named list `[{name, named?: true, overrides}]`.
- Optional fields: `params.layers [{at, gainDb, semitones, params}]` (mixed sample-accurately), `loop {start, end}`, `durationScale`.
- zzfx named params map to ZzFX's positional array in this order: volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide, deltaSlide, pitchJump, pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay, sustainVolume, decay, tremolo, filter.
- jsfxr uses its own names (`wave_type`, `p_env_*`, `p_base_freq`, ..., `sound_vol`). The renderer forces `sample_rate` 44100 and `sample_size` 16.

**Schema gaps to close here (document both in AUDIO_DESIGN §5.2 in the same PR):**
1. **Mixed variants.** §5.4 lists `3 + soakᴺ, refillᴺ` (splash), `2 + hissᴺ` (cat_yowl), `4 + settleᴺ` (dog_bark), `6 + coughᴺ, tutᴺ, huhᴺ` (ped_oi), `3 + whackᴺ` (granny_harrumph) and `3 + smashᴺ` (pickup_glass, from the fling row). The §5.2 schema allows only an integer or a named list. Proposal: named-list entries may carry `count: N`, meaning N seeded mutations of that entry, all unnamed-pickable (e.g. `[{name:"yowl", count:2}, {name:"hiss", named:true, overrides:{...}}]`).
2. **Per-variant metadata.** `horn` needs voices/cooldown 1/120 (bessie) vs 3/300 (car); `hopper_full` and `horn` need per-variant jitter (0/0/40, 0/0/30). Proposal: optional `variants[i].meta: {maxVoices?, cooldownMs?, pitchJitterCents?}` overriding the file-level values, carried into sfx.json.

**Lint** (AUDIO_DESIGN §14): zzfx base params require `"randomness": 0`; `bus` must be one of the §4.1 buses (sfx, voice, ui, amb, live, jingle, music); `priority` must be 1–5.

**Render:**
- Peak-normalise **each variant** to −1 dBFS.
- Concatenate the variants of one ID into one file with 50 ms (2,205 samples) of silence between them, and write their offsets into `public/assets/audio/sfx.json`. The index format beyond 'offsets' is unspecified. Include the runtime metadata the player needs: per variant `name`, `named`, `offsetSamples`, `lengthSamples`, `meta`; per ID bus, gainDb, priority, maxVoices, cooldownMs, pitchJitterCents, pitchLadder, loop, durationScale, caption. Mark IDs whose variants are all named (`combo_tier`, `timer_warn`) so the player never picks them randomly.
- Do **not** trim leading silence: `granny_harrumph` bakes in 150 ms.

**Paths:**
- Sources: `assets-src/audio/sfx/<name>.json`, where name is the ID minus `sfx.`.
- WAVs: `build/tmp/audio/sfx/<name>.wav` (git-ignored).
- Outputs: `public/assets/audio/sfx/<name>.ogg` and `.m4a`.

**Encode** (AUDIO_DESIGN §11.3, exact, ffmpeg 9.0.2):
- Opus: `-hide_banner -nostdin -y -i X.wav -c:a libopus -b:a 64k -vbr on -application audio -ac 1 -bitexact -map_metadata -1 X.ogg`
- AAC: `-hide_banner -nostdin -y -i X.wav -c:a aac -profile:a aac_low -b:a 96k -ac 1 -movflags +faststart -bitexact -map_metadata -1 X.m4a`. Use the native encoder, never `aac_at`.
- The ffmpeg binary is at `/opt/homebrew/bin/ffmpeg` on the dev Mac (CLAUDE.md §4.4, not on PATH). CI on ubuntu has no Homebrew path, so put the path in one shared helper (e.g. `tools/audio/ffmpeg.ts`) with an env override (e.g. `SSP_FFMPEG`); the report and music renderers reuse it.

**Hashes:** WAV sha256 values go into `public/assets/asset-hashes.json` alongside the image hashes. Merge, do not clobber the forge's entries; keep keys sorted for stable diffs.

**Flags:** `--only <name>` and `--out <dir>`. `forge verify` runs the audio tools with `--out` pointed at its temp root (`build/tmp/verify/`, ASSET_PIPELINE §5.2), so under `--out` mirror the repo-relative layout inside `<dir>` and write nothing under `public/` or the real `build/tmp/audio/`.

**Fixtures:** the two example sources in §5.2 (`pickup_small.json`, `horn.json`) are canonical and can be the first committed sources and test fixtures. `tests/unit/audio/render.test.ts` pins the sha256 of the rendered `sfx.pickup_small` WAV.

**Open points (flag in the PR):**
1. The npm script `audio` = `node tools/audio/render-sfx.ts && node tools/audio/render-music.ts`. Until render-music exists (issue SSP-167), verify with `node tools/audio/render-sfx.ts` directly, and keep any M0 stub behaviour honest (no silent pass).
2. Whether audio IDs get entries in `assets-src/manifest.json` (whose schema is sprite-oriented, ASSET_PIPELINE §6.1) is not specified. Default: no; `sfx.json` is the audio registry.
3. Whether encoded files are hash-compared follows decision D-11 (ROADMAP §8).

## Scope

- `tools/audio/render-sfx.ts` with hand-written type guards (no zod) and lint errors that name the file and field
- Integer variants with seeded `mutate`, named variants with `overrides`, the mixed `count` form, per-variant `meta`, layers, loop points, `durationScale` passthrough
- AUDIO_DESIGN §5.2 updated to document the mixed-variant and per-variant `meta` extensions
- Per-variant peak normalisation, sprite concatenation with 50 ms gaps, the `public/assets/audio/sfx.json` index
- Shared ffmpeg helper (path + env override) using the exact flag sets for Opus 64k and AAC-LC 96k
- Write WAV sha256 values into `public/assets/asset-hashes.json` (merge, sorted)
- `--only` and `--out` flags
- Commit `pickup_small.json` and `horn.json` from the doc examples plus their generated outputs; `tests/unit/audio/render.test.ts`

## Out of scope

- Authoring the other 30 SFX (issues sfx-*)
- The `--report` evidence (issue SSP-162)
- Ambience bed validation and amb.json (issue SSP-183)
- Runtime playback (issue SSP-175)

## Acceptance criteria

- [ ] `node tools/audio/render-sfx.ts` renders every source to `build/tmp/audio/sfx/*.wav` (44100 Hz, 16-bit, mono) and to `public/assets/audio/sfx/*.ogg` and `*.m4a`
- [ ] Running the renderer twice produces byte-identical WAVs (test compares sha256)
- [ ] `sfx.json` lists every ID with per-variant name, named flag, offset and length in samples; offsets reflect 2,205-sample gaps (unit test)
- [ ] Test: a fixture using the mixed form (`count: 2` + one named entry) yields 3 variants, of which 2 are unnamed-pickable; a fixture with per-variant `meta` carries those values into sfx.json
- [ ] Each variant's sample peak is −1 dBFS ±0.05 dB (test)
- [ ] A zzfx source with `randomness` ≠ 0, an unknown bus, or a priority outside 1–5 makes the renderer exit non-zero with a message naming the file and field
- [ ] The ffmpeg argument builder output contains `-bitexact -map_metadata -1`, uses `aac` (never `aac_at`) and 64k/96k bitrates (unit test); setting `SSP_FFMPEG` changes the binary path
- [ ] `public/assets/asset-hashes.json` contains WAV sha256 entries for each rendered SFX, and existing image entries are preserved
- [ ] `--only horn` renders only horn; `--out <dir>` writes all outputs under `<dir>` and nothing under `public/`
- [ ] AUDIO_DESIGN §5.2 documents the mixed-variant and per-variant `meta` fields

## Verification

- node tools/audio/render-sfx.ts
- node tools/audio/render-sfx.ts --only horn
- node tools/audio/render-sfx.ts --out build/tmp/verify-test
- npm test -- tests/unit/audio/render.test.ts
- npm run typecheck && npm run lint
- node tools/audio/render-sfx.ts && git status --porcelain (empty after a second render)

## Dependencies

**Depends on:**

- [SSP-159](SSP-159-audio-deps-zzfx-vendor.md) Pin jsfxr 1.4.1, vendor ZzFX buildSamples with seeded RNG, add WAV writer
- [SSP-025](../M0/SSP-025-pipeline-determinism-spikes.md) Measure cross-platform PNG identity and ffmpeg encode determinism (D-12, D-11)
- [SSP-010](../M0/SSP-010-forge-pack-verify.md) Add deterministic atlas packing, generated assets.ts, asset-hashes.json and forge verify
- [SSP-117](../M4/SSP-117-forge-verify-ci.md) Extend forge verify to level and M4 outputs, prove assets idempotence, fill forge pytest gaps and add verify + lint to CI

**Blocks:**

- [SSP-162](SSP-162-audio-review-report.md) Add --report review evidence: spectrograms, waveforms, metrics, listening page
- [SSP-163](SSP-163-sfx-sweeping-vehicle.md) Author the 14 sweeping, hopper and vehicle SFX sources
- [SSP-164](SSP-164-sfx-props-animals-people.md) Author the 10 prop, hazard, animal and people bark SFX sources
- [SSP-165](SSP-165-sfx-feedback-ui.md) Author the 8 game-feedback and UI SFX sources
- [SSP-167](SSP-167-render-music-stems-encode.md) Render music stems, normalise loudness, lint songs, encode and write music.json
- [SSP-168](SSP-168-audio-verify-coverage.md) Wire audio into assets:verify and add SFX coverage and reference tests
- [SSP-174](SSP-174-unlock-codec-loading.md) Add unlock.ts, Opus/AAC codec selection and boot-time audio loading
- [SSP-175](SSP-175-sfx-voice-pool.md) Implement sfx.ts playback: voice pool, variants, pitch ladder and spatial pan
- [SSP-183](SSP-183-amb-town-morning.md) Add the ambience bed player and author amb.town_morning
- [SSP-217](../M6/SSP-217-audio-ambiences-m6.md) Author amb.rain, amb.wind_leaves, amb.seafront and amb.night_town beds

## References

- ../../AUDIO_DESIGN.md#51-file-naming
- ../../AUDIO_DESIGN.md#52-sfx-source-schema
- ../../AUDIO_DESIGN.md#53-determinism-rule-for-zzfx-and-jsfxr
- ../../AUDIO_DESIGN.md#54-full-sfx-list
- ../../AUDIO_DESIGN.md#111-pipeline
- ../../AUDIO_DESIGN.md#113-encoding-exact-ffmpeg-invocations-wrapped-by-the-renderers
- ../../AUDIO_DESIGN.md#114-determinism
- ../../ASSET_PIPELINE.md#52-packagejson-scripts
- ../../ROADMAP.md#8-m0-spike-decision-log

## Roadmap tasks covered

- `render-sfx.ts`: pure sample generation (no WebAudio) → 44.1 kHz 16-bit WAV → ffmpeg 9.0.2 with `-bitexact -map_metadata -1`.
- Deliverable: Every `sfx.*` ... as a JSON source, rendered to Opus (`.ogg`, 64 kbps) and AAC-LC (`.m4a`, 96 kbps). (pipeline)
