---
id: SSP-301
title: "Add the BS.1770 momentary loudness meter and limiter-engagement readout to the F1 dev panel"
milestone: M5
status: todo
type: feature
estimate: S
labels: [type:feature, area:audio, area:tooling, area:test, size:S, vertical-slice]
depends_on: [SSP-173, SSP-048, SSP-019]
blocks: [SSP-185, SSP-246]
---

# SSP-301: Add the BS.1770 momentary loudness meter and limiter-engagement readout to the F1 dev panel

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** feature · **Size:** S · **Areas:** audio, tooling, test · **Vertical slice**

## Summary

Add a pure `src/audio/loudness.ts` (BS.1770 K-weighting at any sample rate, 400 ms momentary loudness, limiter-engagement %). Attach a dev-only meter to the mixer's `meterTap()` and show momentary LUFS, max since reset, limiter-engaged % and a reset button in the F1 panel, so SSP-185 and SSP-246 can check the AUDIO_DESIGN §4.3 targets.

## Context

Split out of SSP-173 to keep the mixer at M. AUDIO_DESIGN §4.3: at default buses during a busy shift, the in-game mix sits at −18 to −14 LUFS momentary, with the limiter engaged < 1% of the time, 'checked with the SSP-048 meter'.
Momentary loudness per ITU-R BS.1770: K-weight each channel (a pre-filter high shelf, then the RLB high-pass), take the mean square over 400 ms, then L = −0.691 + 10·log10(Σ G_i·z_i), with G = 1 for left and right. Reference check: a 0 dBFS 1 kHz sine in one channel only reads −3.01 LUFS. Derive the coefficients for the context's actual sample rate (48 kHz and 44.1 kHz at least), not hard-coded 48 kHz values.
Runtime tap (dev builds only, behind `import.meta.env.DEV`): mixer.meterTap() output → ChannelSplitterNode → per-channel IIRFilterNode(s) with the computed K-weighting → per-channel AnalyserNode. Read the latest 400 ms on each rendered frame. AnalyserNode down-mixes multichannel input, so meter L and R separately before summing. The limiter-engaged fraction is sampled from the DynamicsCompressorNode.reduction that meterTap() exposes. 'Engaged' means reduction below a threshold you propose (e.g. −0.5 dB); document it in AUDIO_DESIGN §4.3.
The F1 panel (SSP-048, `src/debug/devPanel.ts`) shows momentary LUFS, the maximum momentary since reset, limiter-engaged % since reset, and a reset button. Under `?test=1` the null mixer's meterTap() is null and no meter nodes are created (TECHNICAL_DESIGN §14.3). Import rules (TECHNICAL_DESIGN §2.1): loudness.ts imports nothing from three, src/app or the DOM, and its tests need no AudioContext.

## Scope

- Pure `src/audio/loudness.ts`: K-weighting coefficients for any sample rate, momentary loudness over 400 ms, limiter-engagement % over reduction samples
- Dev-only meter graph on mixer.meterTap() with per-channel K-weighting and analysers
- F1 SSP-048 readout: momentary LUFS, max since reset, limiter-engaged %, reset
- Document the engagement threshold in AUDIO_DESIGN §4.3

## Out of scope

- Mixer graph, limiter and ducking (SSP-173)
- Integrated/short-term loudness of rendered files (SSP-162 uses ffmpeg ebur128)
- Mix adjustments themselves (SSP-185, SSP-246)

## Acceptance criteria

- [ ] Unit test: loudness.ts reports −3.01 ± 0.1 LUFS for a 0 dBFS 1 kHz sine in one channel (the other silent) at both 48 kHz and 44.1 kHz, and −Infinity (or a documented floor) for silence
- [ ] Unit test: the limiter-engagement function returns the correct percentage for a synthetic sequence of reduction samples around the documented threshold
- [ ] The production build contains no meter code (grep dist/ for a meter-only marker string), and `?test=1` constructs no AnalyserNode
- [ ] Manual: in `npm run dev` the F1 panel shows momentary LUFS, max and limiter % updating during a shift, and reset clears max and %; one busy-shift reading is recorded in the PR
- [ ] AUDIO_DESIGN §4.3 states the limiter-engaged threshold

## Verification

- npm test -- tests/unit/audio/loudness.test.ts
- npm run build && grep -r '<meter marker>' dist/ ; test $? -eq 1
- npm run typecheck && npm run lint
- npm run dev, open the F1 panel during a Puddle Lane shift

## Dependencies

**Depends on:**

- [SSP-173](SSP-173-mixer-buses-ducking.md) Implement mixer.ts: bus graph, limiter, settings levels and ducking engine
- [SSP-048](../M1/SSP-048-dev-panel.md) Add the F1 dev panel for live tuning, telemetry and Save replay
- [SSP-019](../M0/SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene

**Blocks:**

- [SSP-185](SSP-185-m5-exit-evidence.md) Prove the M5 exit criteria and open the 'Close M5: Sound & Music' PR
- [SSP-246](../M7/SSP-246-audio-complete-audit.md) Verify all 9 songs and 6 jingles ship, and run the full-playthrough mix pass

## References

- ../../AUDIO_DESIGN.md#43-loudness-targets
- ../../AUDIO_DESIGN.md#41-bus-graph
- ../../TECHNICAL_DESIGN.md#141-mixer-audiomixerts
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom

## Roadmap tasks covered

_None._
