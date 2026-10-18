---
id: SSP-302
title: "Extend Pam's prompt layer to the Tue\u2013Sun 'new idea' barks and author them per district"
milestone: M6
status: todo
type: feature
estimate: M
labels: [type:feature, area:gameplay, area:ui, area:tooling, area:test, size:M]
depends_on: [SSP-290, SSP-186, SSP-061, SSP-086, SSP-203, SSP-204, SSP-206, SSP-209, SSP-212, SSP-214, SSP-215]
blocks: [SSP-233]
---

# SSP-302: Extend Pam's prompt layer to the Tue–Sun 'new idea' barks and author them per district

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** M · **Areas:** gameplay, ui, tooling, test

## Summary

Generalise the SSP-290 tutorial_beat layer beyond Puddle Lane. Allow one or two `tutorial_beat` events in each Tue–Sun district, add the triggers those beats need, author the barks (the four days the GDD scripts, plus a proposed line for Friday and Sunday), and persist them as learned per save so each shows only on that district's first play.

## Context

GDD §16.2: 'Later days introduce their new idea with one or two barks in the same style.' The barks:
- Tuesday (High Street) teaches stains and the spray: "Gum. Brush won't shift that. Hold **Shift** to spray." on the first `stain.*` within 10 m, and "Running dry? Pull up by a hydrant." when water drops below 40%.
- Wednesday: "Roads are slippy in this rain. Brake early."
- Thursday: "Mind the dog leads. They stretch."
- Saturday: "Can't see a thing. Stick under the street lamps."
- Friday and Sunday are not scripted. LEVEL_DESIGN §3.3 names their ideas (Fri: gusts, seagulls, Sid, ice cream van; Sun: sweeping ahead of the Inspector's route). Propose one line each in Pam's voice (GDD §18 tone; §18.4 naming/IP rules), record them in GDD §16.2, and get the lead's OK in the PR.
Proposed triggers (record in LEVEL_DESIGN §4.4): Wed and Sat on timer start; Thu on the first `npc.dog_walker` within 10 m; Fri on the first `gust` event; Sun on the `inspection` event start.
SSP-290 built the layer for Puddle Lane only, with presentation-side trigger evaluation from bus events and read-only state, one prompt at a time through the radio panel, tokenised key glyphs and cancel-on-performed. SSP-186 persists `tutorial.learned`. SSP-204, SSP-206 and SSP-212 list their bark text but author no event. This issue authors every Tue–Sun bark event.
Changes:
- The compiler's tutorial_beat rule changes from 'Puddle Lane only' to: Puddle Lane up to 13, each other campaign district ≤ 2, never `district.depot_yard`. Add the new trigger names to the known set.
- Learned ids are namespaced per district (e.g. `high_street.spray`) so they never collide with Monday's.
- The spray bark is an action beat, learned on the first SPRAY hold. The rest are informational and learned when shown.
- Barks show on that district's first play and again with 'Show tips' (SSP-235, M7).
- Text uses the radio-panel tokens ({spray} for Shift).
- Proposal: Free Sweep shows no barks. Record it.
Triggers stay outside the sim, so replay hashes do not change. Update the LEVEL_DESIGN §4.3 'Used in' column for tutorial_beat and §4.4's 'Monday only' wording.

## Scope

- compile-level.ts: relax tutorial_beat to ≤ 2 per non-Monday campaign district (none in the Depot Yard), new trigger names, named errors
- Prompt layer: new triggers (stain within 10 m, water < 40%, timer start, dog walker within 10 m, gust event, inspection start), namespaced learned ids, spray as an action beat
- Author tutorial_beat events in high_street, gasworks, conker_hill, promenade, kebab_mile and civic_quarter level.json; recompile
- Propose and record the Friday and Sunday lines in GDD §16.2; record trigger definitions in LEVEL_DESIGN §4.3/§4.4
- Persist learned ids through SSP-186's tutorial.learned

## Out of scope

- Puddle Lane beats (SSP-290)
- Intro card hints (district issues, e.g. SSP-203)
- The Show tips setting UI (SSP-235)
- Remapped or touch glyphs (SSP-236, SSP-262)

## Acceptance criteria

- [ ] Unit test: rendering the Tue, Wed, Thu and Sat barks with default keyboard bindings equals the GDD §16.2 text with bold markup removed; the Fri and Sun texts in level.json equal the lines recorded in GDD §16.2
- [ ] Unit test over compiled levels: each Tue–Sun district has 1 or 2 tutorial_beat events and the Depot Yard has none
- [ ] Unit tests per new trigger: the stain bark fires at 10.0 m and not at 10.1 m; the hydrant bark fires at water 39% and not at 40%; the Thursday bark fires on the first dog walker within 10 m; the Friday and Sunday barks fire on their events; each fires at most once per shift
- [ ] Unit test: holding SPRAY while the Tuesday spray bark is queued or showing cancels or dismisses it and marks `high_street.spray` learned
- [ ] `npm run levels` rejects a third tutorial_beat in a non-Monday district and any tutorial_beat in district.depot_yard with named errors, and compiling twice gives the same hash
- [ ] e2e: with a save injected (SSP-186 test hook) whose tutorial.learned contains `high_street.stain`, the stain bark does not fire on High Street; on a fresh profile it does
- [ ] `npm run test:replay` hashes are unchanged

## Verification

- npm run levels
- npm run typecheck && npm run lint && npm test
- npm run test:replay
- npm run test:e2e

## Dependencies

**Depends on:**

- [SSP-290](../M3/SSP-290-tutorial-beats.md) Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events
- [SSP-186](SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub
- [SSP-061](../M2/SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats
- [SSP-086](../M3/SSP-086-behaviour-dog-walker.md) Implement the dog walker with a lead line obstacle, Lead Tangle and dog mess drops
- [SSP-203](SSP-203-district-high-street-final.md) Bring district.high_street to final M6 quality with collectibles and 3-star replay
- [SSP-204](SSP-204-district-gasworks.md) Author and compile district.gasworks (Wednesday, rain) with its district replay
- [SSP-206](SSP-206-district-conker-hill.md) Author and compile district.conker_hill (Thursday, wind and leaf fall)
- [SSP-209](SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-212](SSP-212-district-kebab-mile.md) Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden
- [SSP-214](SSP-214-inspector.md) Implement npc.inspector and the inspection event with frontage deductions
- [SSP-215](SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map

**Blocks:**

- [SSP-233](SSP-233-m6-close.md) Close M6: final goldens, no placeholders, replays audit, docs and m6 tag

## References

- ../../GDD.md#162-puddle-lane-first-play-script-proposed-m2m3
- ../../GDD.md#161-principles
- ../../GDD.md#181-tone-in-one-line
- ../../GDD.md#184-naming-and-ip-rules
- ../../LEVEL_DESIGN.md#33-what-each-day-teaches
- ../../LEVEL_DESIGN.md#43-event-catalogue
- ../../LEVEL_DESIGN.md#44-tutorial-beats-monday-only
- ../../LEVEL_DESIGN.md#84-leveljson-schema
- ../../TECHNICAL_DESIGN.md#16-save-data-and-settings

## Roadmap tasks covered

_None._
