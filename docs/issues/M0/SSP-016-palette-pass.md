---
id: SSP-016
title: "Implement the MRT world target and palette pass (64\u00b3 OKLab LUT, night/shadow remap)"
milestone: M0
status: done
type: feature
estimate: M
labels: [type:feature, area:render, area:test, size:M, vertical-slice]
depends_on: [SSP-015, SSP-005]
blocks: [SSP-017, SSP-018, SSP-045, SSP-297, SSP-066, SSP-069, SSP-284, SSP-102, SSP-287, SSP-298, SSP-118, SSP-210]
---

# SSP-016: Implement the MRT world target and palette pass (64³ OKLab LUT, night/shadow remap)

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** feature · **Size:** M · **Areas:** render, test · **Vertical slice**

## Summary

Add `palettePass.ts`, the guarantee that no colour outside Kerbside-32 reaches the screen. It needs an MRT world target (colour + shadow/light mask), a 64³ OKLab LUT built at boot whose nearest-colour function matches the forge fixture exactly, and night/shadow index remaps uploaded as a 32x2 texture.

## Context

RT_world = `WebGLRenderTarget(W+2, 272, { count: 2, depthBuffer: true })`:
- attachment 0: RGBA8 unlit colour;
- attachment 1: RGBA8 mask, R = shadow, G = light;
- 24-bit depth.
World materials are ShaderMaterial (glslVersion GLSL3) writing two outputs. Shadow/light draws use `blendEquation = MaxEquation` and output vec4(0) to attachment 0, so they write only the mask. Verify that MRT + MaxEquation work in three 0.186.1 under SwiftShader (headless Chromium with the visual flags); note the result in the PR for D-09.

Palette pass (full-screen, into RT_final (W+2)x272):
1. idx = LUT[r>>2][g>>2][b>>2] from a 64³ Data3DTexture (R8), built at boot from kerbside32.json (about 262k cells, ~30 ms, cached in memory);
2. if night is active and G == 0: idx = night[idx];
3. if R == 1: idx = shadow[idx] (shadow after night);
4. output palette[idx].
night[32]/shadow[32] are uploaded as a 32x2 texture. Bayer dither is not needed now.

Two separate functions, both pure TS and testable in Vitest without WebGL:
- `nearestIndex(r, g, b)`: exact-RGB OKLab nearest, float64, Ottosson matrices, lower index wins ties. It must equal the forge for all 4,096 fixture samples from SSP-005 (`tests/fixtures/palette_oklab_4096.json` or the path that issue chose). The parity test is against this function, NOT the LUT: a LUT cell covers 4³ RGB values and can legitimately differ from the exact nearest.
- `buildLut(palette): Uint8Array`: each cell's representative RGB is fed through nearestIndex. Then override the cells containing each palette colour to that colour's own index, asserting no two palette colours share a cell, so that every Kerbside-32 colour maps to itself through the LUT (TECHNICAL_DESIGN §12.6).
If parity fails only on near-ties because of cbrt ulp differences, apply the same quantisation the forge uses.

No-out-of-palette test: a CPU reference of the pass over random RGB + mask inputs (fast-check); readFrame-based checks come with test hooks.

Palette colours come only from kerbside32.json via `import palette from '../../assets-src/palette/kerbside32.json' with { type: 'json' }`. There are no hex literals in shader or TS code (hard rule 3); the letterbox CSS #0f0e12 in upscale.ts is the one exception.

## Scope

- src/render/palettePass.ts: nearestIndex, buildLut (pure), Data3DTexture upload, remap texture, full-screen pass
- MRT RT_world setup in Renderer.ts; a test world pass writes colour + mask
- Blit samples RT_final's inner Wx270 window with the sub-pixel offset
- Vitest: palette identity through the LUT, 4,096-sample nearestIndex parity, no-out-of-palette property, shadow-after-night ordering
- Manual SwiftShader check of MRT + MaxEquation (recorded in the PR)

## Out of scope

- Final night/shadow tables (SSP-021)
- Light cookies / fx.ts beyond a test quad
- UI pass (M2)

## Acceptance criteria

- [x] Vitest: all 32 palette colours map to their own index through buildLut
- [x] Vitest: nearestIndex equals the forge fixture for all 4,096 samples (zero mismatches)
- [x] Vitest (fast-check): for random RGB and mask inputs the CPU reference only outputs Kerbside-32 colours; for an index i with mask R=1 and night on, output = palette[shadow[night[i]]]
- [x] `grep -rnE '#[0-9a-fA-F]{6}|0x[0-9a-fA-F]{6}' src/render` matches only the #0f0e12 letterbox in upscale.ts
- [x] `npm run dev` renders a test world through the pass with no console errors; renderer.info (autoReset=false) counts all passes
- [x] The PR states whether MRT + MaxEquation worked under SwiftShader

## Verification

- npm test
- npm run typecheck
- npm run lint
- grep -rnE '#[0-9a-fA-F]{6}|0x[0-9a-fA-F]{6}' src/render

## Dependencies

**Depends on:**

- [SSP-015](SSP-015-render-core-camera-upscale.md) Build the renderer skeleton: perspective camera, sub-pixel snap, upscale and speed zoom
- [SSP-005](SSP-005-kerbside32-palette.md) Author kerbside32.json and forge OKLab palette mapping with a shared 4,096-sample fixture

**Blocks:**

- [SSP-017](SSP-017-city-mesh-shadows.md) Render merged 1/3/6-storey block meshes with facade ramps and SE shadow polygons
- [SSP-018](SSP-018-sprite-batch.md) Draw Bessie (32 headings) and the pedestrian via instanced sprite batches
- [SSP-045](../M1/SSP-045-render-ground-city.md) Render compiled levels: chunked ground layer and full cityMesh cell merge
- [SSP-297](../M1/SSP-297-r8-index-atlases-swap-texture.md) Convert actors/items atlases to R8 index textures with an identity 32x8 swap texture
- [SSP-066](../M2/SSP-066-grime-ground-shader.md) Sample the grime mask in the ground shader with incremental dirty-rect uploads
- [SSP-069](../M2/SSP-069-bitmap-text.md) Implement src/ui/bitmapText.ts and the UI render pass
- [SSP-284](../M2/SSP-284-boot-scene.md) Add BootScene: load atlases, fonts and the palette LUT once, then hand off to the shift flow
- [SSP-102](../M3/SSP-102-fx-placeholder-particles.md) Add placeholder particles in src/render/fx.ts for dust, splash and sparkle
- [SSP-287](../M3/SSP-287-pause-overlay.md) Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire
- [SSP-298](../M3/SSP-298-zoo-scene-review.md) Add a minimal test-only ZooScene for in-engine review of actors and items frames
- [SSP-118](../M4/SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-210](../M6/SSP-210-night-lighting.md) Implement night: night remap with street-lamp and headlight light mask

## References

- ../../TECHNICAL_DESIGN.md#123-frame-graph
- ../../TECHNICAL_DESIGN.md#126-lighting-night-and-the-palette-pass-shadowsts-fxts-palettepassts
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../ART_BIBLE.md#51-the-table
- ../../ART_BIBLE.md#57-shadow-and-night-remaps-intent
- ../../ROADMAP.md#6-risk-register
- ../../../CLAUDE.md#3-hard-rules-non-negotiable

## Roadmap tasks covered

- `src/render/palettePass.ts`: 64³ LUT, night remap, shadow remap. A test asserts that no output pixel lies outside Kerbside-32.
- A shared test vector file of 4,096 RGB samples → expected index, used by **both** pytest (forge) and Vitest (the 64³ LUT builder in `src/render/palettePass.ts`) ... [Vitest side]
