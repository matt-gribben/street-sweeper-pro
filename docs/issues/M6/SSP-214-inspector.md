---
id: SSP-214
title: "Implement npc.inspector and the inspection event with frontage deductions"
milestone: M6
status: todo
type: feature
estimate: M
labels: [type:feature, area:ai-npc, area:sim, area:ui, area:test, size:M]
depends_on: [SSP-190, SSP-064, SSP-094, SSP-080, SSP-157, SSP-291, SSP-300]
blocks: [SSP-215, SSP-216, SSP-221, SSP-302, SSP-237]
---

# SSP-214: Implement npc.inspector and the inspection event with frontage deductions

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** M · **Areas:** ai-npc, sim, ui, test

## Summary

The Tidy Town Inspector walks a fixed route on Sunday and deducts -100 for each frontage below 90% that he passes. His pass rate feeds the Sunday Inspection Score.

## Context

ENTITY_CATALOG §6: npc.inspector, 1.0 m/s. Walks a fixed route with a clipboard; each site.frontage he passes that is below 90% clean = -100. Splashing or hitting him = 2 complaints (a puddle splash on him is 2 C, ENTITY §10). Sun only; idle = writing on the clipboard, angry = clipboard tap. Event inspection {route, at, speed 1.0} (LEVEL_DESIGN §4.3). Civic Quarter (§5.7): the route is about 170 m of pavement and about 28 frontages. It starts at the Town Hall at 60 s, goes clockwise round the square, down Civic Way and through the terraces, and ends at about 230 s. The 28 frontages are worth up to 2,800 points of deductions. Output for the finale (GDD §12.8): Inspection pass rate = % of frontages on his route that are >= 90% clean when he passes. The -100 marks appear on Sunday's score but do not enter the Inspection Score formula. OPEN: 'passes' needs a definition. Proposal: the tick his position enters the frontage zone's pavement band, evaluated once per frontage; document it in ENTITY_CATALOG. UI: his route is shown on the intro card and on the shift map/minimap (LEVEL_DESIGN §3.3, §5.7). Free Sweep skips inspection (one-off). He reacts to hi-vis like other pedestrians (no exemption is listed). entities.json row milestone M6; placeholder grid (final art in SSP-221).

## Scope

- src/sim/npc/behaviours/inspector.ts and its entities.json row
- inspection event: route following, per-frontage evaluation, -100 deductions, and inspected/passed counters in ShiftResult
- Splash or hit = 2 complaints
- Route overlay on the ShiftIntroScene card and the minimap
- Unit tests; replay on a fixture level
- Route overlay on the Tab shift map (SSP-300)

## Out of scope

- Inspection Score and Trophy (SSP-216)
- Final art

## Acceptance criteria

- [ ] Unit test: a frontage at 89% when he passes gives -100 and counts as failed; at 90% it gives 0 and counts as passed
- [ ] Unit test: each frontage on the route is evaluated exactly once
- [ ] Unit test: splashing him adds 2 complaints
- [ ] Unit test: he walks at 1.0 m/s and starts at the configured `at`
- [ ] ShiftResult exposes inspected and passed counts
- [ ] The route appears on the intro card and the minimap (screenshot reviewed with Read)
- [ ] A replay is committed and passing
- [ ] The Inspector's route also appears on the shift map overlay (capture opened with Read)

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:replay
- npm run test:e2e

## Dependencies

**Depends on:**

- [SSP-190](SSP-190-compiler-m6.md) Extend compile-level for M6: skip_run mode, night lamp pools, landmarks, M6 events
- [SSP-064](../M2/SSP-064-tidy-frontages.md) Compute Tidy %, per-frontage clean % and Clean Sweep bonuses incrementally
- [SSP-094](../M3/SSP-094-puddle-splash-broken-glass.md) Add puddle splash penalties and broken glass from flung bottles
- [SSP-080](../M3/SSP-080-npc-store-spawner.md) Add the NPC store, behaviour registry, spawner and phase 7 of the tick
- [SSP-157](../M4/SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art
- [SSP-291](../M4/SSP-291-hud-minimap.md) Implement src/ui/minimap.ts: runtime 64×64 district minimap in the single UI draw
- [SSP-300](../M4/SSP-300-shift-map-overlay.md) Add the Tab shift map overlay: district map with frontage status, depot, skips and hydrants, without pausing

**Blocks:**

- [SSP-215](SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map
- [SSP-216](SSP-216-sunday-finale-trophy.md) Implement the Sunday Inspection Score and the Tidy Town Trophy award
- [SSP-221](SSP-221-art-humans-batch-b.md) Art Pass 2: final sprites for npc.lollipop_lady, npc.reveller and npc.inspector
- [SSP-302](SSP-302-district-idea-barks.md) Extend Pam's prompt layer to the Tue–Sun 'new idea' barks and author them per district
- [SSP-237](../M7/SSP-237-assists-sim.md) Wire auto-brush, +60 s timer, Chill Shift and instant dump into the sim

## References

- ../../ENTITY_CATALOG.md#62-behaviours
- ../../LEVEL_DESIGN.md#43-event-catalogue
- ../../LEVEL_DESIGN.md#57-sun-civic-quarter-districtcivic_quarter-finale
- ../../GDD.md#128-the-week-finale
- ../../LEVEL_DESIGN.md#710-frontages

## Roadmap tasks covered

- People: ... `npc.inspector`. (inspector)
