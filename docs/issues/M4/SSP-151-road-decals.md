---
id: SSP-151
title: "Road decals for High Street: oil, posters and graffiti via Codex ingest"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, size:M]
depends_on: [SSP-110, SSP-115, SSP-116, SSP-118, SSP-105]
blocks: [SSP-158, SSP-203]
---

# SSP-151: Road decals for High Street: oil, posters and graffiti via Codex ingest

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets

## Summary

Generate and ingest the `decal.*` one-offs (oil marks, posters, graffiti, manhole art) that add variety to High Street.

## Context

Road decals (ASSET_PIPELINE §2, §10.10): Codex image gen -> ingest at a common scale (`ai-ingest`, `assets-src/ai/decal.*/`). These are one-offs, where variety hides inconsistency. Target 32x32; ingest.json `mode 'sheet'`, with `grid [1,1]` for one-offs or a 4x2 sheet at one scale. Decals draw on depth layer 2 (road decals, stains; TECHNICAL_DESIGN §12.5). Rules: no text or lettering, no logos or brand-like marks (graffiti must be abstract shapes, not words), rating guard. Open: decal IDs are asset-only and not in the catalog, so add manifest entries. Posters and graffiti may belong on walls rather than the road: decide placement and atlas (world is likely). Ground decals are not outlined.

## Scope

- Prompt(s) and generation (prefer one 4x2 sheet), acceptance, ingest
- Manifest entries and placement in the High Street level
- Sheet + capture review

## Out of scope

- Decals for other districts (M6)

## Acceptance criteria

- [ ] Provenance complete; grids carry `origin:`; lint clean
- [ ] No legible text or logos in any decal (Read, noted); `npm test` (ipHygiene) passes
- [ ] Decals are visible in a High Street capture without competing with litter (Read)

## Verification

- npm run gen:ai -- decal.<sheet-id> --candidates 4 (local only), then Read build/ai-candidates/decal.<sheet-id>/review.png
- npm run assets:ingest -- decal.<sheet-id>
- npm run assets && npm run assets:lint && npm run assets:verify
- npm test && npm run test:visual

## Dependencies

**Depends on:**

- [SSP-110](SSP-110-forge-ingest-complete.md) Complete forge ingest: full 10-step pipeline, edit protection, dry-run previews
- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-118](SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-105](../M3/SSP-105-high-street-greybox.md) Author and compile the grey-box High Street (80×60) for Tuesday's NPCs

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-203](../M6/SSP-203-district-high-street-final.md) Bring district.high_street to final M6 quality with collectibles and 3-star replay

## References

- ../../ASSET_PIPELINE.md#1010-decal-shop-sign-landmark-roof-codex--ingest
- ../../ASSET_PIPELINE.md#2-technique-per-asset-class
- ../../TECHNICAL_DESIGN.md#125-sprites-spritebatchts-spritestackts

## Roadmap tasks covered

- Signs (`sign.*`) for High Street shops, with lettering in Kerbside fonts. Road decals (`decal.*`) for oil, posters and graffiti.
