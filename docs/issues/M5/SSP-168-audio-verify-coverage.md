---
id: SSP-168
title: "Wire audio into assets:verify and add SFX coverage and reference tests"
milestone: M5
status: todo
type: test
estimate: M
labels: [type:test, area:audio, area:tooling, area:test, area:build, size:M, vertical-slice]
depends_on: [SSP-161, SSP-167, SSP-163, SSP-164, SSP-165, SSP-117, SSP-025, SSP-053, SSP-075]
blocks: [SSP-185]
---

# SSP-168: Wire audio into assets:verify and add SFX coverage and reference tests

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** test · **Size:** M · **Areas:** audio, tooling, test, build · **Vertical slice**

## Summary

Make audio part of the reproducibility proof. `forge verify` re-renders audio into a temp root and compares WAV hashes and the generated audio indexes. New tests prove that every canonical `sfx.*` ID has a source and rendered files, and that every entity SFX reference resolves.

## Context

**Exit criterion:** 'All `sfx.*` rendered.' Measurable checks (ROADMAP M5):
- A test cross-checks every ID in the SFX reference list against `assets-src/audio/sfx/*.json` and `public/assets/audio/sfx/`.
- `assets:verify` compares WAV hashes; whether encoded files are also compared depends on D-11.

**The canonical 32 IDs** (ENTITY_CATALOG §1.4): pickup_small, pickup_big, pickup_glass, fling, hopper_full, dump, brush_lower, brush_raise, horn, bump_wall, bump_kerb, crash, police_whoop, ice_cream_chime, cone_knock, bin_knock, splash, cat_yowl, dog_bark, pigeon_flap, seagull_squawk, ped_oi, granny_harrumph, kid_waah, complaint_stamp, combo_tier, powerup, coin, timer_warn, ui_move, ui_select, ui_back.

**Forge verify** (ASSET_PIPELINE §5.2): it runs `forge build --out build/tmp/verify/`, then runs the audio and level tools with `--out` pointed at the same temp root, and byte-compares every file listed in `public/assets/asset-hashes.json` and `src/gen/assets.ts`, exiting non-zero with a per-file report. For audio:
- compare **WAV sha256** against the recorded hashes;
- byte-compare the generated JSON indexes `public/assets/audio/sfx.json`, `music.json` and `amb.json` (whichever exist);
- compare .ogg/.m4a only if D-11 recorded ffmpeg 9.0.2 as bit-exact across macOS arm64 and ubuntu-latest.

**CI:** `assets:verify` runs in the ubuntu `checks` job (TECHNICAL_DESIGN §19). How ubuntu CI obtains ffmpeg 9.0.2 (static build vs skipping encode in verify mode) is **TBD (M0 spike)**. If M0 did not decide it, implement a verify mode that skips encoding (WAV + JSON compare only) and says so in its output; the WAVs and JSON need no ffmpeg.

**Entity references:** ENTITY_CATALOG §15 says a unit test asserts every `sfx` value in `src/data/entities.json` exists in `assets-src/audio/sfx/`. It may already exist from M2/M3; extend or create it.

**Suggestion:** define the 32 IDs once as an `as const` array plus a union type (e.g. `src/audio/sfxIds.ts`) so the director can be typed against it. A test asserts the array matches ENTITY_CATALOG §1.4.

## Scope

- `forge verify` calls `node tools/audio/render-sfx.ts --out <tmp>` and `node tools/audio/render-music.ts --out <tmp>`, compares WAV hashes recorded in asset-hashes.json and byte-compares the audio JSON indexes
- Encoded-file comparison gated on the D-11 outcome (a forge config flag); encode-skipping verify mode if CI has no ffmpeg
- Forge pytest coverage for the audio verify path
- `src/audio/sfxIds.ts` (or equivalent) and `tests/unit/audio/sfxCoverage.test.ts`: the 32 IDs ↔ sources ↔ .ogg/.m4a ↔ sfx.json index entries
- Entities SFX reference test (create or extend)
- Confirm `npm run assets` runs `npm run audio` and both verify paths pass locally

## Out of scope

- Authoring missing SFX (issues sfx-*)
- Installing ffmpeg on CI runners if M0 decided to skip encoding in verify

## Acceptance criteria

- [ ] `npm run assets:verify` exits 0 on a clean tree
- [ ] Changing one SFX JSON param without re-rendering makes `npm run assets:verify` exit non-zero with a per-file report naming that SFX's WAV
- [ ] Hand-editing `public/assets/audio/sfx.json` makes `npm run assets:verify` fail
- [ ] Deleting `public/assets/audio/sfx/horn.m4a` makes `sfxCoverage.test.ts` fail naming `horn`
- [ ] Adding a JSON source whose id is not in the 32-ID list makes the coverage test fail
- [ ] An `entities.json` `sfx` value that is not one of the 32 IDs fails the reference test
- [ ] The verify output states whether encoded audio was compared, per D-11

## Verification

- npm run assets
- npm run assets:verify
- npm test -- tests/unit/audio/sfxCoverage.test.ts
- uv run --project tools/forge pytest tools/forge/tests

## Dependencies

**Depends on:**

- [SSP-161](SSP-161-render-sfx-core.md) Implement render-sfx.ts: SFX JSON to WAV sprites, ffmpeg encodes and sfx.json
- [SSP-167](SSP-167-render-music-stems-encode.md) Render music stems, normalise loudness, lint songs, encode and write music.json
- [SSP-163](SSP-163-sfx-sweeping-vehicle.md) Author the 14 sweeping, hopper and vehicle SFX sources
- [SSP-164](SSP-164-sfx-props-animals-people.md) Author the 10 prop, hazard, animal and people bark SFX sources
- [SSP-165](SSP-165-sfx-feedback-ui.md) Author the 8 game-feedback and UI SFX sources
- [SSP-117](../M4/SSP-117-forge-verify-ci.md) Extend forge verify to level and M4 outputs, prove assets idempotence, fill forge pytest gaps and add verify + lint to CI
- [SSP-025](../M0/SSP-025-pipeline-determinism-spikes.md) Measure cross-platform PNG identity and ffmpeg encode determinism (D-12, D-11)
- [SSP-053](../M2/SSP-053-entities-tuning-seed.md) Seed entities.json with litter, stains and pickups; add M2 values to tuning.json
- [SSP-075](../M3/SSP-075-entity-data-freeze.md) Freeze the Mon–Tue entity set in entities.json and add M3 shared tuning

**Blocks:**

- [SSP-185](SSP-185-m5-exit-evidence.md) Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR

## References

- ../../ROADMAP.md#m5-sound--music
- ../../ENTITY_CATALOG.md#14-sfx-notation
- ../../ENTITY_CATALOG.md#15-entitiesjson-shape
- ../../ASSET_PIPELINE.md#52-packagejson-scripts
- ../../ASSET_PIPELINE.md#135-verify-ci
- ../../AUDIO_DESIGN.md#114-determinism
- ../../TECHNICAL_DESIGN.md#19-ci

## Roadmap tasks covered

- Measurable check: All SFX — a test cross-checks every ID in the SFX reference list against `assets-src/audio/sfx/*.json` and `public/assets/audio/sfx/`
- Measurable check: Reproducible — `assets:verify` compares WAV hashes. Whether encoded files are also compared depends on D-11
