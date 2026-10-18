---
id: SSP-014
title: "Accept ref.people_style and ingest the spike pedestrian grid (D-04, D-13)"
milestone: M0
status: done
type: asset
estimate: M
labels: [type:asset, area:assets, size:M, vertical-slice]
depends_on: [SSP-013, SSP-011, SSP-012]
blocks: [SSP-018, SSP-026, SSP-133, SSP-220, SSP-221]
---

# SSP-014: Accept ref.people_style and ingest the spike pedestrian grid (D-04, D-13)

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** asset · **Size:** M · **Areas:** assets · **Vertical slice**

## Summary

Review the probe old-woman candidate with Read, decide whether to accept it or regenerate through the wrapper, ingest it, and commit the one Codex-derived spike pedestrian as a 24x24 grid in the manifest. Record D-04 (which golden) and D-13 (ingest quality, counting repaired pixels per frame).

## Context

Candidate: assets-src/ai/ref.people_style/golden.png (the probe old_woman_sheet.png: a 4x2 key-pose sheet, 1774x887, magenta background). Known flaw (ADR 0002 E2): the walk frames are not a real cycle and the handbag swaps hands. That is acceptable because the grid holds the animation; only the key poses matter.

Provenance trade-off for D-04. Accepting the probe candidate leaves a retro meta.json: prompt_sha256 null, model inferred rather than pinned. The deliverable asks for a golden "with complete provenance", and VS-5 says every AI golden in use has a complete meta.json. A fresh generation through `forge gen-ai` gives complete provenance at the cost of about 60 s per candidate plus review. State this trade-off and the choice in D-04, and get the lead's sign-off in the PR.

Review criteria:
- ASSET_PIPELINE §11.1 reject list;
- ART_BIBLE §4.4 high three-quarter view (about 60° from the south, face visible S/SW/SE, pivot = feet, no painted floor or shadow);
- §7.2 proportions: elderly hunched 18-19 px tall, head 8 px, body width 10, ≤ 18 with trolley;
- Doris colour key (§7.3): coat 30/31, headscarf 31, handbag 19, trolley 18/25 tartan, hair 06; skin 12 lit / 11 shade;
- signature silhouette: hunch + trolley.

If rejected: write `assets-src/ai/ref.people_style/prompt.md` on preamble v1 and run `npm run gen:ai -- ref.people_style --candidates N`. After 2-3 rejected rounds, revise the prompt rather than looping. Accept with `--accept <n>` plus hand-written acceptance_notes.

Spike pedestrian (decided minimum): asset `npc.old_woman` (a canonical ID), `assets-src/sprites/npc/old_woman.sprite.txt`, ingested from ref.people_style.
- Write `assets-src/ai/ref.people_style/ingest.json` (mode sheet, grid [4,2], target_cell [24,24], largest_item_px about 19, cells mapped to frame IDs after Reading the sheet, unused cells null).
- Commit only the frames the spike needs, at least `idle:s:0`.
- The manifest entry must declare exactly the states/dirs/frames that exist, or the lint shape rule fails, e.g. states [idle], dirs [s], frames {idle:1}. It grows to the full 104-frame set in M3/M4.
- technique ai-ingest, cell [24,24], atlas actors, outline false as in the §6.1 example. The hand-repaired grid must still carry a complete 4-connected 00 outline (lint's outline rule arrives in M4, so check by eye).
- A separate reference-locked Codex character is optional; do not author the full Doris set.

Fix ingest errors in the grid by hand (grids are truth after ingest) and COUNT repaired pixels per frame for D-13. D-13 options: accept the block-mode step-down (~0.7x), or "redraw rate too high, change approach".

Then run `npm run assets`, `assets:lint` and `assets:sheets -- --only npc.old_woman`, and Read the sheet next to Bessie h00. D-04 also says "place it in-engine beside Bessie": record the contact-sheet evidence here, and add the in-engine evidence to D-04 once SSP-018 shows it (SSP-018's PR completes the D-04 evidence line).

## Scope

- Read and judge the candidate; accept (meta.json accepted_index, acceptance_notes) or regenerate via gen:ai
- Write ref.people_style/ingest.json
- Ingest to assets-src/sprites/npc/old_woman.sprite.txt, hand-repair, count repaired pixels per frame
- Add the npc.old_woman manifest entry (only the existing frames); run npm run assets and commit the generated outputs
- Contact sheet review with Read
- Fill in ROADMAP §8 D-04 (contact-sheet evidence; in-engine line pending SSP-018) and D-13

## Out of scope

- Full npc.old_woman animation set (M3/M4)
- Other characters (M4)
- STYLE.md write-up (SSP-026)

## Acceptance criteria

- [x] assets-src/ai/ref.people_style/meta.json has accepted_index set, non-empty acceptance_notes covering the provenance trade-off, and golden_sha256 matching golden.png
- [x] old_woman.sprite.txt exists with origin: ai/ref.people_style#cell=<k> and ingest_sha256: headers; each figure fits ≤ 18x22 inside 24x24 with feet on row 22
- [x] The manifest entry's frames match the grid exactly; `npm run assets:lint` and `npm run assets:verify` pass
- [x] build/sheets/only_npc.old_woman.png was opened with Read, and the PR records what was checked
- [x] ROADMAP §8 D-04 and D-13 have a Decision, Evidence and Date; D-13 cites per-frame repaired-pixel counts

## Verification

- npm run assets:ingest -- ref.people_style --dry-run
- npm run assets:ingest -- ref.people_style
- npm run assets
- npm run assets:lint
- npm run assets:verify
- npm run assets:sheets -- --only npc.old_woman
- Read build/sheets/only_npc.old_woman.png

## Dependencies

**Depends on:**

- [SSP-013](SSP-013-ingest-prototype.md) Prototype forge ingest (steps 1-10) to turn an AI golden into an indexed sprite grid
- [SSP-011](SSP-011-forge-lint-sheets.md) Implement minimal forge lint and forge sheets for M0 asset review
- [SSP-012](SSP-012-genai-codex-wrapper.md) Implement forge gen-ai Codex wrapper with preamble v1 and a concept.spike_street smoke run

**Blocks:**

- [SSP-018](SSP-018-sprite-batch.md) Draw Bessie (32 headings) and the pedestrian via instanced sprite batches
- [SSP-026](SSP-026-style-lock.md) Write assets-src/STYLE.md v1 locking scale, palette and people style; mirror ART_BIBLE
- [SSP-133](../M4/SSP-133-char-doris-pilot.md) Pilot the people pipeline end to end with npc.old_woman (Doris)
- [SSP-220](../M6/SSP-220-art-humans-batch-a.md) Art Pass 2: final sprites for npc.jogger, npc.kid_skateboard and npc.kid_chalk
- [SSP-221](../M6/SSP-221-art-humans-batch-b.md) Art Pass 2: final sprites for npc.lollipop_lady, npc.reveller and npc.inspector

## References

- ../../ROADMAP.md#8-m0-spike-decision-log
- ../../ROADMAP.md#34-acceptance
- ../../ASSET_PIPELINE.md#111-candidate-review-ai
- ../../ASSET_PIPELINE.md#104-human-npc-people-codex--ingest--grid
- ../../ART_BIBLE.md#44-creatures-use-a-high-three-quarter-cheat
- ../../ART_BIBLE.md#72-human-proportions-2424-cell
- ../../ART_BIBLE.md#73-character-colour-keys
- ../../adr/0002-ai-authored-asset-pipeline.md#2-evidence-the-asset-probe-2026-10-18

## Roadmap tasks covered

- Accept `ref.people_style` (from the probe candidate, or regenerate with Codex if it fails review). Open it with Read before accepting.
- `Fill in D-01 to D-13 in §8 ... [D-04, D-13]`
