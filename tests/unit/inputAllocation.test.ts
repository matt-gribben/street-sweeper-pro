// Allocation check for the per-tick input path (SSP-044, CLAUDE.md §5.1 hot path): Actions.beginFrame() and
// sampleForTick() over the keyboard and a gamepad create nothing once optimised. It has a file of its own so
// V8's type feedback for sampleForTick() comes from the two real devices only, as in the game; the edge-case
// tests in inputActions.test.ts (NaN, Infinity, odd devices) would otherwise steer the optimiser elsewhere.
import { describe, expect, it } from 'vitest';
import { Actions } from '../../src/input/actions.ts';
import { GamepadDevice, PAD_BUTTON } from '../../src/input/gamepad.ts';
import { KeyboardDevice } from '../../src/input/keyboard.ts';
import { DT_S } from '../../src/sim/constants.ts';
import { fakePad, keyEvent, setButton } from '../support/fakeInput.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';

describe('allocation', () => {
  it('sampleForTick() and beginFrame() allocate nothing per tick', () => {
    const keyboard = new KeyboardDevice(DT_S);
    const fake = fakePad();
    const source = [fake];
    const actions = new Actions([keyboard, new GamepadDevice(() => source)]);
    keyboard.handleKeyDown(keyEvent('KeyD'));
    let sink = 0;
    // The double-valued getters (steer, throttle) box their result until V8 has inlined them into
    // sampleForTick(); on the dev Mac that takes ~20k calls (600 warm-up ticks leave ~600 KB of boxes,
    // 60k leave ~3 KB), so the warm-up is long. Each tick here costs well under a microsecond.
    const delta = measureHeapDelta(
      (tick) => {
        setButton(fake, PAD_BUTTON.SOUTH, (tick & 8) === 0);
        fake.axes[0] = ((tick % 200) - 100) / 100;
        actions.beginFrame();
        const frame = actions.sampleForTick();
        sink = (sink + frame.steer + frame.pressed) | 0;
      },
      { warmupTicks: 60_000 },
    );
    expect(sink).not.toBe(0);
    assertHeapDeltaWithinThresholds(delta);
  });
});
