import AsyncStorage from '@react-native-async-storage/async-storage';

import type {
  FaithPreferences,
  TranslationChoice,
} from '@features/faith/storage/faith-preferences';
import { faithAddress } from '@/test-support/faith-storage-address';

/**
 * Seeds a chosen translation, for suites that are testing something other than how one is chosen.
 *
 * ── Why this became necessary ───────────────────────────────────────────────
 * NoorLife no longer ships a hard-coded default translation. It resolves one from the live
 * catalogue and **probes it with a real verse request** before accepting it, because the previous
 * constant (`131`) turned out to be an edition that is listed, is selectable, and returns nothing.
 *
 * That is the right behaviour and it has a cost for tests: a screen mounted with empty storage
 * spends two repository round-trips deciding what to read before it can read anything, and a suite
 * asserting on the reader, on search or on recitation is then implicitly asserting on resolution
 * too. Worse, a suite that stubs `listTranslations` to fail — several do, deliberately, to exercise
 * the reader's failure banner — also fails the probe, so no edition is ever chosen and the banner
 * under test never renders.
 *
 * Seeding says what those suites actually mean: *given a translation is selected*, this is how the
 * screen behaves. Resolution itself is covered directly in `faith-translation-selection.test.tsx`.
 */

/** An edition present in the Qur'an fixtures, marked as the user's own deliberate choice. */
export const SEEDED_TRANSLATION: TranslationChoice = {
  id: '20',
  language: 'english',
  name: 'Plain rendering (sample)',
  translator: 'NoorLife sample',
};

/**
 * Writes a preferences blob with a translation already chosen.
 *
 * `translationChosenByUser: true` so the migration leaves it alone — a seeded value that migration
 * then re-resolved would reintroduce exactly the round-trip this helper exists to avoid.
 */
export async function seedTranslationPreference(
  overrides: Partial<FaithPreferences> = {},
): Promise<void> {
  await AsyncStorage.setItem(
    faithAddress('preferences'),
    JSON.stringify({
      translation: SEEDED_TRANSLATION,
      translationChosenByUser: true,
      ...overrides,
    }),
  );
}
