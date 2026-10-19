---
id: SSP-064
title: "Compute Tidy %, per-frontage clean % and Clean Sweep bonuses incrementally"
milestone: M2
status: done
type: feature
estimate: M
labels: [type:feature, area:sim, area:gameplay, area:test, size:M, vertical-slice]
depends_on: [SSP-057, SSP-060, SSP-055, SSP-063]
blocks: [SSP-065, SSP-071, SSP-082, SSP-102, SSP-290, SSP-299, SSP-291, SSP-300, SSP-293, SSP-187, SSP-192, SSP-200, SSP-214]
---

# SSP-064: Compute Tidy %, per-frontage clean % and Clean Sweep bonuses incrementally

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** feature · **Size:** M · **Areas:** sim, gameplay, test · **Vertical slice**

## Summary

Implement Tidy % and per-frontage clean % from incremental counters, award Clean Sweep +100 once per frontage at 100%, and expose would-be stars, so the tally and HUD have the numbers that decide stars.

## Context

Tidy % (GDD §9.2, TECHNICAL_DESIGN §10.3) = 0.6 × (grime cells cleaned ÷ initial grime cells) + 0.4 × (litter collected ÷ litter spawned), both over the route area (roads + pavements) only. 'Litter spawned' includes dynamic litter; `litter.spilled_shopping` counts. Counters are incremental; nothing rescans the mask.
Frontages (GDD §9.3, LEVEL_DESIGN §7.10): each `site.frontage` zone (from the compiled `frontages` list) gets its own clean % using the same formula restricted to the zone. Clean Sweep: a frontage at 100% scores +100 once per shift (via scoring's bonus API; not multiplied, no chain effect). Pledge status (≥ 90%) is computed for later use (the £10 tip and the Mercury map are M6).
Open questions (document in GDD §9.3): (1) attributing litter to a frontage when items move (flings): propose tagging each item with the zone index of its spawn position and counting it as collected for that zone wherever it is collected. (2) A zone with no initial grime and no litter: propose it is never eligible for Clean Sweep.
Stars (GDD §12.1): would-be stars from Tidy %: 1★ ≥ 0.60, 2★ ≥ 0.80, 3★ ≥ 0.92 (TOWED gives no stars; M3).
Properties (TECHNICAL_DESIGN §18.2): Tidy % in [0, 1]; non-decreasing across any tick in which no grime cell is added and no litter is spawned.
Expose `tidy`, `frontageClean[i]`, `stars` read-only for UI and `__ssp.state()`.

## Scope

- Tidy % computation and per-frontage counters (grime cells and litter per zone)
- Clean Sweep +100 award once per frontage per shift
- Would-be stars helper
- Unit tests with hand-computed fixtures and fast-check properties; GDD §9.3 notes

## Out of scope

- Pledge tips and £ (M6)
- Inspector deductions (M6)
- Mercury map colouring (M6)

## Acceptance criteria

- [x] Unit test: with 9,000 initial cells, 4,500 cleaned, 130 spawned and 65 collected, Tidy % = 0.5
- [x] Fixture tests for per-frontage clean % match hand-computed values
- [x] A frontage that reaches 100% awards +100 exactly once even if more litter later spawns in it
- [x] Property tests: Tidy % stays in [0, 1] and never decreases across ticks with no spawns and no new grime
- [x] Stars helper returns 0/1/2/3 at 0.599/0.60/0.80/0.92
- [x] Attribution and empty-zone rules are documented in GDD §9.3

## Verification

- npx vitest run tests/unit/tidy.test.ts tests/property/tidy.prop.test.ts
- npm test
- npm run test:replay
- npm run typecheck

## Dependencies

**Depends on:**

- [SSP-057](SSP-057-litter-field.md) Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn
- [SSP-060](SSP-060-grime-mask.md) Implement dirt.ts grime mask, initial selection, footprint erase and Kerb Hugger
- [SSP-055](SSP-055-compile-frontages-dump-validation.md) Generate frontages and pledges in the compiler and validate dump sites
- [SSP-063](SSP-063-scoring-combo.md) Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger

**Blocks:**

- [SSP-065](SSP-065-tick-order-integration.md) Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test
- [SSP-071](SSP-071-intro-tally-scenes.md) Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry
- [SSP-082](../M3/SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-102](../M3/SSP-102-fx-placeholder-particles.md) Add placeholder particles in src/render/fx.ts for dust, splash and sparkle
- [SSP-290](../M3/SSP-290-tutorial-beats.md) Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events
- [SSP-299](../M3/SSP-299-hud-brush-tidy-arrows.md) Add the Brush-o-meter, brush state ring, district name with Tidy % bar, and off-screen depot/hydrant arrows to the HUD
- [SSP-291](../M4/SSP-291-hud-minimap.md) Implement src/ui/minimap.ts: runtime 64×64 district minimap in the single UI draw
- [SSP-300](../M4/SSP-300-shift-map-overlay.md) Add the Tab shift map overlay: district map with frontage status, depot, skips and hydrants, without pausing
- [SSP-293](../M5/SSP-293-vs-scripted-replays.md) Record the vertical-slice replays vs_slow, vs_fast and vs_practised with a waypoint route follower
- [SSP-187](../M6/SSP-187-progression-economy.md) Add districts.json, upgrades.json and pure week progression and £ ledger
- [SSP-192](../M6/SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-200](../M6/SSP-200-dog-loose-seagull.md) Implement npc.dog_loose chase and npc.seagull chip theft and litter snatching
- [SSP-214](../M6/SSP-214-inspector.md) Implement npc.inspector and the inspection event with frontage deductions

## References

- ../../GDD.md#92-tidy-
- ../../GDD.md#93-frontages-and-pledges
- ../../GDD.md#121-stars-per-district
- ../../TECHNICAL_DESIGN.md#103-grime-mask-srcsimdirtts
- ../../TECHNICAL_DESIGN.md#182-property-tests
- ../../LEVEL_DESIGN.md#710-frontages

## Roadmap tasks covered

- `src/sim/scoring.ts` and `combo.ts`: ... Clean Sweep frontage +100 (the frontage segments come from `level.json`). (Clean Sweep part)
- Measurable check: Tidy % — unit test of `0.6 × grime fraction + 0.4 × litter fraction` over the route area only.
