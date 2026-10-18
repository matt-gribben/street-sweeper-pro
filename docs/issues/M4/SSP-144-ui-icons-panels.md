---
id: SSP-144
title: "HUD icons, 9-slice panels, button states and complaint stamp grids"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, area:ui, size:M, vertical-slice]
depends_on: [SSP-115, SSP-116, SSP-143, SSP-070, SSP-285]
blocks: [SSP-145, SSP-156, SSP-157, SSP-300, SSP-174, SSP-184, SSP-191, SSP-192, SSP-230, SSP-235, SSP-259, SSP-260, SSP-263, SSP-281]
---

# SSP-144: HUD icons, 9-slice panels, button states and complaint stamp grids

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets, ui · **Vertical slice**

## Summary

Author the UI text grids in the municipal council-blue style: 16x16 HUD icons, the three 24x24 9-slice panels, the four button states and the complaint stamp animation.

## Context

UI style (ART_BIBLE §12.1): council-blue panels, chalk text, hi-vis highlights, rendered in the 480x270 internal space at integer scale only. HUD icons (16x16 grids in `assets-src/sprites/ui/`, ART_BIBLE §12.3): hopper, water drop, spanner, clock, complaint form, £ coin, star (filled and empty), brush up and down, horn, and each power-up; <= 6 colours, ink outline, 1 px lit edge on the NW. 9-slice panels: 24x24 source, 8 px corners, named `ui.panel_<name>`, with slicing in code (`src/ui/panels.ts`): `ui.panel_council` (26 fill, 07 inner border, 00 outer, 05 corner bolts), `ui.panel_paper` (07 fill, 06 shade, 00 border), `ui.panel_dark` (01 fill, 03 border). Buttons: normal 26 fill; focus 17 border with a `→` cursor glyph (focus visible without colour); pressed 25 fill with content shifted 1 px down-right; disabled 03 fill, 04 text. Complaint slots: empty = 06 outline form on 25; filled = an 18 rubber 'COMPLAINT' stamp that slams in over 3 frames (lettering from Kerbside glyphs, not freehand). Open: the power-up HUD icons may reuse the `pwr.*` pickup art (items atlas) or be separate `ui` assets. Decide, bearing in mind the HUD draws from the `ui` atlas in one draw call (TECHNICAL_DESIGN §12.7). Atlas `ui`.

src/ui/panels.ts and the placeholder grids for ui.panel_council, ui.panel_paper and ui.panel_dark come from SSP-285. This issue replaces those placeholders with final art (removing `"placeholder": true`) and changes panels.ts only if the final art needs it. The slicing Vitest must still pass.

## Scope

- The icon grids listed above, panel grids, button state grids, complaint stamp frames
- Manifest entries in the `ui` atlas
- Update `src/ui/panels.ts` if 8 px corner slicing needs changes
- Sheet review (hud_specimen covers them later)

## Out of scope

- Upgrade/Workshop icons and week-map art (M6)
- HUD layout code (SSP-156)

## Acceptance criteria

- [ ] All listed icons exist as 16x16 grids with <= 6 colours, an ink outline and a NW lit edge; lint clean
- [ ] Vitest on `panels.ts`: each of the three panels slices to 3 arbitrary sizes with corners unchanged and edges repeated
- [ ] The four button states and the 3-frame complaint stamp are present
- [ ] The power-up icon sourcing decision is recorded in ART_BIBLE §12.3

## Verification

- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas ui, then Read build/sheets/ui.png
- npm test && npm run test:visual

## Dependencies

**Depends on:**

- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-143](SSP-143-font-kerbside-bold-8x8.md) Write Kerbside Bold 8x8 glyphs, metrics and kerning
- [SSP-070](../M2/SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-285](../M3/SSP-285-ui-panels-9slice.md) Implement src/ui/panels.ts 9-slice panels and button states with placeholder panel grids

**Blocks:**

- [SSP-145](SSP-145-hud-specimen-golden.md) Build the hud_specimen scene and commit its visual golden
- [SSP-156](SSP-156-hud-final-art.md) Restyle the HUD and score popups with final fonts, icons and panels
- [SSP-157](SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art
- [SSP-300](SSP-300-shift-map-overlay.md) Add the Tab shift map overlay: district map with frontage status, depot, skips and hydrants, without pausing
- [SSP-174](../M5/SSP-174-unlock-codec-loading.md) Add unlock.ts, Opus/AAC codec selection and boot-time audio loading
- [SSP-184](../M5/SSP-184-captions.md) Add speech-bubble and sound captions for audio cues
- [SSP-191](../M6/SSP-191-week-map-scene.md) Build WeekMapScene: seven district cards, stars, unlock state and Gleaming badges
- [SSP-192](../M6/SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-230](../M6/SSP-230-art-ui-meta.md) Art Pass 2: final UI art for the Week Map, Workshop and Mercury
- [SSP-235](../M7/SSP-235-settings-scene.md) Build SettingsScene with audio, display, accessibility and assist pages
- [SSP-259](../M8/SSP-259-touch-ui-icons.md) Author 16×16 touch-control icons as text-grid UI sprites
- [SSP-260](../M8/SSP-260-touch-controls-overlay.md) Draw the touch control overlay in internal pixel space via the UI pass
- [SSP-263](../M8/SSP-263-rotate-landscape-prompt.md) Show a 'rotate to landscape' prompt and pause the game in portrait
- [SSP-281](../M9/SSP-281-rival-sweep-flow.md) Ship the Rival Sweep mode: district pick, 180 s duel HUD, winner tally

## References

- ../../ART_BIBLE.md#123-panels-buttons-and-icons
- ../../ART_BIBLE.md#122-hud-layout-480270-reference-anchored-to-corners-for-other-widths
- ../../ASSET_PIPELINE.md#107-small-prop-pickup-or-ui-icon-grids
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation

## Roadmap tasks covered

- `UI: HUD icons (16×16), 9-slice panels (24×24, 8 px corners).`
