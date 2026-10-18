---
id: SSP-266
title: "Verify audio unlock, background resume and layout on a real iPhone"
milestone: M8
status: todo
type: test
estimate: S
labels: [type:test, area:audio, area:platform, area:test, size:S]
depends_on: [SSP-264, SSP-257, SSP-260, SSP-261, SSP-262, SSP-263, SSP-255, SSP-250, SSP-251, SSP-157, SSP-002]
blocks: [SSP-268]
---

# SSP-266: Verify audio unlock, background resume and layout on a real iPhone

**Milestone:** [M8 Touch & Mobile Web](../README.md#m8) · **Type:** test · **Size:** S · **Areas:** audio, platform, test

## Summary

The canonical M8 exit proof: on a real iPhone in Safari, confirm audio unlocks on the first tap, survives backgrounding and interruptions, and that the landscape layout, touch controls and rotate prompt behave. Claude prepares the HTTPS build and a step-by-step checklist; the project lead runs it on the device; results are recorded in the M8 PR.

## Context

Exit criterion (canonical, ROADMAP M8): 'Touch controls, adaptive width on phones (landscape), audio unlock on iOS Safari verified'. Key proof of exit (ROADMAP §2): 'iOS Safari audio unlock verified on device'. AUDIO_DESIGN §15.1 M8: 'iOS Safari unlock verified.' Target risk: R-16.

Human in the loop: Claude cannot operate a phone. The project lead runs device checks and approves milestone exits (R-17). Claude builds, deploys to an HTTPS URL, writes the checklist and records the results the lead reports, including device model, iOS version and date. Ask the lead for these; never invent them.

Hosting: AudioWorklet (engine and brush synths) needs a secure context, so http://<LAN-IP>:4173 from vite preview will not exercise the real audio path. Use the restricted itch.io page available from M7 (ROADMAP §2.2), pushed with butler, or another HTTPS static host the lead provides. Never push to the public channel for this test. The itch account name comes from M7 (TECHNICAL_DESIGN §20.3); ask if it is not recorded.

Checklist for the lead (pass/fail per row):
1. Cold load in Safari, landscape: Title shows, no sound until the first tap; the first tap starts mus.title (AUDIO_DESIGN §8.4 TitleScene row: starts on the first unlock gesture). No burst of queued SFX.
2. Start a Puddle Lane shift by tap only: engine, brush and spray synths audible; sfx.ui_select plays on menu taps.
3. Background Safari (home gesture) for about 10 s, return: audio resumes, stems in sync (no flamming between base/drums/lead), shift on PauseOverlay.
4. Lock the screen during a shift, unlock: same as 3.
5. Interruption (incoming call or Siri, if practical), return: audio recovers by the next tap at most, or the 'Tap for sound' prompt appears. N/A allowed with a reason.
6. Ringer/silent switch on: record whether game audio is muted (WebKit behaviour varies; informational unless the lead decides otherwise).
7. Layout: W (from __ssp.readFrame().length / 1080 in a ?test=1 tab via Safari Web Inspector), integer scale, clean #0f0e12 bars, nothing under the notch or home indicator, no zoom on double tap, no page scroll; show/hide the Safari toolbar and confirm re-layout.
8. Touch: steer while holding throttle, brush toggle, spray hold, horn, hold-to-dump at the depot bay, map and pause icons all respond; no stuck input after a system gesture.
9. Rotate to portrait: prompt shown, shift paused. Rotate back: resume works.
10. Fullscreen option hidden or disabled if unsupported, with no broken button.
Any failure becomes a bug fix with a regression test, then the failed rows are re-run.

## Scope

- Build and push a preview to an HTTPS host (the restricted itch.io page via butler)
- Write the device checklist into the M8 PR description and walk the lead through it
- Record results (device, iOS version, date, pass/fail per row, notes) in the M8 PR; update AUDIO_DESIGN §12.4/§15.1 with the verified result
- File and fix any failures (each with a test), then re-verify the failed rows

## Out of scope

- Phone performance profiling (SSP-267)
- Pushing to the public channel (SSP-268)
- Native wrappers

## Acceptance criteria

- [ ] Rows 1–4 and 7–10 are recorded as PASS on a real iPhone in Safari, with device model, iOS version and date supplied by the lead
- [ ] Row 5 is PASS or N/A with a reason; row 6 behaviour is recorded whatever the outcome
- [ ] The device-test build's __SSP_COMMIT__ (shown on the title screen) matches the commit under review
- [ ] AUDIO_DESIGN §12.4/§15.1 state the verification result; R-16 re-scoring is either done in ROADMAP §6 or noted for SSP-268

## Verification

- npm run ci (green before building the device build)
- npm run build && butler push dist <itch-user>/<restricted-project>:html5 --userversion <version> (target confirmed by the lead)
- Manual device checklist executed by the project lead; results pasted into the M8 PR

## Dependencies

**Depends on:**

- [SSP-264](SSP-264-ios-audio-unlock.md) Harden unlock.ts for iOS Safari: touchend unlock and background resume
- [SSP-257](SSP-257-touch-input-device.md) Implement src/input/touch.ts producing the same InputFrame as keyboard and pad
- [SSP-260](SSP-260-touch-controls-overlay.md) Draw the touch control overlay in internal pixel space via the UI pass
- [SSP-261](SSP-261-touch-hud-adaptation.md) Adapt the HUD layout so it never sits under the thumbs in touch mode
- [SSP-262](SSP-262-touch-menus-prompts.md) Make every menu and prompt usable by tap, with touch-aware glyphs
- [SSP-263](SSP-263-rotate-landscape-prompt.md) Show a 'rotate to landscape' prompt and pause the game in portrait
- [SSP-255](SSP-255-phone-viewport-scaling.md) Make the canvas, viewport and integer scaling phone-ready in landscape
- [SSP-250](../M7/SSP-250-butler-install.md) Install butler and record its version in TECHNICAL_DESIGN
- [SSP-251](../M7/SSP-251-itch-page.md) Prepare the itch.io page: copy, controls, rating note and screenshots
- [SSP-157](../M4/SSP-157-title-intro-tally-screens.md) Title, shift intro card and tally numbers page with final UI art
- [SSP-002](../M0/SSP-002-node-scaffold.md) Scaffold the Node/TypeScript/Vite repo with exact pins and verify TS 7.0.2 (D-10)

**Blocks:**

- [SSP-268](SSP-268-m8-close-release.md) Close M8: verify exit criteria, ship the mobile web update, tag m8

## References

- ../../ROADMAP.md#m8-touch--mobile-web
- ../../ROADMAP.md#22-releases-and-builds
- ../../ROADMAP.md#6-risk-register
- ../../AUDIO_DESIGN.md#124-unlock-and-lifecycle-unlockts
- ../../AUDIO_DESIGN.md#84-scene--audio-map
- ../../AUDIO_DESIGN.md#151-plan
- ../../TECHNICAL_DESIGN.md#203-release

## Roadmap tasks covered

- iOS Safari: verify `unlock.ts` on a real device, plus audio resume after the app is backgrounded.
- Adaptive width at phone aspect ratios: confirm `clampEven(round(270 × aspect), 432, 640)` letterboxes cleanly on 19.5:9 screens.
