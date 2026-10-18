---
id: SSP-267
title: "Measure frame time and audio memory on a mid-range phone; record M8 budget"
milestone: M8
status: todo
type: test
estimate: M
labels: [type:test, area:perf, area:platform, area:audio, size:M]
depends_on: [SSP-257, SSP-260, SSP-261, SSP-262, SSP-248, SSP-247, SSP-106, SSP-246, SSP-023, SSP-251]
blocks: [SSP-268]
---

# SSP-267: Measure frame time and audio memory on a mid-range phone; record M8 budget

**Milestone:** [M8 Touch & Mobile Web](../README.md#m8) · **Type:** test · **Size:** M · **Areas:** perf, platform, audio

## Summary

Profile the touch build on a mid-range phone in the heaviest scenes, set the M8 mobile frame-time budget from the measurements, and check decoded audio memory against the 64 MB budget. If the phone cannot hold frame rate, apply the documented mitigations or trigger ADR 0001's mobile revisit.

## Context

ROADMAP task: 'Performance check on a mid-range phone. The budget is recorded in the M8 PR.' AUDIO_DESIGN §15.1 M8: 'Decoded-memory budget checked on a mid-range phone.' AUDIO_DESIGN §12.3: decoded audio resident ≤ 64 MB (mono 48 kHz float32 ≈ 0.19 MB/s; a 3-stem district song ≈ 40 MB, plus mus.workshop ≈ 16 MB, plus SFX ≈ 4 MB); live-synth CPU ≤ 0.6 ms per render quantum.

Desktop budgets (TECHNICAL_DESIGN §17): sim 60 Hz fixed, max 5 steps per frame (below 12 fps the game runs in slow motion); ≤ 10 draw calls; zero allocations per tick; p99 frame time calibrated on the dev Mac (D-08); sim step ≤ 2 ms p99 on the dev Mac with 2,000 litter, 80 NPCs and 30 vehicles. Heavy scenes: perf.spec.ts uses Kebab Mile at night with max litter; the M7 budget check uses Civic Quarter (128×96) and a stress scene.

Open questions (the project lead decides; do not invent):
- Which device counts as 'mid-range' (model and year). If both iOS and Android are available, measure both.
- The target. The docs set no mobile fps target. Propose one from the data (e.g. p99 ≤ 33.3 ms with the 60 Hz sim intact) and record the agreed number in the M8 PR and as a new 'mobile p99 frame time' row in TECHNICAL_DESIGN §17.

Method:
- Frame time: test mode (?test=1) mutes audio and fixes the render step, so use a normal release build on an HTTPS host (see SSP-266) and sample requestAnimationFrame timestamps the same way the perf.spec.ts 'gpu' project does, via Safari Web Inspector (iOS) or chrome://inspect (Android). Put the snippet in the PR.
- Sim step time: read the __ssp timing counters perf.spec.ts uses, in a ?test=1 tab on the device (render-step fixing does not change per-step sim cost).
- Decoded audio memory: there is no browser API, and import.meta.env.DEV code is stripped from builds, so add a counter behind a new compile-time flag (proposed __SSP_PROFILE__ in vite.config define, false by default so it is tree-shaken) that sums length × numberOfChannels × 4 bytes over resident AudioBuffers and is readable from the console. Build a profile build with the flag on (e.g. SSP_PROFILE=1 npm run build) for the memory run only. Measure the peak: in a shift after the next district's song has been prefetched during the tally (AUDIO_DESIGN §12.2). No new dependency.

Runs: Puddle Lane typical play (5 min), Kebab Mile at night with max litter, Civic Quarter, and the M7 stress scene if reachable. Record p50/p95/p99 frame time, sim step time, draw calls, decoded audio MB, thermal notes, DPR / W / scale.

If the budget is missed, use the R-10 contingencies in order (ROADMAP §6): lower litter density per district, cap off-screen NPCs, reduce simulation rate for distant NPCs. Any sim change re-records replay hashes with a reason and must keep mobile and desktop on the same sim (a run is f(seed, district, input log)). Renderer-only options (e.g. skipping the sub-pixel offset on mobile) are allowed if goldens are unaffected. If it still fails, ADR 0001 revisit trigger 5 applies ('The M8 touch/mobile web build cannot hit frame rate on mid-range phones'): write the superseding-ADR proposal; do not swap renderers here.

## Scope

- A profile-flag-gated decoded-audio-bytes counter in src/audio, tree-shaken from the normal release build
- An rAF frame-time sampling snippet matching the gpu project's method, documented in the PR
- Device runs on the agreed phone(s), results tabulated in the M8 PR
- The agreed mobile budget recorded in the M8 PR and TECHNICAL_DESIGN §17; AUDIO_DESIGN §15.1 notes the memory result
- Renderer-only optimisations if needed and cheap; otherwise an ADR proposal per ADR 0001 trigger 5

## Out of scope

- Automated on-device perf tests in CI
- Replacing three.js or the renderer
- Changing desktop budgets (D-08)

## Acceptance criteria

- [ ] The M8 PR has a table of device model, OS/browser version, scene, p50/p95/p99 frame time, sim step time, draw calls and decoded audio MB for at least Puddle Lane, Kebab Mile night and Civic Quarter
- [ ] The agreed mobile p99 budget is in the M8 PR and as a row in TECHNICAL_DESIGN §17, and the measurements meet it, or an ADR proposal citing ADR 0001 trigger 5 is linked
- [ ] Peak decoded audio resident is ≤ 64 MB on the phone, or the overage and its fix are recorded
- [ ] A normal npm run build contains no trace of the counter (grep of dist/ for its identifier finds nothing)
- [ ] If any sim-affecting mitigation was applied, replay hashes were re-recorded with a stated reason and npm run test:replay passes

## Verification

- npm run build && grep -r '<counter identifier>' dist/ (expect no match)
- SSP_PROFILE=1 npm run build (profile build for the memory run)
- npm run test:e2e (perf.spec.ts ci project still ≤ 10 draw calls)
- npm run test:replay
- Manual on-device runs via Safari Web Inspector / chrome://inspect, results pasted into the M8 PR

## Dependencies

**Depends on:**

- [SSP-257](SSP-257-touch-input-device.md) Implement src/input/touch.ts producing the same InputFrame as keyboard and pad
- [SSP-260](SSP-260-touch-controls-overlay.md) Draw the touch control overlay in internal pixel space via the UI pass
- [SSP-261](SSP-261-touch-hud-adaptation.md) Adapt the HUD layout so it never sits under the thumbs in touch mode
- [SSP-262](SSP-262-touch-menus-prompts.md) Make every menu and prompt usable by tap, with touch-aware glyphs
- [SSP-248](../M7/SSP-248-perf-optimise.md) Profile and optimise until the M7 performance budgets hold
- [SSP-247](../M7/SSP-247-perf-stress-civic.md) Extend perf.spec.ts to Civic Quarter with the 2,000/80/30 stress load
- [SSP-106](../M3/SSP-106-npc-stress-budget.md) Prove the NPC budget: 80 NPCs, 30 vehicles, 2,000 litter, allocation-free
- [SSP-246](../M7/SSP-246-audio-complete-audit.md) Verify all 9 songs and 6 jingles ship, and run the full-playthrough mix pass
- [SSP-023](../M0/SSP-023-perf-baseline.md) Baseline perf.spec.ts on the dev Mac GPU and set the p99 frame-time budget (D-08)
- [SSP-251](../M7/SSP-251-itch-page.md) Prepare the itch.io page: copy, controls, rating note and screenshots

**Blocks:**

- [SSP-268](SSP-268-m8-close-release.md) Close M8: verify exit criteria, ship the mobile web update, tag m8

## References

- ../../TECHNICAL_DESIGN.md#17-performance-budgets
- ../../TECHNICAL_DESIGN.md#186-e2e
- ../../TECHNICAL_DESIGN.md#202-vite-configuration
- ../../AUDIO_DESIGN.md#122-loading-strategy
- ../../AUDIO_DESIGN.md#123-budgets
- ../../AUDIO_DESIGN.md#151-plan
- ../../ROADMAP.md#6-risk-register
- ../../ROADMAP.md#8-m0-spike-decision-log
- ../../adr/0001-tech-stack.md#5-revisit-triggers

## Roadmap tasks covered

- `Performance check on a mid-range phone. The budget is recorded in the M8 PR.`
