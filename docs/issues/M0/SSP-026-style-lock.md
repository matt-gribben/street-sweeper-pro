---
id: SSP-026
title: "Write assets-src/STYLE.md v1 locking scale, palette and people style; mirror ART_BIBLE"
milestone: M0
status: todo
type: docs
estimate: M
labels: [type:docs, area:docs, area:assets, size:M, vertical-slice]
depends_on: [SSP-021, SSP-014, SSP-024, SSP-020, SSP-008]
blocks: [SSP-027, SSP-041, SSP-051, SSP-097]
---

# SSP-026: Write assets-src/STYLE.md v1 locking scale, palette and people style; mirror ART_BIBLE

**Milestone:** [M0 Foundations & Look Spike](../README.md#m0) · **Type:** docs · **Size:** M · **Areas:** docs, assets · **Vertical slice**

## Summary

Lock the look. STYLE.md v1 records the scale sheet, Kerbside-32 with its ramps and the final night/shadow tables, the sun, the outline rule and the `ref.people_style` reference, plus the look decisions from the spike. Update ART_BIBLE (and ENTITY_CATALOG slice counts) so they mirror STYLE.md and carry no unresolved M0 TBDs.

## Context

STYLE.md v1 must contain (ROADMAP):
- Scale sheet: 16 px/m, 32x32 tiles, 32x40 facade module, 40 px storeys, and the sprite size table from ART_BIBLE §7.1 (Bessie 64x64 cell / 28x52 body, brush 96x96, humans 24x24 / figure ≤ 18x22, litter 16x16 / 8-14 px, props 32x32 per slice, pickups 16x16 / 12x12). Link the table rather than copying every row if ART_BIBLE stays the owner of the full sheet.
- Palette and ramps: link kerbside32.json as the truth for values; summarise ramps and the final night/shadow tables (D-05/D-06).
- Sun at azimuth 315°, elevation 50°.
- Outline rule: 1 px ink #0f0e12 (index 00), 4-connected, outside the silhouette, forge-applied for outline:true.
- People style reference: assets-src/ai/ref.people_style/golden.png, and the high three-quarter view.

Also record the decided look values:
- tilt (D-02); zoom (D-01; art reviews always at 1:1); base resolution (D-03); scale sign-off (D-07);
- people golden (D-04); ingest quality (D-13);
- slice counts and slice shadows (SSP-020);
- light-pool radius and shadow-length multiplier outcomes (SSP-021);
- toon thresholds (SSP-008).

CLAUDE.md §2: ART_BIBLE ⇄ STYLE.md mirror each other, and kerbside32.json is the truth for colour values. Do not copy large tables between docs: link the owner. After this lock, changing scale/palette/remaps needs an ADR (ROADMAP §1 principle 2; ADR 0002 §3.4).

Update:
- ART_BIBLE §17 open items decided in M0: the night/shadow tables, tilt, character view, speed zoom, shadow multiplier, slice counts;
- the `TBD (M0 spike)` markers in ART_BIBLE §8.6, §9.3 and §13;
- the ENTITY_CATALOG prop slice-count TBDs, if decided.
Anything not decided must be re-deferred with a named milestone and reason.

## Scope

- assets-src/STYLE.md v1
- ART_BIBLE updates: §17 open items resolved, TBD (M0 spike) markers replaced or re-deferred, mirror note to STYLE.md
- ENTITY_CATALOG slice-count TBDs updated where decided

## Out of scope

- Changing any decided value (decisions belong to their spike issues)
- TECHNICAL_DESIGN/GDD/LEVEL_DESIGN/ADR TBD updates (SSP-027)

## Acceptance criteria

- [ ] assets-src/STYLE.md exists, marked v1 with a date, covering the scale sheet, palette/ramps (linking kerbside32.json), night/shadow tables, sun 315°/50°, outline rule, the people style reference and the decided look values
- [ ] `grep -n 'TBD (M0 spike)' docs/ART_BIBLE.md docs/ENTITY_CATALOG.md` returns only items explicitly re-deferred with a named milestone and reason (ENTITY_CATALOG's legend definition of the marker excepted)
- [ ] STYLE.md and ART_BIBLE state the same value for every locked number (spot-check table in the PR)
- [ ] Every hex in STYLE.md matches kerbside32.json
- [ ] `npm test` (ipHygiene) still passes

## Verification

- grep -n 'TBD (M0 spike)' docs/ART_BIBLE.md docs/ENTITY_CATALOG.md
- npm test
- Manual cross-check of STYLE.md numbers vs ART_BIBLE §3.1/§7.1 and kerbside32.json (table in the PR)

## Dependencies

**Depends on:**

- [SSP-021](SSP-021-night-shadow-tuning.md) Tune night[32] and shadow[32] remap tables in the spike scene (D-05, D-06)
- [SSP-014](SSP-014-people-style-acceptance.md) Accept ref.people_style and ingest the spike pedestrian grid (D-04, D-13)
- [SSP-024](SSP-024-look-decisions.md) Decide speed zoom, vehicle tilt, 480x270 base and scale sheet (D-01, D-02, D-03, D-07)
- [SSP-020](SSP-020-lamp-post-stack.md) Prototype a 4-slice sprite-stack lamp post and add it to lean_quadrants (D-02 input)
- [SSP-008](SSP-008-blender-bessie.md) Port the probe sweeper onto rig.py and commit Bessie body, dented and brush renders

**Blocks:**

- [SSP-027](SSP-027-m0-exit-close.md) Verify M0 exit criteria, complete the decision log and open the Close M0 PR
- [SSP-041](../M1/SSP-041-placeholder-facades-roofs.md) Add placeholder facade modules, facade sets and roof surfaces for Puddle Lane
- [SSP-051](../M2/SSP-051-placeholder-litter-sprites.md) Author placeholder grids for all 15 litter IDs and add the items atlas
- [SSP-097](../M3/SSP-097-placeholder-human-grids-mon.md) Author placeholder grids for the six Monday human NPCs (24×24, 13 frames/dir)

## References

- ../../ART_BIBLE.md#31-locked-world-scale
- ../../ART_BIBLE.md#71-size-sheet-locked
- ../../ART_BIBLE.md#57-shadow-and-night-remaps-intent
- ../../ART_BIBLE.md#63-the-outline-rule
- ../../ART_BIBLE.md#86-props
- ../../ART_BIBLE.md#17-open-items
- ../../adr/0002-ai-authored-asset-pipeline.md#34-locks-that-come-before-any-asset-is-generated-m0
- ../../../CLAUDE.md#2-where-truth-lives

## Roadmap tasks covered

- `assets-src/STYLE.md` v1: scale sheet (16 px/m, 32×32 tiles, 32×40 facade module, sprite size table), palette and ramps, sun at azimuth 315° and elevation 50°, outline rule, people style reference. ART_BIBLE.md mirrors it.
