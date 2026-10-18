---
id: SSP-012
title: "Implement forge gen-ai Codex wrapper with preamble v1 and a concept.spike_street smoke run"
milestone: M0
status: todo
type: feature
estimate: L
labels: [type:feature, area:tooling, area:assets, size:L, vertical-slice]
depends_on: [SSP-004, SSP-005, SSP-003, SSP-006]
blocks: [SSP-014, SSP-027, SSP-110, SSP-133, SSP-140, SSP-152, SSP-153, SSP-220]
---

# SSP-012: Implement forge gen-ai Codex wrapper with preamble v1 and a concept.spike_street smoke run

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** feature · **Size:** L · **Areas:** tooling, assets · **Vertical slice**

## Summary

Build `forge gen-ai`, which wraps `codex exec` reproducibly: model pinned, prompt on stdin, output recovery and verification, candidates, review image, `--accept` promotion and meta.json. Write `_style_preamble.md` v1, and prove the wrapper with `npm run gen:ai -- concept.spike_street --candidates 1`.

## Context

Underlying call per candidate, with WORKDIR=build/ai-candidates/<id>/run_NN (NN from 00):
`printf '%s' "$PROMPT" | ~/.local/bin/codex exec -m "$SSP_CODEX_MODEL" --skip-git-repo-check --ephemeral -s workspace-write -C "$WORKDIR" --json -o "$WORKDIR/last_message.txt" [-i assets-src/ai/ref.people_style/golden.png] - > "$WORKDIR/events.jsonl" 2> "$WORKDIR/stderr.txt"`
`CODEX_MODEL = "gpt-6.1-sol"` is pinned in `tools/forge/forge/genai.py` (confirmed by the lead). `SSP_CODEX_MODEL` overrides it. Check `codex --version` = `codex-cli 0.160.1` before running.

Gotchas to encode (§8.2):
- `-i` is variadic, so always pipe stdin and pass `-`. stdin is always redirected, never interactive.
- image_gen is invisible in --json events. Check `$WORKDIR/<output>.png`; otherwise fall back to the newest `~/.codex/generated_images/<thread-id>/exec-*.png`, with thread id from the `thread.started` event.
- The agent must not draw the PNG with code. Evidence from the real probe logs (`assets-src/_probe/codex*/events.jsonl`): good runs `cp` the file from `~/.codex/generated_images/<thread>/exec-*.png`, and the accepted rubbish run also ran a READ-ONLY `python3 -c 'from PIL import Image ... getextrema()'` check. A naive "PIL appears in a command → reject" rule would wrongly reject the probe's best result.
  - Primary check: the output PNG must be byte-identical to an `exec-*.png` under `~/.codex/generated_images/<thread-id>/`.
  - Secondary: reject if a command writes the output via drawing (e.g. `ImageDraw`, `Image.new`, `.save(` targeting the output, SVG/canvas).
- No seed or size control: `seed: null`; aspect is requested in words (2:1 → 1774x887, 1:1 → 1254x1254).
- Refuse to send a prompt containing a denylisted term, using the shared list from SSP-003.
- Fail loudly on missing output.

prompt.md format (§8.4):
- human header table, then `<!-- forge:send -->`;
- everything after the marker is piped byte-for-byte, and `prompt_sha256` covers exactly those bytes;
- sent sections: agent instructions (between `<!-- forge:begin agent-instructions -->` and `<!-- forge:end agent-instructions -->`), preamble (`<!-- forge:begin preamble v1 -->` … `<!-- forge:end preamble -->`), then `## Asset brief`;
- gen-ai refreshes sections 1-2 in place before sending.

`assets-src/ai/_style_preamble.md` v1 is the verbatim block in ASSET_PIPELINE §8.4, starting `<!-- preamble v1 (2026-10-18) -->`, including the 32-hex palette list.

`--candidates N` writes the runs, a draft meta.json, and `build/ai-candidates/<id>/review.png`:
- the raw image downsized;
- an ingest preview at final cell 4x and 8x on light/dark when ingest.json exists. That preview code lands in SSP-013; until then, and for concept.* with no ingest.json, the raw thumbnail is enough.

`--accept <n>` copies the candidate byte-for-byte to `assets-src/ai/<id>/golden.png` and fills candidates_generated, accepted_index, golden_sha256, size and original_output_path. `acceptance_notes` are written by hand. `model` follows the §6.5 example: `"gpt-6.1-sol (agent, pinned via -m); image model: Codex built-in image_gen, version not exposed"`. `--ref <path>` defaults to the refs declared in prompt.md.

Cursor: `--tool cursor` exits non-zero with "not implemented until needed"; document only the raw §8.3 command.

Smoke test: write `assets-src/ai/concept.spike_street/prompt.md`, a straight-down street mood concept. concept.* is reference only, never shipped, with no manifest entry; accepting it is optional (§10.13). Each Codex image takes about 60 s; do not loop hoping for luck.

## Scope

- tools/forge/forge/genai.py (Codex path, CODEX_MODEL, gotchas, output verification, --candidates, --accept, --ref, review.png, draft meta.json)
- assets-src/ai/_style_preamble.md v1 (verbatim)
- assets-src/ai/concept.spike_street/prompt.md
- `--tool cursor` exits non-zero
- pytest with a fake codex binary and a fake ~/.codex/generated_images dir (via HOME or an env override): stdin piping, argv shape, fallback recovery, the byte-identity check, drawing-command rejection, trademark refusal, prompt_sha256 over the bytes after the marker; and replaying both real probe events.jsonl files must NOT be classified as drawn
- One real smoke run on the dev Mac

## Out of scope

- Accepting ref.people_style or any production golden (SSP-014)
- Cursor wrapper (deferred until a milestone needs concept A/B)
- gen:ai in CI (never)

## Acceptance criteria

- [ ] `npm run gen:ai -- concept.spike_street --candidates 1` produces build/ai-candidates/concept.spike_street/run_00/<output>.png and a draft meta.json (exit-criteria proof)
- [ ] The draft meta.json has tool "codex", tool_version "codex-cli 0.160.1", model containing "gpt-6.1-sol", seed null, and prompt_sha256 equal to the sha256 of the bytes after `<!-- forge:send -->`
- [ ] pytest: the invoked argv contains `-m gpt-6.1-sol`, ends with `-`, and the prompt arrives on stdin
- [ ] pytest: a prompt containing a denylisted term is refused before any subprocess starts
- [ ] pytest: both probe events.jsonl logs (cp + read-only PIL check) are classified as not drawn; a synthetic log with `ImageDraw` writing the output is rejected
- [ ] `npm run gen:ai -- x --tool cursor` exits non-zero with 'not implemented until needed'
- [ ] _style_preamble.md matches the §8.4 block exactly (diff in the PR) and lists all 32 palette hexes
- [ ] The smoke candidate was opened with Read; nothing under build/ is committed

## Verification

- uv run --project tools/forge pytest -k genai
- npm run gen:ai -- concept.spike_street --candidates 1
- Read build/ai-candidates/concept.spike_street/review.png
- cat build/ai-candidates/concept.spike_street/run_00/meta.json (or wherever the draft lands, stated in the PR)
- npm test (ipHygiene scans the new prompt.md and preamble)

## Dependencies

**Depends on:**

- [SSP-004](SSP-004-forge-skeleton-pixelize.md) Create the forge Python package (uv, CLI skeleton) and import pixelize.py with tests
- [SSP-005](SSP-005-kerbside32-palette.md) Author kerbside32.json and forge OKLab palette mapping with a shared 4,096-sample fixture
- [SSP-003](SSP-003-lint-purity-ip-tests.md) Add biome.json sim-purity rules plus simPurity and ipHygiene unit tests
- [SSP-006](SSP-006-npm-scripts-ci-workflow.md) Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow

**Blocks:**

- [SSP-014](SSP-014-people-style-acceptance.md) Accept ref.people_style and ingest the spike pedestrian grid (D-04, D-13)
- [SSP-027](SSP-027-m0-exit-close.md) Verify M0 exit criteria, complete the decision log and open the Close M0 PR
- [SSP-110](../M4/SSP-110-forge-ingest-complete.md) Complete forge ingest: full 10-step pipeline, edit protection, dry-run previews
- [SSP-133](../M4/SSP-133-char-doris-pilot.md) Pilot the people pipeline end to end with npc.old_woman (Doris)
- [SSP-140](../M4/SSP-140-litter-sheet-02.md) Generate litter.sheet_02 and ingest the remaining 7 litter items
- [SSP-152](../M4/SSP-152-portrait-big-pam.md) portrait.big_pam: 64x64 intro-card portrait with 2 expressions
- [SSP-153](../M4/SSP-153-title-art.md) art.title: 480x270 title key art via ai-art
- [SSP-220](../M6/SSP-220-art-humans-batch-a.md) Art Pass 2: final sprites for npc.jogger, npc.kid_skateboard and npc.kid_chalk

## References

- ../../ASSET_PIPELINE.md#82-codex-the-exact-command
- ../../ASSET_PIPELINE.md#83-cursor-the-exact-command
- ../../ASSET_PIPELINE.md#84-prompt-file-format
- ../../ASSET_PIPELINE.md#65-ai-asset-folder-assets-srcaiasset-id
- ../../ASSET_PIPELINE.md#111-candidate-review-ai
- ../../ASSET_PIPELINE.md#1013-concept-board-concept
- ../../adr/0002-ai-authored-asset-pipeline.md#41-what-each-ai-asset-folder-records
- ../../../CLAUDE.md#63-procedure-adding-or-replacing-an-ai-asset

## Roadmap tasks covered

- `forge/genai.py`: Codex wrapper (prompt on stdin with `-`, stdin always redirected, model pinned with `-m` from `CODEX_MODEL`, fallback to `~/.codex/generated_images/<thread-id>/exec-*.png`). Implements `--candidates N` and `--accept <n>`. Cursor: ... `--tool cursor` exits non-zero ...
- `assets-src/ai/_style_preamble.md` v1 (overhead, characters about 20 px tall head to feet, 1 px dark outline, top-left light, palette hex list, transparent background, no text, no logos).
