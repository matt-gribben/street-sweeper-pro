---
id: SSP-048
title: "Add the F1 dev panel for live tuning, telemetry and Save replay"
milestone: M1
status: done
type: feature
estimate: S
labels: [type:feature, area:tooling, area:ui, size:S]
depends_on: [SSP-046, SSP-038]
blocks: [SSP-050, SSP-072, SSP-301, SSP-275]
---

# SSP-048: Add the F1 dev panel for live tuning, telemetry and Save replay

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** feature · **Size:** S · **Areas:** tooling, ui

## Summary

Add `src/debug/devPanel.ts`, a roughly 50-line panel opened with F1 in dev builds only. It live-edits `vehicle.sweeper` tuning, shows speed, steer angle and the surface under Bessie, and offers 'Save replay' to export the current input log. It is the main tool for the R-07 handling-tuning loop.

## Context

Spec (ROADMAP M1, GLOSSARY, TECHNICAL_DESIGN §18.3, §20.2):
- F1 toggles the panel (consumed by the scene layer, never reaching the sim).
- Dev builds only, behind `import.meta.env.DEV`, so it is tree-shaken from release.
- No tweakpane (ROADMAP §7 not-now list). Plain DOM.
- Live-edit tuning values.
- Show speed (m/s; mph optional, since GDD §7.2 says the HUD shows mph), steer angle and current surface.
- 'Save replay' writes the shift's recorded input log as a replay JSON (download) through replay.ts.

A DOM overlay costs no WebGL draw call. One draw call is budgeted as spare for the dev panel anyway (§12.7).

The panel edits a copy of the tuning object (from `loadTuning`) and hands it to the World at its parameter boundary (e.g. recreate or reconfigure via an explicit `setTuning`), never writing sim state directly (CLAUDE.md §3 rule 2).

OPEN (flag): live tuning edits change sim behaviour, so a replay recorded after an edit will not reproduce against the committed tuning.json. Proposal: Save replay refuses, or warns loudly, when tuning differs from the committed file. Also add a 'copy tuning JSON' action, so values found in playtests can be pasted into tuning.json, with GDD §7 updated in the same commit (R-07).

Use a unique marker string in the panel (e.g. `ssp-dev-panel`) so the release bundle can be grepped.

## Scope

- src/debug/devPanel.ts: F1 toggle, number inputs for vehicle.sweeper keys, readouts (speed, steer angle in degrees, surface name)
- Save replay (download JSON) with the tuning-diverged guard; copy-tuning-JSON action
- Dev-only import from Game/ShiftScene under import.meta.env.DEV

## Out of scope

- Settings UI or remapping (M7)
- Persisting edited tuning automatically
- Any release-build debug UI

## Acceptance criteria

- [ ] F1 opens and closes the panel in `npm run dev`; the production bundle (`npm run build`) contains no devPanel code (the marker string is absent from dist/)
- [ ] Changing max steer or top speed in the panel changes handling without a reload (the readouts show the new top speed reached)
- [ ] Readouts update every frame with speed, steer angle and surface (asphalt/pavement/grass)
- [ ] Save replay produces a file that `npm run test:replay` accepts when placed in tests/replay/replays/ (recorded with default tuning; checked locally, file not committed)
- [ ] Save replay warns or refuses when tuning differs from the committed tuning.json

## Verification

- npm run dev  (manual F1 check)
- npm run build && ! grep -r 'ssp-dev-panel' dist/
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-046](SSP-046-shift-scene-drive.md) Add a drive-only ShiftScene that loads Puddle Lane and draws an interpolated Bessie
- [SSP-038](SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner

**Blocks:**

- [SSP-050](SSP-050-m1-exit-close.md) Verify M1 exit criteria, run the lead handling playtest and open the Close M1 PR
- [SSP-072](../M2/SSP-072-m2-replays.md) Record the M2 full-shift and dump-cycle replays and commit their hashes
- [SSP-301](../M5/SSP-301-loudness-meter.md) Add the BS.1770 momentary loudness meter and limiter-engagement readout to the F1 dev panel
- [SSP-275](../M9/SSP-275-mode-plumbing.md) Add Daily Shift and Rival Sweep mode plumbing: params, timer, replay, save

## References

- ../../ROADMAP.md#m1-drivable-bessie
- ../../ROADMAP.md#6-risk-register
- ../../ROADMAP.md#7-not-now-list
- ../../TECHNICAL_DESIGN.md#183-deterministic-replay-tests
- ../../TECHNICAL_DESIGN.md#202-vite-configuration
- ../../TECHNICAL_DESIGN.md#127-draw-call-allocation
- ../../GLOSSARY.md

## Roadmap tasks covered

- `src/debug/devPanel.ts` (F1, dev builds only): live-edit tuning values, show speed, steer angle and surface.
- `Deliverable: A 50-line F1 dev panel for live tuning.`
