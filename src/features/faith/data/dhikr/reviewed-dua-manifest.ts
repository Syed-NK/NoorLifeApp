import {
  approvedForProduction,
  type CuratedDhikrReference,
  type DhikrCategory,
  type DhikrReviewStatus,
} from './quran-dhikr-catalogue';

/**
 * The **reviewed Quranic Dua manifest** — a data-only contract for entries a scholar has approved,
 * and the parser that refuses everything else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why a manifest parser exists when there is already a typed catalogue ───
 * `quran-dhikr-catalogue.ts` holds `CuratedDhikrReference`, and TypeScript makes a malformed entry
 * a compile error. That is a real guard and it protects exactly one thing: entries written in
 * TypeScript, in this repository, by somebody running the compiler.
 *
 * A reviewed catalogue does not arrive that way. It arrives as *data* — from a reviewer, in a
 * document, transcribed by somebody who is not a compiler — and the moment it is data,
 * `reviewStatus: "aproved"` is a string that a type cannot catch, a missing `reviewedOn` is an
 * absent property rather than a build failure, and an entry that gained an `arabic` field on its way
 * through a spreadsheet is just an object with an extra key. This parses `unknown` and answers what
 * of it, if anything, is a reviewed entry.
 *
 * ── Fail closed, and say why ───────────────────────────────────────────────
 * Every rejection is *named and returned*, not swallowed. A manifest with nine good entries and one
 * malformed one yields nine approved entries and one rejection carrying its index and its reason, so
 * an operator can see that something was dropped rather than wondering why the count is short. What
 * a rejection never does is degrade into a partial entry: there is no "approved except for the
 * reviewer's name".
 *
 * ── What an entry may never carry ──────────────────────────────────────────
 * Arabic, translation or transliteration **text**, under any key. Not because the parser would fail
 * to understand it, but because a manifest that carries scripture is a second copy of it — outside
 * the retained generation, outside its refresh obligations, and unable to pick up a correction. An
 * entry carrying such text is rejected outright rather than stripped, because a manifest that
 * arrived with text in it is a manifest whose provenance is now in question.
 *
 * It may, and must, carry the *identity* of the resources that supply those things: which translation
 * a reviewer approved, which provider resource holds a romanisation. Those are provenance, they are
 * what makes a translator credit resolvable, and they are integers. See `CONTENT_IDENTITY_KEYS` for
 * how the gate tells naming a resource apart from carrying its contents.
 *
 * ── Nothing here approves anything ─────────────────────────────────────────
 * `REVIEWED_DUA_MANIFEST` is empty, and this file cannot make it otherwise. Approval is a religious
 * judgement made by a named person on a stated date against a citable source; the parser's entire
 * job is to check that such a record is present and specific, never to supply one. A reviewer
 * invented here would be a forgery, and a `reviewStatus` set to `approved` by a developer is the
 * same act with fewer words.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The categories a reviewed entry may be filed under. Closed, and shared with the typed catalogue. */
const CATEGORIES: readonly DhikrCategory[] = [
  'quranic-remembrance',
  'morning-evening',
  'after-prayer',
  'protection',
  'forgiveness',
  'praise',
];

const STATUSES: readonly DhikrReviewStatus[] = ['pending', 'approved', 'rejected', 'withdrawn'];

/**
 * Keys whose mere presence rejects an entry.
 *
 * ── Two lists, because one match rule cannot be both safe and strict ───────
 * The **fragments** are matched anywhere in a key, and every one of them is a word that could not
 * plausibly appear in a field about a *reference*: a key containing "arabic" or "translat" is
 * carrying text whatever else it is called.
 *
 * The **exact names** are matched whole, because they are the generic words a content field tends to
 * be given and they are also substrings of perfectly ordinary metadata. `text` matched loosely
 * rejects `contextNote`; `script` matched loosely rejects `description`. Two entirely reasonable
 * fields refused for containing four letters is a gate that gets disabled rather than fixed.
 *
 * Deliberately strict in the direction that costs least: a false rejection loses one manifest row and
 * names the reason, and a false acceptance puts an uncontrolled copy of scripture into a bundle.
 */
const FORBIDDEN_KEY_FRAGMENTS: readonly string[] = [
  'arabic',
  'translat',
  'transliterat',
  'uthmani',
  'scripture',
];

const FORBIDDEN_KEY_NAMES: readonly string[] = [
  'text',
  'script',
  'body',
  'content',
  'versetext',
  'verse_text',
  'ayahtext',
  'ayah_text',
];

/** Why one manifest entry is not a reviewed entry. Reported, never silently dropped. */
export type ManifestRejectionReason =
  | 'not-an-object'
  | 'missing-id'
  | 'invalid-range'
  | 'missing-title'
  | 'invalid-category'
  | 'invalid-review-status'
  | 'not-approved'
  | 'missing-review-record'
  | 'missing-provenance'
  | 'invalid-target'
  /** The entry carried Arabic, a translation or a transliteration. See `FORBIDDEN_KEY_FRAGMENTS`. */
  | 'embedded-content';

export type ManifestRejection = {
  /** Position in the manifest, so an operator can find the row that was dropped. */
  readonly index: number;
  readonly reason: ManifestRejectionReason;
  /**
   * The entry's own id, when it had a usable one.
   *
   * `null` otherwise, and never a fabricated placeholder — an entry with no id has no name, and
   * inventing one would make two unrelated rejections look like the same entry rejected twice.
   */
  readonly id: string | null;
};

export type ManifestParse = {
  /** Entries that are complete, approved, specifically attributed, and free of embedded content. */
  readonly approved: readonly CuratedDhikrReference[];
  readonly rejected: readonly ManifestRejection[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

/**
 * The shape a content-identity value may take. Neither can hold a character of scripture.
 *
 * `provider-resource-id` is a positive integer or `null` — the identifier of a resource at the
 * approved provider, the same kind of number `RetainedQuran.translations.resourceId` already holds.
 * `arabic-strategy` is a member of a closed set of two-word slugs.
 */
type ContentIdentityShape = 'provider-resource-id' | 'arabic-strategy';

/**
 * The **only** keys permitted to match a forbidden name, and the exact value each may hold.
 *
 * ── Why the gate had to learn the difference between naming and carrying ────
 * The rule above rejects a key by its *name*: anything containing `translat` or `transliterat` is
 * refused. That was right while an entry was a reference and nothing else, and it is what made it
 * impossible for a manifest to describe **which** translation a reviewer approved, or which provider
 * resource supplies a romanisation. Those are facts about provenance, and a reviewed entry that
 * cannot state them is one whose translator credit nobody can resolve.
 *
 * So the gate now asks the question it always meant: *is this field carrying content?* A key on this
 * list is admitted only when its value is a **positive integer** or a member of a **closed set of
 * slugs**. An integer cannot be a verse. A closed set cannot be a verse. Every other key, and every
 * value of any other shape, is refused exactly as before — including a string in one of these fields,
 * which is the case that would otherwise let `transliterationResourceId: '<Arabic>'` through.
 *
 * That makes this net strictly stronger than the name check it extends, not weaker: a value test
 * catches embedded content under an *innocent* key name too, which a name test never could.
 *
 * The list is closed and deliberately short. A future field wanting in has to be added here, in a
 * file whose subject is why scripture may not be.
 */
const CONTENT_IDENTITY_KEYS: ReadonlyMap<string, ContentIdentityShape> = new Map([
  ['translationresourceid', 'provider-resource-id'],
  ['transliterationresourceid', 'provider-resource-id'],
  ['arabicsource', 'arabic-strategy'],
]);

/**
 * The ways a reviewed entry's Arabic may be obtained. One, and it is not "from the manifest".
 *
 * Exported so the domain layer and the parser cannot disagree about what a legal strategy is, and so
 * a second value cannot be added without the test that pins this array failing.
 */
export const ARABIC_SOURCE_STRATEGIES: readonly string[] = ['retained-generation'];

function satisfiesIdentityShape(shape: ContentIdentityShape, value: unknown): boolean {
  if (shape === 'provider-resource-id') {
    /* `null` is a legitimate answer: the review named no resource for this field. */
    return value === null || positiveInteger(value) !== null;
  }
  return typeof value === 'string' && ARABIC_SOURCE_STRATEGIES.includes(value);
}

/** Whether any key on the entry, at any depth of one, carries content this manifest may not hold. */
function carriesEmbeddedContent(record: Record<string, unknown>): boolean {
  const carriesContent = (key: string, value: unknown): boolean => {
    const lower = key.toLowerCase();
    const named =
      FORBIDDEN_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment)) ||
      FORBIDDEN_KEY_NAMES.includes(lower);
    if (!named) {
      return false;
    }
    const shape = CONTENT_IDENTITY_KEYS.get(lower);
    /*
      A forbidden-named key that is not an identity field is refused outright, as it always was. One
      that is has to prove its value is an identifier — a name on the list buys the *opportunity* to
      be checked, never an exemption from checking.
    */
    return shape === undefined || !satisfiesIdentityShape(shape, value);
  };
  for (const [key, value] of Object.entries(record)) {
    if (carriesContent(key, value)) {
      return true;
    }
    if (isRecord(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        if (carriesContent(nestedKey, nestedValue)) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * An ISO calendar date, and a real one.
 *
 * `2026-02-30` parses under a looser check and names a day that does not exist. A review date that
 * does not exist is a review record nobody can corroborate, so it is refused.
 */
function isoDate(value: unknown): string | null {
  const text = nonEmptyString(value);
  if (text === null || !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return null;
  }
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(text) ? null : text;
}

/**
 * Parses one entry. Returns the reference, or the reason it is not one.
 *
 * The order of the checks is the order in which they are worth reporting: structural faults first,
 * then the review record, so an entry missing half its fields reports the missing fields rather than
 * "not approved".
 */
function parseEntry(
  value: unknown,
  index: number,
): { readonly ok: true; readonly entry: CuratedDhikrReference } | ManifestRejection {
  if (!isRecord(value)) {
    return { index, reason: 'not-an-object', id: null };
  }
  const id = nonEmptyString(value.id);
  if (carriesEmbeddedContent(value)) {
    return { index, reason: 'embedded-content', id };
  }
  if (id === null) {
    return { index, reason: 'missing-id', id: null };
  }

  const surah = positiveInteger(value.surah);
  const startAyah = positiveInteger(value.startAyah);
  const endAyah = positiveInteger(value.endAyah);
  if (
    surah === null ||
    surah > 114 ||
    startAyah === null ||
    endAyah === null ||
    endAyah < startAyah
  ) {
    return { index, reason: 'invalid-range', id };
  }

  const title = nonEmptyString(value.title);
  if (title === null) {
    return { index, reason: 'missing-title', id };
  }

  const category = value.category;
  if (typeof category !== 'string' || !CATEGORIES.includes(category as DhikrCategory)) {
    return { index, reason: 'invalid-category', id };
  }

  const reviewStatus = value.reviewStatus;
  if (typeof reviewStatus !== 'string' || !STATUSES.includes(reviewStatus as DhikrReviewStatus)) {
    return { index, reason: 'invalid-review-status', id };
  }
  if (reviewStatus !== 'approved') {
    /*
      Pending, rejected and withdrawn are all *well-formed* and all unshippable. Reported separately
      from a malformed entry because they mean something entirely different: this row is fine, and
      the answer is no.
    */
    return { index, reason: 'not-approved', id };
  }

  const review = value.review;
  if (!isRecord(review)) {
    return { index, reason: 'missing-review-record', id };
  }
  const reviewer = nonEmptyString(review.reviewer);
  const source = nonEmptyString(review.source);
  const reviewedOn = isoDate(review.reviewedOn);
  if (reviewer === null || source === null || reviewedOn === null) {
    return { index, reason: 'missing-review-record', id };
  }

  const contextNote = nonEmptyString(value.contextNote);
  if (contextNote === null) {
    return { index, reason: 'missing-provenance', id };
  }

  /*
    `null` is the normal, safe value: no count unless the review states one. `undefined` is not
    accepted in its place — "the reviewer said nothing about a count" must be a value somebody wrote
    down, not a field they forgot, which is the same rule `CuratedDhikrReference` states.
  */
  const recommendedTarget = value.recommendedTarget;
  if (
    recommendedTarget !== null &&
    (typeof recommendedTarget !== 'number' ||
      !Number.isInteger(recommendedTarget) ||
      recommendedTarget < 1)
  ) {
    return { index, reason: 'invalid-target', id };
  }

  const version = positiveInteger(value.version) ?? 1;

  return {
    ok: true,
    entry: {
      id,
      surah,
      startAyah,
      endAyah,
      title,
      category: category as DhikrCategory,
      recommendedTarget,
      reviewStatus: 'approved',
      review: { reviewer, source, reviewedOn },
      contextNote,
      /* Absent means enabled; an entry is taken out of circulation by saying so explicitly. */
      enabled: value.enabled !== false,
      version,
    },
  };
}

/**
 * Parses a manifest into approved entries and named rejections.
 *
 * ── Two gates, not one ─────────────────────────────────────────────────────
 * An entry that survives `parseEntry` is then put through `approvedForProduction` — the same
 * predicate the typed catalogue goes through. The duplication is deliberate: the parser is the
 * *shape* gate and lives here; `approvedForProduction` is the *policy* gate and lives with the
 * catalogue, so tightening the policy tightens both paths at once and neither can be relaxed by
 * editing the other.
 *
 * A duplicate id is a rejection rather than an overwrite. Two entries claiming one id means one of
 * them is going to be silently discarded, and which one depends on iteration order — so both are
 * refused and the operator resolves it.
 */
export function parseReviewedDuaManifest(manifest: unknown): ManifestParse {
  if (!Array.isArray(manifest)) {
    return { approved: [], rejected: [{ index: 0, reason: 'not-an-object', id: null }] };
  }

  const approved: CuratedDhikrReference[] = [];
  const rejected: ManifestRejection[] = [];
  const seen = new Set<string>();

  manifest.forEach((value: unknown, index) => {
    const parsed = parseEntry(value, index);
    if (!('ok' in parsed)) {
      rejected.push(parsed);
      return;
    }
    if (seen.has(parsed.entry.id)) {
      rejected.push({ index, reason: 'missing-id', id: parsed.entry.id });
      return;
    }
    if (!approvedForProduction(parsed.entry)) {
      rejected.push({ index, reason: 'not-approved', id: parsed.entry.id });
      return;
    }
    seen.add(parsed.entry.id);
    approved.push(parsed.entry);
  });

  return { approved, rejected };
}

/**
 * The reviewed manifest this build ships. **Empty, and not a placeholder.**
 *
 * ── What would have to be true for an entry to appear here ─────────────────
 * A qualified reviewer — named, not "the NoorLife team" — states that a specific reference is
 * appropriate for the category it is filed under, cites the basis, and dates the review. That record
 * goes in beside the reference, and both gates check it is present and specific before the entry can
 * reach a screen.
 *
 * ── Why it is not seeded with "obvious" entries ────────────────────────────
 * Because there is no such thing. Which ayat constitute a dua, in what context, at what repetition,
 * is precisely the judgement this manifest exists to record somebody qualified having made. Five
 * source-less dhikr presets once shipped in this app; a developer choosing verses from memory is
 * exactly how they got there, and confidence in the choice is what the failure felt like from the
 * inside.
 *
 * Typed `readonly unknown[]` on purpose. It is *data*, and it goes through the same parser a
 * manifest from any other origin would, so the entries this file ships can never be the ones that
 * skipped the check.
 */
export const REVIEWED_DUA_MANIFEST: readonly unknown[] = [];

/** The reviewed entries this build may display. Zero, until a manifest with real approvals exists. */
export function reviewedQuranDuas(
  manifest: readonly unknown[] = REVIEWED_DUA_MANIFEST,
): readonly CuratedDhikrReference[] {
  return parseReviewedDuaManifest(manifest).approved;
}
