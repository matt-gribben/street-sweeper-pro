---
id: SSP-291
title: "Implement src/ui/minimap.ts: runtime 64\u00d764 district minimap in the single UI draw"
milestone: M4
status: todo
type: feature
estimate: M
labels: [type:feature, area:ui, area:render, area:test, size:M, vertical-slice]
depends_on: [SSP-069, SSP-070, SSP-032, SSP-055, SSP-060, SSP-064, SSP-105]
blocks: [SSP-156, SSP-158, SSP-300, SSP-192, SSP-214, SSP-261]
---

# SSP-291: Implement src/ui/minimap.ts: runtime 64×64 district minimap in the single UI draw

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** feature · **Size:** M · **Areas:** ui, render, test · **Vertical slice**

## Summary

Render the GDD §15.2 minimap at the bottom-right, built at runtime from compiled map data. It shows roads, pavements, buildings, a coarse grime heat tint, frontage status, pledge frontages, the depot bay, skips, hydrants and Bessie's arrow, all inside the single UI draw call.

## Context

GDD §15.2 Minimap: bottom-right, rendered at runtime from map data. It shows roads, Bessie's arrow, the depot bay, skips, hydrants and pledge frontages (green/red), with grime as a coarse heat tint.
ART_BIBLE §12.2: 64×64 (proposed) at the bottom-right inside the 4 px safe margin. Roads 03, pavement 05, buildings 01, grime 08, clean frontages 23, dirty frontages 18, and Bessie's arrow in 15 with an ink outline.
TECHNICAL_DESIGN §12.7: the minimap is drawn once per district from map data into a small region of a UI-owned canvas texture. Per frame, only the player and objective markers move, as UI instances. It must stay inside draw #7, the one UI instanced draw, so the region lives in the same texture the UI pass samples. Frontage status (SSP-064) and grime (SSP-060) change during a shift. Re-render only the affected minimap pixels, at a low rate and never every frame, and keep the update allocation-free.
Scale: Puddle Lane is 64×48 tiles, so 1 px per 2 m tile fits. High Street is 80×60, and the docs do not say what happens beyond 64 tiles. Proposal: keep 1 px per tile and scroll the window to keep Bessie in view. Record the decision in ART_BIBLE §12.2.
A pure `minimapPixels(level, grime, frontages)` function returns palette indices so it can be unit-tested. All colours are palette indices, never hex. The HUD reads sim state read-only (TECHNICAL_DESIGN §2.1).
Later consumers: SSP-156 restyles the minimap, SSP-192 reuses the renderer for the Mercury district map, SSP-214 draws the inspector route on it, and SSP-261 repositions it for touch.

The full-screen Tab shift map is SSP-300. It reuses `minimapPixels` and ideally the same full-district base region in the UI-owned texture. Keep the base layer addressable as a whole district at 1 px per tile, so the overlay can draw it as one integer-scaled quad.

## Scope

- src/ui/minimap.ts: base layer built once per district into a reserved region of the UI-owned texture
- Incremental updates for the grime tint and frontage clean/dirty status
- Per-frame UI instances for Bessie's arrow and the depot/skip/hydrant markers; pledge frontage marking
- Scrolling window for districts larger than 64 tiles (decision recorded in ART_BIBLE §12.2)
- Unit tests on minimapPixels and the window function; captures on Puddle Lane and High Street

## Out of scope

- Final HUD restyle (SSP-156)
- Mercury tally map (SSP-192)
- Inspector route overlay (SSP-214)
- Full-screen Shift map (Tab) overlay
- Touch layout (SSP-261)

## Acceptance criteria

- [ ] Unit test: minimapPixels maps road, pavement and building tiles to 03, 05 and 01, a fully grimy cell block to 08, a frontage at ≥ 90% clean to 23 and one below 90% to 18
- [ ] Unit test: on a level 80 tiles wide, the window keeps Bessie's tile inside the 64×64 view at the map edges and in the middle
- [ ] Cleaning a frontage past 90% turns its minimap pixels from 18 to 23 within 1 s of sim time without rebuilding the whole region (unit/integration test with an update counter)
- [ ] Captures of Puddle Lane and High Street show the minimap at the bottom-right inside the 4 px margin at W = 432 and W = 640 (frames Read and noted)
- [ ] renderer.info.render.calls stays ≤ 10 with the minimap visible, and the minimap update path allocates nothing per frame
- [ ] `npm run test:visual` passes; any golden change is Read (expected/actual/diff) before updating

## Verification

- npx vitest run tests/unit/minimap.test.ts
- npm run test:visual
- npm run test:e2e
- npm run typecheck && npm run lint && npm test

## Dependencies

**Depends on:**

- [SSP-069](../M2/SSP-069-bitmap-text.md) Implement src/ui/bitmapText.ts and the UI render pass
- [SSP-070](../M2/SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-032](../M1/SSP-032-level-map-codec.md) Add src/sim/map.ts compiled-level codec, tile/surface/collide ids and solid merge
- [SSP-055](../M2/SSP-055-compile-frontages-dump-validation.md) Generate frontages and pledges in the compiler and validate dump sites
- [SSP-060](../M2/SSP-060-grime-mask.md) Implement dirt.ts grime mask, initial selection, footprint erase and Kerb Hugger
- [SSP-064](../M2/SSP-064-tidy-frontages.md) Compute Tidy %, per-frontage clean % and Clean Sweep bonuses incrementally
- [SSP-105](../M3/SSP-105-high-street-greybox.md) Author and compile the grey-box High Street (80×60) for Tuesday's NPCs

**Blocks:**

- [SSP-156](SSP-156-hud-final-art.md) Restyle the HUD and score popups with final fonts, icons and panels
- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-300](SSP-300-shift-map-overlay.md) Add the Tab shift map overlay: district map with frontage status, depot, skips and hydrants, without pausing
- [SSP-192](../M6/SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-214](../M6/SSP-214-inspector.md) Implement npc.inspector and the inspection event with frontage deductions
- [SSP-261](../M8/SSP-261-touch-hud-adaptation.md) Adapt the HUD layout so it never sits under the thumbs in touch mode

## References

- ../../GDD.md#152-hud-layout
- ../../ART_BIBLE.md#122-hud-layout-480270-reference-anchored-to-corners-for-other-widths
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom
- ../../ROADMAP.md#m4-art-pass-1

## Roadmap tasks covered

- `Deliverable: Final fonts (...), the HUD, 9-slice panels, and portraits. (minimap element of the HUD)`
