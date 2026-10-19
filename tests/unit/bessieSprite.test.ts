// SSP-046: Bessie's frame selection (heading index → hNN, the dented body below 40 HP, the brush overlay while
// the brush is down) and her sprite instances (body + brush on layers 7 and 8, the body's drop shadow), built on
// the committed actors atlas without WebGL.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FRAME } from '../../src/gen/assets.ts';
import {
  bessieBodyFrameFor,
  bessieBrushFrameFor,
  createBessieSprite,
  M1_BRUSH_SPIN_FRAME,
} from '../../src/render/bessieSprite.ts';
import {
  BESSIE_DENTED_FRAMES,
  bessieDentedFrame,
  HEADING_IDS,
  HEADING_STEP_RAD,
} from '../../src/render/headings.ts';
import { type AtlasName, loadAtlas } from '../../src/render/spriteAtlas.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';
import { decodePng } from '../support/png.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DENTED_BELOW_HP = DEFAULT_TUNING.vehicle.sweeper.health.dentedBelowHp;

async function atlas(name: AtlasName) {
  return loadAtlas(name, {
    fetchJson: async () => JSON.parse(readFileSync(`${REPO_ROOT}public/assets/atlas/${name}.json`, 'utf8')),
    fetchImage: async () => decodePng(readFileSync(`${REPO_ROOT}public/assets/atlas/${name}.png`)),
  });
}

describe('Bessie frame selection', () => {
  it('uses the 40 HP threshold from tuning.json', () => {
    expect(DENTED_BELOW_HP).toBe(40);
  });

  it('draws h08 at heading π/2 (east), h00 at 0 and h16 at π', () => {
    expect(bessieBodyFrameFor(Math.PI / 2, 100, DENTED_BELOW_HP)).toBe('veh.sweeper:body:h08:0');
    expect(bessieBodyFrameFor(0, 100, DENTED_BELOW_HP)).toBe('veh.sweeper:body:h00:0');
    expect(bessieBodyFrameFor(Math.PI, 100, DENTED_BELOW_HP)).toBe('veh.sweeper:body:h16:0');
    expect(bessieBodyFrameFor(-Math.PI / 2, 100, DENTED_BELOW_HP)).toBe('veh.sweeper:body:h24:0');
  });

  it('uses the dented frame strictly below 40 HP', () => {
    expect(bessieBodyFrameFor(Math.PI / 2, 39.99, DENTED_BELOW_HP)).toBe('veh.sweeper:dented:h08:0');
    expect(bessieBodyFrameFor(Math.PI / 2, 0, DENTED_BELOW_HP)).toBe('veh.sweeper:dented:h08:0');
    expect(bessieBodyFrameFor(Math.PI / 2, 40, DENTED_BELOW_HP)).toBe('veh.sweeper:body:h08:0');
    expect(bessieBodyFrameFor(Math.PI / 2, 100, DENTED_BELOW_HP)).toBe('veh.sweeper:body:h08:0');
  });

  it('selects every heading by the nearest 11.25° step, for unwrapped headings too', () => {
    for (let i = 0; i < HEADING_IDS.length; i++) {
      const h = HEADING_IDS[i];
      // Within ±5° of the heading's centre, and one and two full turns either way (the sim never wraps θ).
      for (const turns of [-2, -1, 0, 1, 2]) {
        for (const offsetDeg of [-5, 0, 5]) {
          const theta = i * HEADING_STEP_RAD + turns * 2 * Math.PI + (offsetDeg * Math.PI) / 180;
          expect(bessieBodyFrameFor(theta, 100, DENTED_BELOW_HP)).toBe(`veh.sweeper:body:${h}:0`);
          expect(bessieBodyFrameFor(theta, 10, DENTED_BELOW_HP)).toBe(`veh.sweeper:dented:${h}:0`);
          expect(bessieBrushFrameFor(theta)).toBe(`veh.sweeper_brush:brush:${h}:${M1_BRUSH_SPIN_FRAME}`);
        }
      }
    }
  });

  it("every dented frame exists in the actors atlas with the body frame's cell and pivot", () => {
    expect(BESSIE_DENTED_FRAMES).toHaveLength(32);
    for (let i = 0; i < 32; i++) {
      const dented = FRAME[bessieDentedFrame(i)];
      const body = FRAME[bessieBodyFrameFor(i * HEADING_STEP_RAD, 100, DENTED_BELOW_HP)];
      expect(dented.atlas).toBe('actors');
      expect([dented.w, dented.h, dented.px, dented.py]).toEqual([body.w, body.h, body.px, body.py]);
    }
    expect(() => bessieDentedFrame(32)).toThrow(/heading index/);
  });
});

describe('createBessieSprite', () => {
  it('draws the body (layer 7), the brush overlay (layer 8) only while the brush is down, and one drop shadow', async () => {
    const actors = await atlas('actors');
    const bessie = createBessieSprite(actors, DENTED_BELOW_HP);
    expect(bessie.group.children.map((m) => m.name)).toEqual(['bessieShadow', 'bessie']);
    expect(bessie.shadows.mesh.renderOrder).toBe(2);
    expect(bessie.sprites.mesh.renderOrder).toBe(3);
    expect(bessie.bodyFrame).toBeNull();

    bessie.update({ xM: 7, yM: 89, headingRad: 0 }, 100, false, 89);
    expect(bessie.bodyFrame).toBe('veh.sweeper:body:h00:0');
    expect(bessie.brushFrame).toBeNull();
    expect(bessie.sprites.count).toBe(1);
    expect(bessie.shadows.count).toBe(1);
    expect(bessie.sprites.mesh.count).toBe(1);

    bessie.update({ xM: 7, yM: 89, headingRad: Math.PI / 2 }, 30, true, 89);
    expect(bessie.bodyFrame).toBe('veh.sweeper:dented:h08:0');
    expect(bessie.brushFrame).toBe('veh.sweeper_brush:brush:h08:0');
    expect(bessie.sprites.count).toBe(2);
    expect(bessie.shadows.count).toBe(1);

    bessie.dispose();
    expect(bessie.group.children).toEqual([]);
  });

  it('refuses another atlas', async () => {
    const items = await atlas('items');
    expect(() => createBessieSprite(items, DENTED_BELOW_HP)).toThrow(/actors atlas/);
  });
});
