---
id: SSP-011
title: "Implement minimal forge lint and forge sheets for M0 asset review"
milestone: M0
status: done
type: feature
estimate: M
labels: [type:feature, area:tooling, area:assets, area:test, size:M, vertical-slice]
depends_on: [SSP-010, SSP-001]
blocks: [SSP-014, SSP-027, SSP-039, SSP-040, SSP-051, SSP-115, SSP-116]
---

# SSP-011: Implement minimal forge lint and forge sheets for M0 asset review

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** feature · **Size:** M · **Areas:** tooling, assets, test · **Vertical slice**

## Summary

Provide the M0 subset of `forge lint` (palette, shape, manifest, provenance, Blender drift/snap) and `forge sheets` (labelled 4x contact sheets). Assets can then be reviewed with Read, and `npm run assets:lint` can pass in `npm run ci`.

## Context

Minimal lint (M0 subset of ASSET_PIPELINE §9.4; the full set lands in M4):
- Palette: any pixel off Kerbside-32, or semi-transparent.
- Shape: size or frame count mismatching the manifest, or an empty frame.
- Manifest: entries unsorted, duplicate IDs, or an unknown class prefix. Classes: veh npc litter stain prop haz pwr collect upg site tile roof facade fx ui font art portrait decal sign concept ref sfx mus jng amb.
- Provenance: an AI folder missing meta.json, or golden_sha256 ≠ the file. It must accept the retro probe form (null prompt_sha256/preamble_version) for ref.people_style and litter.sheet_01; prefer a generic rule (a null prompt_sha256 is allowed only when acceptance_notes say 'retro') over hard-coding folder names. For ai-ingest entries, the grid's `origin:` header must point at a hash-valid folder.
- Blender drift: render.json script_sha256 ≠ the current script + rig → WARN "re-render needed".
- Blender snap: the palette snap changed a pixel (count from SSP-009).

Exclude assets-src/_probe/. Flags: `--only <id>...` and `--warn-as-error` (CI later passes it, except for the re-render warning, §5.3). Outline, orphans, seams, ramp steps and Cursor provenance are M4.

Minimal sheets (§9.5):
- `build/sheets/<atlas>.png` at 4x, every frame labelled with its frame ID;
- both light #c3c1c0 (palette 06) and dark #24222a (palette 01) backgrounds; read these from kerbside32.json, no hex literals;
- a palette strip, and Bessie h00 beside each group for scale;
- `--atlas <name>`; `--only <id>` writes `build/sheets/only_<id>.png`.
Labels need a tiny built-in pixel font: Pillow's default bitmap font is acceptable for review sheets, which are build/ artefacts, not shipped.

## Scope

- tools/forge/forge/lint.py with the rules above, --only, --warn-as-error
- tools/forge/forge/sheets.py with --atlas, --only
- pytest fixtures: an off-palette pixel, a semi-transparent pixel, an unsorted manifest, a wrong golden hash, a retro meta (passes), a stale script hash (warns)
- `npm run assets:lint` and `npm run assets:sheets` wired to the real implementations

## Out of scope

- Full lint rule set (M4)
- Zoo scene (M4)
- verify/lint in ci.yml (M4)

## Acceptance criteria

- [x] `npm run assets:lint` exits 0 on the repo (including both retro probe folders)
- [x] pytest proves each rule: off-palette pixel → error, alpha 128 → error, unsorted manifest → error, golden hash mismatch → error, stale script_sha256 → warning (an error only with --warn-as-error)
- [x] `npm run assets:sheets` writes build/sheets/actors.png; `npm run assets:sheets -- --only veh.sweeper` writes build/sheets/only_veh.sweeper.png
- [x] The actors sheet was opened with Read, and the PR notes what was checked (labels legible, diagonals inside cell, outline present)
- [x] assets-src/_probe/ is never linted (pytest)

## Verification

- uv run --project tools/forge pytest -k 'lint or sheets'
- npm run assets:lint
- npm run assets:sheets
- npm run assets:sheets -- --only veh.sweeper
- Read build/sheets/actors.png and build/sheets/only_veh.sweeper.png

## Dependencies

**Depends on:**

- [SSP-010](SSP-010-forge-pack-verify.md) Add deterministic atlas packing, generated assets.ts, asset-hashes.json and forge verify
- [SSP-001](SSP-001-probe-ai-goldens-import.md) Import probe Codex sheets as AI golden candidates with retro-filled meta.json

**Blocks:**

- [SSP-014](SSP-014-people-style-acceptance.md) Accept ref.people_style and ingest the spike pedestrian grid (D-04, D-13)
- [SSP-027](SSP-027-m0-exit-close.md) Verify M0 exit criteria, complete the decision log and open the Close M0 PR
- [SSP-039](../M1/SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end
- [SSP-040](../M1/SSP-040-procedural-tiles.md) Generate placeholder ground tiles and the 47-tile kerb blob set with tiles.py
- [SSP-051](../M2/SSP-051-placeholder-litter-sprites.md) Author placeholder grids for all 15 litter IDs and add the items atlas
- [SSP-115](../M4/SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](../M4/SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row

## References

- ../../ASSET_PIPELINE.md#94-forge-lint
- ../../ASSET_PIPELINE.md#95-forge-sheets
- ../../ASSET_PIPELINE.md#53-forge-subcommands-full-reference
- ../../ASSET_PIPELINE.md#65-ai-asset-folder-assets-srcaiasset-id
- ../../ART_BIBLE.md#15-self-review-contact-sheets-and-the-quality-checklist
- ../../../CLAUDE.md#54-ids-and-naming

## Roadmap tasks covered

- `forge/__main__.py` CLI: `build`, `ingest`, `blender`, `gen-ai`, `lint`, `sheets` (lint and sheets can be minimal for now). [lint + sheets parts]
