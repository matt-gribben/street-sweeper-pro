---
id: SSP-070
title: "Build the basic HUD: timer, score, combo popups, hopper, water and HP"
milestone: M2
status: todo
type: feature
estimate: M
labels: [type:feature, area:ui, area:gameplay, size:M, vertical-slice]
depends_on: [SSP-069, SSP-063, SSP-062, SSP-058, SSP-061, SSP-065, SSP-036, SSP-043, SSP-015, SSP-019]
blocks: [SSP-073, SSP-074, SSP-078, SSP-289, SSP-299, SSP-144, SSP-156, SSP-291, SSP-300, SSP-235, SSP-240, SSP-242, SSP-257]
---

# SSP-070: Build the basic HUD: timer, score, combo popups, hopper, water and HP

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** feature · **Size:** M · **Areas:** ui, gameplay · **Vertical slice**

## Summary

Implement `src/ui/hud.ts` with the M2 basic HUD (shift timer, score, combo multiplier with tier popup text and chain-timer bar, hopper bar with 80% warning, water bar and HP bar) drawn in Kerbside 5×7, anchored to the screen corners at every supported width.

## Context

Owners: GDD §15.2 owns which elements exist and their behaviour; ART_BIBLE §12.2 owns pixel positions and colours (proposed; M2 confirms HUD layout details per ART_BIBLE §17). 4 px safe margin from every edge at all widths 432–640.
Elements for M2 (ART_BIBLE §12.2):
- Shift timer: top-left (4, 4), m:ss from `ticksRemaining` (display ceil(ticks/60) s, so 14,400 → '4:00'); 07; lemon 16 under 60 s (ticksRemaining < 3,600); flashes 18 every 30 ticks under 30 s (< 1,800). ART_BIBLE specifies Kerbside Bold, which is M4: use 5×7 now.
- Score: top-centre, centred on W/2, y = 4, 07.
- Combo: beside the score on the same baseline: multiplier and tier word, outlined, in the tier colour (×2 23 'TIDY!', ×3 28 'SPOTLESS!', ×4 16 'IMMACULATE!', ×5 'SWEEPING BEAUTY!' cycling 16→17→20→28→23 every 5 ticks); chain-timer bar 48×2 in 17 beneath the score, shrinking with the chain timer.
- Tier popup text on `EV.ComboTier`: rises 12 px over 36 ticks with ease-out, holds 12 ticks, blinks out 3 × 3 ticks (ART_BIBLE §11 popup timing).
- Hopper: bottom-left, 64×6 bar, fill 15; 17 with '!' at ≥ 80%; flashing 18 with 'FULL' at 100%; percentage text. (The 16×16 icon and the dump-site arrow are M4/later.)
- Water: beside hopper, 64×6, fill 27 with a 28 top pixel row.
- Dignity (HP): beside water, 64×6; 23 above 60 HP, 15 from 40 to 60 HP, 18 below 40 HP.
Make the logic testable: a pure `hudModel(snapshot, tick)` function returns each element's text, colour index, fill and visibility; `hud.ts` only draws the model. The docs give no bar asset: add a minimal placeholder `ui.*` solid frame (e.g. `ui.bar_fill`) in the ui atlas and the manifest, keeping one UI draw call. HUD reads sim state read-only and listens via `src/app/events.ts`; it never mutates the sim.
Not in M2: complaints meter (M3), radio panel, minimap, Brush-o-meter, brush state and power-up widgets, Tidy % bar, icons (M4/M6), off-screen arrows.
Evidence: capture frames with `tests/e2e/helpers/saveFrame.ts` (create it if missing) at three viewports and Read them.

Hold-to-dump ring (GDD §6.2: 'A ring fills around the button prompt during the hold'; GDD §8.7). Show a dump prompt whenever a dump is available: Bessie stopped (< 0.5 m/s) inside site.depot_bay, or stopped next to site.skip. The prompt is the interact key label ('E' in M2) with a ring that fills over the 60-tick hold. Read the SSP-062 dump FSM state and hold ticks read-only. If no accessor exists, add a read-only view without moving any logic out of the sim. The ring hides on cancel, when speed goes above 0.5 m/s, and once Draining starts. Add minimal placeholder `ui.*` ring frames (e.g. 8 fill steps) in the ui atlas. Record the position in ART_BIBLE §12.2; the proposal is bottom-centre, clear of the look-ahead zone. SSP-257 (touch) and SSP-237 (instantDump) reuse this.

## Scope

- `src/ui/hud.ts` and a pure `hudModel` with the six M2 elements and tier popups
- Corner anchoring for W = 432..640
- Minimal `ui.*` placeholder frame for bars (manifest + regenerated assets)
- Update ART_BIBLE §12.2/§17 with confirmed M2 positions
- Dump-available prompt with a hold-to-dump fill ring driven by the SSP-062 dump FSM (read-only accessor if needed), plus placeholder ring frames

## Out of scope

- Complaints meter, Brush-o-meter, icons, Tidy % bar
- Minimap (SSP-291) and radio panel (SSP-289)
- Per-pickup world-space score popups (SSP-288)
- 9-slice panels runtime (SSP-285)
- Kerbside Bold (M4)
- `hud_specimen` golden (SSP-145, M4)
- Brush-o-meter, brush state with spin-up ring, district name + Tidy % bar, and off-screen depot/hydrant arrows (SSP-299)

## Acceptance criteria

- [ ] Frames at 1920×1080 (W = 480), 1440×1080 (W = 432) and 2560×1080 (W = 640) show all six elements inside the 4 px margin with no overlap (frames Read and attached)
- [ ] hudModel unit tests: 14,400 ticks → '4:00' in 07; 3,600 → 07; 3,599 → 16; below 1,800 alternates 18 every 30 ticks
- [ ] hudModel unit tests: hopper 79% → 15 with no '!'; 80% → 17 with '!'; 100% → 'FULL' flashing 18
- [ ] hudModel unit tests: HP 61 → 23, 60 → 15, 40 → 15, 39 → 18
- [ ] A tier change spawns a popup that rises 12 px over 36 ticks, holds 12, blinks 3 × 3 ticks, in the tier colour (unit test)
- [ ] Draw calls ≤ 10 with the HUD visible; no per-frame allocations in `hud.ts`
- [ ] `npm run assets:verify` and `npm run test:visual` pass
- [ ] hudModel unit tests: the ring is hidden when no dump is available; in Holding at hold tick k (0..60) its fill step is floor(k / 60 × steps); it hides on cancel and when Draining starts

## Verification

- npx vitest run tests/unit/hud.test.ts
- npm run test:e2e  # HUD frames at three viewports saved to test-results/, then Read
- npm run assets:verify
- npm run test:visual
- npm run typecheck && npm run lint

## Dependencies

**Depends on:**

- [SSP-069](SSP-069-bitmap-text.md) Implement src/ui/bitmapText.ts and the UI render pass
- [SSP-063](SSP-063-scoring-combo.md) Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger
- [SSP-062](SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event
- [SSP-058](SSP-058-hopper.md) Implement hopper.ts LU accounting, mass coupling and bulldozer state
- [SSP-061](SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats
- [SSP-065](SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-036](../M1/SSP-036-static-collision.md) Resolve Bessie against static geometry with impact damage and TOWED stub
- [SSP-043](../M1/SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-015](../M0/SSP-015-render-core-camera-upscale.md) Build the renderer skeleton: perspective camera, sub-pixel snap, upscale and speed zoom
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene

**Blocks:**

- [SSP-073](SSP-073-e2e-smoke.md) Add smoke.spec.ts: 60 s scripted sweep and full shift ending on the tally
- [SSP-074](SSP-074-close-m2.md) Close M2: verify exit criteria, record decisions and tag m2
- [SSP-078](../M3/SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-289](../M3/SSP-289-pam-radio-panel.md) Add Big Pam's HUD radio panel with a one-at-a-time bark queue and inline key glyphs
- [SSP-299](../M3/SSP-299-hud-brush-tidy-arrows.md) Add the Brush-o-meter, brush state ring, district name with Tidy % bar, and off-screen depot/hydrant arrows to the HUD
- [SSP-144](../M4/SSP-144-ui-icons-panels.md) HUD icons, 9-slice panels, button states and complaint stamp grids
- [SSP-156](../M4/SSP-156-hud-final-art.md) Restyle the HUD and score popups with final fonts, icons and panels
- [SSP-291](../M4/SSP-291-hud-minimap.md) Implement src/ui/minimap.ts: runtime 64×64 district minimap in the single UI draw
- [SSP-300](../M4/SSP-300-shift-map-overlay.md) Add the Tab shift map overlay: district map with frontage status, depot, skips and hydrants, without pausing
- [SSP-235](../M7/SSP-235-settings-scene.md) Build SettingsScene with audio, display, accessibility and assist pages
- [SSP-240](../M7/SSP-240-juice-squash-popups.md) Juice pass: squash-and-stretch, combo popups and the cat roof-ride
- [SSP-242](../M7/SSP-242-reduce-flashing.md) Implement the Reduce flashing setting across HUD and world effects
- [SSP-257](../M8/SSP-257-touch-input-device.md) Implement src/input/touch.ts producing the same InputFrame as keyboard and pad

## References

- ../../GDD.md#152-hud-layout
- ../../ART_BIBLE.md#122-hud-layout-480270-reference-anchored-to-corners-for-other-widths
- ../../ART_BIBLE.md#11-vfx
- ../../ART_BIBLE.md#17-open-items
- ../../TECHNICAL_DESIGN.md#121-internal-resolution-and-scaling

## Roadmap tasks covered

- `src/ui/hud.ts`: timer, score, combo tier popup text, hopper bar with 80% warning, water, HP.
- `Deliverable: Basic HUD (timer, score, combo, hopper %, water, HP) in a first draft of Kerbside 5×7.`
