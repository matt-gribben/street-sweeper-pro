---
id: SSP-193
title: "Build WorkshopScene with upgrade purchases and Bessie livery ramp swaps"
milestone: M6
status: todo
type: feature
estimate: L
labels: [type:feature, area:ui, area:gameplay, area:render, area:assets, size:L]
depends_on: [SSP-188, SSP-187, SSP-186, SSP-113, SSP-114, SSP-127, SSP-116, SSP-165, SSP-286]
blocks: [SSP-224, SSP-230, SSP-232, SSP-262]
---

# SSP-193: Build WorkshopScene with upgrade purchases and Bessie livery ramp swaps

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** L · **Areas:** ui, gameplay, render, assets

## Summary

The Depot Workshop, where £ is spent: upgrades with before/after stat previews and a livery selector, plus rendering Bessie in the equipped livery through ramp swaps.

## Context

Spec: GDD §15.4 Depot Workshop. Bessie on a lift; an upgrade list with current level, next level, price and stat preview (before -> after); a livery selector; £ balance; mus.workshop with all stems. SFX: ui_move, ui_select, ui_back, and coin on purchase (ENTITY §14). No refunds and no respec (GDD §12.4, proposed). Upgrades take effect from the next shift. Autosave after every purchase. Flow: Tally -> Workshop, SkipRun -> Workshop, WeekMap <-> Workshop, Workshop -> WeekMap. Prices come from upgrades.json; do not change them (the £7,350 reconciliation is deferred by the project lead).

Liveries (ART_BIBLE §5.6 slot table on the actors atlas):
- Council Yellow = slots 0/1 (identity).
- Racing Green = slots 2/3 (14/15/16 -> 21/22/23, stripe 26 -> 15).
- Seaside Stripes = slots 4/5 (-> 26/27/28, stripe -> 20).
- Midnight Gold = slots 6/7 (-> 01/25/26, stripe -> 15).
Beacon flash: Bessie alternates between her livery's even slot and the next odd slot (17 -> 16). The brush overlay is a separate instance and always uses slot 0. Racing Green and Seaside cost £150 each; Midnight Gold is unlocked (not bought) by all 7 Golden Crisps. The equipped livery lives in save.liveries.equipped and is render-only, so it has no sim or replay-hash effect.

Check whether M4 already emitted the livery swap tables in the actors atlas JSON (`swaps`). If not, add them in the manifest, rebuild, and review a contact sheet showing all four liveries at h00 and at a diagonal heading. Workshop art (pegboard backdrop in 13 with 08 holes, 16x16 upgrade icons) is placeholder here; final art comes in SSP-224 and SSP-230.

## Scope

- src/scenes/WorkshopScene.ts: list, stat previews computed from the same tuning modifiers the sim uses, purchase, insufficient-funds state, livery selector
- Each purchase writes the save (money, upgrades, liveries) immediately
- Livery swap tables in the actors atlas (if missing); ShiftScene/spriteBatch selects the equipped livery slot, with beacon flash
- Placeholder upgrade icons and pegboard under their final ui.* IDs
- e2e: buy upg.hopper L1 for £300, then assert the money and a next-shift hopper capacity of 140 LU via __ssp.state()

## Out of scope

- Final icon and pegboard art (SSP-224, SSP-230)
- Visible upgrade overlays on Bessie (proposed, not in the M6 checklist)
- Price reconciliation (deferred)

## Acceptance criteria

- [ ] Every upg.* in upgrades.json is listed with current level, next level, price and a before -> after value matching ENTITY_CATALOG §14.1
- [ ] Buying with insufficient £ is refused with feedback and no state change
- [ ] A purchase persists across a page reload
- [ ] Midnight Gold is selectable only when all 7 goldenCrisp flags are true
- [ ] The contact sheet shows Bessie in all four liveries with the brush overlay unchanged, reviewed with Read and noted in the PR
- [ ] Changing the livery changes no replay hash
- [ ] assets:lint and assets:verify pass if the atlas swaps changed

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:replay
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets (Read build/sheets/actors.png)
- npx playwright test tests/e2e/workshop.spec.ts

## Dependencies

**Depends on:**

- [SSP-188](SSP-188-upgrade-modifiers.md) Apply upg.* levels to the sim via tuning.ts modifiers and record loadout in replays
- [SSP-187](SSP-187-progression-economy.md) Add districts.json, upgrades.json and pure week progression and £ ledger
- [SSP-186](SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub
- [SSP-113](../M4/SSP-113-forge-pack-atlases.md) Lock atlas trimming and the 1 px gutter, cover all five atlases and add the fill-ratio report
- [SSP-114](../M4/SSP-114-ramp-swap-tables.md) Lock ramp-swap key indices and emit the 8 swap tables per atlas
- [SSP-127](../M4/SSP-127-bessie-final.md) Final Bessie renders: body, dented variant and 96x96 brush overlay
- [SSP-116](../M4/SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-165](../M5/SSP-165-sfx-feedback-ui.md) Author the 8 game-feedback and UI SFX sources
- [SSP-286](../M3/SSP-286-menu-navigation.md) Implement src/ui/menus.ts: keyboard, gamepad and mouse menu navigation plus input-device glyphs

**Blocks:**

- [SSP-224](SSP-224-art-grids-m6.md) Art Pass 2: seagull, loose dog, remaining collectibles, upgrade icons and small props
- [SSP-230](SSP-230-art-ui-meta.md) Art Pass 2: final UI art for the Week Map, Workshop and Mercury
- [SSP-232](SSP-232-week-spec-e2e.md) Write tests/e2e/week.spec.ts: scripted save from Monday to the Tidy Town Trophy
- [SSP-262](../M8/SSP-262-touch-menus-prompts.md) Make every menu and prompt usable by tap, with touch-aware glyphs

## References

- ../../GDD.md#154-other-screens
- ../../GDD.md#124-upgrades
- ../../GDD.md#125-liveries
- ../../ENTITY_CATALOG.md#14-upgrades-and-liveries-upg
- ../../ART_BIBLE.md#56-ramp-swaps-per-instance-palette-variants
- ../../TECHNICAL_DESIGN.md#16-save-data-and-settings

## Roadmap tasks covered

- `WorkshopScene`: all `upg.*` from ENTITY_CATALOG.md, applied through `tuning.ts` modifiers. Liveries as ramp swaps.
