---
id: SSP-037
title: "Add fast-check collision properties: never inside a solid, no tunnelling at 17.2 m/s"
milestone: M1
status: done
type: test
estimate: M
labels: [type:test, area:test, area:physics, area:sim, size:M, vertical-slice]
depends_on: [SSP-036]
blocks: [SSP-050, SSP-090]
---

# SSP-037: Add fast-check collision properties: never inside a solid, no tunnelling at 17.2 m/s

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** test · **Size:** M · **Areas:** test, physics, sim · **Vertical slice**

## Summary

Write `tests/property/collision.prop.test.ts`, the canonical M1 exit proof. Over 10,000 generated scenarios, Bessie never ends a tick inside a solid, never tunnels through a wall or bollard at speeds up to 17.2 m/s, and resolution is idempotent.

## Context

Properties (TECHNICAL_DESIGN §9.5, ROADMAP M1 measurable checks):
1. Never inside a solid: on fast-check-generated grids from 8×8 to 32×32, with random non-overlapping spawn poses and random 600-tick InputFrame sequences, Bessie's OBB never overlaps a solid rect by more than 1 mm at the end of any tick.
2. No tunnelling: from random poses aimed at a 1-tile (2 m) wall, and at a 0.3 m bollard (circle), at speeds up to 17.2 m/s, the swept centre never crosses the obstacle.
3. Idempotent: resolving an already-resolved pose moves it by less than 1e-9 m.

17.2 m/s = transit 11 m/s × Bacon Butty 1.3 × Engine L2 1.2 (= 17.16, rounded up in the docs), the real in-game maximum. That is stricter than the canonical wording 'no tunnelling at 11 m/s'. Note `topSpeedMult = 1.56` only reaches 17.16 and the throttle clamp would pull a faster initial speed down, so for property 2 set `topSpeedMult = 17.2 / 11` and set the initial vLong directly (any throttle value); say so in the test.

Total scenarios: 10,000 (the ROADMAP measurable check), split across the properties (state the split). Fix the fast-check seed in CI and print seed and path on failure. Keep the suite's runtime reasonable for `npm test` on the CI ubuntu job, and note the runtime in the PR.

Build worlds straight from generated collide grids with `mergeSolids` and `encodeLevel` from `src/sim/map.ts` plus `createWorld`, without going through the file compiler.

Do not loosen a property or the 1 mm tolerance to get green (CLAUDE.md §7). Fix the cause instead, with its own regression unit test.

## Scope

- tests/property/collision.prop.test.ts with the three properties
- fast-check arbitraries: grid maps, spawn poses outside solids, InputFrame sequences, aimed approach poses
- A small test helper that builds a World from a raw collide grid

## Out of scope

- Knockable tunnelling (M3) and fling properties (M2)
- Changing collision code beyond fixing failures this suite finds (record any fix in the PR)

## Acceptance criteria

- [ ] The three properties pass, 10,000 generated scenarios in total, with a fixed seed
- [ ] Speeds in the tunnelling property cover the full 0–17.2 m/s range, including exactly 17.2 as an explicit example
- [ ] Any failure prints the fast-check seed and path for reproduction
- [ ] The suite runs under `npm test` (Vitest property project), which the CI ubuntu job runs
- [ ] The 1 mm and 1e-9 m tolerances match TECHNICAL_DESIGN §9.5 exactly

## Verification

- npm test -- collision.prop
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-036](SSP-036-static-collision.md) Resolve Bessie against static geometry with impact damage and TOWED stub

**Blocks:**

- [SSP-050](SSP-050-m1-exit-close.md) Verify M1 exit criteria, run the lead handling playtest and open the Close M1 PR
- [SSP-090](../M3/SSP-090-traffic-parked-collision.md) Add parked cars and Bessie-vs-vehicle collision with dent and impact rules

## References

- ../../TECHNICAL_DESIGN.md#95-property-tests
- ../../TECHNICAL_DESIGN.md#182-property-tests
- ../../ROADMAP.md#m1-drivable-bessie
- ../../ROADMAP.md#52-test-and-verification-ramp
- ../../../CLAUDE.md#7-testing-expectations

## Roadmap tasks covered

- `Exit criteria: fast-check "never ends a tick inside a solid / no tunnelling at 11 m/s" passing (proved at 17.2 m/s).`
- `Measurable check (Collision): 10,000 generated scenarios, speeds up to 17.2 m/s`
