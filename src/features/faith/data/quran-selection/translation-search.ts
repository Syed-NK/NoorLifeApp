import type { RetainedQuran } from '../offline/retained-quran.source';

/**
 * **Finding a verse by words you remember** — over the retained translation, in memory, keeping
 * nothing.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The problem this exists for ────────────────────────────────────────────
 * The browser could already find a surah by name or number, and a verse by an exact reference. What
 * it could not do was answer the way people actually arrive: *I remember the words, not the
 * coordinates.* Its own empty state said so — "Try a surah name, a number from 1 to 114, or a
 * reference like 2:255" — which is a fair description of a feature that required you to already know
 * where you were going.
 *
 * ── Why this does not contradict `searchDuaLibrary` ────────────────────────
 * That function deliberately does **not** search scripture, and the reason it gives is exact: making
 * scripture searchable at speed means building an *index*, and an index is a second copy — outside
 * the refresh path, outside the account boundary if it landed in preferences, and unable to pick up a
 * correction upstream.
 *
 * Every word of that still holds, and this does not build one. `RetainedTranslations.bySurah` is
 * already a `ReadonlyMap` in memory: the offline source read it once for the published generation and
 * every consumer shares it. This scans that map on the keystroke and returns rows. It creates no
 * index, writes nothing, persists nothing, and keeps nothing between calls — so there is no second
 * copy to drift, to leak across accounts, or to survive a correction. The distinction is not
 * cosmetic: the objection was to *storing* a derived copy of scripture, and nothing here stores
 * anything.
 *
 * When the generation is replaced, the next call scans the new map. That is the refresh obligation met
 * by construction rather than by invalidation.
 *
 * ── Translation only, and no transliteration guessing ──────────────────────
 * The Arabic is not searched. A query is typed in the interface's script, so matching "rahman" against
 * Arabic script would require transliterating one side or the other — which is a guess about
 * scripture, and a search that quietly guesses is worse than one that plainly does not cover it. The
 * same reasoning `searchDuaLibrary` records.
 *
 * Matching is plain, case-insensitive substring. No stemming, no fuzzy distance, no synonyms: every
 * one of those decides that a word the user did not type is close enough to a word in a rendering of
 * the Qur'an, which is not a judgement this app makes. "mercy" finds "mercy" and "merciful"; it does
 * not find "compassion", and it should not pretend to.
 *
 * ── Why the query has a floor and the results have a ceiling ───────────────
 * A one- or two-character query matches thousands of verses, which is not a search result, it is the
 * whole book in an unhelpful order. And an unbounded list would render thousands of rows per
 * keystroke. Both bounds are stated to the caller — `MIN_QUERY_LENGTH` so the screen can say what is
 * needed, and `overflow` so it can say how many were not shown rather than implying it found exactly
 * this many.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * How many characters a query needs before scripture is scanned.
 *
 * Three, because two is where the result count stops being a result: "he" appears in a large fraction
 * of English renderings. This is a usefulness floor, not a performance one.
 */
export const MIN_QUERY_LENGTH = 3;

/**
 * How many matches are returned.
 *
 * A browsing aid, not a concordance. Fifty is more than anybody scrolls before refining the words they
 * remember, and `overflow` carries the rest of the truth so the cap is never silent.
 */
export const MAX_TRANSLATION_MATCHES = 50;

/** How much of the surrounding rendering travels with a match, in characters. */
const SNIPPET_RADIUS = 60;

/** One verse whose translation contains the query. */
export type TranslationMatch = {
  readonly surah: number;
  readonly ayah: number;
  /** `2:255`. NoorLife's own label for the reference. */
  readonly reference: string;
  /** The surah's transliterated name where the metadata cache holds one, else `null`. */
  readonly surahName: string | null;
  /**
   * A bounded excerpt of the retained rendering, showing why this matched.
   *
   * Derived on the spot from the text already in memory and never stored. Elided with a leading and
   * trailing ellipsis when it is a window into something longer, so it cannot be mistaken for the
   * whole verse — the whole verse is what opening the result shows, with its translator named.
   */
  readonly snippet: string;
};

export type TranslationSearchResult = {
  readonly matches: readonly TranslationMatch[];
  /** Matches the cap left out. Stated by the screen rather than hidden. */
  readonly overflow: number;
  /**
   * Why there are no matches, so the screen can say the right thing.
   *
   * `too-short` is not an empty result — it is a search that has not run — and telling somebody
   * "nothing matched" when they have typed two letters would be false.
   */
  readonly state: 'ok' | 'too-short' | 'no-generation' | 'no-translation';
  /**
   * Who produced the rendering these snippets come from, and which edition.
   *
   * Carried out of the search rather than looked up again by the screen, because a snippet **is**
   * translation text on screen and the licence requires the translator named wherever it appears. A
   * result list that could render without this would be a list that could omit the credit.
   */
  readonly translator: string | null;
  readonly translationEdition: string | null;
};

/** `2:255`. Single verses only — a match is one ayah, and a range is something the user then chooses. */
function referenceFor(surah: number, ayah: number): string {
  return `${surah}:${ayah}`;
}

/**
 * A window of the rendering around the first match.
 *
 * Whole-word boundaries are respected at the edges where possible, so a snippet does not begin or end
 * mid-word — a fragment like "…ercy upon" reads as corruption rather than as an excerpt.
 */
function snippetAround(text: string, at: number, queryLength: number): string {
  if (text.length <= SNIPPET_RADIUS * 2 + queryLength) {
    return text;
  }
  const rawStart = Math.max(0, at - SNIPPET_RADIUS);
  const rawEnd = Math.min(text.length, at + queryLength + SNIPPET_RADIUS);

  /* Nudge each edge outward to the nearest space, so both ends land between words. */
  const start = rawStart === 0 ? 0 : text.indexOf(' ', rawStart) + 1 || rawStart;
  const lastSpace = text.lastIndexOf(' ', rawEnd);
  const end = rawEnd === text.length ? text.length : lastSpace > start ? lastSpace : rawEnd;

  return `${start === 0 ? '' : '…'}${text.slice(start, end).trim()}${end === text.length ? '' : '…'}`;
}

export type TranslationSearchInput = {
  readonly query: string;
  /**
   * The retained generation, or `null` when this device holds none.
   *
   * Passed in rather than read here: the caller already holds it through `useQuranSelections`, and a
   * search that did its own reading would be a second path to the same content with its own idea of
   * which generation is current.
   */
  readonly retained: RetainedQuran | null;
  /** Surah number → transliterated name, from the metadata cache. Absent names simply render as null. */
  readonly surahNames: ReadonlyMap<number, string>;
  readonly limit?: number;
};

/**
 * The verses whose retained translation contains the query.
 *
 * Ordered by surah then ayah — the Qur'an's own order. Not by a relevance score: ranking renderings of
 * scripture by how well they match a search term would impose an ordering NoorLife has no basis for,
 * and mushaf order is the one order every reader already knows.
 */
export function searchRetainedTranslation(input: TranslationSearchInput): TranslationSearchResult {
  const translations = input.retained?.translations ?? null;
  const translator = translations?.source.attribution ?? null;
  const translationEdition = translations?.source.edition ?? null;
  const empty = { matches: [], overflow: 0, translator, translationEdition } as const;

  const needle = input.query.trim().toLowerCase();
  if (needle.length < MIN_QUERY_LENGTH) {
    return { ...empty, state: 'too-short' };
  }
  if (input.retained === null) {
    return { ...empty, state: 'no-generation' };
  }
  if (translations === null) {
    return { ...empty, state: 'no-translation' };
  }

  const limit = input.limit ?? MAX_TRANSLATION_MATCHES;
  const matches: TranslationMatch[] = [];
  let total = 0;

  /*
    Mushaf order, taken by iterating surah numbers rather than the map's own key order — a `Map`
    preserves insertion order, and the order rows were indexed in is not a promise about scripture.
  */
  const surahNumbers = [...translations.bySurah.keys()].sort((a, b) => a - b);
  for (const surah of surahNumbers) {
    const verses = translations.bySurah.get(surah) ?? [];
    for (const verse of verses) {
      const at = verse.text.toLowerCase().indexOf(needle);
      if (at === -1) {
        continue;
      }
      total += 1;
      /*
        Counting continues past the cap so `overflow` is the real number left out, not the number found
        before the search stopped looking. The scan is over strings already in memory, so finishing it
        costs a pass rather than a read.
      */
      if (matches.length < limit) {
        matches.push({
          surah,
          ayah: verse.ayah,
          reference: referenceFor(surah, verse.ayah),
          surahName: input.surahNames.get(surah) ?? null,
          snippet: snippetAround(verse.text, at, needle.length),
        });
      }
    }
  }

  return {
    matches,
    overflow: Math.max(0, total - matches.length),
    state: 'ok',
    translator,
    translationEdition,
  };
}

/**
 * Whether a query is worth scanning scripture for at all.
 *
 * Exported so the screen can decide whether to run the scan on this keystroke without duplicating the
 * threshold, and so the two can never disagree about what "too short" means.
 */
export function isSearchableQuery(query: string): boolean {
  return query.trim().length >= MIN_QUERY_LENGTH;
}
