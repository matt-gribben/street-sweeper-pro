// Zero allocation per frame for bitmap text (SSP-069; TECHNICAL_DESIGN §17 procedure, tests/support/heapDelta.ts):
// UiSpriteBatch.begin, a HUD's worth of BitmapFont.draw and measure calls in both variants and alignments, end.
//
// It has a file of its own on purpose: Vitest runs each file in a fresh process, so the JIT sees only the
// UiSpriteBatch sink, as the game does. In bitmapText.test.ts the recording sinks (one of which builds an object per
// quad) make the draw loop's `sink.add` call site polymorphic, and V8's optimised code for that mix then allocates
// about 10 bytes per frame (measured in SSP-069: 36.9 KB over 3,600 frames after a single draw into the recorder,
// 3.7 KB without it), which says nothing about the game's monomorphic path.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { loadAtlas, type RgbaImage } from '../../src/render/spriteAtlas.ts';
import { UiSpriteBatch } from '../../src/render/spriteBatch.ts';
import { TextAlign, TextVariant } from '../../src/ui/bitmapText.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';
import { decodePng } from '../support/png.ts';
import { readBitmapFont } from '../support/textRaster.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Frames run before measuring, so the draw path is optimised (as in spriteBatch.test.ts). */
const WARMUP_FRAMES = 20_000;

it('allocates nothing per frame: begin, a HUD worth of text in both variants, end', async () => {
  const atlas = await loadAtlas('ui', {
    fetchJson: async (url: string): Promise<unknown> =>
      JSON.parse(readFileSync(`${REPO_ROOT}public${url}`, 'utf8')),
    fetchImage: async (url: string): Promise<RgbaImage> =>
      decodePng(readFileSync(`${REPO_ROOT}public${url}`)),
  });
  const font = readBitmapFont('kerbside5x7');
  const batch = new UiSpriteBatch(atlas, 256);
  const lines = ['3:42', 'SCORE 012340', 'x3 SPOTLESS!', 'PUDDLE LANE\nTIDY 47%', '£12.50 ★ AV To'];
  const aligns = [TextAlign.Left, TextAlign.Centre, TextAlign.Right] as const;
  const delta = measureHeapDelta(
    (tick) => {
      batch.begin();
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i] ?? '';
        const variant = ((tick + i) & 1) === 1 ? TextVariant.Outline : TextVariant.Plain;
        const align = aligns[(tick + i) % 3] ?? TextAlign.Left;
        font.draw(batch, text, 240 + (tick & 7), 4 + i * 10, (tick + i) & 31, variant, align);
        font.measure(text, variant);
      }
      batch.end();
    },
    { warmupTicks: WARMUP_FRAMES },
  );
  assertHeapDeltaWithinThresholds(delta);
  expect(batch.count).toBeGreaterThan(40);
  batch.dispose();
});
