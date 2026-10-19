---
id: SSP-041
title: "Add placeholder facade modules, facade sets and roof surfaces for Puddle Lane"
milestone: M1
status: done
type: asset
estimate: M
labels: [type:asset, area:assets, area:tooling, area:test, size:M, vertical-slice]
depends_on: [SSP-039, SSP-009, SSP-005, SSP-026]
blocks: [SSP-042, SSP-045, SSP-105, SSP-111, SSP-115, SSP-124, SSP-125, SSP-197, SSP-204]
---

# SSP-041: Add placeholder facade modules, facade sets and roof surfaces for Puddle Lane

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** asset · **Size:** M · **Areas:** assets, tooling, test · **Vertical slice**

## Summary

Author simple 32×40 base-ramp facade module grids and the procedural facade sets that Puddle Lane references, with the forge deriving `lit` and `dark` variants by ramp shift. Add placeholder procedural roof surfaces under their final IDs, so cityMesh can texture every Puddle Lane building.

## Context

Facades (ART_BIBLE §9.4, ASSET_PIPELINE §10.9):
- A module is 32×40 px (2 m × 1 storey), drawn in base ramp values only, in `assets-src/sprites/facade/<name>.sprite.txt`, using the text-grid format and default key (ASSET_PIPELINE §6.2).
- Typical set (*proposed*): plain brick, sash window, bay window, terrace door, shopfront (2 modules wide), drainpipe overlay, ground-floor band, gable end. A minimal subset is fine.
- Sets go in `assets-src/procedural/facades/<set>.json`.
- The forge derives `lit` (N/W faces) and `dark` (E/S faces) by shifting each index one step along its ramp, clamped at the ramp ends (ART_BIBLE §5.4). Ink 00 and glass 25/27 have special rules: glass gains a 28 glint on `lit` only. Frame states are `lit`, `base`, `dark` (ART_BIBLE §14.4; other docs write `_lit/_base/_dark`).
- Readability rules worth following even at placeholder quality: bold 25 windows at least 8×12 px with 06/07 frames, a horizontal band per storey, sparse 1 px 09 mortar at 4 px spacing.

Facade set IDs Puddle Lane uses (LEVEL_DESIGN §8.5): `facade.terrace_brick`, `facade.terrace_brick_bay`, `facade.parade_brick`, `facade.corner_shop`, `facade.flats_render`. The depot building uses `facade.depot_shed` with `roof.depot` (`landmark: true`, 2 storeys), as in the LEVEL_DESIGN §8.6 Depot Yard example.

Roofs (ART_BIBLE §9.5; ROADMAP §5.1 marks roof surfaces P in M1), params in `assets-src/procedural/roofs/*.json`, generator `tools/forge/forge/procedural/roofs.py`:
- `roof.slate`: 02/03 courses every 4 px, 25 tint on the lit slope
- `roof.felt`: 01/02 with 03 patches
- `roof.depot` is a landmark roof (Codex golden → ingest later) but needs a procedural placeholder now under its final ID ('placeholder first, behind final IDs'; only the manifest technique changes later)
- Roof textures are 16 px/m and align to the tile grid
- Roof furniture (Blender roofkit) is not needed in M1

OPEN: the manifest ID scheme for individual modules versus sets is not specified. Proposal: sets are the asset IDs that level.json references, and modules are source grids assembled into set frames. Document the frame layout that cityMesh maps with world-metre UVs (2 m × 2.5 m per module) in the manifest entry and ASSET_PIPELINE §10.9.

End steps: build, `npm run assets:lint`, `npm run assets:sheets`, Read `build/sheets/world.png`, review in the asset zoo if ZooScene exists, and check `lean_quadrants` (ASSET_PIPELINE §10.9 step 3).

## Scope

- A minimal module grid set in assets-src/sprites/facade/ (base ramp only)
- tools/forge/forge/procedural/facades.py: set assembly plus lit/dark ramp shift with the ink/glass rules
- assets-src/procedural/facades/*.json for the 5 Puddle Lane sets plus facade.depot_shed
- tools/forge/forge/procedural/roofs.py and assets-src/procedural/roofs/*.json: roof.slate, roof.felt, roof.depot placeholders
- Manifest entries (sorted), world atlas output, pytest for ramp-shift correctness and determinism
- Documented facade frame layout contract

## Out of scope

- Real facades (M4), shop signs (Codex, M4)
- Roof furniture / roofkit layout (M4)
- Pledge rosette modules (M2+ with frontages)

## Acceptance criteria

- [ ] Each facade set produces lit, base and dark frames, and pytest checks that every non-ink, non-glass index moves exactly one ramp step (clamped) and glass gains the 28 glint only on lit
- [ ] roof.slate, roof.felt and roof.depot exist in the manifest and world atlas
- [ ] facade.terrace_brick, facade.terrace_brick_bay, facade.parade_brick, facade.corner_shop, facade.flats_render and facade.depot_shed exist in the sorted manifest
- [ ] forge lint passes; a second forge build leaves `git status --short` empty
- [ ] lean_quadrants and scale_1440 goldens pass (or changes are Read and explained per the done checklist)
- [ ] The world contact sheet was opened with Read and a check note is in the PR

## Verification

- uv run --project tools/forge pytest
- uv run --project tools/forge python -m forge build && git status --short  (run twice)
- npm run assets:lint
- npm run assets:sheets  (then Read build/sheets/world.png)
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-039](SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end
- [SSP-009](../M0/SSP-009-forge-build-grid-blender.md) Implement forge build for grid and blender techniques with outline and byte-stable PNGs
- [SSP-005](../M0/SSP-005-kerbside32-palette.md) Author kerbside32.json and forge OKLab palette mapping with a shared 4,096-sample fixture
- [SSP-026](../M0/SSP-026-style-lock.md) Write assets-src/STYLE.md v1 locking scale, palette and people style; mirror ART_BIBLE

**Blocks:**

- [SSP-042](SSP-042-puddle-lane-level.md) Author Puddle Lane map.txt and level.json (64×48) and commit compiled output
- [SSP-045](SSP-045-render-ground-city.md) Render compiled levels: chunked ground layer and full cityMesh cell merge
- [SSP-105](../M3/SSP-105-high-street-greybox.md) Author and compile the grey-box High Street (80×60) for Tuesday's NPCs
- [SSP-111](../M4/SSP-111-forge-build-procedural.md) Harden the procedural technique: generator registry, params validation, fx play frames and a shared seam metric
- [SSP-115](../M4/SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-124](../M4/SSP-124-roof-surfaces.md) Final procedural roof surfaces: felt, gravel, slate, corrugated
- [SSP-125](../M4/SSP-125-facades-old-town.md) Old Town terrace facade modules and the pledge rosette (Puddle Lane)
- [SSP-197](../M6/SSP-197-depot-yard-level.md) Author and compile district.depot_yard with all seven Skip Run variants
- [SSP-204](../M6/SSP-204-district-gasworks.md) Author and compile district.gasworks (Wednesday, rain) with its district replay

## References

- ../../ART_BIBLE.md#94-facades
- ../../ART_BIBLE.md#95-roofs
- ../../ART_BIBLE.md#54-ramp-rules
- ../../ART_BIBLE.md#144-naming-conventions
- ../../ASSET_PIPELINE.md#109-facade-module-grid--procedural-assembly
- ../../ASSET_PIPELINE.md#62-text-grid-sprite-spritetxt
- ../../LEVEL_DESIGN.md#85-worked-example-1-a-puddle-lane-excerpt
- ../../LEVEL_DESIGN.md#86-worked-example-2-the-depot-yard-complete
- ../../ROADMAP.md#51-asset-readiness-by-milestone

## Roadmap tasks covered

- `assets-src/procedural/facades/*.json` and simple `assets-src/sprites/facade/*.sprite.txt` modules (32×40) with `_lit`/`_base`/`_dark` variants.
- `Deliverable: procedural placeholder facades (and placeholder roof surfaces per §5.1 readiness)`
