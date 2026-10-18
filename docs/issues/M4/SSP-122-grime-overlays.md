---
id: SSP-122
title: "Procedural grime overlay patterns for asphalt, slab and gutter"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, area:render, area:tooling, size:M, vertical-slice]
depends_on: [SSP-111, SSP-115, SSP-116, SSP-118, SSP-119, SSP-121, SSP-060, SSP-066]
blocks: [SSP-158]
---

# SSP-122: Procedural grime overlay patterns for asphalt, slab and gutter

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets, render, tooling · **Vertical slice**

## Summary

Author the final tileable grime overlay patterns that the ground shader masks per 4 px cell, meeting the Pillar 1 contrast target so the clean reveal is visibly satisfying.

## Context

ART_BIBLE §9.2: each 32 px tile has an 8x8 grid of 4 px grime cells. The ground shader draws grime as a tileable overlay pattern per surface (asphalt, slab, gutter), masked per 4 px cell. Patterns are mostly 08 soot_brown and 13 umber blotches with 01 flecks, covering ~60-80% of a dirty cell's pixels. Contrast target: >= 60% of pixels in a fully dirty cell differ from the clean tile by one or more ramp steps, and the dirty/clean boundary must be visible at 1x from a full screen away. Gutter grime is darker and denser: 08 and 01, ~90% coverage, in a 4-8 px band against the kerb. The clean edge is stepped in 4 px blocks (do not smooth it). 08 is the primary grime colour. The M2 ground shader samples the grime mask (one texel per 4 px cell; TECHNICAL_DESIGN §12.4). Open: the docs name no grime pattern asset IDs. Reuse whatever M2 used (or propose `tile.grime_*` within the `tile` class) and record it. ROADMAP VS-1 (before/after capture) is judged at the gate; this issue provides the art and a deterministic test view.

## Scope

- Grime pattern generator(s) in `tools/forge/forge/procedural/stains.py` or `tiles.py` with params JSON
- pytest contrast metric vs the final clean asphalt and slab tiles; gutter coverage
- Wire final patterns into the ground shader in place of placeholders if IDs change
- A zoo band (or test page) showing half-dirty/half-clean asphalt, slab and gutter cells side by side

## Out of scope

- Grime mask simulation (M2)
- Weather or night variants (M6)

## Acceptance criteria

- [ ] pytest: >= 60% of pixels in a fully dirty asphalt cell and a fully dirty slab cell differ from the clean tile by >= 1 ramp step
- [ ] pytest: gutter pattern coverage is between 85% and 95% and uses only 08/01
- [ ] Patterns tile seamlessly (seam lint clean)
- [ ] The zoo shows the dirty/clean boundary on asphalt, slab and gutter at 1x; Read and noted in the PR
- [ ] `npm run test:visual` passes, or changed goldens are reviewed (expected/actual/diff) and approved with a reason

## Verification

- uv run --project tools/forge pytest
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run test:visual, then Read the zoo actual/diff if changed

## Dependencies

**Depends on:**

- [SSP-111](SSP-111-forge-build-procedural.md) Harden the procedural technique: generator registry, params validation, fx play frames and a shared seam metric
- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-118](SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-119](SSP-119-tiles-road-surfaces.md) Final procedural road tiles: asphalt, markings, double yellows, zebra, drains, bays
- [SSP-121](SSP-121-tiles-pavement-grass-cobbles.md) Final pavement slabs, grass, cobbles, setts, tactile paving and edge tiles
- [SSP-060](../M2/SSP-060-grime-mask.md) Implement dirt.ts grime mask, initial selection, footprint erase and Kerb Hugger
- [SSP-066](../M2/SSP-066-grime-ground-shader.md) Sample the grime mask in the ground shader with incremental dirty-rect uploads

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR

## References

- ../../ART_BIBLE.md#92-grime-and-the-clean-reveal
- ../../TECHNICAL_DESIGN.md#124-city-mesh-and-ground-citymeshts-groundlayerts
- ../../ROADMAP.md#34-acceptance

## Roadmap tasks covered

- `Stains and grime variants.`
