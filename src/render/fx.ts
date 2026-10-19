// Placeholder runtime particles for dust, puddle splashes and sparkles (SSP-102; ART_BIBLE §11, TECHNICAL_DESIGN
// §12.5, §12.7). Until the M4 procedural fx frames exist (SSP-154), each effect is a handful of 1×1 or 2×2 px
// quads in palette colours, chunky, few and short, with no ink outline:
//
//   dust     EV.DustCloud (dirt.ts stepDust, SSP-095): 3 clumps per cloud in 06 kerb / 05 slab round a 04 slab_dk
//            core, spawned just outside the brush that puffed it and drifting backwards and outwards on that side
//            (Bessie's heading on the event's tick), so they never cover her front;
//   splash   EV.Splash (npc/splash.ts, SSP-094): 10–16 droplets in 28 spray / 27 sky with 07 chalk glints, from the
//            puddle's footprint at her wheel lines, thrown sideways and backwards (never forwards). A droplet that
//            would start ahead of her front axle starts just behind it, so no droplet is ever in front of Bessie;
//   sparkle  EV.PowerUp (pickups.ts, SSP-096) at the pickup, and a frontage's Clean Sweep (tidy.ts, SSP-064: no
//            event exists, so trackCleanSweeps reads the read-only `cleanSwept` flags after each tick and sparkles
//            up to 4 points spread over the zone's cells the tick one turns on): 5 points twinkling 16 lemon ↔ 07
//            chalk every 4 ticks round a short-lived 2×2 chalk core.
//
// Pool. A fixed capacity (FX_CAPACITY) of particle slots in typed struct-of-arrays columns, written by a ring
// cursor: every spawn takes the next slot, so once more particles are emitted than the pool holds, the oldest
// spawned are recycled first. Nothing is allocated after construction (tests/unit/fxHeap.test.ts measures it).
//
// Time. A particle stores its birth tick (the event's tick), not a clock: it is drawn at age
// `(simTick − 1 + alpha) − bornTick` ticks, where simTick is the World tick the next step will run, so the
// render-side picture is a pure function of the sim's tick, the render alpha and the events seen. Paused (same tick
// and alpha) nothing moves; test mode's step(n) gives the same frame on every run. Motion eases out: the
// displacement is v · t · (1 − t / 2T) for age t of a lifetime T, so a particle slows to rest as it dies.
//
// Randomness. Every jitter comes from a render-side sfc32 seeded with fxRenderSeed(runSeed) = runSeed ^
// hash32('render.fx') (TECHNICAL_DESIGN §7.3): never a sim stream, so particles cannot change a replay.
//
// Draw. All particles are ONE instanced draw (slot 6, "FX + light cookies", of TECHNICAL_DESIGN §12.7) on depth
// layer 10 (DepthLayer.Fx) at y = 0: one Float32 instance attribute (x, y metres, size px, palette index) sized
// once, one needsUpdate per frame and count = the live particles, so with none alive three skips the draw and every
// frame without effects is unchanged. Corners sit on the 1/16 m pixel grid (the anchor rounds like a sprite's), so
// each particle is a crisp 1×1 or 2×2 block. The fragment shader looks the colour up by index in the palette
// texture; the mask is written (0, 0) like an actor's, so particles are never darkened by a shadow under them.
// Depth-tested against walls and roofs (which hide them), no depth write.
//
// Render-only: the emitters read the decoded bus events and Bessie's pose; nothing here writes sim state.
import {
  BufferAttribute,
  BufferGeometry,
  type DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  GLSL3,
  InstancedBufferAttribute,
  InstancedMesh,
  NoBlending,
  ShaderMaterial,
} from 'three';
import type { EventBus, Unsubscribe } from '../app/events.ts';
import { PX_PER_M, TILE_M } from '../sim/constants.ts';
import { EV } from '../sim/eventQueue.ts';
import type { Frontage } from '../sim/map.ts';
import { hash32, nextU32, type Sfc32, sfc32 } from '../sim/rng.ts';
import { createPaletteTexture, KERBSIDE32, type Kerbside32 } from './palettePass.ts';
import { DEPTH_LAYER_GLSL, DepthLayer, WORLD_OUTPUTS_GLSL } from './worldMaterial.ts';

/** Particle slots in the pool (a busy frame needs about 60: two brushes of dust, a splash and a sparkle). */
export const FX_CAPACITY = 256;

/** Render order of the fx draw: after the items batch (4), so it is the last world draw. */
export const FX_RENDER_ORDER = 5;

/** Name hashed into the render-side seed (TECHNICAL_DESIGN §7.3); not a sim stream. */
export const FX_RENDER_STREAM = 'render.fx';

/** The fx generator's seed for a run seed: runSeed ^ hash32('render.fx'), uint32. */
export function fxRenderSeed(runSeed: number): number {
  return (runSeed ^ hash32(FX_RENDER_STREAM)) >>> 0;
}

/** Palette indices the placeholder effects use (ART_BIBLE §5, §11). */
export const FX_COLOUR = {
  /** 04 slab_dk: the dust core. */
  slabDk: 4,
  /** 05 slab: dust. */
  slab: 5,
  /** 06 kerb: dust. */
  kerb: 6,
  /** 07 chalk: splash glints, sparkle. */
  chalk: 7,
  /** 16 lemon: sparkle. */
  lemon: 16,
  /** 27 sky: splash. */
  sky: 27,
  /** 28 spray: splash. */
  spray: 28,
} as const;

/** Ticks per second (the fixed 60 Hz step). */
const TICK_HZ = 60;

/** Dust per EV.DustCloud (fx.dust_puff: 6 frames × 5 ticks, so at most 30 ticks). */
export const DUST = {
  particles: 3,
  lifeMinTicks: 22,
  lifeMaxTicks: 30,
  /** Spawn: this far outside the brush centre, on its side, ± spawnJitterM along her heading. */
  spawnOutMinM: 0.15,
  spawnOutMaxM: 0.45,
  spawnJitterM: 0.2,
  /** Drift relative to the ground: backwards and outwards, metres per second. */
  backMinMps: 0.8,
  backMaxMps: 1.6,
  outMinMps: 0.4,
  outMaxMps: 1.0,
} as const;

/** Droplets per EV.Splash (fx.splash: 6 frames × 4 ticks, so at most 24 ticks). */
export const SPLASH = {
  minParticles: 10,
  maxParticles: 16,
  /** Droplets per m/s of |vLong| above minParticles (a 6 m/s crossing throws 13). */
  perMps: 0.5,
  lifeMinTicks: 14,
  lifeMaxTicks: 24,
  /** Spawn jitter round the puddle centre along her heading (the puddle tile is 2 m). */
  spreadM: 0.7,
  /**
   * A droplet that would start ahead of her front axle starts up to this far behind it instead (spread along the
   * wheels in the water, not stacked on one line).
   */
  trailM: 0.6,
  /** Spawn: at a wheel line, this far either side of it. */
  wheelJitterM: 0.15,
  /** Throw speed range at 6 m/s, scaled by |vLong| / 6 within [0.75, 1.5]. */
  speedMinMps: 2.0,
  speedMaxMps: 4.0,
  /** Throw direction: sideways, turned up to this far backwards (radians), never forwards. */
  maxBackRad: (70 * Math.PI) / 180,
} as const;

/** Points per sparkle burst (fx.sparkle: 4 frames × 4 ticks, so about 16 ticks). */
export const SPARKLE = {
  particles: 5,
  lifeMinTicks: 12,
  lifeMaxTicks: 18,
  coreLifeTicks: 8,
  radiusMaxM: 0.35,
  speedMinMps: 0.3,
  speedMaxMps: 0.8,
  /** 16 ↔ 07 every this many ticks. */
  twinkleTicks: 4,
  /** Sparkle bursts spread over a frontage's zone on its Clean Sweep. */
  cleanSweepBursts: 4,
} as const;

/** Bessie's pose as the emitters read it (VehicleState satisfies it). */
export type FxBessieView = {
  readonly xM: number;
  readonly yM: number;
  readonly headingRad: number;
};

/** What a dust emitter reads (an EV.DustCloud payload satisfies it). */
export type FxDustSource = {
  readonly tick: number;
  readonly x: number;
  readonly y: number;
  readonly side: -1 | 1;
};

/** What a splash emitter reads (an EV.Splash payload satisfies it). */
export type FxSplashSource = {
  readonly tick: number;
  readonly x: number;
  readonly y: number;
  readonly speedMps: number;
};

/** What a sparkle emitter reads (an EV.PowerUp payload satisfies it). */
export type FxPointSource = { readonly tick: number; readonly x: number; readonly y: number };

export type FxParticlesOptions = {
  /** Particle slots (default FX_CAPACITY). */
  readonly capacity?: number;
  /** The render-side generator's seed (default fxRenderSeed(0)). */
  readonly seed?: number;
  /**
   * Bessie's front axle ahead of her body centre, metres (tuning.json body.frontAxleOffsetM, default 1.2): no
   * splash droplet starts ahead of it.
   */
  readonly frontAxleM?: number;
  /** Her half width, metres (tuning.json body.widthM / 2, default 0.875): the wheel lines droplets start on. */
  readonly halfWidthM?: number;
  /** The level's frontages, for the Clean Sweep sparkles (default none). */
  readonly frontages?: readonly Frontage[];
  /** Palette the draw maps indices through (default Kerbside-32). */
  readonly palette?: Kerbside32;
};

/** Floats per instance: x, y (sim metres), size (px), palette index. */
export const FX_INSTANCE_STRIDE = 4;

const FX_VERTEX = /* glsl */ `
${DEPTH_LAYER_GLSL}
in vec4 particle;
flat out int vColour;
const float PX_PER_M = ${PX_PER_M}.0;
void main() {
  float size = particle.z;
  vec2 anchorPx = floor(particle.xy * PX_PER_M + 0.5);
  vec2 cornerPx = anchorPx - floor(size * 0.5) + position.xz * size;
  vec2 groundM = cornerPx / PX_PER_M;
  vec4 clip = projectionMatrix * viewMatrix * vec4(groundM.x, 0.0, groundM.y, 1.0);
  gl_Position = applyDepthLayer(clip, ${DepthLayer.Fx}.0, 0.0);
  vColour = int(particle.w + 0.5);
}
`;

const FX_FRAGMENT = /* glsl */ `
precision highp float;
precision highp int;
uniform highp sampler2D uPalette;
flat in int vColour;
${WORLD_OUTPUTS_GLSL}
void main() {
  outColour = vec4(texelFetch(uPalette, ivec2(vColour, 0), 0).rgb, 1.0);
  outMask = vec4(0.0);
}
`;

/** 2^-32: a uint32 onto [0, 1). */
const UNIT = 1 / 4294967296;

/** The particle pool and its one instanced draw. Attach it to the bus, call update() once per rendered frame. */
export class FxParticles {
  readonly capacity: number;
  readonly mesh: InstancedMesh;
  /** The render-side generator (never a sim stream). */
  readonly rng: Sfc32;
  // Particle columns, slot i in each. A slot with lifeTicks 0 was never used.
  readonly bornTick: Float64Array;
  readonly lifeTicks: Float64Array;
  readonly x0: Float64Array;
  readonly y0: Float64Array;
  readonly vx: Float64Array;
  readonly vy: Float64Array;
  readonly sizePx: Uint8Array;
  readonly colourA: Uint8Array;
  readonly colourB: Uint8Array;
  /** Ticks between colourA and colourB (0: no twinkle); the phase offset in ticks. */
  readonly twinkleTicks: Uint8Array;
  readonly twinklePhase: Uint8Array;
  /** Particles spawned since construction (the ring cursor is spawned mod capacity). */
  spawned = 0;
  /** Particles drawn by the last update(). */
  drawn = 0;
  private readonly frontAxleM: number;
  private readonly halfWidthM: number;
  private readonly data: Float32Array;
  private readonly attribute: InstancedBufferAttribute;
  private readonly palette: DataTexture;
  /** The particle being spawned: x, y, vx, vy (a typed slot, so no fresh double crosses a call). */
  private readonly s = new Float64Array(4);
  /** Uniform draws for the particle being spawned (roll()). */
  private readonly u = new Float64Array(8);
  /** The centre of the sparkle burst being spawned: x, y. */
  private readonly centre = new Float64Array(2);
  /** Clean Sweep: per frontage, its burst points (x, y metres, SPARKLE.cleanSweepBursts each) and seen flag. */
  private readonly sweepX: Float64Array;
  private readonly sweepY: Float64Array;
  private readonly sweepPoints: Uint8Array;
  private readonly sweepSeen: Uint8Array;

  constructor(options: FxParticlesOptions = {}) {
    const capacity = options.capacity ?? FX_CAPACITY;
    if (!Number.isInteger(capacity) || capacity < 1) throw new Error(`fx particle capacity ${capacity}`);
    this.capacity = capacity;
    this.rng = sfc32(options.seed ?? fxRenderSeed(0));
    this.frontAxleM = options.frontAxleM ?? 1.2;
    this.halfWidthM = options.halfWidthM ?? 0.875;
    this.bornTick = new Float64Array(capacity);
    this.lifeTicks = new Float64Array(capacity);
    this.x0 = new Float64Array(capacity);
    this.y0 = new Float64Array(capacity);
    this.vx = new Float64Array(capacity);
    this.vy = new Float64Array(capacity);
    this.sizePx = new Uint8Array(capacity);
    this.colourA = new Uint8Array(capacity);
    this.colourB = new Uint8Array(capacity);
    this.twinkleTicks = new Uint8Array(capacity);
    this.twinklePhase = new Uint8Array(capacity);

    const frontages = options.frontages ?? [];
    const bursts = SPARKLE.cleanSweepBursts;
    this.sweepX = new Float64Array(frontages.length * bursts);
    this.sweepY = new Float64Array(frontages.length * bursts);
    this.sweepPoints = new Uint8Array(frontages.length);
    this.sweepSeen = new Uint8Array(frontages.length);
    frontages.forEach((frontage, f) => {
      const cells = frontage.cells;
      const n = Math.min(bursts, cells.length);
      this.sweepPoints[f] = n;
      for (let k = 0; k < n; k++) {
        // Evenly spread over the zone's row-major cells: the middle of each of n equal runs.
        const cell = cells[Math.floor(((k + 0.5) * cells.length) / n)];
        if (cell === undefined) continue;
        this.sweepX[f * bursts + k] = (cell[0] + 0.5) * TILE_M;
        this.sweepY[f * bursts + k] = (cell[1] + 0.5) * TILE_M;
      }
    });

    this.data = new Float32Array(capacity * FX_INSTANCE_STRIDE);
    this.attribute = new InstancedBufferAttribute(this.data, FX_INSTANCE_STRIDE);
    this.attribute.setUsage(DynamicDrawUsage);
    const geometry = new BufferGeometry();
    // A unit quad in the XZ plane (position.xz 0..1), as the sprite batches use.
    geometry.setAttribute(
      'position',
      new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1]), 3),
    );
    geometry.setIndex([0, 2, 1, 1, 2, 3]);
    geometry.setAttribute('particle', this.attribute);
    this.palette = createPaletteTexture(options.palette ?? KERBSIDE32);
    const material = new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: FX_VERTEX,
      fragmentShader: FX_FRAGMENT,
      blending: NoBlending,
      side: DoubleSide,
      depthTest: true,
      depthWrite: false,
      uniforms: { uPalette: { value: this.palette } },
    });
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.name = 'fx';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = FX_RENDER_ORDER;
    this.mesh.count = 0;
  }

  /** The instance data (FX_INSTANCE_STRIDE floats per drawn particle); read-only, for tests. */
  get instanceData(): Float32Array {
    return this.data;
  }

  /**
   * Subscribes the emitters to the bus: EV.DustCloud → dust, EV.Splash → splash, EV.PowerUp → sparkle. `bessie` is
   * read when an event arrives (the bus drains right after the tick, so it holds that tick's pose).
   */
  attach(bus: EventBus, bessie: FxBessieView): Unsubscribe {
    const offDust = bus.on(EV.DustCloud, (event) => this.dust(event, bessie));
    const offSplash = bus.on(EV.Splash, (event) => this.splash(event, bessie));
    const offPowerUp = bus.on(EV.PowerUp, (event) => this.sparkle(event));
    return () => {
      offDust();
      offSplash();
      offPowerUp();
    };
  }

  // emitters: begin (no allocation; tests/unit/fxHeap.test.ts)
  /**
   * Fills u[0 .. n − 1] with uniform draws in [0, 1) from the render-side generator. The draws land in a typed
   * array rather than coming back as return values: a large emitter does not inline every call, and a double
   * returned from a call that is not inlined is boxed (a heap allocation per draw).
   */
  private roll(n: number): void {
    const u = this.u;
    for (let i = 0; i < n; i++) u[i] = nextU32(this.rng) * UNIT;
  }

  /**
   * Takes the next ring slot for the particle in `this.s` (x, y, vx, vy), born on `tick`, recycling the oldest
   * spawned particle once the pool is full.
   */
  private place(
    tick: number,
    lifeTicks: number,
    sizePx: number,
    colourA: number,
    colourB: number,
    twinkle: number,
    phase: number,
  ): void {
    const i = this.spawned % this.capacity;
    const s = this.s;
    this.bornTick[i] = tick;
    this.lifeTicks[i] = lifeTicks;
    this.x0[i] = s[0] as number;
    this.y0[i] = s[1] as number;
    this.vx[i] = s[2] as number;
    this.vy[i] = s[3] as number;
    this.sizePx[i] = sizePx;
    this.colourA[i] = colourA;
    this.colourB[i] = colourB;
    this.twinkleTicks[i] = twinkle;
    this.twinklePhase[i] = phase;
    this.spawned += 1;
  }

  /** A dust cloud at a brush: 3 clumps outside it, drifting backwards and outwards on its side. */
  dust(event: FxDustSource, bessie: FxBessieView): void {
    const h = bessie.headingRad;
    const fx = Math.sin(h);
    const fy = -Math.cos(h);
    // The brush's outward direction: side × right, right = (cos h, sin h).
    const ox = event.side * -fy;
    const oy = event.side * fx;
    const s = this.s;
    const u = this.u;
    for (let k = 0; k < DUST.particles; k++) {
      this.roll(6);
      const out = DUST.spawnOutMinM + (DUST.spawnOutMaxM - DUST.spawnOutMinM) * (u[0] as number);
      const along = DUST.spawnJitterM * (2 * (u[1] as number) - 1);
      const back = DUST.backMinMps + (DUST.backMaxMps - DUST.backMinMps) * (u[2] as number);
      const away = DUST.outMinMps + (DUST.outMaxMps - DUST.outMinMps) * (u[3] as number);
      s[0] = event.x + ox * out + fx * along;
      s[1] = event.y + oy * out + fy * along;
      s[2] = ox * away - fx * back;
      s[3] = oy * away - fy * back;
      const life = (DUST.lifeMinTicks + (DUST.lifeMaxTicks - DUST.lifeMinTicks + 1) * (u[4] as number)) | 0;
      // The first clump is the 04 core; the others 06 or 05, the last of them a 1 px wisp.
      const colour = k === 0 ? FX_COLOUR.slabDk : (u[5] as number) < 0.5 ? FX_COLOUR.kerb : FX_COLOUR.slab;
      this.place(event.tick, life, k === DUST.particles - 1 ? 1 : 2, colour, colour, 0, 0);
    }
  }

  /**
   * A puddle splash: droplets from the puddle's footprint at Bessie's wheel lines, thrown sideways and backwards.
   * None starts ahead of her front axle and none moves forwards, so none is ever in front of her.
   */
  splash(event: FxSplashSource, bessie: FxBessieView): void {
    const h = bessie.headingRad;
    const fx = Math.sin(h);
    const fy = -Math.cos(h);
    const rx = -fy;
    const ry = fx;
    const speed = event.speedMps;
    const extra = (speed * SPLASH.perMps) | 0;
    const count = Math.min(SPLASH.maxParticles, SPLASH.minParticles + extra);
    const scaleRaw = speed / 6;
    const scale = scaleRaw < 0.75 ? 0.75 : scaleRaw > 1.5 ? 1.5 : scaleRaw;
    // The puddle centre in her frame: forward and right of her body centre.
    const dx = event.x - bessie.xM;
    const dy = event.y - bessie.yM;
    const centreF = dx * fx + dy * fy;
    const s = this.s;
    const u = this.u;
    const frontAxle = this.frontAxleM;
    const halfWidth = this.halfWidthM;
    for (let k = 0; k < count; k++) {
      this.roll(7);
      const side = (k & 1) === 0 ? 1 : -1;
      const f = Math.min(
        frontAxle - SPLASH.trailM * (u[0] as number),
        centreF + SPLASH.spreadM * (2 * (u[1] as number) - 1),
      );
      const l = side * (halfWidth + SPLASH.wheelJitterM * (2 * (u[2] as number) - 1));
      const turn = SPLASH.maxBackRad * (u[3] as number);
      const v = (SPLASH.speedMinMps + (SPLASH.speedMaxMps - SPLASH.speedMinMps) * (u[4] as number)) * scale;
      const vSide = Math.cos(turn) * v * side;
      const vBack = Math.sin(turn) * v;
      s[0] = bessie.xM + fx * f + rx * l;
      s[1] = bessie.yM + fy * f + ry * l;
      s[2] = rx * vSide - fx * vBack;
      s[3] = ry * vSide - fy * vBack;
      const life =
        (SPLASH.lifeMinTicks + (SPLASH.lifeMaxTicks - SPLASH.lifeMinTicks + 1) * (u[5] as number)) | 0;
      // Mostly 2×2 spray, some sky, and every fourth a 1 px chalk glint.
      if ((k & 3) === 3) this.place(event.tick, life, 1, FX_COLOUR.chalk, FX_COLOUR.chalk, 0, 0);
      else {
        const colour = (u[6] as number) < 0.65 ? FX_COLOUR.spray : FX_COLOUR.sky;
        this.place(event.tick, life, 2, colour, colour, 0, 0);
      }
    }
  }

  /** A sparkle burst at (event.x, event.y): twinkling 16/07 points round a short 2×2 chalk core. */
  sparkle(event: FxPointSource): void {
    const c = this.centre;
    c[0] = event.x;
    c[1] = event.y;
    this.sparkleBurst(event.tick);
  }

  /** A sparkle burst round `this.centre`, born on `tick`. */
  private sparkleBurst(tick: number): void {
    const s = this.s;
    const x = this.centre[0] as number;
    const y = this.centre[1] as number;
    s[0] = x;
    s[1] = y;
    s[2] = 0;
    s[3] = 0;
    this.place(tick, SPARKLE.coreLifeTicks, 2, FX_COLOUR.chalk, FX_COLOUR.chalk, 0, 0);
    const u = this.u;
    for (let k = 0; k < SPARKLE.particles; k++) {
      this.roll(5);
      const a = 2 * Math.PI * (u[0] as number);
      const r = SPARKLE.radiusMaxM * (u[1] as number);
      const v = SPARKLE.speedMinMps + (SPARKLE.speedMaxMps - SPARKLE.speedMinMps) * (u[2] as number);
      const cx = Math.cos(a);
      const cy = Math.sin(a);
      s[0] = x + cx * r;
      s[1] = y + cy * r;
      s[2] = cx * v;
      s[3] = cy * v;
      const life =
        (SPARKLE.lifeMinTicks + (SPARKLE.lifeMaxTicks - SPARKLE.lifeMinTicks + 1) * (u[3] as number)) | 0;
      const phase = (2 * SPARKLE.twinkleTicks * (u[4] as number)) | 0;
      this.place(tick, life, 1, FX_COLOUR.lemon, FX_COLOUR.chalk, SPARKLE.twinkleTicks, phase);
    }
  }

  /**
   * Sparkles each frontage whose Clean Sweep turned on since the last call (`cleanSwept`: TidyView.cleanSwept,
   * in frontage order), born on `tick`, the tick that just ran. Call after every World tick.
   */
  trackCleanSweeps(cleanSwept: ArrayLike<number>, tick: number): void {
    const seen = this.sweepSeen;
    const bursts = SPARKLE.cleanSweepBursts;
    for (let f = 0; f < seen.length; f++) {
      const now = cleanSwept[f] === 1 ? 1 : 0;
      if (now === 1 && seen[f] === 0) {
        const n = this.sweepPoints[f] as number;
        for (let k = 0; k < n; k++) {
          this.centre[0] = this.sweepX[f * bursts + k] as number;
          this.centre[1] = this.sweepY[f * bursts + k] as number;
          this.sparkleBurst(tick);
        }
      }
      seen[f] = now;
    }
  }
  // emitters: end

  // per-frame draw path: begin
  /**
   * Writes every particle alive at render time (simTick − 1 + alpha) into the instance buffer and publishes it:
   * the draw count plus one needsUpdate. `simTick` is the World tick the next step runs (World.tick). Returns
   * the particles drawn.
   */
  update(simTick: number, alpha: number): number {
    const now = simTick - 1 + alpha;
    const d = this.data;
    const cap = this.capacity;
    let n = 0;
    for (let i = 0; i < cap; i++) {
      const life = this.lifeTicks[i] as number;
      if (life === 0) continue;
      const age = now - (this.bornTick[i] as number);
      if (age < 0 || age >= life) continue;
      const k = (age / TICK_HZ) * (1 - (0.5 * age) / life);
      const twinkle = this.twinkleTicks[i] as number;
      let colour = this.colourA[i] as number;
      if (twinkle > 0 && (Math.floor((age + (this.twinklePhase[i] as number)) / twinkle) & 1) === 1) {
        colour = this.colourB[i] as number;
      }
      const o = n * FX_INSTANCE_STRIDE;
      d[o] = (this.x0[i] as number) + (this.vx[i] as number) * k;
      d[o + 1] = (this.y0[i] as number) + (this.vy[i] as number) * k;
      d[o + 2] = this.sizePx[i] as number;
      d[o + 3] = colour;
      n++;
    }
    this.drawn = n;
    this.mesh.count = n;
    this.attribute.needsUpdate = true;
    return n;
  }
  // per-frame draw path: end

  /** Releases the GPU buffers, the material and its palette texture. */
  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
    this.palette.dispose();
  }
}
