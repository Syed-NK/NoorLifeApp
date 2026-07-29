import {
  Poppins_400Regular,
  Poppins_500Medium,
  Poppins_600SemiBold,
  Poppins_700Bold,
} from '@expo-google-fonts/poppins';

import { fontFamilies } from '@ds/tokens';

/**
 * Font registration for NoorLife.
 *
 * Spec §2.4 permits Poppins weights 400/500/600/700 only — exactly the four
 * loaded below. No italic, no other weight, no other Latin typeface.
 *
 * Poppins is served by `@expo-google-fonts/poppins` (SIL Open Font License 1.1),
 * loaded at runtime through expo-font's `useFonts`. Runtime loading is used
 * rather than the `expo-font` config plugin because the config plugin embeds
 * fonts at prebuild time, which would require rebuilding the installed Android
 * development client. See ASSETS-REQUIRED.md for the Phase 2 migration note.
 */
export const latinFontsToLoad = {
  [fontFamilies.regular]: Poppins_400Regular,
  [fontFamilies.medium]: Poppins_500Medium,
  [fontFamilies.semiBold]: Poppins_600SemiBold,
  [fontFamilies.bold]: Poppins_700Bold,
} as const;

/**
 * Arabic UI typeface boundary (spec §8).
 *
 * Arabic UI must render in Noto Sans Arabic, not Poppins. The family names and
 * the registration hook are declared here so Arabic support is a data change
 * rather than a refactor, but the asset is deliberately **not** bundled in
 * Phase 1: no Arabic UI surface exists yet and shipping four unused Arabic faces
 * would grow the bundle for nothing.
 *
 * To enable (Phase 2):
 *   1. `npx expo install @expo-google-fonts/noto-sans-arabic`
 *   2. Populate `arabicFontsToLoad` with the four weights, mirroring
 *      `latinFontsToLoad`.
 *   3. `useAppFonts` picks them up with no further change.
 */
export const arabicFontFamilies = {
  regular: 'NotoSansArabic_400Regular',
  medium: 'NotoSansArabic_500Medium',
  semiBold: 'NotoSansArabic_600SemiBold',
  bold: 'NotoSansArabic_700Bold',
} as const;

/** Empty until the Arabic asset is added — see the note above. */
export const arabicFontsToLoad: Readonly<Record<string, number>> = {};

/**
 * Quran text typeface boundary (spec §8).
 *
 * Quran verses must use an approved Uthmani face tied to the licensed Quran
 * dataset. No such font is bundled and none may be added speculatively: shipping
 * an unlicensed Quran/Uthmani font is explicitly forbidden. The family name stays
 * `null` until a licensed asset is approved, and any Quran rendering surface must
 * check for `null` and refuse to fall back to Poppins.
 */
export const quranFontFamily: string | null = null;

/** Everything `useAppFonts` hands to expo-font. */
export const fontsToLoad = {
  ...latinFontsToLoad,
  ...arabicFontsToLoad,
} as const;
