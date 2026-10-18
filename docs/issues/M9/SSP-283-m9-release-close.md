---
id: SSP-283
title: "Publish desktop builds and both modes on itch.io, then close M9"
milestone: M9
status: todo
type: release
estimate: M
labels: [type:release, area:release, area:platform, area:docs, size:M]
depends_on: [SSP-272, SSP-273, SSP-271, SSP-278, SSP-281, SSP-282, SSP-250, SSP-254]
blocks: []
---

# SSP-283: Publish desktop builds and both modes on itch.io, then close M9

**Milestone:** [M9 Desktop & Extra Modes](../README.md#m9) · **Type:** release · **Size:** M · **Areas:** release, platform, docs

## Summary

Run the TECHNICAL_DESIGN §20.3 release checklist for a post-1.0 version: push the macOS and Windows desktop builds (and Linux if done) to itch.io downloads, and update the HTML5 build with Daily Shift and Rival Sweep. Then open the 'Close M9: Desktop & Extra Modes' PR with evidence for each canonical exit criterion, and tag.

## Context

Exit criteria (canonical, ROADMAP M9): 'Tauri 2.12.3 builds for macOS and Windows. Daily Shift. Rival Sweep.' Key proof (ROADMAP §2): 'Signed or unsigned Tauri 2.12.3 builds for macOS and Windows; mode replays.'

**Release checklist** (TECHNICAL_DESIGN §20.3): `npm run ci` green → `npm run build` → manual smoke on Chrome, Firefox, Safari and Edge (keyboard + gamepad) → butler push → tag `vX.Y.Z` on `main`. Bump `package.json` version first. Tauri's version is single-sourced from it, and `__SSP_VERSION__` shows it on the title screen. The number (e.g. 1.1.0 or 1.2.0, depending on whether the M8 update already shipped) is the lead's call.

**Releases** (ROADMAP §2.2): desktop builds go to itch.io downloads (macOS, Windows), and the HTML5 build stays on the same page. butler has been installed since M7, and TECHNICAL_DESIGN §1.1 records its version. Web push: `butler push dist <itch-user>/street-sweeper-pro:html5 --userversion <version>`. The docs don't name desktop channels. Proposed: `mac`, `windows`, `linux`, pushed with the same `--userversion`. For mac, push a directory containing the .app (butler preserves permissions) or the .dmg, and record which.

**Page text.** The itch.io page gains the desktop downloads, the install notes for unsigned builds (from SSP-271) and the two modes. Store copy falls under IP hygiene (CLAUDE.md hard rule 7), so review it for trademarks.

**Milestone close** (ROADMAP §1, principle 6): a PR titled `Close M9: Desktop & Extra Modes` ticks each criterion and links its evidence, then a git tag `m9`. Re-score the risk register at the close (ROADMAP §9), and note any desktop-specific risks found.

## Scope

- Version bump in package.json, then the §20.3 checklist: ci, build, four-browser smoke
- butler push of the macOS and Windows artefacts (and Linux if shipped) to new desktop channels, plus the updated html5 channel
- itch.io page update: downloads, install notes, Daily Shift and Rival Sweep description, IP review
- Close M9 PR with an evidence table (parity checklists, artefact checksums, e2e and replay runs, the signing decision)
- Re-score the ROADMAP §6 risk register, tick the M9 checklist, and update the TECHNICAL_DESIGN §20.3 post-1.0 line
- Tag `vX.Y.Z` and `m9` on the approved merge commit

## Out of scope

- Steam, consoles or app stores (ROADMAP §7: after M9, needs an ADR)
- Online leaderboards

## Acceptance criteria

- [ ] `butler status <itch-user>/street-sweeper-pro` lists the html5 channel plus the macOS and Windows desktop channels at the release version
- [ ] A desktop build downloaded from itch.io installs and boots to the Title on macOS and on Windows (clean machine or user profile), showing the release version
- [ ] The HTML5 build on itch.io offers Daily Shift and Rival Sweep, and both play to the tally in a clean browser profile; the four-browser smoke is recorded in the PR
- [ ] `npm run ci` is green on the release commit, including the mode replays and the daily/rival e2e specs
- [ ] The Close M9 PR links evidence for each of 'Tauri 2.12.3 builds for macOS and Windows', 'Daily Shift' and 'Rival Sweep'
- [ ] The ROADMAP §6 risk register shows an M9 re-score note, and every M9 checklist item is ticked or explicitly carried over with a reason (e.g. the Linux stretch)
- [ ] Git tags `vX.Y.Z` and `m9` exist on the approved merge commit on main

## Verification

- npm run ci
- npm run build && butler push dist <itch-user>/street-sweeper-pro:html5 --userversion <version>
- butler push <mac-artefact-dir> <itch-user>/street-sweeper-pro:mac --userversion <version>
- butler push <windows-artefact-dir> <itch-user>/street-sweeper-pro:windows --userversion <version>
- butler status <itch-user>/street-sweeper-pro
- git tag vX.Y.Z && git tag m9 (after approval)

## Dependencies

**Depends on:**

- [SSP-272](SSP-272-macos-desktop-builds.md) Produce macOS arm64 and x64 Tauri bundles and verify platform parity
- [SSP-273](SSP-273-windows-desktop-build.md) Produce the Windows x64 Tauri installer and verify parity on WebView2
- [SSP-271](SSP-271-desktop-signing-decision.md) Decide desktop code signing and notarisation for macOS and Windows
- [SSP-278](SSP-278-daily-shift-flow.md) Ship the Daily Shift mode: Title entry, intro card, shift, tally, local best
- [SSP-281](SSP-281-rival-sweep-flow.md) Ship the Rival Sweep mode: district pick, 180 s duel HUD, winner tally
- [SSP-282](SSP-282-mode-replays.md) Commit deterministic replays for Daily Shift (pinned date) and Rival Sweep
- [SSP-250](../M7/SSP-250-butler-install.md) Install butler and record its version in TECHNICAL_DESIGN
- [SSP-254](../M7/SSP-254-release-1-0.md) Push 1.0 to itch.io with butler and tag v1.0.0 and m7

**Blocks:**

_None._

## References

- ../../ROADMAP.md#m9-desktop--extra-modes
- ../../ROADMAP.md#2-milestone-overview
- ../../ROADMAP.md#22-releases-and-builds
- ../../ROADMAP.md#1-planning-principles
- ../../ROADMAP.md#11-definition-of-done-every-task-every-milestone
- ../../ROADMAP.md#6-risk-register
- ../../ROADMAP.md#9-changing-this-roadmap
- ../../TECHNICAL_DESIGN.md#203-release
- ../../TECHNICAL_DESIGN.md#202-vite-configuration
- ../../../CLAUDE.md#8-definition-of-done

## Roadmap tasks covered

- `Exit criteria (canonical): Tauri 2.12.3 builds for macOS and Windows. Daily Shift. Rival Sweep.`
