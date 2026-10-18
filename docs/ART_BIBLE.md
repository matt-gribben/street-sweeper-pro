# Art Bible

> The visual rules of **Street Sweeper Pro**: what the game looks like, why, and how an AI author (Claude) produces and reviews every pixel of it.
>
> **Authority:** names, IDs, numbers, paths and the palette follow the canonical facts sheet (v1.0, 2026-10-18). Values marked *proposed* are this document's starting points and are locked (or changed) in the milestone noted. Values marked `TBD (M0 spike)` are decided by the M0 Foundations & Look Spike and then recorded in `assets-src/STYLE.md` (created in M0).
>
> **Relationship to `assets-src/STYLE.md`:** STYLE.md is the terse, operational copy of this bible that agents load while authoring assets. This document explains the reasoning and carries the examples. Both are edited in the same PR. If they ever disagree on a locked value, STYLE.md wins and this file is fixed in the next PR.
>
> **Language:** British English throughout (colour, kerb, tyre, rubbish).

**Related docs:** [README](../README.md) · [CLAUDE.md](../CLAUDE.md) · [GDD](GDD.md) · [TECHNICAL_DESIGN](TECHNICAL_DESIGN.md) · [ASSET_PIPELINE](ASSET_PIPELINE.md) · [AUDIO_DESIGN](AUDIO_DESIGN.md) · [LEVEL_DESIGN](LEVEL_DESIGN.md) · [ENTITY_CATALOG](ENTITY_CATALOG.md) · [ROADMAP](ROADMAP.md) · [ADR 0001](adr/0001-tech-stack.md) · [ADR 0002](adr/0002-ai-authored-asset-pipeline.md) · [GLOSSARY](GLOSSARY.md)

---

## Contents

1. [The look in one paragraph](#1-the-look-in-one-paragraph)
2. [References and what we take from each](#2-references-and-what-we-take-from-each)
3. [World scale and resolution](#3-world-scale-and-resolution)
4. [Perspective rules](#4-perspective-rules)
5. [Palette: Kerbside-32](#5-palette-kerbside-32)
6. [Light, shading and outline](#6-light-shading-and-outline)
7. [Sprite size sheet and proportions](#7-sprite-size-sheet-and-proportions)
8. [Look by asset class](#8-look-by-asset-class)
9. [Environment: ground, grime, facades, roofs](#9-environment-ground-grime-facades-roofs)
10. [Animation: frame counts and timings](#10-animation-frame-counts-and-timings)
11. [VFX](#11-vfx)
12. [UI art and pixel fonts](#12-ui-art-and-pixel-fonts)
13. [Night, weather and time of day](#13-night-weather-and-time-of-day)
14. [The AI-authored asset pipeline, from the art side](#14-the-ai-authored-asset-pipeline-from-the-art-side)
15. [Self-review: contact sheets and the quality checklist](#15-self-review-contact-sheets-and-the-quality-checklist)
16. [Do and don't](#16-do-and-dont)
17. [Open items](#17-open-items)

---

## 1. The look in one paragraph

Muckleford is a **British seaside town seen from a council helicopter at teatime**: chunky, sunny, slightly grubby pixel art in a strict 32-colour palette, viewed straight down with buildings that lean away from the centre of the screen as you drive past them. Streets are grey and busy with markings (double yellows, zebra stripes, give-way triangles); terraces are brick with slate roofs; the seafront is all sky blue, bubblegum and lemon. Characters are small, round-headed and over-animated, and they *react*: a startled hop, a cartoon pratfall, a shaken fist. Bessie is the brightest thing on screen at all times, a block of `sweeper_yellow` with a council-blue stripe. The single most important image in the game is **a stripe of clean street behind Bessie** cut through grime, so ground textures are built to make that contrast obvious.

**Mood words:** cheerful, municipal, cluttered, crisp, comic, tidy-versus-grotty.
**Not:** gritty, violent, neon-noir, photo-real, painterly, glossy, "mobile-game gradient".

---

## 2. References and what we take from each

> **IP hygiene:** the names below appear **only** in internal design docs, as inspirations. They are never written into image prompts, asset names, in-game text, store copy or commit messages that describe assets. Prompts describe the *qualities* we want ("overhead view", "chunky pixel art"), never a game. See [CLAUDE.md](../CLAUDE.md).

| Reference | What we take | What we leave behind |
|---|---|---|
| **Grand Theft Auto (1997)** | The straight-down city camera; roofs as the dominant "ground" of the city block; vehicles that read purely by silhouette and colour from overhead; 32-way pre-rendered vehicle rotations; the sense that the town is a toy you drive around. | Crime, violence, run-over pedestrians, grim palette. |
| **Grand Theft Auto 2 (1999)** | The **perspective camera over real 3D blocks**: buildings lean radially, tall roofs magnify ("closer and chunkier"), the camera zooms out at speed. Our §4 rules are essentially "GTA2's camera, with a fixed palette". Also its lighting cheat: pre-lit wall variants per face direction. | The muddy night palette and dither-heavy textures. |
| **Paperboy (1985)** | Suburban comedy hazards with personalities (dogs, grannies, cars pulling out), the idea that the *street* is the antagonist, the delivery-route structure. Its oblique tilt is reserved as `camera.tiltDeg` (default 0, max 12) for post-1.0 route views. | The oblique 3/4 camera in 1.0 districts; its punishing crash-and-lose-a-life tone. |
| **Micro Machines (1991)** | Tiny vehicles that stay readable at speed thanks to bold silhouettes, bright body colours and a dark outline; momentum you can *see*. | Track-racing framing. |
| **The Legend of Zelda: A Link to the Past (1991)** | The high three-quarter character convention (§4.4): round heads, visible faces, 8-direction walk cycles that read at about 22 px; ramps of 3–4 steps per material. | Fantasy content and its perspective-ignoring buildings. |
| **Untitled Goose Game (2019)** | British village comedy: residents with one strong trait each, reactions that are funny rather than punishing, low-stakes mischief. | Its flat vector style. |
| **PowerWash Simulator (2022)** | The **satisfaction of visible cleaning**: dirt that disappears where you pass and a clear clean/dirty boundary. Informs pillar 1 and the grime look in §9.2. | 3D realism, slow pace. |
| **British seaside postcards and 1980s council signage** | Saucy-but-wholesome humour (kept PEGI 7), Pantone-bright seafronts, municipal typography (chunky sans capitals on navy and yellow panels), hi-vis everything. | Real council logos, real brands. |

---

## 3. World scale and resolution

### 3.1 Locked world scale

These numbers are locked in M0 and every asset obeys them.

| Quantity | Value |
|---|---|
| Ground texel density | **16 px per metre** |
| Map tile | **32×32 px = 2 m × 2 m** |
| Storey height (stylised) | **2.5 m = 40 px** of facade texture |
| Building heights | 1 to 6 storeys (2.5 to 15 m). Landmarks up to 8 storeys (20 m). |
| Facade module | **32×40 px** (2 m wide × 1 storey) |
| Roof texture density | 16 px/m (same as ground) |

### 3.2 Scale cheats (deliberate)

Not everything is drawn at 16 px/m. Gameplay readability wins over realism for small things. The table is the contract: an asset that drifts from its class's factor is a review failure.

| Thing | Drawn size | Real size | Factor | Why |
|---|---|---|---|---|
| Vehicles, buildings, tiles, roofs | 16 px/m | — | **1.0×** | The world must be geometrically honest for the camera and collision. |
| Bessie (`veh.sweeper`) | 28×52 px | 1.75 × 3.25 m | 1.0× | Matches the sim body exactly. |
| Humans (`npc.*` people) | figure ≤ 18×22 px | ~0.5 × 1.7 m | ~0.85× tall, ~2× wide | High three-quarter view (§4.4); heads are enlarged for faces. |
| Cats, dogs, birds | 12–16 px | 0.3–0.6 m | ~1.5–2× | A true-scale cat would be 7 px. |
| Litter (`litter.*`) | 8–14 px | 0.05–0.4 m | ~3–6× | A drink can at true scale is 2 px. Largest item = 14 px. |
| Pickups (`pwr.*`, `collect.*`) | 12×12 px | 0.1–0.3 m | ~4× | Must read as icons. |
| Storeys | 40 px | ~3 m | 0.83× | Keeps 6-storey towers from swallowing the screen. |

### 3.3 Internal resolution

- **Base internal resolution 480×270.** Height is always 270. Width adapts in whole pixels: `W = clampEven(round(270 × aspect), 432, 640)`.
- Render target is **(W+2)×272** (1 px margin for the sub-pixel camera). Nearest filtering, no MSAA, no mipmaps.
- Integer upscale only: 1080p fullscreen → 4× (windowed ≈ 3×, itch.io 960×540 embed 2×), 1440p → 5× (45 px bars), 4K → 8×. Letterbox colour `#0f0e12` (index 00 `ink`).
- At H = 31.5 m the ground is **1 texel = 1 pixel** (to within 0.03%, under 0.11 px of drift at the frame edge; [TECHNICAL_DESIGN §12.2](TECHNICAL_DESIGN.md#122-camera-rendercamerats)): 30 m × 16.875 m visible, about 15 × 8.4 tiles.

**Art consequence:** an asset is judged at **1×, in the 480×270 frame**, because that is the only scale a player ever sees it at (upscaling is pure nearest-neighbour). The 4× contact sheets are for inspecting pixels, not for judging readability. See [§15](#15-self-review-contact-sheets-and-the-quality-checklist).

---

## 4. Perspective rules

### 4.1 The camera

A three.js `PerspectiveCamera` looks **straight down** (vertical FOV 30°, sweep height H = 31.5 m), easing out to 37.8 m at transit top speed. Full maths is in [TECHNICAL_DESIGN](TECHNICAL_DESIGN.md). What matters for art:

| Element | How it is drawn | Who authors the "lean" |
|---|---|---|
| Ground tiles, stains, hazards, grime | Flat, at y = 0 | Nobody: they are flat. |
| Buildings | Real extruded boxes; facades on the walls, roof textures on top | **The camera.** Walls facing the screen centre become visible; roofs magnify by H/(H − h). |
| Actors (vehicles, people, animals, litter, pickups) | Flat textured quads at y = 0, layered by a depth offset ([TECHNICAL_DESIGN §12.5](TECHNICAL_DESIGN.md#125-sprites-spritebatchts-spritestackts)). **Not billboards.** | Nobody. Actors never lean. |
| Tall thin props (lamp posts, phone boxes, bollards, trees, bins) | **Sprite stacks:** 4–8 horizontal slice quads at increasing heights | **The camera** leans the stack automatically, matching the buildings. |

### 4.2 Building lean

- Walls are visible only on the side facing the screen centre: a building in the top half of the screen shows its **south** face, one on the left shows its **east** face, and so on.
- Lean grows toward the screen edges. Near the centre a 1-storey wall is only a few pixels wide; at the horizontal edge (15 m off-centre) it is about 21 px. **Facade detail is therefore always seen foreshortened** and must read through bold horizontal banding and strong vertical rhythm, not fine texture (§9.4).
- **Roof magnification** at H = 31.5: 1 storey 1.09×, 3 storeys 1.31×, 6 storeys 1.91×. Roof texels on tall buildings become visibly chunkier (mixels). This is **accepted as part of the look**. Roof textures for tall buildings are authored with low-frequency detail so magnification reads as "chunky", not "noisy" (§9.5).
- Shimmer while speed-zoomed is accepted. At sweeping speeds the camera returns to exact 1:1, so all reviews happen at 1:1.

### 4.3 Vehicles are pure overhead

Vehicles are rendered by Blender with an **orthographic camera looking straight down** (`--tilt 0`). We see roofs, bonnets and windscreens, never sides, except the 1–2 px of bodywork that bevels away from the roof. Tilt up to 8° is allowed only if the M0 spike approves it; the probe's 22° clashed with radially leaning buildings and is rejected.

### 4.4 Creatures use a high three-quarter cheat

Humans and animals are drawn in a **high three-quarter view**, as if seen from about 60° above the horizon, from the south. We see the top of the head, the face (when facing S, SW or SE), a foreshortened torso, and feet. This is a deliberate convention, not geometry: the sprite's "up" is always screen-north, regardless of where the actor is on screen.

Why: pillar 4 (Charming Chaos) needs faces: Doris's glare, the jogger's panic, the kid's "WAAAH!". A pure overhead person (a head-and-shoulders blob) cannot glare. The mismatch with pure-overhead vehicles is the same one generations of top-down games have shipped, and the **M0 spike scene** (Blender Bessie plus one Codex pedestrian in-engine) exists to confirm it reads. The approved `ref.people_style` golden locks the exact angle.

Rules that follow from the cheat:

- **Pivot = feet.** The sprite's pivot is the centre of the feet, at the bottom of the figure. Collision circles and drop shadows are centred there.
- **Vertical order:** actors are flat quads, so sort order between overlapping actors is by world Y of the pivot (southern actors draw on top). See [TECHNICAL_DESIGN](TECHNICAL_DESIGN.md).
- **No implied ground plane in the sprite.** No painted floor, no painted shadow: the engine adds the drop shadow (§6.4).

### 4.5 Directions and headings

| Actor kind | Directions | Selection |
|---|---|---|
| Vehicles | 32 headings, `h00` = north (screen up), stepping 11.25° clockwise | Nearest heading, with 2° hysteresis *(proposed)* so a vehicle driving at exactly 5.6° does not flicker. |
| Humans, cats, dogs | 8 directions; S, SW, W, NW, N authored, SE, E, NE mirrored | Nearest 45° sector, with 10° hysteresis *(proposed)*. |
| Pigeons, seagulls | 4 directions; S, W, N authored, E mirrored from W | Nearest 90° sector. |
| Litter | 4 rotations `h00`, `h08`, `h16`, `h24`, generated by code from the authored `h00` frames | Seeded per item at spawn; never changes. |

---

## 5. Palette: Kerbside-32

### 5.1 The table

`assets-src/palette/kerbside32.json` holds **the only legal colours** in the game. The final palette pass maps every screen pixel to one of these 32, so the game can never show anything else.

| # | Name | Hex | # | Name | Hex |
|---|---|---|---|---|---|
| 00 | ink (outline) | `#0f0e12` | 16 | lemon | `#fff27a` |
| 01 | tar | `#24222a` | 17 | hivis_orange | `#ff8a1e` |
| 02 | asphalt | `#3a3840` | 18 | postbox_red | `#d23a2c` |
| 03 | asphalt_lt | `#55535a` | 19 | maroon | `#8a1f27` |
| 04 | slab_dk | `#74727a` | 20 | bubblegum | `#f07a8a` |
| 05 | slab | `#9a989c` | 21 | hedge_dk | `#1f3a2a` |
| 06 | kerb | `#c3c1c0` | 22 | grass | `#2f6b3a` |
| 07 | chalk (white) | `#f2efe6` | 23 | grass_lt | `#5fa04a` |
| 08 | soot_brown | `#3b2421` | 24 | lime | `#a8d06a` |
| 09 | brick_dk | `#6b3a2c` | 25 | navy | `#1c2b4a` |
| 10 | brick | `#9c5236` | 26 | council_blue | `#2e5a9c` |
| 11 | terracotta | `#c97b4e` | 27 | sky | `#5ea0d8` |
| 12 | skin_lt | `#e8b48a` | 28 | spray | `#a8dcef` |
| 13 | umber | `#8a5a3c` | 29 | teal | `#2a8a86` |
| 14 | ochre | `#c98a1a` | 30 | plum | `#4a2f6b` |
| 15 | sweeper_yellow | `#f2c12e` | 31 | lavender | `#8a5ab8` |

**Ramps:**

| Ramp | Indices |
|---|---|
| Neutral grey | 00→01→02→03→04→05→06→07 |
| Brick / skin | 08→09→10→11→12 |
| Skin tones | 12, 11, 13, 08 |
| Yellow | 14→15→16 |
| Orange / red | 19→18→17 |
| Green | 21→22→23→24 |
| Blue | 25→26→27→28 |
| Purple | 30→31 |
| Accents | 20, 29 |

**Bessie's livery:** body 15 (shade 14), cab 07, stripe 26, brushes 18, beacon 17 (flashes to 16), windscreen 25/27, tyres 00/01.

`palette.json` contains `colors[32]`, `ramps{}`, `night[32]` (index remap) and `shadow[32]` (index remap). The exact night and shadow tables are tuned in M0 and recorded in the file.

### 5.2 Value reference

OKLab lightness (L, 0–1) of each index, computed from the hex values. Use it for value checks: two colours that must separate at 1× should differ by **at least 0.12 L**, and an actor's dominant body colour should differ from both asphalt (02, L 0.35) and slab (05, L 0.68) by at least 0.12 L, or else rely on its ink outline and a contrasting accent.

| Idx | L | Idx | L | Idx | L | Idx | L |
|---|---|---|---|---|---|---|---|
| 00 | 0.17 | 08 | 0.29 | 16 | 0.95 | 24 | 0.81 |
| 01 | 0.26 | 09 | 0.41 | 17 | 0.75 | 25 | 0.29 |
| 02 | 0.35 | 10 | 0.52 | 18 | 0.58 | 26 | 0.47 |
| 03 | 0.45 | 11 | 0.66 | 19 | 0.42 | 27 | 0.68 |
| 04 | 0.56 | 12 | 0.81 | 20 | 0.72 | 28 | 0.86 |
| 05 | 0.68 | 13 | 0.51 | 21 | 0.32 | 29 | 0.58 |
| 06 | 0.81 | 14 | 0.68 | 22 | 0.47 | 30 | 0.37 |
| 07 | 0.95 | 15 | 0.83 | 23 | 0.64 | 31 | 0.56 |

Bessie's body (15, L 0.83) sits 0.48 above asphalt and 0.15 above slab: she pops on roads and still separates on pavements.

### 5.3 Usage rules per colour

| # | Name | Use for | Rules and restrictions |
|---|---|---|---|
| 00 | ink | Outlines; the deepest crevices (tyre gaps, open manhole, drain slots); letterbox; text outline | Never as a fill colour larger than 2×2 px on an actor. Never as a shading step inside a lit surface. |
| 01 | tar | Darkest ground (fresh tarmac patch, shadowed gutter), tyres, black cab body, felt roofs | Shading step below asphalt. |
| 02 | asphalt | The base road surface | The most common pixel in the game. Keep actors' dominant colours away from it (§5.2). |
| 03 | asphalt_lt | Road aggregate speckle, worn tarmac, slate roof highlights | |
| 04 | slab_dk | Paving joints, concrete shade, gravel roofs | |
| 05 | slab | Pavement slabs, concrete, silver car paint base | |
| 06 | kerb | Kerb stones, light concrete, worn white paint | Kerb top face is always 06 with a 07 NW lip and 04 SE lip. |
| 07 | chalk | Road markings, white van, cab roofs, highlights, UI text, newspaper paper | The brightest neutral. Use sparingly as a highlight on actors (1–3 px). |
| 08 | soot_brown | Grime, dog mess, deepest brick shade, dark hair | **The primary grime colour.** |
| 09 | brick_dk | Brick mortar shade, dark wood, `_dark` brick facades | |
| 10 | brick | Base brick, red-brown roofs | |
| 11 | terracotta | Pantiles, chimney pots, plant pots, lit brick, skin shade | |
| 12 | skin_lt | Light skin, sand, biscuit and pastry litter | |
| 13 | umber | Mid-brown skin, cardboard (pizza box), wood, dead leaves | |
| 14 | ochre | Bessie shade, double-yellow shade, autumn leaves, gold | |
| 15 | sweeper_yellow | **Bessie's body**, double yellow lines, hi-vis yellow trims, the player arrow on the minimap | **Reserved.** No other vehicle body, no NPC garment larger than 4 px, no large prop may be 15. The player must always find Bessie in under a second. |
| 16 | lemon | Highlights on yellow, beacon flash, headlight cores, lit windows at night, sparkles | |
| 17 | hivis_orange | Bessie's beacon, traffic cones, roadworks, hi-vis vests (postie, bin crew), orange accents | Never a large ground area. |
| 18 | postbox_red | Bessie's brushes, post box, phone box, bus, tail lights, penalty popups, dog lead | |
| 19 | maroon | Shade of red, Doris's handbag, deep awnings | |
| 20 | bubblegum | Seafront accents, milkshake, chalk art, the ×5 combo popup | Accent only: no more than ~10% of any district's screen. |
| 21 | hedge_dk | Hedges, tree canopy shade, deep park shadow | |
| 22 | grass | Grass base, green garments, Racing Green livery | |
| 23 | grass_lt | Lit grass, canopy highlight, pledge rosette, "good" UI states | |
| 24 | lime | Brightest foliage glints, ×2 "TIDY!" accents | |
| 25 | navy | Windscreens, the Inspector's suit, UI panel shade, night water | |
| 26 | council_blue | Bessie's stripe, council UI panels, police livery, signage | |
| 27 | sky | Windscreen highlight, sea, puddle surface, Seaside livery | |
| 28 | spray | Water spray, puddle glints, glass shards, police lightbar "on" | |
| 29 | teal | Seafront railings, oil sheen, teal garments | Accent. |
| 30 | plum | Doris's coat, oil sheen, police lightbar "off", night shading | |
| 31 | lavender | Lit plum, headscarves, chalk art | |

### 5.4 Ramp rules

- **Maximum 4 steps of any one ramp per sprite** (enforced by `forge lint`). Index 00 used as the outline does not count against the neutral ramp; index 00 used as interior fill does. *(The lint's exact treatment of 00 is confirmed in M4; see [§17](#17-open-items).)*
- **Hue-shift across ramps is allowed** where it reads better (e.g. a red car's highlight may be 17 hivis_orange; a black cab's shade may be 00), but the result still counts as 4 steps per ramp touched.
- **Ramps run along light, not along "colour":** step one index toward the light for NW-facing surfaces and one away for SE-facing ones (§6). Never place two non-adjacent steps of the same ramp side by side to fake texture; use one-step speckle.
- **Skin tones** use the skin ramp (12, 11, 13, 08) as light/shade pairs: (12, 11), (11, 13) and (13, 08). Every authored person uses **12 lit, 11 shade** as the key, so ramp swaps can produce the other two pairs (§5.6).

### 5.5 District colour keys

Each district has a dominant palette subset. This is the art-direction view; geometry and spawns live in [LEVEL_DESIGN](LEVEL_DESIGN.md).

| District | Dominant indices | Accents | Notes |
|---|---|---|---|
| Puddle Lane (Mon) | 09, 10, 11 brick terraces; 02/03 slate roofs; 05 slabs | 22/23 front gardens, 27 puddles | Dawn: long shadows, warm. |
| Muckleford High Street (Tue) | 05/06 concrete, 10 brick | Awnings in 18, 26, 22, 20; A-boards 07 | The busiest colour mix; keep ground calm. |
| Gasworks Estate (Wed) | 03, 04, 05 greys, 29 teal cladding, 01 felt roofs | 17 roadworks, 28 rain glints | Overcast; colour comes from hazards. |
| Conker Hill (Thu) | 21, 22, 23 gardens and trees; 11 pantiles | 14, 13, 11 falling leaves | The greenest district. |
| The Promenade (Fri) | 27 sea, 12 sand, 06/07 promenade | 20, 16, 29 railings and arcades | Golden hour; the most saturated. |
| Kebab Mile (Sat) | Night remap of 10/03/05 | Lit windows and signs (16, 17, 18, 20) | See §13. |
| Civic Quarter (Sun) | 06/07 civic stone, 22/23 parks | 26 council banners, 14 Town Hall clock | Grand and clean-looking: grime must still read. |
| The Depot Yard | 02/03 concrete, 15/14 bay hatching | 17 cones | The only place 15 appears on the ground in bulk (bay markings). |

### 5.6 Ramp swaps (per-instance palette variants)

The renderer supports **up to 8 swap tables per atlas**; each instance picks one table (an index → index map). Slot 0 is always identity. Because one table applies to the whole sprite, each slot is **multiplexed**: different sprite families are authored in different *key indices*, so a single table can mean "paint 3" to a hatchback, "outfit 3" to a shopper and "livery 3" to Bessie at the same time.

**Key indices on the `actors` atlas** *(proposed, locked in M4)*:

| Family | Key indices (authored as) | Must not use |
|---|---|---|
| `veh.hatchback`, `veh.saloon` paint | 21 dark, 22 base, 23 light | 14, 15, 16, 17, 26, 30, 12, 11 |
| `npc.shopper` primary garment | 21, 22, 23 | 26, 30 |
| `npc.shopper` secondary garment | 14, 15, 16 (≤ 4 px of 15) | 26, 30 |
| Skin (shopper) and dog coat (dog walker's dog) | 12 lit, 11 shade | — |
| `veh.sweeper` livery | body 14/15/16, stripe 26, beacon 17 | 21–23, 30 |
| `veh.police` lightbar | 30 ("off") | — |
| Glass on all vehicles | 25, 27 (never a swap source) | — |

**Slot allocation:**

| Slot | Car paint (21/22/23 →) | Bessie livery (14/15/16, 26 →) | Flash | Skin / coat (12/11 →) | Used by |
|---|---|---|---|---|---|
| 0 | green 21/22/23 (identity) | Council Yellow (identity) | — | 12/11 | everyone (default) |
| 1 | red 19/18/17 | Council Yellow | 17→16, 30→28 | 11/13 | cars, shoppers, dogs, Bessie and Sid beacon, police lights |
| 2 | blue 25/26/27 | Racing Green: 21/22/23, stripe → 15 | — | 13/08 | cars, shoppers, dogs, Bessie |
| 3 | white 05/06/07 | Racing Green | 17→16 | 12/11 | cars, shoppers, Bessie |
| 4 | silver 03/04/05 | Seaside Stripes: 26/27/28, stripe → 20 | — | 11/13 | cars, shoppers, Bessie |
| 5 | black 01/02/03 | Seaside Stripes | 17→16 | 13/08 | cars, shoppers, Bessie |
| 6 | teal 25/29/28 | Midnight Gold: 01/25/26, stripe → 15 | — | 12/11 | cars, shoppers, Bessie |
| 7 | rust 09/10/11 | Midnight Gold | 17→16 | 11/13 | cars, shoppers, Bessie |

- Tables are a single lookup (never chained), so "14→21 and 21→25" in the same table do not compound.
- **Beacon flash:** Bessie alternates between her livery's even slot and the odd slot after it. The police car alternates between slots 0 and 1. The brush overlay is a separate instance and always uses slot 0, so the red brushes never change.
- **Spotless Sid** (`veh.rival_sweeper`) is a *build-time* application of a `rival` table to Bessie's built frames: body 15→07, 14→06, 16→07, cab 07→22, stripe 26→22 (green and white). It therefore can never drift from Bessie's geometry and uses no runtime slot except slot 1 for his beacon.
- The swap tables are emitted in each atlas JSON under `swaps`. The `ui` and `fx` atlases have their own tables (none planned for 1.0).

### 5.7 Shadow and night remaps (intent)

The exact `shadow[32]` and `night[32]` tables are tuned in M0 and recorded in `palette.json`. The **intent** the tuning must satisfy:

| Remap | Intent | Example targets (illustrative, not final) |
|---|---|---|
| `shadow` | Each colour drops about **two ramp steps** and cools slightly. Shadows must stay readable: details in shade survive. | 02→01, 05→03, 06→04, 07→05, 10→09, 15→14, 23→22, 27→26 |
| `night` | Everything outside a light pool shifts toward navy/plum: warm colours to maroon and plum, neutrals down 2–3 steps, blues stay blue. Bessie must still be the brightest non-light object. | 02→01, 05→02, 07→04, 10→08, 15→14, 16→15, 23→21, 27→25 |

Shadow is applied after night, so a shadowed pixel at night is darker still. Lit windows, headlights and street lamps write the light mask and are exempt from the night remap (§13).

---

## 6. Light, shading and outline

### 6.1 The sun

One sun for every technique: **north-west, azimuth 315°, elevation 50°**. Hand-drawn grids, procedural generators, Blender materials and AI prompts ("light from the top-left") all agree.

### 6.2 Shading rules

| Surface | Treatment |
|---|---|
| Top faces (roofs, bonnets, cab roofs, heads seen from above) | **Base** ramp step, flat. Top faces render flat in Blender too. |
| NW-facing bevels and edges | One step **lighter** (1 px wide at actor scale) |
| SE-facing bevels and edges | One step **darker** (1 px wide; 2 px on large vehicles) |
| Building walls | Pre-built variants: N and W faces `_lit`, roofs `_base`, E and S faces `_dark` (§9.4) |
| Cast shadows | Never painted. Buildings get projected shadow polygons (SE, length 0.84 × height); actors get a drop shadow (§6.4). |

- **Readability comes from silhouette, palette and outline**, not from rendering. Three values per material is the norm: lit, base, dark. A fourth step is for a glint (e.g. a 1 px 16 on a yellow bevel), never for smooth gradients.
- **No pillow shading** (darkening all edges equally), no soft gradients, no anti-aliasing against transparency (alpha is binary), no dithering on sprites. Ordered 4×4 Bayer dither is allowed **only** in `ai-art` (title, key art, portraits), fog and transitions.
- **Mirror-safe creature shading:** SE, E and NE frames are horizontal mirrors of SW, W and NW, which would flip a NW highlight to the NE. Humans and animals therefore use **top-lit** shading: highlights on the top of the head, shoulders and back (centred), shade underneath and on the lower body, and no left/right-asymmetric highlights. The drop shadow, which the engine always offsets to the SE, carries the sun direction for them.
- **Rotation-safe litter shading:** litter is rotated in 90° steps by code, so it uses the same top-lit approach: a centred highlight, never an edge highlight.
- Vehicles and Blender props are exempt: Blender re-lights every heading under the fixed sun, so their highlights stay on the NW correctly.

### 6.3 The outline rule

- **Every actor and prop** (vehicles, people, animals, litter, pickups, props, stack slices) has a **1 px `ink` (`#0f0e12`, index 00) outline, 4-connected, outside the silhouette**. `forge lint` fails any actor or prop with an opaque, non-ink pixel 4-adjacent to transparency.
- Manifest entries carry `outline: true` for these classes. The build **completes** the outline: every transparent pixel 4-adjacent to a non-ink opaque pixel becomes ink. For a grid that already has a full ink border this is a no-op, so hand-drawn grids, ingested grids and Blender renders all end up identical in style.
- **Visible body sizes in the size sheet include the outline.** A human figure of ≤ 18×22 px is at most 16×20 px of colour inside its ink.
- **No selective outlining** (coloured outlines, "sel-out"). Interior lines between parts use the darker ramp step of the part, not ink, except for genuine gaps (between a tyre and the body, the slot of a drain).
- **Not outlined:** ground tiles, roofs, facades, stains, hazards, grime, VFX particles. They are the world, not things on it. Shadows are masks, not sprites.
- **Fonts:** the forge generates an outlined variant of each font (§12.5); UI text on the playfield always uses the outlined variant.

### 6.4 Shadows

| Shadow | Rule |
|---|---|
| Actor drop shadow | The same sprite offset **+2, +2 px** (SE), written to the shadow mask. Never painted into the sprite. Not drawn for flying birds while airborne *(proposed)*; drawn for the cat on Bessie's roof. |
| Building shadow | Polygon projected toward the SE, length 0.84 × height (tan 50°), written to the shadow mask. |
| Sprite stacks | Each slice casts its own +2, +2 offset *(proposed: only the lowest and highest slices, to keep mask draws cheap; decided in M0)*. |
| Result | Pixels under the mask are remapped through `shadow[32]`: shadows are always palette colours. |

---

## 7. Sprite size sheet and proportions

### 7.1 Size sheet (locked)

| Class | Atlas cell | Visible body | Directions / frames |
|---|---|---|---|
| `veh.sweeper` (Bessie) | body/dented 64×64; brush overlay is a separate asset `veh.sweeper_brush`, cell 96×96 (rendered `--size 384`, `ortho_scale` 6 m), same centre pivot as the body | 28×52 px (1.75 × 3.25 m) | 32 headings. Brush overlay: 32 headings × 4 spin frames (the discs reach 2.40 m from the body centre at diagonals, beyond a 64 px cell). Dented variant below 40 HP. |
| `veh.hatchback` | 64×64 | 26×46 | 32 headings, 8 paint swaps |
| `veh.saloon`, `veh.taxi`, `veh.police` | 64×64 | 28×54 | 32 headings |
| `veh.van_white`, `veh.ice_cream_van` | 64×64 | 30×60 / 32×62 | 32 headings |
| `veh.bin_lorry` | 96×96 | 36×84 | 32 headings |
| `veh.bus` | 128×128 | 38×116 | 32 headings |
| `veh.rival_sweeper` | 64×64 | 28×52 | 32 headings (ramp swap of the Bessie model, green and white) |
| `veh.bicycle`, `veh.mobility_scooter` | 32×32 | 8×26 / 14×22 | 32 headings |
| Humans (`npc.*`) | **24×24** | figure ≤ 18×22 | 8 directions (S, SW, W, NW, N authored; SE, E, NE mirrored). Frames: walk 4, idle 2, startle 2, fall 3, angry 2 (13 per direction). |
| `npc.cat` | 16×16 | ≤ 12×14 | 8 directions: walk 4, sit 2, dart 2, leap 3 |
| `npc.dog_*` | 20×20 | ≤ 16×18 | 8 directions: walk 4, sit 2, bark 2 |
| `npc.pigeon` | 12×12 | ≤ 10×8 | 4 directions: peck 2, fly 3 |
| `npc.seagull` | 16×16 | ≤ 14×10 | 4 directions: walk 2, fly 3 |
| Litter (`litter.*`) | **16×16** | 8 to 14 px | 1 frame plus 2-frame wobble. 4 rotations generated by code. |
| Stains / grime decals (`stain.*`) | 32×32 | — | 1 to 3 variants |
| Props (`prop.*`) | 32×32 per slice | — | 1 frame, or a stack of 4 to 8 slices |
| Pickups (`pwr.*`, `collect.*`) | 16×16 | 12×12 | 2-frame bob |
| Ground tiles | 32×32 | — | variants plus a 47-tile kerb blob autotile set |
| HUD icons | 16×16 | — | — |
| 9-slice panels | 24×24 source, 8 px corners | — | — |
| Portraits (intro cards) | 64×64 | — | 2 expressions |
| Title / key art | 480×270 | — | — |

Notes:

- Hazards (`haz.*`) are not in the locked sheet; they use the stain cell, **32×32 ground decals** *(proposed, matching [ENTITY_CATALOG](ENTITY_CATALOG.md) §10)*.
- Vehicle cells are sized for the **diagonal** headings. Bessie's 28×52 body rotated 45° has a bounding box of about 57×57 px including outline, inside 64×64. The bus (38×116) peaks at about 109 px in 128. Check diagonals on the contact sheet, not `h00`.
- Per-class frame totals and frame IDs are listed in [ENTITY_CATALOG](ENTITY_CATALOG.md).

### 7.2 Human proportions (24×24 cell)

High three-quarter view (§4.4). Heights include outline. Pivot = bottom-centre of the feet, at row 22 of the cell *(proposed)*, leaving row 23 clear.

| Build | Total height | Head | Torso | Legs | Width (body / with props) | Used by |
|---|---|---|---|---|---|---|
| Adult | 22 | 8 (hair 3, face 4, chin/outline 1) | 7 | 7 | 10 / ≤ 18 | shopper, jogger, businessman, litterbug, postie, market trader, reveller, inspector, lollipop lady, dog walker, mum |
| Elderly (hunched) | 18–19 | 8 | 6 | 4–5 | 10 / ≤ 18 with trolley or frame | `npc.old_woman` (Doris), `npc.old_man_frame` |
| Child | 16–17 | 8 | 4–5 | 4 | 8 / ≤ 16 with skateboard | `npc.kid_skateboard`, `npc.kid_chalk` |

- Heads are deliberately large (8 px, a third or more of the figure) so expressions read: two-pixel eyes (00 or 01), a 1–2 px mouth, eyebrows only on angry frames.
- Carried props are part of the figure and must fit inside the cell: handbag, tartan shopping trolley, pushchair, walking frame, clipboard, phone, skateboard, postie trolley, lollipop sign.
- **Signature silhouettes:** each character must be identifiable as a 1× silhouette alone (§15). Doris = hunch + trolley; old man = frame; jogger = mid-stride, wide arms; businessman = arm up to ear; lollipop lady = disc on a pole; mum = pushchair rectangle ahead of her.

### 7.3 Character colour keys

So that each character reads at a glance across the street. Shoppers vary by swap (§5.6); unique characters always use slot 0.

| Character | Key colours | Signature detail |
|---|---|---|
| `npc.old_woman` "Doris" | coat 30/31, headscarf 31, handbag 19, trolley 18/25 tartan, hair 06 | The glare: angry frame 0 held, brows down |
| `npc.old_man_frame` | cardigan 13, trousers 03, frame 05/06, flat cap 09 | Frame drawn ahead of his feet |
| `npc.jogger` | top 29, shorts 25, headband 07 | Mid-stride even in idle (bouncing) |
| `npc.businessman` | suit 03/02, shirt 07, tie 18 | Phone 00/05 at the ear |
| `npc.litterbug` | hoodie 04/03, cap 18 | Hood up, hands in pockets |
| `npc.postie` | jacket 18/19, hi-vis 17 band, trolley 18 | Post bag 18 |
| `npc.lollipop_lady` | hi-vis coat 15/14 trim on 07, sign 07 disc with 18 ring | The only person allowed a 15 garment area > 4 px (her coat trim), because she is a "stop" signal |
| `npc.market_trader` | apron 26/07 stripes, flat cap 03 | |
| `npc.mum_pushchair` | coat 20, pushchair 25/03 | |
| `npc.reveller` | shirt 20 or 31, untucked, bottle 22 | Wobbling idle |
| `npc.kid_skateboard` | hoodie 17, board 13 | |
| `npc.kid_chalk` | dungarees 26, chalk 07 | Crouched pose in idle |
| `npc.dog_walker` | coat 22, lead 18 | Lead drawn at runtime (§8.3) |
| `npc.inspector` | suit 25, bowler 01, clipboard 06/07, rosette 23 | Clipboard held out front |
| `npc.cat` | ginger 11/13 with 12 belly (or tabby 03/05; variant by code) | Tail as a 1 px curve |
| `npc.dog_loose` | Jack Russell 07 with 11/12 patches, collar 18 | Patches in the skin key for swaps |
| `npc.pigeon` | 04/05 body, 29 neck sheen, 17 feet | |
| `npc.seagull` | 07 body, 04 wings, 15 beak with 18 dot | Beak is the read: 2 px |

---

## 8. Look by asset class

### 8.1 Bessie (`veh.sweeper`)

The Dustmaster 3000 is a compact council road sweeper, seen straight from above, front pointing to `h00` (north):

- **Front (top of sprite, ~14 px):** the cab. Roof 07 chalk with a 17 beacon (2×2 px) centred near the back of the cab roof. Windscreen band 25 with a 27 highlight along its NW edge, 2–3 px deep across the full cab width.
- **Middle and rear (~38 px):** the hopper body, 15 sweeper_yellow with 14 shade on the SE bevels. A 26 council-blue stripe (2 px) runs along both flanks. A hinged rear door shows as a 1 px 14 seam with 05 hinges.
- **Wheels:** 00/01 tyres peeking 1–2 px beyond the body at each corner.
- **Brushes (separate overlay, `veh.sweeper_brush`, 96×96 cell):** two red (18, shade 19) gutter-brush discs either side of the front, plus a 05 suction mouth between them. Each disc carries 4 radial bristle bars in 19 maroon on 18 postbox_red, so the spin is visible from straight above (a plain disc's top face is one flat colour in the toon shader). Overlay frames are 32 headings × 4 spin frames; the bristle pattern rotates 22.5° per frame (4 frames cover a quarter-turn of the 4-fold-symmetric brush, so the loop is seamless).
- **Dented variant (below 40 HP):** same render with a crumpled rear-left panel (two 14/01 notch pixels), a dangling 05 bumper corner and the hopper door ajar by 1 px. Combined with `fx.engine_smoke` puffs below 20 HP *(proposed)*.
- Bessie is **always the brightest, most saturated object** in her district (night included). If a new asset competes with her for attention at 1×, the asset changes.

### 8.2 Traffic and other vehicles

All Blender, 32 headings, same rig, same sun.

| Vehicle | Look |
|---|---|
| `veh.hatchback`, `veh.saloon` | Rounded boxy shapes, body in the paint key (21/22/23), glass 25/27, roofs flat base, 07 headlight dots, 18 tail lights. Paint varies by swap slot. |
| `veh.taxi` | A **black cab**: 01 body with 02 base roof, 00 shade, a 16 roof sign (lit at night). Not yellow (15 is reserved). |
| `veh.police` | 07 body with 26 and 16 checked flanks (lemon, not sweeper yellow), 30 lightbar flashing to 28. |
| `veh.van_white` | 07/06 box, 25 windscreen, ladder rack 05 on the roof. "Dave's Plumbing" lettering only if legible at 1×; otherwise a 26 stripe. |
| `veh.ice_cream_van` | 07 body with 20 bubblegum and 28 trim, a 12 cone shape on the roof. |
| `veh.bin_lorry` | 22/07 council livery, 05 compactor, 17 hi-vis rear bar. |
| `veh.bus` | 18 red with 07 roof band, 25 window strips along both flanks, 06 roof vents. |
| `veh.bicycle` | 05 frame, rider 29 top and 07 helmet modelled in. |
| `veh.mobility_scooter` | 26 body, rider 30 coat and 06 hair modelled in. |
| Parked variants | Same frames at the axis headings, with a random seeded paint slot. |

### 8.3 People and animals

See §7.2–7.3. Additional rules:

- **Reaction poses must be readable as silhouettes:** startle = arms up and body raised 1 px; fall = horizontal body, legs in the air; angry = fist raised above the head.
- **The dog walker's lead** is not a sprite: a 1 px runtime line in 18 postbox_red from the walker's hand to the dog's collar, with its +2, +2 drop shadow. It must read across both asphalt and slab.
- **Cats on walls and car roofs** use the same sprite; elevation is shown by a larger shadow offset (+3, +3) *(proposed)*.
- Nobody bleeds, nobody is flattened. The fall pose is comic: limbs out, a little 07 "dizzy" star from `fx.impact_star` above them.

### 8.4 Litter

- **One scale factor per sheet** when ingesting; the largest item is 14 px. Relative sizes between items must stay believable: a pizza box (13–14 px) dwarfs a crisp packet (9–10 px), which dwarfs a lolly stick (8 px).
- **Silhouette first:** each item is identifiable by outline alone. Drink can = capsule with silver ends; plastic bottle = longer capsule with a 1 px cap; glass bottle = 22/21 green with a neck; newspaper = 07/06 folded rectangle with 03 text lines; banana skin = 16/15 star with 08 tips.
- Items that fail legibility in ingest are redrawn by hand in the grid (the probe found the can and cigarette butts illegible at 12 px). `litter.cigarette_butts` ships as a **cluster** of 3–5 butts (07 with 17 filter tips).
- Litter wobble frames move the item by 1 px or rock one end; they never change its outline by more than 2 px.

### 8.5 Pickups and collectibles

- 12×12 icons on a 16×16 cell, bobbing 1 px over 2 frames.
- They sit on a **1 px ground halo ring** (alternating 16/07 with the bob) so they read as "for you", unlike litter. Litter never has a halo.
- Icons: `pwr.flask_of_tea` (26 flask, 07 cup), `pwr.bacon_butty` (12 bread, 18 bacon), `pwr.hi_vis` (17 vest with 07 bands), `pwr.super_suction` (05 nozzle, 28 swirl), `pwr.wrench` (05/06 spanner), `pwr.water_can` (22 can, 28 drop). `collect.golden_crisp` is a crisp packet in 15/16 with an `fx.sparkle` every 1.5 s. Lost Property items are drawn literally: false teeth 07/20, wallet 13, hard hat 15/14, cat collar 18 with a 16 bell, bucket and spade 26/18, shoe 19, mayor's chain 14/16.
- `collect.hard_hat` and `collect.golden_crisp` may use 15 because they are tiny pickups; the 15 reservation (§5.3) is about large areas.

### 8.6 Props

| Type | Look |
|---|---|
| Small grid props | Bollard (01 with 07 band), cone (17 with 07 bands), hydrant (18 with 06 cap), wheelie bin (22 or 01 lid, 26 recycling variant), A-board (07 with 03 lettering lines), litter bin (01 with 15 band), post box (18 with 00 slot), recycling box (26 with 22 lid). |
| Blender props | Bench (13 slats, 01 frame), bus shelter (05 frame, 28 glass panels, 26 roof), phone box (18 with 25 glass), tree canopy (21/22/23 clumps; canopy overhangs pavements), market stall (striped 18/07 or 26/07 awning), skip (17 or 22 steel with 01 interior). |
| Stacks | Lamp post 8 slices (01 post, 07 lamp head that writes the light mask at night); phone box, bollard, bins and trees 4–6 slices. Slice counts are `TBD (M0 spike)`. |

### 8.7 Stains and hazards (ground decals)

| ID | Look |
|---|---|
| `stain.gum` | Scattered 2–3 px 06/05 blobs, flattened discs |
| `stain.milkshake` | 20 splash with 07 core, a 1 px 13 cup outline nearby |
| `stain.oil` / `haz.oil_slick` | 01 pool with 30 and 29 iridescent sheen pixels on the NW side |
| `stain.chalk_art` | 07, 20, 27, 16, 31 child drawings: hopscotch grid, sun, a stick cat. Three variants. |
| `stain.splat` | 08/13 brown splat with radial flecks |
| `haz.puddle` | 25 body, 27 inner rim on the NW, 28 glints (2 px), irregular edge; rain adds `fx.rain_ripple` |
| `haz.pothole` | 00 core, 01 bowl, 03 broken rim, 04 rubble crumbs |
| `haz.speed_bump` | A tile-wide band of 03 with 07 or 15 chevrons |
| `haz.wet_leaves` | 14/11/13 leaves over a 01-darkened patch |
| `haz.broken_glass` | 28/07/27 shards, 2-frame glint |
| `haz.open_manhole` | 00 hole, 03 rim, lid 04 slid aside |

---

## 9. Environment: ground, grime, facades, roofs

### 9.1 Ground tiles

Procedural (seeded PCG64) Python generators in `tools/forge/forge/procedural/tiles.py`, parameters in `assets-src/procedural/tiles/*.json`. Only code guarantees seams: the Codex "seamless" tile failed the probe's seam test.

| Tile family | Indices | Rules |
|---|---|---|
| Asphalt | 02 base, 03 and 01 aggregate speckle (≤ 8% of pixels), occasional 01 patch repairs | Speckle is single pixels, never clumps larger than 2×1. 4 variants. |
| Lane markings | 07, worn to 06 | Centre dashes 2 px × 32 px with 32 px gaps (one tile on, one off) *(proposed)*. |
| Double yellows | 15 with 14 shade, 1 px each line, 2 px apart, 2 px from the kerb | |
| Kerbs | 06 top, 07 NW lip, 04 SE lip, 01 gutter line | **47-tile blob autotile**, generated by rule. |
| Pavement slabs | 05 with 04 joints on a 600 mm grid (~10 px), random 06 or 04 slab tints | |
| Zebra crossing | 07 bars 8 px wide (0.5 m) on 02, plus 07 zig-zag lines on approaches | |
| Give-way / SLOW | 07 triangles, 07 lettering drawn with Kerbside Bold scaled into the tile by the generator | |
| Drains and manholes | 01 grid slots with 00, 04 rim | |
| Grass | 22 base, 23 tufts, 21 shade near walls | |
| Cobbles | 04/05 rounded blocks with 03 gaps | Old Town and Civic Quarter |
| Tactile paving | 11 (or 06) with 1 px dot grid | At crossings |

**Seam rule:** a tile's wrap-edge difference must not exceed its interior difference (`forge lint`). **Calmness rule:** ground tiles have the lowest contrast in the game; their internal contrast (speckle versus base) stays within one ramp step, so actors, litter and grime sit on top of them clearly.

### 9.2 Grime and the clean reveal

Pillar 1 lives here. Each 32 px tile has an 8×8 grid of 4 px grime cells (see [TECHNICAL_DESIGN](TECHNICAL_DESIGN.md) for the mask).

- Grime is drawn by the ground shader as a **tileable overlay pattern per surface** (asphalt, slab, gutter), masked per 4 px cell. Patterns are procedural, mostly 08 soot_brown and 13 umber blotches with 01 flecks, covering about 60–80% of a dirty cell's pixels.
- **Contrast target:** at least 60% of the pixels in a fully dirty cell must differ from the clean tile by one or more ramp steps, and the dirty-versus-clean boundary must be visible at 1× from a full screen away.
- **Gutter grime** (the dense strip along kerbs, worth 2× points) is darker and denser: 08 and 01, about 90% coverage, in a 4–8 px band against the kerb.
- **The clean side is the reward:** clean tiles are authored slightly crisper than "average street" (fresh 07 markings, tidy speckle). A street fully cleaned should look newly resurfaced.
- Because grime cells are 4×4 px, the clean edge behind the brush is stepped in 4 px blocks. That chunkiness is intended; do not smooth it.

### 9.3 Building language

- **Massing:** buildings are boxes merged from 2 m cells, 1–6 storeys (landmarks up to 8). Only walls facing lower or open cells exist.
- **Roof edge:** every roof has a 1 px parapet or eave line: 06 or the roof's lit step on the NW edges, the roof's dark step on the SE edges. This edge is what separates a roof from the street below it at 1×.
- **Shadows** fall SE (§6.4). On overcast districts the shadow length should reduce; the multiplier is `TBD (M0 spike)`.

### 9.4 Facades

Procedural assembly of text-grid modules (`assets-src/sprites/facade/*.sprite.txt`), laid out by `assets-src/procedural/facades/*.json`.

- **Module = 32×40 px** (2 m × 1 storey). Typical set *(proposed)*: plain brick, sash window, bay window, terrace door, shopfront (two modules wide), drainpipe overlay, ground-floor rendered band, gable end.
- **Three ramp variants** per module as frame states: `lit` (N and W faces), `base`, `dark` (E and S faces). Modules are authored once at `base`; the forge derives `lit` and `dark` by shifting each index one step along its ramp, clamped at the ramp ends. Ink (00) and glass (25, 27) shift by special-case rules (glass gains a 28 glint on `lit` only).
- **Foreshortening rule:** facades are almost always seen squeezed horizontally (§4.2). So:
  - windows are bold 25 blocks (at least 8×12 px) with 06/07 frames and a 1 px sill;
  - every storey has a horizontal band (sill line or string course) that survives squeezing;
  - no brick-by-brick texture: suggest brick with a sparse 1 px 09 mortar pattern at 4 px spacing.
- **Pledge frontages** (`site.pledge_frontage`) show the green rosette (23/22 with a 07 centre) **twice**: on the door module and as a 6×6 doorstep decal on the pavement, because facades near the screen centre are nearly invisible.
- **Shop signs** are Codex goldens (`assets-src/ai/sign.*/`) with any lettering redrawn using the Kerbside fonts. All shop names are invented (e.g. "Frank's Plaice", "Muckleford Mini Mart"); no real brands.

### 9.5 Roofs

| Roof | Indices | Notes |
|---|---|---|
| Felt (flat) | 01/02 with 03 patches | Gasworks, flat-roof shops |
| Gravel (flat) | 04/05 speckle on 03 | Office and civic roofs |
| Slate (pitched) | 02/03 courses every 4 px, 25 tint on the lit slope | Old Town terraces |
| Corrugated | 05/06 stripes every 2 px | Industrial units, depot sheds |

- Roof textures are procedural at 16 px/m and align to the tile grid.
- **Low-frequency rule for tall buildings:** for buildings of 4+ storeys, roof speckle density halves and features are at least 2 px, because magnification (up to 1.91× at 6 storeys) turns single pixels into blobs.
- **Roof furniture** (AC units, vents, skylights, water tanks, chimneys, stair housings) comes from the Blender roofkit, rendered straight down under the same sun, then placed by a seeded forge script. At least 1 piece per 3 roof cells, so roofs never read as empty slabs *(proposed)*.
- **Landmark roofs** (Town Hall, Pier, Depot) are Codex goldens ingested at 16 px/m.

---

## 10. Animation: frame counts and timings

### 10.1 Principles

- **Animation is driven by sim ticks (60 Hz), not wall-clock time,** so replays and visual goldens (`?test=1&tick=<n>&freeze=1`) are deterministic. Timings below are given in ticks with milliseconds for reference.
- **Walk cycles are distance-driven:** a walk frame advances every *stride* metres travelled, so feet never skate at any speed.
- Idle loops get a **seeded phase offset per instance**, so a crowd never breathes in unison.
- Squash and stretch is **drawn into frames** where the size sheet gives frames for it (cat leap). Runtime quad scaling is allowed only for juice (M7) lasting at most 12 ticks (200 ms), because it creates mixels.
- Frame counts below are **locked** (from the size sheet). Timings are *proposed* and tuned in M3–M4; gameplay durations (fall-over time, how long Doris glares) belong to the [GDD](GDD.md) and override these if they differ.

### 10.2 Timing table

| Entity | State | Frames | Timing | Loop |
|---|---|---|---|---|
| `veh.sweeper` | `body` | 1 × 32 headings | — | — |
| `veh.sweeper_brush` | `brush` overlay | 4 × 32 headings | 3 ticks (50 ms) per frame at 100% RPM, scaled by 1/RPM; frozen on frame 0 below 10% RPM | loop |
| | beacon flash | swap slot toggle | 15 ticks on, 15 off (250 ms) while the brush is down or dumping; off in transit *(proposed: a visible cue of brush state)* | loop |
| | `dented` | 1 × 32 headings | Replaces `body` below 40 HP | — |
| Other vehicles | `body` | 1 × 32 | — | — |
| `veh.police` | lightbar | swap 0 ↔ 1 | 8 ticks each when witnessing a penalty | loop |
| Humans | `walk` | 4 | 1 frame per stride: 0.30 m adults, 0.18 m Doris, 0.15 m old man, 0.55 m jogger, 0.22 m kids | loop |
| | `idle` | 2 | 36 ticks each (600 ms), seeded phase | loop |
| | `startle` | 2 | frame 0 for 4 ticks (the hop), frame 1 held while sidestepping | once |
| | `fall` | 3 | 5 ticks each, hold frame 2 for 72 ticks (1.2 s), then get up by playing frames 1, 0 at 5 ticks | once |
| | `angry` | 2 | 9 ticks each, 6 alternations (fist shake ≈ 0.9 s). Doris's glare holds frame 0. | once / hold |
| `npc.kid_skateboard` | rolling | `idle` frames | Rolls on `idle`; pushes with `walk` 0–1 every 72 ticks | — |
| `npc.cat` | `walk` | 4 | 1 frame per 0.12 m | loop |
| | `sit` | 2 | frame 0 for 90 ticks, frame 1 (tail flick / groom) for 12 | loop |
| | `dart` | 2 | 3 ticks each | loop |
| | `leap` | 3 | squash 4, stretch 6, land 6 ticks | once |
| `npc.dog_*` | `walk` | 4 | 1 frame per 0.35 m (7 m/s → 20 fps) | loop |
| | `sit` | 2 | 30 ticks each | loop |
| | `bark` | 2 | 6 ticks each; `sfx.dog_bark` on frame 1 | loop while barking |
| `npc.pigeon` | `peck` | 2 | frame 0 held 12–30 ticks (seeded), frame 1 for 6 | loop |
| | `fly` | 3 | 4 ticks each | loop |
| `npc.seagull` | `walk` | 2 | 10 ticks each | loop |
| | `fly` | 3 | glide on frame 1; flap 0-1-2 at 5 ticks every 60 ticks | loop |
| Litter | `idle` | 1 | — | — |
| | `wobble` | 2 | 12 ticks each while in the suction zone, in wind or during a gust | loop |
| Pickups | `bob` | 2 | 24 ticks each (400 ms) | loop |
| `collect.golden_crisp` | `bob` + sparkle | 2 + fx | sparkle every 90 ticks | loop |

### 10.3 Pedestrian reaction flow

The frame states map to the reaction model in [ENTITY_CATALOG](ENTITY_CATALOG.md) §3.4:

```mermaid
stateDiagram-v2
    [*] --> walk
    walk --> idle: stops (door, kerb, glare)
    idle --> walk
    walk --> startle: Bessie in awareness radius, or horn
    startle --> walk: sidestep done
    walk --> fall: hit by Bessie
    fall --> fall_hold: frame 2 held 1.2 s
    fall_hold --> getup: frames 1, 0 reversed
    getup --> angry: fist shake
    angry --> walk: resumes route
```

---

## 11. VFX

VFX are **procedural Python frame generators** (`assets-src/procedural/fx/*.json`, 4–8 frames, packed into the `fx` atlas) plus **runtime particles** (1×1 or 2×2 px quads in palette colours). Looping effects must loop exactly; the generator's last frame must flow into its first.

Style rules:

- **Chunky, few, short.** Puffs are made of 2–4 px clumps, not single-pixel mist. Most one-shots finish in under 0.5 s.
- **Palette-strict and outline-free.** VFX never have ink outlines (they are light, air and water). They may use ink for debris only.
- **Readable over both asphalt and slab:** dust uses 06/05 (bright on asphalt, still visible on slab thanks to the 04 core).
- **Never obscure Bessie's front.** Dust and spray spawn at the brushes and drift *backwards and outwards*.

| ID *(proposed)* | Cell | Frames | Timing | Colours | Trigger |
|---|---|---|---|---|---|
| `fx.dust_puff` | 16×16 | 6 | 5 ticks, once | 06, 05, 04 | Brush down on dusty tiles without spray; one per brush every 7 ticks |
| `fx.spray_mist` | 16×16 | 4 | 4 ticks, loop | 28, 27, 07 | Water spray: 3–6 instances across the 2.6 m cone |
| `fx.sparkle` | 16×16 | 4 | 4 ticks, once | 07, 16 | Clean Sweep frontage, golden crisp, pickup collected |
| `fx.splash` | 24×24 | 6 | 4 ticks, once | 27, 28, 07 | Puddle crossed above 3 m/s |
| `fx.leaf_swirl` | 24×24 | 8 | 5 ticks, loop | 14, 11, 13, 22 | Thursday leaf fall; `haz.wind_gust` |
| `fx.splat` | 16×16 | 4 | 4 ticks, once | 08, 13 | Brush up over `litter.dog_mess` (leaves `stain.splat`) |
| `fx.glass_smash` | 16×16 | 5 | 3 ticks, once | 28, 07, 27 | Flung glass bottle (leaves `haz.broken_glass`) |
| `fx.impact_star` | 16×16 | 4 | 3 ticks, once | 16, 07, 17 | Collisions; dizzy star over fallen pedestrians |
| `fx.cough` | 8×8 | 4 | 7 ticks, once | 06, 07 | Pedestrians coughing in dust |
| `fx.rain_ripple` | 8×8 | 4 | 4 ticks, once | 28, 27 | Wednesday rain, random positions on visible ground |
| `fx.engine_smoke` | 16×16 | 6 | 6 ticks, once | 03, 04, 05 | Bessie below 20 HP |
| `fx.skid_mark` | 32×32 decal | 1 | Persistent; fades by one ramp step per 10 s, then removed | 01 | Hard braking, banana or oil spin-out |
| `fx.anger_mark` | 8×8 | 2 | 9 ticks, loop | 18 | Over angry pedestrians (comic "cross" vein) |

**Runtime particles:** fling debris (the item's own colours, on its kinematic arc), water droplets (28), hopper dump spill (08, 13), kerb dust for Kerb Hugger (06). Budget and pooling are in [TECHNICAL_DESIGN](TECHNICAL_DESIGN.md).

**Score popups** are not sprites: they are Kerbside text (§12.5) spawned at the pickup, rising 12 px over 36 ticks with ease-out, holding 12 ticks, then blinking out (3 × 3 ticks). Colour by combo tier:

| Chain multiplier | Popup | Colour |
|---|---|---|
| ×1 | points only | 07 |
| ×2 | "TIDY!" | 23 |
| ×3 | "SPOTLESS!" | 28 |
| ×4 | "IMMACULATE!" | 16 |
| ×5 | "SWEEPING BEAUTY!" | cycles 16 → 17 → 20 → 28 → 23 every 5 ticks |
| Penalty | "−250" etc. | 18 |

---

## 12. UI art and pixel fonts

### 12.1 Style

Municipal and chunky: **council-blue panels with chalk text and hi-vis highlights**, as if the HUD were the dashboard of a council vehicle and the menus were depot noticeboards. The UI renders in the same 480×270 internal pixel space as the game (a second orthographic scene composited before the palette pass), so UI art obeys the palette and pixel grid exactly. Nothing in the UI is scaled by non-integer factors.

### 12.2 HUD layout (480×270 reference, anchored to corners for other widths)

[GDD §15.2](GDD.md#152-hud-layout) owns which elements exist, where they sit and how they behave (thresholds included). This section owns their pixel positions and colours, and must contain every GDD element.

```text
x=4                                                                   x=W-4
┌──────────────────────────────────────────────────────────────────────────┐ y=4
│ 3:42 (Bold)          012340 (Bold) x3 SPOTLESS!    [■][■][□][□][□]       │ timer | score + combo | complaints
│ PUDDLE LANE          ▬▬▬▬▬▬ (chain timer)                                │ y=16
│ TIDY ▕██████|███|█|  ▏ 47%                                               │ y=26 Tidy % bar, ticks 60/80/92
│                                                                          │
│                              playfield                                   │
│                                                                          │
│ ┌PAM────────────────────────┐                                            │ radio panel (1 line)
│ └───────────────────────────┘                                ┌────────┐  │
│ [hopper] ██████░░ 72%  [drop] ████░░░░  [spanner] ██████░░    │minimap │  │ 64x64
│ [■■■■/////····] 9 mph  [brush ▼]  [tea 0:11]                  └────────┘  │ Brush-o-meter 64x8, brush state, power-up
└──────────────────────────────────────────────────────────────────────────┘ y=266
```

| Element | Position *(proposed)* | Art |
|---|---|---|
| Shift timer | top-left (4, 4) | Kerbside Bold 8×8 outlined, 07; turns 16 lemon under 60 s; flashes 18 every 30 ticks under 30 s |
| District + Tidy % | (4, 16) name; (4, 26) bar | District name in Kerbside 5×7, 07. Tidy % bar 64×4: fill 23 on 03, 07 tick marks at 60/80/92, value in 5×7 beside it |
| Score | top-centre (centred on W/2, y = 4) | Kerbside Bold 8×8 outlined, 07 |
| Combo | beside the score, same baseline | Multiplier and tier word in Kerbside 5×7 outlined, tier colour (§11); chain-timer bar 48×2 in 17 beneath the score |
| Complaints | top-right, 5 × 16×16 slots, 2 px gaps | Empty: 06 outline form on 25. Filled: 18 rubber "COMPLAINT" stamp that slams in over 3 frames |
| Radio panel | bottom-left, above the gauges (moves to the opposite corner when Bessie drives toward it) | `ui.panel_council`, one line of 5×7 07 text, Pam's name tab in 17 |
| Hopper gauge | bottom-left, 16×16 icon + 64×6 bar | Fill 15, 17 at ≥ 80%, flashing 18 when full |
| Water gauge | beside the hopper gauge | Fill 27 with 28 top pixel row; hydrant icon pulses below 20% |
| Dignity (HP) | beside the water gauge, 16×16 spanner icon + 64×6 bar | 23 above 60 HP, 15 from 40 to 60 HP, 18 below 40 HP (the dented-sprite threshold) |
| Brush-o-meter | bottom-left, below the gauges, 64×8 | Three patterned zones so it never relies on colour alone: clean (solid 23), fling (hatched 17/03), transit (dotted 26/03). Needle 07 with ink outline; speed in 5×7 beside it (mph by default) |
| Brush state | right of the Brush-o-meter, 16×16 | ▲ raised / ▼ lowered icon, with a 15 spin-up ring |
| Power-up | right of the brush state, 16×16 | Power-up icon plus countdown in 5×7 |
| Minimap | bottom-right, 64×64 *(proposed)*, rendered at runtime from map data | Roads 03, pavement 05, buildings 01, grime 08, clean frontages 23, dirty 18, Bessie arrow 15 with ink outline |

Safe margin: 4 px from every edge at all widths (432–640).

### 12.3 Panels, buttons and icons

- **9-slice panels:** 24×24 source, 8 px corners. Three styles *(proposed IDs)*: `ui.panel_council` (26 fill, 07 inner border, 00 outer, 05 corner bolts), `ui.panel_paper` (07 fill, 06 shade, 00 border; notices and the Mercury), `ui.panel_dark` (01 fill, 03 border; pause overlay).
- **Buttons:** four states, each pixel-exact: normal (26 fill), focus (17 border with a `→` cursor glyph), pressed (25 fill, content shifted 1 px down-right), disabled (03 fill, 04 text). Focus must be visible without colour alone (the cursor glyph), for accessibility.
- **HUD icons** (16×16 grids, `assets-src/sprites/ui/`): hopper, water drop, spanner, clock, complaint form, £ coin, star (filled and empty), brush up and down, horn, each power-up. Icons use ≤ 6 colours, an ink outline and a 1 px lit edge on the NW.

### 12.4 Screens

| Screen | Art notes |
|---|---|
| Title | `art.title`: Codex key art at full resolution → crop → pixelize at the detected pseudo-pixel period (about 3–4×, because the prompt asks for art at game resolution; see [ASSET_PIPELINE §9.2](ASSET_PIPELINE.md#92-forge-build-per-technique)) → palette map (Bayer allowed) → 480×270. Logo text "Street Sweeper Pro" drawn with Kerbside Bold at 2× integer scale over it, never generated. |
| Shift intro card | `ui.panel_council` with a 64×64 portrait (`portrait.big_pam`, 2 expressions: briefing and stern) *(other portrait IDs, proposed: `portrait.spotless_sid`, `portrait.doris` and `portrait.inspector`, matching [GDD §4.2](GDD.md#42-cast))* |
| Week map | Stylised town map on paper (07/06) with district pins; locked districts in 04 |
| The Muckleford Mercury (tally) | Front page on `ui.panel_paper`: masthead in Kerbside Bold (00 on 07), headline in Bold at 2×, columns of 5×7 body text, district map with frontages in 23 or 18, stars and £ in 15/16. Newspaper photo art from Codex goldens (`art.*`), Bayer-dithered like halftone. |
| SACKED! / TOWED! | Rubber-stamp 18 lettering slammed across the Mercury front page at a slight 2-step pixel tilt (drawn, not rotated) |
| Workshop | Pegboard backdrop (13 with 08 holes), upgrade icons as 16×16 grids |

### 12.5 Pixel fonts

Code-defined bitmap fonts written as text-grid glyphs in `assets-src/fonts/`. **Never use AI image generation for fonts.**

| Font | File | Glyph / cell | Character set |
|---|---|---|---|
| **Kerbside 5×7** (HUD, body) | `kerbside5x7.glyphs.txt` | 5×7 in a 6×8 cell | ASCII 32–126 plus £ ★ → ← ↑ ↓ |
| **Kerbside Bold 8×8** (titles, headlines) | `kerbsidebold8x8.glyphs.txt` | 8×8 in a 9×10 cell | same |

Design rules *(proposed, locked in M4)*:

- **Kerbside 5×7:** cap height 7, x-height 5, 1 px stroke. Descender letters (g, j, p, q, y) raise their bowls two rows so the tail ends on row 7 (the classic dot-matrix compromise), keeping everything inside 5×7. Default advance 6; narrow glyphs (i, l, !, .) use advance 2–4 via the metrics JSON. Line height 8 for HUD, 9 for paragraphs.
- **Kerbside Bold 8×8:** 2 px vertical stems, 1 px horizontals, rounded corners cut by one pixel; designed for capitals (lowercase present but secondary). Advance 9.
- **Outlined variants** (generated by the forge): a 1 px ink outline, **8-connected** for text (thin strokes need diagonal coverage), growing each glyph by 1 px on every side, with advance +1 so neighbouring outlines merge.
- **Kerning pairs** in the metrics JSON for at least: `AV AW AT AY LT LY PA TA VA WA YA Fo To Te Ty r. r, ££` *(starter set)*.
- £ must sit on the baseline with a cap-height ascender; ★ fills the full 7 rows.

Specimen glyphs (illustrative; the exact file grammar is in [ASSET_PIPELINE](ASSET_PIPELINE.md)):

```text
A (5x7)   g (5x7)   £ (5x7)   ★ (5x7)
.###.     .....     ..##.     ..#..
#...#     .####     .#..#     .###.
#...#     #...#     .#...     #####
#####     #...#     ####.     .###.
#...#     .####     .#...     .###.
#...#     ....#     .#...     .#.#.
#...#     .###.     #####     #...#
```

The `hud_specimen` visual-test scene renders every glyph of every font and variant, on 02, 05, 07 and 26 backgrounds; it is a committed visual golden.

---

## 13. Night, weather and time of day

| Condition | District | Look |
|---|---|---|
| Dawn → morning | Puddle Lane | Clear; warm and calm. Long SE shadows *(shadow length tuning `TBD (M0 spike)`)*. |
| Late morning | High Street | Neutral, clear, busiest colour. |
| Overcast + rain | Gasworks Estate | Reduced shadows (`TBD (M0 spike)`), many puddles, `fx.rain_ripple` across the ground, 28 glints on wet surfaces. No full-screen tint: the palette pass forbids blends. |
| Afternoon, wind + leaf fall | Conker Hill | `fx.leaf_swirl`, leaf litter, wet-leaf hazards; foliage at its most saturated. |
| Golden hour, gusts | The Promenade | Long shadows, warm sea glints (16 on 27). |
| **Night** | Kebab Mile | Night remap everywhere except the light mask. |
| Morning, clear | Civic Quarter | Crisp, clean civic stone; the grime contrast must still read on 06/07. |

**Night rules (Kebab Mile):**

- The light mask (G channel) is written by street lamp pools, Bessie's headlights, vehicle headlights and tail lights, lit shop signs and a seeded subset of facade windows. Pixels in light keep day colours; the rest go through `night[32]`.
- **Light pools are hard-edged pixel shapes** (stepped circles about 10 m across (radius ≈ 5 m, final value `TBD (M0 spike)`) under lamps, cones 8 m long for headlights), not gradients. Ordered dither on pool edges is allowed only if the M0 night tuning approves it as a "transition"; otherwise edges stay hard.
- Lit windows show interior 16 lemon with an 11 curtain stripe, and stay lit through the night remap.
- Bessie's beacon (17/16) always writes the light mask, so it pulses even in the dark.
- The `night_kebab_mile` visual scene is the golden for this look.

---

## 14. The AI-authored asset pipeline, from the art side

This section covers what the art author does and sees. Commands, schemas and gotchas live in [ASSET_PIPELINE](ASSET_PIPELINE.md); the decision record is [ADR 0002](adr/0002-ai-authored-asset-pipeline.md).

### 14.1 Technique per class, in one line each

| Class | Technique | Why (art view) |
|---|---|---|
| Ground tiles, roofs, stains, grime, VFX | Procedural Python | Seams, loops and variety need code. |
| Facades | Text-grid modules + procedural assembly | Exact pixel control of windows and bands. |
| Vehicles, volumetric props, roof furniture | Blender, straight down, 4× then block-downscaled | 32 consistent rotations under one sun; image models cannot. |
| Humans | Codex key-pose sheet (reference-locked to `ref.people_style`) → ingest → grid; Claude authors the remaining frames | Codex gives style and character; the grid holds the real animation. |
| Animals, small props, pickups, UI icons | Text grids written directly | At ≤ 20 px, hand-placed pixels beat downscales. |
| Litter | Codex transparent 4×2 sheets → ingest (one scale per sheet) → grids, hand-fixed | The probe's best AI result. |
| Decals, shop signs, landmark roofs | Codex goldens → ingest | One-offs where variety hides inconsistency. |
| Title, key art, portraits, Mercury art | Codex at full resolution → `ai-art` downscale | Image models are strongest at large one-offs. |
| Fonts | Text-grid glyphs | Never image generation. |
| Concept / mood boards | Codex (Cursor for A/B), **reference only, never shipped** | Guides STYLE.md. |

### 14.2 Flow

```mermaid
flowchart LR
    subgraph SRC["assets-src (committed)"]
        GRID["Text grids<br/>sprites/**/*.sprite.txt"]
        PROC["Procedural params<br/>procedural/**/*.json"]
        BPY["bpy scripts<br/>blender/**/*.py"]
        AIP["AI prompt.md + meta.json"]
    end
    BPY -->|"assets:blender (local)"| REND["rendered/ID/ h00..h31.png<br/>(golden)"]
    AIP -->|"gen:ai (local), Claude picks"| GOLD["ai/ID/golden.png<br/>(golden)"]
    GOLD -->|"assets:ingest"| GRID
    GOLD -->|"ai-art"| BUILD
    GRID --> BUILD["forge build"]
    PROC --> BUILD
    REND --> BUILD
    BUILD --> ATL["5 atlases + JSON<br/>src/gen/assets.ts"]
    ATL --> LINT["assets:lint"]
    ATL --> SHEETS["assets:sheets + zoo screenshot"]
    SHEETS --> REVIEW{"Claude reviews<br/>with Read"}
    REVIEW -->|"fix pixels"| GRID
    REVIEW -->|"regenerate"| AIP
    REVIEW -->|"fix model"| BPY
    REVIEW -->|"accept"| COMMIT["Commit sources + outputs"]
```

### 14.3 The text-grid sprite format

A `*.sprite.txt` file is the source of truth for every grid asset (and for every ingested asset after ingest). Header: `id:`, `cell: WxH`, `palette: kerbside32`, then the key map. Then one block per frame, `frame <state>:<dir>:<n>`, followed by H rows of W characters. Optional `mirror <dir> from <dir>` lines. Exact grammar: [ASSET_PIPELINE](ASSET_PIPELINE.md).

**Default key** (used unless the header overrides it):

| Char | Idx | Char | Idx | Char | Idx | Char | Idx |
|---|---|---|---|---|---|---|---|
| `.` | transparent | `8` | 08 soot_brown | `g` | 16 lemon | `o` | 24 lime |
| `0` | 00 ink | `9` | 09 brick_dk | `h` | 17 hivis_orange | `p` | 25 navy |
| `1` | 01 tar | `a` | 10 brick | `i` | 18 postbox_red | `q` | 26 council_blue |
| `2` | 02 asphalt | `b` | 11 terracotta | `j` | 19 maroon | `r` | 27 sky |
| `3` | 03 asphalt_lt | `c` | 12 skin_lt | `k` | 20 bubblegum | `s` | 28 spray |
| `4` | 04 slab_dk | `d` | 13 umber | `l` | 21 hedge_dk | `t` | 29 teal |
| `5` | 05 slab | `e` | 14 ochre | `m` | 22 grass | `u` | 30 plum |
| `6` | 06 kerb | `f` | 15 sweeper_yellow | `n` | 23 grass_lt | `v` | 31 lavender |
| `7` | 07 chalk | | | | | | |

**Example: `assets-src/sprites/litter/drink_can.sprite.txt`** (a red drink can lying on its side, no branding; the forge generates the `h08`, `h16` and `h24` rotations from these `h00` frames):

```text
id: litter.drink_can
cell: 16x16
palette: kerbside32

frame idle:h00:0
................
................
................
................
................
...0000000000...
..06hhhh77hh40..
..05iiii77ii40..
..05iiii66ii40..
..04jjjj55jj40..
...0000000000...
................
................
................
................
................

frame wobble:h00:0
................
................
................
................
................
...0000000000...
..06hhh77hhh40..
..05iii77iii40..
..05iii66iii40..
..04jjj55jjj40..
...0000000000...
................
................
................
................
................

frame wobble:h00:1
................
................
................
................
................
...0000000000...
..06hhhhh77h40..
..05iiiii77i40..
..05iiiii66i40..
..04jjjjj55j40..
...0000000000...
................
................
................
................
................
```

What to notice:

- The visible body is 12×6 px including its ink outline, inside the 8–14 px litter range.
- Neutral ramp steps used: 04, 05, 06, 07 (4 steps; the 00 outline does not count). Red ramp: 17, 18, 19 (3 steps). It passes the ramp lint.
- Shading is **top-lit and centred** (17 highlight on the upper row, 19 shade on the lower), so the 90° rotations stay plausible.
- The wobble frames roll the can by moving the white label band ±1 px; the silhouette never changes.
- No drop shadow is drawn: the engine adds it at +2, +2.

**Mirrors, from an 8-direction animal** (`assets-src/sprites/npc/cat.sprite.txt`, header only):

```text
id: npc.cat
cell: 16x16
palette: kerbside32
mirror se from sw
mirror e from w
mirror ne from nw
```

### 14.4 Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Asset ID | `<class>.<snake_name>`. Classes: `veh`, `npc`, `litter`, `stain`, `prop`, `haz`, `pwr`, `collect`, `upg`, `site`, `tile`, `roof`, `facade`, `fx`, `ui`, `font`, `art`, `portrait`, `decal`, `sign`, `concept`, `ref`, `sfx`, `mus`, `jng`, `amb` | `npc.old_woman` |
| Frame ID | `<asset-id>:<state>:<dir>:<n>`. Dir is `h00`–`h31` for vehicles, or `s, sw, w, nw, n, ne, e, se` for actors, or `-`. | `veh.sweeper:body:h07:0`, `npc.cat:dart:w:1` |
| Files | snake_case. Sprite files are named after the asset ID minus its class. | `assets-src/sprites/npc/old_woman.sprite.txt` |
| AI folders | full asset ID | `assets-src/ai/litter.sheet_01/` |

**State vocabulary** (use these words, nothing else; new states are added here and in the manifest in the same PR):

| Class | States | Dirs |
|---|---|---|
| `veh.sweeper` | `body`, `dented` | `h00`–`h31` |
| `veh.sweeper_brush` | `brush` | `h00`–`h31` |
| Other `veh.*` | `body` | `h00`–`h31` |
| Humans | `walk`, `idle`, `startle`, `fall`, `angry` | 8 |
| `npc.cat` | `walk`, `sit`, `dart`, `leap` | 8 |
| `npc.dog_*` | `walk`, `sit`, `bark` | 8 |
| `npc.pigeon` | `peck`, `fly` | `s`, `w`, `n`, `e` |
| `npc.seagull` | `walk`, `fly` | `s`, `w`, `n`, `e` |
| `litter.*` | `idle`, `wobble` | `h00`, `h08`, `h16`, `h24` |
| `pwr.*`, `collect.*` | `bob` | `-` |
| `prop.*` | `flat`, or `slice` with `n` = slice index from the ground up | `-` |
| `facade.*` | `lit`, `base`, `dark` | `-` |
| `fx.*` | `play` | `-` |
| `tile.*`, `roof.*`, `stain.*`, `haz.*` | `v` (variant `n`), or `blob` (autotile index `n`, 0–46) for kerbs *(proposed)* | `-` |

### 14.5 AI generation from the art side

- **Every prompt starts with the shared preamble** `assets-src/ai/_style_preamble.md` (versioned; the version is stamped into `prompt.md` and `meta.json`). It specifies: overhead view, chunky pixel art with characters about 20 pixels tall (head to feet), so the ingested figure fits the ≤ 18×22 body in its 24×24 cell; 1 px dark outline; light from the top-left; flat colours from the attached palette (the hex list is included); transparent background; no text unless asked; no logos or brands.
- **Describe qualities, never games or brands.** "A cheerful elderly British woman in a purple coat and lilac headscarf pulling a red tartan shopping trolley" is fine. Any trademark, any "in the style of <game>", any real shop or council name is forbidden.
- **Humans are always reference-locked** with `-i assets-src/ai/ref.people_style/golden.png`, and request a **key-pose sheet**: one row per authored direction (S, SW, W, NW, N), poses idle, walk contact, startle, fall, angry. Codex walk frames are not real animation (the probe's handbag swapped hands), so treat the sheet as pose and costume reference; the grid holds the animation.
- **Litter sheets** are 4×2 grids of 8 items on a transparent background, 2:1 aspect, one item per cell, centred, with similar real-world scale across the sheet.
- **Accepting a golden** (`npm run gen:ai -- <id> --candidates N`, then `--accept <n>`) is an art decision: open every candidate with Read, write the reason for the choice in `acceptance_notes`, and reject anything that breaks camera angle, light direction or the palette's mood. **Cursor outputs may never become sprite goldens.**

**After ingest, the grid is the truth.** What Claude typically fixes by hand in an ingested grid:

| Problem | Fix |
|---|---|
| Ragged or broken outline | Redraw a clean 1 px 4-connected ink border; let the build's outline completion confirm it. |
| Noisy shading (more than 4 ramp steps, scattered pixels) | Reduce to lit, base, dark per material; delete orphan pixels. |
| Left/right-asymmetric highlights on creatures | Re-shade top-lit (§6.2) so mirrors stay valid. |
| Inconsistent heights between directions | Align the head row and the feet row across all directions of a state. |
| Props swapping hands between frames | Fix in the grid; accept the mirror swap between W and E. |
| Off-palette intent (e.g. a beige that snapped to a muddy brown) | Choose the intended Kerbside-32 index by hand. |
| Illegible small items | Redraw from scratch in the grid (as for the can and butts). |

### 14.6 Atlas packing

- **Five atlases**, each at most 2048×2048, packed by a deterministic maxrects packer (inputs sorted by area descending, then by id): `world` (tiles, roofs, facades, stains), `actors` (vehicles, people, animals), `items` (litter, props, pickups), `ui` (HUD, icons, panels, fonts), `fx`.
- **Trimming** *(proposed, locked in M4)*: each frame is trimmed to its opaque bounding box (outline included) before packing, and the pivot is stored relative to the trimmed rect (`px`, `py` in the atlas JSON). Trimming roughly halves the `actors` footprint (most vehicle headings fill well under their 64×64 cell) and is what keeps 192 Bessie frames, 11 other vehicle types and every pedestrian inside one 2048² atlas.
- **Padding:** 1 px transparent gutter around every actor, item and fx frame (2 px between neighbours), so the speed-zoom (non-1:1 sampling) never bleeds a neighbour's pixels. **Ground tiles and facade modules are extruded** by 1 px (edge pixels duplicated) instead, so tiling surfaces never show transparent seams.
- **Budget check:** `forge build` reports each atlas's fill ratio. Above 85% on any atlas, split classes before adding assets; never grow beyond 2048².

---

## 15. Self-review: contact sheets and the quality checklist

Claude is both artist and art director, so review is a mandatory, written step, not a feeling. **No new golden or asset batch is accepted until Claude has opened the contact sheets and the zoo screenshot with the Read tool.**

### 15.1 Review procedure

1. `npm run assets` then `npm run assets:lint`. Lint must be clean before visual review: no off-palette, semi-transparent, missing-outline, orphan-pixel, ramp-step, size or frame-count failures.
2. `npm run assets:sheets` → open `build/sheets/<atlas>.png` with Read for each atlas touched. Sheets are 4×, labelled, on light (`#c3c1c0`) and dark (`#24222a`) backgrounds, with a palette strip and Bessie `h00` for scale.
3. Open the **asset zoo** (`?test=1&scene=zoo`) screenshot at 1× internal resolution: this is how the asset really looks, under the palette pass, shadow mask and sub-pixel camera.
4. For anything animated, check the frames in sequence on the sheet (they are laid out left to right per state), and step the zoo with `&tick=<n>&freeze=1` at a few tick values to see in-engine poses.
5. For readability, make a **1× greyscale check** of the zoo screenshot (a throwaway Pillow conversion into `build/tmp/`, run with `uv run --project tools/forge python`) and open it: the asset must still separate from asphalt and slab by value alone.
6. Run `npm run test:visual`. A failed diff writes expected, actual and diff PNGs: open all three with Read. Approve with `npm run test:visual:update` only when the change is intended.
7. Record the review in the PR: which sheets were opened, which checklist items needed fixes, and what was changed.

### 15.2 The checklist

An asset passes only if every applicable item passes.

**Palette and pixels**

- [ ] Lint clean (Kerbside-32 only, binary alpha, ≤ 4 steps per ramp, no orphans on actors).
- [ ] No reserved colour misuse: 15 only on Bessie, double yellows, depot bays, small accents (§5.3).
- [ ] Swap-key discipline: swapped families only use their key indices for the swapped parts (§5.6); check all 8 slots on the sheet for cars and shoppers.

**Scale and framing**

- [ ] Visible body within the size-sheet limit, including outline; vehicles checked on the **diagonal** headings.
- [ ] Scale factor matches §3.2 (e.g. litter not bigger than a person's head; cat smaller than a dog).
- [ ] Pivot correct: feet centre for creatures, body centre for vehicles; no jitter of the pivot between frames of a state.

**Silhouette and readability**

- [ ] Identifiable as a **solid ink silhouette at 1×** (cover the colours mentally, or flood-fill in a throwaway check): Doris is a hunch and a trolley, the cat is a cat.
- [ ] Readable on asphalt (02), slab (05) and grass (22), and under the night remap if it appears at night.
- [ ] Contrast: dominant colour at least 0.12 L from 02 and 05, or a contrasting accent plus outline.
- [ ] Bessie is still the most eye-catching object in a zoo screenshot of the district's set.

**Light and outline**

- [ ] 1 px ink outline, complete and 4-connected; no double outlines.
- [ ] Highlights on the NW for vehicles and props; top-lit and symmetric for creatures and litter.
- [ ] No painted shadows, no gradients, no dithering (except `ai-art`).

**Perspective**

- [ ] Vehicles straight overhead; creatures in the high three-quarter view matching `ref.people_style`.
- [ ] Facades read when squeezed to 25% width (windows and bands survive); roofs on tall buildings use the low-frequency rule.
- [ ] Sprite-stack slices line up vertically when the camera is centred (no "wobbling" stack).

**Animation**

- [ ] Correct frame counts per state and direction (manifest and §7.1).
- [ ] Loops are seamless (last frame flows into first); walk cycles alternate feet; head height stays constant within a cycle (±1 px bob allowed on contact frames).
- [ ] Mirrored directions look right (no backwards text, no asymmetric light); accepted mirror artefacts (a handbag changing hands) noted.
- [ ] Reaction poses read as silhouettes: startle, fall and angry are distinguishable from walk at 1×.

**Tiles and VFX**

- [ ] Tiles seamless in a 3×3 repeat on the sheet; no visible repetition grid across 4×4 tiles with variants.
- [ ] Grime contrast target met (§9.2); clean edge visible from across the screen.
- [ ] VFX loop exactly, never cover Bessie's front, and finish in the stated tick count.

**Provenance and hygiene**

- [ ] AI folders complete: `prompt.md` with preamble version, `meta.json`, `golden.png` hash match; candidates left in `build/ai-candidates/`.
- [ ] Blender `render.json` script hash matches the current script (no "re-render needed" warning).
- [ ] No text, logos, brands or trademarks in the asset, its prompt or its name; any lettering is drawn with Kerbside fonts and spelt in British English.
- [ ] Every frame ID referenced by code exists in `src/gen/assets.ts` (the compile catches this).

---

## 16. Do and don't

| Do | Don't |
|---|---|
| Keep ground tiles calm so actors, litter and grime sit on top. | Add busy, high-contrast texture to asphalt or slabs. |
| Make Bessie the brightest object in every scene. | Give traffic or props large areas of 15 sweeper_yellow. |
| Use three values per material: lit, base, dark. | Pillow-shade, gradient or dither sprites. |
| Draw creatures top-lit so mirrors work. | Put a strong NW edge highlight on a mirrored character. |
| Let the camera do the lean (real boxes, sprite stacks). | Paint lean or fake 3D sides into flat actor sprites. |
| Read facades as bands and bold window blocks. | Draw brick-by-brick detail that vanishes when foreshortened. |
| Exaggerate small things to gameplay scale (§3.2). | Draw litter at true scale (a 2 px can). |
| Redraw illegible ingested items by hand in the grid. | Re-roll the image model hoping a 12 px can becomes legible. |
| Describe the qualities you want in prompts. | Name a game, brand, studio or real shop in a prompt or asset. |
| Build titles and logos from the Kerbside fonts. | Ship AI-generated lettering or AI-generated fonts. |
| Keep shadows as masks through the palette remap. | Paint shadows into sprites or blend translucent black. |
| Open the sheets and the zoo with Read before accepting. | Accept an asset because the lint passed. |

---

## 17. Open items

| Item | Decided by | Notes |
|---|---|---|
| Exact `shadow[32]` and `night[32]` tables | `TBD (M0 spike)` | Intent in §5.7. |
| Vehicle tilt (0° vs ≤ 8°) | `TBD (M0 spike)` | Default 0°. |
| Character view angle and proportions | M0 (`ref.people_style` golden) | High three-quarter assumed (§4.4). |
| Speed zoom on or off | `TBD (M0 spike)` | Art reviews always at 1:1 regardless. |
| Shadow length multiplier for overcast and golden hour | `TBD (M0 spike)` | §9.3, §13. |
| Sprite-stack slice counts per prop, and which slices cast shadows | `TBD (M0 spike)` | §6.4, §8.6. |
| Swap-slot allocation and key indices | M4 | Proposed in §5.6. |
| Whether ramp lint ignores index 00 used as outline | M4 (forge lint) | Assumed in §5.4. |
| Atlas trimming and padding | M4 (forge pack) | Proposed in §14.6. |
| Animation timings | M3–M4 | Proposed in §10.2; gameplay timings in the [GDD](GDD.md) win. |
| VFX IDs and HUD layout details | M2 (HUD), M4 (art) | Proposed in §11 and §12.2. |
| Font metrics, descender treatment and kerning set | M4 | Proposed in §12.5. |
