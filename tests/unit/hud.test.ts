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
import { HUD_SAMPLE_SNAPSHOT, hudSampleModel as sampleModel } from '../../src/scenes/HudSampleScene.ts';
import { HUD_FONT } from '../../src/scenes/ShiftScene.ts';
import { BrushState } from '../../src/sim/brush.ts';
import { Offence } from '../../src/sim/complaints.ts';
import { POWERUP_IDS } from '../../src/sim/entities.ts';
import { createEventQueue, EV, emitEvent, resetEvents, sealEvents } from '../../src/sim/eventQueue.ts';
import {
  BUTTON,
  createInputFrame,
  type InputFrame,
  PRESSED,
  THROTTLE_MAX,
} from '../../src/sim/inputFrame.ts';
import { createBlankLevel, decodeLevel, Ground, type Level } from '../../src/sim/map.ts';
import { addPickup } from '../../src/sim/pickups.ts';
import { availableDumpSite, DumpState, dumpHoldTicksAt, ShiftPhase } from '../../src/sim/shift.ts';
import { snapshotWorld } from '../../src/sim/snapshot.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld, type World } from '../../src/sim/world.ts';
import { TextVariant } from '../../src/ui/bitmapText.ts';
import {
  BRUSH_RING_FRAMES,
  COMBO_GAP_PX,
  DEPOT_ARROW_FRAMES,
  DUMP_RING_FRAMES,
  HUD_HEIGHT_PX,
  HUD_MARGIN_PX,
  HUD_MAX_WIDTH_PX,
  HUD_MIN_WIDTH_PX,
  Hud,
  type HudElement,
  type HudRect,
  HYDRANT_ARROW_FRAMES,
  hudLayout,
  METER_FRAMES,
  POWER_UP_ICON_FRAMES,
  writeScoreChars,
} from '../../src/ui/hud.ts';
import {
  ARROW_DIRS,
  ARROW_HALF_PX,
  BrushIcon,
  COMPLAINT_SLOTS,
  ComplaintSlotState,
  createHudModel,
  createHudSnapshot,
  DEFAULT_ARROW_FRAME,
  DUMP_RING_STEPS,
  districtDisplayName,
  type HudArrow,
  type HudArrowFrame,
  HudColour,
  type HudModel,
  type HudSnapshot,
  hudModel,
  METER_H_PX,
  METER_PX,
  MeterZone,
  meterPatternIndex,
  meterShakeDx,
  nearestPoint,
  POPUP_LIFE_TICKS,
  placeArrow,
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
          // SSP-299: the M3 widgets and the slots reserved for the radio panel, minimap and power-up.
          'district',
          'tidy',
          'brushMeter',
          'brushState',
          'powerUpSlot',
          'radioHome',
          'radioAway',
          'minimapSlot',
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
      m.district.visible = false;
      m.tidy.visible = false;
      m.meter.visible = false;
      m.brush.visible = false;
      m.depotArrow.visible = false;
      m.hydrantArrow.visible = false;
      m.powerUp.visible = false;
      return m;
    };
    const toggles: [HudElement, (m: HudModel) => void][] = [
      ['timer', (m) => (m.timer.visible = true)],
      ['scoreCombo', (m) => (m.combo.visible = true)],
      ['chainBar', (m) => (m.chainBar.visible = true)],
      ['popup', (m) => (m.popup.visible = true)],
      ['dump', (m) => (m.dump.visible = true)],
      ['complaints', (m) => (m.complaints.visible = true)],
      ['district', (m) => (m.district.visible = true)],
      ['tidy', (m) => (m.tidy.visible = true)],
      ['brushMeter', (m) => (m.meter.visible = true)],
      ['brushState', (m) => (m.brush.visible = true)],
      ['powerUpSlot', (m) => (m.powerUp.visible = true)],
    ];
    for (const w of PIXEL_WIDTHS) {
      const layout = hudLayout(font, w);
      const r = layout.reserved;
      const hudSampleModel = (): HudModel => sampleModel(createHudModel(), layout.arrowFrame);
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

// ---------------------------------------------------------------------------------------------------------
// SSP-299: the Brush-o-meter, brush state, district name with Tidy % bar, and the off-screen arrows
// ---------------------------------------------------------------------------------------------------------

const LIME = 24;
const COUNCIL_BLUE = 26;
const ASPHALT_LT = 3;

describe('hudModel: the Brush-o-meter (GDD §15.2, §8.3)', () => {
  const meterAt = (speedMps: number, brushState: BrushState, fields: Partial<HudSnapshot> = {}) =>
    model({ speedMps, brushState, rpm: 1, ...fields }).meter;

  it('brush down at 3.9 m/s is clean and "9 mph"; 4.5 m/s is fling and "10 mph"', () => {
    expect(meterAt(3.9, BrushState.Collecting)).toMatchObject({ zone: MeterZone.Clean, speedText: '9 mph' });
    expect(meterAt(4.5, BrushState.Collecting)).toMatchObject({ zone: MeterZone.Fling, speedText: '10 mph' });
    // 4.0 m/s is the last clean speed (p_fling(4.0) = 0) and reads 9 mph; just above it is fling.
    expect(meterAt(4.0, BrushState.Collecting)).toMatchObject({ zone: MeterZone.Clean, speedText: '9 mph' });
    expect(meterAt(4.01, BrushState.SpinningUp).zone).toBe(MeterZone.Fling);
  });

  it('brush raised at 8.0 m/s is transit and "18 mph"; Raising is transit too', () => {
    expect(meterAt(8.0, BrushState.Raised)).toMatchObject({
      zone: MeterZone.Transit,
      transit: true,
      speedText: '18 mph',
      cleanPx: 0,
      flingPx: 0,
    });
    expect(meterAt(3.0, BrushState.Raising).zone).toBe(MeterZone.Transit);
    expect(meterAt(3.0, BrushState.Lowering).zone).toBe(MeterZone.Clean);
  });

  it('with the fling threshold at 6.0 m/s (super suction) 5.5 m/s brush down reads clean, the whole bar clean', () => {
    expect(meterAt(5.5, BrushState.Collecting, { flingThresholdMps: 6 })).toMatchObject({
      zone: MeterZone.Clean,
      cleanPx: 64,
      flingPx: 0,
    });
  });

  it('splits the brush-down bar at floor(t0 / top × 64) = 42 px and moves the needle over 0..top', () => {
    const at = (v: number) => meterAt(v, BrushState.Collecting);
    expect([at(0).cleanPx, at(0).flingPx]).toEqual([42, 22]);
    expect([0, 1.5, 3, 3.99, 4, 4.01, 5, 6, 7].map((v) => at(v).needlePx)).toEqual([
      0, 16, 32, 41, 41, 42, 53, 63, 63,
    ]);
    // Transit spans 0..11 m/s.
    expect([0, 5.5, 11, 14].map((v) => meterAt(v, BrushState.Raised).needlePx)).toEqual([0, 32, 63, 63]);
    // A bacon-butty top speed (×1.3) stretches the scale: 4.0 / 7.8 × 64 = 32.8 → 32 px clean.
    expect(meterAt(5, BrushState.Collecting, { meterDownMaxMps: 7.8 }).cleanPx).toBe(32);
  });

  it('keeps the needle inside its zone and clamps mph to 99', () => {
    for (let i = 0; i <= 600; i++) {
      const v = i / 100;
      const m = meterAt(v, BrushState.Collecting);
      if (m.zone === MeterZone.Clean) expect(m.needlePx, `${v}`).toBeLessThan(m.cleanPx);
      else expect(m.needlePx, `${v}`).toBeGreaterThanOrEqual(m.cleanPx);
      expect(m.speedText).toBe(`${Math.round(v * 2.237)} mph`);
    }
    expect(meterAt(60, BrushState.Raised).speedText).toBe('99 mph');
  });

  it('uses three different pixel patterns, not only three colours (GDD §17.2)', () => {
    const zones = [MeterZone.Clean, MeterZone.Fling, MeterZone.Transit];
    const canonical = zones.map((zone) => {
      // Each pixel's colour replaced by the order in which that colour first appears: two zones match only if
      // they are the same pattern in different colours.
      const seen: number[] = [];
      const out: number[] = [];
      for (let y = 0; y < METER_H_PX; y++) {
        for (let x = 0; x < METER_PX; x++) {
          const c = meterPatternIndex(zone, x, y);
          if (!seen.includes(c)) seen.push(c);
          out.push(seen.indexOf(c));
        }
      }
      return { colours: seen, shape: out.join('') };
    });
    expect(new Set(canonical.map((c) => c.shape)).size).toBe(3);
    expect(canonical.map((c) => [...c.colours].sort((a, b) => a - b))).toEqual([
      [GRASS_LT],
      [ASPHALT_LT, HIVIS],
      [ASPHALT_LT, COUNCIL_BLUE],
    ]);
  });

  it('ui.brush_meter frames are exactly meterPatternIndex', () => {
    const raster = new TextRaster(80, 30, uiAtlas);
    const zones = [
      [MeterZone.Clean, METER_FRAMES.clean],
      [MeterZone.Fling, METER_FRAMES.fling],
      [MeterZone.Transit, METER_FRAMES.transit],
    ] as const;
    zones.forEach(([zone, frame], i) => {
      raster.addRegion(frame, 0, 0, METER_PX, METER_H_PX, 0, i * 8, 255, 0);
      for (let y = 0; y < METER_H_PX; y++) {
        for (let x = 0; x < METER_PX; x++) {
          expect(raster.at(x, i * 8 + y), `${frame} (${x}, ${y})`).toBe(meterPatternIndex(zone, x, y));
        }
      }
    });
  });

  it('draws the brush-down bar as 42 px of solid 23 then hatching, transit dotted, the needle in 07', () => {
    const w = 480;
    const r = hudLayout(font, w).reserved.brushMeter;
    const at = (m: HudModel) => {
      const raster = new TextRaster(w, HUD_HEIGHT_PX, uiAtlas);
      new Hud(raster, font).drawModel(m, w);
      return raster;
    };
    const down = at(model({ speedMps: 4.5, brushState: BrushState.Collecting, rpm: 1 }));
    const needleX = r.x + 1 + 48; // floor(4.5 / 6 × 64) = 48
    for (let x = 0; x < METER_PX; x++) {
      const px = r.x + 1 + x;
      if (Math.abs(px - needleX) <= 1) continue;
      for (let y = 0; y < METER_H_PX; y++) {
        const want = meterPatternIndex(x < 42 ? MeterZone.Clean : MeterZone.Fling, x, y);
        expect(down.at(px, 235 + y), `(${x}, ${y})`).toBe(want);
      }
    }
    expect([233, 234, 240, 242].map((y) => down.at(needleX, y))).toEqual([0, CHALK, CHALK, 0]);
    expect(down.at(needleX - 1, 238)).toBe(0);
    const up = at(model({ speedMps: 0, brushState: BrushState.Raised }));
    for (let x = 2; x < METER_PX; x++) {
      for (let y = 0; y < METER_H_PX; y++) {
        expect(up.at(r.x + 1 + x, 235 + y)).toBe(meterPatternIndex(MeterZone.Transit, x, y));
      }
    }
  });

  it('highlightCleanZone (beat 3) blinks the clean zone 23 ↔ 24 in a 16 frame until its tick, brush down only', () => {
    const hud = new Hud(new TextRaster(480, 270, uiAtlas), font);
    hud.highlightCleanZone(100);
    const s = snap({ speedMps: 2, brushState: BrushState.Collecting, rpm: 1 });
    s.cleanHighlightUntilTick = hud.snapshot.cleanHighlightUntilTick;
    expect(s.cleanHighlightUntilTick).toBe(100);
    expect(hudModel(s, 0).meter).toMatchObject({ highlight: true, highlightLit: true });
    expect(hudModel(s, 8).meter).toMatchObject({ highlight: true, highlightLit: false });
    expect(hudModel(s, 99).meter.highlight).toBe(true);
    expect(hudModel(s, 100).meter).toMatchObject({ highlight: false, highlightLit: false });
    expect(hudModel({ ...s, brushState: BrushState.Raised }, 0).meter.highlight).toBe(false);
    const raster = new TextRaster(480, 270, uiAtlas);
    new Hud(raster, font).drawModel(hudModel(s, 0), 480);
    // Lime fill, the lemon frame round the 42 px clean zone (x 4..47), ink beyond it.
    expect([raster.at(6, 236), raster.at(4, 234), raster.at(47, 234), raster.at(48, 234)]).toEqual([
      LIME,
      LEMON,
      LEMON,
      0,
    ]);
    hud.reset();
    expect(hud.snapshot.cleanHighlightUntilTick).toBe(-1);
  });
});

describe('hudModel: the brush state icon and spin-up ring (GDD §8.2)', () => {
  const brushOf = (brushState: BrushState, rpm: number) => model({ brushState, rpm }).brush;

  it('Raised → ▲ with no ring; SpinningUp at rpm 0.5 → ▼ with ring step 4 of 8; Collecting → ▼, full ring', () => {
    expect(brushOf(BrushState.Raised, 0)).toEqual({
      visible: true,
      icon: BrushIcon.Raised,
      ringVisible: false,
      ringStep: 0,
    });
    expect(brushOf(BrushState.SpinningUp, 0.5)).toEqual({
      visible: true,
      icon: BrushIcon.Lowered,
      ringVisible: true,
      ringStep: 4,
    });
    expect(brushOf(BrushState.Collecting, 0.8)).toMatchObject({ icon: BrushIcon.Lowered, ringStep: 8 });
    expect(brushOf(BrushState.Collecting, 1)).toMatchObject({ icon: BrushIcon.Lowered, ringStep: 8 });
  });

  it('Lowering → ▼ with an empty ring, Bulldozing full, Raising ▲ without a ring; steps floor(rpm × 8)', () => {
    expect(brushOf(BrushState.Lowering, 0)).toMatchObject({
      icon: BrushIcon.Lowered,
      ringVisible: true,
      ringStep: 0,
    });
    expect(brushOf(BrushState.Bulldozing, 1)).toMatchObject({ ringVisible: true, ringStep: 8 });
    expect(brushOf(BrushState.Raising, 0)).toMatchObject({ icon: BrushIcon.Raised, ringVisible: false });
    for (let k = 0; k <= 36; k++) {
      expect(brushOf(BrushState.SpinningUp, k / 36).ringStep, `spin-up tick ${k}`).toBe(
        Math.floor((k / 36) * 8),
      );
    }
  });

  it('draws the badge, then the ring frame of its step over it, inside the brush state box', () => {
    const r = hudLayout(font, 480).reserved.brushState;
    const raster = new TextRaster(480, 270, uiAtlas);
    new Hud(raster, font).drawModel(model({ brushState: BrushState.SpinningUp, rpm: 0.5 }), 480);
    const want = new TextRaster(480, 270, uiAtlas);
    want.add('ui.brush_state:lowered:-:0', r.x + 8, r.y + 8, 255, 0);
    want.add(BRUSH_RING_FRAMES[4] ?? 'ui.brush_state:ring:-:0', r.x + 8, r.y + 8, 255, 0);
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) expect(raster.at(x, y), `(${x}, ${y})`).toBe(want.at(x, y));
    }
    // Half the ring is filled in 15 (clockwise from 12 o'clock to 6) and the other half is still the 03 track.
    expect(raster.at(r.x + 14, r.y + 7)).toBe(SWEEPER_YELLOW);
    expect(raster.at(r.x + 1, r.y + 7)).toBe(ASPHALT_LT);
  });
});

describe('hudModel: the power-up slot (SSP-096; GDD §15.2)', () => {
  it('shows the running power-up and its m:ss countdown, hidden while none runs', () => {
    expect(model({}).powerUp.visible).toBe(false);
    const tea = model({
      powerUpKind: POWERUP_IDS.indexOf('pwr.flask_of_tea'),
      powerUpTicksLeft: 899,
    }).powerUp;
    expect(tea).toEqual({ visible: true, kind: 0, text: '0:15', colour: HudColour.Chalk });
    expect(model({ powerUpKind: 0, powerUpTicksLeft: 661 }).powerUp.text).toBe('0:12');
    expect(model({ powerUpKind: 0, powerUpTicksLeft: 660 }).powerUp.text).toBe('0:11');
    expect(model({ powerUpKind: 0, powerUpTicksLeft: 1 }).powerUp.text).toBe('0:01');
    expect(model({ powerUpKind: 0, powerUpTicksLeft: 0 }).powerUp.visible).toBe(false);
    expect(model({ powerUpKind: -1, powerUpTicksLeft: 50 }).powerUp.visible).toBe(false);
  });

  it('reads the power-up the sim shows: the timed one collected last, with its ticks left', () => {
    const level = decodeLevel(readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8'));
    const world = createWorld(level, 1001, DEFAULT_TUNING);
    expect(readHudSnapshot(world, createHudSnapshot()).powerUpKind).toBe(-1);
    const butty = POWERUP_IDS.indexOf('pwr.bacon_butty');
    addPickup(world.pickups, butty, world.vehicle.xM, world.vehicle.yM);
    world.step(createInputFrame());
    const s = readHudSnapshot(world, createHudSnapshot());
    expect([s.powerUpKind, s.powerUpTicksLeft]).toEqual([butty, 599]);
    expect(hudModel(s, world.tick).powerUp.text).toBe('0:10');
    // The meter's scale follows the butty's top speed (×1.3).
    expect(s.meterDownMaxMps).toBeCloseTo(7.8, 9);
  });

  it('draws the icon in the slot box and the countdown beside it, inside the box', () => {
    const hiVis = POWERUP_IDS.indexOf('pwr.hi_vis');
    for (const w of [432, 480, 640]) {
      const r = hudLayout(font, w).reserved.powerUpSlot;
      const draw = (shown: boolean): TextRaster => {
        const raster = new TextRaster(w, 270, uiAtlas);
        const fields = shown ? { powerUpKind: hiVis, powerUpTicksLeft: 700 } : {};
        new Hud(raster, font).drawModel(model(fields), w);
        return raster;
      };
      const on = draw(true);
      const off = draw(false);
      const want = new TextRaster(w, 270, uiAtlas);
      want.add(POWER_UP_ICON_FRAMES[hiVis] ?? 'ui.powerup_icon:hi_vis:-:0', r.x + 8, r.y + 8, 255, 0);
      let icon = 0;
      let text = 0;
      for (let y = 0; y < 270; y++) {
        for (let x = 0; x < w; x++) {
          if (on.at(x, y) === off.at(x, y)) continue;
          // Everything the slot adds lies inside its reserved box.
          expect(inRect(r, x, y), `(${x}, ${y}) at W = ${w}`).toBe(true);
          if (x < r.x + 16) {
            expect(on.at(x, y), `icon (${x}, ${y})`).toBe(want.at(x, y));
            icon += 1;
          } else text += 1;
        }
      }
      // The icon, then the countdown '0:12' to its right.
      expect(icon).toBeGreaterThan(50);
      expect(text).toBeGreaterThan(20);
    }
    expect(POWER_UP_ICON_FRAMES).toEqual(POWERUP_IDS.map((id) => `ui.powerup_icon:${id.slice(4)}:-:0`));
  });
});

describe('hudModel: district name and Tidy % (GDD §9.2, §15.2)', () => {
  it('Tidy 0.599 → "59%" and 38 px of fill; tick marks at x = 38, 51 and 58', () => {
    const tidy = model({ tidyPpm: 599_000 }).tidy;
    expect(tidy.value.text).toBe('59%');
    expect(tidy.fillPx).toBe(38);
    expect(tidy.ticksPx).toEqual([38, 51, 58]);
  });

  it('floors both, so a star threshold never shows before it is reached', () => {
    const at = (ppm: number) => model({ tidyPpm: ppm }).tidy;
    expect([at(0).value.text, at(0).fillPx]).toEqual(['0%', 0]);
    expect([at(599_999).value.text, at(599_999).fillPx]).toEqual(['59%', 38]);
    expect([at(600_000).value.text, at(600_000).fillPx]).toEqual(['60%', 38]);
    expect([at(919_999).value.text, at(920_000).value.text]).toEqual(['91%', '92%']);
    expect([at(1_000_000).value.text, at(1_000_000).fillPx]).toEqual(['100%', 64]);
    const thresholds = [600_000, 800_000, 920_000];
    for (let ppm = 0; ppm <= 1_000_000; ppm += 997) {
      const t = at(ppm);
      const pct = Number.parseInt(t.value.text, 10);
      thresholds.forEach((threshold, i) => {
        if (ppm >= threshold) return;
        expect(pct, `${ppm} ppm`).toBeLessThan(threshold / 10_000);
        expect(t.fillPx, `${ppm} ppm`).toBeLessThanOrEqual(t.ticksPx[i] ?? 0);
      });
    }
  });

  it('shows the compiled display name upper-cased, falling back to the id', () => {
    expect(districtDisplayName({ id: 'district.puddle_lane', name: 'Puddle Lane' })).toBe('PUDDLE LANE');
    expect(districtDisplayName({ id: 'district.depot_yard' })).toBe('DEPOT YARD');
    expect(districtDisplayName({ id: 'district.x', name: 'A name far longer than twenty' })).toBe(
      'A NAME FAR LONGER TH',
    );
    expect(model({ districtName: 'PUDDLE LANE' }).district).toEqual({
      visible: true,
      text: 'PUDDLE LANE',
      colour: CHALK,
    });
  });

  it('reads the name, Tidy %, thresholds, brush, speed scale and sites from a real Puddle Lane World', () => {
    const level = decodeLevel(readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8'));
    expect(level.name).toBe('Puddle Lane');
    const world = createWorld(level, 1, DEFAULT_TUNING);
    world.step(createInputFrame());
    const s = readHudSnapshot(world, createHudSnapshot());
    expect(s.districtName).toBe('PUDDLE LANE');
    expect([s.star1Ppm, s.star2Ppm, s.star3Ppm]).toEqual([600_000, 800_000, 920_000]);
    expect(s.tidyPpm).toBe(world.tidy.tidyPpm);
    expect([s.brushState, s.flingThresholdMps, s.meterDownMaxMps, s.meterTransitMaxMps]).toEqual([
      BrushState.Raised,
      4,
      6,
      11,
    ]);
    // Two depot bays (tiles [6, 42, 8, 45] and [9, 42, 11, 45]: centres (14, 87) and (20, 87) m) and the two
    // hydrants, in level order.
    expect([s.depotCount, Array.from(s.depotX), Array.from(s.depotY)]).toEqual([2, [14, 20], [87, 87]]);
    expect([s.hydrantCount, Array.from(s.hydrantX), Array.from(s.hydrantY)]).toEqual([2, [77, 51], [7, 15]]);
    // Made once per shift: a second read keeps the same name and depot list.
    const name = s.districtName;
    const depots = s.depotX;
    readHudSnapshot(world, s);
    expect(s.districtName).toBe(name);
    expect(s.depotX).toBe(depots);
  });
});

/** The arrow's 11×11 box. */
function arrowBox(a: HudArrow): HudRect {
  const size = 2 * ARROW_HALF_PX + 1;
  return { x: a.xPx - ARROW_HALF_PX, y: a.yPx - ARROW_HALF_PX, w: size, h: size };
}

/** Degrees between the arrow's direction and the direction from (bx, by) to (tx, ty), on screen. */
function arrowError(a: HudArrow, bx: number, by: number, tx: number, ty: number): number {
  const want = Math.atan2(ty - by, tx - bx);
  const got = (a.dir * Math.PI) / 4;
  let d = Math.abs(want - got) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return (d * 180) / Math.PI;
}

describe('hudModel: off-screen arrows (GDD §15.2)', () => {
  /** Camera on Bessie at the origin, 16 px/m: Bessie at screen (W / 2, 135). */
  const CAMERA = { cameraXM: 0, cameraYM: 0, cameraPxPerM: 16, bessieXM: 0, bessieYM: 0 } as const;
  /** A depot bay far to the south-west (screen (−1360, 1095) at W = 480), and one on screen. */
  const OFF = { depotCount: 1, depotX: [-100], depotY: [60] } as const;
  const ON = { depotCount: 1, depotX: [5], depotY: [3] } as const;

  it('hopper 79% → no depot arrow; 80% with the bay off-screen → inside the margin, within 22.5°; on-screen → hidden', () => {
    expect(model({ ...CAMERA, ...OFF, hopperLu: 79 }).depotArrow.visible).toBe(false);
    const a = model({ ...CAMERA, ...OFF, hopperLu: 80 }).depotArrow;
    expect(a.visible).toBe(true);
    expect(a.target).toBe(0);
    expect(a.colour).toBe(SWEEPER_YELLOW);
    const box = arrowBox(a);
    expect(box.x).toBeGreaterThanOrEqual(HUD_MARGIN_PX);
    expect(box.y).toBeGreaterThanOrEqual(HUD_MARGIN_PX);
    expect(box.x + box.w).toBeLessThanOrEqual(480 - HUD_MARGIN_PX);
    expect(box.y + box.h).toBeLessThanOrEqual(270 - HUD_MARGIN_PX);
    expect(arrowError(a, 240, 135, 240 - 1600, 135 + 960)).toBeLessThanOrEqual(22.5);
    expect(ARROW_DIRS[a.dir]).toBe('sw');
    // A full hopper keeps it (it is also the GDD hopper row's dump-site arrow at 100%).
    expect(model({ ...CAMERA, ...OFF, hopperLu: 100 }).depotArrow.visible).toBe(true);
    expect(model({ ...CAMERA, ...ON, hopperLu: 80 }).depotArrow.visible).toBe(false);
    // No camera (pxPerM 0): no arrows.
    expect(model({ ...CAMERA, ...OFF, hopperLu: 80, cameraPxPerM: 0 }).depotArrow.visible).toBe(false);
  });

  it('water 20% → no hydrant arrow; 19% → an arrow to the nearer of two hydrants (ties to the lower index)', () => {
    const hydrants = { hydrantCount: 2, hydrantX: [80, -50], hydrantY: [-80, -30] } as const;
    expect(model({ ...CAMERA, ...hydrants, water: 20 }).hydrantArrow.visible).toBe(false);
    const a = model({ ...CAMERA, ...hydrants, water: 19 }).hydrantArrow;
    expect(a.visible).toBe(true);
    expect(a.target).toBe(1);
    expect(a.colour).toBe(SKY);
    expect(arrowError(a, 240, 135, 240 - 800, 135 - 480)).toBeLessThanOrEqual(22.5);
    expect(ARROW_DIRS[a.dir]).toBe('nw');
    expect(nearestPoint([3, -3, 3], [4, 4, -4], 3, 0, 0)).toBe(0);
    expect(nearestPoint([9, 3, -3], [9, 4, 4], 3, 0, 0)).toBe(1);
    expect(nearestPoint([], [], 0, 0, 0)).toBe(-1);
  });

  it('every direction at W = 432, 480 and 640: inside the margin, 1 px clear of every HUD box, within 22.5°', () => {
    for (const w of [432, 480, 640]) {
      const frame: HudArrowFrame = hudLayout(font, w).arrowFrame;
      const a = createHudModel().depotArrow;
      for (const [bx, by] of [
        [w / 2, 135],
        [w / 2 + 37, 135 - 29],
        [w / 2 - 41, 135 + 33],
      ] as const) {
        for (let deg = 0; deg < 360; deg += 1) {
          const rad = (deg * Math.PI) / 180;
          const tx = bx + Math.cos(rad) * 2000;
          const ty = by + Math.sin(rad) * 2000;
          placeArrow(a, bx, by, tx, ty, frame);
          const where = `${deg}° from (${bx}, ${by}) at W = ${w}: (${a.xPx}, ${a.yPx})`;
          expect(a.visible, where).toBe(true);
          const box = arrowBox(a);
          expect(box.x, where).toBeGreaterThanOrEqual(HUD_MARGIN_PX);
          expect(box.y, where).toBeGreaterThanOrEqual(HUD_MARGIN_PX);
          expect(box.x + box.w, where).toBeLessThanOrEqual(w - HUD_MARGIN_PX);
          expect(box.y + box.h, where).toBeLessThanOrEqual(270 - HUD_MARGIN_PX);
          for (const b of frame.blockers) {
            const near =
              box.x < b.x + b.w + 1 &&
              b.x < box.x + box.w + 1 &&
              box.y < b.y + b.h + 1 &&
              b.y < box.y + box.h + 1;
            expect(near, `${where} touches (${b.x}, ${b.y}, ${b.w}, ${b.h})`).toBe(false);
          }
          expect(arrowError(a, bx, by, tx, ty), where).toBeLessThanOrEqual(22.5);
          // On the ray (to within the rounding).
          const cross = (a.xPx - bx) * Math.sin(rad) - (a.yPx - by) * Math.cos(rad);
          expect(Math.abs(cross), where).toBeLessThan(1);
        }
      }
    }
  });

  it('hides an arrow whose target is inside the frame, and when Bessie is under a HUD box', () => {
    const a = createHudModel().depotArrow;
    placeArrow(a, 240, 135, 479, 269, DEFAULT_ARROW_FRAME);
    expect(a.visible).toBe(false);
    placeArrow(a, 240, 135, 480, 135, DEFAULT_ARROW_FRAME);
    expect(a.visible).toBe(true);
    expect(ARROW_DIRS[a.dir]).toBe('e');
    placeArrow(a, 30, 260, 30, 2000, hudLayout(font, 480).arrowFrame);
    expect(a.visible).toBe(false);
  });

  it('draws each arrow as its direction frame at its position', () => {
    const w = 480;
    const layout = hudLayout(font, w);
    const s = snap({ ...CAMERA, ...OFF, hopperLu: 90, water: 10 });
    Object.assign(s, { hydrantCount: 1, hydrantX: [90], hydrantY: [-70] });
    const m = hudModel(s, 0, createHudModel(), layout.arrowFrame);
    expect([m.depotArrow.visible, m.hydrantArrow.visible]).toEqual([true, true]);
    const raster = new TextRaster(w, 270, uiAtlas);
    new Hud(raster, font).drawModel(m, w);
    for (const [a, frames] of [
      [m.depotArrow, DEPOT_ARROW_FRAMES],
      [m.hydrantArrow, HYDRANT_ARROW_FRAMES],
    ] as const) {
      const want = new TextRaster(w, 270, uiAtlas);
      want.add(frames[a.dir] ?? 'ui.offscreen_arrow:depot:e:0', a.xPx, a.yPx, 255, 0);
      const box = arrowBox(a);
      let drawn = 0;
      for (let y = box.y; y < box.y + box.h; y++) {
        for (let x = box.x; x < box.x + box.w; x++) {
          if (want.at(x, y) >= 0) drawn++;
          expect(raster.at(x, y), `(${x}, ${y})`).toBe(want.at(x, y));
        }
      }
      expect(drawn).toBeGreaterThan(30);
    }
  });

  it('against a real World: water below 20% points at the nearer Puddle Lane hydrant; bays on screen hide', () => {
    const level = decodeLevel(readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8'));
    const world = createWorld(level, 1, DEFAULT_TUNING);
    world.step(createInputFrame());
    world.vehicle.water = 19;
    world.vehicle.hopperLU = 85;
    const s = readHudSnapshot(world, createHudSnapshot());
    Object.assign(s, { cameraXM: world.vehicle.xM, cameraYM: world.vehicle.yM, cameraPxPerM: 16 });
    const m = hudModel(s, world.tick, createHudModel(), hudLayout(font, 480).arrowFrame);
    // Bessie starts in the depot at (7, 89): the bays are on screen, so no depot arrow.
    expect(m.depotArrow.visible).toBe(false);
    // Hydrants (77, 7) and (51, 15): the second is nearer.
    expect(m.hydrantArrow).toMatchObject({ visible: true, target: 1 });
    const tx = 240 + (51 - world.vehicle.xM) * 16;
    const ty = 135 + (15 - world.vehicle.yM) * 16;
    expect(arrowError(m.hydrantArrow, 240, 135, tx, ty)).toBeLessThanOrEqual(22.5);
  });
});

describe('the sample frame (hud_sample) shows every SSP-299 widget at every width', () => {
  it('meter, ring, district, Tidy bar and both arrows are visible, each inside its box or arrow box', () => {
    expect(HUD_SAMPLE_SNAPSHOT.brushState).toBe(BrushState.Collecting);
    for (const w of PIXEL_WIDTHS) {
      const layout = hudLayout(font, w);
      const m = sampleModel(createHudModel(), layout.arrowFrame);
      expect([m.meter.visible, m.brush.ringVisible, m.district.visible, m.tidy.visible]).toEqual([
        true,
        true,
        true,
        true,
      ]);
      expect([m.depotArrow.visible, m.hydrantArrow.visible], `W = ${w}`).toEqual([true, true]);
      expect(m.hydrantArrow.target).toBe(0);
      const boxes = [...Object.values(layout.reserved), arrowBox(m.depotArrow), arrowBox(m.hydrantArrow)];
      const pixels = drawnPixels(m, w);
      for (let i = 0; i < pixels.length; i += 2) {
        const x = pixels[i] ?? -1;
        const y = pixels[i + 1] ?? -1;
        expect(
          boxes.some((b) => inRect(b, x, y)),
          `(${x}, ${y}) at W = ${w}`,
        ).toBe(true);
      }
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
