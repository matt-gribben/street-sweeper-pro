---
id: SSP-255
title: "Make the canvas, viewport and integer scaling phone-ready in landscape"
milestone: M8
status: todo
type: feature
estimate: M
labels: [type:feature, area:render, area:platform, area:test, size:M]
depends_on: [SSP-015, SSP-022, SSP-019, SSP-006, SSP-073, SSP-235, SSP-253]
blocks: [SSP-257, SSP-262, SSP-263, SSP-265, SSP-266]
---

# SSP-255: Make the canvas, viewport and integer scaling phone-ready in landscape

**Milestone:** [M8 Touch & Mobile Web](../README.md#m8) · **Type:** feature · **Size:** M · **Areas:** render, platform, test

## Summary

Confirm that the adaptive internal width and integer upscale from M0 letterbox cleanly at phone aspect ratios (19.5:9 in particular), and make the page behave on mobile browsers: no pinch or double-tap zoom, no page scroll, re-layout when the iOS toolbar shows or hides, and letterbox-coloured safe areas. Also adds the shared client-to-internal-pixel transform that touch hit-testing needs, and the 'mobile' Playwright project that later M8 issues add cases to.

## Context

Owner docs: TECHNICAL_DESIGN §12.1 (owner), ART_BIBLE §3.3 and GLOSSARY 'Internal resolution' (mirrors). Canonical rules: height is always 270; W = clampEven(round(270 × aspect), 432, 640); render target (W+2)×272, NearestFilter, no MSAA or mipmaps; integer scale = floor(min(winW / W, winH / 270)) with winW/winH in DEVICE pixels (CSS size × devicePixelRatio); centred, letterboxed with #0f0e12 (index 00 ink, the only CSS colour exception in CLAUDE.md hard rule 3), CSS image-rendering: pixelated. src/render/upscale.ts owns the canvas and already recomputes on resize and on DPR change (matchMedia resolution).

Worked phone numbers (use them as unit-test fixtures):
- iPhone-class 19.5:9 landscape 2532×1170 device px (844×390 CSS @ DPR 3): aspect 2.1641 → round(584.3) = 584 → W = 584; scale floor(min(4.336, 4.333)) = 4 → 2336×1080 frame, bars 98 device px left/right and 45 top/bottom (≈ 32.67 and 15 CSS px).
- Exact 19.5:9 (aspect 2.1667): round(585.0) = 585, which is ODD. The docs do not say whether clampEven takes 585 to 584 or 586. Read the M0 implementation and keep its rule. If M0 left it implicit, use 2 × floor(n / 2) (585 → 584, so the frame never gets wider than the aspect implies) — the project lead has delegated this choice. Either way, write the rule into TECHNICAL_DESIGN §12.1 (and the ART_BIBLE §3.3 / GLOSSARY mirrors) and test it.
- 20:9 2400×1080: W = 600, scale 4, no bars.
- 21:9 2560×1080: W = 640 (clamp max), scale 4, no bars.
- 16:9 1920×1080: W = 480, scale 4.
- 4:3 tablet 2048×1536: 360 clamps to W = 432; scale floor(min(4.74, 5.69)) = 4 → 1728×1080, bars 160 px left/right and 228 px top/bottom.

Mobile page behaviour (new in M8):
- Viewport meta: width=device-width, initial-scale=1, plus what is needed to stop zoom. iOS Safari may ignore user-scalable=no, so also set touch-action: none on the canvas container and preventDefault on gesturestart and dblclick.
- No page scroll or rubber-banding (overscroll-behavior: none, full-viewport fixed container). No text selection, long-press callout or tap highlight on the game surface.
- html/body background #0f0e12 so notch and safe-area regions read as letterbox. Use the default inset behaviour (no viewport-fit=cover) unless device testing (SSP-266) shows a problem.
- Re-layout on resize, orientationchange and window.visualViewport 'resize'. Mobile Safari toolbars change the visible height, so W and the scale can change at runtime.
- Export a pure transform from client (CSS px) coordinates to internal pixel coordinates (x in 0..W-1, y in 0..269, or 'outside' in the bars), accounting for DPR, the integer scale and the letterbox offsets. The sub-pixel camera blit offset is below 1 internal px and is ignored for hit-testing. Import table (TECHNICAL_DESIGN §2.1): src/input may import only DOM and the InputFrame type, so the composition root (src/app) passes this transform to src/input; touch.ts must not import src/render.
- Reading W from tests: __ssp.readFrame() returns W×270 RGBA, so W = readFrame().length / (270 × 4).

Playwright 'mobile' project (created here so later issues can add cases): in playwright.config.ts add a project named 'mobile' — browserName chromium (CI installs only Chromium; Playwright's iPhone descriptors default to WebKit, so do not use them), viewport 844×390, deviceScaleFactor 3, isMobile true, hasTouch true — with testMatch limited to tests/e2e/mobile.spec.ts, and make sure the existing desktop e2e specs do not run under it. Adding a project and spec is allowed; note why in the PR. No new dependency.

Visual golden: TECHNICAL_DESIGN §18.4 has scale_1440 as a page-screenshot golden. Add a sibling, scale_phone: a page screenshot at 844×390 CSS with deviceScaleFactor 3 in Chromium + SwiftShader (2532×1170 device px, W = 584, scale 4). Adding a scene means updating the scene lists in TECHNICAL_DESIGN §18.4, GLOSSARY 'Visual golden', CLAUDE.md §7 and the SSP-022 row of ROADMAP §5.2 in the same change.

## Scope

- Unit tests for the internal-width and integer-scale functions (wherever M0 put them, expected src/render/upscale.ts) covering every fixture row in context, including the odd-585 case
- Document the odd-value clampEven rule in TECHNICAL_DESIGN §12.1 (mirrors: ART_BIBLE §3.3, GLOSSARY) and add a phone row to its presentation examples
- index.html viewport meta and CSS for mobile: no zoom, no scroll or overscroll, no selection, callout or tap highlight, #0f0e12 body background
- Re-layout on visualViewport resize and orientationchange, in addition to the existing resize and DPR hooks
- A pure client→internal-pixel transform exported from the render/app layer and passed to input by the composition root, with unit tests
- playwright.config.ts 'mobile' project plus a first tests/e2e/mobile.spec.ts covering re-layout, zoom and scroll
- A scale_phone page-screenshot visual spec and golden, with the scene lists updated in TECHNICAL_DESIGN §18.4, GLOSSARY, CLAUDE.md §7 and ROADMAP §5.2

## Out of scope

- Touch controls and hit-testing (SSP-256, SSP-257)
- The portrait 'rotate to landscape' prompt (SSP-263)
- Changing the 432–640 width clamp or the 270 height (a locked look decision; needs an ADR)
- Screen Orientation API locking
- The full touch-driven smoke drive (SSP-265)

## Acceptance criteria

- [ ] Unit tests assert W = 584, scale = 4 and bars of 98 and 45 device px for 2532×1170; W = 600 with no bars for 2400×1080; W = 640 for 2560×1080; W = 432 with scale 4 and bars 160/228 for 2048×1536; W = 480 for 1920×1080
- [ ] The rule for an odd round(270 × aspect) value (585 at exact 19.5:9) is unit-tested and written in TECHNICAL_DESIGN §12.1, with ART_BIBLE §3.3 and GLOSSARY consistent
- [ ] A unit test of the client→internal transform with DPR 3 and the 2532×1170 fixture maps the frame centre to (292, 135) ± 1, the frame's top-left CSS pixel to (0, 0), and a point inside each bar to 'outside'
- [ ] In the 'mobile' Playwright project, resizing the viewport from 844×390 to 932×430 changes W (read as readFrame().length / 1080) from 584 to the value the documented rule gives for 585.2 (584 or 586) within 2 requestAnimationFrame callbacks
- [ ] In the 'mobile' project, a pinch gesture and a double tap on the canvas leave window.visualViewport.scale at 1, and a vertical swipe leaves window.scrollY at 0
- [ ] The scale_phone golden passes at pixelmatch threshold 0 and its first version was opened with Read before approval; scale_1440 and every other existing golden are unchanged
- [ ] npm run test:e2e runs the desktop specs exactly as before plus the new mobile cases

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:visual (scale_phone plus the existing goldens; Read expected/actual/diff on any failure before npm run test:visual:update)
- npm run test:e2e
- npx playwright test --project=mobile

## Dependencies

**Depends on:**

- [SSP-015](../M0/SSP-015-render-core-camera-upscale.md) Build the renderer skeleton: perspective camera, sub-pixel snap, upscale and speed zoom
- [SSP-022](../M0/SSP-022-visual-goldens.md) Add lean_quadrants and scale_1440 visual specs and goldens; prove 10-run stability (D-09)
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-006](../M0/SSP-006-npm-scripts-ci-workflow.md) Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow
- [SSP-073](../M2/SSP-073-e2e-smoke.md) Add smoke.spec.ts: 60 s scripted sweep and full shift ending on the tally
- [SSP-235](../M7/SSP-235-settings-scene.md) Build SettingsScene with audio, display, accessibility and assist pages
- [SSP-253](../M7/SSP-253-browser-scaling-qa.md) Run cross-browser, scaling and storage-blocked verification for 1.0

**Blocks:**

- [SSP-257](SSP-257-touch-input-device.md) Implement src/input/touch.ts producing the same InputFrame as keyboard and pad
- [SSP-262](SSP-262-touch-menus-prompts.md) Make every menu and prompt usable by tap, with touch-aware glyphs
- [SSP-263](SSP-263-rotate-landscape-prompt.md) Show a 'rotate to landscape' prompt and pause the game in portrait
- [SSP-265](SSP-265-mobile-e2e-smoke.md) Add a Playwright mobile-emulation smoke drive with real touch events
- [SSP-266](SSP-266-ios-device-verification.md) Verify audio unlock, background resume and layout on a real iPhone

## References

- ../../TECHNICAL_DESIGN.md#121-internal-resolution-and-scaling
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom
- ../../TECHNICAL_DESIGN.md#184-visual-headless-screenshot-tests
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../TECHNICAL_DESIGN.md#186-e2e
- ../../ART_BIBLE.md#33-internal-resolution
- ../../GLOSSARY.md#internal-resolution
- ../../GLOSSARY.md#visual-golden
- ../../ROADMAP.md#m8-touch--mobile-web
- ../../ROADMAP.md#52-test-and-verification-ramp
- ../../../CLAUDE.md#3-hard-rules-non-negotiable
- ../../../CLAUDE.md#7-testing-expectations

## Roadmap tasks covered

- Adaptive width at phone aspect ratios: confirm `clampEven(round(270 × aspect), 432, 640)` letterboxes cleanly on 19.5:9 screens.
