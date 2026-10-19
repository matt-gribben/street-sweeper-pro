// The ground the shift's HUD can cover (SSP-070): each element's reserved box (src/ui/hud.ts hudLayout), in screen
// pixels and as sim-metre rects under a camera at (camX, camY) and the sweep height (1 texel = 1 px). Ground checks
// over shift frames (camera_follow, grimeReveal) leave these out, since the HUD draws over the ground there.
import { INTERNAL_HEIGHT_PX } from '../../src/render/upscale.ts';
import { HUD_FONT } from '../../src/scenes/ShiftScene.ts';
import { PX_PER_M } from '../../src/sim/constants.ts';
import { hudLayout } from '../../src/ui/hud.ts';
import type { Rect } from './groundReference.ts';
import { readBitmapFont } from './textRaster.ts';

/** The HUD's reserved boxes at internal width `widthPx`, as screen-pixel rects (x1, y1 exclusive). */
export function hudBoxesPx(widthPx: number): Rect[] {
  return Object.values(hudLayout(readBitmapFont(HUD_FONT), widthPx).reserved).map((b) => ({
    x0: b.x,
    y0: b.y,
    x1: b.x + b.w,
    y1: b.y + b.h,
  }));
}

/** The same boxes as sim-metre rects on the ground under a camera centred on (camX, camY) at the sweep height. */
export function hudCover(camX: number, camY: number, widthPx: number): Rect[] {
  return hudBoxesPx(widthPx).map((b) => ({
    x0: camX + (b.x0 - widthPx / 2) / PX_PER_M,
    y0: camY + (b.y0 - INTERNAL_HEIGHT_PX / 2) / PX_PER_M,
    x1: camX + (b.x1 - widthPx / 2) / PX_PER_M,
    y1: camY + (b.y1 - INTERNAL_HEIGHT_PX / 2) / PX_PER_M,
  }));
}
