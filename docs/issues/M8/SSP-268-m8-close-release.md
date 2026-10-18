---
id: SSP-268
title: "Close M8: verify exit criteria, ship the mobile web update, tag m8"
milestone: M8
status: todo
type: release
estimate: S
labels: [type:release, area:release, area:docs, area:platform, size:S]
depends_on: [SSP-265, SSP-266, SSP-267, SSP-258, SSP-261, SSP-262, SSP-263, SSP-254, SSP-250]
blocks: []
---

# SSP-268: Close M8: verify exit criteria, ship the mobile web update, tag m8

**Milestone:** [M8 Touch & Mobile Web](../README.md#m8) · **Type:** release · **Size:** S · **Areas:** release, docs, platform

## Summary

Assemble the evidence for each canonical M8 exit criterion, update the owning docs and risk register, push the mobile-ready build to the public itch.io page, and open the 'Close M8: Touch & Mobile Web' PR for the project lead to approve, then tag m8.

## Context

Canonical exit criteria (ROADMAP M8, quote unchanged): 'Touch controls, adaptive width on phones (landscape), audio unlock on iOS Safari verified'. Evidence map:
- Touch controls → touch.test.ts, the m8_touch_drive replay (SSP-258), the touch_hud golden, the mobile Playwright spec (SSP-265), device checklist row 8 (SSP-266).
- Adaptive width on phones (landscape) → upscale unit tests and the scale_phone golden (SSP-255), the mobile spec's W = 584 assertion, the rotate_prompt golden and portrait e2e, device checklist rows 7 and 9.
- Audio unlock on iOS Safari verified → unlock.test.ts plus device checklist rows 1–6.
- Plus the mobile performance budget and audio-memory table (SSP-267), required by the M8 task list.

Process (ROADMAP §1 principle 6, §9): a milestone closes with a PR titled 'Close M8: Touch & Mobile Web' that ticks each criterion and links its evidence, followed by git tag m8. The lead approves. The risk register is re-scored at every close: R-16 retired or re-scored with a note (retired risks stay in the table); revisit R-10 in light of phone results. Check the definition of done (ROADMAP §1.1 / CLAUDE.md §8).

Release: ROADMAP §2.2 'Mobile web update — From M8 — Public — Same itch.io page'. TECHNICAL_DESIGN §20.3 checklist: npm run ci green → npm run build → manual smoke on Chrome, Firefox, Safari and Edge (keyboard + gamepad, confirming no desktop regression) → butler push dist <itch-user>/street-sweeper-pro:html5 --userversion <version> → tag vX.Y.Z on main. The docs do not set the version; propose v1.1.0 and confirm with the lead. Review the itch.io page for phones: mobile-friendly embed with landscape orientation, and a controls section listing the GDD §6.1 Touch column. Page text British English with no trademarks (ipHygiene plus a manual review, as in M7).

Docs to sync (CLAUDE.md §2, owner first): GDD §3 platforms (touch and mobile web delivered), GDD §6.1/§15.2 if details changed, TECHNICAL_DESIGN §12.1 / §13.2 / §17 / §18.4 / §18.5 / §20.3, AUDIO_DESIGN §12.4 / §15.1, ART_BIBLE §3.3 / §12.2 / §12.3, GLOSSARY, ROADMAP §5.2, README milestone status. Keep the Capacitor wrapper and portrait play on the 'not now' list (ROADMAP §7).

## Scope

- The 'Close M8: Touch & Mobile Web' PR with each exit criterion ticked and linked to its evidence
- Re-score the risk register (R-16, R-10) in ROADMAP §6
- Final doc-sync pass across GDD, TECHNICAL_DESIGN, AUDIO_DESIGN, ART_BIBLE, GLOSSARY, ROADMAP and README
- Desktop regression smoke (Chrome, Firefox, Safari, Edge; keyboard + gamepad) recorded in the PR
- butler push of the release build to the public html5 channel; itch.io page mobile settings and touch controls text
- Git tags m8 and the agreed release version (proposed v1.1.0) after lead approval

## Out of scope

- New features or fixes beyond what verification uncovers
- M9 desktop builds and modes
- Capacitor or app-store distribution

## Acceptance criteria

- [ ] The PR titled 'Close M8: Touch & Mobile Web' quotes the canonical exit criteria unchanged and links passing evidence for each (CI run, goldens, replay, mobile spec, device checklist, perf table)
- [ ] npm run ci is green on the merge commit
- [ ] The four-browser desktop smoke with keyboard and gamepad is recorded as passing
- [ ] butler push to <itch-user>/street-sweeper-pro:html5 succeeds; the public page loads and plays on a phone in landscape and on desktop in a clean browser profile
- [ ] ROADMAP §6 shows R-16 retired or re-scored with a note; owning docs reflect the shipped touch, scaling, audio and budget behaviour
- [ ] Tags m8 and the agreed version tag exist on main after the lead approves

## Verification

- npm run ci
- npm run build
- butler push dist <itch-user>/street-sweeper-pro:html5 --userversion <version>
- git tag m8 && git tag v<version> (after lead approval)

## Dependencies

**Depends on:**

- [SSP-265](SSP-265-mobile-e2e-smoke.md) Add a Playwright mobile-emulation smoke drive with real touch events
- [SSP-266](SSP-266-ios-device-verification.md) Verify audio unlock, background resume and layout on a real iPhone
- [SSP-267](SSP-267-mobile-perf-check.md) Measure frame time and audio memory on a mid-range phone; record M8 budget
- [SSP-258](SSP-258-touch-replay.md) Add the M8 replay: a Puddle Lane drive driven by scripted touch input
- [SSP-261](SSP-261-touch-hud-adaptation.md) Adapt the HUD layout so it never sits under the thumbs in touch mode
- [SSP-262](SSP-262-touch-menus-prompts.md) Make every menu and prompt usable by tap, with touch-aware glyphs
- [SSP-263](SSP-263-rotate-landscape-prompt.md) Show a 'rotate to landscape' prompt and pause the game in portrait
- [SSP-254](../M7/SSP-254-release-1-0.md) Push 1.0 to itch.io with butler and tag v1.0.0 and m7
- [SSP-250](../M7/SSP-250-butler-install.md) Install butler and record its version in TECHNICAL_DESIGN

**Blocks:**

_None._

## References

- ../../ROADMAP.md#m8-touch--mobile-web
- ../../ROADMAP.md#11-definition-of-done-every-task-every-milestone
- ../../ROADMAP.md#22-releases-and-builds
- ../../ROADMAP.md#6-risk-register
- ../../ROADMAP.md#7-not-now-list
- ../../ROADMAP.md#9-changing-this-roadmap
- ../../TECHNICAL_DESIGN.md#203-release
- ../../GDD.md#3-audience-platforms-and-rating
- ../../../CLAUDE.md#8-definition-of-done

## Roadmap tasks covered

- `Performance check on a mid-range phone. The budget is recorded in the M8 PR.`
- iOS Safari: verify `unlock.ts` on a real device, plus audio resume after the app is backgrounded.
