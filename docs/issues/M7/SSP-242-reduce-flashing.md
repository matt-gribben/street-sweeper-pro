---
id: SSP-242
title: "Implement the Reduce flashing setting across HUD and world effects"
milestone: M7
status: todo
type: feature
estimate: M
labels: [type:feature, area:render, area:ui, size:M]
depends_on: [SSP-234, SSP-240, SSP-070, SSP-156, SSP-078, SSP-114, SSP-211, SSP-222, SSP-288]
blocks: [SSP-253, SSP-260]
---

# SSP-242: Implement the Reduce flashing setting across HUD and world effects

**Milestone:** [M7 1.0 Web Release](../README.md#m7) · **Type:** feature · **Size:** M · **Areas:** render, ui

## Summary

When access.reduceFlashing is on, turn flashing, pulsing and shaking effects into steady states, as GDD §17.2 requires (beacon flash, complaint shake, timer pulse), and extend it to the other fast flashes in the game.

## Context

GDD §17.2 (photosensitivity): the beacon flash, complaint shake and timer pulse become steady states.
Required behaviours (ART_BIBLE §10.2, §12.2; GDD §15.2, §11.3):
- Bessie's beacon is a swap-slot toggle, 15 ticks on and 15 off, while the brush is down or dumping. Reduce flashing → steady on in those states.
- A complaint slams a stamp in over 3 frames with a 2-frame shake, and the meter shakes at 4 complaints. Reduce flashing → the stamp appears with no shake, and the meter does not shake.
- The shift timer turns 16 lemon under 60 s and flashes 18 every 30 ticks under 30 s. Reduce flashing → steady 18.
Extended set (default decision, record in GDD §17.2; each keeps a non-flashing cue):
- veh.police lightbar swap every 8 ticks → steady swap 1 while witnessing
- ×5 'SWEEPING BEAUTY!' colour cycle every 5 ticks → steady 16
- hopper bar flashing 18 when full → steady 18 plus the existing "FULL" text
- hydrant icon pulse below 20% water → steady highlighted icon
The golden crisp sparkle (every 90 ticks) is not a flash and is kept.
The ×5 colour cycle lives in src/ui/popups.ts, which SSP-240 reworks, so land after it.

## Scope

- Read access.reduceFlashing in the render and HUD code paths for the beacon swap, complaint stamp/meter shake and timer flash
- Apply the extended set (police lightbar, ×5 cycle, hopper flash, hydrant pulse)
- Record the decision in GDD §17.2
- Unit tests on the state functions with the flag on and off. Read a frozen HUD frame with the flag on.

## Out of scope

- Screen shake / hit-stop (SSP-241)
- Palette changes (Kerbside-32 is fixed)

## Acceptance criteria

- [ ] With reduceFlashing on, the beacon stays on while the brush is down (unit test across 60 ticks)
- [ ] With reduceFlashing on, a new complaint stamp and the 4-complaint meter have zero shake offset (unit test)
- [ ] With reduceFlashing on, the timer under 30 s is steady 18 with no blink (unit test)
- [ ] With reduceFlashing on, the police lightbar, ×5 popup colour, full hopper bar and hydrant icon do not change state between ticks (unit tests)
- [ ] With the flag off, everything behaves exactly as before, and hud_specimen and zoo goldens are unchanged
- [ ] GDD §17.2 lists the full reduce-flashing set

## Verification

- npm run typecheck && npm run lint && npm test
- npm run test:visual

## Dependencies

**Depends on:**

- [SSP-234](SSP-234-settings-store.md) Implement the ssp.settings.v1 store in src/app/settings.ts with storage fallback
- [SSP-240](SSP-240-juice-squash-popups.md) Juice pass: squash-and-stretch, combo popups and the cat roof-ride
- [SSP-070](../M2/SSP-070-hud.md) Build the basic HUD: timer, score, combo popups, hopper, water and HP
- [SSP-156](../M4/SSP-156-hud-final-art.md) Restyle the HUD and score popups with final fonts, icons and panels
- [SSP-078](../M3/SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-114](../M4/SSP-114-ramp-swap-tables.md) Lock ramp-swap key indices and emit the 8 swap tables per atlas
- [SSP-211](../M6/SSP-211-reveller-police.md) Implement npc.reveller, kicking_out, veh.police witness rule and police_parked
- [SSP-222](../M6/SSP-222-art-vehicles-m6.md) Art Pass 2: Blender renders for bin lorry, ice cream van, police and Sid's sweeper
- [SSP-288](../M3/SSP-288-popups-speech-bubbles.md) Add src/ui/popups.ts: world-space score/penalty popups and NPC speech bubbles

**Blocks:**

- [SSP-253](SSP-253-browser-scaling-qa.md) Run cross-browser, scaling and storage-blocked verification for 1.0
- [SSP-260](../M8/SSP-260-touch-controls-overlay.md) Draw the touch control overlay in internal pixel space via the UI pass

## References

- ../../GDD.md#172-accessibility-features
- ../../GDD.md#152-hud-layout
- ../../GDD.md#113-fail-states
- ../../ART_BIBLE.md#102-timing-table
- ../../ART_BIBLE.md#122-hud-layout-480270-reference-anchored-to-corners-for-other-widths
- ../../ART_BIBLE.md#11-vfx

## Roadmap tasks covered

- `src/scenes/SettingsScene.ts` and `src/app/settings.ts`: remapping, volumes, assists, reduce motion, reduce flashing, Fullscreen toggle. (reduce flashing behaviour)
