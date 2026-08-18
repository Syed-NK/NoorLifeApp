import AsyncStorage from '@react-native-async-storage/async-storage';

import { faithDomainKeyOf, getActiveFaithScope, scopedFaithAddress } from './faith-user-scope';

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
  /** The user's own counter labels. Private, on-device, never sent anywhere. */
  tasbihLabels: `${NAMESPACE}.tasbih.labels`,
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
   * References only. No audio, no URL and no host: the files themselves are indexed by
   * `faith-offline-recitation.ts`, and a playlist entry is resolved back to a local file through the
   * offline manifest at the moment it is played.
   */
  quranPlaylists: `${NAMESPACE}.quran.playlists`,
  /**
   * Cached Arabic and translations for the Quran-derived Dhikr selector.
   *
   * Quran Foundation content, held under the retention rules in
   * `docs/QURAN_FOUNDATION_DHIKR_PERMISSION.md` — Arabic refreshed rather than expired, translations
   * capped at one week. See `faith-dhikr-cache.ts`.
   */
  dhikrContentCache: `${NAMESPACE}.dhikr.content-cache`,
  /**
   * The user's own Dhikr state: selected reference, favourites, recents.
   *
   * ── Deliberately a *separate key* from the cache above ──────────────────────
   * Content expires; this does not. Retained indefinitely under the same permission, and split so
   * that a translation ageing out cannot take a user's selection or their counter history with it.
   * Holds catalogue ids and nothing else — no scripture, no translation, no title.
   */
  dhikrUserState: `${NAMESPACE}.dhikr.user-state`,
  /**
   * What this account decided about the unowned Faith data found on this device.
   *
   * `imported`, `removed`, or absent for "not yet asked / decide later". Scoped like everything
   * else, because the decision belongs to the account that made it: user A choosing "decide later"
   * must not answer the question on user B's behalf. See `faith-legacy-quarantine.ts`.
   */
  legacyDecision: `${NAMESPACE}.legacy-decision`,
  /**
   * How far NoorLife has read the Quran Foundation change feed, per canonical resource filter.
   *
   * A token and a timestamp — no content of any kind. Kept apart from the rows it governs because
   * the two have different lifetimes: a content store can be rebuilt from a snapshot without
   * losing the audit trail, and a stale token can be discarded without discarding the content.
   * See `faith-sync-checkpoint.ts` for why the token may only ever be advanced after a whole run.
   */
  quranSyncCheckpoint: `${NAMESPACE}.quran.sync-checkpoint`,
  /**
   * Translation 85, as synchronised — not as cached.
   *
   * The distinction is the licence: text from the ordinary endpoint expires at one week because
   * nothing would report a correction, while text arriving through Content Sync may be retained
   * because the vendor will report one and NoorLife is obliged to apply it. Its own key so the
   * two can never be confused for one another. See `faith-sync-rows.ts`.
   */
  quranSyncedTranslations: `${NAMESPACE}.quran.synced-translations`,
  /**
   * Sudais recitation rows — resource id, surah, ayah, and sizes where the vendor supplied them.
   *
   * Deliberately holds **no audio URL**. A CDN address can be rotated or re-signed, so binding a
   * downloaded file to one would make its identity depend on something the vendor may change.
   * Surah and ayah are the identity.
   */
  quranSyncedRecitations: `${NAMESPACE}.quran.synced-recitations`,
  /**
   * When the Sudais recitation resource was last reconciled, and how it was reached.
   *
   * ── Why this is not the sync checkpoint's clock ──────────────────────────
   * `quranSyncCheckpoint.lastSyncedAt` says when the **change feed** was last read to completion.
   * This says when **resource 3's contents** were last compared against what is on the device. They
   * are different obligations and they come due independently: a feed that reports nothing is a
   * successful feed read and tells you nothing about the audio.
   *
   * Keeping them apart is what stops one masquerading as the other — which matters here more than
   * usual, because the feed has never emitted a recitation mutation, so the audio clock is the only
   * evidence that the audio was ever checked at all.
   *
   * Holds two timestamps and one closed enum. No content, no URL, no id beyond the approved one.
   * Retired. The generation manifest is the single authority for both the seven-day feed clock
   * (`createdAt`) and the recitation integrity clock (`recitation.lastCheckedAt`), so nothing reads
   * or writes this key any more. It is left declared, and deliberately not migrated or deleted from
   * devices: an inert private key costs nothing, and a migration that touched it could only risk
   * data it no longer owns.
   */
  quranRecitationCheck: `${NAMESPACE}.quran.recitation-check`,
  /**
   * Which published generation of synchronised content is active. **Two fields, nothing else.**
   *
   * ── Why the content is not here ─────────────────────────────────────────
   * Translation 85 and recitation 3 are 6,236 rows each; the live snapshots measured
   * `over_2_to_4_mib` and `over_4_to_8_mib`, and the transformed JSON is larger still. AsyncStorage
   * is one SQLite database with a shared cursor window — storing rows of that size is a production
   * failure that an in-memory test double would never reveal, and raising the database size or
   * sharding across keys moves it rather than removes it.
   *
   * So the rows are file-backed and this key holds `{version, generationId}` — a few dozen bytes.
   * Writing it is the single act that publishes a generation, which is what makes a crash unable to
   * expose translations from one run beside recitations from another. See `faith-sync-generation.ts`.
   */
  quranGenerationPointer: `${NAMESPACE}.quran.generation-pointer`,
  /*
    ── There is deliberately no key for downloaded recitation audio ──────────
    There used to be two: `audioDownloads`, a surah-level index of decisions, and
    `quranAudioManifest`, a row per downloaded ayah. Both are gone, and neither was replaced by a
    third AsyncStorage key.

    The reason is the same measurement recorded above. A complete offline recitation is 6,236 rows;
    the document is a few hundred kilobytes and is rewritten as files land. That does not belong in
    one SQLite database with a shared cursor window, and sharding it across keys would move the
    failure rather than remove it. So the offline manifest is an ordinary private file, written
    atomically — see `faith-offline-recitation.ts` and `expo-manifest-file.ts`.

    The audio itself has never been in AsyncStorage and never could be.
  */
} as const;

export type FaithStorageKey = (typeof faithStorageKeys)[keyof typeof faithStorageKeys];

/** The name of a key in the registry above, rather than its address. */
export type FaithStorageKeyName = keyof typeof faithStorageKeys;

/**
 * The keys holding something a **user authored or chose**, as opposed to publisher content.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── This list is the ownership decision, and it is the whole of it ─────────
 * Everything named here is partitioned by account; everything absent is shared by the device. The
 * split is not "sensitive vs not" — it is *whose it is*. A downloaded recitation is Abdur-Rahman
 * as-Sudais's and Quran Foundation's, installed on this phone; a bookmark pointing at ayah 2:255 is
 * the user's, and belongs to whoever made it.
 *
 * ── Two entries worth defending ────────────────────────────────────────────
 * **`location`** is scoped even though a phone is only ever in one place at a time. The stored
 * record is a coordinate and a place name, and showing user B that this device's owner prays in a
 * named city discloses user A's whereabouts. It is the most revealing value Faith stores, so it is
 * the last one that should be shared by default. The cost is that a new account has no location
 * until it resolves one, which every screen already handles — there has never been a default city.
 *
 * **`notificationSchedule`** is scoped because the alerts it tracks were scheduled from one user's
 * chosen city, method and prayer selection. Leaving it device-wide would let user B's phone keep
 * firing prayer alerts computed for user A's location, which is both an exposure and simply wrong.
 *
 * ── And two that deliberately stay device-wide ─────────────────────────────
 * `dhikrContentCache` and `quranCatalogue` are publisher content under a retention rule, not user
 * choices. Partitioning them would make two accounts on one phone download the same verses twice
 * and hold them under two separate expiry clocks — more vendor traffic and a weaker compliance
 * story, for no privacy gain, because the content is identical for everyone.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const USER_SCOPED_KEY_NAMES = [
  'tasbihSession',
  'tasbihHistory',
  'tasbihLabels',
  'worshipDays',
  'readingPosition',
  'readingLog',
  'location',
  'bookmarks',
  'notificationSchedule',
  'preferences',
  'quranNotes',
  'quranPlaylists',
  'dhikrUserState',
  'legacyDecision',
] as const satisfies readonly FaithStorageKeyName[];

export type UserScopedKeyName = (typeof USER_SCOPED_KEY_NAMES)[number];

/** The device-wide remainder, derived rather than restated so the two can never drift apart. */
export const DEVICE_SCOPED_KEY_NAMES = (
  Object.keys(faithStorageKeys) as FaithStorageKeyName[]
).filter(
  (name) => !(USER_SCOPED_KEY_NAMES as readonly string[]).includes(name),
) satisfies readonly FaithStorageKeyName[];

/** The addresses that must never be reachable without an owner. */
export const USER_SCOPED_KEYS: ReadonlySet<string> = new Set(
  USER_SCOPED_KEY_NAMES.map((name) => faithStorageKeys[name]),
);

export function isUserScopedFaithKey(key: string): boolean {
  return USER_SCOPED_KEYS.has(key);
}

/**
 * Where a key actually lives right now, or `null` if it lives nowhere.
 *
 * ── The three outcomes, and why the third is not an error ──────────────────
 *   • A device key resolves to itself — publisher content is not partitioned.
 *   • A user key with an owner resolves under that owner's namespace.
 *   • A user key with **no owner resolves to `null`**, and every operation below turns that into
 *     the caller's own fallback, a dropped write, or a no-op delete.
 *
 * The third case is a normal state, not a fault: nobody is signed in, so there is no correct
 * namespace to read or write. Returning the unscoped key instead would restore the exposure in one
 * line, and throwing would crash Faith screens that are legitimately reachable while signed out.
 * Rendering defaults is the honest answer to "whose bookmarks?" when the answer is "nobody's".
 */
export function resolveFaithAddress(key: FaithStorageKey): string | null {
  if (!USER_SCOPED_KEYS.has(key)) {
    return key;
  }
  const scope = getActiveFaithScope();
  if (scope === null) {
    return null;
  }
  return scopedFaithAddress(scope, faithDomainKeyOf(key));
}

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
  const address = resolveFaithAddress(key);
  if (address === null) {
    /* No owner, so no value of this user's can exist. The default is the only honest answer. */
    return fallback;
  }
  try {
    const raw = await AsyncStorage.getItem(address);
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
  const address = resolveFaithAddress(key);
  if (address === null) {
    /*
      Dropped rather than written somewhere shared. A signed-out write has no owner to attribute it
      to, and the two alternatives are both worse: the unscoped key is the exposure, and an
      "anonymous" namespace is data the next account either inherits or never sees.
    */
    return;
  }
  try {
    await AsyncStorage.setItem(address, JSON.stringify(value));
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
  const address = resolveFaithAddress(key);
  if (address === null) {
    /*
      `false`, which is the truth: the value was not stored. This is the caller that *asked* to be
      told — the tasbih counter — and telling it "saved" would show a number that vanishes.
    */
    return false;
  }
  try {
    await AsyncStorage.setItem(address, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export async function removeKey(key: FaithStorageKey): Promise<void> {
  const address = resolveFaithAddress(key);
  if (address === null) {
    return;
  }
  try {
    await AsyncStorage.removeItem(address);
  } catch {
    // Nothing to recover; the value is being discarded either way.
  }
}

/**
 * Clears everything this module owns **for the current owner**, plus the device-wide keys.
 *
 * ── What "everything" can and cannot mean now ──────────────────────────────
 * It cannot mean every account's data, because the addresses of other accounts are not derivable
 * from here without enumerating the store — and a reset that reached across accounts would be the
 * exposure with a different verb. So this clears the device keys and whichever owner is active;
 * with no owner it clears the device keys alone.
 *
 * Used by tests and by "reset Faith data". Deliberately **not** called on sign-out: user A's data
 * survives so that A signing back in finds it, which is the entire point of partitioning rather
 * than deleting.
 */
export async function clearFaithStorage(): Promise<void> {
  const addresses = Object.values(faithStorageKeys)
    .map((key) => resolveFaithAddress(key))
    .filter((address): address is string => address !== null);
  try {
    await AsyncStorage.multiRemove(addresses);
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
