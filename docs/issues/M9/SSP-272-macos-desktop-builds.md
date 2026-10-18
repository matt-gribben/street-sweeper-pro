---
id: SSP-272
title: "Produce macOS arm64 and x64 Tauri bundles and verify platform parity"
milestone: M9
status: todo
type: feature
estimate: M
labels: [type:feature, area:platform, area:build, area:audio, area:input, area:save, area:test, size:M]
depends_on: [SSP-269, SSP-270, SSP-235, SSP-236, SSP-174]
blocks: [SSP-283]
---

# SSP-272: Produce macOS arm64 and x64 Tauri bundles and verify platform parity

**Milestone:** [M9 Desktop & Extra Modes](../README.md#m9) · **Type:** feature · **Size:** M · **Areas:** platform, build, audio, input, save, test

## Summary

Build the macOS desktop app for Apple Silicon and Intel from the Tauri shell, then prove the game behaves as it does in the browser: saves persist, audio unlocks and resumes, keyboard and gamepad work, and scaling and fullscreen are correct.

## Context

Exit criterion (canonical): 'Tauri 2.12.3 builds for macOS and Windows.' ROADMAP task: 'macOS (arm64 and x64)'.

Build:
- Rust targets `aarch64-apple-darwin` and `x86_64-apple-darwin`, or `universal-apple-darwin` as an alternative. Choose one and record it in TECHNICAL_DESIGN §20.3.
- Example: `rustup target add …` then `npx tauri build --target aarch64-apple-darwin`. Output goes to `src-tauri/target/<target>/release/bundle/{macos,dmg}/`.
- Bundle targets: `app` + `dmg`.
- The dev Mac is arm64. Test the x64 build under Rosetta (`arch -x86_64`) or on an Intel Mac, and say which in the PR.
- Even unsigned, arm64 binaries need an ad-hoc signature to launch. Make sure the build has one (`codesign -dv` shows `Signature=adhoc`, or apply the SSP-271 outcome).

Parity checks (AUDIO_DESIGN §15.1 lists the 'Tauri audio parity check' for M9):
- **Audio:** the AudioContext starts suspended and resumes on the first pointerdown/keydown. Gamepad presses don't count as activation (the Title shows 'Click or press a key for sound'). `visibilitychange` suspends and resumes with stems still locked (AUDIO_DESIGN §12.4).
- **Saves:** `ssp.save.v1` and `ssp.settings.v1` persist across quit and relaunch, and after installing a rebuilt .app with the same identifier.
- **Input:** keyboard by `KeyboardEvent.code`; the first gamepad with `mapping === 'standard'` (TECHNICAL_DESIGN §13.2); remapping persists.
- **Display:** integer scale at several window sizes, letterbox `#0f0e12`, and the Settings Fullscreen toggle (`element.requestFullscreen()` on the canvas container, TECHNICAL_DESIGN §12.1). If WKWebView refuses element fullscreen, a fix needs Tauri config or window-API code. Report it, and propose a config-only fix or an ADR note rather than changing gameplay code.
- **Version:** `__SSP_VERSION__` and `__SSP_COMMIT__` on the title screen match package.json and git (TECHNICAL_DESIGN §20.2).

## Scope

- Build and bundle arm64 and x64 (or universal) .app and .dmg
- Run the parity checklist on macOS and record the results, plus macOS and WebKit versions, in the PR
- Record bundle sizes and SHA-256 checksums of the artefacts in the PR
- Document the macOS build commands in TECHNICAL_DESIGN §20.3 and the README

## Out of scope

- Windows and Linux builds
- Publishing to itch.io (SSP-283)
- Gameplay or rendering code changes (if one is needed, report it instead)

## Acceptance criteria

- [ ] An arm64 and an x64 build of Street Sweeper Pro (or one universal build) exist, and `lipo -archs` on the main binary shows the expected architectures
- [ ] `codesign -dv` on each .app shows a valid signature (ad-hoc or Developer ID, per the signing decision)
- [ ] Both builds boot to TitleScene offline and complete a full 240 s Puddle Lane shift with keyboard, reaching the Mercury tally
- [ ] A standard-mapping gamepad drives Bessie in the desktop build
- [ ] Audio starts after the first click or key press, and suspends and resumes when the window is hidden and shown, with stems still in sync
- [ ] Progress (stars, best score) and a changed setting survive quitting and relaunching the app, and reinstalling a rebuilt .app
- [ ] The Fullscreen toggle and window resizing give integer scaling with letterboxing, or the PR documents and reports the deviation
- [ ] The parity checklist, with pass/fail per item, is in the PR description

## Verification

- rustup target add aarch64-apple-darwin x86_64-apple-darwin
- npx tauri build --target aarch64-apple-darwin && npx tauri build --target x86_64-apple-darwin
- lipo -archs 'src-tauri/target/<target>/release/bundle/macos/Street Sweeper Pro.app/Contents/MacOS/'*
- codesign -dv 'src-tauri/target/<target>/release/bundle/macos/Street Sweeper Pro.app'
- shasum -a 256 src-tauri/target/*/release/bundle/dmg/*.dmg
- Manual parity checklist (keyboard, gamepad, audio, save relaunch, fullscreen, version string)

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
- ../../AUDIO_DESIGN.md#124-unlock-and-lifecycle-unlockts
- ../../AUDIO_DESIGN.md#151-plan
- ../../TECHNICAL_DESIGN.md#132-devices
- ../../TECHNICAL_DESIGN.md#121-internal-resolution-and-scaling
- ../../TECHNICAL_DESIGN.md#16-save-data-and-settings
- ../../TECHNICAL_DESIGN.md#202-vite-configuration
- ../../TECHNICAL_DESIGN.md#203-release

## Roadmap tasks covered

- `macOS (arm64 and x64) and Windows builds. Code signing is decided at the time (see the "not now" list).`
