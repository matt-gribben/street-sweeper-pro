// SSP-298: the asset zoo's pure layout (src/scenes/zooLayout.ts). The default view shows every actors/items asset in
// FRAME exactly once across its pages, in asset-ID order; `asset=<id>` shows every frame of that asset exactly once;
// cells never overlap, never cross a band edge and stay inside 480×270; every page opens with Bessie h00 for scale;
// an unknown asset or a page out of range falls back with an error naming it; cells cycle at 10 fps on the tick.
import { describe, expect, it } from 'vitest';
import { FRAME, type FrameId } from '../../src/gen/assets.ts';
import {
  ZOO_BAND_W_PX,
  ZOO_BANDS,
  ZOO_GAP_PX,
  ZOO_MARGIN_PX,
  ZOO_PAGE_H_PX,
  ZOO_PAGE_W_PX,
  ZOO_SCALE_FRAME,
  ZOO_TICKS_PER_FRAME,
  type ZooCell,
  type ZooFrameInfo,
  zooAssetsOf,
  zooCellFrame,
  zooLayout,
  zooLayoutOf,
  zooPagesOf,
} from '../../src/scenes/zooLayout.ts';

const FRAME_IDS = Object.keys(FRAME) as FrameId[];

/** Asset ID of a frame ID (everything before the first colon). */
function assetOf(frame: string): string {
  return frame.slice(0, frame.indexOf(':'));
}

/** Every actors/items asset in FRAME, worked out independently of the layout, in code-point order. */
const ZOO_ASSETS = [
  ...new Set(
    FRAME_IDS.filter((id) => FRAME[id].atlas === 'actors' || FRAME[id].atlas === 'items').map(assetOf),
  ),
].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** Every page of a view, through zooLayout's own `page` option. */
function allPages(asset: string | null): ZooCell[][] {
  const first = zooLayout(FRAME_IDS, { asset });
  expect(first.errors).toEqual([]);
  const pages: ZooCell[][] = [];
  for (let page = 0; page < first.pageCount; page++) {
    const layout = zooLayout(FRAME_IDS, { asset, page });
    expect(layout.errors).toEqual([]);
    expect(layout.page).toBe(page);
    pages.push([...layout.cells]);
  }
  return pages;
}

/** Cells of one page: inside the page, inside their band, apart from each other; Bessie first. */
function expectWellFormedPage(
  cells: readonly ZooCell<string>[],
  table: Readonly<Record<string, ZooFrameInfo>>,
): void {
  const scale = cells[0];
  expect(scale?.role).toBe('scale');
  expect(scale?.frame).toBe(ZOO_SCALE_FRAME);
  expect([scale?.x, scale?.y, scale?.band]).toEqual([ZOO_MARGIN_PX, ZOO_MARGIN_PX, 0]);
  expect(cells.filter((c) => c.role === 'scale')).toHaveLength(1);
  for (const cell of cells) {
    const f = table[cell.frame];
    if (f === undefined) throw new Error(`no frame ${cell.frame}`);
    // The cell is the frame plus the shadow/clearance gap.
    expect(cell.w).toBeGreaterThanOrEqual(f.w + ZOO_GAP_PX);
    expect(cell.h).toBeGreaterThanOrEqual(f.h + ZOO_GAP_PX);
    expect(cell.x).toBeGreaterThanOrEqual(0);
    expect(cell.y).toBeGreaterThanOrEqual(ZOO_MARGIN_PX);
    expect(cell.x + cell.w).toBeLessThanOrEqual(ZOO_PAGE_W_PX);
    expect(cell.y + cell.h).toBeLessThanOrEqual(ZOO_PAGE_H_PX);
    // Wholly on one ground band.
    expect(cell.x).toBeGreaterThanOrEqual(cell.band * ZOO_BAND_W_PX + ZOO_MARGIN_PX);
    expect(cell.x + cell.w).toBeLessThanOrEqual((cell.band + 1) * ZOO_BAND_W_PX);
    expect(Number.isInteger(cell.x) && Number.isInteger(cell.y)).toBe(true);
    expect(cell.cycle[cell.cycleIndex]).toBe(cell.frame);
  }
  for (let i = 0; i < cells.length; i++)
    for (let j = i + 1; j < cells.length; j++) {
      const a = cells[i];
      const b = cells[j];
      if (a === undefined || b === undefined) continue;
      const apart = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      if (!apart) throw new Error(`cells overlap: ${a.frame} and ${b.frame}`);
    }
}

describe('zooLayout: the default view', () => {
  it('shows every actors/items asset exactly once across its pages, ordered by asset ID', () => {
    expect(ZOO_ASSETS.length).toBeGreaterThan(20);
    const pages = allPages(null);
    const shown = pages.flatMap((cells) => cells.filter((c) => c.role === 'frame').map((c) => c.asset));
    expect(shown).toEqual(ZOO_ASSETS);
    expect(zooAssetsOf(FRAME_IDS, FRAME)).toEqual(ZOO_ASSETS);
    for (const cells of pages) expectWellFormedPage(cells, FRAME);
  });

  it('never shows a world, ui or fx frame (those are SSP-118)', () => {
    for (const cells of allPages(null))
      for (const cell of cells) expect(['actors', 'items']).toContain(FRAME[cell.frame].atlas);
  });

  it('picks the first state (idle or body first), S or h00 (or -), frame 0', () => {
    const cells = allPages(null).flat();
    const byAsset = new Map(cells.filter((c) => c.role === 'frame').map((c) => [c.asset, c]));
    expect(byAsset.get('veh.sweeper')?.frame).toBe('veh.sweeper:body:h00:0');
    expect(byAsset.get('veh.sweeper_brush')?.frame).toBe('veh.sweeper_brush:brush:h00:0');
    expect(byAsset.get('npc.old_woman')?.frame).toBe('npc.old_woman:idle:s:0');
    expect(byAsset.get('litter.banana_skin')?.frame).toBe('litter.banana_skin:idle:h00:0');
    expect(byAsset.get('pwr.flask_of_tea')?.frame).toBe('pwr.flask_of_tea:bob:-:0');
    expect(byAsset.get('prop.lamp_post')?.frame).toBe('prop.lamp_post:slice:-:0');
    for (const cell of byAsset.values()) {
      expect(cell.cycleIndex).toBe(0);
      expect(cell.frame.endsWith(':0')).toBe(true);
      // Its cycle is its (asset, state, direction) in frame-number order.
      const prefix = `${cell.asset}:${cell.state}:${cell.dir}:`;
      const group = FRAME_IDS.filter((id) => id.startsWith(prefix)).sort(
        (a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)),
      );
      expect(cell.cycle).toEqual(group);
    }
  });

  it('puts sprites on all three ground bands, and every shelf runs west to east through them', () => {
    const cells = zooLayout(FRAME_IDS, {}).cells;
    expect(new Set(cells.map((c) => c.band))).toEqual(new Set([0, 1, 2]));
    expect(ZOO_BANDS).toEqual(['asphalt', 'slab', 'grass']);
    expect(ZOO_BAND_W_PX * ZOO_BANDS.length).toBe(ZOO_PAGE_W_PX);
    // Placement order is reading order: along a shelf (same y), x and band never go back.
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1];
      const b = cells[i];
      if (a === undefined || b === undefined) continue;
      if (a.y === b.y) {
        expect(b.x).toBeGreaterThanOrEqual(a.x + a.w);
        expect(b.band).toBeGreaterThanOrEqual(a.band);
      } else {
        expect(b.y).toBeGreaterThan(a.y);
      }
    }
  });

  it('casts the +2,+2 drop shadow for every sprite but the brush overlay and the bay markings', () => {
    for (const cell of allPages(null).flat()) {
      expect(cell.castsShadow).toBe(cell.asset !== 'veh.sweeper_brush' && cell.asset !== 'site.depot_bay');
    }
  });
});

describe('zooLayout: asset=<id>', () => {
  it('places every veh.sweeper frame exactly once across its pages, Bessie h00 on every page', () => {
    const pages = allPages('veh.sweeper');
    expect(pages.length).toBeGreaterThan(1);
    const shown = pages.flatMap((cells) => cells.filter((c) => c.role === 'frame').map((c) => c.frame));
    const expected = FRAME_IDS.filter((id) => assetOf(id) === 'veh.sweeper');
    expect(expected).toHaveLength(64);
    expect([...shown].sort()).toEqual([...expected].sort());
    expect(new Set(shown).size).toBe(shown.length);
    for (const cells of pages) expectWellFormedPage(cells, FRAME);
    // One shelf per state: every body frame, by heading, then every dented frame, from a fresh shelf.
    expect(shown.slice(0, 32)).toEqual(
      Array.from({ length: 32 }, (_, h) => `veh.sweeper:body:h${String(h).padStart(2, '0')}:0`),
    );
    expect(shown.slice(32).every((id) => id.startsWith('veh.sweeper:dented:'))).toBe(true);
    const firstDented = pages.flat().find((c) => c.frame === 'veh.sweeper:dented:h00:0');
    expect([firstDented?.x, firstDented?.band]).toEqual([ZOO_MARGIN_PX, 0]);
    const layout = zooLayout(FRAME_IDS, { asset: 'veh.sweeper', page: 1 });
    expect([layout.view, layout.asset, layout.page]).toEqual(['asset', 'veh.sweeper', 1]);
  });

  it('places every frame of every zoo asset exactly once, directions in S, SW, W ... order', () => {
    for (const asset of ZOO_ASSETS) {
      const pages = allPages(asset);
      const shown = pages.flatMap((cells) => cells.filter((c) => c.role === 'frame').map((c) => c.frame));
      const expected = FRAME_IDS.filter((id) => assetOf(id) === asset);
      expect([...shown].sort()).toEqual([...expected].sort());
      expect(new Set(shown).size).toBe(shown.length);
      for (const cells of pages) expectWellFormedPage(cells, FRAME);
    }
    const doris = allPages('npc.old_woman')
      .flat()
      .filter((c) => c.role === 'frame');
    expect(doris.map((c) => c.dir)).toEqual(['s', 'sw', 'w', 'nw', 'n', 'ne', 'e', 'se']);
  });
});

describe('zooLayout: fallbacks', () => {
  it('shows the default layout plus an error naming an unknown asset ID', () => {
    const fallback = zooLayout(FRAME_IDS, { asset: 'npc.nobody' });
    const plain = zooLayout(FRAME_IDS, {});
    expect(fallback.view).toBe('default');
    expect(fallback.asset).toBeNull();
    expect(fallback.cells).toEqual(plain.cells);
    expect(fallback.pageCount).toBe(plain.pageCount);
    expect(fallback.errors).toHaveLength(1);
    expect(fallback.errors[0]).toContain("'npc.nobody'");
    expect(plain.errors).toEqual([]);
    // An asset with frames only in another atlas is unknown to the M3 zoo too.
    const tile = zooLayout(FRAME_IDS, { asset: 'tile.asphalt' });
    expect(tile.view).toBe('default');
    expect(tile.errors[0]).toContain("'tile.asphalt'");
  });

  it('shows page 0 plus an error for a page past the last', () => {
    const layout = zooLayout(FRAME_IDS, { asset: 'veh.sweeper', page: 99 });
    expect(layout.page).toBe(0);
    expect(layout.cells).toEqual(zooLayout(FRAME_IDS, { asset: 'veh.sweeper' }).cells);
    expect(layout.errors).toEqual([
      `zoo: page 99 is out of range (0..${layout.pageCount - 1}); showing page 0`,
    ]);
  });
});

/** A synthetic frame table: Bessie h00 plus `count` 16×16 items assets, and one world frame. */
function syntheticTable(count: number): Record<string, ZooFrameInfo> {
  const table: Record<string, ZooFrameInfo> = { [ZOO_SCALE_FRAME]: { atlas: 'actors', w: 64, h: 64 } };
  for (let i = 0; i < count; i++) {
    const id = `litter.item_${String(i).padStart(3, '0')}`;
    table[`${id}:idle:h00:0`] = { atlas: 'items', w: 16, h: 16 };
    table[`${id}:wobble:h00:0`] = { atlas: 'items', w: 16, h: 16 };
  }
  table['tile.asphalt:v:-:0'] = { atlas: 'world', w: 32, h: 32 };
  return table;
}

describe('zooLayout: paging', () => {
  it('pages the default view when it overflows 480×270, each asset once, in order', () => {
    const table = syntheticTable(600);
    const ids = Object.keys(table);
    const pages = zooPagesOf(ids, null, table);
    expect(pages.length).toBeGreaterThan(2);
    const shown = pages.flatMap((cells) => cells.filter((c) => c.role === 'frame').map((c) => c.asset));
    expect(shown).toEqual(zooAssetsOf(ids, table));
    expect(shown).not.toContain('tile.asphalt');
    for (const cells of pages) expectWellFormedPage(cells, table);
    const last = zooLayoutOf(ids, { page: pages.length - 1 }, table);
    expect(last.cells).toEqual(pages[pages.length - 1]);
  });

  it('refuses a frame too big for a band, naming it', () => {
    const table: Record<string, ZooFrameInfo> = {
      [ZOO_SCALE_FRAME]: { atlas: 'actors', w: 64, h: 64 },
      'veh.blimp:body:h00:0': { atlas: 'actors', w: 200, h: 64 },
    };
    expect(() => zooLayoutOf(Object.keys(table), {}, table)).toThrow(/veh\.blimp:body:h00:0/);
  });
});

describe('zooCellFrame', () => {
  it('cycles a cell within its state at 10 fps: frame floor(tick / 6) mod count', () => {
    expect(ZOO_TICKS_PER_FRAME).toBe(6);
    // Searched across the default view's pages: which page holds it depends on how many assets sort before it.
    const brush = allPages(null)
      .flat()
      .find((c) => c.asset === 'veh.sweeper_brush');
    if (brush === undefined) throw new Error('no brush cell');
    const shown = [0, 5, 6, 11, 12, 18, 24, 30].map((tick) => zooCellFrame(brush, tick));
    expect(shown).toEqual([
      'veh.sweeper_brush:brush:h00:0',
      'veh.sweeper_brush:brush:h00:0',
      'veh.sweeper_brush:brush:h00:1',
      'veh.sweeper_brush:brush:h00:1',
      'veh.sweeper_brush:brush:h00:2',
      'veh.sweeper_brush:brush:h00:3',
      'veh.sweeper_brush:brush:h00:0',
      'veh.sweeper_brush:brush:h00:1',
    ]);
    const bessie = zooLayout(FRAME_IDS, {}).cells[0];
    if (bessie === undefined) throw new Error('no scale cell');
    expect(zooCellFrame(bessie, 1234)).toBe(ZOO_SCALE_FRAME);
  });

  it('starts each asset-view cell on its own frame, so every frame shows at tick 0', () => {
    const cells = allPages('veh.sweeper_brush')
      .flat()
      .filter((c) => c.role === 'frame');
    for (const cell of cells) {
      expect(zooCellFrame(cell, 0)).toBe(cell.frame);
      expect(zooCellFrame(cell, ZOO_TICKS_PER_FRAME)).toBe(
        cell.cycle[(cell.cycleIndex + 1) % cell.cycle.length],
      );
    }
  });
});
