// panel_sample (SSP-285): a test-only scene for the 9-slice panels and button states (src/ui/panels.ts), booted with
// `?test=1&scene=panel_sample&freeze=1` (add `night=1` for the night remap). It is the evidence scene for panels.ts
// until the M4 `hud_specimen` golden: tests/e2e/panels.spec.ts saves its frame to test-results/ and checks every UI
// pixel against a CPU rasterisation of the same layout.
//
// World: the text_sample street (TextSampleScene.ts): a 3-storey terrace along the top-left whose building shadow
// darkens the asphalt band below it, so the panels in the top rows sit half in shadow and half in sun and show that
// UI is never darkened (the UI pass writes mask (0, 1)).
//
// UI (panelSampleLayout, all at whole internal pixels, inside W = 432 so it fits every width):
//   - rows 1-3: each style (council, paper, dark) at 24×24 (the source size), 61×37, 200×19 and 16×16 (the
//     minimum), the sizes the slicing Vitest uses;
//   - row 4: the four button states, same width, labels naming the state;
//   - row 5: the same four states as taller 97×21 buttons (odd sizes: clipped repeats, odd centring);
//   - row 6: a pause-style dark panel holding buttons, and a paper notice with text, as the menus will use them.
//
// Static: nothing depends on the tick. Draw calls: city mesh, building shadows, the UI batch (3), plus the palette
// pass and the blit: 5 of the 10 allowed (TECHNICAL_DESIGN §12.7).
import { Group } from 'three';
import type { SceneContext } from '../app/Game.ts';
import type { Scene, SceneParams } from '../app/SceneManager.ts';
import { SWEEP_HEIGHT_M } from '../render/camera.ts';
import { mergeBoxes } from '../render/cityMesh.ts';
import { createPlaceholderCityMesh, parseCityGrid } from '../render/placeholderCity.ts';
import { createBuildingShadows } from '../render/shadows.ts';
import type { SpriteAtlas } from '../render/spriteAtlas.ts';
import { UiSpriteBatch } from '../render/spriteBatch.ts';
import type { InputFrame } from '../sim/inputFrame.ts';
import { type BitmapFont, LineSpacing, loadBitmapFont, TextAlign, TextVariant } from '../ui/bitmapText.ts';
import {
  ButtonState,
  buttonWidthFor,
  type PanelSink,
  PanelStyle,
  Panels,
  type UiRect,
} from '../ui/panels.ts';
import { TEXT_SAMPLE_ORIGIN_M, TEXT_SAMPLE_ROWS } from './TextSampleScene.ts';

/** The font button labels use (`public/assets/fonts/kerbside5x7.json`). */
export const PANEL_SAMPLE_FONT = 'kerbside5x7';

/** UI quads the scene can draw per frame (it draws about 1,000). */
export const PANEL_SAMPLE_CAPACITY = 2048;

/** One element of the sample. */
export type PanelSampleItem =
  | {
      readonly kind: 'panel';
      readonly style: PanelStyle;
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
    }
  | { readonly kind: 'button'; readonly state: ButtonState; readonly rect: UiRect; readonly label: string }
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly x: number;
      readonly y: number;
      readonly colour: number;
      readonly spacing: LineSpacing;
    };

/** The panel sizes per style row (the slicing Vitest's sizes plus the minimum). */
export const PANEL_SAMPLE_SIZES: readonly (readonly [w: number, h: number])[] = [
  [24, 24],
  [61, 37],
  [200, 19],
  [16, 16],
];

/** The four button states with their labels, in ButtonState order. */
export const PANEL_SAMPLE_BUTTONS: readonly (readonly [state: ButtonState, label: string])[] = [
  [ButtonState.Normal, 'NORMAL'],
  [ButtonState.Focus, 'FOCUS'],
  [ButtonState.Pressed, 'PRESSED'],
  [ButtonState.Disabled, 'DISABLED'],
];

/** The sample's elements, drawn in order (later quads over earlier ones). */
export function panelSampleLayout(font: BitmapFont): PanelSampleItem[] {
  const items: PanelSampleItem[] = [];
  const styles = [PanelStyle.Council, PanelStyle.Paper, PanelStyle.Dark] as const;
  styles.forEach((style, row) => {
    let x = 6;
    const y = 6 + row * 43;
    for (const [w, h] of PANEL_SAMPLE_SIZES) {
      items.push({ kind: 'panel', style, x, y, w, h });
      x += w + 6;
    }
  });
  const buttonW = Math.max(...PANEL_SAMPLE_BUTTONS.map(([, label]) => buttonWidthFor(font, label)));
  PANEL_SAMPLE_BUTTONS.forEach(([state, label], i) => {
    items.push({
      kind: 'button',
      state,
      rect: { x: 6 + i * (buttonW + 6), y: 136, w: buttonW, h: 16 },
      label,
    });
    items.push({ kind: 'button', state, rect: { x: 6 + i * 103, y: 158, w: 97, h: 21 }, label });
  });
  // A pause-style menu on the dark panel, and a paper notice.
  items.push({ kind: 'panel', style: PanelStyle.Dark, x: 6, y: 186, w: 120, h: 78 });
  items.push({ kind: 'text', text: 'PAUSED', x: 49, y: 192, colour: 7, spacing: LineSpacing.Hud });
  const menu: readonly (readonly [ButtonState, string])[] = [
    [ButtonState.Focus, 'RESUME'],
    [ButtonState.Normal, 'RESTART'],
    [ButtonState.Disabled, 'RETIRE'],
  ];
  menu.forEach(([state, label], i) => {
    items.push({ kind: 'button', state, rect: { x: 18, y: 204 + i * 19, w: 96, h: 17 }, label });
  });
  items.push({ kind: 'panel', style: PanelStyle.Paper, x: 134, y: 186, w: 150, h: 46 });
  items.push({
    kind: 'text',
    text: 'NOTICE TO RESIDENTS:\nBINS OUT BY 7AM.\nBY ORDER, THE COUNCIL',
    x: 142,
    y: 192,
    colour: 0,
    spacing: LineSpacing.Paragraph,
  });
  items.push({ kind: 'panel', style: PanelStyle.Council, x: 134, y: 236, w: 150, h: 28 });
  items.push({
    kind: 'text',
    text: 'PAM: Mind the cat!',
    x: 145,
    y: 246,
    colour: 7,
    spacing: LineSpacing.Hud,
  });
  return items;
}

/** Draws `items` through `panels` (its sink and font). */
export function drawPanelSample(panels: Panels, items: readonly PanelSampleItem[]): void {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === undefined) continue;
    if (item.kind === 'panel') panels.drawPanel(item.style, item.x, item.y, item.w, item.h);
    else if (item.kind === 'button') panels.drawButton(item.state, item.rect, item.label);
    else {
      panels.font.draw(
        panels.sink,
        item.text,
        item.x,
        item.y,
        item.colour,
        TextVariant.Plain,
        TextAlign.Left,
        item.spacing,
      );
    }
  }
}

/** The panel_sample scene. */
export class PanelSampleScene implements Scene {
  readonly id = 'panel_sample';
  readonly blocksUpdateBelow = false;
  readonly simEvents = null;
  private readonly context: SceneContext;
  private readonly world: Group;
  private atlas: SpriteAtlas | null = null;
  private batch: UiSpriteBatch | null = null;
  private panels: Panels | null = null;
  private items: readonly PanelSampleItem[] = [];

  constructor(context: SceneContext) {
    this.context = context;
    const grid = parseCityGrid(TEXT_SAMPLE_ROWS, TEXT_SAMPLE_ORIGIN_M[0], TEXT_SAMPLE_ORIGIN_M[1]);
    const city = createPlaceholderCityMesh(grid);
    city.renderOrder = 0;
    const shadows = createBuildingShadows(mergeBoxes(grid));
    shadows.renderOrder = 1;
    this.world = new Group();
    this.world.name = 'panelSample';
    this.world.add(city, shadows);
  }

  /** The UI batch (null before enter() resolves): its count is the quads drawn last frame. */
  get uiBatch(): UiSpriteBatch | null {
    return this.batch;
  }

  async enter(_params: SceneParams): Promise<void> {
    const [atlas, font] = await Promise.all([
      this.context.loadAtlas('ui'),
      loadBitmapFont(PANEL_SAMPLE_FONT),
    ]);
    if (font.metrics.atlas !== atlas.name) {
      atlas.texture.dispose();
      atlas.swapTexture.dispose();
      throw new Error(`panel_sample: ${font.metrics.id} draws from atlas '${font.metrics.atlas}', not 'ui'`);
    }
    this.atlas = atlas;
    const batch = new UiSpriteBatch(atlas, PANEL_SAMPLE_CAPACITY);
    const sink: PanelSink = batch;
    this.batch = batch;
    this.panels = new Panels(sink, font);
    this.items = panelSampleLayout(font);
    this.context.root.add(this.world);
    this.context.ui.add(batch.mesh);
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
    this.panels = null;
  }

  fixedUpdate(_input: Readonly<InputFrame>): void {}

  render(_alpha: number): void {
    const batch = this.batch;
    const panels = this.panels;
    if (batch === null || panels === null) return;
    batch.begin();
    drawPanelSample(panels, this.items);
    batch.end();
  }
}
