// SSP-102: the placeholder particles of src/render/fx.ts (ART_BIBLE §11; TECHNICAL_DESIGN §7.3, §12.5, §12.7). The
// pool's ring recycling past capacity, determinism under a fixed render seed, each emitter's rules (dust backwards
// and outwards from the brush, splash droplets never ahead of the front axle and never moving forwards, sparkles
// twinkling 16/07), the Clean Sweep sparkles, the bus wiring, the render-time maths, the one-draw material, and the
// no-allocation source scan of the marked regions (the heap delta is tests/unit/fxHeap.test.ts). No WebGL.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type InstancedBufferAttribute, type ShaderMaterial, Texture } from 'three';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/app/events.ts';
import {
  DUST,
  FX_CAPACITY,
  FX_COLOUR,
  FX_INSTANCE_STRIDE,
  FX_RENDER_ORDER,
  type FxBessieView,
  FxParticles,
  fxRenderSeed,
  SPARKLE,
  SPLASH,
} from '../../src/render/fx.ts';
import { DepthLayer } from '../../src/render/worldMaterial.ts';
import { TILE_M } from '../../src/sim/constants.ts';
import { POWERUP_IDS } from '../../src/sim/entities.ts';
import { createEventQueue, EV, pushEvent, resetEvents, sealEvents } from '../../src/sim/eventQueue.ts';
import type { Frontage } from '../../src/sim/map.ts';
import { hash32 } from '../../src/sim/rng.ts';
import { DEFAULT_TUNING } from '../../src/sim/tuning.ts';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BODY = DEFAULT_TUNING.vehicle.sweeper.body;

/** Bessie at (x, y) facing `headingRad` (0 = north, clockwise). */
function bessieAt(x: number, y: number, headingRad: number): FxBessieView {
  return { xM: x, yM: y, headingRad };
}

/** Forward and right unit vectors for a heading. */
function axes(headingRad: number): { fx: number; fy: number; rx: number; ry: number } {
  const fx = Math.sin(headingRad);
  const fy = -Math.cos(headingRad);
  return { fx, fy, rx: -fy, ry: fx };
}

/** Live slots (spawned, any age): indices whose lifeTicks is set. */
function slots(fx: FxParticles): number[] {
  const out: number[] = [];
  for (let i = 0; i < fx.capacity; i++) if ((fx.lifeTicks[i] as number) > 0) out.push(i);
  return out;
}

/** The drawn particles of the last update(), as { x, y, size, colour }. */
function drawn(fx: FxParticles): { x: number; y: number; size: number; colour: number }[] {
  const d = fx.instanceData;
  const out = [];
  for (let k = 0; k < fx.drawn; k++) {
    const o = k * FX_INSTANCE_STRIDE;
    out.push({
      x: d[o] as number,
      y: d[o + 1] as number,
      size: d[o + 2] as number,
      colour: d[o + 3] as number,
    });
  }
  return out;
}

describe('the pool', () => {
  it('starts empty and draws nothing (count 0: three skips the draw)', () => {
    const fx = new FxParticles();
    expect(fx.capacity).toBe(FX_CAPACITY);
    expect(fx.update(100, 0.5)).toBe(0);
    expect(fx.mesh.count).toBe(0);
    expect(fx.spawned).toBe(0);
  });

  it('emitting past capacity recycles the oldest particles, in spawn order, without growing', () => {
    const capacity = 8;
    const fx = new FxParticles({ capacity, seed: 1 });
    const data = fx.instanceData;
    const columns = [fx.bornTick, fx.lifeTicks, fx.x0, fx.y0, fx.vx, fx.vy, fx.sizePx, fx.colourA];
    // Sparkle bursts at ticks 0, 1, 2, ...: 1 core + 5 points each, so tick t's particles are spawns 6t .. 6t + 5.
    const perBurst = 1 + SPARKLE.particles;
    const bursts = 5;
    for (let t = 0; t < bursts; t++) fx.sparkle({ tick: t, x: t, y: 0 });
    expect(fx.spawned).toBe(bursts * perBurst);
    // The same typed arrays: nothing was reallocated.
    expect(fx.instanceData).toBe(data);
    expect([fx.bornTick, fx.lifeTicks, fx.x0, fx.y0, fx.vx, fx.vy, fx.sizePx, fx.colourA]).toEqual(columns);
    for (const c of columns) expect(c.length).toBe(capacity);
    // Exactly the last `capacity` spawns survive: spawn s lives in slot s mod capacity.
    const total = bursts * perBurst;
    for (let s = total - capacity; s < total; s++) {
      expect(fx.bornTick[s % capacity], `spawn ${s}`).toBe(Math.floor(s / perBurst));
    }
    // The oldest bursts (ticks 0..2) are gone entirely.
    expect(Array.from(fx.bornTick).filter((t) => t < 3)).toEqual([]);
    // Drawing all of them fits the capacity-sized buffer.
    expect(fx.update(bursts, 0)).toBeLessThanOrEqual(capacity);
  });

  it('is deterministic under a fixed render seed, and the seed is the run seed ^ hash32("render.fx")', () => {
    expect(fxRenderSeed(1)).toBe((1 ^ hash32('render.fx')) >>> 0);
    expect(fxRenderSeed(0xffff_ffff)).toBe((0xffff_ffff ^ hash32('render.fx')) >>> 0);
    const run = (seed: number): number[] => {
      const fx = new FxParticles({ seed });
      const bessie = bessieAt(7, 72, 0);
      fx.splash({ tick: 10, x: 7, y: 71, speedMps: 6 }, bessie);
      fx.dust({ tick: 11, x: 7.85, y: 70.25, side: 1 }, bessie);
      fx.sparkle({ tick: 12, x: 9, y: 70 });
      fx.update(14, 0.5);
      return Array.from(fx.instanceData.subarray(0, fx.drawn * FX_INSTANCE_STRIDE));
    };
    const a = run(fxRenderSeed(1));
    expect(a.length).toBeGreaterThan(0);
    expect(run(fxRenderSeed(1))).toEqual(a);
    expect(run(fxRenderSeed(2))).not.toEqual(a);
  });
});

describe('render time', () => {
  it('draws a particle from age 0 (simTick = born + 1, alpha 0) until its lifetime, easing to rest', () => {
    const fx = new FxParticles({ seed: 3 });
    fx.sparkle({ tick: 20, x: 5, y: 6 });
    // Before the tick that emitted it has been rendered: nothing.
    expect(fx.update(20, 0.99)).toBe(0);
    // Age 0: every particle at its spawn point.
    const n = fx.update(21, 0);
    expect(n).toBe(1 + SPARKLE.particles);
    const at0 = drawn(fx);
    for (let k = 0; k < n; k++) {
      expect(at0[k]?.x).toBeCloseTo(fx.x0[k] as number, 5);
      expect(at0[k]?.y).toBeCloseTo(fx.y0[k] as number, 5);
    }
    // Ease-out: displacement v·t·(1 − t / 2T), so the last steps are shorter than the first.
    const i = 1;
    const life = fx.lifeTicks[i] as number;
    const posAt = (age: number): number => {
      fx.update(21 + age, 0);
      // Drawn in slot order, skipping the dead: slot i is drawn after the slots before it still alive.
      let index = 0;
      for (let j = 0; j < i; j++) if (age < (fx.lifeTicks[j] as number)) index++;
      return drawn(fx)[index]?.x ?? Number.NaN;
    };
    const first = Math.abs(posAt(1) - posAt(0));
    const last = Math.abs(posAt(life - 1) - posAt(life - 2));
    expect(first).toBeGreaterThan(last);
    const expected =
      (fx.x0[i] as number) + (fx.vx[i] as number) * ((life - 1) / 60) * (1 - (life - 1) / (2 * life));
    expect(posAt(life - 1)).toBeCloseTo(expected, 5);
    // Gone once its age reaches its lifetime; the core (8 ticks) went first.
    fx.update(21 + SPARKLE.lifeMaxTicks, 0);
    expect(fx.drawn).toBe(0);
    expect(fx.mesh.count).toBe(0);
  });

  it('the same tick and alpha give the same frame (a paused frame does not move)', () => {
    const fx = new FxParticles({ seed: 5 });
    fx.dust({ tick: 3, x: 1, y: 1, side: -1 }, bessieAt(0, 2, 0));
    fx.update(6, 0.4);
    const a = drawn(fx);
    fx.update(6, 0.4);
    expect(drawn(fx)).toEqual(a);
  });
});

describe('dust', () => {
  it.each([
    [0, 1],
    [0, -1],
    [Math.PI / 2, 1],
    [2.4, -1],
    [-1.1, 1],
  ] as const)(
    'heading %f, brush side %i: clumps outside the brush drift backwards and outwards',
    (h, side) => {
      const fx = new FxParticles({ seed: 11 });
      const { fx: fwdX, fy: fwdY, rx, ry } = axes(h);
      const bessie = bessieAt(40, 50, h);
      // The brush centre, as dirt.ts puts it: (±centreXM, centreYM) in vehicle-local axes.
      const brush = DEFAULT_TUNING.sweeping.gutterBrush;
      const bx = 40 + fwdX * brush.centreYM + rx * side * brush.centreXM;
      const by = 50 + fwdY * brush.centreYM + ry * side * brush.centreXM;
      for (let t = 0; t < 20; t++) fx.dust({ tick: t, x: bx, y: by, side }, bessie);
      const live = slots(fx);
      expect(live).toHaveLength(20 * DUST.particles);
      const colours = new Set<number>();
      for (const i of live) {
        const vF = (fx.vx[i] as number) * fwdX + (fx.vy[i] as number) * fwdY;
        const vOut = side * ((fx.vx[i] as number) * rx + (fx.vy[i] as number) * ry);
        expect(vF).toBeLessThanOrEqual(-DUST.backMinMps + 1e-9);
        expect(vOut).toBeGreaterThanOrEqual(DUST.outMinMps - 1e-9);
        // Spawned outside the brush on its side, so outside her body's width.
        const out = side * (((fx.x0[i] as number) - 40) * rx + ((fx.y0[i] as number) - 50) * ry);
        expect(out).toBeGreaterThan(BODY.widthM / 2);
        expect(fx.lifeTicks[i]).toBeGreaterThanOrEqual(DUST.lifeMinTicks);
        expect(fx.lifeTicks[i]).toBeLessThanOrEqual(DUST.lifeMaxTicks);
        expect([1, 2]).toContain(fx.sizePx[i]);
        colours.add(fx.colourA[i] as number);
      }
      expect([...colours].sort((a, b) => a - b)).toEqual([FX_COLOUR.slabDk, FX_COLOUR.slab, FX_COLOUR.kerb]);
    },
  );
});

describe('splash', () => {
  // Bessie's pose relative to the puddle as a crossing begins: the puddle centre from 2.4 m ahead (her front wheels
  // at its near edge) to under her rear axle, at any heading.
  const cases: [heading: number, aheadM: number, speedMps: number][] = [];
  for (const h of [0, Math.PI / 2, Math.PI, -2.2, 0.7]) {
    for (const ahead of [2.4, 1.6, 0.4, -1.0]) cases.push([h, ahead, ahead > 2 ? 6 : 3.4]);
  }

  it.each(cases)(
    'heading %f, puddle %f m ahead at %f m/s: no droplet ahead of the front axle, none moving forwards',
    (h, ahead, speed) => {
      const fx = new FxParticles({
        seed: 13,
        frontAxleM: BODY.frontAxleOffsetM,
        halfWidthM: BODY.widthM / 2,
      });
      const { fx: fwdX, fy: fwdY, rx, ry } = axes(h);
      const bessie = bessieAt(30, 30, h);
      const px = 30 + fwdX * ahead;
      const py = 30 + fwdY * ahead;
      fx.splash({ tick: 0, x: px, y: py, speedMps: speed }, bessie);
      const live = slots(fx);
      expect(live.length).toBe(
        Math.min(SPLASH.maxParticles, SPLASH.minParticles + Math.floor(speed * SPLASH.perMps)),
      );
      let left = 0;
      let right = 0;
      for (const i of live) {
        const f = ((fx.x0[i] as number) - 30) * fwdX + ((fx.y0[i] as number) - 30) * fwdY;
        const l = ((fx.x0[i] as number) - 30) * rx + ((fx.y0[i] as number) - 30) * ry;
        expect(f).toBeLessThanOrEqual(BODY.frontAxleOffsetM + 1e-9);
        // On a wheel line, within the jitter.
        expect(Math.abs(Math.abs(l) - BODY.widthM / 2)).toBeLessThanOrEqual(SPLASH.wheelJitterM + 1e-9);
        // Around the puddle: within its spread (forwards) and her half width (sideways) of its centre.
        expect(Math.hypot((fx.x0[i] as number) - px, (fx.y0[i] as number) - py)).toBeLessThan(2.5);
        const vF = (fx.vx[i] as number) * fwdX + (fx.vy[i] as number) * fwdY;
        const vL = (fx.vx[i] as number) * rx + (fx.vy[i] as number) * ry;
        expect(vF).toBeLessThanOrEqual(1e-9);
        // Thrown outwards, on the side it started.
        expect(Math.sign(vL)).toBe(Math.sign(l));
        if (l < 0) left++;
        else right++;
        expect([FX_COLOUR.spray, FX_COLOUR.sky, FX_COLOUR.chalk]).toContain(fx.colourA[i]);
        expect(fx.lifeTicks[i]).toBeLessThanOrEqual(SPLASH.lifeMaxTicks);
      }
      expect(left).toBeGreaterThan(0);
      expect(right).toBeGreaterThan(0);
      // Every drawn position, at every age, stays behind the front axle of the pose at the event.
      for (let t = 1; t <= SPLASH.lifeMaxTicks + 1; t++) {
        fx.update(t, 0.5);
        for (const p of drawn(fx)) {
          expect((p.x - 30) * fwdX + (p.y - 30) * fwdY).toBeLessThanOrEqual(BODY.frontAxleOffsetM + 1e-6);
        }
      }
    },
  );

  it('uses all three splash colours, 2×2 spray and 1 px chalk glints', () => {
    const fx = new FxParticles({ seed: 17 });
    for (let t = 0; t < 8; t++) fx.splash({ tick: t, x: 0, y: -2, speedMps: 6 }, bessieAt(0, 0, 0));
    const bySize = new Map<number, Set<number>>();
    for (const i of slots(fx)) {
      const size = fx.sizePx[i] as number;
      if (!bySize.has(size)) bySize.set(size, new Set());
      bySize.get(size)?.add(fx.colourA[i] as number);
    }
    expect([...(bySize.get(2) ?? [])].sort((a, b) => a - b)).toEqual([FX_COLOUR.sky, FX_COLOUR.spray]);
    expect([...(bySize.get(1) ?? [])]).toEqual([FX_COLOUR.chalk]);
  });
});

describe('sparkle', () => {
  it('a burst is a 2×2 chalk core plus 1 px points twinkling 16 ↔ 07 every 4 ticks', () => {
    const fx = new FxParticles({ seed: 19 });
    fx.sparkle({ tick: 0, x: 8, y: 8 });
    expect(fx.spawned).toBe(1 + SPARKLE.particles);
    expect([fx.sizePx[0], fx.colourA[0], fx.lifeTicks[0]]).toEqual([
      2,
      FX_COLOUR.chalk,
      SPARKLE.coreLifeTicks,
    ]);
    const seen = new Set<number>();
    for (let t = 1; t <= 9; t++) {
      fx.update(t, 0);
      for (const p of drawn(fx)) seen.add(p.colour);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([FX_COLOUR.chalk, FX_COLOUR.lemon]);
    for (let i = 1; i <= SPARKLE.particles; i++) {
      expect(fx.sizePx[i]).toBe(1);
      expect([fx.colourA[i], fx.colourB[i], fx.twinkleTicks[i]]).toEqual([
        FX_COLOUR.lemon,
        FX_COLOUR.chalk,
        4,
      ]);
      expect(Math.hypot((fx.x0[i] as number) - 8, (fx.y0[i] as number) - 8)).toBeLessThanOrEqual(
        SPARKLE.radiusMaxM,
      );
    }
    // A point's colour flips every twinkleTicks ticks of its age (plus its phase).
    const phase = fx.twinklePhase[1] as number;
    // Until the core dies at age 8 every particle is alive, so drawn index i is slot i.
    const colourAt = (age: number): number => {
      fx.update(1 + age, 0);
      return drawn(fx)[1]?.colour ?? -1;
    };
    for (let age = 0; age < 8; age++) {
      const expected = Math.floor((age + phase) / 4) % 2 === 1 ? FX_COLOUR.chalk : FX_COLOUR.lemon;
      expect(colourAt(age), `age ${age}`).toBe(expected);
    }
  });

  it("sparkles each frontage's zone once, the tick its Clean Sweep turns on", () => {
    const zone: Frontage = {
      id: 'fr_4_2',
      pledge: false,
      rect: [4, 2, 12, 4],
      face: 's',
      cells: Array.from({ length: 16 }, (_, k) => [4 + (k % 8), 2 + Math.floor(k / 8)] as [number, number]),
    };
    const tiny: Frontage = {
      id: 'fr_0_0',
      pledge: true,
      rect: [0, 0, 2, 1],
      face: 'n',
      cells: [
        [0, 0],
        [1, 0],
      ],
    };
    const fx = new FxParticles({ seed: 23, frontages: [zone, tiny] });
    const flags = new Uint8Array(2);
    fx.trackCleanSweeps(flags, 10);
    expect(fx.spawned).toBe(0);
    flags[0] = 1;
    fx.trackCleanSweeps(flags, 11);
    const perBurst = 1 + SPARKLE.particles;
    expect(fx.spawned).toBe(SPARKLE.cleanSweepBursts * perBurst);
    // The cores sit on cell centres spread over the zone (the middle of 4 equal runs of its row-major cells).
    const cores = [0, 1, 2, 3].map((b) => [fx.x0[b * perBurst], fx.y0[b * perBurst]]);
    expect(cores).toEqual(
      [2, 6, 10, 14].map((c) => [
        ((zone.cells[c]?.[0] ?? 0) + 0.5) * TILE_M,
        ((zone.cells[c]?.[1] ?? 0) + 0.5) * TILE_M,
      ]),
    );
    for (let b = 0; b < 4; b++) expect(fx.bornTick[b * perBurst]).toBe(11);
    // Staying swept sparkles nothing more; the two-cell zone gives two bursts.
    fx.trackCleanSweeps(flags, 12);
    expect(fx.spawned).toBe(4 * perBurst);
    flags[1] = 1;
    fx.trackCleanSweeps(flags, 13);
    expect(fx.spawned).toBe(6 * perBurst);
  });
});

describe('the bus', () => {
  it('EV.DustCloud, EV.Splash and EV.PowerUp emit, with Bessie read on drain; unsubscribing stops them', () => {
    const bus = new EventBus();
    const fx = new FxParticles({ seed: 29 });
    const bessie = { xM: 7, yM: 72, headingRad: 0 };
    const off = fx.attach(bus, bessie);
    const queue = createEventQueue();
    const drainTick = (tick: number): void => {
      resetEvents(queue, tick);
      pushEvent(queue, EV.DustCloud, -1, 7.85, 70.25, 1);
      pushEvent(queue, EV.Splash, 0, 7, 71, 6);
      pushEvent(queue, EV.PowerUp, 0, 111, 41, POWERUP_IDS.indexOf('pwr.flask_of_tea'));
      sealEvents(queue);
      bus.drain(queue);
    };
    drainTick(5);
    const splashCount = SPLASH.minParticles + Math.floor(6 * SPLASH.perMps);
    expect(fx.spawned).toBe(DUST.particles + splashCount + 1 + SPARKLE.particles);
    expect(Array.from(fx.bornTick.subarray(0, fx.spawned))).toEqual(new Array(fx.spawned).fill(5));
    // The dust drifted outwards on the right (east, +x, facing north) and backwards (south, +y).
    for (let i = 0; i < DUST.particles; i++) {
      expect(fx.vx[i]).toBeGreaterThan(0);
      expect(fx.vy[i]).toBeGreaterThan(0);
    }
    off();
    drainTick(6);
    expect(fx.spawned).toBe(DUST.particles + splashCount + 1 + SPARKLE.particles);
  });
});

describe('the draw', () => {
  it('is one instanced mesh on the fx layer after the items batch, mapping palette indices, writing no depth', () => {
    const fx = new FxParticles();
    const material = fx.mesh.material as ShaderMaterial;
    expect(fx.mesh.isInstancedMesh).toBe(true);
    expect(fx.mesh.renderOrder).toBe(FX_RENDER_ORDER);
    expect(FX_RENDER_ORDER).toBeGreaterThan(4); // ITEMS_RENDER_ORDER
    expect(fx.mesh.frustumCulled).toBe(false);
    expect(material.vertexShader).toContain(`applyDepthLayer(clip, ${DepthLayer.Fx}.0`);
    expect(material.depthTest).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.uniforms.uPalette?.value).toBeInstanceOf(Texture);
    expect(fx.mesh.geometry.getAttribute('particle').itemSize).toBe(FX_INSTANCE_STRIDE);
    // Colours are palette indices, never RGB: every effect's colours are in 0..31.
    for (const index of Object.values(FX_COLOUR)) expect(index).toBeGreaterThanOrEqual(0);
    for (const index of Object.values(FX_COLOUR)) expect(index).toBeLessThan(32);
    fx.dispose();
  });

  it('publishes once per frame: the live count and one needsUpdate', () => {
    const fx = new FxParticles({ seed: 31 });
    const attribute = fx.mesh.geometry.getAttribute('particle') as InstancedBufferAttribute;
    const version = attribute.version;
    fx.sparkle({ tick: 0, x: 0, y: 0 });
    expect(fx.update(1, 0)).toBe(1 + SPARKLE.particles);
    expect(fx.mesh.count).toBe(1 + SPARKLE.particles);
    expect(attribute.version).toBe(version + 1);
  });
});

describe('no allocation in the marked regions', () => {
  const NEW_RE = /\bnew\s+[A-Za-z_$]/;
  const ARRAY_LITERAL_RE = /(?:[=(,?:]|\breturn)\s*\[/;
  const OBJECT_LITERAL_RE = /(?:[=(,?:]|\breturn)\s*\{/;
  const source = readFileSync(`${REPO_ROOT}src/render/fx.ts`, 'utf8');
  const regions = (begin: string, end: string): string[] =>
    source
      .split(begin)
      .slice(1)
      .map((part) => {
        const stop = part.indexOf(end);
        if (stop < 0) throw new Error(`unterminated region ${begin}`);
        return part.slice(0, stop);
      });

  it.each([
    ['// emitters: begin', '// emitters: end'],
    ['// per-frame draw path: begin', '// per-frame draw path: end'],
  ])('%s: no `new`, array or object literals, no closures', (begin, end) => {
    const found = regions(begin, end);
    expect(found).toHaveLength(1);
    for (const region of found) {
      const lines = region
        .split('\n')
        .filter(
          (l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/**'),
        );
      expect(lines.filter((l) => NEW_RE.test(l))).toEqual([]);
      expect(lines.filter((l) => ARRAY_LITERAL_RE.test(l))).toEqual([]);
      expect(lines.filter((l) => OBJECT_LITERAL_RE.test(l))).toEqual([]);
      expect(lines.filter((l) => /=>/.test(l))).toEqual([]);
    }
  });
});
