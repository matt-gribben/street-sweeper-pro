// The M2 HUD (SSP-070; GDD §15.2, ART_BIBLE §11 and §12.2): the pure hudModel (timer text and colours, hopper and
// Dignity thresholds, the tier popup's rise, hold and blink, the ×5 colour cycle, the hold-to-dump ring), the
// read-only dump accessor and snapshot against a real World, the layout at every width 432..640 (inside the 4 px
// margin, no overlap, every drawn pixel inside its element's box), the score formatting and roll, the EV.ComboTier
// subscription, that drawing never writes the sim, and the per-frame draw path's no-`new` rule (the heap check is
// hudHeap.test.ts).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/app/events.ts';
import type { FrameId } from '../../src/gen/assets.ts';
import { hudSampleModel } from '../../src/scenes/HudSampleScene.ts';
import { HUD_FONT } from '../../src/scenes/ShiftScene.ts';
import { Offence } from '../../src/sim/complaints.ts';
import { createEventQueue, EV, emitEvent, resetEvents, sealEvents } from '../../src/sim/eventQueue.ts';
import {
  BUTTON,
  createInputFrame,
  type InputFrame,
  PRESSED,
  THROTTLE_MAX,
} from '../../src/sim/inputFrame.ts';
import { createBlankLevel, Ground, type Level } from '../../src/sim/map.ts';
import { availableDumpSite, DumpState, dumpHoldTicksAt, ShiftPhase } from '../../src/sim/shift.ts';
import { snapshotWorld } from '../../src/sim/snapshot.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { TextVariant } from '../../src/ui/bitmapText.ts';
import {
  COMBO_GAP_PX,
  DUMP_RING_FRAMES,
  HUD_HEIGHT_PX,
  HUD_MARGIN_PX,
  HUD_MAX_WIDTH_PX,
  HUD_MIN_WIDTH_PX,
  Hud,
  type HudElement,
  type HudRect,
  hudLayout,
  writeScoreChars,
} from '../../src/ui/hud.ts';
import {
  COMPLAINT_SLOTS,
  ComplaintSlotState,
  createHudModel,
  createHudSnapshot,
  DUMP_RING_STEPS,
  type HudModel,
  type HudSnapshot,
  hudModel,
  meterShakeDx,
  POPUP_LIFE_TICKS,
  popupRisePx,
  readHudSnapshot,
  SWEEPING_BEAUTY_CYCLE,
} from '../../src/ui/hudModel.ts';
import type { PanelSink } from '../../src/ui/panels.ts';
import { readBitmapFont, readIndexedAtlas, TextRaster } from '../support/textRaster.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const font = readBitmapFont(HUD_FONT);
const uiAtlas = readIndexedAtlas('ui');

/** Palette indices (ART_BIBLE §5.1). */
const CHALK = 7;
const SWEEPER_YELLOW = 15;
const LEMON = 16;
const HIVIS = 17;
const RED = 18;
const BUBBLEGUM = 20;
const GRASS_LT = 23;
const SKY = 27;
const SPRAY = 28;

/** A shift-start snapshot (full timer, empty hopper, full tank and Dignity) with `fields` over it. */
function snap(fields: Partial<HudSnapshot> = {}): HudSnapshot {
  return {
    ...createHudSnapshot(),
    ticksRemaining: 14_400,
    hopperCapacityLu: 100,
    hopperWarnFraction: 0.8,
    water: 100,
    tankUnits: 100,
    hp: 100,
    maxHp: 100,
    dentedBelowHp: 40,
    ...fields,
  };
}

const model = (fields: Partial<HudSnapshot> = {}, tick = 0): HudModel => hudModel(snap(fields), tick);

describe('hudModel: shift timer (GDD §15.2)', () => {
  it('shows ceil(ticks / 60) s as m:ss: 14,400 → 4:00 in 07', () => {
    expect(model({ ticksRemaining: 14_400 }).timer).toMatchObject({
      visible: true,
      text: '4:00',
      colour: CHALK,
    });
    expect(model({ ticksRemaining: 14_399 }).timer.text).toBe('4:00');
    expect(model({ ticksRemaining: 14_340 }).timer.text).toBe('3:59');
    expect(model({ ticksRemaining: 61 }).timer.text).toBe('0:02');
    expect(model({ ticksRemaining: 1 }).timer.text).toBe('0:01');
    expect(model({ ticksRemaining: 0 }).timer.text).toBe('0:00');
  });

  it('is 07 at 3,600 ticks and lemon 16 from 3,599 (under 60 s)', () => {
    expect(model({ ticksRemaining: 3_600 }).timer).toMatchObject({ text: '1:00', colour: CHALK });
    expect(model({ ticksRemaining: 3_599 }).timer).toMatchObject({ text: '1:00', colour: LEMON });
    expect(model({ ticksRemaining: 1_800 }).timer.colour).toBe(LEMON);
  });

  it('below 1,800 alternates 18 and 16 every 30 ticks, starting on 18, and holds 18 at 0:00', () => {
    const colours: number[] = [];
    for (let t = 1_799; t >= 1; t--) colours.push(model({ ticksRemaining: t }).timer.colour);
    for (let i = 0; i < colours.length; i++) {
      expect(colours[i], `ticksRemaining ${1_799 - i}`).toBe(Math.floor(i / 30) % 2 === 0 ? RED : LEMON);
    }
    expect([1_799, 1_770, 1_769, 1_740, 1_739].map((t) => model({ ticksRemaining: t }).timer.colour)).toEqual(
      [RED, RED, LEMON, LEMON, RED],
    );
    expect(model({ ticksRemaining: 0 }).timer.colour).toBe(RED);
  });
});

describe('hudModel: hopper, water and Dignity (ART_BIBLE §12.2)', () => {
  it('hopper 79% → 15 with no "!"; 80% → 17 with "!"; 100% → "FULL" flashing 18', () => {
    const at79 = model({ hopperLu: 79 });
    expect(at79.hopper.colour).toBe(SWEEPER_YELLOW);
    expect(at79.hopperText).toMatchObject({ text: '79%', colour: CHALK });
    expect(at79.hopperWarn.visible).toBe(false);
    const at80 = model({ hopperLu: 80 });
    expect(at80.hopper.colour).toBe(HIVIS);
    expect(at80.hopperText).toMatchObject({ text: '80%', colour: HIVIS });
    expect(at80.hopperWarn).toMatchObject({ visible: true, text: '!', colour: HIVIS });
    const full = model({ hopperLu: 100 }, 0);
    expect(full.hopper.colour).toBe(RED);
    expect(full.hopperText).toMatchObject({ text: 'FULL', colour: RED });
    expect(full.hopperWarn.visible).toBe(false);
    // The flash: 18 for 15 ticks, then 17 for 15, and so on.
    const flash = [0, 14, 15, 29, 30].map((tick) => model({ hopperLu: 100 }, tick).hopper.colour);
    expect(flash).toEqual([RED, RED, HIVIS, HIVIS, RED]);
    expect(model({ hopperLu: 100 }, 15).hopperText.text).toBe('FULL');
  });

  it('fills the 64 px hopper bar by LU / capacity and floors the percentage', () => {
    expect(model({ hopperLu: 0 }).hopper.fillPx).toBe(0);
    expect(model({ hopperLu: 0 }).hopperText.text).toBe('0%');
    expect(model({ hopperLu: 50 }).hopper.fillPx).toBe(32);
    expect(model({ hopperLu: 99.9 }).hopperText.text).toBe('99%');
    expect(model({ hopperLu: 100 }).hopper.fillPx).toBe(64);
  });

  it('fills the water bar in 27 with its top row in 28', () => {
    const m = model({ water: 37 });
    expect(m.water).toMatchObject({ visible: true, fillPx: 24, colour: SKY, topColour: SPRAY });
    expect(model({ water: 100 }).water.fillPx).toBe(64);
    expect(model({ water: 0 }).water.fillPx).toBe(0);
  });

  it('Dignity 61 → 23, 60 → 15, 40 → 15, 39 → 18', () => {
    expect([61, 60, 40, 39].map((hp) => model({ hp }).dignity.colour)).toEqual([
      GRASS_LT,
      SWEEPER_YELLOW,
      SWEEPER_YELLOW,
      RED,
    ]);
    expect(model({ hp: 100 }).dignity.fillPx).toBe(64);
    expect(model({ hp: 35 }).dignity.fillPx).toBe(22);
    expect(model({ hp: -5 }).dignity.fillPx).toBe(0);
  });
});

describe('hudModel: combo and the chain timer', () => {
  it('shows the multiplier and tier word from ×2 in the tier colour, nothing at ×1', () => {
    expect(model({ multiplier: 1 }).combo.visible).toBe(false);
    expect(model({ multiplier: 2 }).combo).toMatchObject({
      visible: true,
      text: 'x2 TIDY!',
      colour: GRASS_LT,
    });
    expect(model({ multiplier: 3 }).combo).toMatchObject({ text: 'x3 SPOTLESS!', colour: SPRAY });
    expect(model({ multiplier: 4 }).combo).toMatchObject({ text: 'x4 IMMACULATE!', colour: LEMON });
    expect(model({ multiplier: 5 }).combo.text).toBe('x5 SWEEPING BEAUTY!');
  });

  it('cycles ×5 through 16 → 17 → 20 → 28 → 23 every 5 ticks', () => {
    const colours = Array.from({ length: 30 }, (_, tick) => model({ multiplier: 5 }, tick).combo.colour);
    const expected = Array.from({ length: 30 }, (_, tick) => SWEEPING_BEAUTY_CYCLE[Math.floor(tick / 5) % 5]);
    expect(colours).toEqual(expected);
    expect(SWEEPING_BEAUTY_CYCLE).toEqual([LEMON, HIVIS, BUBBLEGUM, SPRAY, GRASS_LT]);
  });

  it('shrinks the 48 px chain bar with the chain timer and hides it without a chain', () => {
    expect(model({ chain: 0 }).chainBar.visible).toBe(false);
    const full = model({ chain: 3, chainTimerTicks: 120, chainRefreshTicks: 120 }).chainBar;
    expect(full).toMatchObject({ visible: true, fillPx: 48, colour: HIVIS });
    expect(model({ chain: 3, chainTimerTicks: 60, chainRefreshTicks: 120 }).chainBar.fillPx).toBe(24);
    expect(model({ chain: 3, chainTimerTicks: 1, chainRefreshTicks: 120 }).chainBar.fillPx).toBe(1);
    expect(model({ chain: 3, chainTimerTicks: 120, chainRefreshTicks: 240 }).chainBar.fillPx).toBe(24);
  });
});

describe('hudModel: tier popups (ART_BIBLE §11)', () => {
  /** The popup `age` ticks after a rise to `multiplier` emitted on tick 99. */
  function popupAt(multiplier: number, age: number): HudModel['popup'] {
    const hud = new Hud(new TextRaster(480, 270, uiAtlas), font);
    hud.onComboTier(multiplier, multiplier - 1, 99);
    return hudModel(hud.snapshot, 100 + age).popup;
  }

  it('a tier change spawns a popup that rises 12 px over 36 ticks with ease-out, holds 12, blinks 3 × 3 ticks', () => {
    const rises = Array.from({ length: 37 }, (_, a) => popupAt(3, a).risePx);
    expect(rises[0]).toBe(0);
    expect(rises[36]).toBe(12);
    for (let a = 1; a <= 36; a++) expect(rises[a] ?? -1).toBeGreaterThanOrEqual(rises[a - 1] ?? 99);
    // Ease-out: most of the rise happens early.
    expect(rises[12] ?? 0).toBeGreaterThan(6);
    expect(rises[18]).toBe(9);
    for (let a = 0; a < 48; a++) {
      const p = popupAt(3, a);
      expect(p.visible, `age ${a}`).toBe(true);
      expect(p.text).toBe('SPOTLESS!');
      expect(p.colour).toBe(SPRAY);
      if (a >= 36) expect(p.risePx).toBe(12);
    }
    const blink = Array.from({ length: 21 }, (_, i) => (popupAt(3, 48 + i).visible ? 1 : 0)).join('');
    expect(blink).toBe('000111000111000111000');
    expect(POPUP_LIFE_TICKS).toBe(66);
    expect(popupAt(3, 66).visible).toBe(false);
    expect(popupAt(3, 500).visible).toBe(false);
    expect(popupRisePx(-3)).toBe(0);
  });

  it('draws each tier word in its tier colour, ×5 cycling', () => {
    expect(popupAt(2, 0)).toMatchObject({ text: 'TIDY!', colour: GRASS_LT });
    expect(popupAt(4, 0)).toMatchObject({ text: 'IMMACULATE!', colour: LEMON });
    const five = Array.from({ length: 25 }, (_, a) => popupAt(5, a).colour);
    expect(five).toEqual(
      Array.from({ length: 25 }, (_, a) => SWEEPING_BEAUTY_CYCLE[Math.floor((100 + a) / 5) % 5]),
    );
    expect(popupAt(5, 0).text).toBe('SWEEPING BEAUTY!');
  });

  it('a drop (expiry or penalty) spawns nothing and leaves a running popup alone', () => {
    const hud = new Hud(new TextRaster(480, 270, uiAtlas), font);
    hud.onComboTier(1, 3, 10);
    expect(hudModel(hud.snapshot, 11).popup.visible).toBe(false);
    hud.onComboTier(3, 2, 20);
    hud.onComboTier(1, 3, 30);
    expect(hudModel(hud.snapshot, 31).popup).toMatchObject({ visible: true, text: 'SPOTLESS!' });
    hud.reset();
    expect(hudModel(hud.snapshot, 31).popup.visible).toBe(false);
  });

  it('listens for EV.ComboTier on the bus and stops when unsubscribed', () => {
    const bus = new EventBus();
    const hud = new Hud(new TextRaster(480, 270, uiAtlas), font);
    const stop = hud.attach(bus);
    const queue = createEventQueue();
    const emitTier = (tick: number, multiplier: number, previous: number): void => {
      resetEvents(queue, tick);
      const e = emitEvent(queue, EV.ComboTier, -1);
      queue.a[e] = multiplier;
      queue.b[e] = previous;
      queue.c[e] = 10;
      sealEvents(queue);
      bus.drain(queue);
    };
    emitTier(41, 2, 1);
    expect(hud.snapshot.popupStartTick).toBe(42);
    expect(hud.snapshot.popupMultiplier).toBe(2);
    stop();
    emitTier(50, 3, 2);
    expect(hud.snapshot.popupStartTick).toBe(42);
  });
});

describe('the complaints meter (GDD §11.3, §15.2; ART_BIBLE §12.2; SSP-078)', () => {
  const stamps = (...ticks: number[]): Int32Array => {
    const out = new Int32Array(COMPLAINT_SLOTS).fill(-1);
    out.set(ticks);
    return out;
  };
  const slots = (m: HudModel): [number, number][] => m.complaints.slots.map((s) => [s.state, s.dx]);
  const { Empty, Slam, Stamped } = ComplaintSlotState;

  it('shows five empty boxes at 0 complaints and the first n stamped at n', () => {
    expect(slots(model())).toEqual([
      [Empty, 0],
      [Empty, 0],
      [Empty, 0],
      [Empty, 0],
      [Empty, 0],
    ]);
    expect(model().complaints.visible).toBe(true);
    expect(slots(model({ complaints: 2 })).map(([s]) => s)).toEqual([Stamped, Stamped, Empty, Empty, Empty]);
    // Clamped to the five boxes.
    expect(slots(model({ complaints: 9 })).map(([s]) => s)).toEqual([
      Stamped,
      Stamped,
      Stamped,
      Stamped,
      Stamped,
    ]);
  });

  it('slams a stamp in over 3 frames of 3 ticks with a 2-frame shake: face +1 px, stamp −1 px, then rest', () => {
    const at = (tick: number): [number, number] =>
      slots(model({ complaints: 1, complaintStampTicks: stamps(100) }, tick))[0] ?? [-1, -1];
    expect([0, 1, 2, 3, 4, 5, 6, 60].map((a) => at(100 + a))).toEqual([
      [Slam, 1],
      [Slam, 1],
      [Slam, 1],
      [Stamped, -1],
      [Stamped, -1],
      [Stamped, -1],
      [Stamped, 0],
      [Stamped, 0],
    ]);
  });

  it('at 4 complaints the whole meter shakes ±1 px for 12 ticks of every 60; not at 3', () => {
    const dxAt = (n: number, tick: number): number[] =>
      slots(model({ complaints: n, complaintStampTicks: stamps(10, 20, 30, 40) }, tick)).map(([, dx]) => dx);
    // The 4th stamp started at 40: its own shake to 45, the meter's burst 40..51 (+1 −1 +1 −1 per 3 ticks).
    expect(dxAt(4, 46)).toEqual([1, 1, 1, 1, 1]);
    expect(dxAt(4, 49)).toEqual([-1, -1, -1, -1, -1]);
    expect(dxAt(4, 52)).toEqual([0, 0, 0, 0, 0]);
    expect(dxAt(4, 100)).toEqual([1, 1, 1, 1, 1]);
    expect(dxAt(4, 103)).toEqual([-1, -1, -1, -1, -1]);
    expect(meterShakeDx(12)).toBe(0);
    expect(dxAt(3, 100)).toEqual([0, 0, 0, 0, 0]);
    // A box mid-slam keeps its own offset during the burst.
    expect(dxAt(4, 43)).toEqual([-1, -1, -1, -1, -1]);
    expect(dxAt(4, 41)[3]).toBe(1);
    expect(dxAt(4, 41)[0]).toBe(1);
  });

  it('draws the placeholder art: 00 border, 25 ground, 06 form; an 18 ring and centre; the solid 18 face', () => {
    const w = 480;
    const l = hudLayout(font, w);
    const x0 = l.complaintsX;
    const y0 = 16;
    const raster = new TextRaster(w, HUD_HEIGHT_PX, uiAtlas);
    const m = withoutMeter(model());
    m.complaints.visible = true;
    const states = [Stamped, Slam, Empty, Empty, Empty] as const;
    m.complaints.slots.forEach((slot, i) => {
      slot.state = states[i] ?? Empty;
      slot.dx = 0;
    });
    new Hud(raster, font).drawModel(m, w);
    const at = (slot: number, dx: number, dy: number): number => raster.at(x0 + slot * 18 + dx, y0 + dy);
    // Stamped: ink corner, red ring, red centre, the form's corner peeping between ring and centre.
    expect([at(0, 0, 0), at(0, 1, 1), at(0, 14, 14), at(0, 7, 7), at(0, 4, 3), at(0, 15, 15)]).toEqual([
      0, 18, 18, 18, 6, 0,
    ]);
    // Slam: the solid face.
    expect([at(1, 0, 0), at(1, 1, 1), at(1, 4, 3), at(1, 7, 7), at(1, 14, 14)]).toEqual([0, 18, 18, 18, 18]);
    // Empty: navy ground, kerb-grey form outline and lines.
    expect([at(2, 0, 0), at(2, 1, 1), at(2, 4, 3), at(2, 11, 12), at(2, 6, 6), at(2, 7, 7)]).toEqual([
      0, 25, 6, 6, 6, 25,
    ]);
    // At rest the meter's right edge is 1 px clear of its box, which ends at the 4 px margin (shake room).
    expect(raster.at(w - 6, y0)).toBe(0);
    expect(raster.at(w - 5, y0)).toBe(-1);
    expect(l.reserved.complaints).toEqual({ x: w - 94, y: 16, w: 90, h: 16 });
  });

  it('times each box’s stamp from EV.Complaint on the bus (the tick after), resets, and stops when unsubscribed', () => {
    const bus = new EventBus();
    const hud = new Hud(new TextRaster(480, 270, uiAtlas), font);
    const stop = hud.attach(bus);
    const queue = createEventQueue();
    const emitComplaints = (tick: number, n: number): void => {
      resetEvents(queue, tick);
      for (let i = 0; i < n; i++) {
        const e = emitEvent(queue, EV.Complaint, -1);
        queue.c[e] = Offence.Hit;
      }
      sealEvents(queue);
      bus.drain(queue);
    };
    emitComplaints(41, 2);
    emitComplaints(90, 1);
    expect([...hud.snapshot.complaintStampTicks]).toEqual([42, 42, 91, -1, -1]);
    emitComplaints(95, 4);
    expect([...hud.snapshot.complaintStampTicks]).toEqual([42, 42, 91, 96, 96]);
    hud.reset();
    expect([...hud.snapshot.complaintStampTicks]).toEqual([-1, -1, -1, -1, -1]);
    stop();
    emitComplaints(120, 1);
    expect([...hud.snapshot.complaintStampTicks]).toEqual([-1, -1, -1, -1, -1]);
  });

  it('reads the count from the World (four quick honks: one complaint)', () => {
    const level = createBlankLevel('test.hud_complaints', 20, 20);
    level.layers.ground.fill(Ground.Road);
    level.player = { x: 20, y: 20, heading: 0 };
    const world = createWorld(level, 1, DEFAULT_TUNING);
    const horn: InputFrame = { ...createInputFrame(), pressed: PRESSED.HORN };
    for (let i = 0; i < 4; i++) world.step(horn);
    expect(readHudSnapshot(world, createHudSnapshot()).complaints).toBe(1);
  });
});

describe('hudModel: the hold-to-dump ring (GDD §6.2, §8.7)', () => {
  it('is hidden when no dump is available', () => {
    expect(model({ dumpAvailable: false }).dump).toEqual({ visible: false, ringVisible: false, ringStep: 0 });
  });

  it('in Holding at hold tick k (0..60) fills floor(k / 60 × 8) of 8 steps', () => {
    for (let k = 0; k <= 60; k++) {
      const d = model({
        dumpAvailable: true,
        dumpState: DumpState.Holding,
        dumpHoldTicks: k,
        dumpHoldTotalTicks: 60,
      }).dump;
      expect(d, `hold tick ${k}`).toEqual({
        visible: true,
        ringVisible: true,
        ringStep: Math.floor((k / 60) * 8),
      });
    }
    expect(DUMP_RING_STEPS).toBe(8);
    expect(DUMP_RING_FRAMES).toHaveLength(9);
  });

  it('hides the fill on a cancel and the whole prompt once Draining starts', () => {
    // Released while still stopped at the site: the prompt stays, the ring is empty.
    expect(model({ dumpAvailable: true, dumpState: DumpState.Idle }).dump).toEqual({
      visible: true,
      ringVisible: false,
      ringStep: 0,
    });
    // Rolled off (speed ≥ 0.5 m/s) or left: no dump available, nothing shown.
    expect(model({ dumpAvailable: false, dumpState: DumpState.Idle, dumpHoldTicks: 0 }).dump.visible).toBe(
      false,
    );
    expect(
      model({ dumpAvailable: true, dumpState: DumpState.Draining, dumpHoldTicks: 0, dumpHoldTotalTicks: 60 })
        .dump,
    ).toEqual({ visible: false, ringVisible: false, ringStep: 0 });
  });
});

describe('the dump prompt against a real World (shift.ts availableDumpSite, readHudSnapshot)', () => {
  /** A 40 × 40 asphalt level with a depot bay (x 10..14, y 10..16 m) and a skip, Bessie parked in the bay. */
  function bayLevel(): Level {
    const level = createBlankLevel('test.hud', 40, 40);
    level.layers.ground.fill(Ground.Road);
    level.player = { x: 12, y: 13, heading: 0 };
    level.sites.push(
      { id: 'site.depot_bay', rect: [5, 5, 7, 8] },
      { id: 'site.skip', rect: [20, 10, 22, 11] },
    );
    return level;
  }
  const NEUTRAL: InputFrame = createInputFrame();
  const HOLD: InputFrame = { ...createInputFrame(), buttons: BUTTON.INTERACT };
  const THROTTLE: InputFrame = { ...createInputFrame(), throttle: THROTTLE_MAX };

  function ringOf(world: World): HudModel['dump'] {
    const s = readHudSnapshot(world, createHudSnapshot());
    return hudModel(s, world.tick).dump;
  }

  it('offers nothing with an empty hopper and a full tank, and the bay once there is LU to dump', () => {
    const world = createWorld(bayLevel(), 1, DEFAULT_TUNING);
    world.step(NEUTRAL);
    expect(availableDumpSite(world.shift)).toBe(-1);
    expect(ringOf(world).visible).toBe(false);
    world.vehicle.hopperLU = 30;
    world.step(NEUTRAL);
    const site = availableDumpSite(world.shift);
    expect(site).toBe(0);
    expect(dumpHoldTicksAt(world.shift, site)).toBe(60);
    expect(ringOf(world)).toEqual({ visible: true, ringVisible: false, ringStep: 0 });
  });

  it('fills the ring tick by tick while E is held, empties on release and hides once the drain starts', () => {
    const world = createWorld(bayLevel(), 1, DEFAULT_TUNING);
    world.vehicle.hopperLU = 30;
    world.step(NEUTRAL);
    for (let k = 1; k <= 59; k++) {
      world.step(HOLD);
      expect(world.shift.dumpState).toBe(DumpState.Holding);
      expect(world.shift.holdTicks).toBe(k);
      expect(ringOf(world), `hold tick ${k}`).toEqual({
        visible: true,
        ringVisible: true,
        ringStep: Math.floor((k / 60) * 8),
      });
    }
    // Released: cancelled, still parked with LU in the hopper, so an empty prompt.
    world.step(NEUTRAL);
    expect(world.shift.dumpState).toBe(DumpState.Idle);
    expect(ringOf(world)).toEqual({ visible: true, ringVisible: false, ringStep: 0 });
    // Held again for the full 60 ticks: Draining starts and the prompt goes.
    for (let k = 1; k <= 60; k++) world.step(HOLD);
    expect(world.shift.dumpState).toBe(DumpState.Draining);
    expect(availableDumpSite(world.shift)).toBe(-1);
    expect(ringOf(world).visible).toBe(false);
  });

  it('hides when Bessie rolls off at 0.5 m/s and when the timer has run out', () => {
    const world = createWorld(bayLevel(), 1, DEFAULT_TUNING);
    world.vehicle.hopperLU = 30;
    world.step(HOLD);
    expect(ringOf(world).ringVisible).toBe(true);
    let n = 0;
    while (Math.hypot(world.vehicle.vLongMps, world.vehicle.vLatMps) < 0.5 && n++ < 120) {
      world.step({ ...THROTTLE, buttons: BUTTON.INTERACT });
    }
    expect(world.shift.dumpState).toBe(DumpState.Idle);
    expect(ringOf(world).visible).toBe(false);

    const ended = createWorld(bayLevel(), 1, DEFAULT_TUNING);
    ended.vehicle.hopperLU = 30;
    ended.step(NEUTRAL);
    expect(availableDumpSite(ended.shift)).toBe(0);
    ended.shift.phase = ShiftPhase.KnockOff;
    expect(availableDumpSite(ended.shift)).toBe(-1);
  });

  it('drawing the HUD reads the World and never writes it', () => {
    const world = createWorld(bayLevel(), 7, DEFAULT_TUNING);
    world.vehicle.hopperLU = 30;
    for (let i = 0; i < 20; i++) world.step(HOLD);
    const before = JSON.stringify(snapshotWorld(world));
    const shiftBefore = JSON.stringify({ ...world.shift, vehicle: null, hopper: null, tank: null });
    const hud = new Hud(new TextRaster(480, 270, uiAtlas), font);
    for (let i = 0; i < 5; i++) {
      hud.tick(world);
      hud.draw(world, 480);
    }
    expect(JSON.stringify(snapshotWorld(world))).toBe(before);
    expect(JSON.stringify({ ...world.shift, vehicle: null, hopper: null, tank: null })).toBe(shiftBefore);
  });
});

describe('the score: commas, the roll and per-character drawing', () => {
  const format = (value: number): string => {
    const out = new Uint8Array(16);
    const n = writeScoreChars(value, out);
    return String.fromCharCode(...out.subarray(0, n));
  };

  it('groups digits in threes, signs penalties and clamps to ±9,999,999', () => {
    expect([0, 7, 999, 1000, 12_450, 1_000_000, 9_999_999, 12_345_678].map(format)).toEqual([
      '0',
      '7',
      '999',
      '1,000',
      '12,450',
      '1,000,000',
      '9,999,999',
      '9,999,999',
    ]);
    expect([-250, -1_000, -12_345_678, 12.6, Number.NaN].map(format)).toEqual([
      '-250',
      '-1,000',
      '-9,999,999',
      '13',
      '0',
    ]);
  });

  it('draws each character exactly as drawing the whole string', () => {
    for (const value of [0, 12_450, -9_999_999, 1_234_567]) {
      const m = createHudModel();
      hudModel(snap(), 0, m);
      m.score.value = value;
      const a = new TextRaster(480, 270, uiAtlas);
      new Hud(a, font).drawModel(m, 480);
      // The whole string, centred the same way, over the same model without the score.
      const text = format(value);
      const b = new TextRaster(480, 270, uiAtlas);
      const width = font.measure(text, TextVariant.Outline);
      font.draw(b, text, 240 - (width >> 1) + 1, 5, CHALK, TextVariant.Outline);
      for (let y = 0; y < 14; y++) {
        for (let x = 100; x < 380; x++) expect(a.at(x, y), `(${x}, ${y}) of ${text}`).toBe(b.at(x, y));
      }
    }
  });

  it('rolls the shown score towards the sim score, 1/8 of the gap per tick, never past it', () => {
    const world = createWorld(createBlankLevel('test.roll', 8, 8), 1, DEFAULT_TUNING);
    const hud = new Hud(new TextRaster(480, 270, uiAtlas), font);
    world.scoring.score = 500;
    const shown: number[] = [];
    for (let i = 0; i < 80; i++) {
      hud.tick(world);
      shown.push(hud.displayedScore);
    }
    expect(shown[0]).toBe(63);
    for (let i = 1; i < shown.length; i++) expect(shown[i] ?? 0).toBeGreaterThanOrEqual(shown[i - 1] ?? 0);
    expect(shown.indexOf(500)).toBeGreaterThan(10);
    expect(shown.indexOf(500)).toBeLessThan(60);
    expect(Math.max(...shown)).toBe(500);
    world.scoring.score = 250;
    for (let i = 0; i < 80; i++) hud.tick(world);
    expect(hud.displayedScore).toBe(250);
  });
});

/** Draws into a raster shifted by (pad, pad), so a pixel outside the screen still lands in the raster. */
class PaddedSink implements PanelSink {
  readonly raster: TextRaster;
  readonly pad: number;
  constructor(raster: TextRaster, pad: number) {
    this.raster = raster;
    this.pad = pad;
  }
  add(frame: FrameId, x: number, y: number, from: number, to: number): void {
    this.raster.add(frame, x + this.pad, y + this.pad, from, to);
  }
  addRegion(
    frame: FrameId,
    sx: number,
    sy: number,
    w: number,
    h: number,
    x: number,
    y: number,
    f: number,
    t: number,
  ) {
    this.raster.addRegion(frame, sx, sy, w, h, x + this.pad, y + this.pad, f, t);
  }
}

const PAD = 24;

/** Screen pixels `m` draws at width `w`, as [x, y] pairs in a flat list. */
function drawnPixels(m: HudModel, w: number): Int32Array {
  const raster = new TextRaster(w + 2 * PAD, HUD_HEIGHT_PX + 2 * PAD, uiAtlas);
  new Hud(new PaddedSink(raster, PAD), font).drawModel(m, w);
  const out: number[] = [];
  const idx = raster.index;
  for (let i = 0; i < idx.length; i++) {
    if ((idx[i] ?? -1) >= 0) out.push((i % raster.width) - PAD, Math.floor(i / raster.width) - PAD);
  }
  return Int32Array.from(out);
}

/** Pixel keys of a drawnPixels list. */
function keySet(pixels: Int32Array): Set<number> {
  const out = new Set<number>();
  for (let i = 0; i < pixels.length; i += 2)
    out.add(((pixels[i] ?? 0) + PAD) * 4096 + (pixels[i + 1] ?? 0) + PAD);
  return out;
}

const inRect = (r: HudRect, x: number, y: number): boolean =>
  x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

/** Every even internal width 432..640. */
const WIDTHS = Array.from(
  { length: (HUD_MAX_WIDTH_PX - HUD_MIN_WIDTH_PX) / 2 + 1 },
  (_, i) => HUD_MIN_WIDTH_PX + 2 * i,
);

/** Widths the pixel-level checks run at: both ends, the base width and odd-quarter steps between. */
const PIXEL_WIDTHS = [432, 434, 446, 480, 482, 528, 574, 600, 638, 640];

/** `m` with the complaints meter hidden (for checks of the top row's score and combo pixels). */
function withoutMeter(m: HudModel): HudModel {
  m.complaints.visible = false;
  return m;
}

describe('layout at every width 432..640 (GDD §15.2: 4 px safe margin, anchored to the corners)', () => {
  it('reserves a box per element, inside the margin and overlapping no other', () => {
    for (const w of WIDTHS) {
      const boxes = Object.entries(hudLayout(font, w).reserved) as [HudElement, HudRect][];
      expect(boxes.map(([name]) => name).sort()).toEqual(
        [
          'chainBar',
          'complaints',
          'dignity',
          'dump',
          'hopper',
          'popup',
          'scoreCombo',
          'timer',
          'water',
        ].sort(),
      );
      for (const [name, r] of boxes) {
        expect(r.x, `${name} at W = ${w}`).toBeGreaterThanOrEqual(HUD_MARGIN_PX);
        expect(r.y, `${name} at W = ${w}`).toBeGreaterThanOrEqual(HUD_MARGIN_PX);
        expect(r.x + r.w, `${name} at W = ${w}`).toBeLessThanOrEqual(w - HUD_MARGIN_PX);
        expect(r.y + r.h, `${name} at W = ${w}`).toBeLessThanOrEqual(HUD_HEIGHT_PX - HUD_MARGIN_PX);
      }
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const [na, a] = boxes[i] as [HudElement, HudRect];
          const [nb, b] = boxes[j] as [HudElement, HudRect];
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap, `${na} and ${nb} at W = ${w}`).toBe(false);
        }
      }
    }
  });

  it('draws every element only inside its own box, at its widest, at widths across 432..640', () => {
    const off = (m: HudModel): HudModel => {
      m.timer.visible = false;
      m.combo.visible = false;
      m.chainBar.visible = false;
      m.popup.visible = false;
      m.dump.visible = false;
      m.complaints.visible = false;
      return m;
    };
    const toggles: [HudElement, (m: HudModel) => void][] = [
      ['timer', (m) => (m.timer.visible = true)],
      ['scoreCombo', (m) => (m.combo.visible = true)],
      ['chainBar', (m) => (m.chainBar.visible = true)],
      ['popup', (m) => (m.popup.visible = true)],
      ['dump', (m) => (m.dump.visible = true)],
      ['complaints', (m) => (m.complaints.visible = true)],
    ];
    for (const w of PIXEL_WIDTHS) {
      const r = hudLayout(font, w).reserved;
      for (const [score, risePx] of [
        [0, 0],
        [-9_999_999, 12],
        [9_999_999, 6],
      ] as const) {
        const all = hudSampleModel();
        all.score.value = score;
        all.popup.risePx = risePx;
        const allPixels = drawnPixels(all, w);
        for (let i = 0; i < allPixels.length; i += 2) {
          const x = allPixels[i] ?? -1;
          const y = allPixels[i + 1] ?? -1;
          const inside = x >= HUD_MARGIN_PX && y >= HUD_MARGIN_PX && x < w - HUD_MARGIN_PX;
          expect(inside && y < HUD_HEIGHT_PX - HUD_MARGIN_PX, `(${x}, ${y}) at W = ${w}`).toBe(true);
        }
        // Score and gauges alone, then each other element on its own.
        const plainModel = off(hudSampleModel());
        plainModel.score.value = score;
        const plainPixels = drawnPixels(plainModel, w);
        const plain = keySet(plainPixels);
        for (let i = 0; i < plainPixels.length; i += 2) {
          const x = plainPixels[i] ?? -1;
          const y = plainPixels[i + 1] ?? -1;
          const home = ['scoreCombo', 'hopper', 'water', 'dignity'] as const;
          expect(
            home.some((e) => inRect(r[e], x, y)),
            `score/gauge pixel (${x}, ${y}) at W = ${w}`,
          ).toBe(true);
        }
        for (const [name, on] of toggles) {
          const m = off(hudSampleModel());
          m.score.value = score;
          m.popup.risePx = risePx;
          on(m);
          const pixels = drawnPixels(m, w);
          for (let i = 0; i < pixels.length; i += 2) {
            const x = pixels[i] ?? -1;
            const y = pixels[i + 1] ?? -1;
            if (plain.has((x + PAD) * 4096 + y + PAD)) continue;
            expect(inRect(r[name], x, y), `${name} pixel (${x}, ${y}) at W = ${w}`).toBe(true);
          }
        }
      }
    }
  });

  it('keeps a gap between the score and the combo beside it, whatever the score', () => {
    for (const score of [0, 7, 99, 12_450, 1_000_000, -250, -9_999_999]) {
      // The complaints meter (top-right, from y = 16) is left out: these rows are the score's and the combo's.
      const m = withoutMeter(hudModel(snap({ multiplier: 5, score }), 0));
      const scoreOnly = withoutMeter(hudModel(snap({ score }), 0));
      const withCombo = drawnPixels(m, 480);
      const without = keySet(drawnPixels(scoreOnly, 480));
      let scoreRight = -1;
      let comboLeft = 9_999;
      for (let i = 0; i < withCombo.length; i += 2) {
        const x = withCombo[i] ?? -1;
        const y = withCombo[i + 1] ?? -1;
        if (y > 20) continue;
        if (without.has((x + PAD) * 4096 + y + PAD)) scoreRight = Math.max(scoreRight, x);
        else comboLeft = Math.min(comboLeft, x);
      }
      expect(comboLeft - scoreRight - 1, `gap for ${score}`).toBe(COMBO_GAP_PX);
    }
  });

  it('puts the timer at (4, 4), the score centred on W / 2 at y = 4 and the gauges bottom-left', () => {
    for (const w of [432, 480, 640]) {
      const l = hudLayout(font, w);
      expect([l.timer.x, l.timer.y]).toEqual([4, 4]);
      expect(l.reserved.scoreCombo.y).toBe(4);
      // The score is centred on W / 2: a symmetric one ('88') draws symmetrically about it.
      const score = drawnPixels(withoutMeter(hudModel(snap({ score: 88 }), 0)), w);
      let x0 = 9_999;
      let x1 = -1;
      for (let i = 0; i < score.length; i += 2) {
        if ((score[i + 1] ?? 99) > 20 || (score[i] ?? 0) < 60) continue;
        x0 = Math.min(x0, score[i] ?? 0);
        x1 = Math.max(x1, score[i] ?? 0);
      }
      expect(x0 + x1 + 1).toBe(w);
      expect(l.gauges.hopper.x).toBe(4);
      expect(l.gauges.hopper.y + l.gauges.hopper.h).toBe(266);
      expect(l.reserved.dump.x + l.reserved.dump.w / 2).toBe(w / 2);
    }
  });
});

describe('per-frame draw path source (acceptance: no `new` or array literals)', () => {
  const NEW_RE = /\bnew\s+[A-Za-z_$]/;
  const ARRAY_LITERAL_RE = /(?:[=(,]|\breturn)\s*\[/;

  it.each([
    ['src/ui/hud.ts', 2],
    ['src/ui/hudModel.ts', 1],
  ])('%s', (file, regions) => {
    const source = readFileSync(`${REPO_ROOT}${file}`, 'utf8');
    const parts = source.split('// per-frame draw path: begin').slice(1);
    expect(parts.length, 'marked regions').toBe(regions);
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
});
