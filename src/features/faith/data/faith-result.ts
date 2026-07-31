/**
 * The result vocabulary every Faith repository speaks.
 *
 * ── Why a union rather than throwing ────────────────────────────────────────
 * A Faith screen has more than two legitimate outcomes. "No bookmarks yet" is not an
 * error, "you are offline but here is the cached surah" is not an error, and "the
 * device refused location" is not an error either — but a thrown exception flattens all
 * of them into one red screen. Modelling them as a union forces each screen to decide
 * what to render for each case, and makes the eight states the phase requires
 * type-checkable rather than aspirational.
 *
 * This mirrors `ModuleDataResult` in the shared framework deliberately. It is a separate
 * type rather than an import because Faith needs two cases the framework's version does
 * not have — `stale` and `permission-required` — and widening the shared type would push
 * cases onto six other modules that have no use for them.
 */

/** Why a request could not be served. Stable codes only — never a provider message. */
export type FaithErrorCode =
  'unavailable' | 'timeout' | 'unauthorized' | 'not-found' | 'rate-limited' | 'unknown';

/** Which OS permission a screen is waiting on. */
export type FaithPermission = 'location' | 'notifications';

/**
 * Where a piece of content came from.
 *
 * Required on anything quoted as religious content. The Faith AI boundary rules forbid
 * presenting generated text as Qur'an, Hadith or a ruling, and the only mechanical way to
 * hold that line is to make provenance part of the type: content without a source cannot
 * be constructed, so it cannot be rendered.
 */
export type ContentSource = {
  /** e.g. "Quran Foundation Content API", "Sahih al-Bukhari". */
  readonly name: string;
  /** Edition, translation or narration identifier, where one applies. */
  readonly edition?: string;
  /** Translator or narrator attribution. */
  readonly attribution?: string;
  /**
   * True only for text served by an approved, licensed source.
   *
   * Mock data sets this false. A screen may render unverified content, but it must say
   * so — see `SourceBadge`.
   */
  readonly verified: boolean;
};

export type FaithResult<T> =
  | { readonly kind: 'ok'; readonly data: T }
  /** The request succeeded and there is genuinely nothing yet. */
  | { readonly kind: 'empty' }
  /** A search or filter ran and matched nothing. Distinct from `empty`. */
  | { readonly kind: 'no-results'; readonly query: string }
  /** No connection, and nothing cached to fall back on. */
  | { readonly kind: 'offline' }
  /**
   * Served from cache while offline or while a refresh failed.
   *
   * Carries the data, so the screen shows content *and* an honest staleness notice
   * rather than choosing between them.
   */
  | { readonly kind: 'stale'; readonly data: T; readonly cachedAt: string }
  /** Blocked on an OS permission the user has not granted. */
  | {
      readonly kind: 'permission-required';
      readonly permission: FaithPermission;
      readonly rationale: string;
    }
  | { readonly kind: 'error'; readonly code: FaithErrorCode; readonly detail?: string };

/** The outcomes that carry no payload, and so fit any `FaithResult`. */
export type FaithFailure = Exclude<FaithResult<unknown>, { readonly data: unknown }>;

/**
 * Narrows to the two cases that carry data.
 *
 * ── It does double duty, and the negative branch is the interesting half ────
 * The obvious guard, `if (result.kind !== 'ok') return result;`, does not compile when
 * the value is being returned from a differently-typed request: the remaining union still
 * includes `stale`, which carries `data: PrayerLocation`, so it is not assignable to
 * `FaithResult<DailyPrayerTimes>`.
 *
 * `hasData` narrows the *false* branch to exactly the payload-free variants, which are
 * assignable to any `FaithResult`. So this one predicate gives a screen both halves of
 * the pattern:
 *
 *     const location = await prayerTimes.resolveCurrentLocation();
 *     if (!hasData(location)) {
 *       return location;                    // FaithFailure — fits any result type
 *     }
 *     return getDailyTimes(location.data);  // narrowed, has a coordinate
 *
 * Note that a `stale` location is deliberately *not* a failure: it has a coordinate and
 * the caller should carry on with it.
 */
export function hasData<T>(result: FaithResult<T>): result is Extract<FaithResult<T>, { data: T }> {
  return result.kind === 'ok' || result.kind === 'stale';
}

/** A page of results, for the repositories that paginate. */
export type FaithPage<T> = {
  readonly items: readonly T[];
  /** Opaque cursor for the next page, or null at the end. */
  readonly nextCursor: string | null;
  /** Total available, where the source reports one. */
  readonly total?: number;
};

export type FaithPageRequest = {
  readonly cursor?: string;
  /** Defaults are the repository's business; callers rarely set this. */
  readonly limit?: number;
};
