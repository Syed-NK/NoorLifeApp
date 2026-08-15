import { faithStorageKeys, isRecord, readJson, removeKey, writeChecked } from './faith-storage';

/**
 * The content NoorLife holds under Content Sync, for the two resources it has permission to retain.
 *
 * ── Why these rows may outlive the seven-day ceiling and ordinary content may not ──
 * The ceiling is not a property of the bytes; it is a property of how they are kept current.
 * Translation 85 fetched from `list_verse_translations` is a *cache* — nothing would ever tell
 * NoorLife the publisher had corrected it — so it expires. The same text arriving through Content
 * Sync is a *synchronised copy*: the vendor will report the correction, and NoorLife is obliged to
 * apply it within seven connected days. Retention is earned by that obligation, so it is only lawful
 * for rows that actually came through sync.
 *
 * That distinction is enforced structurally rather than by a comment. These rows live in their own
 * store, written by exactly one path, and every row records the sync sequence it arrived at. There is
 * no function here that accepts a translation from the ordinary endpoint, so a long-lived cache
 * cannot be created by mistake and then described as synchronised.
 *
 * ── What is deliberately not stored on a recitation row ─────────────────────
 * The audio URL. A CDN address can be rotated, re-signed or retired, so binding a downloaded file's
 * identity to one would make that identity depend on something the vendor may change without telling
 * anybody. Surah and ayah are the identity; the URL is fetched fresh when a download actually runs.
 */

export const SYNC_ROWS_VERSION = 1;

/** Quran Foundation's own identity for a row, as supplied. Never synthesised, never positional. */
export type RecordKey = string;

export type TranslationRow = {
  /** `surah:ayah`. Stable, and the only thing a lookup is keyed by. */
  readonly verseKey: RecordKey;
  readonly surah: number;
  readonly ayah: number;
  /** The publisher's text, byte for byte. Never trimmed, normalised or re-wrapped. */
  readonly text: string;
  readonly resourceId: number;
  /** The vendor's sequence this row arrived at, where one was supplied. For audit and ordering. */
  readonly sequence: number | null;
  readonly refreshedAt: number;
};

export type RecitationRow = {
  readonly verseKey: RecordKey;
  readonly resourceId: number;
  readonly surah: number;
  readonly ayah: number;
  /** Present only where the vendor actually supplied it. Never estimated. */
  readonly durationSeconds: number | null;
  readonly bytes: number | null;
  readonly sequence: number | null;
  readonly refreshedAt: number;
};

/**
 * The translator credit, kept beside the rows it applies to.
 *
 * A licence condition, not decoration: translation 85 may only be displayed with its translator
 * named. Stored with the rows so that an offline reader showing a synchronised translation always
 * has the credit to show — a screen that cannot name the translator must not render the translation,
 * and the two travelling together is what makes that checkable at the point of use.
 */
export type TranslationAttribution = {
  readonly resourceId: number;
  readonly name: string;
  readonly translator: string;
};

export type SyncedTranslations = {
  readonly version: number;
  readonly resourceId: number;
  readonly attribution: TranslationAttribution | null;
  readonly rows: readonly TranslationRow[];
  readonly syncedAt: number;
};

export type SyncedRecitations = {
  readonly version: number;
  readonly resourceId: number;
  readonly rows: readonly RecitationRow[];
  readonly syncedAt: number;
};

const SURAH_MIN = 1;
const SURAH_MAX = 114;

function isVerseNumber(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= max;
}

function isNullableInteger(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
}

/**
 * Whether a verse key agrees with the surah and ayah beside it.
 *
 * Both are stored, and they are checked against each other rather than one being derived from the
 * other. The key is the vendor's; the numbers are what every lookup and every file binding uses. If
 * they ever disagree the row is discarded, because a row whose identity is ambiguous is a verse that
 * could be shown, or played, in the wrong place.
 */
function keyAgrees(verseKey: unknown, surah: number, ayah: number): boolean {
  return typeof verseKey === 'string' && verseKey === `${surah}:${ayah}`;
}

function isTranslationRow(value: unknown): value is TranslationRow {
  if (!isRecord(value)) {
    return false;
  }
  const { verseKey, surah, ayah, text, resourceId, sequence, refreshedAt } = value;
  return (
    isVerseNumber(surah, SURAH_MAX) &&
    surah >= SURAH_MIN &&
    isVerseNumber(ayah, 286) &&
    keyAgrees(verseKey, surah, ayah) &&
    typeof text === 'string' &&
    text.length > 0 &&
    typeof resourceId === 'number' &&
    Number.isInteger(resourceId) &&
    isNullableInteger(sequence) &&
    typeof refreshedAt === 'number' &&
    Number.isFinite(refreshedAt)
  );
}

function isRecitationRow(value: unknown): value is RecitationRow {
  if (!isRecord(value)) {
    return false;
  }
  const { verseKey, surah, ayah, resourceId, durationSeconds, bytes, sequence, refreshedAt } =
    value;
  return (
    isVerseNumber(surah, SURAH_MAX) &&
    surah >= SURAH_MIN &&
    isVerseNumber(ayah, 286) &&
    keyAgrees(verseKey, surah, ayah) &&
    typeof resourceId === 'number' &&
    Number.isInteger(resourceId) &&
    isNullableInteger(durationSeconds) &&
    isNullableInteger(bytes) &&
    isNullableInteger(sequence) &&
    typeof refreshedAt === 'number' &&
    Number.isFinite(refreshedAt)
  );
}

function isAttribution(value: unknown): value is TranslationAttribution {
  if (!isRecord(value)) {
    return false;
  }
  const { resourceId, name, translator } = value;
  return (
    typeof resourceId === 'number' &&
    Number.isInteger(resourceId) &&
    typeof name === 'string' &&
    name.length > 0 &&
    typeof translator === 'string' &&
    translator.length > 0
  );
}

function isSyncedTranslations(value: unknown): value is SyncedTranslations {
  if (!isRecord(value)) {
    return false;
  }
  const { version, resourceId, attribution, rows, syncedAt } = value;
  return (
    version === SYNC_ROWS_VERSION &&
    typeof resourceId === 'number' &&
    (attribution === null || isAttribution(attribution)) &&
    Array.isArray(rows) &&
    rows.every(isTranslationRow) &&
    typeof syncedAt === 'number'
  );
}

function isSyncedRecitations(value: unknown): value is SyncedRecitations {
  if (!isRecord(value)) {
    return false;
  }
  const { version, resourceId, rows, syncedAt } = value;
  return (
    version === SYNC_ROWS_VERSION &&
    typeof resourceId === 'number' &&
    Array.isArray(rows) &&
    rows.every(isRecitationRow) &&
    typeof syncedAt === 'number'
  );
}

export async function readSyncedTranslations(): Promise<SyncedTranslations | null> {
  return await readJson<SyncedTranslations | null>(
    faithStorageKeys.quranSyncedTranslations,
    null,
    (value): value is SyncedTranslations | null => value === null || isSyncedTranslations(value),
  );
}

export async function readSyncedRecitations(): Promise<SyncedRecitations | null> {
  return await readJson<SyncedRecitations | null>(
    faithStorageKeys.quranSyncedRecitations,
    null,
    (value): value is SyncedRecitations | null => value === null || isSyncedRecitations(value),
  );
}

/**
 * Replaces the whole translation store in one write.
 *
 * ── Why replacement rather than a merge ─────────────────────────────────────
 * This is what a snapshot means: `RESOURCE_CREATE` and `RESOURCE_INVALIDATE` both instruct the client
 * to fetch a snapshot and replace all local rows. Merging would keep rows the vendor has removed,
 * which is the deletion half of the obligation quietly not being honoured.
 *
 * One write for the same reason the checkpoint uses one: a store half-replaced is a store nobody can
 * describe, and `AsyncStorage.setItem` on a single key is the atomicity this platform offers.
 */
export async function replaceSyncedTranslations(next: SyncedTranslations): Promise<boolean> {
  return await writeChecked(faithStorageKeys.quranSyncedTranslations, next);
}

export async function replaceSyncedRecitations(next: SyncedRecitations): Promise<boolean> {
  return await writeChecked(faithStorageKeys.quranSyncedRecitations, next);
}

/**
 * Applies row-level changes to a set of rows, in sequence order.
 *
 * ── Ordering is applied, not assumed ────────────────────────────────────────
 * The vendor emits mutations with a `sequence`, and a page can carry a create and a later delete for
 * the same key. Applying them in arrival order happens to be right most of the time and is wrong
 * exactly when it matters, so they are sorted first. A row with no sequence sorts last and keeps its
 * relative order, because the alternative — dropping it — loses a change.
 *
 * Pure, and takes the rows rather than reading them: the caller has already committed to a
 * transaction boundary, and a function that read and wrote its own state could not participate in it.
 */
export function applyRowMutations<Row extends { readonly verseKey: RecordKey }>(
  rows: readonly Row[],
  mutations: readonly {
    readonly kind: 'upsert' | 'delete';
    readonly verseKey: RecordKey;
    readonly sequence: number | null;
    readonly row?: Row;
  }[],
): readonly Row[] {
  const byKey = new Map(rows.map((row) => [row.verseKey, row]));
  const ordered = [...mutations].sort((left, right) => {
    if (left.sequence === null && right.sequence === null) {
      return 0;
    }
    if (left.sequence === null) {
      return 1;
    }
    if (right.sequence === null) {
      return -1;
    }
    return left.sequence - right.sequence;
  });

  for (const mutation of ordered) {
    if (mutation.kind === 'delete') {
      byKey.delete(mutation.verseKey);
      continue;
    }
    if (mutation.row !== undefined) {
      /* Upsert, because `ROW_CREATE` is documented as "insert, or replace if it already exists". */
      byKey.set(mutation.verseKey, mutation.row);
    }
  }

  /*
    Returned in verse order rather than insertion order. Every consumer reads these as a surah, and a
    store that drifted out of order would make "contiguous" a question about the array rather than
    about the content.
  */
  return [...byKey.values()].sort((left, right) => {
    const parse = (key: string): readonly [number, number] => {
      const [surah, ayah] = key.split(':');
      return [Number(surah), Number(ayah)];
    };
    const [leftSurah, leftAyah] = parse(left.verseKey);
    const [rightSurah, rightAyah] = parse(right.verseKey);
    return leftSurah === rightSurah ? leftAyah - rightAyah : leftSurah - rightSurah;
  });
}

/** Discards both stores. Used for `RESOURCE_DELETE` and when a resource leaves the permission table. */
export async function clearSyncedRows(): Promise<void> {
  await removeKey(faithStorageKeys.quranSyncedTranslations);
  await removeKey(faithStorageKeys.quranSyncedRecitations);
}
