---
id: SSP-131
title: "Blender sprite-stack props: lamp post, phone box, tree, bus shelter, stall"
milestone: M4
status: todo
type: asset
estimate: L
labels: [type:asset, area:assets, area:tooling, area:render, size:L, vertical-slice]
depends_on: [SSP-115, SSP-116, SSP-118, SSP-020, SSP-024, SSP-101]
blocks: [SSP-158, SSP-206, SSP-209, SSP-210]
---

# SSP-131: Blender sprite-stack props: lamp post, phone box, tree, bus shelter, stall

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** L · **Areas:** assets, tooling, render · **Vertical slice**

## Summary

Model the tall Blender props as sprite stacks rendered in horizontal slices, so the perspective camera leans them in step with the buildings.

## Context

Sprite-stack props use `--headings 1`. The script renders 4-8 horizontal slices by moving the camera's `clip_start`/`clip_end` through height bands (`SLICES = [(z0, z1), ...]`), writing `slice_0.png ... slice_N.png`. Frame IDs are `prop.phone_box:slice:-:<k>` with k = 0 at ground; manifest `states: ['slice']`, `dirs: '-'`, `frames: {slice: N}`, `cell: [32,32]` (ASSET_PIPELINE §6.6, §7.5, §10.2). If the M0 blender build path does not read `slice_<k>.png` into `slice` frames, add it. Props (ART_BIBLE §8.6, ENTITY_CATALOG §9.2): `prop.lamp_post` (Blender proposed; 01 post, 07 lamp head that writes the light mask at night; ART_BIBLE suggests 8 slices); `prop.phone_box` 18 with 25 glass; `prop.tree` canopy of 21/22/23 clumps overhanging pavements; `prop.bus_shelter` 05 frame, 28 glass panels, 26 roof; `prop.market_stall` striped 18/07 or 26/07 awning (12 pitches on High Street). Slice counts per prop, and which slices cast drop shadows, were decided in the M0 spike: read the outcome from `assets-src/STYLE.md` and ROADMAP §8. Size gap: at 16 px/m a bus shelter (~3-4 m), market stall (~3 m) and tree canopy (4-6 m) exceed the 32x32 slice cell. Decide each prop's cell and record it in ART_BIBLE §7.1 / ENTITY_CATALOG §9, flagging the change to the M0-signed size sheet (D-07) for the lead. Sprite stacks are drawn in the items batch at increasing heights (TECHNICAL_DESIGN §12.5). Review must check `lean_quadrants`: each stack leans with the buildings and its slices line up when the camera is centred.

## Scope

- `assets-src/blender/props/{lamp_post,phone_box,tree,bus_shelter,market_stall}.py`
- Renders (slices) + render.json; manifest entries with slice counts from M0
- Blender build support for slice frames if missing
- Decide and document cell sizes for props larger than 32x32
- Replace the M0 lamp-post stack prototype
- Review on sheet, zoo and `lean_quadrants`

## Out of scope

- Night light-mask behaviour of lamp heads (M6 Kebab Mile)
- Grid-authored stacks (bollard, bins, cone, A-board: SSP-148)

## Acceptance criteria

- [ ] All five props render as slice stacks and pass `npm run assets:blender -- <id> --check` with 0 changed pixels
- [ ] Slice counts match the M0 decision and are recorded in the manifest
- [ ] Cell sizes for oversize props are documented in ART_BIBLE §7.1 and ENTITY_CATALOG §9
- [ ] In `lean_quadrants` (or a capture with all four quadrants) each stack leans in step with adjacent buildings (Read)
- [ ] Lint clean (outline on every slice); sheet + zoo read and noted

## Verification

- npm run assets:blender -- prop.phone_box --check (repeat for each prop)
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas items, then Read build/sheets/items.png
- npm run test:visual (lean_quadrants, zoo)

## Dependencies

**Depends on:**

- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-118](SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-020](../M0/SSP-020-lamp-post-stack.md) Prototype a 4-slice sprite-stack lamp post and add it to lean_quadrants (D-02 input)
- [SSP-024](../M0/SSP-024-look-decisions.md) Decide speed zoom, vehicle tilt, 480x270 base and scale sheet (D-01, D-02, D-03, D-07)
- [SSP-101](../M3/SSP-101-placeholder-props-hazards.md) Add placeholder sprites for knockables, hazards, SSP-096 and High Street props

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-206](../M6/SSP-206-district-conker-hill.md) Author and compile district.conker_hill (Thursday, wind and leaf fall)
- [SSP-209](../M6/SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-210](../M6/SSP-210-night-lighting.md) Implement night: night remap with street-lamp and headlight light mask

## References

- ../../ASSET_PIPELINE.md#102-volumetric-or-tall-prop-prop-blender--sprite-stack
- ../../ASSET_PIPELINE.md#75-special-cases
- ../../ART_BIBLE.md#86-props
- ../../ART_BIBLE.md#64-shadows
- ../../ART_BIBLE.md#71-size-sheet-locked
- ../../TECHNICAL_DESIGN.md#125-sprites-spritebatchts-spritestackts

## Roadmap tasks covered

- `assets-src/blender/props/*.py`: bus shelter, phone box, bench, tree canopy, market stall, skip, with sprite-stack slices for tall props (lamp posts, phone boxes, trees).
