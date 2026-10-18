---
id: SSP-031
title: "Implement OBB, SAT and sweep sub-step primitives in src/sim/collision"
milestone: M1
status: done
type: feature
estimate: M
labels: [type:feature, area:sim, area:physics, area:test, size:M, vertical-slice]
depends_on: [SSP-028]
blocks: [SSP-036, SSP-089, SSP-090, SSP-092]
---

# SSP-031: Implement OBB, SAT and sweep sub-step primitives in src/sim/collision

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** feature · **Size:** M · **Areas:** sim, physics, test · **Vertical slice**

## Summary

Write the hand-rolled, deterministic collision maths that static collision is built on: oriented boxes, SAT tests against axis-aligned rects and circles that return a minimum translation vector, and the sub-step rule. Rapier stays a documented escape hatch and is not installed.

## Context

Files: `src/sim/collision/obb.ts`, `sat.ts`, `sweep.ts` (`grid.ts` belongs to SSP-036).

From TECHNICAL_DESIGN §9.2:
- Bessie's OBB is 1.75 × 3.25 m (half extents 0.875 × 1.625), centred on the body centre and rotated by heading. Vehicle local axes: +y forward, +x right. Heading 0 = north, clockwise.
- SAT against a rect uses the 2 OBB axes plus the 2 world axes. Against a circle it uses the closest-point axis. Keep the minimum-penetration axis and depth (the MTV).
- Sub-step when the per-tick displacement exceeds 0.5 tile (1.0 m): split into `ceil(d / 1.0)` steps.
- At every in-game speed (max ≈ 17.2 m/s ≈ 0.29 m/tick) Bessie needs one step. The rule is for safety and for the M3 knockables, whose extra rule ('sub-step when displacement exceeds half the smallest extent', §9.3) arrives with bodies.ts.

Requirements:
- Deterministic. No allocation per call: write results into caller-supplied or module-level scratch objects.
- Trig goes through fmath.
- Fix and document an MTV sign convention (it pushes the OBB out of the obstacle).

OBB vs OBB is needed only for traffic and parked vehicles in M3. Do not build it now: 'No engine code without a feature that needs it' (CLAUDE.md §5.1).

## Scope

- obb.ts: build an OBB from centre, heading and half extents; corners, axes and AABB into scratch
- sat.ts: OBB vs AABB rect and OBB vs circle, returning overlap boolean, MTV normal and depth
- sweep.ts: sub-step count helper `ceil(d / maxStepM)` with the 1.0 m threshold, plus pose interpolation for sub-steps
- Unit tests in tests/unit/collision.test.ts: separated, touching, overlapping, 45°-rotated, corner and edge cases, circle cases, MTV direction

## Out of scope

- OBB vs OBB (M3 traffic and parked vehicles)
- Static grid buckets and the resolution loop: SSP-036
- Solid-rect merge: SSP-032
- Knockable body sub-step rule (M3)
- Property tests: SSP-037

## Acceptance criteria

- [ ] OBB vs rect reports no overlap for separated shapes and correct depth (±1e-9) for axis-aligned overlaps
- [ ] At 45° rotation the MTV axis is the true minimum-penetration axis (checked against hand-computed fixtures)
- [ ] OBB vs circle handles corner-region contacts using the closest-point axis
- [ ] Applying the returned MTV leaves the shapes non-overlapping (penetration ≤ 1e-9 m)
- [ ] The sub-step helper returns 1 for d ≤ 1.0 m and ceil(d / 1.0) above that
- [ ] Code review confirms no allocations in the per-call paths (scratch objects are module-level or caller-supplied)

## Verification

- npm run typecheck
- npm run lint
- npm test -- collision

## Dependencies

**Depends on:**

- [SSP-028](SSP-028-sim-foundations.md) Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type

**Blocks:**

- [SSP-036](SSP-036-static-collision.md) Resolve Bessie against static geometry with impact damage and TOWED stub
- [SSP-089](../M3/SSP-089-traffic-lane-following.md) Implement traffic.ts: lane following, queuing behind Bessie, honk, Road Rage, bus stops
- [SSP-090](../M3/SSP-090-traffic-parked-collision.md) Add parked cars and Bessie-vs-vehicle collision with dent and impact rules
- [SSP-092](../M3/SSP-092-knockable-bodies.md) Implement bodies.ts knockable impulse bodies with spills and penalties

## References

- ../../TECHNICAL_DESIGN.md#9-collision
- ../../TECHNICAL_DESIGN.md#92-vehicle-vs-static-phase-3
- ../../TECHNICAL_DESIGN.md#4-coordinate-systems-and-units
- ../../ENTITY_CATALOG.md#32-collision-responses
- ../../ROADMAP.md#7-not-now-list

## Roadmap tasks covered

- `src/sim/collision/obb.ts`, `sat.ts`, `grid.ts` (static collision grid from the compiled level), `sweep.ts` (sub-step when speed > 0.5 tile/tick). [obb, sat, sweep parts]
- `Exit criteria: OBB/SAT collision`
