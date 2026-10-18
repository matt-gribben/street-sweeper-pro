---
id: SSP-126
title: "High Street shopfront facade modules and facade sets"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, area:tooling, size:M]
depends_on: [SSP-125, SSP-105]
blocks: [SSP-150, SSP-158, SSP-203, SSP-215, SSP-226]
---

# SSP-126: High Street shopfront facade modules and facade sets

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets, tooling

## Summary

Author the High Street shopfront modules (two modules wide) and the 3-5 storey shopfront facade sets for Tuesday, ready to host shop signs.

## Context

Same module rules as Old Town: 32x40 base-ramp grids, forge-derived lit/dark, bold 25 windows >= 8x12 with 06/07 frames, storey bands, sparse 09 mortar (ART_BIBLE §9.4). The shopfront module is two modules wide (64x40). High Street colour key (ART_BIBLE §5.5): 05/06 concrete, 10 brick, awnings in 18, 26, 22, 20; keep the ground calm. Heights: 3 storeys on the side streets, 4-5 on the High Street (LEVEL_DESIGN §5.2); shops include pound shops, a bakery and a chippy. Facade set: e.g. `assets-src/procedural/facades/shopfront_row.json`. Reuse the pledge rosette module and doorstep decal from SSP-125 (12 pledges on High Street). Shop signs are separate `sign.*` assets with Kerbside lettering; leave a sign band on the shopfront module.

## Scope

- Shopfront, upper-storey and side-street modules for High Street
- Shopfront row set JSON and any side-street set
- Manifest upgrade; sheet, zoo and High Street capture review

## Out of scope

- Shop sign art and lettering (SSP-150)
- Night lit windows (M6)

## Acceptance criteria

- [ ] High Street facades build from final modules; none keeps `placeholder: true`
- [ ] Facades remain readable at a 25% horizontal squeeze (checked in `lean_quadrants` or a High Street capture, noted in PR)
- [ ] Lint clean; visual goldens pass or reviewed updates are committed

## Verification

- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas world, then Read build/sheets/world.png
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-125](SSP-125-facades-old-town.md) Old Town terrace facade modules and the pledge rosette (Puddle Lane)
- [SSP-105](../M3/SSP-105-high-street-greybox.md) Author and compile the grey-box High Street (80×60) for Tuesday's NPCs

**Blocks:**

- [SSP-150](SSP-150-shop-signs.md) High Street shop signs: Codex blank boards plus Kerbside lettering
- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-203](../M6/SSP-203-district-high-street-final.md) Bring district.high_street to final M6 quality with collectibles and 3-star replay
- [SSP-215](../M6/SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-226](../M6/SSP-226-art-facades-m6.md) Art Pass 2: facade module sets for every remaining building style

## References

- ../../ART_BIBLE.md#94-facades
- ../../ART_BIBLE.md#55-district-colour-keys
- ../../LEVEL_DESIGN.md#52-tue-muckleford-high-street-districthigh_street

## Roadmap tasks covered

- Facades for Old Town terraces and High Street shopfronts, `_lit`/`_base`/`_dark`.
