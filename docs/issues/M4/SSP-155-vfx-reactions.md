---
id: SSP-155
title: "Procedural VFX for reactions and damage: impact star, cough, anger, smoke"
milestone: M4
status: todo
type: asset
estimate: M
labels: [type:asset, area:assets, area:render, area:tooling, size:M, vertical-slice]
depends_on: [SSP-111, SSP-115, SSP-116, SSP-118, SSP-102, SSP-082, SSP-093, SSP-095]
blocks: [SSP-158]
---

# SSP-155: Procedural VFX for reactions and damage: impact star, cough, anger, smoke

**Milestone:** [M4 Art Pass 1](../README.md#m4) · **Type:** asset · **Size:** M · **Areas:** assets, render, tooling · **Vertical slice**

## Summary

Add the remaining Mon-Tue VFX that the asset readiness matrix requires (impact star, cough, anger mark, splat, glass smash, engine smoke). They carry the comic reactions of Pillar 4.

## Context

These are not named in the M4 checklist, but VFX are 'R' in M4 per ROADMAP §5.1 and these fire in Mon-Tue (ART_BIBLE §11, IDs proposed): `fx.splat` 16x16, 4 frames, 4 ticks, once, 08/13 (brush up over dog mess; leaves `stain.splat`); `fx.glass_smash` 16x16, 5 frames, 3 ticks, once, 28/07/27 (flung glass bottle; leaves `haz.broken_glass`); `fx.impact_star` 16x16, 4 frames, 3 ticks, once, 16/07/17 (collisions; dizzy star above fallen pedestrians, ART_BIBLE §8.3); `fx.cough` 8x8, 4 frames, 7 ticks, once, 06/07 (pedestrians in dust); `fx.engine_smoke` 16x16, 6 frames, 6 ticks, once, 03/04/05 (Bessie below 20 HP, proposed); `fx.anger_mark` 8x8, 2 frames, 9 ticks, loop, 18 (comic cross vein over angry pedestrians). Rating guard: comic only, no injury imagery. Same generator rules as SSP-154.

## Scope

- Generators and params for the six effects
- pytest for frame counts, loops, palettes
- Hook into the `src/render/fx.ts` triggers that exist from M3
- Sheet + zoo review

## Out of scope

- `fx.rain_ripple` (M6)
- New gameplay triggers

## Acceptance criteria

- [ ] Six fx assets build procedurally with the documented sizes, frame counts and colours (pytest); lint clean
- [ ] pytest: frames x ticks per frame equals the documented duration for each effect
- [ ] Fallen pedestrians show the dizzy star and angry ones the anger mark in a capture (Read, noted)

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
- [SSP-082](../M3/SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-093](../M3/SSP-093-hazards-grip-jolts.md) Implement hazard grip overrides, jolts, LU spills and the open-manhole hard stop
- [SSP-095](../M3/SSP-095-near-miss-dust-coughing.md) Add the near-miss bonus and dust coughing penalties

**Blocks:**

- [SSP-158](SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR

## References

- ../../ART_BIBLE.md#11-vfx
- ../../ROADMAP.md#51-asset-readiness-by-milestone
- ../../ART_BIBLE.md#103-pedestrian-reaction-flow
- ../../ART_BIBLE.md#83-people-and-animals

## Roadmap tasks covered

- `Procedural frame generators (4–8 frames each, exact loops) for dust, spray, sparkle, skid marks, score popups, splash and leaf swirl.`
