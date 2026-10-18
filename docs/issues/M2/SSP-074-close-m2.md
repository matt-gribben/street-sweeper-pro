---
id: SSP-074
title: "Close M2: verify exit criteria, record decisions and tag m2"
milestone: M2
status: todo
type: release
estimate: S
labels: [type:release, area:release, area:docs, area:test, size:S, vertical-slice]
depends_on: [SSP-072, SSP-073, SSP-070, SSP-066, SSP-067, SSP-071, SSP-050, SSP-284]
blocks: []
---

# SSP-074: Close M2: verify exit criteria, record decisions and tag m2

**Milestone:** [M2 Sweeping Core](../README.md#m2) · **Type:** release · **Size:** S · **Areas:** release, docs, test · **Vertical slice**

## Summary

Prove every M2 exit criterion with evidence, confirm the M2-owned design decisions in their owning docs, get the lead's first-playable playtest, open the `Close M2: Sweeping Core` PR and tag `m2` after approval.

## Context

Canonical exit criteria (ROADMAP M2): 'Brush (gutter, suction, inlet), LitterField, grime mask, Tidy %, hopper weight, depot and skip dumping, water spray and hydrants, fling mechanic, combo, basic HUD. A complete 240 s shift with tally numbers on screen.' Measurable checks: brush geometry, fling property, Tidy % unit test, hopper, dumping, water, combo, full shift (smoke + full-shift replay), budget (2,000-item zero-allocation heap test).
Process (ROADMAP §1, §1.1 DoD, CLAUDE.md §8): a PR titled `Close M2: Sweeping Core` ticks each criterion and checklist item and links its evidence (test names, replay files, frame PNGs, CI log); the lead approves; then git tag `m2`. Run `npm run ci` (typecheck, lint, test, test:replay, test:visual, test:e2e, assets:verify, assets:lint).
Playtest: M2 is first playable; Pillars 1 and 3 are first tested. Ask the lead to play at least one full 240 s shift and record notes (is the clean visible? does slow vs fast feel like a choice?). Tuning changes go to `src/data/tuning.json` with replay hashes regenerated and reasons given; tunables are not blockers for closing.
Preview build (ROADMAP §2.2): from M2, `npm run build` → `dist/` shared privately with the lead.
Risk register (ROADMAP §6): re-score at close, especially R-08 (thorough vs fast dominant strategy) and R-10 (litter/grime performance), and R-07 if full-hopper handling feels sluggish.
M2-owned open questions to confirm resolved in their owning docs (each implementing issue should already have done so): GDD §20 Q2 (single-pass grime), Q3 (style bonuses neither multiply nor extend), Q4 (chain frozen during dump), Q10 (no pay-out for undumped LU); Q8 (dust coughing resets the chain) is listed as M2 but dust arrives in M3, so move its owner to M3. LEVEL_DESIGN §13 Q3 (timer start) and Q4 (frontage widths). ENTITY_CATALOG §17 Q5, Q8 and the stain spray times in §5/§17 Q10. ART_BIBLE §17 'HUD layout details (M2)'.
Doc discrepancy to raise with the lead: AUDIO_DESIGN §15.1 lists placeholder M2 sounds (pickup_small with pitch ladder, hopper_full, dump, brush_lower/raise, spray noise), but the ROADMAP M2 checklist has no audio task and defers the pitch rise to M5. ROADMAP owns milestones: either add a task or align AUDIO_DESIGN §15.1.

## Scope

- Run the full DoD and collect evidence for every exit criterion and measurable check
- Lead playtest notes and tuning follow-ups recorded
- Update ROADMAP M2 checklist ticks, risk register scores, and resolved open questions in GDD, LEVEL_DESIGN, ENTITY_CATALOG, ART_BIBLE
- Raise the AUDIO_DESIGN §15.1 vs ROADMAP discrepancy
- Open the `Close M2: Sweeping Core` PR; tag `m2` after approval; produce the private preview build

## Out of scope

- Any new feature work
- M3 tasks
- Public release or itch.io upload

## Acceptance criteria

- [ ] `npm run ci` exits 0 on the dev Mac
- [ ] The close PR lists every canonical exit criterion and measurable check with a link to its evidence
- [ ] Lead playtest notes for at least one full 240 s shift are recorded in the PR
- [ ] All M2-owned open questions are marked resolved (or re-assigned with a reason) in their owning docs
- [ ] Risk register rows R-07, R-08, R-10 are re-scored with a note
- [ ] `npm run build` produces `dist/` and git tag `m2` exists on the merge commit after lead approval

## Verification

- npm run ci
- npm run build
- git tag --list m2

## Dependencies

**Depends on:**

- [SSP-072](SSP-072-m2-replays.md) Record the M2 full-shift and dump-cycle replays and commit their hashes
- [SSP-073](SSP-073-e2e-smoke.md) Add smoke.spec.ts: 60 s scripted sweep and full shift ending on the tally
- [SSP-070](SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-066](SSP-066-grime-ground-shader.md) Sample the grime mask in the ground shader with incremental dirty-rect uploads
- [SSP-067](SSP-067-items-sprite-batch.md) Render litter, stains and site markers via the items instance batch
- [SSP-071](SSP-071-intro-tally-scenes.md) Add ShiftIntroScene placeholder card and numbers-only TallyScene with retry
- [SSP-050](../M1/SSP-050-m1-exit-close.md) Verify M1 exit criteria, run the lead handling playtest and open the Close M1 PR
- [SSP-284](SSP-284-boot-scene.md) Add BootScene: load atlases, fonts and the palette LUT once, then hand off to the shift flow

**Blocks:**

_None._

## References

- ../../ROADMAP.md#m2-sweeping-core
- ../../ROADMAP.md#11-definition-of-done-every-task-every-milestone
- ../../ROADMAP.md#6-risk-register
- ../../ROADMAP.md#22-releases-and-builds
- ../../ROADMAP.md#9-changing-this-roadmap
- ../../GDD.md#20-open-design-questions
- ../../LEVEL_DESIGN.md#13-open-questions
- ../../ENTITY_CATALOG.md#17-open-questions
- ../../ART_BIBLE.md#17-open-items
- ../../AUDIO_DESIGN.md#151-plan
- ../../../CLAUDE.md#8-definition-of-done

## Roadmap tasks covered

- `Exit criteria (canonical): Brush (gutter, suction, inlet), LitterField, grime mask, Tidy %, hopper weight, depot and skip dumping, water spray and hydrants, fling mechanic, combo, basic HUD. A complete 240 s shift with tally numbers on screen.`
