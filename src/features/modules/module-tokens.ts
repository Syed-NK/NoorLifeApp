import { modulePalettes, type ModuleId } from '@ds/tokens';

/**
 * Design tokens for the core module framework.
 *
 * ── Relationship to the locked Main Home tokens ─────────────────────────────
 * Main Home is design-locked. Nothing in this file modifies it. Brand hues are
 * *read* from `modulePalettes` so a hue can still only be changed in one place,
 * and everything a module screen needs beyond that hue is defined here as a
 * module-specific token. That is the separation the phase brief asks for: extend
 * alongside the lock, never edit it to make module screens easier.
 *
 * ── Why each theme carries more than one version of its colour ──────────────
 * The brand primaries were chosen for hero gradients and tile tints, not for
 * text. Measured against white, white-on-primary fails WCAG AA (4.5:1) for five
 * of the seven modules — finance 2.64, health 2.90, goals 3.39, family 3.64,
 * planner 4.48. Shipping one `primary` for fills *and* labels would therefore
 * ship unreadable labels on most modules.
 *
 * So each theme separates the roles, and each role is a hue-preserving darkening
 * of the same brand primary (constant HSL hue and saturation, lightness reduced
 * until the requirement is met) so it still reads as the module's colour:
 *
 *   primary        the brand hue. Decorative fills and gradient ends only, and
 *                  never the sole carrier of meaning.
 *   ink            text and small icons. ≥4.5:1 on both `lightSurface` and white.
 *   fill           filled control backgrounds carrying a white label. ≥4.5:1.
 *   border         boundaries and rings. ≥3:1 on both `lightSurface` and white,
 *                  which is the non-text UI component threshold.
 *   gradientStart  hero gradient start. ≥7:1 against white, so white hero text
 *                  clears AAA at the top of the gradient and AA at the bottom.
 *   lightSurface   the module's tinted section background.
 *
 * The ratios above are asserted in `__tests__/module-tokens.test.ts`, so a future
 * colour edit fails a test rather than silently degrading contrast.
 *
 * ── Why lightSurface repeats the Main Home tile tints ───────────────────────
 * Opening Faith from Main Home should feel like the tile expanded. The tints are
 * therefore the same values as `MODULE_TILE_TINT`, restated here rather than
 * imported so the module layer does not depend on a locked Main Home file. A test
 * asserts the two agree, which turns "keep them in sync" into a build failure
 * instead of a convention.
 */

/** The seven feature modules. Excludes `main` (locked) and `noor-ai` (global, not a module). */
export type FrameworkModuleId = Exclude<ModuleId, 'main' | 'noor-ai'>;

export const FRAMEWORK_MODULE_IDS: readonly FrameworkModuleId[] = [
  'faith',
  'health',
  'planner',
  'finance',
  'learning',
  'family',
  'goals',
] as const;

export type ModuleColorTheme = {
  readonly primary: string;
  readonly ink: string;
  readonly fill: string;
  readonly border: string;
  readonly gradientStart: string;
  readonly gradientEnd: string;
  readonly lightSurface: string;
  /** Text/icon colour on `fill` and on the hero gradient. */
  readonly onFill: string;
};

/**
 * Derived accessible variants, one row per module.
 *
 * Measured ratios are recorded beside each value. They were computed, not
 * guessed — see the test for the assertions that keep them true.
 */
const DERIVED: Readonly<Record<FrameworkModuleId, Omit<ModuleColorTheme, 'primary' | 'onFill'>>> = {
  faith: {
    ink: '#217E68', //  4.54 on surface · 4.94 on white
    fill: '#23856D', //  4.52 white-on-fill
    border: '#23856D', //  4.15 on surface · 4.52 on white
    gradientStart: '#1A6452', //  7.03 on white
    gradientEnd: '#23856D',
    lightSurface: '#ECF8F2',
  },
  health: {
    ink: '#2577AD', //  4.50 · 4.86
    fill: '#277CB5', //  4.53
    border: '#3896D4', //  3.00 · 3.24
    gradientStart: '#1D5D88', //  7.06
    gradientEnd: '#277CB5',
    lightSurface: '#EDF8FE',
  },
  planner: {
    ink: '#4E68C5', //  4.54 · 5.11
    fill: '#5971C9', //  4.54
    border: '#5A72C9', //  3.98 · 4.48
    gradientStart: '#3952AE', //  7.02
    gradientEnd: '#5971C9',
    lightSurface: '#F1F0FF',
  },
  finance: {
    ink: '#A85F17', //  4.51 · 4.87
    fill: '#B06318', //  4.52
    border: '#D3781D', //  3.01 · 3.24
    gradientStart: '#844B12', //  7.01
    gradientEnd: '#B06318',
    lightSurface: '#FFF5E8',
  },
  learning: {
    ink: '#7657D6', //  4.53 · 5.12 — the one primary already AA as text
    fill: '#7657D6', //  5.12
    border: '#7657D6', //  4.53 · 5.12
    gradientStart: '#5E3ACF', //  7.04
    gradientEnd: '#7657D6',
    lightSurface: '#F3EFFF',
  },
  family: {
    ink: '#CE3061', //  4.51 · 4.98
    fill: '#D23E6C', //  4.52
    border: '#D95B82', //  3.30 · 3.64
    gradientStart: '#A5264D', //  7.04
    gradientEnd: '#D23E6C',
    lightSurface: '#FFF0F4',
  },
  goals: {
    ink: '#1F7E78', //  4.51 · 4.87
    fill: '#20847E', //  4.50
    border: '#269B94', //  3.14 · 3.39
    gradientStart: '#18635F', //  7.03
    gradientEnd: '#20847E',
    lightSurface: '#ECF9F7',
  },
};

/** The seven module colour themes. Brand hue from the locked palette, roles derived here. */
export const moduleColorThemes: Readonly<Record<FrameworkModuleId, ModuleColorTheme>> = {
  faith: { primary: modulePalettes.faith.primary, onFill: '#FFFFFF', ...DERIVED.faith },
  health: { primary: modulePalettes.health.primary, onFill: '#FFFFFF', ...DERIVED.health },
  planner: { primary: modulePalettes.planner.primary, onFill: '#FFFFFF', ...DERIVED.planner },
  finance: { primary: modulePalettes.finance.primary, onFill: '#FFFFFF', ...DERIVED.finance },
  learning: { primary: modulePalettes.learning.primary, onFill: '#FFFFFF', ...DERIVED.learning },
  family: { primary: modulePalettes.family.primary, onFill: '#FFFFFF', ...DERIVED.family },
  goals: { primary: modulePalettes.goals.primary, onFill: '#FFFFFF', ...DERIVED.goals },
};

/**
 * Neutrals shared by every module screen.
 *
 * Deliberately a small set. A module screen gets its identity from one accent
 * colour against these neutrals, not from a second palette.
 */
export const moduleNeutrals = {
  /** Page background behind all module content. */
  pageBackground: '#F7F9FC',
  /** Card and sheet background. */
  surface: '#FFFFFF',
  /** A second surface for nested rows inside a card. */
  surfaceMuted: '#F4F6FA',
  /** Primary text. 13.1:1 on every module light surface. */
  textPrimary: '#14265F',
  /** Supporting text. ≥4.7:1 on every module light surface and on white. */
  textSecondary: '#5A6B8C',
  /** Lowest-emphasis text. Metadata only, never the sole label. */
  textTertiary: '#78849E',
  /** Hairline between rows. */
  divider: '#E6EAF2',
  /** Card and input border. */
  border: '#DCE2EC',
  /** Bottom-navigation bar. */
  navBackground: '#FFFFFF',
  /** Inactive navigation label and icon. 4.6:1 on white. */
  navInactive: '#6B7896',
  /** Skeleton base and its highlight. */
  skeleton: '#E8ECF3',
  skeletonHighlight: '#F2F5F9',
  /** Status tones, shared with the entry/auth layer's semantics. */
  success: '#1B8A5A',
  warning: '#B26A00',
  error: '#C4314B',
  info: '#2563EB',
  /** Very light tints behind the status tones. */
  successSurface: '#EAF7F0',
  warningSurface: '#FFF6E6',
  errorSurface: '#FDEDEF',
  infoSurface: '#EDF3FF',
} as const;

/** Type ramp for module screens. `[fontSize, lineHeight]` at the 393 dp baseline. */
export const moduleType = {
  /** Module header title. */
  headerTitle: [17, 24],
  /** Hero headline inside the hero card. */
  heroTitle: [19, 26],
  /** Hero supporting line. */
  heroBody: [12.5, 18],
  /** Hero eyebrow / module name above the headline. */
  eyebrow: [11, 15],
  /** Section heading. */
  sectionTitle: [14, 20],
  /** Section trailing action ("See all"). */
  sectionAction: [12, 17],
  /** Card title. */
  cardTitle: [13.5, 19],
  /** Card body and list rows. */
  body: [12.5, 18],
  /** Metadata, timestamps, units. */
  caption: [11, 15],
  /** A large metric inside a summary card. */
  metric: [22, 27],
  /** Metric unit suffix. */
  metricUnit: [11, 15],
  /** Feature-grid tile label. */
  tileLabel: [11, 15],
  /** Quick-action label. */
  quickAction: [11, 15],
  /** Bottom-navigation label. */
  navLabel: [9.5, 13],
  /** Button label. */
  button: [13.5, 18],
  /** State-screen title (empty, error, offline, permission). */
  stateTitle: [15, 21],
  /** State-screen body. */
  stateBody: [12.5, 18],
  /** Status-banner message. */
  banner: [12, 17],
} as const;

export type ModuleTypeToken = keyof typeof moduleType;

/**
 * Module layout contract, in dp at the 393 dp baseline.
 *
 * Values echo Main Home's proportions — 16 dp page padding, a 68 dp navigation
 * bar, a raised 58 dp centre AI button — because a module must feel like the same
 * app. They are restated here rather than imported so tuning a module screen can
 * never reach into the locked contract.
 */
export const moduleLayout = {
  referenceWidth: 393,
  pagePadding: 16,
  /** Vertical gap between stacked sections. */
  sectionGap: 18,
  /** Gap between a section heading and its content. */
  headingGap: 10,
  /** Gap between cards within a section. */
  cardGap: 10,
  /** Module header. */
  headerHeight: 52,
  headerIcon: 22,
  headerAvatar: 32,
  /** Hero card. */
  heroMinHeight: 132,
  heroPadding: 14,
  /**
   * The hero pictogram's box, in dp.
   *
   * 88 sits in the specified 78–92 dp band, near the top of it deliberately: the
   * canonical normalized PNGs carry a 37 px transparent margin and fill 71.1% of their
   * canvas, so an 88 dp box renders about 63 dp of visible artwork. Compensating once
   * here is the alternative to per-module scale tweaks, which the brief caps at ±4% and
   * which would not be needed anyway — all eight assets measure at identical occupancy.
   */
  heroArtSize: 88,
  /**
   * Share of the card width given to the hero's copy (spec: 60–65%).
   *
   * A fixed proportion rather than a flex remainder, so a long headline cannot encroach
   * on the pictogram.
   */
  heroTextColumnRatio: 0.62,
  /** Cards. */
  cardPadding: 13,
  cardRadius: 16,
  radiusSmall: 10,
  radiusPill: 999,
  /** Feature grid — four columns matching Main Home's module grid rhythm. */
  featureColumns: 4,
  featureGap: 9,
  featureTileHeight: 74,
  featurePictogram: 40,
  /** Quick actions row. */
  quickActionHeight: 62,
  quickActionIcon: 22,
  /** Bottom navigation. */
  navHeight: 68,
  navIcon: 24,
  navAIButton: 58,
  navAIImage: 50,
  navAIRaise: 15,
  /** Minimum touch target, both axes. WCAG 2.5.5 / Android accessibility. */
  minTouchTarget: 44,
  /** Space reserved below scrollable content so the nav bar never covers a card. */
  scrollBottomInset: 24,
} as const;

/**
 * Layout scale for a given screen width.
 *
 * Identical rule to Main Home and the entry flow: downscale narrow screens,
 * **never** upscale. A wider handset gets margins, not stretched cards.
 */
export function moduleScale(screenWidth: number): number {
  return Math.min(screenWidth / moduleLayout.referenceWidth, 1);
}
