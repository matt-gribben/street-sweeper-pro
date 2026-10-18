---
id: SSP-001
title: "Import probe Codex sheets as AI golden candidates with retro-filled meta.json"
milestone: M0
status: todo
type: chore
estimate: S
labels: [type:chore, area:assets, area:tooling, size:S, vertical-slice]
depends_on: []
blocks: [SSP-011, SSP-013, SSP-110, SSP-139]
---

# SSP-001: Import probe Codex sheets as AI golden candidates with retro-filled meta.json

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** chore · **Size:** S · **Areas:** assets, tooling · **Vertical slice**

## Summary

This is the first M0 task (R-06). Copy the two probe Codex sheets byte-for-byte into their final AI asset folders as golden candidates. Fill in provenance after the fact from the probe evidence, so later issues work from git-tracked sources. Accepting ref.people_style happens later (SSP-014).

## Context

Source: `assets-src/_probe/` (git-tracked since e66882f, excluded from the manifest and from lint, and kept as evidence). Its README maps each artefact to its destination.

Verified facts (checked during review on 2026-10-18):
- `assets-src/_probe/codex/old_woman_sheet.png`: 1774x887, 8-bit RGB (no alpha). Magenta key about rgb(250,5,249), not #ff00ff. Pseudo-pixel period 9.22 x 9.38 px. Native cells 22-27 x 28-34 px (reports/post.report.json). SHA-256 `45867af714be82dbd0bf9a0c9109ffb08730bf7097e56b7ea2157fc56cc4d765`.
- Its original Codex output (from the `cp` command in events.jsonl): `~/.codex/generated_images/01a14d13-72ab-72a1-9953-765c8a00398c/exec-57353b28-3d78-4c16-bc3f-88a214cf3726.png`. That file still exists on the dev Mac with an identical SHA-256. Thread id `01a14d13-72ab-72a1-9953-765c8a00398c`.
- `assets-src/_probe/codex4/rubbish_sheet.png`: 1774x887 RGBA. Body alpha about 253, with an alpha=1 haze around items. Period 10.81 x 10.87 px. SHA-256 `b5a46c6f609e106413a2e4546eb79ff7b106aa7c491a7d265b2e6723f36e5d1f`.
- Its original output: `~/.codex/generated_images/01a14d18-bb2c-7673-8334-e18b37c30684/exec-0854cf1c-5437-4cc5-be76-9d46bbbab4fe.png` (identical SHA-256). Thread `01a14d18-bb2c-7673-8334-e18b37c30684`.
- `last_message.txt` only shows the agent's copy under the discarded scratchpad. Use the generated_images path above as `original_output_path`, written in `~/` form as in the ASSET_PIPELINE §6.5 example.

meta.json schema (ASSET_PIPELINE §6.5, fixed): `{ id, tool, tool_version, model, date, argv, prompt_sha256, preamble_version, reference_images:[{path,sha256}], original_output_path, candidates_generated, accepted_index, acceptance_notes, golden_sha256, size:[w,h], seed:null }`.
- Values the ROADMAP requires: `tool_version: "codex-cli 0.160.1"`, `seed: null`, `golden_sha256`.
- Other known values: `tool: "codex"`, `date: "2026-10-18"`, `size: [1774, 887]`, `reference_images: []` (neither probe run used `-i`).

Model: the probe did NOT pass `-m`, so the model came from `~/.codex/config.toml`. That file sets `model = "gpt-6.1-sol"` and was last modified on 2026-10-06, before the probe. Record it labelled as inferred: `"gpt-6.1-sol (NOT pinned: probe ran without -m; inferred from ~/.codex/config.toml, unchanged since 2026-10-06); image model: Codex built-in image_gen, version not exposed"`. The lead has confirmed gpt-6.1-sol as CODEX_MODEL for future runs.

Fields that cannot be reconstructed (the lead does not know them either: the probe was run by Claude in a discarded scratchpad):
- The prompts were piped on stdin and not preserved, and the probe predates preamble v1. Set `prompt_sha256: null` and `preamble_version: null`.
- Set `argv` to the documented probe shape, without `-m` and with no `-i`, as a list prefixed by a marker string such as `"RECONSTRUCTED"`, or set it to null. Say which in acceptance_notes.
- Each folder gets a `prompt.md` stating plainly that it is a retro note and not the text that was sent. It must contain no trademark: ipHygiene scans it. Do not paste the illustrative ADR 0002 §4.1 prompt as if it were the real one.
- Set `candidates_generated: 1` and `accepted_index: null`; both stay candidates here. acceptance_notes points to `assets-src/_probe/<run>/events.jsonl` and `reports/*.report.json` as evidence.
- Do not copy events.jsonl into `refs/`: refs/ is for `-i` reference images only.

`assets-src/ai/litter.sheet_01/ingest.json` uses the §6.5 shape: mode sheet, grid [4,2], frame `idle:h00:0`, target_cell [16,16], largest_item_px 14, period_override null. Cells in reading order: litter.drink_can, litter.banana_skin, litter.glass_bottle, litter.newspaper, litter.crisp_packet, litter.bin_bag, litter.dog_mess, litter.cigarette_butts. Note: ENTITY_CATALOG makes drink_can and cigarette_butts **grid** technique (hand-tuned in M4, because the AI versions were illegible at 12 px). Mention this in acceptance_notes.

No manifest entries: litter.sheet_01 stays a candidate through M0.

## Scope

- Copy old_woman_sheet.png to assets-src/ai/ref.people_style/golden.png, byte-identical (cp, never re-encode)
- Copy rubbish_sheet.png to assets-src/ai/litter.sheet_01/golden.png, byte-identical
- Write a retro-filled meta.json in each folder with the values above; compute golden_sha256 from the copied bytes
- Write a retro prompt.md in each folder stating that the original prompt was not preserved
- Write assets-src/ai/litter.sheet_01/ingest.json with the 8-cell mapping
- Leave assets-src/_probe/ untouched

## Out of scope

- Accepting ref.people_style (SSP-014)
- ref.people_style ingest.json (SSP-014)
- Ingesting either sheet
- manifest.json entries
- Any Codex regeneration

## Acceptance criteria

- [ ] `shasum -a 256 assets-src/ai/ref.people_style/golden.png` = 45867af714be82dbd0bf9a0c9109ffb08730bf7097e56b7ea2157fc56cc4d765 = meta.json golden_sha256
- [ ] `shasum -a 256 assets-src/ai/litter.sheet_01/golden.png` = b5a46c6f609e106413a2e4546eb79ff7b106aa7c491a7d265b2e6723f36e5d1f = meta.json golden_sha256
- [ ] Both meta.json files are valid JSON with all 17 schema keys present, tool "codex", tool_version "codex-cli 0.160.1", seed null, size [1774, 887]
- [ ] original_output_path is the ~/.codex/generated_images/<thread-id>/exec-*.png path for each run
- [ ] model is explicitly labelled as not pinned and inferred; prompt_sha256 and preamble_version are null; argv is marked reconstructed or null. No field is fabricated
- [ ] Both prompt.md files say they are retro notes and contain no trademark terms
- [ ] litter.sheet_01/ingest.json lists exactly the 8 canonical litter IDs in reading order
- [ ] `git status --short assets-src/_probe` shows no changes

## Verification

- shasum -a 256 assets-src/_probe/codex/old_woman_sheet.png assets-src/ai/ref.people_style/golden.png
- shasum -a 256 assets-src/_probe/codex4/rubbish_sheet.png assets-src/ai/litter.sheet_01/golden.png
- python3 -c "import json;[json.load(open(p)) for p in ['assets-src/ai/ref.people_style/meta.json','assets-src/ai/litter.sheet_01/meta.json','assets-src/ai/litter.sheet_01/ingest.json']]"
- grep -rniE 'gta|grand theft|paperboy' assets-src/ai (expect no output)
- git status --short assets-src/_probe (expect no output)
- Read both golden.png files with the Read tool

## Dependencies

**Depends on:**

_None._

**Blocks:**

- [SSP-011](SSP-011-forge-lint-sheets.md) Implement minimal forge lint and forge sheets for M0 asset review
- [SSP-013](SSP-013-ingest-prototype.md) Prototype forge ingest (steps 1-10) to turn an AI golden into an indexed sprite grid
- [SSP-110](../M4/SSP-110-forge-ingest-complete.md) Complete forge ingest: full 10-step pipeline, edit protection, dry-run previews
- [SSP-139](../M4/SSP-139-litter-sheet-01.md) Accept litter.sheet_01, ingest 6 items, hand-draw the can and butts

## References

- ../../ROADMAP.md#m0-foundations--look-spike
- ../../ROADMAP.md#6-risk-register
- ../../ASSET_PIPELINE.md#65-ai-asset-folder-assets-srcaiasset-id
- ../../adr/0002-ai-authored-asset-pipeline.md#2-evidence-the-asset-probe-2026-10-18
- ../../adr/0002-ai-authored-asset-pipeline.md#41-what-each-ai-asset-folder-records
- ../../adr/0002-ai-authored-asset-pipeline.md#9-implementation-notes-m0-to-m4
- ../../../assets-src/_probe/README.md

## Roadmap tasks covered

- Copy `assets-src/_probe/codex/old_woman_sheet.png` → candidate for `assets-src/ai/ref.people_style/golden.png`, with a retro-filled `meta.json` (`tool_version: "codex-cli 0.160.1"`, `seed: null`, `golden_sha256`).
- Copy `assets-src/_probe/codex4/rubbish_sheet.png` → candidate for `assets-src/ai/litter.sheet_01/golden.png`, with a retro-filled `meta.json`.
