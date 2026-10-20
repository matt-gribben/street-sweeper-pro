// World-space popups and speech bubbles (src/ui/popups.ts, SSP-288; GDD §15.2, §18.3; ART_BIBLE §11; AUDIO_DESIGN
// §13.2): the popup timing and tier colours, the bubble timing rule, the max-3 and same-key rules, the bubbles the M3
// behaviours' events spawn over the right entity (a hit shopper, a hit cat, a caught litterbug, a honking car, Doris's
// fist shake), the projection, the speech-bubble panel's pixels, the freeze under a World that does not step, and the
// per-frame draw path's no-`new` rule (the heap check is popupsHeap.test.ts).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/app/events.ts';
import { FRAME, type FrameId } from '../../src/gen/assets.ts';
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
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { DORIS } from '../../src/sim/npc/behaviours/oldWoman.ts';
import { addNpcAt, NpcOrigin, npcHandle, resolveNpcHandle, setNpcState } from '../../src/sim/npc/store.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld, viewWorld, type World } from '../../src/sim/world.ts';
import { HUD_HEIGHT_PX } from '../../src/ui/hud.ts';
import { type HudCamera, HudColour } from '../../src/ui/hudModel.ts';
import {
  BUBBLE_FILL,
  BUBBLE_OUTLINE,
  bubbleHeightFor,
  bubbleWidthFor,
  type PanelSink,
  Panels,
} from '../../src/ui/panels.ts';
import {
  BUBBLE_CAUGHT,
  BUBBLE_HMPH,
  BUBBLE_HONK,
  BUBBLE_LIFT_ANIMAL_PX,
  BUBBLE_LIFT_PERSON_PX,
  BUBBLE_LIFT_VEHICLE_PX,
  BUBBLE_MAX,
  BUBBLE_NOT_THE_CAT,
  BUBBLE_OI,
  BubbleAnchor,
  BubbleManager,
  bubbleCharCount,
  bubbleDurationS,
  bubbleDurationTicks,
  createPopupFrame,
  POPUP_CAPACITY,
  Popups,
  type PopupWorld,
  popupFrameAt,
  project,
  WORLD_POPUP_LIFE_TICKS,
} from '../../src/ui/popups.ts';
import { endlessShiftTuning } from '../support/endlessShift.ts';
import {
  addPerson,
  CENTRE,
  HALF_L,
  HUMAN_R,
  holdBessie,
  honk,
  kindOf,
  neutral,
  place,
  townWorld,
} from '../support/pedestrianRig.ts';
import { readBitmapFont, readIndexedAtlas, TextRaster } from '../support/textRaster.ts';
import { compileTrafficTown, ONE_WAY_STREET } from '../support/trafficTown.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FONT = readBitmapFont('kerbside5x7');
const UI_ATLAS = readIndexedAtlas('ui');
const W = 480;

/** A sink that only counts quads (the trigger tests read the bubble pool, not pixels). */
class CountingSink implements PanelSink {
  quads = 0;
  add(_frame: FrameId): void {
    this.quads++;
  }
  addRegion(): void {
    this.quads++;
  }
}

/** A queue sealed at `tick` holding `events` ([type, entity, a, b, c]). */
function sealed(tick: number, events: readonly (readonly [EventType, number, number, number, number])[]) {
  const q = createEventQueue();
  resetEvents(q, tick);
  for (const [type, entity, a, b, c] of events) pushEvent(q, type, entity, a, b, c);
  sealEvents(q);
  return q;
}

/** A stand-in World for the bus-level tests: a tick and no NPCs or vehicles. */
function emptyWorld(tick: number): PopupWorld & { tick: number } {
  const world = createWorld(townWorldLevel(), 1, DEFAULT_TUNING);
  return { tick, npc: world.npc, vehicles: world.vehicles };
}

let townLevel: World['level'] | null = null;
function townWorldLevel(): World['level'] {
  townLevel ??= townWorld(1).level;
  return townLevel;
}

/** The camera centred on Bessie at 16 px/m. */
function cameraOn(world: World): HudCamera {
  return { xM: world.vehicle.xM, yM: world.vehicle.yM, pxPerM: 16 };
}

/** Steps `world` once and drains its events into `bus`. */
function stepAndDrain(world: World, bus: EventBus, input = neutral): void {
  world.step(input);
  bus.drain(world.events);
}

/** The active bubble showing `text`, or −1. */
function bubbleWith(popups: Popups, text: string): number {
  for (let s = 0; s < BUBBLE_MAX; s++)
    if (popups.bubbles.isActive(s) && popups.bubbles.text[s] === text) return s;
  return -1;
}

describe('score popup timing and colours (ART_BIBLE §11)', () => {
  it('y offset 0 at spawn and −12 px at tick 36; holds to tick 48; blinks in 3-tick steps; gone at tick 57', () => {
    const f = createPopupFrame();
    const at = (age: number) => {
      popupFrameAt(age, 1, false, 0, f);
      return { visible: f.visible, dy: f.offsetYPx };
    };
    expect(at(0)).toEqual({ visible: true, dy: 0 });
    expect(Object.is(at(0).dy, 0)).toBe(true);
    expect(at(36)).toEqual({ visible: true, dy: -12 });
    // The ease-out: fast first, then slower.
    expect(at(1).dy).toBe(-1);
    expect(at(18).dy).toBe(-9);
    expect(at(35).dy).toBe(-12);
    for (let a = 0; a < 48; a++) expect(at(a).visible, `age ${a}`).toBe(true);
    for (let a = 36; a < 57; a++) expect(at(a).dy, `age ${a}`).toBe(-12);
    const blink = [];
    for (let a = 48; a < 60; a++) blink.push(at(a).visible);
    // Hidden 48–50, shown 51–53, hidden 54–56, then gone.
    expect(blink).toEqual([false, false, false, true, true, true, false, false, false, false, false, false]);
    expect(WORLD_POPUP_LIFE_TICKS).toBe(57);
    expect(at(57).visible).toBe(false);
    expect(at(-1).visible).toBe(false);
  });

  it('colours by tier: ×1 07, ×2 23, ×3 28, ×4 16, ×5 cycling 16 → 17 → 20 → 28 → 23 every 5 ticks; penalties 18', () => {
    const f = createPopupFrame();
    const colour = (m: number, tick = 0, penalty = false) => popupFrameAt(10, m, penalty, tick, f).colour;
    expect([1, 2, 3, 4].map((m) => colour(m))).toEqual([7, 23, 28, 16]);
    expect(colour(3)).toBe(28);
    expect([0, 5, 10, 15, 20, 25].map((t) => colour(5, t))).toEqual([16, 17, 20, 28, 23, 16]);
    expect(colour(5, 4)).toBe(16);
    expect(colour(1, 0, true)).toBe(18);
    expect(colour(3, 0, true)).toBe(18);
  });

  it('EV.PickupScored spawns +points in its tier colour at the pickup, from the next tick; EV.Penalty spawns −points in 18', () => {
    const popups = new Popups(new CountingSink(), FONT);
    const bus = new EventBus();
    const world = emptyWorld(0);
    popups.attach(bus, world);
    bus.drain(
      sealed(41, [
        [EV.PickupScored, 3, 40.5, 12.25, 150],
        [EV.PickupScored, 1, 41, 12, 0],
        [EV.Penalty, Offence.Hit, 30.5, 9.25, -250],
        [EV.Penalty, Offence.RoadRage, 30, 9, 0],
      ]),
    );
    // The 0-point pickup and the complaint-only penalty show nothing.
    expect(popups.popupCount(42)).toBe(2);
    const slots = [0, 1].map((p) => ({
      text: popups.popupText(p),
      start: popups.popupStart[p],
      x: popups.popupX[p],
      y: popups.popupY[p],
      m: popups.popupMultiplier[p],
      penalty: popups.popupPenalty[p],
    }));
    expect(slots).toEqual([
      { text: '+150', start: 42, x: 40.5, y: 12.25, m: 3, penalty: 0 },
      { text: '-250', start: 42, x: 30.5, y: 9.25, m: 1, penalty: 1 },
    ]);
    expect(popups.popupCount(42 + 56)).toBe(2);
    expect(popups.popupCount(42 + 57)).toBe(0);
  });

  it('draws the popup centred on its pickup, outlined, rising, in its colour; a full pool replaces the oldest', () => {
    const raster = new TextRaster(W, HUD_HEIGHT_PX, UI_ATLAS);
    const popups = new Popups(raster, FONT);
    const world = emptyWorld(100);
    const camera = { xM: 50, yM: 50, pxPerM: 16, alpha: 0 };
    popups.spawnPoints(100, 52, 51, 3, 30, false);
    popups.draw(world, W, camera);
    // (52, 51) → (240 + 32, 135 + 16) = (272, 151): '+30' is 3 outlined glyphs (7 px each), its box top at 151 − 4.
    const ink = [];
    for (let y = 140; y < 160; y++)
      for (let x = 250; x < 300; x++) if (raster.at(x, y) === 28) ink.push([x, y]);
    expect(ink.length).toBeGreaterThan(20);
    const xs = ink.map((p) => p[0] ?? 0);
    const ys = ink.map((p) => p[1] ?? 0);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(272 - 11);
    expect(Math.max(...xs)).toBeLessThan(272 + 11);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(151 - 4);
    expect(Math.max(...ys)).toBeLessThanOrEqual(151 + 4);
    // Ink ring round it.
    expect(raster.index.some((v) => v === 0)).toBe(true);
    // At age 36 it has risen 12 px.
    const risen = new TextRaster(W, HUD_HEIGHT_PX, UI_ATLAS);
    const p2 = new Popups(risen, FONT);
    p2.spawnPoints(100, 52, 51, 3, 30, false);
    p2.draw({ ...world, tick: 136 }, W, camera);
    let top = HUD_HEIGHT_PX;
    for (let i = 0; i < risen.index.length; i++)
      if (risen.index[i] === 28) top = Math.min(top, Math.floor(i / W));
    expect(top).toBe(Math.min(...ys) - 12);
    // POPUP_CAPACITY + 1 spawns: the first one is gone.
    for (let k = 0; k < POPUP_CAPACITY; k++) popups.spawnPoints(101 + k, 52, 51, 1, 1000 + k, false);
    const texts = Array.from({ length: POPUP_CAPACITY }, (_, p) => popups.popupText(p));
    expect(texts).not.toContain('+30');
    expect(texts).toContain('+1000');
    expect(texts).toContain(`+${1000 + POPUP_CAPACITY - 1}`);
  });

  it('freezes with the World: a frame drawn again at the same World tick is identical, whatever the alpha', () => {
    const a = new TextRaster(W, HUD_HEIGHT_PX, UI_ATLAS);
    const b = new TextRaster(W, HUD_HEIGHT_PX, UI_ATLAS);
    const world = emptyWorld(220);
    const camera = { xM: 0, yM: 0, pxPerM: 16 };
    for (const r of [a, b]) {
      const popups = new Popups(r, FONT);
      popups.spawnPoints(200, 1, 1, 2, 50, false);
      popups.bubbles.show(
        'k',
        BUBBLE_OI,
        200,
        BubbleAnchor.Fixed,
        -1,
        [2],
        [2],
        0,
        BUBBLE_LIFT_PERSON_PX,
        FONT,
      );
      popups.draw(world, W, { ...camera, alpha: r === a ? 0.1 : 0.9 });
    }
    expect(a.covered).toBeGreaterThan(0);
    expect(Array.from(a.index)).toEqual(Array.from(b.index));
  });
});

describe('bubble timing and the max-3 / same-ID rules (AUDIO_DESIGN §13.2)', () => {
  it('a 10-character bubble lasts 2.1 s (1.5 s + 60 ms × 10); a 40-character one is capped at 3.0 s', () => {
    expect(bubbleDurationS(10)).toBe(2.1);
    expect(bubbleDurationTicks(10)).toBe(126);
    expect(bubbleDurationS(40)).toBe(3);
    expect(bubbleDurationTicks(40)).toBe(180);
    expect(bubbleDurationS(25)).toBe(3);
    expect(bubbleDurationS(bubbleCharCount('Oi!'))).toBe(1.68);
    expect(bubbleCharCount('Not the cat!')).toBe(12);
    expect(bubbleCharCount('£★→')).toBe(3);
    const m = new BubbleManager();
    const s = m.show('ten', 'abcdefghij', 1000, BubbleAnchor.Fixed, -1, [0], [0], 0, 10);
    m.expire(1125);
    expect(m.isActive(s)).toBe(true);
    m.expire(1126);
    expect(m.isActive(s)).toBe(false);
    const long = m.show('forty', 'x'.repeat(40), 2000, BubbleAnchor.Fixed, -1, [0], [0], 0, 10);
    m.expire(2179);
    expect(m.isActive(long)).toBe(true);
    m.expire(2180);
    expect(m.isActive(long)).toBe(false);
  });

  it('with 3 active, a 4th distinct one removes the oldest; a repeat of an active ID replaces it rather than stacking', () => {
    const m = new BubbleManager();
    const show = (key: string, text: string, tick: number) =>
      m.show(key, text, tick, BubbleAnchor.Fixed, -1, [0], [0], 0, 10);
    const a = show('a', 'A', 0);
    show('b', 'B', 1);
    show('c', 'C', 2);
    expect(m.count).toBe(3);
    const d = show('d', 'D', 3);
    expect(m.count).toBe(3);
    expect(d).toBe(a);
    expect(m.slotOf('a')).toBe(-1);
    expect(['b', 'c', 'd'].map((k) => m.slotOf(k) >= 0)).toEqual([true, true, true]);
    // A repeat of 'c' replaces it in its slot: still 3, new text, timer restarted, now the newest.
    const c0 = m.slotOf('c');
    const c1 = show('c', 'C again', 10);
    expect(c1).toBe(c0);
    expect(m.count).toBe(3);
    expect(m.text[c1]).toBe('C again');
    expect(m.startTick[c1]).toBe(10);
    expect(m.endTick[c1]).toBe(10 + bubbleDurationTicks(7));
    // So the next distinct one replaces 'b', the oldest now.
    show('e', 'E', 11);
    expect(m.slotOf('b')).toBe(-1);
    expect(m.slotOf('c')).toBe(c1);
    // Drawn oldest first: d, c, e.
    expect([0, 1, 2].map((r) => m.text[m.byAge(r)])).toEqual(['D', 'C again', 'E']);
    expect(m.byAge(3)).toBe(-1);
    // An expired bubble frees its slot for a new key without evicting anyone.
    m.expire(10_000);
    expect(m.count).toBe(0);
  });

  it('refuses text wider than one 192 px line', () => {
    const m = new BubbleManager();
    expect(() => m.show('k', 'W'.repeat(40), 0, BubbleAnchor.Fixed, -1, [0], [0], 0, 10, FONT)).toThrow(
      /wider than 192/,
    );
  });
});

describe('bubbles from the M3 behaviours (GDD §18.3, AUDIO_DESIGN §13.2)', () => {
  /** Checks bubble `text` shows above NPC handle `h`: anchored on it, its tip drawn `lift` px above its pixel. */
  function expectAboveNpc(world: World, popups: Popups, text: string, h: number, lift: number): void {
    const s = bubbleWith(popups, text);
    expect(s, `a '${text}' bubble`).toBeGreaterThanOrEqual(0);
    expect(popups.bubbles.anchor[s]).toBe(BubbleAnchor.Npc);
    expect(popups.bubbles.ref[s]).toBe(h);
    expect(popups.bubbles.liftPx[s]).toBe(lift);
    const i = resolveNpcHandle(world.npc, h);
    expectTipAt(world, popups, s, world.npc.x[i] as number, world.npc.y[i] as number, lift);
  }

  /** Draws `popups` for `world` (alpha 1: the latest tick) and checks bubble `s`'s tail tip is over (x, y) − lift. */
  function expectTipAt(world: World, popups: Popups, s: number, x: number, y: number, lift: number): void {
    const raster = new TextRaster(W, HUD_HEIGHT_PX, UI_ATLAS);
    const drawn = new Popups(raster, FONT);
    // Draw only bubble `s`, through a fresh layer showing the same bubble.
    const b = popups.bubbles;
    drawn.bubbles.show(
      b.key[s] ?? 0,
      b.text[s] ?? '',
      b.startTick[s] ?? 0,
      (b.anchor[s] ?? 0) as BubbleAnchor,
      b.ref[s] ?? -1,
      b.xM,
      b.yM,
      s,
      b.liftPx[s] ?? 0,
    );
    const camera = cameraOn(world);
    drawn.draw(viewWorld(world), W, { ...camera, alpha: 1 });
    // The source follows its interpolated position (alpha 1: where it is now).
    expect(drawn.bubbles.xM[0]).toBeCloseTo(x, 9);
    expect(drawn.bubbles.yM[0]).toBeCloseTo(y, 9);
    const point = { xPx: 0, yPx: 0 };
    expect(project([x], [y], 0, W, camera, point)).toBe(true);
    const tipX = point.xPx;
    const tipY = point.yPx - lift;
    expect(raster.at(tipX, tipY), 'the tip').toBe(BUBBLE_OUTLINE);
    expect(raster.at(tipX, tipY + 1), 'nothing under the tip').toBe(-1);
    expect(raster.at(tipX, tipY - 1), 'the tail').toBe(BUBBLE_FILL);
    expect(raster.at(tipX, tipY - 3), 'the panel above it').toBe(BUBBLE_FILL);
    // Its text sits in the panel above the tail, in chalk: more chalk inside the outline than the outline itself.
    const h = bubbleHeightFor(FONT.metrics.glyph.h);
    const w = bubbleWidthFor(FONT.measure(b.text[s] ?? '') - 1);
    let chalk = 0;
    for (let yy = tipY - 2 - h + 1; yy < tipY - 2; yy++)
      for (let xx = tipX - 60; xx < tipX + 60; xx++) if (raster.at(xx, yy) === 7) chalk++;
    const outline = w - 2 + 2 * (h - 2);
    expect(chalk - outline).toBeGreaterThanOrEqual(5);
  }

  it('hitting a shopper: "Oi!" above her, and her −250 in 18 at the hit', () => {
    const world = townWorld(82);
    const bus = new EventBus();
    const popups = new Popups(new CountingSink(), FONT);
    popups.attach(bus, viewWorld(world));
    const i = addPerson(world, 'npc.shopper', CENTRE, CENTRE - HALF_L - HUMAN_R + 0.02);
    const h = npcHandle(world.npc, i);
    holdBessie(world, 2);
    stepAndDrain(world, bus);
    expect(popups.bubbles.count).toBe(1);
    expectAboveNpc(world, popups, BUBBLE_OI, h, BUBBLE_LIFT_PERSON_PX);
    expect(popups.popupCount(world.tick)).toBe(1);
    expect(popups.popupText(0)).toBe('-250');
    expect(popups.popupPenalty[0]).toBe(1);
  });

  it('a cat hit: "Not the cat!" above the cat, lifted less (it is small)', () => {
    const world = townWorld(87);
    const bus = new EventBus();
    const popups = new Popups(new CountingSink(), FONT);
    popups.attach(bus, viewWorld(world));
    const cat = kindOf('npc.cat');
    const i = addNpcAt(world.npc, cat, NpcOrigin.Ambient, CENTRE, CENTRE - HALF_L - 0.2 + 0.02);
    world.npc.radius[i] = DEFAULT_TUNING.streetLife.npcRadius.catM;
    setNpcState(world.npc, i, world.npcAi.behaviours[cat]?.initial ?? 0);
    const h = npcHandle(world.npc, i);
    holdBessie(world, 2);
    let hit = false;
    for (let t = 0; t < 5 && !hit; t++) {
      world.step(neutral);
      hit = Array.from({ length: world.events.count }, (_, k) => world.events.type[k]).includes(EV.NpcHit);
      bus.drain(world.events);
    }
    expect(hit).toBe(true);
    expectAboveNpc(world, popups, BUBBLE_NOT_THE_CAT, h, BUBBLE_LIFT_ANIMAL_PX);
    expect(popups.popupText(0)).toBe('-300');
  });

  it('a Caught! litterbug: "Caught!" above him, following him as he slinks off', () => {
    const world = townWorld(84);
    const bus = new EventBus();
    const popups = new Popups(new CountingSink(), FONT);
    popups.attach(bus, viewWorld(world));
    const i = addPerson(world, 'npc.litterbug', CENTRE + 5.9, CENTRE);
    const h = npcHandle(world.npc, i);
    holdBessie(world, 0);
    stepAndDrain(world, bus, honk());
    expectAboveNpc(world, popups, BUBBLE_CAUGHT, h, BUBBLE_LIFT_PERSON_PX);
    // A few ticks on, with him moved 3 m (the test standing in for his walk off), the bubble is over him there.
    for (let t = 0; t < 10; t++) {
      holdBessie(world, 0);
      stepAndDrain(world, bus);
    }
    place(world, h, CENTRE + 7, CENTRE - 2);
    const j = resolveNpcHandle(world.npc, h);
    world.npc.prevX[j] = CENTRE + 7;
    world.npc.prevY[j] = CENTRE - 2;
    expectAboveNpc(world, popups, BUBBLE_CAUGHT, h, BUBBLE_LIFT_PERSON_PX);
    expect([world.npc.x[j], world.npc.y[j]]).toEqual([CENTRE + 7, CENTRE - 2]);
  });

  it('a car honking at Bessie: "!" above the car, its second honk replacing the first rather than stacking', () => {
    const world = createWorld(
      compileTrafficTown(ONE_WAY_STREET, { densityPerKm: 5, mix: { 'veh.hatchback': 1 } }),
      1,
      endlessShiftTuning(),
    );
    const bus = new EventBus();
    const popups = new Popups(new CountingSink(), FONT);
    popups.attach(bus, viewWorld(world));
    const idle = createInputFrame();
    const honks: number[] = [];
    for (let guard = 0; guard < 20_000 && honks.length < 2; guard++) {
      stepAndDrain(world, bus, idle);
      for (let k = 0; k < world.events.count; k++)
        if (world.events.type[k] === EV.CarHorn) honks.push(world.tick);
      if (honks.length === 1 && world.tick === honks[0]) {
        const s = bubbleWith(popups, BUBBLE_HONK);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(popups.bubbles.anchor[s]).toBe(BubbleAnchor.Vehicle);
        expect(popups.bubbles.ref[s]).toBe(world.vehicles.uid[0]);
        expectTipAt(
          world,
          popups,
          s,
          world.vehicles.x[0] as number,
          world.vehicles.y[0] as number,
          BUBBLE_LIFT_VEHICLE_PX,
        );
      }
    }
    expect(honks.length).toBe(2);
    // The second honk (3 s later; the first bubble, 1.56 s, had gone) shows one '!' again.
    expect(popups.bubbles.count).toBe(1);
    // Same key while showing: replaced, not stacked.
    const s = bubbleWith(popups, BUBBLE_HONK);
    const key = popups.bubbles.key[s] ?? 0;
    bus.drain(
      sealed(world.tick + 5, [[EV.CarHorn, 0, world.vehicles.x[0] ?? 0, world.vehicles.y[0] ?? 0, 3]]),
    );
    expect(popups.bubbles.count).toBe(1);
    expect(popups.bubbles.slotOf(key)).toBe(s);
    expect(popups.bubbles.startTick[s]).toBe(world.tick + 6);
  });

  it('Doris shaking her fist at the horn: "Hmph!" above her; her hit says it too', () => {
    const world = townWorld(83);
    const bus = new EventBus();
    const popups = new Popups(new CountingSink(), FONT);
    popups.attach(bus, viewWorld(world));
    const i = addPerson(world, 'npc.old_woman', CENTRE + 3, CENTRE);
    const h = npcHandle(world.npc, i);
    // A glaring Doris: the stimulus path only reads her state.
    setNpcState(world.npc, i, DORIS.Glare);
    holdBessie(world, 0);
    stepAndDrain(world, bus, honk());
    const j = resolveNpcHandle(world.npc, h);
    expect(world.npc.state[j]).toBe(DORIS.FistShake);
    expectAboveNpc(world, popups, BUBBLE_HMPH, h, BUBBLE_LIFT_PERSON_PX);
    // Her NpcHit maps to the same voice.
    const hits = new Popups(new CountingSink(), FONT);
    const bus2 = new EventBus();
    hits.attach(bus2, viewWorld(world));
    bus2.drain(
      sealed(world.tick + 1, [
        [EV.NpcHit, j, world.npc.x[j] ?? 0, world.npc.y[j] ?? 0, NPC_IDS.indexOf('npc.old_woman')],
      ]),
    );
    expect(bubbleWith(hits, BUBBLE_HMPH)).toBeGreaterThanOrEqual(0);
  });

  it('an event whose entity index no longer names its source keeps the bubble at the event point', () => {
    const popups = new Popups(new CountingSink(), FONT);
    const bus = new EventBus();
    popups.attach(bus, emptyWorld(0));
    bus.drain(sealed(9, [[EV.NpcHit, 3, 12, 34, NPC_IDS.indexOf('npc.shopper')]]));
    const s = bubbleWith(popups, BUBBLE_OI);
    expect(popups.bubbles.anchor[s]).toBe(BubbleAnchor.Fixed);
    expect([popups.bubbles.xM[s], popups.bubbles.yM[s]]).toEqual([12, 34]);
    // Pigeons have no hit voice.
    bus.drain(sealed(10, [[EV.NpcHit, 3, 12, 34, NPC_IDS.indexOf('npc.pigeon')]]));
    expect(popups.bubbles.count).toBe(1);
  });
});

describe('the speech-bubble panel (panels.ts drawBubble)', () => {
  it('ink fill, 1 px chalk outline with cut corners, and a 2-row tail to the tip', () => {
    const raster = new TextRaster(64, 32, UI_ATLAS);
    new Panels(raster, FONT).drawBubble(4, 4, 20, 11, 13);
    const rows: string[] = [];
    for (let y = 4; y < 4 + 11 + 2; y++) {
      let row = '';
      for (let x = 4; x < 24; x++) {
        const v = raster.at(x, y);
        row += v < 0 ? '.' : v === 0 ? '0' : v === 7 ? '7' : '?';
      }
      rows.push(row);
    }
    expect(rows).toEqual([
      '.777777777777777777.',
      '70000000000000000007',
      '70000000000000000007',
      '70000000000000000007',
      '70000000000000000007',
      '70000000000000000007',
      '70000000000000000007',
      '70000000000000000007',
      '70000000000000000007',
      '70000000000000000007',
      '.777777700077777777.',
      '........707.........',
      '.........7..........',
    ]);
  });

  it('keeps the tail inside the panel when its source is past an end', () => {
    const raster = new TextRaster(64, 32, UI_ATLAS);
    new Panels(raster, FONT).drawBubble(4, 4, 20, 11, 0);
    // Clamped to 3 px inside the left side: the tip at x = 7.
    expect(raster.at(7, 16)).toBe(7);
    expect(() => new Panels(raster, FONT).drawBubble(0, 0, 5, 11, 2)).toThrow(/at least 7x3/);
  });
});

describe('per-frame draw path source (acceptance: no `new` or array literals)', () => {
  const NEW_RE = /\bnew\s+[A-Za-z_$]/;
  const ARRAY_LITERAL_RE = /(?:[=(,]|\breturn)\s*\[/;

  it('src/ui/popups.ts', () => {
    const source = readFileSync(`${REPO_ROOT}src/ui/popups.ts`, 'utf8');
    const parts = source.split('// per-frame draw path: begin').slice(1);
    expect(parts.length, 'marked regions').toBe(4);
    for (const part of parts) {
      const end = part.indexOf('// per-frame draw path: end');
      expect(end).toBeGreaterThan(0);
      const lines = part
        .slice(0, end)
        .split('\n')
        .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
      expect(lines.filter((l) => NEW_RE.test(l))).toEqual([]);
      expect(lines.filter((l) => ARRAY_LITERAL_RE.test(l))).toEqual([]);
    }
  });

  it('the bubble frame comes from the ui atlas', () => {
    expect(FRAME['ui.bar_fill:bar:-:0'].atlas).toBe('ui');
    expect(HudColour.PostboxRed).toBe(18);
  });
});
