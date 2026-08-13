/**
 * Offline city search: how a typed query is normalised, and how matches are ordered.
 *
 * ── Pure on purpose, and separate from the catalogue it searches ────────────
 * Nothing here reads an asset, touches storage or knows what a repository is. Normalisation and
 * ranking are the two things that decide whether a user finds their city, and they are the two
 * things that must be testable without loading 34,000 rows — so they take an index as an argument
 * and return positions in it.
 *
 * ── Why the normaliser is duplicated from the importer, and why that is safe ──
 * `scripts/import-city-catalogue.mjs` precomputes a `normalized` field for every row, so the device
 * never folds 34,000 names at load time. That only works if the two implementations agree exactly:
 * if the importer folded `ø → o` and this did not, every Danish city would be unreachable, and no
 * type would catch it.
 *
 * The guarantee is not "keep the two files in sync by being careful". It is a test that recomputes
 * `normalizeCityQuery` over every name in the *shipped asset* and asserts it reproduces the stored
 * `normalized` field. That checks the data rather than the source, so it fails if either side drifts
 * — including if the asset is rebuilt with an older importer.
 */

import { expandQuery } from './city-exonyms';

/**
 * Characters whose diacritic is part of the glyph, so NFD cannot separate it.
 *
 * Must match `FOLD_EXCEPTIONS` in the importer exactly. See the note above for what enforces that.
 */
const FOLD_EXCEPTIONS: Readonly<Record<string, string>> = {
  ø: 'o',
  Ø: 'o',
  đ: 'd',
  Đ: 'd',
  ð: 'd',
  Ð: 'd',
  ł: 'l',
  Ł: 'l',
  ı: 'i',
  İ: 'i',
  ß: 'ss',
  æ: 'ae',
  Æ: 'ae',
  œ: 'oe',
  Œ: 'oe',
  þ: 'th',
  Þ: 'th',
};

/**
 * A name or a query reduced to what matching compares.
 *
 * Lowercased, NFD-decomposed, combining marks stripped, the exceptions above mapped, and every run
 * of non-alphanumeric characters collapsed to one space.
 *
 * ── Why punctuation collapses to a space rather than vanishing ──────────────
 * "Stoke-on-Trent" must normalise to `stoke on trent`, not `stokeontrent`. A user types the spaces;
 * deleting the separators would make a correctly-typed query fail to prefix-match its own city.
 *
 * The *display* name never passes through here. Accents and casing are how a place is spelled, and
 * the point of folding is to match forgivingly while rendering faithfully.
 */
export function normalizeCityQuery(value: string): string {
  let folded = '';
  for (const char of value) {
    folded += FOLD_EXCEPTIONS[char] ?? char;
  }
  return folded
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
}

/**
 * The shortest query that is searched at all.
 *
 * Two *meaningful* characters — measured after normalisation, so `"a-"` and `"  x  "` are one
 * character and are not searched. Below this the result set is thousands of rows, which is not a
 * search result, and computing it on every keystroke is the cost this bound exists to avoid.
 */
export const MIN_QUERY_LENGTH = 2;

/** How many results a search returns. Small enough to render without virtualisation. */
export const MAX_RESULTS = 20;

/**
 * The flat, parallel-array form the catalogue is indexed into.
 *
 * ── Why parallel arrays rather than an array of objects ─────────────────────
 * 34,000 objects with seven properties each is ~240,000 property slots the JS engine has to
 * allocate, lay out and keep alive for as long as the app runs. Seven arrays is seven allocations,
 * the numeric ones are backed by contiguous storage, and the hot loop below touches exactly one of
 * them — `normalized` — for the vast majority of rows it rejects.
 *
 * Every array has the same length and the same ordering: index `i` is one city across all of them.
 * That ordering is population-descending with a `geonameId` tiebreak, established at build time, and
 * the ranking below depends on it — see `compareMatches`.
 */
export type CityIndex = {
  readonly geonameId: readonly number[];
  readonly name: readonly string[];
  readonly normalized: readonly string[];
  readonly countryCode: readonly string[];
  readonly region: readonly string[];
  readonly latitude: readonly number[];
  readonly longitude: readonly number[];
  readonly population: readonly number[];
  readonly size: number;
};

/**
 * How well a row matched, lower being better.
 *
 * The tiers are the release brief's ranking, made ordinal so a single numeric comparison expresses
 * it. They are deliberately coarse: within a tier, population decides, because a user typing
 * "london" wants London before London, Ontario, and no cleverer relevance signal exists offline.
 */
export const MATCH_TIER = {
  /** The whole normalised name equals the query. */
  exact: 0,
  /** The name starts with the query — the common case while typing. */
  prefix: 1,
  /** A later word starts with the query, e.g. "york" finding "New York". */
  wordPrefix: 2,
  /** The query appears somewhere inside the name. */
  substring: 3,
} as const;

export type MatchTier = (typeof MATCH_TIER)[keyof typeof MATCH_TIER];

export type CityMatch = {
  /** Position in the `CityIndex`. */
  readonly at: number;
  readonly tier: MatchTier;
};

/**
 * Which tier a normalised name matches the query at, or `null` for no match.
 *
 * Ordered cheapest-first and returns on the first hit: equality, then prefix, then a word-boundary
 * prefix, then a free substring. `indexOf` is one pass, and the early returns mean most rows cost a
 * length comparison and a failed `startsWith`.
 */
export function matchTier(normalizedName: string, query: string): MatchTier | null {
  if (normalizedName === query) {
    return MATCH_TIER.exact;
  }
  if (normalizedName.startsWith(query)) {
    return MATCH_TIER.prefix;
  }
  const at = normalizedName.indexOf(query);
  if (at === -1) {
    return null;
  }
  /*
    A match immediately after a space is a word prefix. "york" should reach "New York" well above
    "Yorkton" reaching it by a mid-word substring, because the user typed a whole word of the name.
  */
  return normalizedName[at - 1] === ' ' ? MATCH_TIER.wordPrefix : MATCH_TIER.substring;
}

/**
 * Orders two matches: tier, then population, then the index position.
 *
 * ── Why the final tiebreak is the index rather than the name ────────────────
 * Because the index is already a total order — population descending, `geonameId` ascending, fixed
 * at build time — so falling back to it makes this comparator total without a second string
 * comparison per pair. Sorting by name here would also *disagree* with the catalogue's own ordering,
 * which is the thing the importer guarantees is deterministic.
 */
function compareMatches(a: CityMatch, b: CityMatch, index: CityIndex): number {
  if (a.tier !== b.tier) {
    return a.tier - b.tier;
  }
  const populationA = index.population[a.at] ?? 0;
  const populationB = index.population[b.at] ?? 0;
  if (populationA !== populationB) {
    return populationB - populationA;
  }
  return a.at - b.at;
}

/**
 * The best `MAX_RESULTS` cities for a query, already ordered.
 *
 * ── Why every row is scanned rather than a prefix tree consulted ────────────
 * Because the required behaviour includes substring matching — "york" must find "New York" — and a
 * trie answers prefixes only. Supporting both would mean a second structure, roughly doubling the
 * memory of the thing it was built to make faster.
 *
 * A linear scan over one pre-split array of 34,000 short strings, rejecting almost all of them on a
 * failed `indexOf`, is a few milliseconds — see the timings recorded in the release report. The
 * catalogue is bounded and does not grow with use, so this is a fixed cost rather than one that
 * degrades.
 *
 * Returns an empty array for a query below `MIN_QUERY_LENGTH`, which is the same shape as "nothing
 * matched" on purpose: the screen renders a prompt for the former and an empty state for the latter,
 * and it decides that from the query it already has rather than from a sentinel returned here.
 */
export function searchCityIndex(
  index: CityIndex,
  rawQuery: string,
  limit: number = MAX_RESULTS,
): readonly CityMatch[] {
  const query = normalizeCityQuery(rawQuery);
  if (query.length < MIN_QUERY_LENGTH) {
    return [];
  }

  /*
    Usually one term. A recognised English exonym adds its endonym, so "Mecca" reaches Makkah without
    the catalogue carrying an alias column — see `city-exonyms.ts` for why that trade was made.
  */
  const terms = expandQuery(query);

  const matches: CityMatch[] = [];
  for (let at = 0; at < index.size; at += 1) {
    const candidate = index.normalized[at];
    if (candidate === undefined) {
      continue;
    }
    /*
      Best tier across the terms, and one entry per row. Pushing per matching term would list a city
      twice whenever both the exonym and the endonym hit, which for "Rome" is exactly what happens.
    */
    let best: MatchTier | null = null;
    for (const term of terms) {
      const tier = matchTier(candidate, term);
      if (tier !== null && (best === null || tier < best)) {
        best = tier;
      }
    }
    if (best !== null) {
      matches.push({ at, tier: best });
    }
  }

  /*
    Sorted after collecting rather than kept in a bounded heap. A heap would avoid sorting a few
    thousand matches for a two-character query, but the array sort is native and the collected set
    is already far smaller than the catalogue — and the heap version was harder to prove stable,
    which for a deterministic-ordering requirement is the wrong trade.
  */
  matches.sort((a, b) => compareMatches(a, b, index));
  return matches.slice(0, limit);
}
