---
id: SSP-149
title: "Hand-author power-up and Mon-Tue collectible pickup grids"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, size:M, vertical-slice]
depends_on: [SSP-115, SSP-116, SSP-118, SSP-052, SSP-101]
blocks: [SSP-156, SSP-158, SSP-187]
---

# SSP-149: Hand-author power-up and Mon-Tue collectible pickup grids

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets · **Vertical slice**

## Summary

Write the six `pwr.*` and three Mon-Tue `collect.*` pickups as 16x16 bobbing icons, with the ground halo that marks them as 'for you'.

## Context

Pickups (ART_BIBLE §8.5, ENTITY_CATALOG §12-13): 16x16 cell, 12x12 icon, state `bob` x2 (1 px bob, 24 ticks each), dir `-`, `grid` in `assets-src/sprites/pickup/<name>.sprite.txt`, items atlas, outline true. They sit on a 1 px ground halo ring that alternates 16/07 with the bob (litter never has a halo). Icons: `pwr.flask_of_tea` (26 flask, 07 cup), `pwr.bacon_butty` (12 bread, 18 bacon), `pwr.hi_vis` (17 vest with 07 bands), `pwr.super_suction` (05 nozzle, 28 swirl), `pwr.wrench` (05/06 spanner), `pwr.water_can` (22 can, 28 drop); `collect.false_teeth` (07/20), `collect.lost_wallet` (13), `collect.golden_crisp` (crisp packet in 15/16, with `fx.sparkle` every 90 ticks / 1.5 s; tiny pickups may use 15).

## Scope

- Nine pickup grids with 2 bob frames and halo
- Manifest upgrade; sheet + zoo review

## Out of scope

- Other Lost Property items (M6)
- HUD power-up icons (SSP-144)

## Acceptance criteria

- [ ] Nine pickups are non-placeholder, with 12x12 icons inside 16x16 cells and a halo alternating 16/07 between the two frames
- [ ] Lint clean
- [ ] Pickups are clearly distinct from litter in the zoo (Read, noted)

## Verification

- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas items, then Read build/sheets/items.png
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-118](SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-052](../M2/SSP-052-placeholder-stains-pickups-sites.md) Add stain generator, grime overlays and pickup/collectible/site/hydrant grids
- [SSP-101](../M3/SSP-101-placeholder-props-hazards.md) Add placeholder sprites for knockables, hazards, SSP-096 and High Street props

**Blocks:**

- [SSP-156](SSP-156-hud-final-art.md) Restyle the HUD and score popups with final fonts, icons and panels
- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-187](../M6/SSP-187-progression-economy.md) Add districts.json, upgrades.json and pure week progression and £ ledger

## References

- ../../ART_BIBLE.md#85-pickups-and-collectibles
- ../../ENTITY_CATALOG.md#12-power-ups-pwr
- ../../ENTITY_CATALOG.md#13-collectibles-collect
- ../../ASSET_PIPELINE.md#107-small-prop-pickup-or-ui-icon-grids

## Roadmap tasks covered

- Pickups: all `pwr.*` and the Mon–Tue `collect.*` (`collect.false_teeth`, `collect.lost_wallet`, `collect.golden_crisp`).
