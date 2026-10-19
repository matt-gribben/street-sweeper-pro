// Pam's radio panel (SSP-289; GDD §11.3, §15.2, §16.1; ART_BIBLE §12.2, §12.3): the bark queue (one at a time, 180
// ticks a page, cancel), paging of over-long barks at word boundaries inside the 4 px margin at W = 432, the action
// tokens rendered as keycaps for the active device and {cleanSpeed}, the 4th-complaint bark, the relocation rule,
// the drawn panel (tab, keycap, every pixel inside its slot at every width), and the per-frame no-`new` rule (the
// heap check is hudHeap.test.ts).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/app/events.ts';
import { DEFAULT_GLYPHS } from '../../src/app/glyphBindings.ts';
import {
  HUD_SAMPLE_BARK,
  hudSampleModel,
  hudSamplePages,
  hudSampleRadio,
} from '../../src/scenes/HudSampleScene.ts';
import { HUD_CAPACITY, HUD_FONT } from '../../src/scenes/ShiftScene.ts';
import { Offence } from '../../src/sim/complaints.ts';
import { createEventQueue, EV, emitEvent, resetEvents, sealEvents } from '../../src/sim/eventQueue.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { decodeLevel } from '../../src/sim/map.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld } from '../../src/sim/world.ts';
import { TextVariant } from '../../src/ui/bitmapText.ts';
import type { GlyphDevice } from '../../src/ui/glyphs.ts';
import {
  HUD_HEIGHT_PX,
  HUD_MARGIN_PX,
  HUD_MAX_WIDTH_PX,
  HUD_MIN_WIDTH_PX,
  Hud,
  type HudRect,
  hudLayout,
} from '../../src/ui/hud.ts';
import { createHudModel } from '../../src/ui/hudModel.ts';
import {
  BARK_NONE,
  BARK_PAGE_TICKS,
  BARK_QUEUE_MAX,
  type BarkContext,
  barkPlainText,
  COMPLAINT_WARN_BARK,
  cleanSpeedText,
  createRadioModel,
  KEYCAP_H_PX,
  KEYCAP_TOP_PX,
  keycapWidthPx,
  pageBark,
  parseBark,
  RADIO_AWAY_Y,
  RADIO_HOME_Y,
  RADIO_LOOK_AHEAD_S,
  RADIO_PAGE_MAX_INK_PX,
  RADIO_PANEL_H_PX,
  RADIO_PANEL_MAX_W_PX,
  RADIO_SIDE_HYSTERESIS_PX,
  RADIO_SLOT_H_PX,
  RADIO_SPEAKER,
  RADIO_TAB_H_PX,
  RADIO_TAB_INSET_PX,
  RADIO_TAB_W_PX,
  RADIO_TEXT_INSET_PX,
  RADIO_TEXT_TOP_PX,
  Radio,
  type RadioModel,
  type RadioPage,
  RadioSide,
  radioLookAheadXPx,
  radioModel,
  radioSide,
  radioSlots,
} from '../../src/ui/radio.ts';
import { readBitmapFont, readIndexedAtlas, TextRaster } from '../support/textRaster.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const font = readBitmapFont(HUD_FONT);
const uiAtlas = readIndexedAtlas('ui');

/** Palette indices (ART_BIBLE §5.1). */
const INK = 0;
const CHALK = 7;
const HIVIS = 17;
const COUNCIL_BLUE = 26;

const keyboard: BarkContext = { glyphs: DEFAULT_GLYPHS, device: 'keyboard', cleanSpeedMps: 4 };
const gamepad: BarkContext = { ...keyboard, device: 'gamepad' };

/** GDD §16.2 beat 1 as SSP-290 will author it: about 75 characters, wider than any one page. */
const BEAT_1 = "Morning, rookie. That's Bessie. Be gentle with her. {throttle} to go, {steer} to steer.";

const WIDTHS = Array.from(
  { length: (HUD_MAX_WIDTH_PX - HUD_MIN_WIDTH_PX) / 2 + 1 },
  (_, i) => HUD_MIN_WIDTH_PX + 2 * i,
);

const radio = (): Radio => new Radio(font, DEFAULT_GLYPHS);

/**
 * `model` drawn by the real Hud at width `w`, as a raster of the radio panel's pixels only: the rest of a blank
 * HUD (the score '0' and the gauges, which drawModel always draws) is drawn first and then cleared away.
 */
function rasterRadio(model: RadioModel, w: number): TextRaster {
  const base = new TextRaster(w, HUD_HEIGHT_PX, uiAtlas);
  new Hud(base, font, DEFAULT_GLYPHS).drawModel(createHudModel(), w);
  const raster = new TextRaster(w, HUD_HEIGHT_PX, uiAtlas);
  new Hud(raster, font, DEFAULT_GLYPHS).drawModel(createHudModel(), w, model);
  for (let i = 0; i < raster.index.length; i++) {
    if (raster.index[i] === base.index[i]) raster.index[i] = -1;
  }
  return raster;
}

/** Every covered pixel of `raster` as [x, y, index]. */
function covered(raster: TextRaster): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let y = 0; y < raster.height; y++)
    for (let x = 0; x < raster.width; x++) {
      const i = raster.at(x, y);
      if (i >= 0) out.push([x, y, i]);
    }
  return out;
}

const inRect = (r: HudRect, x: number, y: number): boolean =>
  x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

/** The text runs of a page joined (keycaps as their label in brackets), for reading pages back. */
function pageText(page: RadioPage): string {
  let out = '';
  let pen = 0;
  for (const run of page.runs) {
    if (run.xPx > pen && out !== '' && !out.endsWith(' ')) out += ' ';
    out += run.keycap ? `[${run.text}]` : run.text;
    pen = run.xPx + run.wPx + 1;
  }
  return out;
}

describe('the bark queue (GDD §16.1: one prompt at a time; 180 ticks = 3 s)', () => {
  it('shows two barks enqueued together one after the other, each for 180 ticks, never at once', () => {
    const r = radio();
    const a = r.enqueue('Lovely.');
    const b = r.enqueue('Too quick!');
    expect(a).toBeGreaterThan(BARK_NONE);
    expect(b).toBeGreaterThan(a);
    const shown: number[] = [];
    for (let t = 0; t < 3 * BARK_PAGE_TICKS; t++) {
      // One id at a time: the current bark, and it is never also still queued.
      const current = r.currentId;
      shown.push(current);
      if (current !== BARK_NONE) expect(r.queuedIds).not.toContain(current);
      expect(r.current() === null).toBe(current === BARK_NONE);
      r.tick();
    }
    expect(shown.slice(0, 180).every((id) => id === a)).toBe(true);
    expect(shown.slice(180, 360).every((id) => id === b)).toBe(true);
    expect(shown.slice(360).every((id) => id === BARK_NONE)).toBe(true);
  });

  it('a cancelled queued bark never shows; cancelling the showing bark ends it at once', () => {
    const r = radio();
    const a = r.enqueue('One.');
    const b = r.enqueue('Two.');
    const c = r.enqueue('Three.');
    expect(r.cancel(b)).toBe(true);
    expect(r.cancel(b)).toBe(false);
    const seen = new Set<number>();
    for (let t = 0; t < 4 * BARK_PAGE_TICKS; t++) {
      seen.add(r.currentId);
      r.tick();
    }
    expect([...seen].sort()).toEqual([BARK_NONE, a, c].sort());
    // Cancelling the bark on screen (the tutorial beat was performed) brings the next one up at age 0.
    const d = r.enqueue('Four.');
    const e = r.enqueue('Five.');
    for (let t = 0; t < 50; t++) r.tick();
    expect(r.currentId).toBe(d);
    expect(r.cancel(d)).toBe(true);
    expect([r.currentId, r.pageAgeTicks]).toEqual([e, 0]);
    expect(r.cancel(12_345)).toBe(false);
  });

  it('starts a bark enqueued while idle at once, and one enqueued mid-bark only after it', () => {
    const r = radio();
    for (let t = 0; t < 10; t++) r.tick();
    const a = r.enqueue('Ah. Doris.');
    expect([r.currentId, r.pageAgeTicks]).toEqual([a, 0]);
    for (let t = 0; t < 100; t++) r.tick();
    const b = r.enqueue('Go round.');
    expect(r.currentId).toBe(a);
    for (let t = 0; t < 80; t++) r.tick();
    expect([r.currentId, r.pageAgeTicks]).toEqual([b, 0]);
  });

  it('refuses an empty bark and a bark past BARK_QUEUE_MAX waiting; clear() forgets everything', () => {
    const r = radio();
    expect(r.enqueue('')).toBe(BARK_NONE);
    expect(r.enqueue('   ')).toBe(BARK_NONE);
    const first = r.enqueue('Showing.');
    for (let i = 0; i < BARK_QUEUE_MAX; i++) expect(r.enqueue(`Queued ${i}.`)).toBeGreaterThan(first);
    expect(r.enqueue('One too many.')).toBe(BARK_NONE);
    expect(r.queuedIds).toHaveLength(BARK_QUEUE_MAX);
    r.side = RadioSide.Away;
    r.clear();
    expect([r.currentId, r.queuedIds, r.current(), r.side]).toEqual([BARK_NONE, [], null, RadioSide.Home]);
  });

  it('freezes with the sim: only tick() ages a bark (the HUD ticks it once per sim tick)', () => {
    const level = decodeLevel(readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8'));
    const world = createWorld(level, 1, DEFAULT_TUNING);
    const hud = new Hud(new TextRaster(480, HUD_HEIGHT_PX, uiAtlas), font, DEFAULT_GLYPHS);
    const id = hud.radio.enqueue('Morning, rookie.');
    // Frames without ticks (a paused shift) never move the bark on.
    for (let f = 0; f < 500; f++) hud.draw(world, 480);
    expect([hud.radio.currentId, hud.radio.pageAgeTicks]).toEqual([id, 0]);
    for (let t = 0; t < BARK_PAGE_TICKS - 1; t++) {
      world.step(createInputFrame());
      hud.tick(world);
    }
    expect(hud.radio.currentId).toBe(id);
    world.step(createInputFrame());
    hud.tick(world);
    expect(hud.radio.currentId).toBe(BARK_NONE);
  });
});

describe('paging an over-long bark (decided in SSP-289, GDD §15.2)', () => {
  it('the widest panel fits its half of the narrowest frame, and the 4th-complaint bark fits one page', () => {
    expect(RADIO_PANEL_MAX_W_PX).toBeLessThanOrEqual(HUD_MIN_WIDTH_PX / 2 - HUD_MARGIN_PX);
    expect(RADIO_PAGE_MAX_INK_PX).toBe(RADIO_PANEL_MAX_W_PX - 2 * RADIO_TEXT_INSET_PX);
    expect(pageBark(parseBark(COMPLAINT_WARN_BARK), font, keyboard)).toHaveLength(1);
  });

  it('splits a bark wider than the panel at W = 432 at word boundaries into pages that each fit', () => {
    const pieces = parseBark(BEAT_1);
    const whole = barkPlainText(pieces, keyboard);
    expect(font.measure(whole, TextVariant.Plain) - 1).toBeGreaterThan(RADIO_PAGE_MAX_INK_PX);
    for (const context of [keyboard, gamepad]) {
      const pages = pageBark(pieces, font, context);
      expect(pages.length, context.device).toBeGreaterThan(1);
      for (const page of pages) {
        expect(page.inkPx).toBeLessThanOrEqual(RADIO_PAGE_MAX_INK_PX);
        const last = page.runs[page.runs.length - 1];
        expect(last === undefined ? 0 : last.xPx + last.wPx).toBe(page.inkPx);
      }
      // Every word is kept whole and in order: the pages joined by one space are the whole bark.
      const words = pages.map((p) => p.runs.map((run) => run.text).join(''));
      expect(words.join(' ').replaceAll(/\s+/g, ' ')).toBe(barkPlainText(pieces, context));
    }
    expect(pageBark(pieces, font, keyboard).map(pageText)).toEqual([
      "Morning, rookie. That's Bessie.",
      'Be gentle with her. [W] to go,',
      '[A/D] to steer.',
    ]);
    expect(pageBark(pieces, font, gamepad).map(pageText)).toEqual([
      "Morning, rookie. That's Bessie.",
      'Be gentle with her. [RT] to go,',
      '[Left Stick] to steer.',
    ]);
  });

  it('no rendered line of any page crosses the 4 px safe margin at W = 432, home or away', () => {
    const w = HUD_MIN_WIDTH_PX;
    const pages = pageBark(parseBark(BEAT_1), font, keyboard);
    const widest = Math.max(...pages.map((p) => p.inkPx));
    const slots = radioSlots(w);
    for (const side of [RadioSide.Home, RadioSide.Away]) {
      for (const page of pages) {
        const pixels = covered(rasterRadio(radioModel(page, widest, side, w, createRadioModel()), w));
        expect(pixels.length).toBeGreaterThan(500);
        const slot = side === RadioSide.Home ? slots.home : slots.away;
        for (const [x, y] of pixels) {
          expect(x >= HUD_MARGIN_PX && x < w - HUD_MARGIN_PX, `(${x}, ${y})`).toBe(true);
          expect(y >= HUD_MARGIN_PX && y < HUD_HEIGHT_PX - HUD_MARGIN_PX, `(${x}, ${y})`).toBe(true);
          expect(inRect(slot, x, y), `(${x}, ${y}) in its slot`).toBe(true);
        }
      }
    }
  });

  it('shows each page for its own 180 ticks, then the next bark', () => {
    const r = radio();
    const id = r.enqueue(BEAT_1);
    const after = r.enqueue('Lovely.');
    const pages = r.currentPages.length;
    expect(pages).toBe(3);
    for (let p = 0; p < pages; p++) {
      for (let t = 0; t < BARK_PAGE_TICKS; t++) {
        expect([r.currentId, r.pageIndex, r.pageAgeTicks]).toEqual([id, p, t]);
        expect(r.current()).toBe(r.currentPages[p]);
        r.tick();
      }
    }
    expect([r.currentId, r.pageIndex]).toEqual([after, 0]);
  });

  it('cuts a single word wider than a page between characters, and keeps short words whole', () => {
    const long = 'A'.repeat(40);
    const pages = pageBark(parseBark(`Oi ${long} done`), font, keyboard);
    for (const p of pages) expect(p.inkPx).toBeLessThanOrEqual(RADIO_PAGE_MAX_INK_PX);
    expect(pages.map(pageText)).toEqual(['Oi', 'A'.repeat(32), `${'A'.repeat(8)} done`]);
  });
});

describe('tokens: inline keycaps for the active device, and {cleanSpeed}', () => {
  it("'Brush down with {brush}.' renders 'Space' in a keycap on the keyboard and 'A' on the pad", () => {
    const pieces = parseBark('Brush down with {brush}.');
    expect(pieces).toEqual([
      { kind: 'text', text: 'Brush down with ' },
      { kind: 'key', action: 'brush' },
      { kind: 'text', text: '.' },
    ]);
    const expectKeycap = (device: GlyphDevice, label: string): void => {
      const [page, ...rest] = pageBark(pieces, font, { ...keyboard, device });
      expect(rest).toEqual([]);
      expect(page?.runs.map((r) => [r.keycap, r.text])).toEqual([
        [false, 'Brush down with '],
        [true, label],
        [false, '.'],
      ]);
      // Drawn: the label's glyphs in 07 inside a 1 px 07 box (corners cut) over the panel's 26 fill.
      const w = 480;
      const m = radioModel(page ?? null, page?.inkPx ?? 0, RadioSide.Home, w, createRadioModel());
      const raster = rasterRadio(m, w);
      const key = page?.runs[1];
      if (key === undefined) throw new Error('no keycap run');
      const kx = m.panelX + RADIO_TEXT_INSET_PX + key.xPx;
      const ky = m.panelY + KEYCAP_TOP_PX;
      expect(key.wPx).toBe(keycapWidthPx(font, label));
      expect(raster.at(kx, ky), 'corner cut').toBe(COUNCIL_BLUE);
      expect(raster.at(kx + 1, ky)).toBe(CHALK);
      expect(raster.at(kx + key.wPx - 2, ky + KEYCAP_H_PX - 1)).toBe(CHALK);
      expect(raster.at(kx, ky + 1)).toBe(CHALK);
      expect(raster.at(kx + key.wPx - 1, ky + KEYCAP_H_PX - 2)).toBe(CHALK);
      expect(raster.at(kx + 1, ky + 1), 'pad').toBe(COUNCIL_BLUE);
      // The label is the same pixels as drawing it on its own at the label's place.
      const alone = new TextRaster(w, HUD_HEIGHT_PX, uiAtlas);
      font.draw(alone, label, kx + 2, m.panelY + RADIO_TEXT_TOP_PX, CHALK);
      let labelPixels = 0;
      for (const [x, y, i] of covered(alone)) {
        expect(raster.at(x, y), `label pixel (${x}, ${y})`).toBe(i);
        labelPixels++;
      }
      expect(labelPixels).toBeGreaterThan(5);
    };
    expectKeycap('keyboard', 'Space');
    expectKeycap('gamepad', 'A');
  });

  it('a device change while a bark shows re-lays it out with the new glyphs, keeping its page and age', () => {
    const r = radio();
    r.enqueue(BEAT_1);
    for (let t = 0; t < BARK_PAGE_TICKS + 20; t++) r.tick();
    expect([r.pageIndex, r.pageAgeTicks]).toEqual([1, 20]);
    expect(r.current()?.runs.find((run) => run.keycap)?.text).toBe('W');
    r.setDevice('gamepad');
    expect([r.pageIndex, r.pageAgeTicks]).toEqual([1, 20]);
    expect(r.current()?.runs.find((run) => run.keycap)?.text).toBe('RT');
    const page = r.current();
    r.setDevice('gamepad');
    expect(r.current()).toBe(page);
  });

  it("{cleanSpeed} renders '9 mph' (4.0 m/s) as plain text, and follows the tuning", () => {
    expect(cleanSpeedText(4.0)).toBe('9 mph');
    const pieces = parseBark('Keep it under {cleanSpeed} or you will fling it.');
    expect(barkPlainText(pieces, keyboard)).toBe('Keep it under 9 mph or you will fling it.');
    const [page] = pageBark(pieces, font, keyboard);
    expect(page?.runs.every((run) => !run.keycap)).toBe(true);
    const r = radio();
    r.enqueue('Under {cleanSpeed}!');
    expect(
      r
        .current()
        ?.runs.map((run) => run.text)
        .join(''),
    ).toBe('Under 9 mph!');
    r.setCleanSpeed(6.0);
    expect(
      r
        .current()
        ?.runs.map((run) => run.text)
        .join(''),
    ).toBe('Under 13 mph!');
  });

  it('accepts every glyph action as a token and throws for unknown tokens and unmatched braces', () => {
    for (const action of [
      'throttle',
      'steer',
      'brush',
      'interact',
      'horn',
      'spray',
      'brake',
      'map',
      'pause',
    ]) {
      expect(parseBark(`{${action}}`)).toEqual([{ kind: 'key', action }]);
    }
    expect(() => parseBark('Press {jump}.')).toThrow(/unknown token \{jump\}/);
    expect(() => parseBark('Press {brush.')).toThrow(/never closed/);
    expect(() => parseBark('Press brush}.')).toThrow(/without/);
    expect(() => radio().enqueue('{Brush}')).toThrow(/unknown token/);
  });

  it('every default keycap label fits a page on its own', () => {
    for (const device of ['keyboard', 'gamepad'] as const) {
      for (const label of Object.values(DEFAULT_GLYPHS[device])) {
        expect(keycapWidthPx(font, label), label).toBeLessThan(RADIO_PAGE_MAX_INK_PX);
      }
    }
  });
});

describe('the 4th complaint (GDD §11.3)', () => {
  it(`reaching 4 complaints enqueues exactly "${COMPLAINT_WARN_BARK}" once`, () => {
    const hud = new Hud(new TextRaster(480, HUD_HEIGHT_PX, uiAtlas), font, DEFAULT_GLYPHS);
    const texts: (string | null)[] = [];
    for (let n = 1; n <= 3; n++) {
      hud.onComplaint(10 * n);
      expect(hud.radio.currentId, `after ${n}`).toBe(BARK_NONE);
    }
    hud.onComplaint(40);
    texts.push(hud.radio.currentText);
    expect(hud.radio.queuedIds).toEqual([]);
    hud.onComplaint(50);
    hud.onComplaint(60);
    expect(hud.radio.queuedIds).toEqual([]);
    expect(texts).toEqual([COMPLAINT_WARN_BARK]);
    // It plays out and does not come back.
    let shownTicks = 0;
    for (let t = 0; t < 1_000; t++) {
      if (hud.radio.currentText === COMPLAINT_WARN_BARK) shownTicks++;
      hud.radio.tick();
    }
    expect(shownTicks).toBe(BARK_PAGE_TICKS);
    // A new shift (reset) can bark it again.
    hud.reset();
    for (let n = 0; n < 4; n++) hud.onComplaint(n);
    expect(hud.radio.currentText).toBe(COMPLAINT_WARN_BARK);
  });

  it('from EV.Complaint on the bus, including two complaints in one tick (3 → 5)', () => {
    const bus = new EventBus();
    const hud = new Hud(new TextRaster(480, HUD_HEIGHT_PX, uiAtlas), font, DEFAULT_GLYPHS);
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
    emitComplaints(10, 3);
    expect(hud.radio.currentId).toBe(BARK_NONE);
    emitComplaints(20, 2);
    expect([hud.radio.currentText, hud.radio.queuedIds]).toEqual([COMPLAINT_WARN_BARK, []]);
    stop();
  });

  it('waits its turn behind a bark already showing (FIFO)', () => {
    const hud = new Hud(new TextRaster(480, HUD_HEIGHT_PX, uiAtlas), font, DEFAULT_GLYPHS);
    const tutorial = hud.radio.enqueue("That's a complaint. Five of those and you're sacked.");
    for (let n = 0; n < 4; n++) hud.onComplaint(n);
    expect(hud.radio.currentId).toBe(tutorial);
    expect(hud.radio.queuedIds).toHaveLength(1);
  });
});

describe('relocation: the panel keeps off the road ahead (decided in SSP-289, GDD §15.2)', () => {
  it('moves away when the look-ahead point is in its half of the frame, and back otherwise', () => {
    for (const w of [432, 480, 640]) {
      const half = w / 2;
      const h = RADIO_SIDE_HYSTERESIS_PX;
      // Home (left): the point well inside the left half sends it away; anywhere else keeps it home.
      expect(radioSide(RadioSide.Home, half - h - 1, w)).toBe(RadioSide.Away);
      expect(radioSide(RadioSide.Home, 10, w)).toBe(RadioSide.Away);
      expect(radioSide(RadioSide.Home, half - h, w)).toBe(RadioSide.Home);
      expect(radioSide(RadioSide.Home, half + 50, w)).toBe(RadioSide.Home);
      // Away (right): the point well inside the right half brings it back; anywhere else keeps it away.
      expect(radioSide(RadioSide.Away, half + h + 1, w)).toBe(RadioSide.Home);
      expect(radioSide(RadioSide.Away, w - 10, w)).toBe(RadioSide.Home);
      expect(radioSide(RadioSide.Away, half + h, w)).toBe(RadioSide.Away);
      expect(radioSide(RadioSide.Away, half - 50, w)).toBe(RadioSide.Away);
    }
  });

  it('the look-ahead point is Bessie plus 2 s of her velocity, projected with the camera', () => {
    expect(RADIO_LOOK_AHEAD_S).toBe(2);
    // Parked under the camera: the frame centre.
    expect(radioLookAheadXPx(10, 0, 10, 16, 480)).toBe(240);
    // Driving west at 4 m/s, the camera led 3 m ahead of her: 8 m − 3 m = 80 px left of centre.
    expect(radioLookAheadXPx(10, -4, 7, 16, 480)).toBe(160);
    // No camera: the centre.
    expect(radioLookAheadXPx(10, -4, 7, 0, 480)).toBe(240);
  });

  it('the HUD flips the panel while Bessie drives west and brings it home as she drives east', () => {
    const level = decodeLevel(readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8'));
    const world = createWorld(level, 1, DEFAULT_TUNING);
    world.step(createInputFrame());
    const hud = new Hud(new TextRaster(480, HUD_HEIGHT_PX, uiAtlas), font, DEFAULT_GLYPHS);
    hud.radio.enqueue(COMPLAINT_WARN_BARK);
    const v = world.vehicle;
    const camera = { xM: v.xM, yM: v.yM, pxPerM: 16 };
    hud.draw(world, 480, camera);
    expect([hud.radioModel.visible, hud.radioModel.side]).toEqual([true, RadioSide.Home]);
    expect(hud.radioModel.panelX).toBe(HUD_MARGIN_PX);
    // The camera 4 m east of Bessie: she and the road ahead are left of centre (as when she drives west).
    camera.xM = v.xM + 4;
    hud.draw(world, 480, camera);
    expect(hud.radioModel.side).toBe(RadioSide.Away);
    expect(hud.radioModel.panelX + hud.radioModel.panelW).toBe(480 - HUD_MARGIN_PX);
    expect(hud.radioModel.panelY).toBe(RADIO_AWAY_Y + RADIO_TAB_H_PX);
    // Back over her: inside the hysteresis band, it stays away; 4 m west of her, it comes home.
    camera.xM = v.xM;
    hud.draw(world, 480, camera);
    expect(hud.radioModel.side).toBe(RadioSide.Away);
    camera.xM = v.xM - 4;
    hud.draw(world, 480, camera);
    expect(hud.radioModel.side).toBe(RadioSide.Home);
    expect(hud.radioModel.panelY).toBe(RADIO_HOME_Y + RADIO_TAB_H_PX);
  });
});

describe('the drawn panel (ART_BIBLE §12.2, §12.3)', () => {
  it('reserves both slots inside the margin, clear of every other HUD box, at every width', () => {
    for (const w of WIDTHS) {
      const l = hudLayout(font, w);
      expect(l.reserved.radioHome).toEqual({ x: 4, y: RADIO_HOME_Y, w: 204, h: RADIO_SLOT_H_PX });
      expect(l.reserved.radioAway).toEqual({ x: w - 208, y: RADIO_AWAY_Y, w: 204, h: RADIO_SLOT_H_PX });
      // Each in its own half of the frame, so moving it clears the half Bessie drives into.
      expect(l.reserved.radioHome.x + l.reserved.radioHome.w).toBeLessThanOrEqual(w / 2);
      expect(l.reserved.radioAway.x).toBeGreaterThanOrEqual(w / 2);
    }
  });

  it('draws the council panel, the PAM tab in 17 and the line in 07, only inside its slot', () => {
    expect(RADIO_TAB_W_PX).toBe(font.measure(RADIO_SPEAKER) - 1 + 4);
    const pages = hudSamplePages(font);
    expect(pages[0]?.runs.map((r) => [r.keycap, r.text])).toEqual([
      [false, 'Brush down with '],
      [true, 'Space'],
      [false, '. Takes'],
    ]);
    expect(barkPlainText(parseBark(HUD_SAMPLE_BARK), keyboard)).toBe(
      'Brush down with Space. Takes her a second to spin up.',
    );
    for (const w of [432, 480, 640]) {
      for (const side of [RadioSide.Home, RadioSide.Away]) {
        const m = side === RadioSide.Home ? hudSampleRadio(pages, w) : createRadioModel();
        if (side === RadioSide.Away) radioModel(pages[0] ?? null, pages[0]?.inkPx ?? 0, side, w, m);
        const raster = rasterRadio(m, w);
        const slot = side === RadioSide.Home ? radioSlots(w).home : radioSlots(w).away;
        for (const [x, y] of covered(raster)) expect(inRect(slot, x, y), `(${x}, ${y})`).toBe(true);
        // The panel: 00 outer, 07 inner, 26 fill; the tab above it: 00 border, 17 fill, 'PAM' in 00.
        const { panelX: px, panelY: py, panelW: pw } = m;
        expect([raster.at(px + 10, py), raster.at(px + 10, py + 1), raster.at(px + 10, py + 2)]).toEqual([
          INK,
          CHALK,
          COUNCIL_BLUE,
        ]);
        expect(raster.at(px + pw - 1, py + RADIO_PANEL_H_PX - 1), 'cut corner').toBe(-1);
        const tx = px + RADIO_TAB_INSET_PX;
        const ty = py - RADIO_TAB_H_PX;
        expect([
          raster.at(tx, ty),
          raster.at(tx + 1, ty),
          raster.at(tx, ty + 1),
          raster.at(tx + 1, ty + 1),
        ]).toEqual([-1, INK, INK, HIVIS]);
        const tab = new TextRaster(w, HUD_HEIGHT_PX, uiAtlas);
        font.draw(tab, RADIO_SPEAKER, tx + 2, ty + 2, INK);
        for (const [x, y] of covered(tab)) expect(raster.at(x, y)).toBe(INK);
      }
    }
  });

  it('draws in the one UI batch: a bark costs quads, not draw calls, and the busiest HUD fits the batch', () => {
    // The sink is the batch: every quad of the panel goes through add/addRegion, never another draw.
    let quads = 0;
    const counter = {
      add: (): void => {
        quads++;
      },
      addRegion: (): void => {
        quads++;
      },
    };
    const hud = new Hud(counter, font, DEFAULT_GLYPHS);
    const m = hudSampleRadio(hudSamplePages(font), 480);
    hud.drawModel(createHudModel(), 480, m);
    const withRadio = quads;
    quads = 0;
    hud.drawModel(createHudModel(), 480);
    expect(withRadio - quads).toBeLessThan(160);
    // The busiest HUD (hud_sample, every element at its widest) plus the widest panel with three keycaps fits the
    // HUD's one batch (ShiftScene HUD_CAPACITY).
    const widest = pageBark(parseBark(`{horn} {horn} {horn} ${'x'.repeat(24)}`), font, keyboard);
    expect(widest).toHaveLength(1);
    for (const w of [432, 480, 640]) {
      quads = 0;
      hud.drawModel(
        hudSampleModel(createHudModel(), hudLayout(font, w).arrowFrame),
        w,
        radioModel(widest[0] ?? null, RADIO_PAGE_MAX_INK_PX, RadioSide.Away, w, createRadioModel()),
      );
      expect(quads, `W = ${w}`).toBeLessThanOrEqual(HUD_CAPACITY);
    }
  });
});

describe('per-frame draw path source (acceptance: the radio panel allocates nothing per frame)', () => {
  const NEW_RE = /\bnew\s+[A-Za-z_$]/;
  const ARRAY_LITERAL_RE = /(?:[=(,]|\breturn)\s*\[/;
  const OBJECT_LITERAL_RE = /(?:[=(,]|\breturn)\s*\{/;

  it('src/ui/radio.ts', () => {
    const source = readFileSync(`${REPO_ROOT}src/ui/radio.ts`, 'utf8');
    const parts = source.split('// per-frame draw path: begin').slice(1);
    expect(parts.length, 'marked regions').toBe(2);
    for (const part of parts) {
      const end = part.indexOf('// per-frame draw path: end');
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
