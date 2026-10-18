# ref.people_style

**Retro note. This is NOT the prompt that was sent.**

| Key | Value |
|---|---|
| Asset IDs | ref.people_style (candidate, not accepted) |
| Tool | codex |
| Output file | old_woman_sheet.png (in the probe working dir) |
| Aspect | 2:1 |
| References | none (no `-i`) |
| Preamble | none (the probe predates preamble v1) |
| Status | retro-filled on import from the asset probe, 2026-10-18 (SSP-001) |

## Why there is no prompt here

This golden was imported byte-for-byte from the pre-project asset probe (`assets-src/_probe/codex/old_woman_sheet.png`). The probe ran `codex exec` in a temporary scratch directory that has since been discarded. The prompt was piped on stdin and was not saved anywhere, so the exact text that was sent cannot be recovered. For that reason `meta.json` has `prompt_sha256: null` and `preamble_version: null`.

This file deliberately has no `<!-- forge:send -->` marker. Nothing in it may be sent to an image tool or hashed as a prompt. A fresh generation through `forge gen-ai` needs a new prompt written in the ASSET_PIPELINE §8.4 format.

## What is known about the request

These points come from the probe evidence, not from the prompt text:

- ADR 0002 §2.1 records the run as experiment E2: an old-woman 4x2 key-pose sheet on a magenta background. Nothing more specific about the wording survives.
- The agent said it was using its image generation skill, then copied the image from `~/.codex/generated_images/` into the working dir and drew nothing with code (`assets-src/_probe/codex/events.jsonl`).
- The measured result is in `assets-src/_probe/reports/post.report.json`: pseudo-pixel period 9.22 x 9.38 px, native cells about 22-27 x 28-34 px, and a key colour of about rgb(250,5,249) rather than pure magenta.

See `meta.json` (`acceptance_notes`) for the full provenance and what is reconstructed.
