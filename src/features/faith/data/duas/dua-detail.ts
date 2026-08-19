import { QURAN_CONTENT_ATTRIBUTION } from '../dhikr/quran-content-attribution';
import {
  SELECTION_ID_PREFIX,
  selectionReferenceLabel,
  type QuranSelection,
} from '../quran-selection/quran-selection';
import type { SelectionResolution } from '../quran-selection/retained-selection.resolver';
import type { DuaCategoryId } from './dua-categories';
import {
  QURAN_PROVIDER,
  duaSourceLabel,
  reviewedQuranReferenceLabel,
  type ReviewedDua,
} from './reviewed-dua';

/**
 * **The Dua detail page's domain object** — one description of what may be shown, computed once, with
 * every unsupported section absent rather than guessed at.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why the screen renders a value instead of asking questions ─────────────
 * A detail page is a long list of conditionals — is there a transliteration, is there a repetition
 * count, is there a reviewer to name, may this open in the Reader — and every one of them is a place a
 * missing field can be quietly turned into a plausible default. `null` becoming an em dash is
 * harmless; `null` becoming "recite three times" is an invented religious instruction, and it would
 * look exactly like the reviewed ones beside it.
 *
 * So the decisions are taken here, in one pure function over a validated object, and the screen draws
 * whatever it is handed. **Nothing is inferred**: a field absent from the source is absent from the
 * presentation, and the section that would have shown it is not rendered at all. That is a property a
 * test can assert without rendering anything, and `faith-dua-detail.test.tsx` does.
 *
 * ── One route, two kinds of thing, and no ambiguity ────────────────────────
 * The same detail route serves a reviewed entry and one of the user's own selections. It has to,
 * because the alternative is two presentations of the same reference that could disagree about which
 * translator produced the meaning being read. What it must never do is let one pass for the other: a
 * personal selection is shown as *the user's own choice*, with no reviewer, no context note and no
 * claim that reciting it is recommended.
 *
 * The discrimination is structural rather than a lookup order. A selection's id always begins `q.`
 * (`selectionIdFor`), and the manifest parser **rejects** a reviewed id that begins `q.` — see
 * `reviewed-dua.ts`. So the two namespaces cannot overlap, `parseDuaDetailId` reads the prefix, and no
 * part of this file has to guess which store to try first or what to do when both answer.
 *
 * ── Provider attribution is on both, because it is true of both ────────────
 * A personal selection's Arabic and translation come from the same retained Quran Foundation
 * generation a reviewed entry's would. The user chose the *reference*; they did not produce the text.
 * So the provider sentence and the translator's name appear on both, and the thing that differs is the
 * review — which is the only thing that actually differs.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** What a detail route is pointing at. */
export type DuaDetailTarget =
  | { readonly kind: 'personal'; readonly selection: QuranSelection }
  | { readonly kind: 'reviewed'; readonly dua: ReviewedDua };

/** Which namespace a route parameter belongs to, before anything is looked up. */
export type DuaDetailIdKind = 'personal' | 'reviewed';

/**
 * Which store a detail id names, from the id alone.
 *
 * Total: every non-empty string is one or the other, because the namespaces partition the space by
 * prefix. `null` only for a parameter that names nothing at all.
 */
export function parseDuaDetailId(duaId: string): DuaDetailIdKind | null {
  if (duaId.trim() === '') {
    return null;
  }
  return duaId.startsWith(SELECTION_ID_PREFIX) ? 'personal' : 'reviewed';
}

/** The route parameter for a target. The id itself — there is no second encoding to keep in step. */
export function duaDetailIdFor(target: DuaDetailTarget): string {
  return target.kind === 'personal' ? target.selection.id : target.dua.id;
}

/**
 * The Tasbih counter a target counts on.
 *
 * The same id, deliberately. A counter's identity *is* the thing it counts, which is what lets a count
 * survive a reinstall and what makes `forgetCounter` able to discard exactly one. `isSelectionCounterId`
 * tells the two kinds apart downstream, and it can only do that because the namespaces are disjoint.
 */
export function duaCounterId(target: DuaDetailTarget): string {
  return duaDetailIdFor(target);
}

export type DuaDetailLookup = {
  readonly duaId: string;
  readonly selections: readonly QuranSelection[];
  /** Reviewed entries already through the manifest gate. */
  readonly reviewed: readonly ReviewedDua[];
};

/**
 * The target a route parameter names, or `null`.
 *
 * `null` is answered honestly by the screen rather than redirected away — a link that silently shows
 * something else is a link that makes a broken address look like a working one, which is the same
 * decision `UnknownCategory` already records.
 */
export function resolveDuaDetail(input: DuaDetailLookup): DuaDetailTarget | null {
  const kind = parseDuaDetailId(input.duaId);
  if (kind === null) {
    return null;
  }
  if (kind === 'personal') {
    const selection = input.selections.find((entry) => entry.id === input.duaId);
    return selection === undefined ? null : { kind: 'personal', selection };
  }
  const dua = input.reviewed.find((entry) => entry.id === input.duaId);
  return dua === undefined ? null : { kind: 'reviewed', dua };
}

/** What the review says, for the disclosure block. Present only on a reviewed entry. */
export type DuaDetailReview = {
  readonly reviewer: string;
  readonly basis: string;
  readonly approvedOn: string;
  /** NoorLife's own identifier for the review record, so a claim is traceable to a document. */
  readonly recordId: string;
  readonly status: 'approved';
};

/**
 * Everything the detail page may draw, and nothing it may not.
 *
 * Every nullable field means the same thing: **the source does not supply this, so the section is not
 * drawn.** None of them has a default, a placeholder or a fallback.
 */
export type DuaDetailPresentation = {
  readonly id: string;
  /** The approved title, or — for a selection — the user's own note, or a neutral stand-in. */
  readonly title: string;
  /** Whether the title is the user's own words. Drives whether it is credited to anybody. */
  readonly titleIsUserWritten: boolean;
  readonly origin: 'personal' | 'reviewed';
  readonly sourceKind: 'quran' | 'hadith';
  /** The exact reference, in the words its kind uses. Always present — it is NoorLife's own. */
  readonly reference: string;
  /** The provider whose licence covers the displayed content. */
  readonly provider: string;
  /** The exact attribution sentence the permission specifies. Never paraphrased. */
  readonly attribution: string;
  /**
   * The Arabic, its translation and the translator, as the device resolved them — or the honest
   * unavailable state. `null` for a source kind this app cannot resolve, which today is Hadith and
   * which is unreachable because no Hadith entry can be approved.
   */
  readonly resolution: SelectionResolution | null;
  /**
   * A romanisation supplied by an approved provider resource, or `null`.
   *
   * `null` today and for every entry, because **NoorLife does not transliterate** and no provider
   * romanisation is retrieved. The field exists so that a reviewed entry naming a
   * `transliterationResourceId` has somewhere for that resource's text to arrive; it is never composed,
   * never guessed from the Arabic, and the section is omitted while it is `null`.
   */
  readonly transliteration: string | null;
  /** Whether the entry declares a romanisation resource at all — separate from having its text. */
  readonly transliterationResourceId: number | null;
  /** The reviewed context. `null` on a personal selection, which has no reviewed context and gets none. */
  readonly context: string | null;
  /** A repetition count, only where a review stated one and stated its basis. */
  readonly repetition: number | null;
  /** The basis the review gave for that count. Never present without the count. */
  readonly repetitionBasis: string | null;
  readonly review: DuaDetailReview | null;
  /** The cards this entry appears under. Reviewed: the approved list. Personal: the user's own state. */
  readonly categories: readonly DuaCategoryId[];
  /** The user's favourite state, or `null` where the concept does not apply. */
  readonly favourite: boolean | null;
  /** Where Open in Reader goes, or `null` when there is no Qur’an reference to open. */
  readonly readerTarget: { readonly surah: number; readonly ayah: number } | null;
  /** The counter id Use in Tasbih switches to. */
  readonly counterId: string;
};

/**
 * A neutral stand-in for a selection with no note of its own.
 *
 * Not a title and not presented as one: it says what the thing is — a verse the user chose — and makes
 * no claim about the verse. Composing something more specific from the reference would be NoorLife
 * naming a passage of the Qur’an, which is exactly the authoring it has no standing to do.
 */
const UNTITLED_SELECTION = 'Your Qur’an selection';

/**
 * The presentation for one target.
 *
 * `resolution` is supplied by the caller because resolving is the screen's business — it holds the
 * retained generation through `useQuranSelections` and resolves synchronously. Passing it in keeps this
 * pure, which is what lets the omission rules be asserted directly.
 */
export function duaDetailPresentation(
  target: DuaDetailTarget,
  resolution: SelectionResolution | null,
): DuaDetailPresentation {
  if (target.kind === 'personal') {
    const { selection } = target;
    return {
      id: selection.id,
      title: selection.label ?? UNTITLED_SELECTION,
      titleIsUserWritten: selection.label !== null,
      origin: 'personal',
      sourceKind: 'quran',
      reference: `Qur’an ${selectionReferenceLabel(selection)}`,
      provider: QURAN_PROVIDER,
      attribution: QURAN_CONTENT_ATTRIBUTION,
      resolution,
      /* A selection has no approved romanisation source, so there is nothing for either field. */
      transliteration: null,
      transliterationResourceId: null,
      /*
        No context, no repetition, no review. Not "not yet" — a selection is the user pointing at a
        verse, and NoorLife supplying a context note for it would be inventing the reviewed claim this
        whole module exists to keep separate.
      */
      context: null,
      repetition: null,
      repetitionBasis: null,
      review: null,
      /*
        Derived from the user's own state, which is the only reason a personal entry may be said to be
        "in" a category at all. Favourites is included exactly when they starred it.
      */
      categories: selection.favourite
        ? ['my-quran-selections', 'favourites']
        : ['my-quran-selections'],
      favourite: selection.favourite,
      readerTarget: { surah: selection.surah, ayah: selection.startAyah },
      counterId: selection.id,
    };
  }

  const { dua } = target;
  const quran = dua.source.kind === 'quran' ? dua.source : null;

  return {
    id: dua.id,
    title: dua.title,
    titleIsUserWritten: false,
    origin: 'reviewed',
    sourceKind: dua.source.kind,
    reference: duaSourceLabel(dua.source),
    provider: dua.provider,
    attribution: QURAN_CONTENT_ATTRIBUTION,
    /* Only a Qur’an reference can be resolved from the retained generation. */
    resolution: quran === null ? null : resolution,
    transliteration: null,
    transliterationResourceId: dua.content.transliterationResourceId,
    context: dua.contextNote,
    repetition: dua.recommendedTarget,
    /*
      Carried only alongside a count. The parser refuses a count without a basis, so a non-null
      repetition always has one — and a basis with no count is not shown, because there is no
      instruction for it to be the basis of.
    */
    repetitionBasis: dua.recommendedTarget === null ? null : dua.review.repetitionBasis,
    review: {
      reviewer: dua.review.reviewer,
      basis: dua.review.source,
      approvedOn: dua.review.reviewedOn,
      recordId: dua.review.recordId,
      status: dua.reviewStatus,
    },
    categories: dua.categories,
    /*
      `null`, not `false`. A reviewed entry has no favourite state anywhere in this app — that would
      live in the reviewed catalogue's own store — and `false` would render a star the user could press
      to write into a store that does not exist.
    */
    favourite: null,
    readerTarget: quran === null ? null : { surah: quran.surah, ayah: quran.startAyah },
    counterId: dua.id,
  };
}

/**
 * The reference a reviewed Qur’an entry resolves against, for the caller that has to resolve it.
 *
 * Returns `null` for a Hadith entry, which has no range and which nothing on the device can resolve.
 */
export function duaResolutionRef(target: DuaDetailTarget): {
  readonly surah: number;
  readonly startAyah: number;
  readonly endAyah: number;
} | null {
  if (target.kind === 'personal') {
    const { selection } = target;
    return {
      surah: selection.surah,
      startAyah: selection.startAyah,
      endAyah: selection.endAyah,
    };
  }
  const { source } = target.dua;
  return source.kind === 'quran'
    ? { surah: source.surah, startAyah: source.startAyah, endAyah: source.endAyah }
    : null;
}

/** The bare `2:255` for a target that has one, for a screen that shows the reference without a prefix. */
export function duaBareReference(target: DuaDetailTarget): string | null {
  const ref = duaResolutionRef(target);
  return ref === null ? null : reviewedQuranReferenceLabel(ref);
}
