---
id: SSP-213
title: "Implement npc.lollipop_lady, site.school_crossing, crossing_patrol and parade"
milestone: M6
status: todo
type: feature
estimate: M
labels: [type:feature, area:ai-npc, area:sim, area:test, size:M]
depends_on: [SSP-211, SSP-199, SSP-081, SSP-085, SSP-089, SSP-080]
blocks: [SSP-215, SSP-221]
---

# SSP-213: Implement npc.lollipop_lady, site.school_crossing, crossing_patrol and parade

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** M · **Areas:** ai-npc, sim, test

## Summary

Add Sunday's crossing patrol, where Bessie must stop for the lollipop lady, and the parade event that closes Civic Way behind a police escort and leaves a trail of litter.

## Context

ENTITY_CATALOG §6: npc.lollipop_lady, 0.8 m/s. Steps out at site.school_crossing, and you must stop. Holds the crossing for 6 s (proposed, TBD (M6 tuning); ENTITY §17 Q10) while a group of children crosses. Running it = -200 + 1 complaint (ped_oi). Sun only; idle = sign raised, angry = sign waved. site.school_crossing (ENTITY §11): zig-zag ground tiles, map char `k`, with a traffic stop line on the lane graph (TECHNICAL_DESIGN §11.4). Event crossing_patrol {crossing, windows[]}: Sunday 20-80 s ('Sunday School') and 200-240 s. OPEN: 'a group of children' is not tied to an entity. Proposal: temporary npc.kid_chalk/kid_skateboard walkers, or reuse shopper outfit swaps; record the choice. Event parade {route, at, untilS, walkers, dropEveryS, table} (LEVEL_DESIGN §4.3): closes a road section to traffic. A slow column of existing NPCs (shoppers in outfit swaps, kids, parents with pushchairs) walks it behind a veh.police escort, dropping litter behind it. Sunday 120-170 s along Civic Way, across the second half of the Inspector's route. The lane closure must reroute or hold traffic deterministically. Free Sweep skips parade (one-off) and loops the crossing_patrol windows. entities.json row milestone M6; placeholder grid for the lollipop lady (final art in SSP-221).

## Scope

- src/sim/npc/behaviours/lollipopLady.ts and its entities.json row
- site.school_crossing occupancy and the 'running the crossing' penalty
- crossing_patrol and parade events, including the lane closure and police escort
- Placeholder lollipop lady grid; unit tests; replay; ENTITY_CATALOG note on the children choice and tuned hold time

## Out of scope

- Civic Quarter layout
- Final art

## Acceptance criteria

- [ ] Unit test: while the crossing is held (6 s), Bessie entering it gives -200 and +1 complaint
- [ ] Unit test: crossing_patrol is active only inside its windows
- [ ] Unit test: during a parade no traffic enters the closed section, and litter drops every dropEveryS behind the column
- [ ] Unit test: a veh.police instance leads the parade column
- [ ] A replay with crossing_patrol and parade is committed and passing

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:replay
- npm run assets && npm run assets:lint

## Dependencies

**Depends on:**

- [SSP-211](SSP-211-reveller-police.md) Implement npc.reveller, kicking_out, veh.police witness rule and police_parked
- [SSP-199](SSP-199-people-kids-jogger.md) Implement npc.jogger, npc.kid_skateboard, npc.kid_chalk and school_out/population_wave
- [SSP-081](../M3/SSP-081-npc-steering.md) Implement NPC steering: seek, flee, separation, nav paths, zebra crossing
- [SSP-085](../M3/SSP-085-behaviour-old-man-mum-postie.md) Implement old man, mum with pushchair and postie, and the occupied-zebra penalty
- [SSP-089](../M3/SSP-089-traffic-lane-following.md) Implement traffic.ts: lane following, queuing behind Bessie, honk, Road Rage, bus stops
- [SSP-080](../M3/SSP-080-npc-store-spawner.md) Add the NPC store, behaviour registry, spawner and phase 7 of the tick

**Blocks:**

- [SSP-215](SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-221](SSP-221-art-humans-batch-b.md) Art Pass 2: final sprites for npc.lollipop_lady, npc.reveller and npc.inspector

## References

- ../../ENTITY_CATALOG.md#62-behaviours
- ../../ENTITY_CATALOG.md#11-sites-site
- ../../ENTITY_CATALOG.md#17-open-questions
- ../../LEVEL_DESIGN.md#43-event-catalogue
- ../../LEVEL_DESIGN.md#45-per-district-event-timelines
- ../../TECHNICAL_DESIGN.md#114-traffic-srcsimtrafficts

## Roadmap tasks covered

- People: ... `npc.lollipop_lady` ... (lollipop_lady)
- `site.school_crossing`, `haz.wind_gust`. (site.school_crossing)
