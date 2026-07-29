/**
 * Entry & Authentication design tokens.
 *
 * Source of truth: design-reference/01-entry-authentication-flow/
 *   • ENTRY_AUTHENTICATION_DESIGN_LOCK.md
 *   • CLAUDE_PHASE2_ENTRY_AUTH_PROMPT.md § "Visual lock"
 *   • 01-splash-locked-soft-mint.png and 01-entry-authentication-flow-soft-mint.png
 *
 * ── Why these live here and not in @ds/tokens ───────────────────────────────
 * The global palette in `src/design-system/tokens/colors.ts` is the locked Main Home
 * system: a neutral `#F7F8FA` canvas, `#172033` primary text and a `#3157C8` primary
 * action. The entry flow is locked to a *different* system — a Soft Mint canvas,
 * `#14265F` text and a `#1677FF` action. Both contracts are true at once only if they
 * stay separate, and Main Home's tokens are protected, so nothing here modifies them.
 *
 * Every number the entry screens use comes from this file. No screen hard-codes a
 * colour, radius or control height.
 */

/**
 * Soft Mint backgrounds.
 *
 * `page` is the flat canvas every entry screen paints. `secondary` and `ambientGlow`
 * are the two deeper mint steps the locked artwork uses for its radial glow; they are
 * for decorative fills only, never for text backgrounds.
 */
export const entryAuthColors = {
  /** Page canvas — the colour the native splash is matched to. */
  pageBackground: '#FAFFFD',
  /** Secondary mint, for grouped/inset areas. */
  secondaryMint: '#EEF9F4',
  /** Ambient mint glow behind illustrations. */
  ambientMint: '#DDF6F1',
  /** Card and form surfaces. */
  surface: '#FFFFFF',
  /** Headings and input values. */
  textPrimary: '#14265F',
  /** Supporting copy, labels and placeholders. */
  textSecondary: '#667085',
  /** Primary action fill and links. */
  primary: '#1677FF',
  /** Deeper end of the primary action range, used for pressed states. */
  primaryDeep: '#2563EB',
  /** Focused input border. */
  focus: '#3B82F6',
  error: '#E5484D',
  success: '#18A66A',
  /** Input and card hairline. */
  border: '#E4E9F0',
  /** Disabled control fill. */
  disabled: '#C8CED8',
  /** Text and icons on a primary-filled control. */
  onPrimary: '#FFFFFF',
} as const;

/**
 * Saturated medallion fills, one per module, from §7 of the final brief.
 *
 * These are *not* the Main Home module palette — that system uses pale tinted tiles, and this one
 * uses saturated discs on a Soft Mint page. Both are correct in their own screen, which is only
 * possible while they stay separate.
 */
export const medallionColors = {
  noorAI: '#2563EB',
  faith: '#14966F',
  health: '#3B9DE2',
  planner: '#5B5BD6',
  finance: '#F59E0B',
  learning: '#7357D9',
  family: '#E84D78',
  goals: '#159E99',
} as const;

export type MedallionColorKey = keyof typeof medallionColors;

/** Medallion geometry, in unscaled baseline dp and unitless ratios. */
export const medallionSpec = {
  /** Every medallion shares one diameter — §7 requires equal circular size. */
  diameter: 56,
  /**
   * Pictogram size as a fraction of the diameter.
   *
   * 0.76, the middle of §7's 74–78% band. The artwork inside each PNG already occupies a uniform
   * ~86% of its own canvas, so one ratio here yields equal perceived weight across all eight
   * without any per-module correction.
   */
  pictogramRatio: 0.76,
  /** Translucent white highlight ring width. */
  ringWidth: 1.5,
  ringColor: 'rgba(255,255,255,0.55)',
} as const;

/**
 * Type ramp, as `[fontSize, lineHeight]` in unscaled baseline dp.
 *
 * Headings are **600** (Poppins SemiBold) and never heavier — the rejection gates list
 * "a heading is heavier than Poppins SemiBold" explicitly.
 */
export const entryAuthType = {
  /** Onboarding and screen headings. */
  title: [22, 30],
  /** Smaller heading, used where a card holds the title. */
  titleCompact: [20, 28],
  /** Supporting copy under a heading. */
  subtitle: [13, 19],
  /** Field labels and control captions. */
  label: [12, 17],
  /** Input values and body copy. */
  body: [14, 21],
  /** Button labels. */
  button: [15, 22],
  /** Legal copy and helper text. */
  caption: [11, 16],
  /** OTP digits. */
  otp: [20, 28],
} as const satisfies Record<string, readonly [number, number]>;

export type EntryAuthTypeToken = keyof typeof entryAuthType;

/** Control and layout geometry, in unscaled baseline dp. */
export const entryAuthLayout = {
  /** The baseline width every dp value below is expressed against. */
  referenceWidth: 393,
  /** Baseline viewport height from the visual lock. */
  referenceHeight: 852,
  /** Page side padding. */
  pagePadding: 16,
  /** Card corner radius (lock allows 14–16). */
  cardRadius: 16,
  /** Input corner radius. */
  inputRadius: 12,
  /** Primary button corner radius. */
  buttonRadius: 12,
  /** Input height — also the lock's minimum. */
  inputHeight: 48,
  /**
   * Primary button height.
   *
   * 48 exactly: the rejection gates fail anything over 50 dp without an accessibility
   * reason, and 48 already clears the 44 dp touch-target minimum.
   */
  buttonHeight: 48,
  /** Minimum accessible touch target. */
  minTouchTarget: 44,
  /** Gap between stacked form fields. */
  fieldGap: 14,
  /** Gap between a label and its control. */
  labelGap: 6,
  /**
   * Maximum measure for centred onboarding headings, in baseline dp.
   *
   * Not the full 361 dp content width. The reference sets every onboarding heading on two
   * centred lines, and at 22 dp SemiBold the full-width column is wide enough to fit
   * "Your family, beautifully in sync." on one line (measured 348.8 dp against 361 dp), which
   * loses that hierarchy and leaves the heading almost touching both margins.
   *
   * 262 clears the longest single line the reference uses — "with clear boundaries." at
   * 249.1 dp — with room to spare, so no heading spills to a third line.
   */
  headingMaxWidth: 262,
  /**
   * Maximum measure for supporting copy, in baseline dp.
   *
   * 250, tuned from the reference's own line breaks: "Bring your loved ones together and" is
   * 228.2 dp and adding "stay" reaches 257.8 dp, so 250 breaks after "and" exactly as the
   * reference does, and the following line (234.4 dp) still fits.
   */
  subtitleMaxWidth: 250,
  /** Progress dot diameter and spacing. */
  progressDot: 7,
  progressDotGap: 6,
  /** Active progress dot width — the active dot is a pill, not a larger circle. */
  progressDotActiveWidth: 18,
} as const;

/**
 * Layout scale.
 *
 * `Math.min(width / 393, 1)` — **never above 1**. A Pixel 8 (411 dp) renders at the
 * baseline dimensions with the content column centred; cards and fonts must not grow to
 * fill the extra width, and screen *height* is never an input to any size.
 */
export function entryAuthScale(width: number): number {
  return Math.min(width / entryAuthLayout.referenceWidth, 1);
}
