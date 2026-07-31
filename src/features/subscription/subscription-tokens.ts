import {
  entryAuthColors,
  entryAuthLayout,
  entryAuthType,
} from '@features/entry-auth/entry-auth-tokens';

/**
 * Design tokens for the subscription and family-membership screens.
 *
 * ── Why these read from the entry/auth lock ─────────────────────────────────
 * The brief asks that these screens feel like an extension of the approved Entry/Auth surface:
 * soft-mint page, navy text, electric blue actions, white cards, fine cool-grey borders. Those
 * values are already locked in `entry-auth-tokens.ts`, so they are **imported, never restated**.
 * A second copy of `#FAFFFD` is a second place for the palette to drift.
 *
 * `entry-auth-tokens.ts` is a design-locked file. Nothing here modifies it — this module only
 * consumes it and adds the geometry the subscription screens need on top.
 */

/** The palette, re-exported so subscription components have one import. */
export const subscriptionColors = {
  pageBackground: entryAuthColors.pageBackground,
  surface: entryAuthColors.surface,
  surfaceMuted: entryAuthColors.secondaryMint,
  textPrimary: entryAuthColors.textPrimary,
  textSecondary: entryAuthColors.textSecondary,
  /** Electric blue — selected controls and primary actions. */
  accent: entryAuthColors.primary,
  accentDeep: entryAuthColors.primaryDeep,
  onAccent: entryAuthColors.onPrimary,
  border: entryAuthColors.border,
  disabled: entryAuthColors.disabled,
  success: entryAuthColors.success,
  error: entryAuthColors.error,

  /**
   * Tints behind status messages.
   *
   * Derived here rather than in the locked file, at the lowest saturation that still reads as a
   * tint. Text on these is always `textPrimary` or the matching status colour, never white.
   */
  successSurface: '#EAF7F0',
  warningSurface: '#FFF6E6',
  warning: '#B26A00',
  errorSurface: '#FDEDEF',
  accentSurface: '#EDF3FF',

  /**
   * The selected plan card's ring.
   *
   * Selection is carried by this ring *and* a check mark *and* the accessibility state — never by
   * colour alone, which the accessibility requirements forbid.
   */
  selectedRing: entryAuthColors.primary,
} as const;

/** The type ramp, from the lock. */
export const subscriptionType = entryAuthType;

/**
 * Geometry, in unscaled dp at the 393 dp baseline.
 *
 * Page padding, radii and control heights come from the lock so a subscription card sits on the
 * same grid as an auth card. Everything below that is specific to these screens.
 */
export const subscriptionLayout = {
  referenceWidth: entryAuthLayout.referenceWidth,
  pagePadding: entryAuthLayout.pagePadding,
  cardRadius: entryAuthLayout.cardRadius,
  buttonRadius: entryAuthLayout.buttonRadius,
  buttonHeight: entryAuthLayout.buttonHeight,
  minTouchTarget: entryAuthLayout.minTouchTarget,

  /** Gap between stacked plan cards. */
  cardGap: 10,
  /** Padding inside a plan card. */
  cardPadding: 13,
  /** Gap between a card's rows. */
  rowGap: 7,
  /** Section spacing on a scrolling screen. */
  sectionGap: 16,

  /**
   * The billing-period toggle.
   *
   * 40 dp tall — under the 44 dp minimum for the *visual* control, so each half carries hit slop
   * to reach 44. A 44 dp pill looked heavy against the 48 dp primary button beneath it.
   */
  toggleHeight: 40,
  togglePadding: 3,
  toggleRadius: 999,

  /** The module pictogram on a locked-module sheet. */
  sheetPictogram: 56,
  /** The module pictogram in a comparison or feature row. */
  rowPictogram: 24,
  /** The Noor AI robot on processing and success states. */
  robotSize: 96,

  /** A family member avatar, and the seat placeholder that shares its size. */
  memberAvatar: 40,
  /** The six-seat row on the family details screen. */
  seatDot: 34,

  /** Selected-plan check mark. */
  checkSize: 20,
} as const;

/** Downscale narrow screens, never upscale — the same rule as Main Home and the entry flow. */
export function subscriptionScale(screenWidth: number): number {
  return Math.min(screenWidth / subscriptionLayout.referenceWidth, 1);
}
