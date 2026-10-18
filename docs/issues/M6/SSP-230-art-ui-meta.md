---
id: SSP-230
title: "Art Pass 2: final UI art for the Week Map, Workshop and Mercury"
milestone: M6
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, area:ui, size:M]
depends_on: [SSP-191, SSP-193, SSP-192, SSP-216, SSP-224, SSP-113, SSP-144, SSP-145]
blocks: [SSP-233]
---

# SSP-230: Art Pass 2: final UI art for the Week Map, Workshop and Mercury

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** asset · **Size:** M · **Areas:** assets, ui

## Summary

Replace placeholder UI on the meta screens with final grids and panels: the paper town map, pins and padlocks, badges, the Workshop pegboard and lift, Mercury stamps and rosettes, and the trophy.

## Context

ART_BIBLE §12.3/§12.4. Week Map: a stylised town map on paper (07/06) with district pins; locked districts in 04. Workshop: pegboard backdrop (13 with 08 holes), Bessie on a lift, upgrade icons (from SSP-224). Mercury: ui.panel_paper (07 fill, 06 shade, 00 border); SACKED!/TOWED! rubber-stamp lettering in 18 at a 2-step pixel tilt (drawn, not rotated); green pledge rosettes; Gleaming badge; 'Top Tipper' stamp; filled and empty star icons; trophy icon/art for the Week Map. 9-slice panels are 24x24 with 8 px corners (src/ui/panels.ts slices them). Buttons have four states, with the -> cursor glyph for focus (never colour alone). Technique: text grids (ASSET_PIPELINE §10.7); a larger map backdrop may be procedural or grid. Avoid image generation for anything with text. Check the hud_specimen and mercury_tally goldens, plus frozen screenshots of the Week Map and Workshop, with Read.

## Scope

- Final ui.* grids and panels for the Week Map, Workshop and Mercury listed above
- Manifest updates removing placeholders
- Golden re-approvals with reasons after reading diffs

## Out of scope

- Scene logic changes
- Mercury photo art and portraits

## Acceptance criteria

- [ ] No placeholder: true remains for any ui.* ID used by WeekMapScene, WorkshopScene or TallyScene
- [ ] Focus is visible without colour (the cursor glyph appears in screenshots)
- [ ] assets:lint and assets:verify pass
- [ ] hud_specimen and mercury_tally pass after Read-reviewed updates; Week Map and Workshop screenshots reviewed

## Verification

- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets (Read build/sheets/ui.png)
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-191](SSP-191-week-map-scene.md) Build WeekMapScene: seven district cards, stars, unlock state and Gleaming badges
- [SSP-193](SSP-193-workshop-liveries.md) Build WorkshopScene with upgrade purchases and Bessie livery ramp swaps
- [SSP-192](SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-216](SSP-216-sunday-finale-trophy.md) Implement the Sunday Inspection Score and the Tidy Town Trophy award
- [SSP-224](SSP-224-art-grids-m6.md) Art Pass 2: seagull, loose dog, remaining collectibles, upgrade icons and small props
- [SSP-113](../M4/SSP-113-forge-pack-atlases.md) Lock atlas trimming and the 1 px gutter, cover all five atlases and add the fill-ratio report
- [SSP-144](../M4/SSP-144-ui-icons-panels.md) HUD icons, 9-slice panels, button states and complaint stamp grids
- [SSP-145](../M4/SSP-145-hud-specimen-golden.md) Build the hud_specimen scene and commit its visual golden

**Blocks:**

- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag

## References

- ../../ART_BIBLE.md#123-panels-buttons-and-icons
- ../../ART_BIBLE.md#124-screens
- ../../ASSET_PIPELINE.md#107-small-prop-pickup-or-ui-icon-grids
- ../../ROADMAP.md#51-asset-readiness-by-milestone

## Roadmap tasks covered

- `All Wed–Sun assets, batched by class, each batch reviewed via contact sheets and the zoo. (HUD and panels: Workshop, week map, Mercury)`
