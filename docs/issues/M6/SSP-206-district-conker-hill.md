---
id: SSP-206
title: "Author and compile district.conker_hill (Thursday, wind and leaf fall)"
milestone: M6
status: todo
type: feature
estimate: L
labels: [type:feature, area:gameplay, area:test, size:L]
depends_on: [SSP-190, SSP-189, SSP-196, SSP-205, SSP-199, SSP-200, SSP-201, SSP-188, SSP-085, SSP-086, SSP-087, SSP-131]
blocks: [SSP-226, SSP-231, SSP-232, SSP-302, SSP-248, SSP-277, SSP-280]
---

# SSP-206: Author and compile district.conker_hill (Thursday, wind and leaf fall)

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** L · **Areas:** gameplay, test

## Summary

Author Thursday's leafy suburb, with tree-lined avenues, cul-de-sacs, The Rec and a primary school, where dog leads, loose dogs, chalking kids and leaf fall provide the pressure.

## Context

LEVEL_DESIGN §5.4.
Layout: 96x72.
- Horse Chestnut Avenue and Acorn Crescent: tree-lined 3-tile roads with grass verges.
- Four cul-de-sacs, 8-12 tiles long, each with a 5x5 turning head (L014).
- The Rec: ~24x16 (grass, path loop).
- School Lane runs past the primary school (the school_out anchor), with speed bumps.
- Depot on the west edge; 2 storeys throughout.
Litter 220 (~320 LU incl. leaf fall). Table: leaf pile 30, crisp 18, can 12, plastic 10, butts 10, newspaper 8, dog mess 12. Leaf fall up to +40; dog mess every 40-60 s per walker.
Grime 11,000. stain.chalk_art from up to 4 kid_chalk from 75 s (chalk spots sit on pledge frontages). 8 potholes. Skips 2 / hydrants 3. Power-ups 2 (hi-vis, flask of tea, wrench). Frontages 72 / pledges 16.
Lost Property: collect.cat_collar at the foot of a garden wall in Laburnum Close. Golden Crisp: in the densest leaf-pile cluster in The Rec.
NPC peaks: cat 10, dog_walker 6 (leads up to 5 m), dog_loose 3, kid_chalk 4, kid_skateboard 3, jogger 4, shopper 6, mum_pushchair 3, postie 2, Doris 1. Moving traffic 7 (cars 5, van_white 1, bin_lorry 1 on a light bin_round); parked 20 (driveways `d` and kerbside). Knockables: 24 recycling boxes and 12 wheelie bins.
Timeline: leaf_fall every 4 s, max +40 (cont.); school_out at 75 s (4 chalkers, 3 skaters); dog walkers peak at 6 from 120 s; chalk kids leave 60-90 s after arrival.
Weather 'wind', timeOfDay afternoon.
Par (Thu loadout + gutter brooms L1, 2.9 m): 1★ 110 s, 2★ 165 s, 3★ 213 s, 100% 320 s. Set par {star1 110, star2 165, star3 213, perfectMin 260} with the Thu loadout. L060/L061/L062 as in LEVEL_DESIGN §10.3.
Bands 11,000 / 15,500 / 20,000. Music mus.conker_hill (falls back to mus.workshop until SSP-219); ambience amb.wind_leaves. Bark: 'Mind the dog leads. They stretch.' Add placeholder suburban facade sets if missing. Run the LEVEL_DESIGN §12 checklist.

## Scope

- assets-src/levels/conker_hill.map.txt and conker_hill.level.json, with the par block
- Collectibles, intro text, placeholder facades if missing
- Route file and committed tests/replay/replays/m6_conker_hill.json 3★ replay
- Par report and screenshot review

## Out of scope

- Final suburban facade art
- mus.conker_hill
- Authoring the Pam bark as a tutorial_beat event and its trigger (SSP-302)

## Acceptance criteria

- [ ] npm run levels passes, and every cul-de-sac has a 5x5 turning head (L014)
- [ ] Par report: 3★ estimate <= 213 s (checklist) and never > 230 s (L060); 100% par > 260 s (L061); 1★ <= 125 s
- [ ] Pledges = 16, at least two of them contested by chalk spots; any L031 warning resolved or explained
- [ ] m6_conker_hill.json reaches >= 92 Tidy % and passes test:replay, with a score within ±25% of 20,000
- [ ] Free Sweep loops leaf_fall without errors
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
- [SSP-205](SSP-205-wind-leaves-gusts.md) Implement leaf fall, wet leaves and haz.wind_gust litter drift
- [SSP-199](SSP-199-people-kids-jogger.md) Implement npc.jogger, npc.kid_skateboard, npc.kid_chalk and school_out/population_wave
- [SSP-200](SSP-200-dog-loose-seagull.md) Implement npc.dog_loose chase and npc.seagull chip theft and litter snatching
- [SSP-201](SSP-201-bin-lorry.md) Implement veh.bin_lorry and the bin_round event
- [SSP-188](SSP-188-upgrade-modifiers.md) Apply upg.* levels to the sim via tuning.ts modifiers and record loadout in replays
- [SSP-085](../M3/SSP-085-behaviour-old-man-mum-postie.md) Implement old man, mum with pushchair and postie, and the occupied-zebra penalty
- [SSP-086](../M3/SSP-086-behaviour-dog-walker.md) Implement the dog walker with a lead line obstacle, Lead Tangle and dog mess drops
- [SSP-087](../M3/SSP-087-behaviour-cat.md) Implement the cat: perch, dart on approach, groom, bolt, and ride Bessie's roof
- [SSP-131](../M4/SSP-131-blender-props-stacks.md) Blender sprite-stack props: lamp post, phone box, tree, bus shelter, stall

**Blocks:**

- [SSP-226](SSP-226-art-facades-m6.md) Art Pass 2: facade module sets for every remaining building style
- [SSP-231](SSP-231-balance-pass.md) Full-week balance pass: competent runs, £ curve, par constants and score bands
- [SSP-232](SSP-232-week-spec-e2e.md) Write tests/e2e/week.spec.ts: scripted save from Monday to the Tidy Town Trophy
- [SSP-302](SSP-302-district-idea-barks.md) Extend Pam's prompt layer to the Tue–Sun 'new idea' barks and author them per district
- [SSP-248](../M7/SSP-248-perf-optimise.md) Profile and optimise until the M7 performance budgets hold
- [SSP-277](../M9/SSP-277-daily-modifiers.md) Implement Daily Shift modifiers as level knob overrides and extra events
- [SSP-280](../M9/SSP-280-rival-ai-controller.md) Build Sid's Rival Sweep AI on the lane graph and LitterField

## References

- ../../LEVEL_DESIGN.md#54-thu-conker-hill-districtconker_hill
- ../../LEVEL_DESIGN.md#45-per-district-event-timelines
- ../../LEVEL_DESIGN.md#62-par-times-the-target-times
- ../../LEVEL_DESIGN.md#103-validation-rules
- ../../LEVEL_DESIGN.md#710-frontages
- ../../LEVEL_DESIGN.md#12-level-design-checklist

## Roadmap tasks covered

- Author and compile ... `conker_hill` ... (conker_hill)
- Lost Property `collect.*` and one `collect.golden_crisp` placed per district. (Thu)
