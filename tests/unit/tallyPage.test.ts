// SSP-071: the intro card (src/ui/introCard.ts) and the numbers-only tally page (src/ui/tallyPage.ts) as pure
// layouts: formatting, the figures taken from a SimSnapshot, focus stepping, and that every quad lands inside its
// panel at the narrowest, base and widest internal widths (rasterised on the CPU from the real ui atlas).
import { describe, expect, it } from 'vitest';
import type { SimSnapshot } from '../../src/sim/snapshot.ts';
import { TextVariant } from '../../src/ui/bitmapText.ts';
import {
  districtDisplayName,
  INTRO_BRIEFING,
  IntroStatus,
  introCardLayout,
  introPrompt,
} from '../../src/ui/introCard.ts';
import { ButtonState, Panels } from '../../src/ui/panels.ts';
import {
  formatCount,
  formatFraction,
  formatTidyPercent,
  STAR,
  TallyButton,
  tallyButtonRects,
  tallyButtonStates,
  tallyFigures,
  tallyPageLayout,
} from '../../src/ui/tallyPage.ts';
import { drawUiItems, type UiItem, uiItemStrings } from '../../src/ui/uiItems.ts';
import { readBitmapFont, readIndexedAtlas, TextRaster } from '../support/textRaster.ts';

const font = readBitmapFont('kerbside5x7');
const HEIGHT = 270;
const WIDTHS = [432, 480, 640];

function snapshot(overrides: Partial<SimSnapshot> = {}): SimSnapshot {
  return {
    tick: 14_581,
    bessie: { x: 7, y: 70, heading: 0, speed: 0 },
    hp: 100,
    score: 12_450,
    tidy: 0.4735,
    stars: 0,
    hopper: { lu: 10, capacityLu: 100, full: false },
    water: { units: 50, capacity: 100 },
    combo: { chain: 0, multiplier: 1, timerTicks: 0, bestChain: 4 },
    litter: { spawned: 130, collected: 12 },
    grime: { initial: 9000, cleaned: 300 },
    frontages: [],
    npcs: [],
    shift: { phase: 'ended', ticksRemaining: 0, endReason: 'time_up', endTick: 14_580 },
    ...overrides,
  };
}

/** Rasterises `items` at `width` and returns the pixels painted outside the first (panel) item. */
function paintedOutsidePanel(items: readonly UiItem[], width: number): number {
  const raster = new TextRaster(width, HEIGHT, readIndexedAtlas('ui'));
  drawUiItems(new Panels(raster, font), items);
  const panel = items[0];
  if (panel?.kind !== 'panel') throw new Error('the first item is not the panel');
  let outside = 0;
  let inside = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < width; x++) {
      if (raster.at(x, y) < 0) continue;
      const within = x >= panel.x && x < panel.x + panel.w && y >= panel.y && y < panel.y + panel.h;
      if (within) inside++;
      else outside++;
    }
  }
  // The panel is opaque, bar the council panel's four cut corner pixels (ART_BIBLE §12.3).
  expect(inside).toBeGreaterThanOrEqual(panel.w * panel.h - 4);
  return outside;
}

describe('formatting', () => {
  it('formats counts with thousands separators', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(999)).toBe('999');
    expect(formatCount(1000)).toBe('1,000');
    expect(formatCount(12_450)).toBe('12,450');
    expect(formatCount(1_234_567)).toBe('1,234,567');
    expect(formatCount(-1200)).toBe('-1,200');
    expect(formatCount(41.6)).toBe('42');
    expect(formatFraction(300, 9000)).toBe('300 / 9,000');
  });

  it('formats Tidy % with one decimal', () => {
    expect(formatTidyPercent(0)).toBe('0.0%');
    expect(formatTidyPercent(0.4735)).toBe('47.4%');
    expect(formatTidyPercent(0.018667)).toBe('1.9%');
    expect(formatTidyPercent(0.92)).toBe('92.0%');
    expect(formatTidyPercent(1)).toBe('100.0%');
  });
});

describe('tally figures', () => {
  it('reads the end reason, Tidy %, items, grime, score and would-be stars from the snapshot', () => {
    expect(tallyFigures(snapshot({ stars: 2 }), 'PUDDLE LANE')).toEqual({
      reason: 'TIME UP!',
      towed: false,
      district: 'PUDDLE LANE',
      tidy: '47.4%',
      items: '12 / 130',
      grime: '300 / 9,000',
      score: '12,450',
      stars: 2,
    });
    const towed = snapshot({
      shift: { phase: 'ended', ticksRemaining: 900, endReason: 'towed', endTick: 13_000 },
    });
    expect(tallyFigures(towed, 'PUDDLE LANE')).toMatchObject({ reason: 'TOWED!', towed: true });
  });

  it('refuses a shift that has not ended', () => {
    const running = snapshot({
      shift: { phase: 'running', ticksRemaining: 900, endReason: null, endTick: -1 },
    });
    expect(() => tallyFigures(running, 'PUDDLE LANE')).toThrow(/has not ended/);
  });
});

describe('tally page layout', () => {
  it.each(WIDTHS)('fits every quad inside the paper panel, centred, at W = %i', (width) => {
    const items = tallyPageLayout(
      font,
      width,
      HEIGHT,
      tallyFigures(snapshot({ stars: 3 }), 'PUDDLE LANE'),
      tallyButtonStates(TallyButton.TryAgain),
    );
    const panel = items[0];
    if (panel?.kind !== 'panel') throw new Error('no panel');
    expect(panel.x * 2 + panel.w).toBeGreaterThanOrEqual(width - 1);
    expect(panel.x * 2 + panel.w).toBeLessThanOrEqual(width);
    expect(paintedOutsidePanel(items, width)).toBe(0);
  });

  it('shows the figures in order, with Try Again focused, and Back to Briefing pressed once picked', () => {
    const figures = tallyFigures(snapshot({ stars: 1 }), 'PUDDLE LANE');
    const items = tallyPageLayout(font, 480, HEIGHT, figures, tallyButtonStates(TallyButton.TryAgain));
    expect(uiItemStrings(items)).toEqual([
      'TIME UP!',
      'PUDDLE LANE',
      'TIDY',
      '47.4%',
      'ITEMS COLLECTED',
      '12 / 130',
      'GRIME CLEANED',
      '300 / 9,000',
      'SCORE',
      '12,450',
      'STARS',
      STAR,
      STAR,
      STAR,
      'TRY AGAIN',
      'BACK TO BRIEFING',
    ]);
    const buttons = items.filter((item) => item.kind === 'button');
    expect(buttons.map((b) => b.state)).toEqual([ButtonState.Focus, ButtonState.Normal]);
    const picked = tallyPageLayout(
      font,
      480,
      HEIGHT,
      figures,
      tallyButtonStates(TallyButton.BackToBriefing, true),
    );
    expect(picked.filter((item) => item.kind === 'button').map((b) => b.state)).toEqual([
      ButtonState.Normal,
      ButtonState.Pressed,
    ]);
  });

  it('lays the buttons out at the rects the menu hit-tests, in the states it is given', () => {
    const figures = tallyFigures(snapshot(), 'PUDDLE LANE');
    for (const width of WIDTHS) {
      const rects = tallyButtonRects(font, width, HEIGHT);
      const states = [ButtonState.Disabled, ButtonState.Pressed];
      const buttons = tallyPageLayout(font, width, HEIGHT, figures, states).filter(
        (i) => i.kind === 'button',
      );
      expect(buttons.map((b) => b.rect)).toEqual(rects);
      expect(buttons.map((b) => b.state)).toEqual(states);
      expect(rects[1]?.y).toBeGreaterThan((rects[0]?.y ?? 0) + (rects[0]?.h ?? 0)); // no overlap
    }
  });

  it.each([0, 1, 2, 3])('draws %i earned stars outlined in 15 and the rest plain in 04', (stars) => {
    const items = tallyPageLayout(
      font,
      480,
      HEIGHT,
      tallyFigures(snapshot({ stars }), 'X'),
      tallyButtonStates(0),
    );
    const starItems = items.filter((item) => item.kind === 'text' && item.text === STAR);
    expect(starItems).toHaveLength(3);
    const looks = starItems.map((item) => (item.kind === 'text' ? [item.colour, item.variant] : []));
    for (let i = 0; i < 3; i++) {
      expect(looks[i]).toEqual(i < stars ? [15, TextVariant.Outline] : [4, TextVariant.Plain]);
    }
  });

  it('heads a TOWED shift in 18 postbox red, TIME UP in 00 ink', () => {
    const towed = snapshot({
      shift: { phase: 'ended', ticksRemaining: 900, endReason: 'towed', endTick: 13_000 },
    });
    const header = (s: SimSnapshot) =>
      tallyPageLayout(font, 480, HEIGHT, tallyFigures(s, 'X'), tallyButtonStates(0))[1];
    expect(header(towed)).toMatchObject({ kind: 'text', text: 'TOWED!', colour: 18 });
    expect(header(snapshot())).toMatchObject({ kind: 'text', text: 'TIME UP!', colour: 0 });
  });
});

describe('intro card', () => {
  it('names the district from its ID', () => {
    expect(districtDisplayName('district.puddle_lane')).toBe('PUDDLE LANE');
    expect(districtDisplayName('district.kebab_mile')).toBe('KEBAB MILE');
  });

  it.each([
    [IntroStatus.Loading, 'Loading...', 16],
    [IntroStatus.Ready, 'Press Space to start', 16],
    [IntroStatus.Failed, 'Level failed to load', 18],
  ])('shows the district, the briefing and the prompt for status %i', (status, prompt, colour) => {
    const items = introCardLayout(font, 480, HEIGHT, 'district.puddle_lane', status);
    expect(uiItemStrings(items)).toEqual(['PUDDLE LANE', INTRO_BRIEFING, prompt]);
    expect(introPrompt(status)).toBe(prompt);
    expect(items[3]).toMatchObject({ kind: 'text', colour });
  });

  it("names the active device's select control in the ready prompt (SSP-286)", () => {
    const items = introCardLayout(font, 480, HEIGHT, 'district.puddle_lane', IntroStatus.Ready, 'A');
    expect(uiItemStrings(items)[2]).toBe('Press A to start');
    expect(introPrompt(IntroStatus.Loading, 'A')).toBe('Loading...');
  });

  it.each(WIDTHS)('fits every quad inside the council panel, centred, at W = %i', (width) => {
    const items = introCardLayout(font, width, HEIGHT, 'district.puddle_lane', IntroStatus.Ready);
    const panel = items[0];
    if (panel?.kind !== 'panel') throw new Error('no panel');
    expect(panel.x).toBeGreaterThanOrEqual(4);
    expect(panel.x * 2 + panel.w).toBeGreaterThanOrEqual(width - 1);
    expect(paintedOutsidePanel(items, width)).toBe(0);
  });
});
