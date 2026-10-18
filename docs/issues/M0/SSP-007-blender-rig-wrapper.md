---
id: SSP-007
title: "Implement assets-src/blender/rig.py and the forge blender wrapper with --check"
milestone: M0
status: done
type: feature
estimate: M
labels: [type:feature, area:tooling, area:assets, size:M, vertical-slice]
depends_on: [SSP-004, SSP-005, SSP-006]
blocks: [SSP-008, SSP-020, SSP-100, SSP-127, SSP-128, SSP-132, SSP-222]
---

# SSP-007: Implement assets-src/blender/rig.py and the forge blender wrapper with --check

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** feature · **Size:** M · **Areas:** tooling, assets · **Vertical slice**

## Summary

Write the shared Blender rig (camera, sun, toon material from palette names, render settings, render.json) and `forge blender`. The wrapper runs headless Blender 5.2.2 LTS safely, swaps renders in atomically, writes provenance, and checks committed renders for pixel drift.

## Context

Exact command (ASSET_PIPELINE §7.1):
`/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 -P <script> -- --out <dir> --size <4 x CELL_PX> --headings <n> --tilt 0`
Blender is not on PATH. `SSP_BLENDER` overrides the path for one shell only.

Wrapper duties (`tools/forge/forge/blender.py`):
- Refuse to run unless `-b --factory-startup --version` reports `Blender 5.2.2 LTS`.
- Render into `build/tmp/blender/<id>/`, then swap into `assets-src/rendered/<id>/` only after Blender exits 0, render.json exists, and the frame count matches the script's states x headings.
- Treat a non-zero exit OR `Traceback` in stderr as failure.
- render.json = `{ blender_version:"5.2.2 LTS", script_sha256, argv, tilt_deg, pivots_px }`, with script_sha256 = sha256(script bytes + NUL + rig.py bytes). The rig writes it (§7.3 `write_render_json`); the wrapper verifies it.
- `--check`: render to build/tmp, print per-frame changed-pixel counts, write diff PNGs to `build/tmp/blender/<id>/diff/`, replace nothing, and exit non-zero if any pixel changed.
- `forge blender --version` prints the Blender version (an exit-criteria proof).
- `all` renders every asset script.

Script lookup and arguments (decided; the manifest may not exist yet when Bessie is first rendered):
- The asset ID minus its class prefix maps to `assets-src/blender/{vehicles,props,roofkit}/<name>.py`, e.g. veh.sweeper → vehicles/sweeper.py, veh.sweeper_brush → vehicles/sweeper_brush.py. Error on zero or multiple matches.
- `--size` = 4 x the script's `CELL_PX`, parsed by regex from the script text. Cross-check it against the manifest `cell` when an entry exists.
- `--headings` by class: veh 32, prop 1, roof 4.
- `--out` = the temp dir.
- Document this in ASSET_PIPELINE §7.1.

rig.py (the ASSET_PIPELINE §7.3 skeleton is the template):
- orthographic camera straight down, ortho_scale = CELL_PX / 16 (32 px→2 m, 64→4 m, 96→6 m, 128→8 m);
- square --size render at 100%;
- film_transparent; view_transform 'Standard' (never AgX/Filmic); look None; exposure 0; gamma 1; dither_intensity 0;
- EEVEE with taa_render_samples=1 and filter_size=0.0; PNG RGBA 8-bit;
- one sun at azimuth 315°, elevation 50°;
- `toon_material(name, lit, base, dark)`: dot(N, sun) → CONSTANT ColorRamp with exact palette stops → Emission;
- `pal(name)` reads kerbside32.json `colors[].name` and converts sRGB → linear. Raw hex literals in bpy scripts are forbidden;
- T_BASE=0.35, T_LIT=0.85 (a flat top scores 0.766 → base); final values are settled in SSP-008;
- headings rotate the model root clockwise, never the camera; h00 = north;
- no shadow catchers or ground planes.
Timing: first frame about 3.3 s (shader compile), then about 0.05 s per frame.

## Scope

- assets-src/blender/rig.py per §7.2/§7.3
- tools/forge/forge/blender.py: version gate, ID→script lookup, temp render + atomic swap, failure detection, render.json verification, --check with diff PNGs, --version, `all`
- ASSET_PIPELINE §7.1 note on the lookup convention
- pytest with a fake Blender (SSP_BLENDER pointing at a script): version gate, Traceback/exit failure leaves the target untouched, script_sha256 maths, --check diff counting on synthetic PNGs

## Out of scope

- Bessie scripts and committed renders (SSP-008)
- forge build's blender technique (SSP-009)
- Running Blender in pytest or CI (never)

## Acceptance criteria

- [x] `uv run --project tools/forge python -m forge blender --version` prints `Blender 5.2.2 LTS` on the dev Mac
- [x] With SSP_BLENDER pointing at a fake binary reporting another version, the wrapper exits non-zero before rendering
- [x] A fake render that writes a Traceback to stderr, or exits 1, makes the wrapper exit non-zero and leaves assets-src/rendered/<id>/ byte-identical
- [x] pytest verifies script_sha256 = sha256(script + b'\0' + rig.py)
- [x] `--check` on identical synthetic frames reports 0 changed pixels and exits 0; on a 1 px change it reports 1, writes a diff PNG and exits non-zero
- [x] `grep -rnE '#[0-9a-fA-F]{6}' assets-src/blender` prints nothing
- [x] `uv run --project tools/forge pytest` passes

## Verification

- uv run --project tools/forge pytest -k blender
- uv run --project tools/forge python -m forge blender --version
- npm run assets:blender -- --version
- grep -rnE '#[0-9a-fA-F]{6}' assets-src/blender (expect no output)

## Dependencies

**Depends on:**

- [SSP-004](SSP-004-forge-skeleton-pixelize.md) Create the forge Python package (uv, CLI skeleton) and import pixelize.py with tests
- [SSP-005](SSP-005-kerbside32-palette.md) Author kerbside32.json and forge OKLab palette mapping with a shared 4,096-sample fixture
- [SSP-006](SSP-006-npm-scripts-ci-workflow.md) Wire every npm script, playwright.config.ts and the GitHub Actions CI workflow

**Blocks:**

- [SSP-008](SSP-008-blender-bessie.md) Port the probe sweeper onto rig.py and commit Bessie body, dented and brush renders
- [SSP-020](SSP-020-lamp-post-stack.md) Prototype a 4-slice sprite-stack lamp post and add it to lean_quadrants (D-02 input)
- [SSP-100](../M3/SSP-100-placeholder-vehicle-renders.md) Render placeholder traffic vehicles in Blender as primitive boxes at 32 headings
- [SSP-127](../M4/SSP-127-bessie-final.md) Final Bessie renders: body, dented variant and 96x96 brush overlay
- [SSP-128](../M4/SSP-128-traffic-cars.md) Final Blender cars: hatchback, saloon, taxi, white van, parked aliases
- [SSP-132](../M4/SSP-132-roofkit-layout.md) Blender roof kit and the seeded roof-furniture layout script
- [SSP-222](../M6/SSP-222-art-vehicles-m6.md) Art Pass 2: Blender renders for bin lorry, ice cream van, police and Sid's sweeper

## References

- ../../ASSET_PIPELINE.md#71-the-exact-command
- ../../ASSET_PIPELINE.md#72-rig-rules-enforced-in-rigpy
- ../../ASSET_PIPELINE.md#73-skeleton-assets-srcblenderrigpy
- ../../ASSET_PIPELINE.md#66-blender-render-folder-assets-srcrenderedasset-id
- ../../ASSET_PIPELINE.md#112-render-review-blender
- ../../ASSET_PIPELINE.md#133-blender
- ../../adr/0002-ai-authored-asset-pipeline.md#34-locks-that-come-before-any-asset-is-generated-m0
- ../../../CLAUDE.md#44-local-tool-binaries-not-on-path-always-use-absolute-paths

## Roadmap tasks covered

- `forge/blender.py`: wraps the exact command in ASSET_PIPELINE.md, writes `render.json`, and implements `--check`.
