/**
 * Minimal typing for `pngjs`, used only by the splash-artwork test.
 *
 * `pngjs` ships no types and is present as a transitive dependency. Declared narrowly here — just
 * the synchronous read the test needs — rather than pulling in `@types/pngjs` for one test file, and
 * rather than `declare module 'pngjs'` which would type the whole module as `any` and let a typo in
 * the test pass silently.
 */
declare module 'pngjs' {
  export type PNGData = {
    readonly width: number;
    readonly height: number;
    /** RGBA, four bytes per pixel, row-major. */
    readonly data: Buffer;
  };

  export const PNG: {
    readonly sync: {
      read(buffer: Buffer): PNGData;
    };
  };
}
