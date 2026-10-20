// Pam's tutorial prompt layer (SSP-290; GDD §16.1, §16.2, §17.2; LEVEL_DESIGN §4.4): each of the 13 Puddle Lane beats
// fires exactly once per shift on its trigger and not before, beats that fire together show one after another,
// performing an action cancels or dismisses its beat and marks it learned for the rest of the session, informational
// beats are learned when shown, beat 3 drives the Brush-o-meter clean-zone highlight while it shows, and the frame
// reader turns read-only World state into the triggers' inputs. The layer runs over a real Hud (its Radio) with the
// compiled Puddle Lane beats, ticked in ShiftScene's order: the HUD's radio ages first, then the layer.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/app/events.ts';
import { DEFAULT_GLYPHS } from '../../src/app/glyphBindings.ts';
import { HUD_FONT } from '../../src/scenes/ShiftScene.ts';
import { BrushState } from '../../src/sim/brush.ts';
import { Offence } from '../../src/sim/complaints.ts';
import { NPC_IDS } from '../../src/sim/entities.ts';
import {
  createEventQueue,
  EV,
  type EventType,
  pushEvent,
  resetEvents,
  sealEvents,
} from '../../src/sim/eventQueue.ts';
import { DumpSite } from '../../src/sim/hopper.ts';
import { decodeLevel, type TutorialTrigger } from '../../src/sim/map.ts';
import { addNpcAt } from '../../src/sim/npc/store.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld } from '../../src/sim/world.ts';
import { HUD_HEIGHT_PX, Hud } from '../../src/ui/hud.ts';
import { createHudSnapshot, type HudSnapshot, hudModel } from '../../src/ui/hudModel.ts';
import { BARK_NONE, BARK_PAGE_TICKS } from '../../src/ui/radio.ts';
import {
  CLEAN_HIGHLIGHT_WHILE_SHOWING,
  createTutorialFrame,
  pledgeFrontageInView,
  readTutorialFrame,
  TUTORIAL_FINAL_TICKS,
  type TutorialFrame,
  TutorialLayer,
  type TutorialOptions,
  tutorialBeats,
} from '../../src/ui/tutorial.ts';
import { TutorialMemory } from '../../src/ui/tutorialMemory.ts';
import { readBitmapFont, readIndexedAtlas, TextRaster } from '../support/textRaster.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const font = readBitmapFont(HUD_FONT);
const uiAtlas = readIndexedAtlas('ui');
const LEVEL = decodeLevel(readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8'));
const BEATS = tutorialBeats(LEVEL);
/** Puddle Lane's depot start (body centre, metres). */
const START = { x: 7, y: 89 } as const;

/** The beat number of `trigger`. */
function beatOf(trigger: TutorialTrigger): number {
  const n = BEATS.findIndex((b) => b.trigger === trigger) + 1;
  if (n === 0) throw new Error(`no beat for ${trigger}`);
  return n;
}

/** One event's payload as the sim would emit it (valid for the bus's decoder). */
const PAYLOAD: Partial<Record<EventType, [number, number, number]>> = {
  [EV.LitterCollected]: [10, 80, 0],
  [EV.Fling]: [10, 80, 0],
  [EV.KerbJolt]: [10, 80, 3],
  [EV.Complaint]: [10, 80, Offence.Hit],
  [EV.DumpStart]: [DumpSite.Depot, 5, 120],
  [EV.Horn]: [10, 80, 8],
};

/** A shift's tutorial over a real HUD and bus, started at the depot. */
function shift(memory: TutorialMemory = new TutorialMemory(), options: TutorialOptions = {}) {
  const hud = new Hud(new TextRaster(480, HUD_HEIGHT_PX, uiAtlas), font, DEFAULT_GLYPHS);
  const bus = new EventBus();
  const layer = new TutorialLayer(BEATS, hud, memory, options);
  const off = layer.attach(bus);
  const frame: TutorialFrame = createTutorialFrame();
  frame.xM = START.x;
  frame.yM = START.y;
  frame.ticksRemaining = 14_400;
  layer.start(frame);
  let tick = 0;
  return {
    hud,
    layer,
    frame,
    memory,
    off,
    get tick() {
      return tick;
    },
    /** n World ticks, in ShiftScene's order: the HUD's radio ages, then the layer reads the frame. */
    step(n = 1): void {
      for (let i = 0; i < n; i++) {
        tick += 1;
        hud.radio.tick();
        layer.tick(frame);
      }
    },
    /** One sim event on the bus, as the loop drains it after a tick. */
    emit(type: EventType): void {
      const [a, b, c] = PAYLOAD[type] ?? [0, 0, 0];
      // A fresh queue per event: the bus drains a queue once per tick.
      const queue = createEventQueue();
      resetEvents(queue, tick);
      pushEvent(queue, type, -1, a, b, c);
      sealEvents(queue);
      bus.drain(queue);
    },
    /** Steps until nothing shows (at most `limit` ticks). */
    drain(limit = 20_000): void {
      for (let i = 0; i < limit && hud.radio.currentId !== BARK_NONE; i++) this.step();
    },
  };
}
type Shift = ReturnType<typeof shift>;

describe('beat 1 (shift_start)', () => {
  it('shows at shift start, before the first tick, and once only', () => {
    const s = shift();
    expect(s.layer.currentBeat).toBe(1);
    expect(s.layer.fired).toEqual([1]);
    expect(s.hud.radio.currentText).toBe(BEATS[0]?.text);
    s.step(2_000);
    expect(s.layer.fired).toEqual([1]);
  });
});

/**
 * One case per state or event trigger: `before` sets the frame just short of the trigger (it must not fire),
 * `at` makes it hold (it fires), and it keeps holding for many ticks after (it never fires again).
 */
const CASES: {
  trigger: TutorialTrigger;
  before: (s: Shift) => void;
  at: (s: Shift) => void;
}[] = [
  {
    trigger: 'moved_10m',
    before: (s) => {
      s.frame.xM = START.x + 9.9;
    },
    at: (s) => {
      s.frame.xM = START.x + 10;
    },
  },
  { trigger: 'first_pickup', before: () => {}, at: (s) => s.emit(EV.LitterCollected) },
  { trigger: 'first_fling', before: () => {}, at: (s) => s.emit(EV.Fling) },
  {
    trigger: 'chain_10',
    before: (s) => {
      s.frame.chain = 9;
    },
    at: (s) => {
      s.frame.chain = 10;
    },
  },
  { trigger: 'first_kerb_contact', before: () => {}, at: (s) => s.emit(EV.KerbJolt) },
  {
    trigger: 'hopper_80',
    before: () => {},
    at: (s) => {
      s.frame.hopperWarning = true;
    },
  },
  {
    trigger: 'in_depot_bay',
    before: () => {},
    at: (s) => {
      s.frame.inDepotBay = true;
    },
  },
  {
    trigger: 'cat_within_10m',
    before: () => {},
    at: (s) => {
      s.frame.catNear = true;
    },
  },
  {
    trigger: 'doris_encounter',
    before: () => {},
    at: (s) => {
      s.frame.dorisNear = true;
    },
  },
  { trigger: 'first_complaint', before: () => {}, at: (s) => s.emit(EV.Complaint) },
  {
    trigger: 'pledge_on_screen',
    before: () => {},
    at: (s) => {
      s.frame.pledgeOnScreen = true;
    },
  },
  {
    trigger: 'timer_remaining<=60',
    before: (s) => {
      s.frame.timerRunning = true;
      s.frame.ticksRemaining = TUTORIAL_FINAL_TICKS + 1;
    },
    at: (s) => {
      s.frame.ticksRemaining = TUTORIAL_FINAL_TICKS;
    },
  },
];

describe('each trigger fires its beat exactly once per shift, on the trigger and not before', () => {
  it.each(CASES)('$trigger', ({ trigger, before, at }) => {
    const s = shift();
    const n = beatOf(trigger);
    before(s);
    s.step(300);
    expect(s.layer.fired, 'before its trigger').toEqual([1]);
    at(s);
    s.step();
    expect(s.layer.fired, 'on its trigger').toEqual([1, n]);
    // The trigger keeps holding (and the event comes again): still once.
    for (let k = 0; k < 3; k++) {
      at(s);
      s.step(100);
    }
    s.drain();
    expect(s.layer.fired.filter((b) => b === n)).toEqual([n]);
  });

  it('moved_10m: 9.9 m of path is short, 10 m fires; reversing counts as path', () => {
    const s = shift();
    s.frame.yM = START.y - 5;
    s.step();
    s.frame.yM = START.y - 0.1;
    s.step();
    expect(s.layer.distanceM).toBeCloseTo(9.9, 10);
    expect(s.layer.fired).toEqual([1]);
    s.frame.yM = START.y;
    s.step();
    expect(s.layer.distanceM).toBe(10);
    expect(s.layer.fired).toEqual([1, 2]);
  });

  it('first_kerb_contact also fires on a hugging gutter brush (dirt.kerbContact), once', () => {
    const s = shift();
    s.frame.kerbContact = true;
    s.step(50);
    s.emit(EV.KerbJolt);
    expect(s.layer.fired).toEqual([1, beatOf('first_kerb_contact')]);
  });

  it('beat 13 waits for the running timer (the rollout holds the full timer)', () => {
    const s = shift();
    s.frame.timerRunning = false;
    s.frame.ticksRemaining = 0;
    s.step(10);
    expect(s.layer.fired).toEqual([1]);
  });

  it('no beat fires once the shift has reached its knock-off', () => {
    const s = shift();
    s.frame.over = true;
    s.step();
    s.frame.chain = 50;
    s.frame.catNear = true;
    s.step(10);
    s.emit(EV.Complaint);
    expect(s.layer.fired).toEqual([1]);
  });
});

describe('one prompt at a time (GDD §16.1, §17.2)', () => {
  it('two triggers in the same tick show one after the other, never together, in beat order', () => {
    const s = shift();
    s.frame.chain = 10;
    s.frame.hopperWarning = true;
    s.step();
    expect(s.layer.fired).toEqual([1, beatOf('chain_10'), beatOf('hopper_80')]);
    const shown: number[] = [];
    const starts: number[] = [];
    for (let t = 0; t < 10_000 && s.hud.radio.currentId !== BARK_NONE; t++) {
      const now = s.layer.currentBeat;
      if (now !== shown[shown.length - 1]) {
        shown.push(now);
        starts.push(s.tick);
      }
      // The radio holds one bark: the rest wait in its queue.
      expect(s.hud.radio.queuedIds.includes(s.hud.radio.currentId)).toBe(false);
      s.step();
    }
    expect(shown).toEqual([1, 5, 7]);
    // Beat 5 starts only once beat 1's pages are over, and beat 7 once beat 5's are.
    const pages = (n: number): number => {
      const hud = new Hud(new TextRaster(480, HUD_HEIGHT_PX, uiAtlas), font, DEFAULT_GLYPHS);
      hud.radio.enqueue(BEATS[n - 1]?.text ?? '');
      return hud.radio.currentPages.length;
    };
    expect(starts[1]).toBe(pages(1) * BARK_PAGE_TICKS);
    expect((starts[2] ?? 0) - (starts[1] ?? 0)).toBe(pages(5) * BARK_PAGE_TICKS);
  });
});

describe('the learned rule (GDD §16.1)', () => {
  it('lowering the brush while beat 2 is queued cancels it and marks brush learned', () => {
    const s = shift();
    s.frame.xM = START.x + 12;
    s.step();
    expect(s.layer.fired).toEqual([1, 2]);
    expect(s.layer.currentBeat).toBe(1);
    expect(s.layer.state().queued).toEqual([2]);
    s.frame.brushDown = true;
    s.step();
    expect(s.layer.state().queued).toEqual([]);
    expect(s.memory.has('brush')).toBe(true);
    s.drain();
    expect(s.layer.fired).toEqual([1, 2]);
  });

  it('lowering the brush while beat 2 shows dismisses it at once', () => {
    const s = shift();
    // Throttle then steer: beat 1 is learned (drive) and dismissed.
    s.frame.throttle = true;
    s.step(30);
    expect(s.layer.currentBeat).toBe(1);
    s.frame.steer = true;
    s.step();
    expect(s.layer.currentBeat).toBe(0);
    expect(s.memory.learned()).toEqual(['drive']);
    s.frame.xM = START.x + 10;
    s.step();
    expect(s.layer.currentBeat).toBe(2);
    s.step(20);
    s.frame.brushDown = true;
    s.step();
    expect(s.layer.currentBeat).toBe(0);
    expect(s.hud.radio.currentId).toBe(BARK_NONE);
    expect(s.memory.learned()).toEqual(['drive', 'brush']);
  });

  it('a learned beat does not fire in the next shift of the same session', () => {
    const memory = new TutorialMemory();
    const first = shift(memory);
    first.frame.brushDown = true;
    first.step();
    first.frame.xM = START.x + 20;
    first.step();
    expect(first.layer.fired).toEqual([1]);
    expect(memory.has('brush')).toBe(true);
    first.off();

    const second = shift(memory);
    expect(second.layer.fired).toEqual([1]);
    second.frame.xM = START.x + 20;
    second.step(10);
    expect(second.layer.fired).toEqual([1]);
    // Showing a beat learns it, so beat 1 (drive) does not come back either once performed.
    second.frame.throttle = true;
    second.frame.steer = true;
    second.step();
    const third = shift(memory);
    expect(third.layer.fired).toEqual([]);
    expect(third.layer.currentBeat).toBe(0);
  });

  it('a beat performed before its trigger never fires (dump, horn)', () => {
    const s = shift();
    s.emit(EV.DumpStart);
    s.emit(EV.Horn);
    s.frame.inDepotBay = true;
    s.frame.catNear = true;
    s.step(10);
    expect(s.layer.fired).toEqual([1]);
    expect(s.memory.learned()).toEqual(['dump', 'horn']);
  });

  it('informational beats are learned when they start showing, not when queued', () => {
    const s = shift();
    s.frame.chain = 10;
    s.step();
    expect(s.layer.state().queued).toEqual([5]);
    expect(s.memory.has('combo')).toBe(false);
    s.step(10_000);
    expect(s.memory.has('combo')).toBe(true);
    const next = shift(s.memory);
    next.frame.chain = 10;
    next.step();
    expect(next.layer.fired).toEqual([1]);
  });

  it('Show tips plays learned beats again, each still once per shift', () => {
    const memory = new TutorialMemory(['drive', 'combo']);
    expect(shift(memory).layer.fired).toEqual([]);
    const s = shift(memory, { showTips: true });
    s.frame.chain = 10;
    s.step(100);
    expect(s.layer.fired).toEqual([1, 5]);
  });

  it('TutorialMemory: load() seeds it, learned() reads it back in order, without duplicates', () => {
    const memory = new TutorialMemory();
    memory.load(['brush', 'fling', 'brush', '']);
    expect(memory.learned()).toEqual(['brush', 'fling']);
    expect(memory.learn('combo')).toBe(true);
    expect(memory.learn('combo')).toBe(false);
    const copy = memory.learned();
    copy.push('x');
    expect(memory.learned()).toEqual(['brush', 'fling', 'combo']);
    memory.load([]);
    expect(memory.learned()).toEqual([]);
  });
});

describe('beat 3 drives the Brush-o-meter clean-zone highlight (GDD §16.2, SSP-299)', () => {
  /** The HUD model's meter for the HUD's own highlight deadline, brush collecting at 2 m/s. */
  function meter(hud: Hud, tick: number) {
    const snapshot: HudSnapshot = {
      ...createHudSnapshot(),
      ticksRemaining: 14_400,
      hopperCapacityLu: 100,
      hopperWarnFraction: 0.8,
      water: 100,
      tankUnits: 100,
      hp: 100,
      maxHp: 100,
      dentedBelowHp: 40,
      speedMps: 2,
      brushState: BrushState.Collecting,
      rpm: 1,
      cleanHighlightUntilTick: hud.snapshot.cleanHighlightUntilTick,
    };
    return hudModel(snapshot, tick).meter;
  }

  it('highlights while beat 3 shows and clears when it is dismissed', () => {
    const s = shift();
    s.frame.throttle = true;
    s.frame.steer = true;
    s.step();
    expect(s.layer.currentBeat).toBe(0);
    expect(meter(s.hud, s.tick).highlight).toBe(false);
    s.emit(EV.LitterCollected);
    expect(s.layer.currentBeat).toBe(3);
    expect(s.hud.snapshot.cleanHighlightUntilTick).toBe(CLEAN_HIGHLIGHT_WHILE_SHOWING);
    for (let t = 0; t < 200; t++) {
      expect(meter(s.hud, s.tick).highlight, `tick ${s.tick}`).toBe(true);
      s.step();
    }
    s.drain();
    expect(s.layer.currentBeat).toBe(0);
    expect(meter(s.hud, s.tick).highlight).toBe(false);
    expect(s.hud.snapshot.cleanHighlightUntilTick).toBe(-1);
  });

  it('waits for beat 3 to show when it is queued, and clears when it is cancelled from the radio', () => {
    const s = shift();
    s.emit(EV.LitterCollected);
    expect(s.layer.currentBeat).toBe(1);
    expect(meter(s.hud, s.tick).highlight).toBe(false);
    for (let t = 0; t < 5_000 && s.layer.currentBeat !== 3; t++) s.step();
    expect(s.layer.currentBeat).toBe(3);
    expect(meter(s.hud, s.tick).highlight).toBe(true);
    s.hud.radio.cancel(s.hud.radio.currentId);
    s.step();
    expect(meter(s.hud, s.tick).highlight).toBe(false);
  });

  it('clears when the scene exits mid-beat (dispose)', () => {
    const s = shift();
    s.frame.throttle = true;
    s.frame.steer = true;
    s.step();
    s.emit(EV.LitterCollected);
    expect(meter(s.hud, s.tick).highlight).toBe(true);
    s.layer.dispose();
    expect(meter(s.hud, s.tick).highlight).toBe(false);
  });
});

describe('readTutorialFrame and pledgeFrontageInView', () => {
  it('reads Bessie, the input, the brush, the chain, the hopper, the bay, the NPCs and the timer from the World', () => {
    const world = createWorld(LEVEL, 1, DEFAULT_TUNING);
    const frame = readTutorialFrame(world, false, createTutorialFrame());
    expect(frame).toMatchObject({
      xM: START.x,
      yM: START.y,
      throttle: false,
      steer: false,
      brushDown: false,
      chain: 0,
      hopperWarning: false,
      inDepotBay: false,
      catNear: false,
      dorisNear: false,
      kerbContact: false,
      timerRunning: false,
      ticksRemaining: 14_400,
      over: false,
      pledgeOnScreen: false,
    });
    world.input.throttle = 40;
    world.input.steer = -3;
    world.vehicle.brushDown = true;
    expect(readTutorialFrame(world, true, frame)).toMatchObject({
      throttle: true,
      steer: true,
      brushDown: true,
      pledgeOnScreen: true,
    });
    // Hopper at 80% (the warning fill) and Bessie's centre on a depot bay's edge.
    const capacity = world.hopper.params.hopperCapacityLU;
    world.vehicle.hopperLU = capacity * 0.8;
    const s = world.shift;
    const bay = [...Array(s.siteCount).keys()].find((i) => s.siteKind[i] === DumpSite.Depot) ?? -1;
    world.vehicle.xM = s.siteMinX[bay] ?? 0;
    world.vehicle.yM = s.siteMaxY[bay] ?? 0;
    expect(readTutorialFrame(world, false, frame)).toMatchObject({ hopperWarning: true, inDepotBay: true });
    world.vehicle.hopperLU = 0;
    expect(readTutorialFrame(world, false, frame).inDepotBay).toBe(false);
  });

  it('a cat or Doris counts within 10 m of Bessie, not beyond', () => {
    const world = createWorld(LEVEL, 1, DEFAULT_TUNING);
    const { xM, yM } = world.vehicle;
    const cat = NPC_IDS.indexOf('npc.cat');
    const doris = NPC_IDS.indexOf('npc.old_woman');
    world.npc.count = 0;
    addNpcAt(world.npc, cat, 0, xM + 10.01, yM);
    addNpcAt(world.npc, doris, 0, xM, yM - 10.01);
    expect(readTutorialFrame(world, false, createTutorialFrame())).toMatchObject({
      catNear: false,
      dorisNear: false,
    });
    world.npc.x[0] = xM + 6;
    world.npc.y[0] = yM + 8;
    world.npc.y[1] = yM - 9.99;
    expect(readTutorialFrame(world, false, createTutorialFrame())).toMatchObject({
      catNear: true,
      dorisNear: true,
    });
  });

  it('the timer: running with ticks left; over from the knock-off', () => {
    const world = createWorld(LEVEL, 1, DEFAULT_TUNING);
    world.shift.phase = 1;
    world.shift.ticksRemaining = TUTORIAL_FINAL_TICKS;
    expect(readTutorialFrame(world, false, createTutorialFrame())).toMatchObject({
      timerRunning: true,
      ticksRemaining: TUTORIAL_FINAL_TICKS,
      over: false,
    });
    world.shift.phase = 2;
    expect(readTutorialFrame(world, false, createTutorialFrame())).toMatchObject({
      timerRunning: false,
      over: true,
    });
  });

  it('a pledge frontage is on screen when its zone rect overlaps the camera ground rect', () => {
    const pledge = LEVEL.frontages.find((f) => f.pledge);
    if (pledge === undefined) throw new Error('no pledge frontage');
    const [x0, y0, x1, y1] = pledge.rect.map((v) => v * 2) as [number, number, number, number];
    const view = (minX: number, minY: number, maxX: number, maxY: number) => ({ minX, minY, maxX, maxY });
    expect(pledgeFrontageInView(LEVEL.frontages, view(x0 - 1, y0 - 1, x0 + 0.5, y0 + 0.5))).toBe(true);
    expect(pledgeFrontageInView(LEVEL.frontages, view(x1 - 0.5, y1 - 0.5, x1 + 30, y1 + 17))).toBe(true);
    // Touching the edge is not on screen.
    const others = LEVEL.frontages.filter((f) => f !== pledge);
    expect(pledgeFrontageInView([pledge], view(x1, y0, x1 + 30, y1))).toBe(false);
    // Puddle Lane's depot start shows no pledge frontage (the camera's 30 × 17 m rect over Bessie).
    expect(
      pledgeFrontageInView(LEVEL.frontages, view(START.x - 15, START.y - 8.5, START.x + 15, START.y + 8.5)),
    ).toBe(false);
    expect(
      pledgeFrontageInView(
        others.filter((f) => !f.pledge),
        view(-1e3, -1e3, 1e3, 1e3),
      ),
    ).toBe(false);
  });
});

describe('the per-tick path source allocates nothing (TECHNICAL_DESIGN §17; the heap check is tutorialHeap.test.ts)', () => {
  const NEW_RE = /\bnew\s+[A-Za-z_$]/;
  const ARRAY_LITERAL_RE = /(?:[=(,]|\breturn)\s*\[/;
  const OBJECT_LITERAL_RE = /(?:[=(,]|\breturn)\s*\{/;

  it('src/ui/tutorial.ts: no new, array or object literal between the per-tick markers', () => {
    const source = readFileSync(`${REPO_ROOT}src/ui/tutorial.ts`, 'utf8');
    const parts = source.split('// per-tick path: begin').slice(1);
    expect(parts.length, 'marked regions').toBe(2);
    for (const part of parts) {
      const end = part.indexOf('// per-tick path: end');
      expect(end).toBeGreaterThan(0);
      const lines = part
        .slice(0, end)
        .split('\n')
        .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
      expect(lines.filter((l) => NEW_RE.test(l))).toEqual([]);
      expect(lines.filter((l) => ARRAY_LITERAL_RE.test(l))).toEqual([]);
      expect(lines.filter((l) => OBJECT_LITERAL_RE.test(l))).toEqual([]);
    }
  });
});
