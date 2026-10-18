// assets-src/STYLE.md v1 (SSP-026) mirror checks. kerbside32.json is the truth for colour values and the
// night/shadow remaps (CLAUDE.md §2), ENTITY_CATALOG §9 carries the locked prop slice counts, and ART_BIBLE
// mirrors STYLE.md's locked numbers. These tests keep the three from drifting apart.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (path: string): string => readFileSync(`${REPO_ROOT}${path}`, 'utf8');

const STYLE = read('assets-src/STYLE.md');
const ART_BIBLE = read('docs/ART_BIBLE.md');
const CATALOG = read('docs/ENTITY_CATALOG.md');

interface PaletteFile {
  colors: { name: string; hex: string }[];
  night: number[];
  shadow: number[];
}

function loadPalette(): PaletteFile {
  const raw: unknown = JSON.parse(read('assets-src/palette/kerbside32.json'));
  if (typeof raw !== 'object' || raw === null) throw new Error('kerbside32.json is not an object');
  const { colors, night, shadow } = raw as Record<string, unknown>;
  const isIndexList = (v: unknown): v is number[] =>
    Array.isArray(v) && v.length === 32 && v.every((n) => Number.isInteger(n));
  const isColours = (v: unknown): v is PaletteFile['colors'] =>
    Array.isArray(v) &&
    v.length === 32 &&
    v.every((c) => typeof c === 'object' && c !== null && typeof (c as { hex?: unknown }).hex === 'string');
  if (!isColours(colors) || !isIndexList(night) || !isIndexList(shadow)) {
    throw new Error('kerbside32.json does not have 32 colours, night[32] and shadow[32]');
  }
  return { colors, night, shadow };
}

const PALETTE = loadPalette();

/** The STYLE.md §3 summary row that starts with `label`, as numbers. */
function remapRow(label: string): number[] {
  const line = STYLE.split('\n').find((l) => l.startsWith(`${label} `));
  if (line === undefined) throw new Error(`STYLE.md has no "${label}" row in its remap summary`);
  return line
    .slice(label.length)
    .trim()
    .split(/\s+/)
    .map((cell) => Number.parseInt(cell, 10));
}

/** {prop id: slices} from a markdown table whose row matches `row`. */
function sliceCounts(text: string, row: RegExp): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split('\n')) {
    const m = row.exec(line);
    if (m?.[1] !== undefined && m[2] !== undefined) out.set(m[1], Number.parseInt(m[2], 10));
  }
  return out;
}

describe('assets-src/STYLE.md', () => {
  it('is marked with a version and a date', () => {
    expect(STYLE).toMatch(/^\*\*Version: v\d+(\.\d+)?, \d{4}-\d{2}-\d{2}\*\*/m);
  });

  it('uses only hex values that are in kerbside32.json', () => {
    const legal = new Set(PALETTE.colors.map((c) => c.hex.toLowerCase()));
    const hexes = STYLE.match(/#[0-9a-fA-F]{6}\b/g) ?? [];
    expect(hexes.length).toBeGreaterThan(0);
    for (const hex of hexes) expect(legal, hex).toContain(hex.toLowerCase());
  });

  it('summarises the night and shadow remaps exactly as kerbside32.json holds them', () => {
    expect(remapRow('idx')).toEqual(Array.from({ length: 32 }, (_, i) => i));
    expect(remapRow('night')).toEqual(PALETTE.night);
    expect(remapRow('shadow')).toEqual(PALETTE.shadow);
  });

  it('locks the same prop slice counts as ENTITY_CATALOG §9', () => {
    const style = sliceCounts(STYLE, /^\| `(prop\.[a-z_]+)` \|.*\| \*\*(\d+)\*\* \|$/);
    const catalog = sliceCounts(CATALOG, /^\| `(prop\.[a-z_]+)` \|.*\| stack \((\d+)\) \|/);
    expect(style.size).toBeGreaterThan(0);
    expect(Object.fromEntries(catalog)).toEqual(Object.fromEntries(style));
    for (const n of style.values()) expect([4, 8]).toContain(n);
  });

  it('states the locked look values that ART_BIBLE also states', () => {
    const plain = (text: string): string => text.replaceAll('*', '');
    const style = plain(STYLE);
    const bible = plain(ART_BIBLE);
    const locked = [
      '16 px per metre',
      '32×32 px',
      '2.5 m = 40 px',
      '32×40 px',
      '480×270',
      '28×52',
      '96×96',
      '24×24',
      '18×22',
      '12×12',
      'azimuth 315°',
      'elevation 50°',
      '0.84 × height',
      '+2, +2 px',
      'radius 5 m',
      '0.33–0.83',
      '×0.5',
      '×1.5',
      '0.9048',
      '112e30d9',
    ];
    for (const value of locked) {
      expect(style, `STYLE.md: ${value}`).toContain(value);
      expect(bible, `ART_BIBLE.md: ${value}`).toContain(value);
    }
  });
});
