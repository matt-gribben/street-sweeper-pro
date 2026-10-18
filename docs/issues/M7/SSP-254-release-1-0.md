---
id: SSP-254
title: "Push 1.0 to itch.io with butler and tag v1.0.0 and m7"
milestone: M7
status: todo
type: release
estimate: S
labels: [type:release, area:release, area:docs, size:S]
depends_on: [SSP-253, SSP-252, SSP-251, SSP-250, SSP-248, SSP-246, SSP-238, SSP-249, SSP-233, SSP-296]
blocks: [SSP-268, SSP-269, SSP-271, SSP-283]
---

# SSP-254: Push 1.0 to itch.io with butler and tag v1.0.0 and m7

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** release · **Size:** S · **Areas:** release, docs

## Summary

Ship 1.0: run the release checklist, push dist/ to the itch.io html5 channel with butler, confirm the page loads and plays in a clean browser profile, make it public, tag v1.0.0 and m7, and close M7 with a PR that links every exit criterion to evidence.

## Context

Release checklist (TECHNICAL_DESIGN §20.3): `npm run ci` green → `npm run build` → manual smoke on Chrome, Firefox, Safari, Edge with keyboard + gamepad (from SSP-253) → `butler push dist <account>/street-sweeper-pro:html5 --userversion 1.0.0` → tag `v1.0.0` on main, in addition to `m7`.
Set package.json version to 1.0.0 so `__SSP_VERSION__` (shown on the title screen, TECHNICAL_DESIGN §20.2) reads 1.0.0. `__SSP_COMMIT__` is the short SHA.
Sequence, so the shipped build matches the tagged commit:
1. On the Close M7 branch, bump the version, run `npm run ci` and `npm run build`, push to html5 while the page is still restricted, and check load-and-play in a clean profile via the restricted link.
2. Open the PR titled `Close M7: 1.0 Web Release` (ROADMAP §1 principle 6). It ticks each canonical criterion with evidence: juice, settings and remapping, assists, budgets, all songs, butler installed, itch page live. It also covers the measurable checks table (Budgets, Browsers, Scaling, Remapping, Audio complete, Content rating, IP hygiene, Release), re-scores the ROADMAP §6 risk register (required at every milestone close by §9), and fills in the §1.1 definition of done.
3. After the lead approves, merge so that main's HEAD is the pushed commit (fast-forward/rebase). If the SHA changes, rebuild and re-push from main.
4. Tag `v1.0.0` and `m7` on that commit. The lead flips the page to public. Do a final clean-profile check on the public URL and add it to the PR as a comment.
The project lead approves the milestone exit and makes the page public; Claude proposes. Commit and PR text end with the session's attribution lines. No secrets in logs. CLAUDE rule 7: no trademarks in commit messages.

## Scope

- Bump package.json version to 1.0.0
- npm run ci, then npm run build
- butler push of dist/ to the html5 channel with --userversion 1.0.0
- Clean-profile load-and-play check (restricted, then public)
- Close M7 PR with an evidence table, risk register re-score and §1.1 checklist
- After the lead approves and merges: tags v1.0.0 and m7 on main, and the lead makes the page public

## Out of scope

- Touch/mobile (M8), desktop builds (M9)
- Any feature work. Blockers go back to their owning issues.

## Acceptance criteria

- [ ] npm run ci exits 0 on the release commit
- [ ] `butler push dist <account>/street-sweeper-pro:html5 --userversion 1.0.0` succeeds, and `butler status` shows 1.0.0 on html5
- [ ] In a clean browser profile, the public itch page loads, shows version 1.0.0 and the release commit SHA on the title, and a full shift can be played
- [ ] Tags `v1.0.0` and `m7` point at the commit that was pushed
- [ ] The Close M7 PR links evidence for every canonical exit criterion and every measurable check, and includes the re-scored risk register
- [ ] The lead's approval is recorded

## Verification

- npm run ci
- npm run build
- <abs path>/butler push dist <account>/street-sweeper-pro:html5 --userversion 1.0.0
- <abs path>/butler status <account>/street-sweeper-pro
- git tag --list 'v1.0.0' 'm7' && git rev-parse v1.0.0 m7

## Dependencies

**Depends on:**

- [SSP-253](SSP-253-browser-scaling-qa.md) Run cross-browser, scaling and storage-blocked verification for 1.0
- [SSP-252](SSP-252-content-ip-review.md) Run the PEGI 7 / ESRB E10+ content review and extend IP hygiene checks
- [SSP-251](SSP-251-itch-page.md) Prepare the itch.io page: copy, controls, rating note and screenshots
- [SSP-250](SSP-250-butler-install.md) Install butler and record its version in TECHNICAL_DESIGN
- [SSP-248](SSP-248-perf-optimise.md) Profile and optimise until the M7 performance budgets hold
- [SSP-246](SSP-246-audio-complete-audit.md) Verify all 9 songs and 6 jingles ship, and run the full-playthrough mix pass
- [SSP-238](SSP-238-assists-tally-save.md) Flag assists on the Mercury tally and store assisted bests separately
- [SSP-249](SSP-249-credits-scene.md) Build CreditsScene with pipeline and tool-version provenance
- [SSP-233](../M6/SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag
- [SSP-296](SSP-296-ci-macos-visual-e2e.md) Bring the macos-latest visual/e2e CI job to its 1.0 shape and prove both CI jobs green

**Blocks:**

- [SSP-268](../M8/SSP-268-m8-close-release.md) Close M8: verify exit criteria, ship the mobile web update, tag m8
- [SSP-269](../M9/SSP-269-tauri-scaffold.md) Wrap dist/ in a Tauri 2.12.3 desktop shell (ADR, src-tauri/, scripts)
- [SSP-271](../M9/SSP-271-desktop-signing-decision.md) Decide desktop code signing and notarisation for macOS and Windows
- [SSP-283](../M9/SSP-283-m9-release-close.md) Publish desktop builds and both modes on itch.io, then close M9

## References

- ../../TECHNICAL_DESIGN.md#203-release
- ../../TECHNICAL_DESIGN.md#202-vite-configuration
- ../../ROADMAP.md#m7-10-web-release
- ../../ROADMAP.md#11-definition-of-done-every-task-every-milestone
- ../../ROADMAP.md#1-planning-principles
- ../../ROADMAP.md#6-risk-register
- ../../ROADMAP.md#9-changing-this-roadmap
- ../../ROADMAP.md#22-releases-and-builds

## Roadmap tasks covered

- Release tag `v1.0.0` in addition to `m7`.
- Exit check: Release — `butler push dist <account>/street-sweeper-pro:html5` succeeds. The page loads and plays in a clean browser profile.
- `Exit criterion: itch.io HTML5 page live.`
