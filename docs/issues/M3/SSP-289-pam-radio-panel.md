---
id: SSP-289
title: "Add Big Pam's HUD radio panel with a one-at-a-time bark queue and inline key glyphs"
milestone: M3
status: todo
type: feature
estimate: M
labels: [type:feature, area:ui, area:gameplay, area:test, size:M, vertical-slice]
depends_on: [SSP-285, SSP-286, SSP-069, SSP-070, SSP-078, SSP-044, SSP-047]
blocks: [SSP-109, SSP-290, SSP-156]
---

# SSP-289: Add Big Pam's HUD radio panel with a one-at-a-time bark queue and inline key glyphs

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** M · **Areas:** ui, gameplay, test · **Vertical slice**

## Summary

Build the GDD §15.2 radio panel: a one-line `ui.panel_council` panel with Pam's name tab, at the bottom-left above the gauges. It shows barks one at a time, auto-dismisses each after 3 s and moves out of Bessie's path. Bark text can carry action tokens that render as inline key glyphs for the active input device. The first producer is the 4-complaint warning.

## Context

GDD §15.2 radio panel: bottom-left, above the gauges. Pam's barks appear in a 9-slice panel, one line at a time, and auto-dismiss after 3 s (proposed). The panel never covers the road ahead of Bessie; it moves to the opposite corner if Bessie drives toward it (proposed).
ART_BIBLE §12.2: `ui.panel_council`, one line of Kerbside 5×7 in 07, with Pam's name tab in 17.
GDD §16.1: one prompt at a time, delivered as Pam radio barks with the relevant key glyph inline. Glyphs follow the active input device.
GDD §11.3: at 4 complaints Pam barks "One more and you're off the van!". SSP-078 and SSP-079 left this bark out because no radio panel existed.
Queue: barks are FIFO and never overlap. A producer can cancel a bark it queued (the tutorial layer drops beats the player has already performed). Timing counts sim ticks (180 ticks = 3 s), so barks freeze under PauseOverlay.
Width: GDD tutorial beat 1 is about 75 characters (about 450 px at advance 6), wider than the panel can be at the 432 px minimum frame with 4 px margins. Proposal: split an over-long bark at word boundaries into consecutive one-line pages, each shown for its own 3 s. Record the decision in GDD §15.2.
Relocation rule (choose one and record it in GDD §15.2): for example, switch to the bottom-right when Bessie's look-ahead point (camera look-ahead, SSP-047) falls in the panel's half of the frame. From M4 the panel then sits above the minimap.
Inline glyphs: bark strings may contain action tokens such as `{throttle}`, `{steer}`, `{brush}`, `{interact}`, `{horn}` and `{spray}`. Each renders as a keycap: the label from glyphs.ts (SSP-286) in 5×7 inside a 1 px 07 box. Record the keycap look in ART_BIBLE §12.3. A `{cleanSpeed}` token renders '9 mph' (4.0 m/s, GDD §7.2), so SSP-235's units setting can switch it later.
Location: the radio panel is a HUD element, so put it in `src/ui/hud.ts` (or a new file under src/ui listed in TECHNICAL_DESIGN §2) with a pure `radioModel`. The UI reads sim state read-only.

## Scope

- Radio panel HUD element: ui.panel_council, PAM tab in 17, one 5×7 line, bottom-left above the gauges, with the relocation rule
- Bark queue API (enqueue, cancel, current) with a 180-tick auto-dismiss and paging for over-long lines
- Token parser and keycap glyph rendering from glyphs.ts for the active device; the {cleanSpeed} token
- The bark "One more and you're off the van!" on the 4th complaint
- Record the paging, relocation and keycap decisions in GDD §15.2 and ART_BIBLE §12.3
- Unit tests for the queue, paging, tokens and relocation; captures at W = 432 and 640

## Out of scope

- Tutorial beat triggers and tracking of learned beats (SSP-290)
- Final panel art and restyle (SSP-144, SSP-156)
- Remapped glyphs (SSP-236) and touch glyphs (SSP-262)
- Barks for the Tue–Sun districts

## Acceptance criteria

- [ ] Unit test: two barks enqueued together show one after the other, each for 180 ticks, never at the same time; a cancelled queued bark never shows
- [ ] Unit test: a bark wider than the panel's maximum at W = 432 is split at word boundaries into pages that each fit, and no rendered line crosses the 4 px safe margin
- [ ] Unit test: 'Brush down with {brush}.' renders 'Space' in a keycap with the keyboard active and 'A' with the gamepad active
- [ ] Unit test: reaching 4 complaints enqueues exactly "One more and you're off the van!" once
- [ ] Unit test: the relocation rule moves the panel when the look-ahead point is in its half of the frame, and moves it back otherwise
- [ ] Captures at W = 432 and W = 640 show the panel inside the safe margin with a keycap glyph (frames Read and noted)
- [ ] Draw calls stay ≤ 10, and the radio panel code allocates nothing per frame

## Verification

- npm run typecheck && npm run lint && npm test
- npm run test:e2e
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-285](SSP-285-ui-panels-9slice.md) Implement src/ui/panels.ts 9-slice panels and button states with placeholder panel grids
- [SSP-286](SSP-286-menu-navigation.md) Implement src/ui/menus.ts: keyboard, gamepad and mouse menu navigation plus input-device glyphs
- [SSP-069](../M2/SSP-069-bitmap-text.md) Implement src/ui/bitmapText.ts and the UI render pass
- [SSP-070](../M2/SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-078](SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-044](../M1/SSP-044-input-devices.md) Implement keyboard and gamepad input producing quantised per-tick InputFrames
- [SSP-047](../M1/SSP-047-camera-lookahead-zoom.md) Drive camera look-ahead and speed zoom from Bessie's real speed

**Blocks:**

- [SSP-109](SSP-109-close-m3.md) Close M3: verify the exit criteria, sync docs, state the frozen entity list, tag m3
- [SSP-290](SSP-290-tutorial-beats.md) Implement Pam's tutorial prompt layer and author the 13 Puddle Lane tutorial_beat events
- [SSP-156](../M4/SSP-156-hud-final-art.md) Restyle the HUD and score popups with final fonts, icons and panels

## References

- ../../GDD.md#152-hud-layout
- ../../GDD.md#161-principles
- ../../GDD.md#113-fail-states
- ../../ART_BIBLE.md#122-hud-layout-480270-reference-anchored-to-corners-for-other-widths
- ../../ART_BIBLE.md#123-panels-buttons-and-icons
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom

## Roadmap tasks covered

_None._
