---
id: SSP-216
title: "Implement the Sunday Inspection Score and the Tidy Town Trophy award"
milestone: M6
status: todo
type: feature
estimate: M
labels: [type:feature, area:gameplay, area:ui, area:save, area:test, size:M]
depends_on: [SSP-214, SSP-187, SSP-192, SSP-191, SSP-186]
blocks: [SSP-230, SSP-232, SSP-245, SSP-249]
---

# SSP-216: Implement the Sunday Inspection Score and the Tidy Town Trophy award

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** M · **Areas:** gameplay, ui, save, test

## Summary

Turn Sunday's result into the week finale: compute the Inspection Score, award the Tidy Town Trophy at >= 80, show the fixed Mercury headline and put the Trophy on the Week Map.

## Context

GDD §12.8 (proposed M6 values; adopt them, and mark GDD §20 Q6 resolved with the lead's sign-off in the PR): Inspection Score (0-100) = 0.5 x mean of best Tidy % across Mon-Sat + 0.5 x Inspection pass rate (% of the Inspector's frontages >= 90% clean when he passed). The -100 marks stay on Sunday's score but do not enter the formula. The Trophy is awarded at Inspection Score >= 80, chosen so that a ~14★ player (mean best Tidy % about 85) who passes 75% of inspected frontages wins: 0.5 x 85 + 0.5 x 75 = 80. This is also week.spec.ts's pass condition. Winning shows the fixed Mercury headline "MUCKLEFORD NAMED BRITAIN'S TIDIEST TOWN (RUNNER-UP)", sets save week.trophy = true, updates week.inspectionBest, and puts the Trophy on the Week Map. Sunday stays replayable for stars. Losing is not game over: Sunday and earlier districts can be replayed. M7 owns jng.trophy and CreditsScene (Tally -> Credits on the first win). In M6, play no trophy jingle (or jng.tally) and do not route to Credits; leave a hook for M7. tidyBest is stored per district as 0..1, so convert to %. A SACKED or TOWED Sunday gives no trophy (no Inspection Score). The pass rate comes from the inspector issue's ShiftResult counters.

## Scope

- Pure function inspectionScore(save, result) and the trophy rule in the progression module
- TallyScene trophy outcome: fixed headline, trophy stamp/art placeholder
- Save week.trophy and week.inspectionBest; Week Map trophy display
- Unit tests for the formula and threshold; GDD §12.8 and §20 Q6 updated

## Out of scope

- jng.trophy and CreditsScene (M7)
- Final trophy art (SSP-230)

## Acceptance criteria

- [ ] Unit test: mean best Tidy 85% with a 75% pass rate gives 80.0 and awards the trophy
- [ ] Unit test: 84.8% with 75% gives 79.9 and no trophy
- [ ] Unit test: a TOWED or SACKED Sunday never awards the trophy
- [ ] A win shows the exact fixed headline text (e2e or visual assertion)
- [ ] After a win, reloading shows the Trophy on the Week Map and Sunday is still selectable (e2e)
- [ ] GDD §20 Q6 is marked resolved

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:e2e

## Dependencies

**Depends on:**

- [SSP-214](SSP-214-inspector.md) Implement npc.inspector and the inspection event with frontage deductions
- [SSP-187](SSP-187-progression-economy.md) Add districts.json, upgrades.json and pure week progression and £ ledger
- [SSP-192](SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-191](SSP-191-week-map-scene.md) Build WeekMapScene: seven district cards, stars, unlock state and Gleaming badges
- [SSP-186](SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub

**Blocks:**

- [SSP-230](SSP-230-art-ui-meta.md) Art Pass 2: final UI art for the Week Map, Workshop and Mercury
- [SSP-232](SSP-232-week-spec-e2e.md) Write tests/e2e/week.spec.ts: scripted save from Monday to the Tidy Town Trophy
- [SSP-245](../M7/SSP-245-song-civic-trophy.md) Compose mus.civic_quarter "Clipboard March" and the jng.trophy jingle
- [SSP-249](../M7/SSP-249-credits-scene.md) Build CreditsScene with pipeline and tool-version provenance

## References

- ../../GDD.md#128-the-week-finale
- ../../GDD.md#20-open-design-questions
- ../../GDD.md#153-tally-screen-the-muckleford-mercury
- ../../TECHNICAL_DESIGN.md#16-save-data-and-settings

## Roadmap tasks covered

_None._
