---
id: SSP-157
title: "Title, shift intro card and tally numbers page with final UI art"
milestone: M4
status: todo
type: feature
estimate: M
labels: [type:feature, area:ui, area:gameplay, size:M, vertical-slice]
depends_on: [SSP-152, SSP-153, SSP-143, SSP-142, SSP-144, SSP-071, SSP-043, SSP-284, SSP-285, SSP-286, SSP-287, SSP-002]
blocks: [SSP-158, SSP-174, SSP-295, SSP-186, SSP-191, SSP-214, SSP-235, SSP-249, SSP-266, SSP-278]
---

# SSP-157: Title, shift intro card and tally numbers page with final UI art

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** feature · **Size:** M · **Areas:** ui, gameplay · **Vertical slice**

## Summary

Put final art in place across the vertical slice flow: the title screen with key art and the Kerbside Bold logo, the shift intro card with Big Pam's portrait on a council panel, and the M2 tally numbers page restyled with real fonts and 9-slice panels.

## Context

Vertical slice flow (ROADMAP §3.2): title -> shift intro card (Big Pam, 2 expressions) -> 240 s shift -> tally numbers page -> retry or quit. The slice uses the M2 numbers page restyled with real fonts and 9-slice panels; the Mercury is M6 (§3.3). Title (ART_BIBLE §12.4): `art.title` 480x270 with the logo text 'Street Sweeper Pro' drawn over it in Kerbside Bold at 2x integer scale, never generated. Version and commit (`__SSP_VERSION__`, `__SSP_COMMIT__`) are shown on the title screen (TECHNICAL_DESIGN §20.2). Shift intro card (GDD §15.4 and the GDD shift structure): `ui.panel_council` with the 64x64 `portrait.big_pam` (briefing and stern expressions), 2-3 lines of briefing, the district, the target, the weather, and 'Press Space to start'. Buttons use the four pixel-exact states with the `→` focus glyph. Nothing scales by non-integer factors. If `TitleScene` or `ShiftIntroScene` does not exist yet (ROADMAP M2 lists only HUD and TallyScene), create minimal versions in the scene flow of TECHNICAL_DESIGN §6.2.

BootScene exists (SSP-284) and by default hands off to ShiftIntroScene. This issue creates TitleScene and changes that default target to TitleScene. The title, intro and tally buttons use menus.ts and panels.ts (SSP-286, SSP-285), which give keyboard, gamepad and mouse support plus the four button states. The version line renders both define constants from SSP-002, e.g. 'v0.4.0 a1b2c3d'. PauseOverlay's Retire entry (SSP-287) uses the intro card as a stand-in target; point it at TitleScene until SSP-191 rewires it to WeekMapScene.

## Scope

- `TitleScene` art + logo layout + version string
- `ShiftIntroScene` card with portrait and panel (expression choice per context)
- `TallyScene` numbers page restyle with panels and fonts
- Button state rendering in menus
- Create `src/scenes/TitleScene.ts` (it does not exist before this issue) using the Scene interface of TECHNICAL_DESIGN §6.1 (`enter/exit/fixedUpdate/render`, with `exit` releasing GPU resources), registered with the SceneManager from SSP-043
- Change BootScene's default hand-off to TitleScene, so TitleScene is the first visible scene in `npm run dev`
- Slice flow wiring (ROADMAP §3.2: title -> shift intro card -> shift -> tally -> retry or quit): TitleScene leads to ShiftIntroScene, because WeekMapScene does not exist until M6 (SSP-191)
- Replace the SSP-071 stand-in 'quit' option on TallyScene (which returned to the intro card) with a real return to TitleScene, point PauseOverlay's Retire stand-in at TitleScene, and update the GDD §15.1 note that SSP-071 added
- Make TitleScene reachable through the `?test=1&scene=<id>` hook (TECHNICAL_DESIGN §18.5, routed by BootScene), and extend `tests/e2e/flow.spec.ts` to start from the title: title -> intro -> shift -> tally -> quit -> title

## Out of scope

- Mercury tally layout (M6)
- Settings and remapping screens (M7)
- Audio jingles (M5)
- WeekMapScene and the Tidy Town Week / Free Sweep / Settings / Credits title entries (M6/M7). In M4 the title offers only the slice's start-shift entry

## Acceptance criteria

- [ ] The title shows `art.title` with a 2x Kerbside Bold logo and the version string at integer scale
- [ ] The intro card shows Big Pam's portrait on `ui.panel_council` with briefing text in Kerbside 5x7 and 'Press Space to start'
- [ ] The tally page uses final fonts and 9-slice panels
- [ ] `npm run test:e2e` smoke still passes; captures of all three screens at 1080p were opened with Read (noted)
- [ ] `src/scenes/TitleScene.ts` exists, and `npm run dev` boots BootScene → TitleScene. Confirming from the title (Space/Enter, gamepad A or a mouse click) opens ShiftIntroScene
- [ ] The title's version line shows both __SSP_VERSION__ and __SSP_COMMIT__, matching package.json and `git rev-parse --short HEAD`
- [ ] The tally's quit option returns to TitleScene, and Try Again still skips the intro card and restarts in under 3 s; both are asserted in `tests/e2e/flow.spec.ts`
- [ ] e2e: Pause → Retire returns to TitleScene (stand-in until SSP-191)
- [ ] `?test=1&scene=title` boots straight into TitleScene, and the active scene id reads as the title scene

## Verification

- npm run typecheck && npm run lint && npm test
- npm run test:e2e
- npm run test:visual
- npm run dev, capture title, intro card and tally at 1920x1080; Read each

## Dependencies

**Depends on:**

- [SSP-152](SSP-152-portrait-big-pam.md) portrait.big_pam: 64x64 intro-card portrait with 2 expressions
- [SSP-153](SSP-153-title-art.md) art.title: 480x270 title key art via ai-art
- [SSP-143](SSP-143-font-kerbside-bold-8x8.md) Write Kerbside Bold 8x8 glyphs, metrics and kerning
- [SSP-142](SSP-142-font-kerbside-5x7.md) Finalise Kerbside 5x7 glyphs, metrics and kerning
- [SSP-144](SSP-144-ui-icons-panels.md) HUD icons, 9-slice panels, button states and complaint stamp grids
- [SSP-071](../M2/SSP-071-intro-tally-scenes.md) Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry
- [SSP-043](../M1/SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-284](../M2/SSP-284-boot-scene.md) Add BootScene: load atlases, fonts and the palette LUT once, then hand off to the shift flow
- [SSP-285](../M3/SSP-285-ui-panels-9slice.md) Implement src/ui/panels.ts 9-slice panels and button states with placeholder panel grids
- [SSP-286](../M3/SSP-286-menu-navigation.md) Implement src/ui/menus.ts: keyboard, gamepad and mouse menu navigation plus input-device glyphs
- [SSP-287](../M3/SSP-287-pause-overlay.md) Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire
- [SSP-002](../M0/SSP-002-node-scaffold.md) Scaffold the Node/TypeScript/Vite repo with exact pins and verify TS 7.0.2 (D-10)

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-174](../M5/SSP-174-unlock-codec-loading.md) Add unlock.ts, Opus/AAC codec selection and boot-time audio loading
- [SSP-295](../M5/SSP-295-vertical-slice-gate.md) Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR
- [SSP-186](../M6/SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub
- [SSP-191](../M6/SSP-191-week-map-scene.md) Build WeekMapScene: seven district cards, stars, unlock state and Gleaming badges
- [SSP-214](../M6/SSP-214-inspector.md) Implement npc.inspector and the inspection event with frontage deductions
- [SSP-235](../M7/SSP-235-settings-scene.md) Build SettingsScene with audio, display, accessibility and assist pages
- [SSP-249](../M7/SSP-249-credits-scene.md) Build CreditsScene with pipeline and tool-version provenance
- [SSP-266](../M8/SSP-266-ios-device-verification.md) Verify audio unlock, background resume and layout on a real iPhone
- [SSP-278](../M9/SSP-278-daily-shift-flow.md) Ship the Daily Shift mode: Title entry, intro card, shift, tally, local best

## References

- ../../ART_BIBLE.md#124-screens
- ../../ROADMAP.md#32-what-is-in-the-slice
- ../../ROADMAP.md#33-what-is-not-in-the-slice
- ../../ART_BIBLE.md#123-panels-buttons-and-icons
- ../../GDD.md#154-other-screens
- ../../TECHNICAL_DESIGN.md#62-scene-flow

## Roadmap tasks covered

- Portraits: `portrait.big_pam` with 2 expressions, 64×64.
- `art.title` key art at 480×270.
