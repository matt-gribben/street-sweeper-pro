---
id: SSP-299
title: "Add the Brush-o-meter, brush state ring, district name with Tidy % bar, and off-screen depot/hydrant arrows to the HUD"
milestone: M3
status: done
type: feature
estimate: L
labels: [type:feature, area:ui, area:gameplay, area:render, area:test, size:L, vertical-slice]
depends_on: [SSP-070, SSP-059, SSP-064, SSP-061, SSP-058, SSP-055, SSP-047, SSP-015, SSP-069, SSP-042]
blocks: [SSP-109, SSP-290, SSP-156]
---

# SSP-299: Add the Brush-o-meter, brush state ring, district name with Tidy % bar, and off-screen depot/hydrant arrows to the HUD

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** L · **Areas:** ui, gameplay, render, test · **Vertical slice**

## Summary

Extend `src/ui/hud.ts` and its pure `hudModel` with the four GDD §15.2 widgets that SSP-070 left out and SSP-156 only restyles. They are the Brush-o-meter (three patterned speed zones), the brush state icon with its spin-up ring, the district name with the Tidy % bar and star ticks, and edge arrows to the depot bay (hopper ≥ 80%) and the nearest hydrant (water < 20%). All use placeholder `ui.*` frames in the single UI draw.

## Context

Owners: GDD §15.2 owns which elements exist and how they behave. ART_BIBLE §12.2 owns pixel positions and colours (480×270 reference, 4 px safe margin at W = 432..640). SSP-070 excluded these widgets, SSP-156 (M4) only restyles existing widgets, and GDD §16.2 beats 3 and 7 (SSP-290, M3) refer to them, so they land in M3 with placeholder art.

Brush-o-meter (GDD §15.2, §8.2–8.3; ART_BIBLE §12.2): bottom-left below the gauges, 64×8. Three zones: clean (speed ≤ 4.0 m/s, solid 23), fling (4.0–6.0 m/s, hatched 17/03) and transit (brush raised, dotted 26/03). Needle in 07 with an ink outline, and speed in Kerbside 5×7 beside it, in mph by default (mph = round(|vLong| × 2.237), so 4.0 m/s reads '9 mph'). Needle, colour and pattern together mean it never relies on colour alone (GDD §17.2). The docs do not fix the needle scale. Proposal: while the brush is lowering or down the bar spans 0–6.0 m/s, so clean fills the first floor(4/6 × 64) = 42 px. While raising or raised the whole bar shows the dotted transit pattern and the needle spans 0–11.0 m/s. The clean/fling boundary follows the live fling threshold t0 read from the sim (6.0 m/s under `pwr.super_suction`, so the whole brush-down bar reads clean). Record the scale in ART_BIBLE §12.2.

Brush state (ART_BIBLE §12.2): 16×16, right of the Brush-o-meter. ▲ raised / ▼ lowered placeholder frames with a 15 spin-up ring. States come read-only from SSP-059 (Raised → Lowering → SpinningUp → Collecting → Bulldozing → Raising; rpm 0..1; 36-tick spin-up). Proposal: the ring has 8 steps, floor(rpm × 8), and is shown from Lowering through Bulldozing. Raised and Raising show ▲ with no ring. Lowering shows ▼ with an empty ring. Record this in ART_BIBLE §12.2.

District + Tidy % (ART_BIBLE §12.2): the district name at (4, 16) in 5×7 07, uppercase, from the compiled level's display name. The bar sits at (4, 26), 64×4, fill 23 on 03, with 07 tick marks at 60/80/92 placed at x = floor(threshold × 64) (38, 51, 58). The value sits beside it in 5×7. Fill and value use floor (fill floor(tidy × 64), text floor(tidy × 100)%), so the HUD never shows a star threshold before it is reached. Tidy % is read from the SSP-064 counters.

Off-screen arrows (GDD §15.2): one arrow points to the depot bay while the hopper is ≥ 80% full (fill fraction, so upgrades to capacity still work). It covers the GDD hopper row's 'dump-site arrow at 100%'. Another points to the nearest hydrant while water is < 20%. Nearest means Euclidean distance from Bessie to the site centre, with ties broken by lowest site index. Project the target with the render camera (UI may read presentation state; the sim never does, TECHNICAL_DESIGN §7.4). Draw the arrow where the ray from Bessie's screen position to the target meets a rect inset by the 4 px margin, nudged so it never overlaps the HUD corner blocks. Use 8-direction placeholder frames, never non-integer rotation (ART_BIBLE §12.1). Proposal: hide an arrow while its target is inside the visible frame, and colour the depot arrow 15 and the hydrant arrow 27. ART_BIBLE §12.2 has no arrow row yet: add one, and record the on-screen rule in GDD §15.2.

Tutorial hooks: GDD §16.2 beat 3 highlights the Brush-o-meter clean zone, and beat 7 says 'the arrow'll show you'. Expose a model input such as `highlightCleanZone(untilTick)` that SSP-290 calls. The depot arrow needs no hook.

Rules: the HUD reads sim state read-only (TECHNICAL_DESIGN §2.1); the logic lives in the pure `hudModel` and hud.ts only draws it. No per-frame allocations. Everything stays in the one UI instanced draw (TECHNICAL_DESIGN §12.7). New frames are placeholder `ui.*` entries (`placeholder: true`) in the ui atlas and manifest, which SSP-144/SSP-156 replace. The power-up slot to the right of the brush state belongs to SSP-096. Leave room for it.

## Scope

- Brush-o-meter in hudModel/hud.ts: zones from the live fling threshold, needle scale, mph text, three distinct patterns
- Brush state icon (▲/▼) with an 8-step spin-up ring driven by SSP-059 state and rpm
- District name and Tidy % bar with 60/80/92 tick marks and floor-rounded value
- Off-screen depot (hopper ≥ 80%) and nearest-hydrant (water < 20%) arrows: camera projection, inset-rect placement, HUD-block avoidance, hide-when-on-screen
- `highlightCleanZone` hook for SSP-290 beat 3
- Placeholder `ui.*` frames (meter patterns, needle, brush icons, ring steps, 8-direction arrows) in the manifest; regenerate assets
- Record needle scale, ring steps, the arrow row and the on-screen rule in ART_BIBLE §12.2 and GDD §15.2

## Out of scope

- Final art, fonts and icons for these widgets (SSP-156)
- Power-up icon and countdown (SSP-096)
- Minimap (SSP-291) and the Tab shift map (SSP-300)
- Hydrant icon pulse on the water gauge (SSP-156)
- km/h units setting (SSP-235, M7) and touch layout (SSP-261)
- Any change to sim thresholds (GDD-owned)

## Acceptance criteria

- [ ] hudModel unit tests: brush down at 3.9 m/s → zone clean, '9 mph'; at 4.5 m/s → zone fling, '10 mph'; brush raised at 8.0 m/s → zone transit, '18 mph'; with the fling threshold at 6.0 m/s (super suction) a brush-down speed of 5.5 m/s reads clean
- [ ] Unit test on the meter pattern function: the clean, fling and transit regions use three different pixel patterns, not only three colours
- [ ] hudModel unit tests: Raised → ▲ with no ring; SpinningUp at rpm 0.5 → ▼ with ring step 4 of 8; Collecting → ▼ with a full ring
- [ ] hudModel unit tests: Tidy 0.599 → text '59%' and fill 38 px; tick marks at x = 38, 51 and 58
- [ ] hudModel unit tests: hopper 79% → no depot arrow; 80% with the depot bay off-screen → arrow visible inside the 4 px margin, pointing within 22.5° of the true direction; the same with the depot on-screen → hidden
- [ ] hudModel unit tests: water 20% → no hydrant arrow; 19% → arrow to the nearer of two fixture hydrants
- [ ] Frames at W = 432, 480 and 640 show all four widgets inside the 4 px margin with no overlap with the SSP-070 elements, the radio panel or the reserved minimap slot (frames Read and attached)
- [ ] Draw calls ≤ 10 with the HUD visible, and no per-frame allocations in hud.ts
- [ ] `npm run assets:verify` and `npm run test:visual` pass
- [ ] ART_BIBLE §12.2 records the needle scale, ring steps and an off-screen arrow row; GDD §15.2 records the hide-when-on-screen rule

## Verification

- npx vitest run tests/unit/hud.test.ts
- npm run test:e2e  # HUD frames at three widths saved to test-results/, then Read
- npm run assets:verify
- npm run test:visual
- npm run typecheck && npm run lint

## Dependencies

**Depends on:**

- [SSP-070](../M2/SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-059](../M2/SSP-059-brush.md) Implement brush.ts state machine, suction, inlet collection and fling roll
- [SSP-064](../M2/SSP-064-tidy-frontages.md) Compute Tidy %, per-frontage clean % and Clean Sweep bonuses incrementally
- [SSP-061](../M2/SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats
- [SSP-058](../M2/SSP-058-hopper.md) Implement hopper.ts LU accounting, mass coupling and bulldozer state
- [SSP-055](../M2/SSP-055-compile-frontages-dump-validation.md) Generate frontages and pledges in the compiler and validate dump sites
- [SSP-047](../M1/SSP-047-camera-lookahead-zoom.md) Drive camera look-ahead and speed zoom from Bessie's real speed
- [SSP-015](../M0/SSP-015-render-core-camera-upscale.md) Build the renderer skeleton: perspective camera, sub-pixel snap, upscale and speed zoom
- [SSP-069](../M2/SSP-069-bitmap-text.md) Implement src/ui/bitmapText.ts and the UI render pass
- [SSP-042](../M1/SSP-042-puddle-lane-level.md) Author Puddle Lane map.txt and level.json (64×48) and commit compiled output

**Blocks:**

- [SSP-109](SSP-109-close-m3.md) Close M3: verify the exit criteria, sync docs, state the frozen entity list, tag m3
- [SSP-290](SSP-290-tutorial-beats.md) Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events
- [SSP-156](../M4/SSP-156-hud-final-art.md) Restyle the HUD and score popups with final fonts, icons and panels

## References

- ../../GDD.md#152-hud-layout
- ../../GDD.md#82-brush-states
- ../../GDD.md#83-the-fling-curve-pillar-3-in-one-formula
- ../../GDD.md#92-tidy-
- ../../GDD.md#162-puddle-lane-first-play-script-proposed-m2m3
- ../../GDD.md#172-accessibility-features
- ../../ART_BIBLE.md#122-hud-layout-480270-reference-anchored-to-corners-for-other-widths
- ../../ART_BIBLE.md#121-style
- ../../TECHNICAL_DESIGN.md#83-brush-mechanics-state
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom

## Roadmap tasks covered

_None._
