---
id: SSP-115
title: "Complete forge lint: every rule with a failing fixture, zero warnings on assets"
milestone: M4
status: todo
type: feature
estimate: L
labels: [type:feature, area:tooling, area:assets, area:test, size:L, vertical-slice]
depends_on: [SSP-111, SSP-011, SSP-009, SSP-040, SSP-041, SSP-051, SSP-052, SSP-097, SSP-098, SSP-099, SSP-100, SSP-101]
blocks: [SSP-117, SSP-119, SSP-120, SSP-121, SSP-122, SSP-123, SSP-124, SSP-125, SSP-127, SSP-128, SSP-129, SSP-130, SSP-131, SSP-132, SSP-133, SSP-139, SSP-144, SSP-146, SSP-147, SSP-148, SSP-149, SSP-150, SSP-151, SSP-154, SSP-155, SSP-220, SSP-221, SSP-225, SSP-249, SSP-259, SSP-270]
---

# SSP-115: Complete forge lint: every rule with a failing fixture, zero warnings on assets

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** feature · **Size:** L · **Areas:** tooling, assets, test · **Vertical slice**

## Summary

Implement every `forge lint` rule from ASSET_PIPELINE §9.4, plus litter rotation symmetry and placeholder tracking. Prove each rule with a failing fixture, and make the current asset set pass with zero warnings so lint can join CI.

## Context

Rules (ASSET_PIPELINE §9.4): Palette (a pixel outside Kerbside-32, or semi-transparent). Shape (size or frame count mismatches the manifest, or an empty frame); this is also what enforces 'frame IDs never change when a placeholder is upgraded' (§2). Outline (an actor/prop silhouette edge lacks ink 00 outline, 4-connected, outside the silhouette; with `outline: true` the visible body must be <= cell - 2 px). Orphans (an actor orphan pixel). Seams (tile wrap-edge difference > interior difference; reuse the SSP-111 seam metric). Ramps (> 4 steps of any ramp). ART_BIBLE §5.4/§17 leaves open whether index 00 used as an outline is exempt; decide here and record it. Provenance (AI folder missing meta.json, golden_sha256 mismatch, a shipped asset tracing to a `tool: 'cursor'` golden, or an `ai-ingest` grid missing `origin:` per §6.2). Blender drift (warn 're-render needed' when render.json `script_sha256` != sha256(script bytes + NUL + rig.py bytes), §6.6). Blender snap (the palette snap changed any render pixel). Manifest (unsorted entries, duplicate IDs, unknown class prefix from the CLAUDE.md §5.4 list). Extras: litter frames whose 90-degree rotation changes which edge carries the ramp's darkest step (§6.2), and 'preamble stale (v1 -> v2)' as informational (§12). Classes that are not outlined: tile, roof, facade, stain, haz, fx (ART_BIBLE §6.3). Flags (§5.3): `--only <id>`, `--warn-as-error`. CI passes `--warn-as-error`, which escalates every warning EXCEPT 're-render needed'; that one stays a warning and blocks merge by review rule. Open gap: the `"placeholder": true` marker used by ROADMAP's noPlaceholders check is not in the §6.1 manifest schema. Add it to §6.1 as an optional boolean, validate it, and print a summary of remaining placeholders.

## Scope

- Implement each rule in `tools/forge/forge/lint.py` with a clear per-file, per-frame message
- One failing fixture per rule under `tools/forge/tests/fixtures/` and a pytest asserting the expected failure
- `--warn-as-error` semantics, including the 're-render needed' exception
- Decide and document the index-00 ramp treatment
- Formalise the optional `placeholder` manifest field in ASSET_PIPELINE §6.1, plus a remaining-placeholder summary
- Fix any existing asset that fails, so `npm run assets:lint` is clean with zero warnings

## Out of scope

- Adding lint to CI (SSP-117)
- Art upgrades of placeholder assets beyond what is needed to pass lint

## Acceptance criteria

- [ ] Every §9.4 rule plus litter rotation symmetry has a fixture that makes `forge lint` exit non-zero with the rule named in the output
- [ ] A Cursor-traced golden fixture fails the Provenance rule with a message naming the cursor golden
- [ ] A fixture where `rig.py` changed makes lint warn 're-render needed' for every Blender asset in it
- [ ] pytest: `--warn-as-error` turns a non-drift warning into an error but leaves 're-render needed' as a warning
- [ ] `npm run assets:lint -- --warn-as-error` exits 0 with zero warnings on the committed asset set
- [ ] ART_BIBLE §5.4 and §17 record the index-00 decision; ASSET_PIPELINE §6.1 documents `placeholder`

## Verification

- uv run --project tools/forge pytest tools/forge/tests/
- npm run assets:lint
- npm run assets:lint -- --warn-as-error

## Dependencies

**Depends on:**

- [SSP-111](SSP-111-forge-build-procedural.md) Harden the procedural technique: generator registry, params validation, fx play frames and a shared seam metric
- [SSP-011](../M0/SSP-011-forge-lint-sheets.md) Implement minimal forge lint and forge sheets for M0 asset review
- [SSP-009](../M0/SSP-009-forge-build-grid-blender.md) Implement forge build for grid and blender techniques with outline and byte-stable PNGs
- [SSP-040](../M1/SSP-040-procedural-tiles.md) Generate placeholder ground tiles and the 47-tile kerb blob set with tiles.py
- [SSP-041](../M1/SSP-041-placeholder-facades-roofs.md) Add placeholder facade modules, facade sets and roof surfaces for Puddle Lane
- [SSP-051](../M2/SSP-051-placeholder-litter-sprites.md) Author placeholder grids for all 15 litter IDs and add the items atlas
- [SSP-052](../M2/SSP-052-placeholder-stains-pickups-sites.md) Add stain generator, grime overlays and pickup/collectible/site/hydrant grids
- [SSP-097](../M3/SSP-097-placeholder-human-grids-mon.md) Author placeholder grids for the six Monday human NPCs (24×24, 13 frames/dir)
- [SSP-098](../M3/SSP-098-placeholder-human-grids-tue.md) Author placeholder grids for businessman, litterbug and market trader
- [SSP-099](../M3/SSP-099-placeholder-animal-grids.md) Author placeholder grids for the cat, pigeon and dog (npc.dog_loose grid)
- [SSP-100](../M3/SSP-100-placeholder-vehicle-renders.md) Render placeholder traffic vehicles in Blender as primitive boxes at 32 headings
- [SSP-101](../M3/SSP-101-placeholder-props-hazards.md) Add placeholder sprites for knockables, hazards, SSP-096 and High Street props

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
- [SSP-144](SSP-144-ui-icons-panels.md) HUD icons, 9-slice panels, button states and complaint stamp grids
- [SSP-146](SSP-146-animal-cat.md) Hand-author the npc.cat grid: walk, sit, dart, leap in 8 directions
- [SSP-147](SSP-147-animals-pigeon-dog.md) Hand-author npc.pigeon and the npc.dog_loose grid with coat swap
- [SSP-148](SSP-148-small-props-grids.md) Hand-author small prop grids, including grid sprite stacks
- [SSP-149](SSP-149-pickups-grids.md) Hand-author power-up and Mon-Tue collectible pickup grids
- [SSP-150](SSP-150-shop-signs.md) High Street shop signs: Codex blank boards plus Kerbside lettering
- [SSP-151](SSP-151-road-decals.md) Road decals for High Street: oil, posters and graffiti via Codex ingest
- [SSP-154](SSP-154-vfx-core.md) Procedural VFX: dust, spray, sparkle, splash, leaf swirl, skid marks
- [SSP-155](SSP-155-vfx-reactions.md) Procedural VFX for reactions and damage: impact star, cough, anger, smoke
- [SSP-220](../M6/SSP-220-art-humans-batch-a.md) Art Pass 2: final sprites for npc.jogger, npc.kid_skateboard and npc.kid_chalk
- [SSP-221](../M6/SSP-221-art-humans-batch-b.md) Art Pass 2: final sprites for npc.lollipop_lady, npc.reveller and npc.inspector
- [SSP-225](../M6/SSP-225-art-world-tiles-m6.md) Art Pass 2: procedural ground tiles, hazard decals and stains for Wed-Sun
- [SSP-249](../M7/SSP-249-credits-scene.md) Build CreditsScene with pipeline and tool-version provenance
- [SSP-259](../M8/SSP-259-touch-ui-icons.md) Author 16×16 touch-control icons as text-grid UI sprites
- [SSP-270](../M9/SSP-270-desktop-app-icon.md) Author the desktop app icon as a pipeline asset and wire it into Tauri

## References

- ../../ASSET_PIPELINE.md#94-forge-lint
- ../../ASSET_PIPELINE.md#53-forge-subcommands-full-reference
- ../../ASSET_PIPELINE.md#61-manifest-assets-srcmanifestjson
- ../../ART_BIBLE.md#54-ramp-rules
- ../../ART_BIBLE.md#63-the-outline-rule
- ../../ART_BIBLE.md#17-open-items
- ../../../CLAUDE.md#54-ids-and-naming

## Roadmap tasks covered

- `forge lint`: every rule, each with a failing fixture under `tools/forge/tests/fixtures/`.
