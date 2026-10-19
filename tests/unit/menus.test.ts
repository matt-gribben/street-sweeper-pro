// SSP-286: menu navigation (src/ui/menus.ts) driven end to end from the real devices: KeyboardDevice, a fake
// standard gamepad and the canvas PointerDevice, merged by Actions, sampled with hold-repeat by
// src/input/menuInput.ts and applied by src/scenes/menuController.ts. Checks focus movement (skipping disabled and
// hidden items, wrapping), select and back, hold-repeat timing, client → internal hit-testing at several integer
// scales and letterboxes, one UI event per action, and that none of it reaches the sim InputFrame.
import { describe, expect, it } from 'vitest';
import { EventBus, UI_EV, type UiEventType } from '../../src/app/events.ts';
import type { SceneContext } from '../../src/app/Game.ts';
import { Actions, POINTER_PHASE } from '../../src/input/actions.ts';
import { GamepadDevice, MENU_STICK_THRESHOLD, PAD_BUTTON } from '../../src/input/gamepad.ts';
import { KeyboardDevice } from '../../src/input/keyboard.ts';
import {
  MENU_REPEAT_DELAY_TICKS,
  MENU_REPEAT_INTERVAL_TICKS,
  MenuInputSampler,
} from '../../src/input/menuInput.ts';
import { POINTER_QUEUE_LENGTH, PointerDevice } from '../../src/input/pointer.ts';
import {
  clientToInternalPx,
  computeViewportLayout,
  type InternalPoint,
  type ViewportLayout,
} from '../../src/render/upscale.ts';
import { MenuController } from '../../src/scenes/menuController.ts';
import { DT_S } from '../../src/sim/constants.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { MENU_COMMAND, Menu, type MenuItem, NO_ITEM } from '../../src/ui/menus.ts';
import { ButtonState, type UiRect } from '../../src/ui/panels.ts';
import { fakePad, keyEvent, padSource, setButton } from '../support/fakeInput.ts';

/** Five items: 0 Play, 1 Disabled (greyed), 2 Hidden, 3 Options, 4 Quit. */
type Rig = ReturnType<typeof rig>;

function rig(options: { layout?: ViewportLayout; disabled?: number[]; hidden?: number[] } = {}) {
  const keyboard = new KeyboardDevice(DT_S);
  const pad = fakePad();
  const pads = padSource(pad);
  const pointer = new PointerDevice();
  const actions = new Actions([keyboard, new GamepadDevice(pads.source)], pointer);
  actions.beginFrame(); // the pad's first poll sets its edge baseline
  const layout = options.layout ?? computeViewportLayout(1920, 1080, 1);
  const context = {
    clientToInternal: (x: number, y: number, out: InternalPoint) => clientToInternalPx(layout, x, y, out),
  } as unknown as SceneContext;
  const bus = new EventBus();
  const events: [UiEventType, string, number][] = [];
  for (const type of Object.values(UI_EV)) {
    bus.onUi(type, (event) => events.push([event.type, event.menu, event.item]));
  }
  const selected: number[] = [];
  let backs = 0;
  const disabled = new Set(options.disabled ?? [1]);
  const hidden = new Set(options.hidden ?? [2]);
  const labels = ['PLAY', 'DISABLED', 'HIDDEN', 'OPTIONS', 'QUIT'];
  const items: MenuItem[] = labels.map((label, i) => ({
    label,
    enabled: () => !disabled.has(i),
    visible: () => !hidden.has(i),
    onSelect: () => selected.push(i),
  }));
  const menu = new Menu({ id: 'test', items, events: bus, onBack: () => (backs += 1) });
  const rects: UiRect[] = labels.map((_l, i) => ({ x: 100, y: 60 + i * 21, w: 120, h: 17 }));
  menu.setRects(rects);
  const controller = new MenuController(context, actions);
  controller.reset();
  /** One display frame with one tick: poll, then the menu's tick. */
  const tick = (): void => {
    actions.beginFrame();
    controller.update(menu);
  };
  const tap = (code: string): void => {
    keyboard.handleKeyDown(keyEvent(code));
    keyboard.handleKeyUp(keyEvent(code));
    tick();
  };
  const press = (button: number): void => {
    setButton(pad, button, true);
    tick();
    setButton(pad, button, false);
    tick();
  };
  const stick = (y: number): void => {
    pad.axes[1] = y;
    tick();
    pad.axes[1] = 0;
    tick();
  };
  return {
    keyboard,
    pad,
    pointer,
    actions,
    layout,
    bus,
    events,
    selected,
    backs: () => backs,
    disabled,
    hidden,
    menu,
    rects,
    controller,
    tick,
    tap,
    press,
    stick,
  };
}

/** Every way GDD §6.1 moves the focus down, select and back. */
const DOWN: [string, (r: Rig) => void][] = [
  ['↓', (r) => r.tap('ArrowDown')],
  ['S', (r) => r.tap('KeyS')],
  ['D-pad down', (r) => r.press(PAD_BUTTON.DPAD_DOWN)],
  ['left stick down', (r) => r.stick(MENU_STICK_THRESHOLD)],
];
const UP: [string, (r: Rig) => void][] = [
  ['↑', (r) => r.tap('ArrowUp')],
  ['W', (r) => r.tap('KeyW')],
  ['D-pad up', (r) => r.press(PAD_BUTTON.DPAD_UP)],
  ['left stick up', (r) => r.stick(-1)],
];
const SELECT: [string, (r: Rig) => void][] = [
  ['Enter', (r) => r.tap('Enter')],
  ['Space', (r) => r.tap('Space')],
  ['pad A', (r) => r.press(PAD_BUTTON.SOUTH)],
];
const BACK: [string, (r: Rig) => void][] = [
  ['Esc', (r) => r.tap('Escape')],
  ['Backspace', (r) => r.tap('Backspace')],
  ['pad B', (r) => r.press(PAD_BUTTON.EAST)],
];

describe('focus movement', () => {
  it.each(DOWN)(
    '%s moves to the next enabled, visible item, skipping disabled and hidden ones, and wraps',
    (_n, down) => {
      const r = rig();
      expect(r.menu.focus).toBe(0);
      down(r);
      expect(r.menu.focus).toBe(3); // 1 is disabled, 2 is hidden
      down(r);
      expect(r.menu.focus).toBe(4);
      down(r);
      expect(r.menu.focus).toBe(0); // wrapped
      expect(r.selected).toEqual([]);
    },
  );

  it.each(UP)('%s moves to the previous reachable item and wraps at the top', (_n, up) => {
    const r = rig();
    up(r);
    expect(r.menu.focus).toBe(4);
    up(r);
    expect(r.menu.focus).toBe(3);
    up(r);
    expect(r.menu.focus).toBe(0);
  });

  it('a stick deflection short of the threshold does not move the focus', () => {
    const r = rig();
    r.stick(MENU_STICK_THRESHOLD - 0.01);
    r.stick(-(MENU_STICK_THRESHOLD - 0.01));
    expect(r.menu.focus).toBe(0);
  });

  it('follows the predicates as they change, and starts on the first reachable item', () => {
    const r = rig({ disabled: [0], hidden: [] });
    expect(r.menu.focus).toBe(1); // 0 disabled at construction
    r.disabled.clear();
    r.disabled.add(1);
    r.disabled.add(2);
    r.tap('KeyS');
    expect(r.menu.focus).toBe(3);
    r.disabled.add(3);
    r.disabled.add(4);
    r.tap('KeyS');
    expect(r.menu.focus).toBe(0); // only 0 left
    r.tap('KeyS');
    expect(r.menu.focus).toBe(0); // nowhere to go: no move, no event
    expect(r.events.filter(([t]) => t === UI_EV.UiMove)).toHaveLength(2);
  });

  it('up and down in the same tick cancel out', () => {
    const r = rig();
    r.keyboard.handleKeyDown(keyEvent('KeyW'));
    r.keyboard.handleKeyDown(keyEvent('KeyS'));
    r.tick();
    expect(r.menu.focus).toBe(0);
    expect(r.events).toEqual([]);
  });
});

describe('select and back', () => {
  it.each(SELECT)('%s selects the focused item and draws it pressed', (_n, select) => {
    const r = rig();
    r.tap('KeyS');
    select(r);
    expect(r.selected).toEqual([3]);
    expect(r.menu.buttonState(3)).toBe(ButtonState.Pressed);
    expect(r.menu.buttonState(0)).toBe(ButtonState.Normal);
    expect(r.menu.buttonState(1)).toBe(ButtonState.Disabled);
  });

  it.each(BACK)('%s calls the back handler', (_n, back) => {
    const r = rig();
    back(r);
    expect(r.backs()).toBe(1);
    expect(r.selected).toEqual([]);
  });

  it('never selects a disabled item, and selecting clears on the next move', () => {
    const r = rig({ disabled: [], hidden: [] });
    r.tap('KeyS');
    r.disabled.add(1);
    r.tap('Enter');
    expect(r.selected).toEqual([]);
    expect(r.menu.buttonState(1)).toBe(ButtonState.Disabled);
    r.disabled.clear();
    r.tap('Enter');
    expect(r.selected).toEqual([1]);
    r.tap('KeyS');
    expect(r.menu.selected).toBe(NO_ITEM);
    expect(r.menu.buttonState(2)).toBe(ButtonState.Focus);
  });

  it('a backItem menu picks that item on Back; a `once` menu then ignores everything', () => {
    const picked: number[] = [];
    const menu = new Menu({
      id: 'once',
      items: [0, 1].map((i) => ({ label: `${i}`, onSelect: () => picked.push(i) })),
      events: null,
      backItem: 1,
      once: true,
    });
    menu.command(MENU_COMMAND.Back);
    expect(picked).toEqual([1]);
    expect(menu.focus).toBe(1);
    expect(menu.finished).toBe(true);
    expect(menu.buttonState(1)).toBe(ButtonState.Pressed);
    menu.command(MENU_COMMAND.Up | MENU_COMMAND.Select);
    menu.command(MENU_COMMAND.Back);
    expect(picked).toEqual([1]);
    expect(menu.focus).toBe(1);
  });

  it('a menu with neither backItem nor onBack ignores Back and emits nothing', () => {
    const events: string[] = [];
    const menu = new Menu({
      id: 'card',
      items: [{ label: 'GO', onSelect: () => {} }],
      events: { emitUi: (type) => events.push(type) },
    });
    expect(menu.back()).toBe(false);
    expect(events).toEqual([]);
  });

  it('rejects an empty menu and out-of-range focus or backItem', () => {
    const item = { label: 'X', onSelect: () => {} };
    expect(() => new Menu({ id: 'm', items: [], events: null })).toThrow(/no items/);
    expect(() => new Menu({ id: 'm', items: [item], events: null, focus: 1 })).toThrow(/focus/);
    expect(() => new Menu({ id: 'm', items: [item], events: null, backItem: 2 })).toThrow(/backItem/);
  });
});

describe('hold-repeat', () => {
  /** Ticks (from the press, tick 0) on which a held input stepped the focus, over `ticks` ticks. */
  function steps(r: Rig, hold: (on: boolean) => void, ticks: number): number[] {
    const out: number[] = [];
    let moves = 0;
    hold(true);
    for (let t = 0; t < ticks; t++) {
      r.tick();
      const now = r.events.filter(([type]) => type === UI_EV.UiMove).length;
      if (now > moves) out.push(t);
      moves = now;
    }
    hold(false);
    return out;
  }

  const expected = (ticks: number): number[] => {
    const out = [0];
    for (let t = MENU_REPEAT_DELAY_TICKS; t < ticks; t += MENU_REPEAT_INTERVAL_TICKS) out.push(t);
    return out;
  };

  it('documents 0.40 s then every 0.15 s at 60 Hz (GDD §6.1)', () => {
    expect(MENU_REPEAT_DELAY_TICKS * DT_S).toBeCloseTo(0.4, 10);
    expect(MENU_REPEAT_INTERVAL_TICKS * DT_S).toBeCloseTo(0.15, 10);
  });

  it.each([
    ['D-pad down', (r: Rig) => (on: boolean) => setButton(r.pad, PAD_BUTTON.DPAD_DOWN, on)],
    [
      'left stick down',
      (r: Rig) => (on: boolean) => {
        r.pad.axes[1] = on ? 0.9 : 0;
      },
    ],
    [
      'S held',
      (r: Rig) => (on: boolean) =>
        on ? r.keyboard.handleKeyDown(keyEvent('KeyS')) : r.keyboard.handleKeyUp(keyEvent('KeyS')),
    ],
  ])('a held %s steps on the press, after the delay, then at the interval', (_n, holder) => {
    const r = rig({ disabled: [], hidden: [] });
    const ticks = MENU_REPEAT_DELAY_TICKS + 4 * MENU_REPEAT_INTERVAL_TICKS + 3;
    expect(steps(r, holder(r), ticks)).toEqual(expected(ticks));
    // Released: nothing more, and a fresh press starts over.
    const before = r.events.length;
    for (let t = 0; t < 60; t++) r.tick();
    expect(r.events.length).toBe(before);
    expect(steps(r, holder(r), MENU_REPEAT_DELAY_TICKS)).toEqual([0]);
  });

  it('select and back never repeat', () => {
    const r = rig();
    setButton(r.pad, PAD_BUTTON.SOUTH, true);
    for (let t = 0; t < 120; t++) r.tick();
    expect(r.selected).toEqual([0]);
  });

  it('a direction held over reset() is ignored until it is released', () => {
    const keyboard = new KeyboardDevice(DT_S);
    const actions = new Actions([keyboard]);
    const sampler = new MenuInputSampler(actions);
    keyboard.handleKeyDown(keyEvent('KeyS')); // braking as the shift ended
    sampler.reset();
    for (let t = 0; t < 120; t++) expect(sampler.sample()).toBe(0);
    keyboard.handleKeyUp(keyEvent('KeyS'));
    expect(sampler.sample()).toBe(0);
    keyboard.handleKeyDown(keyEvent('KeyS'));
    expect(sampler.sample()).not.toBe(0);
  });
});

describe('mouse: client → internal hit-testing', () => {
  // Integer scales 2, 3 and 4 with side bars, top bars or both, and a DPR-2 window.
  const LAYOUTS: [string, ViewportLayout][] = [
    ['2x, bars all round', computeViewportLayout(1000, 600, 1)],
    ['3x, bars all round', computeViewportLayout(1500, 900, 1)],
    ['3x, tall window (W 432)', computeViewportLayout(1300, 1300, 1)],
    ['4x, bars all round', computeViewportLayout(2000, 1200, 1)],
    ['4x at DPR 2', computeViewportLayout(1000, 600, 2)],
    ['4x, 1080p ultrawide (W 640)', computeViewportLayout(2600, 1080, 1)],
  ];

  it('covers integer scales 2, 3 and 4 with letterbox offsets', () => {
    expect(new Set(LAYOUTS.map(([, l]) => l.scale))).toEqual(new Set([2, 3, 4]));
    for (const [, l] of LAYOUTS) expect(l.canvasDeviceLeft + l.canvasDeviceTop).toBeGreaterThan(0);
  });

  /** The client point at the centre of internal rect `r` on screen. */
  function centre(l: ViewportLayout, r: UiRect): [number, number] {
    return [
      (l.canvasDeviceLeft + (r.x + r.w / 2) * l.scale) / l.devicePixelRatio,
      (l.canvasDeviceTop + (r.y + r.h / 2) * l.scale) / l.devicePixelRatio,
    ];
  }

  it.each(LAYOUTS)('%s: a click at the centre of an item maps to that item and selects it', (_n, layout) => {
    const r = rig({ layout, disabled: [], hidden: [] });
    const out = { x: 0, y: 0 };
    r.rects.forEach((rect, i) => {
      const [cx, cy] = centre(layout, rect);
      expect(clientToInternalPx(layout, cx, cy, out)).toBe(true);
      expect(r.menu.itemAt(out.x, out.y)).toBe(i);
      const event = { clientX: cx, clientY: cy, button: 0, isPrimary: true };
      r.pointer.handle(POINTER_PHASE.Down, event);
      r.pointer.handle(POINTER_PHASE.Up, event);
      r.tick();
      expect(r.selected.at(-1)).toBe(i);
      expect(r.menu.focus).toBe(i);
    });
    expect(r.selected).toEqual([0, 1, 2, 3, 4]);
  });

  it.each(LAYOUTS)(
    '%s: maps each device block to its internal pixel, and the letterbox off the frame',
    (_n, l) => {
      const out = { x: 0, y: 0 };
      const dpr = l.devicePixelRatio;
      for (const [ix, iy] of [
        [0, 0],
        [l.internalWidth - 1, 269],
        [137, 91],
      ] as const) {
        const left = l.canvasDeviceLeft + ix * l.scale;
        const top = l.canvasDeviceTop + iy * l.scale;
        // First and last device pixel of the block (sampled at their centres, as a browser reports them).
        for (const [dx, dy] of [
          [left + 0.5, top + 0.5],
          [left + l.scale - 0.5, top + l.scale - 0.5],
        ] as const) {
          expect(clientToInternalPx(l, dx / dpr, dy / dpr, out)).toBe(true);
          expect([out.x, out.y]).toEqual([ix, iy]);
        }
      }
      expect(clientToInternalPx(l, (l.canvasDeviceLeft - 0.5) / dpr, 300 / dpr, out)).toBe(false);
      const bottom = l.canvasDeviceTop + l.canvasDeviceHeight + 0.5;
      expect(clientToInternalPx(l, (l.canvasDeviceLeft + 10) / dpr, bottom / dpr, out)).toBe(false);
    },
  );

  it('selects on release over the pressed item only; a press shows it pressed; hover does nothing', () => {
    const r = rig({ disabled: [], hidden: [] });
    const at = (i: number) => {
      const [x, y] = centre(r.layout, r.rects[i] as UiRect);
      return { clientX: x, clientY: y, button: 0, isPrimary: true };
    };
    r.pointer.handle(POINTER_PHASE.Down, at(3));
    r.tick();
    expect(r.menu.focus).toBe(3);
    expect(r.menu.buttonState(3)).toBe(ButtonState.Pressed);
    expect(r.selected).toEqual([]);
    r.pointer.handle(POINTER_PHASE.Up, at(4)); // dragged off: no selection
    r.tick();
    expect(r.selected).toEqual([]);
    expect(r.menu.buttonState(3)).toBe(ButtonState.Focus);
    r.pointer.handle(POINTER_PHASE.Up, at(4)); // a release with nothing armed
    r.tick();
    expect(r.selected).toEqual([]);
    r.pointer.handle(POINTER_PHASE.Down, at(4));
    r.pointer.handle(POINTER_PHASE.Cancel, at(4));
    r.pointer.handle(POINTER_PHASE.Up, at(4));
    r.tick();
    expect(r.selected).toEqual([]);
    // Right button and non-primary pointers are ignored; a click on empty space does nothing.
    r.pointer.handle(POINTER_PHASE.Down, { ...at(0), button: 2 });
    r.pointer.handle(POINTER_PHASE.Up, { ...at(0), button: 2 });
    r.pointer.handle(POINTER_PHASE.Down, { ...at(0), isPrimary: false });
    r.pointer.handle(POINTER_PHASE.Up, { ...at(0), isPrimary: false });
    r.pointer.handle(POINTER_PHASE.Down, { ...at(0), clientX: 5, clientY: 5 });
    r.pointer.handle(POINTER_PHASE.Up, { ...at(0), clientX: 5, clientY: 5 });
    r.tick();
    expect(r.selected).toEqual([]);
    expect(r.menu.focus).toBe(4);
  });

  it('a click on a disabled or hidden item does nothing', () => {
    const r = rig();
    for (const i of [1, 2]) {
      const [x, y] = centre(r.layout, r.rects[i] as UiRect);
      const event = { clientX: x, clientY: y, button: 0, isPrimary: true };
      r.pointer.handle(POINTER_PHASE.Down, event);
      r.pointer.handle(POINTER_PHASE.Up, event);
      r.tick();
    }
    expect(r.selected).toEqual([]);
    expect(r.menu.focus).toBe(0);
  });

  it('reset() drops clicks made before the menu showed; the queue holds 16 samples', () => {
    const r = rig({ disabled: [], hidden: [] });
    const [x, y] = centre(r.layout, r.rects[0] as UiRect);
    const event = { clientX: x, clientY: y, button: 0, isPrimary: true };
    r.pointer.handle(POINTER_PHASE.Down, event);
    r.pointer.handle(POINTER_PHASE.Up, event);
    r.controller.reset();
    r.tick();
    expect(r.selected).toEqual([]);
    for (let i = 0; i < POINTER_QUEUE_LENGTH + 4; i++) r.pointer.handle(POINTER_PHASE.Cancel, event);
    expect(r.pointer.queued).toBe(POINTER_QUEUE_LENGTH);
    r.tick();
    expect(r.pointer.queued).toBe(0);
  });
});

describe('UI events', () => {
  it('each navigation action emits exactly one UiMove, UiSelect or UiBack', () => {
    const r = rig();
    r.tap('KeyS');
    expect(r.events).toEqual([[UI_EV.UiMove, 'test', 3]]);
    r.press(PAD_BUTTON.DPAD_UP);
    expect(r.events.slice(1)).toEqual([[UI_EV.UiMove, 'test', 0]]);
    r.stick(1);
    expect(r.events.slice(2)).toEqual([[UI_EV.UiMove, 'test', 3]]);
    r.tap('Enter');
    expect(r.events.slice(3)).toEqual([[UI_EV.UiSelect, 'test', 3]]);
    r.press(PAD_BUTTON.SOUTH);
    expect(r.events.slice(4)).toEqual([[UI_EV.UiSelect, 'test', 3]]);
    r.tap('Escape');
    expect(r.events.slice(5)).toEqual([[UI_EV.UiBack, 'test', 3]]);
    r.press(PAD_BUTTON.EAST);
    expect(r.events.slice(6)).toEqual([[UI_EV.UiBack, 'test', 3]]);
    // A click is one action: a single UiSelect, even when the press moved the focus.
    const [x, y] = [
      (r.rects[4]?.x ?? 0) * r.layout.scale + 10,
      ((r.rects[4]?.y ?? 0) + 5) * r.layout.scale + r.layout.canvasDeviceTop,
    ];
    const event = { clientX: x, clientY: y, button: 0, isPrimary: true };
    r.pointer.handle(POINTER_PHASE.Down, event);
    r.pointer.handle(POINTER_PHASE.Up, event);
    r.tick();
    expect(r.events.slice(7)).toEqual([[UI_EV.UiSelect, 'test', 4]]);
    expect(r.events).toHaveLength(8);
    // Ticks with no input emit nothing.
    for (let t = 0; t < 30; t++) r.tick();
    expect(r.events).toHaveLength(8);
  });

  it('a bus listener can unsubscribe; events carry the menu id and the item', () => {
    const bus = new EventBus();
    const seen: number[] = [];
    const off = bus.onUi(UI_EV.UiSelect, (event) => seen.push(event.item));
    bus.emitUi(UI_EV.UiSelect, 'm', 2);
    bus.emitUi(UI_EV.UiMove, 'm', 1);
    off();
    bus.emitUi(UI_EV.UiSelect, 'm', 3);
    expect(seen).toEqual([2]);
  });
});

describe('menu input never reaches the sim', () => {
  it('navigation, selection, back and clicks leave every InputFrame neutral', () => {
    const r = rig({ disabled: [], hidden: [] });
    const neutral = createInputFrame();
    const frames: unknown[] = [];
    const [x, y] = [r.layout.canvasDeviceLeft + 420, r.layout.canvasDeviceTop + 300];
    const event = { clientX: x, clientY: y, button: 0, isPrimary: true };
    r.tap('Enter');
    r.tap('Backspace');
    r.press(PAD_BUTTON.DPAD_DOWN);
    r.press(PAD_BUTTON.START);
    r.stick(-1);
    r.pointer.handle(POINTER_PHASE.Down, event);
    r.pointer.handle(POINTER_PHASE.Up, event);
    for (let t = 0; t < 4; t++) frames.push({ ...r.actions.sampleForTick() });
    for (const frame of frames) expect(frame).toEqual(neutral);
    expect(r.selected.length).toBeGreaterThan(0);
  });
});
