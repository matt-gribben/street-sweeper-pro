---
id: SSP-258
title: "Add the M8 replay: a Puddle Lane drive driven by scripted touch input"
milestone: M8
status: todo
type: test
estimate: S
labels: [type:test, area:test, area:input, size:S]
depends_on: [SSP-257, SSP-038, SSP-049, SSP-072, SSP-104]
blocks: [SSP-268]
---

# SSP-258: Add the M8 replay: a Puddle Lane drive driven by scripted touch input

**Milestone:** [M8 Touch & Mobile Web](../README.md#m8) · **Type:** test · **Size:** S · **Areas:** test, input

## Summary

Each milestone adds at least one committed replay. Add m8_touch_drive: a 3,600-tick Puddle Lane run whose input log is produced by feeding a scripted multi-touch pointer timeline through the pure touch reducer, so touch-quantised analogue steering is covered by the determinism tripwire.

## Context

Replay format and policy (TECHNICAL_DESIGN §18.3, ROADMAP §5.2/§5.3): tests/replay/replays/<name>.json with format 'ssp.replay', version 1, district, seed, ticks 3600, inputs as base64 RLE of InputFrame changes [tickDelta, throttle, brake, steer, buttons, pressed], checkpoint hashes every 600 ticks, and invariants. npm run test:replay runs each replay in Node and checks the final hash, checkpoints and invariants; new hashes are written with npm run test:replay -- --update.

Why scripted: normal recording uses the dev panel 'Save replay' (F1) in a dev build, but desktop device emulation gives only one pointer, so throttle + steer at once cannot be recorded by hand. Instead write a small generator (proposed: tests/replay/touchScript.ts or a script under tools/ that runs on Node type stripping) that drives the touch reducer from SSP-257 (onDown/onMove/onUp/sampleForTick) with a fixed timeline in internal-pixel coordinates from computeTouchLayout(480), and encodes the resulting InputFrames with the SAME encoder the M1 recorder uses. Reuse; do not write a second encoder.

Route: district.puddle_lane, fixed seed (proposed 1234), brush lowered by a Brush tap early, throttle held with partial steering (values strictly between -127 and 127) to sweep a stretch of kerb. Invariants: minScore ≥ 1 and minLitterCollected ≥ 20 (the TECHNICAL_DESIGN §18.3 example values); if the route misses them, change the route, not the invariants.

No sim change: all pre-existing hashes must stay identical.

## Scope

- Generator that turns a scripted touch timeline into a replay input log via the touch reducer and the existing encoder
- tests/replay/replays/m8_touch_drive.json with checkpoints from npm run test:replay -- --update
- A short note in the PR listing the timeline and why it was scripted

## Out of scope

- Changes to the replay format or runner
- Any change in src/sim
- Browser-side touch e2e (SSP-265)

## Acceptance criteria

- [ ] tests/replay/replays/m8_touch_drive.json exists for district.puddle_lane with ticks 3600 and invariants minScore ≥ 1, minLitterCollected ≥ 20
- [ ] Its decoded input log contains at least one tick with throttle 255 and steer strictly between -127 and 127 and ≠ 0 at the same time, and at least one BRUSH pressed edge
- [ ] npm run test:replay passes twice in a row with every pre-existing hash unchanged
- [ ] Re-running the generator produces a byte-identical inputs string

## Verification

- npm run test:replay
- npm run test:replay (second run, same result)
- npm run typecheck
- npm run lint

## Dependencies

**Depends on:**

- [SSP-257](SSP-257-touch-input-device.md) Implement src/input/touch.ts producing the same InputFrame as keyboard and pad
- [SSP-038](../M1/SSP-038-replay-and-hash.md) Implement replay format, quantised state hash and the npm run test:replay runner
- [SSP-049](../M1/SSP-049-m1-drive-replay.md) Record and commit the m1_drive_puddle_lane replay and its final-state hash
- [SSP-072](../M2/SSP-072-m2-replays.md) Record the M2 full-shift and dump-cycle replays and commit their hashes
- [SSP-104](../M3/SSP-104-puddle-lane-population.md) Populate Puddle Lane with its M3 NPCs, traffic, hazards, knockables and power-up

**Blocks:**

- [SSP-268](SSP-268-m8-close-release.md) Close M8: verify exit criteria, ship the mobile web update, tag m8

## References

- ../../TECHNICAL_DESIGN.md#183-deterministic-replay-tests
- ../../ROADMAP.md#52-test-and-verification-ramp
- ../../ROADMAP.md#53-replay-hash-policy
- ../../../CLAUDE.md#7-testing-expectations

## Roadmap tasks covered

- `src/input/touch.ts`: left-half drag steering slider, right pedal (throttle), left pedal (brake/reverse), brush, spray and horn buttons, a contextual Interact/Dump button, map and pause icons
