---
id: SSP-223
title: "Art Pass 2: final litter sprites for kebab wrapper, leaf pile and lolly stick"
milestone: M6
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, size:M]
depends_on: [SSP-205, SSP-207, SSP-211, SSP-051, SSP-139, SSP-110]
blocks: [SSP-233]
---

# SSP-223: Art Pass 2: final litter sprites for kebab wrapper, leaf pile and lolly stick

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** asset · **Size:** M · **Areas:** assets

## Summary

Turn the Wed-Sun litter items, still on their M2 placeholders, into final sprites through a new Codex litter sheet, ingest and grid touch-up.

## Context

M2 created placeholder grids for all 15 litter IDs; M4 made the Mon-Tue items real (litter.sheet_01 plus the hand-drawn drink can and cigarette butts). Items first used Wed-Sun are likely still placeholders: litter.kebab_wrapper (Sat), litter.leaf_pile (Thu; driven through brush-up it leaves haz.wet_leaves) and litter.lolly_stick (Fri, ice cream van). FIRST audit the manifest and list every litter.* entry still marked placeholder: true, and include any others. Common spec (ENTITY §4): cell 16x16, visible body 8-14 px; frames idle x1 + wobble x2, each in 4 code-generated rotations (h00/h08/h16/h24) = 12 frame IDs per item; atlas items. Technique (ASSET_PIPELINE §10.6): take the next sheet number assets-src/ai/litter.sheet_NN/, write prompt.md with up to 8 items of similar real-world size, run `npm run gen:ai -- litter.sheet_NN --candidates 4`, Read the review, `--accept <n>`, and write ingest.json (grid [4,2], largest_item_px 14). Then `npm run assets:ingest -- litter.sheet_NN`, redraw any item illegible at 16 px by hand in the grid, and author wobble:h00:0..1. Check that no generated rotation reads as a different object and that shading stays rotation-symmetric. A leaf pile is 2 LU and bulky, so its silhouette must read as a heap rather than a single leaf; use the Thursday autumn key (ART_BIBLE §5.5). R-03: pin the Codex CLI version for the batch. No trademarks on wrappers. Review the items contact sheet and the zoo with Read.

## Scope

- Audit of litter.* placeholder entries (listed in the PR)
- Prompt, accepted golden, provenance and ingest.json for the new litter sheet
- Ingested and touched-up grids with wobble frames for each audited item
- Manifest updates removing placeholder flags; generated outputs committed

## Out of scope

- Litter behaviour changes
- Stains (SSP-225)

## Acceptance criteria

- [ ] The sheet has prompt.md, meta.json (golden_sha256 matches) and golden.png
- [ ] Each audited item has all 12 frame IDs with a visible body of 8-14 px
- [ ] No litter.* manifest entry keeps placeholder: true
- [ ] assets:lint and assets:verify pass; npm run assets twice gives zero diff
- [ ] Items contact sheet and zoo reviewed with Read and noted in the PR

## Verification

- npm run gen:ai -- litter.sheet_02 --candidates 4 (local only), then --accept <n>
- npm run assets:ingest -- litter.sheet_02
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets (Read build/sheets/items.png)
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-205](SSP-205-wind-leaves-gusts.md) Implement leaf fall, wet leaves and haz.wind_gust litter drift
- [SSP-207](SSP-207-ice-cream-van.md) Implement veh.ice_cream_van, its parked variant and the vehicle_stop event
- [SSP-211](SSP-211-reveller-police.md) Implement npc.reveller, kicking_out, veh.police witness rule and police_parked
- [SSP-051](../M2/SSP-051-placeholder-litter-sprites.md) Author placeholder grids for all 15 litter IDs and add the items atlas
- [SSP-139](../M4/SSP-139-litter-sheet-01.md) Accept litter.sheet_01, ingest 6 items, hand-draw the can and butts
- [SSP-110](../M4/SSP-110-forge-ingest-complete.md) Complete forge ingest: full 10-step pipeline, edit protection, dry-run previews

**Blocks:**

- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag

## References

- ../../ASSET_PIPELINE.md#106-litter-litter-codex-sheet--ingest--grids
- ../../ASSET_PIPELINE.md#11-golden-review-and-acceptance
- ../../ENTITY_CATALOG.md#41-stats
- ../../ENTITY_CATALOG.md#42-behaviours-and-brush-up-rules
- ../../ART_BIBLE.md#55-district-colour-keys
- ../../ROADMAP.md#51-asset-readiness-by-milestone

## Roadmap tasks covered

- `All Wed–Sun assets, batched by class, each batch reviewed via contact sheets and the zoo. (litter)`
