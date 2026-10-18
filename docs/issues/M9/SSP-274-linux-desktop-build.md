---
id: SSP-274
title: "Stretch: produce a Linux x64 Tauri build (AppImage/deb) and smoke-test it"
milestone: M9
status: todo
type: feature
estimate: M
labels: [type:feature, area:platform, area:build, area:test, size:M]
depends_on: [SSP-269, SSP-270]
blocks: []
---

# SSP-274: Stretch: produce a Linux x64 Tauri build (AppImage/deb) and smoke-test it

**Milestone:** [M9 Desktop & Extra Modes](../README.md#m9) · **Type:** feature · **Size:** M · **Areas:** platform, build, test

## Summary

The identity section lists Linux, but the M9 exit criterion needs only macOS and Windows. If time allows, build a Linux x64 bundle and smoke-test it. If WebKitGTK can't run the game acceptably, record that instead of shipping.

## Context

ROADMAP M9: 'Linux build as a stretch goal (the identity section lists Linux; the exit criterion requires only macOS and Windows).' GDD §3 lists macOS/Windows/Linux desktop via Tauri 2, and TECHNICAL_DESIGN §20.3 says 'Linux where feasible'.

Tauri's Linux webview is WebKitGTK. The renderer is three.js `WebGLRenderer` on WebGL2 (TECHNICAL_DESIGN §1.2), so check WebGL2 support and frame pacing first.

Build on a Linux host (e.g. `ubuntu-latest` or a VM) and document the apt packages it needs. Bundle targets: `appimage` and/or `deb`.

This doesn't block the M9 exit. A documented 'not feasible, because …' result is an acceptable outcome.

## Scope

- Build a Linux x64 bundle on a Linux host with documented commands and system packages
- Smoke test: boot, Title, a 60 s Puddle Lane drive with keyboard, audio unlock, save persistence across relaunch
- Record the outcome (shipped, or not feasible with the reason) in TECHNICAL_DESIGN §20.3 and the PR

## Out of scope

- Flatpak/Snap packaging
- Workarounds that change gameplay or rendering code

## Acceptance criteria

- [ ] Either a Linux AppImage or .deb is produced from a clean checkout and passes the smoke test, or the PR documents with evidence why Linux isn't feasible (e.g. no WebGL2 in WebKitGTK)
- [ ] TECHNICAL_DESIGN §20.3 states the Linux status
- [ ] No changes under src/ (`git diff --stat main -- src` is empty)

## Verification

- npm ci && npx tauri build --bundles appimage,deb (on Linux)
- Manual smoke checklist on the Linux host

## Dependencies

**Depends on:**

- [SSP-269](SSP-269-tauri-scaffold.md) Wrap dist/ in a Tauri 2.12.3 desktop shell (ADR, src-tauri/, scripts)
- [SSP-270](SSP-270-desktop-app-icon.md) Author the desktop app icon as a pipeline asset and wire it into Tauri

**Blocks:**

_None._

## References

- ../../ROADMAP.md#m9-desktop--extra-modes
- ../../GDD.md#3-audience-platforms-and-rating
- ../../TECHNICAL_DESIGN.md#12-stack-wide-consequences
- ../../TECHNICAL_DESIGN.md#203-release

## Roadmap tasks covered

- `Linux build as a stretch goal (the identity section lists Linux; the exit criterion requires only macOS and Windows).`
