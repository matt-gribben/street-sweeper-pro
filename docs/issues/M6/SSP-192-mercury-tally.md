---
id: SSP-192
title: "Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden"
milestone: M6
status: todo
type: feature
estimate: L
labels: [type:feature, area:ui, area:gameplay, area:render, area:test, size:L]
depends_on: [SSP-186, SSP-187, SSP-071, SSP-064, SSP-142, SSP-143, SSP-144, SSP-172, SSP-165, SSP-173, SSP-285, SSP-286, SSP-291]
blocks: [SSP-195, SSP-196, SSP-198, SSP-216, SSP-229, SSP-230, SSP-238, SSP-245, SSP-252, SSP-262, SSP-275, SSP-278, SSP-281]
---

# SSP-192: Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** L · **Areas:** ui, gameplay, render, test

## Summary

Replace the M2 numbers page with a 480x270 newspaper front page: outcome headline, live district map with frontages green or red, stars, itemised £, a letters-page line and a Pam quote. It is also the commit point that applies progression and saves.

## Context

Spec: GDD §15.3.

Page sections:
- Masthead: 'The Muckleford Mercury' plus the day ('MONDAY') and a week edition number.
- Headline: Kerbside Bold 2x, chosen from a pool by outcome. GDD §18.3 samples include 3★ 'STREETS SO CLEAN YOU COULD EAT YOUR CHIPS OFF THEM (PLEASE DON'T)', SACKED 'SWEEPER SACKED AFTER GRANNY STANDOFF' and TOWED 'BESSIE TOWED: ...', plus Gleaming, cat-incident and Doris lines. Final pools are authored in M6.
- District map: frontages green (>= 90%, colour 23) or red (18); pledges marked with rosettes; Bessie's route as a faint trail (proposed).
- 'By the numbers': Tidy %, stars (jng.star per star as they stamp on), score, best chain, complaints.
- 'Wages and tips': wage, pledge tips, tipping fees, star bonus, Lost Property and total, from the progression ledger, with sfx.coin per line.
- Letters snippet: the Lost Property owner's thank-you (Mon Doris, Tue businessman, Wed gasworks foreman, Thu cat's owner, Fri tearful child, Sat reveller, Sun the Mayor; ENTITY §13.1), or a complaint letter from the most-annoyed NPC type (proposed).
- One Pam quote.
- A 'Pinched by Sid/gulls' count when > 0 (ENTITY §17 Q6).
- A 'Top Tipper' stamp when Pam's Target (pamTarget in districts.json, the 3★ band) is beaten (GDD §12.1, no £).

Buttons: Skip Run (completed shifts only), Workshop, Try Again (skips the intro card) and Week Map. After SACKED/TOWED, Try Again has default focus. Until SSP-198 lands, the Skip Run button is hidden behind a registry check (SkipRunScene not registered); SSP-198 enables it. SACKED!/TOWED! are rubber-stamp letters in 18 across the page at a 2-step pixel tilt, drawn rather than rotated.

Audio (AUDIO §8.4): jng.tally -> jng.star x n -> mus.workshop base at -6 dB, or jng.sacked/jng.towed. Skip missing audio IDs silently until they are rendered.

Art (ART_BIBLE §12.4): ui.panel_paper (07 fill, 06 shade, 00 border); masthead Kerbside Bold 00 on 07; body Kerbside 5x7; stars and £ in 15/16. Newspaper photo art comes from Codex `art.*` goldens with Bayer halftone; use a placeholder under the final ID until SSP-229.

CONFLICT to resolve: GDD §15.3 says 'Codex-generated masthead art plus live text', while ART_BIBLE says the masthead is Kerbside Bold. CLAUDE.md forbids generated text, so all lettering is Kerbside and Codex art is only decoration and photos; record the resolution in the GDD.

Headline pools need a home the docs do not name: propose src/data/mercury.json and add it to TECHNICAL_DESIGN §2. Headline choice must be deterministic (from the shift seed and result) so the golden is stable. Visual golden `mercury_tally` (`?test=1&scene=mercury_tally&freeze=1`, fixed fixture result) at pixelmatch threshold 0; open expected/actual/diff with Read before approving. On entry, call progression applyShiftResult and save (tally committed).

## Scope

- src/scenes/TallyScene.ts: Mercury layout with every GDD §15.3 section and the four buttons
- Live district map renderer for frontage status and pledge rosettes (can reuse src/ui/minimap.ts)
- Headline pool data file with the GDD §18.3 samples plus at least 3 lines per outcome, and deterministic selection
- SACKED/TOWED stamp, Top Tipper stamp, Pinched count
- Apply progression and save on entry; Skip Run button only after a completed shift and only once SkipRunScene is registered
- mercury_tally visual scene, spec and golden

## Out of scope

- Cut-down Free Sweep variant (SSP-196)
- Final Mercury photo art (SSP-229)
- Trophy headline flow (SSP-216)
- Rendering jng.star / jng.towed (SSP-195)
- SkipRunScene itself (SSP-198)

## Acceptance criteria

- [ ] The mercury_tally fixture frame contains every GDD §15.3 section (masthead, headline, map, both columns, letters, Pam quote), checked by a Read review of the frame noted in the PR
- [ ] Frontages >= 90% render in index 23 and < 90% in 18 on the map, and pledges show rosettes (pixel assertions in the visual spec)
- [ ] Ledger lines equal the progression ledger for the fixture and sum to the total (unit test)
- [ ] After SACKED or TOWED, Try Again has focus and Skip Run is absent (e2e)
- [ ] The same fixture result always selects the same headline (unit test)
- [ ] mercury_tally passes at threshold 0 on ten consecutive identical runs
- [ ] The save is written exactly once per tally, and progression is applied exactly once (spy test)
- [ ] GDD §15.3 records the masthead lettering resolution

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:visual
- npm run test:e2e

## Dependencies

**Depends on:**

- [SSP-186](SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub
- [SSP-187](SSP-187-progression-economy.md) Add districts.json, upgrades.json and pure week progression and £ ledger
- [SSP-071](../M2/SSP-071-intro-tally-scenes.md) Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry
- [SSP-064](../M2/SSP-064-tidy-frontages.md) Compute Tidy %, per-frontage clean % and Clean Sweep bonuses incrementally
- [SSP-142](../M4/SSP-142-font-kerbside-5x7.md) Finalise Kerbside 5x7 glyphs, metrics and kerning
- [SSP-143](../M4/SSP-143-font-kerbside-bold-8x8.md) Write Kerbside Bold 8x8 glyphs, metrics and kerning
- [SSP-144](../M4/SSP-144-ui-icons-panels.md) HUD icons, 9-slice panels, button states and complaint stamp grids
- [SSP-172](../M5/SSP-172-jingles-vs.md) Compose jng.shift_start, jng.tally and jng.sacked jingles
- [SSP-165](../M5/SSP-165-sfx-feedback-ui.md) Author the 8 game-feedback and UI SFX sources
- [SSP-173](../M5/SSP-173-mixer-buses-ducking.md) Implement mixer.ts: bus graph, limiter, settings levels and ducking engine
- [SSP-285](../M3/SSP-285-ui-panels-9slice.md) Implement src/ui/panels.ts 9-slice panels and button states with placeholder panel grids
- [SSP-286](../M3/SSP-286-menu-navigation.md) Implement src/ui/menus.ts: keyboard, gamepad and mouse menu navigation plus input-device glyphs
- [SSP-291](../M4/SSP-291-hud-minimap.md) Implement src/ui/minimap.ts: runtime 64×64 district minimap in the single UI draw

**Blocks:**

- [SSP-195](SSP-195-audio-jingles-star-towed.md) Compose jng.star and jng.towed and wire them to the tally and TOWED end state
- [SSP-196](SSP-196-free-sweep.md) Add Free Sweep mode: untimed, no complaints, Pause -> Finish Sweep, cut-down Mercury
- [SSP-198](SSP-198-skip-run.md) Implement SkipRunScene: 45 s cone slalom and reverse-park bays with £5/£50 payouts
- [SSP-216](SSP-216-sunday-finale-trophy.md) Implement the Sunday Inspection Score and the Tidy Town Trophy award
- [SSP-229](SSP-229-art-mercury-portraits.md) Art Pass 2: Mercury newspaper art and portraits for Sid, Doris and the Inspector
- [SSP-230](SSP-230-art-ui-meta.md) Art Pass 2: final UI art for the Week Map, Workshop and Mercury
- [SSP-238](../M7/SSP-238-assists-tally-save.md) Flag assists on the Mercury tally and store assisted bests separately
- [SSP-245](../M7/SSP-245-song-civic-trophy.md) Compose mus.civic_quarter "Clipboard March" and the jng.trophy jingle
- [SSP-252](../M7/SSP-252-content-ip-review.md) Run the PEGI 7 / ESRB E10+ content review and extend IP hygiene checks
- [SSP-262](../M8/SSP-262-touch-menus-prompts.md) Make every menu and prompt usable by tap, with touch-aware glyphs
- [SSP-275](../M9/SSP-275-mode-plumbing.md) Add Daily Shift and Rival Sweep mode plumbing: params, timer, replay, save
- [SSP-278](../M9/SSP-278-daily-shift-flow.md) Ship the Daily Shift mode: Title entry, intro card, shift, tally, local best
- [SSP-281](../M9/SSP-281-rival-sweep-flow.md) Ship the Rival Sweep mode: district pick, 180 s duel HUD, winner tally

## References

- ../../GDD.md#153-tally-screen-the-muckleford-mercury
- ../../GDD.md#183-writing-samples
- ../../GDD.md#121-stars-per-district
- ../../ART_BIBLE.md#124-screens
- ../../ENTITY_CATALOG.md#131-lost-property-one-per-district
- ../../ENTITY_CATALOG.md#17-open-questions
- ../../AUDIO_DESIGN.md#84-scene--audio-map
- ../../TECHNICAL_DESIGN.md#184-visual-headless-screenshot-tests

## Roadmap tasks covered

- `TallyScene` as the Mercury front page: headline, district map with frontages green or red, stars, £ earned, Lost Property thank-you line.
