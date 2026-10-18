---
id: SSP-152
title: "portrait.big_pam: 64x64 intro-card portrait with 2 expressions"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, size:M, vertical-slice]
depends_on: [SSP-112, SSP-012]
blocks: [SSP-157, SSP-229]
---

# SSP-152: portrait.big_pam: 64x64 intro-card portrait with 2 expressions

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets · **Vertical slice**

## Summary

Generate and accept Big Pam's portrait golden, and build both expressions through `ai-art` for the shift intro card.

## Context

Big Pam Scrubbs: depot manager; brisk, unflappable, tea-powered, secretly proud of you (GDD §4.2). `portrait.big_pam`: 64x64, 2 expressions, briefing and stern (ART_BIBLE §12.4). Technique `ai-art` (ASSET_PIPELINE §10.11): a 1:1 Codex golden of 1254x1254 with the 2 expressions side by side. The prompt says each portrait is pixel art at roughly 64x64 art pixels, upscaled, and states the safe area. ingest.json: `mode 'art'` using the multi-crop schema defined in SSP-112, `period_override` null (auto), `dither` none or bayer4. The output path/naming also follows SSP-112 (e.g. under `public/assets/art/`). No text, no logos; describe qualities only. Accept only after Reading every candidate; acceptance_notes give the reasons. Expect ~60 s per candidate.

## Scope

- `assets-src/ai/portrait.big_pam/` prompt, generation, acceptance
- ingest.json with two crops; manifest entry
- Review at 4x (1080p)

## Out of scope

- Other portraits (Sid, Doris, Inspector: later)
- Intro card layout (SSP-157)

## Acceptance criteria

- [ ] Provenance folder complete with acceptance_notes
- [ ] Both expressions build to exactly 64x64, Kerbside-32 only, no mixels (one art pixel = one game pixel)
- [ ] `assets:verify` reproduces the output byte-identically
- [ ] Read at 4x: briefing and stern are distinguishable (noted)

## Verification

- npm run gen:ai -- portrait.big_pam --candidates 4 (local only), then Read build/ai-candidates/portrait.big_pam/review.png
- npm run assets && npm run assets:lint && npm run assets:verify
- Read the built portrait PNG(s) under public/assets/art/

## Dependencies

**Depends on:**

- [SSP-112](SSP-112-forge-build-ai-art.md) Add the ai-art build technique: crop, pixelize at detected period, palette map
- [SSP-012](../M0/SSP-012-genai-codex-wrapper.md) Implement forge gen-ai Codex wrapper with preamble v1 and a concept.spike_street smoke run

**Blocks:**

- [SSP-157](SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art
- [SSP-229](../M6/SSP-229-art-mercury-portraits.md) Art Pass 2: Mercury newspaper art and portraits for Sid, Doris and the Inspector

## References

- ../../ASSET_PIPELINE.md#1011-title-key-art-intro-cards-mercury-art-portraits-ai-art
- ../../ART_BIBLE.md#124-screens
- ../../GDD.md#42-cast

## Roadmap tasks covered

- Portraits: `portrait.big_pam` with 2 expressions, 64×64.
