// text_sample (SSP-069): a test-only scene for the bitmap text and the UI pass, booted with
// `?test=1&scene=text_sample&freeze=1` (add `night=1` for the night remap). It is the evidence scene for
// src/ui/bitmapText.ts until the M4 `hud_specimen` golden: tests/e2e/bitmapText.spec.ts saves its frames to
// test-results/ and checks every text pixel against a CPU rasterisation of the same layout.
//
// World (camera pinned over the origin at H = 31.5 m: 30 m × 16.9 m visible at W = 480, north up), in screen pixels
// at W = 480: a 3-storey terrace fills the north-west of the top row (x −32..224, y −9..23); its building shadow
// (0.84 × 7.5 m to the SE, 71 px on each axis) darkens the asphalt band below it, x from (y − 55) to (y + 201) for
// y 23..94. The east half of that band stays sunlit, and the south half of the frame is 05 slab.
//
// Text (TEXT_SAMPLE lines, all at whole internal pixels): the same four lines (07 chalk and 18 postbox red, plain
// and outlined) once inside the building shadow (x = 56) and once in the sun (x = 300), so the frame shows UI text
// is never darkened (the UI pass writes mask (0, 1)); the alignment samples about x = W / 2; the HUD-like corner
// strings at the 4 px safe margin; the whole character set plain and outlined; the combo tier colours (ART_BIBLE
// §11); a multi-line paragraph with a fallback character; and centred multi-line text.
//
// Static: nothing depends on the tick, so every frame is the same. Draw calls: city mesh, building shadows, the UI
// batch (3), plus the palette pass and the blit: 5 of the 10 allowed (TECHNICAL_DESIGN §12.7).
import { Group } from 'three';
import type { SceneContext } from '../app/Game.ts';
import type { Scene, SceneParams } from '../app/SceneManager.ts';
import { SWEEP_HEIGHT_M } from '../render/camera.ts';
import { mergeBoxes } from '../render/cityMesh.ts';
import { paletteIndex } from '../render/palettePass.ts';
import { createPlaceholderCityMesh, parseCityGrid } from '../render/placeholderCity.ts';
import { createBuildingShadows } from '../render/shadows.ts';
import type { SpriteAtlas } from '../render/spriteAtlas.ts';
import { UiSpriteBatch } from '../render/spriteBatch.ts';
import type { InputFrame } from '../sim/inputFrame.ts';
import { type BitmapFont, LineSpacing, loadBitmapFont, TextAlign, TextVariant } from '../ui/bitmapText.ts';

/** One character per 2 m cell (`.` asphalt, `:` slab, `3` a 3-storey building); row 0 is north. 17 × 9 cells. */
export const TEXT_SAMPLE_ROWS: readonly string[] = [
  '33333333.........',
  '.................',
  '.................',
  '.................',
  ':::::::::::::::::',
  ':::::::::::::::::',
  ':::::::::::::::::',
  ':::::::::::::::::',
  ':::::::::::::::::',
];

/** Sim position of the grid's NW corner: the 34 m × 18 m grid is centred on the origin. */
export const TEXT_SAMPLE_ORIGIN_M: readonly [x: number, y: number] = [-17, -9];

/** The font the scene draws (`public/assets/fonts/kerbside5x7.json`). */
export const TEXT_SAMPLE_FONT = 'kerbside5x7';

/** x of the column inside the building shadow, and of the sunlit column, at every width. */
export const TEXT_SAMPLE_SHADOW_X_PX = 56;
export const TEXT_SAMPLE_SUN_X_PX = 300;

/** UI quads the scene can draw per frame (it draws about 1,100). */
export const TEXT_SAMPLE_CAPACITY = 2048;

/** One string of the sample: drawn with BitmapFont.draw(batch, text, x, y, colour, variant, align, spacing). */
export type TextSampleLine = {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  /** Palette index. */
  readonly colour: number;
  readonly variant: TextVariant;
  readonly align: TextAlign;
  readonly spacing: LineSpacing;
};

/** Every glyph of Kerbside 5×7 except the space, in code-point order, split into two lines. */
export const TEXT_SAMPLE_CHARSET = (() => {
  let ascii = '';
  for (let c = 33; c <= 126; c++) ascii += String.fromCodePoint(c);
  return `${ascii.slice(0, 48)}\n${ascii.slice(48)}£←↑→↓★`;
})();

/** The four comparison lines: 07 and 18, plain and outlined (ART_BIBLE §11: text 07, penalties 18). */
function comparisonLines(x: number): TextSampleLine[] {
  const chalk = paletteIndex('chalk');
  const red = paletteIndex('postbox_red');
  const line = (text: string, y: number, colour: number, variant: TextVariant): TextSampleLine => ({
    text,
    x,
    y,
    colour,
    variant,
    align: TextAlign.Left,
    spacing: LineSpacing.Hud,
  });
  return [
    line('CHALK Hi! AV To', 30, chalk, TextVariant.Plain),
    line('CHALK Hi! AV To', 42, chalk, TextVariant.Outline),
    line('PENALTY -250', 54, red, TextVariant.Plain),
    line('PENALTY -250', 66, red, TextVariant.Outline),
    line('x2 TIDY!', 78, paletteIndex('grass_lt'), TextVariant.Outline),
  ];
}

/**
 * The sample's strings for internal width `widthPx` (alignment anchors follow W). `font` places the combo tier
 * words one after another; any font with the Kerbside 5×7 metrics gives the same layout.
 */
export function textSampleLines(widthPx: number, font: BitmapFont): TextSampleLine[] {
  const chalk = paletteIndex('chalk');
  const at = (
    text: string,
    x: number,
    y: number,
    colour: number,
    variant: TextVariant,
    align: TextAlign = TextAlign.Left,
    spacing: LineSpacing = LineSpacing.Hud,
  ): TextSampleLine => ({ text, x, y, colour, variant, align, spacing });
  const lines: TextSampleLine[] = [
    ...comparisonLines(TEXT_SAMPLE_SHADOW_X_PX),
    ...comparisonLines(TEXT_SAMPLE_SUN_X_PX),
    // HUD corners at the 4 px safe margin (ART_BIBLE §12.2).
    at('3:42', 4, 104, chalk, TextVariant.Outline),
    at('SCORE 012340', widthPx - 4, 104, chalk, TextVariant.Outline, TextAlign.Right),
    // Alignment about x = W / 2.
    at('LEFT', widthPx / 2, 104, chalk, TextVariant.Plain, TextAlign.Left),
    at('CENTRE', widthPx / 2, 114, chalk, TextVariant.Plain, TextAlign.Centre),
    at('RIGHT', widthPx / 2, 124, chalk, TextVariant.Plain, TextAlign.Right),
    // The character set, plain then outlined, at paragraph spacing.
    at(TEXT_SAMPLE_CHARSET, 4, 136, chalk, TextVariant.Plain, TextAlign.Left, LineSpacing.Paragraph),
    at(TEXT_SAMPLE_CHARSET, 4, 158, chalk, TextVariant.Outline, TextAlign.Left, LineSpacing.Paragraph),
  ];
  // Combo tier words in their colours (ART_BIBLE §11), one outlined advance apart.
  const tiers: readonly [string, string][] = [
    ['TIDY!', 'grass_lt'],
    ['SPOTLESS!', 'spray'],
    ['IMMACULATE!', 'lemon'],
    ['SWEEPING BEAUTY!', 'bubblegum'],
  ];
  let x = 4;
  for (const [word, colour] of tiers) {
    lines.push(at(word, x, 182, paletteIndex(colour), TextVariant.Outline));
    x += font.measure(word, TextVariant.Outline) + font.measure(' ', TextVariant.Outline);
  }
  lines.push(
    at(
      'Paragraph spacing is 9 px:\nthe pen drops a cell plus one.\nFallback: café draws ?',
      4,
      198,
      chalk,
      TextVariant.Plain,
      TextAlign.Left,
      LineSpacing.Paragraph,
    ),
    at(
      'CENTRED\nLINES',
      (widthPx * 3) / 4,
      198,
      paletteIndex('sweeper_yellow'),
      TextVariant.Outline,
      TextAlign.Centre,
    ),
    at('£12.50 ★★★ ← ↑ → ↓', 4, 232, paletteIndex('lemon'), TextVariant.Outline),
    at('Kerbside 5x7: AV AT AY LT LY TA Te To Ty VA YA Fo r. r,', 4, 248, chalk, TextVariant.Plain),
  );
  return lines;
}

/** The text_sample scene. */
export class TextSampleScene implements Scene {
  readonly id = 'text_sample';
  readonly blocksUpdateBelow = false;
  readonly simEvents = null;
  private readonly context: SceneContext;
  private readonly world: Group;
  private atlas: SpriteAtlas | null = null;
  private batch: UiSpriteBatch | null = null;
  private font: BitmapFont | null = null;
  private lines: readonly TextSampleLine[] = [];
  private linesWidthPx = 0;

  constructor(context: SceneContext) {
    this.context = context;
    const grid = parseCityGrid(TEXT_SAMPLE_ROWS, TEXT_SAMPLE_ORIGIN_M[0], TEXT_SAMPLE_ORIGIN_M[1]);
    const city = createPlaceholderCityMesh(grid);
    city.renderOrder = 0;
    const shadows = createBuildingShadows(mergeBoxes(grid));
    shadows.renderOrder = 1;
    this.world = new Group();
    this.world.name = 'textSample';
    this.world.add(city, shadows);
  }

  /** The UI batch (null before enter() resolves): its count is the quads drawn last frame. */
  get uiBatch(): UiSpriteBatch | null {
    return this.batch;
  }

  async enter(_params: SceneParams): Promise<void> {
    const [atlas, font] = await Promise.all([this.context.loadAtlas('ui'), loadBitmapFont(TEXT_SAMPLE_FONT)]);
    if (font.metrics.atlas !== atlas.name) {
      atlas.texture.dispose();
      atlas.swapTexture.dispose();
      throw new Error(`text_sample: ${font.metrics.id} draws from atlas '${font.metrics.atlas}', not 'ui'`);
    }
    this.atlas = atlas;
    this.font = font;
    this.batch = new UiSpriteBatch(atlas, TEXT_SAMPLE_CAPACITY);
    this.context.root.add(this.world);
    this.context.ui.add(this.batch.mesh);
    this.context.pinCamera(0, 0, SWEEP_HEIGHT_M);
  }

  exit(): void {
    this.context.root.remove(this.world);
    if (this.batch !== null) {
      this.context.ui.remove(this.batch.mesh);
      this.batch.dispose();
      this.batch = null;
    }
    if (this.atlas !== null) {
      this.atlas.texture.dispose();
      this.atlas.swapTexture.dispose();
      this.atlas = null;
    }
  }

  fixedUpdate(_input: Readonly<InputFrame>): void {}

  render(_alpha: number): void {
    const batch = this.batch;
    const font = this.font;
    if (batch === null || font === null) return;
    const widthPx = this.context.renderer.rig.internalWidth;
    if (widthPx !== this.linesWidthPx) {
      // Rebuilt only when W changes (a window resize), never per frame.
      this.lines = textSampleLines(widthPx, font);
      this.linesWidthPx = widthPx;
    }
    const lines = this.lines;
    batch.begin();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === undefined) continue;
      font.draw(batch, line.text, line.x, line.y, line.colour, line.variant, line.align, line.spacing);
    }
    batch.end();
  }
}
