---
id: SSP-033
title: "Build level schema and compile-level.ts core: parse, legend, buildings, M1 checks"
milestone: M1
status: done
type: feature
estimate: L
labels: [type:feature, area:tooling, area:test, size:L, vertical-slice]
depends_on: [SSP-032, SSP-006, SSP-002, SSP-009]
blocks: [SSP-034, SSP-042, SSP-054, SSP-055, SSP-076, SSP-117, SSP-132, SSP-178, SSP-183, SSP-190, SSP-197]
---

# SSP-033: Build level schema and compile-level.ts core: parse, legend, buildings, M1 checks

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** feature · **Size:** L · **Areas:** tooling, test · **Vertical slice**

## Summary

Create the deterministic ASCII level compiler (`npm run levels`): parse `<district>.map.txt` plus `level.json`, resolve the legend, ground inheritance, building columns, props, sites and start, validate the M1 core rule set, and write the v1 compiled JSON through `src/sim/map.ts`.

## Context

Files:
- `tools/levels/schema.ts`: type-only, from LEVEL_DESIGN §8.4
- `tools/levels/compile-level.ts`: holds `DEFAULT_LEGEND`
- Uses `src/sim/map.ts` (SSP-032) for ids and encoding
- Output: `public/assets/levels/<name>.json`

The tool runs as `node tools/levels/compile-level.ts` on Node 24 type stripping (no tsx). Explicit `.ts` relative imports. It may import `src/sim/**`, `src/data/**` and Node built-ins, never `three` or `src/render`.

map.txt rules (§8.2):
- ASCII only, LF line endings, no trailing whitespace, a final newline, exactly size[1] rows × size[0] columns, no tabs or blank lines.
- Row 0 is north, column 0 is west. One char = one 2 m tile.
- `A`–`Z` are buildings from `level.json` → `buildings`; same letters that touch orthogonally merge; different letters are separate buildings.
- `0`–`9` are anchors. Exactly one `@`, inside `depot.rect` ([x, y, w, h] in tiles).
- Prop/site/anchor chars inherit ground: the most common plain-ground char among the 4 orthogonal neighbours, ties going to pavement.
- A level may add or override legend entries but may not redefine `A`–`Z`, `0`–`9` or `@`.

Default legend (§8.3):
- Ground: `#` road, `><^v` one-way road, `.` pavement, `:` cobbles, `;` alley, `,` grass, `%` yard, `+` apron, `~` water, `_` sand, space = void
- Road features (ground = road): `z` zebra, `k` school crossing, `b` bus stop, `p` parking bay, `=` speed bump
- Props: `l` lamp_post, `h` hydrant, `n` bench, `t` tree, `i` litter_bin, `u` bus_shelter, `f` phone_box, `q` post_box, `!` bollard, `g` planter, `m` market_stall
- Walls and hedges: `w` low wall, `e` hedge, `r` railing
- Sites and markers: `d` dropped kerb (ground pavement), `s` skip, `$` depot_bay, `@` start

Layers written here: `ground`, `surface` (from the ground→surface mapping in map.ts), `storeys`/`roof`/`wall` (building columns), `route` (from the legend's route-area column; `;` only if drivable), `autotile` all 255 and `collide` 0 (filled by SSP-034), `grimeDensity` and `gutter` zero-filled until M2. Lists: `props`, `sites`, `player`, anchors; `solids` [], `frontages` [], `lanes`/`nav` as `{nodes: [], edges: []}` stubs until M3, `spawns` {}, `schedules` []. `weather` and `timerS` from level.json.

Validation in this issue (§10.3). Messages use `puddle_lane.map.txt:8:23 L013 …` (1-based row:col); errors exit non-zero:
- L001 size, ASCII, tabs, trailing whitespace
- L002 unknown char
- L003 `@` count or position
- L004 storeys 1–6 (1–8 with `landmark: true`), and `roof.*`/`facade.*` IDs exist in `assets-src/manifest.json` (read with fs)
- L006 timer 240 (shift) or 45 (skip run)
- L010 drivable area is one connected region reachable from `@`
- L013 isolated road tile
L014, L015 and L020–L022 belong to SSP-034. L005/L007 wait for entities.json (M2), L011/L012 for the lane graph (M3), L030+ for M2/M3/M6.

OPEN (flag in the PR):
1. Map size is meant to be checked against `src/data/districts.json` (TECHNICAL_DESIGN §15.1), which no M1 task creates. In M1, check against `level.json` → `size`.
2. `schema.ts` makes `pledges`, `litter` and `grime` required, but those arrive in M2. Proposal: optional until M2, with a comment.

The compiler accepts `--out <dir>`, because forge verify rebuilds levels into a temp root (ASSET_PIPELINE §5.2). Once this lands, `npm run assets` (`forge build && npm run audio && npm run levels`) no longer stops at the levels stub; the audio stub is handled in SSP-039.

Correction: the audio side of `npm run assets` needs no work in M1. SSP-006 (M0) already made render-sfx.ts and render-music.ts input-count guards that exit 0 with '0 sources; nothing to render' and accept `--out`. SSP-039 no longer touches audio.

Audio theme fields: LEVEL_DESIGN §8.4 defines optional `music?: mus.*` and `ambience?: amb.*` in level.json (Puddle Lane uses `mus.puddle_lane` / `amb.town_morning`), and in M5 music.ts and the ambience bed player read them from the compiled level. Copy both into the compiled header next to `weather` and `timerS`, add them as optional fields of the compiled-level type in `src/sim/map.ts`, and omit them when absent (the Depot Yard has no `music`, LEVEL_DESIGN §8.6). Validate the shape now: `music` must match `^mus\.[a-z0-9_]+$` and `ambience` must match `^amb\.[a-z0-9_]+$`. A malformed value fails with the standard `<file>:<row>:<col> L005` message format; the rest of L005 still waits for entities.json in M2. Checking that the ID names a rendered song or bed is not possible until music.json/amb.json exist (M5). Add both fields to the TECHNICAL_DESIGN §15.2 compiled schema example in the same PR.

## Scope

- tools/levels/schema.ts (type-only LevelFile and friends from LEVEL_DESIGN §8.4)
- tools/levels/compile-level.ts: DEFAULT_LEGEND, map parse, legend overrides, ground inheritance, building merge into storeys/roof/wall layers, surface and route layers, props/sites/player/anchors extraction, zero-filled M2 layers, stub lanes/nav
- Validation codes L001–L004, L006, L010, L013 with file:row:col messages; non-zero exit on error
- `--out <dir>` flag; compiles every pair in assets-src/levels/
- Wire `npm run levels` to the real tool (replacing the M0 stub)
- Fixtures under tests/fixtures/levels/ (one small failing map per implemented code, one valid map)
- tests/unit/compileLevel.test.ts plus tests/property/levelRoundTrip.prop.test.ts (random legal maps compile, decode and re-encode byte-identically, TECHNICAL_DESIGN §18.2)
- Pass level.json `music` and `ambience` through to the compiled header (omitted when absent), typed in src/sim/map.ts, with a prefix-shape check; add both to TECHNICAL_DESIGN §15.2

## Out of scope

- map.ts codec and solid merge: SSP-032
- Kerb autotile, KERB_EDGE/SOLID bits, merged solids, path-distance rules: SSP-034
- Lane graph and pavement nav graph (M3)
- Frontages, pledges, spawn tables, grime baking, par report (M2/M6)
- Authoring Puddle Lane: SSP-042
- Creating districts.json
- Checking that `music`/`ambience` IDs exist in public/assets/audio/music.json / amb.json (those files arrive in M5)

## Acceptance criteria

- [ ] `npm run levels` compiles the valid fixture, and two runs produce byte-identical output (same SHA-256)
- [ ] Each implemented error code has a fixture that fails with the exact `<file>:<row>:<col> Lnnn` message format and a non-zero exit
- [ ] The level round-trip fast-check property passes on random legal maps with a fixed seed
- [ ] Prop and site chars get inherited ground per the tie rule (unit test with a tie that goes to pavement)
- [ ] Same-letter buildings that touch orthogonally merge; different letters stay separate (unit test)
- [ ] `node tools/levels/compile-level.ts` runs without tsx and imports src/sim/map.ts directly
- [ ] Open questions 1–2 are written in the PR description, and schema decisions are documented in tools/levels/schema.ts comments
- [ ] Unit test: a fixture level.json with `music: "mus.puddle_lane"` and `ambience: "amb.town_morning"` compiles to JSON carrying those exact values; a fixture without them omits both keys; `music: "puddle_lane"` fails with an L005-format error
- [ ] TECHNICAL_DESIGN §15.2 lists the optional `music` and `ambience` compiled fields

## Verification

- npm run levels
- npm run levels && shasum -a 256 public/assets/levels/*.json  (run twice, compare)
- npm run typecheck
- npm run lint
- npm test

## Dependencies

**Depends on:**

- [SSP-032](SSP-032-level-map-codec.md) Add src/sim/map.ts compiled-level codec, tile/surface/collide ids and solid merge
- [SSP-006](../M0/SSP-006-npm-scripts-ci-workflow.md) Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow
- [SSP-002](../M0/SSP-002-node-scaffold.md) Scaffold the Node/TypeScript/Vite repo with exact pins and verify TS 7.0.2 (D-10)
- [SSP-009](../M0/SSP-009-forge-build-grid-blender.md) Implement forge build for grid and blender techniques with outline and byte-stable PNGs

**Blocks:**

- [SSP-034](SSP-034-compiler-autotile-collision.md) Add kerb blob autotile, kerb edges, collision bits and merged solids to compiler
- [SSP-042](SSP-042-puddle-lane-level.md) Author Puddle Lane map.txt and level.json (64×48) and commit compiled output
- [SSP-054](../M2/SSP-054-compile-route-grime-litter-layers.md) Extend compile-level.ts with route, grime density, gutter and litter weight layers
- [SSP-055](../M2/SSP-055-compile-frontages-dump-validation.md) Generate frontages and pledges in the compiler and validate dump sites
- [SSP-076](../M3/SSP-076-compile-lane-nav-graphs.md) Compile the traffic lane graph and pavement nav graph in compile-level.ts
- [SSP-117](../M4/SSP-117-forge-verify-ci.md) Extend forge verify to level and M4 outputs, prove assets idempotence, fill forge pytest gaps and add verify + lint to CI
- [SSP-132](../M4/SSP-132-roofkit-layout.md) Blender roof kit and the seeded roof-furniture layout script
- [SSP-178](../M5/SSP-178-music-player.md) Implement music.ts: sample-locked stems, loops, jingles and scene music
- [SSP-183](../M5/SSP-183-amb-town-morning.md) Add the ambience bed player and author amb.town_morning
- [SSP-190](../M6/SSP-190-compiler-m6.md) Extend compile-level for M6: skip_run mode, night lamp pools, landmarks, M6 events
- [SSP-197](../M6/SSP-197-depot-yard-level.md) Author and compile district.depot_yard with all seven Skip Run variants

## References

- ../../LEVEL_DESIGN.md#8-map-authoring-format
- ../../LEVEL_DESIGN.md#82-maptxt-rules
- ../../LEVEL_DESIGN.md#83-default-legend
- ../../LEVEL_DESIGN.md#84-leveljson-schema
- ../../LEVEL_DESIGN.md#10-the-compile-step
- ../../LEVEL_DESIGN.md#103-validation-rules
- ../../TECHNICAL_DESIGN.md#151-compile-step
- ../../TECHNICAL_DESIGN.md#152-compiled-schema-v1
- ../../TECHNICAL_DESIGN.md#182-property-tests
- ../../ASSET_PIPELINE.md#52-packagejson-scripts

## Roadmap tasks covered

- `tools/levels/compile-level.ts`: legend parse, building columns, autotile, collision grid. The lane graph and pavement nav graph are stubbed until M3. [legend parse, building columns, stubs]
