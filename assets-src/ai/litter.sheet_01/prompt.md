# litter.sheet_01

**Retro note. This is NOT the prompt that was sent.**

| Key | Value |
|---|---|
| Asset IDs | litter.drink_can, litter.banana_skin, litter.glass_bottle, litter.newspaper, litter.crisp_packet, litter.bin_bag, litter.dog_mess, litter.cigarette_butts (candidate, not accepted) |
| Tool | codex |
| Output file | rubbish_sheet.png (in the probe working dir) |
| Aspect | 2:1 |
| References | none (no `-i`) |
| Preamble | none (the probe predates preamble v1) |
| Status | retro-filled on import from the asset probe, 2026-10-18 (SSP-001) |

## Why there is no prompt here

This golden was imported byte-for-byte from the pre-project asset probe (`assets-src/_probe/codex4/rubbish_sheet.png`). The probe ran `codex exec` in a temporary scratch directory that has since been discarded. The prompt was piped on stdin and was not saved anywhere, so the exact text that was sent cannot be recovered. For that reason `meta.json` has `prompt_sha256: null` and `preamble_version: null`.

This file deliberately has no `<!-- forge:send -->` marker. Nothing in it may be sent to an image tool or hashed as a prompt. A regeneration through `forge gen-ai` needs a new prompt written in the ASSET_PIPELINE §8.4 format.

## What is known about the request

These points come from the probe evidence, not from the prompt text:

- ADR 0002 §2.1 records the run as experiment E5: a 4x2 rubbish sheet on a transparent background. Nothing more specific about the wording survives.
- The agent said it was using its image generation skill to make a transparent sprite sheet, then copied the image from `~/.codex/generated_images/` into the working dir. Its only other commands were read-only size and alpha checks (`assets-src/_probe/codex4/events.jsonl`).
- The measured result is in `assets-src/_probe/reports/post_rub.report.json`: pseudo-pixel period 10.81 x 10.87 px and native items about 15-31 px. The cells hold, in reading order, a drink can, banana skin, glass bottle, newspaper, crisp packet, bin bag, dog mess and cigarette butts (see `ingest.json`).

See `meta.json` (`acceptance_notes`) for the full provenance and what is reconstructed.
