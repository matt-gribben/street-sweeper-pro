// Minimal local types for pngjs 7.0.0, which ships none (SSP-022). We deliberately do NOT add @types/pngjs:
// no new dependency without a request (CLAUDE.md hard rule 6). This covers only what tests/support/visualGolden.ts
// uses: the synchronous RGBA8 read and write. pixelmatch 8.0.0 bundles its own index.d.ts, so it needs nothing.
declare module 'pngjs' {
  /** A decoded image: `data` is always RGBA8, row-major, row 0 at the top (pngjs normalises every input). */
  export interface PNGImage {
    width: number;
    height: number;
    data: Buffer;
  }

  /** Encoder options used by the helper (all optional; pngjs defaults: deflate level 9, colour type 6). */
  export interface PNGWriteOptions {
    deflateLevel?: number;
  }

  export class PNG implements PNGImage {
    /** Allocates a zeroed `width` × `height` RGBA8 buffer in `data`. */
    constructor(options: { width: number; height: number });
    width: number;
    height: number;
    data: Buffer;
    static sync: {
      read(buffer: Uint8Array): PNGImage;
      write(png: PNGImage, options?: PNGWriteOptions): Buffer;
    };
  }
}
