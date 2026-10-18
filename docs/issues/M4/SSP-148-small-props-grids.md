---
id: SSP-148
title: "Hand-author small prop grids, including grid sprite stacks"
milestone: M4
status: todo
type: asset
estimate: L
labels: [type:asset, area:assets, size:L, vertical-slice]
depends_on: [SSP-115, SSP-116, SSP-118, SSP-101, SSP-020]
blocks: [SSP-158]
---

# SSP-148: Hand-author small prop grids, including grid sprite stacks

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** L · **Areas:** assets · **Vertical slice**

## Summary

Write the final text grids for the small knockable and static props used Mon-Tue, including slice frames for the grid-authored sprite stacks.

## Context

32x32 per slice, items atlas, outline true, NW highlights allowed (props are not mirrored), `flat` (1 frame) or `slice` frames (k = 0 at ground) written in the `.sprite.txt` under `assets-src/sprites/prop/` (ASSET_PIPELINE §7.5, §10.7; ART_BIBLE §8.6; ENTITY_CATALOG §9). Checklist props: `prop.bollard` (01 with 07 band, stack), `prop.traffic_cone` (17 with 07 bands, stack), `prop.hydrant` (18 with 06 cap, flat), `prop.wheelie_bin` (22 or 01 lid, 26 recycling variant, stack), `prop.a_board` (07 with 03 lettering lines, stack), `prop.recycling_box` (26 with 22 lid, flat), `prop.litter_bin` (01 with 15 band, stack), `prop.post_box` (18 with 00 slot, stack). The frozen M3 scope ('all knockables and all statics') also requires two props missing from the checklist: `prop.shopping_trolley` (grid proposed, flat) and `prop.roadworks_barrier` (grid proposed, stack; rings `haz.open_manhole`). Slice counts come from the M0 decision (bollard/bins 4-6). Open: the wheelie bin 'recycling variant' needs either an items-atlas swap table (none planned) or a second frame/asset. Decide and record it in ART_BIBLE §8.6. Collision shape = opaque bbox of the lowest slice.

## Scope

- Author 10 prop grids with correct flat/slice frames
- Resolve the wheelie bin variant approach
- Manifest upgrade; sheet, zoo and `lean_quadrants` stack check

## Out of scope

- Blender props
- Knockable physics (M3)

## Acceptance criteria

- [ ] All 10 props are non-placeholder and lint clean (outline on every slice)
- [ ] Stack slices line up when the camera is centred and lean with the buildings (Read in `lean_quadrants` or the zoo)
- [ ] No large prop area uses 15 (litter bin band only)
- [ ] The wheelie bin variant decision is documented

## Verification

- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas items, then Read build/sheets/items.png
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-118](SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-101](../M3/SSP-101-placeholder-props-hazards.md) Add placeholder sprites for knockables, hazards, SSP-096 and High Street props
- [SSP-020](../M0/SSP-020-lamp-post-stack.md) Prototype a 4-slice sprite-stack lamp post and add it to lean_quadrants (D-02 input)

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR

## References

- ../../ART_BIBLE.md#86-props
- ../../ENTITY_CATALOG.md#9-props-and-obstacles-prop
- ../../ASSET_PIPELINE.md#107-small-prop-pickup-or-ui-icon-grids
- ../../ASSET_PIPELINE.md#75-special-cases

## Roadmap tasks covered

- `Small props: bollard, cone, hydrant, wheelie bin, A-board, recycling box, litter bin, post box.`
