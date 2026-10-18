---
id: SSP-025
title: "Measure cross-platform PNG identity and ffmpeg encode determinism (D-12, D-11)"
milestone: M0
status: done
type: spike
estimate: M
labels: [type:spike, area:tooling, area:audio, area:build, size:M, vertical-slice]
depends_on: [SSP-010, SSP-006]
blocks: [SSP-027, SSP-039, SSP-117, SSP-161, SSP-167, SSP-168, SSP-194, SSP-296]
---

# SSP-025: Measure cross-platform PNG identity and ffmpeg encode determinism (D-12, D-11)

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** spike · **Size:** M · **Areas:** tooling, audio, build · **Vertical slice**

## Summary

Settle two reproducibility questions before M4/M5 depend on them. Does Pillow 13.0.0 encode byte-identical PNGs on macOS arm64 and ubuntu-latest (D-12: byte vs `--pixels` verify)? Is ffmpeg 9.0.2 with `-bitexact -map_metadata -1` byte-stable for OGG/M4A (D-11, measured now, applied in M5)? Also record the asset-build timings.

## Context

D-12: build the M0 assets on the Mac, rebuild on Linux, compare bytes. If only encoded bytes differ (pixels identical), CI uses `forge verify --pixels` (ASSET_PIPELINE §13.5), which decodes RGBA and still byte-compares JSON/TS.

D-11: encode the same WAV twice with `-bitexact -map_metadata -1`, on the Mac AND on ubuntu-latest, and compare bytes for both OGG (libopus) and M4A (native AAC). The options are "compare WAV + encoded" or "WAV only". ffmpeg 9.0.2 is at /opt/homebrew/bin/ffmpeg. No audio sources exist yet: synthesise a deterministic test WAV into build/tmp/ (e.g. `ffmpeg -f lavfi -i sine=frequency=440:duration=2 -c:a pcm_s16le -bitexact`). This is a measurement, not M5 tooling. Do not add jsfxr/zzfx.

Also TBD (M0 spike):
- how CI obtains ffmpeg 9.0.2 on ubuntu (static build vs skipping encode in verify mode), TECHNICAL_DESIGN §19;
- AUDIO_DESIGN open questions A1 (same as D-11) and A2 (encoderDelaySamples per browser, §12.1 JSON). A2 is a browser measurement: measure it if cheap, otherwise re-defer it to M5 explicitly with a reason;
- ASSET_PIPELINE §14 timing rows: `npm run assets` cold/cached, and `assets:verify` in CI (always cold).

Linux access: no GitHub remote exists yet.
- Options: a throwaway GitHub Actions run once a remote exists, or a local container if one is available on the dev Mac.
- ubuntu-latest is **x86_64**, while a default container on Apple Silicon is arm64 Linux, which is not equivalent for Pillow wheels. Use `--platform linux/amd64` (emulated), and record the platform for every hash.
- Do NOT add dependencies to the repo for this.
- If no Linux environment is available, record the Mac results, mark the Linux half pending with the exact commands to run, and never fabricate Linux results.

## Scope

- Mac: build the M0 assets twice (byte check) and record SHA-256s; Linux amd64: rebuild and compare (or document as pending)
- Mac and Linux: encode a fixed WAV twice to OGG and M4A with -bitexact -map_metadata -1 and compare
- Record D-11 and D-12 in ROADMAP §8; update TECHNICAL_DESIGN §19 (ffmpeg in CI, verify mode) and AUDIO_DESIGN §15.2 A1 (A2 measured or re-deferred; §12.1 encoderDelaySamples accordingly)
- Record `npm run assets` cold/cached and verify timings in ASSET_PIPELINE §14

## Out of scope

- tools/audio renderers (M5)
- Adding assets:verify to ci.yml (M4)
- Installing new npm/Python dependencies

## Acceptance criteria

- [ ] ROADMAP §8 D-11 and D-12 have a Decision, Evidence (hash listings with platform/arch) and Date; any Linux half not run is marked pending with exact commands, never guessed
- [ ] TECHNICAL_DESIGN §19 states the chosen verify mode (byte or --pixels) and the ffmpeg-in-CI approach, consistent with D-11/D-12
- [ ] AUDIO_DESIGN A1 is resolved consistently with D-11, and A2 is resolved or explicitly re-deferred with a milestone and reason
- [ ] ASSET_PIPELINE §14 timing TBDs are replaced with measured values (machine noted), or the CI row is marked pending with the reason
- [ ] No dependency or version changes in package.json or pyproject.toml

## Verification

- uv run --project tools/forge python -m forge build --no-cache --out build/tmp/a && uv run --project tools/forge python -m forge build --no-cache --out build/tmp/b && diff -r build/tmp/a build/tmp/b
- uv run --project tools/forge python -m forge verify --pixels
- /opt/homebrew/bin/ffmpeg -y -i build/tmp/test.wav -c:a libopus -bitexact -map_metadata -1 build/tmp/a.ogg (twice to different names, then shasum)
- /opt/homebrew/bin/ffmpeg -y -i build/tmp/test.wav -c:a aac -bitexact -map_metadata -1 build/tmp/a.m4a (twice, then shasum)
- rm -rf build/.forge-cache && time npm run assets; time npm run assets

## Dependencies

**Depends on:**

- [SSP-010](SSP-010-forge-pack-verify.md) Add deterministic atlas packing, generated assets.ts, asset-hashes.json and forge verify
- [SSP-006](SSP-006-npm-scripts-ci-workflow.md) Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow

**Blocks:**

- [SSP-027](SSP-027-m0-exit-close.md) Verify M0 exit criteria, complete the decision log and open the Close M0 PR
- [SSP-039](../M1/SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end
- [SSP-117](../M4/SSP-117-forge-verify-ci.md) Extend forge verify to level and M4 outputs, prove assets idempotence, fill forge pytest gaps and add verify + lint to CI
- [SSP-161](../M5/SSP-161-render-sfx-core.md) Implement render-sfx.ts: SFX JSON to WAV sprites, ffmpeg encodes and sfx.json
- [SSP-167](../M5/SSP-167-render-music-stems-encode.md) Render music stems, normalise loudness, lint songs, encode and write music.json
- [SSP-168](../M5/SSP-168-audio-verify-coverage.md) Wire audio into assets:verify and add SFX coverage and reference tests
- [SSP-194](../M6/SSP-194-audio-mus-workshop.md) Compose mus.workshop 'Tea Break' and implement the mus.workshop fallback rule
- [SSP-296](../M7/SSP-296-ci-macos-visual-e2e.md) Bring the macos-latest visual/e2e CI job to its 1.0 shape and prove both CI jobs green

## References

- ../../ROADMAP.md#8-m0-spike-decision-log
- ../../ROADMAP.md#6-risk-register
- ../../TECHNICAL_DESIGN.md#19-ci
- ../../ASSET_PIPELINE.md#135-verify-ci
- ../../ASSET_PIPELINE.md#14-appendix-time-and-cost-budget
- ../../AUDIO_DESIGN.md#114-determinism
- ../../AUDIO_DESIGN.md#152-open-questions

## Roadmap tasks covered

- Fill in D-01 to D-13 in §8, each with evidence (screenshots under `build/`, attached to the PR and summarised in the log). [D-11, D-12]
