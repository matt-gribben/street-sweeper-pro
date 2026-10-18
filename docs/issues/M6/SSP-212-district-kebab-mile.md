---
id: SSP-212
title: "Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden"
milestone: M6
status: todo
type: feature
estimate: L
labels: [type:feature, area:gameplay, area:render, area:test, size:L]
depends_on: [SSP-190, SSP-189, SSP-196, SSP-210, SSP-211, SSP-188, SSP-091, SSP-087, SSP-023]
blocks: [SSP-226, SSP-227, SSP-231, SSP-232, SSP-233, SSP-302, SSP-244, SSP-248, SSP-260, SSP-277, SSP-280]
---

# SSP-212: Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** L · **Areas:** gameplay, render, test

## Summary

Author Saturday's town centre after the pubs close, fully night-remapped, with overlapping lamp pools on main streets and dark alleys, plus the night_kebab_mile visual golden.

## Context

LEVEL_DESIGN §5.6.
Layout: 96x80.
- Bridge Street is the main drag: a 4-tile road with 2-tile pavements, the taxi rank (a long `p` run reserved for veh.taxi) and the pub doors, which are the kicking_out anchors (The Mucky Duck and The Dog & Dustpan, both fictional).
- The Shambles is a grid of narrow 3-tile streets with alleys behind the takeaways (the densest litter).
- One prop.lamp_post every 5-6 tiles (10-12 m) on main streets so the pools overlap; back alleys are deliberately dark.
- Depot on the north edge. 3-5 storeys; Bridge Street is 8 tiles facade to facade.
Litter 250 (~340 LU incl. dynamic). Table: kebab wrapper 18, pizza box 12, chip wrapper 12, glass bottle 12, can 12, butts 12, crisp 10, plastic 6, bin bag 6. Dynamic ~80 from revellers, mostly after 150 s.
Grime 13,000. 30 stain.gum. Broken glass from flung bottles. Skips 2 / hydrants 3. Power-ups 2 (wrench, hi-vis, flask of tea). Frontages 58 / pledges 14.
Lost Property: collect.lost_shoe in the taxi rank. Golden Crisp: in the darkest alley behind the nightclub, outside every lamp pool, found with the headlights. L072 covers hazards and litter hotspots, not collectibles; darkness may hide the Golden Crisp but never a penalty.
NPC peaks: reveller 8 -> 32 after kicking_out (150-180 s), cat 5. Moving traffic 16 (taxi 6, police 2 on a patrol loop with the second from 90 s, bicycle 3 couriers, cars 5); parked 12. Knockables: 16 wheelie bins, 4 trolleys.
Night rule (L072): every hazard and litter hotspot sits inside a lamp pool or is flagged darkOk (the placement-level darkOk added by SSP-190). The police patrol loop avoids the densest litter streets. timeOfDay night.
Par (Sat loadout + suction L1): 1★ 120 s, 2★ 175 s, 3★ 225 s, 100% 335 s. Set par {star1 120, star2 175, star3 225, perfectMin 260} with the Sat loadout. L060/L061/L062 as in LEVEL_DESIGN §10.3.
Bands 15,500 / 22,000 / 28,500. mus.kebab_mile is owed to M7, so mus.workshop plays as the fallback; ambience amb.night_town. Bark: 'Can't see a thing. Stick under the street lamps.'
Visual golden `night_kebab_mile` (TECHNICAL_DESIGN §18.4): fixed seed, frozen tick and a pinned camera (__ssp.setCamera) on Bridge Street; pixelmatch threshold 0; open expected/actual/diff with Read before approving. SSP-233 re-approves it after Art Pass 2. Run the LEVEL_DESIGN §12 checklist.

## Scope

- assets-src/levels/kebab_mile.map.txt and kebab_mile.level.json, with the par block
- Collectibles, intro text, placeholder facades and signs if missing
- Route file and committed tests/replay/replays/m6_kebab_mile.json 3★ replay
- tests/visual night_kebab_mile spec and golden
- Point perf.spec's dense scene at the real Kebab Mile if it used a stand-in

## Out of scope

- mus.kebab_mile (M7)
- Final pub, takeaway and sign art
- Authoring the Pam bark as a tutorial_beat event and its trigger (SSP-302)

## Acceptance criteria

- [ ] npm run levels passes L072 with zero unlit hazards or hotspots that are not darkOk
- [ ] Par report: 3★ estimate <= 225 s (checklist) and never > 230 s (L060); 100% par > 260 s (L061); 1★ <= 125 s
- [ ] Pledges = 14; collectibles pass L041; the Golden Crisp sits outside every lamp pool
- [ ] m6_kebab_mile.json reaches >= 92 Tidy % and passes test:replay, with a score within ±25% of 28,500
- [ ] night_kebab_mile passes at threshold 0 on ten identical runs
- [ ] perf.spec ci project: <= 10 draw calls on Kebab Mile
- [ ] Free Sweep loads (kicking_out skipped) without errors
- [ ] The checklist is ticked in the PR

## Verification

- npm run levels
- npm run assets:verify
- npm run test:replay
- npm run test:visual
- npm run test:e2e
- npm test

## Dependencies

**Depends on:**

- [SSP-190](SSP-190-compiler-m6.md) Extend compile-level for M6: skip_run mode, night lamp pools, landmarks, M6 events
- [SSP-189](SSP-189-scripted-runs.md) Generalise scripted-run authoring for district replays, balance runs and week e2e
- [SSP-196](SSP-196-free-sweep.md) Add Free Sweep mode: untimed, no complaints, Pause -> Finish Sweep, cut-down Mercury
- [SSP-210](SSP-210-night-lighting.md) Implement night: night remap with street-lamp and headlight light mask
- [SSP-211](SSP-211-reveller-police.md) Implement npc.reveller, kicking_out, veh.police witness rule and police_parked
- [SSP-188](SSP-188-upgrade-modifiers.md) Apply upg.* levels to the sim via tuning.ts modifiers and record loadout in replays
- [SSP-091](../M3/SSP-091-traffic-special-kinds.md) Add taxi fare stops, white van pavement parking, bicycle filtering and mobility scooter
- [SSP-087](../M3/SSP-087-behaviour-cat.md) Implement the cat: perch, dart on approach, groom, bolt, and ride Bessie's roof
- [SSP-023](../M0/SSP-023-perf-baseline.md) Baseline perf.spec.ts on the dev Mac GPU and set the p99 frame-time budget (D-08)

**Blocks:**

- [SSP-226](SSP-226-art-facades-m6.md) Art Pass 2: facade module sets for every remaining building style
- [SSP-227](SSP-227-art-signs-decals-m6.md) Art Pass 2: shop signs and road decals for the Wed-Sun districts
- [SSP-231](SSP-231-balance-pass.md) Full-week balance pass: competent runs, £ curve, par constants and score bands
- [SSP-232](SSP-232-week-spec-e2e.md) Write tests/e2e/week.spec.ts: scripted save from Monday to the Tidy Town Trophy
- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag
- [SSP-302](SSP-302-district-idea-barks.md) Extend Pam's prompt layer to the Tue–Sun 'new idea' barks and author them per district
- [SSP-244](../M7/SSP-244-song-kebab-mile.md) Compose and render mus.kebab_mile "Kebab O'Clock" with adaptive stems
- [SSP-248](../M7/SSP-248-perf-optimise.md) Profile and optimise until the M7 performance budgets hold
- [SSP-260](../M8/SSP-260-touch-controls-overlay.md) Draw the touch control overlay in internal pixel space via the UI pass
- [SSP-277](../M9/SSP-277-daily-modifiers.md) Implement Daily Shift modifiers as level knob overrides and extra events
- [SSP-280](../M9/SSP-280-rival-ai-controller.md) Build Sid's Rival Sweep AI on the lane graph and LitterField

## References

- ../../LEVEL_DESIGN.md#56-sat-kebab-mile-districtkebab_mile
- ../../LEVEL_DESIGN.md#45-per-district-event-timelines
- ../../LEVEL_DESIGN.md#103-validation-rules
- ../../LEVEL_DESIGN.md#96-power-ups-and-collectibles
- ../../ART_BIBLE.md#13-night-weather-and-time-of-day
- ../../TECHNICAL_DESIGN.md#184-visual-headless-screenshot-tests
- ../../TECHNICAL_DESIGN.md#186-e2e

## Roadmap tasks covered

- Author and compile ... `kebab_mile` ... (kebab_mile)
- Lost Property `collect.*` and one `collect.golden_crisp` placed per district. (Sat)
