---
id: SSP-051
title: "Author placeholder grids for all 15 litter IDs and add the items atlas"
milestone: M2
status: done
type: asset
estimate: L
labels: [type:asset, area:assets, area:tooling, size:L, vertical-slice]
depends_on: [SSP-009, SSP-011, SSP-026, SSP-039]
blocks: [SSP-052, SSP-053, SSP-067, SSP-115, SSP-139, SSP-223]
---

# SSP-051: Author placeholder grids for all 15 litter IDs and add the items atlas

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** asset · **Size:** L · **Areas:** assets, tooling · **Vertical slice**

## Summary

Write code-defined placeholder text-grid sprites for every `litter.*` ID under their final asset and frame IDs, add them to the manifest, generate the code rotations and pack them into a new `items` atlas, so the sim and renderer can reference typed `FRAME` entries from day one. Real art replaces these in M4 with no code changes.

## Context

IDs (15, ENTITY_CATALOG §2/§4.1): litter.crisp_packet, drink_can, plastic_bottle, glass_bottle, newspaper, cigarette_butts, banana_skin, chip_wrapper, pizza_box, kebab_wrapper, leaf_pile, dog_mess, bin_bag, lolly_stick, spilled_shopping.
Sprite spec (ART_BIBLE §7.1, ENTITY_CATALOG §4): cell 16×16, visible body 8–14 px. States `idle ×1` + `wobble ×2`. Only the `h00` rotation is authored; `forge build` generates `h08`, `h16`, `h24` as exact 90° rotations (ASSET_PIPELINE §6.2), giving 12 frame IDs per item (e.g. `litter.pizza_box:wobble:h08:1`) and 180 litter frame IDs in total.
Grid format (ASSET_PIPELINE §6.2): header `id:`, `cell: 16x16`, `palette: kerbside32`; default key `.` = transparent, `0`–`9` = indices 00–09, `a`–`v` = 10–31; one `frame <state>:<dir>:<n>` block per frame, exactly 16 rows of 16 chars. Files go in `assets-src/sprites/litter/<name>.sprite.txt` (asset ID minus class). The crisp-packet pixel rows in ASSET_PIPELINE §6.2 can be reused, but drop its `origin:` and `ingest_sha256:` header lines: this placeholder is hand-authored (`technique: "grid"`), not ingested.
Shading rules: litter is rotated by code, so it uses top-lit, rotation-symmetric shading only (ink 00 outline, a base, one centred highlight; no NW glint, no darker edge). ASSET_PIPELINE §6.2 says lint flags a litter frame whose 90° rotation changes which edge carries the ramp's darkest step. M0 shipped `forge lint` as minimal, so implement this check (and the ≤ 4 ramp steps check) if it is missing. Wobble frames move the item 1 px or rock one end and never change the outline by more than 2 px (ART_BIBLE §8.4).
Colour guidance, documented (ART_BIBLE §6.2, §8.4): crisp packet 18 base + 16 highlight; drink can capsule with silver ends; plastic bottle longer capsule with 1 px cap; glass bottle 22/21 with a neck; newspaper 07/06 folded rectangle with 03 text lines; banana skin 16/15 star with 08 tips; cigarette butts a cluster of 3–5 butts in 07 with 17 filter tips. Relative size: pizza box 13–14 px > crisp packet 9–10 px > lolly stick 8 px. Suggestions only (not in the docs): pizza box 13 cardboard, dog mess 08, leaf pile 14/11/13, bin bag 01/02. Never use index 15 sweeper_yellow for a large area.
Manifest (`assets-src/manifest.json`, ASSET_PIPELINE §6.1): fields `{ id, class, technique, source, cell, states, dirs, frames, atlas, outline, swaps }`, one entry per ID, sorted by id, `technique: "grid"` (M4 moves most to `ai-ingest` keeping frame IDs; drink_can and cigarette_butts stay grid), `atlas: "items"`, `outline: false` (grids draw their own ink).
Open question: no `dirs` value is defined for the litter rotation set; `"h4"` is documented as h00–h03 (roof kit). Pick a representation that yields the `h00/h08/h16/h24` frame IDs required by ENTITY_CATALOG §1.3 and document it in the ASSET_PIPELINE §6.1 `dirs` row in the same PR.
The `items` atlas (≤ 2048², deterministic maxrects sorted by area then frame id, no rotation, 1 px padding; ASSET_PIPELINE §9.3) is new in M2; M1 delivered at least `world` and `actors`. The M0-imported `assets-src/ai/litter.sheet_01/` candidate is NOT ingested now (M4).

## Scope

- 15 `assets-src/sprites/litter/*.sprite.txt` placeholder grids with frames idle:h00:0, wobble:h00:0 and wobble:h00:1
- Manifest entries for the 15 litter IDs (sorted) and the documented `dirs` value for the rotation set
- Forge build support for generated litter rotations (h08/h16/h24) if M0/M1 did not implement it, with pytest
- `forge lint` rotation-symmetric shading and ramp-step checks if not already present, with pytest
- Add the `items` atlas to `forge/pack.py` and regenerate `public/assets/atlas/items.{png,json}`, `src/gen/assets.ts` and `public/assets/asset-hashes.json`
- Commit sources and generated outputs together

## Out of scope

- Ingesting `litter.sheet_01` or generating new Codex litter sheets (M4)
- Stain, pickup, site or prop sprites (SSP-052)
- Rendering litter in-game (SSP-067)

## Acceptance criteria

- [ ] All 15 litter IDs have a grid file and a manifest entry; manifest stays sorted by id
- [ ] `src/gen/assets.ts` contains exactly 12 litter frame IDs per litter ID (180 total) covering h00, h08, h16, h24, and `AssetId` includes all 15 IDs
- [ ] Each generated h08/h16/h24 frame is a pixel-exact 90°/180°/270° rotation of its h00 frame (pytest)
- [ ] `npm run assets:lint` passes, and a deliberately NW-shaded fixture fails the rotation-symmetry check (pytest)
- [ ] `npm run assets:verify` byte-compares clean after `npm run assets`
- [ ] `build/sheets/items.png` was opened with Read and each item is distinguishable by silhouette at 1×; the PR says what was checked
- [ ] No pixel uses a colour outside Kerbside-32

## Verification

- uv run --project tools/forge pytest tools/forge/tests
- npm run assets
- npm run assets:lint
- npm run assets:verify
- npm run assets:sheets  # then Read build/sheets/items.png
- npm run typecheck
- grep -o '"litter\.[a-z_]*:[a-z]*:h[0-9]*:[0-9]"' src/gen/assets.ts | sort -u | wc -l  # expect 180

## Dependencies

**Depends on:**

- [SSP-009](../M0/SSP-009-forge-build-grid-blender.md) Implement forge build for grid and blender techniques with outline and byte-stable PNGs
- [SSP-011](../M0/SSP-011-forge-lint-sheets.md) Implement minimal forge lint and forge sheets for M0 asset review
- [SSP-026](../M0/SSP-026-style-lock.md) Write assets-src/STYLE.md v1 locking scale, palette and people style; mirror ART_BIBLE
- [SSP-039](../M1/SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end

**Blocks:**

- [SSP-052](SSP-052-placeholder-stains-pickups-sites.md) Add stain generator, grime overlays and pickup/collectible/site/hydrant grids
- [SSP-053](SSP-053-entities-tuning-seed.md) Seed entities.json with litter, stains and pickups; add M2 values to tuning.json
- [SSP-067](SSP-067-items-sprite-batch.md) Render litter, stains and site markers via the items instance batch
- [SSP-115](../M4/SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-139](../M4/SSP-139-litter-sheet-01.md) Accept litter.sheet_01, ingest 6 items, hand-draw the can and butts
- [SSP-223](../M6/SSP-223-art-litter-m6.md) Art Pass 2: final litter sprites for kebab wrapper, leaf pile and lolly stick

## References

- ../../ROADMAP.md#m2-sweeping-core
- ../../ENTITY_CATALOG.md#4-rubbish-litter
- ../../ENTITY_CATALOG.md#13-sprite-and-frame-notation
- ../../ART_BIBLE.md#84-litter
- ../../ART_BIBLE.md#71-size-sheet-locked
- ../../ASSET_PIPELINE.md#62-text-grid-sprite-spritetxt
- ../../ASSET_PIPELINE.md#61-manifest-assets-srcmanifestjson
- ../../ASSET_PIPELINE.md#93-packing-and-outputs
- ../../ASSET_PIPELINE.md#94-forge-lint
- ../../../CLAUDE.md#6-asset-rules

## Roadmap tasks covered

- Placeholder `assets-src/sprites/litter/*.sprite.txt` for all 15 litter IDs (simple shapes in the right palette ramps, 16×16 cells)... (litter part)
- Deliverable: Placeholder grid sprites under the final IDs for every `litter.*` ... that Puddle Lane uses (litter part)
