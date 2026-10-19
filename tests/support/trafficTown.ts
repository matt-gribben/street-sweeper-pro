// Small compiled districts for the traffic tests (SSP-089): ASCII maps with a level.json `traffic` spec, run
// through the real level compiler (tools/levels/compile-level.ts), so the lane graph, its portals, junction
// connectors, zebra and bus-stop flags, the bus route and the moving-vehicle target are exactly what a shipped
// level would carry. The layout codes are skipped as in steeringTown.ts.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeLevel, type Level } from '../../src/sim/map.ts';
import { compileLevel, formatDiagnostic } from '../../tools/levels/compile-level.ts';
import { KERB_BLOB_PATH, readKerbBlob } from '../../tools/levels/kerbBlob.ts';
import type { LayoutCode } from '../../tools/levels/layoutChecks.ts';
import { townLevelText } from './steeringTown.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const KERB_BLOB = readKerbBlob(join(REPO_ROOT, KERB_BLOB_PATH));
const KNOWN = new Set(['roof.slate', 'roof.felt', 'facade.terrace_brick', 'facade.corner_shop']);
const LAYOUT_CODES: readonly LayoutCode[] = ['L014', 'L015', 'L020', 'L021', 'L022'];

/** The level.json `traffic` block (LEVEL_DESIGN §8.4). */
export type TownTraffic = {
  densityPerKm: number;
  mix: Record<string, number>;
  busRoute?: string[];
  busEveryS?: number;
  /** Parked cars (SSP-090): 0 and none unless given. */
  parkedFill?: number;
  parkedMix?: Record<string, number>;
  /** Pavement vehicles out at once (SSP-091): none unless given. */
  pavement?: Record<string, number>;
};

/**
 * The parking street (SSP-090), 64 × 7 tiles (128 × 14 m): terraces (rows 0 and 6), 1-tile pavements (rows 1
 * and 5) and a 3-tile two-way road (rows 2–4) running off the map at both ends, with two 10-cell runs of
 * parking bays `p` on its south row (columns 10–19 and 36–45, the westbound lane's kerb row): 10 bays of 2
 * tiles. Bessie's start is mid-road at column 30.
 */
export const PARKING_STREET: readonly string[] = [
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  '................................................................',
  '################################################################',
  '##############################@#################################',
  '##########pppppppppp################pppppppppp##################',
  '................................................................',
  'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
];

/**
 * The one-way high street, 60 × 7 tiles (120 × 14 m): terraces (rows 0 and 6), 1-tile pavements (rows 1 and 5)
 * and a 3-tile one-way eastbound road (rows 2–4) whose single lane runs along y = 7 m from the west portal
 * (x = 0) to the east one (x = 120). Bus stops on the north (left-hand) kerb at columns 10–13 and 40–43, a
 * 1-tile zebra at column 25 (lane edge 49 → 51 m), a dropped-kerb crossing at column 35, the bus route's
 * anchors 1 (column 5) and 2 (column 55), and Bessie's start at column 30 (centre (61, 7), facing east).
 */
export const ONE_WAY_STREET: readonly string[] = [
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  '...................................d........................',
  '>>>>>>>>>>bbbb>>>>>>>>>>>z>>>>>>>>>>>>>>bbbb>>>>>>>>>>>>>>>>',
  '>>>>>1>>>>>>>>>>>>>>>>>>>z>>>>@>>>>>>>>>>>>>>>>>>>>>>>2>>>>>',
  '>>>>>>>>>>>>>>>>>>>>>>>>>z>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>',
  '...................................d........................',
  'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
];

/**
 * The crossroads, 40 × 31 tiles (80 × 62 m): a two-way 3-tile road east–west (rows 14–16) and one north–south
 * (columns 18–20), each running off the map at both ends, crossing in a 3 × 3 junction, with 1-tile pavements
 * and terraces in the four blocks. Eight portals (an entry and an exit lane on each map edge), a junction box
 * in the middle, and Bessie's start on the east arm.
 */
export const CROSSROADS: readonly string[] = (() => {
  const rows: string[] = [];
  const w = 40;
  for (let y = 0; y < 31; y += 1) {
    let row = '';
    for (let x = 0; x < w; x += 1) {
      const roadNs = x >= 18 && x <= 20;
      const roadEw = y >= 14 && y <= 16;
      const paveNs = x === 17 || x === 21;
      const paveEw = y === 13 || y === 17;
      if (roadNs || roadEw) row += '#';
      else if (paveNs || paveEw) row += '.';
      else row += y < 14 ? 'A' : 'B';
    }
    rows.push(row);
  }
  const r = rows[15] as string;
  rows[15] = `${r.slice(0, 30)}@${r.slice(31)}`;
  return rows;
})();

/**
 * The parking crossroads (SSP-090): CROSSROADS with bays on all four arms' kerb rows, each 4 tiles clear of the
 * junction (LEVEL_DESIGN §7.4), so turning traffic, parked cars and Bessie meet at one junction.
 */
export const PARKING_CROSSROADS: readonly string[] = (() => {
  const rows = CROSSROADS.map((r) => r.split(''));
  const set = (x: number, y: number): void => {
    const row = rows[y] as string[];
    row[x] = 'p';
  };
  // West arm (row 16, the westbound lane's kerb row) and east arm (row 14, the eastbound lane's).
  for (let x = 4; x <= 11; x += 1) set(x, 16);
  for (let x = 26; x <= 33; x += 1) set(x, 14);
  // North arm (column 18, the northbound lane's kerb column) and south arm (column 20, southbound).
  for (let y = 3; y <= 8; y += 1) set(18, y);
  for (let y = 22; y <= 27; y += 1) set(20, y);
  return rows.map((r) => r.join(''));
})();

/**
 * The half-on-pavement street (SSP-091), 64 × 8 tiles (128 × 16 m): terraces (rows 0 and 7), a 2-tile pavement on
 * the north side (rows 1–2) and a 1-tile one on the south (row 6), and a 3-tile two-way road (rows 3–5) running off
 * the map at both ends, with a 10-cell run of bays on its north row (columns 10–19, the eastbound lane's kerb row,
 * beside the 2-tile pavement) and another on its south row (columns 36–45, the westbound lane's, beside the 1-tile
 * pavement): 5 bays each. Bessie's start is mid-road at column 30.
 */
export const HALF_ON_STREET: readonly string[] = [
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  '................................................................',
  '................................................................',
  '##########pppppppppp############################################',
  '##############################@#################################',
  '####################################pppppppppp##################',
  '................................................................',
  'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
];

/**
 * The long street (SSP-091), 90 × 7 tiles (180 × 14 m): PARKING_STREET's cross-section (terraces, 1-tile pavements,
 * a 3-tile two-way road whose lanes are 3 m apart) with no bays, for the bicycle filtering past a queue.
 * Bessie's start is mid-road at column 45.
 */
export const LONG_STREET: readonly string[] = [
  'A'.repeat(90),
  '.'.repeat(90),
  '#'.repeat(90),
  `${'#'.repeat(45)}@${'#'.repeat(44)}`,
  '#'.repeat(90),
  '.'.repeat(90),
  'B'.repeat(90),
];

/** Compile `rows` with the `traffic` block and decode it, as the game loads it. Throws on a diagnostic error. */
export function compileTrafficTown(rows: readonly string[], traffic: TownTraffic): Level {
  const level = JSON.parse(townLevelText(rows)) as Record<string, unknown>;
  if (rows.join('').includes('1')) level.anchors = { '1': 'route_start', '2': 'route_end' };
  level.traffic = { parkedFill: 0, parkedMix: {}, ...traffic };
  const result = compileLevel({
    name: 'steering',
    mapText: rows.map((r) => `${r}\n`).join(''),
    levelText: `${JSON.stringify(level, null, 2)}\n`,
    knownAssetIds: KNOWN,
    kerbBlob: KERB_BLOB,
    skipCodes: LAYOUT_CODES,
  });
  if (result.output === null) {
    throw new Error(`compileTrafficTown: ${result.diagnostics.map(formatDiagnostic).join('\n')}`);
  }
  return decodeLevel(result.output.text);
}
