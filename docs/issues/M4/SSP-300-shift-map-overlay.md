---
id: SSP-300
title: "Add the Tab shift map overlay: district map with frontage status, depot, skips and hydrants, without pausing"
milestone: M4
status: todo
type: feature
estimate: M
labels: [type:feature, area:ui, area:input, area:render, area:test, size:M, vertical-slice]
depends_on: [SSP-291, SSP-044, SSP-285, SSP-144, SSP-069, SSP-070, SSP-064, SSP-055, SSP-061, SSP-287, SSP-105]
blocks: [SSP-158, SSP-214, SSP-260]
---

# SSP-300: Add the Tab shift map overlay: district map with frontage status, depot, skips and hydrants, without pausing

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** feature · **Size:** M · **Areas:** ui, input, render, test · **Vertical slice**

## Summary

The `map` action (Tab / pad View) toggles a full-district map panel over the shift. It shows frontage clean/dirty status, pledge frontages, the depot bay, skips, hydrants and Bessie's arrow. The sim keeps running while it is open (GDD §6.2: reading the map is a deliberate time cost), and it is drawn inside the single UI draw by reusing the minimap renderer.

## Context

GDD §6.1 binds Shift map to Tab / View/Back (Map icon on touch, M8). GDD §6.2: the shift map overlays the district map with frontage status, the depot, skips and hydrants. It does **not** pause the shift (proposed). LEVEL_DESIGN §3.3: Tuesday's intro card hint says 'Hydrants are on the map'. LEVEL_DESIGN §5.7: the Inspector's route is shown on the shift map (SSP-214 adds that layer).
Input: TECHNICAL_DESIGN §13.1 / SSP-044. MAP is a `pressed` edge consumed by the scene layer and never reaches the sim InputFrame. ShiftScene owns the overlay. Driving input keeps flowing to the sim while the map is open.
Behaviour (propose and record in GDD §6.2): a press toggles the map (no hold). A second press, PauseOverlay opening (Esc/Start, or a hidden tab), or the shift ending closes it. While it is open, the timer and complaints meter stay visible and the rest of the HUD hides.
Layout: a `ui.panel_council` (or `ui.panel_dark`) panel centred below the top HUD rows, with the district name as its title. Map scale is the largest integer ≤ 4 that fits inside W − 8 × 230 px. That gives Puddle Lane 64×48 → 4, High Street 80×60 → 3 and Civic Quarter 128×96 → 2 (256×192) at every width 432–640 (LEVEL_DESIGN §3.1). Integer scaling only (ART_BIBLE §12.1).
Rendering: reuse `minimapPixels` (SSP-291) for roads 03, pavement 05, buildings 01, grime 08, frontages 23 (≥ 90% clean) / 18. Build the full-district base once per district at 1 px per tile in the UI-owned texture region (shared with the minimap base if possible) and draw it as one integer-scaled quad instance. Draw markers as UI instances: depot bay, every skip and every hydrant from compiled sites, pledge rosettes, and Bessie's arrow at her heading. Frontage status changes reuse the minimap's low-rate incremental update. It must stay inside draw #7 (TECHNICAL_DESIGN §12.7) with no per-frame allocations. Use the SSP-144 icons or small marker frames from the ui atlas, and record the legend in ART_BIBLE §12.2/§12.4.
A pure `shiftMapModel(level, frontages, bessie, W)` returns the scale, panel rect and marker list, so it can be unit-tested.

## Scope

- Map toggle in ShiftScene from the MAP edge (Tab / pad View); close on second press, PauseOverlay or shift end
- Pure `shiftMapModel` (scale, panel rect, markers) and its drawing in the UI pass, reusing minimapPixels and an integer-scaled base quad
- Markers: depot bay, skips, hydrants, pledge rosettes, Bessie's arrow; frontage green/red via the incremental update
- HUD visibility while open (timer + complaints stay)
- Record the toggle and HUD decisions in GDD §6.2 and the layout and legend in ART_BIBLE §12.2/§12.4
- Unit tests; captures on Puddle Lane and High Street

## Out of scope

- Inspector route layer (SSP-214)
- Touch Map icon (SSP-260) and remapping the map action (SSP-236)
- Pausing the shift while the map is open
- Mercury tally map (SSP-192)

## Acceptance criteria

- [ ] Unit test: a MAP edge toggles the map open, a second edge closes it, opening PauseOverlay closes it, and EV.ShiftEnd closes it
- [ ] Integration test: with the map open for 600 ticks, `ticksRemaining` falls by exactly 600 and no sim InputFrame carries a MAP bit
- [ ] Unit test: shiftMapModel picks scale 4 for 64×48, 3 for 80×60 and 2 for 128×96 at W = 432 and 640, and the panel stays inside the 4 px margin and below the top HUD rows
- [ ] Unit test: frontages ≥ 90% map to 23 and below to 18; every depot bay, skip, hydrant and pledge frontage in the compiled sites produces a marker; Bessie's arrow sits on her tile
- [ ] Captures of Puddle Lane and High Street with the map open at W = 432 and 640 were opened with Read and noted
- [ ] renderer.info.render.calls stays ≤ 10 with the map open; opening the map does not rebuild the base region (update counter), and the open-map frame path allocates nothing
- [ ] `npm run test:visual` passes; any golden change is Read before updating
- [ ] GDD §6.2 records toggle-not-hold and the HUD visibility rule

## Verification

- npx vitest run tests/unit/shiftMap.test.ts
- npm run test:e2e
- npm run test:visual
- npm run typecheck && npm run lint && npm test

## Dependencies

**Depends on:**

- [SSP-291](SSP-291-hud-minimap.md) Implement src/ui/minimap.ts: runtime 64×64 district minimap in the single UI draw
- [SSP-044](../M1/SSP-044-input-devices.md) Implement keyboard and gamepad input producing quantised per-tick InputFrames
- [SSP-285](../M3/SSP-285-ui-panels-9slice.md) Implement src/ui/panels.ts 9-slice panels and button states with placeholder panel grids
- [SSP-144](SSP-144-ui-icons-panels.md) HUD icons, 9-slice panels, button states and complaint stamp grids
- [SSP-069](../M2/SSP-069-bitmap-text.md) Implement src/ui/bitmapText.ts and the UI render pass
- [SSP-070](../M2/SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-064](../M2/SSP-064-tidy-frontages.md) Compute Tidy %, per-frontage clean % and Clean Sweep bonuses incrementally
- [SSP-055](../M2/SSP-055-compile-frontages-dump-validation.md) Generate frontages and pledges in the compiler and validate dump sites
- [SSP-061](../M2/SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats
- [SSP-287](../M3/SSP-287-pause-overlay.md) Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire
- [SSP-105](../M3/SSP-105-high-street-greybox.md) Author and compile the grey-box High Street (80×60) for Tuesday's NPCs

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-214](../M6/SSP-214-inspector.md) Implement npc.inspector and the inspection event with frontage deductions
- [SSP-260](../M8/SSP-260-touch-controls-overlay.md) Draw the touch control overlay in internal pixel space via the UI pass

## References

- ../../GDD.md#61-bindings
- ../../GDD.md#62-control-design-notes
- ../../GDD.md#152-hud-layout
- ../../GDD.md#93-frontages-and-pledges
- ../../ART_BIBLE.md#121-style
- ../../ART_BIBLE.md#122-hud-layout-480270-reference-anchored-to-corners-for-other-widths
- ../../TECHNICAL_DESIGN.md#131-actions-and-the-inputframe
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../LEVEL_DESIGN.md#31-district-table
- ../../LEVEL_DESIGN.md#33-what-each-day-teaches

## Roadmap tasks covered

_None._
