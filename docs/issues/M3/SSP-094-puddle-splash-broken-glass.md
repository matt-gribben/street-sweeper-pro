---
id: SSP-094
title: "Add puddle splash penalties and broken glass from flung bottles"
milestone: M3
status: todo
type: feature
estimate: S
labels: [type:feature, area:sim, area:gameplay, area:test, size:S, vertical-slice]
depends_on: [SSP-093, SSP-082, SSP-078, SSP-057]
blocks: [SSP-102, SSP-104, SSP-108, SSP-214]
---

# SSP-094: Add puddle splash penalties and broken glass from flung bottles

**Milestone:** [M3 Living Street](../README.md#m3) · **Type:** feature · **Size:** S · **Areas:** sim, gameplay, test · **Vertical slice**

## Summary

Add the two hazard rules that involve other systems: fast puddle crossings splash nearby pedestrians (−50 each, every 3rd splash a complaint), and a flung glass bottle smashes into haz.broken_glass, which drains HP and can be swept for +20.

## Context

From ENTITY_CATALOG §3.4, §4.2 and §10:

Puddle splash
- Above 3 m/s through haz.puddle, pedestrians within 1.5 m are splashed: −50 each, and they play Startle.
- Every 3rd splash = 1 complaint (reason Splash). Splashing npc.inspector (M6) = 2 C.
- Emit EV.Splash for M5 SFX and fx.ts.
- 'Every 3rd splash' is ambiguous: propose counting per splashed pedestrian across the shift, and flag it.
- One splash per puddle-crossing episode per pedestrian.

Broken glass
- A flung litter.glass_bottle smashes into haz.broken_glass where it lands (event for fx.glass_smash).
- Driving on it costs −5 HP/s (5/60 HP per tick).
- Sweeping it (brush-down suction over it) awards +20 with pickup_glass and removes it. Scoring class is unspecified: propose treating it like a litter pickup (multiplied, refreshes the chain, 0 LU, not counted in Tidy %); flag it.
- Glass bottles appear on Tue (not Mon). Dynamic hazards respect the 64 cap.

## Scope

- Splash detection per puddle crossing, penalty per pedestrian within 1.5 m, shift splash counter with a complaint on every 3rd, EV.Splash.
- Hook on the glass-bottle fling landing that spawns haz.broken_glass.
- HP drain while overlapping, and the sweep-to-clear +20 award.
- Tests.

## Out of scope

- Inspector splash (M6).
- VFX art.

## Acceptance criteria

- [ ] Test: crossing a puddle at 3.5 m/s with 2 pedestrians within 1.5 m costs −100 total and startles both; at 2.9 m/s it costs nothing.
- [ ] Test: the 3rd counted splash in a shift adds exactly 1 complaint, and the 6th adds another.
- [ ] Test: a flung glass bottle creates one haz.broken_glass at its landing point.
- [ ] Test: driving on broken glass for 60 ticks costs 5 HP ± 0.01.
- [ ] Test: sweeping the glass awards +20 once and removes the hazard.

## Verification

- npm test
- npm run test:replay
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-093](SSP-093-hazards-grip-jolts.md) Implement hazard grip overrides, jolts, LU spills and the open-manhole hard stop
- [SSP-082](SSP-082-pedestrian-reactions-horn.md) Build the shared pedestrian reaction model, actor hits, horn stimulus and spilled shopping
- [SSP-078](SSP-078-penalties-complaints-core.md) Add complaints.ts, the penalty pipeline, horn input and the HUD complaints meter
- [SSP-057](../M2/SSP-057-litter-field.md) Implement LitterField store, 4 m spatial hash, fling arc and shift-start spawn

**Blocks:**

- [SSP-102](SSP-102-fx-placeholder-particles.md) Add placeholder particles in src/render/fx.ts for dust, splash and sparkle
- [SSP-104](SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up
- [SSP-108](SSP-108-penalty-table-test.md) Add the table-driven penalty and complaint test against entities.json
- [SSP-214](../M6/SSP-214-inspector.md) Implement npc.inspector and the inspection event with frontage deductions

## References

- ../../ENTITY_CATALOG.md#34-generic-pedestrian-reaction-model
- ../../ENTITY_CATALOG.md#42-behaviours-and-brush-up-rules
- ../../ENTITY_CATALOG.md#10-hazards-haz
- ../../GDD.md#112-penalty-summary

## Roadmap tasks covered

- Hazards in `world.ts`/`vehicle.ts`: ... the broken-glass HP drain ...
- `Deliverable: puddle splashing`
