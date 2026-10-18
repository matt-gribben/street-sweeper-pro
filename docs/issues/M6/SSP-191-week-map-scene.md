---
id: SSP-191
title: "Build WeekMapScene: seven district cards, stars, unlock state and Gleaming badges"
milestone: M6
status: todo
type: feature
estimate: M
labels: [type:feature, area:ui, area:gameplay, size:M]
depends_on: [SSP-186, SSP-187, SSP-043, SSP-141, SSP-142, SSP-143, SSP-144, SSP-157, SSP-071, SSP-285, SSP-286, SSP-287]
blocks: [SSP-196, SSP-216, SSP-230, SSP-262, SSP-278]
---

# SSP-191: Build WeekMapScene: seven district cards, stars, unlock state and Gleaming badges

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** M · **Areas:** ui, gameplay

## Summary

The campaign hub: a seafront map of Muckleford with seven day cards showing stars, Gleaming badge, collectible ticks, Top Tipper stamp and lock state, leading to the shift intro or the Workshop.

## Context

Spec: GDD §13.1 and §15.4. Seven district cards Mon-Sun (from src/data/districts.json) sit on a stylised seafront town map drawn on paper (palette 07/06) with district pins. Locked districts are drawn in 04 with a padlock and the requirement text, using the GDD §13.1 pattern: "Needs 1★ on Tuesday" or "Needs 12★ total". Each card shows best-ever stars, the Gleaming badge, a Lost Property tick and a Golden Crisp tick. It also shows the 'Top Tipper' stamp when the district's best score >= its pamTarget (GDD §12.1 Pam's Target, proposed M6; use progression topTipper). Header: total stars, £ balance and a Workshop button. Flow (GDD §15.1 / TECHNICAL_DESIGN §6.2): Title (Continue / Tidy Town Week / Free Sweep) -> WeekMapScene -> ShiftIntroScene or WorkshopScene; Tally -> Week Map; Workshop -> Week Map. Save on week map entry (TECHNICAL_DESIGN §16 write policy). Music: mus.workshop base + lead (AUDIO §8.4); until it is rendered, play nothing rather than a wrong track. Input: keyboard, gamepad and mouse, with no hover-only information. Focus is shown by the -> cursor glyph (ART_BIBLE §12.3). Flow target (GDD §15.1, proposed M7): <= 4 inputs from cold boot to driving on a returning save. Real UI art (paper map, pins, padlock) arrives in SSP-230; use placeholder grids under the final ui.* IDs here (placeholder-first rule). SSP-216 adds the trophy state and SSP-196 adds the Free Sweep entry. UI renders in internal pixel space (480x270 base, width 432-640) with Kerbside 5x7 and Kerbside Bold 8x8.

## Scope

- src/scenes/WeekMapScene.ts: card layout, lock state from progression isUnlocked, requirement text, Top Tipper stamp
- TitleScene: Continue and Tidy Town Week entries wired to the Week Map
- Keyboard, gamepad and mouse navigation; Start on an unlocked card opens ShiftIntroScene for that district
- Placeholder ui.* grids for pins, padlock, badge, stamp and ticks under their final IDs in the manifest
- Save write on entry
- e2e test: inject a save through the test hook and assert lock text, star counts and navigation to ShiftIntro and Workshop
- Rewire PauseOverlay's 'Retire to Week Map' (SSP-287) from its stand-in target (TitleScene since SSP-157) to WeekMapScene

## Out of scope

- Final week-map art (SSP-230)
- Trophy display (SSP-216)
- Free Sweep mode toggle (SSP-196)

## Acceptance criteria

- [ ] With a fresh save only Monday is selectable, and Tuesday shows 'Needs 1★ on Monday'
- [ ] With 1★ on every day Mon-Sat (6 total), Sunday shows 'Needs 12★ total'
- [ ] Stars, Gleaming badge, Lost Property tick, Golden Crisp tick and Top Tipper stamp on each card match the injected save
- [ ] Every action is reachable by keyboard, by gamepad and by mouse (e2e drives each)
- [ ] Entering the scene writes the save exactly once (spy in a unit or e2e test)
- [ ] The palette test stays green, and typecheck, lint and e2e pass
- [ ] e2e: Pause → Retire to Week Map lands on WeekMapScene with no save write

## Verification

- npm run typecheck
- npm run lint
- npm test
- npx playwright test tests/e2e/weekmap.spec.ts
- npm run assets && npm run assets:lint

## Dependencies

**Depends on:**

- [SSP-186](SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub
- [SSP-187](SSP-187-progression-economy.md) Add districts.json, upgrades.json and pure week progression and £ ledger
- [SSP-043](../M1/SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-141](../M4/SSP-141-font-builder-outline-kerning.md) Font builder: per-glyph advance syntax, kerning validation and Kerbside Bold 8x8 support
- [SSP-142](../M4/SSP-142-font-kerbside-5x7.md) Finalise Kerbside 5x7 glyphs, metrics and kerning
- [SSP-143](../M4/SSP-143-font-kerbside-bold-8x8.md) Write Kerbside Bold 8x8 glyphs, metrics and kerning
- [SSP-144](../M4/SSP-144-ui-icons-panels.md) HUD icons, 9-slice panels, button states and complaint stamp grids
- [SSP-157](../M4/SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art
- [SSP-071](../M2/SSP-071-intro-tally-scenes.md) Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry
- [SSP-285](../M3/SSP-285-ui-panels-9slice.md) Implement src/ui/panels.ts 9-slice panels and button states with placeholder panel grids
- [SSP-286](../M3/SSP-286-menu-navigation.md) Implement src/ui/menus.ts: keyboard, gamepad and mouse menu navigation plus input-device glyphs
- [SSP-287](../M3/SSP-287-pause-overlay.md) Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire

**Blocks:**

- [SSP-196](SSP-196-free-sweep.md) Add Free Sweep mode: untimed, no complaints, Pause -> Finish Sweep, cut-down Mercury
- [SSP-216](SSP-216-sunday-finale-trophy.md) Implement the Sunday Inspection Score and the Tidy Town Trophy award
- [SSP-230](SSP-230-art-ui-meta.md) Art Pass 2: final UI art for the Week Map, Workshop and Mercury
- [SSP-262](../M8/SSP-262-touch-menus-prompts.md) Make every menu and prompt usable by tap, with touch-aware glyphs
- [SSP-278](../M9/SSP-278-daily-shift-flow.md) Ship the Daily Shift mode: Title entry, intro card, shift, tally, local best

## References

- ../../GDD.md#131-tidy-town-week
- ../../GDD.md#154-other-screens
- ../../GDD.md#151-scene-flow
- ../../GDD.md#121-stars-per-district
- ../../TECHNICAL_DESIGN.md#62-scene-flow
- ../../ART_BIBLE.md#124-screens
- ../../AUDIO_DESIGN.md#84-scene--audio-map

## Roadmap tasks covered

- `WeekMapScene`: districts, stars, unlock state, Gleaming badges.
