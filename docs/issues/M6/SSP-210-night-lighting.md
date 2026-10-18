---
id: SSP-210
title: "Implement night: night remap with street-lamp and headlight light mask"
milestone: M6
status: todo
type: feature
estimate: L
labels: [type:feature, area:render, area:perf, area:test, size:L]
depends_on: [SSP-190, SSP-197, SSP-016, SSP-021, SSP-023, SSP-154, SSP-131]
blocks: [SSP-212, SSP-226, SSP-227]
---

# SSP-210: Implement night: night remap with street-lamp and headlight light mask

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** L · **Areas:** render, perf, test

## Summary

Make Saturday's night look work: everything outside a light pool goes through the night[32] remap, while lamps, headlights, lit signs, windows and Bessie's beacon write the light mask.

## Context

TECHNICAL_DESIGN §12.6: everything is unlit. At night, street-lamp and headlight light cookies (procedural shapes in the fx atlas) write G = 1 into the mask with MAX blending. Palette pass step 2: if night is active and G == 0, idx = night[idx]; step 3 applies shadow after night. The night[32] table was tuned in M0 (D-05) and lives in assets-src/palette/kerbside32.json; ROADMAP and TECHNICAL_DESIGN call it palette.json, but it is the same table. ART_BIBLE §13 night rules: the light mask is written by street-lamp pools, Bessie's headlights, vehicle headlights and tail lights, lit shop signs, and a seeded subset of facade windows (interior 16 lemon with an 11 curtain stripe). Bessie's beacon (17/16) always writes the mask, and Bessie must remain the brightest non-light object. Light pools are hard-edged stepped circles 10 m across (radius 5 m, decided in M0 by D-05; use the shared constant from SSP-190). Headlight cones are 8 m long. The M0 night tuning did not approve dither on pool edges (ART_BIBLE §13), so edges stay hard. The UI writes mask (0,1), so the HUD is never darkened. Night applies to timeOfDay 'night' (Kebab Mile), and to the Depot Yard when SSP-198 passes timeOfDay 'night' after Saturday. Draw calls: cookies share the FX instanced batch (slot 6), and the total must stay <= 10 (perf.spec ci project; TECHNICAL_DESIGN §18.6 already uses Kebab Mile at night as its dense perf scene). Also resolve LEVEL_DESIGN §13 Q5 (owned by M6): either implement Monday's `dawn` event (night remap at elapsed 0, dissolving to day over 20 s with the 4x4 Bayer transition dither) or record Monday as plain 'morning'. If implemented, Puddle Lane replays are unaffected (render-only), but visual goldens may change and need Read review. SSP-212 creates the `night_kebab_mile` golden; here, verify with the Depot Yard at night (it has lamp posts `l`).

## Scope

- Procedural light-cookie generators (lamp pool, headlight cone, tail light, sign glow) in the fx atlas
- Renderer: light mask pass with MAX blending from lamps, Bessie's headlights and beacon, traffic headlights and tail lights, lit signs and seeded lit windows
- Night activation from the effective timeOfDay (level value or scene param)
- Decision on, and optional implementation of, the Monday dawn dissolve; LEVEL_DESIGN §13 Q5 updated
- Test-hook support to boot a district with a time-of-day override (e.g. ?test=1&scene=district.depot_yard&tod=night), documented in TECHNICAL_DESIGN §18.5
- Palette-pass test: no output pixel outside Kerbside-32 at night

## Out of scope

- Kebab Mile layout and its golden (SSP-212)
- Changing the night[32] table (needs an ADR after M0)

## Acceptance criteria

- [ ] A frozen Depot Yard night frame shows lamp pools in day colours and the rest night-remapped; reviewed with Read and attached to the PR
- [ ] Unit or visual test: no pixel outside Kerbside-32 with night active
- [ ] Bessie's beacon pixels are never night-remapped (pixel assertion)
- [ ] The perf.spec ci project reports <= 10 draw calls in a night scene
- [ ] The light-pool radius comes from the single shared constant also used by the compiler's L072
- [ ] LEVEL_DESIGN §13 Q5 is marked resolved with the decision
- [ ] Existing goldens either pass or are re-approved after reading diffs, with reasons in the commit

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:visual
- npm run test:e2e
- npm run assets && npm run assets:lint && npm run assets:verify

## Dependencies

**Depends on:**

- [SSP-190](SSP-190-compiler-m6.md) Extend compile-level for M6: skip_run mode, night lamp pools, landmarks, M6 events
- [SSP-197](SSP-197-depot-yard-level.md) Author and compile district.depot_yard with all seven Skip Run variants
- [SSP-016](../M0/SSP-016-palette-pass.md) Implement the MRT world target and palette pass (64³ OKLab LUT, night/shadow remap)
- [SSP-021](../M0/SSP-021-night-shadow-tuning.md) Tune night[32] and shadow[32] remap tables in the spike scene (D-05, D-06)
- [SSP-023](../M0/SSP-023-perf-baseline.md) Baseline perf.spec.ts on the dev Mac GPU and set the p99 frame-time budget (D-08)
- [SSP-154](../M4/SSP-154-vfx-core.md) Procedural VFX: dust, spray, sparkle, splash, leaf swirl, skid marks
- [SSP-131](../M4/SSP-131-blender-props-stacks.md) Blender sprite-stack props: lamp post, phone box, tree, bus shelter, stall

**Blocks:**

- [SSP-212](SSP-212-district-kebab-mile.md) Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden
- [SSP-226](SSP-226-art-facades-m6.md) Art Pass 2: facade module sets for every remaining building style
- [SSP-227](SSP-227-art-signs-decals-m6.md) Art Pass 2: shop signs and road decals for the Wed-Sun districts

## References

- ../../TECHNICAL_DESIGN.md#126-lighting-night-and-the-palette-pass-shadowsts-fxts-palettepassts
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../ART_BIBLE.md#13-night-weather-and-time-of-day
- ../../ART_BIBLE.md#57-shadow-and-night-remaps-intent
- ../../LEVEL_DESIGN.md#13-open-questions
- ../../ROADMAP.md#8-m0-spike-decision-log

## Roadmap tasks covered

- Night: the night remap from `palette.json`; light mask from street lamps and headlights.
