import { duaCategoryById, type DuaCategoryId } from './dua-categories';
import { QURAN_PROVIDER, type ReviewedDuaSourceKind } from './reviewed-dua';

/**
 * The **review-candidate contract**: what a proposed Dua looks like before anybody qualified has ruled
 * on it, and the one narrow gate through which an approved one may become manifest data.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── This module ships types and a gate. It ships no candidates. ────────────
 * There is no candidate array here and there is not meant to be one. Candidate records are a *review
 * artefact* — a proposal, a reviewer's decision, notes, a date — and they live in `docs/faith/dua-review/`
 * where a scholar can read and annotate them. Nothing under `src/` imports them, and
 * `faith-dua-candidate-boundary.test.ts` asserts that: the moment a candidate document became an
 * importable module, "proposed" and "shipped" would be one edit apart.
 *
 * That is the whole architectural point. A candidate existing is not a reason for a user to see it. The
 * only way content reaches a screen is `REVIEWED_DUA_MANIFEST`, and the only way a candidate reaches
 * that manifest is a human deliberately copying an `approved` record's promoted form into it — after
 * which `parseReviewedDuas` still has to accept it.
 *
 * ── Two gates in series, and the second one does not trust the first ───────
 * `promoteCandidate` refuses anything that is not `approved` with every review field present. What it
 * returns is **not** a `ReviewedDua`; it is `unknown`-shaped manifest data that must still pass
 * `parseReviewedDuas` — the same parser a manifest from any other origin goes through. So a bug here
 * cannot mint a publishable entry, because this function's output is not the thing screens read.
 *
 * ── Why the status set is closed and includes two kinds of "no" ────────────
 * `rejected` and `superseded` are both invisible to users and they mean different things to a
 * reviewer: rejected is a judgement about the reference, superseded is a judgement about *this
 * record* — a better-worded context, a corrected range — and the old one is kept so the same
 * reference is not proposed again as though nothing had happened. Deleting either would lose the
 * review history that makes a second review cheaper than the first.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Where a proposal stands. Closed, so a typo is a compile error and a hand-written status is not a
 * new state.
 */
export type DuaCandidateStatus =
  /** Drafted by NoorLife, not yet sent to anybody. Invisible to users. */
  | 'candidate'
  /** Sent to a reviewer, awaiting their ruling. Invisible to users. */
  | 'needs-review'
  /** A named reviewer approved it on a stated date. The only status that may be promoted. */
  | 'approved'
  /** A reviewer declined it. Retained so the same reference is not re-proposed blind. */
  | 'rejected'
  /** Replaced by a later record for the same reference. Retained for the same reason. */
  | 'superseded';

/** The statuses that may never reach a user, whatever else is true of the record. */
export const UNPUBLISHABLE_CANDIDATE_STATUSES: readonly DuaCandidateStatus[] = [
  'candidate',
  'needs-review',
  'rejected',
  'superseded',
];

/** The reviewer's ruling, as recorded. Every field is required for an approval to count. */
export type DuaCandidateReview = {
  /** The named person or body. "Reviewed internally" is not a reviewer. */
  readonly reviewer: string;
  /** The citable basis — a work, a ruling, a published collection. Never invented. */
  readonly source: string;
  /** ISO date of the decision. */
  readonly decidedOn: string;
  /** NoorLife's own identifier for the review record, so a claim is traceable to a document. */
  readonly recordId: string;
  /**
   * The reviewer's own remarks, including cautions.
   *
   * Kept on rejected and superseded records too — a reviewer's reason for declining is the most useful
   * thing in the whole file the next time somebody proposes the same passage.
   */
  readonly notes: string | null;
  /** Stated basis for any repetition guidance. Required whenever a count is proposed. */
  readonly repetitionBasis: string | null;
  /** The reviewer's editorial rank, or `null`. Only a reviewer may set this. */
  readonly popularRank: number | null;
};

/** One proposed Dua, at whatever stage it has reached. */
export type DuaCandidate = {
  /** Stable within the review file. Becomes the manifest id on promotion. */
  readonly id: string;
  readonly status: DuaCandidateStatus;
  /** NoorLife's proposed title. A reviewer may replace it; nothing ships an unapproved one. */
  readonly proposedTitle: string;
  /** The presentation cards proposed for it. Validated against the ten, personal cards refused. */
  readonly proposedCategories: readonly DuaCategoryId[];
  readonly sourceKind: ReviewedDuaSourceKind;
  /** For `quran`: the exact range. For `hadith`: `null`, and the collection fields carry it. */
  readonly quranRange: {
    readonly surah: number;
    readonly startAyah: number;
    readonly endAyah: number;
  } | null;
  /** For `hadith`: the collection and the narration's identifier within it. */
  readonly hadithReference: {
    readonly collection: string;
    readonly reference: string;
  } | null;
  /** The provider whose licence would cover it. */
  readonly provider: string;
  /** The proposed context in which it is offered. */
  readonly proposedContext: string;
  /** A proposed repetition count, or `null`. Needs `review.repetitionBasis` to be promotable. */
  readonly proposedRepetition: number | null;
  /** Provider resource id of the translation proposed, or `null`. */
  readonly translationResourceId: number | null;
  /** Provider resource id of a romanisation, or `null`. NoorLife composes none. */
  readonly transliterationResourceId: number | null;
  /** The reviewer's record, or `null` while nobody has ruled. */
  readonly review: DuaCandidateReview | null;
  /** A digest of the reviewed content, or `null`. Proves a promoted row is the row that was signed. */
  readonly fingerprint: string | null;
  readonly version: number;
};

/** Why a candidate may not be promoted. Named, so a review file can be triaged rather than re-read. */
export type PromotionRefusal =
  | 'not-approved'
  | 'missing-review-record'
  | 'incomplete-review-record'
  | 'missing-title'
  | 'missing-context'
  | 'missing-categories'
  | 'unknown-category'
  | 'personal-category'
  | 'source-reference-mismatch'
  | 'wrong-provider'
  | 'repetition-without-basis'
  | 'invalid-popular-rank'
  | 'reserved-id';

export type PromotionOutcome =
  | {
      readonly ok: true;
      /**
       * Manifest data, deliberately typed `unknown`.
       *
       * Not a `ReviewedDua`. It is the row a human would paste into `REVIEWED_DUA_MANIFEST`, and it
       * still has to survive `parseReviewedDuas` afterwards. Typing it as the domain object would let a
       * caller skip the parser, which is the one thing the two-gate arrangement exists to prevent.
       */
      readonly manifestRow: unknown;
    }
  | { readonly ok: false; readonly refusal: PromotionRefusal };

function nonEmpty(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

/**
 * Turns one approved candidate into manifest data, or says why it cannot be.
 *
 * Deliberately strict about things the downstream parser would also catch. Duplication is the point:
 * a reviewer reading a refusal here gets a specific reason at review time, and the parser still
 * refuses independently at build time. Neither is load-bearing alone.
 */
export function promoteCandidate(candidate: DuaCandidate): PromotionOutcome {
  const refuse = (refusal: PromotionRefusal): PromotionOutcome => ({ ok: false, refusal });

  if (candidate.status !== 'approved') {
    return refuse('not-approved');
  }
  /*
    The user's selection namespace. A promoted id beginning `q.` would collide with a personal
    selection on the shared detail route — the parser refuses it too, and so does this.
  */
  if (candidate.id.startsWith('q.')) {
    return refuse('reserved-id');
  }

  const review = candidate.review;
  if (review === null) {
    return refuse('missing-review-record');
  }
  if (!nonEmpty(review.reviewer) || !nonEmpty(review.source) || !nonEmpty(review.recordId)) {
    return refuse('incomplete-review-record');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(review.decidedOn)) {
    return refuse('incomplete-review-record');
  }
  if (!nonEmpty(candidate.proposedTitle)) {
    return refuse('missing-title');
  }
  if (!nonEmpty(candidate.proposedContext)) {
    return refuse('missing-context');
  }

  if (candidate.proposedCategories.length === 0) {
    return refuse('missing-categories');
  }
  for (const id of candidate.proposedCategories) {
    const category = duaCategoryById(id);
    if (category === undefined) {
      return refuse('unknown-category');
    }
    /* The two personal cards hold the user's own data and never a reviewed entry. */
    if (category.kind === 'personal') {
      return refuse('personal-category');
    }
  }

  if (candidate.sourceKind === 'quran') {
    if (candidate.quranRange === null || candidate.hadithReference !== null) {
      return refuse('source-reference-mismatch');
    }
    if (candidate.provider !== QURAN_PROVIDER) {
      return refuse('wrong-provider');
    }
  } else {
    if (candidate.hadithReference === null || candidate.quranRange !== null) {
      return refuse('source-reference-mismatch');
    }
    if (!nonEmpty(candidate.provider)) {
      return refuse('wrong-provider');
    }
  }

  if (candidate.proposedRepetition !== null && !nonEmpty(review.repetitionBasis)) {
    return refuse('repetition-without-basis');
  }
  if (
    review.popularRank !== null &&
    (!Number.isInteger(review.popularRank) || review.popularRank < 1)
  ) {
    return refuse('invalid-popular-rank');
  }

  /*
    Shaped for `parseReviewedDuas`: the rank and the repetition basis go *inside* the review block,
    because that parser refuses a rank placed beside it. See `reviewed-dua.ts`.
  */
  const base = {
    id: candidate.id,
    sourceKind: candidate.sourceKind,
    provider: candidate.provider,
    title: candidate.proposedTitle,
    categories: [...candidate.proposedCategories],
    /* The reviewed taxonomy's own bucket, which the presentation cards do not carry. */
    category: 'quranic-remembrance',
    arabicSource: 'retained-generation',
    translationResourceId: candidate.translationResourceId,
    transliterationResourceId: candidate.transliterationResourceId,
    recommendedTarget: candidate.proposedRepetition,
    reviewStatus: candidate.status,
    review: {
      reviewer: review.reviewer,
      source: review.source,
      reviewedOn: review.decidedOn,
      recordId: review.recordId,
      popularRank: review.popularRank,
      repetitionBasis: review.repetitionBasis,
    },
    contextNote: candidate.proposedContext,
    enabled: true,
    version: candidate.version,
    ...(candidate.fingerprint === null ? {} : { fingerprint: candidate.fingerprint }),
  };

  const manifestRow =
    candidate.sourceKind === 'quran' && candidate.quranRange !== null
      ? {
          ...base,
          surah: candidate.quranRange.surah,
          startAyah: candidate.quranRange.startAyah,
          endAyah: candidate.quranRange.endAyah,
        }
      : {
          ...base,
          collection: candidate.hadithReference?.collection,
          hadithReference: candidate.hadithReference?.reference,
        };

  return { ok: true, manifestRow };
}

/**
 * The promotable rows in a review file, and every refusal alongside them.
 *
 * Returns both because a review pass is a conversation: an operator needs to see that eleven of
 * fourteen candidates were refused and exactly why, not a shorter list with no explanation.
 */
export function promoteCandidates(candidates: readonly DuaCandidate[]): {
  readonly manifestRows: readonly unknown[];
  readonly refused: readonly { readonly id: string; readonly refusal: PromotionRefusal }[];
} {
  const manifestRows: unknown[] = [];
  const refused: { readonly id: string; readonly refusal: PromotionRefusal }[] = [];

  for (const candidate of candidates) {
    const outcome = promoteCandidate(candidate);
    if (outcome.ok) {
      manifestRows.push(outcome.manifestRow);
    } else {
      refused.push({ id: candidate.id, refusal: outcome.refusal });
    }
  }
  return { manifestRows, refused };
}

/**
 * Whether a candidate may be shown to a user. **Always false.**
 *
 * Total, and not because it is a stub: a candidate is by definition something no reviewer has cleared
 * for display, and `approved` records are not displayed *as candidates* — they are promoted into the
 * manifest and displayed from there, with the parser's guarantees attached. So there is no status for
 * which the answer is yes, and this exists to make that statement callable rather than remembered.
 */
export function candidateIsDisplayable(): false {
  return false;
}
