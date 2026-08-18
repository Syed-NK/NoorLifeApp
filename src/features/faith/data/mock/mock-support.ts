import type { ContentSource, FaithPage, FaithPageRequest } from '../faith-result';

/**
 * Shared plumbing for the Faith mock repositories.
 *
 * ── On honesty in fixtures ──────────────────────────────────────────────────
 * `MOCK_SOURCE.verified` is `false` on every fixture in this directory, without
 * exception. That flag is what the source badge reads, so every screen showing mock
 * scripture says so on the screen itself. Setting it true for "nicer looking"
 * screenshots would defeat the only mechanism preventing sample content from being
 * mistaken for the real thing.
 */

/** Latency, so loading states are actually observable during development. */
export const MOCK_LATENCY_MS = 280;

export function delay<T>(value: T, ms: number = MOCK_LATENCY_MS): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), ms);
  });
}

/**
 * The provenance stamped on every fixture.
 *
 * Named so it reads unambiguously wherever it surfaces, including in a screenshot taken
 * out of context.
 */
export const MOCK_SOURCE: ContentSource = {
  name: 'NoorLife sample content',
  edition: 'development fixtures',
  attribution: 'Not a verified source — pending Quran Foundation approval',
  verified: false,
};

/** Provenance for Hadith fixtures, which cite a real collection but are not vetted text. */
export const MOCK_HADITH_SOURCE: ContentSource = {
  name: 'NoorLife sample content',
  edition: 'development fixtures',
  attribution: 'Collection named for realism; text not verified against a critical edition',
  verified: false,
};

/**
 * Paginates an in-memory array.
 *
 * The mock paginates for real rather than returning everything at once, because a screen
 * that only ever saw one page would not exercise its "load more" path and would break the
 * first time a real 286-ayah surah arrived.
 */
export function paginate<T>(items: readonly T[], page?: FaithPageRequest): FaithPage<T> {
  const limit = page?.limit ?? 20;
  const start = page?.cursor === undefined ? 0 : Number.parseInt(page.cursor, 10);
  const from = Number.isNaN(start) ? 0 : start;
  const slice = items.slice(from, from + limit);
  const next = from + limit;

  return {
    items: slice,
    nextCursor: next < items.length ? String(next) : null,
    total: items.length,
  };
}

/** ISO date for today, `YYYY-MM-DD`. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Case- and diacritic-insensitive substring match for the mock search screens.
 *
 * Not a search engine, and not pretending to be one — it exists so the search screen's
 * results, no-results and query-too-short paths are all reachable during review.
 */
export function matches(haystack: string, needle: string): boolean {
  const normalise = (value: string): string =>
    value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return normalise(haystack).includes(normalise(needle));
}
