// The shared, read-only asset registry (TECHNICAL_DESIGN §6.3, SSP-284). BootScene loads it once per page: every
// sprite atlas (spriteAtlas.ts loadAtlas, with its load-time Kerbside-32 check and FRAME check), every font's
// metrics (bitmapText.ts loadBitmapFont) and the palette pass's tables (palettePass.ts createPaletteTables: the
// 64³ OKLab LUT, the night/shadow remap and the palette textures). Later scenes read it through
// SceneContext.assets and never load, nor dispose, an atlas, a font or a table themselves: the registry owns them
// for the page's lifetime.
//
// The lists come from the generated table (src/gen/assets.ts): the atlases are the `atlas` of every FRAME entry,
// the fonts every `font.<name>` asset, so the M4 atlases and fonts join the boot load with no code change. All of
// them load in parallel, relative to `import.meta.env.BASE_URL` (the loaders' URL helpers), while the LUT is built.
// A load that fails (an HTTP error, a non-palette pixel, a stale FRAME table, bad metrics) rejects the whole load
// with an error naming the asset; the atlases that load anyway are released once every request has settled.
import { FRAME, type FrameId } from '../gen/assets.ts';
import {
  createPaletteTables,
  disposePaletteTables,
  KERBSIDE32,
  type Kerbside32,
  type PaletteTables,
} from '../render/palettePass.ts';
import {
  type AtlasName,
  type AtlasSource,
  browserAtlasSource,
  loadAtlas,
  type SpriteAtlas,
} from '../render/spriteAtlas.ts';
import { type BitmapFont, type FontJsonSource, loadBitmapFont } from '../ui/bitmapText.ts';

/** `font.<name>` → `<name>`, for every font asset of the generated table. */
type FontNameOf<T> = T extends `font.${infer Name}:${string}` ? Name : never;

/** Font names (the asset ID minus `font.`), derived from the generated table: `kerbside5x7` in M2. */
export type FontName = FontNameOf<FrameId>;

/** The registry later scenes read: every atlas and font, and the palette tables. Never written after boot. */
export type Assets = {
  /** Every atlas, by name, in ATLAS_NAMES order. */
  readonly atlases: ReadonlyMap<AtlasName, SpriteAtlas>;
  /** Every font, by name, in FONT_NAMES order. */
  readonly fonts: ReadonlyMap<FontName, BitmapFont>;
  /** The palette pass's LUT, remap and palette textures. */
  readonly palette: PaletteTables;
  /** The atlas called `name`; throws if the registry has none (a stale build). */
  atlas(name: AtlasName): SpriteAtlas;
  /** The font called `name`; throws if the registry has none. */
  font(name: FontName): BitmapFont;
};

function isAtlasName(name: string, names: ReadonlySet<string>): name is AtlasName {
  return names.has(name);
}

function collectAtlasNames(): AtlasName[] {
  const seen = new Set<string>();
  for (const frame of Object.values(FRAME)) seen.add(frame.atlas);
  const names: AtlasName[] = [];
  for (const name of [...seen].sort()) if (isAtlasName(name, seen)) names.push(name);
  return names;
}

const FONT_FRAME = /^font\.([a-z0-9_]+):/;

function isFontName(name: string, names: ReadonlySet<string>): name is FontName {
  return names.has(name);
}

function collectFontNames(): FontName[] {
  const seen = new Set<string>();
  for (const id of Object.keys(FRAME)) {
    const match = FONT_FRAME.exec(id);
    if (match?.[1] !== undefined) seen.add(match[1]);
  }
  const names: FontName[] = [];
  for (const name of [...seen].sort()) if (isFontName(name, seen)) names.push(name);
  return names;
}

/** Every atlas the generated table names, sorted: `actors`, `items`, `ui`, `world` in M2. */
export const ATLAS_NAMES: readonly AtlasName[] = Object.freeze(collectAtlasNames());

/** Every font the generated table names, sorted: `kerbside5x7` in M2. */
export const FONT_NAMES: readonly FontName[] = Object.freeze(collectFontNames());

/** Where the registry's files come from: the browser by default; tests inject file readers. */
export type AssetSources = {
  readonly atlas?: AtlasSource;
  readonly fontJson?: FontJsonSource;
  /** The palette the atlases are checked against and the tables are built for (default Kerbside-32). */
  readonly palette?: Kerbside32;
};

function releaseAtlas(atlas: SpriteAtlas): void {
  atlas.texture.dispose();
  atlas.swapTexture.dispose();
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Builds the registry from loaded parts. Throws if an atlas of ATLAS_NAMES or a font of FONT_NAMES is missing, or
 * a font draws from an atlas the registry does not hold. The maps are copied, so the registry never changes.
 */
export function createAssets(
  atlases: ReadonlyMap<AtlasName, SpriteAtlas>,
  fonts: ReadonlyMap<FontName, BitmapFont>,
  palette: PaletteTables,
): Assets {
  const atlasMap = new Map<AtlasName, SpriteAtlas>();
  for (const name of ATLAS_NAMES) {
    const atlas = atlases.get(name);
    if (atlas === undefined) throw new Error(`asset registry: atlas '${name}' was not loaded`);
    atlasMap.set(name, atlas);
  }
  const fontMap = new Map<FontName, BitmapFont>();
  for (const name of FONT_NAMES) {
    const font = fonts.get(name);
    if (font === undefined) throw new Error(`asset registry: font '${name}' was not loaded`);
    const drawsFrom = font.metrics.atlas;
    if (!ATLAS_NAMES.some((atlasName) => atlasName === drawsFrom)) {
      throw new Error(`asset registry: font '${name}' draws from atlas '${drawsFrom}', which is not loaded`);
    }
    fontMap.set(name, font);
  }
  return Object.freeze({
    atlases: atlasMap,
    fonts: fontMap,
    palette,
    atlas(name: AtlasName): SpriteAtlas {
      const atlas = atlasMap.get(name);
      if (atlas === undefined) throw new Error(`asset registry: no atlas '${name}'`);
      return atlas;
    },
    font(name: FontName): BitmapFont {
      const font = fontMap.get(name);
      if (font === undefined) throw new Error(`asset registry: no font '${name}'`);
      return font;
    },
  });
}

/**
 * Loads the registry: every atlas and font in parallel, and the palette tables (built while the fetches are in
 * flight). Rejects with an error naming the first asset that failed (`asset registry: atlas 'ui' failed to
 * load: …`, the loader's error as its `cause`); the atlases that load anyway are released once every request has settled.
 */
export async function loadAssets(sources: AssetSources = {}): Promise<Assets> {
  const palette = sources.palette ?? KERBSIDE32;
  const atlasSource = sources.atlas ?? browserAtlasSource;
  const atlasLoads = ATLAS_NAMES.map((name) =>
    loadAtlas(name, atlasSource, palette).catch((error: unknown) => {
      throw new Error(`asset registry: atlas '${name}' failed to load: ${messageOf(error)}`, {
        cause: error,
      });
    }),
  );
  const fontLoads = FONT_NAMES.map((name) =>
    (sources.fontJson === undefined ? loadBitmapFont(name) : loadBitmapFont(name, sources.fontJson)).catch(
      (error: unknown) => {
        throw new Error(`asset registry: font '${name}' failed to load: ${messageOf(error)}`, {
          cause: error,
        });
      },
    ),
  );
  let tables: PaletteTables | null = null;
  try {
    // The LUT build is synchronous (~30 ms): it runs while the requests above are in flight.
    tables = createPaletteTables(palette);
    const [atlasList, fontList] = await Promise.all([Promise.all(atlasLoads), Promise.all(fontLoads)]);
    const atlases = new Map<AtlasName, SpriteAtlas>();
    for (const atlas of atlasList) atlases.set(atlas.name, atlas);
    const fonts = new Map<FontName, BitmapFont>();
    fontList.forEach((font, i) => {
      const name = FONT_NAMES[i];
      if (name !== undefined) fonts.set(name, font);
    });
    return createAssets(atlases, fonts, tables);
  } catch (error: unknown) {
    // Fail fast with the first error; release the atlases that load anyway once every request has settled.
    void Promise.allSettled(atlasLoads).then((results) => {
      for (const result of results) if (result.status === 'fulfilled') releaseAtlas(result.value);
    });
    if (tables !== null) disposePaletteTables(tables);
    throw error;
  }
}
