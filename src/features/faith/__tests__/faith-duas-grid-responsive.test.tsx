import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { shouldStackTwoColumn, twoColumnMinimumHalfWidth } from '@features/modules/module-tokens';

import { duaGridColumns, LONGEST_CATEGORY_WORD } from '../data/duas/dua-categories';

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

describe('the label decides the columns, not just the card width', () => {
  /**
   * The three acceptance sizes, with the numbers the device actually reports.
   *
   * `halfColumn` and `chrome` are in rendered dp: the layout scale is `screenWidth / 393`, and the
   * label size is the type token times *both* that scale and the OS font scale — the second of which
   * `useModuleMetrics().type()` deliberately omits, because React Native applies it at render.
   *
   * Getting that second multiplication wrong is exactly how this rule first shipped: it kept two
   * columns at 393 dp / 1.3 while the device was visibly splitting "Remembrances" in half.
   */
  const layoutScale = (width: number) => Math.min(width / 393, 1);
  const round = (value: number, scale: number) => Math.round(value * scale);
  const chrome = (width: number) => {
    const scale = layoutScale(width);
    return round(40, scale) + round(8, scale) + round(11, scale) * 2;
  };
  /* `body` is 12.5 dp, scaled by the layout scale and then by the OS font scale at render. */
  const labelSize = (width: number, fontScale: number) =>
    +(12.5 * layoutScale(width)).toFixed(1) * fontScale;

  it.each([
    ['411 dp at 1.0 — the reference device keeps two columns', 411, 1.0, 2],
    ['393 dp at 1.3 — stacks rather than splitting "Remembrances"', 393, 1.3, 1],
    ['320 dp at 1.5 — already stacked by the shared rule', 320, 1.5, 1],
    ['600 dp tablet at 1.0 — comfortably two', 600, 1.0, 2],
  ] as const)('%s', (_name, width, fontScale, expected) => {
    const half = halfColumn(width);
    expect(
      duaGridColumns({
        halfColumnWidth: half,
        stackTwoColumns: shouldStackTwoColumn(half, fontScale),
        labelFontSize: labelSize(width, fontScale),
        labelChromeWidth: chrome(width),
      }),
    ).toBe(expected);
  });

  it('keeps margin on both sides of the decision rather than sitting on the edge', () => {
    /*
      The coefficient is calibrated between two device measurements, not taken from a font metric.
      These assert it has not drifted onto either boundary, where a font substitution or a rounding
      change would flip the layout.
    */
    const twoColumn = duaGridColumns({
      halfColumnWidth: halfColumn(411),
      stackTwoColumns: false,
      labelFontSize: labelSize(411, 1.0) * 1.1,
      labelChromeWidth: chrome(411),
    });
    const oneColumn = duaGridColumns({
      halfColumnWidth: halfColumn(393),
      stackTwoColumns: false,
      labelFontSize: labelSize(393, 1.3) * 0.9,
      labelChromeWidth: chrome(393),
    });
    // 10% larger text at 411 still fits; 10% smaller text at 393 still does not.
    expect(twoColumn).toBe(2);
    expect(oneColumn).toBe(1);
  });

  it('measures the longest word rather than the longest label', () => {
    /*
      A label may wrap — "Morning &" / "Evening" is what the design draws. A word may not: React
      Native breaks one that overflows its line, and "Daily Reme / mbrances" is what that looked like
      on device.
    */
    expect(LONGEST_CATEGORY_WORD).toBe('Remembrances');
  });

  it('never returns two columns when the shared rule says stack', () => {
    /*
      The app-wide threshold is the floor. This grid may be stricter than every other two-column pair
      in the app; it may never be laxer, or it would keep two columns on a device where Faith Home
      had already stacked.
    */
    expect(
      duaGridColumns({
        halfColumnWidth: halfColumn(320),
        stackTwoColumns: true,
        labelFontSize: 10,
        labelChromeWidth: 0,
      }),
    ).toBe(1);
  });

  it('does not shrink the label to keep two columns', () => {
    const source = readFileSync(join(__dirname, '..', 'screens', 'duas-screen.tsx'), 'utf8');
    /*
      No `adjustsFontSizeToFit` and no `minimumFontScale` on this screen: the stated preference is a
      stacked card over shrunken text, and the layout is what gives way.
    */
    expect(source).not.toMatch(/adjustsFontSizeToFit/);
    expect(source).not.toMatch(/minimumFontScale/);
  });

  it('feeds the rule the rendered label size, not the unscaled token', () => {
    const source = readFileSync(join(__dirname, '..', 'screens', 'duas-screen.tsx'), 'utf8');
    expect(source).toContain("labelFontSize: type('body').fontSize * fontScale");
  });
});

describe('the search field', () => {
  it('keeps the full purpose in its accessible name at every width', () => {
    /*
      Scanned in `dua-search-controls.tsx`, which is where the field now lives: the category pages need
      the same control, and a second copy would have been a second answer to the questions this rule
      settles. The rule itself has not moved an inch — what follows is the same three assertions about
      the same behaviour, against the file that now implements it.

      The visible placeholder shortens to "Search" where the full phrase would clip. The spoken name
      does not, so assistive technology is told the purpose in full at every size — what gives way to
      the width is the visible text, never the meaning.
    */
    const source = readFileSync(
      join(__dirname, '..', 'components', 'dua-search-controls.tsx'),
      'utf8',
    );

    expect(source).toContain('accessibilityLabel={FULL_PLACEHOLDER}');
    expect(source).toContain("const FULL_PLACEHOLDER = 'Find a remembrance'");
    expect(source).toContain("const COMPACT_PLACEHOLDER = 'Search'");
    expect(source).toContain('placeholder={compact ? COMPACT_PLACEHOLDER : FULL_PLACEHOLDER}');
    expect(source).toContain('accessibilityHint=');
  });

  it('is the only implementation of the field, so the fix cannot be half-applied', () => {
    /*
      Both Duas surfaces render the shared control. A local `TextInput` reappearing on either screen
      would be a second search field with its own idea of when to shorten a placeholder — which is the
      state this extraction ended.
    */
    for (const screen of ['duas-screen.tsx', 'dua-category-screen.tsx']) {
      const source = readFileSync(join(__dirname, '..', 'screens', screen), 'utf8');
      expect(source).not.toMatch(/<TextInput/);
      expect(source).toContain('DuaSearchRow');
    }
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
