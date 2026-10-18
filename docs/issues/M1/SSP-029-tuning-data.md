---
id: SSP-029
title: "Create tuning.json vehicle.sweeper block and typed src/sim/tuning.ts"
milestone: M1
status: todo
type: feature
estimate: S
labels: [type:feature, area:sim, area:gameplay, area:docs, size:S, vertical-slice]
depends_on: [SSP-028, SSP-002]
blocks: [SSP-030, SSP-035, SSP-036, SSP-053, SSP-075, SSP-188]
---

# SSP-029: Create tuning.json vehicle.sweeper block and typed src/sim/tuning.ts

**Milestone:** [M1 Drivable Bessie](../README.md#m1) · **Type:** feature · **Size:** S · **Areas:** sim, gameplay, docs · **Vertical slice**

## Summary

Move every handling number from the GDD handling sheet into `src/data/tuning.json` → `vehicle.sweeper`, with a typed, validated loader in `src/sim/tuning.ts`. From this commit the JSON is the source of truth and GDD §7 becomes its mirror (CLAUDE.md §2).

## Context

Values, verbatim from GDD §7.1, §7.3, §7.4 and TECHNICAL_DESIGN §8:
- Body 1.75 × 3.25 m, wheelbase 2.4 m
- Mass 4,200 kg empty, plus 1,500 kg at a full hopper (linear with fill)
- Accel 2.4 m/s². Full-hopper multipliers: accel ×0.70, top speed ×0.90, steer rate ×0.85
- Brake 6.0 m/s²
- Reverse: max 2.5 m/s, accel 1.5 m/s²; engages when brake is held with |vLong| < 0.2 m/s for 0.25 s (both marked *proposed* in GDD §6.2)
- Top speed 6.0 m/s brush down, 11.0 m/s brush up (transit)
- Clean-pickup speed 4.0 m/s; fling probability ramps 4.0→6.0 (consumed in M2)
- Steering: max 34°, scaled by 1/(1 + v/8). Steer rate 120°/s, return 180°/s
- Drag: rolling 0.3 m/s² plus 0.012·v². Rolling drag ×2.5 on grass
- Lateral grip k (/s): asphalt 9.0, pavement 8.0, grass 5.0, wet/puddle 4.0, wet leaves 3.0, oil 1.2. Rain sets asphalt to 6.0 (Wednesday / district.gasworks; hook only)
- Kerb crossing keeps 0.7 of speed (a 30% loss)
- Restitution 0.2. Damage 4 HP per m/s of normal impact speed above 2 m/s
- HP 100. Dented variant below 40 HP
- Brush: raise/lower 0.5 s, RPM spin-up 0.6 s, collects at RPM ≥ 0.8 (consumed in M2)

Rules:
- Key names carry unit suffixes (`wheelbaseM`, `maxSteerDeg`, `steerRateDegPerS`, `brakeMps2`…).
- The sim works in radians. Convert degrees in tuning.ts once, at load.
- The sim may import `src/data/*.json` only through tuning.ts (TECHNICAL_DESIGN §2.1).
- Validate with hand-written type guards: no zod, no `any` (CLAUDE.md §5.1).
- JSON import: `import data from '../data/tuning.json' with { type: 'json' }` should work on Node 24 type stripping and in Vite. Check it under both.
- Expose a `loadTuning(raw: unknown): Tuning` function plus the default parsed object. Later issues pass the tuning object into `createWorld(level, seed, tuning)` as a parameter; do NOT make the sim read a module-level singleton implicitly, because the dev panel (SSP-048 issue) must be able to hand the World an edited copy.

OPEN (flag in the PR summary, do not decide silently):
- The docs give no wheel track width and no axle offsets, but TECHNICAL_DESIGN §8.2 steps 7 and 9 need the four wheel contact points and the axle midpoints. Proposal: track 1.75 m (ART_BIBLE §8.1 shows wheels at the body corners) and axles at ±1.2 m from the body centre (symmetric wheelbase). Store them as `wheelTrackM` and `frontAxleOffsetM`/`rearAxleOffsetM`, marked provisional.
- Power-up and upgrade multipliers (`pwr.bacon_butty` ×1.3, `upg.engine` ×1.1/×1.2, `upg.tyres` ×1.15, `upg.bumper` ×0.6) belong to ENTITY_CATALOG / `entities.json` / `upgrades.json`, not tuning.json. Leave them out.

## Scope

- src/data/tuning.json with a `vehicle.sweeper` block holding every value listed in context
- src/sim/tuning.ts: typed readonly Tuning type, `loadTuning(raw: unknown)` with type guards that throw a clear error on malformed data, degree→radian conversion, exported default
- Provisional wheel-geometry keys, flagged in the PR
- Update the GDD §7 header note to say the values are mirrored from tuning.json (wording only, no number changes)
- Unit tests: the loader accepts the committed file and rejects missing or wrongly typed keys

## Out of scope

- entities.json, upgrades.json, districts.json
- Camera constants (they live in src/render)
- Retuning any value (R-07 tuning happens after the lead playtest)

## Acceptance criteria

- [ ] Every value in GDD §7.1, the §7.3 grip table and the §7.4 full-hopper multipliers appears in tuning.json with the same number (a unit test asserts each)
- [ ] Only tuning.ts imports src/data/tuning.json from src/sim (checked by the purity scan or a grep test)
- [ ] The type guards reject a fixture with a missing key and one with a string where a number is expected
- [ ] The JSON loads both under Node type stripping (`node -e` import or a tools smoke script) and in Vitest
- [ ] `loadTuning` returns a new object each call, so callers can pass an edited copy
- [ ] The provisional wheel-geometry values are listed in the PR summary as needing lead confirmation

## Verification

- npm run typecheck
- npm run lint
- npm test

## Dependencies

**Depends on:**

- [SSP-028](SSP-028-sim-foundations.md) Add sim foundations: sfc32 RNG, fmath wrapper, constants, InputFrame type
- [SSP-002](../M0/SSP-002-node-scaffold.md) Scaffold the Node/TypeScript/Vite repo with exact pins and verify TS 7.0.2 (D-10)

**Blocks:**

- [SSP-030](SSP-030-vehicle-model.md) Implement Bessie's kinematic bicycle model in src/sim/vehicle.ts
- [SSP-035](SSP-035-world-tick-order.md) Add World, EventQueue and fixed tick order with surface grip and kerb jolts
- [SSP-036](SSP-036-static-collision.md) Resolve Bessie against static geometry with impact damage and TOWED stub
- [SSP-053](../M2/SSP-053-entities-tuning-seed.md) Seed entities.json with litter, stains and pickups; add M2 values to tuning.json
- [SSP-075](../M3/SSP-075-entity-data-freeze.md) Freeze the Mon–Tue entity set in entities.json and add M3 shared tuning
- [SSP-188](../M6/SSP-188-upgrade-modifiers.md) Apply upg.* levels to the sim via tuning.ts modifiers and record loadout in replays

## References

- ../../GDD.md#71-handling-sheet
- ../../GDD.md#73-surfaces-and-terrain
- ../../GDD.md#74-load-the-hopper-makes-bessie-heavier
- ../../GDD.md#62-control-design-notes
- ../../TECHNICAL_DESIGN.md#82-per-tick-integration-phase-2
- ../../TECHNICAL_DESIGN.md#32-core-principles
- ../../TECHNICAL_DESIGN.md#21-who-may-import-whom
- ../../../CLAUDE.md#2-where-truth-lives

## Roadmap tasks covered

- `src/data/tuning.json` → `vehicle.sweeper`, with every value from the handling table in [GDD.md](../../GDD.md). `src/sim/tuning.ts` gives it typed access.
