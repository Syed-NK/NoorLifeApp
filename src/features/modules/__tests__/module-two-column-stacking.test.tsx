import { shouldStackTwoColumn, twoColumnMinimumHalfWidth } from '../module-tokens';

/**
 * The responsive-stacking rule, asserted as arithmetic rather than through a rendered tree.
 *
 * ── Why this is a unit test and not a render test ───────────────────────────
 * The decision is a pure function of two numbers — the measured half-column and the OS text size —
 * and testing it through a rendered screen would mean mocking `useWindowDimensions` for every case
 * and then inferring the answer from a style. That proves the plumbing, not the rule. The rendering
 * side is covered separately in `faith-home-layout.test.tsx`; this file pins the boundary itself,
 * which is the part a future width or text size will be judged against.
 *
 * ── The widths below are measured, not invented ─────────────────────────────
 * Each one is `(contentWidth - twoColumnGap) / 2` for a real supported width, computed the way
 * `useModuleMetrics` computes it:
 *
 *   320 dp · scale 0.814 → padding 13, content 294, gap 7  → half 143.5
 *   360 dp · scale 0.916 → padding 15, content 330, gap 8  → half 161.0
 *   393 dp · scale 1.000 → padding 16, content 361, gap 9  → half 176.0
 *   411 dp · scale 1.000 → capped at 393, so identical     → half 176.0
 *   600 dp · scale 1.000 → capped at 393, so identical     → half 176.0
 *
 * Above 393 dp the content column is capped, so every wider device is the 393 dp case — which is
 * why a 600 dp tablet keeps two columns rather than earning a third.
 */

const HALF_COLUMN = {
  narrow: 143.5, // 320 dp
  medium: 161, // 360 dp
  reference: 176, // 393 dp and every width above it
} as const;

describe('the two-column stacking rule', () => {
  it('keeps two columns at the accepted 411 dp / font scale 1.0 baseline', () => {
    // The locked normal appearance. If this ever flips, the approved Faith Home layout has changed.
    expect(shouldStackTwoColumn(HALF_COLUMN.reference, 1)).toBe(false);
  });

  it.each([1, 1.15, 1.3])(
    'keeps two columns at the reference width at font scale %s',
    (fontScale) => {
      // 1.3 is deliberately included: labels take a second line there and still render in full, so
      // stacking would be a shape change nobody asked for.
      expect(shouldStackTwoColumn(HALF_COLUMN.reference, fontScale)).toBe(false);
    },
  );

  it('stacks at the reference width at font scale 1.5', () => {
    // 176 / 1.5 = 117.3. This is the case that produced "Maghrib Pr…" and "Islamic cale…".
    expect(shouldStackTwoColumn(HALF_COLUMN.reference, 1.5)).toBe(true);
  });

  it('keeps two columns on the narrowest supported width at the default text size', () => {
    // 320 dp is tight but complete at 1.0, so it keeps the approved layout.
    expect(shouldStackTwoColumn(HALF_COLUMN.narrow, 1)).toBe(false);
  });

  it.each([1.15, 1.3, 1.5])('stacks on the narrowest width at font scale %s', (fontScale) => {
    expect(shouldStackTwoColumn(HALF_COLUMN.narrow, fontScale)).toBe(true);
  });

  it('does not let a font scale below 1 change the layout', () => {
    // Smaller-than-default text is not a reason to re-shape an approved screen, and without the
    // clamp a 0.85 setting would widen the effective column and could flip a borderline case.
    expect(shouldStackTwoColumn(HALF_COLUMN.narrow, 0.85)).toBe(
      shouldStackTwoColumn(HALF_COLUMN.narrow, 1),
    );
  });

  it('derives the decision from space and text size only', () => {
    // The same effective width must give the same answer however it was arrived at: a wide column
    // with large text and a narrow column with default text are the same layout problem. This is
    // what stops the rule from becoming a device or emulator exception.
    const wideWithLargeText = shouldStackTwoColumn(twoColumnMinimumHalfWidth * 1.5, 1.5);
    const narrowWithDefaultText = shouldStackTwoColumn(twoColumnMinimumHalfWidth, 1);
    expect(wideWithLargeText).toBe(narrowWithDefaultText);
  });

  it('treats the threshold as a floor, not a ceiling', () => {
    expect(shouldStackTwoColumn(twoColumnMinimumHalfWidth, 1)).toBe(false);
    expect(shouldStackTwoColumn(twoColumnMinimumHalfWidth - 0.1, 1)).toBe(true);
  });

  it('sits between the last working and first failing measurement', () => {
    // Recorded so a future tweak has to argue with the device evidence rather than with taste:
    // 411 dp at 1.3 rendered everything, 411 dp at 1.5 did not.
    expect(twoColumnMinimumHalfWidth).toBeGreaterThan(HALF_COLUMN.reference / 1.5);
    expect(twoColumnMinimumHalfWidth).toBeLessThanOrEqual(HALF_COLUMN.reference / 1.3);
  });
});
