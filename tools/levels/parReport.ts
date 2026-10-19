// The par report (LEVEL_DESIGN §10.4): the one-screen summary `npm run levels` prints for every level it
// compiles, which the author pastes into the merge message. Pure formatting: the compiler (compile-level.ts)
// works out the numbers. Deterministic: digits are grouped by hand, never with the locale.
//
// As built (SSP-077): the header, route/grime/litter, dumps, frontages, peak and warnings lines. The par
// estimate lines (`par (stock): …`, `grime density along par route`) need the M6 par solver (SSP-190), and the
// Skip Run course lines are SSP-190's too.
import { NPC_BUDGET, VEHICLE_BUDGET } from './spawnSpecs.ts';

/** The numbers of one level's par report. A null value is a level without that spec (or source). */
export type ParReport = {
  id: string;
  size: readonly [number, number];
  seed: number;
  routeTiles: number;
  grimeCells: number | null;
  gutterCells: number | null;
  litter: number | null;
  dynamicLitter: number;
  /** Expected litter units of the initial and dynamic litter, or null without a litter table. */
  litterLu: number | null;
  depotBays: number;
  skips: number;
  hydrants: number;
  /** Farthest route tile from a dump site / water source, metres (path), or null without any. */
  maxDumpM: number | null;
  maxWaterM: number | null;
  frontages: number;
  pledges: number;
  peakNpc: number;
  peakVehicles: number;
  /** Codes of the warnings the level compiled with. */
  warnings: string[];
};

/** `1264` → `1,264`. */
export function groupDigits(n: number): string {
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(Math.round(n)));
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += ',';
    out += digits[i];
  }
  return sign + out;
}

/** The report's lines, without trailing whitespace. */
export function formatParReport(r: ParReport): string[] {
  const grime =
    r.grimeCells === null
      ? 'grime none'
      : `grime ${groupDigits(r.grimeCells)} cells (gutter ${(r.grimeCells > 0 ? ((r.gutterCells ?? 0) / r.grimeCells) * 100 : 0).toFixed(1)}%)`;
  const litter =
    r.litter === null
      ? 'litter none'
      : `litter ${groupDigits(r.litter)} (+${groupDigits(r.dynamicLitter)} dyn)${r.litterLu === null ? '' : ` ≈ ${groupDigits(r.litterLu)} LU`}`;
  const metres = (m: number | null): string => (m === null ? 'n/a' : `${groupDigits(m)} m`);
  return [
    `${r.id}  ${r.size[0]}x${r.size[1]}  seed ${r.seed}`,
    `  route area      ${groupDigits(r.routeTiles)} tiles   ${grime}   ${litter}`,
    `  dumps: depot ${r.depotBays} bays, skips ${r.skips}   hydrants ${r.hydrants}   max dump dist ${metres(r.maxDumpM)}   max water dist ${metres(r.maxWaterM)}`,
    `  frontages ${r.frontages}   pledges ${r.pledges}`,
    `  peak NPC ${r.peakNpc}/${NPC_BUDGET}   peak vehicles ${r.peakVehicles}/${VEHICLE_BUDGET}`,
    `  warnings: ${r.warnings.length === 0 ? 'none' : r.warnings.join(', ')}`,
  ];
}
