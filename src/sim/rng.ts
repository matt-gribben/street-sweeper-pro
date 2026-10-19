// Seeded randomness for the sim (TECHNICAL_DESIGN §7.3, LEVEL_DESIGN §9). The only random source src/sim may
// use: no Math.random, crypto or wall-clock seeding (CLAUDE.md hard rule 1).
//
// sfc32 is Chris Doty-Humphrey's "Small Fast Chaotic" generator from PractRand 0.95
// (src/RNGs/sfc.cpp, `PractRand::RNGs::Raw::sfc32`). `raw32` and both seeding routines below are a direct
// transcription; tests/unit/rng.test.ts holds known-answer vectors produced by compiling that reference.
// State is four uint32 words kept in a plain object, so a generator is cheap to copy into a replay hash
// and every call is allocation-free.

/** sfc32 generator state: four uint32 words. Mutated in place by every draw. */
export type Sfc32 = {
  a: number;
  b: number;
  c: number;
  counter: number;
};

/** 2^-32: maps a uint32 onto [0, 1). Exact in binary floating point. */
const UINT32_TO_UNIT = 1 / 4294967296;

/** Advance the generator one step and return the next uint32 (PractRand `sfc32::raw32`). */
export function nextU32(rng: Sfc32): number {
  const tmp = (rng.a + rng.b + rng.counter) >>> 0;
  rng.counter = (rng.counter + 1) >>> 0;
  rng.a = (rng.b ^ (rng.b >>> 9)) >>> 0;
  rng.b = (rng.c + (rng.c << 3)) >>> 0;
  rng.c = (((rng.c << 21) | (rng.c >>> 11)) + tmp) >>> 0;
  return tmp;
}

/**
 * Seed a generator from a 64-bit seed given as two uint32 halves (PractRand `sfc32::seed(Uint64)`):
 * a = 0, b = low word, c = high word, counter = 1, then 12 discarded rounds. Game seeds are 32-bit, so
 * `seedHi` defaults to 0.
 */
export function sfc32(seed: number, seedHi = 0): Sfc32 {
  const rng: Sfc32 = { a: 0, b: seed >>> 0, c: seedHi >>> 0, counter: 1 };
  for (let i = 0; i < 12; i += 1) nextU32(rng);
  return rng;
}

/**
 * Seed a generator from three uint32 words (PractRand `sfc32::seed(Uint32, Uint32, Uint32)`):
 * a, b, c as given, counter = 1, then 15 discarded rounds.
 */
export function sfc32FromWords(s1: number, s2: number, s3: number): Sfc32 {
  const rng: Sfc32 = { a: s1 >>> 0, b: s2 >>> 0, c: s3 >>> 0, counter: 1 };
  for (let i = 0; i < 15; i += 1) nextU32(rng);
  return rng;
}

/** Next float in [0, 1), with 32 bits of resolution. */
export function nextFloat(rng: Sfc32): number {
  return nextU32(rng) * UINT32_TO_UNIT;
}

/** Next float in [minInclusive, maxExclusive). */
export function nextRange(rng: Sfc32, minInclusive: number, maxExclusive: number): number {
  return minInclusive + (maxExclusive - minInclusive) * nextFloat(rng);
}

/** Largest `n` that nextInt accepts: u32 * n then stays below 2^53, so every step is exact in doubles. */
export const NEXT_INT_MAX = 2 ** 21;

/**
 * Next integer in [0, n) for an integer 1 <= n <= NEXT_INT_MAX. Computes floor(u32 * n / 2^32) exactly
 * (multiply-shift, no modulo), so the result never reaches n. Bias is below n / 2^32.
 */
export function nextInt(rng: Sfc32, n: number): number {
  return Math.floor(nextU32(rng) * n * UINT32_TO_UNIT);
}

/** FNV-1a 32-bit offset basis, shared by hash32 and the replay state hash (src/sim/replay.ts). */
export const FNV1A32_OFFSET = 0x811c9dc5;
/** FNV-1a 32-bit prime. */
export const FNV1A32_PRIME = 0x01000193;

function fnvByte(hash: number, byte: number): number {
  return Math.imul(hash ^ byte, FNV1A32_PRIME) >>> 0;
}

/**
 * hash32: FNV-1a 32-bit over the UTF-8 bytes of `text` (TECHNICAL_DESIGN §7.3; the same hash family as the
 * replay state hash, §18.3). Encodes UTF-8 by hand, without TextEncoder, so it allocates nothing. A lone
 * surrogate is encoded as U+FFFD, as TextEncoder would.
 */
export function hash32(text: string): number {
  let hash = FNV1A32_OFFSET;
  for (let i = 0; i < text.length; i += 1) {
    let cp = text.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < text.length) {
      const lo = text.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
        i += 1;
      }
    }
    if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
    if (cp < 0x80) {
      hash = fnvByte(hash, cp);
    } else if (cp < 0x800) {
      hash = fnvByte(hash, 0xc0 | (cp >>> 6));
      hash = fnvByte(hash, 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      hash = fnvByte(hash, 0xe0 | (cp >>> 12));
      hash = fnvByte(hash, 0x80 | ((cp >>> 6) & 0x3f));
      hash = fnvByte(hash, 0x80 | (cp & 0x3f));
    } else {
      hash = fnvByte(hash, 0xf0 | (cp >>> 18));
      hash = fnvByte(hash, 0x80 | ((cp >>> 12) & 0x3f));
      hash = fnvByte(hash, 0x80 | ((cp >>> 6) & 0x3f));
      hash = fnvByte(hash, 0x80 | (cp & 0x3f));
    }
  }
  return hash;
}

/**
 * The sim's random streams, one per subsystem (TECHNICAL_DESIGN §7.3, LEVEL_DESIGN §9). Each stream's seed
 * depends only on the run seed and its own name, so adding a stream never reshuffles another. Add new
 * streams at the end and document them in §7.3.
 */
export const RNG_STREAMS = [
  'litter',
  'grime',
  'stains',
  'hazards',
  'npc',
  'traffic',
  'events',
  'brush',
  'weather',
] as const;
export type RngStream = (typeof RNG_STREAMS)[number];

/** Create the generator for one subsystem: `sfc32(seed ^ hash32(stream))`. `seed` is the run's uint32 seed. */
export function createStream(seed: number, stream: RngStream): Sfc32 {
  return sfc32((seed ^ hash32(stream)) >>> 0);
}
