---
id: SSP-270
title: "Author the desktop app icon as a pipeline asset and wire it into Tauri"
milestone: M9
status: todo
type: asset
estimate: S
labels: [type:asset, area:assets, area:platform, area:build, size:S]
depends_on: [SSP-269, SSP-115, SSP-116, SSP-117]
blocks: [SSP-272, SSP-273, SSP-274]
---

# SSP-270: Author the desktop app icon as a pipeline asset and wire it into Tauri

**Milestone:** [M9 Desktop & Extra Modes](../README.md#m9) · **Type:** asset · **Size:** S · **Areas:** assets, platform, build

## Summary

Replace the placeholder desktop icon with a reproducible Kerbside-32 icon. Its source is committed and built deterministically, and every size Tauri bundles (icns, ico, PNGs) stays pixel-exact and on-palette.

## Context

The docs don't specify a desktop app icon anywhere (ART_BIBLE, ASSET_PIPELINE). These rules do apply:
- 'Assets are code': never commit a binary without its source, and never hand-edit a built output (CLAUDE.md hard rule 4).
- Kerbside-32 colours only (hard rule 3). This covers every image inside the .icns/.ico too.
- UI icons are text grids in `assets-src/sprites/ui/` with ≤ 6 colours, an ink outline and a 1 px lit NW edge (ART_BIBLE §12.3; procedure in ASSET_PIPELINE §10.7).
- Contact sheet review with Read is mandatory (hard rule 8).
- No trademarks (hard rule 7).

Pitfall: `npx tauri icon <png>` resamples one master to every size with a smoothing filter. That produces blended, off-palette pixels at 16/24/32/48 px. Instead, author native grids (proposed: 16×16 and 32×32) and produce every required size by **integer nearest-neighbour** scaling from the closest grid. Sizes: 16, 32, 64, 128, 256, 512 and 1024 for icns; 16, 24 (from 16 at 1.5×, not allowed, so author a 24×24 grid or omit 24), 32, 48, 64 and 256 for ico; 32x32.png, 128x128.png and 128x128@2x.png for Tauri. Assemble .icns/.ico with Pillow (numpy + Pillow only; PNGs with no metadata; CLAUDE.md §5.2), or use `tauri icon` only if its output passes the palette check below.

Decide these in the PR and record them in ASSET_PIPELINE near the UI/grid technique rows:
- Asset ID. Proposed: `ui.app_icon`, in `assets-src/manifest.json`, flagged or placed so it is NOT packed into the runtime `ui` atlas (it is never drawn in game).
- Motif. Proposed: Bessie (`veh.sweeper`, 15 sweeper_yellow) on a plain ground. The project lead approves.
- Byte stability. If the icns/ico writer isn't byte-stable, treat src-tauri/icons/** as generated outputs, commit them with the command used, and exclude them from `assets:verify`, documenting why.

## Scope

- Text-grid source(s) for the icon plus a manifest entry kept out of runtime atlases
- A deterministic build step (forge or npm script) that writes every icon size by integer nearest-neighbour and assembles .icns/.ico/PNGs into src-tauri/icons/
- Point tauri.conf.json `bundle.icon` at the new files and delete the placeholder and its generator
- A check (forge lint rule or unit test) that every pixel of every generated icon image is a Kerbside-32 colour or fully transparent
- Document the icon technique and command in ASSET_PIPELINE

## Out of scope

- Browser favicon changes for the web build
- itch.io page artwork

## Acceptance criteria

- [ ] The icon's source grid(s) are committed under assets-src/sprites/ui/ with a manifest entry, and `npm run assets:lint` passes
- [ ] Every pixel of every image inside the generated .icns, .ico and PNGs is a Kerbside-32 colour or alpha 0 (automated check, run in `npm test` or `assets:lint`)
- [ ] Each grid uses ≤ 6 colours with an ink outline and a 1 px lit NW edge (ART_BIBLE §12.3)
- [ ] The contact sheet from `npm run assets:sheets` was opened with Read, and the PR notes what was checked
- [ ] src-tauri/icons contains .icns, .ico and the PNG sizes tauri.conf.json references, and `npm run desktop:build` uses them (Finder shows the new icon)
- [ ] `npm run assets:verify` passes, or any exclusion of src-tauri/icons is documented with a reason
- [ ] No placeholder or Tauri-default icon remains, and the runtime `ui` atlas is unchanged (`git diff --stat -- public/assets/atlas` is empty)

## Verification

- npm run assets && npm run assets:lint && npm run assets:verify
- npm test
- npm run assets:sheets (Read the sheet containing ui.app_icon in build/sheets/)
- npm run desktop:build

## Dependencies

**Depends on:**

- [SSP-269](SSP-269-tauri-scaffold.md) Wrap dist/ in a Tauri 2.12.3 desktop shell (ADR, src-tauri/, scripts)
- [SSP-115](../M4/SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](../M4/SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-117](../M4/SSP-117-forge-verify-ci.md) Extend forge verify to level and M4 outputs, prove assets idempotence, fill forge pytest gaps and add verify + lint to CI

**Blocks:**

- [SSP-272](SSP-272-macos-desktop-builds.md) Produce macOS arm64 and x64 Tauri bundles and verify platform parity
- [SSP-273](SSP-273-windows-desktop-build.md) Produce the Windows x64 Tauri installer and verify parity on WebView2
- [SSP-274](SSP-274-linux-desktop-build.md) Stretch: produce a Linux x64 Tauri build (AppImage/deb) and smoke-test it

## References

- ../../ART_BIBLE.md#123-panels-buttons-and-icons
- ../../ASSET_PIPELINE.md#107-small-prop-pickup-or-ui-icon-grids
- ../../ASSET_PIPELINE.md#61-manifest-assets-srcmanifestjson
- ../../../CLAUDE.md#6-asset-rules
- ../../../CLAUDE.md#3-hard-rules-non-negotiable

## Roadmap tasks covered

- `macOS (arm64 and x64) and Windows builds. Code signing is decided at the time (see the "not now" list).`
