# Build issues

Generated from [ROADMAP.md](../ROADMAP.md) §4. One file per issue; each is sized for one AI-agent session (S ≤ ½ day, M ≈ 1 day, L ≈ 2 days).
Update an issue's `status:` front matter (`todo` → `in-progress` → `done`) as work lands. Dependencies are in each file's `depends_on` / `blocks` front matter.

| Milestone | Issues | S / M / L | Vertical slice |
|---|---|---|---|
| [M0 Foundations & Look Spike](#m0) | 28 | 1 / 20 / 7 | 27 |
| [M1 Drivable Bessie](#m1) | 24 | 6 / 14 / 4 | 23 |
| [M2 Sweeping Core](#m2) | 25 | 2 / 18 / 5 | 25 |
| [M3 Living Street](#m3) | 43 | 6 / 30 / 7 | 40 |
| [M4 Art Pass 1](#m4) | 51 | 2 / 36 / 13 | 46 |
| [M5 Sound & Music](#m5) | 31 | 1 / 21 / 9 | 29 |
| [M6 Tidy Town Week](#m6) | 49 | 1 / 31 / 17 | 0 |
| [M7 1.0 Web Release](#m7) | 22 | 2 / 15 / 5 | 0 |
| [M8 Touch & Mobile Web](#m8) | 14 | 6 / 6 / 2 | 0 |
| [M9 Desktop & Extra Modes](#m9) | 15 | 4 / 8 / 3 | 0 |
| **Total** | **302** | | **190** |

**Start here:** issues with no dependencies: [SSP-001](M0/SSP-001-probe-ai-goldens-import.md), [SSP-002](M0/SSP-002-node-scaffold.md), [SSP-004](M0/SSP-004-forge-skeleton-pixelize.md), [SSP-250](M7/SSP-250-butler-install.md).

<a id="m0"></a>
## M0 Foundations & Look Spike

| ID | Title | Type | Size | Depends on |
|---|---|---|---|---|
| [SSP-001](M0/SSP-001-probe-ai-goldens-import.md) | Import probe Codex sheets as AI golden candidates with retro-filled meta.json ★ | chore | S | — |
| [SSP-002](M0/SSP-002-node-scaffold.md) | Scaffold the Node/TypeScript/Vite repo with exact pins and verify TS 7.0.2 (D-10) ★ | chore | M | — |
| [SSP-003](M0/SSP-003-lint-purity-ip-tests.md) | Add biome.json sim-purity rules plus simPurity and ipHygiene unit tests ★ | test | M | SSP-002 |
| [SSP-004](M0/SSP-004-forge-skeleton-pixelize.md) | Create the forge Python package (uv, CLI skeleton) and import pixelize.py with tests ★ | feature | M | — |
| [SSP-005](M0/SSP-005-kerbside32-palette.md) | Author kerbside32.json and forge OKLab palette mapping with a shared 4,096-sample fixture ★ | feature | M | SSP-004 |
| [SSP-006](M0/SSP-006-npm-scripts-ci-workflow.md) | Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow ★ | chore | M | SSP-002, SSP-003, SSP-004 |
| [SSP-007](M0/SSP-007-blender-rig-wrapper.md) | Implement assets-src/blender/rig.py and the forge blender wrapper with --check ★ | feature | M | SSP-004, SSP-005, SSP-006 |
| [SSP-008](M0/SSP-008-blender-bessie.md) | Port the probe sweeper onto rig.py and commit Bessie body, dented and brush renders ★ | asset | L | SSP-007 |
| [SSP-009](M0/SSP-009-forge-build-grid-blender.md) | Implement forge build for grid and blender techniques with outline and byte-stable PNGs ★ | feature | L | SSP-005, SSP-008 |
| [SSP-010](M0/SSP-010-forge-pack-verify.md) | Add deterministic atlas packing, generated assets.ts, asset-hashes.json and forge verify ★ | feature | L | SSP-009, SSP-006 |
| [SSP-011](M0/SSP-011-forge-lint-sheets.md) | Implement minimal forge lint and forge sheets for M0 asset review ★ | feature | M | SSP-010, SSP-001 |
| [SSP-012](M0/SSP-012-genai-codex-wrapper.md) | Implement forge gen-ai Codex wrapper with preamble v1 and a concept.spike_street smoke run ★ | feature | L | SSP-004, SSP-005, SSP-003, SSP-006 |
| [SSP-013](M0/SSP-013-ingest-prototype.md) | Prototype forge ingest (steps 1-10) to turn an AI golden into an indexed sprite grid ★ | feature | L | SSP-009, SSP-001 |
| [SSP-014](M0/SSP-014-people-style-acceptance.md) | Accept ref.people_style and ingest the spike pedestrian grid (D-04, D-13) ★ | asset | M | SSP-013, SSP-011, SSP-012 |
| [SSP-015](M0/SSP-015-render-core-camera-upscale.md) | Build the renderer skeleton: perspective camera, sub-pixel snap, upscale and speed zoom ★ | feature | L | SSP-002 |
| [SSP-016](M0/SSP-016-palette-pass.md) | Implement the MRT world target and palette pass (64³ OKLab LUT, night/shadow remap) ★ | feature | M | SSP-015, SSP-005 |
| [SSP-017](M0/SSP-017-city-mesh-shadows.md) | Render merged 1/3/6-storey block meshes with facade ramps and SE shadow polygons ★ | feature | M | SSP-016 |
| [SSP-018](M0/SSP-018-sprite-batch.md) | Draw Bessie (32 headings) and the pedestrian via instanced sprite batches ★ | feature | L | SSP-016, SSP-010, SSP-014 |
| [SSP-019](M0/SSP-019-test-hooks-lean-quadrants.md) | Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene ★ | feature | M | SSP-017, SSP-018 |
| [SSP-020](M0/SSP-020-lamp-post-stack.md) | Prototype a 4-slice sprite-stack lamp post and add it to lean_quadrants (D-02 input) ★ | spike | M | SSP-019, SSP-007 |
| [SSP-021](M0/SSP-021-night-shadow-tuning.md) | Tune night[32] and shadow[32] remap tables in the spike scene (D-05, D-06) ★ | spike | M | SSP-019, SSP-020 |
| [SSP-022](M0/SSP-022-visual-goldens.md) | Add lean_quadrants and scale_1440 visual specs and goldens; prove 10-run stability (D-09) ★ | test | M | SSP-019, SSP-020, SSP-006, SSP-021 |
| [SSP-023](M0/SSP-023-perf-baseline.md) | Baseline perf.spec.ts on the dev Mac GPU and set the p99 frame-time budget (D-08) ★ | test | M | SSP-019, SSP-006 |
| [SSP-024](M0/SSP-024-look-decisions.md) | Decide speed zoom, vehicle tilt, 480x270 base and scale sheet (D-01, D-02, D-03, D-07) ★ | spike | M | SSP-020, SSP-022, SSP-008 |
| [SSP-025](M0/SSP-025-pipeline-determinism-spikes.md) | Measure cross-platform PNG identity and ffmpeg encode determinism (D-12, D-11) ★ | spike | M | SSP-010, SSP-006 |
| [SSP-026](M0/SSP-026-style-lock.md) | Write assets-src/STYLE.md v1 locking scale, palette and people style; mirror ART_BIBLE ★ | docs | M | SSP-021, SSP-014, SSP-024, SSP-020, SSP-008 |
| [SSP-027](M0/SSP-027-m0-exit-close.md) | Verify M0 exit criteria, complete the decision log and open the Close M0 PR | release | M | SSP-026, SSP-022, SSP-023, SSP-025, SSP-024, SSP-012, SSP-011, SSP-006, SSP-292 |
| [SSP-292](M0/SSP-292-heap-threshold-spike.md) | Measure the zero-allocation heap-growth threshold and add the shared --expose-gc heap-delta helper ★ | spike | M | SSP-002, SSP-006 |

<a id="m1"></a>
## M1 Drivable Bessie

| ID | Title | Type | Size | Depends on |
|---|---|---|---|---|
| [SSP-028](M1/SSP-028-sim-foundations.md) | Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type ★ | feature | S | SSP-002, SSP-003 |
| [SSP-029](M1/SSP-029-tuning-data.md) | Create tuning.json vehicle.sweeper block and typed src/sim/tuning.ts ★ | feature | S | SSP-028, SSP-002 |
| [SSP-030](M1/SSP-030-vehicle-model.md) | Implement Bessie's kinematic bicycle model in src/sim/vehicle.ts ★ | feature | M | SSP-028, SSP-029 |
| [SSP-031](M1/SSP-031-collision-primitives.md) | Implement OBB, SAT and sweep sub-step primitives in src/sim/collision ★ | feature | M | SSP-028 |
| [SSP-032](M1/SSP-032-level-map-codec.md) | Add src/sim/map.ts compiled-level codec, tile/surface/collide ids and solid merge ★ | feature | M | SSP-028, SSP-002 |
| [SSP-033](M1/SSP-033-level-compiler-core.md) | Build level schema and compile-level.ts core: parse, legend, buildings, M1 checks ★ | feature | L | SSP-032, SSP-006, SSP-002, SSP-009 |
| [SSP-034](M1/SSP-034-compiler-autotile-collision.md) | Add kerb blob autotile, kerb edges, collision bits and merged solids to compiler ★ | feature | L | SSP-033 |
| [SSP-035](M1/SSP-035-world-tick-order.md) | Add World, EventQueue and fixed tick order with surface grip and kerb jolts ★ | feature | M | SSP-028, SSP-029, SSP-030, SSP-032 |
| [SSP-036](M1/SSP-036-static-collision.md) | Resolve Bessie against static geometry with impact damage and TOWED stub ★ | feature | M | SSP-031, SSP-035, SSP-032, SSP-029 |
| [SSP-037](M1/SSP-037-collision-property-tests.md) | Add fast-check collision properties: never inside a solid, no tunnelling at 17.2 m/s ★ | test | M | SSP-036 |
| [SSP-038](M1/SSP-038-replay-and-hash.md) | Implement replay format, quantised state hash and the npm run test:replay runner ★ | feature | M | SSP-035, SSP-032, SSP-002, SSP-006, SSP-027, SSP-292 |
| [SSP-039](M1/SSP-039-forge-pack-gen-assets.md) | Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end ★ | feature | S | SSP-004, SSP-005, SSP-009, SSP-010, SSP-011, SSP-008, SSP-018, SSP-022, SSP-006, SSP-025 |
| [SSP-040](M1/SSP-040-procedural-tiles.md) | Generate placeholder ground tiles and the 47-tile kerb blob set with tiles.py ★ | asset | L | SSP-039, SSP-034, SSP-005, SSP-004, SSP-011 |
| [SSP-041](M1/SSP-041-placeholder-facades-roofs.md) | Add placeholder facade modules, facade sets and roof surfaces for Puddle Lane ★ | asset | M | SSP-039, SSP-009, SSP-005, SSP-026 |
| [SSP-042](M1/SSP-042-puddle-lane-level.md) | Author Puddle Lane map.txt and level.json (64×48) and commit compiled output ★ | feature | M | SSP-033, SSP-034, SSP-041, SSP-039 |
| [SSP-043](M1/SSP-043-app-shell.md) | Add the fixed 60 Hz loop, Game, SceneManager and typed event bus ★ | feature | M | SSP-035, SSP-019, SSP-022 |
| [SSP-044](M1/SSP-044-input-devices.md) | Implement keyboard and gamepad input producing quantised per-tick InputFrames ★ | feature | M | SSP-028, SSP-043 |
| [SSP-045](M1/SSP-045-render-ground-city.md) | Render compiled levels: chunked ground layer and full cityMesh cell merge ★ | feature | L | SSP-039, SSP-040, SSP-041, SSP-034, SSP-042, SSP-032, SSP-043, SSP-015, SSP-016, SSP-017, SSP-022 |
| [SSP-046](M1/SSP-046-shift-scene-drive.md) | Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie ★ | feature | M | SSP-043, SSP-044, SSP-045, SSP-036, SSP-038, SSP-018, SSP-019, SSP-008, SSP-024 |
| [SSP-047](M1/SSP-047-camera-lookahead-zoom.md) | Drive camera look-ahead and speed zoom from Bessie's real speed ★ | feature | M | SSP-046, SSP-024, SSP-015 |
| [SSP-048](M1/SSP-048-dev-panel.md) | Add the F1 dev panel for live tuning, telemetry and Save replay | feature | S | SSP-046, SSP-038 |
| [SSP-049](M1/SSP-049-m1-drive-replay.md) | Record and commit the m1_drive_puddle_lane replay and its final-state hash ★ | test | S | SSP-038, SSP-042, SSP-036, SSP-035 |
| [SSP-050](M1/SSP-050-m1-exit-close.md) | Verify M1 exit criteria, run the lead handling playtest and open the Close M1 PR ★ | release | S | SSP-030, SSP-037, SSP-036, SSP-042, SSP-045, SSP-047, SSP-049, SSP-048, SSP-044, SSP-046, SSP-027 |
| [SSP-297](M1/SSP-297-r8-index-atlases-swap-texture.md) | Convert actors/items atlases to R8 index textures with an identity 32x8 swap texture ★ | feature | M | SSP-018, SSP-010, SSP-039, SSP-005, SSP-016, SSP-022 |

<a id="m2"></a>
## M2 Sweeping Core

| ID | Title | Type | Size | Depends on |
|---|---|---|---|---|
| [SSP-051](M2/SSP-051-placeholder-litter-sprites.md) | Author placeholder grids for all 15 litter IDs and add the items atlas ★ | asset | L | SSP-009, SSP-011, SSP-026, SSP-039 |
| [SSP-052](M2/SSP-052-placeholder-stains-pickups-sites.md) | Add stain generator, grime overlays and pickup/collectible/site/hydrant grids ★ | asset | L | SSP-051, SSP-009, SSP-005, SSP-040, SSP-039 |
| [SSP-053](M2/SSP-053-entities-tuning-seed.md) | Seed entities.json with litter, stains and pickups; add M2 values to tuning.json ★ | feature | M | SSP-051, SSP-052, SSP-029, SSP-003 |
| [SSP-054](M2/SSP-054-compile-route-grime-litter-layers.md) | Extend compile-level.ts with route, grime density, gutter and litter weight layers ★ | feature | M | SSP-053, SSP-033, SSP-034, SSP-032, SSP-042 |
| [SSP-055](M2/SSP-055-compile-frontages-dump-validation.md) | Generate frontages and pledges in the compiler and validate dump sites ★ | feature | M | SSP-054, SSP-033, SSP-042 |
| [SSP-056](M2/SSP-056-puddle-lane-sweeping-content.md) | Author Puddle Lane litter, grime, frontages, pledges and collectibles data ★ | feature | M | SSP-053, SSP-054, SSP-055, SSP-042 |
| [SSP-057](M2/SSP-057-litter-field.md) | Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn ★ | feature | L | SSP-053, SSP-054, SSP-056, SSP-028, SSP-035, SSP-032, SSP-038 |
| [SSP-058](M2/SSP-058-hopper.md) | Implement hopper.ts LU accounting, mass coupling and bulldozer state ★ | feature | S | SSP-053, SSP-030, SSP-035 |
| [SSP-059](M2/SSP-059-brush.md) | Implement brush.ts state machine, suction, inlet collection and fling roll ★ | feature | L | SSP-057, SSP-058, SSP-028, SSP-030, SSP-038 |
| [SSP-060](M2/SSP-060-grime-mask.md) | Implement dirt.ts grime mask, initial selection, footprint erase and Kerb Hugger ★ | feature | L | SSP-054, SSP-056, SSP-059, SSP-034, SSP-036, SSP-032, SSP-028, SSP-038 |
| [SSP-061](M2/SSP-061-water-stains.md) | Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats ★ | feature | M | SSP-053, SSP-057, SSP-059, SSP-028, SSP-042, SSP-035 |
| [SSP-062](M2/SSP-062-shift-dumping-timer.md) | Implement shift.ts dumping FSM, 240 s timer and end-of-shift event ★ | feature | M | SSP-058, SSP-061, SSP-055, SSP-036, SSP-028, SSP-035 |
| [SSP-063](M2/SSP-063-scoring-combo.md) | Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger ★ | feature | M | SSP-059, SSP-060, SSP-061, SSP-062, SSP-035 |
| [SSP-064](M2/SSP-064-tidy-frontages.md) | Compute Tidy %, per-frontage clean % and Clean Sweep bonuses incrementally ★ | feature | M | SSP-057, SSP-060, SSP-055, SSP-063 |
| [SSP-065](M2/SSP-065-tick-order-integration.md) | Wire tick phases 5, 6, 9 and 10 into World.step and add the zero-allocation test ★ | feature | M | SSP-062, SSP-063, SSP-064, SSP-060, SSP-061, SSP-035, SSP-038, SSP-049, SSP-019, SSP-027, SSP-292, SSP-046 |
| [SSP-066](M2/SSP-066-grime-ground-shader.md) | Sample the grime mask in the ground shader with incremental dirty-rect uploads ★ | feature | M | SSP-060, SSP-052, SSP-065, SSP-045, SSP-016, SSP-019, SSP-022 |
| [SSP-067](M2/SSP-067-items-sprite-batch.md) | Render litter, stains and site markers via the items instance batch ★ | feature | M | SSP-057, SSP-051, SSP-052, SSP-061, SSP-065, SSP-018, SSP-008, SSP-043, SSP-297 |
| [SSP-068](M2/SSP-068-kerbside5x7-font.md) | Draft Kerbside 5×7 glyphs and add the forge font builder and ui atlas ★ | asset | M | SSP-004, SSP-009, SSP-039 |
| [SSP-069](M2/SSP-069-bitmap-text.md) | Implement src/ui/bitmapText.ts and the UI render pass ★ | feature | M | SSP-068, SSP-015, SSP-016, SSP-018, SSP-019, SSP-043 |
| [SSP-070](M2/SSP-070-hud.md) | Build the basic HUD: timer, score, combo popups, hopper, water and HP ★ | feature | M | SSP-069, SSP-063, SSP-062, SSP-058, SSP-061, SSP-065, SSP-036, SSP-043, SSP-015, SSP-019 |
| [SSP-071](M2/SSP-071-intro-tally-scenes.md) | Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry ★ | feature | M | SSP-069, SSP-064, SSP-062, SSP-065, SSP-043, SSP-046, SSP-044, SSP-019 |
| [SSP-072](M2/SSP-072-m2-replays.md) | Record the M2 full-shift and dump-cycle replays and commit their hashes ★ | test | M | SSP-065, SSP-056, SSP-038, SSP-048 |
| [SSP-073](M2/SSP-073-e2e-smoke.md) | Add smoke.spec.ts: 60 s scripted sweep and full shift ending on the tally ★ | test | M | SSP-065, SSP-071, SSP-056, SSP-072, SSP-070, SSP-006, SSP-023, SSP-019, SSP-044, SSP-038 |
| [SSP-074](M2/SSP-074-close-m2.md) | Close M2: verify exit criteria, record decisions and tag m2 ★ | release | S | SSP-072, SSP-073, SSP-070, SSP-066, SSP-067, SSP-071, SSP-050, SSP-284 |
| [SSP-284](M2/SSP-284-boot-scene.md) | Add BootScene: load atlases, fonts and the palette LUT once, then hand off to the shift flow ★ | feature | M | SSP-043, SSP-016, SSP-018, SSP-068, SSP-069, SSP-071, SSP-046, SSP-019 |

<a id="m3"></a>
## M3 Living Street

| ID | Title | Type | Size | Depends on |
|---|---|---|---|---|
| [SSP-075](M3/SSP-075-entity-data-freeze.md) | Freeze the Mon–Tue entity set in entities.json and add M3 shared tuning ★ | chore | M | SSP-053, SSP-029 |
| [SSP-076](M3/SSP-076-compile-lane-nav-graphs.md) | Compile the traffic lane graph and pavement nav graph in compile-level.ts ★ | feature | L | SSP-033, SSP-032, SSP-042, SSP-056 |
| [SSP-077](M3/SSP-077-compile-spawn-specs.md) | Compile NPC, traffic, hazard, knockable and power-up spawn specs from level.json ★ | feature | M | SSP-075, SSP-076, SSP-056, SSP-054, SSP-055 |
| [SSP-078](M3/SSP-078-penalties-complaints-core.md) | Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter ★ | feature | M | SSP-075, SSP-063, SSP-070, SSP-069, SSP-028, SSP-044, SSP-043, SSP-065, SSP-046 |
| [SSP-079](M3/SSP-079-end-states-sacked-towed.md) | End shifts on SACKED (5 complaints) and TOWED (0 HP) with correct tally rules ★ | feature | M | SSP-078, SSP-036, SSP-062, SSP-071 |
| [SSP-080](M3/SSP-080-npc-store-spawner.md) | Add the NPC store, behaviour registry, spawner and phase 7 of the tick ★ | feature | M | SSP-075, SSP-077, SSP-035, SSP-028, SSP-038, SSP-065 |
| [SSP-081](M3/SSP-081-npc-steering.md) | Implement NPC steering: seek, flee, separation, nav paths, zebra crossing ★ | feature | L | SSP-076, SSP-080, SSP-028, SSP-036 |
| [SSP-082](M3/SSP-082-pedestrian-reactions-horn.md) | Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping ★ | feature | M | SSP-078, SSP-080, SSP-081, SSP-057, SSP-064 |
| [SSP-083](M3/SSP-083-behaviour-doris.md) | Implement Doris (npc.old_woman): glare, fist-shake slowdown, spray chase, handbag whack ★ | feature | M | SSP-082, SSP-061 |
| [SSP-084](M3/SSP-084-behaviour-shopper-businessman-litterbug.md) | Implement shopper, businessman and litterbug behaviours, including the Caught! bonus ★ | feature | M | SSP-082, SSP-063 |
| [SSP-085](M3/SSP-085-behaviour-old-man-mum-postie.md) | Implement old man, mum with pushchair and postie, and the occupied-zebra penalty ★ | feature | M | SSP-082, SSP-055 |
| [SSP-086](M3/SSP-086-behaviour-dog-walker.md) | Implement the dog walker with a lead line obstacle, Lead Tangle and dog mess drops ★ | feature | M | SSP-082, SSP-061 |
| [SSP-087](M3/SSP-087-behaviour-cat.md) | Implement the cat: perch, dart on approach, groom, bolt, and ride Bessie's roof ★ | feature | M | SSP-082, SSP-090 |
| [SSP-088](M3/SSP-088-behaviour-market-trader-pigeon.md) | Implement market trader (with market close pile) and pigeon flocks with Pigeon Scatter | feature | M | SSP-082, SSP-062 |
| [SSP-089](M3/SSP-089-traffic-lane-following.md) | Implement traffic.ts: lane following, queuing behind Bessie, honk, Road Rage, bus stops ★ | feature | L | SSP-076, SSP-077, SSP-078, SSP-081, SSP-035, SSP-031 |
| [SSP-090](M3/SSP-090-traffic-parked-collision.md) | Add parked cars and Bessie-vs-vehicle collision with dent and impact rules ★ | feature | M | SSP-089, SSP-031, SSP-036, SSP-037 |
| [SSP-091](M3/SSP-091-traffic-special-kinds.md) | Add taxi fare stops, white van pavement parking, bicycle filtering and mobility scooter ★ | feature | M | SSP-090, SSP-082 |
| [SSP-092](M3/SSP-092-knockable-bodies.md) | Implement bodies.ts knockable impulse bodies with spills and penalties ★ | feature | M | SSP-075, SSP-077, SSP-078, SSP-031, SSP-036, SSP-057 |
| [SSP-093](M3/SSP-093-hazards-grip-jolts.md) | Implement hazard grip overrides, jolts, LU spills and the open-manhole hard stop ★ | feature | M | SSP-075, SSP-077, SSP-030, SSP-035, SSP-058, SSP-059, SSP-057 |
| [SSP-094](M3/SSP-094-puddle-splash-broken-glass.md) | Add puddle splash penalties and broken glass from flung bottles ★ | feature | S | SSP-093, SSP-082, SSP-078, SSP-057 |
| [SSP-095](M3/SSP-095-near-miss-dust-coughing.md) | Add the near-miss bonus and dust coughing penalties ★ | feature | S | SSP-082, SSP-078, SSP-060, SSP-061 |
| [SSP-096](M3/SSP-096-power-ups.md) | Spawn power-ups on pavements, implement all six pwr.* effects, draw them ★ | feature | M | SSP-075, SSP-077, SSP-082, SSP-101, SSP-063, SSP-059, SSP-058, SSP-061, SSP-067 |
| [SSP-097](M3/SSP-097-placeholder-human-grids-mon.md) | Author placeholder grids for the six Monday human NPCs (24×24, 13 frames/dir) ★ | asset | L | SSP-009, SSP-039, SSP-005, SSP-026, SSP-298 |
| [SSP-098](M3/SSP-098-placeholder-human-grids-tue.md) | Author placeholder grids for businessman, litterbug and market trader | asset | M | SSP-009, SSP-039, SSP-298 |
| [SSP-099](M3/SSP-099-placeholder-animal-grids.md) | Author placeholder grids for the cat, pigeon and dog (npc.dog_loose grid) ★ | asset | M | SSP-009, SSP-039, SSP-298 |
| [SSP-100](M3/SSP-100-placeholder-vehicle-renders.md) | Render placeholder traffic vehicles in Blender as primitive boxes at 32 headings ★ | asset | M | SSP-007, SSP-024, SSP-039, SSP-298 |
| [SSP-101](M3/SSP-101-placeholder-props-hazards.md) | Add placeholder sprites for knockables, hazards, SSP-096 and High Street props ★ | asset | M | SSP-040, SSP-039, SSP-052, SSP-298 |
| [SSP-102](M3/SSP-102-fx-placeholder-particles.md) | Add placeholder particles in src/render/fx.ts for dust, splash and sparkle ★ | feature | S | SSP-095, SSP-094, SSP-016, SSP-043, SSP-063, SSP-064 |
| [SSP-103](M3/SSP-103-render-actors-traffic.md) | Draw NPCs, animals, traffic, knockables and hazards with state-driven frames ★ | feature | L | SSP-080, SSP-089, SSP-090, SSP-092, SSP-093, SSP-087, SSP-086, SSP-104, SSP-097, SSP-098, SSP-099, SSP-100, SSP-101, SSP-018, SSP-067, SSP-297 |
| [SSP-104](M3/SSP-104-puddle-lane-population.md) | Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up ★ | feature | M | SSP-077, SSP-083, SSP-084, SSP-085, SSP-086, SSP-087, SSP-091, SSP-092, SSP-093, SSP-094, SSP-095, SSP-096, SSP-042, SSP-056 |
| [SSP-105](M3/SSP-105-high-street-greybox.md) | Author and compile the grey-box High Street (80×60) for Tuesday's NPCs | feature | L | SSP-077, SSP-084, SSP-088, SSP-083, SSP-085, SSP-091, SSP-092, SSP-096, SSP-101, SSP-040, SSP-041, SSP-054, SSP-055 |
| [SSP-106](M3/SSP-106-npc-stress-budget.md) | Prove the NPC budget: 80 NPCs, 30 vehicles, 2,000 litter, allocation-free ★ | test | M | SSP-080, SSP-091, SSP-092, SSP-093, SSP-083, SSP-087, SSP-086, SSP-088, SSP-103, SSP-023, SSP-065, SSP-292 |
| [SSP-107](M3/SSP-107-m3-replays-determinism.md) | Record SACKED and TOWED replays and add the replay-determinism property test ★ | test | M | SSP-079, SSP-104, SSP-038 |
| [SSP-108](M3/SSP-108-penalty-table-test.md) | Add the table-driven penalty and complaint test against entities.json ★ | test | S | SSP-083, SSP-084, SSP-085, SSP-086, SSP-087, SSP-088, SSP-091, SSP-090, SSP-092, SSP-094, SSP-095, SSP-079 |
| [SSP-109](M3/SSP-109-close-m3.md) | Close M3: verify the exit criteria, sync docs, state the frozen entity list, tag m3 ★ | release | S | SSP-106, SSP-107, SSP-108, SSP-105, SSP-103, SSP-102, SSP-285, SSP-286, SSP-287, SSP-288, SSP-289, SSP-290, SSP-299 |
| [SSP-285](M3/SSP-285-ui-panels-9slice.md) | Implement src/ui/panels.ts 9-slice panels and button states with placeholder panel grids ★ | feature | S | SSP-069, SSP-068, SSP-039 |
| [SSP-286](M3/SSP-286-menu-navigation.md) | Implement src/ui/menus.ts: keyboard, gamepad and mouse menu navigation plus input-device glyphs ★ | feature | M | SSP-044, SSP-069, SSP-071, SSP-015, SSP-285 |
| [SSP-287](M3/SSP-287-pause-overlay.md) | Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire ★ | feature | M | SSP-043, SSP-044, SSP-046, SSP-071, SSP-016, SSP-019, SSP-285, SSP-286 |
| [SSP-288](M3/SSP-288-popups-speech-bubbles.md) | Add src/ui/popups.ts: world-space score/penalty popups and NPC speech bubbles ★ | feature | M | SSP-285, SSP-069, SSP-063, SSP-078, SSP-082, SSP-083, SSP-084, SSP-087, SSP-089, SSP-046 |
| [SSP-289](M3/SSP-289-pam-radio-panel.md) | Add Big Pam's HUD radio panel with a one-at-a-time bark queue and inline key glyphs ★ | feature | M | SSP-285, SSP-286, SSP-069, SSP-070, SSP-078, SSP-044, SSP-047 |
| [SSP-290](M3/SSP-290-tutorial-beats.md) | Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events ★ | feature | M | SSP-289, SSP-077, SSP-104, SSP-062, SSP-063, SSP-064, SSP-078, SSP-083, SSP-087, SSP-035, SSP-047, SSP-299 |
| [SSP-298](M3/SSP-298-zoo-scene-review.md) | Add a minimal test-only ZooScene for in-engine review of actors and items frames ★ | feature | M | SSP-043, SSP-019, SSP-018, SSP-016, SSP-039, SSP-067, SSP-284 |
| [SSP-299](M3/SSP-299-hud-brush-tidy-arrows.md) | Add the Brush-o-meter, brush state ring, district name with Tidy % bar, and off-screen depot/hydrant arrows to the HUD ★ | feature | L | SSP-070, SSP-059, SSP-064, SSP-061, SSP-058, SSP-055, SSP-047, SSP-015, SSP-069, SSP-042 |

<a id="m4"></a>
## M4 Art Pass 1

| ID | Title | Type | Size | Depends on |
|---|---|---|---|---|
| [SSP-110](M4/SSP-110-forge-ingest-complete.md) | Complete forge ingest: full 10-step pipeline, edit protection, dry-run previews ★ | feature | L | SSP-013, SSP-004, SSP-005, SSP-012, SSP-001 |
| [SSP-111](M4/SSP-111-forge-build-procedural.md) | Harden the procedural technique: generator registry, params validation, fx play frames and a shared seam metric ★ | feature | M | SSP-009, SSP-040, SSP-041 |
| [SSP-112](M4/SSP-112-forge-build-ai-art.md) | Add the ai-art build technique: crop, pixelize at detected period, palette map ★ | feature | M | SSP-004, SSP-005 |
| [SSP-113](M4/SSP-113-forge-pack-atlases.md) | Lock atlas trimming and the 1 px gutter, cover all five atlases and add the fill-ratio report ★ | feature | M | SSP-010, SSP-039, SSP-018, SSP-067, SSP-045 |
| [SSP-114](M4/SSP-114-ramp-swap-tables.md) | Lock ramp-swap key indices and emit the 8 swap tables per atlas ★ | feature | M | SSP-113, SSP-118, SSP-005, SSP-021, SSP-097, SSP-099, SSP-100, SSP-297 |
| [SSP-115](M4/SSP-115-forge-lint-complete.md) | Complete forge lint: every rule with a failing fixture, zero warnings on assets ★ | feature | L | SSP-111, SSP-011, SSP-009, SSP-040, SSP-041, SSP-051, SSP-052, SSP-097, SSP-098, SSP-099, SSP-100, SSP-101 |
| [SSP-116](M4/SSP-116-forge-sheets.md) | Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row ★ | feature | S | SSP-113, SSP-011, SSP-008, SSP-040 |
| [SSP-117](M4/SSP-117-forge-verify-ci.md) | Extend forge verify to level and M4 outputs, prove assets idempotence, fill forge pytest gaps and add verify + lint to CI ★ | feature | M | SSP-110, SSP-111, SSP-112, SSP-113, SSP-115, SSP-116, SSP-006, SSP-025, SSP-033, SSP-039, SSP-010, SSP-042 |
| [SSP-118](M4/SSP-118-zoo-scene.md) | Complete ZooScene coverage and add the zoo visual golden for in-engine asset review ★ | feature | M | SSP-019, SSP-016, SSP-017, SSP-022, SSP-043, SSP-018, SSP-067, SSP-103, SSP-298 |
| [SSP-119](M4/SSP-119-tiles-road-surfaces.md) | Final procedural road tiles: asphalt, markings, double yellows, zebra, drains, bays ★ | asset | L | SSP-111, SSP-115, SSP-116, SSP-118, SSP-040, SSP-045, SSP-066 |
| [SSP-120](M4/SSP-120-tiles-kerb-blob.md) | Final 47-tile kerb blob autotile generated by rule ★ | asset | M | SSP-111, SSP-115, SSP-116, SSP-118, SSP-040, SSP-034, SSP-045 |
| [SSP-121](M4/SSP-121-tiles-pavement-grass-cobbles.md) | Final pavement slabs, grass, cobbles, setts, tactile paving and edge tiles ★ | asset | L | SSP-111, SSP-115, SSP-116, SSP-118, SSP-040, SSP-105 |
| [SSP-122](M4/SSP-122-grime-overlays.md) | Procedural grime overlay patterns for asphalt, slab and gutter ★ | asset | M | SSP-111, SSP-115, SSP-116, SSP-118, SSP-119, SSP-121, SSP-060, SSP-066 |
| [SSP-123](M4/SSP-123-stains-hazards.md) | Procedural stain and hazard ground decals for the Mon-Tue set ★ | asset | M | SSP-111, SSP-115, SSP-116, SSP-118, SSP-052, SSP-101 |
| [SSP-124](M4/SSP-124-roof-surfaces.md) | Final procedural roof surfaces: felt, gravel, slate, corrugated ★ | asset | M | SSP-111, SSP-115, SSP-116, SSP-017, SSP-041 |
| [SSP-125](M4/SSP-125-facades-old-town.md) | Old Town terrace facade modules and the pledge rosette (Puddle Lane) ★ | asset | M | SSP-111, SSP-115, SSP-116, SSP-118, SSP-041, SSP-045 |
| [SSP-126](M4/SSP-126-facades-high-street.md) | High Street shopfront facade modules and facade sets | asset | M | SSP-125, SSP-105 |
| [SSP-127](M4/SSP-127-bessie-final.md) | Final Bessie renders: body, dented variant and 96x96 brush overlay ★ | asset | M | SSP-114, SSP-115, SSP-116, SSP-118, SSP-007, SSP-008, SSP-024 |
| [SSP-128](M4/SSP-128-traffic-cars.md) | Final Blender cars: hatchback, saloon, taxi, white van, parked aliases ★ | asset | L | SSP-114, SSP-115, SSP-116, SSP-118, SSP-100, SSP-007 |
| [SSP-129](M4/SSP-129-traffic-bus-bike-scooter.md) | Final Blender bus (128x128), bicycle and mobility scooter (32x32) ★ | asset | M | SSP-115, SSP-116, SSP-118, SSP-100 |
| [SSP-130](M4/SSP-130-blender-props-flat.md) | Blender flat props: bench, planter and the skip ★ | asset | M | SSP-115, SSP-116, SSP-118, SSP-052, SSP-101 |
| [SSP-131](M4/SSP-131-blender-props-stacks.md) | Blender sprite-stack props: lamp post, phone box, tree, bus shelter, stall ★ | asset | L | SSP-115, SSP-116, SSP-118, SSP-020, SSP-024, SSP-101 |
| [SSP-132](M4/SSP-132-roofkit-layout.md) | Blender roof kit and the seeded roof-furniture layout script ★ | asset | L | SSP-111, SSP-124, SSP-115, SSP-116, SSP-017, SSP-007, SSP-033 |
| [SSP-133](M4/SSP-133-char-doris-pilot.md) | Pilot the people pipeline end to end with npc.old_woman (Doris) ★ | asset | L | SSP-110, SSP-115, SSP-116, SSP-118, SSP-014, SSP-012, SSP-097 |
| [SSP-134](M4/SSP-134-char-shopper.md) | Final npc.shopper with 8 outfit swaps ★ | asset | M | SSP-133, SSP-114, SSP-097 |
| [SSP-135](M4/SSP-135-char-old-man-mum.md) | Final npc.old_man_frame and npc.mum_pushchair ★ | asset | L | SSP-133, SSP-097 |
| [SSP-136](M4/SSP-136-char-postie-dog-walker.md) | Final npc.postie and npc.dog_walker ★ | asset | L | SSP-133, SSP-097, SSP-086, SSP-103 |
| [SSP-137](M4/SSP-137-char-businessman-litterbug.md) | Final npc.businessman and npc.litterbug | asset | L | SSP-133, SSP-098 |
| [SSP-138](M4/SSP-138-char-market-trader.md) | Final npc.market_trader | asset | M | SSP-133, SSP-098 |
| [SSP-139](M4/SSP-139-litter-sheet-01.md) | Accept litter.sheet_01, ingest 6 items, hand-draw the can and butts ★ | asset | M | SSP-110, SSP-115, SSP-116, SSP-118, SSP-001, SSP-051, SSP-067 |
| [SSP-140](M4/SSP-140-litter-sheet-02.md) | Generate litter.sheet_02 and ingest the remaining 7 litter items ★ | asset | M | SSP-139, SSP-012 |
| [SSP-141](M4/SSP-141-font-builder-outline-kerning.md) | Font builder: per-glyph advance syntax, kerning validation and Kerbside Bold 8x8 support ★ | feature | S | SSP-069, SSP-068 |
| [SSP-142](M4/SSP-142-font-kerbside-5x7.md) | Finalise Kerbside 5x7 glyphs, metrics and kerning ★ | asset | M | SSP-141, SSP-116, SSP-068 |
| [SSP-143](M4/SSP-143-font-kerbside-bold-8x8.md) | Write Kerbside Bold 8x8 glyphs, metrics and kerning ★ | asset | M | SSP-141, SSP-116 |
| [SSP-144](M4/SSP-144-ui-icons-panels.md) | HUD icons, 9-slice panels, button states and complaint stamp grids ★ | asset | M | SSP-115, SSP-116, SSP-143, SSP-070, SSP-285 |
| [SSP-145](M4/SSP-145-hud-specimen-golden.md) | Build the hud_specimen scene and commit its visual golden ★ | test | M | SSP-142, SSP-143, SSP-144, SSP-019, SSP-022 |
| [SSP-146](M4/SSP-146-animal-cat.md) | Hand-author the npc.cat grid: walk, sit, dart, leap in 8 directions ★ | asset | M | SSP-115, SSP-116, SSP-118, SSP-099 |
| [SSP-147](M4/SSP-147-animals-pigeon-dog.md) | Hand-author npc.pigeon and the npc.dog_loose grid with coat swap ★ | asset | M | SSP-114, SSP-115, SSP-116, SSP-118, SSP-099 |
| [SSP-148](M4/SSP-148-small-props-grids.md) | Hand-author small prop grids, including grid sprite stacks ★ | asset | L | SSP-115, SSP-116, SSP-118, SSP-101, SSP-020 |
| [SSP-149](M4/SSP-149-pickups-grids.md) | Hand-author power-up and Mon-Tue collectible pickup grids ★ | asset | M | SSP-115, SSP-116, SSP-118, SSP-052, SSP-101 |
| [SSP-150](M4/SSP-150-shop-signs.md) | High Street shop signs: Codex blank boards plus Kerbside lettering | asset | L | SSP-110, SSP-115, SSP-116, SSP-143, SSP-126, SSP-003 |
| [SSP-151](M4/SSP-151-road-decals.md) | Road decals for High Street: oil, posters and graffiti via Codex ingest | asset | M | SSP-110, SSP-115, SSP-116, SSP-118, SSP-105 |
| [SSP-152](M4/SSP-152-portrait-big-pam.md) | portrait.big_pam: 64x64 intro-card portrait with 2 expressions ★ | asset | M | SSP-112, SSP-012 |
| [SSP-153](M4/SSP-153-title-art.md) | art.title: 480x270 title key art via ai-art ★ | asset | M | SSP-112, SSP-012 |
| [SSP-154](M4/SSP-154-vfx-core.md) | Procedural VFX: dust, spray, sparkle, splash, leaf swirl, skid marks ★ | asset | M | SSP-111, SSP-115, SSP-116, SSP-118, SSP-102 |
| [SSP-155](M4/SSP-155-vfx-reactions.md) | Procedural VFX for reactions and damage: impact star, cough, anger, smoke ★ | asset | M | SSP-111, SSP-115, SSP-116, SSP-118, SSP-102, SSP-082, SSP-093, SSP-095 |
| [SSP-156](M4/SSP-156-hud-final-art.md) | Restyle the HUD and score popups with final fonts, icons and panels ★ | feature | M | SSP-142, SSP-143, SSP-144, SSP-149, SSP-070, SSP-069, SSP-063, SSP-078, SSP-096, SSP-288, SSP-289, SSP-291, SSP-299 |
| [SSP-157](M4/SSP-157-title-intro-tally-screens.md) | Title, shift intro card and tally numbers page with final UI art ★ | feature | M | SSP-152, SSP-153, SSP-143, SSP-142, SSP-144, SSP-071, SSP-043, SSP-284, SSP-285, SSP-286, SSP-287, SSP-002 |
| [SSP-158](M4/SSP-158-m4-exit-close.md) | M4 exit: no-placeholder test, full review pass and Close M4 PR ★ | release | M | SSP-117, SSP-118, SSP-145, SSP-119, SSP-120, SSP-121, SSP-122, SSP-123, SSP-124, SSP-125, SSP-126, SSP-127, SSP-128, SSP-129, SSP-130, SSP-131, SSP-132, SSP-133, SSP-134, SSP-135, SSP-136, SSP-137, SSP-138, SSP-139, SSP-140, SSP-150, SSP-151, SSP-146, SSP-147, SSP-148, SSP-149, SSP-154, SSP-155, SSP-156, SSP-157, SSP-075, SSP-104, SSP-105, SSP-109, SSP-291, SSP-300 |
| [SSP-291](M4/SSP-291-hud-minimap.md) | Implement src/ui/minimap.ts: runtime 64×64 district minimap in the single UI draw ★ | feature | M | SSP-069, SSP-070, SSP-032, SSP-055, SSP-060, SSP-064, SSP-105 |
| [SSP-300](M4/SSP-300-shift-map-overlay.md) | Add the Tab shift map overlay: district map with frontage status, depot, skips and hydrants, without pausing ★ | feature | M | SSP-291, SSP-044, SSP-285, SSP-144, SSP-069, SSP-070, SSP-064, SSP-055, SSP-061, SSP-287, SSP-105 |

<a id="m5"></a>
## M5 Sound & Music

| ID | Title | Type | Size | Depends on |
|---|---|---|---|---|
| [SSP-159](M5/SSP-159-audio-deps-zzfx-vendor.md) | Pin jsfxr 1.4.1, vendor ZzFX buildSamples with seeded RNG, add WAV writer ★ | chore | M | SSP-002, SSP-028 |
| [SSP-160](M5/SSP-160-dsp-kernels.md) | Build the shared DSP kernels in tools/audio/synth (oscillators, filters, envelopes, FM) ★ | feature | M | SSP-002, SSP-028 |
| [SSP-161](M5/SSP-161-render-sfx-core.md) | Implement render-sfx.ts: SFX JSON to WAV sprites, ffmpeg encodes and sfx.json ★ | feature | L | SSP-159, SSP-025, SSP-010, SSP-117 |
| [SSP-162](M5/SSP-162-audio-review-report.md) | Add --report review evidence: spectrograms, waveforms, metrics, listening page ★ | feature | M | SSP-161 |
| [SSP-163](M5/SSP-163-sfx-sweeping-vehicle.md) | Author the 14 sweeping, hopper and vehicle SFX sources ★ | asset | L | SSP-161, SSP-162 |
| [SSP-164](M5/SSP-164-sfx-props-animals-people.md) | Author the 10 prop, hazard, animal and people bark SFX sources ★ | asset | M | SSP-161, SSP-162 |
| [SSP-165](M5/SSP-165-sfx-feedback-ui.md) | Author the 8 game-feedback and UI SFX sources ★ | asset | M | SSP-161, SSP-162 |
| [SSP-166](M5/SSP-166-tracker-core.md) | Implement the render-music.ts tracker core: song parsing, instruments, notes, effects ★ | feature | L | SSP-160, SSP-159 |
| [SSP-167](M5/SSP-167-render-music-stems-encode.md) | Render music stems, normalise loudness, lint songs, encode and write music.json ★ | feature | L | SSP-166, SSP-162, SSP-161, SSP-025 |
| [SSP-168](M5/SSP-168-audio-verify-coverage.md) | Wire audio into assets:verify and add SFX coverage and reference tests ★ | test | M | SSP-161, SSP-167, SSP-163, SSP-164, SSP-165, SSP-117, SSP-025, SSP-053, SSP-075 |
| [SSP-169](M5/SSP-169-song-puddle-lane.md) | Compose mus.puddle_lane 'Milk Float Shuffle' with base, drums and lead stems ★ | asset | L | SSP-167 |
| [SSP-170](M5/SSP-170-song-title.md) | Compose mus.title 'Brush With Greatness' with base, drums and lead stems ★ | asset | M | SSP-167 |
| [SSP-171](M5/SSP-171-song-high-street.md) | Compose mus.high_street 'Window Shopping' with base, drums and lead stems | asset | M | SSP-167 |
| [SSP-172](M5/SSP-172-jingles-vs.md) | Compose jng.shift_start, jng.tally and jng.sacked jingles ★ | asset | M | SSP-167 |
| [SSP-173](M5/SSP-173-mixer-buses-ducking.md) | Implement mixer.ts: bus graph, limiter, settings levels and ducking engine ★ | feature | M | SSP-043, SSP-019 |
| [SSP-174](M5/SSP-174-unlock-codec-loading.md) | Add unlock.ts, Opus/AAC codec selection and boot-time audio loading ★ | feature | M | SSP-173, SSP-161, SSP-157, SSP-142, SSP-144, SSP-044, SSP-006, SSP-284 |
| [SSP-175](M5/SSP-175-sfx-voice-pool.md) | Implement sfx.ts playback: voice pool, variants, pitch ladder and spatial pan ★ | feature | L | SSP-173, SSP-174, SSP-161, SSP-028, SSP-019, SSP-047 |
| [SSP-176](M5/SSP-176-sfx-event-wiring.md) | Wire sim events to sfx cues through a pure audio director ★ | feature | M | SSP-175, SSP-173, SSP-043, SSP-058, SSP-059, SSP-062, SSP-063, SSP-078, SSP-082, SSP-092, SSP-093, SSP-075, SSP-286 |
| [SSP-177](M5/SSP-177-music-state-machine.md) | Implement the pure adaptive-music state machine for drums and lead stems ★ | feature | M | SSP-063, SSP-062 |
| [SSP-178](M5/SSP-178-music-player.md) | Implement music.ts: sample-locked stems, loops, jingles and scene music ★ | feature | L | SSP-177, SSP-173, SSP-174, SSP-167, SSP-179, SSP-071, SSP-046, SSP-079, SSP-033, SSP-042, SSP-287 |
| [SSP-179](M5/SSP-179-worklet-infra.md) | Set up the AudioWorklet host that shares tools/audio/synth kernels at runtime ★ | feature | M | SSP-160, SSP-173, SSP-002, SSP-006, SSP-003 |
| [SSP-180](M5/SSP-180-engine-synth.md) | Implement engineSynth.ts: Bessie's diesel with load, misfire and tyre squeal ★ | feature | M | SSP-179, SSP-030, SSP-036, SSP-059, SSP-058, SSP-093 |
| [SSP-181](M5/SSP-181-brush-suction-synth.md) | Implement brushSynth.ts brush, suction fan, scrub crackle and bulldozer layers ★ | feature | M | SSP-179, SSP-059, SSP-060, SSP-058, SSP-096 |
| [SSP-182](M5/SSP-182-spray-beeper-synth.md) | Add spray (sputter, dry pump, refill) and reverse-beeper voices to brushSynth ★ | feature | M | SSP-179, SSP-181, SSP-061, SSP-062, SSP-030 |
| [SSP-183](M5/SSP-183-amb-town-morning.md) | Add the ambience bed player and author amb.town_morning ★ | feature | M | SSP-161, SSP-175, SSP-173, SSP-179, SSP-160, SSP-105, SSP-287, SSP-033, SSP-042 |
| [SSP-184](M5/SSP-184-captions.md) | Add speech-bubble and sound captions for audio cues | feature | M | SSP-176, SSP-142, SSP-143, SSP-144, SSP-145, SSP-288 |
| [SSP-185](M5/SSP-185-m5-exit-evidence.md) | Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR ★ | test | M | SSP-168, SSP-169, SSP-170, SSP-171, SSP-172, SSP-176, SSP-178, SSP-180, SSP-181, SSP-182, SSP-183, SSP-174, SSP-073, SSP-072, SSP-019, SSP-065, SSP-046, SSP-173, SSP-301 |
| [SSP-293](M5/SSP-293-vs-scripted-replays.md) | Record the vertical-slice replays vs_slow, vs_fast and vs_practised with a waypoint route follower ★ | test | L | SSP-038, SSP-072, SSP-064, SSP-104, SSP-107, SSP-109 |
| [SSP-294](M5/SSP-294-vs-automated-checks.md) | Automate the vertical-slice technical checks: before/after captures, Puddle Lane perf and the 20-shift soak ★ | test | L | SSP-023, SSP-073, SSP-104, SSP-107, SSP-109, SSP-158, SSP-293 |
| [SSP-295](M5/SSP-295-vertical-slice-gate.md) | Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR ★ | release | M | SSP-293, SSP-294, SSP-185, SSP-158, SSP-109, SSP-118, SSP-145, SSP-117, SSP-036, SSP-157 |
| [SSP-301](M5/SSP-301-loudness-meter.md) | Add the BS.1770 momentary loudness meter and limiter-engagement readout to the F1 dev panel ★ | feature | S | SSP-173, SSP-048, SSP-019 |

<a id="m6"></a>
## M6 Tidy Town Week

| ID | Title | Type | Size | Depends on |
|---|---|---|---|---|
| [SSP-186](M6/SSP-186-save-v1.md) | Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub | feature | L | SSP-043, SSP-157, SSP-019, SSP-284, SSP-290, SSP-295, SSP-062, SSP-038 |
| [SSP-187](M6/SSP-187-progression-economy.md) | Add districts.json, upgrades.json and pure week progression and £ ledger | feature | L | SSP-186, SSP-062, SSP-063, SSP-064, SSP-055, SSP-078, SSP-079, SSP-149 |
| [SSP-188](M6/SSP-188-upgrade-modifiers.md) | Apply upg.* levels to the sim via tuning.ts modifiers and record loadout in replays | feature | M | SSP-187, SSP-029, SSP-030, SSP-038, SSP-058, SSP-059, SSP-061, SSP-078, SSP-080 |
| [SSP-189](M6/SSP-189-scripted-runs.md) | Generalise scripted-run authoring for district replays, balance runs and week e2e | chore | M | SSP-188, SSP-038, SSP-293 |
| [SSP-190](M6/SSP-190-compiler-m6.md) | Extend compile-level for M6: skip_run mode, night lamp pools, landmarks, M6 events | feature | L | SSP-033, SSP-076, SSP-021, SSP-295 |
| [SSP-191](M6/SSP-191-week-map-scene.md) | Build WeekMapScene: seven district cards, stars, unlock state and Gleaming badges | feature | M | SSP-186, SSP-187, SSP-043, SSP-141, SSP-142, SSP-143, SSP-144, SSP-157, SSP-071, SSP-285, SSP-286, SSP-287 |
| [SSP-192](M6/SSP-192-mercury-tally.md) | Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden | feature | L | SSP-186, SSP-187, SSP-071, SSP-064, SSP-142, SSP-143, SSP-144, SSP-172, SSP-165, SSP-173, SSP-285, SSP-286, SSP-291 |
| [SSP-193](M6/SSP-193-workshop-liveries.md) | Build WorkshopScene with upgrade purchases and Bessie livery ramp swaps | feature | L | SSP-188, SSP-187, SSP-186, SSP-113, SSP-114, SSP-127, SSP-116, SSP-165, SSP-286 |
| [SSP-194](M6/SSP-194-audio-mus-workshop.md) | Compose mus.workshop 'Tea Break' and implement the mus.workshop fallback rule | asset | M | SSP-166, SSP-167, SSP-177, SSP-178, SSP-173, SSP-025, SSP-295 |
| [SSP-195](M6/SSP-195-audio-jingles-star-towed.md) | Compose jng.star and jng.towed and wire them to the tally and TOWED end state | asset | S | SSP-192, SSP-166, SSP-167, SSP-173 |
| [SSP-196](M6/SSP-196-free-sweep.md) | Add Free Sweep mode: untimed, no complaints, Pause -> Finish Sweep, cut-down Mercury | feature | M | SSP-192, SSP-191, SSP-194, SSP-187, SSP-189, SSP-062, SSP-078, SSP-079, SSP-287 |
| [SSP-197](M6/SSP-197-depot-yard-level.md) | Author and compile district.depot_yard with all seven Skip Run variants | feature | M | SSP-190, SSP-033, SSP-041 |
| [SSP-198](M6/SSP-198-skip-run.md) | Implement SkipRunScene: 45 s cone slalom and reverse-park bays with £5/£50 payouts | feature | L | SSP-197, SSP-192, SSP-187, SSP-189, SSP-030, SSP-092, SSP-170, SSP-183 |
| [SSP-199](M6/SSP-199-people-kids-jogger.md) | Implement npc.jogger, npc.kid_skateboard, npc.kid_chalk and school_out/population_wave | feature | L | SSP-081, SSP-080, SSP-082, SSP-076, SSP-095, SSP-078, SSP-061, SSP-053, SSP-295 |
| [SSP-200](M6/SSP-200-dog-loose-seagull.md) | Implement npc.dog_loose chase and npc.seagull chip theft and litter snatching | feature | M | SSP-080, SSP-088, SSP-082, SSP-147, SSP-064, SSP-057, SSP-295 |
| [SSP-201](M6/SSP-201-bin-lorry.md) | Implement veh.bin_lorry and the bin_round event | feature | M | SSP-089, SSP-091, SSP-092, SSP-100, SSP-295 |
| [SSP-202](M6/SSP-202-rain-weather.md) | Implement rain: road grip 6.0, puddle density, rain FX and amb.rain hookup | feature | M | SSP-030, SSP-093, SSP-154, SSP-295 |
| [SSP-203](M6/SSP-203-district-high-street-final.md) | Bring district.high_street to final M6 quality with collectibles and 3-star replay | feature | M | SSP-190, SSP-189, SSP-196, SSP-105, SSP-084, SSP-088, SSP-089, SSP-091, SSP-121, SSP-126, SSP-150, SSP-151, SSP-171 |
| [SSP-204](M6/SSP-204-district-gasworks.md) | Author and compile district.gasworks (Wednesday, rain) with its district replay | feature | L | SSP-190, SSP-189, SSP-196, SSP-202, SSP-201, SSP-199, SSP-200, SSP-188, SSP-093, SSP-095, SSP-089, SSP-041 |
| [SSP-205](M6/SSP-205-wind-leaves-gusts.md) | Implement leaf fall, wet leaves and haz.wind_gust litter drift | feature | M | SSP-057, SSP-093, SSP-154, SSP-295 |
| [SSP-206](M6/SSP-206-district-conker-hill.md) | Author and compile district.conker_hill (Thursday, wind and leaf fall) | feature | L | SSP-190, SSP-189, SSP-196, SSP-205, SSP-199, SSP-200, SSP-201, SSP-188, SSP-085, SSP-086, SSP-087, SSP-131 |
| [SSP-207](M6/SSP-207-ice-cream-van.md) | Implement veh.ice_cream_van, its parked variant and the vehicle_stop event | feature | M | SSP-199, SSP-091, SSP-090 |
| [SSP-208](M6/SSP-208-rival-sweeper-cameo.md) | Implement veh.rival_sweeper Friday cameo and the rival_cameo event | feature | M | SSP-200, SSP-059, SSP-057, SSP-089 |
| [SSP-209](M6/SSP-209-district-promenade.md) | Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo) | feature | L | SSP-190, SSP-189, SSP-196, SSP-205, SSP-200, SSP-207, SSP-208, SSP-199, SSP-188, SSP-089, SSP-091, SSP-088, SSP-111, SSP-130, SSP-131 |
| [SSP-210](M6/SSP-210-night-lighting.md) | Implement night: night remap with street-lamp and headlight light mask | feature | L | SSP-190, SSP-197, SSP-016, SSP-021, SSP-023, SSP-154, SSP-131 |
| [SSP-211](M6/SSP-211-reveller-police.md) | Implement npc.reveller, kicking_out, veh.police witness rule and police_parked | feature | M | SSP-078, SSP-108, SSP-089, SSP-080, SSP-295 |
| [SSP-212](M6/SSP-212-district-kebab-mile.md) | Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden | feature | L | SSP-190, SSP-189, SSP-196, SSP-210, SSP-211, SSP-188, SSP-091, SSP-087, SSP-023 |
| [SSP-213](M6/SSP-213-lollipop-crossing-parade.md) | Implement npc.lollipop_lady, site.school_crossing, crossing_patrol and parade | feature | M | SSP-211, SSP-199, SSP-081, SSP-085, SSP-089, SSP-080 |
| [SSP-214](M6/SSP-214-inspector.md) | Implement npc.inspector and the inspection event with frontage deductions | feature | M | SSP-190, SSP-064, SSP-094, SSP-080, SSP-157, SSP-291, SSP-300 |
| [SSP-215](M6/SSP-215-district-civic-quarter.md) | Author and compile district.civic_quarter, the Sunday finale map | feature | L | SSP-190, SSP-189, SSP-196, SSP-214, SSP-213, SSP-207, SSP-211, SSP-199, SSP-200, SSP-201, SSP-188, SSP-083, SSP-084, SSP-085, SSP-086, SSP-087, SSP-088, SSP-125, SSP-126 |
| [SSP-216](M6/SSP-216-sunday-finale-trophy.md) | Implement the Sunday Inspection Score and the Tidy Town Trophy award | feature | M | SSP-214, SSP-187, SSP-192, SSP-191, SSP-186 |
| [SSP-217](M6/SSP-217-audio-ambiences-m6.md) | Author amb.rain, amb.wind_leaves, amb.seafront and amb.night_town beds | asset | M | SSP-205, SSP-183, SSP-161 |
| [SSP-218](M6/SSP-218-audio-mus-gasworks.md) | Compose mus.gasworks 'Drizzle Dub' with adaptive stems and dub delay send | asset | M | SSP-194, SSP-166, SSP-167 |
| [SSP-219](M6/SSP-219-audio-mus-conker-hill.md) | Compose mus.conker_hill 'Conker Crunch' 6/8 jig with adaptive stems | asset | M | SSP-194, SSP-166, SSP-177 |
| [SSP-220](M6/SSP-220-art-humans-batch-a.md) | Art Pass 2: final sprites for npc.jogger, npc.kid_skateboard and npc.kid_chalk | asset | L | SSP-199, SSP-014, SSP-012, SSP-110, SSP-115, SSP-116, SSP-118 |
| [SSP-221](M6/SSP-221-art-humans-batch-b.md) | Art Pass 2: final sprites for npc.lollipop_lady, npc.reveller and npc.inspector | asset | L | SSP-211, SSP-213, SSP-214, SSP-014, SSP-110, SSP-115, SSP-116, SSP-117 |
| [SSP-222](M6/SSP-222-art-vehicles-m6.md) | Art Pass 2: Blender renders for bin lorry, ice cream van, police and Sid's sweeper | asset | M | SSP-201, SSP-207, SSP-211, SSP-208, SSP-007, SSP-127, SSP-114, SSP-024 |
| [SSP-223](M6/SSP-223-art-litter-m6.md) | Art Pass 2: final litter sprites for kebab wrapper, leaf pile and lolly stick | asset | M | SSP-205, SSP-207, SSP-211, SSP-051, SSP-139, SSP-110 |
| [SSP-224](M6/SSP-224-art-grids-m6.md) | Art Pass 2: seagull, loose dog, remaining collectibles, upgrade icons and small props | asset | M | SSP-200, SSP-193, SSP-187, SSP-009, SSP-113, SSP-145 |
| [SSP-225](M6/SSP-225-art-world-tiles-m6.md) | Art Pass 2: procedural ground tiles, hazard decals and stains for Wed-Sun | asset | M | SSP-111, SSP-119, SSP-115, SSP-123, SSP-052, SSP-295 |
| [SSP-226](M6/SSP-226-art-facades-m6.md) | Art Pass 2: facade module sets for every remaining building style | asset | L | SSP-204, SSP-206, SSP-209, SSP-212, SSP-215, SSP-197, SSP-210, SSP-111, SSP-125, SSP-126 |
| [SSP-227](M6/SSP-227-art-signs-decals-m6.md) | Art Pass 2: shop signs and road decals for the Wed-Sun districts | asset | M | SSP-210, SSP-204, SSP-209, SSP-212, SSP-215, SSP-150, SSP-110 |
| [SSP-228](M6/SSP-228-art-landmark-roofs.md) | Art Pass 2: landmark roofs for the Town Hall, Pier and Depot via Codex goldens | asset | M | SSP-197, SSP-209, SSP-215, SSP-110, SSP-124 |
| [SSP-229](M6/SSP-229-art-mercury-portraits.md) | Art Pass 2: Mercury newspaper art and portraits for Sid, Doris and the Inspector | asset | M | SSP-192, SSP-112, SSP-152 |
| [SSP-230](M6/SSP-230-art-ui-meta.md) | Art Pass 2: final UI art for the Week Map, Workshop and Mercury | asset | M | SSP-191, SSP-193, SSP-192, SSP-216, SSP-224, SSP-113, SSP-144, SSP-145 |
| [SSP-231](M6/SSP-231-balance-pass.md) | Full-week balance pass: competent runs, £ curve, par constants and score bands | test | L | SSP-203, SSP-204, SSP-206, SSP-209, SSP-212, SSP-215, SSP-198, SSP-187, SSP-189, SSP-104, SSP-072, SSP-293 |
| [SSP-232](M6/SSP-232-week-spec-e2e.md) | Write tests/e2e/week.spec.ts: scripted save from Monday to the Tidy Town Trophy | test | M | SSP-216, SSP-193, SSP-203, SSP-204, SSP-206, SSP-209, SSP-212, SSP-215, SSP-189, SSP-186, SSP-073, SSP-019 |
| [SSP-233](M6/SSP-233-m6-close.md) | Close M6: final goldens, no placeholders, replays audit, docs and m6 tag | release | M | SSP-232, SSP-231, SSP-220, SSP-221, SSP-222, SSP-223, SSP-224, SSP-225, SSP-226, SSP-227, SSP-228, SSP-229, SSP-230, SSP-217, SSP-218, SSP-219, SSP-195, SSP-196, SSP-198, SSP-212, SSP-158, SSP-302 |
| [SSP-302](M6/SSP-302-district-idea-barks.md) | Extend Pam's prompt layer to the Tue–Sun 'new idea' barks and author them per district | feature | M | SSP-290, SSP-186, SSP-061, SSP-086, SSP-203, SSP-204, SSP-206, SSP-209, SSP-212, SSP-214, SSP-215 |

<a id="m7"></a>
## M7 1.0 Web Release

| ID | Title | Type | Size | Depends on |
|---|---|---|---|---|
| [SSP-234](M7/SSP-234-settings-store.md) | Implement the ssp.settings.v1 store in src/app/settings.ts with storage fallback | feature | M | SSP-186, SSP-173 |
| [SSP-235](M7/SSP-235-settings-scene.md) | Build SettingsScene with audio, display, accessibility and assist pages | feature | L | SSP-234, SSP-157, SSP-043, SSP-113, SSP-142, SSP-143, SSP-144, SSP-070, SSP-024, SSP-285, SSP-286, SSP-287, SSP-290 |
| [SSP-236](M7/SSP-236-input-remapping.md) | Add keyboard and gamepad remapping for every action, with persistence | feature | L | SSP-234, SSP-235, SSP-044, SSP-286, SSP-287, SSP-290 |
| [SSP-237](M7/SSP-237-assists-sim.md) | Wire auto-brush, +60 s timer, Chill Shift and instant dump into the sim | feature | L | SSP-234, SSP-059, SSP-062, SSP-058, SSP-053, SSP-078, SSP-211, SSP-196, SSP-214, SSP-079, SSP-071, SSP-287 |
| [SSP-238](M7/SSP-238-assists-tally-save.md) | Flag assists on the Mercury tally and store assisted bests separately | feature | M | SSP-237, SSP-192, SSP-186, SSP-187 |
| [SSP-239](M7/SSP-239-audio-access-settings.md) | Wire audio accessibility settings live: captions via SSP-184, mono, loud sounds, beeper, adaptive music | feature | M | SSP-234, SSP-173, SSP-184, SSP-182, SSP-177, SSP-178, SSP-180, SSP-181 |
| [SSP-240](M7/SSP-240-juice-squash-popups.md) | Juice pass: squash-and-stretch, combo popups and the cat roof-ride | feature | M | SSP-087, SSP-082, SSP-036, SSP-070, SSP-063, SSP-127, SSP-133, SSP-146, SSP-142, SSP-143, SSP-288 |
| [SSP-241](M7/SSP-241-juice-impact.md) | Add screen shake, hit-stop and gamepad rumble with reduce-motion support | feature | M | SSP-234, SSP-036, SSP-090, SSP-082, SSP-078, SSP-044, SSP-043, SSP-024 |
| [SSP-242](M7/SSP-242-reduce-flashing.md) | Implement the Reduce flashing setting across HUD and world effects | feature | M | SSP-234, SSP-240, SSP-070, SSP-156, SSP-078, SSP-114, SSP-211, SSP-222, SSP-288 |
| [SSP-243](M7/SSP-243-song-promenade.md) | Compose and render mus.promenade "Seagull Surf" with adaptive stems | asset | M | SSP-166, SSP-167, SSP-177, SSP-209 |
| [SSP-244](M7/SSP-244-song-kebab-mile.md) | Compose and render mus.kebab_mile "Kebab O'Clock" with adaptive stems | asset | M | SSP-166, SSP-167, SSP-212 |
| [SSP-245](M7/SSP-245-song-civic-trophy.md) | Compose mus.civic_quarter "Clipboard March" and the jng.trophy jingle | asset | L | SSP-166, SSP-170, SSP-176, SSP-215, SSP-216, SSP-192 |
| [SSP-246](M7/SSP-246-audio-complete-audit.md) | Verify all 9 songs and 6 jingles ship, and run the full-playthrough mix pass | test | M | SSP-243, SSP-244, SSP-245, SSP-169, SSP-170, SSP-171, SSP-172, SSP-173, SSP-194, SSP-195, SSP-218, SSP-219, SSP-301 |
| [SSP-247](M7/SSP-247-perf-stress-civic.md) | Extend perf.spec.ts to Civic Quarter with the 2,000/80/30 stress load | test | M | SSP-023, SSP-027, SSP-106, SSP-215, SSP-292 |
| [SSP-248](M7/SSP-248-perf-optimise.md) | Profile and optimise until the M7 performance budgets hold | feature | L | SSP-247, SSP-240, SSP-241, SSP-023, SSP-197, SSP-203, SSP-204, SSP-206, SSP-209, SSP-212, SSP-215 |
| [SSP-249](M7/SSP-249-credits-scene.md) | Build CreditsScene with pipeline and tool-version provenance | feature | M | SSP-216, SSP-186, SSP-157, SSP-115, SSP-117 |
| [SSP-250](M7/SSP-250-butler-install.md) | Install butler and record its version in TECHNICAL_DESIGN | chore | S | — |
| [SSP-251](M7/SSP-251-itch-page.md) | Prepare the itch.io page: copy, controls, rating note and screenshots | release | M | SSP-250, SSP-019, SSP-233 |
| [SSP-252](M7/SSP-252-content-ip-review.md) | Run the PEGI 7 / ESRB E10+ content review and extend IP hygiene checks | test | M | SSP-249, SSP-251, SSP-003, SSP-192, SSP-233 |
| [SSP-253](M7/SSP-253-browser-scaling-qa.md) | Run cross-browser, scaling and storage-blocked verification for 1.0 | test | M | SSP-235, SSP-236, SSP-238, SSP-239, SSP-240, SSP-241, SSP-242, SSP-248, SSP-246, SSP-249, SSP-251, SSP-022, SSP-232, SSP-233 |
| [SSP-254](M7/SSP-254-release-1-0.md) | Push 1.0 to itch.io with butler and tag v1.0.0 and m7 | release | S | SSP-253, SSP-252, SSP-251, SSP-250, SSP-248, SSP-246, SSP-238, SSP-249, SSP-233, SSP-296 |
| [SSP-296](M7/SSP-296-ci-macos-visual-e2e.md) | Bring the macos-latest visual/e2e CI job to its 1.0 shape and prove both CI jobs green | chore | M | SSP-006, SSP-117, SSP-022, SSP-025, SSP-073, SSP-232, SSP-247 |

<a id="m8"></a>
## M8 Touch & Mobile Web

| ID | Title | Type | Size | Depends on |
|---|---|---|---|---|
| [SSP-255](M8/SSP-255-phone-viewport-scaling.md) | Make the canvas, viewport and integer scaling phone-ready in landscape | feature | M | SSP-015, SSP-022, SSP-019, SSP-006, SSP-073, SSP-235, SSP-253 |
| [SSP-256](M8/SSP-256-touch-layout-model.md) | Define the touch control layout and hit-testing in internal pixel space | feature | S | SSP-044, SSP-015 |
| [SSP-257](M8/SSP-257-touch-input-device.md) | Implement src/input/touch.ts producing the same InputFrame as keyboard and pad | feature | L | SSP-256, SSP-255, SSP-044, SSP-234, SSP-236, SSP-237, SSP-062, SSP-070, SSP-046, SSP-198 |
| [SSP-258](M8/SSP-258-touch-replay.md) | Add the M8 replay: a Puddle Lane drive driven by scripted touch input | test | S | SSP-257, SSP-038, SSP-049, SSP-072, SSP-104 |
| [SSP-259](M8/SSP-259-touch-ui-icons.md) | Author 16×16 touch-control icons as text-grid UI sprites | asset | S | SSP-113, SSP-115, SSP-117, SSP-144, SSP-145, SSP-118 |
| [SSP-260](M8/SSP-260-touch-controls-overlay.md) | Draw the touch control overlay in internal pixel space via the UI pass | feature | M | SSP-256, SSP-259, SSP-257, SSP-144, SSP-069, SSP-113, SSP-019, SSP-023, SSP-212, SSP-242, SSP-285, SSP-300 |
| [SSP-261](M8/SSP-261-touch-hud-adaptation.md) | Adapt the HUD layout so it never sits under the thumbs in touch mode | feature | L | SSP-256, SSP-260, SSP-156, SSP-240, SSP-238, SSP-291 |
| [SSP-262](M8/SSP-262-touch-menus-prompts.md) | Make every menu and prompt usable by tap, with touch-aware glyphs | feature | M | SSP-257, SSP-255, SSP-259, SSP-191, SSP-192, SSP-193, SSP-235, SSP-249, SSP-237, SSP-239, SSP-286, SSP-287, SSP-290 |
| [SSP-263](M8/SSP-263-rotate-landscape-prompt.md) | Show a 'rotate to landscape' prompt and pause the game in portrait | feature | S | SSP-255, SSP-259, SSP-043, SSP-144, SSP-142, SSP-143, SSP-287 |
| [SSP-264](M8/SSP-264-ios-audio-unlock.md) | Harden unlock.ts for iOS Safari: touchend unlock and background resume | feature | M | SSP-173, SSP-174, SSP-178, SSP-179, SSP-180, SSP-181, SSP-246, SSP-239 |
| [SSP-265](M8/SSP-265-mobile-e2e-smoke.md) | Add a Playwright mobile-emulation smoke drive with real touch events | test | M | SSP-255, SSP-257, SSP-260, SSP-262, SSP-263, SSP-073, SSP-006, SSP-019, SSP-022, SSP-296 |
| [SSP-266](M8/SSP-266-ios-device-verification.md) | Verify audio unlock, background resume and layout on a real iPhone | test | S | SSP-264, SSP-257, SSP-260, SSP-261, SSP-262, SSP-263, SSP-255, SSP-250, SSP-251, SSP-157, SSP-002 |
| [SSP-267](M8/SSP-267-mobile-perf-check.md) | Measure frame time and audio memory on a mid-range phone; record M8 budget | test | M | SSP-257, SSP-260, SSP-261, SSP-262, SSP-248, SSP-247, SSP-106, SSP-246, SSP-023, SSP-251 |
| [SSP-268](M8/SSP-268-m8-close-release.md) | Close M8: verify exit criteria, ship the mobile web update, tag m8 | release | S | SSP-265, SSP-266, SSP-267, SSP-258, SSP-261, SSP-262, SSP-263, SSP-254, SSP-250 |

<a id="m9"></a>
## M9 Desktop & Extra Modes

| ID | Title | Type | Size | Depends on |
|---|---|---|---|---|
| [SSP-269](M9/SSP-269-tauri-scaffold.md) | Wrap dist/ in a Tauri 2.12.3 desktop shell (ADR, src-tauri/, scripts) | feature | M | SSP-254, SSP-186, SSP-234 |
| [SSP-270](M9/SSP-270-desktop-app-icon.md) | Author the desktop app icon as a pipeline asset and wire it into Tauri | asset | S | SSP-269, SSP-115, SSP-116, SSP-117 |
| [SSP-271](M9/SSP-271-desktop-signing-decision.md) | Decide desktop code signing and notarisation for macOS and Windows | docs | S | SSP-254 |
| [SSP-272](M9/SSP-272-macos-desktop-builds.md) | Produce macOS arm64 and x64 Tauri bundles and verify platform parity | feature | M | SSP-269, SSP-270, SSP-235, SSP-236, SSP-174 |
| [SSP-273](M9/SSP-273-windows-desktop-build.md) | Produce the Windows x64 Tauri installer and verify parity on WebView2 | feature | M | SSP-269, SSP-270, SSP-235, SSP-236, SSP-174 |
| [SSP-274](M9/SSP-274-linux-desktop-build.md) | Stretch: produce a Linux x64 Tauri build (AppImage/deb) and smoke-test it | feature | M | SSP-269, SSP-270 |
| [SSP-275](M9/SSP-275-mode-plumbing.md) | Add Daily Shift and Rival Sweep mode plumbing: params, timer, replay, save | feature | M | SSP-196, SSP-186, SSP-192, SSP-038, SSP-048 |
| [SSP-276](M9/SSP-276-daily-seed-picker.md) | Derive the Daily Shift seed from the UTC date and pick district + modifiers | feature | S | SSP-187, SSP-186, SSP-028 |
| [SSP-277](M9/SSP-277-daily-modifiers.md) | Implement Daily Shift modifiers as level knob overrides and extra events | feature | L | SSP-275, SSP-276, SSP-203, SSP-204, SSP-206, SSP-209, SSP-212, SSP-215, SSP-205, SSP-207, SSP-083 |
| [SSP-278](M9/SSP-278-daily-shift-flow.md) | Ship the Daily Shift mode: Title entry, intro card, shift, tally, local best | feature | M | SSP-275, SSP-276, SSP-277, SSP-192, SSP-157, SSP-187, SSP-191, SSP-237, SSP-238 |
| [SSP-279](M9/SSP-279-rival-sweeper-sim.md) | Give Spotless Sid a full sweeper in the sim: handling, brush, hopper, dumping | feature | M | SSP-275, SSP-208, SSP-222, SSP-030, SSP-059, SSP-057, SSP-058, SSP-062 |
| [SSP-280](M9/SSP-280-rival-ai-controller.md) | Build Sid's Rival Sweep AI on the lane graph and LitterField | feature | L | SSP-279, SSP-089, SSP-080, SSP-197, SSP-203, SSP-204, SSP-206, SSP-209, SSP-212, SSP-215 |
| [SSP-281](M9/SSP-281-rival-sweep-flow.md) | Ship the Rival Sweep mode: district pick, 180 s duel HUD, winner tally | feature | L | SSP-275, SSP-280, SSP-192, SSP-229, SSP-208, SSP-186, SSP-156, SSP-142, SSP-143, SSP-144, SSP-237, SSP-235 |
| [SSP-282](M9/SSP-282-mode-replays.md) | Commit deterministic replays for Daily Shift (pinned date) and Rival Sweep | test | S | SSP-278, SSP-281, SSP-038 |
| [SSP-283](M9/SSP-283-m9-release-close.md) | Publish desktop builds and both modes on itch.io, then close M9 | release | M | SSP-272, SSP-273, SSP-271, SSP-278, SSP-281, SSP-282, SSP-250, SSP-254 |

★ = required for the vertical slice ([ROADMAP §3](../ROADMAP.md#3-vertical-slice)).
