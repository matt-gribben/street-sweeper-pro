// Zero allocation per frame for the HUD (SSP-070; TECHNICAL_DESIGN §17 procedure, tests/support/heapDelta.ts):
// UiSpriteBatch.begin, Hud.tick and Hud.draw from a live World view, then Hud.drawModel over a snapshot whose every
// field moves frame by frame (timer, score digits and sign, combo tiers, the chain bar, tier popups, hopper, water,
// Dignity and the dump ring; since SSP-299 the Brush-o-meter's zones, needle and mph, the brush state and its ring,
// the clean-zone highlight, Tidy %, and both off-screen arrows sweeping round the frame), end.
//
// A file of its own, like bitmapTextHeap.test.ts: Vitest runs each file in a fresh process, so the JIT sees only the
// UiSpriteBatch sink, as the game does.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { loadAtlas, type RgbaImage } from '../../src/render/spriteAtlas.ts';
import { UiSpriteBatch } from '../../src/render/spriteBatch.ts';
import { HUD_CAPACITY, HUD_FONT } from '../../src/scenes/ShiftScene.ts';
import { BrushState } from '../../src/sim/brush.ts';
import { createInputFrame } from '../../src/sim/inputFrame.ts';
import { decodeLevel } from '../../src/sim/map.ts';
import { DumpState } from '../../src/sim/shift.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { createWorld } from '../../src/sim/world.ts';
import { Hud } from '../../src/ui/hud.ts';
import { createHudModel, createHudSnapshot, hudModel } from '../../src/ui/hudModel.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';
import { decodePng } from '../support/png.ts';
import { readBitmapFont } from '../support/textRaster.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Frames run before measuring, so the draw path is optimised (as in bitmapTextHeap.test.ts). */
const WARMUP_FRAMES = 20_000;

it('allocates nothing per frame: tick, draw from the World, and a model whose every element changes', async () => {
  const atlas = await loadAtlas('ui', {
    fetchJson: async (url: string): Promise<unknown> =>
      JSON.parse(readFileSync(`${REPO_ROOT}public${url}`, 'utf8')),
    fetchImage: async (url: string): Promise<RgbaImage> =>
      decodePng(readFileSync(`${REPO_ROOT}public${url}`)),
  });
  const batch = new UiSpriteBatch(atlas, HUD_CAPACITY);
  const hud = new Hud(batch, readBitmapFont(HUD_FONT));
  const level = decodeLevel(readFileSync(`${REPO_ROOT}public/assets/levels/puddle_lane.json`, 'utf8'));
  const world = createWorld(level, 1, DEFAULT_TUNING);
  world.step(createInputFrame());
  const snapshot = createHudSnapshot();
  snapshot.hopperCapacityLu = 100;
  snapshot.hopperWarnFraction = 0.8;
  snapshot.tankUnits = 100;
  snapshot.maxHp = 100;
  snapshot.dentedBelowHp = 40;
  snapshot.dumpHoldTotalTicks = 60;
  snapshot.chainRefreshTicks = 120;
  snapshot.districtName = 'PUDDLE LANE';
  snapshot.cameraPxPerM = 16;
  snapshot.depotCount = 2;
  snapshot.depotX = Float64Array.of(-100, 40);
  snapshot.depotY = Float64Array.of(60, -90);
  snapshot.hydrantCount = 2;
  snapshot.hydrantX = Float64Array.of(70, -80);
  snapshot.hydrantY = Float64Array.of(-50, -20);
  const camera = { xM: world.vehicle.xM, yM: world.vehicle.yM, pxPerM: 16 };
  const brushStates = [
    BrushState.Raised,
    BrushState.Lowering,
    BrushState.SpinningUp,
    BrushState.Collecting,
    BrushState.Bulldozing,
    BrushState.Raising,
  ] as const;
  const frame = hud.layout(480).arrowFrame;
  hud.highlightCleanZone(1_000_000_000);
  const model = createHudModel();
  let maxQuads = 0;
  const delta = measureHeapDelta(
    (tick) => {
      snapshot.ticksRemaining = 14_400 - (tick % 14_401);
      snapshot.score = ((tick * 7919) % 20_000_001) - 10_000_000;
      snapshot.multiplier = 1 + (Math.floor(tick / 50) % 5);
      snapshot.chain = tick % 130;
      snapshot.chainTimerTicks = 120 - (tick % 121);
      snapshot.popupStartTick = tick - (tick % 70);
      snapshot.popupMultiplier = 2 + (Math.floor(tick / 70) % 4);
      snapshot.hopperLu = tick % 101;
      snapshot.water = 100 - (tick % 101);
      snapshot.hp = tick % 101;
      snapshot.dumpAvailable = (tick & 64) !== 0;
      snapshot.dumpState = (tick & 128) !== 0 ? DumpState.Holding : DumpState.Idle;
      snapshot.dumpHoldTicks = tick % 61;
      snapshot.speedMps = (tick % 120) / 10;
      snapshot.brushState = brushStates[Math.floor(tick / 40) % brushStates.length] ?? BrushState.Raised;
      snapshot.rpm = (tick % 37) / 36;
      snapshot.flingThresholdMps = (tick & 256) !== 0 ? 6 : 4;
      snapshot.cleanHighlightUntilTick = (tick & 512) !== 0 ? tick + 10 : -1;
      snapshot.tidyPpm = (tick * 997) % 1_000_001;
      snapshot.cameraXM = 20 * Math.cos(tick / 50);
      snapshot.cameraYM = 20 * Math.sin(tick / 70);
      batch.begin();
      hud.tick(world);
      hud.draw(world, 480, camera);
      hud.drawModel(hudModel(snapshot, tick, model, frame), 480);
      if (batch.count > maxQuads) maxQuads = batch.count;
      batch.end();
    },
    { warmupTicks: WARMUP_FRAMES },
  );
  assertHeapDeltaWithinThresholds(delta);
  // Two HUDs a frame; the busiest comfortably inside the batch.
  expect(maxQuads).toBeGreaterThan(150);
  expect(maxQuads).toBeLessThanOrEqual(HUD_CAPACITY);
  batch.dispose();
});
