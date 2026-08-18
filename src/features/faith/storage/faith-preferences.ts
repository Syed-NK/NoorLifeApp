import type {
  AsrJuristicMethod,
  CalculationMethod,
  PrayerKey,
  PrayerNotificationPreference,
} from '../data/prayer-times.repository';
import type { ReciterId, TranslationId } from '../data/quran-content.repository';
import { faithStorageKeys, hasString, isRecord, readJson, writeJson } from './faith-storage';

/**
 * The user's Faith preferences.
 *
 * ── Why the defaults are named constants and not inline literals ────────────
 * "Which translation does a new user get?" is a product decision with an attribution
 * attached, not an implementation detail. Naming it makes it reviewable, and makes the
 * one place to change it obvious when a licensed edition is chosen.
 *
 * The default translation below is a placeholder identifier, not a licensed edition. It
 * resolves against the mock repository only. Selecting the real default is part of the
 * Quran Foundation approval work — see `data/quran-foundation/README.md`.
 */

export type FaithPreferences = {
  readonly translationId: TranslationId;
  readonly reciterId: ReciterId;
  readonly calculationMethod: CalculationMethod;
  readonly asrMethod: AsrJuristicMethod;
  readonly prayerNotifications: readonly PrayerNotificationPreference[];
  /** Show transliteration beneath Arabic in the Duas screen. */
  readonly showTransliteration: boolean;
  /** Last chosen location label, so a manual city survives a restart. */
  readonly locationLabel: string | null;
};

const DEFAULT_NOTIFICATIONS: readonly PrayerNotificationPreference[] = (
  ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const satisfies readonly PrayerKey[]
).map((prayer) => ({ prayer, enabled: false, minutesBefore: 10 }));

/**
 * Notifications default to **off**.
 *
 * Opting a user into five daily notifications without asking is the kind of default that
 * gets an app uninstalled, and the Faith permission rationale in the module registry
 * promises reminders happen "at the time you choose" — which presupposes choosing.
 */
export const defaultFaithPreferences: FaithPreferences = {
  translationId: 'mock.en.clear',
  reciterId: 'mock.ar.reciter',
  calculationMethod: 'muslim-world-league',
  asrMethod: 'standard',
  prayerNotifications: DEFAULT_NOTIFICATIONS,
  showTransliteration: true,
  locationLabel: null,
};

function isPreferences(value: unknown): value is FaithPreferences {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasString(value, 'translationId') &&
    hasString(value, 'reciterId') &&
    hasString(value, 'calculationMethod') &&
    hasString(value, 'asrMethod') &&
    Array.isArray(value.prayerNotifications) &&
    typeof value.showTransliteration === 'boolean'
  );
}

export async function readFaithPreferences(): Promise<FaithPreferences> {
  const stored = await readJson(
    faithStorageKeys.preferences,
    defaultFaithPreferences,
    isPreferences,
  );
  // Merged over the defaults so a preference added in a later build is present even when
  // the stored blob predates it — otherwise a new field reads as undefined at runtime
  // despite the type claiming it exists.
  return { ...defaultFaithPreferences, ...stored };
}

export async function writeFaithPreferences(
  update: Partial<FaithPreferences>,
): Promise<FaithPreferences> {
  const current = await readFaithPreferences();
  const next: FaithPreferences = { ...current, ...update };
  await writeJson(faithStorageKeys.preferences, next);
  return next;
}
