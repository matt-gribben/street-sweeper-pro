---
id: SSP-145
title: "Build the hud_specimen scene and commit its visual golden"
milestone: M4
status: todo
type: test
estimate: M
labels: [type:test, area:test, area:ui, size:M, vertical-slice]
depends_on: [SSP-142, SSP-143, SSP-144, SSP-019, SSP-022]
blocks: [SSP-158, SSP-184, SSP-295, SSP-224, SSP-230, SSP-259]
---

# SSP-145: Build the hud_specimen scene and commit its visual golden

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** test · **Size:** M · **Areas:** test, ui · **Vertical slice**

## Summary

Add the `hud_specimen` visual-test scene, which renders every glyph of every font and variant on the four reference backgrounds plus the UI icons, panels and button states, and commit its threshold-0 golden.

## Context

ART_BIBLE §12.5: `hud_specimen` renders every glyph of every font and variant (Kerbside 5x7, 5x7 outlined, Bold 8x8, Bold outlined) on 02, 05, 07 and 26 backgrounds, as a committed visual golden. ASSET_PIPELINE §10.7 says UI changes are checked in `hud_specimen`, so include icons, panels and button states too. Spec as for the other visual tests (TECHNICAL_DESIGN §18.4): `/?test=1&seed=1&scene=hud_specimen&freeze=1`, 1920x1080 viewport, `readFrame()`, pixelmatch threshold 0 vs `tests/visual/__goldens__/hud_specimen.png`. Open: a rough count (101 glyphs x 4 font variants x 4 backgrounds at W = 480) needs ~370 px of height, more than 270. Decide between compacting (e.g. backgrounds as vertical strips), multiple pages with separate goldens (`hud_specimen_<n>`), or another approach, and record it in TECHNICAL_DESIGN §18.4.

## Scope

- `hud_specimen` scene (test-only) and `tests/visual/hud_specimen.spec.ts`
- Resolve the fit question and document it
- Commit the golden(s) after reading them

## Out of scope

- Font or icon design changes

## Acceptance criteria

- [ ] Vitest over the specimen layout: every glyph of all four font variants appears on each of the 02, 05, 07, 26 backgrounds
- [ ] Icons, panels and button states appear
- [ ] `npm run test:visual` passes `hud_specimen` (all pages) at threshold 0 on ten consecutive runs
- [ ] TECHNICAL_DESIGN §18.4 documents the layout/pages decision

## Verification

- npm run test:visual
- for i in $(seq 10); do npm run test:visual || exit 1; done
- Read tests/visual/__goldens__/hud_specimen.png (and any extra pages)

## Dependencies

**Depends on:**

- [SSP-142](SSP-142-font-kerbside-5x7.md) Finalise Kerbside 5x7 glyphs, metrics and kerning
- [SSP-143](SSP-143-font-kerbside-bold-8x8.md) Write Kerbside Bold 8x8 glyphs, metrics and kerning
- [SSP-144](SSP-144-ui-icons-panels.md) HUD icons, 9-slice panels, button states and complaint stamp grids
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-022](../M0/SSP-022-visual-goldens.md) Add lean_quadrants and scale_1440 visual specs and goldens; prove 10-run stability (D-09)

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-184](../M5/SSP-184-captions.md) Add speech-bubble and sound captions for audio cues
- [SSP-295](../M5/SSP-295-vertical-slice-gate.md) Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR
- [SSP-224](../M6/SSP-224-art-grids-m6.md) Art Pass 2: seagull, loose dog, remaining collectibles, upgrade icons and small props
- [SSP-230](../M6/SSP-230-art-ui-meta.md) Art Pass 2: final UI art for the Week Map, Workshop and Mercury
- [SSP-259](../M8/SSP-259-touch-ui-icons.md) Author 16×16 touch-control icons as text-grid UI sprites

## References

- ../../ART_BIBLE.md#125-pixel-fonts
- ../../TECHNICAL_DESIGN.md#184-visual-headless-screenshot-tests
- ../../ASSET_PIPELINE.md#107-small-prop-pickup-or-ui-icon-grids
- ../../ASSET_PIPELINE.md#1012-font-glyph-changes

## Roadmap tasks covered

- Fonts: finalise `kerbside5x7.glyphs.txt`, write `kerbsidebold8x8.glyphs.txt`, generate outlined variants, define kerning pairs.
