---
id: SSP-271
title: "Decide desktop code signing and notarisation for macOS and Windows"
milestone: M9
status: todo
type: docs
estimate: S
labels: [type:docs, area:release, area:platform, area:docs, size:S]
depends_on: [SSP-254]
blocks: [SSP-283]
---

# SSP-271: Decide desktop code signing and notarisation for macOS and Windows

**Milestone:** [M9 Desktop & Extra Modes](../README.md#m9) · **Type:** docs · **Size:** S · **Areas:** release, platform, docs

## Summary

The 'not now' list defers desktop code signing to M9, to be decided with real distribution numbers. Lay out the options, get the project lead's decision, and record it so the platform builds and the itch.io page apply it.

## Context

ROADMAP §7 row: 'Desktop code signing and notarisation | Decided at M9 with real distribution numbers | M9'. The M9 key proof (ROADMAP §2) accepts 'Signed or unsigned Tauri 2.12.3 builds for macOS and Windows'. ROADMAP §9 says removing an item from the 'not now' list needs an ADR. So adopting signing means an ADR: the next free number after the Tauri ADR (0003), so 0004. Staying unsigned only updates the row (the decision plus a new 'earliest reconsideration').

Options:
- **macOS, unsigned (ad-hoc).** arm64 binaries must carry at least an ad-hoc signature to run at all. Gatekeeper then blocks the first launch, and the player allows it under System Settings → Privacy & Security → Open Anyway. Check the current flow on the target macOS version.
- **macOS, signed.** Developer ID signing plus notarisation: paid Apple Developer Program, notarytool credentials.
- **Windows, unsigned.** SmartScreen shows 'More info → Run anyway'.
- **Windows, signed.** A code-signing certificate or a cloud signing service.

Input data: itch.io page views and downloads since the 1.0 launch (M7). Never commit certificates, keys or passwords. Signing secrets live outside the repo (no remote/CI exists yet; TECHNICAL_DESIGN §19).

## Scope

- A short options write-up (cost, player friction, maintenance) in the PR description, with the itch.io numbers
- Record the lead's decision in ROADMAP §7 and TECHNICAL_DESIGN §20.3
- If signing is adopted: ADR 0004, plus the signing steps for the platform build issues (no secrets in git)
- If unsigned: player-facing install notes for the itch.io page (British English, no trademarks beyond the OS names the instructions need)

## Out of scope

- Buying certificates or memberships (the human lead does this)
- Producing the builds themselves

## Acceptance criteria

- [ ] The ROADMAP §7 'Desktop code signing and notarisation' row states the decision and date, or the row is removed and docs/adr/0004-*.md records adopting signing
- [ ] TECHNICAL_DESIGN §20.3 describes the desktop release signing policy for macOS and Windows
- [ ] The decision is attributed to the project lead in the PR
- [ ] If unsigned, install-note text for macOS and Windows is committed (e.g. in TECHNICAL_DESIGN §20.3 or a release-notes section) and ready for the itch.io page
- [ ] `git grep -n -i -E 'BEGIN (RSA|PRIVATE)|\.p12|\.pfx'` finds no secrets

## Verification

- Read docs/ROADMAP.md §7 and docs/TECHNICAL_DESIGN.md §20.3 after the edit
- git grep -n -i 'sign' docs/ROADMAP.md docs/TECHNICAL_DESIGN.md

## Dependencies

**Depends on:**

- [SSP-254](../M7/SSP-254-release-1-0.md) Push 1.0 to itch.io with butler and tag v1.0.0 and m7

**Blocks:**

- [SSP-283](SSP-283-m9-release-close.md) Publish desktop builds and both modes on itch.io, then close M9

## References

- ../../ROADMAP.md#7-not-now-list
- ../../ROADMAP.md#9-changing-this-roadmap
- ../../ROADMAP.md#2-milestone-overview
- ../../ROADMAP.md#22-releases-and-builds
- ../../TECHNICAL_DESIGN.md#203-release

## Roadmap tasks covered

- `macOS (arm64 and x64) and Windows builds. Code signing is decided at the time (see the "not now" list).`
