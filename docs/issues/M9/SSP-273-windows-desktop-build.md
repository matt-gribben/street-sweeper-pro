---
id: SSP-273
title: "Produce the Windows x64 Tauri installer and verify parity on WebView2"
milestone: M9
status: todo
type: feature
estimate: M
labels: [type:feature, area:platform, area:build, area:audio, area:input, area:save, area:test, size:M]
depends_on: [SSP-269, SSP-270, SSP-235, SSP-236, SSP-174]
blocks: [SSP-283]
---

# SSP-273: Produce the Windows x64 Tauri installer and verify parity on WebView2

**Milestone:** [M9 Desktop & Extra Modes](../README.md#m9) · **Type:** feature · **Size:** M · **Areas:** platform, build, audio, input, save, test

## Summary

Build a Windows x64 installer from the Tauri shell and run the same parity checklist as macOS on Windows 10/11 with WebView2. The M9 exit criterion requires it.

## Context

Exit criterion (canonical): 'Tauri 2.12.3 builds for macOS and Windows.'

Build:
- Target `x86_64-pc-windows-msvc`.
- Bundle formats: NSIS (`.exe` setup) and/or MSI. Choose and record in TECHNICAL_DESIGN §20.3.
- WebView2 install mode: Tauri's default is the download bootstrapper. Consider an embedded or offline mode for players without WebView2, and record the choice.
- Don't change the webview scheme (`useHttpsScheme`) from what ADR 0003 records, because it changes the localStorage origin.

Build host (the docs don't cover this). The dev machine is a Mac. Options:
- a GitHub Actions `windows-latest` job (CI runs on the public GitHub remote since 2026-10-20, TECHNICAL_DESIGN §19; Blender and AI never run in CI, but Tauri may)
- a Windows machine
- experimental cross-compilation from macOS (NSIS only).
Pick one, document it, and make sure the build repeats from a clean checkout (`npm ci`, then the build).

Parity checklist (same as SSP-272):
- audio unlock and visibility resume (AUDIO_DESIGN §12.4; the Tauri audio parity check, AUDIO_DESIGN §15.1)
- `ssp.save.v1`/`ssp.settings.v1` persistence across relaunch and reinstall
- keyboard (`KeyboardEvent.code`) and a standard-mapping gamepad
- integer scaling and the Fullscreen toggle
- the version string.

Signing: apply the SSP-271 outcome if it's known. Unsigned is acceptable for the exit criterion. If unsigned, record the SmartScreen behaviour.

## Scope

- Choose and document the Windows build host and commands
- Build the x64 installer (NSIS and/or MSI) with the chosen WebView2 install mode
- Run the parity checklist on Windows 10 or 11 and record the results, OS build and WebView2 version in the PR
- Record installer size and SHA-256 in the PR

## Out of scope

- Windows on ARM builds
- Microsoft Store packaging (ROADMAP §7: stores are after M9)
- Gameplay code changes

## Acceptance criteria

- [ ] A Windows x64 installer is produced from a clean checkout using commands documented in TECHNICAL_DESIGN §20.3
- [ ] The installed game boots to TitleScene offline and completes a full 240 s Puddle Lane shift with keyboard and with a standard-mapping gamepad
- [ ] Audio unlocks on the first click or key press and survives minimise and restore
- [ ] Progress and settings persist across app relaunch and across reinstalling the same version
- [ ] Integer scaling and the Fullscreen toggle behave as on the web build, or the PR documents and reports the deviations
- [ ] The parity checklist, with pass/fail per item, is in the PR description

## Verification

- npm ci && npx tauri build --target x86_64-pc-windows-msvc (on the chosen host)
- certutil -hashfile <installer> SHA256 (or shasum -a 256)
- Manual parity checklist on Windows 10/11

## Dependencies

**Depends on:**

- [SSP-269](SSP-269-tauri-scaffold.md) Wrap dist/ in a Tauri 2.12.3 desktop shell (ADR, src-tauri/, scripts)
- [SSP-270](SSP-270-desktop-app-icon.md) Author the desktop app icon as a pipeline asset and wire it into Tauri
- [SSP-235](../M7/SSP-235-settings-scene.md) Build SettingsScene with audio, display, accessibility and assist pages
- [SSP-236](../M7/SSP-236-input-remapping.md) Add keyboard and gamepad remapping for every action, with persistence
- [SSP-174](../M5/SSP-174-unlock-codec-loading.md) Add unlock.ts, Opus/AAC codec selection and boot-time audio loading

**Blocks:**

- [SSP-283](SSP-283-m9-release-close.md) Publish desktop builds and both modes on itch.io, then close M9

## References

- ../../ROADMAP.md#m9-desktop--extra-modes
- ../../TECHNICAL_DESIGN.md#19-ci
- ../../TECHNICAL_DESIGN.md#203-release
- ../../AUDIO_DESIGN.md#124-unlock-and-lifecycle-unlockts
- ../../AUDIO_DESIGN.md#151-plan
- ../../TECHNICAL_DESIGN.md#132-devices
- ../../TECHNICAL_DESIGN.md#16-save-data-and-settings

## Roadmap tasks covered

- `macOS (arm64 and x64) and Windows builds. Code signing is decided at the time (see the "not now" list).`
