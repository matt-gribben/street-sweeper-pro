# Asset probe artefacts (2026-10-18)

Copied from the pre-project asset probe, which ran in a temporary scratch directory that has since been discarded. Raw Codex logs (`events.jsonl`, `last_message.txt`) are kept verbatim for provenance, so they still mention the original temporary paths.
This folder is git-tracked but is **not** an asset source: it is excluded from `assets-src/manifest.json` and from `forge lint`.
M0 imports these files to their final homes (see docs/ROADMAP.md, M0 "Probe import", and docs/ASSET_PIPELINE.md §3).

| File | Imported to (M0) |
|---|---|
| `blender/sweeper_v2.py` | `assets-src/blender/vehicles/sweeper.py` (refactored onto `rig.py`) |
| `tools/pixelize.py` | `tools/forge/forge/pixelize.py` |
| `codex/old_woman_sheet.png` (+ `events.jsonl`, `last_message.txt`) | candidate `assets-src/ai/ref.people_style/golden.png`; rejected in SSP-014 (ROADMAP §8 D-04) and replaced by a fresh `forge gen-ai` golden with complete provenance |
| `codex4/rubbish_sheet.png` (+ `events.jsonl`, `last_message.txt`) | candidate `assets-src/ai/litter.sheet_01/golden.png` |
| `reports/*.report.json` | evidence for ADR 0002 (pixel periods, native sizes) |
| `view_mockscene.png` (+ `tools/mockscene.py`) | evidence only: Blender sweepers, Codex characters and litter composited on one fixed palette |
