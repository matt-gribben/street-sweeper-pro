---
id: SSP-294
title: "Automate the vertical-slice technical checks: before/after captures, Puddle Lane perf and the 20-shift soak"
milestone: M5
status: todo
type: test
estimate: L
labels: [type:test, area:test, area:perf, size:L, vertical-slice]
depends_on: [SSP-023, SSP-073, SSP-104, SSP-107, SSP-109, SSP-158, SSP-293]
blocks: [SSP-295]
---

# SSP-294: Automate the vertical-slice technical checks: before/after captures, Puddle Lane perf and the 20-shift soak

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** test · **Size:** L · **Areas:** test, perf · **Vertical slice**

## Summary

Build the automated evidence for three gate rows. VS-1: before/after frames at one camera position. VS-7: perf.spec.ts on the slice, with p99 within D-08 in the local gpu project and ≤ 10 draw calls in ci. VS-8: 20 consecutive automated 240 s shifts on random seeds with no console errors and no invariant failures.

## Context

ROADMAP §3.4:
- VS-1: 'A before/after capture at the same camera position shows grime cleared along the driven route.' Proof: two `?test=1&freeze=1` frames attached to the gate PR.
- VS-7: '`perf.spec.ts` meets the p99 frame-time budget calibrated in M0 (D-08) in the local `gpu` project, with ≤ 10 draw calls in the `ci` project.' Proof: `npm run test:e2e` plus a local gpu run.
- VS-8: '20 consecutive automated 240 s shifts on random seeds produce no console errors and no invariant failures.' Proof: `npm run test:replay` plus an e2e soak.

Test hooks (TECHNICAL_DESIGN §18.5): `?test=1&seed=<n>&scene=district.puddle_lane&freeze=1`, `__ssp.step(n)`, `__ssp.state()`, `readFrame()` (W×270 palette-mapped RGBA), `setCamera(x, y, h)`, and the input-injection hook `__ssp.loadInputs(base64)` added by SSP-073. Test mode mutes audio.

VS-1 spec (e.g. `tests/e2e/vsBeforeAfter.spec.ts`):
1. Load seed 1 frozen, and pin the camera on a section of the vs_slow route.
2. Capture frame A.
3. Load vs_slow's inputs and step to a tick before the shift ends (e.g. 14,000), so the scene is still ShiftScene and not the tally.
4. Pin the same camera and capture frame B.
5. Assert from state() that grime cleaned > 0, and that A and B differ inside the route area.
6. Write both PNGs (pngjs) under test-results/ for the gate PR, and open them with Read.

VS-7: TECHNICAL_DESIGN §18.6 defines the two Playwright projects. `ci` (SwiftShader) asserts only draw calls ≤ 10 (`renderer.info`, autoReset=false) and sim step time. `gpu` (headed, no SwiftShader, local only, never in CI) asserts p99 from rAF timestamps against D-08. The final dense perf scenes (Kebab Mile, Civic Quarter) do not exist until M6/M7. Add a Puddle Lane full-slice scenario with all M3 street life, a shift's litter and the HUD on screen, using the real M4 art. Keep the M0 scenario.

VS-8:
(a) Replay project: a soak test runs 20 consecutive full shifts in Node on random seeds. Generate the seeds in the test, log them, and allow an env override such as `SSP_SOAK_SEEDS` so failures can be reproduced. Drive the shifts with the route follower from SSP-293, which is closed-loop and so adapts to each seed. Assert the TECHNICAL_DESIGN §18.2 invariants every tick: hopper LU ≤ capacity; water ≥ 0; HP in [0, 100]; Tidy % in [0, 1]; Bessie never inside a solid by more than 0.001 m. Also assert that each shift reaches an end state (shift end, SACKED or TOWED).
(b) e2e soak: 20 shifts in the browser on random seeds, with a console-error listener, each run to the tally. Prefer consecutive shifts in one page session (tally → retry) to catch leaks across shifts. If retry cannot take a new seed through the test hooks, navigate fresh for each shift and say so in the PR.
Record the runtimes. If the soak is too slow to run on every `npm run test:replay`, propose a tag or flag in the PR, but the gate run must execute it.

The binding sim-step number and the heap threshold come from M0 (TECHNICAL_DESIGN §17; the heap threshold from SSP-292).

## Scope

- tests/e2e/vsBeforeAfter.spec.ts, producing the two VS-1 frames as PNGs plus assertions
- perf.spec.ts: a Puddle Lane full-slice scenario in the ci project (draw calls ≤ 10, sim step time) and in the gpu project (p99 vs D-08)
- Replay-project soak test: 20 random-seed full shifts with per-tick invariants and logged seeds
- e2e soak spec: 20 consecutive browser shifts with no console errors
- TECHNICAL_DESIGN §18.6 updated to name the Puddle Lane perf scenario and the soak specs

## Out of scope

- The VS-3/VS-6 replays (SSP-293)
- Performance optimisation if a budget fails (raise a follow-up; the gate stays open)
- The Civic Quarter and Kebab Mile stress scenarios (SSP-247)
- Lead judgements and the gate PR (SSP-295)

## Acceptance criteria

- [ ] The vsBeforeAfter spec passes: state() shows grime cleaned > 0, frames A and B (same setCamera) differ inside the route area, and both PNGs are written and were opened with Read
- [ ] `npm run test:e2e` runs the Puddle Lane perf scenario in the ci project and asserts draw calls ≤ 10
- [ ] `npx playwright test tests/e2e/perf.spec.ts --project=gpu` runs the Puddle Lane scenario locally and asserts p99 ≤ the D-08 budget, or the PR records the failing number for the gate
- [ ] The replay soak runs 20 full shifts on logged random seeds with zero invariant failures, and every shift reaches an end state
- [ ] The e2e soak runs 20 consecutive shifts with no console errors, and each ends on the tally
- [ ] Re-running either soak with the same seed override reproduces the same final state() values
- [ ] The gpu project is still excluded from test:e2e and ci.yml

## Verification

- npm run test:replay
- npm run test:e2e
- npx playwright test tests/e2e/perf.spec.ts --project=gpu
- npx playwright test tests/e2e/vsBeforeAfter.spec.ts

## Dependencies

**Depends on:**

- [SSP-023](../M0/SSP-023-perf-baseline.md) Baseline perf.spec.ts on the dev Mac GPU and set the p99 frame-time budget (D-08)
- [SSP-073](../M2/SSP-073-e2e-smoke.md) Add smoke.spec.ts: 60 s scripted sweep and full shift ending on the tally
- [SSP-104](../M3/SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up
- [SSP-107](../M3/SSP-107-m3-replays-determinism.md) Record SACKED and TOWED replays and add the replay-determinism property test
- [SSP-109](../M3/SSP-109-close-m3.md) Close M3: verify the exit criteria, sync docs, state the frozen entity list, tag m3
- [SSP-158](../M4/SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-293](SSP-293-vs-scripted-replays.md) Record the vertical-slice replays vs_slow, vs_fast and vs_practised with a waypoint route follower

**Blocks:**

- [SSP-295](SSP-295-vertical-slice-gate.md) Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR

## References

- ../../ROADMAP.md#34-acceptance
- ../../TECHNICAL_DESIGN.md#186-e2e
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../TECHNICAL_DESIGN.md#182-property-tests
- ../../TECHNICAL_DESIGN.md#17-performance-budgets
- ../../ROADMAP.md#8-m0-spike-decision-log

## Roadmap tasks covered

- `VS-1 before/after frames`
- `VS-7 Performance (perf.spec.ts gpu p99 + ci draw calls)`
- `VS-8 Stability (20 consecutive automated 240 s shifts)`
