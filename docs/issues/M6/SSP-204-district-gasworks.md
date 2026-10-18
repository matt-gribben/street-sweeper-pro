---
id: SSP-204
title: "Author and compile district.gasworks (Wednesday, rain) with its district replay"
milestone: M6
status: todo
type: feature
estimate: L
labels: [type:feature, area:gameplay, area:test, size:L]
depends_on: [SSP-190, SSP-189, SSP-196, SSP-202, SSP-201, SSP-199, SSP-200, SSP-188, SSP-093, SSP-095, SSP-089, SSP-041]
blocks: [SSP-226, SSP-227, SSP-231, SSP-232, SSP-302, SSP-248, SSP-277, SSP-280]
---

# SSP-204: Author and compile district.gasworks (Wednesday, rain) with its district replay

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** L · **Areas:** gameplay, test

## Summary

Author Wednesday's Gasworks Estate: industrial units, tower blocks, a canal and roadworks in steady rain, with bin rounds, collectibles and a committed 3-star replay.

## Context

LEVEL_DESIGN §5.3 (initial values).
Layout: 96x72.
- Gasholder Road loop: 4-tile road, wide gutters, potholes, kerbside puddles.
- Units 1-12 on Coke Street, a dead end with a 5x5 turning head and covered, dusty loading yards (`%`) under canopies.
- Two 6-storey towers (Kestrel House, Heron House) on a podium, >= 8 tiles back from any road edge, with bin stores as the densest grime.
- Canal `~` with two bridges (pinch points with no pavement).
- Roadworks: 2 haz.open_manhole ringed by prop.roadworks_barrier and telegraphed by cones 20 m before (L070).
- Depot on the east edge; units 2-4 storeys.
Litter 210 (~260 LU). Table: crisp 20, can 18, butts 15, plastic 12, newspaper 10, glass 10, bin bag 15.
Grime 12,000. 10 stain.oil, each on the same tile as a haz.oil_slick.
Hazards: 30 puddle, 18 pothole, 10 oil slick, 2 open manhole; road grip 6.0 (rain); dust on `%`.
Skips 2 / hydrants 4 (a sensible route passes one every 60-90 s). Power-ups 2 (wrench, water can, super suction). Frontages 34 / pledges 10.
Lost Property: collect.hard_hat inside the Coke Street turning head. Golden Crisp: under the second canal bridge on the towpath (a 2-tile pavement strip reached via a dropped kerb).
NPC peaks: shopper 8, kid_skateboard 3 (+3 at 140 s), litterbug 3, dog_loose 2 (tower podium). Moving traffic 10 (bin_lorry 2, van_white 3, cars 5); parked 16 (vans half on pavements). Knockables: 40 wheelie bins at kerbs, 4 trolleys.
Timeline (§4.5): rain (cont.); bin_round at 15 s (2 lorries); second lorry at 70 s; skater wave at 140 s; lorries return from 200 s.
Weather 'rain'. 'Overcast' is not a timeOfDay schema value (schema: dawn, morning, late_morning, afternoon, golden_hour, night), so use the closest allowed value and note it.
Par (Wed loadout = Tue, hopper L1): 1★ 105 s, 2★ 160 s, 3★ 208 s, 100% 310 s. Set par {star1 105, star2 160, star3 208, perfectMin 260} with the Wed loadout. L060/L061/L062 as in LEVEL_DESIGN §10.3.
Score bands 12,000 / 17,000 / 22,000. Music mus.gasworks (falls back to mus.workshop until SSP-218 lands); ambience amb.rain. Intro card hint on dust and spray; bark 'Roads are slippy in this rain. Brake early.' Add placeholder facade sets for industrial units and tower blocks (placeholder: true) if missing; SSP-226 replaces them. Run the LEVEL_DESIGN §12 checklist.

## Scope

- assets-src/levels/gasworks.map.txt and gasworks.level.json per §5.3, the Wed timeline and the par block
- Collectibles placement, intro text, placeholder facade/roof IDs if missing
- Route file and committed tests/replay/replays/m6_gasworks.json 3★ replay
- Par report in the PR; full-map screenshot reviewed with Read

## Out of scope

- Final facade art
- mus.gasworks composition
- Authoring the Pam bark as a tutorial_beat event and its trigger (SSP-302)

## Acceptance criteria

- [ ] npm run levels passes with no errors (L070 telegraph cones present, L007 milestone gate OK)
- [ ] Par report: 3★ estimate <= 208 s (checklist) and never > 230 s (L060); 100% par > 260 s (L061); 1★ <= 125 s
- [ ] Every route tile is within 200 m of a dump and 150 m of water (L020/L021)
- [ ] Pledges = 10; Lost Property and Golden Crisp pass L041
- [ ] m6_gasworks.json reaches >= 92 Tidy % and passes test:replay, with a score within ±25% of 22,000
- [ ] Free Sweep loads and loops bin_round without errors
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
- [SSP-202](SSP-202-rain-weather.md) Implement rain: road grip 6.0, puddle density, rain FX and amb.rain hookup
- [SSP-201](SSP-201-bin-lorry.md) Implement veh.bin_lorry and the bin_round event
- [SSP-199](SSP-199-people-kids-jogger.md) Implement npc.jogger, npc.kid_skateboard, npc.kid_chalk and school_out/population_wave
- [SSP-200](SSP-200-dog-loose-seagull.md) Implement npc.dog_loose chase and npc.seagull chip theft and litter snatching
- [SSP-188](SSP-188-upgrade-modifiers.md) Apply upg.* levels to the sim via tuning.ts modifiers and record loadout in replays
- [SSP-093](../M3/SSP-093-hazards-grip-jolts.md) Implement hazard grip overrides, jolts, LU spills and the open-manhole hard stop
- [SSP-095](../M3/SSP-095-near-miss-dust-coughing.md) Add the near-miss bonus and dust coughing penalties
- [SSP-089](../M3/SSP-089-traffic-lane-following.md) Implement traffic.ts: lane following, queuing behind Bessie, honk, Road Rage, bus stops
- [SSP-041](../M1/SSP-041-placeholder-facades-roofs.md) Add placeholder facade modules, facade sets and roof surfaces for Puddle Lane

**Blocks:**

- [SSP-226](SSP-226-art-facades-m6.md) Art Pass 2: facade module sets for every remaining building style
- [SSP-227](SSP-227-art-signs-decals-m6.md) Art Pass 2: shop signs and road decals for the Wed-Sun districts
- [SSP-231](SSP-231-balance-pass.md) Full-week balance pass: competent runs, £ curve, par constants and score bands
- [SSP-232](SSP-232-week-spec-e2e.md) Write tests/e2e/week.spec.ts: scripted save from Monday to the Tidy Town Trophy
- [SSP-302](SSP-302-district-idea-barks.md) Extend Pam's prompt layer to the Tue–Sun 'new idea' barks and author them per district
- [SSP-248](../M7/SSP-248-perf-optimise.md) Profile and optimise until the M7 performance budgets hold
- [SSP-277](../M9/SSP-277-daily-modifiers.md) Implement Daily Shift modifiers as level knob overrides and extra events
- [SSP-280](../M9/SSP-280-rival-ai-controller.md) Build Sid's Rival Sweep AI on the lane graph and LitterField

## References

- ../../LEVEL_DESIGN.md#53-wed-gasworks-estate-districtgasworks
- ../../LEVEL_DESIGN.md#45-per-district-event-timelines
- ../../LEVEL_DESIGN.md#62-par-times-the-target-times
- ../../LEVEL_DESIGN.md#103-validation-rules
- ../../LEVEL_DESIGN.md#79-sight-lines-and-the-camera
- ../../LEVEL_DESIGN.md#12-level-design-checklist
- ../../ART_BIBLE.md#55-district-colour-keys

## Roadmap tasks covered

- Author and compile ... `gasworks` ... (gasworks)
- Lost Property `collect.*` and one `collect.golden_crisp` placed per district. (Wed)
