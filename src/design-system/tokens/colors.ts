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

/** §2.1 Neutral foundation — the application canvas is neutral, never tinted. */
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
 * Specification addition: §3.2 states "inactive items use `#7A8496`" inline
 * rather than in the token tables, so it is lifted here to keep the value out
 * of component code. The literal is unchanged from the specification.
 */
export const navigationColors = {
  inactive: '#7A8496',
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
