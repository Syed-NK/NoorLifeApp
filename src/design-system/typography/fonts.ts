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
 * Poppins is SIL Open Font License 1.1. The four faces are registered **twice**, by two
 * mechanisms that answer two different questions, and both are required.
 *
 * ── Android: embedded at build time, because measurement cannot wait ────────
 * `app.json` links the four `.ttf` files under `assets/fonts/` through the `expo-font` config
 * plugin, which copies them to `android/app/src/main/assets/fonts/`. React Native's
 * `ReactFontManager` resolves a `fontFamily` there **by filename**, so `Poppins_600SemiBold.ttf`
 * is reachable as `Poppins_600SemiBold` — the exact keys `fontFamilies` below already used.
 *
 * This is not a packaging preference. Runtime registration alone produced a defect that only
 * appeared in release builds: React Native measured every string in the system fallback face
 * while painting it in Poppins, because the text was measured before `useFonts` had registered
 * anything. Poppins is 10–18% wider than the fallback, so Yoga sized each `Text` view for a
 * narrower face than Android drew and the surplus lines were cropped by the view's own bounds.
 * Measured on the emulator: one string rendered at 16 dp in `Poppins_600SemiBold` and again with
 * no family reported 243.8 dp and 244.9 dp — visibly different faces, indistinguishable widths.
 * Re-navigating never corrected it, because the measurement spannable is cached by string
 * content. Embedding removes the window entirely: the family exists before the first frame.
 *
 * ── iOS and web: still loaded at runtime, and not redundant ─────────────────
 * `useFonts` stays, and `FontProvider` still publishes readiness. iOS resolves an embedded font
 * by its **internal** name, and these files carry `Poppins-Regular` / `Poppins-Medium` /
 * `Poppins-SemiBold` / `Poppins-Bold` — which are *not* the `Poppins_400Regular` style keys the
 * app asks for. Embedding on iOS would therefore add ~600 KB of faces under names nothing
 * references, so the plugin is scoped to `android` and iOS keeps the runtime path that already
 * registers the right keys. Web has no native project at all and depends on it outright.
 *
 * The consequence worth stating: the family names below are the contract between this file,
 * `app.json` and every `fontFamily` in the app. `typography-fonts.test.ts` asserts that the four
 * files exist, that `app.json` links exactly them, and that each filename equals its token.
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
