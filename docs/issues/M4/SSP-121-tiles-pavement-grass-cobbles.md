---
id: SSP-121
title: "Final pavement slabs, grass, cobbles, setts, tactile paving and edge tiles"
milestone: M4
status: todo
type: asset
estimate: L
labels: [type:asset, area:assets, area:tooling, size:L, vertical-slice]
depends_on: [SSP-111, SSP-115, SSP-116, SSP-118, SSP-040, SSP-105]
blocks: [SSP-122, SSP-158, SSP-203]
---

# SSP-121: Final pavement slabs, grass, cobbles, setts, tactile paving and edge tiles

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** L · **Areas:** assets, tooling · **Vertical slice**

## Summary

Final procedural generators for pavement slabs, grass, cobbles and tactile paving, plus the other Mon-Tue ground types the map legend uses (alley setts, yard gravel, and hedge/low wall/railing if M1 drew them as tiles). This covers Puddle Lane's pavements, Pump Green and the Gutter Row alley, and High Street's cobbled Market Square.

## Context

ART_BIBLE §9.1: Pavement slabs are 05 with 04 joints on a 600 mm grid (~10 px), with random 06 or 04 slab tints. Grass: 22 base, 23 tufts, 21 shade near walls. Cobbles: 04/05 rounded blocks with 03 gaps (Old Town and Civic Quarter; High Street Market Square is ~20x14 tiles of cobbles `:`). Tactile paving: 11 (or 06) with a 1 px dot grid, at crossings. The map legend (LEVEL_DESIGN §8.3) also has `;` alley setts (Puddle Lane's Gutter Row alley), `%` yard/gravel, `e` hedge (Pump Green is hedge-bounded), `w` low wall (cats perch on it) and `r` railing. Upgrade whichever of these M1 rendered as ground tiles, under their existing IDs. The calmness rule and seam rule apply. Open question: 600 mm = 9.6 px does not divide the 32 px tile. Pick a wrap-safe joint pattern (e.g. a 10/11/11 px rhythm or 16 px slabs) and record it in ART_BIBLE §9.1. Keep the M1 placeholder IDs/frame IDs.

## Scope

- Generators + params for slabs, grass, cobbles, tactile paving, alley setts, yard gravel
- Hedge/low wall/railing visuals if M1 represents them as tiles (otherwise list how they render in the PR)
- pytest per generator (determinism, seam, palette subset)
- Record the slab joint rhythm decision
- Manifest upgrade, sheet + zoo review

## Out of scope

- Kerbs, road tiles
- District-specific sets for Wed-Sun (M6)

## Acceptance criteria

- [ ] All listed families build procedurally with `wrap: true` where tileable and pass the seam lint
- [ ] The slab joint rhythm decision is recorded in ART_BIBLE §9.1
- [ ] No Mon-Tue entry of these families keeps `placeholder: true`
- [ ] The sheet's 3x3 previews show no visible repetition grid (Read, noted in PR)

## Verification

- uv run --project tools/forge pytest
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas world, then Read build/sheets/world.png
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-111](SSP-111-forge-build-procedural.md) Harden the procedural technique: generator registry, params validation, fx play frames and a shared seam metric
- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-118](SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-040](../M1/SSP-040-procedural-tiles.md) Generate placeholder ground tiles and the 47-tile kerb blob set with tiles.py
- [SSP-105](../M3/SSP-105-high-street-greybox.md) Author and compile the grey-box High Street (80×60) for Tuesday's NPCs

**Blocks:**

- [SSP-122](SSP-122-grime-overlays.md) Procedural grime overlay patterns for asphalt, slab and gutter
- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-203](../M6/SSP-203-district-high-street-final.md) Bring district.high_street to final M6 quality with collectibles and 3-star replay

## References

- ../../ART_BIBLE.md#91-ground-tiles
- ../../ASSET_PIPELINE.md#108-ground-tile-roof-surface-stain-or-vfx-procedural
- ../../LEVEL_DESIGN.md#83-default-legend
- ../../LEVEL_DESIGN.md#51-mon-puddle-lane-districtpuddle_lane-tutorial
- ../../LEVEL_DESIGN.md#52-tue-muckleford-high-street-districthigh_street

## Roadmap tasks covered

- `Final ground tiles: asphalt, lane markings, double yellows, kerbs (47-tile blob), pavement slabs, zebra, drains, manholes, grass, cobbles, tactile paving. Each passes the wrap-edge seam lint.`
