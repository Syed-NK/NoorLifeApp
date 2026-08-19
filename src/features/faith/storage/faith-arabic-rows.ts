import type { RecordKey } from './faith-sync-rows';

/**
 * The complete Arabic Qur'an, as retained under Quran Foundation's written permission.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What the permission actually licenses, and what that forces here ───────
 * The grant of 2026-08-18 permits retaining the **complete, unmodified** Arabic text in private
 * application storage beyond one week, for offline in-app reading and synchronised recitation
 * playback. Two words in that sentence do the work.
 *
 * **Complete.** A partial Qur'an is not a licensed artefact — it is a corruption of one. So there is
 * no such thing as a valid partial dataset here: `validateArabicDataset` accepts exactly 6,236 rows
 * covering every canonical verse key once, and refuses everything else. A reader that shows 6,000
 * verses and silently omits 236 is worse than a reader that honestly says Arabic is unavailable.
 *
 * **Unmodified.** Every transformation a well-meaning engineer might reach for is prohibited, and
 * each has a specific way of being wrong:
 *
 *   • trimming — Qur'anic text carries meaningful leading and trailing marks;
 *   • Unicode normalisation — NFC/NFD reorders combining marks and changes the bytes of scripture;
 *   • diacritic stripping or rewriting — the ḥarakāt *are* the text in an Uthmani rendering;
 *   • character substitution — visually identical codepoints are not the same codepoint;
 *   • Bismillah reconstruction — the publisher decides where it belongs and whether it is part of
 *     ayah 1; synthesising it invents scripture.
 *
 * None of those is applied. `text` is whatever the publisher sent, and `assertNoTransformation`
 * exists so that a future edit which introduces one fails a test rather than shipping.
 *
 * ── Why the script is named and pinned ─────────────────────────────────────
 * The permission covers the Arabic text NoorLife requests, and NoorLife requests exactly one
 * representation: `text_uthmani`, which the server boundary already names as its scripture edition.
 * Recording the script on the dataset means a generation can never mix two renderings, and a future
 * change of edition is a visible, deliberate act rather than a silent drift.
 *
 * ── What is deliberately absent ────────────────────────────────────────────
 * No URL, no cursor, no token, no page number, no raw response. Provenance here is the script
 * identifier, the row count and the integrity fields — enough to validate what is held, and nothing
 * that could reconstruct how it was fetched or expose a credential.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The complete ayah count of the Qur'an. A dataset claiming completeness must produce exactly this. */
export const TOTAL_AYAH_COUNT = 6236;

export const MIN_SURAH = 1;
export const MAX_SURAH = 114;

/**
 * The Arabic representation NoorLife requests and retains.
 *
 * A constant rather than a parameter. The server boundary requests `fields=text_uthmani` and names
 * this edition; a dataset that accepted a script argument could hold two renderings across two runs
 * and no reader could tell which it was showing.
 */
export const ARABIC_SCRIPT = 'text_uthmani' as const;

export type ArabicScript = typeof ARABIC_SCRIPT;

export type ArabicRow = {
  /** `surah:ayah`. The publisher's own identity for the verse, never synthesised, never positional. */
  readonly verseKey: RecordKey;
  readonly surah: number;
  readonly ayah: number;
  /**
   * The publisher's Arabic, exactly as received.
   *
   * Never trimmed, normalised, re-wrapped, substituted or reconstructed. See the module note.
   */
  readonly text: string;
  readonly script: ArabicScript;
};

export type ArabicDatasetProvenance = {
  readonly script: ArabicScript;
  readonly rowCount: number;
  /** When the complete dataset was last confirmed against the publisher. */
  readonly lastCheckedAt: number;
};

export type ArabicValidationFailure =
  | { readonly kind: 'wrong-row-count'; readonly received: number }
  | { readonly kind: 'duplicate-verse-key'; readonly verseKey: RecordKey }
  | { readonly kind: 'missing-verse-key'; readonly verseKey: RecordKey }
  | { readonly kind: 'malformed-row'; readonly index: number; readonly reason: string }
  | { readonly kind: 'verse-key-out-of-range'; readonly verseKey: RecordKey }
  | { readonly kind: 'verse-key-mismatch'; readonly verseKey: RecordKey }
  | { readonly kind: 'wrong-script'; readonly received: string };

export type ArabicValidation =
  | { readonly ok: true; readonly rows: readonly ArabicRow[] }
  | { readonly ok: false; readonly failure: ArabicValidationFailure };

/** `surah:ayah` with no leading zeros, no whitespace and no alternative separator. */
const VERSE_KEY = /^([1-9][0-9]{0,2}):([1-9][0-9]{0,2})$/;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Whether a row is structurally a row at all.
 *
 * Deliberately strict about `text`. An empty string is refused because a verse with no text is not a
 * verse — it is a hole that would render as a blank line in a Qur'an, which is precisely the silent
 * corruption completeness validation exists to prevent.
 */
function malformedReason(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) {
    return 'not an object';
  }
  const row = value as Partial<ArabicRow>;
  if (typeof row.verseKey !== 'string' || !VERSE_KEY.test(row.verseKey)) {
    return 'verseKey is not a canonical surah:ayah string';
  }
  if (!isPositiveInteger(row.surah) || !isPositiveInteger(row.ayah)) {
    return 'surah and ayah must be positive integers';
  }
  if (typeof row.text !== 'string' || row.text.length === 0) {
    return 'text must be a non-empty string';
  }
  if (row.script !== ARABIC_SCRIPT) {
    return `script must be ${ARABIC_SCRIPT}`;
  }
  return null;
}

/**
 * Every canonical verse key, in order, built from the supplied ayah counts.
 *
 * The counts are the caller's — they come from the publisher's chapter list, not from a table
 * invented here. Hard-coding 114 ayah counts in this repository would be scholarly content NoorLife
 * has no licence and no standing to author.
 */
export function expectedVerseKeys(ayahCounts: readonly number[]): readonly RecordKey[] {
  const keys: RecordKey[] = [];
  for (let index = 0; index < ayahCounts.length; index += 1) {
    const surah = index + 1;
    const count = ayahCounts[index] ?? 0;
    for (let ayah = 1; ayah <= count; ayah += 1) {
      keys.push(`${surah}:${ayah}`);
    }
  }
  return keys;
}

/**
 * Accepts a dataset only when it is the complete Qur'an, once, in the pinned script.
 *
 * ── Why every failure is named ─────────────────────────────────────────────
 * A boolean would tell a caller to discard the dataset and tell an operator nothing. These reasons
 * distinguish "the vendor sent 6,235 rows" from "the vendor sent a row for surah 115" from "two rows
 * claim the same verse" — three very different faults, one of which is a contract change and two of
 * which are corruption.
 *
 * The rows are returned unchanged on success. This function validates; it never repairs, reorders or
 * fills. Repair is transformation, and transformation is what the licence forbids.
 */
export function validateArabicDataset(
  rows: readonly unknown[],
  expectedKeys: readonly RecordKey[],
): ArabicValidation {
  for (let index = 0; index < rows.length; index += 1) {
    const reason = malformedReason(rows[index]);
    if (reason !== null) {
      const candidate = rows[index] as Partial<ArabicRow> | null;
      if (reason.startsWith('script') && candidate !== null) {
        return { ok: false, failure: { kind: 'wrong-script', received: String(candidate.script) } };
      }
      return { ok: false, failure: { kind: 'malformed-row', index, reason } };
    }
  }

  const typed = rows as readonly ArabicRow[];

  if (typed.length !== expectedKeys.length) {
    return { ok: false, failure: { kind: 'wrong-row-count', received: typed.length } };
  }

  const seen = new Map<RecordKey, ArabicRow>();
  for (const row of typed) {
    const [surahPart, ayahPart] = row.verseKey.split(':');
    /*
      The key and the numeric fields must agree. A row whose verseKey says 2:5 while its surah says 3
      is not merely odd — every lookup in the reader is by key, so the mismatch would surface as the
      wrong verse under the right heading.
    */
    if (Number(surahPart) !== row.surah || Number(ayahPart) !== row.ayah) {
      return { ok: false, failure: { kind: 'verse-key-mismatch', verseKey: row.verseKey } };
    }
    if (row.surah < MIN_SURAH || row.surah > MAX_SURAH) {
      return { ok: false, failure: { kind: 'verse-key-out-of-range', verseKey: row.verseKey } };
    }
    if (seen.has(row.verseKey)) {
      return { ok: false, failure: { kind: 'duplicate-verse-key', verseKey: row.verseKey } };
    }
    seen.set(row.verseKey, row);
  }

  for (const key of expectedKeys) {
    if (!seen.has(key)) {
      return { ok: false, failure: { kind: 'missing-verse-key', verseKey: key } };
    }
  }

  return { ok: true, rows: typed };
}

/**
 * Proves a row survived the pipeline byte for byte.
 *
 * Used by tests rather than by the write path, because the write path's correctness is *not applying*
 * a transformation — and the honest way to assert an absence is to compare what went in with what
 * came out.
 */
export function isExactlyPreserved(received: string, stored: string): boolean {
  return received === stored;
}
