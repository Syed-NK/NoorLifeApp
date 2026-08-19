import type { CuratedDhikrReference, DhikrReviewStatus } from '../dhikr/quran-dhikr-catalogue';
import {
  ARABIC_SOURCE_STRATEGIES,
  parseReviewedDuaManifest,
  REVIEWED_DUA_MANIFEST,
  type ManifestRejectionReason,
} from '../dhikr/reviewed-dua-manifest';
import { SELECTION_ID_PREFIX } from '../quran-selection/quran-selection';
import { duaCategoryById, type DuaCategoryId } from './dua-categories';

/**
 * A **reviewed Dua** — the validated domain object the detail page is driven by, and the parser that
 * refuses everything which is not one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this exists beside `CuratedDhikrReference` ─────────────────────────
 * `CuratedDhikrReference` is a Qur’an *reference* with a review attached, and every field on it is
 * about a range of ayat. It cannot describe a Hadith-derived entry, because there is no surah; it
 * cannot say which translation a reviewer approved; and it has nowhere to record an editorial rank, a
 * reviewer's record identifier, or the basis for a repetition count.
 *
 * A Dua is the larger thing. It has a *source kind*, and the shape of its reference depends on which
 * kind it is — which is a discriminated union, not an optional field. This is that union, plus the
 * provenance a detail page has to disclose before it may show anything.
 *
 * ── One gate, composed rather than copied ──────────────────────────────────
 * The Qur’an-shaped half of every entry — the range, the title, the review record, the context note,
 * the embedded-content scan, `approvedForProduction` — is validated by `parseReviewedDuaManifest`,
 * unchanged, by delegating one row at a time to it. Nothing here re-implements a rule that already
 * exists there, so tightening either gate tightens both paths and neither can be relaxed by editing
 * the other. What this file adds is the Dua-level checks that file has no concept of.
 *
 * ── Three fail-closed decisions worth stating plainly ──────────────────────
 * **Hadith can never be published by a data change.** `PERMITTED_HADITH_PROVIDERS` is empty, and it
 * is code rather than manifest data, so a `sourceKind: 'hadith'` row is rejected however complete and
 * however well-reviewed it is. That is correct: a provider grant is a licence NoorLife either has or
 * does not, and it is not something a row in a manifest can assert on its own behalf. Hadith is locked
 * at the provider level elsewhere in this module too — see `hadith-screen.tsx`.
 *
 * **An editorial rank lives inside the review record.** Not beside it. A top-level `popularRank` is
 * rejected outright, so promoting an entry on a category page is impossible without editing the block
 * that carries a reviewer's name and date — which is what "popular rank without review approval" has
 * to mean if it is to mean anything. Ordering supplications by NoorLife's own idea of popularity
 * would be an editorial religious act performed by whoever last touched a spreadsheet.
 *
 * **A repetition count needs a stated basis.** `recommendedTarget` is admitted only alongside
 * `review.repetitionBasis`, a non-empty citation. A count with no basis is an invented religious
 * instruction wearing the catalogue's authority, and it is the exact failure the five removed dhikr
 * presets were removed for.
 *
 * ── The id namespace is disjoint from the user's, by refusal ───────────────
 * One detail route serves both a reviewed entry and a personal selection, so one route parameter has
 * to name either without ambiguity. A selection's id is derived from its reference and always begins
 * `q.` — see `selectionIdFor`. A reviewed id beginning `q.` is therefore **rejected**, which makes the
 * two namespaces disjoint by construction rather than by a prefix somebody remembers to add.
 * `parseDuaDetailId` relies on exactly that, and nothing has to guess.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The providers NoorLife may publish Hadith-derived Duas from. **Empty.**
 *
 * Not a placeholder and not an oversight. No Hadith provider has granted permission, no text has been
 * licensed, and no qualified review of any narration exists. Until all three are true this list stays
 * empty and every Hadith row fails closed — see the module note on why this is code and not manifest
 * data.
 */
export const PERMITTED_HADITH_PROVIDERS: readonly string[] = [];

/** The one provider NoorLife may publish Qur’an-derived content from, under the recorded permission. */
export const QURAN_PROVIDER = 'quran-foundation';

/**
 * The one shippable review status, taken from the shared union rather than restated as a literal.
 *
 * ── Why it is derived and not written out ──────────────────────────────────
 * `reviewed-dua-manifest.test.ts` scans every production source for the approved literal being
 * assigned, because writing it is the act that requires a real reviewer behind it. A regex cannot tell
 * a type annotation from an assignment, and it should not have to — so this file contains the literal
 * nowhere, and the narrow type is expressed as what it actually is: the approved member of
 * `DhikrReviewStatus`. A future rename of that member is then a compile error here rather than a
 * silently divergent string.
 */
export type ApprovedReviewStatus = Extract<DhikrReviewStatus, 'approved'>;

/** What kind of source an entry is derived from. Closed, and it decides the shape of the reference. */
export type ReviewedDuaSourceKind = 'quran' | 'hadith';

/**
 * The exact reference, in the only shape its kind admits.
 *
 * A union rather than a record of optional fields, so "a Qur’an entry with a Hadith reference" is not
 * a state that can be constructed and then checked for — it cannot be written down.
 */
export type ReviewedDuaSource =
  | {
      readonly kind: 'quran';
      readonly surah: number;
      readonly startAyah: number;
      /** Inclusive. Equal to `startAyah` for a single verse. */
      readonly endAyah: number;
    }
  | {
      readonly kind: 'hadith';
      /** The collection, exactly as the licensed provider names it. Never abbreviated here. */
      readonly collection: string;
      /** The narration's own identifier within that collection. */
      readonly reference: string;
    };

/**
 * Where the displayable content comes from — as identities, never as text.
 *
 * Every field is an integer or a closed slug. See `CONTENT_IDENTITY_KEYS` in the manifest for why the
 * gate admits these three keys and refuses a string in any of them.
 */
export type ReviewedDuaContent = {
  /** How the Arabic is obtained. One legal value, and it is not "from the manifest". */
  readonly arabicSource: 'retained-generation';
  /**
   * The provider resource id of the translation the review approved, or `null`.
   *
   * `null` means the review named no edition, and the detail page then shows whatever edition the
   * device retained, credited to its own translator. It never means "any translation will do".
   */
  readonly translationResourceId: number | null;
  /**
   * The provider resource id supplying a romanisation, or `null`.
   *
   * `null` is the normal case and the safe one: **NoorLife does not transliterate.** A romanisation
   * composed here would be a pronunciation instruction for scripture, authored by a developer, and the
   * detail page omits the section entirely rather than generating one.
   */
  readonly transliterationResourceId: number | null;
};

/**
 * Who approved the entry, against what, when — and what NoorLife's own record of it is called.
 *
 * `recordId` is the addition over `DhikrReviewRecord`: an identifier for the review record itself, so
 * a claim on a screen can be traced back to a document rather than to a name that may be shared.
 */
export type ReviewedDuaReview = {
  readonly reviewer: string;
  readonly source: string;
  /** ISO date of the approval. */
  readonly reviewedOn: string;
  readonly recordId: string;
  /**
   * The reviewer's editorial rank for the category pages, or `null`.
   *
   * Inside the review record on purpose — see the module note. `null` is the normal value and means
   * the entry is not promoted anywhere.
   */
  readonly popularRank: number | null;
  /** The stated basis for a repetition count. Required whenever there is one, `null` otherwise. */
  readonly repetitionBasis: string | null;
};

/** One reviewed Dua, complete. Every field is either required or explicitly nullable. */
export type ReviewedDua = {
  /** Stable, persisted, and never beginning with the selection prefix. */
  readonly id: string;
  /** The presentation cards this entry appears under. At least one, none of them personal. */
  readonly categories: readonly DuaCategoryId[];
  readonly source: ReviewedDuaSource;
  /** The provider whose licence covers this content. */
  readonly provider: string;
  /** The approved display title. NoorLife does not compose these. */
  readonly title: string;
  /** The reviewed context in which the entry is offered. Required for approval. */
  readonly contextNote: string;
  readonly content: ReviewedDuaContent;
  /** A repetition count, only where the review states one and states its basis. */
  readonly recommendedTarget: number | null;
  readonly review: ReviewedDuaReview;
  /** Only ever `approved` — nothing else reaches this type. */
  readonly reviewStatus: ApprovedReviewStatus;
  /**
   * A fingerprint of the reviewed content, or `null`.
   *
   * Optional because the repository's review contract records a `version` and does not yet mint
   * digests. Carried so that when it does, an entry can prove it is the one that was signed rather
   * than a later edit of it.
   */
  readonly fingerprint: string | null;
  readonly version: number;
};

/** Why one manifest row is not a reviewed Dua. Every reason is reported, never silently dropped. */
export type ReviewedDuaRejectionReason =
  /** Passed through from the underlying manifest gate, unchanged. */
  | ManifestRejectionReason
  | 'invalid-source-kind'
  /** The reference does not match the kind claimed — a Qur’an range on a Hadith row, or the reverse. */
  | 'source-reference-mismatch'
  /** No provider is licensed for this source kind. Hadith, today, always. */
  | 'missing-provider-permission'
  | 'missing-categories'
  /** A category id that is not one of the ten cards. */
  | 'unknown-category'
  /** A personal card. `my-quran-selections` and `favourites` hold the user's data and never this. */
  | 'personal-category'
  | 'invalid-content-identity'
  | 'missing-review-record-id'
  /** A rank outside the review record, or a malformed one inside it. */
  | 'popular-rank-not-approved'
  /** A count with no stated basis. */
  | 'repetition-without-evidence'
  | 'invalid-fingerprint'
  /** The id begins `q.`, which is the user's selection namespace. */
  | 'reserved-id'
  | 'duplicate-id';

export type ReviewedDuaRejection = {
  readonly index: number;
  readonly reason: ReviewedDuaRejectionReason;
  /** The row's own id where it had a usable one. Never fabricated. */
  readonly id: string | null;
};

export type ReviewedDuaParse = {
  readonly approved: readonly ReviewedDua[];
  readonly rejected: readonly ReviewedDuaRejection[];
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

/** A resource identity: a positive integer, or `null` for "the review named none". */
function resourceIdOrNull(value: unknown): { readonly id: number | null } | null {
  if (value === null || value === undefined) {
    return { id: null };
  }
  const id = positiveInteger(value);
  return id === null ? null : { id };
}

type Rejected = { readonly reason: ReviewedDuaRejectionReason; readonly id: string | null };

function rejected(reason: ReviewedDuaRejectionReason, id: string | null): Rejected {
  return { reason, id };
}

/**
 * The presentation cards a row claims, validated against the closed set.
 *
 * A card that does not exist is a rejection rather than a filtered-out value: an entry filed under a
 * category nobody can open is an entry a reviewer approved for a place it will never appear, and
 * dropping the category quietly would leave it displayed somewhere they did not choose.
 */
function parseCategories(
  value: unknown,
  id: string,
): { readonly categories: readonly DuaCategoryId[] } | Rejected {
  if (!Array.isArray(value) || value.length === 0) {
    return rejected('missing-categories', id);
  }
  const categories: DuaCategoryId[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') {
      return rejected('unknown-category', id);
    }
    const category = duaCategoryById(entry);
    if (category === undefined) {
      return rejected('unknown-category', id);
    }
    /*
      The two personal cards are the user's own data. A reviewed entry placed in one would appear
      inside a list the user believes they built, which is the misrepresentation this whole module is
      arranged to prevent — see `selectionsForCategory`, which answers those two cards and nothing
      else.
    */
    if (category.kind === 'personal') {
      return rejected('personal-category', id);
    }
    categories.push(category.id);
  }
  return { categories };
}

/** The three content identities, each an integer or a closed slug. Never text. */
function parseContent(
  record: Record<string, unknown>,
  id: string,
): { readonly content: ReviewedDuaContent } | Rejected {
  const arabicSource = nonEmptyString(record.arabicSource);
  if (arabicSource === null || !ARABIC_SOURCE_STRATEGIES.includes(arabicSource)) {
    return rejected('invalid-content-identity', id);
  }
  const translation = resourceIdOrNull(record.translationResourceId);
  const transliteration = resourceIdOrNull(record.transliterationResourceId);
  if (translation === null || transliteration === null) {
    return rejected('invalid-content-identity', id);
  }
  return {
    content: {
      /* Narrowed against the same closed array the gate uses, so the two cannot drift apart. */
      arabicSource: 'retained-generation',
      translationResourceId: translation.id,
      transliterationResourceId: transliteration.id,
    },
  };
}

/**
 * The review record, including the two things that may only live inside it.
 *
 * The reviewer, source and date have already been validated by the underlying manifest gate; they are
 * carried through here rather than re-checked, so there is one implementation of what makes them
 * valid.
 */
function parseReview(
  record: Record<string, unknown>,
  id: string,
  base: { readonly reviewer: string; readonly source: string; readonly reviewedOn: string },
  recommendedTarget: number | null,
): { readonly review: ReviewedDuaReview } | Rejected {
  const review = isRecord(record.review) ? record.review : {};

  const recordId = nonEmptyString(review.recordId);
  if (recordId === null) {
    return rejected('missing-review-record-id', id);
  }

  /*
    A rank outside the review record is refused rather than moved into it. Accepting one would mean an
    entry could be promoted without the reviewer's block being touched, which is precisely the thing
    placing the field inside that block is meant to make impossible.
  */
  if ('popularRank' in record) {
    return rejected('popular-rank-not-approved', id);
  }
  const rawRank = review.popularRank;
  let popularRank: number | null = null;
  if (rawRank !== null && rawRank !== undefined) {
    const rank = positiveInteger(rawRank);
    if (rank === null) {
      return rejected('popular-rank-not-approved', id);
    }
    popularRank = rank;
  }

  const repetitionBasis = nonEmptyString(review.repetitionBasis);
  /* A count is admitted only with a basis; a basis with no count is harmless and is kept. */
  if (recommendedTarget !== null && repetitionBasis === null) {
    return rejected('repetition-without-evidence', id);
  }

  return {
    review: {
      reviewer: base.reviewer,
      source: base.source,
      reviewedOn: base.reviewedOn,
      recordId,
      popularRank,
      repetitionBasis,
    },
  };
}

/**
 * The source reference, and the provider licensed to supply it.
 *
 * Checked together because they are one question: a Hadith reference NoorLife has no provider for is
 * not a lesser entry, it is content this app may not display at all.
 */
function parseSource(
  record: Record<string, unknown>,
  id: string,
  quranRange: {
    readonly surah: number;
    readonly startAyah: number;
    readonly endAyah: number;
  } | null,
): { readonly source: ReviewedDuaSource; readonly provider: string } | Rejected {
  const kind = record.sourceKind;
  if (kind !== 'quran' && kind !== 'hadith') {
    return rejected('invalid-source-kind', id);
  }

  const hasQuranFields = 'surah' in record || 'startAyah' in record || 'endAyah' in record;
  const collection = nonEmptyString(record.collection);
  const hadithReference = nonEmptyString(record.hadithReference);
  const provider = nonEmptyString(record.provider);

  if (kind === 'quran') {
    if (quranRange === null || collection !== null || hadithReference !== null) {
      return rejected('source-reference-mismatch', id);
    }
    if (provider !== QURAN_PROVIDER) {
      return rejected('missing-provenance', id);
    }
    return {
      source: {
        kind: 'quran',
        surah: quranRange.surah,
        startAyah: quranRange.startAyah,
        endAyah: quranRange.endAyah,
      },
      provider,
    };
  }

  if (hasQuranFields || collection === null || hadithReference === null) {
    return rejected('source-reference-mismatch', id);
  }
  if (provider === null) {
    return rejected('missing-provenance', id);
  }
  /*
    Empty list, so this always fails today — and it fails here rather than at a screen, so no part of
    the app has to remember that Hadith is unlicensed. See `PERMITTED_HADITH_PROVIDERS`.
  */
  if (!PERMITTED_HADITH_PROVIDERS.includes(provider)) {
    return rejected('missing-provider-permission', id);
  }
  return { source: { kind: 'hadith', collection, reference: hadithReference }, provider };
}

/**
 * Parses one row into a reviewed Dua, or the reason it is not one.
 *
 * The Qur’an-shaped core is delegated to `parseReviewedDuaManifest` — one row at a time, so its
 * rejection reason is reported verbatim rather than re-derived. That call is skipped for a Hadith row,
 * which has no range for it to validate, and such a row is refused on provider grounds regardless.
 */
function parseRow(value: unknown): { readonly dua: ReviewedDua } | Rejected {
  if (!isRecord(value)) {
    return rejected('not-an-object', null);
  }
  const id = nonEmptyString(value.id);
  if (id === null) {
    return rejected('missing-id', null);
  }
  if (id.startsWith(SELECTION_ID_PREFIX)) {
    return rejected('reserved-id', id);
  }

  type QuranCore = {
    readonly surah: number;
    readonly startAyah: number;
    readonly endAyah: number;
    readonly title: string;
    readonly contextNote: string;
    readonly recommendedTarget: number | null;
    readonly review: {
      readonly reviewer: string;
      readonly source: string;
      readonly reviewedOn: string;
    };
    /**
     * Carried from the approved entry rather than written here.
     *
     * The underlying gate returns only approved rows, but its type says the wider
     * `DhikrReviewStatus` union. Narrowing it with an explicit comparison below means this file
     * never *assigns* the approved literal — it only passes along one the gate established, which is
     * what `reviewed-dua-manifest.test.ts`'s approval scan is there to insist on.
     */
    readonly reviewStatus: ApprovedReviewStatus;
    readonly version: number;
  };

  let core: QuranCore | null = null;

  if (value.sourceKind === 'quran') {
    const parse = parseReviewedDuaManifest([value]);
    const entry = parse.approved[0];
    if (entry === undefined) {
      return rejected(parse.rejected[0]?.reason ?? 'not-approved', id);
    }
    if (entry.review === null || entry.contextNote === null) {
      /* Unreachable through the gate above, which requires both. Refused rather than asserted away. */
      return rejected('missing-review-record', id);
    }
    /*
      Unreachable too — the gate rejects every other status — and it is this comparison that narrows the
      wider union to the one value the type admits. A cast would have done the same thing without
      proving anything, and would have put an assigned approval in this file.
    */
    if (entry.reviewStatus !== 'approved') {
      return rejected('not-approved', id);
    }
    core = {
      surah: entry.surah,
      startAyah: entry.startAyah,
      endAyah: entry.endAyah,
      title: entry.title,
      contextNote: entry.contextNote,
      recommendedTarget: entry.recommendedTarget,
      review: entry.review,
      reviewStatus: entry.reviewStatus,
      version: entry.version,
    };
  }

  const source = parseSource(
    value,
    id,
    core === null ? null : { surah: core.surah, startAyah: core.startAyah, endAyah: core.endAyah },
  );
  if ('reason' in source) {
    return source;
  }

  /*
    Only a Qur’an row reaches this point with a core, and a Hadith row cannot reach it at all — the
    provider check above refuses every one of them. So a missing core here would be a source kind that
    passed `parseSource` without being validated, which is a fault rather than something to report
    politely.
  */
  if (core === null) {
    return rejected('invalid-source-kind', id);
  }

  const categories = parseCategories(value.categories, id);
  if ('reason' in categories) {
    return categories;
  }

  const content = parseContent(value, id);
  if ('reason' in content) {
    return content;
  }

  const review = parseReview(value, id, core.review, core.recommendedTarget);
  if ('reason' in review) {
    return review;
  }

  const rawFingerprint = value.fingerprint;
  let fingerprint: string | null = null;
  if (rawFingerprint !== null && rawFingerprint !== undefined) {
    const text = nonEmptyString(rawFingerprint);
    /* Hex, so a digest is a digest and not a sentence somebody typed where one was expected. */
    if (text === null || !/^[0-9a-f]{16,128}$/.test(text)) {
      return rejected('invalid-fingerprint', id);
    }
    fingerprint = text;
  }

  return {
    dua: {
      id,
      categories: categories.categories,
      source: source.source,
      provider: source.provider,
      title: core.title,
      contextNote: core.contextNote,
      content: content.content,
      recommendedTarget: core.recommendedTarget,
      review: review.review,
      reviewStatus: core.reviewStatus,
      fingerprint,
      version: core.version,
    },
  };
}

/**
 * Parses a manifest into reviewed Duas and named rejections.
 *
 * A duplicate id is refused rather than resolved by iteration order — two rows claiming one id means
 * one is about to be discarded silently, and which one depends on nothing anybody chose.
 */
export function parseReviewedDuas(manifest: unknown): ReviewedDuaParse {
  if (!Array.isArray(manifest)) {
    return { approved: [], rejected: [{ index: 0, reason: 'not-an-object', id: null }] };
  }

  const approved: ReviewedDua[] = [];
  const rejections: ReviewedDuaRejection[] = [];
  const seen = new Set<string>();

  manifest.forEach((value: unknown, index) => {
    const parsed = parseRow(value);
    if ('reason' in parsed) {
      rejections.push({ index, reason: parsed.reason, id: parsed.id });
      return;
    }
    if (seen.has(parsed.dua.id)) {
      rejections.push({ index, reason: 'duplicate-id', id: parsed.dua.id });
      return;
    }
    seen.add(parsed.dua.id);
    approved.push(parsed.dua);
  });

  return { approved, rejected: rejections };
}

/**
 * The reviewed Duas this build may display. **Zero**, and read through the parser every time.
 *
 * Reads the same single manifest array `reviewedQuranDuas` reads, so there is one place entries would
 * appear and one place they are checked. Deliberately not memoised: the parse is over an empty array,
 * and a cached answer is one more thing that could be stale in a build where the manifest gained a
 * row.
 */
export function reviewedDuas(
  manifest: readonly unknown[] = REVIEWED_DUA_MANIFEST,
): readonly ReviewedDua[] {
  return parseReviewedDuas(manifest).approved;
}

/** The reviewed Duas filed under one presentation card. Empty for a card naming none. */
export function reviewedDuasForCategory(
  categoryId: string,
  duas: readonly ReviewedDua[],
): readonly ReviewedDua[] {
  return duas.filter((dua) => dua.categories.some((category) => category === categoryId));
}

/** `2:255`, or `59:22-24`. The Qur’an half of `duaSourceLabel`, kept separate so a range is one rule. */
export function reviewedQuranReferenceLabel(source: {
  readonly surah: number;
  readonly startAyah: number;
  readonly endAyah: number;
}): string {
  return source.startAyah === source.endAyah
    ? `${source.surah}:${source.startAyah}`
    : `${source.surah}:${source.startAyah}-${source.endAyah}`;
}

/** The exact reference, in the words its kind uses. Exhaustive, so a new kind is a compile error. */
export function duaSourceLabel(source: ReviewedDuaSource): string {
  switch (source.kind) {
    case 'quran':
      return `Qur’an ${reviewedQuranReferenceLabel(source)}`;
    case 'hadith':
      return `${source.collection} ${source.reference}`;
  }
}

/**
 * A reviewed Dua as the row component's `CuratedDhikrReference`, or `null` where it cannot be one.
 *
 * ── Why an adapter and not a second row component ──────────────────────────
 * `ReviewedItem` already draws a reviewed Qur’an reference correctly: the badge, the scripture through
 * the retained generation, the context note, the review line, and the two actions with no remove and
 * no star. It is asserted by the suites that shipped with it. A second component for the same subject
 * would be a second answer to "does a reviewed entry get a favourite control?", and the answer has
 * already been settled once.
 *
 * `null` for a Hadith entry, which has no range for that component to resolve and which no manifest
 * can approve today. The caller draws such a row without scripture rather than guessing at a range.
 */
export function reviewedDuaAsReference(dua: ReviewedDua): CuratedDhikrReference | null {
  if (dua.source.kind !== 'quran') {
    return null;
  }
  return {
    id: dua.id,
    surah: dua.source.surah,
    startAyah: dua.source.startAyah,
    endAyah: dua.source.endAyah,
    title: dua.title,
    /*
      The reviewed taxonomy's bucket is not carried on a `ReviewedDua` — it files against the ten
      presentation cards instead. The row does not read `category`, so the safest available value is the
      one that claims least: the general remembrance bucket, which asserts nothing about a subject.
    */
    category: 'quranic-remembrance',
    recommendedTarget: dua.recommendedTarget,
    /* Passed through, not asserted: an adapter may relay an approval and may never mint one. */
    reviewStatus: dua.reviewStatus,
    review: {
      reviewer: dua.review.reviewer,
      source: dua.review.source,
      reviewedOn: dua.review.reviewedOn,
    },
    contextNote: dua.contextNote,
    enabled: true,
    version: dua.version,
  };
}
