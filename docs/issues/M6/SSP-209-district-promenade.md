---
id: SSP-209
title: "Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)"
milestone: M6
status: todo
type: feature
estimate: L
labels: [type:feature, area:gameplay, area:test, size:L]
depends_on: [SSP-190, SSP-189, SSP-196, SSP-205, SSP-200, SSP-207, SSP-208, SSP-199, SSP-188, SSP-089, SSP-091, SSP-088, SSP-111, SSP-130, SSP-131]
blocks: [SSP-226, SSP-227, SSP-228, SSP-231, SSP-232, SSP-302, SSP-243, SSP-248, SSP-277, SSP-280]
---

# SSP-209: Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** L · **Areas:** gameplay, test

## Summary

Author Friday's seafront, with the long Marine Parade, the Pier dead end, the arcade row and Winkle Street, plus gusts, seagulls, the ice cream van and Spotless Sid's cameo.

## Context

LEVEL_DESIGN §5.5.
Layout: 112x64, the widest map, built for transit.
- Marine Parade runs the full width: a 4-tile road with a 3-tile promenade pavement on the sea side behind railings `r`. The beach `_` is out of bounds.
- The Pier juts south from the centre: a 4-tile-wide pavement deck (drivable, no traffic), 30 tiles long, with a turning space at the end.
- Arcade row on the land side (2-4 storeys), with back lane Winkle Street and the skips.
- Depot on the west edge; a second dump option is one skip at the far east end.
Litter 240 (~300 LU). Table: chip wrapper 22, newspaper 18, crisp 15, can 12, plastic 10, butts 8, banana 5, lolly stick 10. Dynamic ~50.
Grime 11,500, spread along the Parade. 12 stain.milkshake. Gusts at 40/95/150/205 s from the south. Skips 2 / hydrants 4. Power-ups 3 (bacon butty, super suction, flask of tea, water can). Frontages 52 / pledges 12.
Lost Property: collect.bucket_and_spade at the pier end. Golden Crisp: behind the bandstand, in a 1-tile-wide, 2-tile-deep gap between the railings and the bandstand base (Bessie's 1.75 m body just fits). Possible conflict: L015 rejects a 1-tile alley mouth Bessie can enter unless it is bollarded or bounded by buildings. Resolve it (for example with a legend override, or by treating the bandstand as a building) and note it.
NPC peaks: seagull 10, pigeon 3 flocks of 6-10, shopper 14, jogger 5, kid_skateboard 4 (+ ice cream kids). Moving traffic 10 (bus 2, ice cream van 1 with two stops, mobility scooter 2, cars 4, rival_sweeper 1 at 110-170 s); parked 12.
Timeline: gusts 40/95/150/205; ice cream van stops at 55 s and 165 s; Sid 110-170 s on the eastern half.
Weather 'gusts', timeOfDay golden_hour. The Pier uses landmark roof.pier (placeholder until SSP-228).
Par (Fri loadout + engine L1, transit 9.35 m/s): 1★ 115 s, 2★ 170 s, 3★ 216 s, 100% 330 s. Set par {star1 115, star2 170, star3 216, perfectMin 260} with the Fri loadout. L060/L061/L062 as in LEVEL_DESIGN §10.3.
Bands 12,500 / 17,500 / 23,000. mus.promenade is owed to M7, so the district falls back to mus.workshop; ambience amb.seafront. Run the LEVEL_DESIGN §12 checklist.

## Scope

- assets-src/levels/promenade.map.txt and promenade.level.json, with the par block
- Collectibles, intro text, placeholder facades and roof.pier if missing
- Route file and committed tests/replay/replays/m6_promenade.json 3★ replay
- Par report and screenshot review

## Out of scope

- mus.promenade (M7)
- Final arcade and pier art

## Acceptance criteria

- [ ] npm run levels passes; any L015 exemption for the bandstand gap is documented in LEVEL_DESIGN
- [ ] Par report: 3★ estimate <= 216 s (checklist) and never > 230 s (L060); 100% par > 260 s (L061); 1★ <= 125 s
- [ ] Pledges = 12 and SSP-096 = 3; collectibles pass L041
- [ ] m6_promenade.json reaches >= 92 Tidy % and passes test:replay, with a score within ±25% of 23,000
- [ ] Music falls back to mus.workshop with no missing-asset errors
- [ ] Free Sweep loads and loops gusts and vehicle_stop without errors
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
- [SSP-200](SSP-200-dog-loose-seagull.md) Implement npc.dog_loose chase and npc.seagull chip theft and litter snatching
- [SSP-207](SSP-207-ice-cream-van.md) Implement veh.ice_cream_van, its parked variant and the vehicle_stop event
- [SSP-208](SSP-208-rival-sweeper-cameo.md) Implement veh.rival_sweeper Friday cameo and the rival_cameo event
- [SSP-199](SSP-199-people-kids-jogger.md) Implement npc.jogger, npc.kid_skateboard, npc.kid_chalk and school_out/population_wave
- [SSP-188](SSP-188-upgrade-modifiers.md) Apply upg.* levels to the sim via tuning.ts modifiers and record loadout in replays
- [SSP-089](../M3/SSP-089-traffic-lane-following.md) Implement traffic.ts: lane following, queuing behind Bessie, honk, Road Rage, bus stops
- [SSP-091](../M3/SSP-091-traffic-special-kinds.md) Add taxi fare stops, white van pavement parking, bicycle filtering and mobility scooter
- [SSP-088](../M3/SSP-088-behaviour-market-trader-pigeon.md) Implement market trader (with market close pile) and pigeon flocks with Pigeon Scatter
- [SSP-111](../M4/SSP-111-forge-build-procedural.md) Harden the procedural technique: generator registry, params validation, fx play frames and a shared seam metric
- [SSP-130](../M4/SSP-130-blender-props-flat.md) Blender flat props: bench, planter and the skip
- [SSP-131](../M4/SSP-131-blender-props-stacks.md) Blender sprite-stack props: lamp post, phone box, tree, bus shelter, stall

**Blocks:**

- [SSP-226](SSP-226-art-facades-m6.md) Art Pass 2: facade module sets for every remaining building style
- [SSP-227](SSP-227-art-signs-decals-m6.md) Art Pass 2: shop signs and road decals for the Wed-Sun districts
- [SSP-228](SSP-228-art-landmark-roofs.md) Art Pass 2: landmark roofs for the Town Hall, Pier and Depot via Codex goldens
- [SSP-231](SSP-231-balance-pass.md) Full-week balance pass: competent runs, £ curve, par constants and score bands
- [SSP-232](SSP-232-week-spec-e2e.md) Write tests/e2e/week.spec.ts: scripted save from Monday to the Tidy Town Trophy
- [SSP-302](SSP-302-district-idea-barks.md) Extend Pam's prompt layer to the Tue–Sun 'new idea' barks and author them per district
- [SSP-243](../M7/SSP-243-song-promenade.md) Compose and render mus.promenade "Seagull Surf" with adaptive stems
- [SSP-248](../M7/SSP-248-perf-optimise.md) Profile and optimise until the M7 performance budgets hold
- [SSP-277](../M9/SSP-277-daily-modifiers.md) Implement Daily Shift modifiers as level knob overrides and extra events
- [SSP-280](../M9/SSP-280-rival-ai-controller.md) Build Sid's Rival Sweep AI on the lane graph and LitterField

## References

- ../../LEVEL_DESIGN.md#55-fri-the-promenade-districtpromenade
- ../../LEVEL_DESIGN.md#45-per-district-event-timelines
- ../../LEVEL_DESIGN.md#62-par-times-the-target-times
- ../../LEVEL_DESIGN.md#103-validation-rules
- ../../LEVEL_DESIGN.md#12-level-design-checklist

## Roadmap tasks covered

- Author and compile ... `promenade` ... (promenade)
- Lost Property `collect.*` and one `collect.golden_crisp` placed per district. (Fri)
