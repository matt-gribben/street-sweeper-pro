---
id: SSP-066
title: "Sample the grime mask in the ground shader with incremental dirty-rect uploads"
milestone: M2
status: todo
type: feature
estimate: M
labels: [type:feature, area:render, area:perf, size:M, vertical-slice]
depends_on: [SSP-060, SSP-052, SSP-065, SSP-045, SSP-016, SSP-019, SSP-022]
blocks: [SSP-074, SSP-119, SSP-122]
---

# SSP-066: Sample the grime mask in the ground shader with incremental dirty-rect uploads

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** feature · **Size:** M · **Areas:** render, perf · **Vertical slice**

## Summary

Upload `dirt.ts`'s grime mask as an R8 texture and blend the per-surface grime overlay in the ground fragment shader, re-uploading only the changed region each rendered frame, so cleaning is visible pixel by pixel behind the brush.

## Context

Ground (TECHNICAL_DESIGN §12.4): the ground uses the world atlas through per-vertex tile rects plus the grime mask sampled per fragment (one texel per 4 px cell) to blend the grime overlay; a per-vertex flag disables grime on walls and roofs. The city mesh stays one draw call (budget ≤ 10, §12.7).
Texture (TECHNICAL_DESIGN §10.3): `R8` `DataTexture` of (tilesW·8)×(tilesH·8) (Puddle Lane 512×384 = 196,608 B), NearestFilter, no mipmaps. Bits 0–6 = intensity (overlay strength), bit 7 = gutter grime (gutter pattern). `dirt.ts` records a dirty rectangle per tick; `render/groundLayer.ts` merges the rects of all ticks in the frame and uploads that sub-rectangle once per rendered frame. If three 0.186.1's update-range API cannot express a sub-rectangle upload, fall back to a full upload (≤ 786 KB) as TECHNICAL_DESIGN §10.3 allows, and record the measured cost. The roadmap wording 'only dirty chunks are re-uploaded' is satisfied by the dirty rect.
Look (ART_BIBLE §9.2): overlay patterns per surface (asphalt, slab, gutter) from the placeholder grime overlay frames (IDs documented by SSP-052). The clean edge is stepped in 4 px blocks on purpose; do not smooth it. No hex in shader constants (palette by index; the palette pass guarantees the screen).
Rules: render reads sim state, never writes it; no per-frame `new THREE.*`; one `needsUpdate` per frame.
Visual evidence: no M2 golden covers grime (`zoo`/`hud_specimen` arrive in M4) and the golden scene list is fixed (TECHNICAL_DESIGN §18.4). Add `tests/e2e/grimeReveal.spec.ts`: open `/?test=1&seed=1&scene=district.puddle_lane&freeze=1`, save `__ssp.readFrame()` (W×270 RGBA) as PNG via pngjs to `test-results/grime_before.png`, drive a brush-down path (Playwright `keyboard.down('Space')`/`up`, hold `W`, between `__ssp.step(n)` calls; camera pinned with `__ssp.setCamera`), save `grime_after.png`, and assert pixels changed in the driven band. Put the PNG save in `tests/e2e/helpers/saveFrame.ts` (create it if missing) so other issues reuse it. Read both PNGs. Existing `lean_quadrants` and `scale_1440` goldens must pass unchanged.

## Scope

- Grime `DataTexture` owned by `src/render/groundLayer.ts`, bound to the ground ShaderMaterial
- Fragment shader overlay blend per surface with gutter variant and wall/roof disable flag
- Dirty-rect accumulation and sub-rect upload (or documented full-upload fallback)
- `tests/e2e/grimeReveal.spec.ts` and `tests/e2e/helpers/saveFrame.ts`; before/after PNG evidence

## Out of scope

- Final grime art (M4)
- Minimap grime tint (later)
- New visual golden scenes

## Acceptance criteria

- [ ] In the frozen Puddle Lane frame, grime is visible on route tiles and absent on walls, roofs, grass and aprons (frame Read)
- [ ] `grimeReveal.spec.ts` passes: after the scripted brush-down drive, at least 500 pixels in the driven band differ from the before-frame and both PNGs were Read and attached to the PR
- [ ] A unit test on the rect-merge helper shows that only the union of the frame's dirty rects is uploaded (or the fallback and its measured cost are documented in TECHNICAL_DESIGN §10.3)
- [ ] Draw calls stay ≤ 10 (`renderer.info.render.calls` with `autoReset = false`)
- [ ] `npm run test:visual` passes with `lean_quadrants` and `scale_1440` unchanged

## Verification

- npx vitest run tests/unit/grimeUpload.test.ts
- npm run test:e2e -- tests/e2e/grimeReveal.spec.ts  # then Read test-results/grime_before.png and grime_after.png
- npm run test:visual
- npm run typecheck && npm run lint

## Dependencies

**Depends on:**

- [SSP-060](SSP-060-grime-mask.md) Implement dirt.ts grime mask, initial selection, footprint erase and Kerb Hugger
- [SSP-052](SSP-052-placeholder-stains-pickups-sites.md) Add stain generator, grime overlays and pickup/collectible/site/hydrant grids
- [SSP-065](SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-045](../M1/SSP-045-render-ground-city.md) Render compiled levels: chunked ground layer and full cityMesh cell merge
- [SSP-016](../M0/SSP-016-palette-pass.md) Implement the MRT world target and palette pass (64³ OKLab LUT, night/shadow remap)
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-022](../M0/SSP-022-visual-goldens.md) Add lean_quadrants and scale_1440 visual specs and goldens; prove 10-run stability (D-09)

**Blocks:**

- [SSP-074](SSP-074-close-m2.md) Close M2: verify exit criteria, record decisions and tag m2
- [SSP-119](../M4/SSP-119-tiles-road-surfaces.md) Final procedural road tiles: asphalt, markings, double yellows, zebra, drains, bays
- [SSP-122](../M4/SSP-122-grime-overlays.md) Procedural grime overlay patterns for asphalt, slab and gutter

## References

- ../../TECHNICAL_DESIGN.md#124-city-mesh-and-ground-citymeshts-groundlayerts
- ../../TECHNICAL_DESIGN.md#103-grime-mask-srcsimdirtts
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../TECHNICAL_DESIGN.md#184-visual-headless-screenshot-tests
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../ART_BIBLE.md#92-grime-and-the-clean-reveal

## Roadmap tasks covered

- `Ground shader samples the grime mask texture. The upload is incremental: only dirty chunks are re-uploaded each frame.`
- `Deliverable: The grime mask uploaded to the ground shader, so cleaning is visible pixel by pixel.`
