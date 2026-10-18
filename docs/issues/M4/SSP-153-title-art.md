---
id: SSP-153
title: "art.title: 480x270 title key art via ai-art"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, size:M, vertical-slice]
depends_on: [SSP-112, SSP-012]
blocks: [SSP-157]
---

# SSP-153: art.title: 480x270 title key art via ai-art

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets · **Vertical slice**

## Summary

Generate and accept the title-screen key art, and build it to 480x270 through the `ai-art` path with Bayer dithering.

## Context

`art.title` (ASSET_PIPELINE §6.5, §8.4, §10.11; ART_BIBLE §12.4): a 2:1 Codex golden of 1774x887, prompted as 'the whole image is pixel art at roughly 540x270 art pixels, upscaled' with the safe area 'keep all important content inside the central 480x270 art pixels'. Pseudo-pixel period ~3.3 px. ingest.json: `{mode:'art', crop:null, period_override:null, dither:'bayer4', out:'public/assets/art/title.png', size:[480,270]}`. No text in the golden: the logo 'Street Sweeper Pro' is drawn over it in Kerbside Bold at 2x integer scale (SSP-157). Describe qualities only (overhead seaside town street, a yellow council sweeper, chunky pixel art) and never name games or brands. Bessie should be the eye-catching subject.

## Scope

- `assets-src/ai/art.title/` prompt, generation, acceptance
- ingest.json and manifest entry
- Review at 1080p fullscreen (4x)

## Out of scope

- Logo text and title screen layout (SSP-157)
- Mercury newspaper art (M6)

## Acceptance criteria

- [ ] Provenance folder complete with acceptance_notes
- [ ] Builds to exactly 480x270, Kerbside-32 only, byte-identical across builds
- [ ] No generated lettering or logos (Read, noted); `npm test` (ipHygiene) passes

## Verification

- npm run gen:ai -- art.title --candidates 4 (local only), then Read build/ai-candidates/art.title/review.png
- npm run assets && npm run assets:lint && npm run assets:verify
- Read public/assets/art/title.png
- npm test

## Dependencies

**Depends on:**

- [SSP-112](SSP-112-forge-build-ai-art.md) Add the ai-art build technique: crop, pixelize at detected period, palette map
- [SSP-012](../M0/SSP-012-genai-codex-wrapper.md) Implement forge gen-ai Codex wrapper with preamble v1 and a concept.spike_street smoke run

**Blocks:**

- [SSP-157](SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art

## References

- ../../ASSET_PIPELINE.md#1011-title-key-art-intro-cards-mercury-art-portraits-ai-art
- ../../ASSET_PIPELINE.md#84-prompt-file-format
- ../../ART_BIBLE.md#124-screens

## Roadmap tasks covered

- `art.title` key art at 480×270.
