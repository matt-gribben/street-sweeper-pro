---
id: SSP-028
title: "Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type"
milestone: M1
status: done
type: feature
estimate: S
labels: [type:feature, area:sim, area:test, size:S, vertical-slice]
depends_on: [SSP-002, SSP-003]
blocks: [SSP-029, SSP-030, SSP-031, SSP-032, SSP-035, SSP-044, SSP-057, SSP-059, SSP-060, SSP-061, SSP-062, SSP-078, SSP-080, SSP-081, SSP-159, SSP-160, SSP-175, SSP-276]
---

# SSP-028: Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** feature · **Size:** S · **Areas:** sim, test · **Vertical slice**

## Summary

Lay down the smallest pure-sim building blocks every later M1 issue imports: the seeded sfc32 RNG with known-answer tests, the fmath transcendental wrapper, unit constants, coordinate helpers and the InputFrame type. These are the root of the determinism contract (run = f(seed, district, inputLog)).

## Context

Files: `src/sim/rng.ts`, `src/sim/fmath.ts`, `src/sim/constants.ts`, plus a sim-side home for the `InputFrame` type. TECHNICAL_DESIGN §2.1 says `src/input/**` may import only the `InputFrame` type from `src/sim`, so the type must live in sim. The docs do not name its file: propose `src/sim/inputFrame.ts`.

RNG (TECHNICAL_DESIGN §7.3):
- sfc32, one stream per subsystem, seeded as `sfc32(seed ^ hash32(streamName))`.
- Stream names: `litter`, `grime`, `stains`, `hazards`, `npc`, `traffic`, `events`, `brush`, `weather`.
- Adding a stream must never reshuffle another stream.
- OPEN: the docs do not define `hash32`. Proposal: FNV-1a 32-bit over the UTF-8 bytes, the same family the replay hash uses (§18.3). Record the choice in TECHNICAL_DESIGN §7.3.
- Known-answer vectors must come from the reference sfc32 (PractRand, Chris Doty-Humphrey). Cite the source in the test file.

fmath (§7.4, and the 'one addition' note in §2): all sim transcendentals go through `src/sim/fmath.ts`. Version 1 forwards to `Math.*` (Node and Chromium are both V8). The doc lists `sin`, `cos`, `atan2`, `exp`, `sqrt` and `hypot`. Add `tan` too, because the vehicle yaw step uses `tan(δ)`, and note the addition in §2 and §7.4.

Constants (§3.2: no magic numbers except unit conversions):
- `PX_PER_M = 16`, tile 2 m, grime cell 0.25 m
- `TICK_HZ = 60`, `DT = 1/60`
- shift = 14,400 ticks (240 s)

Coordinates (§4):
- Sim +x is east and +y is south, in metres. Tile col = floor(x/2), row = floor(y/2).
- Heading 0 = north, increasing clockwise.
- forward = `(sin θ, −cos θ)`, right = `(cos θ, sin θ)`.
- Vehicle frame = `((round(θ / (2π/32)) % 32) + 32) % 32` → `h00`..`h31`.
- Actor dir = `round(θ / (π/4)) mod 8` → `n, ne, e, se, s, sw, w, nw`.

InputFrame (§13.1):
- `throttle` 0..255, `brake` 0..255, `steer` −127..127 (all integers)
- `buttons`: bitfield of held actions (SPRAY, INTERACT)
- `pressed`: rising edges (BRUSH, HORN, MAP, PAUSE)
- Use `as const` objects for the bit constants: no `enum` (CLAUDE.md §5.1).

Hard rules: no `Math.random`, `Date` or `performance` in `src/sim`. Imports carry an explicit `.ts`. Named exports only. Zero allocations per call in hot functions (write into caller-supplied out objects).

## Scope

- src/sim/rng.ts: sfc32 generator, stream factory `sfc32(seed ^ hash32(name))`, next uint32 / float helpers
- src/sim/fmath.ts forwarding sin, cos, tan, atan2, exp, sqrt, hypot to Math.*
- src/sim/constants.ts with unit conversions and tick constants
- Pure coordinate helpers: heading→forward/right vectors (into an out object), heading→vehicle frame index (h00–h31), heading→8-way actor dir
- InputFrame type plus BUTTON/PRESSED bit constants as `as const` objects
- Extend tests/unit/simPurity.test.ts (or add a sibling test) so that no file in src/sim except fmath.ts calls Math.sin|cos|tan|atan2|exp|sqrt|hypot
- Unit tests: sfc32 KATs, stream independence, coordinate conventions
- Doc updates: hash32 choice in TECHNICAL_DESIGN §7.3; tan in §2 and §7.4

## Out of scope

- Swapping fmath to polynomial approximations (only if cross-engine replays are ever needed)
- Render-side presentation RNG
- World, EventQueue, vehicle state (later issues)

## Acceptance criteria

- [x] sfc32 reproduces at least 8 consecutive outputs for at least 2 seeds from the reference implementation (vectors and source cited in the test)
- [x] Two streams created from the same seed with different names produce different sequences, and creating an extra stream does not change the sequence of an existing one
- [x] Unit test: heading 0 gives forward (0, −1); heading π/2 gives vehicle frame index 8 (h08); heading −0.01 rad gives h00; the 8 actor directions map as specified in TECHNICAL_DESIGN §4
- [x] A test fails if any src/sim file other than fmath.ts calls Math.sin/cos/tan/atan2/exp/sqrt/hypot (verified by temporarily adding such a call)
- [x] tests/unit/simPurity.test.ts and the Biome src/sim override still pass, with no suppressions
- [x] The hash32 choice is recorded in TECHNICAL_DESIGN §7.3 and the fmath tan addition in §2/§7.4

## Verification

- npm run typecheck
- npm run lint
- npm test

## Dependencies

**Depends on:**

- [SSP-002](../M0/SSP-002-node-scaffold.md) Scaffold the Node/TypeScript/Vite repo with exact pins and verify TS 7.0.2 (D-10)
- [SSP-003](../M0/SSP-003-lint-purity-ip-tests.md) Add biome.json sim-purity rules plus simPurity and ipHygiene unit tests

**Blocks:**

- [SSP-029](SSP-029-tuning-data.md) Create tuning.json vehicle.sweeper block and typed src/sim/tuning.ts
- [SSP-030](SSP-030-vehicle-model.md) Implement Bessie's kinematic bicycle model in src/sim/vehicle.ts
- [SSP-031](SSP-031-collision-primitives.md) Implement OBB, SAT and sweep sub-step primitives in src/sim/collision
- [SSP-032](SSP-032-level-map-codec.md) Add src/sim/map.ts compiled-level codec, tile/surface/collide ids and solid merge
- [SSP-035](SSP-035-world-tick-order.md) Add World, EventQueue and fixed tick order with surface grip and kerb jolts
- [SSP-044](SSP-044-input-devices.md) Implement keyboard and gamepad input producing quantised per-tick InputFrames
- [SSP-057](../M2/SSP-057-litter-field.md) Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn
- [SSP-059](../M2/SSP-059-brush.md) Implement brush.ts state machine, suction, inlet collection and fling roll
- [SSP-060](../M2/SSP-060-grime-mask.md) Implement dirt.ts grime mask, initial selection, footprint erase and Kerb Hugger
- [SSP-061](../M2/SSP-061-water-stains.md) Implement water.ts tank, spray cone, hydrant refill, stains and dog-mess splats
- [SSP-062](../M2/SSP-062-shift-dumping-timer.md) Implement shift.ts dumping FSM, 240 s timer and end-of-shift event
- [SSP-078](../M3/SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-080](../M3/SSP-080-npc-store-spawner.md) Add the NPC store, behaviour registry, spawner and phase 7 of the tick
- [SSP-081](../M3/SSP-081-npc-steering.md) Implement NPC steering: seek, flee, separation, nav paths, zebra crossing
- [SSP-159](../M5/SSP-159-audio-deps-zzfx-vendor.md) Pin jsfxr 1.4.1, vendor ZzFX buildSamples with seeded RNG, add WAV writer
- [SSP-160](../M5/SSP-160-dsp-kernels.md) Build the shared DSP kernels in tools/audio/synth (oscillators, filters, envelopes, FM)
- [SSP-175](../M5/SSP-175-sfx-voice-pool.md) Implement sfx.ts playback: voice pool, variants, pitch ladder and spatial pan
- [SSP-276](../M9/SSP-276-daily-seed-picker.md) Derive the Daily Shift seed from the UTC date and pick district + modifiers

## References

- ../../TECHNICAL_DESIGN.md#73-randomness
- ../../TECHNICAL_DESIGN.md#74-determinism
- ../../TECHNICAL_DESIGN.md#2-directory-layout
- ../../TECHNICAL_DESIGN.md#4-coordinate-systems-and-units
- ../../TECHNICAL_DESIGN.md#131-actions-and-the-inputframe
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom
- ../../TECHNICAL_DESIGN.md#181-unit-tests-examples
- ../../ROADMAP.md#m1-drivable-bessie
- ../../../CLAUDE.md#3-hard-rules-non-negotiable
- ../../../CLAUDE.md#51-typescript

## Roadmap tasks covered

- `src/sim/rng.ts`: sfc32 with known-answer tests.
- Deliverable: the pure sim core: `rng.ts` (sfc32), `constants.ts` [rng, constants parts]
