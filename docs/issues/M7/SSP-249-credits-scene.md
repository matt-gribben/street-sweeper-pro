---
id: SSP-249
title: "Build CreditsScene with pipeline and tool-version provenance"
milestone: M7
status: todo
type: feature
estimate: M
labels: [type:feature, area:ui, area:assets, area:tooling, size:M]
depends_on: [SSP-216, SSP-186, SSP-157, SSP-115, SSP-117]
blocks: [SSP-252, SSP-253, SSP-254, SSP-262]
---

# SSP-249: Build CreditsScene with pipeline and tool-version provenance

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** feature · **Size:** M · **Areas:** ui, assets, tooling

## Summary

Add CreditsScene, reachable from the Title and shown once after jng.trophy on the first Trophy win. Following Pillar 5 ("Every Pixel Reproducible"), it explains how every asset was made, with techniques, pipeline and tool versions derived from committed provenance.

## Context

Flow (GDD §15.1, TECHNICAL_DESIGN §6.2): Title → Credits → Title. Tally → Credits on the first Trophy win only, then Title. ssp.save.v1 has `week.trophy`; play the credits when it flips false → true. The M6 week flow owns the win.
Technique per class (CLAUDE §6.2):
- procedural Python: ground tiles, roofs, stains, VFX
- procedural assembly of text-grid modules: facades
- Blender: vehicles, volumetric props, roof kit
- Codex key-pose sheets locked to ref.people_style, then ingest: humans
- text grids: animals, small props, pickups, UI icons
- Codex sheets, then ingest: litter
- Codex golden, then ingest: road decals, shop signs, landmark roofs
- Codex golden plus ai-art downscale: title, key art, intro cards, Mercury art, portraits
- text grids, never image gen: fonts
- code-authored tracker and zzfx/jsfxr: all audio
Tool versions (TECHNICAL_DESIGN §1.1): Blender 5.2.2 LTS, codex-cli 0.160.1 with pinned model gpt-6.1-sol (CODEX_MODEL in tools/forge/forge/genai.py; the lead confirmed this pin), Python 3.13.15, numpy 2.5.4, Pillow 13.0.0, ffmpeg 9.0.2, Node 24.21.0, three 0.186.1, TypeScript 7.0.2, Vite 8.3.4, zzfx 1.4.0, jsfxr 1.4.1.
DERIVE, DON'T HAND-TYPE: values come from committed provenance (meta.json `tool`/`tool_version`/`model`, render.json, package.json, pyproject/uv.lock), so credits cannot drift. Default: a generated `public/assets/credits.json` built deterministically as a step of `npm run assets` (stable key order, no timestamps), including per-technique asset counts from assets-src/manifest.json. Extend `npm run assets:verify` to rebuild and byte-compare it.
Art and UI: ui.panel_paper or ui.panel_council, Kerbside 5×7 / Bold 8×8, internal pixel space, scrolling with skip/back on Esc/B/click.
Decisions (defaults; the lead confirms in the PR and the owning docs are updated):
(1) Music: AUDIO_DESIGN §8.4 has no CreditsScene row. Use mus.title (all stems) and add the row.
(2) IP: CLAUDE rule 7 bans trademarks in in-game text. Naming tools (Blender, Codex, three.js, ffmpeg) and the AI author is nominative attribution, but the lead must confirm it. Keep every name in credits.json only (never literals in the scene), so switching to generic descriptions is a data change. Allowlist these names in ipHygiene only for credits.json.
(3) Open-source licence notices (e.g. three.js MIT) are not covered by the docs. Default: ship a LICENSES.txt via public/ (copied into dist/) and add a one-line pointer in the credits.

## Scope

- src/scenes/CreditsScene.ts with scrolling credits and back/skip
- Title 'Credits' menu entry, plus the first-win Tally → Credits → Title path
- Credits data generator wired into npm run assets, reading manifest.json, meta.json, render.json and the version pins; covered by assets:verify
- public/LICENSES.txt for bundled open-source licences
- Update the AUDIO_DESIGN §8.4 scene → audio map for CreditsScene
- Unit test: credits data lists every technique present in manifest.json and every pinned tool version. e2e for both entry paths.

## Out of scope

- jng.trophy itself (SSP-245)
- Changing any tool version
- Extending ipHygiene scan roots beyond the credits allowlist (SSP-252)

## Acceptance criteria

- [ ] Title → Credits → back returns to Title (e2e)
- [ ] On a save that wins the Trophy for the first time, Credits play once after jng.trophy, and a later win does not replay them (unit test on the flow guard or e2e)
- [ ] Credits show each technique and the tool versions above, sourced from credits.json and not from literals in the scene (unit test)
- [ ] npm run assets is deterministic: running it twice gives a byte-identical credits.json, and assets:verify passes with it
- [ ] dist/ contains LICENSES.txt after npm run build
- [ ] The lead's decisions on items 1–3 are recorded in the PR and the owning docs

## Verification

- npm run assets && npm run assets:verify
- npm run typecheck && npm run lint && npm test
- npm run test:e2e
- npm run test:visual
- Manual: Read a screenshot of the credits at 1080p

## Dependencies

**Depends on:**

- [SSP-216](../M6/SSP-216-sunday-finale-trophy.md) Implement the Sunday Inspection Score and the Tidy Town Trophy award
- [SSP-186](../M6/SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub
- [SSP-157](../M4/SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art
- [SSP-115](../M4/SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-117](../M4/SSP-117-forge-verify-ci.md) Extend forge verify to level and M4 outputs, prove assets idempotence, fill forge pytest gaps and add verify + lint to CI

**Blocks:**

- [SSP-252](SSP-252-content-ip-review.md) Run the PEGI 7 / ESRB E10+ content review and extend IP hygiene checks
- [SSP-253](SSP-253-browser-scaling-qa.md) Run cross-browser, scaling and storage-blocked verification for 1.0
- [SSP-254](SSP-254-release-1-0.md) Push 1.0 to itch.io with butler and tag v1.0.0 and m7
- [SSP-262](../M8/SSP-262-touch-menus-prompts.md) Make every menu and prompt usable by tap, with touch-aware glyphs

## References

- ../../GDD.md#2-design-pillars
- ../../GDD.md#151-scene-flow
- ../../GDD.md#128-the-week-finale
- ../../TECHNICAL_DESIGN.md#62-scene-flow
- ../../TECHNICAL_DESIGN.md#11-versions-exact-pins-verified-2026-10-18
- ../../ASSET_PIPELINE.md#61-manifest-assets-srcmanifestjson
- ../../ASSET_PIPELINE.md#65-ai-asset-folder-assets-srcaiasset-id
- ../../AUDIO_DESIGN.md#84-scene--audio-map
- ../../../CLAUDE.md#62-technique-cheat-sheet
- ../../../CLAUDE.md#3-hard-rules-non-negotiable

## Roadmap tasks covered

- `CreditsScene` (from the Title, and once after `jng.trophy` on the first win), including how every asset was made (pipeline and tool versions), consistent with Pillar 5.
