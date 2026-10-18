---
id: SSP-071
title: "Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry"
milestone: M2
status: todo
type: feature
estimate: M
labels: [type:feature, area:ui, area:gameplay, area:input, size:M, vertical-slice]
depends_on: [SSP-069, SSP-064, SSP-062, SSP-065, SSP-043, SSP-046, SSP-044, SSP-019]
blocks: [SSP-073, SSP-074, SSP-284, SSP-079, SSP-286, SSP-287, SSP-157, SSP-178, SSP-191, SSP-192, SSP-237]
---

# SSP-071: Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** feature · **Size:** M · **Areas:** ui, gameplay, input · **Vertical slice**

## Summary

Add a text-only `ShiftIntroScene` before the shift and a numbers-only `TallyScene` after it, wired through the SceneManager so `npm run dev` always runs a complete 240 s shift that ends on a tally with a fast Try Again.

## Context

Flow (TECHNICAL_DESIGN §6.2, GDD §15.1): ShiftIntroScene → ShiftScene → (time up / TOWED) → TallyScene → Try Again (intro card skipped) → ShiftScene. From M2, `npm run dev` must always run a complete 240 s shift (ROADMAP §1). Title, Week Map and Workshop do not exist yet.
ShiftIntroScene (placeholder, text only, Kerbside 5×7): district name ('PUDDLE LANE'), a one-line briefing placeholder and 'Press Space to start'. The compiled level `public/assets/levels/puddle_lane.json` loads while the card is shown (TECHNICAL_DESIGN §6.3). Pam portrait and real card art are M4.
TallyScene (numbers only): end reason (TIME UP or TOWED), Tidy % (one decimal), items collected (collected / spawned), grime cleaned (cells cleaned / initial), score, would-be stars (★ glyph, from Tidy % ≥ 0.60/0.80/0.92). The Mercury layout, £ and frontage map are M6. Enter on `EV.ShiftEnd` after the knock-off coast.
Buttons: Try Again (default focus) restarts the same seed with the intro skipped in under 3 s (GDD §11.3). A second option returning to the intro card stands in for 'quit' until a TitleScene exists (note it in GDD §15.1). Menu input is consumed by the scene layer (keyboard and standard gamepad), never fed to the sim.
Test hooks (TECHNICAL_DESIGN §18.5): `?test=1&scene=<id>` boots straight into a scene. E2E must read the active scene id; `SimSnapshot` has no field for it, so add `__ssp.scene()` (or a `scene` field) and document it in §18.5.
Scene interface (TECHNICAL_DESIGN §6.1): `enter/exit/fixedUpdate/render`, `blocksUpdateBelow`; `exit` releases GPU resources.
Add `tests/e2e/flow.spec.ts` (CLAUDE.md §7 requires e2e for scenes/flow): intro → Space → shift → step to the end → tally → Try Again, measuring the restart time.

SSP-284 adds BootScene in front of this flow, and PauseOverlay is SSP-287. Neither is in scope here.

## Scope

- `src/scenes/ShiftIntroScene.ts` placeholder card with level preload
- `src/scenes/TallyScene.ts` numbers page with Try Again and back-to-intro
- SceneManager wiring and ShiftScene → TallyScene on `EV.ShiftEnd`
- Test hook exposing the active scene id, documented in TECHNICAL_DESIGN §18.5
- `tests/e2e/flow.spec.ts`

## Out of scope

- TitleScene, WeekMapScene, WorkshopScene, PauseOverlay (M4/M6/M7)
- The Muckleford Mercury layout, headlines, £ (M6)
- Jingles (M5)

## Acceptance criteria

- [ ] `npm run dev` boots to the intro card; Space starts the shift; the shift ends on the tally after 240 s of timer time
- [ ] Tally shows end reason, Tidy %, items collected/spawned, grime cleaned/initial, score and would-be stars, each matching `__ssp.state()` (asserted in flow.spec.ts)
- [ ] Try Again restarts the same seed with the intro skipped, `__ssp.state().tick` resets, and the shift scene is active within 3 s of the key press (asserted in flow.spec.ts)
- [ ] Both scenes respond to keyboard and standard-mapping gamepad input (unit test on the menu input mapping)
- [ ] The active scene id is readable in test mode and documented
- [ ] `npm run test:e2e` passes

## Verification

- npm run test:e2e -- tests/e2e/flow.spec.ts
- npm run dev  # manual: intro → shift → tally → Try Again
- npm run typecheck && npm run lint && npm test

## Dependencies

**Depends on:**

- [SSP-069](SSP-069-bitmap-text.md) Implement src/ui/bitmapText.ts and the UI render pass
- [SSP-064](SSP-064-tidy-frontages.md) Compute Tidy %, per-frontage clean % and Clean Sweep bonuses incrementally
- [SSP-062](SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event
- [SSP-065](SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-043](../M1/SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-046](../M1/SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie
- [SSP-044](../M1/SSP-044-input-devices.md) Implement keyboard and gamepad input producing quantised per-tick InputFrames
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene

**Blocks:**

- [SSP-073](SSP-073-e2e-smoke.md) Add smoke.spec.ts: 60 s scripted sweep and full shift ending on the tally
- [SSP-074](SSP-074-close-m2.md) Close M2: verify exit criteria, record decisions and tag m2
- [SSP-284](SSP-284-boot-scene.md) Add BootScene: load atlases, fonts and the palette LUT once, then hand off to the shift flow
- [SSP-079](../M3/SSP-079-end-states-sacked-towed.md) End shifts on SACKED (5 complaints) and TOWED (0 HP) with correct tally rules
- [SSP-286](../M3/SSP-286-menu-navigation.md) Implement src/ui/menus.ts: keyboard, gamepad and mouse menu navigation plus input-device glyphs
- [SSP-287](../M3/SSP-287-pause-overlay.md) Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire
- [SSP-157](../M4/SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art
- [SSP-178](../M5/SSP-178-music-player.md) Implement music.ts: sample-locked stems, loops, jingles and scene music
- [SSP-191](../M6/SSP-191-week-map-scene.md) Build WeekMapScene: seven district cards, stars, unlock state and Gleaming badges
- [SSP-192](../M6/SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-237](../M7/SSP-237-assists-sim.md) Wire auto-brush, +60 s timer, Chill Shift and instant dump into the sim

## References

- ../../TECHNICAL_DESIGN.md#62-scene-flow
- ../../TECHNICAL_DESIGN.md#61-scenemanager
- ../../TECHNICAL_DESIGN.md#63-loading
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../GDD.md#151-scene-flow
- ../../GDD.md#121-stars-per-district
- ../../GDD.md#113-fail-states
- ../../ROADMAP.md#1-planning-principles

## Roadmap tasks covered

- `TallyScene` (numbers only): Tidy %, items collected, grime cleaned, score, would-be stars.
- `ShiftIntroScene` placeholder card (text only).
- `Deliverable: Tally numbers screen.`
