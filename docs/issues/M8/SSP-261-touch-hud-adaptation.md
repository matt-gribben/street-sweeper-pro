---
id: SSP-261
title: "Adapt the HUD layout so it never sits under the thumbs in touch mode"
milestone: M8
status: todo
type: feature
estimate: L
labels: [type:feature, area:ui, area:test, area:docs, size:L]
depends_on: [SSP-256, SSP-260, SSP-156, SSP-240, SSP-238, SSP-291]
blocks: [SSP-266, SSP-267, SSP-268]
---

# SSP-261: Adapt the HUD layout so it never sits under the thumbs in touch mode

**Milestone:** [M8 Touch & Mobile Web](../README.md#m8) · **Type:** feature · **Size:** L · **Areas:** ui, test, docs

## Summary

The 1.0 HUD puts gauges bottom-left, the minimap bottom-right and the complaints top-right, which collide with the touch slider, pedals and icons. Add a touch-mode HUD arrangement so every HUD element stays readable and uncovered and the road ahead of Bessie stays clear, while keyboard/gamepad keep the 1.0 layout exactly.

## Context

Ownership: GDD §15.2 owns which HUD elements exist, which corner they sit in and how they behave; ART_BIBLE §12.2 owns pixel positions and colours and must contain every GDD element. Update both in the same change (CLAUDE.md §2, one owner per fact).

1.0 positions (ART_BIBLE §12.2, 4 px safe margin at all widths 432–640): timer top-left (4, 4); district name (4, 16) and Tidy % bar 64×4 at (4, 26); score and combo top-centre (centred on W/2, y = 4) with a 48×2 chain-timer bar; complaints top-right as 5 × 16×16 slots with 2 px gaps; radio panel bottom-left above the gauges (moves to the opposite corner when Bessie drives toward it); hopper, water and Dignity gauges bottom-left (16×16 icon + 64×6 bar each); Brush-o-meter 64×8, brush state 16×16 and power-up 16×16 along the bottom-left; minimap 64×64 (proposed) bottom-right.

Conflicts: the left-half steering zone covers the bottom-left gauges and radio panel; the right-half pedals and buttons cover the minimap; Map and Pause compete with the complaints.

The docs do not cover this; it is a design decision to make and record with screenshots in the PR. Recommended: in touch mode move the gauge row to a compact strip along the top edge under the timer and score (W = 584 gives 104 px more width than 480); move the minimap below the complaints at top-right or shrink it; shift the complaints left of Map/Pause; keep the radio panel in the top half with its opposite-corner rule. HUD principle (GDD §15.2): 'The road ahead of Bessie is sacred' — nothing overlaps the look-ahead zone (Bessie is led by up to 3.0 m along velocity, TECHNICAL_DESIGN §12.2). The Brush-o-meter keeps its three patterned zones (never colour alone, GDD §17.2).

The arrangement switches on the active-input-device signal (SSP-257); keyboard and gamepad keep the 1.0 layout pixel-for-pixel. HUD rects and touch control rects (SSP-256) must not intersect; src/app passes the reserved control rects to the HUD so src/ui never imports src/input.

## Scope

- A touch-mode HUD arrangement in src/ui/hud.ts (and minimap.ts / popups.ts as needed) selected by the active input device
- A unit-tested non-intersection check between touch-mode HUD rects and touch control rects for W ∈ {432, 480, 584, 600, 640}
- Update ART_BIBLE §12.2 (touch-mode positions) and GDD §15.2 (touch-mode placement note) in the same change
- Extend the touch_hud visual golden to show the adapted HUD with every element visible

## Out of scope

- Changing the 1.0 keyboard/gamepad HUD positions
- New HUD elements or behaviours
- Settings UI to customise the HUD

## Acceptance criteria

- [ ] Unit test: for each W in {432, 480, 584, 600, 640}, no touch-mode HUD element rect intersects any touch control rect, and all lie within the 4 px safe margin
- [ ] The updated touch_hud golden shows timer, district + Tidy %, score/combo, complaints, radio panel, hopper, water, Dignity, Brush-o-meter, brush state, power-up slot and minimap fully visible, and was Read before approval
- [ ] With keyboard as the active device, hud_specimen and every other existing golden are unchanged
- [ ] ART_BIBLE §12.2 and GDD §15.2 both describe the touch-mode arrangement and agree with each other

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:visual (Read diffs before npm run test:visual:update)

## Dependencies

**Depends on:**

- [SSP-256](SSP-256-touch-layout-model.md) Define the touch control layout and hit-testing in internal pixel space
- [SSP-260](SSP-260-touch-controls-overlay.md) Draw the touch control overlay in internal pixel space via the UI pass
- [SSP-156](../M4/SSP-156-hud-final-art.md) Restyle the HUD and score popups with final fonts, icons and panels
- [SSP-240](../M7/SSP-240-juice-squash-popups.md) Juice pass: squash-and-stretch, combo popups and the cat roof-ride
- [SSP-238](../M7/SSP-238-assists-tally-save.md) Flag assists on the Mercury tally and store assisted bests separately
- [SSP-291](../M4/SSP-291-hud-minimap.md) Implement src/ui/minimap.ts: runtime 64×64 district minimap in the single UI draw

**Blocks:**

- [SSP-266](SSP-266-ios-device-verification.md) Verify audio unlock, background resume and layout on a real iPhone
- [SSP-267](SSP-267-mobile-perf-check.md) Measure frame time and audio memory on a mid-range phone; record M8 budget
- [SSP-268](SSP-268-m8-close-release.md) Close M8: verify exit criteria, ship the mobile web update, tag m8

## References

- ../../GDD.md#152-hud-layout
- ../../ART_BIBLE.md#122-hud-layout-480270-reference-anchored-to-corners-for-other-widths
- ../../TECHNICAL_DESIGN.md#122-camera-rendercamerats
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom
- ../../GDD.md#172-accessibility-features
- ../../../CLAUDE.md#2-where-truth-lives

## Roadmap tasks covered

- `Touch UI drawn in internal pixel space with the 9-slice panels, so it passes through the palette pass like everything else.`
