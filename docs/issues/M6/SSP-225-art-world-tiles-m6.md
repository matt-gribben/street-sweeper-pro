---
id: SSP-225
title: "Art Pass 2: procedural ground tiles, hazard decals and stains for Wed-Sun"
milestone: M6
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, size:M]
depends_on: [SSP-111, SSP-119, SSP-115, SSP-123, SSP-052, SSP-295]
blocks: [SSP-233]
---

# SSP-225: Art Pass 2: procedural ground tiles, hazard decals and stains for Wed-Sun

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** asset · **Size:** M · **Areas:** assets

## Summary

Generate the ground tile families, ground hazard decals and stains the new districts use that M4 did not already make real.

## Context

Technique (ASSET_PIPELINE §10.8, ART_BIBLE §9.1): procedural Python with seeded PCG64 in tools/forge/forge/procedural/tiles.py, with params in assets-src/procedural/tiles/*.json (stains in assets-src/procedural/stains/*.json). Append variants, never reorder them. Never hand-edit the 47-tile kerb blob; change the kerb_blob.json rules instead. M4 delivered asphalt, lane markings, double yellows, kerbs, slabs, zebra, drains, manholes, grass, cobbles, tactile paving, and the Mon-Tue stains (gum, milkshake, splat). AUDIT the default legend (LEVEL_DESIGN §8.3) and the haz.*/stain.* IDs against the manifest, and make the rest real. Likely candidates: alley setts `;`, yard/gravel `%` (dusty), concrete apron `+`, water `~` (canal, pond, sea), sand `_` (beach), the site.school_crossing zig-zag `k`, depot bay hatching (15/14, the only place 15 appears on the ground in bulk), and hazard decals still on placeholders (haz.oil_slick, haz.pothole, haz.wet_leaves, haz.broken_glass, the haz.open_manhole tile variant; 32x32 ground decals, procedural proposed). Stains (ENTITY §5): stain.oil (Wed/Sun, same tile as haz.oil_slick) and stain.chalk_art (Thu/Sun; drawn by kid_chalk), 32x32 cells, 1-3 variants each, procedural; they still have M2 placeholder params. The audit is against the legend and the catalog, not the levels, so this batch does not wait for district authoring. District colour keys: ART_BIBLE §5.5 (Gasworks greys + 29 teal; Promenade 27 sea / 12 sand; Civic 06/07 stone). Seam rule (forge lint): the wrap-edge difference must not exceed the interior difference. Calmness rule: internal contrast within one ramp step. Read the 3x3 tiled preview that forge sheets draws for every wrap: true tile. chalk_art must be wordless and rating-safe.

## Scope

- Audit of legend ground/feature chars and haz.*/stain.* IDs against the manifest (listed in the PR)
- New or extended procedural params and generators, with pytest for any new generator (seam + determinism)
- Hazard decals still on placeholders
- stain.oil and stain.chalk_art final procedural params
- Generated world atlas committed

## Out of scope

- Facades and roofs
- AI-generated ground tiles (never)

## Acceptance criteria

- [ ] Every default-legend ground and road-feature char maps to a non-placeholder tile
- [ ] No haz.* decal or stain.* entry keeps placeholder: true
- [ ] The forge lint seam check passes for all wrap: true tiles
- [ ] pytest covers any new generator; assets:verify passes
- [ ] 3x3 tiled previews and the world contact sheet reviewed with Read

## Verification

- uv run --project tools/forge pytest tools/forge/tests
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets (Read build/sheets/world.png)
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-111](../M4/SSP-111-forge-build-procedural.md) Harden the procedural technique: generator registry, params validation, fx play frames and a shared seam metric
- [SSP-119](../M4/SSP-119-tiles-road-surfaces.md) Final procedural road tiles: asphalt, markings, double yellows, zebra, drains, bays
- [SSP-115](../M4/SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-123](../M4/SSP-123-stains-hazards.md) Procedural stain and hazard ground decals for the Mon-Tue set
- [SSP-052](../M2/SSP-052-placeholder-stains-pickups-sites.md) Add stain generator, grime overlays and pickup/collectible/site/hydrant grids
- [SSP-295](../M5/SSP-295-vertical-slice-gate.md) Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR

**Blocks:**

- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag

## References

- ../../ASSET_PIPELINE.md#108-ground-tile-roof-surface-stain-or-vfx-procedural
- ../../ART_BIBLE.md#91-ground-tiles
- ../../ART_BIBLE.md#55-district-colour-keys
- ../../LEVEL_DESIGN.md#83-default-legend
- ../../ENTITY_CATALOG.md#10-hazards-haz
- ../../ENTITY_CATALOG.md#5-stains-stain

## Roadmap tasks covered

- `All Wed–Sun assets, batched by class, each batch reviewed via contact sheets and the zoo. (ground tiles, hazard decals, stains)`
