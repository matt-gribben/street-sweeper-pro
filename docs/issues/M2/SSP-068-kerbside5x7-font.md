---
id: SSP-068
title: "Draft Kerbside 5\u00d77 glyphs and add the forge font builder and ui atlas"
milestone: M2
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, area:tooling, area:ui, size:M, vertical-slice]
depends_on: [SSP-004, SSP-009, SSP-039]
blocks: [SSP-069, SSP-284, SSP-285, SSP-141, SSP-142]
---

# SSP-068: Draft Kerbside 5×7 glyphs and add the forge font builder and ui atlas

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** asset · **Size:** M · **Areas:** assets, tooling, ui · **Vertical slice**

## Summary

Write the first draft of `assets-src/fonts/kerbside5x7.glyphs.txt` covering the full character set, and teach the forge to build it into the `ui` atlas with an outlined variant and a metrics JSON, so the HUD and tally can draw text.

## Context

Glyph file format (ASSET_PIPELINE §6.3): header `font: Kerbside 5x7`, `glyph: 5x7`, `cell: 6x8`, `baseline: 7`, `advance: 6`; blocks `glyph "X"` followed by 7 rows of 5 chars (`#` = ink, `.` = empty); `kern "AV" -1` lines. Character set: ASCII 32–126 (95 glyphs) plus £ ★ → ← ↑ ↓ = 101 glyphs.
Design rules (ART_BIBLE §12.5, proposed, locked in M4): cap height 7, x-height 5, 1 px stroke; descenders (g, j, p, q, y) raise their bowls two rows so the tail ends on row 7; default advance 6, narrow glyphs (i, l, !, .) advance 2–4 via metrics; line height 8 (HUD) / 9 (paragraphs); £ on the baseline with a cap-height ascender; ★ fills all 7 rows. Starter kerning set: AV AW AT AY LT LY PA TA VA WA YA Fo To Te Ty r. r, ££. Specimen glyphs for A, g, £, ★ are in ART_BIBLE §12.5.
Forge output: glyph frames packed into the `ui` atlas (new in M2, ≤ 2048²), an automatically built outlined variant (1 px ink, 8-connected for text, growing each glyph by 1 px each side, advance +1), and metrics JSON at `public/assets/fonts/kerbside5x7.json` consumed by `src/ui/bitmapText.ts`. Byte-deterministic output; pytest coverage for the parser and outline. Glyph pixels must render in Kerbside-32 colours (e.g. 07 ink on transparent; 00 outline).
Fonts are always text grids: never use AI image generation. Kerbside Bold 8×8 is NOT in M2 (M4).
Manifest: class `font` exists in the ID convention (CLAUDE.md §5.4); propose `font.kerbside5x7` and an outlined-variant naming (e.g. frame state `outline`), and record it in the manifest and ASSET_PIPELINE §6.3.

## Scope

- `assets-src/fonts/kerbside5x7.glyphs.txt` with all 101 glyphs and the starter kerning set
- Forge font builder: parse, render, outline variant, metrics JSON, pack into `ui` atlas
- Manifest entry and regenerated `src/gen/assets.ts`, `public/assets/fonts/`, atlas and hashes
- pytest for the glyph parser and 8-connected outline

## Out of scope

- Kerbside Bold 8×8 (M4)
- The `hud_specimen` visual golden (M4)
- HUD icons and 9-slice panels (M4)

## Acceptance criteria

- [ ] The glyph file parses and contains exactly 101 glyphs (ASCII 32–126 plus £ ★ → ← ↑ ↓) and every starter kerning pair
- [ ] `public/assets/fonts/kerbside5x7.json` lists advance, kerning and frame references for every glyph, including the outlined variant (advance +1)
- [ ] pytest verifies the outline is 8-connected and grows each glyph by exactly 1 px per side
- [ ] Forge pytest passes; two builds produce byte-identical outputs; `npm run assets:verify` passes
- [ ] `npm run assets:lint` passes (palette-only pixels)
- [ ] `build/sheets/ui.png` was Read and every glyph is legible at 1×

## Verification

- uv run --project tools/forge pytest tools/forge/tests
- npm run assets
- npm run assets:lint
- npm run assets:verify
- npm run assets:sheets  # Read build/sheets/ui.png

## Dependencies

**Depends on:**

- [SSP-004](../M0/SSP-004-forge-skeleton-pixelize.md) Create the forge Python package (uv, CLI skeleton) and import pixelize.py with tests
- [SSP-009](../M0/SSP-009-forge-build-grid-blender.md) Implement forge build for grid and blender techniques with outline and byte-stable PNGs
- [SSP-039](../M1/SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end

**Blocks:**

- [SSP-069](SSP-069-bitmap-text.md) Implement src/ui/bitmapText.ts and the UI render pass
- [SSP-284](SSP-284-boot-scene.md) Add BootScene: load atlases, fonts and the palette LUT once, then hand off to the shift flow
- [SSP-285](../M3/SSP-285-ui-panels-9slice.md) Implement src/ui/panels.ts 9-slice panels and button states with placeholder panel grids
- [SSP-141](../M4/SSP-141-font-builder-outline-kerning.md) Font builder: per-glyph advance syntax, kerning validation and Kerbside Bold 8x8 support
- [SSP-142](../M4/SSP-142-font-kerbside-5x7.md) Finalise Kerbside 5x7 glyphs, metrics and kerning

## References

- ../../ASSET_PIPELINE.md#63-glyph-files-glyphstxt
- ../../ASSET_PIPELINE.md#1012-font-glyph-changes
- ../../ART_BIBLE.md#125-pixel-fonts
- ../../ASSET_PIPELINE.md#93-packing-and-outputs
- ../../ROADMAP.md#51-asset-readiness-by-milestone

## Roadmap tasks covered

- `src/ui/bitmapText.ts` with a first draft of `assets-src/fonts/kerbside5x7.glyphs.txt` (ASCII 32–126 plus £ ★ → ← ↑ ↓). (glyph file and forge part)
