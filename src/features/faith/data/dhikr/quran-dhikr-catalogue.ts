/**
 * The curated catalogue of Quran-derived Dhikr **references** — and the gate that keeps unreviewed
 * ones out of the product.
 *
 * ── What this file holds, and the one thing it may never hold ───────────────
 * References. A surah number, a start ayah, an end ayah, and NoorLife's own metadata about the
 * entry. **No Arabic, no translation, no transliteration** — not one character of scripture appears
 * in this bundle, and `quran-derived-dhikr.test.ts` scans for it.
 *
 * That is not squeamishness, it is the cheapest available enforcement of the permission's first
 * mandatory requirement, *Arabic Quran text remains unchanged*. Text that is not in the source
 * cannot be normalised by a helpful refactor, cannot drift from the vendor's current rendering
 * across a release, cannot be re-pointed by an editor that rewrites Arabic diacritics, and cannot be
 * corrected in a pull request nobody reads closely. It arrives from the Content API at runtime and
 * is rendered exactly as received. See `docs/QURAN_FOUNDATION_DHIKR_PERMISSION.md` §7.
 *
 * ── The two permissions this feature needs, and why only one of them exists ─
 * Quran Foundation has confirmed NoorLife *may build this* under its existing Content API access —
 * no new scope, no fee, no production approval. That grant is real and is recorded.
 *
 * It is **not** scholarly approval, and conflating the two is the failure this file is built to make
 * impossible. Whether a particular ayah is appropriate as a dhikr, what count is recommended for it,
 * and what context should accompany it are religious judgements that a vendor's API terms say
 * nothing about. Five source-less dhikr presets once shipped in this app and had to be removed;
 * they were removed for exactly this reason, and a developer choosing verses from memory is how they
 * got there.
 *
 * So: `PRODUCTION_DHIKR_CATALOGUE` is **empty**, and it is empty on purpose. It stays empty until a
 * qualified reviewer supplies entries with the review record `approvedForProduction` demands.
 */

/** Where an entry stands with NoorLife's scholarly review. */
export type DhikrReviewStatus =
  /**
   * Proposed, not reviewed. May exist in the development review file; may never reach production.
   *
   * The gate below rejects it, and the production catalogue does not import the file that holds it,
   * so a pending entry cannot arrive in a build even if the gate were bypassed.
   */
  | 'pending'
  /** Reviewed and approved by a named reviewer, with a citable record. The only shippable state. */
  | 'approved'
  /** Reviewed and rejected. Retained so the same reference is not re-proposed and re-reviewed. */
  | 'rejected'
  /** Previously approved and since withdrawn. Treated as un-shippable, and never silently dropped. */
  | 'withdrawn';

/**
 * Who approved an entry, and against what.
 *
 * Required on every approved entry, and required to be *specific*: "reviewed internally" is not a
 * reviewer and "various scholars" is not a source. The gate checks these are non-empty, which is a
 * structural floor rather than a judgement of quality — the judgement is the reviewer's, and this
 * only ensures there is a reviewer to point at.
 */
export type DhikrReviewRecord = {
  /** The named person or body who approved this entry. */
  readonly reviewer: string;
  /** The citable basis — a work, a ruling, a published collection. Never invented. */
  readonly source: string;
  /** ISO date of the review. */
  readonly reviewedOn: string;
};

/** The categories a curated entry may be filed under. Closed, so a typo is a compile error. */
export type DhikrCategory =
  | 'quranic-remembrance'
  | 'morning-evening'
  | 'after-prayer'
  | 'protection'
  | 'forgiveness'
  | 'praise';

/**
 * One curated Quran-derived Dhikr reference.
 *
 * Every field that could become a religious claim is either required or explicitly nullable, and
 * nothing is optional-by-omission. `recommendedTarget` is the clearest case: it is `number | null`
 * rather than `number | undefined`, so "this entry has no recommended count" is a value somebody
 * wrote down rather than a field they forgot.
 */
export type CuratedDhikrReference = {
  /** NoorLife's own stable id. Persisted in user state, so it must never be reused or renumbered. */
  readonly id: string;
  readonly surah: number;
  readonly startAyah: number;
  /**
   * The last ayah of the range, inclusive. Equal to `startAyah` for a single verse.
   *
   * A range is stored as its two endpoints and resolved against the source, which is what makes the
   * permission's *preserve original context* requirement structural: a "range" cannot become a
   * hand-assembled selection of non-adjacent verses, because there is nowhere to express one.
   */
  readonly endAyah: number;
  /** The title the curated catalogue supplies. NoorLife does not compose these. */
  readonly title: string;
  readonly category: DhikrCategory;
  /**
   * A recommended repetition count, **only** where the scholarly review states one.
   *
   * `null` is the normal case and the safe one. A count NoorLife chose — or inferred from a familiar
   * practice — would be an invented religious instruction wearing the catalogue's authority.
   */
  readonly recommendedTarget: number | null;
  readonly reviewStatus: DhikrReviewStatus;
  /** Required when `reviewStatus` is `approved`. `null` while pending. */
  readonly review: DhikrReviewRecord | null;
  /**
   * The context in which this reference is offered as a dhikr.
   *
   * Required for approval. Its purpose is the permission's *preserve original context and meaning*
   * requirement: a verse lifted out of its passage and presented as a repetition prompt has already
   * lost context unless something restores it, and this is that something.
   */
  readonly contextNote: string | null;
  /** Set when an entry is deliberately taken out of circulation without deleting its record. */
  readonly enabled: boolean;
  /** Bumped whenever the reviewed content of this entry changes. */
  readonly version: number;
};

/**
 * The catalogue the product reads. **Empty, deliberately.**
 *
 * ── Why this is not a placeholder ───────────────────────────────────────────
 * No scholarly-reviewed reference list has been supplied. The complete architecture around this
 * array is built and tested — the gate, the retrieval boundary, the private cache, the attribution,
 * the selector section and its honest awaiting-review state — and the one thing that would be a
 * fabrication is the data itself.
 *
 * Populating it requires, per entry: an approved status, a named reviewer and citable source, a
 * valid range, and a context note. `approvedForProduction` enforces all four, so an entry added
 * without them is filtered out at runtime rather than shipped.
 *
 * Proposed references, if any, live in `quran-dhikr-catalogue.review.ts`, which is **not imported by
 * anything on a production path** — `quran-derived-dhikr.test.ts` asserts that.
 */
export const PRODUCTION_DHIKR_CATALOGUE: readonly CuratedDhikrReference[] = [];

/** Whether a range names verses that could exist at all. Length is checked against the source. */
export function isValidRange(entry: CuratedDhikrReference): boolean {
  return (
    Number.isInteger(entry.surah) &&
    entry.surah >= 1 &&
    entry.surah <= 114 &&
    Number.isInteger(entry.startAyah) &&
    entry.startAyah >= 1 &&
    Number.isInteger(entry.endAyah) &&
    entry.endAyah >= entry.startAyah
  );
}

/**
 * Whether an entry may appear in the production selector.
 *
 * ── Every clause is a separate way to ship a religious claim by accident ────
 * Written as one predicate rather than spread across the UI, so there is exactly one place to read
 * and exactly one place to break. A caller that wants to show *something* cannot relax one condition
 * locally; it has to edit this function, in a file whose whole subject is why it must not.
 *
 * Note what this does **not** check: that the API text resolves, and that the translation's
 * attribution resolves. Those are runtime facts about a fetch, not properties of a catalogue entry,
 * and they are enforced where they are known — see `quran-dhikr.repository.ts`, which fails closed
 * when either is missing. An entry passing this gate is *eligible*; it is displayed only if its
 * content also binds.
 */
export function approvedForProduction(entry: CuratedDhikrReference): boolean {
  if (entry.reviewStatus !== 'approved') {
    return false;
  }
  if (!entry.enabled) {
    return false;
  }
  if (!isValidRange(entry)) {
    return false;
  }
  /*
    A review record with an empty reviewer or an empty source is the same as no record: it names
    nobody. Trimmed before checking so a whitespace-only string cannot satisfy it.
  */
  const review = entry.review;
  if (review === null || review.reviewer.trim() === '' || review.source.trim() === '') {
    return false;
  }
  return entry.contextNote !== null && entry.contextNote.trim() !== '';
}

/** The entries the production selector may consider. Empty until a reviewed catalogue is supplied. */
export function productionDhikrEntries(
  catalogue: readonly CuratedDhikrReference[] = PRODUCTION_DHIKR_CATALOGUE,
): readonly CuratedDhikrReference[] {
  return catalogue.filter(approvedForProduction);
}

/** The verse keys a reference covers, in order — the identity every fetched verse is matched on. */
export function verseKeysFor(entry: CuratedDhikrReference): readonly string[] {
  const keys: string[] = [];
  for (let ayah = entry.startAyah; ayah <= entry.endAyah; ayah += 1) {
    keys.push(`${entry.surah}:${ayah}`);
  }
  return keys;
}

/** The human-readable reference — `2:255`, or `59:22-24` for a range. Shown with every entry. */
export function referenceLabel(entry: CuratedDhikrReference): string {
  return entry.startAyah === entry.endAyah
    ? `${entry.surah}:${entry.startAyah}`
    : `${entry.surah}:${entry.startAyah}-${entry.endAyah}`;
}
