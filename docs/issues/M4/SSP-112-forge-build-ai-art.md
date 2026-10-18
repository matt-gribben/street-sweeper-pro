---
id: SSP-112
title: "Add the ai-art build technique: crop, pixelize at detected period, palette map"
milestone: M4
status: todo
type: feature
estimate: M
labels: [type:feature, area:tooling, area:assets, area:test, size:M, vertical-slice]
depends_on: [SSP-004, SSP-005]
blocks: [SSP-117, SSP-152, SSP-153, SSP-229]
---

# SSP-112: Add the ai-art build technique: crop, pixelize at detected period, palette map

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** feature · **Size:** M · **Areas:** tooling, assets, test · **Vertical slice**

## Summary

Implement the `ai-art` technique, which rebuilds title art and portraits from their Codex golden on every `forge build` with no intermediate grid. This is what lets `art.title` and `portrait.big_pam` ship.

## Context

Pipeline (ASSET_PIPELINE §9.2): golden -> crop -> pixelize (FFT period detection and block-mode at the detected period, exactly as in ingest; `period_override` in ingest.json, null = auto) -> if the result is larger than `size`, centre-crop. Never upscale: a result smaller than `size` fails with advice to regenerate or set `period_override`. Then palette map, with optional ordered 4x4 Bayer (`dither: 'bayer4'` or `'none'`), and output under `public/assets/art/`. No BOX pre-resize, because it blurs the pseudo-pixel grid. A fixed block size on a ~10 px period golden creates mixels, which ART_BIBLE forbids. Art ingest.json (§6.5): `{mode:'art', crop:null, period_override:null, dither:'bayer4', out:'public/assets/art/title.png', size:[480,270]}`. The title golden is 2:1, 1774x887, prompted at ~540x270 art pixels (period ~3.3 px), with the centre 480x270 kept. Portraits: a 1:1 golden of 1254x1254 holding 2 expressions side by side; `crop` selects each expression at ~64x64 art px. Gap to resolve and document in §6.5: ingest.json has a single `crop` and `out`, but a portrait has two expressions. Define the schema (e.g. `crops: [{state:'briefing', rect:[x,y,w,h]}, ...]`), the output layout (one PNG per expression, or one strip), and how the manifest entry and runtime reference it (e.g. states `briefing`/`stern`). Outputs are listed in `asset-hashes.json`, so `assets:verify` covers them. Bayer dither is allowed only in ai-art (ART_BIBLE §6.2), computed from internal pixel coordinates.

## Scope

- `ai-art` builder in `tools/forge/forge/build.py` (or a dedicated module) reading `assets-src/ai/<id>/golden.png` + `ingest.json`
- Multi-crop schema for portrait expressions, the output layout and manifest representation, documented in ASSET_PIPELINE §6.5
- Deterministic 4x4 Bayer
- Register outputs in `asset-hashes.json`
- pytest with synthetic upscaled fixtures

## Out of scope

- Generating `art.title` or `portrait.big_pam` goldens (separate issues)
- Mercury newspaper art (M6)

## Acceptance criteria

- [ ] pytest: a synthetic 64x64 Kerbside-32 image, nearest-upscaled by 3.3x and by 10.8x with +/-4 RGB noise, is reconstructed to the exact original 64x64
- [ ] A result smaller than `size` fails the build with a message naming `period_override`
- [ ] Output contains only Kerbside-32 colours with binary alpha (fully opaque for full-bleed art)
- [ ] Two builds produce byte-identical art PNGs
- [ ] `forge build --only <art-id>` still repacks all atlases and updates asset-hashes.json
- [ ] ASSET_PIPELINE §6.5 documents the multi-crop schema and output naming

## Verification

- uv run --project tools/forge pytest tools/forge/tests/
- npm run assets && npm run assets && git status --short
- npm run assets:verify

## Dependencies

**Depends on:**

- [SSP-004](../M0/SSP-004-forge-skeleton-pixelize.md) Create the forge Python package (uv, CLI skeleton) and import pixelize.py with tests
- [SSP-005](../M0/SSP-005-kerbside32-palette.md) Author kerbside32.json and forge OKLab palette mapping with a shared 4,096-sample fixture

**Blocks:**

- [SSP-117](SSP-117-forge-verify-ci.md) Extend forge verify to level and M4 outputs, prove assets idempotence, fill forge pytest gaps and add verify + lint to CI
- [SSP-152](SSP-152-portrait-big-pam.md) portrait.big_pam: 64x64 intro-card portrait with 2 expressions
- [SSP-153](SSP-153-title-art.md) art.title: 480x270 title key art via ai-art
- [SSP-229](../M6/SSP-229-art-mercury-portraits.md) Art Pass 2: Mercury newspaper art and portraits for Sid, Doris and the Inspector

## References

- ../../ASSET_PIPELINE.md#92-forge-build-per-technique
- ../../ASSET_PIPELINE.md#65-ai-asset-folder-assets-srcaiasset-id
- ../../ASSET_PIPELINE.md#1011-title-key-art-intro-cards-mercury-art-portraits-ai-art
- ../../ART_BIBLE.md#124-screens
- ../../ART_BIBLE.md#62-shading-rules

## Roadmap tasks covered

- `forge build`: `procedural` (tiles, roofs, facades, stains, fx frame generators), `ai-art` (crop, pixelize at the detected period, palette map, optional 4×4 Bayer), swaps (up to 8 per atlas).
