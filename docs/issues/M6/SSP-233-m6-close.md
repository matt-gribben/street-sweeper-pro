---
id: SSP-233
title: "Close M6: final goldens, no placeholders, replays audit, docs and m6 tag"
milestone: M6
status: todo
type: release
estimate: M
labels: [type:release, area:release, area:test, area:docs, area:assets, size:M]
depends_on: [SSP-232, SSP-231, SSP-220, SSP-221, SSP-222, SSP-223, SSP-224, SSP-225, SSP-226, SSP-227, SSP-228, SSP-229, SSP-230, SSP-217, SSP-218, SSP-219, SSP-195, SSP-196, SSP-198, SSP-212, SSP-158, SSP-302]
blocks: [SSP-251, SSP-252, SSP-253, SSP-254]
---

# SSP-233: Close M6: final goldens, no placeholders, replays audit, docs and m6 tag

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** release · **Size:** M · **Areas:** release, test, docs, assets

## Summary

Verify every M6 exit criterion with evidence, finish the remaining doc decisions, open the 'Close M6: Tidy Town Week' PR for the project lead, then tag m6.

## Context

Canonical exit (ROADMAP M6): 'All 7 districts + Depot Yard. Week map, Mercury tally, stars and unlocks, £ economy, Workshop upgrades, collectibles, rain, wind, leaves and night, save/load. A full playthrough possible.' Measurable checks: week.spec.ts; unlock-rule unit tests; economy unit tests (wage £60, pledge tip £10, tipping fee £1 per 5 LU, star bonus £50 first time only, Lost Property £25; the full list equals the sum of upgrades.json, currently £6,500); the balance replay check; one committed 3,600-tick replay per district plus the Skip Run; save round-trip and corrupted-data tests, plus Playwright with storage blocked; goldens night_kebab_mile and mercury_tally at threshold 0 (after Art Pass 2, re-approved only after reading diffs); assets:lint and assets:verify clean; no `placeholder: true` left in the manifest. The project lead DEFERRED the £7,350 reconciliation (GDD §20 Q1, 2026-10-18), so the economy assertion stays on the JSON sum. Update the ROADMAP M6 Economy row, which still says the assertion 'is updated with' the reconciliation, to say the reconciliation was deferred past M6. Extend tests/unit/noPlaceholders.test.ts from Mon-Tue to every district and the whole manifest. Expected replay set: m6_high_street, m6_gasworks, m6_conker_hill, m6_promenade, m6_kebab_mile, m6_civic_quarter, m6_skip_run_mon, and the existing Puddle Lane replays. List the songs owed to M7 (mus.promenade, mus.kebab_mile, mus.civic_quarter, jng.trophy) in the PR, with those districts on the mus.workshop fallback. Re-score the risk register (ROADMAP §6: R-13 scope creep, R-03 drift, R-04 music, R-10 performance on Civic Quarter, R-17 review bottleneck) and keep retired risks visible. Confirm that each open question is resolved or explicitly re-deferred: GDD §20 (Q1 deferred by the lead; Q6, Q9, Q12), ENTITY §17 (Q1, Q6, Q9, and the M6 values in Q10) and LEVEL_DESIGN §13 (Q5, Q6, Q7). Closing process (ROADMAP §1): a PR titled 'Close M6: Tidy Town Week' ticks each criterion with links to evidence, and the git tag m6 follows after the lead approves. The definition of done (ROADMAP §1.1 / CLAUDE.md §8) applies.

## Scope

- noPlaceholders test covering all districts and the whole manifest
- Final re-approval of the night_kebab_mile and mercury_tally goldens after Art Pass 2 (Read the diffs)
- Replay audit: every district and Skip Run replay present and passing
- Docs: open-question tables updated, ROADMAP M6 economy row reworded for the deferral, risk register re-scored, M7 owed-items list
- Close M6 PR with evidence links; tag m6 after approval

## Out of scope

- Any new feature work
- M7 items (juice, settings, remaining songs, credits)

## Acceptance criteria

- [ ] npm run ci passes on the dev Mac (typecheck, lint, unit, replay, visual, e2e, assets:verify, assets:lint)
- [ ] The noPlaceholders test asserts zero `placeholder: true` entries in assets-src/manifest.json
- [ ] tests/replay/replays contains a passing 3,600-tick replay for each of the 7 districts and one for the Skip Run
- [ ] night_kebab_mile and mercury_tally pass at threshold 0 on ten consecutive identical runs
- [ ] week.spec.ts and the storage-blocked e2e pass
- [ ] Every M6 canonical exit criterion is ticked in the PR with a link to its evidence
- [ ] The risk register is re-scored with a dated note; the open-question tables and the ROADMAP economy row are updated
- [ ] The m6 tag is created only after the project lead approves

## Verification

- npm run ci
- npm test -- tests/unit/noPlaceholders.test.ts
- npm run test:replay
- npm run test:visual
- npx playwright test tests/e2e/week.spec.ts
- git tag m6 (after approval)

## Dependencies

**Depends on:**

- [SSP-232](SSP-232-week-spec-e2e.md) Write tests/e2e/week.spec.ts: scripted save from Monday to the Tidy Town Trophy
- [SSP-231](SSP-231-balance-pass.md) Full-week balance pass: competent runs, £ curve, par constants and score bands
- [SSP-220](SSP-220-art-humans-batch-a.md) Art Pass 2: final sprites for npc.jogger, npc.kid_skateboard and npc.kid_chalk
- [SSP-221](SSP-221-art-humans-batch-b.md) Art Pass 2: final sprites for npc.lollipop_lady, npc.reveller and npc.inspector
- [SSP-222](SSP-222-art-vehicles-m6.md) Art Pass 2: Blender renders for bin lorry, ice cream van, police and Sid's sweeper
- [SSP-223](SSP-223-art-litter-m6.md) Art Pass 2: final litter sprites for kebab wrapper, leaf pile and lolly stick
- [SSP-224](SSP-224-art-grids-m6.md) Art Pass 2: seagull, loose dog, remaining collectibles, upgrade icons and small props
- [SSP-225](SSP-225-art-world-tiles-m6.md) Art Pass 2: procedural ground tiles, hazard decals and stains for Wed-Sun
- [SSP-226](SSP-226-art-facades-m6.md) Art Pass 2: facade module sets for every remaining building style
- [SSP-227](SSP-227-art-signs-decals-m6.md) Art Pass 2: shop signs and road decals for the Wed-Sun districts
- [SSP-228](SSP-228-art-landmark-roofs.md) Art Pass 2: landmark roofs for the Town Hall, Pier and Depot via Codex goldens
- [SSP-229](SSP-229-art-mercury-portraits.md) Art Pass 2: Mercury newspaper art and portraits for Sid, Doris and the Inspector
- [SSP-230](SSP-230-art-ui-meta.md) Art Pass 2: final UI art for the Week Map, Workshop and Mercury
- [SSP-217](SSP-217-audio-ambiences-m6.md) Author amb.rain, amb.wind_leaves, amb.seafront and amb.night_town beds
- [SSP-218](SSP-218-audio-mus-gasworks.md) Compose mus.gasworks 'Drizzle Dub' with adaptive stems and dub delay send
- [SSP-219](SSP-219-audio-mus-conker-hill.md) Compose mus.conker_hill 'Conker Crunch' 6/8 jig with adaptive stems
- [SSP-195](SSP-195-audio-jingles-star-towed.md) Compose jng.star and jng.towed and wire them to the tally and TOWED end state
- [SSP-196](SSP-196-free-sweep.md) Add Free Sweep mode: untimed, no complaints, Pause -> Finish Sweep, cut-down Mercury
- [SSP-198](SSP-198-skip-run.md) Implement SkipRunScene: 45 s cone slalom and reverse-park bays with £5/£50 payouts
- [SSP-212](SSP-212-district-kebab-mile.md) Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden
- [SSP-158](../M4/SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-302](SSP-302-district-idea-barks.md) Extend Pam's prompt layer to the Tue–Sun 'new idea' barks and author them per district

**Blocks:**

- [SSP-251](../M7/SSP-251-itch-page.md) Prepare the itch.io page: copy, controls, rating note and screenshots
- [SSP-252](../M7/SSP-252-content-ip-review.md) Run the PEGI 7 / ESRB E10+ content review and extend IP hygiene checks
- [SSP-253](../M7/SSP-253-browser-scaling-qa.md) Run cross-browser, scaling and storage-blocked verification for 1.0
- [SSP-254](../M7/SSP-254-release-1-0.md) Push 1.0 to itch.io with butler and tag v1.0.0 and m7

## References

- ../../ROADMAP.md#m6-tidy-town-week
- ../../ROADMAP.md#11-definition-of-done-every-task-every-milestone
- ../../ROADMAP.md#6-risk-register
- ../../ROADMAP.md#1-planning-principles
- ../../GDD.md#20-open-design-questions
- ../../ENTITY_CATALOG.md#17-open-questions
- ../../LEVEL_DESIGN.md#13-open-questions
- ../../../CLAUDE.md#8-definition-of-done

## Roadmap tasks covered

_None._
