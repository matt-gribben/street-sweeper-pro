---
id: SSP-224
title: "Art Pass 2: seagull, loose dog, remaining collectibles, upgrade icons and small props"
milestone: M6
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, area:ui, size:M]
depends_on: [SSP-200, SSP-193, SSP-187, SSP-009, SSP-113, SSP-145]
blocks: [SSP-230, SSP-233]
---

# SSP-224: Art Pass 2: seagull, loose dog, remaining collectibles, upgrade icons and small props

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** asset · **Size:** M · **Areas:** assets, ui

## Summary

Write the hand-authored text-grid assets Wed-Sun need: the seagull, any missing loose-dog frames, five Lost Property pickups, the upgrade HUD icons and the remaining small props.

## Context

Technique: text grids written directly (ASSET_PIPELINE §10.5, §10.7). npc.seagull: 16x16 cell, body <= 14x10, 4 directions with walk 2 / fly 3 (author S, W, N; mirror E from W) = 20 frame IDs. npc.dog_loose: 20x20, <= 16x18, 8 directions with walk 4 / sit 2 / bark 2 = 64 IDs. The grid exists from M4 for the walker's dog; verify that every frame the loose behaviour needs (bark, roll-over via sit) is final art. Collectibles (ENTITY §13): collect.hard_hat, collect.cat_collar, collect.bucket_and_spade, collect.lost_shoe and collect.mayors_chain, each a 16x16 cell with a 12x12 body and a 2-frame bob, in assets-src/sprites/pickup/ (placeholders added by SSP-187). Upgrade icons: one 16x16 HUD icon per upg.* (9 upgrades; liveries may reuse a swatch icon) in assets-src/sprites/ui/, <= 6 colours, ink outline, 1 px lit NW edge (ART_BIBLE §12.3). Small props still on placeholders for Wed-Sun, e.g. prop.roadworks_barrier (grid proposed, stack render; exact slice counts are TBD (M0 spike), so use the recorded value). Kerbside-32 only. Review on contact sheets and in the zoo with Read, and use hud_specimen for UI icons. Animate the animals at 10 fps in the zoo to check that walk and fly cycles don't swim.

## Scope

- Grids for npc.seagull, missing npc.dog_loose frames, the five collect.* pickups, upgrade icons and remaining Wed-Sun small props
- Manifest updates removing placeholder flags
- Generated outputs; zoo and hud_specimen goldens re-approved if changed

## Out of scope

- Humans, vehicles, litter, Codex assets

## Acceptance criteria

- [ ] Every listed ID has every frame ID required by ENTITY_CATALOG, with no placeholder: true
- [ ] Bodies are within their size-sheet limits (forge lint)
- [ ] assets:lint and assets:verify pass
- [ ] Contact sheets, zoo and hud_specimen reviewed with Read and noted in the PR
- [ ] The Workshop shows the final upgrade icons (screenshot)

## Verification

- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-200](SSP-200-dog-loose-seagull.md) Implement npc.dog_loose chase and npc.seagull chip theft and litter snatching
- [SSP-193](SSP-193-workshop-liveries.md) Build WorkshopScene with upgrade purchases and Bessie livery ramp swaps
- [SSP-187](SSP-187-progression-economy.md) Add districts.json, upgrades.json and pure week progression and £ ledger
- [SSP-009](../M0/SSP-009-forge-build-grid-blender.md) Implement forge build for grid and blender techniques with outline and byte-stable PNGs
- [SSP-113](../M4/SSP-113-forge-pack-atlases.md) Lock atlas trimming and the 1 px gutter, cover all five atlases and add the fill-ratio report
- [SSP-145](../M4/SSP-145-hud-specimen-golden.md) Build the hud_specimen scene and commit its visual golden

**Blocks:**

- [SSP-230](SSP-230-art-ui-meta.md) Art Pass 2: final UI art for the Week Map, Workshop and Mercury
- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag

## References

- ../../ASSET_PIPELINE.md#105-animal-npccat-npcdog_-npcpigeon-npcseagull-grids
- ../../ASSET_PIPELINE.md#107-small-prop-pickup-or-ui-icon-grids
- ../../ART_BIBLE.md#71-size-sheet-locked
- ../../ART_BIBLE.md#123-panels-buttons-and-icons
- ../../ENTITY_CATALOG.md#13-collectibles-collect

## Roadmap tasks covered

- `All Wed–Sun assets, batched by class, each batch reviewed via contact sheets and the zoo. (grids)`
