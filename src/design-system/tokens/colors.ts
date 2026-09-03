/**
 * NoorLife locked colour tokens.
 *
 * Source of truth: docs/NOORLIFE_UI_DESIGN_SPEC.md §2.1 (neutral foundation),
 * §2.2 (semantic) and §2.3 (module palettes).
 *
 * These values are LOCKED. Do not add, remove or alter a value here without a
 * corresponding change to the design specification. Every colour used anywhere
 * in the application must come from this file (directly, or via a ModuleTheme).
 */

/**
 * §2.1 Neutral foundation — every **shared** canvas is neutral.
 *
 * ── Amended for the module surface contract — issue #86 ────────────────────
 * This rule used to read "the application canvas is neutral, never tinted", and that absolute is
 * what left every module screen on one grey while Faith quietly tinted six of its own surfaces
 * outside the token system.
 *
 * The rule now distinguishes *whose* canvas it is:
 *
 * - A **shared or global** canvas stays neutral. Main Home is explicitly exempt from module tinting
 *   and keeps `canvas`, because it combines eight module identities at once and tinting it would
 *   mean choosing one of them. Entry/auth, subscription and profile keep their own grounds.
 * - A **module-owned screen** may use that module's approved `pageSurface` from
 *   `ModuleColorTheme`, which is the locked palette's own `soft` value under an explicit name.
 *
 * The Qur'an reader (`readerPageBackground`) and Tasbih (`tasbihStageSurface`) keep their special
 * grounds; both are reading and photographic surfaces with recorded reasons of their own.
 *
 * Nothing here permits a colour that is not in this file, and nothing permits sampling one from
 * artwork.
 */
export const neutralColors = {
  /** Main application background. */
  canvas: '#F7F8FA',
  /** Cards, sheets, navigation surfaces. */
  surface: '#FFFFFF',
  /** Secondary cards and grouped controls. */
  surfaceSoft: '#F1F3F6',
  /** Card and input borders. */
  border: '#E2E6EC',
  /** List separators. */
  divider: '#E9ECF1',
  /** Headings and important values. */
  textPrimary: '#172033',
  /** Supporting copy. */
  textSecondary: '#667085',
  /** Metadata and placeholders. */
  textMuted: '#98A2B3',
  /** Disabled controls. */
  disabled: '#C8CED8',
  /** Modal background. */
  scrim: 'rgba(17,24,39,0.45)',
} as const;

/**
 * §2.2 Semantic colours.
 *
 * `primary` is for buttons, links, focus states and global active navigation
 * only. It must never be used as a large-area background.
 */
export const semanticColors = {
  primary: '#3157C8',
  success: '#22A06B',
  warning: '#E6A23C',
  error: '#D92D4C',
  info: '#3A8DDE',
} as const;

/**
 * Inactive bottom-navigation item colour.
 *
 * Specification addition: §3.2 states the inactive item colour inline rather than in the token
 * tables, so it is lifted here to keep the value out of component code.
 *
 * ── The specified literal was corrected in issue #171 ──────────────────────
 * §3.2 and Main Home implementation-lock §13 both said `#7A8496`. On the bar it renders on —
 * `neutralColors.surface` `#FFFFFF` — that measures **3.7713:1** against AA's 4.5 for normal text,
 * so the specified value could not be conformed to and met at the same time. The spec and the lock
 * were amended together with this token; the conformance test in `tokens.test.ts` pins the corrected
 * value, not a relaxed bound.
 *
 * The replacement is `neutralColors.textSecondary`'s own hex, deliberately: an inactive tab label is
 * secondary text on a white ground, so the palette already had the right colour and no new one was
 * introduced. Measured with `contrastRatio`, unrounded:
 *
 *     on neutralColors.surface #FFFFFF     3.7713  ->  4.9748
 *     against active #3157C8 (6.3103)      1.6733  ->  1.2685
 *
 * The active item stays the darker of the two, so selection reads in the same direction it always
 * did — that ordering is preserved, unlike on the module bars, where #88 had no approved token that
 * could both clear AA and stay lighter than the inks. Neither separation figure reached the 3:1 at
 * which a lightness difference becomes legible on its own, so what distinguishes the states here is
 * the hue step from desaturated grey-blue to saturated `#3157C8`, plus `accessibilityState.selected`.
 *
 * A locked tab renders in exactly this tint too — nothing in the slot is dimmed, the padlock is the
 * whole signal — so raising it raises the locked state with it. See `home-bottom-navigation.tsx`.
 */
export const navigationColors = {
  inactive: '#667085',
} as const;

/**
 * Text and icon colour used on top of a module hero gradient.
 *
 * Specification addition: §3.3 requires WCAG AA hero text contrast but does not
 * name a token. Hero surfaces are always a module `dark`→`primary` gradient, so
 * the on-hero colour is `surface` white plus two documented alpha steps for
 * supporting copy. No new hue is introduced.
 */
export const onHeroColors = {
  primary: '#FFFFFF',
  secondary: 'rgba(255,255,255,0.86)',
  muted: 'rgba(255,255,255,0.68)',
  /** Translucent chip/pill fill on a hero, e.g. the AI scope pill. */
  chip: 'rgba(255,255,255,0.18)',
  /** Hairline used to separate hero sub-areas. */
  hairline: 'rgba(255,255,255,0.24)',
} as const;

/** Every module palette from §2.3, keyed by module id. */
export const modulePalettes = {
  main: { primary: '#3949AB', dark: '#26337D', soft: '#EEF0FF', supporting: '#F2B84B' },
  'noor-ai': { primary: '#6556C8', dark: '#473A9E', soft: '#F0EDFF', supporting: '#45BFD1' },
  faith: { primary: '#23856D', dark: '#155E4D', soft: '#E9F6F1', supporting: '#D5A94E' },
  health: { primary: '#4A9FD8', dark: '#2875A8', soft: '#EAF6FC', supporting: '#65C7B2' },
  planner: { primary: '#5A72C9', dark: '#3C50A1', soft: '#EEF1FB', supporting: '#87A7E8' },
  finance: { primary: '#E38A32', dark: '#B7641F', soft: '#FFF3E6', supporting: '#F1B75B' },
  learning: { primary: '#7657D6', dark: '#5839B5', soft: '#F1EDFF', supporting: '#B695F3' },
  family: { primary: '#D95B82', dark: '#A93B60', soft: '#FDECF2', supporting: '#F0A4B8' },
  goals: { primary: '#269B94', dark: '#15716C', soft: '#E8F7F5', supporting: '#67C9BE' },
} as const;

export const colors = {
  ...neutralColors,
  ...semanticColors,
  navigation: navigationColors,
  onHero: onHeroColors,
  modules: modulePalettes,
} as const;

export type ModuleId = keyof typeof modulePalettes;
export type ModulePalette = (typeof modulePalettes)[ModuleId];
export type NeutralColorToken = keyof typeof neutralColors;
export type SemanticColorToken = keyof typeof semanticColors;
