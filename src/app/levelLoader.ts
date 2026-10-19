// Loads a compiled level in the browser (TECHNICAL_DESIGN §6.3, §15): `public/assets/levels/<name>.json`, fetched
// relative to the app base and decoded by src/sim/map.ts (which range-checks every field and layer), so a stale or
// malformed file fails at load rather than drawing garbage. `level_preview` (SSP-045) uses it; ShiftScene
// (SSP-046) loads its district the same way.
import { decodeLevel, type Level } from '../sim/map.ts';

/** District file names (`district.<name>` → `<name>`): snake_case only, so the name cannot escape the folder. */
const LEVEL_NAME = /^[a-z][a-z0-9_]*$/;

/** URL of a compiled level, relative to the app base (`import.meta.env.BASE_URL`). */
export function levelUrl(name: string, base: string = import.meta.env.BASE_URL): string {
  if (!LEVEL_NAME.test(name)) throw new Error(`level name '${name}' is not snake_case`);
  return `${base}assets/levels/${name}.json`;
}

/** Fetches JSON text; injectable so tests can load fixtures without a browser. */
export type LevelSource = (url: string) => Promise<string>;

/** The browser source: fetch, failing on an HTTP error. */
export const browserLevelSource: LevelSource = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`level fetch ${url}: HTTP ${response.status}`);
  return response.text();
};

/** Loads and decodes compiled level `<name>` (for example `puddle_lane`). */
export async function loadLevel(name: string, source: LevelSource = browserLevelSource): Promise<Level> {
  const url = levelUrl(name);
  try {
    return decodeLevel(await source(url));
  } catch (error: unknown) {
    throw new Error(`level ${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
