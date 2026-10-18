---
id: SSP-165
title: "Author the 8 game-feedback and UI SFX sources"
milestone: M5
status: todo
type: asset
estimate: M
labels: [type:asset, area:audio, area:assets, area:ui, size:M, vertical-slice]
depends_on: [SSP-161, SSP-162]
blocks: [SSP-168, SSP-192, SSP-193]
---

# SSP-165: Author the 8 game-feedback and UI SFX sources

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** asset · **Size:** M · **Areas:** audio, assets, ui · **Vertical slice**

## Summary

Write, render and review the JSON sources for the score and penalty feedback stings (complaint, combo tiers, SSP-096, coin, timer) and the three menu sounds.

## Context

AUDIO_DESIGN §5.4. Columns: engine | variants | jitter | bus | priority | voices/cooldown ms.

**Game feedback:**
- `complaint_stamp`: zzfx layers | 2 | 0 | sfx | 5 | 1/200 | rubber-stamp KA-CHUNK (60 Hz thump + woody slap at 30 ms) plus a paper rustle, 350 ms.
- `combo_tier`: zzfx layers | `x2`ᴺ, `x3`ᴺ, `x4`ᴺ, `x5`ᴺ, `bonus`ᴺ | 0 | sfx | 4 | 1/100 | ascending major arpeggio on pulse waves of 3/4/5/6 notes (the root rises a fourth per tier), 250–450 ms; bonus = two-note sparkle E6→B6, 120 ms.
- `powerup`: zzfx layers | `power`, `collect`ᴺ, `golden`ᴺ, `expire`ᴺ | 0 | sfx | 4 | 1/100 | power = rising square sweep with fast arpeggio, 500 ms; collect = cheerful 4-note triangle fanfare; golden = collect plus a shimmering high pulse, 900 ms; expire = three falling blips.
- `coin`: zzfx | 2 | 0 | **ui** | 3 | 2/60 | B5→E6 square ka-ching, 180 ms.
- `timer_warn`: zzfx | `tick`ᴺ, `final`ᴺ, `thirty`ᴺ | 0 | sfx | 5 | 1/0 | tick = 1 kHz square 60 ms; final = 1.5 kHz 80 ms; thirty = two 880 Hz beeps 90 ms apart.

**UI:**
- `ui_move`: zzfx | 1 | 0 | ui | 1 | 1/40 | 30 ms square at 1.4 kHz.
- `ui_select`: zzfx | 1 | 0 | ui | 2 | 1/80 | C6→G6, 110 ms.
- `ui_back`: zzfx | 1 | 0 | ui | 2 | 1/80 | G5→C5, 110 ms (the 'denied' double play is runtime logic).

Notes:
- `timer_warn` and `combo_tier` have **only** named variants, so the player must never pick them randomly; SSP-161 marks such IDs in sfx.json.
- Use the ± relative `mutate` only where variants > 1.
- Process: `--report`, Read the evidence, lead listening approval in the PR.

## Scope

- 8 JSON sources under `assets-src/audio/sfx/`
- Rendered outputs, sfx.json entries and WAV hashes committed
- Extend the source unit test for these IDs
- Review evidence read; lead listening sign-off

## Out of scope

- Coin count-up ladder in the tally (needs the M6 £ economy)
- Triggering (issue SSP-176)

## Acceptance criteria

- [ ] All 8 files exist: complaint_stamp, combo_tier, powerup, coin, timer_warn, ui_move, ui_select, ui_back
- [ ] `coin`, `ui_move`, `ui_select` and `ui_back` use bus `ui`; the others use `sfx`; priorities and voices/cooldown match §5.4 (unit test)
- [ ] combo_tier contains exactly the named variants x2, x3, x4, x5 and bonus, all flagged named; timer_warn contains tick, final and thirty, all named; sfx.json marks both IDs as named-only (unit test)
- [ ] The x2–x5 variants have 3, 4, 5 and 6 note layers respectively (unit test on the JSON layer counts)
- [ ] Durations within 20% of target (from `metrics.json` `variants`); a second render gives no diff; §11.5 checklist and the lead's approval in the PR

## Verification

- node tools/audio/render-sfx.ts --report
- Read build/audio-report/<name>.spec.png and <name>.wave.png for the 8 IDs
- npm test -- tests/unit/audio
- npm run assets:verify

## Dependencies

**Depends on:**

- [SSP-161](SSP-161-render-sfx-core.md) Implement render-sfx.ts: SFX JSON to WAV sprites, ffmpeg encodes and sfx.json
- [SSP-162](SSP-162-audio-review-report.md) Add --report review evidence: spectrograms, waveforms, metrics, listening page

**Blocks:**

- [SSP-168](SSP-168-audio-verify-coverage.md) Wire audio into assets:verify and add SFX coverage and reference tests
- [SSP-192](../M6/SSP-192-mercury-tally.md) Rebuild TallyScene as the Muckleford Mercury front page with mercury_tally golden
- [SSP-193](../M6/SSP-193-workshop-liveries.md) Build WorkshopScene with upgrade purchases and Bessie livery ramp swaps

## References

- ../../AUDIO_DESIGN.md#54-full-sfx-list
- ../../GDD.md#102-combo-chain
- ../../AUDIO_DESIGN.md#115-review-evidence-what-claude-reads-before-accepting-audio

## Roadmap tasks covered

- Author all 32 SFX JSON sources, with variants and `pitchJitterCents`. (8 of 32: game feedback and UI)
