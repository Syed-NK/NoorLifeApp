import { selectionReferenceLabel, type QuranSelection } from '../quran-selection/quran-selection';
import { selectionsForCategory } from './dua-library';
import { type DuaCategory, type DuaCategoryId } from './dua-categories';
import {
  duaSourceLabel,
  reviewedDuasForCategory,
  reviewedQuranReferenceLabel,
  type ReviewedDua,
} from './reviewed-dua';

/**
 * **What one category page shows** — its filters, its search, its results, and which of the several
 * different kinds of "nothing" it is looking at.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why filters, search and emptiness are decided in one function ───────────
 * They are not three questions. "Sunnah, matching 'travel', in Food & Drink" has exactly one right
 * answer, and computing the filter in one place, the search in another and the empty state in a third
 * is how a screen ends up saying *nothing matched your search* when the truth is that no reviewed
 * content exists for the category at all. Those are different sentences and the user acts differently
 * on each — one means try another word, the other means no word will help.
 *
 * So this takes the whole question and returns the whole answer, deterministically: same inputs, same
 * rows, same order, same empty reason. The screen renders it and decides nothing.
 *
 * ── Which filters a card offers, and why some are absent rather than empty ──
 * The module's existing convention, set by the library-wide filter sheet, is that a filter which is
 * *legitimately empty today* is still offered — hiding it would teach the user a control that appears
 * out of nowhere later, and would conceal that NoorLife distinguishes reviewed content from personal
 * at all. That convention is kept: **Sunnah is always offered on a reviewed card** and answers
 * honestly.
 *
 * A filter that is *structurally incapable* of a result is a different case and is absent. Two of
 * them:
 *
 *   • **Favorites on a reviewed card.** A reviewed entry has no favourite state — that would live in
 *     the reviewed catalogue's own store, and `ReviewedItem` deliberately offers no star. A filter
 *     over a property the rows cannot have is not empty, it is meaningless.
 *   • **Qur’an and Sunnah on a personal card.** Every one of the user's selections is a Qur’an
 *     reference, so "Qur’an" would be a synonym for "All" and "Sunnah" would be a permanent blank.
 *     Neither draws a distinction that exists in that list.
 *
 * And Favorites inside **Favorites** is absent too, because that card *is* the starred subset — a
 * filter that re-applies the page's own definition is a control that cannot change anything.
 *
 * ── Search covers metadata and never scripture ─────────────────────────────
 * Title, the user's own note, the surah's transliterated name, and the reference itself. Not the
 * Arabic and not the translation, for the reasons `searchDuaLibrary` sets out at length: indexing
 * scripture means keeping a second copy of it outside the refresh path and outside the account
 * boundary. Nothing here logs a query, records it, or keeps it beyond the render that used it.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The filters a category page may offer. Closed, and every one of them is honest where it appears. */
export type DuaCategoryFilter = 'all' | 'quran' | 'sunnah' | 'favourites';

export type DuaCategoryFilterOption = {
  readonly id: DuaCategoryFilter;
  readonly label: string;
};

const FILTER_LABELS: Readonly<Record<DuaCategoryFilter, string>> = {
  all: 'All',
  quran: 'Qur’an',
  sunnah: 'Sunnah',
  favourites: 'Favorites',
};

/**
 * The filters this card offers, in order, with All always first.
 *
 * Derived from the card's `kind` and its id rather than from what happens to be in the store, so the
 * control set does not change under the user as they star something.
 */
export function categoryFilterOptions(category: DuaCategory): readonly DuaCategoryFilterOption[] {
  const ids: readonly DuaCategoryFilter[] =
    category.kind === 'reviewed'
      ? ['all', 'quran', 'sunnah']
      : category.id === 'favourites'
        ? ['all']
        : ['all', 'favourites'];
  return ids.map((id) => ({ id, label: FILTER_LABELS[id] }));
}

/** Whether a filter may be applied on this card at all. The guard against a stale route parameter. */
export function categoryFilterAvailable(category: DuaCategory, filter: DuaCategoryFilter): boolean {
  return categoryFilterOptions(category).some((option) => option.id === filter);
}

/** One row on a category page, carrying which kind of thing it is and therefore what may be claimed. */
export type DuaCategoryRow =
  | {
      readonly kind: 'personal';
      readonly selection: QuranSelection;
      /** `2:255`, or `59:22-24`. */
      readonly reference: string;
      readonly surahName: string | null;
    }
  | {
      readonly kind: 'reviewed';
      readonly dua: ReviewedDua;
      /** `Qur’an 2:255`, or a collection and narration number. */
      readonly reference: string;
      readonly surahName: string | null;
    };

/**
 * Why a category page has no rows. **Five different truths, never collapsed into one.**
 *
 * The distinction the product actually turns on is between the last two: *your search found nothing*
 * is advice to try another word, and *nothing has been reviewed for this category* is a statement
 * about NoorLife's publishing policy that no search term will change. A screen that said the first
 * when it meant the second would send the user hunting for content that does not exist.
 */
export type DuaCategoryEmptyReason =
  /** There are rows. Nothing is empty. */
  | 'not-empty'
  /** A query was typed and matched nothing that the filter admits. */
  | 'no-search-match'
  /** A reviewed card, with nothing approved for it. The honest policy statement. */
  | 'no-reviewed-content'
  /** My Quran Selections, and the user has saved none. */
  | 'no-personal-selections'
  /** Favorites, and the user has starred none. */
  | 'no-favourites';

export type DuaCategoryResultsInput = {
  readonly category: DuaCategory;
  readonly filter: DuaCategoryFilter;
  readonly query: string;
  readonly selections: readonly QuranSelection[];
  /**
   * Reviewed entries **already through the gate**.
   *
   * The caller passes `reviewedDuas()`, which parses the manifest. Nothing here re-derives approval
   * and deliberately cannot: it has no access to the raw manifest, so an unapproved row has no path
   * to a result by being handed in directly.
   */
  readonly reviewed: readonly ReviewedDua[];
  /** Surah number → transliterated name, from the metadata cache. Absent names simply do not match. */
  readonly surahNames: ReadonlyMap<number, string>;
};

export type DuaCategoryResults = {
  readonly rows: readonly DuaCategoryRow[];
  readonly emptyReason: DuaCategoryEmptyReason;
  /** Whether a query is being applied — the screen needs it to pick between two empty states. */
  readonly searching: boolean;
};

function matches(haystack: readonly (string | null)[], needle: string): boolean {
  return haystack.some((value) => value !== null && value.toLowerCase().includes(needle));
}

/**
 * The rows the filter admits, before any search.
 *
 * `sunnah` returns nothing rather than filtering to nothing: no reviewed entry can have a Hadith
 * source today, because `PERMITTED_HADITH_PROVIDERS` is empty and the parser refuses every such row.
 * Written as a filter over `source.kind` anyway, so a future licensed provider is a data change here
 * too rather than a branch somebody has to find and delete.
 */
function admitted(input: DuaCategoryResultsInput): readonly DuaCategoryRow[] {
  const { category, filter, selections, reviewed, surahNames } = input;

  const personalSource =
    filter === 'quran' || filter === 'sunnah'
      ? []
      : selectionsForCategory(category.id, selections).filter(
          (selection) => filter !== 'favourites' || selection.favourite,
        );

  const personal: DuaCategoryRow[] = personalSource.map((selection) => ({
    kind: 'personal' as const,
    selection,
    reference: selectionReferenceLabel(selection),
    surahName: surahNames.get(selection.surah) ?? null,
  }));

  /*
    A personal card never shows reviewed entries and a reviewed card never shows selections. That is
    not a filter decision — it is the same rule `selectionsForCategory` states, and putting somebody's
    saved verse under a religious category would be an editorial claim made by code.
  */
  const reviewedSource =
    category.kind === 'personal' || filter === 'favourites'
      ? []
      : reviewedDuasForCategory(category.id, reviewed).filter((dua) =>
          filter === 'quran'
            ? dua.source.kind === 'quran'
            : filter === 'sunnah'
              ? dua.source.kind === 'hadith'
              : true,
        );

  const reviewedRows: DuaCategoryRow[] = reviewedSource.map((dua) => ({
    kind: 'reviewed' as const,
    dua,
    reference: duaSourceLabel(dua.source),
    surahName: dua.source.kind === 'quran' ? (surahNames.get(dua.source.surah) ?? null) : null,
  }));

  /*
    Reviewed first, then the user's own. A reviewed entry carries a named approval and a personal one
    does not, and on a page that holds both the one with provenance leads. Within each group the input
    order is preserved, so nothing is re-sorted by a rule nobody stated.
  */
  return [...reviewedRows, ...personal];
}

/**
 * Which of the five kinds of nothing this is.
 *
 * Ordered so the most specific true statement wins. A query beats everything, because when somebody
 * has typed a word the thing they need to know is whether it matched — telling them the category is
 * unreviewed while their search box holds "travel" answers a question they did not ask.
 */
function emptyReasonFor(
  input: DuaCategoryResultsInput,
  searching: boolean,
  rowCount: number,
): DuaCategoryEmptyReason {
  if (rowCount > 0) {
    return 'not-empty';
  }
  if (searching) {
    return 'no-search-match';
  }
  if (input.category.kind === 'reviewed') {
    return 'no-reviewed-content';
  }
  return input.category.id === 'favourites' ? 'no-favourites' : 'no-personal-selections';
}

/**
 * One category page's rows and its empty reason.
 *
 * An empty query returns everything the filter admits, so the same function drives the unsearched
 * page and the searched one — two code paths would be two answers to "what is in Favorites?".
 */
export function duaCategoryResults(input: DuaCategoryResultsInput): DuaCategoryResults {
  const needle = input.query.trim().toLowerCase();
  const searching = needle.length > 0;
  const all = admitted(input);

  const rows = searching
    ? all.filter((row) =>
        row.kind === 'personal'
          ? matches([row.selection.label, row.reference, row.surahName], needle)
          : matches(
              [
                row.dua.title,
                row.reference,
                row.surahName,
                /*
                  The bare `2:255` as well as the prefixed label, so somebody typing a reference finds
                  it whether or not they wrote the word before it.
                */
                row.dua.source.kind === 'quran'
                  ? reviewedQuranReferenceLabel(row.dua.source)
                  : row.dua.source.reference,
              ],
              needle,
            ),
      )
    : all;

  return { rows, emptyReason: emptyReasonFor(input, searching, rows.length), searching };
}

/**
 * The wording each empty state uses.
 *
 * Kept beside the reason rather than in the screen so the two cannot drift, and so a test can assert
 * that the reviewed-category sentence says the three things it has to say: that reviewed content for
 * *this category* is not available yet, that NoorLife does not publish unapproved supplications, and
 * that the user's own selections are unaffected.
 */
export function duaCategoryEmptyCopy(
  reason: Exclude<DuaCategoryEmptyReason, 'not-empty'>,
  category: { readonly label: string; readonly id: DuaCategoryId },
): { readonly title: string; readonly body: string; readonly note: string | null } {
  switch (reason) {
    case 'no-search-match':
      return {
        title: 'Nothing matched that',
        body: 'Try a surah name, a reference like 2:255, or a word from a note you wrote.',
        note: null,
      };
    case 'no-reviewed-content':
      return {
        title: 'Reviewed content for this category is not available yet.',
        body: `NoorLife does not publish supplications that a qualified reviewer has not approved. Nothing appears in ${category.label} until each reference has been reviewed and the review recorded.`,
        note: 'Your own Qur’an selections are unaffected.',
      };
    case 'no-personal-selections':
      return {
        title: 'No selections yet',
        body: 'Choose a verse from the Qur’an and it appears here, with its Arabic and its translation.',
        note: null,
      };
    case 'no-favourites':
      return {
        title: 'Nothing starred yet',
        body: 'Star a selection and it appears here.',
        note: null,
      };
  }
}
