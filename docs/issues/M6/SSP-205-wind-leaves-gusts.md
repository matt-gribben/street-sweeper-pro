---
id: SSP-205
title: "Implement leaf fall, wet leaves and haz.wind_gust litter drift"
milestone: M6
status: todo
type: feature
estimate: M
labels: [type:feature, area:sim, area:render, area:test, size:M]
depends_on: [SSP-057, SSP-093, SSP-154, SSP-295]
blocks: [SSP-206, SSP-209, SSP-217, SSP-223, SSP-277]
---

# SSP-205: Implement leaf fall, wet leaves and haz.wind_gust litter drift

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** M · **Areas:** sim, render, test

## Summary

Thursday's wind drives leaf fall and wet-leaf hazards, and Friday's gusts push light litter around. Both run through the deterministic sim with the leaf-swirl FX.

## Context

Events (LEVEL_DESIGN §4.3):
- leaf_fall {everyS, max} adds new litter.leaf_pile items under prop.tree canopies (Thu: every 4 s, max +40). A leaf_pile may only spawn under or within 4 m of a prop.tree (§9.1).
- gust {at[], dirDeg} = haz.wind_gust: newspapers, crisp packets and leaves drift 1.5 m/s for 4 s in the set direction (Fri at 40, 95, 150 and 205 s, onshore from the south). Wobble frames play while drifting (ENTITY §4.2). haz.wind_gust is not a sprite but a timed district event shown with the leaf-swirl FX (ENTITY §10).
Thursday weather is 'wind' and only drives leaf fall: no gusts on Thursday (ENTITY §17 Q9 default; adopt it and mark Q9 resolved).
Wet leaves: driving through a leaf_pile with the brush up leaves haz.wet_leaves with grip 3.0 (3.45 with tyres). Check whether M3 already implemented this brush-up rule and only fill gaps. leaf_pile: 5 pts, 2 LU, pickup_big; its entities.json row and placeholder sprite exist from M2 (final art in SSP-223). M2 left a wind-drift hook in litter.ts.
FX: fx.leaf_swirl 24x24, 8 frames, 5 ticks, loop, colours 14/11/13/22 (generator from M4). Emit gust start/end events on the bus so audio can swell amb.wind_leaves (+6 dB) and amb.seafront's wind layer. Free Sweep loops gust and leaf_fall on a 240 s cycle. Dynamic litter counts toward 'litter spawned' and the 2,000 cap. Use the weather/events sfc32 streams.

## Scope

- leaf_fall event spawning leaf piles under tree canopies, with the max cap
- gust event driving the litter drift hook for newspaper, crisp_packet and leaf_pile
- haz.wet_leaves creation on brush-up leaf pile contact (if not already present)
- fx.leaf_swirl triggering for leaf fall and gusts; gust events on the bus
- Unit tests and a replay with gusts and leaf fall; ENTITY_CATALOG §17 Q9 marked resolved

## Out of scope

- amb.wind_leaves / amb.seafront beds (SSP-217)
- District layouts
- Leaf pile final art (SSP-223)

## Acceptance criteria

- [ ] Unit test: with leaf_fall everyS 4 and max 40, exactly 40 piles are added by 160 s and none afterwards, all within 4 m of a tree
- [ ] Unit test: during a gust, newspapers, packets and leaves move at 1.5 m/s for 4 s (240 ticks) along dirDeg, and other litter does not move
- [ ] Unit test: brush-up contact with a leaf_pile creates haz.wet_leaves with grip 3.0
- [ ] Unit test: a level with weather 'wind' never fires gusts unless it authors gust events
- [ ] A replay with gusts is committed and deterministic across two runs
- [ ] Gust start and end events appear on the event bus (unit test)

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:replay

## Dependencies

**Depends on:**

- [SSP-057](../M2/SSP-057-litter-field.md) Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn
- [SSP-093](../M3/SSP-093-hazards-grip-jolts.md) Implement hazard grip overrides, jolts, LU spills and the open-manhole hard stop
- [SSP-154](../M4/SSP-154-vfx-core.md) Procedural VFX: dust, spray, sparkle, splash, leaf swirl, skid marks
- [SSP-295](../M5/SSP-295-vertical-slice-gate.md) Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR

**Blocks:**

- [SSP-206](SSP-206-district-conker-hill.md) Author and compile district.conker_hill (Thursday, wind and leaf fall)
- [SSP-209](SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-217](SSP-217-audio-ambiences-m6.md) Author amb.rain, amb.wind_leaves, amb.seafront and amb.night_town beds
- [SSP-223](SSP-223-art-litter-m6.md) Art Pass 2: final litter sprites for kebab wrapper, leaf pile and lolly stick
- [SSP-277](../M9/SSP-277-daily-modifiers.md) Implement Daily Shift modifiers as level knob overrides and extra events

## References

- ../../LEVEL_DESIGN.md#43-event-catalogue
- ../../ENTITY_CATALOG.md#42-behaviours-and-brush-up-rules
- ../../ENTITY_CATALOG.md#10-hazards-haz
- ../../ENTITY_CATALOG.md#17-open-questions
- ../../ART_BIBLE.md#11-vfx
- ../../AUDIO_DESIGN.md#71-assignment

## Roadmap tasks covered

- Wind and leaf fall: drifting litter, `litter.leaf_pile` respawn, `haz.wet_leaves`.
- `site.school_crossing`, `haz.wind_gust`. (haz.wind_gust)
