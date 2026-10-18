---
id: SSP-150
title: "High Street shop signs: Codex blank boards plus Kerbside lettering"
milestone: M4
status: todo
type: asset
estimate: L
labels: [type:asset, area:assets, area:tooling, size:L]
depends_on: [SSP-110, SSP-115, SSP-116, SSP-143, SSP-126, SSP-003]
blocks: [SSP-158, SSP-203, SSP-227]
---

# SSP-150: High Street shop signs: Codex blank boards plus Kerbside lettering

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** L · **Areas:** assets, tooling

## Summary

Create the `sign.*` shop signs for High Street: blank sign boards from Codex ingested to grids, with invented shop names composited at build time from Kerbside glyphs (never generated lettering).

## Context

Shop signs (ASSET_PIPELINE §2, §10.10; ART_BIBLE §9.4): Codex golden -> ingest -> grid (`ai-ingest`, `assets-src/ai/sign.*/`). Generate the blank sign board only; lettering is composited at build time from Kerbside glyphs, as declared in the manifest entry's `states`. All shop names are invented with no real brands (e.g. 'Frank's Plaice', 'Muckleford Mini Mart'). High Street has pound shops, a bakery and a chippy; British English spelling. ingest.json: `mode 'sheet'`, `grid [1,1]` for one-offs (or a multi-board 4x2 sheet at one scale). Open questions to resolve and record: (1) the forge has no documented mechanism for build-time lettering, so design the manifest declaration (font, text, position, colour index) and implement it in `forge build`; (2) `sign.*` IDs are asset-only, so add manifest entries and list them in ASSET_PIPELINE (they are not entity IDs in ENTITY_CATALOG §2); (3) the atlas for signs (world, as facade dressing, is likely); (4) how signs are placed on facades (facade set JSON or level JSON). Lit-at-night signs are M6. IP (CLAUDE.md rule 7): the ipHygiene test must pass; reject any candidate with lettering or logos.

## Scope

- Prompt(s), generation, acceptance and ingest of blank boards
- Build-time Kerbside lettering compositing in the forge, with pytest, documented
- Manifest entries for each High Street sign; placement on shopfronts
- Sheet + High Street capture review

## Out of scope

- Signs for other districts (M6)
- Night lighting of signs (M6)

## Acceptance criteria

- [ ] Each High Street shopfront has a sign with invented Kerbside lettering legible at 1x (High Street capture, Read)
- [ ] Provenance folders complete; no golden contains generated lettering
- [ ] pytest: the lettering compositor output is byte-identical across runs; `assets:verify` clean
- [ ] `npm test` (ipHygiene) passes; lint clean; ASSET_PIPELINE documents the lettering mechanism and the sign IDs

## Verification

- npm run gen:ai -- sign.<id> --candidates 4 (local only), then Read build/ai-candidates/sign.<id>/review.png
- npm run assets:ingest -- sign.<id>
- npm run assets && npm run assets:lint && npm run assets:verify
- uv run --project tools/forge pytest && npm test
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-110](SSP-110-forge-ingest-complete.md) Complete forge ingest: full 10-step pipeline, edit protection, dry-run previews
- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-143](SSP-143-font-kerbside-bold-8x8.md) Write Kerbside Bold 8x8 glyphs, metrics and kerning
- [SSP-126](SSP-126-facades-high-street.md) High Street shopfront facade modules and facade sets
- [SSP-003](../M0/SSP-003-lint-purity-ip-tests.md) Add biome.json sim-purity rules plus simPurity and ipHygiene unit tests

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-203](../M6/SSP-203-district-high-street-final.md) Bring district.high_street to final M6 quality with collectibles and 3-star replay
- [SSP-227](../M6/SSP-227-art-signs-decals-m6.md) Art Pass 2: shop signs and road decals for the Wed-Sun districts

## References

- ../../ASSET_PIPELINE.md#1010-decal-shop-sign-landmark-roof-codex--ingest
- ../../ART_BIBLE.md#94-facades
- ../../ASSET_PIPELINE.md#61-manifest-assets-srcmanifestjson
- ../../../CLAUDE.md#3-hard-rules-non-negotiable

## Roadmap tasks covered

- Signs (`sign.*`) for High Street shops, with lettering in Kerbside fonts. Road decals (`decal.*`) for oil, posters and graffiti.
