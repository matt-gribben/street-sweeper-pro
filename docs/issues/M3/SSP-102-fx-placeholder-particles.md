---
id: SSP-102
title: "Add placeholder particles in src/render/fx.ts for dust, splash and sparkle"
milestone: M3
status: todo
type: feature
estimate: S
labels: [type:feature, area:render, area:test, size:S, vertical-slice]
depends_on: [SSP-095, SSP-094, SSP-016, SSP-043, SSP-063, SSP-064]
blocks: [SSP-109, SSP-154, SSP-155]
---

# SSP-102: Add placeholder particles in src/render/fx.ts for dust, splash and sparkle

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** S · **Areas:** render, test · **Vertical slice**

## Summary

Create src/render/fx.ts: pooled runtime particles (1×1 or 2×2 px quads in palette colours) driven by sim events, giving placeholder feedback for dust, puddle splashes and sparkles until the M4 procedural fx frames exist.

## Context

ART_BIBLE §11 VFX rules:
- Chunky, few and short; no ink outlines.
- Dust colours 06/05/04; splash 27/28/07; sparkle 07/16.
- Dust and spray spawn at the brushes and drift BACKWARDS and outwards; never obscure Bessie's front.

Triggers (event bus): dust cloud (SSP-095), EV.Splash (SSP-094), sparkle on pickup collected and Clean Sweep frontage (M2 events).

Rules:
- Presentation randomness uses the render-side sfc32, never sim streams (TECHNICAL_DESIGN §7.3).
- One instanced draw (#6 in the draw-call allocation, TECHNICAL_DESIGN §12.7) at layer 10.
- No per-frame `new THREE.*`; instance buffer sized once; one needsUpdate per frame.
- Render reads sim state and events and never writes them. Colours referenced by palette index, not hex.

## Scope

- fx.ts particle pool with fixed capacity, per-effect emitters (dust, splash, sparkle) and palette-index colours.
- Subscribe to the event bus.
- Integrate into the frame graph at layer 10 within the draw-call budget.
- Unit test for pool exhaustion and determinism under a fixed render seed.

## Out of scope

- Procedural fx atlas frames (M4).
- Juice: shake and hit-stop (M7).

## Acceptance criteria

- [ ] `renderer.info.render.calls` stays ≤ 10 with particles active (perf.spec.ts `ci` project).
- [ ] Unit test: emitting past capacity recycles the oldest particles without allocation.
- [ ] A frozen-frame capture just after a splash, opened with Read, shows splash particles around the puddle and none in front of Bessie.
- [ ] Existing visual goldens pass unchanged when no effects are active.

## Verification

- npm test
- npm run test:visual
- npm run test:e2e
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-095](SSP-095-near-miss-dust-coughing.md) Add the near-miss bonus and dust coughing penalties
- [SSP-094](SSP-094-puddle-splash-broken-glass.md) Add puddle splash penalties and broken glass from flung bottles
- [SSP-016](../M0/SSP-016-palette-pass.md) Implement the MRT world target and palette pass (64³ OKLab LUT, night/shadow remap)
- [SSP-043](../M1/SSP-043-app-shell.md) Add the fixed 60 Hz loop, Game, SceneManager and typed event bus
- [SSP-063](../M2/SSP-063-scoring-combo.md) Implement scoring.ts and combo.ts: item points, multiplier chain, grime, Kerb Hugger
- [SSP-064](../M2/SSP-064-tidy-frontages.md) Compute Tidy %, per-frontage clean % and Clean Sweep bonuses incrementally

**Blocks:**

- [SSP-109](SSP-109-close-m3.md) Close M3: verify the exit criteria, sync docs, state the frozen entity list, tag m3
- [SSP-154](../M4/SSP-154-vfx-core.md) Procedural VFX: dust, spray, sparkle, splash, leaf swirl, skid marks
- [SSP-155](../M4/SSP-155-vfx-reactions.md) Procedural VFX for reactions and damage: impact star, cough, anger, smoke

## References

- ../../ART_BIBLE.md#11-vfx
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../TECHNICAL_DESIGN.md#73-randomness
- ../../TECHNICAL_DESIGN.md#125-sprites-spritebatchts-spritestackts

## Roadmap tasks covered

- `src/render/fx.ts` placeholder particles (palette colours only) for dust, splash and sparkle.
