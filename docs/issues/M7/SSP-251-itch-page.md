---
id: SSP-251
title: "Prepare the itch.io page: copy, controls, rating note and screenshots"
milestone: M7
status: todo
type: release
estimate: M
labels: [type:release, area:release, area:docs, area:tooling, size:M]
depends_on: [SSP-250, SSP-019, SSP-233]
blocks: [SSP-252, SSP-253, SSP-254, SSP-266, SSP-267]
---

# SSP-251: Prepare the itch.io page: copy, controls, rating note and screenshots

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** release · **Size:** M · **Areas:** release, docs, tooling

## Summary

Write and review the itch.io HTML5 page content (title, tagline, description, controls, content-rating note) and screenshots captured reproducibly through test hooks. Push a preview to a restricted page so the embed is tested before 1.0 goes public.

## Context

Required (ROADMAP M7): title "Street Sweeper Pro", primary tagline "Somebody's got to do it.", screenshots captured through test hooks, controls, and a content rating note.
Controls (GDD §6.1; keyboard + gamepad only, touch is M8):
- Throttle W/↑ or RT
- Brake/reverse S/↓ or LT
- Steer A,D/←,→ or left stick
- Brush Space or A
- Spray Left Shift or X
- Horn H or B
- Interact/Dump (hold) E or Y
- Map Tab or View
- Pause Esc/P or Start
- Note that all keys are remappable
Rating note (GDD §3): target PEGI 7 / ESRB E10+ (Comic Mischief, Mild Crude Humour: dog mess). Phrase it as a self-assessed content guide, not an official certification. The lead confirms the wording.
Platforms: desktop Chrome, Firefox, Safari, Edge. Embed 960×540 (2× scale) with itch's fullscreen button enabled (TECHNICAL_DESIGN §12.1). Vite `base: './'` makes dist/ work in the itch iframe (§20.2).
Screenshots:
- URL pattern `/?test=1&seed=<n>&scene=<id>&tick=<n>&freeze=1` (TECHNICAL_DESIGN §18.5). Wait for `__ssp.ready`, call `__ssp.readFrame()` (W×270 palette-mapped RGBA), then upscale by an integer factor with nearest neighbour using pngjs (e.g. 4× → 1920×1080 at W = 480).
- Default location: a Playwright-driven script under `tools/release/`, outside the CI test globs, writing to git-ignored `build/release/screenshots/`. Commit the script and the seed/tick shot list, not the PNGs.
- Shots: before/after grime clean, the cat roof-ride, the Mercury tally, Kebab Mile at night, Civic Quarter.
- The script asserts every pixel is a Kerbside-32 colour. Read every screenshot before upload.
IP hygiene (CLAUDE rule 7, GDD §18.4): no trademark, real brand or inspiration name anywhere in the copy. Commit the copy as plain text at `docs/release/itch-page.md` (default; the lead may move it) so SSP-252 can add it to the ipHygiene scan.
Page visibility: restricted/draft until release (ROADMAP §2.2: a restricted itch page for previews from M7). Creating the project in the itch web UI is a human step done by the lead. Claude prepares the content and does the preview push.

## Scope

- Write the page copy file (title, tagline, short description, controls table, rating note, system requirements, credits pointer)
- Screenshot capture script driven by test hooks, plus the shot list, with output reviewed with Read
- Lead creates the restricted HTML5 project. Claude does a first restricted `butler push` of a preview build and checks the embed.
- Manual trademark review of the copy, recorded in the PR

## Out of scope

- Making the page public (SSP-254)
- Wiring the copy into ipHygiene.test.ts (SSP-252)
- Store pages other than itch.io (Steam, consoles and app stores are on the 'not now' list)

## Acceptance criteria

- [ ] The copy file contains the title, the exact tagline "Somebody's got to do it.", the full keyboard and gamepad controls, and a rating note the lead approved
- [ ] The screenshot script produces byte-identical PNGs for the same seed/tick in two runs on the dev Mac
- [ ] The script's palette assertion passes, and every screenshot is at an integer scale and was opened with Read
- [ ] `<abs path>/butler status <account>/street-sweeper-pro` shows the preview build on the html5 channel
- [ ] The restricted itch page loads the preview build in the 960×540 embed at 2×, and itch's fullscreen button works
- [ ] The PR records a trademark review of the copy

## Verification

- node tools/release/<capture script> (or the agreed Playwright command), run twice, then cmp the outputs
- <abs path>/butler push dist <account>/street-sweeper-pro:html5 --userversion <preview version>
- <abs path>/butler status <account>/street-sweeper-pro
- Manual: open the restricted page in a clean browser profile

## Dependencies

**Depends on:**

- [SSP-250](SSP-250-butler-install.md) Install butler and record its version in TECHNICAL_DESIGN
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-233](../M6/SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag

**Blocks:**

- [SSP-252](SSP-252-content-ip-review.md) Run the PEGI 7 / ESRB E10+ content review and extend IP hygiene checks
- [SSP-253](SSP-253-browser-scaling-qa.md) Run cross-browser, scaling and storage-blocked verification for 1.0
- [SSP-254](SSP-254-release-1-0.md) Push 1.0 to itch.io with butler and tag v1.0.0 and m7
- [SSP-266](../M8/SSP-266-ios-device-verification.md) Verify audio unlock, background resume and layout on a real iPhone
- [SSP-267](../M8/SSP-267-mobile-perf-check.md) Measure frame time and audio memory on a mid-range phone; record M8 budget

## References

- ../../GDD.md#61-bindings
- ../../GDD.md#3-audience-platforms-and-rating
- ../../GDD.md#184-naming-and-ip-rules
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../TECHNICAL_DESIGN.md#121-internal-resolution-and-scaling
- ../../TECHNICAL_DESIGN.md#202-vite-configuration
- ../../TECHNICAL_DESIGN.md#203-release
- ../../ROADMAP.md#22-releases-and-builds
- ../../ROADMAP.md#7-not-now-list

## Roadmap tasks covered

- `itch.io page: title, primary tagline "Somebody's got to do it.", screenshots captured through test hooks, controls, content rating note.`
