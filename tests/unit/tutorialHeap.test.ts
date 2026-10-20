// Zero allocation per tick for Pam's tutorial layer (SSP-290; TECHNICAL_DESIGN §17 procedure,
// tests/support/heapDelta.ts): readTutorialFrame from a live World whose Bessie moves every tick, the camera-rect
// pledge check, and TutorialLayer.tick in a shift whose every lesson is learned (no beat fires, the steady state).
//
// A file of its own, like hudHeap.test.ts: Vitest runs each file in a fresh process, so the JIT sees only this path,
// and it warms up for 20,000 ticks so the measured window runs optimised code (the unoptimised tiers box doubles).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';
import { DEFAULT_GLYPHS } from '../../src/app/glyphBindings.ts';
import { HUD_FONT } from '../../src/scenes/ShiftScene.ts';
import { decodeLevel } from '../../src/sim/map.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld } from '../../src/sim/world.ts';
import { HUD_HEIGHT_PX, Hud } from '../../src/ui/hud.ts';
import {
  createTutorialFrame,
  pledgeFrontageInView,
  readTutorialFrame,
  TutorialLayer,
  tutorialBeats,
} from '../../src/ui/tutorial.ts';
import { TutorialMemory } from '../../src/ui/tutorialMemory.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';
import { readBitmapFont, readIndexedAtlas, TextRaster } from '../support/textRaster.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
/**
 * Ticks run before measuring, so the tick path is optimised. hudHeap.test.ts runs 20,000 frames; a tick here is far
 * lighter, so more of them give the background compiler the same time on a loaded machine (about 0.2 s).
 */
const WARMUP_TICKS = 100_000;

it('reading the frame and ticking the layer on a moving Bessie allocates nothing', () => {
  const level = decodeLevel(readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8'));
  const world = createWorld(level, 1, DEFAULT_TUNING);
  const hud = new Hud(
    new TextRaster(480, HUD_HEIGHT_PX, readIndexedAtlas('ui')),
    readBitmapFont(HUD_FONT),
    DEFAULT_GLYPHS,
  );
  const beats = tutorialBeats(level);
  const layer = new TutorialLayer(beats, hud, new TutorialMemory(beats.map((b) => b.lesson)));
  const frame = createTutorialFrame();
  const view = { minX: 0, minY: 60, maxX: 30, maxY: 77 };
  layer.start(readTutorialFrame(world, false, frame));
  world.input.throttle = 120;
  world.input.steer = 20;
  const startX = world.vehicle.xM;
  const delta = measureHeapDelta(
    (tick) => {
      world.vehicle.xM = startX + (tick % 600) * 0.0137;
      world.vehicle.yM = 89 - (tick % 300) * 0.0071;
      hud.radio.tick();
      layer.tick(readTutorialFrame(world, pledgeFrontageInView(level.frontages, view), frame));
    },
    { warmupTicks: WARMUP_TICKS },
  );
  assertHeapDeltaWithinThresholds(delta);
});
