---
id: SSP-250
title: "Install butler and record its version in TECHNICAL_DESIGN"
milestone: M7
status: todo
type: chore
estimate: S
labels: [type:chore, area:release, area:tooling, area:docs, size:S]
depends_on: []
blocks: [SSP-251, SSP-254, SSP-266, SSP-268, SSP-283]
---

# SSP-250: Install butler and record its version in TECHNICAL_DESIGN

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** chore · **Size:** S · **Areas:** release, tooling, docs

## Summary

Install itch.io's butler uploader (latest at M7) on the dev Mac as a local tool, record its exact version and absolute path in the docs, and record the itch account name. The project lead does the login.

## Context

TECHNICAL_DESIGN §1.1 has the row "itch.io uploader (M7, not installed yet) | butler | latest at M7". Replace it with the exact installed version.
Release command (TECHNICAL_DESIGN §20.3): `butler push dist <itch-user>/street-sweeper-pro:html5 --userversion <version>`. "The itch account name is set at M7": get it from the lead and record it in §20.3.
butler is a local binary, not an npm dependency. Like Blender, ffmpeg and the Codex CLI, it lives off PATH and is called by absolute path (CLAUDE §4.4). Add a row there with path and version. Update README where it mentions butler ("pushed with butler from M7").
Never run butler in CI (CI never pushes).
CREDENTIALS: the project lead runs `butler login`. API keys and tokens must never be committed, pasted into logs or written to repo files, and Claude never reads the credentials file.
The itch project may not exist yet (SSP-251 creates it), so do not verify against it here.
The roadmap task explicitly requests this install, so no ADR is needed. Say so in the PR.

## Scope

- Download and install butler on the dev Mac, and record its absolute path and exact version
- Update TECHNICAL_DESIGN §1.1 (version) and §20.3 (account name), the CLAUDE.md §4.4 local tools table, and README
- Ask the lead to run `butler login` and confirm it in the PR

## Out of scope

- Pushing any build (SSP-251 preview, SSP-254)
- Creating the itch page (SSP-251)
- CI integration

## Acceptance criteria

- [ ] `<abs path>/butler -V` prints a version that matches TECHNICAL_DESIGN §1.1 exactly
- [ ] CLAUDE.md §4.4 lists butler with path and version, and README is consistent
- [ ] TECHNICAL_DESIGN §20.3 names the itch account
- [ ] The lead's confirmation that `butler login` succeeded is recorded in the PR
- [ ] No credential appears in git diff or the transcript

## Verification

- <abs path>/butler -V
- git diff (docs only, no secrets)

## Dependencies

**Depends on:**

_None._

**Blocks:**

- [SSP-251](SSP-251-itch-page.md) Prepare the itch.io page: copy, controls, rating note and screenshots
- [SSP-254](SSP-254-release-1-0.md) Push 1.0 to itch.io with butler and tag v1.0.0 and m7
- [SSP-266](../M8/SSP-266-ios-device-verification.md) Verify audio unlock, background resume and layout on a real iPhone
- [SSP-268](../M8/SSP-268-m8-close-release.md) Close M8: verify exit criteria, ship the mobile web update, tag m8
- [SSP-283](../M9/SSP-283-m9-release-close.md) Publish desktop builds and both modes on itch.io, then close M9

## References

- ../../TECHNICAL_DESIGN.md#11-versions-exact-pins-verified-2026-10-18
- ../../TECHNICAL_DESIGN.md#203-release
- ../../ROADMAP.md#22-releases-and-builds
- ../../../CLAUDE.md#44-local-tool-binaries-not-on-path-always-use-absolute-paths

## Roadmap tasks covered

- `Install butler (latest at M7), and record its version in [TECHNICAL_DESIGN.md](../../TECHNICAL_DESIGN.md).`
- `Exit criterion: butler installed.`
