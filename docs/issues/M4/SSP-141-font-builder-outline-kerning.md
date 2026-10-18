---
id: SSP-141
title: "Font builder: per-glyph advance syntax, kerning validation and Kerbside Bold 8x8 support"
milestone: M4
status: todo
type: feature
estimate: S
labels: [type:feature, area:tooling, area:ui, area:test, size:S, vertical-slice]
depends_on: [SSP-069, SSP-068]
blocks: [SSP-142, SSP-143, SSP-191]
---

# SSP-141: Font builder: per-glyph advance syntax, kerning validation and Kerbside Bold 8x8 support

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** feature · **Size:** S · **Areas:** tooling, ui, test · **Vertical slice**

## Summary

SSP-068 built the forge font builder (outlined variant, metrics JSON with advances and kerning), and SSP-069 applies kerning, advances and the outlined variant in `bitmapText.ts`. This issue adds three things: a documented per-glyph advance override in the glyph file, so narrow glyphs (i, l, !, .) get advances 2-4; validation of the kerning table; and builder and bitmapText support for the Kerbside Bold 8x8 format (8x8 glyph, 9x10 cell, advance 9), so SSP-143 only has to write glyphs.

## Context

Already done; do not redo:
- SSP-068 (M2) built the glyph-file parser for the ASSET_PIPELINE §6.3 grammar: header `font:`, `glyph: 5x7`, `cell: 6x8`, `baseline: 7`, `advance: 6`; `glyph "X"` blocks with `#` ink and `.` empty; and `kern "AV" -1` lines. It renders into the `ui` atlas, generates the outlined variant automatically (1 px ink, 8-connected, each glyph grown 1 px per side, advance +1; ART_BIBLE §12.5) and writes `public/assets/fonts/kerbside5x7.json` with advances, kerning and frame references, with pytest for the parser and the outline.
- SSP-069 (M2): `src/ui/bitmapText.ts` applies kerning and narrow advances, selects the outlined variant (used for all playfield text, ART_BIBLE §6.3) and uses line height 8 for the HUD and 9 for paragraphs.

Gaps this issue closes:
1. Narrow advances. ART_BIBLE §12.5 says narrow glyphs (i, l, !, .) use advance 2-4 'via the metrics JSON', but §6.3 shows no per-glyph advance syntax. Define one (e.g. `glyph "i" advance 2`), document it in ASSET_PIPELINE §6.3, and have the builder write it into the metrics (+1 for the outlined variant).
2. Kerning validation. A kern pair must name exactly two glyphs defined in the file and carry an integer value, and a duplicate pair is an error. Each error names the file and line. Pairs apply to both the plain and the outlined metrics.
3. Kerbside Bold 8x8: an 8x8 glyph in a 9x10 cell with advance 9 (ASSET_PIPELINE §6.3, ART_BIBLE §12.5), with the same character set. The builder must take glyph size, cell and advance from each file's header rather than hard-coding 5x7, and must reject glyph rows that do not match the header size. Prove it with a small fixture file; the real glyphs are SSP-143. bitmapText must be able to lay out text with either font's metrics.

Fonts are never AI-generated.

## Scope

- Glyph-file grammar: a per-glyph advance override, documented in ASSET_PIPELINE §6.3 and written into the metrics (+1 for the outlined variant)
- Kerning-table validation (undefined glyphs, wrong pair length, non-integer values, duplicates) with file:line errors
- Header-driven glyph/cell/advance in the builder, so a Kerbside Bold 8x8 file (8x8 in 9x10, advance 9) builds into the ui atlas and `public/assets/fonts/<font>.json`
- `bitmapText.ts`: lay out with a chosen font's metrics (5x7 or Bold 8x8), if SSP-069 hard-coded kerbside5x7
- pytest for the advance syntax, kerning validation and the 8x8 fixture; a Vitest test for Bold 8x8 layout

## Out of scope

- Outlined-variant generation and the 8-connected dilation (SSP-068)
- Applying kerning and advances, selecting the outlined variant and line heights in bitmapText (SSP-069)
- Final glyph designs (SSP-142, SSP-143)
- The hud_specimen golden (SSP-145)

## Acceptance criteria

- [ ] pytest: `glyph "i" advance 2` (or the documented syntax) gives 'i' advance 2 in kerbside5x7.json and 3 in the outlined variant; glyphs without an override use the header advance
- [ ] pytest: a kern pair naming an undefined glyph, a pair that is not exactly two characters, or a duplicate pair fails the build with the file and line in the message
- [ ] pytest: a fixture Bold 8x8 file (glyph 8x8, cell 9x10, advance 9) builds a metrics JSON and ui-atlas frames, and a fixture glyph with a 5-wide row in that file fails
- [ ] Vitest: bitmapText measures a 3-glyph string with Bold 8x8 metrics as 27 px (advance 9, no kerning) and as 30 px outlined
- [ ] The per-glyph advance syntax is documented in ASSET_PIPELINE §6.3
- [ ] SSP-068's outline tests and SSP-069's kerning tests still pass; `npm run assets && npm run assets:verify` is clean

## Verification

- uv run --project tools/forge pytest
- npm test
- npm run assets && npm run assets:verify && npm run typecheck

## Dependencies

**Depends on:**

- [SSP-069](../M2/SSP-069-bitmap-text.md) Implement src/ui/bitmapText.ts and the UI render pass
- [SSP-068](../M2/SSP-068-kerbside5x7-font.md) Draft Kerbside 5×7 glyphs and add the forge font builder and ui atlas

**Blocks:**

- [SSP-142](SSP-142-font-kerbside-5x7.md) Finalise Kerbside 5x7 glyphs, metrics and kerning
- [SSP-143](SSP-143-font-kerbside-bold-8x8.md) Write Kerbside Bold 8x8 glyphs, metrics and kerning
- [SSP-191](../M6/SSP-191-week-map-scene.md) Build WeekMapScene: seven district cards, stars, unlock state and Gleaming badges

## References

- ../../ASSET_PIPELINE.md#63-glyph-files-glyphstxt
- ../../ART_BIBLE.md#125-pixel-fonts
- ../../ART_BIBLE.md#63-the-outline-rule
- ../../ASSET_PIPELINE.md#1012-font-glyph-changes

## Roadmap tasks covered

- Fonts: finalise `kerbside5x7.glyphs.txt`, write `kerbsidebold8x8.glyphs.txt`, generate outlined variants, define kerning pairs.
