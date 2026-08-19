import { referenceLabel, type CuratedDhikrReference } from '../dhikr/quran-dhikr-catalogue';
import { selectionReferenceLabel, type QuranSelection } from '../quran-selection/quran-selection';

/**
 * Searching and filtering the Duas library — over what NoorLife may legitimately show, and nothing
 * else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What is searched, and the one thing that deliberately is not ───────────
 * Four fields: the user's own label, the surah's name, the reference itself, and the display title
 * of a reviewed entry. All four are either the user's words or NoorLife's own metadata about a
 * reference.
 *
 * **The Arabic is not searched, and neither is the translation.** Not because it would be hard —
 * the retained generation is right there — but because making scripture searchable at speed means
 * building an index of it, and an index is a second copy: outside the refresh path, outside the
 * account boundary if it landed in preferences, and immune to a correction upstream. The feature
 * would be worth roughly one convenience and would cost the property that the whole storage layer is
 * built to guarantee.
 *
 * A query is also typed in the interface's script. Matching "rahman" against Arabic would be a
 * transliteration guess, and a search that quietly guesses at scripture is worse than one that
 * plainly does not cover it.
 *
 * ── Why this is a pure function over supplied data ─────────────────────────
 * It reads nothing and fetches nothing. Selections come from the account-scoped store, reviewed
 * entries come through the manifest gate, and surah names come from the metadata cache — each is
 * already loaded by the screen for its own reasons. A search that did its own reading would be a
 * third path to the same data with its own idea of who is signed in.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The four filters the compact sheet offers. Closed, and every one of them is honest. */
export type DuaLibraryFilter =
  | 'all'
  /** The user's own saved references. */
  | 'selections'
  /** The subset they starred. */
  | 'favourites'
  /**
   * Entries a named reviewer approved.
   *
   * Legitimately empty today, and the sheet still offers it: a filter that appears only once content
   * exists teaches the user a control that was never there, and hides the fact that NoorLife
   * distinguishes the two kinds at all.
   */
  | 'reviewed';

export const DUA_LIBRARY_FILTERS: readonly {
  readonly id: DuaLibraryFilter;
  readonly label: string;
}[] = [
  { id: 'all', label: 'All' },
  { id: 'selections', label: 'My Quran Selections' },
  { id: 'favourites', label: 'Favorites' },
  { id: 'reviewed', label: 'Reviewed' },
];

/**
 * One search hit, carrying which kind of thing it is.
 *
 * A union rather than a flag, because the two carry different data and are rendered with different
 * claims attached. Nothing downstream can render a hit without having decided which branch it is in
 * — which is the same reason the Duas list badges every row.
 */
export type DuaSearchResult =
  | {
      readonly kind: 'personal';
      readonly selection: QuranSelection;
      /** `2:255`, or `59:22-24`. */
      readonly reference: string;
      /** The surah's transliterated name where the metadata cache holds one. */
      readonly surahName: string | null;
    }
  | {
      readonly kind: 'reviewed';
      readonly entry: CuratedDhikrReference;
      readonly reference: string;
      readonly surahName: string | null;
    };

export type DuaSearchInput = {
  readonly query: string;
  readonly filter: DuaLibraryFilter;
  readonly selections: readonly QuranSelection[];
  /**
   * Reviewed entries **already through the gate**.
   *
   * The caller passes `reviewedQuranDuas()`, which parses the manifest and applies
   * `approvedForProduction`. This function does not re-derive that and deliberately cannot: it has
   * no access to the raw manifest, so there is no path on which an unapproved entry could reach a
   * result by being handed in directly.
   */
  readonly reviewed: readonly CuratedDhikrReference[];
  /** Surah number → transliterated name, from the metadata cache. Absent names simply do not match. */
  readonly surahNames: ReadonlyMap<number, string>;
};

function matches(haystack: readonly (string | null)[], needle: string): boolean {
  return haystack.some((value) => value !== null && value.toLowerCase().includes(needle));
}

/**
 * The library, filtered and searched.
 *
 * An empty query returns everything the filter admits, so the same function drives the unsearched
 * list and the searched one — two code paths would be two answers to "what is in Favorites?".
 */
export function searchDuaLibrary(input: DuaSearchInput): readonly DuaSearchResult[] {
  const needle = input.query.trim().toLowerCase();

  const personal: DuaSearchResult[] =
    input.filter === 'reviewed'
      ? []
      : input.selections
          .filter((selection) => input.filter !== 'favourites' || selection.favourite)
          .map((selection) => ({
            kind: 'personal' as const,
            selection,
            reference: selectionReferenceLabel(selection),
            surahName: input.surahNames.get(selection.surah) ?? null,
          }));

  /*
    Reviewed entries are excluded from the two personal filters rather than filtered out afterwards.
    "Favorites" means the user starred it, and a reviewed entry is not something they starred — its
    favourite state lives in the reviewed catalogue's own store, and answering from here would be a
    second opinion about the same question.
  */
  const reviewed: DuaSearchResult[] =
    input.filter === 'selections' || input.filter === 'favourites'
      ? []
      : input.reviewed.map((entry) => ({
          kind: 'reviewed' as const,
          entry,
          reference: referenceLabel(entry),
          surahName: input.surahNames.get(entry.surah) ?? null,
        }));

  const all = [...personal, ...reviewed];
  if (needle.length === 0) {
    return all;
  }

  return all.filter((result) =>
    result.kind === 'personal'
      ? matches([result.selection.label, result.reference, result.surahName], needle)
      : matches([result.entry.title, result.reference, result.surahName], needle),
  );
}

/**
 * The selections belonging to one category card.
 *
 * ── Why only two cards can ever return anything ────────────────────────────
 * A user's selection is a verse they chose. It is not a morning remembrance, a travel supplication
 * or a dua for distress unless somebody qualified says so, and nobody has — so placing one into a
 * religious category would be NoorLife making exactly the editorial claim it does not make.
 *
 * `my-quran-selections` returns them all and `favourites` returns the starred ones. Every other card
 * returns nothing, whatever is in the store.
 */
export function selectionsForCategory(
  categoryId: string,
  selections: readonly QuranSelection[],
): readonly QuranSelection[] {
  if (categoryId === 'my-quran-selections') {
    return selections;
  }
  if (categoryId === 'favourites') {
    return selections.filter((selection) => selection.favourite);
  }
  return [];
}

/**
 * The reviewed entries belonging to one category card.
 *
 * Takes entries that are already through the gate and narrows them to the buckets the card names. A
 * card naming no bucket returns nothing by construction rather than by a condition somebody could
 * relax — see `reviewedCategories` in `dua-categories.ts`.
 */
export function reviewedForCategory(
  reviewedCategories: readonly string[],
  reviewed: readonly CuratedDhikrReference[],
): readonly CuratedDhikrReference[] {
  if (reviewedCategories.length === 0) {
    return [];
  }
  return reviewed.filter((entry) => reviewedCategories.includes(entry.category));
}
