// Zero allocation per frame for panels and buttons (SSP-285; TECHNICAL_DESIGN §17 procedure, tests/support/heapDelta.ts):
// UiSpriteBatch.begin, the three panel styles at changing sizes and the four button states with labels, end.
//
// A file of its own, like bitmapTextHeap.test.ts: Vitest runs each file in a fresh process, so the JIT sees only the
// UiSpriteBatch sink (panels.test.ts's recording sinks would make the sink call sites polymorphic).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { loadAtlas, type RgbaImage } from '../../src/render/spriteAtlas.ts';
import { UiSpriteBatch } from '../../src/render/spriteBatch.ts';
import { ButtonState, PanelStyle, Panels, type UiRect } from '../../src/ui/panels.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';
import { decodePng } from '../support/png.ts';
import { readBitmapFont } from '../support/textRaster.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Frames run before measuring, so the draw path is optimised (as in bitmapTextHeap.test.ts). */
const WARMUP_FRAMES = 20_000;

it('allocates nothing per frame: begin, three panels and four buttons, end', async () => {
  const atlas = await loadAtlas('ui', {
    fetchJson: async (url: string): Promise<unknown> =>
      JSON.parse(readFileSync(`${REPO_ROOT}public${url}`, 'utf8')),
    fetchImage: async (url: string): Promise<RgbaImage> =>
      decodePng(readFileSync(`${REPO_ROOT}public${url}`)),
  });
  const font = readBitmapFont('kerbside5x7');
  const batch = new UiSpriteBatch(atlas, 1024);
  const panels = new Panels(batch, font);
  const styles = [PanelStyle.Council, PanelStyle.Paper, PanelStyle.Dark] as const;
  const states = [ButtonState.Normal, ButtonState.Focus, ButtonState.Pressed, ButtonState.Disabled] as const;
  const labels = ['RESUME', 'RESTART', 'CONTROLS', 'RETIRE'];
  const rects: UiRect[] = labels.map((_, i) => ({ x: 180, y: 120 + i * 20, w: 97, h: 17 }));
  const delta = measureHeapDelta(
    (tick) => {
      batch.begin();
      for (let i = 0; i < styles.length; i++) {
        const style = styles[i] ?? PanelStyle.Council;
        panels.drawPanel(style, 4 + i * 8, 4 + (tick & 3), 61 + ((tick + i) & 15), 19 + (tick & 31));
      }
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        if (rect === undefined) continue;
        panels.drawButton(states[(tick + i) & 3] ?? ButtonState.Normal, rect, labels[i] ?? '');
      }
      batch.end();
    },
    { warmupTicks: WARMUP_FRAMES },
  );
  assertHeapDeltaWithinThresholds(delta);
  expect(batch.count).toBeGreaterThan(100);
  batch.dispose();
});
