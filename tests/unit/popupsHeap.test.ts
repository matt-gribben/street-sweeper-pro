// Zero allocation per frame for the world-space popups and speech bubbles (SSP-288; TECHNICAL_DESIGN §17 procedure,
// tests/support/heapDelta.ts): every frame a tick's events are decoded by the bus into the popups (pickups at every
// multiplier, penalties, NPC hits, Caught!, Doris's fist shake and car honks, so the pools fill, expire and replace),
// the NPCs and the car the bubbles follow move, and UiSpriteBatch.begin, Popups.draw at a moving camera and alpha,
// end.
//
// A file of its own, like hudHeap.test.ts: Vitest runs each file in a fresh process, so the JIT sees only the
// UiSpriteBatch sink, as the game does.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { EventBus } from '../../src/app/events.ts';
import { loadAtlas, type RgbaImage } from '../../src/render/spriteAtlas.ts';
import { UiSpriteBatch } from '../../src/render/spriteBatch.ts';
import { HUD_FONT } from '../../src/scenes/ShiftScene.ts';
import { Offence } from '../../src/sim/complaints.ts';
import { NPC_IDS } from '../../src/sim/entities.ts';
import { createEventQueue, EV, emitEvent, resetEvents, sealEvents } from '../../src/sim/eventQueue.ts';
import { addVehicle } from '../../src/sim/vehicleStore.ts';
import { createPopupCamera, POPUPS_MAX_QUADS, Popups } from '../../src/ui/popups.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';
import { addPerson, CENTRE, townWorld } from '../support/pedestrianRig.ts';
import { decodePng } from '../support/png.ts';
import { readBitmapFont } from '../support/textRaster.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Frames run before measuring, so the draw path is optimised (as in hudHeap.test.ts). */
const WARMUP_FRAMES = 20_000;

it('allocates nothing per frame: events into popups and bubbles, sources moving, draw', async () => {
  const atlas = await loadAtlas('ui', {
    fetchJson: async (url: string): Promise<unknown> =>
      JSON.parse(readFileSync(`${REPO_ROOT}public${url}`, 'utf8')),
    fetchImage: async (url: string): Promise<RgbaImage> =>
      decodePng(readFileSync(`${REPO_ROOT}public${url}`)),
  });
  const batch = new UiSpriteBatch(atlas, POPUPS_MAX_QUADS);
  const popups = new Popups(batch, readBitmapFont(HUD_FONT));
  const sim = createWorldWithSources();
  const view = { tick: 0, npc: sim.npc, vehicles: sim.vehicles };
  const bus = new EventBus();
  popups.attach(bus, view);
  const q = createEventQueue();
  const camera = createPopupCamera();
  camera.xM = CENTRE;
  camera.yM = CENTRE;
  camera.pxPerM = 16;
  const shopper = NPC_IDS.indexOf('npc.shopper');
  const cat = NPC_IDS.indexOf('npc.cat');
  let maxQuads = 0;
  let maxBubbles = 0;
  const delta = measureHeapDelta(
    (tick) => {
      view.tick = tick + 1;
      resetEvents(q, tick);
      // A pickup most ticks, at a moving point and every multiplier.
      if (tick % 3 !== 0) {
        const e = emitEvent(q, EV.PickupScored, 1 + (tick % 5));
        q.a[e] = CENTRE + (tick % 23) - 11;
        q.b[e] = CENTRE + (tick % 13) - 6;
        q.c[e] = 10 + (tick % 997) * 7;
      }
      if (tick % 37 === 0) {
        const e = emitEvent(q, EV.Penalty, Offence.Hit);
        q.a[e] = CENTRE - 3;
        q.b[e] = CENTRE + 2;
        q.c[e] = -250;
      }
      // Bubbles: hits on NPC 0 and 1, Caught! on 2, a fist shake on 3, the car's honk.
      const k = tick % 41;
      if (k < 5) {
        const i = k === 4 ? 0 : k;
        const type =
          k === 0 || k === 1 ? EV.NpcHit : k === 2 ? EV.Caught : k === 3 ? EV.FistShake : EV.CarHorn;
        const e = emitEvent(q, type, i);
        const xs = type === EV.CarHorn ? sim.vehicles.x : sim.npc.x;
        const ys = type === EV.CarHorn ? sim.vehicles.y : sim.npc.y;
        q.a[e] = xs[i] ?? 0;
        q.b[e] = ys[i] ?? 0;
        q.c[e] = type === EV.NpcHit ? (k === 0 ? shopper : cat) : 1;
      }
      sealEvents(q);
      bus.drain(q);
      // The sources walk and drive.
      for (let i = 0; i < 4; i++) {
        sim.npc.prevX[i] = sim.npc.x[i] ?? 0;
        sim.npc.x[i] = CENTRE + 4 * Math.sin((tick + i * 50) / 90);
      }
      sim.vehicles.prevX[0] = sim.vehicles.x[0] ?? 0;
      sim.vehicles.x[0] = CENTRE + 8 * Math.cos(tick / 120);
      camera.xM = CENTRE + 2 * Math.sin(tick / 60);
      camera.alpha = (tick % 10) / 10;
      batch.begin();
      popups.draw(view, (tick & 1) === 0 ? 480 : 432, camera);
      if (batch.count > maxQuads) maxQuads = batch.count;
      if (popups.bubbles.count > maxBubbles) maxBubbles = popups.bubbles.count;
      batch.end();
    },
    { warmupTicks: WARMUP_FRAMES },
  );
  assertHeapDeltaWithinThresholds(delta);
  expect(maxBubbles).toBe(3);
  expect(maxQuads).toBeGreaterThan(100);
  expect(maxQuads).toBeLessThanOrEqual(POPUPS_MAX_QUADS);
  batch.dispose();
});

/** The open town with a shopper, a cat, a litterbug and Doris near its centre, and one car. */
function createWorldWithSources() {
  const world = townWorld(288);
  addPerson(world, 'npc.shopper', CENTRE - 2, CENTRE - 3);
  addPerson(world, 'npc.cat', CENTRE + 2, CENTRE - 3);
  addPerson(world, 'npc.litterbug', CENTRE - 4, CENTRE + 2);
  addPerson(world, 'npc.old_woman', CENTRE + 4, CENTRE + 2);
  const v = addVehicle(world.vehicles, 0, 0);
  world.vehicles.x[v] = CENTRE;
  world.vehicles.y[v] = CENTRE + 5;
  world.vehicles.prevX[v] = CENTRE;
  world.vehicles.prevY[v] = CENTRE + 5;
  return world;
}
