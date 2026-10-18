// Pure base64 (RFC 4648 §4: standard alphabet, `=` padding) for the compiled-level grid layers
// (TECHNICAL_DESIGN §15.2). src/sim runs in the browser and on Node type stripping, so this uses neither
// Node's Buffer nor the DOM's atob/btoa. Load-time only: these allocate and are never called per tick.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Char code → 6-bit value, or 255 for a character outside the alphabet. */
const DECODE_TABLE: Uint8Array = (() => {
  const table = new Uint8Array(128).fill(255);
  for (let i = 0; i < ALPHABET.length; i += 1) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

/** Encode bytes as padded standard base64. The empty array encodes as the empty string. */
export function encodeBase64(bytes: Uint8Array): string {
  const n = bytes.length;
  const parts: string[] = [];
  // Build the output in 3 KiB slices so very long layers (the gutter mask) never make one giant concat chain.
  let chunk = '';
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    chunk +=
      ALPHABET.charAt(v >>> 18) +
      ALPHABET.charAt((v >>> 12) & 63) +
      ALPHABET.charAt((v >>> 6) & 63) +
      ALPHABET.charAt(v & 63);
    if (chunk.length >= 4096) {
      parts.push(chunk);
      chunk = '';
    }
  }
  const rest = n - i;
  if (rest === 1) {
    const v = (bytes[i] ?? 0) << 16;
    chunk += `${ALPHABET.charAt(v >>> 18)}${ALPHABET.charAt((v >>> 12) & 63)}==`;
  } else if (rest === 2) {
    const v = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
    chunk += `${ALPHABET.charAt(v >>> 18)}${ALPHABET.charAt((v >>> 12) & 63)}${ALPHABET.charAt((v >>> 6) & 63)}=`;
  }
  parts.push(chunk);
  return parts.join('');
}

function sextet(text: string, index: number): number {
  const code = text.charCodeAt(index);
  const value = code < 128 ? (DECODE_TABLE[code] ?? 255) : 255;
  if (value === 255) {
    throw new Error(`base64: invalid character ${JSON.stringify(text.charAt(index))} at offset ${index}`);
  }
  return value;
}

/**
 * Decode padded standard base64. Strict: the length must be a multiple of 4, only the alphabet and up to
 * two trailing `=` are allowed, no whitespace, and the unused bits before the padding must be zero (so
 * every byte array has exactly one encoding and decode → encode is byte-identical).
 */
export function decodeBase64(text: string): Uint8Array {
  const n = text.length;
  if (n % 4 !== 0) throw new Error(`base64: length ${n} is not a multiple of 4`);
  if (n === 0) return new Uint8Array(0);
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((n / 4) * 3 - pad);
  const fullEnd = pad === 0 ? n : n - 4;
  let o = 0;
  for (let i = 0; i < fullEnd; i += 4) {
    const v =
      (sextet(text, i) << 18) |
      (sextet(text, i + 1) << 12) |
      (sextet(text, i + 2) << 6) |
      sextet(text, i + 3);
    out[o] = v >>> 16;
    out[o + 1] = (v >>> 8) & 255;
    out[o + 2] = v & 255;
    o += 3;
  }
  if (pad === 2) {
    const v = (sextet(text, n - 4) << 18) | (sextet(text, n - 3) << 12);
    if ((v & 0xffff) !== 0) throw new Error('base64: non-zero bits before the padding');
    out[o] = v >>> 16;
  } else if (pad === 1) {
    const v = (sextet(text, n - 4) << 18) | (sextet(text, n - 3) << 12) | (sextet(text, n - 2) << 6);
    if ((v & 0xff) !== 0) throw new Error('base64: non-zero bits before the padding');
    out[o] = v >>> 16;
    out[o + 1] = (v >>> 8) & 255;
  }
  return out;
}
