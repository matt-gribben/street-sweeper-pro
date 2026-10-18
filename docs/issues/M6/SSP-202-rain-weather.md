---
id: SSP-202
title: "Implement rain: road grip 6.0, puddle density, rain FX and amb.rain hookup"
milestone: M6
status: todo
type: feature
estimate: M
labels: [type:feature, area:sim, area:physics, area:render, area:test, size:M]
depends_on: [SSP-030, SSP-093, SSP-154, SSP-295]
blocks: [SSP-204]
---

# SSP-202: Implement rain: road grip 6.0, puddle density, rain FX and amb.rain hookup

**Milestone:** [M6 Tidy Town Week](../README.md#m6) · **Type:** feature · **Size:** M · **Areas:** sim, physics, render, test

## Summary

Wednesday's weather: every road drops to grip 6.0 for the whole shift, puddles are dense, and rain ripples and droplets sell it without breaking the palette or the draw-call budget.

## Context

GDD §7.3: asphalt grip is 9.0, and on Wednesday (rain) all roads drop to 6.0. upg.tyres multiplies this by 1.15 (6.9). Puddle 4.0, oil 1.2 and wet leaves 3.0 are unchanged. Open: read 'all roads' as road tiles (asphalt and one-way) only, with pavement staying at 8.0; update the GDD if you choose otherwise. Level fields (LEVEL_DESIGN §8.4): weather 'rain'. The `rain` event sets all road grip to 6.0 for the whole shift, activates the puddle table and plays amb.rain. Puddle density comes from hazards.random with rule kerbside_low_points (Gasworks: 30 haz.puddle). Par assumes a 3.4 m/s average sweep speed in rain. Weather randomness uses the 'weather' sfc32 stream (TECHNICAL_DESIGN §7.3). Weather must be a single sim input that can come from the level or from a scene param, so the Depot Yard's inherited weather (resolved by SSP-198) works without special cases. Rain FX (ART_BIBLE §11/§13): fx.rain_ripple 8x8, 4 frames, 4 ticks, played once, colours 28/27, at random positions on visible ground (render-side sfc32, never a sim stream). Runtime rain particles are 1x1/2x2 quads in palette colour 28, with 28 glints on wet surfaces. There is no full-screen tint: the palette pass forbids blends. The overcast shadow-length multiplier was proposed in M0 as ×0.5 (0.42 × h; ROADMAP D-06, ART_BIBLE §13, provisional): confirm it here on the real district and build the per-district value, which M0 did not. FX go in the FX instanced batch (draw-call slot 6; total <= 10). SSP-217 authors the amb.rain bed; here, make sure the level's ambience ID is played.

## Scope

- Sim: one weather input (level or scene param); road grip override 6.0 (x1.15 with tyres)
- Procedural generator for fx.rain_ripple (assets-src/procedural/fx/) and runtime rain particles
- Palette-only wet glints on ground where cheap
- Unit tests for grip; a replay on a rain fixture level; contact sheet for fx.rain_ripple

## Out of scope

- amb.rain bed authoring (SSP-217)
- Gasworks layout (SSP-204)
- Resolving Depot Yard 'inherit' (SSP-198)

## Acceptance criteria

- [ ] Unit test: with weather rain, road tile lateral grip is 6.0 (6.9 with upg.tyres) and pavement grip is unchanged
- [ ] Unit test: puddle, oil and wet-leaves grip values are unchanged by rain
- [ ] Unit test: a skip_run fixture level with weather supplied as a scene param 'rain' gets road/apron grip 6.0 (no Depot-specific code path)
- [ ] Clear-weather replays keep identical hashes
- [ ] fx.rain_ripple matches the spec (8x8, 4 frames, 4 ticks, colours 28/27) and passes assets:lint; contact sheet reviewed with Read
- [ ] The perf.spec ci project still reports <= 10 draw calls with rain active

## Verification

- npm run typecheck
- npm run lint
- npm test
- npm run test:replay
- npm run assets && npm run assets:lint && npm run assets:verify
- npm run assets:sheets (Read build/sheets/fx.png)
- npm run test:e2e

## Dependencies

**Depends on:**

- [SSP-030](../M1/SSP-030-vehicle-model.md) Implement Bessie's kinematic bicycle model in src/sim/vehicle.ts
- [SSP-093](../M3/SSP-093-hazards-grip-jolts.md) Implement hazard grip overrides, jolts, LU spills and the open-manhole hard stop
- [SSP-154](../M4/SSP-154-vfx-core.md) Procedural VFX: dust, spray, sparkle, splash, leaf swirl, skid marks
- [SSP-295](../M5/SSP-295-vertical-slice-gate.md) Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR

**Blocks:**

- [SSP-204](SSP-204-district-gasworks.md) Author and compile district.gasworks (Wednesday, rain) with its district replay

## References

- ../../GDD.md#73-surfaces-and-terrain
- ../../LEVEL_DESIGN.md#43-event-catalogue
- ../../ART_BIBLE.md#11-vfx
- ../../ART_BIBLE.md#13-night-weather-and-time-of-day
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../TECHNICAL_DESIGN.md#73-randomness

## Roadmap tasks covered

- Rain: grip override 6.0, puddle density, rain particles, `amb.rain`. (sim, FX, ambience hookup)
