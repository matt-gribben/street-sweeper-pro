// sfc32 known-answer tests and stream rules (TECHNICAL_DESIGN §7.3).
//
// Known-answer vectors come from the reference sfc32 in PractRand 0.95 by Chris Doty-Humphrey,
// src/RNGs/sfc.cpp (`PractRand::RNGs::Raw::sfc32::raw32`, `seed(Uint64)` and `seed(Uint32, Uint32, Uint32)`;
// file SHA-256 0e823785b6c687499db2372757e5beb148549ebb1911a898fdb76644ffd6e15f, as mirrored on GitHub at
// MartyMacGyver/PractRand). Those functions were copied verbatim into a C++17 harness, built with Apple
// clang and run on 2026-10-19; each vector is the state after seeding, then the first 12 raw32() outputs.
import { describe, expect, it } from 'vitest';
import {
  createStream,
  hash32,
  NEXT_INT_MAX,
  nextFloat,
  nextInt,
  nextRange,
  nextU32,
  RNG_STREAMS,
  type Sfc32,
  sfc32,
  sfc32FromWords,
} from '../../src/sim/rng.ts';
import { assertHeapDeltaWithinThresholds, measureHeapDelta } from '../support/heapDelta.ts';

type Vector = { state: Sfc32; outputs: number[] };

/** PractRand `sfc32::seed(Uint64 s)` vectors, keyed by the 64-bit seed as [low word, high word]. */
const SEED64_VECTORS: { seed: [number, number]; vector: Vector }[] = [
  {
    seed: [0, 0],
    vector: {
      state: { a: 0xc3effe89, b: 0x8d56782d, c: 0xf149b0c0, counter: 13 },
      outputs: [
        0x514676c3, 0x08a809df, 0x30349d2b, 0xfb52c520, 0x38802be1, 0x948279e6, 0xec4bf1d9, 0x7cb0a909,
        0xfad8b4a8, 0x3ca4b808, 0x3821b4c5, 0x5e7023ca,
      ],
    },
  },
  {
    seed: [1, 0],
    vector: {
      state: { a: 0x2b44d33d, b: 0x4caa23da, c: 0xcb016c7b, counter: 13 },
      outputs: [
        0x77eef724, 0x6f99472c, 0x65c86823, 0x6a161a47, 0x78c8aace, 0x63091598, 0xa2aa2971, 0xf7bc3fb2,
        0x2a39073f, 0x28008fac, 0xaa52a934, 0x2efd25c6,
      ],
    },
  },
  {
    seed: [1234, 0],
    vector: {
      state: { a: 0x1bdf3095, b: 0xc3e5bb12, c: 0x76a8c2e8, counter: 13 },
      outputs: [
        0xdfc4ebb4, 0xef732405, 0x4f6cf480, 0x74313244, 0x68778cdc, 0x7f32c21e, 0x9b8f566d, 0x1baa3e52,
        0xc4e39059, 0x4d00569e, 0x149e1852, 0x9c339a68,
      ],
    },
  },
  {
    seed: [0xdeadbeef, 0],
    vector: {
      state: { a: 0xc67eb899, b: 0xfc4117a6, c: 0xc57c1dd9, counter: 13 },
      outputs: [
        0xc2bfd04c, 0xed9c43dc, 0x5ee2207d, 0x9176bacb, 0xc3558e44, 0xf9b8865c, 0xbc1a80aa, 0xb7667dbc,
        0x4f3b79c3, 0xd01f8a61, 0xf884a133, 0xd5a361c2,
      ],
    },
  },
  {
    // A Daily Shift style seed (YYYYMMDD), TECHNICAL_DESIGN §7.3.
    seed: [20261019, 0],
    vector: {
      state: { a: 0xc622ca9f, b: 0x74612e9d, c: 0x0af24ccf, counter: 13 },
      outputs: [
        0x3a83f949, 0xd6dfd15f, 0xda46054f, 0x8ab92a89, 0x8a7d5a71, 0x85b49b12, 0xa8c0519f, 0xd2d195cb,
        0xc33ad2c3, 0xf8fc5e4b, 0x78183978, 0x235c420c,
      ],
    },
  },
  {
    // 0x0123456789abcdef: exercises the high seed word.
    seed: [0x89abcdef, 0x01234567],
    vector: {
      state: { a: 0xbcb23a9a, b: 0xc7bef2f0, c: 0xcc3284e9, counter: 13 },
      outputs: [
        0x84712d97, 0xf5a3d9c8, 0x5cd0a295, 0x35e05b54, 0x4c627ca1, 0x33a043e2, 0xb6113c67, 0x7cab9699,
        0x4a52efeb, 0x5936797f, 0x139e2b9f, 0xc7df3db1,
      ],
    },
  },
];

/** PractRand `sfc32::seed(1, 2, 3)`. */
const SEED3_VECTOR: Vector = {
  state: { a: 0x78e8db08, b: 0x74bdcb47, c: 0xd73883db, counter: 16 },
  outputs: [
    0xeda6a65f, 0x05843866, 0x42e2d5db, 0x01712f7d, 0xd37ea3b9, 0x198c7566, 0xfe87c14e, 0x2c6fdb3f,
    0x61ba636e, 0x1bb3ed87, 0x8c7934f9, 0xef0fc318,
  ],
};

function draw(rng: Sfc32, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) out.push(nextU32(rng));
  return out;
}

describe('sfc32 known answers (PractRand 0.95 reference)', () => {
  it.each(
    SEED64_VECTORS.map(({ seed, vector }) => [
      `0x${seed[1].toString(16).padStart(8, '0')}${seed[0].toString(16).padStart(8, '0')}`,
      seed,
      vector,
    ]),
  )('seed(Uint64 %s): state after 12 warm-up rounds and the next 12 outputs', (_label, seed, vector) => {
    const rng = sfc32(seed[0], seed[1]);
    expect(rng).toEqual(vector.state);
    expect(draw(rng, vector.outputs.length)).toEqual(vector.outputs);
  });

  it('seed(Uint32, Uint32, Uint32): state after 15 warm-up rounds and the next 12 outputs', () => {
    const rng = sfc32FromWords(1, 2, 3);
    expect(rng).toEqual(SEED3_VECTOR.state);
    expect(draw(rng, SEED3_VECTOR.outputs.length)).toEqual(SEED3_VECTOR.outputs);
  });

  it('defaults the high seed word to 0, so a 32-bit game seed is the 64-bit seed zero-extended', () => {
    expect(draw(sfc32(1234), 8)).toEqual(draw(sfc32(1234, 0), 8));
  });

  it('treats seeds as uint32: negative and out-of-range numbers wrap like the C++ casts', () => {
    expect(draw(sfc32(-1), 8)).toEqual(draw(sfc32(0xffffffff), 8));
    expect(draw(sfc32(2 ** 32 + 1234), 8)).toEqual(draw(sfc32(1234), 8));
  });

  it('keeps every state word and output a uint32 over a long run', () => {
    const rng = sfc32(0xdeadbeef);
    for (let i = 0; i < 100_000; i += 1) {
      const v = nextU32(rng);
      if (!(Number.isInteger(v) && v >= 0 && v <= 0xffffffff)) throw new Error(`bad output ${v} at ${i}`);
    }
    for (const word of [rng.a, rng.b, rng.c, rng.counter]) {
      expect(Number.isInteger(word) && word >= 0 && word <= 0xffffffff).toBe(true);
    }
    expect(rng.counter).toBe(13 + 100_000);
  });
});

describe('float and integer helpers', () => {
  it('maps uint32 outputs onto [0, 1) by dividing by 2^32', () => {
    const a = sfc32(1);
    const b = sfc32(1);
    for (let i = 0; i < 1000; i += 1) {
      const f = nextFloat(a);
      expect(f).toBe(nextU32(b) / 2 ** 32);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });

  it('nextFloat reaches neither 1 nor beyond at the extreme output', () => {
    const rng: Sfc32 = { a: 0xffffffff, b: 0, c: 0, counter: 0 };
    expect(nextFloat(rng)).toBe(0xffffffff / 2 ** 32);
    expect(nextFloat({ a: 0xffffffff, b: 0, c: 0, counter: 0 })).toBeLessThan(1);
  });

  it('nextRange stays in [min, max)', () => {
    const rng = sfc32(42);
    for (let i = 0; i < 1000; i += 1) {
      const v = nextRange(rng, -2.5, 4);
      expect(v).toBeGreaterThanOrEqual(-2.5);
      expect(v).toBeLessThan(4);
    }
  });

  it('nextInt stays in [0, n), hits every value and is exact at the extremes', () => {
    const rng = sfc32(7);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i += 1) {
      const v = nextInt(rng, 6);
      expect(Number.isInteger(v)).toBe(true);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    // The largest uint32 maps to n - 1, never n, even at NEXT_INT_MAX.
    expect(nextInt({ a: 0xffffffff, b: 0, c: 0, counter: 0 }, NEXT_INT_MAX)).toBe(NEXT_INT_MAX - 1);
    expect(nextInt({ a: 0, b: 0, c: 0, counter: 0 }, NEXT_INT_MAX)).toBe(0);
    expect(nextInt({ a: 0xffffffff, b: 0, c: 0, counter: 0 }, 1)).toBe(0);
  });

  // The step below is a few dozen instructions, so 600 warm-up ticks (the §17 default, sized for a full sim
  // tick) leave it in V8's baseline tiers, which box uint32 and float results while they run. Measured on the
  // dev Mac (pre-final-GC bytes): 950 KB after 600 warm-up ticks, 63 KB after 2,000, then 3.6 to 15 KB from
  // 3,000 on, the same harness noise §17 reports for an allocation-free tick. A longer warm-up measures the
  // optimised code the game actually runs; the 32 KiB thresholds are unchanged.
  const RNG_HEAP_WARMUP_TICKS = 6000;

  it('draws without allocating (TECHNICAL_DESIGN §17 heap-delta check)', () => {
    const rng = sfc32(99);
    let sink = 0;
    const delta = measureHeapDelta(
      () => {
        for (let i = 0; i < 16; i += 1) {
          // Integer-only accumulation keeps `sink` a small integer, so the harness itself allocates nothing.
          sink = (sink + (nextU32(rng) & 0xff) + nextInt(rng, 10) + (nextFloat(rng) < 0.5 ? 1 : 0)) | 0;
          sink = (sink + (nextRange(rng, 0, 4) < 2 ? 1 : 0)) | 0;
        }
      },
      { warmupTicks: RNG_HEAP_WARMUP_TICKS },
    );
    expect(sink).not.toBe(0);
    assertHeapDeltaWithinThresholds(delta);
  });
});

describe('hash32 (FNV-1a 32-bit over UTF-8)', () => {
  it.each([
    // Published FNV-1a 32-bit test vectors (Fowler/Noll/Vo, http://www.isthe.com/chongo/tech/comp/fnv/).
    ['', 0x811c9dc5],
    ['a', 0xe40c292c],
    ['foobar', 0xbf9cf968],
  ])('hash32(%j) = known FNV-1a value', (text, expected) => {
    expect(hash32(text)).toBe(expected);
  });

  it('matches FNV-1a over the bytes TextEncoder produces, including multi-byte and astral text', () => {
    const fnvBytes = (bytes: Uint8Array): number => {
      let h = 0x811c9dc5;
      for (const byte of bytes) h = Math.imul(h ^ byte, 0x01000193) >>> 0;
      return h;
    };
    const encoder = new TextEncoder();
    for (const text of [...RNG_STREAMS, 'Muckleford', 'café', '£5 kerb', 'ʕ•ᴥ•ʔ', 'grime 🧹', '\ud800x']) {
      expect(hash32(text)).toBe(fnvBytes(encoder.encode(text)));
    }
  });

  it('gives every stream name a distinct hash', () => {
    expect(new Set(RNG_STREAMS.map(hash32)).size).toBe(RNG_STREAMS.length);
  });
});

describe('subsystem streams', () => {
  it('lists the nine streams of TECHNICAL_DESIGN §7.3 in order', () => {
    expect([...RNG_STREAMS]).toEqual([
      'litter',
      'grime',
      'stains',
      'hazards',
      'npc',
      'traffic',
      'events',
      'brush',
      'weather',
    ]);
  });

  it('seeds each stream as sfc32(seed ^ hash32(name))', () => {
    for (const stream of RNG_STREAMS) {
      expect(draw(createStream(1234, stream), 8)).toEqual(draw(sfc32((1234 ^ hash32(stream)) >>> 0), 8));
    }
  });

  it('gives two streams from the same seed different sequences', () => {
    const seqs = RNG_STREAMS.map((stream) => draw(createStream(1234, stream), 8).join(','));
    expect(new Set(seqs).size).toBe(RNG_STREAMS.length);
    expect(draw(createStream(1234, 'litter'), 8)).not.toEqual(draw(createStream(1234, 'npc'), 8));
  });

  it('is reproducible: the same seed and stream give the same sequence', () => {
    expect(draw(createStream(20261019, 'traffic'), 16)).toEqual(draw(createStream(20261019, 'traffic'), 16));
    expect(draw(createStream(1, 'traffic'), 8)).not.toEqual(draw(createStream(2, 'traffic'), 8));
  });

  it('never reshuffles a stream when another is created or drawn from', () => {
    const alone = draw(createStream(1234, 'litter'), 32);

    const litter = createStream(1234, 'litter');
    const first = draw(litter, 16);
    // Create every other stream mid-sequence and draw heavily from them.
    for (const stream of RNG_STREAMS) {
      if (stream !== 'litter') draw(createStream(1234, stream), 100);
    }
    const second = draw(litter, 16);
    expect([...first, ...second]).toEqual(alone);
  });
});
