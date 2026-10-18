---
id: SSP-220
title: "Art Pass 2: final sprites for npc.jogger, npc.kid_skateboard and npc.kid_chalk"
milestone: M6
status: todo
type: asset
estimate: L
labels: [type:asset, area:assets, size:L]
depends_on: [SSP-199, SSP-014, SSP-012, SSP-110, SSP-115, SSP-116, SSP-118]
blocks: [SSP-233]
---

# SSP-220: Art Pass 2: final sprites for npc.jogger, npc.kid_skateboard and npc.kid_chalk

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** asset · **Size:** L · **Areas:** assets

## Summary

Replace the three placeholder pedestrians with real grids: Codex key poses locked to the style reference, ingested, then animated by hand.

## Context

Technique (ASSET_PIPELINE §2, §10.4; CLAUDE.md §6.3): a Codex key-pose sheet (2:1; 5 columns S/SW/W/NW/N x 2 rows idle/walk contact) generated with -i assets-src/ai/ref.people_style/golden.png. Provenance goes in assets-src/ai/char.<id>/ (prompt.md built on _style_preamble.md, meta.json with seed null, golden.png, acceptance_notes). forge ingest writes assets-src/sprites/npc/<name>.sprite.txt, and from then on the grid is the truth. Author walk 4, idle 2, startle 2, fall 3, angry 2 = 13 frames x 5 authored directions = 65 frames, and mirror SE/E/NE. Cell 24x24, figure <= 18x22, pivot bottom-centre at row 22 (ART_BIBLE §7.2). Builds: jogger = adult, 22 px, signature silhouette mid-stride with wide arms, walk = run cycle; kid_skateboard = child, 16-17 px, <= 16 wide with the skateboard, walk = push cycle, startle = crouch/ollie; kid_chalk = child, idle = drawing, angry = wail. Never re-ingest over an edited grid (--force only when deliberately discarding edits). Codex costs ~60 s per image; after 2-3 rejected rounds, revise the prompt or reference (CLAUDE.md §9; R-03). Review: the forge sheets contact sheet at 4x next to npc.old_woman and Bessie h00, plus the zoo (?test=1&scene=zoo), both opened with Read, with the ART_BIBLE §15.2 checklist noted in the PR (ASSET_PIPELINE §11.4 template). Rating guard: falls are cartoonish and nobody is injured. No trademarks or logos. Remove `placeholder: true` from each manifest entry; frame IDs must not change.

## Scope

- Prompts, accepted goldens and provenance for the three characters
- Ingested and fully animated grids (65 authored frames each)
- Manifest updates (technique ai-ingest, placeholder removed)
- Generated outputs committed; zoo golden re-approved after reading diffs

## Out of scope

- Behaviour changes
- Other characters

## Acceptance criteria

- [ ] Each character has prompt.md, meta.json (golden_sha256 matches) and golden.png
- [ ] Each grid has all 104 frame IDs (65 authored + 39 mirrored) with figures within 18x22
- [ ] npm run assets twice gives zero diff; assets:lint and assets:verify pass
- [ ] Contact sheet and zoo reviewed with Read, with checklist notes in the PR
- [ ] No placeholder: true remains for these three IDs
- [ ] The zoo visual golden passes (re-approved with a reason if it changed)

## Verification

- npm run gen:ai -- char.jogger --candidates 4 (local only), then --accept <n>
- npm run assets:ingest -- char.jogger
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets (Read build/sheets/actors.png)
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-199](SSP-199-people-kids-jogger.md) Implement npc.jogger, npc.kid_skateboard, npc.kid_chalk and school_out/population_wave
- [SSP-014](../M0/SSP-014-people-style-acceptance.md) Accept ref.people_style and ingest the spike pedestrian grid (D-04, D-13)
- [SSP-012](../M0/SSP-012-genai-codex-wrapper.md) Implement forge gen-ai Codex wrapper with preamble v1 and a concept.spike_street smoke run
- [SSP-110](../M4/SSP-110-forge-ingest-complete.md) Complete forge ingest: full 10-step pipeline, edit protection, dry-run previews
- [SSP-115](../M4/SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](../M4/SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-118](../M4/SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review

**Blocks:**

- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag

## References

- ../../ASSET_PIPELINE.md#104-human-npc-people-codex--ingest--grid
- ../../ASSET_PIPELINE.md#11-golden-review-and-acceptance
- ../../ART_BIBLE.md#72-human-proportions-2424-cell
- ../../ART_BIBLE.md#152-the-checklist
- ../../ENTITY_CATALOG.md#62-behaviours
- ../../../CLAUDE.md#63-procedure-adding-or-replacing-an-ai-asset

## Roadmap tasks covered

- `All Wed–Sun assets, batched by class, each batch reviewed via contact sheets and the zoo. (humans batch A)`
