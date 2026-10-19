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
};

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
