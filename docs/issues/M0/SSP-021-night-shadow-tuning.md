---
id: SSP-021
title: "Tune night[32] and shadow[32] remap tables in the spike scene (D-05, D-06)"
milestone: M0
status: done
type: spike
estimate: M
labels: [type:spike, area:render, area:assets, size:M, vertical-slice]
depends_on: [SSP-019, SSP-020]
blocks: [SSP-022, SSP-026, SSP-114, SSP-190, SSP-210]
---

# SSP-021: Tune night[32] and shadow[32] remap tables in the spike scene (D-05, D-06)

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** spike · **Size:** M · **Areas:** render, assets · **Vertical slice**

## Summary

Use the spike scene to tune the final `night[32]` and `shadow[32]` tables in kerbside32.json against the ART_BIBLE intent. This needs a night toggle and a simple hard-edged lamp light pool, with Read-reviewed screenshots as evidence. Record D-05 and D-06 plus the light-pool radius and shadow-length multiplier outcomes. Do this before the visual goldens are recorded.

## Context

Rule (ROADMAP): every entry maps within its own ramp or to the next ramp down. Validate with the operational rule from SSP-005 (same ramp and not lighter, or a different ramp and strictly darker in OKLab L), which its pytest already enforces.

Ramps: neutral 00→07; brick/skin 08→12; skin 12,11,13,08; yellow 14→16; orange/red 19→18→17; green 21→24; blue 25→28; purple 30→31; accents 20, 29.

Intent (ART_BIBLE §5.7):
- shadow: each colour drops about two ramp steps and cools slightly; detail in shade survives (illustrative: 02→01, 05→03, 06→04, 07→05, 10→09, 15→14, 23→22, 27→26);
- night: outside light pools, shift toward navy/plum. Warm colours go to maroon/plum, neutrals drop 2-3 steps, blues stay blue, and Bessie must still be the brightest non-light object (illustrative: 02→01, 05→02, 07→04, 10→08, 15→14, 16→15, 23→21, 27→25).
Shadow is applied after night. Lit windows, headlights and lamps write the light mask (G) and are exempt from night.

D-05 test: spike scene with night active; lit areas read clearly. D-06 test: building shadows (0.84 x h, SE) and actor drop shadows (+2,+2 px) read on every ground tile type. M0 has only flat placeholder ground, so add swatches of at least 02 asphalt, 05 slab, 06 kerb and 22 grass.

Light pools: hard-edged stepped circles about 10 m across (radius ≈ 5 m, final value TBD (M0 spike)), written as G = 1 into the mask via MaxEquation, not gradients. Hang them on the lamp post from SSP-020. Keep the code minimal (fx.ts proper is M2+).

Night toggle: the documented hook params are seed/scene/tick/freeze. Propose e.g. `night=1`, and add it to the TECHNICAL_DESIGN §18.5 table (the owner) in the same change, or use a separate scene id (e.g. `lean_quadrants_night`). Do not add an undocumented param.

Also TBD (M0 spike) in ART_BIBLE §9.3/§13/§17: the shadow length multiplier for overcast and golden hour. Propose values, or re-defer explicitly with a milestone and reason.

Value reference: ART_BIBLE §5.2 OKLab L table; colours that must separate at 1x need ≥ 0.12 L difference. Evidence screenshots (from readFrame at 1x, Wx270) go under build/ (git-ignored), are attached to the PR and summarised in the log.

## Scope

- Night toggle (documented) + a simple hard-edged light pool under the lamp post
- Shadow test swatches (02/05/06/22) in the spike scene
- Iterate night[32]/shadow[32] in assets-src/palette/kerbside32.json with Read-reviewed screenshots
- Keep the forge ramp-rule pytest and SSP-016 Vitest green
- Fill in ROADMAP §8 D-05 and D-06
- Record the light-pool radius and shadow-length multiplier outcomes in the PR (for SSP-026)

## Out of scope

- Writing STYLE.md (SSP-026)
- Full fx.ts / headlight cones (M6)
- Visual goldens (SSP-022 is recorded after this)

## Acceptance criteria

- [ ] kerbside32.json night and shadow tables pass the ramp-rule pytest
- [ ] Screenshots at 1x of the spike with night off/on and with shadows over 02/05/06/22 were opened with Read and are listed in the PR
- [ ] Under night, Bessie's body colour after remap has the highest OKLab L of any non-lit pixel class in the frame (stated with the L values)
- [ ] If a night param or scene was added, TECHNICAL_DESIGN §18.5 documents it
- [ ] `npm test` and `uv run --project tools/forge pytest -k palette` pass
- [ ] ROADMAP §8 D-05 and D-06 have a Decision (tables summarised), Evidence and Date

## Verification

- uv run --project tools/forge pytest -k palette
- npm test
- Open /?test=1&scene=lean_quadrants&freeze=1 with night on/off, save readFrame PNGs to build/ and Read them

## Dependencies

**Depends on:**

- [SSP-019](SSP-019-test-hooks-lean-quadrants.md) Add ?test=1 hooks (readFrame, setCamera, freeze, stub step/state) and the lean_quadrants spike scene
- [SSP-020](SSP-020-lamp-post-stack.md) Prototype a 4-slice sprite-stack lamp post and add it to lean_quadrants (D-02 input)

**Blocks:**

- [SSP-022](SSP-022-visual-goldens.md) Add lean_quadrants and scale_1440 visual specs and goldens; prove 10-run stability (D-09)
- [SSP-026](SSP-026-style-lock.md) Write assets-src/STYLE.md v1 locking scale, palette and people style; mirror ART_BIBLE
- [SSP-114](../M4/SSP-114-ramp-swap-tables.md) Lock ramp-swap key indices and emit the 8 swap tables per atlas
- [SSP-190](../M6/SSP-190-compiler-m6.md) Extend compile-level for M6: skip_run mode, night lamp pools, landmarks, M6 events
- [SSP-210](../M6/SSP-210-night-lighting.md) Implement night: night remap with street-lamp and headlight light mask

## References

- ../../ART_BIBLE.md#57-shadow-and-night-remaps-intent
- ../../ART_BIBLE.md#52-value-reference
- ../../ART_BIBLE.md#51-the-table
- ../../ART_BIBLE.md#13-night-weather-and-time-of-day
- ../../ART_BIBLE.md#64-shadows
- ../../ART_BIBLE.md#17-open-items
- ../../TECHNICAL_DESIGN.md#126-lighting-night-and-the-palette-pass-shadowsts-fxts-palettepassts
- ../../TECHNICAL_DESIGN.md#185-test-hooks
- ../../ROADMAP.md#8-m0-spike-decision-log

## Roadmap tasks covered

- Tune `night[32]` and `shadow[32]` in the spike scene. Every entry must map within its own ramp, or to the next ramp down. Record the tables in the file and in D-05/D-06.
- `Fill in D-01 to D-13 in §8 ... [D-05, D-06]`
