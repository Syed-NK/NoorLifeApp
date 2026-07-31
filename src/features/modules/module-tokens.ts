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

/**
 * The eight core modules. Excludes only `main`, which is locked Main Home.
 *
 * Noor AI was previously excluded as "global, not a module". That was wrong: it has its own
 * approved individual-core-screen reference, its own five-slot navigation and its own hero
 * asset, so it is a core module like the rest. Treating it as a placeholder is what left a
 * "Noor AI arrives in Phase 2" screen in the app.
 */
export type FrameworkModuleId = Exclude<ModuleId, 'main'>;

export const FRAMEWORK_MODULE_IDS: readonly FrameworkModuleId[] = [
  'noor-ai',
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
  'noor-ai': {
    ink: '#6556C8', //  4.95 on surface · 5.65 on white — already AA, no darkening needed
    fill: '#6556C8', //  5.65 white-on-fill
    border: '#6556C8', //  4.95 · 5.65
    gradientStart: '#5544C2', //  7.02 on white
    gradientEnd: '#6556C8',
    lightSurface: '#F1EEFF',
  },
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
  'noor-ai': {
    primary: modulePalettes['noor-ai'].primary,
    onFill: '#FFFFFF',
    ...DERIVED['noor-ai'],
  },
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
  /**
   * The hero display figure — Faith's prayer name and time, Health's score.
   *
   * Measured at ~30 dp on the Faith reference. Line height is deliberately tight (1.13)
   * because Faith stacks two of these lines and the reference shows them close-set.
   */
  heroDisplay: [24, 28],
  /**
   * Faith's combined prayer and time line, e.g. "Dhuhr 12:35 PM".
   *
   * 20 dp. It was 24 while the copy was centred across the full 361 dp card; the left-copy
   * hero gives it a 199 dp column instead, where 24 dp measured ~158 dp and left too little
   * margin once Android's font scale applied. At 20 dp the string measures ~132 dp and holds
   * one line with room to spare, which is the requirement — and 20 dp remains comfortably
   * above the accessible floor for a display line.
   */
  faithPrayer: [20, 25],
  /** Health's wellness score, larger again at ~40 dp in its reference. */
  heroScore: [30, 34],
  /** Hero supporting line. */
  heroBody: [12.5, 18],
  /** Hero eyebrow / module name above the headline. */
  eyebrow: [11, 15],
  /** Section heading. */
  sectionTitle: [14, 20],
  /** Section trailing action ("See all"). */
  sectionAction: [12, 17],
  /**
   * Heading inside a half-width card, e.g. "Today's Worship".
   *
   * Smaller than `sectionTitle`: measured ~13 dp on the reference, and at the full 14 dp
   * "Today's Worship" plus its "View All" link cannot fit a 176 dp column — it truncated to
   * "Today's Wor…" on the first build.
   */
  cardHeading: [12, 17],
  /** The trailing link beside a `cardHeading`. ~11.5 dp on the reference. */
  cardAction: [10.5, 14],
  /** A list row's label inside a half-width card. ~11.5 dp measured. */
  rowLabel: [11, 15],
  /** A list row's trailing value or time. ~10.5 dp measured. */
  rowMeta: [9.5, 13],
  /**
   * A metric card's figure, e.g. "7,542".
   *
   * Its own token because a quarter-width card leaves ~45 dp for text: at the shared
   * 13.5 dp card title every one of Health's four metrics truncated ("7,5…", "Go…").
   */
  metricValue: [12.5, 16],
  /** Chart axis ticks. A seventh of a half-width card is ~18 dp, so these must be small. */
  chartAxis: [9.5, 13],
  /** Card title. */
  cardTitle: [13.5, 19],
  /** Card body and list rows. */
  body: [12.5, 18],
  /** Metadata, timestamps, units. */
  caption: [11, 15],
  /**
   * Qur'anic Arabic.
   *
   * Larger than body text and with a much taller line height: harakat sit above and
   * below the baseline, and a 1.3 ratio clips them. Measured ~18 dp on the reference.
   */
  arabic: [18, 32],
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
  /**
   * The AI Insight card's title and body.
   *
   * Main Home's `aiTitle` / `aiBody` values exactly — restated here so the module layer
   * does not import a locked file, and asserted equal by
   * `design-system/components/__tests__/ai-insight-geometry.test.ts`. They are smaller
   * than `cardTitle` / `body` on purpose: the card's height is fixed at 68 dp and this
   * ramp is what makes a title plus two body lines fit inside it.
   */
  aiInsightTitle: [10.5, 14],
  aiInsightBody: [10, 13],
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
  /**
   * Vertical gap between stacked sections.
   *
   * 7 dp. It was 18 while the framework had one generic composition, then 8 once the
   * approved compositions landed, and 7 after Faith Home was measured on a Pixel 8 and
   * found to overflow by 10.9 dp. Density is not decoration here — it is what makes the
   * approved screens fit without scrolling, and the alternative was dropping content the
   * reference shows.
   *
   * (The comment here previously claimed 10, which never matched the value. Corrected.)
   */
  sectionGap: 7,
  /** Gap between a section heading and its content. */
  headingGap: 10,
  /** Gap between cards within a section. */
  cardGap: 10,
  /** Module header. */
  headerHeight: 54,
  /** Back and Help glyph. 19 dp, mid of the specified 18-20 band. */
  headerIcon: 19,
  /** Profile portrait (brief: 34-36 dp). Its touch target is the full 44 dp. */
  headerAvatar: 35,
  /** Gap between Help and Profile (brief: 4-8 dp). */
  headerControlGap: 6,
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
   * Share of the card width given to the hero copy.
   *
   * 0.52, matching the quiet band the locked artwork leaves on the copy side. It was 0.62
   * while the hero was a flat gradient with a pictogram, and at that width Finance's body
   * copy ran straight over the wallet. The brief is explicit that copy must not cover the
   * main artwork, and the artwork decides where the room is.
   */
  heroTextColumnRatio: 0.52,
  /** Cards. */
  cardPadding: 11,
  /** Padding inside a half-width card, where every dp of inner width counts. */
  twoColumnPadding: 10,
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
  /**
   * The Noor AI mark inside the raised control.
   *
   * 53 dp fills the 54 dp inner circle (58 outer, 2 dp ring each side) without clipping, so
   * the mark reads as large as it can. The brief asks for 76-82% of the inner diameter; note
   * the normalized asset carries ~29% transparent margin, so the *visible* robot lands nearer
   * 70% of the inner circle. Closing that gap would need the tighter-cropped original, which
   * would break the "same asset as Main Home" requirement — so the asset wins.
   */
  navAIImage: 53,
  navAIRaise: 15,
  /**
   * ── Metrics derived from the approved individual-core-screen references ────
   *
   * Every value below was measured off `design-reference/individual-core-screens/`
   * (Faith at 1.18 px/dp, Health at 1.23 px/dp — see docs/PHASE_4A_MISMATCH_AUDIT.md).
   * They are grouped and named after what they measure so a future screen cannot reach
   * for "roughly the card size" and drift.
   */
  /** Header back/help control: a bordered white disc, as both references draw it. */
  headerControl: 36,
  /**
   * Hero height, shared by every module.
   *
   * 132 dp, and not a matter of taste: the locked hero PNGs are 1083 x 396 px, which at 3x
   * is 361 x 132 dp — exactly the module content column. At this height each asset renders
   * one-to-one, so `cover` neither crops nor stretches it.
   *
   * This supersedes the per-screen heights measured off the individual-core-screen mockups
   * (Faith ~168, Health ~156). Those mockups pre-date the locked artwork, and honouring them
   * would force `cover` to scale by height and crop 27-49 dp off each side — which on Faith
   * removes the flanking minarets and on Health the trees. Given a locked canvas cut to the
   * content column, showing all of the artwork is the faithful reading.
   *
   * The consequence, stated plainly: hero type is smaller than in those mockups, because a
   * 132 dp box holds less. See docs/PHASE_4A_MISMATCH_AUDIT.md.
   */
  heroHeight: 132,
  /** Vertical padding inside the hero copy group, so a button never touches the card edge. */
  heroCopyPaddingV: 12,
  /** Hero call-to-action height (brief: 34-38 dp). */
  heroButtonHeight: 34,
  /**
   * Faith's hero height — 144, taller than the shared 132.
   *
   * ── Why Faith alone is taller ───────────────────────────────────────────
   * Faith stacks five elements where every other hero stacks three: eyebrow, prayer
   * line, two date lines, and a button. Measured, that column needs 142 dp. At the
   * shared 132 it overflowed by 14 and the button clipped — which is the clipping the
   * correction brief forbids, and the brief is equally explicit that content must not be
   * dropped to make it fit. Raising the box is the only remaining lever.
   *
   * The cost, stated plainly: `03-faith-hero-left-copy-v2.png` is 2105 x 747, which at
   * the 361 dp content width is 128 dp tall. Covering a 144 dp box therefore scales by
   * height and crops ~22 dp from each side — 5.5%. On this asset that removes empty green
   * on the left and the outermost palm fronds on the right; the dome, the minaret and the
   * lanterns all sit well inside. Verified on device.
   */
  faithHeroHeight: 144,
  /** Faith hero spacing, all explicit per the correction brief. */
  faithHeroPaddingTop: 12,
  faithHeroPaddingBottom: 11,
  /** Clear air between "Next Prayer" and the prayer line. */
  faithHeroEyebrowGap: 4,
  faithHeroDateGap: 6,
  /** Clear air before the action, so the button never touches the prayer text. */
  faithHeroButtonGap: 9,
  /** Noor AI's four capability cards. */
  noorAICapabilityHeight: 62,
  /**
   * Faith's eight approved submenu tiles: 4 columns, 9 dp gaps.
   *
   * 74 dp tall with a 40 dp image box. The previous 48/27 pair drew a small glyph in a
   * short tile and left the large unused band the correction brief calls out; at 40 dp the
   * pictogram is big enough to read as artwork, and 74 dp leaves 3 dp of gap plus a 15 dp
   * label line beneath it without wrapping. Both clear the 44 dp touch minimum.
   */
  faithSubmenuTileHeight: 74,
  faithSubmenuImage: 40,
  /**
   * The pictogram a Faith child screen repeats from the tile that opened it.
   *
   * 56 dp, mid-band of the specified 48–64, and identical on all eight children: they are
   * seen in sequence, so a per-screen size would read as a hierarchy that does not exist.
   */
  faithIdentityImage: 56,
  /** The Continue-Quran card's identity pictogram. */
  faithContinueImage: 42,
  /** The supporting date cards' identity pictogram — smaller, as they are secondary. */
  faithCompactImage: 28,
  /** Health's four metric cards: icon left, value/label stacked right. */
  healthMetricHeight: 42,
  healthMetricIcon: 21,
  /** Faith's Continue-Quran card. */
  continueCardHeight: 62,
  /** The two-column content rows both screens are built from. */
  twoColumnGap: 9,
  /** Faith's compact Upcoming / Islamic Calendar pair. */
  compactCardHeight: 64,
  /** Health's Quick Log mini-cards. */
  quickLogHeight: 49,
  /** Health's wellness score ring. */
  scoreRing: 72,
  /** Keeps the score ring off the artwork's runner on the far right. */
  healthRingInset: 40,
  scoreRingStroke: 8,
  /** The AI insight card's robot artwork. */
  insightRobot: 50,
  /** Minimum touch target, both axes. WCAG 2.5.5 / Android accessibility. */
  minTouchTarget: 44,
  /**
   * Space below scrollable content, on top of the navigation bar and the safe area.
   *
   * 14, down from 24. The scaffold already insets by `navHeight + insets.bottom`, so this
   * is purely breathing room under the last card — and it was the cheapest 10 dp of the
   * 10.9 dp Faith Home was overflowing by. 14 dp still keeps the AI Insight visibly clear
   * of the bar rather than tucked against it.
   */
  scrollBottomInset: 14,
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
