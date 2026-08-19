import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { shouldStackTwoColumn, twoColumnMinimumHalfWidth } from '@features/modules/module-tokens';

/**
 * **The grid's responsive rule, and the two things its icons may never do.**
 *
 * ── Why the collapse rule is asserted rather than re-derived ────────────────
 * The grid does not own a breakpoint. It asks `useModuleMetrics` for `twoColumnWidth` and
 * `stackTwoColumns`, which come from `shouldStackTwoColumn` — a threshold measured on device across
 * six widths and four text sizes, already shared by every other two-column pair in the app.
 *
 * A grid with its own number would collapse at a different point from the pair on Faith Home, on the
 * same device, for no reason a user could see. So what is worth asserting here is that the rule
 * behaves correctly at the three acceptance sizes, and that the screen is wired to it — not a fresh
 * set of magic numbers.
 *
 * The measurements below are the real half-columns: screen width, less two 16 dp page paddings, less
 * the 10 dp gap between the pair, halved.
 */

/** The half-column a screen of this width gives a two-column pair, in dp. */
function halfColumn(screenWidth: number): number {
  const pagePadding = 16;
  const gap = 10;
  return (screenWidth - pagePadding * 2 - gap) / 2;
}

describe('two columns, and when they must stop being two', () => {
  it.each([
    ['411 dp at 1.0 — the reference device', 411, 1.0, false],
    ['393 dp at 1.3 — a narrower device with larger text', 393, 1.3, false],
    ['320 dp at 1.5 — the narrowest supported, at the largest text', 320, 1.5, true],
    ['600 dp tablet at 1.0', 600, 1.0, false],
  ])('%s', (_name, width, fontScale, expectedToStack) => {
    expect(shouldStackTwoColumn(halfColumn(width), fontScale)).toBe(expectedToStack);
  });

  it('collapses rather than shrinking text to keep two columns', () => {
    /*
      The threshold is expressed per unit of text size, so the answer to "does this fit?" already
      accounts for the user's font scale. That is what makes collapsing the correct response instead
      of reducing the type below NoorLife's readable sizes — the layout gives way, never the text.
    */
    expect(twoColumnMinimumHalfWidth).toBe(132);
    expect(shouldStackTwoColumn(halfColumn(320), 1.5)).toBe(true);
    expect(shouldStackTwoColumn(halfColumn(320), 1.0)).toBe(false);
  });

  it('never earns extra columns from a text size below the default', () => {
    // The approved layout is the two-column one; smaller text is not a reason to change shape.
    expect(shouldStackTwoColumn(halfColumn(320), 0.85)).toBe(
      shouldStackTwoColumn(halfColumn(320), 1.0),
    );
  });

  it('is what the grid actually uses, rather than a rule of its own', () => {
    const source = readFileSync(join(__dirname, '..', 'screens', 'duas-screen.tsx'), 'utf8');
    expect(source).toContain('stackTwoColumns');
    expect(source).toContain('twoColumnWidth');
    /*
      No hand-rolled breakpoint. A literal width comparison here would be a second answer to a
      question `shouldStackTwoColumn` already answers, and the two would drift.
    */
    expect(source).not.toMatch(/screenWidth\s*[<>]/);
    expect(source).not.toMatch(/Dimensions\.get/);
  });
});

describe('the grid draws no icon it did not bundle', () => {
  const SCREENS = ['duas-screen.tsx', 'dua-category-screen.tsx'];

  it.each(SCREENS)('%s loads no remote image and renders no emoji', (file) => {
    const source = readFileSync(join(__dirname, '..', 'screens', file), 'utf8');

    /*
      A remote source would make the library depend on a network it must not touch to render, and an
      emoji renders differently on every OS and font — the design calls for one coherent dimensional
      family, which an OS-dependent glyph is not part of.
    */
    expect(source).not.toMatch(/https?:\/\//);
    expect(source).not.toMatch(/\buri\s*:/);
    expect(source).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
  });

  it('has no icon file outside the registry for any screen to reach', () => {
    /*
      Every image the grid can draw comes from `faith-dua-category-assets.ts`. Asserted by checking
      the screens hold no `require` of their own — a local one would be an image nobody's asset
      handoff knows about.
    */
    for (const file of SCREENS) {
      const source = readFileSync(join(__dirname, '..', 'screens', file), 'utf8');
      expect(source).not.toMatch(/require\(['"]@assets/);
    }
  });

  it('registers every Duas icon file that exists on disk', () => {
    /*
      The reverse direction: artwork delivered into the Duas folder and never registered would sit in
      the repository looking installed while the screen still drew a fallback.
    */
    const duasAssetDir = join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'assets',
      'images',
      'modules',
      'faith',
      'duas',
    );
    let delivered: string[] = [];
    try {
      delivered = readdirSync(duasAssetDir).filter((name) => /\.(png|webp)$/.test(name));
    } catch {
      // The folder does not exist yet, which is the current state: no artwork has been delivered.
      delivered = [];
    }

    const registry = readFileSync(join(__dirname, '..', 'faith-dua-category-assets.ts'), 'utf8');
    for (const file of delivered) {
      expect(registry).toContain(file);
    }
  });
});
