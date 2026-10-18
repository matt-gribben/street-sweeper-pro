---
id: SSP-143
title: "Write Kerbside Bold 8x8 glyphs, metrics and kerning"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, area:ui, size:M, vertical-slice]
depends_on: [SSP-141, SSP-116]
blocks: [SSP-144, SSP-145, SSP-150, SSP-156, SSP-157, SSP-184, SSP-191, SSP-192, SSP-235, SSP-240, SSP-263, SSP-281]
---

# SSP-143: Write Kerbside Bold 8x8 glyphs, metrics and kerning

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets, ui · **Vertical slice**

## Summary

Author Kerbside Bold 8x8, the headline font used for the timer, score, title logo and shop-sign lettering.

## Context

Kerbside Bold 8x8: an 8x8 glyph in a 9x10 cell, with the same character set as 5x7 (ASCII 32-126 plus £ ★ → ← ↑ ↓) (ART_BIBLE §12.5). Rules (proposed; lock in M4): 2 px vertical stems, 1 px horizontals, rounded corners cut by one pixel; designed for capitals (lowercase present but secondary); advance 9. Kerning starter set as for 5x7. Used for: the shift timer and score (outlined), the title logo 'Street Sweeper Pro' at 2x integer scale, shop-sign lettering composited at build time, and give-way/SLOW tile lettering. GDD §15.2 also uses it for popups and headlines.

## Scope

- Write `assets-src/fonts/kerbsidebold8x8.glyphs.txt` with advances and kerning
- Manifest/font registration so the forge builds it and its outlined variant
- Lock the rules in ART_BIBLE §12.5

## Out of scope

- Logo layout on the title screen (SSP-157)

## Acceptance criteria

- [ ] All 101 glyphs present within 8x8 (pytest); vertical stems 2 px, horizontals 1 px
- [ ] `public/assets/fonts/kerbsidebold8x8.json` plus the outlined variant are generated deterministically
- [ ] A specimen was opened with Read and noted in the PR

## Verification

- uv run --project tools/forge pytest
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas ui, then Read build/sheets/ui.png

## Dependencies

**Depends on:**

- [SSP-141](SSP-141-font-builder-outline-kerning.md) Font builder: per-glyph advance syntax, kerning validation and Kerbside Bold 8x8 support
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row

**Blocks:**

- [SSP-144](SSP-144-ui-icons-panels.md) HUD icons, 9-slice panels, button states and complaint stamp grids
- [SSP-145](SSP-145-hud-specimen-golden.md) Build the hud_specimen scene and commit its visual golden
- [SSP-150](SSP-150-shop-signs.md) High Street shop signs: Codex blank boards plus Kerbside lettering
- [SSP-156](SSP-156-hud-final-art.md) Restyle the HUD and score popups with final fonts, icons and panels
- [SSP-157](SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art
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

## Roadmap tasks covered

- Fonts: finalise `kerbside5x7.glyphs.txt`, write `kerbsidebold8x8.glyphs.txt`, generate outlined variants, define kerning pairs.
