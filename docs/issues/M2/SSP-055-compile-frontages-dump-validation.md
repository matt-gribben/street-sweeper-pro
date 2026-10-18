---
id: SSP-055
title: "Generate frontages and pledges in the compiler and validate dump sites"
milestone: M2
status: todo
type: feature
estimate: M
labels: [type:feature, area:tooling, size:M, vertical-slice]
depends_on: [SSP-054, SSP-033, SSP-042]
blocks: [SSP-056, SSP-062, SSP-064, SSP-077, SSP-085, SSP-105, SSP-299, SSP-291, SSP-300, SSP-187]
---

# SSP-055: Generate frontages and pledges in the compiler and validate dump sites

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** feature · **Size:** M · **Areas:** tooling · **Vertical slice**

## Summary

Generate `site.frontage` scoring segments with stable `fr_<x>_<y>` IDs, resolve the pledge list, emit compiled site rects for depot bays and skips, and add the dump, hydrant, power-up and collectible validation rules so Puddle Lane's sweeping layout is checked at compile time.

## Context

Frontage rules (LEVEL_DESIGN §7.10): generated for every building edge facing pavement or a precinct when the building's `use` is house, shop, pub, takeaway, civic or unit. A facade run splits into segments of `frontageWidth` tiles: house 3, shop 4, pub/takeaway 5, unit 6, civic 8 (initial; overridable per level via `frontageWidth` and per building). A leftover under half a width merges into the last segment, otherwise it becomes its own frontage. Zone = pavement tiles in front of the segment (up to 3 deep) plus the first road tile beyond the kerb (the gutter). ID = `fr_<x>_<y>` from the north-west-most pavement tile of its zone.
Compiled output (TECHNICAL_DESIGN §15.2): `frontages: [{ id, pledge, rect, face }]`, `sites: [{ id, rect }]` (`site.depot_bay` from `$`, 2×3 tiles; `site.skip` from `s`, 2×1 tiles), `props` (`prop.hydrant` from `h`). Open question: a zone may not be a perfect rectangle where pavement depth varies. The schema has one `rect`; propose a rect clipped to pavement + gutter tiles, or add a cell list, and document the choice in §15.2.
LEVEL_DESIGN §13 Q4 (frontage widths and zone depth) is owned by M2: confirm the values (they are tunable later) and close the question.
Validation (LEVEL_DESIGN §10.3): L020 error for fewer than 2 depot bays, a skip within 40 m (path distance) of a depot bay, or a route tile more than 200 m from a dump site; L021 error for a route tile more than 150 m from a hydrant or depot bay; L022 error for a skip or hydrant with no stopping tile beside it; L030 error when pledges are not 8–20 or a pledge ID is not a generated frontage; L031 warning when more than a third of pledges are on one street; L040 error for power-up count outside 1–3; L041 error when Lost Property or Golden Crisp is missing, unreachable by Bessie's body or in a footway. Path distances use BFS over drivable tiles (2 m per tile). 'Street' for L031: propose the connected run of road tiles the frontage's gutter tile belongs to, split at junctions, and document it. Skip any rule M1 already implemented.
Depot (LEVEL_DESIGN §7.7): `depot.rect` at the map edge contains `@` and at least 2 `site.depot_bay`.

## Scope

- Frontage generation and stable IDs in `compile-level.ts`
- Pledge resolution into `frontages[].pledge`
- `sites` output for depot bays and skips
- Validation codes L020, L021, L022, L030, L031, L040, L041
- Fixture-based unit tests; close LEVEL_DESIGN §13 Q4; document zone shape in TECHNICAL_DESIGN §15.2

## Out of scope

- Per-frontage clean % at runtime (SSP-064)
- Inspector routes, Mercury map colouring (M6)
- Authoring Puddle Lane's pledges (SSP-056)

## Acceptance criteria

- [ ] A fixture terrace of 10 house tiles facing pavement yields frontages of width 3, 3 and 4 (the 1-tile leftover merges) with IDs from the NW-most zone tile
- [ ] Pledge IDs not matching a generated frontage fail with L030; 7 or 21 pledges fail with L030
- [ ] Each of L020, L021, L022, L040, L041 fires on a crafted bad fixture with code and file:row:col; L031 prints a warning without failing
- [ ] Compiled output lists `sites` for every `$` and `s` and stays byte-deterministic across two runs
- [ ] LEVEL_DESIGN §13 Q4 is marked resolved with the chosen values

## Verification

- npm test
- npm run levels
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-054](SSP-054-compile-route-grime-litter-layers.md) Extend compile-level.ts with route, grime density, gutter and litter weight layers
- [SSP-033](../M1/SSP-033-level-compiler-core.md) Build level schema and compile-level.ts core: parse, legend, buildings, M1 checks
- [SSP-042](../M1/SSP-042-puddle-lane-level.md) Author Puddle Lane map.txt and level.json (64×48) and commit compiled output

**Blocks:**

- [SSP-056](SSP-056-puddle-lane-sweeping-content.md) Author Puddle Lane litter, grime, frontages, pledges and collectibles data
- [SSP-062](SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event
- [SSP-064](SSP-064-tidy-frontages.md) Compute Tidy %, per-frontage clean % and Clean Sweep bonuses incrementally
- [SSP-077](../M3/SSP-077-compile-spawn-specs.md) Compile NPC, traffic, hazard, knockable and power-up spawn specs from level.json
- [SSP-085](../M3/SSP-085-behaviour-old-man-mum-postie.md) Implement old man, mum with pushchair and postie, and the occupied-zebra penalty
- [SSP-105](../M3/SSP-105-high-street-greybox.md) Author and compile the grey-box High Street (80×60) for Tuesday's NPCs
- [SSP-299](../M3/SSP-299-hud-brush-tidy-arrows.md) Add the Brush-o-meter, brush state ring, district name with Tidy % bar, and off-screen depot/hydrant arrows to the HUD
- [SSP-291](../M4/SSP-291-hud-minimap.md) Implement src/ui/minimap.ts: runtime 64×64 district minimap in the single UI draw
- [SSP-300](../M4/SSP-300-shift-map-overlay.md) Add the Tab shift map overlay: district map with frontage status, depot, skips and hydrants, without pausing
- [SSP-187](../M6/SSP-187-progression-economy.md) Add districts.json, upgrades.json and pure week progression and £ ledger

## References

- ../../LEVEL_DESIGN.md#710-frontages
- ../../LEVEL_DESIGN.md#77-depot-skips-and-hydrants
- ../../LEVEL_DESIGN.md#103-validation-rules
- ../../LEVEL_DESIGN.md#13-open-questions
- ../../TECHNICAL_DESIGN.md#152-compiled-schema-v1
- ../../GDD.md#93-frontages-and-pledges

## Roadmap tasks covered

- Puddle Lane `level.json`: litter density, spawn tables, frontages and pledge list. (compiler support for frontages and pledges)
- `src/sim/scoring.ts` and `combo.ts`: ... Clean Sweep frontage +100 (the frontage segments come from `level.json`). (frontage generation part)
