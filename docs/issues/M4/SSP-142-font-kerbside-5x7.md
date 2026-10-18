---
id: SSP-142
title: "Finalise Kerbside 5x7 glyphs, metrics and kerning"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, area:ui, size:M, vertical-slice]
depends_on: [SSP-141, SSP-116, SSP-068]
blocks: [SSP-145, SSP-156, SSP-157, SSP-174, SSP-184, SSP-191, SSP-192, SSP-235, SSP-240, SSP-263, SSP-281]
---

# SSP-142: Finalise Kerbside 5x7 glyphs, metrics and kerning

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets, ui · **Vertical slice**

## Summary

Finalise Kerbside 5x7, the HUD/body font, against the design rules M4 locks, with narrow advances and the starter kerning set.

## Context

Kerbside 5x7: a 5x7 glyph in a 6x8 cell, ASCII 32-126 plus £ ★ → ← ↑ ↓ (ART_BIBLE §12.5). Rules (proposed; lock in M4): cap height 7, x-height 5, 1 px stroke. Descenders (g, j, p, q, y) raise their bowls two rows so the tail ends on row 7, keeping everything inside 5x7. Default advance 6; narrow glyphs (i, l, !, .) use 2-4. £ sits on the baseline with a cap-height ascender; ★ fills the full 7 rows. Kerning starter set: AV AW AT AY LT LY PA TA VA WA YA Fo To Te Ty r. r, ££. Specimen glyphs for A, g, £ and ★ are in ART_BIBLE §12.5. British English UI strings will use it (e.g. 'SPOTLESS!', 'COMPLAINT').

## Scope

- Complete `assets-src/fonts/kerbside5x7.glyphs.txt` (all glyphs, advances, kerning)
- Lock the 5x7 rules in ART_BIBLE §12.5 and §17
- Review via a temporary specimen capture (hud_specimen lands later)

## Out of scope

- Kerbside Bold 8x8
- Localisation glyphs (not planned)

## Acceptance criteria

- [ ] All 95 printable ASCII glyphs (32-126) plus the 6 extras are present, each fitting 5x7 (pytest on the parsed file)
- [ ] All 17 starter kerning pairs are defined; narrow-glyph advances are set
- [ ] ART_BIBLE §12.5 rules are no longer marked proposed
- [ ] A rendered specimen was opened with Read; 0/O and 1/l/I are distinguishable (noted in PR)

## Verification

- uv run --project tools/forge pytest
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas ui, then Read build/sheets/ui.png

## Dependencies

**Depends on:**

- [SSP-141](SSP-141-font-builder-outline-kerning.md) Font builder: per-glyph advance syntax, kerning validation and Kerbside Bold 8x8 support
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-068](../M2/SSP-068-kerbside5x7-font.md) Draft Kerbside 5×7 glyphs and add the forge font builder and ui atlas

**Blocks:**

- [SSP-145](SSP-145-hud-specimen-golden.md) Build the hud_specimen scene and commit its visual golden
- [SSP-156](SSP-156-hud-final-art.md) Restyle the HUD and score popups with final fonts, icons and panels
- [SSP-157](SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art
- [SSP-174](../M5/SSP-174-unlock-codec-loading.md) Add unlock.ts, Opus/AAC codec selection and boot-time audio loading
- [SSP-184](../M5/SSP-184-captions.md) Add speech-bubble and sound captions for audio cues
- [SSP-191](../M6/SSP-191-week-map-scene.md) Build WeekMapScene: seven district cards, stars, unlock state and Gleaming badges
- [SSP-192](../M6/SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-235](../M7/SSP-235-settings-scene.md) Build SettingsScene with audio, display, accessibility and assist pages
- [SSP-240](../M7/SSP-240-juice-squash-popups.md) Juice pass: squash-and-stretch, combo popups and the cat roof-ride
- [SSP-263](../M8/SSP-263-rotate-landscape-prompt.md) Show a 'rotate to landscape' prompt and pause the game in portrait
- [SSP-281](../M9/SSP-281-rival-sweep-flow.md) Ship the Rival Sweep mode: district pick, 180 s duel HUD, winner tally

## References

- ../../ART_BIBLE.md#125-pixel-fonts
- ../../ASSET_PIPELINE.md#63-glyph-files-glyphstxt
- ../../ART_BIBLE.md#17-open-items

## Roadmap tasks covered

- Fonts: finalise `kerbside5x7.glyphs.txt`, write `kerbsidebold8x8.glyphs.txt`, generate outlined variants, define kerning pairs.
