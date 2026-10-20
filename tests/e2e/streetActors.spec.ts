// The street's actors in the shipping bundle (SSP-103; TECHNICAL_DESIGN §12.5, §12.7; ART_BIBLE §8.3, §10.2). No
// golden covers the street until the zoo golden (SSP-118, M4), so the frozen frames are saved to test-results/ as
// review captures (open them with Read) and the spec checks what must hold exactly.
//
// `?test=1&seed=1&scene=district.puddle_lane&tick=7800&freeze=1` (130 s in: the population is up and the named dog
// walker is out), with the camera pinned over two views worked out from the same seeded World in Node:
// - the parade (56, 13): pedestrians, a perched cat on a parked car's roof, parked and moving cars, a wheelie bin,
//   a puddle;
// - the High Street corner (79, 23): the dog walker, its dog and the lead, parked cars.
// In each: the frame takes 8 draw calls (city, building shadows, drop shadows, actors, items, HUD, palette pass,
// blit: the street adds none), the actors the Node World puts in view are the ones the actors batch draws, and
// every pixel of the CPU composite of that batch (tests/support/actorReference.ts) that nothing nearer covers (a
// wall or roof, a knockable's raised slices, the HUD) shows exactly that actor's palette index in the GPU frame.
import { expect, type Page, test } from '@playwright/test';
import type { ShiftTestState, TestState } from '../../src/debug/testHooks.ts';
import { cameraGroundRect, createCameraRig, pinCameraRig } from '../../src/render/camera.ts';
import { CELL_M, mergeBoxes } from '../../src/render/cityMesh.ts';
import { KERBSIDE32 } from '../../src/render/palettePass.ts';
import { LEAD_COLOUR } from '../../src/render/streetActors.ts';
import { PX_PER_M } from '../../src/sim/constants.ts';
import { NPC_IDS, VEHICLE_IDS } from '../../src/sim/entities.ts';
import { VEHICLE_FLAG } from '../../src/sim/vehicleStore.ts';
import {
  actorFrame,
  actorsAtlas,
  compositeActors,
  idleWorld,
  puddleLaneLevel,
} from '../support/actorReference.ts';
import { buildingCover, type Rect } from '../support/groundReference.ts';
import { hudBoxesPx } from '../support/hudCover.ts';
import { collectPageErrors, openTestScene, type RgbaFrame, readTestFrame } from '../support/visualGolden.ts';
import { saveFrame } from './helpers/saveFrame.ts';

const SEED = 1;
const TICK = 7800;
const URL = `/?test=1&seed=${SEED}&scene=district.puddle_lane&tick=${TICK}&freeze=1`;
const WIDTH_PX = 480;
const HEIGHT_PX = 270;
const SWEEP_H = 31.5;
/** City, building shadows, drop shadows, actors, items, HUD, palette pass, blit (TECHNICAL_DESIGN §12.7). */
const EXPECTED_DRAW_CALLS = 8;
const DRAW_CALL_BUDGET = 10;

const VIEWS = {
  parade: { x: 56, y: 13 },
  walker: { x: 79, y: 23 },
} as const;

const LEVEL = puddleLaneLevel();

async function shiftState(page: Page): Promise<ShiftTestState> {
  const state = await page.evaluate((): TestState => {
    const api = window.__ssp;
    if (api === undefined) throw new Error('window.__ssp missing');
    return api.state();
  });
  if (!('bessie' in state)) throw new Error(`state() is not a shift snapshot: ${JSON.stringify(state)}`);
  return state;
}

async function pinView(page: Page, x: number, y: number): Promise<number> {
  return page.evaluate(
    ([px, py, ph]) => {
      const api = window.__ssp;
      if (api === undefined) throw new Error('window.__ssp missing');
      api.setCamera(px, py, ph);
      api.step(0);
      return api.perf().drawCalls;
    },
    [x, y, SWEEP_H] as const,
  );
}

/** Palette index of each pixel of `frame` (−1 off Kerbside-32). */
function frameIndices(frame: RgbaFrame): Int16Array {
  const out = new Int16Array(frame.width * frame.height).fill(-1);
  const rgb = KERBSIDE32.rgb;
  const lookup = new Map<number, number>();
  for (let i = 0; i < 32; i++)
    lookup.set(((rgb[i * 3] ?? 0) << 16) | ((rgb[i * 3 + 1] ?? 0) << 8) | (rgb[i * 3 + 2] ?? 0), i);
  for (let p = 0; p < out.length; p++) {
    const o = p * 4;
    out[p] =
      lookup.get(((frame.data[o] ?? 0) << 16) | ((frame.data[o + 1] ?? 0) << 8) | (frame.data[o + 2] ?? 0)) ??
      -1;
  }
  return out;
}

/** Screen-pixel rects (x1, y1 exclusive) that may hide an actor: walls and roofs, raised knockables, the HUD. */
function coverPx(world: ReturnType<typeof idleWorld>, camX: number, camY: number): Rect[] {
  const [cols, rows] = LEVEL.size;
  const boxes = mergeBoxes({
    cols,
    rows,
    originXM: 0,
    originYM: 0,
    storeys: LEVEL.layers.storeys,
    wall: LEVEL.layers.wall,
    roof: LEVEL.layers.roof,
  });
  const toPx = (r: Rect): Rect => ({
    x0: Math.floor(WIDTH_PX / 2 + (r.x0 - camX) * PX_PER_M),
    y0: Math.floor(HEIGHT_PX / 2 + (r.y0 - camY) * PX_PER_M),
    x1: Math.ceil(WIDTH_PX / 2 + (r.x1 - camX) * PX_PER_M),
    y1: Math.ceil(HEIGHT_PX / 2 + (r.y1 - camY) * PX_PER_M),
  });
  const rects = boxes.map((b) => toPx(buildingCover(b, camX, camY, SWEEP_H)));
  for (let i = 0; i < world.bodies.count; i++) {
    const x = world.bodies.x[i] ?? 0;
    const y = world.bodies.y[i] ?? 0;
    rects.push(toPx({ x0: x - CELL_M, y0: y - CELL_M, x1: x + CELL_M, y1: y + CELL_M }));
  }
  return [...rects, ...hudBoxesPx(WIDTH_PX)];
}

function covered(rects: readonly Rect[], x: number, y: number): boolean {
  return rects.some((r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1);
}

test('Puddle Lane at tick 7800: pedestrians, cats, moving and parked cars, the dog lead and puddles', async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const errors = collectPageErrors(page);
  await openTestScene(page, URL);
  expect((await shiftState(page)).tick).toBe(TICK);
  const world = idleWorld(LEVEL, SEED, TICK);
  // The browser's World is the Node one (on the replay hash's 1e-4 grid).
  const state = await shiftState(page);
  const q = (v: number): number => Math.round(v * 1e4);
  expect(state.npcs.map((n) => [n.id, q(n.x), q(n.y), n.state])).toEqual(
    Array.from({ length: world.npc.count }, (_, i) => [
      world.npc.kind[i] === NPC_IDS.indexOf('npc.dog_walker')
        ? 'npc.dog_walker'
        : NPC_IDS[world.npc.kind[i] ?? 0],
      q(world.npc.x[i] ?? 0),
      q(world.npc.y[i] ?? 0),
      world.npc.state[i],
    ]),
  );
  const atlas = actorsAtlas();

  const report: string[] = [];
  for (const [name, view] of Object.entries(VIEWS)) {
    const calls = await pinView(page, view.x, view.y);
    expect(calls, `${name} draw calls`).toBe(EXPECTED_DRAW_CALLS);
    expect(calls).toBeLessThanOrEqual(DRAW_CALL_BUDGET);
    const frame = await readTestFrame(page);
    await saveFrame(testInfo, `street_${name}.png`, frame, { atResultsRoot: true });

    // What is in view, from the Node World.
    const rig = createCameraRig(WIDTH_PX);
    pinCameraRig(rig, view.x, view.y, SWEEP_H);
    const rect = cameraGroundRect(rig, 0, { minX: 0, minY: 0, maxX: 0, maxY: 0 });
    const inView = (x: number, y: number): boolean =>
      x > rect.minX && x < rect.maxX && y > rect.minY && y < rect.maxY;
    const npcs: string[] = [];
    for (let i = 0; i < world.npc.count; i++) {
      if (inView(world.npc.x[i] ?? 0, world.npc.y[i] ?? 0)) {
        const companion = world.npc.origin[i] === 4;
        npcs.push(companion ? 'dog' : (NPC_IDS[world.npc.kind[i] ?? 0] ?? '?'));
      }
    }
    const moving: string[] = [];
    const parked: string[] = [];
    for (let i = 0; i < world.vehicles.count; i++) {
      if (!inView(world.vehicles.x[i] ?? 0, world.vehicles.y[i] ?? 0)) continue;
      const id = VEHICLE_IDS[world.vehicles.kind[i] ?? 0] ?? '?';
      if (((world.vehicles.flags[i] ?? 0) & VEHICLE_FLAG.PARKED) !== 0) parked.push(id);
      else moving.push(id);
    }
    let puddles = 0;
    for (let i = 0; i < world.hazards.count; i++) {
      if (inView(world.hazards.x[i] ?? 0, world.hazards.y[i] ?? 0)) puddles++;
    }

    const ref = actorFrame(world, atlas, view.x, view.y, SWEEP_H, WIDTH_PX, 0);
    const image = compositeActors(ref, atlas, rig.snappedX, rig.snappedZ, WIDTH_PX);
    const gpu = frameIndices(frame);
    const cover = coverPx(world, rig.snappedX, rig.snappedZ);
    let compared = 0;
    let mismatched = 0;
    let lead = 0;
    for (let y = 0; y < HEIGHT_PX; y++) {
      for (let x = 0; x < WIDTH_PX; x++) {
        const want = image.index[y * WIDTH_PX + x] ?? -1;
        if (want < 0 || covered(cover, x, y)) continue;
        compared++;
        if (gpu[y * WIDTH_PX + x] !== want) mismatched++;
        else if (want === LEAD_COLOUR) lead++;
      }
    }
    report.push(
      `${name}: npcs [${npcs.join(', ')}], moving [${moving.join(', ')}], parked [${parked.join(', ')}], ` +
        `hazards ${puddles}, ${ref.street.npcsDrawn} npc / ${ref.street.vehiclesDrawn} vehicle instances, ` +
        `${ref.street.leadRunsDrawn} lead runs, ${compared} actor px compared, ${mismatched} mismatched`,
    );
    console.log(`[street] ${report[report.length - 1]}`);
    expect(mismatched, `${name}: actor pixels differing from the CPU composite`).toBe(0);
    expect(compared, `${name}: actor pixels compared`).toBeGreaterThan(200);
    if (name === 'parade') {
      expect(npcs).toContain('npc.cat');
      expect(npcs.some((id) => id !== 'npc.cat')).toBe(true);
      expect(moving.length).toBeGreaterThan(0);
      expect(parked.length).toBeGreaterThan(0);
      expect(puddles).toBeGreaterThan(0);
    } else {
      expect(npcs).toContain('npc.dog_walker');
      expect(npcs).toContain('dog');
      expect(ref.street.leadsDrawn).toBe(1);
      expect(lead).toBeGreaterThan(10);
    }
  }
  expect(errors).toEqual([]);
});
