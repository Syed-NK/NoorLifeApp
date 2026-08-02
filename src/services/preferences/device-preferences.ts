import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Non-sensitive device preferences.
 *
 * ── What belongs here, and what does not ────────────────────────────────────
 * A device preference is a choice about *this installation* — how the interface behaves on this
 * phone. It is not account data. Nothing here syncs, nothing here is read by the backend, and no
 * database column or migration exists for any of it, which is exactly why a user's Reduce Motion
 * choice can be stored without a schema change.
 *
 * Credentials never come near this module. Tokens live in the Keystore through
 * `@services/auth/session-storage`; AsyncStorage is plain on-device storage and is the wrong place
 * for a secret. The typed key union below is the enforcement: a caller cannot pass an arbitrary
 * string, so "somebody stored a token in preferences" is a compile error rather than a review note.
 *
 * ── Why a service and not `AsyncStorage` at the call site ───────────────────
 * Three reasons the Profile screens depend on. Keys are namespaced in one place, so two features
 * cannot collide on `'reduceMotion'`. A read failure is a *value* — `{ status: 'unavailable' }` —
 * rather than a thrown exception a screen has to remember to catch, so the Preferences screen can
 * render an honest "could not load your settings" with a retry. And presentation never imports the
 * storage library, which `profile-isolation.test.ts` asserts.
 */

/**
 * Every preference this application stores on the device.
 *
 * Storage keys are namespaced `noorlife.preference.*` so they sit apart from the onboarding flags
 * and the Faith module's own storage, both of which predate this service.
 */
const PREFERENCE_KEYS = {
  reduceMotion: 'noorlife.preference.reduceMotion',
} as const;

export type PreferenceKey = keyof typeof PREFERENCE_KEYS;

/**
 * A read that either produced the stored value, produced the default because nothing was stored,
 * or could not reach storage at all.
 *
 * The third case is kept distinct from the second on purpose: "you have never set this" and "we
 * could not read your settings" are different things to tell a user, and collapsing them would
 * make a storage failure look like a deliberate default.
 */
export type PreferenceRead<T> =
  | { readonly status: 'stored'; readonly value: T }
  | { readonly status: 'default'; readonly value: T }
  | { readonly status: 'unavailable' };

export type PreferenceWrite = { readonly status: 'saved' } | { readonly status: 'unavailable' };

/** Reads a boolean preference. Anything other than the two stored forms is treated as unset. */
export async function readBooleanPreference(
  key: PreferenceKey,
  fallback: boolean,
): Promise<PreferenceRead<boolean>> {
  try {
    const raw = await AsyncStorage.getItem(PREFERENCE_KEYS[key]);
    if (raw === 'true') {
      return { status: 'stored', value: true };
    }
    if (raw === 'false') {
      return { status: 'stored', value: false };
    }
    // Never written, or written by a version that stored something else. Either way the honest
    // answer is the default, not a guess at what the old value meant.
    return { status: 'default', value: fallback };
  } catch {
    return { status: 'unavailable' };
  }
}

/**
 * Writes a boolean preference.
 *
 * Reports failure rather than swallowing it. A preference the user just changed and that silently
 * did not persist is worse than one that says it could not be saved — the user would set it again
 * on the next launch, and again after that, with nothing on screen explaining why.
 */
export async function writeBooleanPreference(
  key: PreferenceKey,
  value: boolean,
): Promise<PreferenceWrite> {
  try {
    await AsyncStorage.setItem(PREFERENCE_KEYS[key], value ? 'true' : 'false');
    return { status: 'saved' };
  } catch {
    return { status: 'unavailable' };
  }
}

/** The storage key a preference occupies. Exported for tests, not for call sites. */
export function preferenceStorageKey(key: PreferenceKey): string {
  return PREFERENCE_KEYS[key];
}
