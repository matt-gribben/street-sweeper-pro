---
id: SSP-042
title: "Author Puddle Lane map.txt and level.json (64\u00d748) and commit compiled output"
milestone: M1
status: done
type: feature
estimate: M
labels: [type:feature, area:gameplay, area:assets, area:test, size:M, vertical-slice]
depends_on: [SSP-033, SSP-034, SSP-041, SSP-039]
blocks: [SSP-045, SSP-049, SSP-050, SSP-054, SSP-055, SSP-056, SSP-061, SSP-076, SSP-104, SSP-299, SSP-117, SSP-178, SSP-183]
---

# SSP-042: Author Puddle Lane map.txt and level.json (64×48) and commit compiled output

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** feature · **Size:** M · **Areas:** gameplay, assets, test · **Vertical slice**

## Summary

Write `assets-src/levels/puddle_lane.map.txt` (64×48) and `puddle_lane.level.json` following LEVEL_DESIGN §5.1 and the §8.5 worked example, compile them with `npm run levels`, and commit `public/assets/levels/puddle_lane.json`. This is the street M1 drives in and later milestones fill. It also proves the full `npm run assets` chain end to end.

## Context

Layout (LEVEL_DESIGN §5.1):
- 64×48 tiles of Old Town terraces.
- Depot on the SW edge: `depot.rect` [0, 38, 14, 10] (x, y, w, h in tiles), `@` inside it, `start.heading` 0 (north). It holds at least 2 `$` depot bays (2×3 tiles each) and a depot building (`use: depot`, `storeys: 2`, `roof.depot`, `facade.depot_shed`, `landmark: true`, as in §8.6).
- **Mangle Street**: a straight 3-tile two-way road heading north from the depot. The grime zone rect [2, 20, 3, 18] in §8.5 puts it at x 2–4, rows 20–37. Its first 30 m is a straight kerb run.
- **Puddle Lane**: rows 4–6, a 3-tile carriageway with 1-tile pavements, parking bays on the south side, one zebra, and speed bumps at both ends.
- **Gutter Row**: x 22–24, running south from Puddle Lane. The skip `s` (2×1) sits in a 2-tile drivable alley off it, with a stopping tile beside it, at least 40 m by path from the depot bays.
- The Golden Crisp is reserved at (44.5, 30.5) tiles, at the dead end of that alley behind the skip (M3 content). Any dead end longer than 6 tiles needs a 5×5 turning head (L014).
- **Pump Green**: about 14×8 tiles at x 26–39, rows 8–15. Hedge-bounded grass with drivable paved paths.
- **Drain Close** and **Soapsud Terrace** complete a figure-of-eight, so no route needs a three-point turn.
- Heights: 2-storey terraces (`roof.slate`) and a 3-storey parade. No street is flanked by more than 3 storeys.
- Exactly 2 hydrants (§5.1 table): the excerpt already has `h` at (38, 3) and (25, 7). 1 skip. 3 speed-bump rows `=`. Parking bays on Puddle Lane and Drain Close. At least 3 straight kerb runs of 15+ tiles.

Rows 0–19 × columns 0–39 must match the §8.5 excerpt verbatim, including building letters A–F, anchors 1 (doris_home), 2 (zebra_puddle_s) and 3 (corner_shop_door), the bollarded 1-tile footway on row 13, and the zebras.

Also place anchors 4–7 for the M3 dog-walker loop around Pump Green, as §8.5 describes.

level.json in M1 (fields per §8.4; values from §8.5):
- `schema` 1, `id` `district.puddle_lane`, `name` 'Puddle Lane', `day` mon, `mode` shift, `map` 'puddle_lane.map.txt', `size` [64, 48], `timer` 240, `seed` 1001
- `timeOfDay` dawn, `weather` clear, `music` `mus.puddle_lane`, `ambience` `amb.town_morning`
- `start`, `depot`, `buildings` (A–F exactly as §8.5, plus the rest), `anchors`
- Litter, grime, pledges, NPCs, traffic and events are M2/M3 content. Either leave them out (if schema.ts makes them optional) or copy the §8.5 values verbatim, but nothing consumes them in M1.

Autotile coverage (ROADMAP M1 measurable check 'autotile covers every kerb configuration in the map'): every cell on a raised road↔pavement boundary must get an autotile index in 0..46 (never 255), and the set of indices used is printed for the PR.

End-to-end assets: with SSP-033 and SSP-039 landed, `npm run assets` (`forge build && npm run audio && npm run levels`) must exit 0 and be byte-stable on rerun. `npm run assets:verify` is an M4 deliverable; run it only if it exists.

Run the LEVEL_DESIGN §12 format and layout checklist items that apply in M1, and note any skipped as M2+. The compiler must pass with no errors.

## Scope

- assets-src/levels/puddle_lane.map.txt (64×48, ASCII, LF, final newline)
- assets-src/levels/puddle_lane.level.json (M1 fields)
- Committed compiled output public/assets/levels/puddle_lane.json (and its asset-hashes entry, if levels are hashed)
- tests/unit/puddleLane.test.ts: excerpt match, site/prop counts, start inside depot, autotile coverage
- PR notes: the applicable LEVEL_DESIGN §12 checklist items ticked, deviations from §5.1 explained, autotile indices used

## Out of scope

- Litter/grime density, frontages and pledges (M2 Puddle Lane level.json task)
- NPC schedules, traffic, hazards and SSP-096 (M3)
- Par tuning and the 3★ replay (M6)

## Acceptance criteria

- [ ] `npm run levels` passes with zero errors for puddle_lane, and the compiled size is [64, 48]
- [ ] Rows 0–19 × columns 0–39 of the map are byte-identical to the LEVEL_DESIGN §8.5 excerpt (unit test)
- [ ] The compiled level has ≥ 2 site.depot_bay, exactly 1 site.skip and exactly 2 prop.hydrant, and the player start lies inside depot rect [0, 38, 14, 10]
- [ ] Every street is part of a loop or ends in a 5×5 turning head (L014 passes), and L010/L015/L020–L022 pass
- [ ] Every raised-kerb boundary cell has an autotile index in 0..46 (unit test over the compiled layers)
- [ ] `npm run assets` exits 0, and a second run leaves `git status --short` empty
- [ ] The committed `public/assets/levels/puddle_lane.json` carries `"music": "mus.puddle_lane"` and `"ambience": "amb.town_morning"`.

## Verification

- npm run levels
- shasum -a 256 public/assets/levels/puddle_lane.json  (before/after a second compile)
- npm run assets && git status --short
- npm test

## Dependencies

**Depends on:**

- [SSP-033](SSP-033-level-compiler-core.md) Build level schema and compile-level.ts core: parse, legend, buildings, M1 checks
- [SSP-034](SSP-034-compiler-autotile-collision.md) Add kerb blob autotile, kerb edges, collision bits and merged solids to compiler
- [SSP-041](SSP-041-placeholder-facades-roofs.md) Add placeholder facade modules, facade sets and roof surfaces for Puddle Lane
- [SSP-039](SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end

**Blocks:**

- [SSP-045](SSP-045-render-ground-city.md) Render compiled levels: chunked ground layer and full cityMesh cell merge
- [SSP-049](SSP-049-m1-drive-replay.md) Record and commit the m1_drive_puddle_lane replay and its final-state hash
- [SSP-050](SSP-050-m1-exit-close.md) Verify M1 exit criteria, run the lead handling playtest and open the Close M1 PR
- [SSP-054](../M2/SSP-054-compile-route-grime-litter-layers.md) Extend compile-level.ts with route, grime density, gutter and litter weight layers
- [SSP-055](../M2/SSP-055-compile-frontages-dump-validation.md) Generate frontages and pledges in the compiler and validate dump sites
- [SSP-056](../M2/SSP-056-puddle-lane-sweeping-content.md) Author Puddle Lane litter, grime, frontages, pledges and collectibles data
- [SSP-061](../M2/SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats
- [SSP-076](../M3/SSP-076-compile-lane-nav-graphs.md) Compile the traffic lane graph and pavement nav graph in compile-level.ts
- [SSP-104](../M3/SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up
- [SSP-299](../M3/SSP-299-hud-brush-tidy-arrows.md) Add the Brush-o-meter, brush state ring, district name with Tidy % bar, and off-screen depot/hydrant arrows to the HUD
- [SSP-117](../M4/SSP-117-forge-verify-ci.md) Extend forge verify to level and M4 outputs, prove assets idempotence, fill forge pytest gaps and add verify + lint to CI
- [SSP-178](../M5/SSP-178-music-player.md) Implement music.ts: sample-locked stems, loops, jingles and scene music
- [SSP-183](../M5/SSP-183-amb-town-morning.md) Add the ambience bed player and author amb.town_morning

## References

- ../../LEVEL_DESIGN.md#51-mon-puddle-lane-districtpuddle_lane-tutorial
- ../../LEVEL_DESIGN.md#85-worked-example-1-a-puddle-lane-excerpt
- ../../LEVEL_DESIGN.md#86-worked-example-2-the-depot-yard-complete
- ../../LEVEL_DESIGN.md#7-level-building-blocks
- ../../LEVEL_DESIGN.md#79-sight-lines-and-the-camera
- ../../LEVEL_DESIGN.md#12-level-design-checklist
- ../../LEVEL_DESIGN.md#84-leveljson-schema
- ../../ASSET_PIPELINE.md#52-packagejson-scripts

## Roadmap tasks covered

- Author `puddle_lane.map.txt` (64×48) and `puddle_lane.level.json` following [LEVEL_DESIGN.md](../../LEVEL_DESIGN.md): terraces of 2–3 storeys, `site.depot_bay` reachable, at least one `site.skip` and one `prop.hydrant` placed (for M2).
- `Exit criteria: Puddle Lane compiled from ASCII`
- `Measurable check (Level compile): Puddle Lane is 64×48; autotile covers every kerb configuration in the map; compile deterministic`
