---
id: SSP-184
title: "Add speech-bubble and sound captions for audio cues"
milestone: M5
status: todo
type: feature
estimate: M
labels: [type:feature, area:audio, area:ui, area:test, size:M]
depends_on: [SSP-176, SSP-142, SSP-143, SSP-144, SSP-145, SSP-288]
blocks: [SSP-239]
---

# SSP-184: Add speech-bubble and sound captions for audio cues

**Milestone:** [M5 Sound & Music](../README.md#m5) · **Type:** feature · **Size:** M · **Areas:** audio, ui, test

## Summary

Give every gameplay-relevant sound a visual equivalent: speech bubbles for character barks (the default 'Speech' mode) and bracketed sound captions with edge arrows for off-screen sources in 'Speech + sounds' mode. AUDIO_DESIGN assigns captions to M5, but the ROADMAP checklist does not list them, so confirm the milestone with the lead before starting.

## Context

**Scope note:** AUDIO_DESIGN §15.1 lists 'Captions' as an M5 deliverable. The ROADMAP M5 checklist and exit criteria do not, and the accessibility settings UI is M7. If the lead prefers, move this issue to M7.

**Settings** (§13.1): Captions Off / **Speech** (default) / Speech + sounds; Caption size **1×** / 2× (2× draws Kerbside 5×7 at double scale, or Kerbside Bold 8×8 if space is short).

**Rendering** (§13.2):
- Internal pixel space, Kerbside 5×7 font, chalk text on an ink panel with a 1 px outline. §13.2 quotes hex values, but CLAUDE.md hard rule 3 requires palette names (`chalk`, `ink`) in code; no raw hex.
- On-screen sources get a speech bubble anchored above them. Off-screen sources get a caption at the screen edge with an arrow glyph (← → ↑ ↓).
- Display time = 1.5 s + 60 ms per character, max 3 s. At most 3 captions show at once, and a newer caption replaces an older one with the same ID.

**Caption table (Speech):**
- `ped_oi` → 'Oi!', varied ('Watch it!', 'Oi, Sweepy!', 'My shoes!'), seeded from a list in `src/data/entities.json`;
- `ped_oi:cough` → '*cough cough*'; `ped_oi:tut` → 'Tut tut.';
- `granny_harrumph` → 'HMPH!' / 'Young people today!'; `:whack` → 'Take that!';
- `kid_waah` → 'WAAAH!'.

**Caption table (Speech + sounds):** [Cat yowls], [Dog barks] (with an edge arrow), [Seagull squawks], [Pigeons scatter], [Police siren] (with an edge arrow), [Car horn], [Ice cream van chimes], [Hopper full], [Water empty].

**Import rule** (TECHNICAL_DESIGN §2.1): `src/ui/**` may not import `src/audio`. Wire the director's caption cues to the UI caption manager in the composition root (`src/app`), or have the UI subscribe to the event bus with its own mapping.

**Rules:** British English, no trademarks, no reliance on colour alone. The caption RNG is presentation-side, never the sim RNG.

M3/M4 may already render NPC speech bubbles via `src/ui/popups.ts` (GDD lists 'Oi!' and 'Hmph!' bubbles). Reuse them rather than duplicating.

Any visible change needs `npm run test:visual`; read the diffs before updating goldens, and consider extending `hud_specimen`.

Ownership: SSP-288 already draws on-screen speech bubbles through a bubble manager in popups.ts. That manager implements the AUDIO_DESIGN §13.2 timing (1.5 s + 60 ms per character, max 3 s), the max-3 rule and same-ID replacement. Build the caption manager on it: extend the same manager so edge captions share the max-3 limit and replacement, and do not write a second timing implementation. This issue owns the rest of caption behaviour from AUDIO_DESIGN §13.1/§13.2: mode filtering, the Speech and Speech+sounds caption tables, edge captions with arrows, the seeded ped_oi variants, and the caption-size parameter. SSP-239 (M7) only connects the ssp.settings.v1 store to this caption manager so that changes apply live; it adds no caption logic of its own.

## Scope

- Caption manager in `src/ui/` fed by director cues via the composition root: mode filtering, timing, max-3 rule, same-ID replacement, on-screen vs edge placement with arrow
- Speech-bubble and edge-caption rendering via bitmapText/panels in palette colours by name
- Seeded caption string lists in entities.json for ped_oi variants (and the ENTITY_CATALOG mirror)
- Settings field with default 'speech' (no UI)
- Unit tests for timing and replacement; a visual golden for a bubble and an edge caption
- Caption size parameter (1× default, 2×) in the caption manager and renderer: 2× draws Kerbside 5×7 at double integer scale and falls back to Kerbside Bold 8×8 when the 2× caption does not fit the available width (AUDIO_DESIGN §13.1). Settings field only, no UI

## Out of scope

- Settings UI for captions and caption size (M7)
- M6-only sources being triggered in game (police, seagull, loose dog)
- Creating the NPC speech-bubble renderer and its timing/max-3/replacement manager (exists from SSP-288)

## Acceptance criteria

- [ ] Test: a 10-character caption shows for 2.1 s; a 40-character caption is capped at 3.0 s
- [ ] Test: with 3 captions active, a 4th distinct caption removes the oldest; a repeat of an active ID replaces it rather than stacking
- [ ] Test: in 'speech' mode, `cat_yowl` produces no caption; in 'speech+sounds' mode it produces '[Cat yowls]'
- [ ] Test: an off-screen source produces an edge caption with the arrow pointing towards the source quadrant
- [ ] No file under `src/ui/` imports `src/audio` (import scan)
- [ ] `npm run test:visual` passes with any new or updated golden reviewed via Read (expected/actual/diff) and described in the PR
- [ ] No hex colour literal is introduced in the caption code (lint/grep check)
- [ ] Test: with caption size 2×, a caption that fits is laid out at exactly twice its 1× width in Kerbside 5×7, and a caption whose 2× width exceeds the available width uses Kerbside Bold 8×8 instead

## Verification

- npm test -- tests/unit
- npm run test:visual
- npm run typecheck && npm run lint

## Dependencies

**Depends on:**

- [SSP-176](SSP-176-sfx-event-wiring.md) Wire sim events to sfx cues through a pure audio director
- [SSP-142](../M4/SSP-142-font-kerbside-5x7.md) Finalise Kerbside 5x7 glyphs, metrics and kerning
- [SSP-143](../M4/SSP-143-font-kerbside-bold-8x8.md) Write Kerbside Bold 8x8 glyphs, metrics and kerning
- [SSP-144](../M4/SSP-144-ui-icons-panels.md) HUD icons, 9-slice panels, button states and complaint stamp grids
- [SSP-145](../M4/SSP-145-hud-specimen-golden.md) Build the hud_specimen scene and commit its visual golden
- [SSP-288](../M3/SSP-288-popups-speech-bubbles.md) Add src/ui/popups.ts: world-space score/penalty popups and NPC speech bubbles

**Blocks:**

- [SSP-239](../M7/SSP-239-audio-access-settings.md) Wire audio accessibility settings live: captions via SSP-184, mono, loud sounds, beeper, adaptive music

## References

- ../../AUDIO_DESIGN.md#13-accessibility
- ../../AUDIO_DESIGN.md#131-settings
- ../../AUDIO_DESIGN.md#132-caption-table
- ../../AUDIO_DESIGN.md#15-milestone-plan-and-open-questions
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom
- ../../TECHNICAL_DESIGN.md#184-visual-headless-screenshot-tests

## Roadmap tasks covered

_None._
