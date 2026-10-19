---
id: SSP-098
title: "Author placeholder grids for businessman, litterbug and market trader"
milestone: M3
status: done
type: asset
estimate: M
labels: [type:asset, area:assets, area:test, size:M]
depends_on: [SSP-009, SSP-039, SSP-298]
blocks: [SSP-103, SSP-115, SSP-137, SSP-138]
---

# SSP-098: Author placeholder grids for businessman, litterbug and market trader

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** asset · **Size:** M · **Areas:** assets, test

## Summary

Write placeholder text-grid sprites for the three Tuesday-only human NPCs in the same 24×24, 13-frames-per-direction format and final frame IDs as the Monday cast.

## Context

Format and rules are identical to SSP-097 (reuse its generator script if it exists): 24×24 cell; S, SW, W, NW, N authored with mirror lines for SE, E, NE; walk 4, idle 2, startle 2, fall 3, angry 2; 65 authored frames and 104 frame IDs each; manifest technique `grid`, `"placeholder": true`, atlas actors, outline false, sorted entries. Files in assets-src/sprites/npc/.

Colour keys (ART_BIBLE §7.3):
- npc.businessman: suit 03/02, shirt 07, tie 18; phone 00/05 at the ear. Signature silhouette: arm up to the ear. Idle = phone.
- npc.litterbug: hoodie 04/03, cap 18; hood up, hands in pockets. Slink-off uses the walk frames (head down).
- npc.market_trader: apron 26/07 stripes, flat cap 03. Idle = calling out.
Adult build: 22 px tall, figure ≤ 18×22.

Zoo review uses the minimal M3 ZooScene (SSP-298), with `&asset=<id>` for full-frame views. The zoo golden is M4 (SSP-118).

## Scope

- Three .sprite.txt files with all frames and mirror lines.
- Manifest entries with placeholder: true.
- Run `npm run assets`, commit the generated outputs, Read the contact sheets and zoo screenshot.

## Out of scope

- Final art (M4).

## Acceptance criteria

- [ ] All 104 frame IDs per ID exist in src/gen/assets.ts.
- [ ] `npm run assets:lint` and `npm run assets:verify` pass; figures fit 18×22 (bounds report in the PR).
- [ ] Contact sheets and `?test=1&scene=zoo` were opened with Read; the PR notes the silhouettes are distinct (businessman's arm to ear, litterbug's hood).
- [ ] `npm run test:visual` passes (existing goldens).

## Verification

- npm run assets
- npm run assets:lint
- npm run assets:verify
- npm run assets:sheets
- npm run typecheck
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-009](../M0/SSP-009-forge-build-grid-blender.md) Implement forge build for grid and blender techniques with outline and byte-stable PNGs
- [SSP-039](../M1/SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end
- [SSP-298](SSP-298-zoo-scene-review.md) Add a minimal test-only ZooScene for in-engine review of actors and items frames

**Blocks:**

- [SSP-103](SSP-103-render-actors-traffic.md) Draw NPCs, animals, traffic, knockables and hazards with state-driven frames
- [SSP-115](../M4/SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-137](../M4/SSP-137-char-businessman-litterbug.md) Final npc.businessman and npc.litterbug
- [SSP-138](../M4/SSP-138-char-market-trader.md) Final npc.market_trader

## References

- ../../ART_BIBLE.md#71-size-sheet-locked
- ../../ART_BIBLE.md#72-human-proportions-2424-cell
- ../../ART_BIBLE.md#73-character-colour-keys
- ../../ASSET_PIPELINE.md#62-text-grid-sprite-spritetxt

## Roadmap tasks covered

- `Placeholder grids for all M3 NPCs: 24×24 humans with 13 frames per direction ... (Tuesday cast)`
