---
id: SSP-113
title: "Lock atlas trimming and the 1 px gutter, cover all five atlases and add the fill-ratio report"
milestone: M4
status: todo
type: feature
estimate: M
labels: [type:feature, area:tooling, area:assets, area:render, area:test, size:M, vertical-slice]
depends_on: [SSP-010, SSP-039, SSP-018, SSP-067, SSP-045]
blocks: [SSP-114, SSP-116, SSP-117, SSP-193, SSP-224, SSP-230, SSP-235, SSP-259, SSP-260]
---

# SSP-113: Lock atlas trimming and the 1 px gutter, cover all five atlases and add the fill-ratio report

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** feature · **Size:** M · **Areas:** tooling, assets, render, test · **Vertical slice**

## Summary

Extend the packer from SSP-010, and the world-atlas extrusion from SSP-039, with the rules locked in M4. Frames are trimmed to their opaque bounding box and their pivots remapped. Actor, item and fx frames get a 1 px transparent gutter. Each atlas reports its fill ratio, with a warning above 85% and a hard error past 2048x2048. All five atlases (world, actors, items, ui, fx) build. ART_BIBLE §14.6/§17 and ASSET_PIPELINE §9.3 are brought into line with the locked rule.

## Context

Already done: SSP-010 (M0) built tools/forge/forge/pack.py (deterministic maxrects, inputs sorted by area descending then frame id, no rotation, at most 2048x2048, no empty atlas). It also generates the atlas JSON (`frames` + `swaps`), `src/gen/assets.ts` (FRAME, FrameId, AssetId) and `public/assets/asset-hashes.json`. SSP-039 (M1) added the `world` atlas with 1 px extrusion (duplicated edge pixels) for ground tiles and facade modules; its JSON rect covers the interior only. Do not re-implement any of this.

New in M4 (ART_BIBLE §14.6, ASSET_PIPELINE §9.3):
- Atlases, each at most 2048x2048: `world` (tiles, roofs, facades and stains, plus hazards per ENTITY_CATALOG §10 and the roof kit), `actors` (vehicles, people, animals), `items` (litter, props, pickups), `ui` (HUD, icons, panels, fonts) and `fx` (VFX). An atlas with no frames is still not emitted. fx frames may not arrive until the VFX issues.
- Trimming (proposed; lock it now): trim each frame to its opaque bbox, outline included, before packing. Store the pivot relative to the trimmed rect as `px`,`py` in the atlas JSON. Trimming happens before packing, so the area sort uses the trimmed size. Trimming is what lets 192 Bessie frames, 11 other vehicle types and every pedestrian fit in one 2048 atlas.
- Padding: a 1 px transparent gutter around actor/item/fx frames (2 px between neighbours), so speed-zoom (non-1:1 sampling) never bleeds a neighbour into view. The tile and facade extrusion from SSP-039 stays as is.
- Doc conflict: ASSET_PIPELINE §9.3 says only '1 px padding'. Update it to match the locked ART_BIBLE rule, and remove 'proposed' from ART_BIBLE §14.6/§17.
- Budget: the build reports each atlas's fill ratio. Above 85%, split classes before adding assets. Never exceed 2048: the error is `atlas 'actors' exceeds 2048×2048` (§13.4). A sixth atlas needs an ADR.
- The M4 checklist says `forge pack`, but ASSET_PIPELINE §5.3 has no `pack` subcommand. Packing runs inside `build` via `pack.py`, and `--only` still repacks all atlases. Keep it that way and add no new CLI subcommand.
- Renderer impact: `src/render/spriteBatch.ts` must honour trimmed rects and pivots (TECHNICAL_DESIGN §12.5). The ground and city meshes need no change, because SSP-039's interior-rect contract already keeps sampling inside the extruded border.

## Scope

- tools/forge/forge/pack.py: trim each frame to its opaque bbox (outline included) before sorting; remap px/py to the trimmed rect
- 1 px transparent gutter for actor/item/fx frames (2 px between neighbours); keep SSP-039's tile/facade extrusion
- Per-atlas fill-ratio report with a warning above 85%, and the hard error `atlas '<name>' exceeds 2048×2048`
- Five-atlas routing per the §9.3 table, including `fx` when fx frames exist
- Update src/render/spriteBatch.ts for trimmed rects and pivots
- Lock trimming and padding in ART_BIBLE §14.6 and §17 (remove 'proposed'); bring ASSET_PIPELINE §9.3 into line
- pytest additions in tools/forge/tests/test_pack.py

## Out of scope

- Re-implementing maxrects, the sort rule, atlas JSON, src/gen/assets.ts or asset-hashes.json generation (SSP-010)
- The world atlas and tile/facade extrusion (SSP-039)
- Swap table content (SSP-114)
- Adding a sixth atlas or a `forge pack` subcommand

## Acceptance criteria

- [ ] pytest: a trimmed frame's rect equals its opaque bbox (outline included), and its pivot maps back to the same world position as the untrimmed cell pivot
- [ ] pytest: frames are placed in order of trimmed area descending, then frame id
- [ ] pytest: every actor/item/fx frame has a fully transparent 1 px ring, so opaque pixels of neighbouring frames are at least 2 px apart; SSP-039's tile/facade extrusion test still passes
- [ ] `forge build` prints a fill ratio for every emitted atlas and warns above 85%; a fixture with fx frames emits `fx`; a synthetic overflow fixture fails with `atlas '<name>' exceeds 2048×2048`
- [ ] `npm run typecheck` passes with the regenerated `src/gen/assets.ts`, and `npm run assets && npm run assets && git status --short` prints nothing
- [ ] `npm run test:visual` passes, or the changed goldens (`lean_quadrants`, `scale_1440`) were opened with Read (expected/actual/diff) and re-approved with a stated reason
- [ ] ART_BIBLE §14.6/§17 and ASSET_PIPELINE §9.3 state the same locked rule

## Verification

- uv run --project tools/forge pytest tools/forge/tests/test_pack.py
- npm run assets && npm run assets && git status --short
- npm run typecheck && npm test
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-010](../M0/SSP-010-forge-pack-verify.md) Add deterministic atlas packing, generated assets.ts, asset-hashes.json and forge verify
- [SSP-039](../M1/SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end
- [SSP-018](../M0/SSP-018-sprite-batch.md) Draw Bessie (32 headings) and the pedestrian via instanced sprite batches
- [SSP-067](../M2/SSP-067-items-sprite-batch.md) Render litter, stains and site markers via the items instance batch
- [SSP-045](../M1/SSP-045-render-ground-city.md) Render compiled levels: chunked ground layer and full cityMesh cell merge

**Blocks:**

- [SSP-114](SSP-114-ramp-swap-tables.md) Lock ramp-swap key indices and emit the 8 swap tables per atlas
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-117](SSP-117-forge-verify-ci.md) Extend forge verify to level and M4 outputs, prove assets idempotence, fill forge pytest gaps and add verify + lint to CI
- [SSP-193](../M6/SSP-193-workshop-liveries.md) Build WorkshopScene with upgrade purchases and Bessie livery ramp swaps
- [SSP-224](../M6/SSP-224-art-grids-m6.md) Art Pass 2: seagull, loose dog, remaining collectibles, upgrade icons and small props
- [SSP-230](../M6/SSP-230-art-ui-meta.md) Art Pass 2: final UI art for the Week Map, Workshop and Mercury
- [SSP-235](../M7/SSP-235-settings-scene.md) Build SettingsScene with audio, display, accessibility and assist pages
- [SSP-259](../M8/SSP-259-touch-ui-icons.md) Author 16×16 touch-control icons as text-grid UI sprites
- [SSP-260](../M8/SSP-260-touch-controls-overlay.md) Draw the touch control overlay in internal pixel space via the UI pass

## References

- ../../ASSET_PIPELINE.md#93-packing-and-outputs
- ../../ART_BIBLE.md#146-atlas-packing
- ../../ART_BIBLE.md#17-open-items
- ../../TECHNICAL_DESIGN.md#125-sprites-spritebatchts-spritestackts
- ../../TECHNICAL_DESIGN.md#124-city-mesh-and-ground-citymeshts-groundlayerts

## Roadmap tasks covered

- `forge pack`: all 5 atlases, with the sort rule (area descending, then id).
