---
id: SSP-109
title: "Close M3: verify the exit criteria, sync docs, state the frozen entity list, tag m3"
milestone: M3
status: todo
type: release
estimate: S
labels: [type:release, area:docs, area:release, area:test, size:S, vertical-slice]
depends_on: [SSP-106, SSP-107, SSP-108, SSP-105, SSP-103, SSP-102, SSP-285, SSP-286, SSP-287, SSP-288, SSP-289, SSP-290, SSP-299]
blocks: [SSP-158, SSP-293, SSP-294, SSP-295]
---

# SSP-109: Close M3: verify the exit criteria, sync docs, state the frozen entity list, tag m3

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** release · **Size:** S · **Areas:** docs, release, test · **Vertical slice**

## Summary

Open the `Close M3: Living Street` PR, ticking each canonical exit criterion and measurable check with linked evidence, recording M3 tuning decisions and resolved open questions in the owning docs, re-scoring the risk register, and stating the frozen Mon–Tue entity list M4 builds on. Tag `m3` after approval.

## Context

Canonical exit criteria: 'All §7.3 NPC behaviours for Mon–Tue types, traffic lane graph, knockables, hazards, penalties, complaints, SACKED and TOWED states, reaction animations (placeholders allowed).'

Evidence to link: one test file per behaviour; penalties.test.ts; complaints.rules.test.ts; m3_sacked.json and m3_towed.json; stress-scene heap and step-time results; determinism.prop.test.ts; tickOrder.test.ts; placeholder contact sheets and zoo screenshot; the Puddle Lane screenshot from SSP-103; both par reports.

Process (ROADMAP §1 principle 6): a PR titled `Close M3: Living Street`, then git tag `m3`. The project lead (human) approves milestone exits; Claude proposes. Definition of done: ROADMAP §1.1 / CLAUDE.md §8.

Docs to sync (owner first):
- ENTITY_CATALOG §17: Q2, Q3, Q4, Q7 resolved; Q10 M3 values recorded; any proposals made by M3 issues (horn-spam re-arm, splash counting, second knockable hit, dog hit, broken-glass scoring, footprints) recorded in the owning tables.
- GDD §11.3 (TOWED rounding, fail precedence) and §20: Q5 (shift map does not pause; leave unless changed) and Q11 (6 m aware vs 4 m sidestep confirmed).
- LEVEL_DESIGN Q7 (Mon–Tue initial values) and §10.4 peak estimation method.
- TECHNICAL_DESIGN: any new RNG stream (`pickups`), early-ending replays, the §9.4 lead-tangle row.
- ROADMAP §6: re-score the risk register (R-10 with the stress numbers, R-13). ROADMAP §5.1: confirm all M3 'P' rows exist.

State the frozen Mon–Tue entity list explicitly (M3 → M4 dependency). Note adjacent issues found but not fixed, e.g. GDD §16.2 tutorial beats 9–11 (cat, Doris, first complaint) are marked proposed M2–M3 but are in no milestone checklist.

GDD §16.2 tutorial beats (including 9–11) are implemented in M3 by SSP-290. Verify them at close instead of listing them as an unowned gap. Also check that the M3 UI issues are done: SSP-285, SSP-286, SSP-287, SSP-288, SSP-289, and the review-only ZooScene SSP-298.

## Scope

- Run `npm run ci` and attach the results.
- PR description with an evidence link per criterion and measurable check.
- Apply the doc updates listed in Context.
- Re-score the risk register.
- Tag m3 after the lead approves.

## Out of scope

- New features.
- Vertical slice gate judgements (after M4/M5).

## Acceptance criteria

- [ ] `npm run ci` exits 0 on the dev Mac.
- [ ] Every canonical exit criterion and M3 measurable-check row in the PR links passing evidence.
- [ ] ENTITY_CATALOG, GDD, LEVEL_DESIGN and TECHNICAL_DESIGN contain no open item marked 'Resolve in M3' without a recorded resolution or a deferral note.
- [ ] ROADMAP §6 risk scores are updated with a note per changed row.
- [ ] The tag `m3` exists on the merge commit after approval.

## Verification

- npm run ci
- git tag --list m3

## Dependencies

**Depends on:**

- [SSP-106](SSP-106-npc-stress-budget.md) Prove the NPC budget: 80 NPCs, 30 vehicles, 2,000 litter, allocation-free
- [SSP-107](SSP-107-m3-replays-determinism.md) Record SACKED and TOWED replays and add the replay-determinism property test
- [SSP-108](SSP-108-penalty-table-test.md) Add the table-driven penalty and complaint test against entities.json
- [SSP-105](SSP-105-high-street-greybox.md) Author and compile the grey-box High Street (80×60) for Tuesday's NPCs
- [SSP-103](SSP-103-render-actors-traffic.md) Draw NPCs, animals, traffic, knockables and hazards with state-driven frames
- [SSP-102](SSP-102-fx-placeholder-particles.md) Add placeholder particles in src/render/fx.ts for dust, splash and sparkle
- [SSP-285](SSP-285-ui-panels-9slice.md) Implement src/ui/panels.ts 9-slice panels and button states with placeholder panel grids
- [SSP-286](SSP-286-menu-navigation.md) Implement src/ui/menus.ts: keyboard, gamepad and mouse menu navigation plus input-device glyphs
- [SSP-287](SSP-287-pause-overlay.md) Add PauseOverlay: Esc/P/Start, visibilitychange auto-pause, dimmed world, Resume/Restart/Controls/Retire
- [SSP-288](SSP-288-popups-speech-bubbles.md) Add src/ui/popups.ts: world-space score/penalty popups and NPC speech bubbles
- [SSP-289](SSP-289-pam-radio-panel.md) Add Big Pam's HUD radio panel with a one-at-a-time bark queue and inline key glyphs
- [SSP-290](SSP-290-tutorial-beats.md) Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events
- [SSP-299](SSP-299-hud-brush-tidy-arrows.md) Add the Brush-o-meter, brush state ring, district name with Tidy % bar, and off-screen depot/hydrant arrows to the HUD

**Blocks:**

- [SSP-158](../M4/SSP-158-m4-exit-close.md) M4 exit: no-placeholder test, full review pass and Close M4 PR
- [SSP-293](../M5/SSP-293-vs-scripted-replays.md) Record the vertical-slice replays vs_slow, vs_fast and vs_practised with a waypoint route follower
- [SSP-294](../M5/SSP-294-vs-automated-checks.md) Automate the vertical-slice technical checks: before/after captures, Puddle Lane perf and the 20-shift soak
- [SSP-295](../M5/SSP-295-vertical-slice-gate.md) Run the vertical-slice gate: VS-1..VS-10 evidence, lead playtests and the gate PR

## References

- ../../ROADMAP.md#m3-living-street
- ../../ROADMAP.md#11-definition-of-done-every-task-every-milestone
- ../../ROADMAP.md#6-risk-register
- ../../ROADMAP.md#51-asset-readiness-by-milestone
- ../../ENTITY_CATALOG.md#17-open-questions
- ../../GDD.md#20-open-design-questions
- ../../GDD.md#162-puddle-lane-first-play-script-proposed-m2m3
- ../../LEVEL_DESIGN.md#13-open-questions
- ../../../CLAUDE.md#8-definition-of-done

## Roadmap tasks covered

- `Exit (canonical): All §7.3 NPC behaviours for Mon–Tue types, traffic lane graph, knockables, hazards, penalties, complaints, SACKED and TOWED states, reaction animations (placeholders allowed).`
- `Mon–Tue entity scope (frozen at the start of M3, because M4 art depends on it) (freeze handoff)`
