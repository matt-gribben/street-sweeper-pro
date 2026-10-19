// A UI-only screen's GPU side (SSP-071): the `ui` atlas, the Kerbside 5×7 font, one UiSpriteBatch on the scene
// context's UI root and the Panels that draw through it. ShiftIntroScene and TallyScene own one each: open() in
// enter(), draw(items) in render(), dispose() in exit(). The atlas and the font come from the asset registry
// BootScene loaded (SceneContext.assets, SSP-284): a screen loads and releases neither, only its batch. Nothing is
// drawn in the world pass, so behind the screen the frame is the cleared world target (index 00 after the palette
// pass).
//
// Draw calls: the UI batch (1), the palette pass and the blit: 3 of the 10 allowed (TECHNICAL_DESIGN §12.7).
import type { FontName } from '../app/assetRegistry.ts';
import type { SceneContext } from '../app/Game.ts';
import { UiSpriteBatch } from '../render/spriteBatch.ts';
import type { BitmapFont } from '../ui/bitmapText.ts';
import { Panels } from '../ui/panels.ts';
import { drawUiItems, type UiItem } from '../ui/uiItems.ts';

/** The font UI screens draw (`public/assets/fonts/kerbside5x7.json`). */
export const UI_SCREEN_FONT: FontName = 'kerbside5x7';

/** UI quads a screen can draw per frame (the tally page draws about 500). */
export const UI_SCREEN_CAPACITY = 1024;

/** A loaded screen: its font and panels, drawing into one UI batch. */
export class UiScreen {
  readonly font: BitmapFont;
  private readonly context: SceneContext;
  private readonly batch: UiSpriteBatch;
  private readonly panels: Panels;
  private disposed = false;

  private constructor(context: SceneContext, batch: UiSpriteBatch, font: BitmapFont, order: number) {
    this.context = context;
    this.font = font;
    this.batch = batch;
    this.panels = new Panels(this.batch, font);
    batch.mesh.renderOrder = order;
    context.ui.add(this.batch.mesh);
  }

  /**
   * Takes the `ui` atlas and the font from the registry and puts an empty batch on the UI root. Throws (naming
   * `who`) if the font draws from another atlas. `order` is the batch's renderOrder: a screen drawn over another
   * scene's UI (PauseOverlay over the HUD, SSP-287) passes a higher one so its quads land on top.
   */
  static open(context: SceneContext, who: string, order = 0): UiScreen {
    const assets = context.assets;
    const atlas = assets.atlas('ui');
    const font = assets.font(UI_SCREEN_FONT);
    if (font.metrics.atlas !== atlas.name) {
      throw new Error(`${who}: ${font.metrics.id} draws from atlas '${font.metrics.atlas}', not 'ui'`);
    }
    return new UiScreen(context, new UiSpriteBatch(atlas, UI_SCREEN_CAPACITY), font, order);
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

  /** Takes the batch off the UI root and releases it (the atlas is the registry's). Idempotent. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.context.ui.remove(this.batch.mesh);
    this.batch.dispose();
  }
}
