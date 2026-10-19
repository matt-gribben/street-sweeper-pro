// The asset registry (src/app/assetRegistry.ts, SSP-284) loaded from the checkout's committed outputs without a
// browser: atlas PNGs decoded by tests/support/png.ts (exactly as a browser decodes them), atlas JSON and font
// metrics read from `public/`. Scene tests put it on their fake SceneContext as `assets`, as BootScene does in the
// game. `checkoutAssets()` loads it once per test file (the registry is read-only, so tests can share it).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type AssetSources, type Assets, loadAssets } from '../../src/app/assetRegistry.ts';
import type { RgbaImage } from '../../src/render/spriteAtlas.ts';
import { decodePng } from './png.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** `/assets/…` (the URL under vitest's base `/`) → the checkout file `public/assets/…`. */
function publicPath(url: string): string {
  return `${REPO_ROOT}public/${url.replace(/^\.?\//, '')}`;
}

/** Sources that serve the checkout's files and log every URL they are asked for into `requests` (when given). */
export function checkoutSources(requests?: string[]): AssetSources {
  return {
    atlas: {
      fetchJson: async (url: string): Promise<unknown> => {
        requests?.push(url);
        return JSON.parse(readFileSync(publicPath(url), 'utf8'));
      },
      fetchImage: async (url: string): Promise<RgbaImage> => {
        requests?.push(url);
        return decodePng(readFileSync(publicPath(url)));
      },
    },
    fontJson: async (url: string): Promise<unknown> => {
      requests?.push(url);
      return JSON.parse(readFileSync(publicPath(url), 'utf8'));
    },
  };
}

let shared: Promise<Assets> | null = null;

/** The registry over the checkout's committed atlases and fonts, loaded once per test file. */
export function checkoutAssets(): Promise<Assets> {
  shared ??= loadAssets(checkoutSources());
  return shared;
}

/**
 * A view of `assets` that records every atlas and font a scene looks up (`atlas:<name>`, `font:<name>`) into
 * `lookups`, so a test can tell what a scene takes from the registry.
 */
export function recordingAssets(assets: Assets, lookups: string[]): Assets {
  return {
    atlases: assets.atlases,
    fonts: assets.fonts,
    palette: assets.palette,
    atlas(name) {
      lookups.push(`atlas:${name}`);
      return assets.atlas(name);
    },
    font(name) {
      lookups.push(`font:${name}`);
      return assets.font(name);
    },
  };
}
