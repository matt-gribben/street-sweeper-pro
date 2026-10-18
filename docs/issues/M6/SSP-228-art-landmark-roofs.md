---
id: SSP-228
title: "Art Pass 2: landmark roofs for the Town Hall, Pier and Depot via Codex goldens"
milestone: M6
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, size:M]
depends_on: [SSP-197, SSP-209, SSP-215, SSP-110, SSP-124]
blocks: [SSP-233]
---

# SSP-228: Art Pass 2: landmark roofs for the Town Hall, Pier and Depot via Codex goldens

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** asset · **Size:** M · **Areas:** assets

## Summary

Replace the placeholder roof.* landmarks with unique Codex-golden roofs, ingested at 16 px/m to the footprints the levels define.

## Context

Technique (ASSET_PIPELINE §2 and §10.10, ART_BIBLE §9.5): Codex golden -> forge ingest -> grid, targeting the building footprint at 16 px/m (1 tile = 32 px). Footprints come from the levels:
- roof.depot on building P in depot_yard: map rows 1-4, columns 1-18 = 18 x 4 tiles = 576 x 128 px; 2 storeys, landmark.
- roof.pier on the Promenade's pier: 4 tiles wide x 30 long; use SSP-209's final footprint.
- roof.town_hall on the Civic Quarter Town Hall with its 8-storey clock tower: accent 14 for the clock, 26 for council banners.
Low-frequency rule for tall buildings: halve speckle density and keep features >= 2 px. Magnification is up to 1.91x at 6 storeys and higher on the 8-storey tower, so check for swimming while panning (R-02). One sun at azimuth 315 / elevation 50; Kerbside-32 only; no lettering or logos (a clock face is fine, but no text). Review the golden candidates, and the in-game roof at 1080p fullscreen (4x), with Read; provenance must be complete.

## Scope

- prompt.md, goldens, meta.json, ingest.json and grids for roof.town_hall, roof.pier and roof.depot
- Manifest updates removing placeholders
- Generated outputs; in-game screenshots of each landmark

## Out of scope

- Ordinary roof surfaces and roof kit (M4)

## Acceptance criteria

- [ ] Each roof grid matches its level footprint at 16 px/m exactly (roof.depot = 576x128 px)
- [ ] No placeholder: true remains for the three roof IDs
- [ ] assets:lint and assets:verify pass; provenance is complete
- [ ] Frozen in-game screenshots of each landmark reviewed with Read; a panning check notes no visible swim

## Verification

- npm run gen:ai -- roof.town_hall --candidates 4 (local only)
- npm run assets:ingest -- roof.town_hall
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-197](SSP-197-depot-yard-level.md) Author and compile district.depot_yard with all seven Skip Run variants
- [SSP-209](SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-215](SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-110](../M4/SSP-110-forge-ingest-complete.md) Complete forge ingest: full 10-step pipeline, edit protection, dry-run previews
- [SSP-124](../M4/SSP-124-roof-surfaces.md) Final procedural roof surfaces: felt, gravel, slate, corrugated

**Blocks:**

- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag

## References

- ../../ASSET_PIPELINE.md#1010-decal-shop-sign-landmark-roof-codex--ingest
- ../../ART_BIBLE.md#95-roofs
- ../../LEVEL_DESIGN.md#86-worked-example-2-the-depot-yard-complete
- ../../ROADMAP.md#6-risk-register

## Roadmap tasks covered

- Landmark roofs (`roof.*` for the Town Hall, Pier and Depot) via Codex goldens.
