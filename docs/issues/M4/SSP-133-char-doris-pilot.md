---
id: SSP-133
title: "Pilot the people pipeline end to end with npc.old_woman (Doris)"
milestone: M4
status: todo
type: asset
estimate: L
labels: [type:asset, area:assets, area:tooling, size:L, vertical-slice]
depends_on: [SSP-110, SSP-115, SSP-116, SSP-118, SSP-014, SSP-012, SSP-097]
blocks: [SSP-134, SSP-135, SSP-136, SSP-137, SSP-138, SSP-158, SSP-240]
---

# SSP-133: Pilot the people pipeline end to end with npc.old_woman (Doris)

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** L · **Areas:** assets, tooling · **Vertical slice**

## Summary

Produce final Doris (`npc.old_woman`, upgrading the M3 placeholder) through the chain Codex key-pose sheet -> ingest -> hand-authored grid. Along the way, settle the reusable people template (prompt, sheet layout, ingest.json, pivot, authoring conventions) that the other eight characters follow.

## Context

Humans (ENTITY_CATALOG §6, ART_BIBLE §7.1-7.3): 24x24 cell, figure <= 18x22 including outline. Doris is elderly and hunched, 18-19 px tall (head 8, torso 6, legs 4-5), width 10, <= 18 with trolley. 8 directions: S, SW, W, NW, N authored, plus `mirror se from sw`, `mirror e from w`, `mirror ne from nw`. States walk 4, idle 2, startle 2, fall 3, angry 2 = 13 per direction, 65 authored, 104 frame IDs (e.g. `npc.old_woman:angry:sw:1`). Colours: coat 30/31, headscarf 31, handbag 19, trolley 18/25 tartan, hair 06, skin 12 lit/11 shade. Signature silhouette: hunch + trolley. Glare: angry frame 0 held, brows down. Shading is top-lit and symmetric (mirror-safe). Pivot: bottom-centre of the feet at row 22 (proposed; lock it here). Reactions read as silhouettes: startle = arms up and body raised 1 px; fall = horizontal body, legs in the air; angry = fist above head. Timings (ART_BIBLE §10.2): walk advances 1 frame per 0.18 m for Doris. Procedure (ASSET_PIPELINE §10.4): write `assets-src/ai/char.old_woman/prompt.md` declaring `References | assets-src/ai/ref.people_style/golden.png`; run `npm run gen:ai -- char.old_woman --candidates 4`; Read `build/ai-candidates/char.old_woman/review.png`; `--accept <n>` and write acceptance_notes; write ingest.json with `target_cell [24,24]` and the target asset `npc.old_woman`; ingest; then fix and author in `assets-src/sprites/npc/old_woman.sprite.txt`. Doc conflict to resolve and record: ASSET_PIPELINE §10.4 asks for a 5x2 sheet (S,SW,W,NW,N x idle, walk contact; grid [5,2]), while ART_BIBLE §14.5 asks for one row per direction with idle, walk contact, startle, fall, angry. The M0 spike may already have ingested `ref.people_style` (the probe old-woman sheet) into a grid. If an edited grid exists it is the truth: do not re-ingest over it (use `--dry-run` to compare; CLAUDE.md rule 9). D-13 (step-down quality) indicates how much repair to expect. `CODEX_MODEL` is pinned to `gpt-6.1-sol` (confirmed by the lead). Record hours spent: ADR 0002 revisit trigger 3 fires if grid authoring of a human type exceeds 2 working days.

## Scope

- Doris prompt.md, generation, acceptance with notes, ingest.json, ingest (or reuse of the M0 grid)
- Author all 65 frames plus mirror lines; fix ingest errors per the ART_BIBLE §14.5 table
- Lock the human pivot row and the key-pose sheet layout; update ASSET_PIPELINE §10.4 and ART_BIBLE §7.2/§14.5
- Write a short people-template section (prompt skeleton, ingest.json example) in ASSET_PIPELINE §10.4
- Sheet + zoo review with `&tick=` stepping; record time spent in the PR

## Out of scope

- Other characters (separate issues)
- Doris behaviour (M3)
- `portrait.doris` (proposed for later)

## Acceptance criteria

- [ ] `assets-src/ai/char.old_woman/` holds prompt.md (stamped with the current preamble version), meta.json with acceptance_notes covering every candidate, and golden.png with a matching golden_sha256
- [ ] `old_woman.sprite.txt` has an `origin:` header, 65 authored frames and 3 mirror lines; the manifest technique is `ai-ingest` with no `placeholder`
- [ ] The figure stays within 18x22 with feet on the locked pivot row in every frame
- [ ] Lint clean (outline, orphans, <= 4 ramp steps)
- [ ] Sheet and zoo opened with Read: the walk cycle does not swim at 10 fps, and reaction poses are distinguishable at 1x (noted in PR)
- [ ] The sheet-layout conflict is resolved in both docs; hours spent are recorded in the PR

## Verification

- npm run gen:ai -- char.old_woman --candidates 4 (local only), then Read build/ai-candidates/char.old_woman/review.png
- npm run assets:ingest -- char.old_woman (or --dry-run if an edited grid exists)
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --only npc.old_woman, then Read build/sheets/only_npc.old_woman.png
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-110](SSP-110-forge-ingest-complete.md) Complete forge ingest: full 10-step pipeline, edit protection, dry-run previews
- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-118](SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-014](../M0/SSP-014-people-style-acceptance.md) Accept ref.people_style and ingest the spike pedestrian grid (D-04, D-13)
- [SSP-012](../M0/SSP-012-genai-codex-wrapper.md) Implement forge gen-ai Codex wrapper with preamble v1 and a concept.spike_street smoke run
- [SSP-097](../M3/SSP-097-placeholder-human-grids-mon.md) Author placeholder grids for the six Monday human NPCs (24×24, 13 frames/dir)

**Blocks:**

- [SSP-134](SSP-134-char-shopper.md) Final npc.shopper with 8 outfit swaps
- [SSP-135](SSP-135-char-old-man-mum.md) Final npc.old_man_frame and npc.mum_pushchair
- [SSP-136](SSP-136-char-postie-dog-walker.md) Final npc.postie and npc.dog_walker
- [SSP-137](SSP-137-char-businessman-litterbug.md) Final npc.businessman and npc.litterbug
- [SSP-138](SSP-138-char-market-trader.md) Final npc.market_trader
- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-240](../M7/SSP-240-juice-squash-popups.md) Juice pass: squash-and-stretch, combo popups and the cat roof-ride

## References

- ../../ASSET_PIPELINE.md#104-human-npc-people-codex--ingest--grid
- ../../ART_BIBLE.md#72-human-proportions-2424-cell
- ../../ART_BIBLE.md#73-character-colour-keys
- ../../ART_BIBLE.md#145-ai-generation-from-the-art-side
- ../../ART_BIBLE.md#102-timing-table
- ../../ENTITY_CATALOG.md#6-pedestrians-npc-people
- ../../adr/0002-ai-authored-asset-pipeline.md#8-revisit-triggers

## Roadmap tasks covered

- Characters: `npc.shopper` (8 outfit swaps), `npc.old_woman`, `npc.old_man_frame`, `npc.mum_pushchair`, `npc.postie`, `npc.dog_walker`, `npc.businessman`, `npc.litterbug`, `npc.market_trader`. Generate a key-pose sheet with `-i assets-src/ai/ref.people_style/golden.png`, ingest it, then hand-author the remaining frames (walk 4, idle 2, startle 2, fall 3, angry 2) in each grid.
