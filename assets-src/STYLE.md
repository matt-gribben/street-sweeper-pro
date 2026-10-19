# STYLE.md: the locked look of Street Sweeper Pro

**Version: v1, 2026-10-19** (SSP-026, closing the M0 look lock). Load this file before you author, generate,
ingest or review any asset.

- **What this file is.** The terse, operational rule sheet for every pixel in the game. [ART_BIBLE.md](../docs/ART_BIBLE.md)
  carries the reasoning and the examples and mirrors this file. Both change in the same commit. If they ever
  disagree on a locked value, this file wins and ART_BIBLE is fixed in the next commit.
- **Colour values.** [`palette/kerbside32.json`](palette/kerbside32.json) is the only truth for colours, ramps
  and the `night`/`shadow` remaps. This file refers to colours as `index name` (e.g. `15 sweeper_yellow`) and
  never restates a hex value except ink. `tests/unit/styleMirror.test.ts` checks every hex and the remap
  summary below against the JSON.
- **Locked means locked.** After M0 closes, changing the scale, the palette or a remap table needs an ADR under
  `docs/adr/` and a whole-class regeneration ([ROADMAP §1](../docs/ROADMAP.md#1-planning-principles) principle 2,
  [ADR 0002 §3.4](../docs/adr/0002-ai-authored-asset-pipeline.md#34-locks-that-come-before-any-asset-is-generated-m0)).
  The D-xx calls below were made by Claude under the owner's delegation and were approved by the owner when M0
  closed (2026-10-19, tag `m0`). Changing one now needs an ADR.
- **Evidence.** Each decision's measurements and the frames that were read are in the
  [ROADMAP §8 decision log](../docs/ROADMAP.md#8-m0-spike-decision-log). This file records outcomes only.

---

## 1. Scale sheet

| Quantity | Locked value |
|---|---|
| Ground texel density | **16 px per metre** (`PX_PER_M`, `src/sim/constants.ts`) |
| Map tile | **32×32 px** = 2 m × 2 m |
| Storey | **2.5 m = 40 px** of facade texture; buildings 1–6 storeys, landmarks up to 8 |
| Facade module | **32×40 px** (2 m wide × 1 storey) |
| Roof texture density | 16 px/m, aligned to the tile grid |
| Internal resolution | **480×270** base: height always 270, width `clampEven(round(270 × aspect), 432, 640)`, integer upscale only, letterbox `00 ink` (D-03) |
| Review scale | **1:1 in the Wx270 frame** (camera at H = 31.5 m, 1 texel = 1 px). 4× sheets are for inspecting pixels, not for judging readability. |

**Size sheet.** [ART_BIBLE §7.1](../docs/ART_BIBLE.md#71-size-sheet-locked) owns the full per-class table (every
vehicle, animal, UI and art cell). The rows you need most often:

| Class | Atlas cell | Visible body (outline included, except vehicles) |
|---|---|---|
| `veh.sweeper` (Bessie) body and dented | 64×64 | 28×52 px of body (1.75 × 3.25 m, the sim body), 30×54 with the forge outline; about 57×57 at the diagonals |
| `veh.sweeper_brush` overlay | 96×96 (rendered `--size 384`, `ortho_scale` 6 m) | discs reach 2.40 m from the body centre |
| Humans (`npc.*` people) | **24×24** | figure ≤ 18×22; feet pivot (12, 22), row 23 clear |
| Litter (`litter.*`) | **16×16** | 8–14 px (largest item on a sheet = 14 px) |
| Props (`prop.*`) | **32×32 per slice** | 1 flat frame, or a stack of 4 or 8 slices (§8) |
| Pickups (`pwr.*`, `collect.*`) | 16×16 | 12×12 icon on a 1 px halo ring |
| Stains, hazards | 32×32 ground decals | — |

**Scale cheats** ([ART_BIBLE §3.2](../docs/ART_BIBLE.md#32-scale-cheats-deliberate)): vehicles, buildings, tiles
and roofs are 1.0×; humans about 0.85× tall and 2× wide with enlarged heads; cats, dogs and birds about 1.5–2×;
litter about 3–6×; pickups about 4×; storeys 0.83×.

**Scale sign-off (D-07).** Signed off unchanged. At 1:1 Bessie's body is about three times Doris's height, the
14 px litter item is clearly smaller than a person, and a 32 px tile is about a third of Bessie's length. When
authoring litter sheets, include the largest item (the pizza box, 13–14 px) so that mid-size items such as the
banana skin step down to about 10–11 px (note for SSP-139).

---

## 2. Palette and ramps

Kerbside-32 is the only legal colour set, in every asset, shader constant, CSS rule and Blender material. The final
palette pass maps every screen pixel to it, and `forge lint` rejects off-palette pixels in assets. Values: read
[`palette/kerbside32.json`](palette/kerbside32.json). The only hex you may write outside that file is the
letterbox and outline ink, `00 ink` = `#0f0e12`.

| Ramp (`ramps` key) | Indices, dark → light | Use |
|---|---|---|
| `neutral_grey` | 00 → 01 → 02 → 03 → 04 → 05 → 06 → 07 | ink, tar, asphalt, slabs, kerb, chalk |
| `brick_skin` | 08 → 09 → 10 → 11 → 12 | grime, brick, terracotta, light skin |
| `skin_tones` | 12, 11, 13, 08 | light/shade pairs (12, 11), (11, 13), (13, 08); author people as 12 lit / 11 shade |
| `yellow` | 14 → 15 → 16 | Bessie (body 15, shade 14, glint 16), double yellows |
| `orange_red` | 19 → 18 → 17 | brushes, post boxes, cones, hi-vis |
| `green` | 21 → 22 → 23 → 24 | hedges, grass, foliage |
| `blue` | 25 → 26 → 27 → 28 | glass, council blue, sea, spray |
| `purple` | 30 → 31 | plum, lavender |
| `accents` | 20, 29 | bubblegum, teal (accent only) |

Rules (full list in [ART_BIBLE §5.3–5.4](../docs/ART_BIBLE.md#53-usage-rules-per-colour)):

- **At most 4 steps of any one ramp per sprite.** `00 ink` used as the outline does not count (the lint's exact
  treatment of 00 is confirmed in M4).
- **`15 sweeper_yellow` is reserved** for Bessie, double yellows, depot bay hatching and small accents (≤ 4 px on
  an NPC garment; the lollipop lady's coat trim and the tiny `collect.hard_hat` / `collect.golden_crisp` are the
  listed exceptions). Bessie is always the brightest, most saturated object on screen, night included.
- **Three values per material** (lit, base, dark), plus at most a 1 px glint. No gradients, no pillow shading, no
  anti-aliasing against transparency (alpha is binary), no dithering on sprites (ordered 4×4 Bayer only in
  `ai-art`, fog and transitions).
- Two colours that must separate at 1× differ by **≥ 0.12 OKLab L**; an actor's dominant colour sits ≥ 0.12 L from
  `02 asphalt` and `05 slab`, or relies on its outline and a contrasting accent (L table:
  [ART_BIBLE §5.2](../docs/ART_BIBLE.md#52-value-reference)).
- Ramp swaps (per-instance palette variants) and their key indices are *proposed* and lock in M4 (SSP-114); see
  [ART_BIBLE §5.6](../docs/ART_BIBLE.md#56-ramp-swaps-per-instance-palette-variants).

---

## 3. Night and shadow remaps (D-05, D-06)

The tuned tables live in `kerbside32.json` (truth) and are mirrored row by row in
[ART_BIBLE §5.7](../docs/ART_BIBLE.md#57-shadow-and-night-remaps-intent). Summary, source index → target index:

```text
idx    00 01 02 03 04 05 06 07 08 09 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31
night  00 00 01 02 02 02 03 04 00 01 08 09 13 08 13 14 14 13 19 30 19 25 21 21 22 25 25 25 26 25 25 30
shadow 00 00 01 01 02 03 04 05 00 08 09 13 11 08 13 14 15 18 19 30 31 01 21 22 23 00 25 26 27 26 25 30
```

- **Ramp rule** (forge pytest, `forge.palette.remap_violations`): a target is the source itself, a same-ramp colour
  that is not lighter, or a different-ramp colour that is strictly darker. Both tables also keep **value order within
  every ramp**, so lit/base/dark shading survives either remap.
- **`shadow`** drops each colour about two steps and cools it where a cooler darker colour exists; every colour but
  ink darkens. `02 asphalt → 01 tar` is only 0.09 L, the most the neutral ramp allows short of ink.
- **`night`**: neutrals drop 2–3 steps, warm colours step down their own ramps or toward maroon and plum, blues stay
  blue. Bessie's body `15 → 14 ochre` (L 0.68) stays ≥ 0.12 L above every other remapped colour (the brightest
  is `07 → 04`, L 0.56).
- **Order:** shadow is applied after night. Pixels in the light mask (lamp pools, headlights, tail lights, lit
  signs and windows, Bessie's beacon) keep their day colours.
- **Light pools: radius 5 m** (a pool 10 m across, `LIGHT_POOL_RADIUS_M` in `src/render/lightPools.ts`),
  hard-edged stepped circles, **no dither on the edge**. Headlight cones are 8 m long.
- **Cast shadows** are masks, never painted: buildings cast SE polygons of length **0.84 × height** (1 / tan 50°, the sun elevation);
  actors cast their own sprite offset **+2, +2 px** (SE). Bessie's brush overlay casts none; airborne birds cast
  none (*proposed*).
- **Shadow-length multiplier per district (D-06, provisional):** overcast (Gasworks Estate) **×0.5** (0.42 × h),
  dawn (Puddle Lane) and golden hour (The Promenade) **×1.5** (1.26 × h), every other district **×1.0**. The
  direction always stays SE. The values are confirmed when those districts render: M6 for the overcast and golden
  hour cases (SSP-202/SSP-204, SSP-209), and Puddle Lane once a per-district value exists. No issue builds that
  per-district value yet, so until one does every district renders ×1.0.

---

## 4. Light

- **One sun for every technique: azimuth 315° (north-west), elevation 50°.** Hand-drawn grids, procedural
  generators, the Blender rig (`SUN_AZIMUTH_DEG`, `SUN_ELEVATION_DEG` in `blender/rig.py`) and AI prompts ("light
  from the top-left") all agree.
- Top faces (roofs, bonnets, heads seen from above) render **base**, flat. NW-facing bevels are one step lighter,
  SE-facing ones one step darker (1 px; 2 px on large vehicles).
- Building walls use pre-built ramp variants: N and W faces `lit`, E and S faces `dark`, roofs `base`. The forge
  derives `lit`/`dark` from base-value modules by one ramp step (clamped); ink 00, glass 25/27 and the accents
  20/29 never shift, and glass gains one 28 glint per pane on `lit` only (ART_BIBLE §9.4).
- **Creatures and litter are top-lit and symmetric** (highlights centred on head, shoulders and back), because
  SE/E/NE frames are mirrors and litter is rotated in 90° steps by code. The engine's SE drop shadow carries the
  sun direction for them.
- **Blender toon thresholds (SSP-008): dot(N, sun) < 0.33 → dark, 0.33–0.83 → base, ≥ 0.83 → lit** (`T_BASE`,
  `T_LIT` in `blender/rig.py`; owner [ASSET_PIPELINE §7.2](../docs/ASSET_PIPELINE.md#72-rig-rules-enforced-in-rigpy)).
  A flat top scores 0.766 and renders base. Each threshold sits midway between neighbouring 45° chamfer values at
  the 32 headings, with ≥ 0.03 of margin.

---

## 5. Outline

- **Every actor and prop** (vehicles, people, animals, litter, pickups, props, every stack slice) has a **1 px
  `00 ink` (`#0f0e12`) outline, 4-connected, outside the silhouette.**
- Manifest entries for these classes carry `outline: true`, and the forge **completes** the outline at build time:
  every transparent pixel 4-adjacent to a non-ink opaque pixel becomes ink. On a grid that already has a full ink
  border this is a no-op. `forge lint` fails any opaque non-ink pixel 4-adjacent to transparency.
- **Body sizes in the size sheet include the outline** (an 18×22 figure is at most 16×20 of colour). Vehicles are
  the exception: their size is the true-scale model, which must match the sim body, and the outline adds 1 px on
  every side (Bessie 28×52 → 30×54, measured in D-07).
- No coloured outlines ("sel-out"). Interior lines use the part's darker ramp step, not ink, except at genuine gaps
  (tyre against body, drain slot).
- **Not outlined:** ground tiles, roofs, facades, stains, hazards, grime, VFX, and ground markings inside an item sprite
  (a pickup's halo ring, the depot bay markings; SSP-052). Fonts get a generated 8-connected
  outlined variant for text on the playfield.

---

## 6. Perspective and camera (D-01, D-02)

- The camera is a perspective camera looking **straight down** (vertical FOV 30°, H = 31.5 m). Buildings are real
  boxes and lean radially away from the screen centre; roofs magnify by H/(H − h) (1.91× at 6 storeys, accepted as
  chunky mixels; tall roofs use low-frequency detail).
- **Speed zoom: on** (D-01). H eases 31.5 → 37.8 m at transit speed (ω = 3 rad/s, `SPEED_ZOOM_DEFAULT` in
  `src/render/camera.ts`). The shimmer this causes is accepted. At sweeping speeds the camera returns to exact 1:1,
  and **every art review happens at 1:1**. Confirmed with real driving in SSP-047 (M1).
- **Vehicle render tilt: 0°** (D-02). Vehicles are rendered by Blender orthographic and straight down (`--tilt 0`;
  `forge blender` refuses any other value). Actors never lean: they are flat quads, not billboards.
- **Creatures use the high three-quarter view** (§7): seen from about 60° above the horizon, from the south, with
  the sprite's up always screen-north. Pivot = centre of the feet. No painted floor or shadow.
- **Tall thin props are sprite stacks** (§8), which the camera leans exactly like the buildings.
- Directions: vehicles 32 headings (`h00` = north, 11.25° clockwise steps); humans, cats and dogs 8 directions (S,
  SW, W, NW, N authored, SE, E, NE mirrored); pigeons and seagulls 4 (E mirrored from W); litter 4 rotations
  generated by code from `h00`.

---

## 7. People style reference (D-04, D-13)

**Golden:** [`ai/ref.people_style/golden.png`](ai/ref.people_style/golden.png), SHA-256
`112e30d99341abdd8ca285cd4ca25cf4db69e2d66b5deab7382b10492e5af5c4` (`forge gen-ai` candidate `run_04` of round 2,
preamble v1, pinned Codex model, complete `meta.json`). It is a 4×2 turnaround of Doris (`npc.old_woman`): front row
S, bottom row SW, W, NW, N. It locks:

- **The view:** the high three-quarter character view. The face reads full on at S, three-quarter at SW and in profile at W, the
  top of the head is visible, the feet sit at the bottom of the figure, and there is no ground or cast shadow.
- **The proportions:** a large head (about a third of the figure) with 2 px eyes and a 1–2 px mouth; the figure
  sizes of [ART_BIBLE §7.2](../docs/ART_BIBLE.md#72-human-proportions-24x24-cell) (adult 22 px tall, elderly
  18–19, child 16–17, outline included; Doris's front row ingests at 17 px, accepted inside the limit).
- **The finish:** chunky pixels, a complete 1 px ink outline, flat Kerbside-32 colours, almost no interior lines,
  top-lit shading, and carried props inside the cell (Doris's trolley is on the same side in every authored
  direction).
- **The Doris colour key:** headscarf 31, coat 31 over 30, handbag 19, tartan trolley 18/25, hair 06, skin 12/11.

**How to use it:**

- Every human prompt attaches the golden with `-i` and asks to "match the attached reference's proportions,
  outline and palette exactly", plus the high three-quarter view
  ([ASSET_PIPELINE §8.4](../docs/ASSET_PIPELINE.md#84-prompt-file-format)). Ask for "a small frowning mouth line", never a "cross mouth".
- **Ingest quality (D-13):** the block-mode step-down is accepted only when a people sheet's single factor stays
  **at about 0.8× or above**. Prompts therefore ask for near-native resolution: "the whole sheet is only about
  200 × 100 art pixels", a figure of about 19 px, almost no dark lines inside the silhouette. Below about 0.65× the
  face and interior detail collapse into ink and the redraw rate is too high: revise the prompt instead of
  repairing. For reference, the accepted golden ingested at 0.9048× and needed 45 of 1,076 px (4.2%) repaired over
  5 frames, mostly faces, hands and shoes.
- Ingest settings for people: `target_cell` 24×24, `largest_item_px` 19 (elderly) or 22 (adults), `baseline_row`
  22. If the FFT period detector picks a harmonic, commit a measured `period_override` (13.5 px for this golden).
- **After ingest the grid is the truth** (`sprites/npc/<id>.sprite.txt`). Fix faces, hands and outlines there and
  never re-ingest over an edited grid.

---

## 8. Sprite stacks: slice counts and slice shadows (SSP-020)

A stack is 4 to 8 horizontal 32×32 slices drawn at real heights (slice `k` = 0 at the ground, drawn at the top of
its height band), so the camera leans it like a wall. Slice `k` shifts `r · h / (H − h)` metres outward, where `r`
is its distance from the screen centre.

**Rule.** A thin member stays continuous while consecutive slices shift less than its width in pixels. Compute
`D = 16 · r · h / (H − h)` px for the prop's top height `h`, at `r = 20 m` (the horizontal edge of the widest,
640 px frame) and H = 31.5 m. If `D / w ≤ 4`, where `w` is the narrowest vertical member's width in px (outline
included), the prop gets **4 slices**; otherwise it gets **8**. Two tiers keep the count stable against small
model changes.

| Prop | Nominal top height, narrowest member | D / w | **Slices** |
|---|---|---|---|
| `prop.lamp_post` | 4.4 m, 6 px post | 8.7 | **8** |
| `prop.tree` | 6.0 m, 7 px trunk | 10.8 | **8** |
| `prop.market_stall` | 2.5 m, 3 px awning pole | 9.2 | **8** |
| `prop.bus_shelter` | 2.5 m, 4 px frame member | 6.9 | **8** |
| `prop.phone_box` | 2.5 m, 18 px box (16 px + outline) | 1.5 | **4** |
| `prop.post_box` | 1.6 m, 10 px pillar | 1.7 | **4** |
| `prop.bollard` | 1.0 m, 5 px post | 2.1 | **4** |
| `prop.litter_bin` | 1.0 m, 10 px bin | 1.1 | **4** |
| `prop.wheelie_bin` | 1.1 m, 12 px bin | 1.0 | **4** |
| `prop.traffic_cone` | 0.75 m, 8 px base | 1.0 | **4** |
| `prop.a_board` | 0.9 m, 6 px frame | 1.6 | **4** |
| `prop.roadworks_barrier` | 1.0 m, 3 px rail | 3.5 | **4** |

- Evidence: the 4-slice M0 lamp post (SSP-020) holds together beside the `lean_quadrants` blocks (r ≈ 7.6 m) but
  its 6 px post breaks with a 3 px gap 13.5 m out. At 8 slices the shift per slice at the 640 px frame edge is about
  6.5 px against the 6 px post, so a 1 px gap can still open in the outermost corners of an ultrawide frame; 8 is
  the size sheet's maximum, and this is accepted.
- The committed M0 lamp post is the 4-slice prototype. SSP-131 (M4) replaces it with the 8-slice render. Heights and
  widths in the table are nominal: if the real model differs, apply the rule to the modelled geometry, and record
  any change of tier here and in [ENTITY_CATALOG §9](../docs/ENTITY_CATALOG.md#9-props-and-obstacles-prop).
  Oversize cells (bus shelter, market stall, tree canopy) are decided in SSP-131.
- **Slice shadows: only the lowest and highest slices cast** the +2, +2 px drop shadow, each at its own height, so
  a stack writes 2 shadow instances whatever its slice count.
- Stack slices must line up vertically when the camera is centred over them (no wobbling stack).

---

## 9. Decided look values (M0)

| Decision | Locked value | Owner / evidence |
|---|---|---|
| D-01 speed zoom | On, H 31.5 → 37.8 m, ω = 3 rad/s; reviews always at 1:1 | ROADMAP §8 D-01, `src/render/camera.ts` |
| D-02 vehicle tilt | 0° (pure overhead) for every vehicle render | ROADMAP §8 D-02, `forge blender` |
| D-03 base resolution | 480×270, adaptive width 432–640, integer scale, `00 ink` letterbox | ROADMAP §8 D-03, [TECHNICAL_DESIGN §12.1](../docs/TECHNICAL_DESIGN.md#121-internal-resolution-and-scaling) |
| D-04 people golden | `ref.people_style` `run_04` (SHA-256 `112e30d9…`), high three-quarter view | ROADMAP §8 D-04, `ai/ref.people_style/meta.json` |
| D-05 `night[32]` | The table in §3; light pools 5 m radius, hard-edged, no dither | ROADMAP §8 D-05, `kerbside32.json` |
| D-06 `shadow[32]` | The table in §3; multipliers ×0.5 overcast, ×1.5 dawn and golden hour, ×1.0 otherwise (provisional) | ROADMAP §8 D-06, `kerbside32.json` |
| D-07 scale sheet | 16 px/m, 32×32 tiles, 32×40 facade module, ART_BIBLE §7.1 unchanged | ROADMAP §8 D-07 |
| D-13 ingest quality | Block-mode step-down accepted at a sheet factor of about ≥ 0.8×; below about 0.65×, re-prompt | ROADMAP §8 D-13 |
| SSP-020 / SSP-026 stacks | 4 or 8 slices by the §8 rule; ends-only slice shadows | §8, ART_BIBLE §6.4 and §8.6 |
| SSP-021 shadows and light | Light-pool radius 5 m; shadow-length multipliers as D-06 | §3 |
| SSP-008 toon thresholds | 0.33 / 0.83 | §4, ASSET_PIPELINE §7.2 |

---

## 10. Not locked by v1

These stay open, owned by the milestone named, and are recorded in [ART_BIBLE §17](../docs/ART_BIBLE.md#17-open-items):

| Item | Decided in |
|---|---|
| Ramp-swap slot allocation and key indices | M4 (SSP-114) |
| Whether the ramp lint ignores `00 ink` used as outline | M4 (forge lint) |
| Atlas trimming and the actor/item/fx gutter (tile, facade and roof frames are 1 px extruded from M1, SSP-039) | M4 (forge pack, SSP-113) |
| Animation timings (frame counts are locked in ART_BIBLE §7.1) | M3–M4 |
| VFX IDs, HUD pixel layout (the M2 positions are decided: SSP-070, ART_BIBLE §12.2) | M2 (HUD), M4 (art) |
| Font metrics, descenders, kerning | M4 |
| Oversize prop cells (bus shelter, market stall, tree) | M4 (SSP-131) |
| Confirming the shadow-length multipliers in real districts | M6 (SSP-202/SSP-204, SSP-209) |

When one of these is decided, update this file and ART_BIBLE in the same commit and bump the version line at the
top (v1.1, v1.2, …).
