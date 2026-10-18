// Decoder-offset probe for SSP-025 (AUDIO_DESIGN §15.2 A2, `encoderDelaySamples` in §12.1). Measurement only:
// not part of `npm test` or CI. Run after `node tools/spikes/pipelineDeterminism.ts`, which writes the inputs:
//
//   node tools/spikes/audioDecodeOffset.ts [--browsers chromium,webkit,firefox]
//
// For each Playwright engine it decodes the 48 kHz music-profile encodes (AUDIO_DESIGN §11.3: Opus 96k OGG and
// AAC-LC 128k M4A of the integer-synthesised synth48.wav) with `OfflineAudioContext.decodeAudioData` at 48 kHz,
// and finds the lag that best aligns each decoded buffer with the source WAV (cross-correlation over 16,384
// samples of the tonal first half, lags -4096..4096). A lag of 0 means the engine already trims the encoder
// priming (Opus pre-skip, the M4A edit list), so `encoderDelaySamples` for that codec is 0 in that engine.
// It also reports decoded length vs the source length (trailing padding left in the buffer).
//
// These are Playwright engine builds (Chromium, WebKit, Firefox), not branded Chrome, Safari or Firefox.
import { readFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type BrowserType, chromium, firefox, webkit } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const audioDir = join(repoRoot, 'build', 'tmp', 'determinism', `${platform()}-${arch()}`, 'audio');

const ENGINES: Record<string, BrowserType> = { chromium, webkit, firefox };

interface Decoded {
  readonly codec: string;
  readonly error?: string;
  readonly length?: number;
  readonly sampleRate?: number;
  readonly lagSamples?: number;
}

function isDecodedList(value: unknown): value is Decoded[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'object' && v !== null && 'codec' in v);
}

const inputs = {
  wav: readFileSync(join(audioDir, 'synth48.wav')).toString('base64'),
  ogg: readFileSync(join(audioDir, 'music-opus-96k.1.ogg')).toString('base64'),
  m4a: readFileSync(join(audioDir, 'music-aac-128k.1.m4a')).toString('base64'),
};

const args = process.argv.slice(2);
const at = args.indexOf('--browsers');
const names = (at >= 0 ? (args[at + 1] ?? '') : 'chromium,webkit,firefox').split(',').filter(Boolean);

let failed = false;
for (const name of names) {
  const engine = ENGINES[name];
  if (!engine) throw new Error(`unknown browser ${name}`);
  let browser: Awaited<ReturnType<BrowserType['launch']>>;
  try {
    browser = await engine.launch();
  } catch (exc) {
    failed = true;
    process.stdout.write(`${name}: could not launch (${String(exc).split('\n')[0]})\n`);
    continue;
  }
  const page = await browser.newPage();
  const result: unknown = await page.evaluate(async (files) => {
    const ctx = new OfflineAudioContext(1, 48000, 48000);
    const decode = async (b64: string): Promise<AudioBuffer> => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return ctx.decodeAudioData(bytes.buffer);
    };
    const ref = (await decode(files.wav)).getChannelData(0);
    const out: {
      codec: string;
      error?: string;
      length?: number;
      sampleRate?: number;
      lagSamples?: number;
    }[] = [];
    for (const codec of ['ogg', 'm4a'] as const) {
      try {
        const buf = await decode(files[codec]);
        const data = buf.getChannelData(0);
        let bestLag = 0;
        let bestScore = Number.NEGATIVE_INFINITY;
        for (let lag = -4096; lag <= 4096; lag++) {
          let score = 0;
          for (let i = 8192; i < 8192 + 16384; i++) score += (ref[i] ?? 0) * (data[i + lag] ?? 0);
          if (score > bestScore) {
            bestScore = score;
            bestLag = lag;
          }
        }
        out.push({ codec, length: buf.length, sampleRate: buf.sampleRate, lagSamples: bestLag });
      } catch (exc) {
        out.push({ codec, error: String(exc) });
      }
    }
    out.unshift({ codec: 'wav', length: ref.length, sampleRate: 48000, lagSamples: 0 });
    return out;
  }, inputs);
  const version = browser.version();
  await browser.close();
  if (!isDecodedList(result)) throw new Error(`${name}: unexpected result`);
  for (const d of result) {
    const detail = d.error ?? `length ${d.length} @ ${d.sampleRate} Hz, start lag ${d.lagSamples} samples`;
    process.stdout.write(`${name} ${version} ${d.codec}: ${detail}\n`);
    if (d.error) failed = true;
  }
}
process.exitCode = failed ? 1 : 0;
