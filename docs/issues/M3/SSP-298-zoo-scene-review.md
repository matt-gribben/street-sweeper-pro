---
id: SSP-298
title: "Add a minimal test-only ZooScene for in-engine review of actors and items frames"
milestone: M3
status: todo
type: feature
estimate: M
labels: [type:feature, area:render, area:test, area:assets, size:M, vertical-slice]
depends_on: [SSP-043, SSP-019, SSP-018, SSP-016, SSP-039, SSP-067, SSP-284]
blocks: [SSP-097, SSP-098, SSP-099, SSP-100, SSP-101, SSP-118]
---

# SSP-298: Add a minimal test-only ZooScene for in-engine review of actors and items frames

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** render, test, assets · **Vertical slice**

## Summary

Create `src/scenes/ZooScene.ts` behind `?test=1&scene=zoo`. It lays out actors- and items-atlas frames from `FRAME` at 1:1 under the real palette pass and drop shadows, with a paged representative view and an `&asset=<id>` full-frame view. This lets the M3 placeholder batches be reviewed in-engine, as the ROADMAP §1.1 definition of done requires. The golden and full atlas coverage stay in SSP-118 (M4).

## Context

ROADMAP §1.1 (definition of done, every milestone): any new or changed asset batch is reviewed with Read on its contact sheet and in the asset zoo (`?test=1&scene=zoo`). The M3 placeholder batches (SSP-097, SSP-098, SSP-099, SSP-100, SSP-101) require that review, but ZooScene was only scheduled in SSP-118 (M4).
TECHNICAL_DESIGN §6.2: `ZooScene` is test-only and never reachable from menus. The SceneId union already reserves 'zoo', and §18.5 lists `scene=zoo` among the test hooks (`seed`, `scene`, `tick`, `freeze=1`, `__ssp.readFrame()`, `__ssp.setCamera`). Test mode disables audio. Since SSP-284, BootScene finishes loading and then routes `?test=1&scene=zoo` here.
ART_BIBLE §15.1: the zoo screenshot shows the asset at 1x internal resolution under the palette pass, shadow mask and sub-pixel camera. Animated assets are stepped with `&tick=<n>&freeze=1`, and a 1x greyscale check of the screenshot must still separate the asset from asphalt and slab. The readability bands are asphalt 02, slab 05 and grass 22, and Bessie h00 is present for scale. ASSET_PIPELINE §11.3 gives the iteration URL `http://localhost:5173/?test=1&scene=zoo&freeze=1`, and walk cycles are checked animating at 10 fps.
Minimal design:
- Three flat ground bands in indices 02/05/22.
- Sprites drawn with the existing spriteBatch (SSP-018 actors, SSP-067 items), with +2,+2 drop shadows into the mask.
- A pure, unit-tested `zooLayout` function decides placement.
- The default view shows one representative frame per asset (first state, S or h00, frame 0), sorted by asset ID and paged with `&page=<n>` when it overflows 480x270.
- `&asset=<id>` shows every frame of one asset, one row per state with frames left to right, paged if needed.
- With `tick=<n>`, displayed frames cycle within their state at 10 fps (frame = floor(tick / 6) mod count).
- Bessie `veh.sweeper:body:h00:0` appears on every page.
- An unknown `asset=` logs a console error naming the ID and falls back to the default view.
Not every frame fits one 480x270 view (Bessie alone has 64 body/dented frames in 64 px cells). The final layout decision and its documentation belong to SSP-118.

## Scope

- src/scenes/ZooScene.ts registered with SceneManager as 'zoo' and reachable only via `?test=1&scene=zoo`
- Flat 02/05/22 ground bands; actors and items frames at 1:1 with +2,+2 drop shadows; Bessie h00 on every page
- Pure `zooLayout(frameIds, { page, asset })` with the default representative view, `&page=<n>` and `&asset=<id>`
- `tick`-driven 10 fps frame cycling under `freeze=1`
- Unit tests for the layout function
- A one-line note in the ROADMAP §5 M4 deliverables: a minimal ZooScene lands in M3 for the §1.1 review, and the zoo golden stays in M4

## Out of scope

- `tests/visual/zoo.spec.ts` and the zoo golden (SSP-118)
- World, ui and fx atlas frames and real ground tiles in the zoo (SSP-118)
- Swap-slot rows (SSP-114 / SSP-118)
- Documenting the final zoo layout in TECHNICAL_DESIGN §6.2/§18.4 (SSP-118)

## Acceptance criteria

- [ ] `http://localhost:5173/?test=1&scene=zoo&freeze=1` renders with no console errors, `__ssp.ready` becomes true, and `__ssp.readFrame()` returns a 480x270 frame
- [ ] Vitest: in the default view, every actors/items asset in FRAME appears exactly once across pages, ordered by asset ID, with no overlapping cells and every cell inside 480x270
- [ ] Vitest: `zooLayout` with `asset: 'veh.sweeper'` places every veh.sweeper frame ID exactly once across its pages
- [ ] Vitest: an unknown `asset` ID yields the default layout plus an error naming the ID
- [ ] No menu or scene transition targets 'zoo' (unit test over the menu definitions), and test mode keeps audio off
- [ ] Captures of `?test=1&seed=1&scene=zoo&freeze=1` and `&asset=veh.sweeper` (via `__ssp.readFrame()`, saved under build/) were opened with Read, and the PR notes that Bessie h00 is present, shadows sit at +2,+2 and sprites read on all three bands
- [ ] Existing visual goldens pass unchanged

## Verification

- npm test
- npm run typecheck
- npm run lint
- npm run test:visual
- npm run dev, open /?test=1&scene=zoo&freeze=1, capture to build/ and Read

## Dependencies

**Depends on:**

- [SSP-043](../M1/SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-018](../M0/SSP-018-sprite-batch.md) Draw Bessie (32 headings) and the pedestrian via instanced sprite batches
- [SSP-016](../M0/SSP-016-palette-pass.md) Implement the MRT world target and palette pass (64³ OKLab LUT, night/shadow remap)
- [SSP-039](../M1/SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end
- [SSP-067](../M2/SSP-067-items-sprite-batch.md) Render litter, stains and site markers via the items instance batch
- [SSP-284](../M2/SSP-284-boot-scene.md) Add BootScene: load atlases, fonts and the palette LUT once, then hand off to the shift flow

**Blocks:**

- [SSP-097](SSP-097-placeholder-human-grids-mon.md) Author placeholder grids for the six Monday human NPCs (24×24, 13 frames/dir)
- [SSP-098](SSP-098-placeholder-human-grids-tue.md) Author placeholder grids for businessman, litterbug and market trader
- [SSP-099](SSP-099-placeholder-animal-grids.md) Author placeholder grids for the cat, pigeon and dog (npc.dog_loose grid)
- [SSP-100](SSP-100-placeholder-vehicle-renders.md) Render placeholder traffic vehicles in Blender as primitive boxes at 32 headings
- [SSP-101](SSP-101-placeholder-props-hazards.md) Add placeholder sprites for knockables, hazards, SSP-096 and High Street props
- [SSP-118](../M4/SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review

## References

- ../../TECHNICAL_DESIGN.md#62-scene-flow
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../TECHNICAL_DESIGN.md#125-sprites-spritebatchts-spritestackts
- ../../ART_BIBLE.md#151-review-procedure
- ../../ASSET_PIPELINE.md#113-batch-review-always
- ../../ROADMAP.md#11-definition-of-done-every-task-every-milestone

## Roadmap tasks covered

_None._
