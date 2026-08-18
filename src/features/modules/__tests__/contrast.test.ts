import { AA_TEXT, AA_UI, contrastRatio, formatRatio, luminance, meets } from '../contrast';

/**
 * The contrast helper itself.
 *
 * Worth testing because everything else trusts it: the token suite asserts theme ratios
 * with these functions and the Module Gallery prints them. A wrong implementation would
 * make every downstream assertion agree on the wrong answer.
 */

describe('luminance', () => {
  it('matches the WCAG reference values at the extremes', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 6);
    expect(luminance('#FFFFFF')).toBeCloseTo(1, 6);
  });

  it('weights green above red above blue', () => {
    // The 0.2126 / 0.7152 / 0.0722 coefficients, observable.
    expect(luminance('#00FF00')).toBeGreaterThan(luminance('#FF0000'));
    expect(luminance('#FF0000')).toBeGreaterThan(luminance('#0000FF'));
  });

  it('applies the sRGB transfer curve rather than treating channels as linear', () => {
    // Mid-grey is ~0.216 luminance, not 0.5. Getting this wrong is the classic bug.
    expect(luminance('#808080')).toBeCloseTo(0.2159, 3);
  });
});

describe('contrastRatio', () => {
  it('is 21:1 for black on white', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 2);
  });

  it('is 1:1 for a colour against itself', () => {
    expect(contrastRatio('#3949AB', '#3949AB')).toBeCloseTo(1, 6);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#14265F', '#ECF8F2')).toBeCloseTo(contrastRatio('#ECF8F2', '#14265F'), 9);
  });

  it('is case-insensitive about the hex', () => {
    expect(contrastRatio('#abcdef', '#FFFFFF')).toBeCloseTo(contrastRatio('#ABCDEF', '#ffffff'), 9);
  });
});

describe('input validation', () => {
  it.each(['#FFF', 'FFFFFF', '#GGGGGG', 'rgba(0,0,0,0.5)', '#FFFFFF80', ''])(
    'rejects %p rather than returning a plausible number',
    (value) => {
      // A silent wrong answer here would show a passing ratio for an unreadable pair. The
      // 8-digit case matters most: alpha has no single contrast ratio.
      expect(() => contrastRatio(value, '#000000')).toThrow(/#RRGGBB/);
    },
  );
});

describe('meets', () => {
  it('applies the threshold at the boundary', () => {
    // Real pair from the Faith theme: ink on its light surface, measured 4.54:1.
    expect(meets('#217E68', '#ECF8F2', AA_TEXT)).toBe(true);
    // The raw Finance primary on white is 2.64:1 — below even the non-text bar.
    expect(meets('#E38A32', '#FFFFFF', AA_UI)).toBe(false);
  });
});

describe('formatRatio', () => {
  it('writes ratios the way a review note would', () => {
    expect(formatRatio(4.5)).toBe('4.50:1');
    expect(formatRatio(21)).toBe('21.00:1');
  });
});
