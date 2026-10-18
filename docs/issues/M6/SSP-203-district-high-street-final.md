---
id: SSP-203
title: "Bring district.high_street to final M6 quality with collectibles and 3-star replay"
milestone: M6
status: todo
type: feature
estimate: M
labels: [type:feature, area:gameplay, area:test, size:M]
depends_on: [SSP-190, SSP-189, SSP-196, SSP-105, SSP-084, SSP-088, SSP-089, SSP-091, SSP-121, SSP-126, SSP-150, SSP-151, SSP-171]
blocks: [SSP-231, SSP-232, SSP-302, SSP-248, SSP-277, SSP-280]
---

# SSP-203: Bring district.high_street to final M6 quality with collectibles and 3-star replay

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** M · **Areas:** gameplay, test

## Summary

Take Tuesday from its M3/M4 state to the final authored numbers, events, pledges and collectibles, and commit its district replay.

## Context

LEVEL_DESIGN §5.2 (all values initial).
Layout: 80x60. The High Street spine has a 4-tile carriageway with bus boxes, 2 zebras and 2 bus stops. Market Square is ~20x14 of cobbles with 12 stall pitches in two rows and 3-tile aisles. Station Road is a one-way loop with service yards and 2 skips. Ginnels every 25-35 m; depot on the north edge; 3 storeys on side streets and 4-5 on the High Street (8 tiles facade to facade).
Litter: 200 items (~230 LU incl. dynamic). Table: crisp 20, butts 18, can 12, plastic bottle 10, chip wrapper 10, newspaper 8, banana 8, glass 6, pizza box 4, bin bag 4. Dynamic ~60.
Other counts: grime 11,000 cells; stains 30 gum + 6 milkshake; skips 2 / hydrants 4; SSP-096 2 (flask of tea, super suction, water can); frontages 64 / pledges 12.
Lost Property: collect.lost_wallet between two stalls in Market Square. Golden Crisp: in the bus box at the far bus stop, reachable only when no bus is stopped there.
NPC peaks: shopper 18 (26 during 120-180 s), market_trader 12, businessman 5, litterbug 3 (+2 at 90 s), Doris 1, old man 1, pigeons 2 flocks of 6-10. Moving traffic 12 (bus 2 every 45 s, taxi 2, bicycle 2, cars 6); parked 14.
Timeline (§4.5): market (cont.); buses every 45 s from 20 s; litterbug wave +2 at 90 s; shopper wave +8 from 120 to 180 s; market_close at 180 s (~40 items over 20 s).
Par (§6.2, Tue loadout upg.hopper L1, 140 LU): 1★ 89 s, 2★ 150 s, 3★ 184 s, 100% 289 s. Set level.json par {loadout: ["upg.hopper:1"], star1 89, star2 150, star3 184, perfectMin 260}. Compiler rules: L060 errors if the 3★ estimate > par.star3 x 1.10 or > 230 s; L061 errors if the 100% estimate < perfectMin; L062 warns if 1★ > 125 s. The §12 checklist additionally asks for 3★ par <= par.star3 and 100% par > 260 s.
Score bands (§6.3): 11,000 / 15,500 / 20,000. Music mus.high_street; ambience amb.town_morning (market chatter layer). Intro card hint: "Spray the gum, love. Hydrants are on the map." Collectible placement rules (LEVEL_DESIGN §9.6): Lost Property = 10-20 s brush-up detour from the par route; Golden Crisp = >= 15 s detour, reachable without a penalty, never in a footway (L041). The docs do not say where intro-card briefing and hint text lives: follow whatever ShiftIntroScene has used since the VS, or propose a field and document it in LEVEL_DESIGN §8.4. Run the full LEVEL_DESIGN §12 checklist and paste the par report in the PR.

## Scope

- Update assets-src/levels/high_street.map.txt and high_street.level.json to the §5.2 values, the §4.5 timeline and the par block
- Place collect.lost_wallet and collect.golden_crisp per the spec
- Intro card text and Lost Property hint
- Route file and committed 3,600-tick 3★ replay tests/replay/replays/m6_high_street.json (Tue par loadout)
- Full-map screenshot reviewed with Read; Free Sweep load check

## Out of scope

- New NPC behaviours
- Art changes (M4 already delivered High Street art)

## Acceptance criteria

- [ ] npm run levels passes with no errors; any warnings are fixed or explained in the PR
- [ ] Par report: 3★ estimate <= 184 s (checklist) and never > 230 s (L060); 100% par > 260 s (L061, perfectMin 260); 1★ <= 125 s (no L062 warning)
- [ ] Pledges = 12 and SSP-096 = 2; Lost Property and Golden Crisp are present and pass L041
- [ ] m6_high_street.json reaches >= 92 Tidy % (3★) and passes npm run test:replay
- [ ] The replay's score is within ±25% of 20,000
- [ ] Free Sweep on High Street runs 480 s and loops the schedule without errors (e2e or replay)
- [ ] The LEVEL_DESIGN §12 checklist is ticked in the PR

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
- [SSP-105](../M3/SSP-105-high-street-greybox.md) Author and compile the grey-box High Street (80×60) for Tuesday's NPCs
- [SSP-084](../M3/SSP-084-behaviour-shopper-businessman-litterbug.md) Implement shopper, businessman and litterbug behaviours, including the Caught! bonus
- [SSP-088](../M3/SSP-088-behaviour-market-trader-pigeon.md) Implement market trader (with market close pile) and pigeon flocks with Pigeon Scatter
- [SSP-089](../M3/SSP-089-traffic-lane-following.md) Implement traffic.ts: lane following, queuing behind Bessie, honk, Road Rage, bus stops
- [SSP-091](../M3/SSP-091-traffic-special-kinds.md) Add taxi fare stops, white van pavement parking, bicycle filtering and mobility scooter
- [SSP-121](../M4/SSP-121-tiles-pavement-grass-cobbles.md) Final pavement slabs, grass, cobbles, setts, tactile paving and edge tiles
- [SSP-126](../M4/SSP-126-facades-high-street.md) High Street shopfront facade modules and facade sets
- [SSP-150](../M4/SSP-150-shop-signs.md) High Street shop signs: Codex blank boards plus Kerbside lettering
- [SSP-151](../M4/SSP-151-road-decals.md) Road decals for High Street: oil, posters and graffiti via Codex ingest
- [SSP-171](../M5/SSP-171-song-high-street.md) Compose mus.high_street 'Window Shopping' with base, drums and lead stems

**Blocks:**

- [SSP-231](SSP-231-balance-pass.md) Full-week balance pass: competent runs, £ curve, par constants and score bands
- [SSP-232](SSP-232-week-spec-e2e.md) Write tests/e2e/week.spec.ts: scripted save from Monday to the Tidy Town Trophy
- [SSP-302](SSP-302-district-idea-barks.md) Extend Pam's prompt layer to the Tue–Sun 'new idea' barks and author them per district
- [SSP-248](../M7/SSP-248-perf-optimise.md) Profile and optimise until the M7 performance budgets hold
- [SSP-277](../M9/SSP-277-daily-modifiers.md) Implement Daily Shift modifiers as level knob overrides and extra events
- [SSP-280](../M9/SSP-280-rival-ai-controller.md) Build Sid's Rival Sweep AI on the lane graph and LitterField

## References

- ../../LEVEL_DESIGN.md#52-tue-muckleford-high-street-districthigh_street
- ../../LEVEL_DESIGN.md#45-per-district-event-timelines
- ../../LEVEL_DESIGN.md#62-par-times-the-target-times
- ../../LEVEL_DESIGN.md#63-target-score-bands
- ../../LEVEL_DESIGN.md#96-power-ups-and-collectibles
- ../../LEVEL_DESIGN.md#103-validation-rules
- ../../LEVEL_DESIGN.md#12-level-design-checklist

## Roadmap tasks covered

- Author and compile `high_street` (final), `gasworks`, `conker_hill`, `promenade`, `kebab_mile`, `civic_quarter`, `depot_yard`. (high_street)
- Lost Property `collect.*` and one `collect.golden_crisp` placed per district. (Tue)
