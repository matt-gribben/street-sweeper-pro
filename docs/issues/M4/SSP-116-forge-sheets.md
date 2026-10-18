---
id: SSP-116
title: "Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row"
milestone: M4
status: todo
type: feature
estimate: S
labels: [type:feature, area:tooling, area:assets, area:test, size:S, vertical-slice]
depends_on: [SSP-113, SSP-011, SSP-008, SSP-040]
blocks: [SSP-117, SSP-119, SSP-120, SSP-121, SSP-122, SSP-123, SSP-124, SSP-125, SSP-127, SSP-128, SSP-129, SSP-130, SSP-131, SSP-132, SSP-133, SSP-139, SSP-142, SSP-143, SSP-144, SSP-146, SSP-147, SSP-148, SSP-149, SSP-150, SSP-151, SSP-154, SSP-155, SSP-193, SSP-220, SSP-221, SSP-270]
---

# SSP-116: Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** feature · **Size:** S · **Areas:** tooling, assets, test · **Vertical slice**

## Summary

SSP-011 shipped the M0 `forge sheets`: 4x frames labelled with frame IDs, light and dark backgrounds, a palette strip, Bessie h00 for scale, `--atlas` and `--only`. This issue extends it for M4. Every emitted atlas sheet gets the palette strip and Bessie h00. `--only` takes several IDs and lays out each state's frames left to right. Every `wrap: true` tile gets a 3x3 tiled preview, and assets with swaps get an 8-slot swap row.

## Context

Already done (SSP-011, M0; ASSET_PIPELINE §9.5): `build/sheets/<atlas>.png` at 4x with every frame labelled by frame ID; light #c3c1c0 (palette 06) and dark #24222a (palette 01) backgrounds read from kerbside32.json; a palette strip; Bessie h00 beside each group; `--atlas <name>`; and `--only <id>`, which writes `build/sheets/only_<id>.png`. Labels use Pillow's default bitmap font, which remains acceptable for build/ review artefacts. SSP-040 (M1) may already have added a 3x3 tiled preview for wrap tiles. Extend whatever exists and do not rewrite tools/forge/forge/sheets.py.

M4 increments:
- Bessie h00 (`veh.sweeper:body:h00:0`) and the Kerbside-32 strip appear on every emitted atlas sheet (world, actors, items, ui, and fx when it exists), not only on actors.
- `--only <id>…` accepts several IDs (§5.3) and writes one `build/sheets/only_<id>.png` per ID. That is the sheet to Read during iteration.
- A state's frames are laid out left to right so animation can be checked in sequence (ART_BIBLE §15.1).
- Every `wrap: true` tile gets a 3x3 tiled preview (ASSET_PIPELINE §10.8), on its atlas sheet and in its `--only` sheet.
- ART_BIBLE §15.2 requires checking all 8 swap slots on the sheet for cars and shoppers. An asset whose manifest lists `swaps` gets a row showing its representative frame under each swap slot, using the tables SSP-114 emits (0 rows while no tables exist).

`build/` is git-ignored. The sheet background hexes are for review only, are never shipped, and sit outside the game palette by design. Pass args through npm with `--`, e.g. `npm run assets:sheets -- --atlas world`.

## Scope

- tools/forge/forge/sheets.py (from SSP-011): palette strip and Bessie h00 on every emitted atlas sheet
- `--only` with multiple IDs, writing one only_<id>.png each; a state's frames laid out left to right
- 3x3 tiled preview for every `wrap: true` tile (reuse SSP-040's preview if present)
- 8-slot swap row for assets with `swaps`
- pytest additions: multi-id --only, swap row from a fixture table, 3x3 preview presence, frame order within a state

## Out of scope

- Re-implementing 4x labelled sheets, the backgrounds, --atlas or single-id --only (SSP-011)
- A new label font (Pillow's default bitmap font from SSP-011 is acceptable)
- The in-engine zoo (SSP-298, SSP-118)
- Any automated judgement of art quality

## Acceptance criteria

- [ ] `npm run assets:sheets` writes one PNG per emitted atlas in build/sheets/, and each one, including world, items and ui, shows both background colours, the 32-colour strip and Bessie h00
- [ ] `npm run assets:sheets -- --only tile.asphalt veh.sweeper` writes both build/sheets/only_tile.asphalt.png and build/sheets/only_veh.sweeper.png
- [ ] only_tile.asphalt.png contains a 3x3 tiled preview; pytest asserts that every `wrap: true` manifest entry gets one
- [ ] pytest: an asset with a fixture swap table gets a row with one cell per slot (8 for a full table); an asset without swaps gets none
- [ ] pytest: the frames of one state appear left to right in frame-index order
- [ ] SSP-011's existing sheets tests still pass, and build/sheets/actors.png and world.png were opened with Read with the labels legible

## Verification

- uv run --project tools/forge pytest tools/forge/tests/
- npm run assets:sheets, then Read build/sheets/actors.png and build/sheets/world.png
- npm run assets:sheets -- --only tile.asphalt, then Read build/sheets/only_tile.asphalt.png

## Dependencies

**Depends on:**

- [SSP-113](SSP-113-forge-pack-atlases.md) Lock atlas trimming and the 1 px gutter, cover all five atlases and add the fill-ratio report
- [SSP-011](../M0/SSP-011-forge-lint-sheets.md) Implement minimal forge lint and forge sheets for M0 asset review
- [SSP-008](../M0/SSP-008-blender-bessie.md) Port the probe sweeper onto rig.py and commit Bessie body, dented and brush renders
- [SSP-040](../M1/SSP-040-procedural-tiles.md) Generate placeholder ground tiles and the 47-tile kerb blob set with tiles.py

**Blocks:**

- [SSP-117](SSP-117-forge-verify-ci.md) Extend forge verify to level and M4 outputs, prove assets idempotence, fill forge pytest gaps and add verify + lint to CI
- [SSP-119](SSP-119-tiles-road-surfaces.md) Final procedural road tiles: asphalt, markings, double yellows, zebra, drains, bays
- [SSP-120](SSP-120-tiles-kerb-blob.md) Final 47-tile kerb blob autotile generated by rule
- [SSP-121](SSP-121-tiles-pavement-grass-cobbles.md) Final pavement slabs, grass, cobbles, setts, tactile paving and edge tiles
- [SSP-122](SSP-122-grime-overlays.md) Procedural grime overlay patterns for asphalt, slab and gutter
- [SSP-123](SSP-123-stains-hazards.md) Procedural stain and hazard ground decals for the Mon-Tue set
- [SSP-124](SSP-124-roof-surfaces.md) Final procedural roof surfaces: felt, gravel, slate, corrugated
- [SSP-125](SSP-125-facades-old-town.md) Old Town terrace facade modules and the pledge rosette (Puddle Lane)
- [SSP-127](SSP-127-bessie-final.md) Final Bessie renders: body, dented variant and 96x96 brush overlay
- [SSP-128](SSP-128-traffic-cars.md) Final Blender cars: hatchback, saloon, taxi, white van, parked aliases
- [SSP-129](SSP-129-traffic-bus-bike-scooter.md) Final Blender bus (128x128), bicycle and mobility scooter (32x32)
- [SSP-130](SSP-130-blender-props-flat.md) Blender flat props: bench, planter and the skip
- [SSP-131](SSP-131-blender-props-stacks.md) Blender sprite-stack props: lamp post, phone box, tree, bus shelter, stall
- [SSP-132](SSP-132-roofkit-layout.md) Blender roof kit and the seeded roof-furniture layout script
- [SSP-133](SSP-133-char-doris-pilot.md) Pilot the people pipeline end to end with npc.old_woman (Doris)
- [SSP-139](SSP-139-litter-sheet-01.md) Accept litter.sheet_01, ingest 6 items, hand-draw the can and butts
- [SSP-142](SSP-142-font-kerbside-5x7.md) Finalise Kerbside 5x7 glyphs, metrics and kerning
- [SSP-143](SSP-143-font-kerbside-bold-8x8.md) Write Kerbside Bold 8x8 glyphs, metrics and kerning
- [SSP-144](SSP-144-ui-icons-panels.md) HUD icons, 9-slice panels, button states and complaint stamp grids
- [SSP-146](SSP-146-animal-cat.md) Hand-author the npc.cat grid: walk, sit, dart, leap in 8 directions
- [SSP-147](SSP-147-animals-pigeon-dog.md) Hand-author npc.pigeon and the npc.dog_loose grid with coat swap
- [SSP-148](SSP-148-small-props-grids.md) Hand-author small prop grids, including grid sprite stacks
- [SSP-149](SSP-149-pickups-grids.md) Hand-author power-up and Mon-Tue collectible pickup grids
- [SSP-150](SSP-150-shop-signs.md) High Street shop signs: Codex blank boards plus Kerbside lettering
- [SSP-151](SSP-151-road-decals.md) Road decals for High Street: oil, posters and graffiti via Codex ingest
- [SSP-154](SSP-154-vfx-core.md) Procedural VFX: dust, spray, sparkle, splash, leaf swirl, skid marks
- [SSP-155](SSP-155-vfx-reactions.md) Procedural VFX for reactions and damage: impact star, cough, anger, smoke
- [SSP-193](../M6/SSP-193-workshop-liveries.md) Build WorkshopScene with upgrade purchases and Bessie livery ramp swaps
- [SSP-220](../M6/SSP-220-art-humans-batch-a.md) Art Pass 2: final sprites for npc.jogger, npc.kid_skateboard and npc.kid_chalk
- [SSP-221](../M6/SSP-221-art-humans-batch-b.md) Art Pass 2: final sprites for npc.lollipop_lady, npc.reveller and npc.inspector
- [SSP-270](../M9/SSP-270-desktop-app-icon.md) Author the desktop app icon as a pipeline asset and wire it into Tauri

## References

- ../../ASSET_PIPELINE.md#95-forge-sheets
- ../../ASSET_PIPELINE.md#53-forge-subcommands-full-reference
- ../../ART_BIBLE.md#151-review-procedure
- ../../ART_BIBLE.md#152-the-checklist
- ../../ASSET_PIPELINE.md#113-batch-review-always

## Roadmap tasks covered

- `forge sheets`: 4×, labelled, on light `#c3c1c0` and dark `#24222a`, with a palette strip and Bessie h00 for scale.
