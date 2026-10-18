---
id: SSP-154
title: "Procedural VFX: dust, spray, sparkle, splash, leaf swirl, skid marks"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, area:render, area:tooling, size:M, vertical-slice]
depends_on: [SSP-111, SSP-115, SSP-116, SSP-118, SSP-102]
blocks: [SSP-158, SSP-202, SSP-205, SSP-210]
---

# SSP-154: Procedural VFX: dust, spray, sparkle, splash, leaf swirl, skid marks

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets, render, tooling · **Vertical slice**

## Summary

Write the procedural frame generators for the core sweeping VFX in the checklist, with exact loops and palette-strict colours, replacing the sprite frames of the M3 placeholder particles. Resolve the score-popup technique conflict.

## Context

VFX (ART_BIBLE §11): procedural Python generators in `tools/forge/forge/procedural/fx.py`, params in `assets-src/procedural/fx/*.json`, 4-8 frames, `fx` atlas, state `play`. No outlines (ink only for debris); chunky 2-4 px clumps; most one-shots last < 0.5 s; never obscure Bessie's front (spawn at the brushes, drift backwards/outwards); readable over asphalt and slab. IDs (proposed) and specs: `fx.dust_puff` 16x16, 6 frames, 5 ticks, once, 06/05/04; `fx.spray_mist` 16x16, 4 frames, 4 ticks, loop, 28/27/07 (3-6 instances across the 2.6 m cone); `fx.sparkle` 16x16, 4 frames, 4 ticks, once, 07/16; `fx.splash` 24x24, 6 frames, 4 ticks, once, 27/28/07 (puddle crossed above 3 m/s); `fx.leaf_swirl` 24x24, 8 frames, 5 ticks, loop, 14/11/13/22; `fx.skid_mark` 32x32 decal, 1 frame, persistent, fading one ramp step per 10 s, 01. Score popups: the ROADMAP checklist and ASSET_PIPELINE §2 list them as a VFX frame generator, but ART_BIBLE §11 (the visual owner) says popups are Kerbside text, not sprites. They are implemented as text in SSP-156. Update the ASSET_PIPELINE §2 VFX row in this PR so the docs agree. Runtime particles (`src/render/fx.ts`) use palette colours only.

## Scope

- Generators and params for the six effects
- pytest: frame counts, exact loop (last frame flows into the first for loops), palette subsets
- Hook frames into `src/render/fx.ts`, replacing placeholders under the same IDs
- Align ASSET_PIPELINE §2 on score popups being text
- Sheet + zoo review with tick stepping

## Out of scope

- Reaction/impact VFX (SSP-155)
- Score popup rendering (SSP-156)
- Rain ripples and night light cookies (M6)
- Juice (screen shake, hit-stop: M7)

## Acceptance criteria

- [ ] Six fx assets are non-placeholder with the documented cell sizes, frame counts and colours (pytest)
- [ ] Looping effects loop exactly (pytest); lint clean
- [ ] In a sweeping capture (`?test=1&...&tick=<n>&freeze=1`), dust and spray never cover Bessie's front (Read, noted)
- [ ] ASSET_PIPELINE §2 and ART_BIBLE §11 agree that score popups are Kerbside text

## Verification

- uv run --project tools/forge pytest
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets -- --atlas fx, then Read build/sheets/fx.png
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-111](SSP-111-forge-build-procedural.md) Harden the procedural technique: generator registry, params validation, fx play frames and a shared seam metric
- [SSP-115](SSP-115-forge-lint-complete.md) Complete forge lint: every rule with a failing fixture, zero warnings on assets
- [SSP-116](SSP-116-forge-sheets.md) Extend forge sheets: palette strip and Bessie scale on every atlas, multi-id --only, 3x3 wrap previews and the 8-slot swap row
- [SSP-118](SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-102](../M3/SSP-102-fx-placeholder-particles.md) Add placeholder particles in src/render/fx.ts for dust, splash and sparkle

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-202](../M6/SSP-202-rain-weather.md) Implement rain: road grip 6.0, puddle density, rain FX and amb.rain hookup
- [SSP-205](../M6/SSP-205-wind-leaves-gusts.md) Implement leaf fall, wet leaves and haz.wind_gust litter drift
- [SSP-210](../M6/SSP-210-night-lighting.md) Implement night: night remap with street-lamp and headlight light mask

## References

- ../../ART_BIBLE.md#11-vfx
- ../../ASSET_PIPELINE.md#108-ground-tile-roof-surface-stain-or-vfx-procedural
- ../../ASSET_PIPELINE.md#2-technique-per-asset-class
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation

## Roadmap tasks covered

- `Procedural frame generators (4–8 frames each, exact loops) for dust, spray, sparkle, skid marks, score popups, splash and leaf swirl.`
