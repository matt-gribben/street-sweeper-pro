// Gamepad device (SSP-044, TECHNICAL_DESIGN §13.2): standard mapping, the 0.15 stick deadzone rescale, trigger
// quantisation, button edges, disconnects that never throw, and impact rumble (AUDIO_DESIGN §12.5). Fake
// Gamepad objects stand in for navigator.getGamepads().
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTION, Actions } from '../../src/input/actions.ts';
import {
  applyDeadzone,
  browserPadSource,
  GamepadDevice,
  IMPACT_RUMBLE,
  impactRumble,
  PAD_BUTTON,
  type PadSource,
  pickPad,
  type RumbleEffect,
} from '../../src/input/gamepad.ts';
import { BRAKE_MAX, BUTTON, createInputFrame, PRESSED, THROTTLE_MAX } from '../../src/sim/inputFrame.ts';
import {
  type FakePad,
  fakePad,
  padSource,
  setButton,
  setTrigger,
  vanishingPad,
} from '../support/fakeInput.ts';

function rig(...pads: (FakePad | null)[]): {
  pad: GamepadDevice;
  actions: Actions;
  slots: ReturnType<typeof padSource>;
} {
  const slots = padSource(...pads);
  const pad = new GamepadDevice(slots.source);
  return { pad, actions: new Actions([pad]), slots };
}

/** One rendered frame with one tick: poll, then sample. Returns a copy of the frame. */
function frameTick(actions: Actions): ReturnType<typeof createInputFrame> {
  actions.beginFrame();
  return { ...actions.sampleForTick() };
}

const NEUTRAL = createInputFrame();

describe('left stick X → steer', () => {
  it.each([
    [0, 0],
    [0.1, 0],
    [0.15, 0],
    [-0.15, 0],
    [0.575, 64],
    [-0.575, -64],
    [1, 127],
    [-1, -127],
    [1.2, 127],
  ])('stick X = %d gives steer %d', (x, steer) => {
    const fake = fakePad();
    fake.axes[0] = x;
    const { actions } = rig(fake);
    expect(frameTick(actions).steer).toBe(steer);
  });

  it('rescales linearly outside the deadzone: 0.575 is exactly half lock', () => {
    expect(applyDeadzone(0.575)).toBeCloseTo(0.5, 12);
    expect(applyDeadzone(-0.575)).toBeCloseTo(-0.5, 12);
    expect(applyDeadzone(0.15)).toBe(0);
    expect(applyDeadzone(Number.NaN)).toBe(0);
    expect(Object.is(applyDeadzone(-0.1), 0)).toBe(true);
  });

  it('every steer value over a sweep is an integer in −127..127, and monotonic in x', () => {
    const fake = fakePad();
    const { actions } = rig(fake);
    let previous = -Infinity;
    for (let i = -1000; i <= 1000; i += 1) {
      fake.axes[0] = i / 1000;
      const steer = frameTick(actions).steer;
      expect(Number.isInteger(steer)).toBe(true);
      expect(Math.abs(steer)).toBeLessThanOrEqual(127);
      expect(steer).toBeGreaterThanOrEqual(previous);
      previous = steer;
    }
  });
});

describe('triggers', () => {
  it('RT maps to throttle and LT to brake, 0..255 as integers', () => {
    const fake = fakePad();
    const { actions } = rig(fake);
    for (const [value, expected] of [
      [0, 0],
      [0.25, 64],
      [0.5, 128],
      [0.999, 255],
      [1, 255],
    ] as const) {
      setTrigger(fake, PAD_BUTTON.RIGHT_TRIGGER, value);
      setTrigger(fake, PAD_BUTTON.LEFT_TRIGGER, 1 - value);
      const frame = frameTick(actions);
      expect(frame.throttle).toBe(expected);
      expect(frame.brake).toBe(Math.round((1 - value) * BRAKE_MAX));
      expect(Number.isInteger(frame.throttle) && Number.isInteger(frame.brake)).toBe(true);
    }
  });

  it('every trigger value over a sweep quantises to an integer in 0..255', () => {
    const fake = fakePad();
    const { actions } = rig(fake);
    for (let i = 0; i <= 1000; i += 1) {
      setTrigger(fake, PAD_BUTTON.RIGHT_TRIGGER, i / 1000);
      const throttle = frameTick(actions).throttle;
      expect(Number.isInteger(throttle)).toBe(true);
      expect(throttle).toBeGreaterThanOrEqual(0);
      expect(throttle).toBeLessThanOrEqual(THROTTLE_MAX);
    }
  });

  it('out-of-range and non-finite trigger values clamp', () => {
    const fake = fakePad();
    const { actions } = rig(fake);
    setTrigger(fake, PAD_BUTTON.RIGHT_TRIGGER, 1.5);
    setTrigger(fake, PAD_BUTTON.LEFT_TRIGGER, Number.NaN);
    const frame = frameTick(actions);
    expect(frame.throttle).toBe(THROTTLE_MAX);
    expect(frame.brake).toBe(0);
  });
});

describe('buttons', () => {
  it('X holds SPRAY and Y holds INTERACT', () => {
    const fake = fakePad();
    const { actions } = rig(fake);
    setButton(fake, PAD_BUTTON.WEST, true);
    expect(frameTick(actions).buttons).toBe(BUTTON.SPRAY);
    setButton(fake, PAD_BUTTON.NORTH, true);
    expect(frameTick(actions).buttons).toBe(BUTTON.SPRAY | BUTTON.INTERACT);
    setButton(fake, PAD_BUTTON.WEST, false);
    expect(frameTick(actions).buttons).toBe(BUTTON.INTERACT);
  });

  it('A gives one BRUSH edge per press and B one HORN edge, however long they are held', () => {
    const fake = fakePad();
    const { actions } = rig(fake);
    frameTick(actions);
    setButton(fake, PAD_BUTTON.SOUTH, true);
    expect(frameTick(actions).pressed).toBe(PRESSED.BRUSH);
    expect(frameTick(actions).pressed).toBe(0);
    expect(frameTick(actions).pressed).toBe(0);
    setButton(fake, PAD_BUTTON.SOUTH, false);
    setButton(fake, PAD_BUTTON.EAST, true);
    expect(frameTick(actions).pressed).toBe(PRESSED.HORN);
    setButton(fake, PAD_BUTTON.SOUTH, true);
    expect(frameTick(actions).pressed).toBe(PRESSED.BRUSH);
  });

  it('View/Back and Start/Menu are scene actions and never reach the sim frame', () => {
    const fake = fakePad();
    const { actions } = rig(fake);
    frameTick(actions);
    setButton(fake, PAD_BUTTON.BACK, true);
    setButton(fake, PAD_BUTTON.START, true);
    actions.beginFrame();
    expect(actions.sceneActions).toBe(ACTION.MAP | ACTION.PAUSE);
    expect(actions.sampleForTick()).toEqual(NEUTRAL);
    actions.beginFrame();
    expect(actions.sceneActions).toBe(0);
  });

  it('polls once per frame: ticks in one frame share one reading', () => {
    const fake = fakePad();
    let polls = 0;
    const source: PadSource = () => {
      polls += 1;
      return [fake];
    };
    const actions = new Actions([new GamepadDevice(source)]);
    actions.beginFrame();
    actions.sampleForTick();
    actions.sampleForTick();
    actions.sampleForTick();
    expect(polls).toBe(1);
  });
});

describe('pad choice', () => {
  it('the first connected pad with the standard mapping wins', () => {
    const odd = fakePad(0, '');
    const gone = fakePad(1);
    gone.connected = false;
    const first = fakePad(2);
    const second = fakePad(3);
    setTrigger(first, PAD_BUTTON.RIGHT_TRIGGER, 1);
    setTrigger(second, PAD_BUTTON.LEFT_TRIGGER, 1);
    setTrigger(odd, PAD_BUTTON.LEFT_TRIGGER, 1);
    const { actions } = rig(null, odd, gone, first, second);
    const frame = frameTick(actions);
    expect(frame.throttle).toBe(THROTTLE_MAX);
    expect(frame.brake).toBe(0);
  });

  it('with no standard pad the device is neutral and not connected', () => {
    const { pad, actions } = rig(fakePad(0, 'xr-standard'));
    expect(frameTick(actions)).toEqual(NEUTRAL);
    expect(pad.connected).toBe(false);
  });

  it('pickPad copes with a source that throws or returns nothing', () => {
    expect(
      pickPad(() => {
        throw new Error('blocked by permissions policy');
      }),
    ).toBeNull();
    expect(pickPad(() => null)).toBeNull();
    expect(pickPad(() => undefined)).toBeNull();
  });

  it('browserPadSource is empty where the Gamepad API is missing', () => {
    expect(pickPad(browserPadSource({} as Navigator))).toBeNull();
  });
});

describe('disconnects never throw', () => {
  function heldPad(): FakePad {
    const fake = fakePad();
    fake.axes[0] = 1;
    setTrigger(fake, PAD_BUTTON.RIGHT_TRIGGER, 1);
    setTrigger(fake, PAD_BUTTON.LEFT_TRIGGER, 0.5);
    setButton(fake, PAD_BUTTON.WEST, true);
    setButton(fake, PAD_BUTTON.NORTH, true);
    return fake;
  }

  it('the slot going null mid-sample gives a neutral frame', () => {
    const { actions, slots } = rig(heldPad());
    expect(frameTick(actions).throttle).toBe(THROTTLE_MAX);
    slots.slots = [null];
    expect(() => frameTick(actions)).not.toThrow();
    expect(frameTick(actions)).toEqual(NEUTRAL);
  });

  it('connected turning false gives a neutral frame', () => {
    const fake = heldPad();
    const { actions } = rig(fake);
    frameTick(actions);
    fake.connected = false;
    expect(frameTick(actions)).toEqual(NEUTRAL);
  });

  it('a pad whose getters throw mid-read gives a neutral frame', () => {
    const { actions, slots } = rig(heldPad());
    frameTick(actions);
    slots.slots = [vanishingPad()];
    let frame = createInputFrame();
    expect(() => {
      frame = frameTick(actions);
    }).not.toThrow();
    expect(frame).toEqual(NEUTRAL);
  });

  it('a pad with emptied button and axis arrays gives a neutral frame', () => {
    const fake = heldPad();
    const { actions } = rig(fake);
    frameTick(actions);
    fake.buttons = [];
    fake.axes = [];
    expect(frameTick(actions)).toEqual(NEUTRAL);
  });

  it('getGamepads() throwing gives a neutral frame', () => {
    let fail = false;
    const fake = heldPad();
    const device = new GamepadDevice(() => {
      if (fail) throw new Error('SecurityError');
      return [fake];
    });
    const actions = new Actions([device]);
    frameTick(actions);
    fail = true;
    expect(frameTick(actions)).toEqual(NEUTRAL);
  });

  it('keeps an edge latched before the disconnect, and a button held through a reconnect fires no new edge', () => {
    const fake = fakePad();
    const { pad, actions, slots } = rig(fake);
    actions.beginFrame();
    setButton(fake, PAD_BUTTON.SOUTH, true);
    actions.beginFrame(); // edge latched, no tick yet
    slots.slots = [null];
    actions.beginFrame(); // gone before the tick ran
    expect(actions.sampleForTick().pressed).toBe(PRESSED.BRUSH);
    slots.slots = [fake]; // back, A still held
    expect(frameTick(actions).pressed).toBe(0);
    expect(pad.connected).toBe(true);
    setButton(fake, PAD_BUTTON.SOUTH, false);
    frameTick(actions);
    setButton(fake, PAD_BUTTON.SOUTH, true);
    expect(frameTick(actions).pressed).toBe(PRESSED.BRUSH);
  });
});

describe('impact rumble', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps impact speed to the AUDIO_DESIGN §12.5 cues', () => {
    expect(impactRumble(0)).toBeNull();
    expect(impactRumble(0.49)).toBeNull();
    expect(impactRumble(Number.NaN)).toBeNull();
    expect(impactRumble(0.5)).toEqual({
      startDelay: 0,
      duration: 90,
      strongMagnitude: 0.3,
      weakMagnitude: 0.2,
    });
    const mid = impactRumble(1.75);
    expect(mid?.strongMagnitude).toBeCloseTo(0.45, 12);
    expect(mid?.duration).toBe(IMPACT_RUMBLE.bumpDurationMs);
    expect(impactRumble(3)?.strongMagnitude).toBeCloseTo(0.6, 12);
    expect(impactRumble(3.01)).toEqual({
      startDelay: 0,
      duration: 220,
      strongMagnitude: 0.9,
      weakMagnitude: 0.6,
    });
    expect(impactRumble(17)).toEqual(impactRumble(3.01));
  });

  function rumblePad(): { fake: FakePad; effects: RumbleEffect[] } {
    const fake = fakePad();
    const effects: RumbleEffect[] = [];
    fake.vibrationActuator = {
      playEffect: (type, params) => {
        expect(type).toBe('dual-rumble');
        effects.push(params);
        return Promise.resolve('complete');
      },
    };
    return { fake, effects };
  }

  it('plays dual-rumble on the active pad for a bump or a crash, nothing for a graze', () => {
    const { fake, effects } = rumblePad();
    const { pad } = rig(fake);
    pad.rumbleImpact(0.2);
    pad.rumbleImpact(2);
    pad.rumbleImpact(5);
    expect(effects.map((e) => e.duration)).toEqual([90, 220]);
  });

  it('does nothing when rumble is switched off', () => {
    const { fake, effects } = rumblePad();
    const { pad } = rig(fake);
    pad.rumbleEnabled = false;
    pad.rumbleImpact(5);
    expect(effects).toEqual([]);
  });

  it('never throws: no pad, no actuator, a throwing actuator or a rejected effect', () => {
    expect(() => rig().pad.rumbleImpact(5)).not.toThrow();
    const bare = fakePad();
    expect(() => rig(bare).pad.rumbleImpact(5)).not.toThrow();
    bare.vibrationActuator = null;
    expect(() => rig(bare).pad.rumbleImpact(5)).not.toThrow();
    const throwing = fakePad();
    throwing.vibrationActuator = {
      playEffect: () => {
        throw new Error('NotSupportedError');
      },
    };
    expect(() => rig(throwing).pad.rumbleImpact(5)).not.toThrow();
    // A rejected effect (the pad cannot rumble) must be handled by the device, or it would surface as an
    // unhandled rejection.
    const rejecting = fakePad();
    const rejection = Promise.reject(new Error('InvalidStateError'));
    const handled = vi.spyOn(rejection, 'catch');
    rejecting.vibrationActuator = { playEffect: () => rejection };
    expect(() => rig(rejecting).pad.rumbleImpact(5)).not.toThrow();
    expect(handled).toHaveBeenCalledTimes(1);
  });
});
