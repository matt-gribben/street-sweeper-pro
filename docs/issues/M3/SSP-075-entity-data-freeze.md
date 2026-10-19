---
id: SSP-075
title: "Freeze the Mon\u2013Tue entity set in entities.json and add M3 shared tuning"
milestone: M3
status: done
type: chore
estimate: M
labels: [type:chore, area:sim, area:gameplay, area:test, size:M, vertical-slice]
depends_on: [SSP-053, SSP-029]
blocks: [SSP-077, SSP-078, SSP-080, SSP-092, SSP-093, SSP-096, SSP-158, SSP-168, SSP-176]
---

# SSP-075: Freeze the Mon–Tue entity set in entities.json and add M3 shared tuning

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** chore · **Size:** M · **Areas:** sim, gameplay, test · **Vertical slice**

## Summary

Add every M3 entity (people, animals, traffic, parked variants, props, hazards, sites, SSP-096) to src/data/entities.json and the shared street-life rules to src/data/tuning.json, with typed loaders that fail loudly. M4 art depends on this list being frozen at the start of M3, and every other M3 sim issue reads its numbers from here.

## Context

Since M2, the JSON is the source of truth and ENTITY_CATALOG.md is a mirror, kept in sync by tests/unit/entityCatalog.test.ts (CLAUDE.md §2). M2 seeded entities.json with litter.* and stain.*.

Frozen Mon–Tue scope (ROADMAP M3 table):
- People: npc.shopper, npc.old_woman, npc.old_man_frame, npc.mum_pushchair, npc.postie, npc.dog_walker, npc.businessman, npc.litterbug, npc.market_trader.
- Animals: npc.cat, npc.pigeon. The walker's dog is a child actor that reuses the npc.dog_loose grid; it is not a separate catalog entity, and npc.dog_loose behaviour arrives in M6.
- Vehicles: veh.hatchback, veh.saloon, veh.van_white, veh.taxi, veh.bus, veh.bicycle, veh.mobility_scooter, plus veh.hatchback_parked, veh.saloon_parked, veh.van_white_parked, veh.taxi_parked.
- Props: knockables prop.wheelie_bin, prop.traffic_cone, prop.a_board, prop.shopping_trolley, prop.recycling_box, plus all 12 statics (ENTITY_CATALOG §9.2).
- Hazards: haz.puddle, haz.oil_slick, haz.pothole, haz.speed_bump, haz.broken_glass, haz.open_manhole, haz.wet_leaves (haz.wind_gust waits for M6).
- Sites: site.zebra, site.bus_stop, site.frontage, site.pledge_frontage.
- Power-ups: all six pwr.*.

Per-entity values (speed, hit pts and complaints, drops, SFX, districts, milestone) come from ENTITY_CATALOG §6–§12. Examples:
- Shopper 1.3 m/s, −250, 1 C. Doris 0.6 m/s (chase 1.2), −500, 2 C, drops 6 litter.spilled_shopping, handbagHitHp 2. Old man 0.4 m/s, −500, 2 C. Mum 1.1 m/s, −500, 2 C. Postie 1.2 m/s, −250, 1 C. Dog walker 1.2 m/s: Tangle −150, 1 C; hit −300, 1 C. Litterbug and businessman 1.4 m/s, −250, 1 C. Market trader 0 m/s, −250, 1 C.
- Cat dart 6.0 m/s, −300, 1 C. Pigeon cannot be hit; +25 Pigeon Scatter.
- Bicycle −250, 1 C. Mobility scooter 1.5 m/s, −500, 2 C. Parked car dent −100 and 5 HP.
- Knockables: bin 30 kg, −50, spills 4; cone 2 kg, free; A-board −25; trolley free; recycling box −25, spills 2.
- Hazards: puddle grip 4.0; oil 1.2; wet leaves 3.0; pothole −2 HP and 2 LU spill; speed bump spills 3 LU above 6 m/s; broken glass −5 HP/s and +20 when swept; open manhole −10 HP and a hard stop.
- Power-ups: tea 15 s chain ×2; butty 10 s top speeds ×1.3; hi-vis 12 s; super suction 10 s, suction ×2 and fling threshold 6.0 m/s; wrench +25 HP; water can +50.

Shared rules for tuning.json (ENTITY_CATALOG §3, TECHNICAL_DESIGN §9.4/§11):
- Awareness radius 6 m (10 m with upg.led_beacon); horn radius 8 m (12 m with upg.two_tone_horn).
- Near miss: within 0.5 m at > 3 m/s, +25. Dust cough: within 3 m, −10 per pedestrian per 2 s. Puddle splash: above 3 m/s, within 1.5 m, −50; every 3rd splash = 1 C.
- Horn spam: > 3 honks in 5 s (5 with two-tone horn). Traffic: honk after 3 s blocked; Road Rage complaint after > 10 s. Occupied zebra: −200 + 1 C.
- Complaint cap 5 = SACKED. TOWED keeps 50% of the score.
- Actor-hit closing speed ≥ 1.0 m/s; contact ignored for 1.5 s after a hit. NPC radii: human 0.3 m, cat 0.2 m, dog 0.25 m.
- Police witness: +1 C within 15 m (stored now, used in M6).

Open values: ENTITY_CATALOG §17 Q10 lists the gaps (Doris post-horn 0.4 m/s, whack every 1.0 s, give-up 8 m; masses for the A-board, trolley and recycling box). The project lead confirmed on 2026-10-18 that tunable gameplay numbers are not blockers: use the proposed defaults; where none exists (the three masses), pick a starting value, store it, mark it in the catalog as chosen in M3 tuning, and list it in the PR. Resolve the M3 open questions to their stated defaults: Q2 hit counts at ≥ 1.0 m/s closing speed; Q3 hitting moving traffic costs HP only; Q4 denting a parked car is a flat 5 HP that replaces impact damage; Q7 0 spilled-shopping items for everyone except Doris.

Rules for the JSON (ENTITY_CATALOG §15):
- SFX values only from the closed list in ENTITY_CATALOG §1.4.
- `milestone` is "M3" for all of these entities.
- `districts` is a full membership list (e.g. shopper includes Wed–Sun too). The compiler's L005 and L007 checks depend on it.
- `sprite` holds the final AssetId string. The placeholder sprites land in the five placeholder-* issues, which run in parallel with this one. Do not weaken any existing test: if an existing test already requires every `sprite` to resolve in src/gen/assets.ts, land this issue after the placeholder-* issues and say so in the PR. SSP-103 adds the full sprite-resolution test.

## Scope

- Add an entities.json entry for every frozen M3 ID with class, name, speed, behaviour key, yields flag, hit {pts, complaints, drops}, sprite, sfx, districts and milestone, following the ENTITY_CATALOG §15 shape.
- Add the shared street-life rules above to tuning.json and expose them through src/sim/tuning.ts as typed accessors.
- Write hand-written type guards (no zod) that throw on a missing required field instead of defaulting.
- Extend tests/unit/entityCatalog.test.ts so it diffs the new IDs, pts, LU, speeds, penalties and complaints against the ENTITY_CATALOG tables.
- Update ENTITY_CATALOG.md in the same PR: record the chosen M3 tuning values and mark §17 Q2, Q3, Q4 and Q7 as resolved to their defaults.

## Out of scope

- Wed–Sun entities (M6): jogger, kids, lollipop lady, reveller, inspector, dog_loose behaviour, seagull, bin lorry, ice cream van, police, rival sweeper.
- Manifest and sprite entries (the placeholder-* issues).
- Any behaviour code.

## Acceptance criteria

- [ ] Every ID in the ROADMAP M3 entity-scope table exists in entities.json with milestone "M3".
- [ ] entityCatalog.test.ts passes, and fails if any pts, complaints, speed or LU value in the JSON is changed without a matching catalog change.
- [ ] Loading entities.json with a required field removed throws an error that names the ID and the field.
- [ ] A unit test asserts every sfx value in entities.json is in the ENTITY_CATALOG §1.4 list.
- [ ] No value marked TBD (M3 tuning) is missing from the JSON: each has a number, and the catalog marks the numbers chosen in M3.
- [ ] tests/unit/ipHygiene.test.ts still passes.

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:replay

## Dependencies

**Depends on:**

- [SSP-053](../M2/SSP-053-entities-tuning-seed.md) Seed entities.json with litter, stains and pickups; add M2 values to tuning.json
- [SSP-029](../M1/SSP-029-tuning-data.md) Create tuning.json vehicle.sweeper block and typed src/sim/tuning.ts

**Blocks:**

- [SSP-077](SSP-077-compile-spawn-specs.md) Compile NPC, traffic, hazard, knockable and power-up spawn specs from level.json
- [SSP-078](SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-080](SSP-080-npc-store-spawner.md) Add the NPC store, behaviour registry, spawner and phase 7 of the tick
- [SSP-092](SSP-092-knockable-bodies.md) Implement bodies.ts knockable impulse bodies with spills and penalties
- [SSP-093](SSP-093-hazards-grip-jolts.md) Implement hazard grip overrides, jolts, LU spills and the open-manhole hard stop
- [SSP-096](SSP-096-power-ups.md) Spawn power-ups on pavements, implement all six pwr.* effects, draw them
- [SSP-158](../M4/SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-168](../M5/SSP-168-audio-verify-coverage.md) Wire audio into assets:verify and add SFX coverage and reference tests
- [SSP-176](../M5/SSP-176-sfx-event-wiring.md) Wire sim events to sfx cues through a pure audio director

## References

- ../../ROADMAP.md#m3-living-street
- ../../ENTITY_CATALOG.md#14-sfx-notation
- ../../ENTITY_CATALOG.md#3-shared-rules
- ../../ENTITY_CATALOG.md#6-pedestrians-npc-people
- ../../ENTITY_CATALOG.md#7-animals-npc-animals
- ../../ENTITY_CATALOG.md#8-vehicles-veh
- ../../ENTITY_CATALOG.md#9-props-and-obstacles-prop
- ../../ENTITY_CATALOG.md#10-hazards-haz
- ../../ENTITY_CATALOG.md#12-power-ups-pwr
- ../../ENTITY_CATALOG.md#15-entitiesjson-shape
- ../../ENTITY_CATALOG.md#16-changing-this-catalog
- ../../ENTITY_CATALOG.md#17-open-questions
- ../../../CLAUDE.md#2-where-truth-lives

## Roadmap tasks covered

- `Mon–Tue entity scope (frozen at the start of M3, because M4 art depends on it)`
- `src/sim/bodies.ts`: knockable impulse bodies with masses and spill counts from `entities.json` (data part)
