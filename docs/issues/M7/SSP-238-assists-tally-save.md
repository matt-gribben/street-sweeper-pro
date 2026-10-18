---
id: SSP-238
title: "Flag assists on the Mercury tally and store assisted bests separately"
milestone: M7
status: todo
type: feature
estimate: M
labels: [type:feature, area:ui, area:save, area:gameplay, size:M]
depends_on: [SSP-237, SSP-192, SSP-186, SSP-187]
blocks: [SSP-253, SSP-254, SSP-261, SSP-278]
---

# SSP-238: Flag assists on the Mercury tally and store assisted bests separately

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** feature · **Size:** M · **Areas:** ui, save, gameplay

## Summary

Make assist use visible and fair in the meta layer: "Overtime" and "Chill" stamps on the Mercury, the Gleaming badge blocked under Chill Shift, +60 s personal bests stored separately in ssp.save.v1, and a clear HUD complaints meter under Chill.

## Context

Reward rules (GDD §17.1):
- Auto-brush: no effect on rewards and no stamp.
- +60 s timer: stars and £ awarded normally. The tally shows an "Overtime" stamp. The personal best goes to `bestAssisted` in the ssp.save.v1 districts entry instead of `best` (TECHNICAL_DESIGN §16 already has the field).
- Chill Shift: stars and £ awarded normally. The Gleaming badge (3★ + 0 complaints + Lost Property returned, GDD §12.1) cannot be earned. The tally shows a "Chill" stamp. The best score goes to `best`, because GDD only separates +60 s runs. This is tunable later, so do not block on it.
Stamp art: use the small Mercury stamp treatment that M6 uses for "Top Tipper" (GDD §12.1), not the full-page SACKED!/TOWED! slam. Assists are not shameful (GDD §17.1), so do not use 18 postbox_red, which reads as failure. Draw the stamps (do not rotate them) in Kerbside Bold, palette colours only. Copy is British English and never says "easy mode".
HUD under Chill (default, record in GDD §17.1 / §15.2): the complaints meter shows a "CHILL" label in place of the five stamp boxes, so the player can see complaints are off.
The Mercury layout is in GDD §15.3, and the `mercury_tally` visual golden exists from M6. Add a stamped-tally visual check, either as a variant of the mercury_tally scene through a test-hook parameter or as a new scene. If you add a new visual scene, update the TECHNICAL_DESIGN §18.4 scene list and the CLAUDE §7 list.

## Scope

- TallyScene: Overtime / Chill stamps from the shift's run config
- Gleaming evaluation blocked for Chill Shift runs
- save.ts: write `bestAssisted` instead of `best` for extraTime runs. No schema version bump (the field is already documented).
- HUD complaints meter shows CHILL under Chill Shift
- Record the decisions in GDD §17.1
- Unit tests for the reward rules. Visual golden for a stamped tally, reviewed with Read.

## Out of scope

- Sim assist behaviour (SSP-237)
- Changing star thresholds or the £ economy

## Acceptance criteria

- [ ] An extraTime shift shows an "Overtime" stamp on the Mercury and updates `bestAssisted`, not `best` (unit test)
- [ ] A chillShift shift shows a "Chill" stamp, awards stars and £ normally, and never sets `gleaming: true` (unit test)
- [ ] An auto-brush-only shift shows no stamp and updates `best` normally (unit test)
- [ ] During a Chill Shift the HUD complaints meter shows CHILL
- [ ] The stamped tally golden passes at threshold 0, and expected/actual/diff were opened with Read before approval
- [ ] mercury_tally and hud_specimen goldens for the unassisted case are unchanged

## Verification

- npm run typecheck && npm run lint && npm test
- npm run test:visual
- npm run test:e2e

## Dependencies

**Depends on:**

- [SSP-237](SSP-237-assists-sim.md) Wire auto-brush, +60 s timer, Chill Shift and instant dump into the sim
- [SSP-192](../M6/SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-186](../M6/SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub
- [SSP-187](../M6/SSP-187-progression-economy.md) Add districts.json, upgrades.json and pure week progression and £ ledger

**Blocks:**

- [SSP-253](SSP-253-browser-scaling-qa.md) Run cross-browser, scaling and storage-blocked verification for 1.0
- [SSP-254](SSP-254-release-1-0.md) Push 1.0 to itch.io with butler and tag v1.0.0 and m7
- [SSP-261](../M8/SSP-261-touch-hud-adaptation.md) Adapt the HUD layout so it never sits under the thumbs in touch mode
- [SSP-278](../M9/SSP-278-daily-shift-flow.md) Ship the Daily Shift mode: Title entry, intro card, shift, tally, local best

## References

- ../../GDD.md#171-assists-m7
- ../../GDD.md#121-stars-per-district
- ../../GDD.md#152-hud-layout
- ../../GDD.md#153-tally-screen-the-muckleford-mercury
- ../../ART_BIBLE.md#124-screens
- ../../TECHNICAL_DESIGN.md#16-save-data-and-settings
- ../../TECHNICAL_DESIGN.md#184-visual-headless-screenshot-tests

## Roadmap tasks covered

- Assists wired into `shift.ts` and `complaints.ts`, flagged on the Mercury tally. (tally flags)
