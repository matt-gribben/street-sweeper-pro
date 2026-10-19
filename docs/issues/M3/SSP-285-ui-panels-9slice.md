---
id: SSP-285
title: "Implement src/ui/panels.ts 9-slice panels and button states with placeholder panel grids"
milestone: M3
status: done
type: feature
estimate: S
labels: [type:feature, area:ui, area:render, area:assets, size:S, vertical-slice]
depends_on: [SSP-069, SSP-068, SSP-039]
blocks: [SSP-109, SSP-286, SSP-287, SSP-288, SSP-289, SSP-144, SSP-157, SSP-300, SSP-191, SSP-192, SSP-235, SSP-260]
---

# SSP-285: Implement src/ui/panels.ts 9-slice panels and button states with placeholder panel grids

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** S · **Areas:** ui, render, assets · **Vertical slice**

## Summary

Add the `src/ui/panels.ts` runtime. It draws 24×24 9-slice panels (8 px corners) at any integer size, plus the four button states, as UI instances in the single UI draw. It ships with placeholder grids for `ui.panel_council`, `ui.panel_paper` and `ui.panel_dark`, so the M3 menus, pause overlay, radio panel and bubbles have panels before the M4 final art.

## Context

ART_BIBLE §12.3 defines the panels: 24×24 sources with 8 px corners, in three styles with proposed IDs. `ui.panel_council` has a 26 fill, 07 inner border, 00 outer border and 05 corner bolts. `ui.panel_paper` has a 07 fill, 06 shade and 00 border, and is used for notices and the Mercury. `ui.panel_dark` has a 01 fill and 03 border, and is used for the pause overlay. Buttons have four pixel-exact states. Normal is a 26 fill. Focus is a 17 border plus a `→` cursor glyph, so focus does not rely on colour alone. Pressed is a 25 fill with the content shifted 1 px down-right. Disabled is a 03 fill with 04 text.
Slicing happens in code (ART_BIBLE §12.3). Corners are drawn unchanged. Edges and the centre REPEAT in 8 px steps and are never stretched, because nothing may scale by a non-integer factor (GDD §15.2). The final partial repeat uses a sub-rect UV, so any integer size ≥ 16×16 works.
Rendering: everything stays inside the one UI instanced draw from the `ui` atlas (draw #7, TECHNICAL_DESIGN §12.7). The pass writes mask (0, 1) (§12.6). The draw path allocates nothing per frame.
Placeholders: author simple grids in `assets-src/sprites/ui/` using the documented colours, mark them `"placeholder": true` in the manifest, and add them to the `ui` atlas. SSP-144 (M4) replaces them with final art. ART_BIBLE gives these IDs as proposed; use them exactly.
Import rules (TECHNICAL_DESIGN §2.1): src/ui may import `src/render/spriteBatch.ts` and nothing else from render.

## Scope

- src/ui/panels.ts: drawPanel(style, x, y, w, h) and drawButton(state, rect, label) as UI instances
- Placeholder 24×24 grids for ui.panel_council, ui.panel_paper and ui.panel_dark (placeholder: true), packed into the ui atlas
- Button state rendering: normal; focus with the → glyph; pressed with a 1 px content shift; disabled
- Vitest on the slicing function and the button state model

## Out of scope

- Final panel, button and icon art (SSP-144)
- Menu navigation and input (SSP-286)
- HUD icons

## Acceptance criteria

- [x] Vitest: each of the three panels slices to 3 arbitrary integer sizes (e.g. 24×24, 61×37, 200×19) with corner quads unchanged, edge and centre quads repeated in 8 px steps, a clipped final repeat, and no non-integer scale
- [x] Vitest: the focus state emits a → glyph instance, and pressed offsets the content by (+1, +1)
- [x] A captured frame shows all three panels and all four button states at integer positions (frame Read and noted in the PR)
- [x] Total draw calls stay ≤ 10 with panels on screen, and the draw path creates no `new` objects or array literals per frame
- [x] `npm run assets:verify` and `npm run test:visual` pass

## Verification

- npx vitest run tests/unit/panels.test.ts
- npm run assets && npm run assets:verify
- npm run test:visual
- npm run typecheck && npm run lint

## Dependencies

**Depends on:**

- [SSP-069](../M2/SSP-069-bitmap-text.md) Implement src/ui/bitmapText.ts and the UI render pass
- [SSP-068](../M2/SSP-068-kerbside5x7-font.md) Draft Kerbside 5×7 glyphs and add the forge font builder and ui atlas
- [SSP-039](../M1/SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end

**Blocks:**

- [SSP-109](SSP-109-close-m3.md) Close M3: verify the exit criteria, sync docs, state the frozen entity list, tag m3
- [SSP-286](SSP-286-menu-navigation.md) Implement src/ui/menus.ts: keyboard, gamepad and mouse menu navigation plus input-device glyphs
- [SSP-287](SSP-287-pause-overlay.md) Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire
- [SSP-288](SSP-288-popups-speech-bubbles.md) Add src/ui/popups.ts: world-space score/penalty popups and NPC speech bubbles
- [SSP-289](SSP-289-pam-radio-panel.md) Add Big Pam's HUD radio panel with a one-at-a-time bark queue and inline key glyphs
- [SSP-144](../M4/SSP-144-ui-icons-panels.md) HUD icons, 9-slice panels, button states and complaint stamp grids
- [SSP-157](../M4/SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art
- [SSP-300](../M4/SSP-300-shift-map-overlay.md) Add the Tab shift map overlay: district map with frontage status, depot, skips and hydrants, without pausing
- [SSP-191](../M6/SSP-191-week-map-scene.md) Build WeekMapScene: seven district cards, stars, unlock state and Gleaming badges
- [SSP-192](../M6/SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-235](../M7/SSP-235-settings-scene.md) Build SettingsScene with audio, display, accessibility and assist pages
- [SSP-260](../M8/SSP-260-touch-controls-overlay.md) Draw the touch control overlay in internal pixel space via the UI pass

## References

- ../../ART_BIBLE.md#123-panels-buttons-and-icons
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../TECHNICAL_DESIGN.md#123-frame-graph
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom
- ../../GDD.md#152-hud-layout

## Roadmap tasks covered

- `UI: HUD icons (16×16), 9-slice panels (24×24, 8 px corners). (runtime slicing and placeholder panels; final art is SSP-144)`
