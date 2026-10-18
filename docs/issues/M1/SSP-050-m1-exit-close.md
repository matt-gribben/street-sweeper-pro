---
id: SSP-050
title: "Verify M1 exit criteria, run the lead handling playtest and open the Close M1 PR"
milestone: M1
status: todo
type: release
estimate: S
labels: [type:release, area:release, area:docs, area:test, size:S, vertical-slice]
depends_on: [SSP-030, SSP-037, SSP-036, SSP-042, SSP-045, SSP-047, SSP-049, SSP-048, SSP-044, SSP-046, SSP-027]
blocks: [SSP-074]
---

# SSP-050: Verify M1 exit criteria, run the lead handling playtest and open the Close M1 PR

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** release · **Size:** S · **Areas:** release, docs, test · **Vertical slice**

## Summary

Gather evidence for every M1 exit criterion and measurable check, run the full done-checklist, get the project lead's handling playtest (R-07 makes it an M1 exit requirement), re-score the risk register, and open `Close M1: Drivable Bessie` ticking each criterion with links. The lead approves the exit and the `m1` tag.

## Context

Canonical exit (ROADMAP M1): 'Bicycle model + OBB/SAT collision. Puddle Lane compiled from ASCII and rendered with procedural placeholder tiles and facades. Camera and look-ahead done. fast-check "never ends a tick inside a solid / no tunnelling at 11 m/s" passing. First replay hash committed.'

Measurable checks to evidence:
- Handling unit tests: 6.0/11.0 m/s, brake 6.0 m/s², reverse 2.5 m/s, turning circles 7.1 ± 0.2 m and 8.7 ± 0.3 m, kerb −30%
- `collision.prop.test.ts`: 10,000 scenarios, up to 17.2 m/s
- Damage unit test (4 HP per m/s above 2, restitution 0.2)
- `npm run levels` deterministic (compile twice, compare hashes), Puddle Lane 64×48, autotile covers every kerb configuration in the map
- The replay and its hash
- Camera: look-ahead ≤ 3.0 m, and 1:1 ground at ≤ 6.0 m/s at a frozen tick

Process (ROADMAP §1 principle 6, §9):
- PR titled `Close M1: Drivable Bessie`, then tag `m1` after the lead approves.
- Tick the M1 checklist in ROADMAP §4.
- Re-score the risk register (at least R-07, R-09, R-02).
- Record any open questions resolved during M1 in their owning docs: wheel geometry, REV controls, drag sign, hash32, map units, markings layer, `;` grip, prop footprints, the audio no-source behaviour in `npm run assets`, districts.json, tile IDs vs ENTITY_CATALOG, asphalt variant count.

`npm run ci` runs everything both CI jobs run plus `assets:verify` and `assets:lint` (TECHNICAL_DESIGN §19). `assets:verify` joins CI in M4 (ROADMAP §5.2); use `npm run ci` as M0 defined it and state in the PR which checks are stubs or not yet in CI.

The definition of done (ROADMAP §1.1 / CLAUDE.md §8) requires reporting which checks ran.

R-07: if the lead finds the handling sluggish rather than satisfyingly heavy, iterate in tuning.json (re-recording the replay hash with a reason) before closing. The contingency levers are softer full-hopper penalties, a higher steer rate and slight drift assist.

## Scope

- Run `npm run ci` plus test:visual and test:replay on the dev Mac; collect outputs
- Evidence table in the Close M1 PR linking tests, the replay file, the compiled level, and the frozen-tick capture(s) (opened with Read)
- Lead playtest session notes (keyboard and gamepad) and any resulting tuning commits
- ROADMAP updates: M1 checklist ticked, risk register re-scored; owning docs updated for resolved open questions

## Out of scope

- Starting M2 work
- Creating the git tag without the lead's approval

## Acceptance criteria

- [ ] Every canonical exit criterion and measurable check in ROADMAP M1 is ticked in the PR with a link to its proof
- [ ] `npm run ci` exits 0 on the dev Mac, and the PR states which checks are stubs or not yet in CI per the §5.2 ramp
- [ ] The lead's playtest feedback is recorded in the PR; any tuning changes are in tuning.json, with GDD §7 mirrored and the replay re-recorded with a reason
- [ ] The risk register is re-scored and the M1 checklist items are ticked in docs/ROADMAP.md
- [ ] `npm run dev` launches a drivable Puddle Lane

## Verification

- npm run ci
- npm run test:visual
- npm run levels  (twice, compare shasum)
- npm run test:replay
- npm run dev  (lead playtest)

## Dependencies

**Depends on:**

- [SSP-030](SSP-030-vehicle-model.md) Implement Bessie's kinematic bicycle model in src/sim/vehicle.ts
- [SSP-037](SSP-037-collision-property-tests.md) Add fast-check collision properties: never inside a solid, no tunnelling at 17.2 m/s
- [SSP-036](SSP-036-static-collision.md) Resolve Bessie against static geometry with impact damage and TOWED stub
- [SSP-042](SSP-042-puddle-lane-level.md) Author Puddle Lane map.txt and level.json (64×48) and commit compiled output
- [SSP-045](SSP-045-render-ground-city.md) Render compiled levels: chunked ground layer and full cityMesh cell merge
- [SSP-047](SSP-047-camera-lookahead-zoom.md) Drive camera look-ahead and speed zoom from Bessie's real speed
- [SSP-049](SSP-049-m1-drive-replay.md) Record and commit the m1_drive_puddle_lane replay and its final-state hash
- [SSP-048](SSP-048-dev-panel.md) Add the F1 dev panel for live tuning, telemetry and Save replay
- [SSP-044](SSP-044-input-devices.md) Implement keyboard and gamepad input producing quantised per-tick InputFrames
- [SSP-046](SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie
- [SSP-027](../M0/SSP-027-m0-exit-close.md) Verify M0 exit criteria, complete the decision log and open the Close M0 PR

**Blocks:**

- [SSP-074](../M2/SSP-074-close-m2.md) Close M2: verify exit criteria, record decisions and tag m2

## References

- ../../ROADMAP.md#m1-drivable-bessie
- ../../ROADMAP.md#11-definition-of-done-every-task-every-milestone
- ../../ROADMAP.md#52-test-and-verification-ramp
- ../../ROADMAP.md#6-risk-register
- ../../ROADMAP.md#9-changing-this-roadmap
- ../../ROADMAP.md#1-planning-principles
- ../../TECHNICAL_DESIGN.md#19-ci
- ../../../CLAUDE.md#8-definition-of-done

## Roadmap tasks covered

- `Exit criteria (canonical): Bicycle model + OBB/SAT collision. Puddle Lane compiled from ASCII and rendered ... Camera and look-ahead done. fast-check ... passing. First replay hash committed.`
- `Measurable checks table (Handling, Collision, Damage, Level compile, Replay, Camera) evidence`
- `R-07: The M1 exit requires a lead playtest`
