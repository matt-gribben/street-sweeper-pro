---
id: SSP-186
title: "Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub"
milestone: M6
status: todo
type: feature
estimate: L
labels: [type:feature, area:save, area:test, area:ui, size:L]
depends_on: [SSP-043, SSP-157, SSP-019, SSP-284, SSP-290, SSP-295, SSP-062, SSP-038]
blocks: [SSP-187, SSP-191, SSP-192, SSP-193, SSP-216, SSP-232, SSP-302, SSP-234, SSP-238, SSP-249, SSP-269, SSP-275, SSP-276, SSP-281]
---

# SSP-186: Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** L · **Areas:** save, test, ui

## Summary

Create src/app/save.ts, the only module that reads and writes week progress. Every other M6 meta system (Week Map, Mercury, Workshop, Skip Run, Free Sweep, trophy) saves through it, so it lands first.

## Context

Spec: TECHNICAL_DESIGN §16 (schema and write policy) and GDD §15.5. The only localStorage keys are `ssp.save.v1` (progress) and `ssp.settings.v1` (preferences). The settings UI is M7: do not build it, and do not collide with its key. Every storage access goes inside try/catch. If storage is unavailable (private mode, blocked site data, quota), the game runs on in-memory state and the Title shows a one-time notice, worded as in GDD §15.5: "Progress won't be saved in this browser". Each document carries `"v": 1`. Loading runs a migration chain `migrations[v] -> v+1`, and a future breaking change moves to a new key (`ssp.save.v2`) after migrating. M6 ships a v2 migration STUB that is registered and tested but leaves the key unchanged. Adding fields with defaults does not bump `v`: the loader fills missing fields from defaults. Validation is hand-written structural checks; zod is not allowed. An invalid or unparsable document is logged to the console, replaced by defaults, and the player is told. Write policy (TECHNICAL_DESIGN §16): save at tally committed, Workshop purchase, settings change and week map entry, and NEVER during a shift. GDD §15.5 lists fewer save points; follow TECHNICAL_DESIGN. v1 shape: week {unlocked[], trophy, inspectionBest}, districts{<district id>: {stars, gleaming, best, bestAssisted, tidyBest (0..1), lostProperty, goldenCrisp}}, tutorial.learned[], introSeen{}, money, upgrades{upg.*: level}, liveries{owned[], equipped}, starBonusPaid{<district>: stars paid}, skipRun.best, stats{shifts, luDumped}. Storage sits behind a two-method adapter, `read(key)` / `write(key, json)`, so the M9 Tauri store can implement the same interface. CLAUDE.md §5.1 repeats the storage rule.

**First-play timer rule** (GDD §16.1, LEVEL_DESIGN §4.1): on the first play of Puddle Lane only, the shift timer does not start until the player first lowers the brush. Neither throttle nor the 180-tick fallback starts it. SSP-062 left this as a hook (a `firstPlay` shift start parameter, default false). Definition of first play (propose, and record in GDD §16.1): the save has no committed tally for `district.puddle_lane`, meaning no `districts['district.puddle_lane']` entry. Without storage, the in-memory save gives the same answer: a player who retires before the tally is still on first play, and one who reached the tally is not (Try Again included). Other districts, Free Sweep (no timer), Skip Run and the M9 modes always pass false. The scene that launches ShiftScene (the shift intro flow now, WeekMapScene/ShiftIntroScene once SSP-191 lands) computes the flag from the loaded save and passes it in ShiftScene's start params. ShiftScene hands it to the sim at shift start, so the rule that neither ShiftScene nor src/sim imports save.ts still holds. If the SSP-062 hook is a bare flag, implement the branch in `src/sim/shift.ts` here, allocation-free. The flag changes sim behaviour, so a replay must record it. Add an optional `firstPlay` field (default false) to the replay header (TECHNICAL_DESIGN §18.3), so existing replays keep their hashes.

## Scope

- src/app/save.ts: SaveV1 type, defaults, load (parse, validate, fill defaults, migrate), save, isPersistent(), and a storage adapter interface with a localStorage implementation and an in-memory fallback
- Migrations table with a v1 -> v2 stub and its unit test
- One-time 'Progress won't be saved in this browser' notice on TitleScene when storage is unavailable
- Test hook in src/debug/testHooks.ts (active only with ?test=1) to inject and read a save document for later e2e tests
- tests/unit/save.test.ts: round-trip, corrupted JSON, wrong field types, missing fields filled from defaults, a fake Storage whose methods throw, a quota error on write
- tests/e2e/storage.spec.ts: boot with localStorage access throwing (addInitScript) and assert the Title renders, the notice shows, and there are no uncaught errors
- BootScene (SSP-284) loads the save once at boot and exposes it to later scenes
- Seed the tutorial prompt layer (SSP-290) from save.tutorial.learned, and include its learned set in the next save write (never mid-shift)
- First-play timer rule: compute `firstPlay` from the save at shift launch, pass it through ShiftScene start params to the SSP-062 hook, and implement the timer branch in shift.ts if the hook is a bare flag
- Optional `firstPlay` replay header field (default false), plus one committed first-play replay or equivalent replay-runner test; document it in TECHNICAL_DESIGN §18.3 and the first-play definition in GDD §16.1

## Out of scope

- ssp.settings.v1 content and SettingsScene (M7)
- Progression rules, stars and £ maths (SSP-187)
- Tauri store adapter (M9)
- Cloud saves (on the 'not now' list)

## Acceptance criteria

- [ ] grep in src/ finds localStorage referenced only in src/app/save.ts
- [ ] Every localStorage call in save.ts is inside try/catch (code review plus the throwing-Storage unit test)
- [ ] Saving then loading a fully populated SaveV1 gives a deep-equal object
- [ ] Loading unparsable JSON or a structurally invalid document logs once, returns defaults and sets a 'save reset' flag the UI can show
- [ ] Loading a v1 document with missing fields returns it with defaults filled in and v still 1
- [ ] The v2 migration stub is registered and covered by a unit test
- [ ] With a Storage whose methods throw, load returns defaults, save does not throw, and isPersistent() returns false
- [ ] tests/e2e/storage.spec.ts passes with zero console errors and the notice visible
- [ ] Neither src/sim/** nor src/scenes/ShiftScene.ts imports save.ts (grep check, so nothing can save mid-shift)
- [ ] e2e: when a save with tutorial.learned containing 'brush' is injected before boot, beat 2 does not fire in Puddle Lane; a fresh profile shows it
- [ ] Unit (tests/unit/shift.test.ts): with firstPlay true, `ticksRemaining` stays 14,400 through throttle-only input and past tick 180, then starts counting on the tick of the first BRUSH press edge; with firstPlay false the SSP-062 start rules are unchanged
- [ ] Unit: a fresh save yields firstPlay true for Puddle Lane; a save with a committed Puddle Lane tally yields false; any other district, Free Sweep and Skip Run yield false
- [ ] `npm run test:replay`: existing hashes are unchanged, and a replay whose header has `firstPlay: true` reproduces its committed hash
- [ ] e2e: on a fresh profile under ?test=1 the timer still reads 4:00 after 300 ticks of throttle-only input and starts once the brush is lowered; with an injected save that has a Puddle Lane tally it starts on the first throttle

## Verification

- npm run typecheck
- npm run lint
- npm test -- tests/unit/save.test.ts
- npx playwright test tests/e2e/storage.spec.ts
- npm run test:e2e

## Dependencies

**Depends on:**

- [SSP-043](../M1/SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-157](../M4/SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-284](../M2/SSP-284-boot-scene.md) Add BootScene: load atlases, fonts and the palette LUT once, then hand off to the shift flow
- [SSP-290](../M3/SSP-290-tutorial-beats.md) Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events
- [SSP-295](../M5/SSP-295-vertical-slice-gate.md) Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR
- [SSP-062](../M2/SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event
- [SSP-038](../M1/SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner

**Blocks:**

- [SSP-187](SSP-187-progression-economy.md) Add districts.json, upgrades.json and pure week progression and £ ledger
- [SSP-191](SSP-191-week-map-scene.md) Build WeekMapScene: seven district cards, stars, unlock state and Gleaming badges
- [SSP-192](SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-193](SSP-193-workshop-liveries.md) Build WorkshopScene with upgrade purchases and Bessie livery ramp swaps
- [SSP-216](SSP-216-sunday-finale-trophy.md) Implement the Sunday Inspection Score and the Tidy Town Trophy award
- [SSP-232](SSP-232-week-spec-e2e.md) Write tests/e2e/week.spec.ts: scripted save from Monday to the Tidy Town Trophy
- [SSP-302](SSP-302-district-idea-barks.md) Extend Pam's prompt layer to the Tue–Sun 'new idea' barks and author them per district
- [SSP-234](../M7/SSP-234-settings-store.md) Implement the ssp.settings.v1 store in src/app/settings.ts with storage fallback
- [SSP-238](../M7/SSP-238-assists-tally-save.md) Flag assists on the Mercury tally and store assisted bests separately
- [SSP-249](../M7/SSP-249-credits-scene.md) Build CreditsScene with pipeline and tool-version provenance
- [SSP-269](../M9/SSP-269-tauri-scaffold.md) Wrap dist/ in a Tauri 2.12.3 desktop shell (ADR, src-tauri/, scripts)
- [SSP-275](../M9/SSP-275-mode-plumbing.md) Add Daily Shift and Rival Sweep mode plumbing: params, timer, replay, save
- [SSP-276](../M9/SSP-276-daily-seed-picker.md) Derive the Daily Shift seed from the UTC date and pick district + modifiers
- [SSP-281](../M9/SSP-281-rival-sweep-flow.md) Ship the Rival Sweep mode: district pick, 180 s duel HUD, winner tally

## References

- ../../TECHNICAL_DESIGN.md#16-save-data-and-settings
- ../../GDD.md#155-save-behaviour
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../ROADMAP.md#m6-tidy-town-week
- ../../../CLAUDE.md#51-typescript

## Roadmap tasks covered

- `src/app/save.ts`: versioned schema, every access wrapped in try/catch, migration stub for v2.
