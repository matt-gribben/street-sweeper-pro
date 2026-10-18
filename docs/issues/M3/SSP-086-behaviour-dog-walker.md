---
id: SSP-086
title: "Implement the dog walker with a lead line obstacle, Lead Tangle and dog mess drops"
milestone: M3
status: todo
type: feature
estimate: M
labels: [type:feature, area:sim, area:ai-npc, area:gameplay, area:test, size:M, vertical-slice]
depends_on: [SSP-082, SSP-061]
blocks: [SSP-103, SSP-104, SSP-106, SSP-108, SSP-136, SSP-206, SSP-215, SSP-302]
---

# SSP-086: Implement the dog walker with a lead line obstacle, Lead Tangle and dog mess drops

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** sim, ai-npc, gameplay, test · **Vertical slice**

## Summary

Write dogWalker.ts: the walker walks a route with a child dog actor up to 5 m ahead on an extendable lead. Driving through the lead is a Lead Tangle, and the dog drops litter.dog_mess every 40–60 s.

## Context

From ENTITY_CATALOG §6.1–6.2, §3.2 and TECHNICAL_DESIGN §9.4:
- Walker 1.2 m/s. The dog roams up to 5 m ahead on an extendable lead.
- The dog is a child actor of the walker in the NpcStore, linked by a generation-checked handle; not a separate catalog entity. It renders with the npc.dog_loose grid and a coat ramp swap (key indices 12/11, ART_BIBLE §5.6). Dog circle r = 0.25 m.
- The lead is a LINE OBSTACLE: segment walker → dog, no physical collision.
- Bessie's OBB crossing the segment = Lead Tangle: −150, 1 C. The walker spins (startle) and the dog barks. ENTITY_CATALOG (behaviour owner) says startle; TECHNICAL_DESIGN §9.4 says Angry: use startle and fix the TECHNICAL_DESIGN row in the same PR. Audio later: dog_bark, then ped_oi 120 ms after.
- Walker hit: −300, 1 C (GDD animal tier).
- The dog drops litter.dog_mess every 40–60 s (npc stream). LEVEL_DESIGN §9.1 places dog_mess only on pavements and grass: if the dog is elsewhere when the timer fires, defer the drop until it is. Brush-up over dog mess makes stain.splat (−20, existing M2 rule).
- Puddle Lane: one walker from 120 s, looping Pump Green.

Open (flag in PR): hitting the dog itself is unspecified; treat it as the walker's animal hit (−300, 1 C), sharing one contact episode with the walker. Tangle re-arm: Bessie must fully leave the segment before another Tangle counts.

Rendering of the 1 px lead (index 18 postbox_red, +2,+2 shadow) is SSP-103.

## Scope

- dogWalker.ts with walker and dog child spawn, dog roaming within 5 m, lead segment maintenance.
- OBB-vs-segment Tangle test and penalty fact (reason Tangle).
- Dog mess drop timing and placement constraints.
- Read-only lead segment endpoints for the renderer.
- tests/unit/behaviours/dogWalker.test.ts; update the TECHNICAL_DESIGN §9.4 lead row.

## Out of scope

- npc.dog_loose chase behaviour (M6).
- Dog sprite art (SSP-099).

## Acceptance criteria

- [ ] Test: the dog's distance from the walker never exceeds 5.0 m over 3,600 ticks.
- [ ] Test: Bessie crossing the lead costs −150 and 1 C once per crossing episode, and the walker enters Startle.
- [ ] Test: the first dog_mess appears 2,400–3,600 ticks after the walker spawns (or later if deferred), always on a pavement or grass tile.
- [ ] Test: a walker hit costs −300 and 1 C; hitting the dog in the same episode adds nothing extra.
- [ ] Test: removing the walker also removes the dog, and the dog's old handle fails its generation check.
- [ ] Replays pass or are re-recorded with a reason.

## Verification

- npm test
- npm run test:replay
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-082](SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-061](../M2/SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats

**Blocks:**

- [SSP-103](SSP-103-render-actors-traffic.md) Draw NPCs, animals, traffic, knockables and hazards with state-driven frames
- [SSP-104](SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up
- [SSP-106](SSP-106-npc-stress-budget.md) Prove the NPC budget: 80 NPCs, 30 vehicles, 2,000 litter, allocation-free
- [SSP-108](SSP-108-penalty-table-test.md) Add the table-driven penalty and complaint test against entities.json
- [SSP-136](../M4/SSP-136-char-postie-dog-walker.md) Final npc.postie and npc.dog_walker
- [SSP-206](../M6/SSP-206-district-conker-hill.md) Author and compile district.conker_hill (Thursday, wind and leaf fall)
- [SSP-215](../M6/SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-302](../M6/SSP-302-district-idea-barks.md) Extend Pam's prompt layer to the Tue–Sun 'new idea' barks and author them per district

## References

- ../../ENTITY_CATALOG.md#62-behaviours
- ../../ENTITY_CATALOG.md#32-collision-responses
- ../../TECHNICAL_DESIGN.md#94-dynamic-actors
- ../../ART_BIBLE.md#83-people-and-animals
- ../../LEVEL_DESIGN.md#91-litter

## Roadmap tasks covered

- Behaviours: ... `dogWalker.ts` (lead as a line obstacle; Lead Tangle; the dog drops `litter.dog_mess`) ...
