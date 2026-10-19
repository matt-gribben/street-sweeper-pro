// The M0 spike scenes on the SceneManager (SSP-043). M0 booted them with a minimal switch in main.ts; this
// adapter gives each the Scene contract (§6.1) without touching what it draws, so the lean_quadrants,
// scale_1440 and scale_sheet visual goldens are unchanged:
//
//   - spike_city:      the SSP-017 spike city plus the SSP-018 spike actors (the default world until the
//                      Boot/Title flow); dev builds can swap the world (`?world=palette_test|empty`, `?actors=0`);
//   - lean_quadrants:  LeanQuadrantsScene (SSP-019), and `scale_1440`, the same scene in a 2560×1440 page (SSP-022);
//   - scale_sheet:     ScaleSheetScene (SSP-024).
//
// The spike actors are a pure function of a frame counter (heading cycle, brush spin). In M0 the counter
// advanced once per rendered frame; it is now the scene's tick count, advanced by fixedUpdate at 60 Hz, so
// 120 and 144 Hz displays animate at the same speed as 60 Hz ones and `__ssp.step(n)` advances it by n. The
// render interpolation alpha is unused: nothing here moves between ticks.

import { Group, type Object3D } from 'three';
import type { SceneContext } from '../app/Game.ts';
import type { Scene, SceneId, SceneParams } from '../app/SceneManager.ts';
import { createSpikeActors, type SpikeActors } from '../render/spikeActors.ts';
import { createSpikeCity } from '../render/spikeCity.ts';
import type { AtlasName, SpriteAtlas } from '../render/spriteAtlas.ts';
import { createTestWorld } from '../render/testWorld.ts';
import type { InputFrame } from '../sim/inputFrame.ts';
import { LeanQuadrantsScene } from './LeanQuadrantsScene.ts';
import { ScaleSheetScene } from './ScaleSheetScene.ts';

/** Looks one sprite atlas up in the asset registry BootScene loaded (SceneContext.assets, SSP-284). */
export type AtlasLookup = (name: AtlasName) => SpriteAtlas;

/** What a spike scene draws: world-pass content, plus sprites over the registry's atlases. */
export type SpikeContent = {
  readonly world: Object3D;
  /** Takes the atlases the content needs through `atlas` and attaches its sprites; null for none. */
  readonly attachSprites: ((atlas: AtlasLookup) => void) | null;
  /** Poses the content for frame counter `frameCount`; `camYSimM` is the camera's sim y (sprite sorting). */
  update(frameCount: number, camYSimM: number): void;
  /** Night on or off: the content shows or hides its light pools (the renderer owns the night remap). */
  setNight(on: boolean): void;
};

/** The spike scenes `?test=1&scene=<id>` can boot. */
export const SPIKE_TEST_SCENES = ['lean_quadrants', 'scale_1440', 'scale_sheet'] as const;
export type SpikeTestSceneId = (typeof SPIKE_TEST_SCENES)[number];

/** True for a scene ID `?test=1&scene=` can boot. */
export function isSpikeTestScene(id: string): id is SpikeTestSceneId {
  return (SPIKE_TEST_SCENES as readonly string[]).includes(id);
}

/** A spike content set as a Scene. */
export class SpikeScene implements Scene {
  readonly id: SceneId;
  readonly blocksUpdateBelow = false;
  readonly simEvents = null;
  private readonly content: SpikeContent;
  private readonly context: SceneContext;
  /** Dev builds: `?actorFrame=N` pins the drawn frame; null draws the tick count. */
  private readonly pinnedFrame: number | null;
  private ticks = 0;

  constructor(id: SceneId, content: SpikeContent, context: SceneContext, pinnedFrame: number | null = null) {
    this.id = id;
    this.content = content;
    this.context = context;
    this.pinnedFrame = pinnedFrame;
  }

  /** Ticks this scene has run: the frame counter its actors are posed from. */
  get frameCount(): number {
    return this.ticks;
  }

  /** The frame counter the content is drawn at (the pinned frame, when one is set). */
  get drawnFrame(): number {
    return this.pinnedFrame ?? this.ticks;
  }

  /** True when the content has sprites (false for the static dev worlds). */
  get hasSprites(): boolean {
    return this.content.attachSprites !== null;
  }

  /**
   * Attaches the sprites over the registry's atlases (BootScene checked them at boot: a bad atlas never gets
   * this far), then adds the world content to the world pass.
   */
  async enter(_params: SceneParams): Promise<void> {
    const attach = this.content.attachSprites;
    if (attach !== null) {
      const assets = this.context.assets;
      attach((name) => assets.atlas(name));
    }
    this.context.root.add(this.content.world);
  }

  /**
   * Removes the content from the world pass. The spike content holds its GPU buffers for the page's lifetime
   * (M0 never leaves a spike scene); scenes from M1 on dispose theirs here.
   */
  exit(): void {
    this.context.root.remove(this.content.world);
  }

  fixedUpdate(_input: Readonly<InputFrame>): void {
    this.ticks += 1;
  }

  render(_alpha: number): void {
    const renderer = this.context.renderer;
    this.content.setNight(renderer.night);
    this.content.update(this.drawnFrame, renderer.rig.snappedZ);
  }
}

function leanQuadrants(): SpikeContent {
  const scene = new LeanQuadrantsScene();
  return {
    world: scene.world,
    attachSprites: (atlas) => scene.attachSprites(atlas('actors'), atlas('items')),
    update: (frameCount, camYSimM) => scene.update(frameCount, camYSimM),
    setNight: (on) => scene.setNight(on),
  };
}

function scaleSheet(): SpikeContent {
  const scene = new ScaleSheetScene();
  return {
    world: scene.world,
    attachSprites: (atlas) => scene.attachSprites(atlas('actors'), atlas('items')),
    update: (frameCount, camYSimM) => scene.update(frameCount, camYSimM),
    setNight: () => {},
  };
}

/** The SSP-017 spike city, with the SSP-018 spike actors unless `withActors` is false. */
function spikeCity(withActors: boolean): SpikeContent {
  const world = createSpikeCity();
  let actors: SpikeActors | null = null;
  return {
    world,
    attachSprites: withActors
      ? (atlas) => {
          actors = createSpikeActors(atlas('actors'));
          world.add(actors.group);
        }
      : null,
    update: (frameCount, camYSimM) => actors?.update(frameCount, camYSimM),
    setNight: () => {},
  };
}

function staticWorld(world: Object3D): SpikeContent {
  return { world, attachSprites: null, update: () => {}, setNight: () => {} };
}

/** The `?test=1&scene=<id>` spike scene. `scale_1440` is lean_quadrants (the page size differs, not the scene). */
export function createSpikeTestScene(id: SpikeTestSceneId, context: SceneContext): SpikeScene {
  switch (id) {
    case 'lean_quadrants':
    case 'scale_1440':
      return new SpikeScene(id, leanQuadrants(), context);
    case 'scale_sheet':
      return new SpikeScene(id, scaleSheet(), context);
  }
}

/** The default scene: the spike city, with its actors unless `withActors` is false (`?actors=0`, dev only). */
export function createSpikeCityScene(
  context: SceneContext,
  withActors: boolean,
  pinnedFrame: number | null,
): SpikeScene {
  return new SpikeScene('spike_city', spikeCity(withActors), context, pinnedFrame);
}

/**
 * Dev builds only (`?world=`): `palette_test` is the SSP-016 palette test world and `empty` draws nothing, the
 * baseline for draw-call deltas. main.ts calls it under `import.meta.env.DEV`, so release builds drop it.
 */
export function createDevWorldScene(context: SceneContext, world: 'palette_test' | 'empty'): SpikeScene {
  const content = staticWorld(world === 'palette_test' ? createTestWorld() : new Group());
  return new SpikeScene('spike_city', content, context);
}
