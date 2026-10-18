---
id: SSP-009
title: "Implement forge build for grid and blender techniques with outline and byte-stable PNGs"
milestone: M0
status: done
type: feature
estimate: L
labels: [type:feature, area:tooling, area:assets, area:test, size:L, vertical-slice]
depends_on: [SSP-005, SSP-008]
blocks: [SSP-010, SSP-013, SSP-033, SSP-039, SSP-041, SSP-051, SSP-052, SSP-068, SSP-097, SSP-098, SSP-099, SSP-111, SSP-115, SSP-224]
---

# SSP-009: Implement forge build for grid and blender techniques with outline and byte-stable PNGs

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** feature · **Size:** L · **Areas:** tooling, assets, test · **Vertical slice**

## Summary

Implement the pure, deterministic `forge build` path for `grid`/`ai-ingest` and `blender` manifest entries. It parses .sprite.txt, block-mode reduces Blender renders, snaps to the palette, adds the 1 px ink outline and encodes metadata-free PNGs. Start `assets-src/manifest.json` and prove byte-identical output across two builds.

## Context

Manifest (`assets-src/manifest.json`, ASSET_PIPELINE §6.1): `{ assets: [ { id, class, technique, source, cell:[w,h], states, dirs, frames, atlas, outline, swaps } ] }`, sorted by id.
- technique ∈ grid | procedural | blender | ai-ingest | ai-art. Only grid, ai-ingest and blender are built in M0.
- dirs: "h32" | "h4" | a list of compass dirs | "-".

M0 entries added here:
- `veh.sweeper`: blender, source assets-src/rendered/veh.sweeper, cell [64,64], states [body, dented], dirs h32, frames {body:1, dented:1}, atlas actors, outline true, swaps [] (the §6.1 example lists liveries, but swap tables do not exist until M4).
- `veh.sweeper_brush`: blender, [96,96], states [brush], h32, frames {brush:4}, actors, outline true, swaps [].
Later issues add the spike pedestrian (SSP-014) and the lamp post (SSP-020). _probe and concept.* are never in the manifest.

Blender file naming → frame IDs (§6.6):
- `h07.png` → `veh.sweeper:body:h07:0`;
- `dented_h07.png` → `veh.sweeper:dented:h07:0`;
- `brush_h07_2.png` → `veh.sweeper_brush:brush:h07:2`;
- `slice_<k>.png` → `<id>:slice:-:<k>` (used by SSP-020 if it chooses Blender).

.sprite.txt format (§6.2):
- header `id:`, `cell: WxH`, `palette: kerbside32`, optional key map;
- default key: `.` = transparent, 0-9 = indices 00-09, a-v = indices 10-31;
- blocks `frame <state>:<dir>:<n>` followed by exactly H rows of W chars;
- `mirror <dir> from <dir>` lines; `#` comments;
- `origin:` and `ingest_sha256:` headers, read and preserved.
Put the parser/writer in one module (e.g. `forge/sprite.py`) that ingest reuses.

Build steps (§9.2):
- grid/ai-ingest: parse → validate size/key/frame list against the manifest → render frames → apply mirrors → (litter rotations: not in M0) → outline if outline:true.
- blender: read assets-src/rendered/<id>/ → block-mode 4x4 → 1 px → palette snap (expected no-op; count changed pixels and expose them for lint) → alpha threshold 128 → 1 px ink #0f0e12 outline, 4-connected, outside the silhouette → record pivots (from render.json pivots_px).

`forge/outline.py`: every transparent pixel 4-adjacent to a non-ink opaque pixel becomes ink (index 00). It is a no-op on grids that already have a full ink border.

Outputs in this issue: per-frame indexed results written as PNG under `<out>/frames/<asset-id>/<frame-id>.png` (default out `build/.forge-cache/`, or the cache dir), plus an in-memory frame list that SSP-010 packs.

Determinism:
- Pillow with NO metadata (no tEXt/iTXt/zTXt/tIME/pHYs), fixed compress_level and no optimize flag;
- deterministic iteration order (sorted ids/frame ids);
- content-hash cache in `build/.forge-cache/`, with `--no-cache`, `--out <dir>` and `--only <id>...`.

## Scope

- assets-src/manifest.json with veh.sweeper and veh.sweeper_brush
- forge/sprite.py: shared .sprite.txt parser/writer (default key, mirrors, headers)
- tools/forge/forge/build.py: grid/ai-ingest and blender techniques, --out, --only, --no-cache, content-hash cache, snap-change counts
- tools/forge/forge/outline.py
- Deterministic PNG encode helper
- pytest: sprite parse/write round-trip and mirrors, outline on synthetic shapes, 4x4 block-mode on a synthetic render, determinism (build twice, identical SHA-256)

## Out of scope

- Atlas packing, src/gen/assets.ts, asset-hashes.json, verify (SSP-010)
- lint and sheets (SSP-011)
- procedural and ai-art techniques (M1/M4)
- Litter rotations (M2/M4)

## Acceptance criteria

- [ ] `uv run --project tools/forge python -m forge build --no-cache --out build/tmp/a` builds all 192 frames of veh.sweeper + veh.sweeper_brush without error
- [ ] Built Bessie frames are 64x64 (brush 96x96) and contain only Kerbside-32 colours with binary alpha
- [ ] No opaque non-ink pixel is 4-adjacent to transparency in any built outline:true frame (pytest over the build output)
- [ ] The palette snap changed 0 pixels on the committed Bessie renders (count logged)
- [ ] Two `--no-cache` builds into build/tmp/a and build/tmp/b are identical (`diff -r` exit 0)
- [ ] Built PNGs contain no tEXt/iTXt/zTXt/tIME chunks (pytest inspects chunks)
- [ ] manifest.json entries are sorted by id
- [ ] `uv run --project tools/forge pytest` passes

## Verification

- uv run --project tools/forge pytest
- uv run --project tools/forge python -m forge build --no-cache --out build/tmp/a && uv run --project tools/forge python -m forge build --no-cache --out build/tmp/b && diff -r build/tmp/a build/tmp/b
- uv run --project tools/forge python -c "from PIL import Image;import glob;f=sorted(glob.glob('build/tmp/a/**/*.png',recursive=True))[0];print(f,Image.open(f).info)" (expect no text/time keys)

## Dependencies

**Depends on:**

- [SSP-005](SSP-005-kerbside32-palette.md) Author kerbside32.json and forge OKLab palette mapping with a shared 4,096-sample fixture
- [SSP-008](SSP-008-blender-bessie.md) Port the probe sweeper onto rig.py and commit Bessie body, dented and brush renders

**Blocks:**

- [SSP-010](SSP-010-forge-pack-verify.md) Add deterministic atlas packing, generated assets.ts, asset-hashes.json and forge verify
- [SSP-013](SSP-013-ingest-prototype.md) Prototype forge ingest (steps 1-10) to turn an AI golden into an indexed sprite grid
- [SSP-033](../M1/SSP-033-level-compiler-core.md) Build level schema and compile-level.ts core: parse, legend, buildings, M1 checks
- [SSP-039](../M1/SSP-039-forge-pack-gen-assets.md) Add the world atlas with 1 px tile/facade extrusion and confirm npm run assets runs end to end
- [SSP-041](../M1/SSP-041-placeholder-facades-roofs.md) Add placeholder facade modules, facade sets and roof surfaces for Puddle Lane
- [SSP-051](../M2/SSP-051-placeholder-litter-sprites.md) Author placeholder grids for all 15 litter IDs and add the items atlas
- [SSP-052](../M2/SSP-052-placeholder-stains-pickups-sites.md) Add stain generator, grime overlays and pickup/collectible/site/hydrant grids
- [SSP-068](../M2/SSP-068-kerbside5x7-font.md) Draft Kerbside 5×7 glyphs and add the forge font builder and ui atlas
- [SSP-097](../M3/SSP-097-placeholder-human-grids-mon.md) Author placeholder grids for the six Monday human NPCs (24×24, 13 frames/dir)
- [SSP-098](../M3/SSP-098-placeholder-human-grids-tue.md) Author placeholder grids for businessman, litterbug and market trader
- [SSP-099](../M3/SSP-099-placeholder-animal-grids.md) Author placeholder grids for the cat, pigeon and dog (npc.dog_loose grid)
- [SSP-111](../M4/SSP-111-forge-build-procedural.md) Harden the procedural technique: generator registry, params validation, fx play frames and a shared seam metric
- [SSP-115](../M4/SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-224](../M6/SSP-224-art-grids-m6.md) Art Pass 2: seagull, loose dog, remaining collectibles, upgrade icons and small props

## References

- ../../ASSET_PIPELINE.md#61-manifest-assets-srcmanifestjson
- ../../ASSET_PIPELINE.md#62-text-grid-sprite-spritetxt
- ../../ASSET_PIPELINE.md#66-blender-render-folder-assets-srcrenderedasset-id
- ../../ASSET_PIPELINE.md#92-forge-build-per-technique
- ../../ART_BIBLE.md#63-the-outline-rule
- ../../../CLAUDE.md#52-python-forge
- ../../../CLAUDE.md#6-asset-rules

## Roadmap tasks covered

- `forge/build.py` for the `grid` and `blender` techniques. `forge/outline.py`: 1 px ink, 4-connected, outside the silhouette. Byte-identical PNG encode, with no metadata.
- `Deterministic Pillow encode test: build twice and compare SHA-256.`
