---
id: SSP-259
title: "Author 16\u00d716 touch-control icons as text-grid UI sprites"
milestone: M8
status: todo
type: asset
estimate: S
labels: [type:asset, area:assets, area:ui, size:S]
depends_on: [SSP-113, SSP-115, SSP-117, SSP-144, SSP-145, SSP-118]
blocks: [SSP-260, SSP-262, SSP-263]
---

# SSP-259: Author 16×16 touch-control icons as text-grid UI sprites

**Milestone:** [M8 Touch & Mobile Web](../README.md#m8) · **Type:** asset · **Size:** S · **Areas:** assets, ui

## Summary

Add the UI icons the touch overlay and rotate prompt need that do not exist yet (throttle and brake pedals, map, pause, dump/interact, slider knob, rotate-device). Like every UI icon they are text grids written directly, reviewed on the contact sheet and in the zoo.

## Context

Technique (ASSET_PIPELINE §10.7, ART_BIBLE §12.3, CLAUDE.md §6.2): UI icons are text grids written directly at assets-src/sprites/ui/<name>.sprite.txt. HUD icons are 16×16, use ≤ 6 colours, an ink (00) outline and a 1 px lit edge on the NW, and contain only Kerbside-32 colours (CLAUDE.md hard rule 3). They pack into the 'ui' atlas. 9-slice panels are 24×24 with 8 px corners, named ui.panel_<name>, sliced in code by src/ui/panels.ts.

Existing icons to REUSE, not duplicate (ART_BIBLE §12.3): hopper, water drop, spanner, clock, complaint form, £ coin, star, brush up and brush down, horn, each power-up. Spray button = water drop, brush button = brush up/down, horn button = horn.

New icons (IDs proposed; none appear in the docs yet): ui.icon_throttle, ui.icon_brake, ui.icon_map, ui.icon_pause, ui.icon_dump (interact/dump), ui.icon_rotate (portrait prompt) and ui.touch_knob (steering slider thumb). Pedals use a 16×16 icon centred on a 9-slice panel; reuse the existing panels (ui.panel_council: 26 fill, 07 inner border, 00 outer, 05 corner bolts; ui.panel_dark: 01 fill, 03 border) and add a new panel only with a recorded reason. Follow the ui frame-ID convention M4 used (ART_BIBLE §14.4 state vocabulary has no ui row; if M4 did not add one, add it in this change).

Placeholder-first (ROADMAP §1 principle 3): register the IDs in assets-src/manifest.json so src/gen/assets.ts types them; code references frames through FRAME. UI IDs are not entities, so ENTITY_CATALOG is not changed. No lettering inside icons, no trademarks.

ZooScene lays out every FRAME, so the zoo golden WILL change; hud_specimen should not.

## Scope

- Text-grid sprites in assets-src/sprites/ui/ for the seven new IDs, plus manifest entries
- npm run assets to regenerate public/assets/** and src/gen/assets.ts, committed with the sources
- Contact-sheet review of the ui atlas and the zoo golden update

## Out of scope

- Drawing the overlay in game (SSP-260)
- Changing existing icons or panels
- Any AI-generated or Blender UI art (UI icons are always grids)

## Acceptance criteria

- [ ] Each new icon is 16×16, uses ≤ 6 colours, has a 1 px ink outline and a NW lit edge, and uses only Kerbside-32 indices
- [ ] npm run assets:lint and npm run assets:verify pass
- [ ] src/gen/assets.ts exports FRAME entries for all seven new IDs
- [ ] build/sheets/ui.png was opened with Read, and the PR notes what was checked (readability at 1×, consistency with the existing horn, brush and water icons)
- [ ] The zoo golden was updated only after its diff was Read, with a one-line reason; hud_specimen is unchanged

## Verification

- npm run assets
- npm run assets:lint
- npm run assets:verify
- npm run assets:sheets, then Read build/sheets/ui.png
- npm run test:visual (Read the zoo diff, then npm run test:visual:update)

## Dependencies

**Depends on:**

- [SSP-113](../M4/SSP-113-forge-pack-atlases.md) Lock atlas trimming and the 1 px gutter, cover all five atlases and add the fill-ratio report
- [SSP-115](../M4/SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-117](../M4/SSP-117-forge-verify-ci.md) Extend forge verify to level and M4 outputs, prove assets idempotence, fill forge pytest gaps and add verify + lint to CI
- [SSP-144](../M4/SSP-144-ui-icons-panels.md) HUD icons, 9-slice panels, button states and complaint stamp grids
- [SSP-145](../M4/SSP-145-hud-specimen-golden.md) Build the hud_specimen scene and commit its visual golden
- [SSP-118](../M4/SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review

**Blocks:**

- [SSP-260](SSP-260-touch-controls-overlay.md) Draw the touch control overlay in internal pixel space via the UI pass
- [SSP-262](SSP-262-touch-menus-prompts.md) Make every menu and prompt usable by tap, with touch-aware glyphs
- [SSP-263](SSP-263-rotate-landscape-prompt.md) Show a 'rotate to landscape' prompt and pause the game in portrait

## References

- ../../ASSET_PIPELINE.md#107-small-prop-pickup-or-ui-icon-grids
- ../../ART_BIBLE.md#123-panels-buttons-and-icons
- ../../ART_BIBLE.md#144-naming-conventions
- ../../ART_BIBLE.md#146-atlas-packing
- ../../ART_BIBLE.md#15-self-review-contact-sheets-and-the-quality-checklist
- ../../../CLAUDE.md#6-asset-rules

## Roadmap tasks covered

- `Touch UI drawn in internal pixel space with the 9-slice panels, so it passes through the palette pass like everything else.`
