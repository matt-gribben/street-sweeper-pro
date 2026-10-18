---
id: SSP-248
title: "Profile and optimise until the M7 performance budgets hold"
milestone: M7
status: todo
type: feature
estimate: L
labels: [type:feature, area:perf, area:sim, area:render, size:L]
depends_on: [SSP-247, SSP-240, SSP-241, SSP-023, SSP-197, SSP-203, SSP-204, SSP-206, SSP-209, SSP-212, SSP-215]
blocks: [SSP-253, SSP-254, SSP-267]
---

# SSP-248: Profile and optimise until the M7 performance budgets hold

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** feature · **Size:** L · **Areas:** perf, sim, render

## Summary

Profile the Civic Quarter and Kebab Mile stress runs, fix every sim hot-path allocation, and optimise render and sim until perf.spec.ts passes all M7 budgets. Measure after the juice pass lands, so the final numbers include it.

## Context

Targets (TECHNICAL_DESIGN §17):
- p99 frame time ≤ D-08 (gpu project).
- Draw calls ≤ 10 (ci).
- Sim step within the M0-bound budget (initial target ≤ 2 ms p99).
- Zero allocations per tick in src/sim (heap-delta check).
Code rules:
- In per-tick src/sim functions: no `new`, array/object literals, closures or Array.prototype.map/filter. Scratch vectors are module-level preallocated objects (CLAUDE §5.1).
- Renderer: no per-frame `new THREE.*`, instance buffers sized to capacity once, one `needsUpdate` per batch per frame, the grime texture uploads only its dirty rect, culling via the sim spatial hash with a 4 m margin (TECHNICAL_DESIGN §12.5, §17).
- The city mesh is one BufferGeometry per district. If a district ever exceeds 250k vertices, switch to per-chunk draws (TECHNICAL_DESIGN §12.4).
R-10 contingencies (lower litter density per district, cap NPCs off-screen, sim LOD for distant NPCs) CHANGE SIM BEHAVIOUR. They need the lead's approval, regenerated replay hashes with the reason in the commit, and GDD/LEVEL_DESIGN updates. Exhaust pure optimisations first.
Any optimisation that changes a replay hash without an intended behaviour change is a determinism bug (ROADMAP §5.3).

## Scope

- Profile both stress scenarios (Chrome performance panel and the __ssp timing counters), and list hotspots in the PR
- Remove every allocation found in per-tick sim code
- Render-side optimisations within the draw-call allocation
- Re-run perf.spec.ts (ci + gpu) and record final numbers
- Only if needed and approved: an R-10 contingency, with replay re-recording and doc updates

## Out of scope

- Raising the budgets (needs a ROADMAP/TECHNICAL_DESIGN change approved by the lead)
- Mobile performance (M8)
- WebGPU or any renderer swap

## Acceptance criteria

- [ ] perf.spec.ts ci project passes on the Civic Quarter and Kebab Mile night stress scenes: draw calls ≤ 10 and sim step within budget
- [ ] perf.spec.ts gpu project passes p99 ≤ D-08 on the dev Mac (local run output attached to the PR)
- [ ] Heap-delta zero-allocation check passes
- [ ] npm run test:replay hashes unchanged, or re-recorded only for an approved R-10 change with the reason stated
- [ ] Final numbers recorded in the PR for the release evidence

## Verification

- npm run test:e2e
- npx playwright test tests/e2e/perf.spec.ts --project=gpu
- npm run test:replay
- npm run typecheck && npm run lint && npm test

## Dependencies

**Depends on:**

- [SSP-247](SSP-247-perf-stress-civic.md) Extend perf.spec.ts to Civic Quarter with the 2,000/80/30 stress load
- [SSP-240](SSP-240-juice-squash-popups.md) Juice pass: squash-and-stretch, combo popups and the cat roof-ride
- [SSP-241](SSP-241-juice-impact.md) Add screen shake, hit-stop and gamepad rumble with reduce-motion support
- [SSP-023](../M0/SSP-023-perf-baseline.md) Baseline perf.spec.ts on the dev Mac GPU and set the p99 frame-time budget (D-08)
- [SSP-197](../M6/SSP-197-depot-yard-level.md) Author and compile district.depot_yard with all seven Skip Run variants
- [SSP-203](../M6/SSP-203-district-high-street-final.md) Bring district.high_street to final M6 quality with collectibles and 3-star replay
- [SSP-204](../M6/SSP-204-district-gasworks.md) Author and compile district.gasworks (Wednesday, rain) with its district replay
- [SSP-206](../M6/SSP-206-district-conker-hill.md) Author and compile district.conker_hill (Thursday, wind and leaf fall)
- [SSP-209](../M6/SSP-209-district-promenade.md) Author and compile district.promenade (Friday, gusts, seagulls, Sid cameo)
- [SSP-212](../M6/SSP-212-district-kebab-mile.md) Author district.kebab_mile (Saturday night) and create the night_kebab_mile golden
- [SSP-215](../M6/SSP-215-district-civic-quarter.md) Author and compile district.civic_quarter, the Sunday finale map

**Blocks:**

- [SSP-253](SSP-253-browser-scaling-qa.md) Run cross-browser, scaling and storage-blocked verification for 1.0
- [SSP-254](SSP-254-release-1-0.md) Push 1.0 to itch.io with butler and tag v1.0.0 and m7
- [SSP-267](../M8/SSP-267-mobile-perf-check.md) Measure frame time and audio memory on a mid-range phone; record M8 budget

## References

- ../../TECHNICAL_DESIGN.md#17-performance-budgets
- ../../TECHNICAL_DESIGN.md#124-city-mesh-and-ground-citymeshts-groundlayerts
- ../../TECHNICAL_DESIGN.md#125-sprites-spritebatchts-spritestackts
- ../../ROADMAP.md#6-risk-register
- ../../ROADMAP.md#53-replay-hash-policy
- ../../../CLAUDE.md#51-typescript

## Roadmap tasks covered

- `Profiling and optimisation pass until budgets hold. Fix any allocation in the hot path.`
- `Exit criterion: Performance budgets met.`
