/**
 * NoorLife locked typography tokens.
 *
 * Source of truth: docs/NOORLIFE_UI_DESIGN_SPEC.md §2.4.
 *
 * Poppins is the only Latin UI typeface. Only weights 400, 500, 600 and 700 are
 * permitted. Arabic UI uses Noto Sans Arabic (see fonts.ts for the boundary);
 * Quran text requires a separately licensed Uthmani face and is out of scope.
 */

/** The four permitted Poppins weights. */
export const fontWeights = {
  regular: '400',
  medium: '500',
  semiBold: '600',
  bold: '700',
} as const;

export type FontWeightToken = keyof typeof fontWeights;

/**
 * Registered font family names.
 *
 * These are the exact names `@expo-google-fonts/poppins` registers with
 * expo-font, so `fontFamily` must use them verbatim rather than relying on
 * `fontWeight`, which does not select a face reliably on Android.
 */
export const fontFamilies = {
  regular: 'Poppins_400Regular',
  medium: 'Poppins_500Medium',
  semiBold: 'Poppins_600SemiBold',
  bold: 'Poppins_700Bold',
} as const;

/**
 * §2.4 type scale. `size` / `lineHeight` are the specified px pairs.
 *
 * Minimum supported body size is 14. Do not introduce additional steps.
 */
export const textScale = {
  /** 32 / 40 · 700 — splash and marketing only. */
  display: { size: 32, lineHeight: 40, weight: 'bold' },
  /** 24 / 31 · 700 — hero-card headline. */
  heroTitle: { size: 24, lineHeight: 31, weight: 'bold' },
  /** 20 / 28 · 600 — app-bar title. */
  screenTitle: { size: 20, lineHeight: 28, weight: 'semiBold' },
  /** 17 / 24 · 600 — section headings. */
  sectionTitle: { size: 17, lineHeight: 24, weight: 'semiBold' },
  /** 15 / 22 · 600 — card and list headings. */
  cardTitle: { size: 15, lineHeight: 22, weight: 'semiBold' },
  /** 14 / 21 · 400 — main body content. */
  body: { size: 14, lineHeight: 21, weight: 'regular' },
  /** 14 / 21 · 500 — emphasised content. */
  bodyMedium: { size: 14, lineHeight: 21, weight: 'medium' },
  /** 12 / 17 · 500 — form and navigation labels. */
  label: { size: 12, lineHeight: 17, weight: 'medium' },
  /** 11 / 16 · 400 — metadata. */
  caption: { size: 11, lineHeight: 16, weight: 'regular' },
  /** 34 / 40 · 600 — scores, balances, progress. */
  dataLarge: { size: 34, lineHeight: 40, weight: 'semiBold' },
} as const satisfies Record<
  string,
  { readonly size: number; readonly lineHeight: number; readonly weight: FontWeightToken }
>;

export type TextVariant = keyof typeof textScale;

/** Smallest permitted body size (§2.4). Used by text-scaling clamps. */
export const minimumBodyFontSize = 14;

export const typography = {
  families: fontFamilies,
  weights: fontWeights,
  scale: textScale,
  minimumBodyFontSize,
} as const;
