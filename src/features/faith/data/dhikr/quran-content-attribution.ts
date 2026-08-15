/**
 * The attribution Quran Foundation requires for Quran text and translations, and its only home.
 *
 * ── Why a constant, for the same reason the recitation credit is one ────────
 * The permission specifies the sentence **exactly**: not paraphrased, not reordered, not shortened
 * to fit a caption. A second copy typed into a screen is how the full stop after "(Quran.com)" goes
 * missing, or how "provided by" becomes "from" under a layout squeeze — and a licence condition met
 * in three places and broken in a fourth is broken. `quran-derived-dhikr.test.ts` pins this byte for
 * byte and fails if the sentence appears as a literal anywhere else in `src/`.
 *
 * ── This is not the translator credit, and neither substitutes for the other ─
 * The permission carries two separate display requirements: this sentence, which credits the
 * *source*, and the **translator's name**, which must appear with every translation. Showing one
 * does not satisfy the other. The translator travels on the fetched translation itself — see
 * `quran-dhikr.repository.ts`, which refuses to display a translation whose attribution is missing.
 *
 * See `docs/QURAN_FOUNDATION_DHIKR_PERMISSION.md` §8.
 */

/** The exact string, as granted. Do not edit without re-reading the permission record. */
export const QURAN_CONTENT_ATTRIBUTION =
  'Quran text and translations provided by Quran Foundation (Quran.com).';
