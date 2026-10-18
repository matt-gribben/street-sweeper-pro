---
id: SSP-118
title: "Complete ZooScene coverage and add the zoo visual golden for in-engine asset review"
milestone: M4
status: todo
type: feature
estimate: M
labels: [type:feature, area:render, area:test, area:assets, size:M, vertical-slice]
depends_on: [SSP-019, SSP-016, SSP-017, SSP-022, SSP-043, SSP-018, SSP-067, SSP-103, SSP-298]
blocks: [SSP-114, SSP-119, SSP-120, SSP-121, SSP-122, SSP-123, SSP-125, SSP-127, SSP-128, SSP-129, SSP-130, SSP-131, SSP-133, SSP-139, SSP-146, SSP-147, SSP-148, SSP-149, SSP-151, SSP-154, SSP-155, SSP-158, SSP-295, SSP-220, SSP-259]
---

# SSP-118: Complete ZooScene coverage and add the zoo visual golden for in-engine asset review

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** feature · **Size:** M · **Areas:** render, test, assets · **Vertical slice**

## Summary

Extend the M3 test-only `ZooScene` (`?test=1&scene=zoo`) so it covers every atlas with frames in `FRAME`, including world, fx and ui. Add a swap-slot row, settle and document the final layout, and add the `zoo` Playwright visual golden. Every M4 asset batch is reviewed in it.

## Context

TECHNICAL_DESIGN §6.2: `ZooScene` lays out every frame from `FRAME` in a grid at 1:1 for the `zoo` visual golden and for in-engine review. It is test-only and never reachable from menus. Test mode disables audio output (TECHNICAL_DESIGN §18.5). Visual spec (§18.4): Chromium headless with `--use-angle=swiftshader --enable-unsafe-swiftshader`, a 1920x1080 viewport (W = 480), opening `/?test=1&seed=1&scene=zoo&freeze=1`, waiting for `__ssp.ready`. `__ssp.readFrame()` returns W x 270 palette-mapped pixels, encoded with pngjs and compared by pixelmatch at threshold 0 against `tests/visual/__goldens__/zoo.png`. Failures write expected/actual/diff into `test-results/`. Test hooks: `seed`, `scene`, `tick=<n>` (advance animations deterministically), `freeze=1`, and `__ssp.setCamera`. Review needs (ART_BIBLE §15): readable on asphalt 02, slab 05 and grass 22; drop shadows at +2,+2 px; Bessie h00 present for scale; animations stepped with `&tick=<n>&freeze=1`; swap slots visible for swapped assets. Quick look during iteration: `npm run dev`, then `http://localhost:5173/?test=1&scene=zoo&freeze=1` (ASSET_PIPELINE §11.3). Open question (decide and record in TECHNICAL_DESIGN §6.2/§18.4, flagging it for the lead in the PR): 'every frame' cannot fit one 480x270 frame, since Bessie alone has 192 frames in 64-96 px cells. Proposal: the golden shows one representative frame per asset state (S / h00, plus a diagonal heading for vehicles) on asphalt/slab/grass bands, and `&asset=<id>` and/or `&page=<n>` query params show every frame of one asset for iteration. Add extra goldens only for pages the lead accepts.

A minimal ZooScene already exists from SSP-298. It covers actors and items frames, with a paged default view showing one representative frame per asset, `&asset=<id>` full-frame views, Bessie h00 for scale, drop shadows over flat 02/05/22 bands, and `tick` stepping. Build on that scene and its unit-tested layout function rather than replacing them.

## Scope

- Extend `src/scenes/ZooScene.ts` (from SSP-298) to every atlas with frames in `FRAME`, including world-atlas decals/tiles and fx frames
- Final default layout over asphalt/slab/grass bands (real ground tiles where available) with drop shadows, deterministic ordering by asset ID, and a slot row for assets with swaps
- Decide the full-frame coverage for the golden (keep or revise the M3 `&asset=` / `&page=` params)
- `tests/visual/zoo.spec.ts` and the first committed golden
- Document the layout decision in TECHNICAL_DESIGN §6.2/§18.4

## Out of scope

- `hud_specimen` scene (SSP-145)
- Final art (each asset batch re-approves the golden)

## Acceptance criteria

- [ ] `http://localhost:5173/?test=1&scene=zoo&freeze=1` renders with no console errors
- [ ] `npm run test:visual` passes `zoo` at threshold 0 on ten consecutive runs
- [ ] Vitest over the zoo layout function: every asset with frames in `FRAME` appears in the default view or a documented page
- [ ] The scene is not reachable from any menu, and test mode keeps audio off
- [ ] TECHNICAL_DESIGN documents how the zoo covers all frames

## Verification

- npm run test:visual
- for i in $(seq 10); do npm run test:visual || exit 1; done
- npm run typecheck && npm run lint && npm test
- Read tests/visual/__goldens__/zoo.png

## Dependencies

**Depends on:**

- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-016](../M0/SSP-016-palette-pass.md) Implement the MRT world target and palette pass (64³ OKLab LUT, night/shadow remap)
- [SSP-017](../M0/SSP-017-city-mesh-shadows.md) Render merged 1/3/6-storey block meshes with facade ramps and SE shadow polygons
- [SSP-022](../M0/SSP-022-visual-goldens.md) Add lean_quadrants and scale_1440 visual specs and goldens; prove 10-run stability (D-09)
- [SSP-043](../M1/SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-018](../M0/SSP-018-sprite-batch.md) Draw Bessie (32 headings) and the pedestrian via instanced sprite batches
- [SSP-067](../M2/SSP-067-items-sprite-batch.md) Render litter, stains and site markers via the items instance batch
- [SSP-103](../M3/SSP-103-render-actors-traffic.md) Draw NPCs, animals, traffic, knockables and hazards with state-driven frames
- [SSP-298](../M3/SSP-298-zoo-scene-review.md) Add a minimal test-only ZooScene for in-engine review of actors and items frames

**Blocks:**

- [SSP-114](SSP-114-ramp-swap-tables.md) Lock ramp-swap key indices and emit the 8 swap tables per atlas
- [SSP-119](SSP-119-tiles-road-surfaces.md) Final procedural road tiles: asphalt, markings, double yellows, zebra, drains, bays
- [SSP-120](SSP-120-tiles-kerb-blob.md) Final 47-tile kerb blob autotile generated by rule
- [SSP-121](SSP-121-tiles-pavement-grass-cobbles.md) Final pavement slabs, grass, cobbles, setts, tactile paving and edge tiles
- [SSP-122](SSP-122-grime-overlays.md) Procedural grime overlay patterns for asphalt, slab and gutter
- [SSP-123](SSP-123-stains-hazards.md) Procedural stain and hazard ground decals for the Mon-Tue set
- [SSP-125](SSP-125-facades-old-town.md) Old Town terrace facade modules and the pledge rosette (Puddle Lane)
- [SSP-127](SSP-127-bessie-final.md) Final Bessie renders: body, dented variant and 96x96 brush overlay
- [SSP-128](SSP-128-traffic-cars.md) Final Blender cars: hatchback, saloon, taxi, white van, parked aliases
- [SSP-129](SSP-129-traffic-bus-bike-scooter.md) Final Blender bus (128x128), bicycle and mobility scooter (32x32)
- [SSP-130](SSP-130-blender-props-flat.md) Blender flat props: bench, planter and the skip
- [SSP-131](SSP-131-blender-props-stacks.md) Blender sprite-stack props: lamp post, phone box, tree, bus shelter, stall
- [SSP-133](SSP-133-char-doris-pilot.md) Pilot the people pipeline end to end with npc.old_woman (Doris)
- [SSP-139](SSP-139-litter-sheet-01.md) Accept litter.sheet_01, ingest 6 items, hand-draw the can and butts
- [SSP-146](SSP-146-animal-cat.md) Hand-author the npc.cat grid: walk, sit, dart, leap in 8 directions
- [SSP-147](SSP-147-animals-pigeon-dog.md) Hand-author npc.pigeon and the npc.dog_loose grid with coat swap
- [SSP-148](SSP-148-small-props-grids.md) Hand-author small prop grids, including grid sprite stacks
- [SSP-149](SSP-149-pickups-grids.md) Hand-author power-up and Mon-Tue collectible pickup grids
- [SSP-151](SSP-151-road-decals.md) Road decals for High Street: oil, posters and graffiti via Codex ingest
- [SSP-154](SSP-154-vfx-core.md) Procedural VFX: dust, spray, sparkle, splash, leaf swirl, skid marks
- [SSP-155](SSP-155-vfx-reactions.md) Procedural VFX for reactions and damage: impact star, cough, anger, smoke
- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-295](../M5/SSP-295-vertical-slice-gate.md) Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR
- [SSP-220](../M6/SSP-220-art-humans-batch-a.md) Art Pass 2: final sprites for npc.jogger, npc.kid_skateboard and npc.kid_chalk
- [SSP-259](../M8/SSP-259-touch-ui-icons.md) Author 16×16 touch-control icons as text-grid UI sprites

## References

- ../../TECHNICAL_DESIGN.md#62-scene-flow
- ../../TECHNICAL_DESIGN.md#184-visual-headless-screenshot-tests
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../ART_BIBLE.md#151-review-procedure
- ../../ASSET_PIPELINE.md#113-batch-review-always

## Roadmap tasks covered

- `For each batch, open the contact sheet and the zoo with Read. Note the checks against the [ART_BIBLE.md](../../ART_BIBLE.md) review checklist in the PR.`
