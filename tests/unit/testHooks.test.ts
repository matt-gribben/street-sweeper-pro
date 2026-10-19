// Test hooks (SSP-019; TECHNICAL_DESIGN §18.5): `?test=1` parameter parsing, the inert installer without the
// flag, and the M0 stub behaviour of window.__ssp over a fake host (no WebGL needed).
import { describe, expect, it } from 'vitest';
import {
  installTestHooks,
  isShiftTestState,
  MAX_PAGE,
  MAX_SEED,
  readTestParams,
  TEST_RENDER_STEP_S,
  type TestCamera,
  type TestHookHost,
  type TestHookTarget,
} from '../../src/debug/testHooks.ts';
import {
  appendInput,
  createInputLog,
  encodeInputs,
  type InputLog,
  inputLogsEqual,
} from '../../src/sim/replay.ts';

/** A host that records calls: a tick counter, a camera and a 2x1 "frame" holding the tick. */
function fakeHost(
  snapshot: TestHookHost['snapshot'] = () => null,
): TestHookHost & { calls: string[]; history: string[]; stack: string[] } {
  let tick = 0;
  const history: string[] = [];
  const stack: string[] = [];
  let camera: TestCamera = { x: 0, y: 0, h: 31.5, leadX: 0, leadY: 0, pinned: false };
  const calls: string[] = [];
  return {
    calls,
    history,
    stack,
    tick: () => tick,
    advance: (n) => {
      calls.push(`advance ${n}`);
      tick += n;
    },
    render: () => {
      calls.push('render');
    },
    readFrame: () => new Uint8Array([tick, 0, 0, 255, tick, 0, 0, 255]),
    pinCamera: (x, y, h) => {
      calls.push(`pin ${x} ${y} ${h}`);
      camera = { x, y, h, leadX: 0, leadY: 0, pinned: true };
    },
    camera: () => camera,
    drawCalls: () => 6,
    snapshot,
    renders: () => calls.filter((c) => c === 'render').length,
    sceneId: () => history[history.length - 1] ?? null,
    sceneHistory: () => history,
    sceneStack: () => stack,
    boot: () => ({ status: 'failed', error: "asset registry: atlas 'ui' failed to load", lutBuilds: 1 }),
    loadInputs: (log) => {
      calls.push(`loadInputs ${log.length}`);
    },
  };
}

describe('readTestParams', () => {
  it('returns null unless test=1 is present', () => {
    expect(readTestParams('')).toBeNull();
    expect(readTestParams('?scene=lean_quadrants&freeze=1')).toBeNull();
    expect(readTestParams('?test=0&scene=lean_quadrants')).toBeNull();
    expect(readTestParams('?test=true')).toBeNull();
    expect(readTestParams('?test=')).toBeNull();
  });

  it('defaults every optional parameter', () => {
    expect(readTestParams('?test=1')).toEqual({
      seed: null,
      scene: null,
      tick: 0,
      freeze: false,
      night: false,
      springs: false,
      page: 0,
      asset: null,
    });
  });

  it('parses seed, scene, tick, freeze, night and springs', () => {
    expect(readTestParams('?test=1&seed=1&scene=lean_quadrants&tick=120&freeze=1&night=1&springs=1')).toEqual(
      {
        seed: 1,
        scene: 'lean_quadrants',
        tick: 120,
        freeze: true,
        night: true,
        springs: true,
        page: 0,
        asset: null,
      },
    );
    expect(readTestParams('?test=1&night=0')?.night).toBe(false);
    expect(readTestParams('?test=1&springs=0')?.springs).toBe(false);
    expect(readTestParams('test=1&freeze=0&scene=scale_1440')).toMatchObject({
      scene: 'scale_1440',
      freeze: false,
    });
    expect(readTestParams(`?test=1&seed=${MAX_SEED}`)?.seed).toBe(0xffff_ffff);
    expect(readTestParams('?test=1&scene=district.puddle_lane')?.scene).toBe('district.puddle_lane');
  });

  it("parses the zoo's page and asset (SSP-298)", () => {
    expect(readTestParams('?test=1&scene=zoo&page=3&asset=veh.sweeper')).toMatchObject({
      scene: 'zoo',
      page: 3,
      asset: 'veh.sweeper',
    });
    expect(readTestParams(`?test=1&page=${MAX_PAGE}`)?.page).toBe(MAX_PAGE);
    // An ID the zoo has no frames for is well-formed: the zoo itself reports it and falls back.
    expect(readTestParams('?test=1&scene=zoo&asset=npc.nobody')?.asset).toBe('npc.nobody');
  });

  it.each([
    ['a negative seed', '?test=1&seed=-1'],
    ['a fractional seed', '?test=1&seed=1.5'],
    ['a seed above 2^32 - 1', `?test=1&seed=${MAX_SEED + 1}`],
    ['an empty seed', '?test=1&seed='],
    ['a hex tick', '?test=1&tick=0x10'],
    ['a negative tick', '?test=1&tick=-3'],
    ['freeze=yes', '?test=1&freeze=yes'],
    ['night=true', '?test=1&night=true'],
    ['an empty night', '?test=1&night='],
    ['springs=on', '?test=1&springs=on'],
    ['a scene with a slash', '?test=1&scene=../zoo'],
    ['an upper-case scene', '?test=1&scene=Zoo'],
    ['an empty scene', '?test=1&scene='],
    ['a negative page', '?test=1&page=-1'],
    ['a fractional page', '?test=1&page=1.5'],
    ['a page above the maximum', `?test=1&page=${MAX_PAGE + 1}`],
    ['an asset without a class', '?test=1&asset=sweeper'],
    ['a frame ID as the asset', '?test=1&asset=veh.sweeper:body:h00:0'],
    ['an empty asset', '?test=1&asset='],
  ])('throws on %s', (_label, search) => {
    expect(() => readTestParams(search)).toThrow(/\?test=1/);
  });

  it('uses a fixed 1/60 s render step', () => {
    expect(TEST_RENDER_STEP_S).toBe(1 / 60);
  });
});

describe('installTestHooks without test=1', () => {
  it.each(['', '?scene=lean_quadrants&freeze=1', '?test=0&scene=lean_quadrants'])(
    'does nothing for %j: window.__ssp stays undefined',
    (search) => {
      const target: TestHookTarget = {};
      const host = fakeHost();
      expect(installTestHooks(target, search, host)).toBeNull();
      expect(target.__ssp).toBeUndefined();
      expect('__ssp' in target).toBe(false);
      expect(host.calls).toEqual([]);
    },
  );
});

describe('installTestHooks with test=1', () => {
  it('installs window.__ssp with the documented members and returns the parsed params', () => {
    const target: TestHookTarget = {};
    const hooks = installTestHooks(target, '?test=1&scene=lean_quadrants&freeze=1', fakeHost());
    expect(hooks?.params).toEqual({
      seed: null,
      scene: 'lean_quadrants',
      tick: 0,
      freeze: true,
      night: false,
      springs: false,
      page: 0,
      asset: null,
    });
    expect(target.__ssp).toBe(hooks?.api);
    const api = target.__ssp;
    expect(typeof api?.step).toBe('function');
    expect(typeof api?.state).toBe('function');
    expect(typeof api?.readFrame).toBe('function');
    expect(typeof api?.setCamera).toBe('function');
    expect(Object.keys(api ?? {}).sort()).toEqual([
      'boot',
      'loadInputs',
      'perf',
      'perfReset',
      'readFrame',
      'ready',
      'scene',
      'sceneHistory',
      'scenes',
      'setCamera',
      'state',
      'step',
    ]);
  });

  it('scene() is the active scene ID and sceneHistory() a copy of every scene entered (SSP-071)', () => {
    const target: TestHookTarget = {};
    const host = fakeHost();
    installTestHooks(target, '?test=1', host);
    const api = target.__ssp;
    expect(api?.scene()).toBeNull();
    expect(api?.sceneHistory()).toEqual([]);
    host.history.push('shift_intro', 'shift', 'tally', 'shift');
    expect(api?.scene()).toBe('shift');
    const history = api?.sceneHistory();
    expect(history).toEqual(['shift_intro', 'shift', 'tally', 'shift']);
    history?.push('mutated');
    expect(host.history).toHaveLength(4);
    expect(JSON.parse(JSON.stringify(history?.slice(0, 4)))).toEqual(host.history);
  });

  it('scenes() is a copy of the scene stack, bottom first (SSP-287)', () => {
    const target: TestHookTarget = {};
    const host = fakeHost();
    installTestHooks(target, '?test=1', host);
    const api = target.__ssp;
    expect(api?.scenes()).toEqual([]);
    host.stack.push('shift', 'pause');
    const stack = api?.scenes();
    expect(stack).toEqual(['shift', 'pause']);
    stack?.pop();
    expect(host.stack).toEqual(['shift', 'pause']);
  });

  it("boot() is BootScene's state as JSON-safe plain data (SSP-284)", () => {
    const target: TestHookTarget = {};
    installTestHooks(target, '?test=1', fakeHost());
    const boot = target.__ssp?.boot();
    expect(boot).toEqual({
      status: 'failed',
      error: "asset registry: atlas 'ui' failed to load",
      lutBuilds: 1,
    });
    expect(JSON.parse(JSON.stringify(boot))).toEqual(boot);
  });

  it('loadInputs(inputs, ticks) decodes a replay log strictly and hands it to the host (SSP-073)', () => {
    const target: TestHookTarget = {};
    const host = fakeHost();
    const loaded: InputLog[] = [];
    host.loadInputs = (log) => loaded.push(log);
    installTestHooks(target, '?test=1&freeze=1', host);
    const api = target.__ssp;
    if (api === undefined) throw new Error('hooks not installed');
    // Throttle 255 from tick 0, then the brush pressed on tick 5 only.
    const log = createInputLog(10);
    for (let t = 0; t < 10; t++) {
      appendInput(log, t, { throttle: 255, brake: 0, steer: 0, buttons: 0, pressed: t === 5 ? 1 : 0 });
    }
    api.loadInputs(encodeInputs(log), 10);
    expect(loaded).toHaveLength(1);
    expect(inputLogsEqual(loaded[0] as InputLog, log)).toBe(true);
    // A neutral log is the empty string.
    api.loadInputs('', 3);
    expect(loaded[1]?.length).toBe(3);
    expect(Array.from(loaded[1]?.throttle ?? [])).toEqual([0, 0, 0]);
    // Malformed calls throw and load nothing.
    expect(() => api.loadInputs(encodeInputs(log), 5)).toThrow(/past the replay/);
    expect(() => api.loadInputs('', 0)).toThrow(RangeError);
    expect(() => api.loadInputs('', Number.NaN)).toThrow(RangeError);
    expect(() => api.loadInputs(null as unknown as string, 3)).toThrow(TypeError);
    expect(loaded).toHaveLength(2);
    expect(host.calls).toEqual([]);
  });

  it('reports ready only after markReady()', () => {
    const target: TestHookTarget = {};
    const hooks = installTestHooks(target, '?test=1', fakeHost());
    expect(target.__ssp?.ready).toBe(false);
    hooks?.markReady();
    expect(target.__ssp?.ready).toBe(true);
  });

  it('step(n) advances n ticks then renders once; state() returns { tick, camera }', () => {
    const target: TestHookTarget = {};
    const host = fakeHost();
    installTestHooks(target, '?test=1&freeze=1', host);
    expect(target.__ssp?.state()).toEqual({
      tick: 0,
      camera: { x: 0, y: 0, h: 31.5, leadX: 0, leadY: 0, pinned: false },
    });
    target.__ssp?.step(120);
    expect(host.calls).toEqual(['advance 120', 'render']);
    expect(target.__ssp?.state().tick).toBe(120);
    target.__ssp?.step(0);
    expect(host.calls).toEqual(['advance 120', 'render', 'advance 0', 'render']);
    expect(Object.keys(target.__ssp?.state() ?? {}).sort()).toEqual(['camera', 'tick']);
  });

  it('in a shift, state() is the SimSnapshot plus the camera, and step(n) renders exactly once', () => {
    const target: TestHookTarget = {};
    let simTick = 0;
    const m2 = {
      score: 120,
      tidy: 0.25,
      stars: 0,
      hopper: { lu: 12.5, capacityLu: 100, full: false },
      water: { units: 94, capacity: 100 },
      combo: { chain: 3, multiplier: 1, timerTicks: 80, bestChain: 7 },
      litter: { spawned: 130, collected: 9 },
      grime: { initial: 9000, cleaned: 450 },
      frontages: [{ id: 'frontage.test', clean: 0.5, cleanSwept: false }],
      shift: {
        phase: 'running' as const,
        ticksRemaining: 14_000,
        endReason: null,
        endTick: -1,
        finalScore: null,
        finalStars: null,
      },
      npcs: [
        { id: 'npc.shopper', origin: 'ambient' as const, x: 3, y: 4, heading: 0, state: 0, stateTicks: 9 },
      ],
      complaints: 1,
      pickups: [{ id: 'pwr.flask_of_tea' as const, x: 61, y: 9 }],
      powerUps: [],
    };
    const host = fakeHost(() => ({
      tick: simTick,
      bessie: { x: 7, y: 89 - simTick * 0.01, heading: 0, speed: 0.5 },
      hp: 100,
      ...m2,
    }));
    const advance = host.advance;
    host.advance = (n) => {
      advance(n);
      simTick += n;
    };
    installTestHooks(target, '?test=1&scene=district.puddle_lane&freeze=1', host);
    const api = target.__ssp;
    if (api === undefined) throw new Error('hooks not installed');
    const before = api.perf().renders;
    api.step(600);
    expect(api.perf().renders - before).toBe(1);
    const state = api.state();
    expect(isShiftTestState(state)).toBe(true);
    expect(state).toEqual({
      tick: 600,
      bessie: { x: 7, y: 83, heading: 0, speed: 0.5 },
      hp: 100,
      ...m2,
      camera: { x: 0, y: 0, h: 31.5, leadX: 0, leadY: 0, pinned: false },
    });
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it('outside a shift, state() is { tick, camera } and isShiftTestState is false', () => {
    const target: TestHookTarget = {};
    installTestHooks(target, '?test=1', fakeHost());
    const state = target.__ssp?.state();
    expect(state === undefined ? true : isShiftTestState(state)).toBe(false);
  });

  it('state() is JSON-safe', () => {
    const target: TestHookTarget = {};
    installTestHooks(target, '?test=1', fakeHost());
    const state = target.__ssp?.state();
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('step(%s) throws and does nothing', (n) => {
    const target: TestHookTarget = {};
    const host = fakeHost();
    installTestHooks(target, '?test=1', host);
    expect(() => target.__ssp?.step(n)).toThrow(RangeError);
    expect(host.calls).toEqual([]);
  });

  it('setCamera(x, y, h) pins the camera, then renders so readFrame() sees it', () => {
    const target: TestHookTarget = {};
    const host = fakeHost();
    installTestHooks(target, '?test=1', host);
    target.__ssp?.setCamera(5, -3, 31.5);
    expect(host.calls).toEqual(['pin 5 -3 31.5', 'render']);
    expect(target.__ssp?.state().camera).toEqual({ x: 5, y: -3, h: 31.5, leadX: 0, leadY: 0, pinned: true });
  });

  it('readFrame() returns the host frame', () => {
    const target: TestHookTarget = {};
    const host = fakeHost();
    installTestHooks(target, '?test=1', host);
    target.__ssp?.step(7);
    const frame = target.__ssp?.readFrame();
    expect(frame).toBeInstanceOf(Uint8Array);
    expect(Array.from(frame ?? [])).toEqual([7, 0, 0, 255, 7, 0, 0, 255]);
  });

  it('perf() reports the host draw calls and the frames recorded through recordFrame()', () => {
    const target: TestHookTarget = {};
    const hooks = installTestHooks(target, '?test=1', fakeHost());
    expect(typeof target.__ssp?.perf).toBe('function');
    expect(typeof target.__ssp?.perfReset).toBe('function');
    expect(target.__ssp?.perf()).toEqual({ drawCalls: 6, renders: 0, frameMs: [], workMs: [], overflow: 0 });
    hooks?.recordFrame(8.3, 0.1);
    hooks?.recordFrame(8.4, 0.2);
    const perf = target.__ssp?.perf();
    expect(perf).toEqual({ drawCalls: 6, renders: 0, frameMs: [8.3, 8.4], workMs: [0.1, 0.2], overflow: 0 });
    expect(JSON.parse(JSON.stringify(perf))).toEqual(perf);
  });

  it('perfReset() clears the recorded frames but not the draw-call reading', () => {
    const target: TestHookTarget = {};
    const host = fakeHost();
    const hooks = installTestHooks(target, '?test=1', host);
    hooks?.recordFrame(8.3, 0.1);
    target.__ssp?.perfReset();
    expect(target.__ssp?.perf()).toEqual({ drawCalls: 6, renders: 0, frameMs: [], workMs: [], overflow: 0 });
    expect(host.calls).toEqual([]);
  });

  it('throws on malformed parameters instead of installing', () => {
    const target: TestHookTarget = {};
    expect(() => installTestHooks(target, '?test=1&tick=soon', fakeHost())).toThrow(/tick=soon/);
    expect(target.__ssp).toBeUndefined();
  });
});
