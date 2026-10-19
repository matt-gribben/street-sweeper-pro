// Device merge (SSP-044, TECHNICAL_DESIGN §13.1): the quantisation rule, edge latching per tick and per frame
// (through the real fixed-step loop), scene-layer actions kept out of the sim frame, and merging two devices.
// The allocation check is in inputAllocation.test.ts.
import { describe, expect, it } from 'vitest';
import { createLoop, type LoopClock } from '../../src/app/loop.ts';
import {
  ACTION,
  Actions,
  type InputDevice,
  quantiseAxis,
  quantiseUnit,
  SCENE_ACTIONS,
  SIM_EDGE_ACTIONS,
  SIM_HELD_ACTIONS,
} from '../../src/input/actions.ts';
import { GamepadDevice, PAD_BUTTON } from '../../src/input/gamepad.ts';
import { KeyboardDevice } from '../../src/input/keyboard.ts';
import { DT_S } from '../../src/sim/constants.ts';
import { createInputFrame, type InputFrame, PRESSED, STEER_MAX } from '../../src/sim/inputFrame.ts';
import { fakePad, keyEvent, padSource, setButton, setTrigger } from '../support/fakeInput.ts';

describe('quantisation', () => {
  it.each([
    [0, 127, 0],
    [0.5, 127, 64],
    [-0.5, 127, -64],
    [1, 127, 127],
    [-1, 127, -127],
    [2, 127, 127],
    [-2, 127, -127],
    [0.003, 127, 0],
    [0.004, 127, 1],
    [0.5, 255, 128],
    [Number.NaN, 127, 0],
    [Number.POSITIVE_INFINITY, 255, 255],
    [Number.NEGATIVE_INFINITY, 127, -127],
  ])('quantiseAxis(%d, %d) = %d', (value, max, expected) => {
    expect(quantiseAxis(value, max)).toBe(expected);
  });

  it('absorbs float error at a half: the deadzone example 0.575 → 63.4999… → 64', () => {
    const rescaled = (0.575 - 0.15) / 0.85;
    expect(rescaled * 127).toBeLessThan(63.5); // the trap plain Math.round falls into
    expect(Math.round(rescaled * 127)).toBe(63);
    expect(quantiseAxis(rescaled, 127)).toBe(64);
  });

  it('mirrors left and right exactly and never produces −0', () => {
    for (let i = 0; i <= 2000; i += 1) {
      const v = i / 2000;
      expect(quantiseAxis(-v, 127)).toBe(-quantiseAxis(v, 127) || 0);
      expect(Object.is(quantiseAxis(-v, 127), -0)).toBe(false);
    }
  });

  it('quantiseUnit clamps negatives to 0', () => {
    expect(quantiseUnit(-0.5, 255)).toBe(0);
    expect(quantiseUnit(0.25, 255)).toBe(64);
  });
});

describe('action groups', () => {
  it('splits every action into exactly one of sim-edge, sim-held and scene', () => {
    const all = Object.values(ACTION).reduce((a, b) => a | b, 0);
    expect(SIM_EDGE_ACTIONS | SIM_HELD_ACTIONS | SCENE_ACTIONS).toBe(all);
    expect(SIM_EDGE_ACTIONS & SIM_HELD_ACTIONS).toBe(0);
    expect(SIM_EDGE_ACTIONS & SCENE_ACTIONS).toBe(0);
    expect(SIM_HELD_ACTIONS & SCENE_ACTIONS).toBe(0);
  });
});

/** A fake clock driving createLoop one frame at a time. */
function fakeClock(): LoopClock & { runFrame(nowMs: number): void } {
  let pending: ((nowMs: number) => void) | null = null;
  let nowMs = 0;
  return {
    now: () => nowMs,
    requestFrame(callback) {
      pending = callback;
      return 1;
    },
    cancelFrame() {
      pending = null;
    },
    runFrame(at: number) {
      const callback = pending;
      if (callback === null) throw new Error('no frame requested');
      pending = null;
      nowMs = at;
      callback(at);
    },
  };
}

/** Actions behind the real loop; records a copy of every tick's frame, grouped by display frame. */
function loopRig(devices: InputDevice[]): {
  actions: Actions;
  clock: ReturnType<typeof fakeClock>;
  frames: InputFrame[][];
  scene: number[];
  runFrame(ticks: number): void;
} {
  const actions = new Actions(devices);
  const clock = fakeClock();
  const frames: InputFrame[][] = [];
  const scene: number[] = [];
  let current: InputFrame[] = [];
  const loop = createLoop(
    {
      beginFrame: () => actions.beginFrame(),
      sampleForTick: () => actions.sampleForTick(),
      fixedUpdate: (input) => {
        current.push({ ...input });
      },
      drainEvents: () => {},
      render: () => {
        frames.push(current);
        scene.push(actions.sceneActions);
        current = [];
      },
    },
    { clock },
  );
  loop.start();
  let t = 0;
  return {
    actions,
    clock,
    frames,
    scene,
    runFrame(ticks: number): void {
      // A hair over `ticks` whole ticks, so float error never drops one.
      t += ticks * DT_S * 1000 + 0.001;
      clock.runFrame(t);
    },
  };
}

describe('edge latching through the loop', () => {
  it('when 3 ticks run in one frame, a new keyboard edge appears only in the first tick', () => {
    const keyboard = new KeyboardDevice(DT_S);
    const r = loopRig([keyboard]);
    r.runFrame(1);
    keyboard.handleKeyDown(keyEvent('Space'));
    keyboard.handleKeyUp(keyEvent('Space'));
    keyboard.handleKeyDown(keyEvent('KeyH'));
    r.runFrame(3);
    const frame = r.frames[1] ?? [];
    expect(frame.map((f) => f.pressed)).toEqual([PRESSED.BRUSH | PRESSED.HORN, 0, 0]);
    r.runFrame(3);
    expect((r.frames[2] ?? []).map((f) => f.pressed)).toEqual([0, 0, 0]);
  });

  it('when 3 ticks run in one frame, a new gamepad edge appears only in the first tick', () => {
    const fake = fakePad();
    const pad = new GamepadDevice(padSource(fake).source);
    const r = loopRig([pad]);
    r.runFrame(1);
    setButton(fake, PAD_BUTTON.SOUTH, true);
    r.runFrame(3);
    expect((r.frames[1] ?? []).map((f) => f.pressed)).toEqual([PRESSED.BRUSH, 0, 0]);
    r.runFrame(3);
    expect((r.frames[2] ?? []).map((f) => f.pressed)).toEqual([0, 0, 0]);
  });

  it('a press made during a frame with no ticks reaches the first tick of a later frame', () => {
    const keyboard = new KeyboardDevice(DT_S);
    const r = loopRig([keyboard]);
    keyboard.handleKeyDown(keyEvent('Space'));
    keyboard.handleKeyUp(keyEvent('Space'));
    r.runFrame(0); // a 144 Hz frame that runs no tick
    r.runFrame(0);
    r.runFrame(2);
    expect(r.frames.map((f) => f.map((x) => x.pressed))).toEqual([[], [], [PRESSED.BRUSH, 0]]);
  });

  it('held buttons and analogue values repeat on every tick of a frame', () => {
    const fake = fakePad();
    setTrigger(fake, PAD_BUTTON.RIGHT_TRIGGER, 0.5);
    setButton(fake, PAD_BUTTON.WEST, true);
    const r = loopRig([new GamepadDevice(padSource(fake).source)]);
    r.runFrame(3);
    expect((r.frames[0] ?? []).map((f) => [f.throttle, f.buttons])).toEqual([
      [128, 1],
      [128, 1],
      [128, 1],
    ]);
  });
});

describe('scene-layer actions', () => {
  it('Esc/P, Tab and F1 never set bits in the sim InputFrame', () => {
    for (const code of ['Escape', 'KeyP', 'Tab', 'F1']) {
      const keyboard = new KeyboardDevice(DT_S);
      const actions = new Actions([keyboard]);
      keyboard.handleKeyDown(keyEvent(code));
      actions.beginFrame();
      for (let i = 0; i < 5; i += 1) {
        expect(actions.sampleForTick(), code).toEqual(createInputFrame());
      }
      keyboard.handleKeyUp(keyEvent(code));
      keyboard.handleKeyDown(keyEvent(code));
      // Even without a beginFrame in between, the sim frame never takes a scene edge.
      expect(actions.sampleForTick().pressed & (PRESSED.MAP | PRESSED.PAUSE)).toBe(0);
      expect(actions.sampleForTick()).toEqual(createInputFrame());
    }
  });

  it('they reach sceneActions for exactly one frame, whatever its tick count', () => {
    const keyboard = new KeyboardDevice(DT_S);
    const r = loopRig([keyboard]);
    r.runFrame(1);
    keyboard.handleKeyDown(keyEvent('Escape'));
    r.runFrame(3);
    keyboard.handleKeyDown(keyEvent('Tab'));
    keyboard.handleKeyDown(keyEvent('F1'));
    r.runFrame(0);
    r.runFrame(1);
    expect(r.scene).toEqual([0, ACTION.PAUSE, ACTION.MAP | ACTION.DEV_PANEL, 0]);
    for (const frame of r.frames) for (const f of frame) expect(f).toEqual(createInputFrame());
  });

  it('P and Esc are the same action', () => {
    const keyboard = new KeyboardDevice(DT_S);
    const actions = new Actions([keyboard]);
    keyboard.handleKeyDown(keyEvent('KeyP'));
    actions.beginFrame();
    expect(actions.sceneActions).toBe(ACTION.PAUSE);
  });
});

describe('merging keyboard and gamepad', () => {
  function both(): { keyboard: KeyboardDevice; fake: ReturnType<typeof fakePad>; actions: Actions } {
    const keyboard = new KeyboardDevice(DT_S);
    const fake = fakePad();
    const actions = new Actions([keyboard, new GamepadDevice(padSource(fake).source)]);
    return { keyboard, fake, actions };
  }

  it('throttle and brake take the strongest device', () => {
    const { keyboard, fake, actions } = both();
    setTrigger(fake, PAD_BUTTON.RIGHT_TRIGGER, 0.5);
    actions.beginFrame();
    expect(actions.sampleForTick().throttle).toBe(128);
    keyboard.handleKeyDown(keyEvent('KeyW'));
    expect(actions.sampleForTick().throttle).toBe(255);
    setTrigger(fake, PAD_BUTTON.LEFT_TRIGGER, 0.2);
    actions.beginFrame();
    expect(actions.sampleForTick().brake).toBe(51);
  });

  it('steer takes the larger deflection, keyboard first on a tie', () => {
    const { keyboard, fake, actions } = both();
    fake.axes[0] = -0.575; // −64
    actions.beginFrame();
    keyboard.handleKeyDown(keyEvent('KeyD'));
    expect(actions.sampleForTick().steer).toBe(-64); // keyboard at 26
    actions.sampleForTick(); // 53
    expect(actions.sampleForTick().steer).toBe(79);
    expect(actions.sampleForTick().steer).toBe(106);
    expect(actions.sampleForTick().steer).toBe(STEER_MAX);
  });

  it('held buttons and edges from both devices are combined', () => {
    const { keyboard, fake, actions } = both();
    keyboard.handleKeyDown(keyEvent('ShiftLeft'));
    keyboard.handleKeyDown(keyEvent('KeyH'));
    actions.beginFrame();
    setButton(fake, PAD_BUTTON.NORTH, true);
    setButton(fake, PAD_BUTTON.SOUTH, true);
    actions.beginFrame();
    const frame = actions.sampleForTick();
    expect(frame.buttons).toBe(3);
    expect(frame.pressed).toBe(PRESSED.BRUSH | PRESSED.HORN);
  });
});
