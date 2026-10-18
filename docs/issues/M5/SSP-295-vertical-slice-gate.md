---
id: SSP-295
title: "Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR"
milestone: M5
status: todo
type: release
estimate: M
labels: [type:release, area:release, area:test, area:gameplay, area:docs, size:M, vertical-slice]
depends_on: [SSP-293, SSP-294, SSP-185, SSP-158, SSP-109, SSP-118, SSP-145, SSP-117, SSP-036, SSP-157]
blocks: [SSP-186, SSP-190, SSP-194, SSP-199, SSP-200, SSP-201, SSP-202, SSP-205, SSP-211, SSP-225]
---

# SSP-295: Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** release · **Size:** M · **Areas:** release, test, gameplay, docs · **Vertical slice**

## Summary

Pass the vertical-slice gate between M5 and M6. Collect evidence for every row of ROADMAP §3.4 (VS-1 to VS-10), support the lead's playtest of at least five full shifts, run the tuning loop if VS-1..VS-4 fail, and open the gate PR. M6 does not start until the lead approves it.

## Context

ROADMAP §3: the slice is 'One Monday shift in Puddle Lane, playable from the title screen to the tally and back, with every pixel and every sound on screen at 1.0 quality, running inside the 1.0 performance budgets.' It is 'a gate between M5 and M6, not a milestone of its own. M6 does not start until the slice passes.' ROADMAP M6 'Depends on: The vertical slice gate passing.'

The project lead judges the design-pillar rows after at least five full shifts; the technical rows are automated. Evidence per row:
- VS-1: the two frames from SSP-294.
- VS-2: the lead's notes, plus SSP-036's damage unit test (6 m/s → 16 HP) and the hopper-full multiplier tests.
- VS-3: vs_slow.json / vs_fast.json and the vsSlice test (SSP-293).
- VS-4: the lead's notes on Doris, the cat and a shopper.
- VS-5: `npm run assets:verify` byte-compares clean, `npm run assets:lint` passes, and every AI golden in use has a complete meta.json. List them. Probe-derived retro meta.json files with null fields fail this row (see SSP-014).
- VS-6: the lead's notes (first-time 1★, Tidy ≥ 60) plus vs_practised ≥ 92.
- VS-7: `npm run test:e2e` plus a local gpu run.
- VS-8: the replay and e2e soaks.
- VS-9: the `zoo` and `hud_specimen` goldens at pixelmatch threshold 0 (`npm run test:visual`).
- VS-10: the lead signs off a 1080p fullscreen (4×) capture of Puddle Lane (a 1920×1080 page screenshot) against ART_BIBLE §16 do/don't.

VS-5 says 'CI log'. If no GitHub remote exists yet (TECHNICAL_DESIGN §19: CI runs 'once a remote exists'), attach the full `npm run ci` log from the dev Mac and say so.

Also confirm the §3.2 'in the slice' table row by row: the flow Title → intro card (Big Pam, 2 expressions) → 240 s shift → numbers tally → retry/quit; the street-life list; and the audio list (already confirmed in Close M5, SSP-185).

Playtest support: give the lead a preview build (`npm run build`, then serve dist/, ROADMAP §2.2) and the F1 dev panel for live tuning.

Tuning loop (ROADMAP §3.4): 'If VS-1 to VS-4 fail, we iterate on tuning (`src/data/tuning.json`) and NPC behaviour before producing any more content. That loop is allowed to take as long as it needs.' Small tuning changes may land in this issue. Every intentional sim change re-records the affected replay hashes, including the vs_* replays, in the same commit with a reason (ROADMAP §5.3). Larger behaviour work goes into follow-up issues, and the gate stays open.

PR: the docs fix no title; the proposed one is 'Vertical slice gate: Puddle Lane'. The PR ticks VS-1..VS-10, each linked to its evidence. The lead's approval in the PR is the gate decision. No git tag is defined for the gate, so do not create one. Claude proposes; the lead decides.

## Scope

- Run every automated VS check and collect the outputs (test:replay, test:e2e, test:visual, assets:verify, assets:lint, the local gpu perf run)
- Audit the AI goldens in use for complete meta.json (VS-5)
- Capture the 1080p fullscreen (4×) Puddle Lane image for VS-10 and open it with Read
- Provide the preview build and a playtest-notes template covering VS-2, VS-4 and VS-6 for the lead's ≥ 5 shifts
- Tuning-loop iterations on tuning.json/NPC parameters if VS-1..VS-4 fail, with replay hashes re-recorded and reasons stated
- Gate PR with a VS-1..VS-10 evidence table and the §3.2 checklist

## Out of scope

- Any M6 content (week map, Workshop, economy, other districts, Mercury tally)
- Juice, settings and assists (M7)
- Large behaviour rewrites found by the playtest (follow-up issues)
- Creating a git tag for the gate

## Acceptance criteria

- [ ] `npm run test:replay`, `npm run test:visual`, `npm run test:e2e`, `npm run assets:verify` and `npm run assets:lint` all exit 0 on the gate commit, with the logs linked in the PR
- [ ] The PR lists every AI golden used by the slice, and no meta.json among them has a null provenance field
- [ ] The PR evidence table has a row for each of VS-1 to VS-10, each linking to its proof (frames, test names, logs, capture, lead notes)
- [ ] The lead's playtest notes record at least five full shifts and a pass/fail judgement for VS-2, VS-4, VS-6 and VS-10
- [ ] Every replay hash changed during the tuning loop has a stated reason in its commit message
- [ ] The lead's approval of the gate is recorded on the PR before any M6 issue moves to in-progress

## Verification

- npm run ci
- npm run test:replay
- npm run test:visual
- npm run test:e2e
- npx playwright test tests/e2e/perf.spec.ts --project=gpu
- npm run assets:verify && npm run assets:lint
- gh pr create --title "Vertical slice gate: Puddle Lane"

## Dependencies

**Depends on:**

- [SSP-293](SSP-293-vs-scripted-replays.md) Record the vertical-slice replays vs_slow, vs_fast and vs_practised with a waypoint route follower
- [SSP-294](SSP-294-vs-automated-checks.md) Automate the vertical-slice technical checks: before/after captures, Puddle Lane perf and the 20-shift soak
- [SSP-185](SSP-185-m5-exit-evidence.md) Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR
- [SSP-158](../M4/SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-109](../M3/SSP-109-close-m3.md) Close M3: verify the exit criteria, sync docs, state the frozen entity list, tag m3
- [SSP-118](../M4/SSP-118-zoo-scene.md) Complete ZooScene coverage and add the zoo visual golden for in-engine asset review
- [SSP-145](../M4/SSP-145-hud-specimen-golden.md) Build the hud_specimen scene and commit its visual golden
- [SSP-117](../M4/SSP-117-forge-verify-ci.md) Extend forge verify to level and M4 outputs, prove assets idempotence, fill forge pytest gaps and add verify + lint to CI
- [SSP-036](../M1/SSP-036-static-collision.md) Resolve Bessie against static geometry with impact damage and TOWED stub
- [SSP-157](../M4/SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art

**Blocks:**

- [SSP-186](../M6/SSP-186-save-v1.md) Implement versioned ssp.save.v1 store with try/catch access and v2 migration stub
- [SSP-190](../M6/SSP-190-compiler-m6.md) Extend compile-level for M6: skip_run mode, night lamp pools, landmarks, M6 events
- [SSP-194](../M6/SSP-194-audio-mus-workshop.md) Compose mus.workshop 'Tea Break' and implement the mus.workshop fallback rule
- [SSP-199](../M6/SSP-199-people-kids-jogger.md) Implement npc.jogger, npc.kid_skateboard, npc.kid_chalk and school_out/population_wave
- [SSP-200](../M6/SSP-200-dog-loose-seagull.md) Implement npc.dog_loose chase and npc.seagull chip theft and litter snatching
- [SSP-201](../M6/SSP-201-bin-lorry.md) Implement veh.bin_lorry and the bin_round event
- [SSP-202](../M6/SSP-202-rain-weather.md) Implement rain: road grip 6.0, puddle density, rain FX and amb.rain hookup
- [SSP-205](../M6/SSP-205-wind-leaves-gusts.md) Implement leaf fall, wet leaves and haz.wind_gust litter drift
- [SSP-211](../M6/SSP-211-reveller-police.md) Implement npc.reveller, kicking_out, veh.police witness rule and police_parked
- [SSP-225](../M6/SSP-225-art-world-tiles-m6.md) Art Pass 2: procedural ground tiles, hazard decals and stains for Wed-Sun

## References

- ../../ROADMAP.md#3-vertical-slice
- ../../ROADMAP.md#32-what-is-in-the-slice
- ../../ROADMAP.md#34-acceptance
- ../../ROADMAP.md#53-replay-hash-policy
- ../../ROADMAP.md#22-releases-and-builds
- ../../ART_BIBLE.md#16-do-and-dont
- ../../TECHNICAL_DESIGN.md#19-ci

## Roadmap tasks covered

- `Vertical slice gate: §3 acceptance table (VS-1 to VS-10)`
