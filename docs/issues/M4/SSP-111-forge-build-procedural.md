---
id: SSP-111
title: "Harden the procedural technique: generator registry, params validation, fx play frames and a shared seam metric"
milestone: M4
status: todo
type: feature
estimate: M
labels: [type:feature, area:tooling, area:assets, area:test, size:M, vertical-slice]
depends_on: [SSP-009, SSP-040, SSP-041]
blocks: [SSP-115, SSP-117, SSP-119, SSP-120, SSP-121, SSP-122, SSP-123, SSP-124, SSP-125, SSP-132, SSP-154, SSP-155, SSP-209, SSP-225, SSP-226]
---

# SSP-111: Harden the procedural technique: generator registry, params validation, fx play frames and a shared seam metric

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** feature · **Size:** M · **Areas:** tooling, assets, test · **Vertical slice**

## Summary

SSP-040 added the forge `procedural` technique (generator dispatch, tiles.asphalt and the other tile generators, seeded variants, seam and variant-append pytest), and SSP-041 added facade assembly with the `lit`/`dark` ramp shift. This issue extends that code without re-creating it. It adds a generator registry over every procedural family, params validation with errors that name the file, fx `play` frame generation, and a seam metric shared with forge lint. It also makes the generator, variant and facade tests exhaustive and resolves the asphalt variant-count conflict. After this, content issues only add generators and params.

## Context

Already done; extend it, do not rewrite it:
- SSP-040 (M1): `procedural` dispatch in forge build.py by `generator`; tools/forge/forge/procedural/tiles.py (asphalt, pavement, the 47-tile kerb blob, lane markings, grass, placeholders); pure generators `f(params, numpy.random.Generator(PCG64(seed)), cell, variant)` that return a uint8 (h, w) array of Kerbside-32 indices; pytest for determinism, the wrap seam rule and variant-append stability. It ships asphalt with 6 variants and flags the doc conflict in its PR.
- SSP-041 (M1): tools/forge/forge/procedural/facades.py and roofs.py, with a ramp-shift pytest. facades.py takes 32x40 base-ramp modules from `assets-src/sprites/facade/*.sprite.txt` and assembles them per `assets-src/procedural/facades/<set>.json`. It derives `lit`/`base`/`dark` by a one-step ramp shift clamped at the ends, and applies the ink 00 and glass 25/27 rules, with the 28 glint on `lit` only.

M4 increments (ASSET_PIPELINE §6.4, §9.2; ART_BIBLE §5.1, §9.4, §11, §14.4):
- Registry: one generator registry keyed by name (e.g. `tiles.asphalt`) over tools/forge/forge/procedural/ (tiles, roofs, facades, stains, fx). An unknown generator name fails the build with the params file path.
- Params: load and validate `assets-src/procedural/{tiles,roofs,facades,stains,fx}/*.json` (`id`, `generator`, `seed`, `cell`, `variants`, `params`). A missing or invalid field fails with a message naming the file and the field.
- fx: for `fx.*`, the frame index n of state `play` takes the place of `variant` (4-8 frames; for loops, the last frame must flow into the first; ART_BIBLE §11). Provide the dispatch and a loop-check helper. The real VFX are SSP-154/155.
- Seam metric: promote SSP-040's seam check (wrap-edge difference <= interior difference) to a shared function that the Seams rule of forge lint (SSP-115) imports.
- These rules are unchanged: no `random`, no `time`, no unordered set iteration, and variant k draws only after variants 0..k-1.
- Ramps for the exhaustive facade test (ART_BIBLE §5.1): neutral 00-07, brick/skin 08-12, yellow 14-16, orange/red 19-18-17, green 21-24, blue 25-28, purple 30-31. Accents 20 and 29 are on no ramp.
- Open conflict to resolve and record: ART_BIBLE §9.1 (which owns the visual rule) gives asphalt 4 variants, while the ASSET_PIPELINE §6.1/§6.4 examples show 6. Prefer the count the M1 placeholder already ships (6, per SSP-040) so frame IDs stay stable, and fix whichever doc loses.

## Scope

- Generator registry over tools/forge/forge/procedural/, replacing SSP-040's ad hoc dispatch; an unknown name is an error naming the params file
- Params loading and validation for all five procedural families, with errors naming the file and the field
- fx `play` frame dispatch (frame index in place of variant) and a loop-check helper
- A shared seam-metric function used by SSP-040's tests and importable by forge lint
- Exhaustive tests: the uint8 0-31 contract and variant-append stability for every registered generator; the facade ramp shift over every ramp
- Resolve the asphalt 4 vs 6 doc conflict

## Out of scope

- Re-implementing the tiles.py, facades.py or roofs.py generators (SSP-040, SSP-041)
- Final art for tiles, roofs, stains, hazards, facades and fx (separate issues)
- Roof furniture layout (`roof_layout.py`, SSP-132)

## Acceptance criteria

- [ ] `forge build` builds every procedural manifest entry through the registry; an unknown generator name fails the build with the params file path in the message
- [ ] A params file missing `seed` fails the build with a message naming that file and the field
- [ ] Two cold builds (`--no-cache --out build/tmp/a` and `build/tmp/b`) produce identical files (`diff -r` is empty)
- [ ] pytest: for every registered generator, adding variant N+1 leaves variants 0..N byte-identical, and the output is dtype uint8 with values in 0-31
- [ ] pytest: a fixture fx generator produces frames `play` 0..n-1 through the registry, and the loop-check helper flags a fixture whose last frame does not flow into the first
- [ ] SSP-040's seam tests call the shared seam-metric function, and forge lint can import that function
- [ ] The facade ramp-shift pytest covers every ramp, clamping at both ends, accents 20/29, and the ink and glass rules
- [ ] The asphalt variant-count conflict (4 vs 6) is resolved, and the losing doc is updated in the same PR

## Verification

- uv run --project tools/forge pytest tools/forge/tests/
- uv run --project tools/forge python -m forge build --no-cache --out build/tmp/a && uv run --project tools/forge python -m forge build --no-cache --out build/tmp/b && diff -r build/tmp/a build/tmp/b
- npm run assets:verify

## Dependencies

**Depends on:**

- [SSP-009](../M0/SSP-009-forge-build-grid-blender.md) Implement forge build for grid and blender techniques with outline and byte-stable PNGs
- [SSP-040](../M1/SSP-040-procedural-tiles.md) Generate placeholder ground tiles and the 47-tile kerb blob set with tiles.py
- [SSP-041](../M1/SSP-041-placeholder-facades-roofs.md) Add placeholder facade modules, facade sets and roof surfaces for Puddle Lane

**Blocks:**

- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-117](SSP-117-forge-verify-ci.md) Extend forge verify to level and M4 outputs, prove assets idempotence, fill forge pytest gaps and add verify + lint to CI
- [SSP-119](SSP-119-tiles-road-surfaces.md) Final procedural road tiles: asphalt, markings, double yellows, zebra, drains, bays
- [SSP-120](SSP-120-tiles-kerb-blob.md) Final 47-tile kerb blob autotile generated by rule
- [SSP-121](SSP-121-tiles-pavement-grass-cobbles.md) Final pavement slabs, grass, cobbles, setts, tactile paving and edge tiles
- [SSP-122](SSP-122-grime-overlays.md) Procedural grime overlay patterns for asphalt, slab and gutter
- [SSP-123](SSP-123-stains-hazards.md) Procedural stain and hazard ground decals for the Mon-Tue set
- [SSP-124](SSP-124-roof-surfaces.md) Final procedural roof surfaces: felt, gravel, slate, corrugated
- [SSP-125](SSP-125-facades-old-town.md) Old Town terrace facade modules and the pledge rosette (Puddle Lane)
- [SSP-132](SSP-132-roofkit-layout.md) Blender roof kit and the seeded roof-furniture layout script
- [SSP-154](SSP-154-vfx-core.md) Procedural VFX: dust, spray, sparkle, splash, leaf swirl, skid marks
- [SSP-155](SSP-155-vfx-reactions.md) Procedural VFX for reactions and damage: impact star, cough, anger, smoke
- [SSP-209](../M6/SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-225](../M6/SSP-225-art-world-tiles-m6.md) Art Pass 2: procedural ground tiles, hazard decals and stains for Wed-Sun
- [SSP-226](../M6/SSP-226-art-facades-m6.md) Art Pass 2: facade module sets for every remaining building style

## References

- ../../ASSET_PIPELINE.md#64-procedural-params-assets-srcproceduraljson
- ../../ASSET_PIPELINE.md#92-forge-build-per-technique
- ../../ASSET_PIPELINE.md#109-facade-module-grid--procedural-assembly
- ../../ART_BIBLE.md#94-facades
- ../../ART_BIBLE.md#144-naming-conventions
- ../../ART_BIBLE.md#91-ground-tiles

## Roadmap tasks covered

- `forge build`: `procedural` (tiles, roofs, facades, stains, fx frame generators), `ai-art` (crop, pixelize at the detected period, palette map, optional 4×4 Bayer), swaps (up to 8 per atlas).
