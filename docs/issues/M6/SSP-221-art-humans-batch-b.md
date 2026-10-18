---
id: SSP-221
title: "Art Pass 2: final sprites for npc.lollipop_lady, npc.reveller and npc.inspector"
milestone: M6
status: todo
type: asset
estimate: L
labels: [type:asset, area:assets, size:L]
depends_on: [SSP-211, SSP-213, SSP-214, SSP-014, SSP-110, SSP-115, SSP-116, SSP-117]
blocks: [SSP-233]
---

# SSP-221: Art Pass 2: final sprites for npc.lollipop_lady, npc.reveller and npc.inspector

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** asset · **Size:** L · **Areas:** assets

## Summary

Replace the remaining three placeholder pedestrians with real reference-locked, ingested and animated grids.

## Context

Same technique and review rules as SSP-220 (ASSET_PIPELINE §10.4): a Codex key-pose sheet locked to ref.people_style, then ingest; after that the grid is the truth. Author 65 frames (walk 4, idle 2, startle 2, fall 3, angry 2 over S/SW/W/NW/N) and mirror SE/E/NE, giving 104 frame IDs per character. 24x24 cell, adult build 22 px, figure <= 18x22. Animation mapping (ENTITY §6.2): lollipop_lady idle = sign raised, angry = sign waved, signature silhouette = a disc on a pole (ART_BIBLE §7.2), and the sign must fit inside the cell; reveller walks with a sway; inspector idle = writing on the clipboard, angry = clipboard tap, with clipboard and tiny pencil. Unique characters use swap slot 0 (ART_BIBLE §7.3). Review the contact sheet next to npc.old_woman and Bessie h00, plus the zoo, with Read; PR notes per ASSET_PIPELINE §11.4. Rating guard (PEGI 7): revellers are merry, never aggressive; nobody is injured. No trademarks.

## Scope

- Prompts, goldens, provenance, and ingested and animated grids for the three characters
- Manifest updates; generated outputs; zoo golden re-approval if changed

## Out of scope

- Behaviour changes

## Acceptance criteria

- [ ] Provenance is complete for each character (golden_sha256 matches)
- [ ] Each character has all 104 frame IDs, with figures within 18x22
- [ ] assets:lint and assets:verify pass; npm run assets twice gives zero diff
- [ ] Contact sheet and zoo reviewed with Read and noted in the PR
- [ ] No placeholder: true remains for these IDs

## Verification

- npm run gen:ai -- char.inspector --candidates 4 (local only)
- npm run assets:ingest -- char.inspector
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets (Read build/sheets/actors.png)
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-211](SSP-211-reveller-police.md) Implement npc.reveller, kicking_out, veh.police witness rule and police_parked
- [SSP-213](SSP-213-lollipop-crossing-parade.md) Implement npc.lollipop_lady, site.school_crossing, crossing_patrol and parade
- [SSP-214](SSP-214-inspector.md) Implement npc.inspector and the inspection event with frontage deductions
- [SSP-014](../M0/SSP-014-people-style-acceptance.md) Accept ref.people_style and ingest the spike pedestrian grid (D-04, D-13)
- [SSP-110](../M4/SSP-110-forge-ingest-complete.md) Complete forge ingest: full 10-step pipeline, edit protection, dry-run previews
- [SSP-115](../M4/SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](../M4/SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-117](../M4/SSP-117-forge-verify-ci.md) Extend forge verify to level and M4 outputs, prove assets idempotence, fill forge pytest gaps and add verify + lint to CI

**Blocks:**

- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag

## References

- ../../ASSET_PIPELINE.md#104-human-npc-people-codex--ingest--grid
- ../../ART_BIBLE.md#72-human-proportions-2424-cell
- ../../ART_BIBLE.md#83-people-and-animals
- ../../ART_BIBLE.md#152-the-checklist
- ../../ENTITY_CATALOG.md#62-behaviours

## Roadmap tasks covered

- `All Wed–Sun assets, batched by class, each batch reviewed via contact sheets and the zoo. (humans batch B)`
