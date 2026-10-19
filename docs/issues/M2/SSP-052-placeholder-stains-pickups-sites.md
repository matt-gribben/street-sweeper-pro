---
id: SSP-052
title: "Add stain generator, grime overlays and pickup/collectible/site/hydrant grids"
milestone: M2
status: done
type: asset
estimate: L
labels: [type:asset, area:assets, area:tooling, size:L, vertical-slice]
depends_on: [SSP-051, SSP-009, SSP-005, SSP-040, SSP-039]
blocks: [SSP-053, SSP-066, SSP-067, SSP-101, SSP-115, SSP-123, SSP-130, SSP-149, SSP-225]
---

# SSP-052: Add stain generator, grime overlays and pickup/collectible/site/hydrant grids

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** asset · **Size:** L · **Areas:** assets, tooling · **Vertical slice**

## Summary

Create the seeded procedural stain generator with placeholder params for all 5 `stain.*` IDs, placeholder grime overlay patterns for the ground shader, and placeholder grids for the power-up, collectibles, site markers and hydrant that Puddle Lane uses, all under final IDs.

## Context

Stains (ENTITY_CATALOG §5, ART_BIBLE §8.7): stain.gum, stain.milkshake, stain.oil, stain.chalk_art, stain.splat. Cell 32×32, 1–3 variants, technique `procedural`, params in `assets-src/procedural/stains/<name>.json`, generator in `tools/forge/forge/procedural/stains.py`, atlas `world`. Generators are pure functions of `(params, numpy.random.Generator(PCG64(seed)))` returning `uint8` palette-index arrays, never RGB (ASSET_PIPELINE §6.4). No global `random`, no `np.random.*` module functions, no time, no unordered set iteration. numpy + Pillow only.
Looks (placeholder quality is fine, but use these indices): gum scattered 2–3 px 06/05 blobs; milkshake 20 splash with 07 core and a 1 px 13 cup outline; oil 01 pool with 30 and 29 sheen on the NW side; chalk_art 07, 20, 27, 16, 31 child drawings, three variants; splat 08/13 brown splat with radial flecks.
Grime overlay (ART_BIBLE §9.2): a tileable procedural overlay pattern per surface (asphalt, slab, gutter), mostly 08 soot_brown and 13 umber blotches with 01 flecks covering 60–80% of a dirty cell; gutter grime 08 and 01 at about 90% coverage. Contrast target: at least 60% of pixels in a fully dirty cell differ from the clean tile by ≥ 1 ramp step. Open question: no doc names asset IDs for the grime overlay patterns. Propose IDs (e.g. `tile.grime_asphalt`, `tile.grime_slab`, `tile.grime_gutter` in the `world` atlas) and record the choice in ART_BIBLE §9.2 and the manifest in the same PR.
Pickups (ENTITY_CATALOG §12/§13, ART_BIBLE §8.5): cell 16×16, visible 12×12, `bob ×2`, technique `grid`, atlas `items`, files `assets-src/sprites/pickup/<name>.sprite.txt`, each on a 1 px ground halo ring alternating 16/07 with the bob. Puddle Lane uses `pwr.flask_of_tea` (26 flask, 07 cup), `collect.false_teeth` (07/20) and `collect.golden_crisp` (crisp packet in 15/16; the fx sparkle is M3+). ROADMAP §5.1 lists pickups and collectibles as P from M2, and `entities.json` entries for them need a `sprite` AssetId.
Site markers: `site.depot_bay` (2×3 tiles; final visual is procedural bay markings) and `site.skip` (2×1 tiles; final art is a Blender prop, 17 or 22 steel with 01 interior). Neither has a cell size in the locked size sheet; pick footprint-sized placeholders at 16 px/m (e.g. 64×96 and 64×32) and record the choice in the manifest/PR.
Prop: `prop.hydrant` is `grid`, flat, 32×32 cell (props are 32×32 per slice), 18 with 06 cap, atlas `items`. ROADMAP §5.1 lists props as P from M2, and the water refill needs hydrants visible.
Forge pytest must cover generator determinism (build twice, same SHA-256) and palette-only output.

## Scope

- `tools/forge/forge/procedural/stains.py` and 5 params files under `assets-src/procedural/stains/`
- Placeholder grime overlay patterns (asphalt, slab, gutter) produced by the forge, with IDs documented
- Grids for `pwr.flask_of_tea`, `collect.false_teeth`, `collect.golden_crisp`, `prop.hydrant`, and placeholders for `site.depot_bay` and `site.skip`
- Manifest entries, packing into `world`/`items` atlases, regenerated `src/gen/assets.ts` and hashes
- pytest for the stain and grime generators (determinism, palette-only output)

## Out of scope

- The other five `pwr.*` sprites, other `collect.*` sprites and other props (M3/M4)
- VFX sprites such as `fx.spray_mist` or `fx.sparkle` (M3)
- Hazard decals (`haz.*`, M3)

## Acceptance criteria

- [ ] All 5 stain IDs build from procedural params with 1–3 variants each (chalk_art 3) and appear as frames in the `world` atlas
- [ ] Grime overlay patterns exist under documented IDs, recorded in ART_BIBLE §9.2, and a fully dirty cell differs from the clean tile in ≥ 60% of pixels (pytest)
- [ ] `pwr.flask_of_tea`, `collect.false_teeth`, `collect.golden_crisp` each have 2 bob frames; `prop.hydrant`, `site.depot_bay`, `site.skip` have placeholder frames under their final IDs
- [ ] Generator pytest passes; two consecutive builds produce identical SHA-256 for every output
- [ ] `npm run assets:lint` and `npm run assets:verify` pass
- [ ] `build/sheets/world.png` and `build/sheets/items.png` were Read and the PR notes what was checked

## Verification

- uv run --project tools/forge pytest tools/forge/tests
- npm run assets
- npm run assets:lint
- npm run assets:verify
- npm run assets:sheets  # Read build/sheets/world.png and build/sheets/items.png
- npm run typecheck

## Dependencies

**Depends on:**

- [SSP-051](SSP-051-placeholder-litter-sprites.md) Author placeholder grids for all 15 litter IDs and add the items atlas
- [SSP-009](../M0/SSP-009-forge-build-grid-blender.md) Implement forge build for grid and blender techniques with outline and byte-stable PNGs
- [SSP-005](../M0/SSP-005-kerbside32-palette.md) Author kerbside32.json and forge OKLab palette mapping with a shared 4,096-sample fixture
- [SSP-040](../M1/SSP-040-procedural-tiles.md) Generate placeholder ground tiles and the 47-tile kerb blob set with tiles.py
- [SSP-039](../M1/SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end

**Blocks:**

- [SSP-053](SSP-053-entities-tuning-seed.md) Seed entities.json with litter, stains and pickups; add M2 values to tuning.json
- [SSP-066](SSP-066-grime-ground-shader.md) Sample the grime mask in the ground shader with incremental dirty-rect uploads
- [SSP-067](SSP-067-items-sprite-batch.md) Render litter, stains and site markers via the items instance batch
- [SSP-101](../M3/SSP-101-placeholder-props-hazards.md) Add placeholder sprites for knockables, hazards, SSP-096 and High Street props
- [SSP-115](../M4/SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-123](../M4/SSP-123-stains-hazards.md) Procedural stain and hazard ground decals for the Mon-Tue set
- [SSP-130](../M4/SSP-130-blender-props-flat.md) Blender flat props: bench, planter and the skip
- [SSP-149](../M4/SSP-149-pickups-grids.md) Hand-author power-up and Mon-Tue collectible pickup grids
- [SSP-225](../M6/SSP-225-art-world-tiles-m6.md) Art Pass 2: procedural ground tiles, hazard decals and stains for Wed-Sun

## References

- ../../ROADMAP.md#m2-sweeping-core
- ../../ROADMAP.md#51-asset-readiness-by-milestone
- ../../ENTITY_CATALOG.md#5-stains-stain
- ../../ENTITY_CATALOG.md#11-sites-site
- ../../ENTITY_CATALOG.md#12-power-ups-pwr
- ../../ENTITY_CATALOG.md#13-collectibles-collect
- ../../ART_BIBLE.md#87-stains-and-hazards-ground-decals
- ../../ART_BIBLE.md#92-grime-and-the-clean-reveal
- ../../ART_BIBLE.md#85-pickups-and-collectibles
- ../../ART_BIBLE.md#86-props
- ../../ASSET_PIPELINE.md#64-procedural-params-assets-srcproceduraljson
- ../../ASSET_PIPELINE.md#108-ground-tile-roof-surface-stain-or-vfx-procedural
- ../../ASSET_PIPELINE.md#107-small-prop-pickup-or-ui-icon-grids

## Roadmap tasks covered

- Placeholder `assets-src/sprites/litter/*.sprite.txt` for all 15 litter IDs (...), and placeholder `stain.*` procedural params. (stain part)
- Deliverable: Placeholder grid sprites under the final IDs for every ... `stain.*`, `pwr.*` and `site.*` marker that Puddle Lane uses
