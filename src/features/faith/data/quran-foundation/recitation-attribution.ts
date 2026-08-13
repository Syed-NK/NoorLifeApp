/**
 * The attribution Quran Foundation requires for Abdur-Rahman as-Sudais, and the one place it exists.
 *
 * ── Why the string is a constant and not typed at each call site ─────────────
 * The permission specifies it **exactly**. Not paraphrased, not reordered, not abbreviated to fit a
 * row. A second copy typed into a screen is how the full stop after "(Quran.com)" goes missing, or how
 * "Audio provided by" becomes "Audio from" in a layout squeeze — and a licence condition met in three
 * places and broken in a fourth is broken. `recitation-attribution.test.ts` pins this byte for byte.
 *
 * ── Why it is a lookup rather than a component prop ─────────────────────────
 * Because the permission applies to **resource ID 3 alone**, and that is the property most at risk of
 * being lost. The obvious implementation — an `attribution` field on the reciter row, filled in from
 * whichever reciter is selected — generalises the grant to all of them the first time somebody adds a
 * second reciter's credit. `attributionForReciter` answers `null` for every other id, so extending the
 * permission requires editing this file and cannot happen by accident at a call site.
 *
 * ── What this does *not* claim ──────────────────────────────────────────────
 * Nothing here says anything about offline retention. The extended-retention permission is granted but
 * **not implemented**: the seven-day read-time expiry is still in force for every reciter including
 * this one, and it stays in force until the Content Sync mechanism is confirmed and built. The
 * attribution is a condition of *using* the recitation, which NoorLife does today by streaming and by
 * the bounded download that already exists — so it is owed today, and stating it now implies nothing
 * about a feature that does not exist yet. See `docs/QURAN_FOUNDATION_AUDIO_PERMISSION.md`.
 */

/** Quran Foundation's recitation resource id for Abdur-Rahman as-Sudais. */
export const SUDAIS_RESOURCE_ID = '3';

/**
 * The exact string, as granted. Do not edit without re-reading the permission record.
 *
 * Two sentences, one space between them, a full stop on each. "Quran" is unaccented in both places
 * because that is how the permission writes it, and "(Quran.com)" carries the parentheses.
 */
export const SUDAIS_ATTRIBUTION =
  'Recitation by Abdur-Rahman as-Sudais. Audio provided by Quran Foundation (Quran.com).';

/**
 * The required attribution for a reciter, or `null` when none is required.
 *
 * `null` for every id but `3`. That is not a placeholder for future entries: other reciters are used
 * under the ordinary Developer Terms, which the content-information screen already acknowledges
 * collectively, and none of them carries a bespoke written permission with its own wording.
 */
export function attributionForReciter(reciterId: string): string | null {
  return reciterId === SUDAIS_RESOURCE_ID ? SUDAIS_ATTRIBUTION : null;
}
