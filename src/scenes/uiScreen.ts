// A UI-only screen's GPU side (SSP-071): the `ui` atlas, the Kerbside 5×7 font, one UiSpriteBatch on the scene
// context's UI root and the Panels that draw through it. ShiftIntroScene and TallyScene own one each: load() in
// enter(), draw(items) in render(), dispose() in exit(). Nothing is drawn in the world pass, so behind the screen
// the frame is the cleared world target (index 00 after the palette pass).
//
// Draw calls: the UI batch (1), the palette pass and the blit: 3 of the 10 allowed (TECHNICAL_DESIGN §12.7).
import type { SceneContext } from '../app/Game.ts';
import type { SpriteAtlas } from '../render/spriteAtlas.ts';
import { UiSpriteBatch } from '../render/spriteBatch.ts';
import { type BitmapFont, type FontJsonSource, loadBitmapFont } from '../ui/bitmapText.ts';
import { Panels } from '../ui/panels.ts';
import { drawUiItems, type UiItem } from '../ui/uiItems.ts';

/** The font UI screens draw (`public/assets/fonts/kerbside5x7.json`). */
export const UI_SCREEN_FONT = 'kerbside5x7';

/** UI quads a screen can draw per frame (the tally page draws about 500). */
export const UI_SCREEN_CAPACITY = 1024;

/** A loaded screen: its font and panels, drawing into one UI batch. */
export class UiScreen {
  readonly font: BitmapFont;
  private readonly context: SceneContext;
  private readonly atlas: SpriteAtlas;
  private readonly batch: UiSpriteBatch;
  private readonly panels: Panels;
  private disposed = false;

  private constructor(context: SceneContext, atlas: SpriteAtlas, font: BitmapFont) {
    this.context = context;
    this.atlas = atlas;
    this.font = font;
    this.batch = new UiSpriteBatch(atlas, UI_SCREEN_CAPACITY);
    this.panels = new Panels(this.batch, font);
    context.ui.add(this.batch.mesh);
  }

  /**
   * Loads the `ui` atlas and the font (through `fontSource` when given: tests read the file) and puts an empty
   * batch on the UI root. Releases the atlas if it fails.
   */
  static async load(context: SceneContext, who: string, fontSource?: FontJsonSource): Promise<UiScreen> {
    const [atlasResult, fontResult] = await Promise.allSettled([
      context.loadAtlas('ui'),
      fontSource === undefined ? loadBitmapFont(UI_SCREEN_FONT) : loadBitmapFont(UI_SCREEN_FONT, fontSource),
    ]);
    if (atlasResult.status === 'rejected') throw atlasResult.reason;
    const atlas = atlasResult.value;
    try {
      if (fontResult.status === 'rejected') throw fontResult.reason;
      const font = fontResult.value;
      if (font.metrics.atlas !== atlas.name) {
        throw new Error(`${who}: ${font.metrics.id} draws from atlas '${font.metrics.atlas}', not 'ui'`);
      }
      return new UiScreen(context, atlas, font);
    } catch (error: unknown) {
      atlas.texture.dispose();
      atlas.swapTexture.dispose();
      throw error;
    }
  }

  /** Quads drawn last frame. */
  get quads(): number {
    return this.batch.count;
  }

  /** Replaces the batch's quads with `items` (once per frame, from render()). */
  draw(items: readonly UiItem[]): void {
    if (this.disposed) return;
    const batch = this.batch;
    batch.begin();
    drawUiItems(this.panels, items);
    batch.end();
  }

  /** Takes the batch off the UI root and releases the batch and the atlas. Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.context.ui.remove(this.batch.mesh);
    this.batch.dispose();
    this.atlas.texture.dispose();
    this.atlas.swapTexture.dispose();
  }
}
