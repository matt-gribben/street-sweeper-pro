---
id: SSP-284
title: "Add BootScene: load atlases, fonts and the palette LUT once, then hand off to the shift flow"
milestone: M2
status: todo
type: feature
estimate: M
labels: [type:feature, area:platform, area:render, area:ui, area:test, size:M, vertical-slice]
depends_on: [SSP-043, SSP-016, SSP-018, SSP-068, SSP-069, SSP-071, SSP-046, SSP-019]
blocks: [SSP-074, SSP-298, SSP-157, SSP-174, SSP-186]
---

# SSP-284: Add BootScene: load atlases, fonts and the palette LUT once, then hand off to the shift flow

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** feature · **Size:** M · **Areas:** platform, render, ui, test · **Vertical slice**

## Summary

Create `src/scenes/BootScene.ts` as the root scene. It loads every atlas, the font metrics and the palette LUT exactly once and passes them to later scenes through a shared read-only asset registry. It then hands off to the M2 flow: ShiftIntroScene now, TitleScene from M4 (SSP-157). Audio (SSP-174, M5) and the save (SSP-186, M6) later extend this same scene.

## Context

TECHNICAL_DESIGN §6.2 starts the flow at `BootScene` ('atlases, fonts, palette LUT, save'). §6.3 says what loads there: the `ui`, `actors`, `items`, `fx` and `world` atlases (each ≤ 2048² PNG), fonts, the palette and all SFX. No issue builds BootScene yet, so each M0–M2 scene loads its own resources: the SSP-018 atlas loader with its load-time palette check, the SSP-016 64³ OKLab LUT (about 30 ms, built at boot from kerbside32.json) and the SSP-069 font metrics.
Registry: load in parallel and resolve URLs relative to `import.meta.env.BASE_URL` (`base: './'`, TECHNICAL_DESIGN §20.2). Expose the result as a typed, read-only `Assets` object passed to later scenes through SceneParams (or held by Game). ShiftScene, ShiftIntroScene, TallyScene and the test-only scenes (level_preview and the spike scenes) take their assets from it and stop loading atlases themselves. M2 has only the atlases that exist so far. Drive the atlas list from `src/gen/assets.ts`, so the M4 atlases are picked up with no code change.
Routing: by default BootScene hands off to ShiftIntroScene (SSP-071); SSP-157 later changes the target to TitleScene. With `?test=1&scene=<id>`, BootScene finishes loading and then jumps straight to that scene (the dotted BOOT → ZOO edge in §6.2), so existing test hooks keep working. The `__ssp` ready signal (SSP-019) must flip only after boot completes.
Failure: a missing or off-palette atlas must surface as a thrown error in the console and in the test hook, never as a silent black screen that hangs.
Later extensions, not part of this issue: SSP-174 adds codec selection and SFX decoding to BootScene, and SSP-186 adds loading the save.
Keep the shipping bundle testable: Playwright runs against `vite build` + preview (§20.2).

## Scope

- src/scenes/BootScene.ts registered with SceneManager as the first scene
- Shared read-only asset registry (atlases with the palette check, font metrics, palette LUT plus night/shadow remap textures) passed to later scenes
- Remove per-scene atlas/LUT loading from ShiftScene, ShiftIntroScene, TallyScene and the test-only scenes
- Routing: default → ShiftIntroScene; ?test=1&scene=<id> → that scene after boot; __ssp ready only after boot
- Unit test for the routing function; e2e check of the request log
- Document BootScene's responsibilities in TECHNICAL_DESIGN §6.3 if the implementation refines them

## Out of scope

- Audio codec selection and SFX loading (SSP-174)
- Loading the save and the storage notice (SSP-186)
- TitleScene (SSP-157)
- A loading progress bar

## Acceptance criteria

- [ ] `npm run dev` boots through BootScene into the ShiftIntroScene card, and the full intro → shift → tally → Try Again flow still works (tests/e2e/flow.spec.ts passes)
- [ ] Across one boot plus intro → shift → tally → Try Again, the Playwright request log shows each atlas PNG and JSON, and the font metrics JSON, fetched exactly once
- [ ] The palette LUT is built exactly once per page load, asserted through a test-mode counter or a unit test with a spy on buildLut
- [ ] `?test=1&scene=district.puddle_lane&freeze=1` still renders the same frame as before, and the existing visual goldens pass unchanged
- [ ] The `__ssp` ready signal resolves only after BootScene has finished loading (e2e)
- [ ] With an atlas URL forced to 404 by a Playwright route, boot fails within 5 s with a visible console error naming the atlas, and nothing hangs unhandled

## Verification

- npm run typecheck && npm run lint && npm test
- npm run test:e2e
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-043](../M1/SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-016](../M0/SSP-016-palette-pass.md) Implement the MRT world target and palette pass (64³ OKLab LUT, night/shadow remap)
- [SSP-018](../M0/SSP-018-sprite-batch.md) Draw Bessie (32 headings) and the pedestrian via instanced sprite batches
- [SSP-068](SSP-068-kerbside5x7-font.md) Draft Kerbside 5×7 glyphs and add the forge font builder and ui atlas
- [SSP-069](SSP-069-bitmap-text.md) Implement src/ui/bitmapText.ts and the UI render pass
- [SSP-071](SSP-071-intro-tally-scenes.md) Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry
- [SSP-046](../M1/SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene

**Blocks:**

- [SSP-074](SSP-074-close-m2.md) Close M2: verify exit criteria, record decisions and tag m2
- [SSP-298](../M3/SSP-298-zoo-scene-review.md) Add a minimal test-only ZooScene for in-engine review of actors and items frames
- [SSP-157](../M4/SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art
- [SSP-174](../M5/SSP-174-unlock-codec-loading.md) Add unlock.ts, Opus/AAC codec selection and boot-time audio loading
- [SSP-186](../M6/SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub

## References

- ../../TECHNICAL_DESIGN.md#62-scene-flow
- ../../TECHNICAL_DESIGN.md#63-loading
- ../../TECHNICAL_DESIGN.md#61-scenemanager
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../TECHNICAL_DESIGN.md#202-vite-configuration

## Roadmap tasks covered

_None._
