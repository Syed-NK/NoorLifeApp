import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * On-device persistence for the Faith module.
 *
 * ── What may and may not live here ──────────────────────────────────────────
 * AsyncStorage is unencrypted. Everything below is either the user's own low-sensitivity
 * activity (a dhikr count, which prayers they marked) or a preference (which translation
 * they read). No credential, no token and no API key is written here, and none may be
 * added — the entry flow's `session-storage.ts` makes the same split for the same reason,
 * and the secrets test asserts it across the whole bundle.
 *
 * Worship records are personal, and treating them as low-sensitivity is a judgement worth
 * naming: they stay on-device only, are never transmitted in this phase, and the proposed
 * Supabase schema in `docs/FAITH_DATA_MODEL.md` puts them behind row-level security when
 * they do sync.
 *
 * ── Why every read is total ─────────────────────────────────────────────────
 * Each reader returns a usable value on any failure — a corrupt JSON blob, a missing key,
 * a storage backend that is unavailable. A Faith screen must not fail to render because a
 * preference could not be parsed; the correct degradation is the default, not an error
 * state. Writes are best-effort for the same reason, except where the caller needs to
 * know (`writeChecked`).
 */

const NAMESPACE = 'noorlife.faith';

/** Every key this module owns, in one place so the set is auditable and clearable. */
export const faithStorageKeys = {
  tasbihSession: `${NAMESPACE}.tasbih.session`,
  tasbihHistory: `${NAMESPACE}.tasbih.history`,
  worshipDays: `${NAMESPACE}.worship.days`,
  readingPosition: `${NAMESPACE}.quran.position`,
  /** Per-day ayat read, per-surah furthest verse, and the daily goal. See `faith-reading-log.ts`. */
  readingLog: `${NAMESPACE}.quran.reading-log`,
  /** The coordinate prayer times and the Qibla are calculated for. See `faith-location.ts`. */
  location: `${NAMESPACE}.location`,
  bookmarks: `${NAMESPACE}.bookmarks`,
  /**
   * Which prayer alerts are pending, by local calendar date and prayer.
   *
   * Identifiers and a fingerprint of the inputs that produced them — no coordinate, no place name
   * and no times. See `faith-notification-schedule.ts` for why the fingerprint is stored beside
   * them.
   */
  notificationSchedule: `${NAMESPACE}.notifications.prayer-schedule`,
  preferences: `${NAMESPACE}.preferences`,
  /**
   * The 114-surah catalogue, so Qur'an home opens without a network read.
   *
   * Catalogue metadata only — numbers, names, meanings, ayah counts — never a verse, a translation
   * or a recitation URL, and bounded by the same one-week licence ceiling the in-memory cache
   * enforces. See `faith-quran-catalogue.ts` for why this one key is permitted to persist.
   */
  quranCatalogue: `${NAMESPACE}.quran.catalogue`,
  /**
   * Which surahs the user deliberately downloaded, for which reciter.
   *
   * An index of *decisions*, not content: no audio, no URL and no host is written here — only a
   * reciter id, a surah number, a file count, a byte total and a timestamp. The audio itself lives
   * on the filesystem under the same one-week ceiling, and this key exists so a deliberate download
   * is never evicted by the automatic prefetch and can be described and removed by the user. See
   * `faith-audio-downloads.ts`.
   */
  audioDownloads: `${NAMESPACE}.quran.audio-downloads`,
  /**
   * The user's own notes on individual ayat, keyed by `surah:ayah`.
   *
   * The user's words, never scripture: a note record carries no Arabic and no translation, only the
   * verse it is attached to. See `faith-notes.ts` for why the identity is the verse reference rather
   * than a position in a rendered list.
   */
  quranNotes: `${NAMESPACE}.quran.notes`,
  /**
   * Listening playlists — named lists of verse references, with the reciter each was added under.
   *
   * References only. No audio, no URL and no host: the files themselves live under
   * `faith-audio-downloads.ts` and its one-week ceiling, and a playlist entry is resolved back to a
   * recitation through the repository at the moment it is played.
   */
  quranPlaylists: `${NAMESPACE}.quran.playlists`,
} as const;

export type FaithStorageKey = (typeof faithStorageKeys)[keyof typeof faithStorageKeys];

/**
 * Reads and parses a JSON value.
 *
 * `validate` is required rather than optional. Without it, a value written by an older
 * build deserialises into a shape the current code does not expect and fails somewhere
 * far from here; with it, the bad value is discarded at the boundary and the default is
 * used. Passing `() => true` is possible but is a visible decision at the call site.
 */
export async function readJson<T>(
  key: FaithStorageKey,
  fallback: T,
  validate: (value: unknown) => value is T,
): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw === null) {
      return fallback;
    }
    const parsed: unknown = JSON.parse(raw);
    return validate(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** Best-effort write. Used where a lost preference is an acceptable outcome. */
export async function writeJson(key: FaithStorageKey, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Non-fatal by design — see the note above.
  }
}

/**
 * Write that reports failure.
 *
 * Used by the tasbih counter, where silently dropping an increment would show the user a
 * number that does not survive a restart.
 */
export async function writeChecked(key: FaithStorageKey, value: unknown): Promise<boolean> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export async function removeKey(key: FaithStorageKey): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Nothing to recover; the value is being discarded either way.
  }
}

/** Clears everything this module owns. Used by tests and by a future "reset Faith data". */
export async function clearFaithStorage(): Promise<void> {
  try {
    await AsyncStorage.multiRemove(Object.values(faithStorageKeys));
  } catch {
    // Best effort.
  }
}

// ── Shared type guards ──────────────────────────────────────────────────────
// Small and explicit rather than a schema library: the shapes are few, and adding a
// runtime validation dependency for six keys is not a trade worth making.

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function hasNumber(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === 'number' && Number.isFinite(value[key]);
}

export function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === 'string';
}
