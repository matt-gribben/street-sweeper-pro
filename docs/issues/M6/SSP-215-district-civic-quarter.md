---
id: SSP-215
title: "Author and compile district.civic_quarter, the Sunday finale map"
milestone: M6
status: todo
type: feature
estimate: L
labels: [type:feature, area:gameplay, area:perf, area:test, size:L]
depends_on: [SSP-190, SSP-189, SSP-196, SSP-214, SSP-213, SSP-207, SSP-211, SSP-199, SSP-200, SSP-201, SSP-188, SSP-083, SSP-084, SSP-085, SSP-086, SSP-087, SSP-088, SSP-125, SSP-126]
blocks: [SSP-226, SSP-227, SSP-228, SSP-231, SSP-232, SSP-302, SSP-245, SSP-247, SSP-248, SSP-277, SSP-280]
---

# SSP-215: Author and compile district.civic_quarter, the Sunday finale map

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** L · **Areas:** gameplay, perf, test

## Summary

Author the biggest map, the Civic Quarter on inspection morning, with every NPC type, the Inspector's route, the parade and the lollipop crossing, and commit its replay.

## Context

LEVEL_DESIGN §5.7.
Layout: 128x96.
- Civic Way: a 4-tile boulevard from the depot (south edge) to the Town Hall steps (the parade route), 10 tiles facade to facade.
- Civic Square: a cobbled plaza with planters, bollards and benches.
- Jubilee Park: ~30x20 with paths, a pond `~`, trees and dog walkers.
- Chapel Street: the site.school_crossing (`k`) and npc.lollipop_lady.
- Edge quarters quote earlier days: a terrace row, a shopping street with a bus stop, a roadworks patch, a tree avenue, a takeaway corner.
- The Inspector's route: ~170 m / ~28 frontages.
- Heights 3-6. The Town Hall tower is 8 storeys with landmark roof.town_hall.
Litter 300 (~360 LU): every Sunday-member litter type, weighted toward crisps, cans and butts; dynamic ~40. Grime 14,500. 30 stains (gum, milkshake, oil, chalk).
Hazards: 10 puddles, 6 potholes, 2 oil slicks, 1 open manhole (roadworks), speed bumps on Chapel Street.
Skips 3 / hydrants 6. Power-ups 3 (full pool). Frontages 84 / pledges 20.
Lost Property: collect.mayors_chain in Jubilee Park by the pond. Golden Crisp: on the Town Hall steps, reachable only while the Inspector is away from the square (after ~90 s).
Every NPC type appears at least once at lower counts: ~72 NPCs and 28 vehicles (12 moving + 16 parked) at peak (budgets 80/30).
Timeline: crossing_patrol 20-80 s; ice cream van at 45 s; inspection from 60 s; parade 120-170 s along Civic Way; the Inspector finishes at ~230 s; crossing_patrol 200-240 s (L081 warns on events later than 200 s, so a 200 s start is fine).
Par (Sun loadout + hopper L2, 180 LU): 1★ 125 s, 2★ 180 s, 3★ 230 s (10 s slack), 100% 350 s. Set par {star1 125, star2 180, star3 230, perfectMin 260} with the Sun loadout. L060/L061/L062 as in LEVEL_DESIGN §10.3.
Bands 16,500 / 23,000 / 30,000 before Inspector deductions. mus.civic_quarter is owed to M7, so mus.workshop plays as the fallback; ambience amb.town_morning with church bells at the start. The intro card shows the Inspector's route. This is also the heaviest district for M7 perf (ROADMAP M7), so keep the stress budgets honest now. Run the LEVEL_DESIGN §12 checklist.

## Scope

- assets-src/levels/civic_quarter.map.txt and civic_quarter.level.json, with the par block
- Collectibles, intro text, placeholder roof.town_hall and civic facades if missing
- Route file and committed tests/replay/replays/m6_civic_quarter.json 3★ replay
- Par report, screenshot review and budget report (peak NPCs and vehicles)

## Out of scope

- mus.civic_quarter (M7)
- Final landmark and facade art
- M7 performance optimisation

## Acceptance criteria

- [ ] npm run levels passes, and every catalog NPC type is present in the spawn tables or named NPCs
- [ ] The budget report shows peak NPCs <= 80 and vehicles <= 30 (L050)
- [ ] Par report: 3★ estimate <= 230 s (L060 and checklist); 100% par > 260 s (L061); 1★ <= 125 s
- [ ] Pledges = 20 and SSP-096 = 3; collectibles pass L041
- [ ] m6_civic_quarter.json reaches >= 92 Tidy % and passes test:replay, with a score within ±25% of 30,000 before deductions
- [ ] The zero-allocation replay heap check passes on this replay
- [ ] Free Sweep loads (inspection and parade skipped) without errors
- [ ] The checklist is ticked in the PR

## Verification

- npm run levels
- npm run assets:verify
- npm run test:replay
- npm test
- npm run test:e2e

## Dependencies

**Depends on:**

- [SSP-190](SSP-190-compiler-m6.md) Extend compile-level for M6: skip_run mode, night lamp pools, landmarks, M6 events
- [SSP-189](SSP-189-scripted-runs.md) Generalise scripted-run authoring for district replays, balance runs and week e2e
- [SSP-196](SSP-196-free-sweep.md) Add Free Sweep mode: untimed, no complaints, Pause -> Finish Sweep, cut-down Mercury
- [SSP-214](SSP-214-inspector.md) Implement npc.inspector and the inspection event with frontage deductions
- [SSP-213](SSP-213-lollipop-crossing-parade.md) Implement npc.lollipop_lady, site.school_crossing, crossing_patrol and parade
- [SSP-207](SSP-207-ice-cream-van.md) Implement veh.ice_cream_van, its parked variant and the vehicle_stop event
- [SSP-211](SSP-211-reveller-police.md) Implement npc.reveller, kicking_out, veh.police witness rule and police_parked
- [SSP-199](SSP-199-people-kids-jogger.md) Implement npc.jogger, npc.kid_skateboard, npc.kid_chalk and school_out/population_wave
- [SSP-200](SSP-200-dog-loose-seagull.md) Implement npc.dog_loose chase and npc.seagull chip theft and litter snatching
- [SSP-201](SSP-201-bin-lorry.md) Implement veh.bin_lorry and the bin_round event
- [SSP-188](SSP-188-upgrade-modifiers.md) Apply upg.* levels to the sim via tuning.ts modifiers and record loadout in replays
- [SSP-083](../M3/SSP-083-behaviour-doris.md) Implement Doris (npc.old_woman): glare, fist-shake slowdown, spray chase, handbag whack
- [SSP-084](../M3/SSP-084-behaviour-shopper-businessman-litterbug.md) Implement shopper, businessman and litterbug behaviours, including the Caught! bonus
- [SSP-085](../M3/SSP-085-behaviour-old-man-mum-postie.md) Implement old man, mum with pushchair and postie, and the occupied-zebra penalty
- [SSP-086](../M3/SSP-086-behaviour-dog-walker.md) Implement the dog walker with a lead line obstacle, Lead Tangle and dog mess drops
- [SSP-087](../M3/SSP-087-behaviour-cat.md) Implement the cat: perch, dart on approach, groom, bolt, and ride Bessie's roof
- [SSP-088](../M3/SSP-088-behaviour-market-trader-pigeon.md) Implement market trader (with market close pile) and pigeon flocks with Pigeon Scatter
- [SSP-125](../M4/SSP-125-facades-old-town.md) Old Town terrace facade modules and the pledge rosette (Puddle Lane)
- [SSP-126](../M4/SSP-126-facades-high-street.md) High Street shopfront facade modules and facade sets

**Blocks:**

- [SSP-226](SSP-226-art-facades-m6.md) Art Pass 2: facade module sets for every remaining building style
- [SSP-227](SSP-227-art-signs-decals-m6.md) Art Pass 2: shop signs and road decals for the Wed-Sun districts
- [SSP-228](SSP-228-art-landmark-roofs.md) Art Pass 2: landmark roofs for the Town Hall, Pier and Depot via Codex goldens
- [SSP-231](SSP-231-balance-pass.md) Full-week balance pass: competent runs, £ curve, par constants and score bands
- [SSP-232](SSP-232-week-spec-e2e.md) Write tests/e2e/week.spec.ts: scripted save from Monday to the Tidy Town Trophy
- [SSP-302](SSP-302-district-idea-barks.md) Extend Pam's prompt layer to the Tue–Sun 'new idea' barks and author them per district
- [SSP-245](../M7/SSP-245-song-civic-trophy.md) Compose mus.civic_quarter "Clipboard March" and the jng.trophy jingle
- [SSP-247](../M7/SSP-247-perf-stress-civic.md) Extend perf.spec.ts to Civic Quarter with the 2,000/80/30 stress load
- [SSP-248](../M7/SSP-248-perf-optimise.md) Profile and optimise until the M7 performance budgets hold
- [SSP-277](../M9/SSP-277-daily-modifiers.md) Implement Daily Shift modifiers as level knob overrides and extra events
- [SSP-280](../M9/SSP-280-rival-ai-controller.md) Build Sid's Rival Sweep AI on the lane graph and LitterField

## References

- ../../LEVEL_DESIGN.md#57-sun-civic-quarter-districtcivic_quarter-finale
- ../../LEVEL_DESIGN.md#45-per-district-event-timelines
- ../../LEVEL_DESIGN.md#61-per-district-numbers
- ../../LEVEL_DESIGN.md#103-validation-rules
- ../../LEVEL_DESIGN.md#79-sight-lines-and-the-camera
- ../../LEVEL_DESIGN.md#12-level-design-checklist
- ../../TECHNICAL_DESIGN.md#17-performance-budgets

## Roadmap tasks covered

- Author and compile ... `civic_quarter` ... (civic_quarter)
- Lost Property `collect.*` and one `collect.golden_crisp` placed per district. (Sun)
