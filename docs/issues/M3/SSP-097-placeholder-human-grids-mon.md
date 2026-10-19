---
id: SSP-097
title: "Author placeholder grids for the six Monday human NPCs (24\u00d724, 13 frames/dir)"
milestone: M3
status: done
type: asset
estimate: L
labels: [type:asset, area:assets, area:test, size:L, vertical-slice]
depends_on: [SSP-009, SSP-039, SSP-005, SSP-026, SSP-298]
blocks: [SSP-103, SSP-114, SSP-115, SSP-133, SSP-134, SSP-135, SSP-136]
---

# SSP-097: Author placeholder grids for the six Monday human NPCs (24×24, 13 frames/dir)

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** asset · **Size:** L · **Areas:** assets, test · **Vertical slice**

## Summary

Write placeholder text-grid sprites under the final IDs and frame IDs for npc.shopper, npc.old_woman, npc.old_man_frame, npc.mum_pushchair, npc.postie and npc.dog_walker, with every reaction state as frames, so M4 can replace the art without code changes.

## Context

The frozen ID list is in the ROADMAP M3 entity table; this issue does not need entities.json.

Size sheet (ART_BIBLE §7.1–7.2, ENTITY_CATALOG §6):
- Cell 24×24, figure ≤ 18×22 px. Pivot at the bottom-centre of the feet, row 22 (proposed), row 23 clear.
- 8 directions: S, SW, W, NW, N authored; SE, E, NE via `mirror se from sw`, `mirror e from w`, `mirror ne from nw`.
- Frames per direction: walk 4, idle 2, startle 2, fall 3, angry 2 = 13 per direction, 65 authored, 104 frame IDs.
- Frame IDs: `npc.<id>:<state>:<dir>:<n>`, e.g. npc.old_woman:angry:sw:1.
- Builds: adult 22 px tall; elderly (Doris, old man) 18–19 px, hunched. Carried props fit in the cell: trolley, walking frame, pushchair, postie trolley.

Colour keys (ART_BIBLE §7.3): Doris coat 30/31, headscarf 31, handbag 19, trolley 18/25, hair 06. Old man cardigan 13, trousers 03, frame 05/06, flat cap 09. Postie jacket 18/19, hi-vis band 17, trolley 18, post bag 18. Mum coat 20, pushchair 25/03 (pushchair rectangle ahead of her). Dog walker coat 22 (lead drawn at runtime). Shopper primary garment keys 21/22/23, secondary 14/15/16 (≤ 4 px of 15), skin 12 lit / 11 shade, so the 8 outfit swaps work (ART_BIBLE §5.6). Unique characters use slot 0.

Reaction poses read as silhouettes (ART_BIBLE §8.3): startle = arms up, body raised 1 px; fall = horizontal body, legs in the air; angry = fist above head. Rating guard: comic, never injured.

Format (ASSET_PIPELINE §6.2): header `id:`, `cell: 24x24`, `palette: kerbside32`; default key (`.` transparent, 0–9 and a–v = indices 00–31); `frame <state>:<dir>:<n>` blocks. Kerbside-32 only.

Manifest (ASSET_PIPELINE §6.1): technique `grid` for placeholders (final art becomes ai-ingest in M4), `"placeholder": true` (M4's noPlaceholders test removes it per entry), atlas `actors`, states and frames as above, outline false (grids draw their own 1 px ink outline), entries sorted by id. Files: assets-src/sprites/npc/<name>.sprite.txt.

Placeholder quality is fine. A one-off generator script (templated body + props + colour keys) may emit the grids and is reusable for the Tuesday cast; the committed .sprite.txt is the source of truth. forge lint does not check figure bounds, so confirm ≤ 18×22 yourself (script output in the PR).

In-engine review uses the minimal M3 ZooScene (SSP-298): `?test=1&scene=zoo&freeze=1` for the default page, and `&asset=npc.old_woman` (and so on) to see every frame of one asset. The zoo golden belongs to SSP-118 (M4), so there is no zoo golden to update here.

## Scope

- Six .sprite.txt files with all 65 authored frames each, plus mirror lines.
- Manifest entries (sorted) with placeholder: true.
- Run `npm run assets` and commit the regenerated atlases, src/gen/assets.ts and asset-hashes.json.
- Read the contact sheets and the zoo screenshot; note the checks in the PR.

## Out of scope

- Codex key-pose generation and ingest (M4).
- Tuesday cast (SSP-098).
- Animals.

## Acceptance criteria

- [ ] src/gen/assets.ts contains all 104 frame IDs for each of the six IDs, e.g. FRAME['npc.old_woman:fall:nw:2'] and FRAME['npc.shopper:walk:e:3'].
- [ ] `npm run assets:lint` passes (palette, frame counts vs manifest, outlines, sorted manifest) and `npm run assets:verify` passes.
- [ ] Every figure fits within 18×22 px with feet on row 22 (bounds report in the PR).
- [ ] Contact sheets (`npm run assets:sheets -- --only npc.old_woman` etc.) and `?test=1&scene=zoo` were opened with Read; the PR notes that startle, fall and angry silhouettes read at 1× and that Doris and the old man read as hunched.
- [ ] Shopper garments use only keys 21/22/23 and 14/15/16, so swaps apply.
- [ ] `npm run test:visual` passes (existing goldens).

## Verification

- npm run assets
- npm run assets:lint
- npm run assets:verify
- npm run assets:sheets
- npm run typecheck
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-009](../M0/SSP-009-forge-build-grid-blender.md) Implement forge build for grid and blender techniques with outline and byte-stable PNGs
- [SSP-039](../M1/SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end
- [SSP-005](../M0/SSP-005-kerbside32-palette.md) Author kerbside32.json and forge OKLab palette mapping with a shared 4,096-sample fixture
- [SSP-026](../M0/SSP-026-style-lock.md) Write assets-src/STYLE.md v1 locking scale, palette and people style; mirror ART_BIBLE
- [SSP-298](SSP-298-zoo-scene-review.md) Add a minimal test-only ZooScene for in-engine review of actors and items frames

**Blocks:**

- [SSP-103](SSP-103-render-actors-traffic.md) Draw NPCs, animals, traffic, knockables and hazards with state-driven frames
- [SSP-114](../M4/SSP-114-ramp-swap-tables.md) Lock ramp-swap key indices and emit the 8 swap tables per atlas
- [SSP-115](../M4/SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-133](../M4/SSP-133-char-doris-pilot.md) Pilot the people pipeline end to end with npc.old_woman (Doris)
- [SSP-134](../M4/SSP-134-char-shopper.md) Final npc.shopper with 8 outfit swaps
- [SSP-135](../M4/SSP-135-char-old-man-mum.md) Final npc.old_man_frame and npc.mum_pushchair
- [SSP-136](../M4/SSP-136-char-postie-dog-walker.md) Final npc.postie and npc.dog_walker

## References

- ../../ART_BIBLE.md#71-size-sheet-locked
- ../../ART_BIBLE.md#72-human-proportions-2424-cell
- ../../ART_BIBLE.md#73-character-colour-keys
- ../../ART_BIBLE.md#56-ramp-swaps-per-instance-palette-variants
- ../../ART_BIBLE.md#83-people-and-animals
- ../../ASSET_PIPELINE.md#61-manifest-assets-srcmanifestjson
- ../../ASSET_PIPELINE.md#62-text-grid-sprite-spritetxt
- ../../ASSET_PIPELINE.md#94-forge-lint
- ../../ENTITY_CATALOG.md#6-pedestrians-npc-people
- ../../../CLAUDE.md#7-testing-expectations

## Roadmap tasks covered

- `Placeholder grids for all M3 NPCs: 24×24 humans with 13 frames per direction (S, SW, W, NW, N authored; SE, E, NE mirrored) (Monday cast)`
- `Deliverable: Reaction animations: placeholder grids allowed, but every state (walk, idle, startle, fall, angry) exists as frames under the final frame IDs. (Monday cast)`
