---
id: SSP-162
title: "Add --report review evidence: spectrograms, waveforms, metrics, listening page"
milestone: M5
status: todo
type: feature
estimate: M
labels: [type:feature, area:audio, area:tooling, size:M, vertical-slice]
depends_on: [SSP-161]
blocks: [SSP-163, SSP-164, SSP-165, SSP-167]
---

# SSP-162: Add --report review evidence: spectrograms, waveforms, metrics, listening page

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** feature · **Size:** M · **Areas:** audio, tooling · **Vertical slice**

## Summary

Claude authors audio blind, so the renderers must produce objective evidence that can be opened with the Read tool, plus a listening page for the project lead. Add a shared `--report` mode that writes per-asset spectrograms, waveforms and loudness metrics (including per-variant figures) to `build/audio-report/`.

## Context

AUDIO_DESIGN §11.5. `--report` writes into `build/audio-report/` (git-ignored, under `build/`):
- `<name>.spec.png`: `ffmpeg -i x.wav -lavfi showspectrumpic=s=1024x512:legend=1:scale=log x.spec.png`
- `<name>.wave.png`: `ffmpeg -i x.wav -lavfi showwavespic=s=1024x256:split_channels=0 x.wave.png`
- `<name>.metrics.json`: renderer data plus `ffmpeg -af ebur128=peak=true -f null -`. Fields: duration, sample peak, true peak, LUFS, DC offset, leading and trailing silence.
- `index.html`: one page with `<audio>` players for the lead's listening pass.

**Per-variant metrics:** an SFX file is a sprite of all variants (50 ms gaps), so whole-file metrics only describe the first variant's lead-in. The renderer knows each variant's offset, so `metrics.json` must also contain a `variants` array (`name`, `offsetSamples`, `durationMs`, `samplePeakDb`, `leadingSilenceMs`, `trailingSilenceMs`). The SFX authoring issues use it for the 'duration within 20%' check and for `granny_harrumph`'s 150 ms lead-in.

The songs' piano roll (`<id>.roll.png`) is added by SSP-167, so make the report module reusable by both renderers.

Commands: `node tools/audio/render-sfx.ts --only horn --report`. These flags are tool-level conveniences; the canonical npm scripts are unchanged (§11.2). Call ffmpeg through the shared helper from SSP-161 (`/opt/homebrew/bin/ffmpeg` by default).

The acceptance checklist below is copied into every audio PR; render it at the top of `index.html`:
- spectrogram and waveform opened with Read; no clicks or aliasing;
- metrics within §4.3 targets (SFX peak −1 dBFS; songs −16 LUFS ±1, TP ≤ −1 dBTP; jingles −15 LUFS short-term at the loudest point);
- song lint passes;
- duration within 20% of the §5.4 target;
- lead approval recorded in the PR.

Open: duration targets live only in AUDIO_DESIGN §5.4 prose, not in the SFX schema. Default: the report shows the per-variant durations and Claude compares them manually. Adding an optional `targetDurationMs` field would be a schema change and must be documented in AUDIO_DESIGN §5.2 in the same PR.

## Scope

- A shared report module under `tools/audio/` (e.g. `report.ts`) that render-sfx and render-music can both call
- `--report` flag on render-sfx.ts producing spec.png, wave.png and metrics.json per SFX file
- Per-variant metrics computed in TS from the sprite offsets; DC offset and leading/trailing silence in TS (define the silence threshold, e.g. −60 dBFS, in code)
- Parse ebur128 output into metrics.json
- Generate `build/audio-report/index.html` with players and the acceptance checklist

## Out of scope

- The piano-roll renderer (issue SSP-167)
- Running the report in `npm run audio`, CI or `assets:verify` (it is a dev convenience)

## Acceptance criteria

- [ ] `node tools/audio/render-sfx.ts --only horn --report` creates `build/audio-report/horn.spec.png`, `horn.wave.png`, `horn.metrics.json` and `index.html`
- [ ] `metrics.json` contains the numeric keys durationSec, samplePeakDb, truePeakDb, lufs, dcOffset, leadingSilenceMs and trailingSilenceMs, plus a `variants` array with one entry per variant (horn: bessie, two_tone, car)
- [ ] Unit test: for a synthetic sprite with known silences, per-variant leadingSilenceMs and durationMs are correct within 1 ms
- [ ] `index.html` has one `<audio>` element per rendered asset with a relative src that plays when opened from disk, and shows the acceptance checklist
- [ ] Without `--report`, nothing is written to `build/audio-report/`
- [ ] The PNGs open with the Read tool and show a labelled spectrogram and a waveform

## Verification

- node tools/audio/render-sfx.ts --only horn --report
- Read build/audio-report/horn.spec.png and build/audio-report/horn.wave.png
- npm run typecheck && npm run lint && npm test

## Dependencies

**Depends on:**

- [SSP-161](SSP-161-render-sfx-core.md) Implement render-sfx.ts: SFX JSON to WAV sprites, ffmpeg encodes and sfx.json

**Blocks:**

- [SSP-163](SSP-163-sfx-sweeping-vehicle.md) Author the 14 sweeping, hopper and vehicle SFX sources
- [SSP-164](SSP-164-sfx-props-animals-people.md) Author the 10 prop, hazard, animal and people bark SFX sources
- [SSP-165](SSP-165-sfx-feedback-ui.md) Author the 8 game-feedback and UI SFX sources
- [SSP-167](SSP-167-render-music-stems-encode.md) Render music stems, normalise loudness, lint songs, encode and write music.json

## References

- ../../AUDIO_DESIGN.md#115-review-evidence-what-claude-reads-before-accepting-audio
- ../../AUDIO_DESIGN.md#43-loudness-targets
- ../../AUDIO_DESIGN.md#112-commands

## Roadmap tasks covered

- `render-sfx.ts`: pure sample generation (no WebAudio) → 44.1 kHz 16-bit WAV → ffmpeg 9.0.2 ... (review evidence)
- `Compose the three songs and three jingles above. Listening review by the project lead (see R-04). (listening page)`
