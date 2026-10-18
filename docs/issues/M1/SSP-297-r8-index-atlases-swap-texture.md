---
id: SSP-297
title: "Convert actors/items atlases to R8 index textures with an identity 32x8 swap texture"
milestone: M1
status: todo
type: feature
estimate: M
labels: [type:feature, area:render, area:test, size:M, vertical-slice]
depends_on: [SSP-018, SSP-010, SSP-039, SSP-005, SSP-016, SSP-022]
blocks: [SSP-067, SSP-103, SSP-114]
---

# SSP-297: Convert actors/items atlases to R8 index textures with an identity 32x8 swap texture

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** feature · **Size:** M · **Areas:** render, test · **Vertical slice**

## Summary

Make the documented ramp-swap renderer path real. At load, convert the `actors` and `items` atlases to R8 index textures and build a 32x8 swap texture per atlas from the atlas JSON `swaps` (identity until M4). The sprite and drop-shadow shaders apply the instance's swap row before the palette lookup. SSP-114 then only has to fill the tables.

## Context

TECHNICAL_DESIGN §12.5: at load, the `actors` and `items` atlases are converted to R8 index textures by exact hex -> index lookup; a non-palette pixel is a load-time error. The fragment shader reads the index, applies the instance's swap row from a 32x8 swap texture (up to 8 swap tables per atlas), then looks up the palette texture. SSP-018 (M0) only recommends this path and allows RGBA sampling for the spike. Yet SSP-067 (M2) assumes the items atlas is R8, SSP-103 (M3) writes per-instance swap slots for shopper outfits and car paint, and SSP-114 (M4) fills the 8 real tables. This issue guarantees the path before any of them.
Inputs: the atlas JSON from SSP-010/SSP-039 is `{ frames, swaps: {} }`, and kerbside32.json `swaps` stays `{}` until M4 (SSP-005). The representation (named vs slot) is not locked until SSP-114 settles the conflict between ASSET_PIPELINE §6.1/§9.3 and ART_BIBLE §5.6. Until then, parse `swaps` as an object of at most 8 tables keyed `slot_0`..`slot_7`, each `{ "<srcIndex>": dstIndex }`. Missing slots are identity, and slot 0 is always identity. SSP-114 updates the parser if it locks a different form.
Transparency: R8 has no alpha channel. Proposal: index 255 means transparent and is discarded by the binary alpha test (actors are alpha-tested, §12.5); document this in §12.5. A semi-transparent pixel is a load error, like a non-palette pixel (forge lint already forbids them).
The per-instance `swap` (uint8) attribute already exists from SSP-018. The drop-shadow draw samples the same index textures through its per-instance atlas selector. Draw calls must not rise (≤ 10, §12.7). If SSP-018 already implemented the R8 path, keep it and add the swap-texture build and the tests.

## Scope

- Atlas load: PNG -> R8 index DataTexture via exact Kerbside-32 hex lookup, with 255 for transparent; a non-palette or semi-transparent pixel throws an error naming the atlas and the pixel x,y
- Per-atlas 32x8 R8 swap DataTexture built from the atlas JSON `swaps` (identity rows by default; more than 8 tables, or an index >= 32, is a load error)
- Sprite and drop-shadow shaders: index -> swap row selected by the per-instance `swap` -> palette texture; discard on 255
- TECHNICAL_DESIGN §12.5: document the transparent sentinel and the provisional `swaps` parsing
- Vitest coverage for conversion, swap-texture building and load errors

## Out of scope

- Authoring swap tables and locking key indices (SSP-114, M4)
- Beacon flash slot toggling (SSP-114)
- World, ui and fx atlases (§12.5 index-converts only actors and items)
- Assigning outfit/paint slots to instances (SSP-084, SSP-090, SSP-103)

## Acceptance criteria

- [ ] Vitest: converting a fixture atlas maps each of the 32 Kerbside-32 hex values to its index and fully transparent pixels to 255
- [ ] Vitest: a non-palette pixel and a semi-transparent pixel each fail at load with an error naming the atlas and the pixel coordinates
- [ ] Vitest: with `swaps: {}`, row k, column i of the 32x8 swap texture equals i for all 8 rows
- [ ] Vitest: with fixture `swaps: { "slot_1": { "21": 19 } }`, row 1 maps 21 -> 19 and every other entry is identity; a 9th table, or a destination index >= 32, fails at load
- [ ] The existing `lean_quadrants` and `scale_1440` visual goldens pass unchanged at threshold 0 (identity swaps are pixel-identical)
- [ ] renderer.info.render.calls is unchanged (≤ 10) in the spike scene
- [ ] npm run typecheck, lint and test pass

## Verification

- npm test
- npm run test:visual
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-018](../M0/SSP-018-sprite-batch.md) Draw Bessie (32 headings) and the pedestrian via instanced sprite batches
- [SSP-010](../M0/SSP-010-forge-pack-verify.md) Add deterministic atlas packing, generated assets.ts, asset-hashes.json and forge verify
- [SSP-039](SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end
- [SSP-005](../M0/SSP-005-kerbside32-palette.md) Author kerbside32.json and forge OKLab palette mapping with a shared 4,096-sample fixture
- [SSP-016](../M0/SSP-016-palette-pass.md) Implement the MRT world target and palette pass (64³ OKLab LUT, night/shadow remap)
- [SSP-022](../M0/SSP-022-visual-goldens.md) Add lean_quadrants and scale_1440 visual specs and goldens; prove 10-run stability (D-09)

**Blocks:**

- [SSP-067](../M2/SSP-067-items-sprite-batch.md) Render litter, stains and site markers via the items instance batch
- [SSP-103](../M3/SSP-103-render-actors-traffic.md) Draw NPCs, animals, traffic, knockables and hazards with state-driven frames
- [SSP-114](../M4/SSP-114-ramp-swap-tables.md) Lock ramp-swap key indices and emit the 8 swap tables per atlas

## References

- ../../TECHNICAL_DESIGN.md#125-sprites-spritebatchts-spritestackts
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../ART_BIBLE.md#56-ramp-swaps-per-instance-palette-variants
- ../../ASSET_PIPELINE.md#93-packing-and-outputs

## Roadmap tasks covered

_None._
