---
id: SSP-156
title: "Restyle the HUD and score popups with final fonts, icons and panels"
milestone: M4
status: todo
type: feature
estimate: M
labels: [type:feature, area:ui, area:render, size:M, vertical-slice]
depends_on: [SSP-142, SSP-143, SSP-144, SSP-149, SSP-070, SSP-069, SSP-063, SSP-078, SSP-096, SSP-288, SSP-289, SSP-291, SSP-299]
blocks: [SSP-158, SSP-242, SSP-261, SSP-281]
---

# SSP-156: Restyle the HUD and score popups with final fonts, icons and panels

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** feature · **Size:** M · **Areas:** ui, render · **Vertical slice**

## Summary

Move `src/ui/hud.ts` and the score popups from the M2 draft to the final art: Kerbside fonts (outlined on the playfield), HUD icons and 9-slice panels, at the pixel positions and colours ART_BIBLE §12.2 specifies.

## Context

GDD §15.2 owns which HUD elements exist and how they behave; ART_BIBLE §12.2 owns positions and colours (480x270 reference, anchored to corners, 4 px safe margin at widths 432-640). Timer top-left (4,4): Bold outlined, 07; 16 under 60 s; flashing 18 every 30 ticks under 30 s. District name (4,16) in 5x7, 07. Tidy bar (4,26): 64x4, fill 23 on 03, 07 ticks at 60/80/92, value beside. Score top-centre: Bold outlined, 07. Combo multiplier + tier word in 5x7 outlined, in the tier colour; chain bar 48x2 in 17. Complaints top-right: 5 x 16x16 slots, 2 px gaps. Radio panel: `ui.panel_council` with a 17 'PAM' tab. Hopper gauge: 16x16 icon + 64x6 bar, fill 15, 17 at >= 80%, flashing 18 when full. Water: fill 27 with a 28 top row; the hydrant icon pulses below 20%. Dignity bar: 23 above 60 HP, 15 at 40-60, 18 below 40. Brush-o-meter: 64x8 with patterned zones (clean solid 23, fling hatched 17/03, transit dotted 26/03), 07 needle, speed in 5x7 (mph default). Brush state: 16x16 with a 15 spin-up ring. Power-up: icon + 5x7 countdown. Minimap: 64x64 bottom-right, rendered at runtime (roads 03, pavement 05, buildings 01, grime 08, clean frontages 23, dirty 18, Bessie arrow 15). Score popups (ART_BIBLE §11) are Kerbside text spawned at the pickup, rising 12 px over 36 ticks with ease-out, holding 12, then blinking 3 x 3 ticks. Colours: x1 07; x2 'TIDY!' 23; x3 'SPOTLESS!' 28; x4 'IMMACULATE!' 16; x5 'SWEEPING BEAUTY!' cycling 16->17->20->28->23 every 5 ticks; penalty 18. GDD §15.2 says popups use Kerbside Bold 8x8. The UI renders in one draw call from the `ui` atlas and writes mask (0,1) so it is never darkened (TECHNICAL_DESIGN §12.6/§12.7).

minimap.ts (SSP-291), popups.ts with score popups and speech bubbles (SSP-288) and the radio panel (SSP-289) already exist. This issue only restyles them.

SSP-299 builds the Brush-o-meter, the brush state icon with its spin-up ring, the district name + Tidy % bar and the off-screen depot/hydrant arrows, using placeholder `ui.*` frames. This issue restyles those widgets (and their arrow frames) with final art at the ART_BIBLE §12.2 positions. It does not change their behaviour.

## Scope

- Rework `hud.ts`, `popups.ts` and `minimap.ts` styling to the spec using final assets
- Anchoring and 4 px margin across widths 432-640
- Visual check via HUD captures and the updated goldens

## Out of scope

- New HUD behaviour or thresholds (GDD-owned)
- Workshop/week map/Mercury UI (M6)
- Settings for mph/km/h (M7)

## Acceptance criteria

- [ ] Every GDD §15.2 element is drawn with final fonts/icons at the ART_BIBLE §12.2 positions and colours (checked against a 1080p capture with Read, noted)
- [ ] At W = 432 and W = 640 nothing crosses the 4 px safe margin (Vitest on the layout function plus captures opened with Read)
- [ ] Vitest on the popup parameter function: rise 12 px over 36 ticks, hold 12, blink 3 x 3, tier colours as listed
- [ ] Draw calls stay <= 10 in the perf `ci` project; visual goldens are updated only after reading the diffs

## Verification

- npm run typecheck && npm run lint && npm test
- npm run test:visual
- npm run test:e2e
- npm run dev, capture ?test=1&scene=<puddle_lane shift id>&tick=600&freeze=1 at 1920x1080 and at a narrow aspect (W = 432); Read both

## Dependencies

**Depends on:**

- [SSP-142](SSP-142-font-kerbside-5x7.md) Finalise Kerbside 5x7 glyphs, metrics and kerning
- [SSP-143](SSP-143-font-kerbside-bold-8x8.md) Write Kerbside Bold 8x8 glyphs, metrics and kerning
- [SSP-144](SSP-144-ui-icons-panels.md) HUD icons, 9-slice panels, button states and complaint stamp grids
- [SSP-149](SSP-149-pickups-grids.md) Hand-author power-up and Mon-Tue collectible pickup grids
- [SSP-070](../M2/SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-069](../M2/SSP-069-bitmap-text.md) Implement src/ui/bitmapText.ts and the UI render pass
- [SSP-063](../M2/SSP-063-scoring-combo.md) Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger
- [SSP-078](../M3/SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-096](../M3/SSP-096-power-ups.md) Spawn power-ups on pavements, implement all six pwr.* effects, draw them
- [SSP-288](../M3/SSP-288-popups-speech-bubbles.md) Add src/ui/popups.ts: world-space score/penalty popups and NPC speech bubbles
- [SSP-289](../M3/SSP-289-pam-radio-panel.md) Add Big Pam's HUD radio panel with a one-at-a-time bark queue and inline key glyphs
- [SSP-291](SSP-291-hud-minimap.md) Implement src/ui/minimap.ts: runtime 64×64 district minimap in the single UI draw
- [SSP-299](../M3/SSP-299-hud-brush-tidy-arrows.md) Add the Brush-o-meter, brush state ring, district name with Tidy % bar, and off-screen depot/hydrant arrows to the HUD

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-242](../M7/SSP-242-reduce-flashing.md) Implement the Reduce flashing setting across HUD and world effects
- [SSP-261](../M8/SSP-261-touch-hud-adaptation.md) Adapt the HUD layout so it never sits under the thumbs in touch mode
- [SSP-281](../M9/SSP-281-rival-sweep-flow.md) Ship the Rival Sweep mode: district pick, 180 s duel HUD, winner tally

## References

- ../../ART_BIBLE.md#122-hud-layout-480270-reference-anchored-to-corners-for-other-widths
- ../../ART_BIBLE.md#11-vfx
- ../../GDD.md#152-hud-layout
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation

## Roadmap tasks covered

- `Procedural frame generators (4–8 frames each, exact loops) for dust, spray, sparkle, skid marks, score popups, splash and leaf swirl.`
