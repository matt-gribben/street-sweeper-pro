// The scene stack (SSP-043, TECHNICAL_DESIGN §6.1): the top scene gets the input and the scenes below a
// neutral frame until one blocks updates below it; every scene renders, bottom first; enter/exit ordering
// for push, replace and pop; failed and overlapping transitions; and which scenes' sim events get drained.
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/app/events.ts';
import { SCENE_IDS, type Scene, type SceneId, SceneManager } from '../../src/app/SceneManager.ts';
import {
  createEventQueue,
  EV,
  type EventQueue,
  pushEvent,
  resetEvents,
  sealEvents,
} from '../../src/sim/eventQueue.ts';
import { createInputFrame, type InputFrame } from '../../src/sim/inputFrame.ts';

/** A scene that logs every call to a shared log. */
class LogScene implements Scene {
  readonly id: SceneId;
  readonly blocksUpdateBelow: boolean;
  readonly simEvents: EventQueue | null;
  readonly inputs: Readonly<InputFrame>[] = [];
  private readonly log: string[];
  private readonly name: string;
  enterGate: Promise<void> = Promise.resolve();
  onUpdate: (() => void) | null = null;
  private tick = 0;

  constructor(name: string, log: string[], options: { blocks?: boolean; sim?: boolean; id?: SceneId } = {}) {
    this.name = name;
    this.log = log;
    this.id = options.id ?? 'title';
    this.blocksUpdateBelow = options.blocks ?? false;
    this.simEvents = options.sim === true ? createEventQueue() : null;
  }

  async enter(): Promise<void> {
    this.log.push(`${this.name} enter`);
    await this.enterGate;
    this.log.push(`${this.name} entered`);
  }

  exit(): void {
    this.log.push(`${this.name} exit`);
  }

  fixedUpdate(input: Readonly<InputFrame>): void {
    this.inputs.push(input);
    this.log.push(`${this.name} update`);
    const queue = this.simEvents;
    if (queue !== null) {
      resetEvents(queue, this.tick);
      pushEvent(queue, EV.Impact, -1, 0, 0, this.tick);
      sealEvents(queue);
    }
    this.tick += 1;
    this.onUpdate?.();
  }

  render(alpha: number): void {
    this.log.push(`${this.name} render ${alpha}`);
  }
}

const SEED = { seed: 1 } as const;

describe('SceneManager', () => {
  it('lists the scene IDs of the flow (§6.2) and the test scenes', () => {
    for (const id of ['boot', 'title', 'shift', 'pause', 'tally', 'zoo', 'lean_quadrants', 'scale_1440']) {
      expect(SCENE_IDS).toContain(id);
    }
    expect(new Set(SCENE_IDS).size).toBe(SCENE_IDS.length);
  });

  it('pushes a scene only once enter() resolves', async () => {
    const log: string[] = [];
    const scenes = new SceneManager();
    const a = new LogScene('a', log);
    let open = (): void => {};
    a.enterGate = new Promise((resolve) => {
      open = resolve;
    });
    const pushed = scenes.push(a, SEED);
    expect(scenes.busy).toBe(true);
    expect(scenes.size).toBe(0);
    scenes.fixedUpdate(createInputFrame());
    scenes.render(0);
    expect(log).toEqual(['a enter']);
    open();
    await pushed;
    expect(scenes.busy).toBe(false);
    expect(scenes.top).toBe(a);
    expect(scenes.ids()).toEqual(['title']);
  });

  it('gives the top scene the input and the scenes below a neutral frame', async () => {
    const log: string[] = [];
    const scenes = new SceneManager();
    const below = new LogScene('below', log);
    const top = new LogScene('top', log);
    await scenes.push(below, SEED);
    await scenes.push(top, SEED);
    log.length = 0;
    const input = { throttle: 200, brake: 0, steer: -40, buttons: 1, pressed: 2 };
    scenes.fixedUpdate(input);
    expect(log).toEqual(['top update', 'below update']);
    expect(top.inputs[0]).toBe(input);
    expect(below.inputs[0]).toEqual(createInputFrame());
    expect(Object.isFrozen(below.inputs[0])).toBe(true);
  });

  it('stops updating below a scene that blocks updates, but keeps rendering everything bottom first', async () => {
    const log: string[] = [];
    const scenes = new SceneManager();
    await scenes.push(new LogScene('shift', log, { id: 'shift' }), SEED);
    await scenes.push(new LogScene('pause', log, { id: 'pause', blocks: true }), SEED);
    await scenes.push(new LogScene('toast', log), SEED);
    log.length = 0;
    scenes.fixedUpdate(createInputFrame());
    scenes.render(0.5);
    expect(log).toEqual([
      'toast update',
      'pause update',
      'shift render 0.5',
      'pause render 0.5',
      'toast render 0.5',
    ]);
  });

  it('pop() exits the top scene and the one below takes the input again', async () => {
    const log: string[] = [];
    const scenes = new SceneManager();
    const shift = new LogScene('shift', log, { id: 'shift' });
    await scenes.push(shift, SEED);
    await scenes.push(new LogScene('pause', log, { id: 'pause', blocks: true }), SEED);
    log.length = 0;
    expect(scenes.pop().id).toBe('pause');
    const input = { throttle: 1, brake: 2, steer: 3, buttons: 0, pressed: 0 };
    scenes.fixedUpdate(input);
    expect(log).toEqual(['pause exit', 'shift update']);
    expect(shift.inputs.at(-1)).toBe(input);
    scenes.pop();
    expect(() => scenes.pop()).toThrow(/empty/);
  });

  it('replace() enters the new scene before exiting the old one', async () => {
    const log: string[] = [];
    const scenes = new SceneManager();
    await scenes.push(new LogScene('title', log), SEED);
    await scenes.replace(new LogScene('week', log, { id: 'week_map' }), SEED);
    expect(log).toEqual(['title enter', 'title entered', 'week enter', 'week entered', 'title exit']);
    expect(scenes.ids()).toEqual(['week_map']);
  });

  it('calls onEntered as each scene joins the stack, after enter() and before the old top exits (SSP-071)', async () => {
    const log: string[] = [];
    const scenes = new SceneManager();
    scenes.onEntered = (scene) => log.push(`joined ${scene.id}`);
    await scenes.push(new LogScene('title', log), SEED);
    await scenes.replace(new LogScene('week', log, { id: 'week_map' }), SEED);
    const broken = new LogScene('broken', log, { id: 'tally' });
    broken.enterGate = Promise.reject(new Error('atlas failed'));
    await expect(scenes.replace(broken, SEED)).rejects.toThrow('atlas failed');
    expect(log).toEqual([
      'title enter',
      'title entered',
      'joined title',
      'week enter',
      'week entered',
      'joined week_map',
      'title exit',
      'broken enter',
    ]);
  });

  it('refuses a second transition while one is pending, and a scene already on the stack', async () => {
    const log: string[] = [];
    const scenes = new SceneManager();
    const a = new LogScene('a', log);
    let open = (): void => {};
    a.enterGate = new Promise((resolve) => {
      open = resolve;
    });
    const pending = scenes.push(a, SEED);
    await expect(scenes.push(new LogScene('b', log), SEED)).rejects.toThrow(/in progress/);
    expect(() => scenes.pop()).toThrow(/in progress/);
    open();
    await pending;
    await expect(scenes.push(a, SEED)).rejects.toThrow(/already on the stack/);
  });

  it('leaves the stack unchanged when enter() rejects', async () => {
    const log: string[] = [];
    const scenes = new SceneManager();
    await scenes.push(new LogScene('a', log), SEED);
    const broken = new LogScene('broken', log);
    broken.enterGate = Promise.reject(new Error('atlas failed'));
    await expect(scenes.push(broken, SEED)).rejects.toThrow('atlas failed');
    expect(scenes.size).toBe(1);
    expect(scenes.busy).toBe(false);
    await expect(scenes.replace(broken, SEED)).rejects.toThrow('atlas failed');
    expect(scenes.ids()).toEqual(['title']);
    expect(log).not.toContain('a exit');
  });

  it('lets a scene pop itself during its update without skipping the scene below this tick', async () => {
    const log: string[] = [];
    const scenes = new SceneManager();
    await scenes.push(new LogScene('below', log), SEED);
    const top = new LogScene('top', log);
    top.onUpdate = () => scenes.pop();
    await scenes.push(top, SEED);
    log.length = 0;
    scenes.fixedUpdate(createInputFrame());
    expect(log).toEqual(['top update', 'top exit', 'below update']);
    expect(scenes.size).toBe(1);
  });

  it('drains the sim events only of scenes that updated this tick', async () => {
    const log: string[] = [];
    const scenes = new SceneManager();
    const bus = new EventBus();
    const ticks: number[] = [];
    bus.on(EV.Impact, (e) => ticks.push(e.tick));
    await scenes.push(new LogScene('shift', log, { id: 'shift', sim: true }), SEED);
    scenes.fixedUpdate(createInputFrame());
    scenes.drainEvents(bus);
    scenes.fixedUpdate(createInputFrame());
    scenes.drainEvents(bus);
    expect(ticks).toEqual([0, 1]);
    await scenes.push(new LogScene('pause', log, { id: 'pause', blocks: true }), SEED);
    scenes.fixedUpdate(createInputFrame());
    scenes.drainEvents(bus);
    expect(ticks).toEqual([0, 1]);
    scenes.pop();
    scenes.fixedUpdate(createInputFrame());
    scenes.drainEvents(bus);
    expect(ticks).toEqual([0, 1, 2]);
  });
});
