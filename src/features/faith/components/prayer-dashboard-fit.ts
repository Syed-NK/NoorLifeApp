import {
  moduleHeaderHeight,
  moduleLayout,
  moduleNavigationHeight,
  moduleType,
} from '@features/modules/module-tokens';

import { prayerActionMetrics } from './prayer-action-cards';
import { prayerJourneyMetrics } from './prayer-journey-timeline';
import { prayerNextMetrics } from './prayer-next-summary';

/**
 * Whether the Prayer Times dashboard fits one viewport, and what to do when it does not.
 *
 * ── Why this is a module rather than a `useState` in the screen ─────────────
 * Because the decision has to be assertable. "At 411 dp and the default text size the dashboard is
 * compact; at 320 dp, or at 1.3x text, it scrolls" is a statement about a rule, and a rule expressed
 * as branches inside a render can only be tested by rendering — which in Jest means a tree with no
 * layout engine, where every measured height is zero and every assertion passes vacuously.
 *
 * ── The rule has two halves, and the measured half always wins ──────────────
 * A screen's first frame has no measurements: `onLayout` has not fired and the content has never
 * been laid out. Something still has to be decided, so the first half **predicts** from the two
 * inputs that are known at that moment — the width and the OS text size — using the module's own
 * responsive metrics rather than a device name.
 *
 * The second half replaces the prediction the instant real numbers arrive. That ordering is not a
 * detail: a prediction that said "compact" while the content genuinely overflowed would be a screen
 * whose last card could not be reached, and no amount of care in the prediction can rule that out
 * for copy this app does not control — a localised warning, a long place name, an OS text size
 * between the steps anybody tested. Measurement is the authority; prediction only covers the frame
 * before it exists.
 *
 * ── What "compact" is allowed to mean ───────────────────────────────────────
 * Only "no scrolling is needed here". It is never a licence to clip: nothing in this module shrinks
 * type, caps a line, or drops a card to reach it. When the content does not fit, the screen scrolls
 * — from offset zero, with the hero fully visible, and with the last card clearing the navigation.
 */

export type PrayerDashboardMode = 'compact' | 'overflow';

export type PrayerDashboardFitInput = {
  /** `useWindowDimensions().width`, in dp. */
  readonly screenWidth: number;
  /** The OS text-size setting. 1 is the default. */
  readonly fontScale: number;
  /**
   * The scroll region's own measured height, in dp, or 0 before it has been laid out.
   *
   * This is the **safe body**: the scaffold's `ScrollView` is the flex child between the fixed
   * header and the bottom of the root, so its measured height is already the status-bar inset and
   * the header removed.
   */
  readonly viewportHeight: number;
  /**
   * The scroll region's measured content height, in dp, or 0 before it has been laid out.
   *
   * Includes the bottom padding the scaffold reserves for the absolutely-positioned navigation bar,
   * so comparing it against `viewportHeight` answers exactly "does everything clear the chrome".
   */
  readonly contentHeight: number;
};

/**
 * The narrowest width at which the compact dashboard is even predicted.
 *
 * The module's own reference width, not a new constant: below it every card in the module is already
 * being downscaled by `moduleScale`, the two action cards have stacked, and the composition is taller
 * than the one that was measured. Predicting compact there would be predicting against the layout's
 * own responsive rules.
 */
const COMPACT_MINIMUM_WIDTH = moduleLayout.referenceWidth;

/**
 * The largest OS text size at which the compact dashboard is predicted.
 *
 * Exactly 1. Above the default every line in the six-row timeline grows, and the honest response is
 * to let the screen scroll rather than to hold a height the text no longer fits — the correction is
 * explicit that text must wrap rather than clip and that nothing may shrink to avoid scrolling.
 */
const COMPACT_MAXIMUM_FONT_SCALE = 1;

/** Whether both measurements have arrived. Neither is ever legitimately zero once laid out. */
export function prayerDashboardIsMeasured(input: PrayerDashboardFitInput): boolean {
  return input.viewportHeight > 0 && input.contentHeight > 0;
}

/**
 * Compact or overflow, for one viewport.
 *
 * Measured first, predicted only as a fallback — see the note above for why that order is the whole
 * safety property.
 */
export function prayerDashboardMode(input: PrayerDashboardFitInput): PrayerDashboardMode {
  if (prayerDashboardIsMeasured(input)) {
    /*
      A strict comparison, with no tolerance either way. A dashboard one dp taller than its viewport
      is a dashboard whose last row is one dp off the screen, and rounding that to "fits" is how a
      user ends up unable to reach the reminders card.
    */
    return input.contentHeight <= input.viewportHeight ? 'compact' : 'overflow';
  }
  return input.screenWidth >= COMPACT_MINIMUM_WIDTH && input.fontScale <= COMPACT_MAXIMUM_FONT_SCALE
    ? 'compact'
    : 'overflow';
}

/**
 * The location card's height, from the two values the screen lays it out with.
 *
 * Kept here rather than exported from the screen because the screen imports *this* module; the two
 * constants are restated in one place with the screen's own note explaining why they are what they
 * are, and `prayer-dashboard-layout.test.tsx` asserts the screen still uses them.
 */
export const prayerLocationMetrics = {
  pictogramDp: 40,
  cardPaddingDp: 10,
  borderDp: 2,
  /**
   * One line of place name over one line of "Hijri date • method".
   *
   * ── Measured twice, because the first correction was not enough ────────────
   * At a 48 dp mark and a 12 dp row gap the text column came to 210 dp, the place name wrapped, and
   * the card stood at 73.5. Taking the mark to 44 put the *name* on one line and left the column at
   * 216.8 — where "29 Safar 1448 AH • Muslim World League" still needed two, so the text block was
   * 49.6 dp and the card only fell to 71.6. The mark was never the tallest thing in the row.
   *
   * 40 dp with a 6 dp gap returns sixteen dp to the column. Both lines then fit, the block drops to
   * 36, and the mark becomes the floor again — which is what puts this card at 62.
   */
  get textDp(): number {
    return moduleType.cardTitle[1] + 2 + moduleType.caption[1];
  },
  get heightDp(): number {
    return this.borderDp + this.cardPaddingDp * 2 + Math.max(this.pictogramDp, this.textDp);
  },
} as const;

/**
 * The compact dashboard's total height, composed from the values that actually ship.
 *
 * ── Why a model exists at all when there is a measured path ─────────────────
 * Because the measured path only exists on a device. Jest has no layout engine, so every height in a
 * rendered tree is zero and "does the dashboard fit 411 dp" cannot be asserted from a render. It can
 * be asserted from arithmetic — provided the arithmetic reads the same constants the components lay
 * out with, which is why each of them exports its own metrics rather than being duplicated here.
 *
 * ── What it deliberately does not model ─────────────────────────────────────
 * Wrapping. Every term assumes the single-line case the compact layout is designed for, because that
 * is the claim being made: *at 411 dp and the default text size, nothing wraps.* A device measurement
 * is what confirms it, and the emulator numbers are recorded in the layout suite. Anything wider than
 * one line is overflow mode's business, and overflow is decided by measurement rather than by this.
 *
 * The five sections and the four gaps between them, in the order the screen stacks them.
 */
export function prayerDashboardContentHeight(dp: (value: number) => number): number {
  const gap = dp(moduleLayout.sectionGap);
  const sections = [
    dp(moduleLayout.faithHeroHeight),
    dp(prayerLocationMetrics.heightDp),
    dp(prayerNextMetrics.heightDp),
    dp(prayerJourneyMetrics.heightDp),
    dp(prayerActionMetrics.heightDp),
  ];
  return sections.reduce((total, height) => total + height, 0) + gap * (sections.length - 1);
}

/**
 * How far the scroll region can travel at a given viewport, in dp. Zero when everything fits.
 *
 * `contentHeight + paddingBottom - viewportHeight`, floored at zero. The padding is the scaffold's:
 * the navigation bar's full height, plus the breathing room — which Prayer Times sets to zero once it
 * has measured itself compact, precisely so this comes out at zero rather than at fourteen.
 */
export function prayerDashboardScrollRange(input: {
  readonly contentHeight: number;
  readonly viewportHeight: number;
  readonly navigationHeight: number;
  readonly comfortInset: number;
}): number {
  const total = input.contentHeight + input.navigationHeight + input.comfortInset;
  return Math.max(0, total - input.viewportHeight);
}

/**
 * The height a screen has for content once every piece of fixed **chrome** is removed, in dp.
 *
 * ── Why this exists beside the measured path ────────────────────────────────
 * The measured path answers the question at runtime; this answers it for the screen's first frame and
 * for a report. "Does the approved composition clear the navigation on a Pixel 8" is a question with
 * an arithmetic answer, and deriving it from the same tokens the scaffold lays out from is what makes
 * the answer checkable rather than a screenshot somebody eyeballed.
 *
 * Every term is the scaffold's own: the status-bar inset it pads the root by, the header it draws
 * below that, and the absolutely-positioned navigation bar, whose height already includes the gesture
 * inset.
 *
 * ── Why the breathing room is deliberately *not* subtracted ─────────────────
 * Because it is a consequence of the answer rather than an input to it. Compact mode sets the
 * scaffold's comfort inset to zero — there is nothing to scroll, so there is no last card to let
 * travel clear of the bar — and a safe body that had already deducted fourteen dp would be asking
 * "does the content fit in the space left after reserving room it will not need". It did, and the
 * result was a 707 dp dashboard reported as overflow inside a 716.6 dp gap: the deduction, not the
 * content, was what did not fit.
 *
 * The question this answers is the one the correction states: does the composition clear the fixed
 * navigation. Chrome is subtracted; padding is not.
 */
export function prayerDashboardSafeBodyHeight(input: {
  readonly screenHeight: number;
  readonly insetTop: number;
  readonly insetBottom: number;
  readonly dp: (value: number) => number;
  /**
   * The OS text size, because the header is no longer a constant — issue #143.
   *
   * The title may take two lines, so the header grows at large text sizes. Subtracting the base 54
   * dp here would hand the dashboard room the header has already taken and report a fit that is not
   * there. `moduleHeaderHeight` is the one function the header itself draws from, so the deduction
   * and the chrome cannot disagree — which is the failure the note above this describes from the
   * other direction.
   */
  readonly fontScale: number;
}): number {
  const { screenHeight, insetTop, insetBottom, dp, fontScale } = input;
  return (
    screenHeight -
    insetTop -
    moduleHeaderHeight(dp, fontScale) -
    moduleNavigationHeight(dp, insetBottom)
  );
}
