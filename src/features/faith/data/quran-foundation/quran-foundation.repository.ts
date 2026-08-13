import type { ContentSource, FaithPage, FaithPageRequest, FaithResult } from '../faith-result';
import {
  ayahNumber,
  surahNumber,
  type AyahRecitation,
  type AyahText,
  type AyahTranslation,
  type QuranContentRepository,
  type ReciterEdition,
  type ReciterId,
  type SurahNumber,
  type SurahSummary,
  type TranslationEdition,
  type TranslationId,
} from '../quran-content.repository';
import { dailyAyahFor } from './daily-ayah-rotation';
import { createQuranCache, type QuranCache } from './quran-cache';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  QURAN_FOUNDATION_SOURCE,
  toWireResourceId,
  type QuranContentPayload,
  type QuranContentRequest,
  type QuranEndpointFailure,
  type QuranEndpointOutcome,
  type QuranFoundationClientConfig,
  type WireChapter,
  type WireSource,
  validateCachePolicy,
} from './quran-foundation.contract';

/**
 * Runs a call and turns a **thrown** failure into `null`.
 *
 * Used only for the catalogue store, whose two methods reach a storage backend this repository does
 * not own. Everything else here answers with a `FaithResult` by contract. A store that throws is
 * operationally identical to a store that is empty — the request below happens either way — so it is
 * treated as one rather than being allowed to take down a screen. Nothing about the failure is
 * captured: this module has no logger, by the same rule as the endpoint.
 */
async function settled<T>(call: () => Promise<T>): Promise<T | null> {
  try {
    return await call();
  } catch {
    return null;
  }
}

/**
 * The approved Quran Foundation adapter, as a `QuranContentRepository`.
 *
 * ── What this is, and what it is not ────────────────────────────────────────
 * It satisfies the domain interface the Faith screens already depend on, by calling NoorLife's own
 * `quran-content` edge function and mapping the result. It holds no credential, names no vendor host,
 * makes no direct request, and contains no scripture — every verse it returns arrived in the response
 * it is mapping, and `AyahText.arabic` is assigned by copy with no transformation on the path.
 *
 * ── The one method that cannot be satisfied, and why it is not hidden ───────
 * `searchTranslations` needs Quran Foundation's **Search APIs**, and NoorLife's approval covers
 * Content only. Three options were available and two were wrong:
 *
 *   • *Search the cache.* The cache holds, at most, the handful of pages this user happened to open
 *     in the last week. Searching it would answer "no results" for verses that plainly exist, which
 *     is a worse failure than an error — it looks like an answer.
 *   • *Delete the method from the interface.* That would remove the evidence that a capability is
 *     missing, and would make the mock and the real repository describe different products.
 *   • *Return an honest `unsupported` result.* Which is what this does, and the search screen states
 *     it in words rather than showing an empty Qur'an section.
 *
 * ── No fallback to sample scripture, in any failure mode ────────────────────
 * Every failure path below returns a `FaithResult` failure or a `stale` cache entry that came from
 * the approved source. There is no import of `data/mock` in this file and no branch that could reach
 * one — a source scan asserts it. A user who is offline with an empty cache sees an offline state,
 * not an invented verse.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Mapping helpers
// ─────────────────────────────────────────────────────────────────────────────

/** The wire's provenance, as the domain's. `verified` is `true` only because the source is approved. */
function toContentSource(source: WireSource): ContentSource {
  return {
    name: source.name,
    ...(source.edition === undefined ? {} : { edition: source.edition }),
    ...(source.attribution === undefined ? {} : { attribution: source.attribution }),
    verified: true,
  };
}

/**
 * A page request as the wire's paging parameters.
 *
 * ── Clamping here, refusing on the server: the asymmetry is deliberate ──────
 * The edge function refuses a `per_page` above the vendor's documented 50, because a client that
 * asked for 500 and silently received 50 would page incorrectly for the rest of the surah. This
 * repository *owns* the paging — it produces the cursors its callers hand back — so a caller's
 * `limit` is a preference rather than a protocol, and clamping it is invisible and correct.
 *
 * The cursor is opaque to callers and is a page number here. An unparseable one restarts at page one
 * rather than failing: a cursor this repository did not issue is a bug in a caller, and losing the
 * user's place is a better outcome than an error screen.
 */
function pagingFor(page?: FaithPageRequest): { readonly page: number; readonly per_page: number } {
  const cursor = page?.cursor;
  const parsed = cursor === undefined ? Number.NaN : Number.parseInt(cursor, 10);
  const pageNumber = Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;

  const limit = page?.limit;
  const perPage =
    typeof limit === 'number' && Number.isFinite(limit)
      ? Math.min(Math.max(Math.floor(limit), 1), MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;

  return { page: pageNumber, per_page: perPage };
}

/**
 * The client-facing failure for each endpoint state.
 *
 * Every one of these is a state a screen already knows how to render, and none of them carries a
 * message. `offline` is the only member that is not an `error`, because the framework treats it as a
 * first-class state with its own retry affordance.
 */
function toFailure(failure: QuranEndpointFailure): FaithResult<never> {
  switch (failure) {
    case 'not-configured':
      return { kind: 'error', code: 'not-configured' };
    case 'authentication-required':
      return { kind: 'error', code: 'unauthorized' };
    case 'offline':
      return { kind: 'offline' };
    case 'timed-out':
      return { kind: 'error', code: 'timeout' };
    case 'rate-limited':
      return { kind: 'error', code: 'rate-limited' };
    case 'not-found':
      return { kind: 'error', code: 'not-found' };
    case 'unavailable':
      return { kind: 'error', code: 'unavailable' };
    case 'invalid-response':
      /**
       * A response NoorLife could not validate. `unknown` rather than `unavailable` because the
       * service answered — this is a defect on one side of the boundary, not an outage, and the
       * distinction is what an engineer reading a report needs.
       */
      return { kind: 'error', code: 'unknown' };
  }
}

/** A stable cache key. Every varying input appears in it, so two reads cannot collide. */
function cacheKeyFor(request: QuranContentRequest): string {
  switch (request.operation) {
    case 'list_chapters':
    case 'list_translation_resources':
    case 'list_recitation_resources':
      return request.operation;
    case 'get_chapter':
      return `${request.operation}:${request.surah}`;
    case 'list_verses':
      return `${request.operation}:${request.surah}:${request.page}:${request.per_page}`;
    case 'list_verse_translations':
      return `${request.operation}:${request.surah}:${request.translation_id}:${request.page}:${request.per_page}`;
    case 'get_verse':
      return `${request.operation}:${request.surah}:${request.verse}:${request.translation_id ?? 'none'}`;
    case 'list_verse_recitations':
      return `${request.operation}:${request.surah}:${request.recitation_id}:${request.page}:${request.per_page}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The repository
// ─────────────────────────────────────────────────────────────────────────────

export function createQuranFoundationRepository(
  config: QuranFoundationClientConfig,
): QuranContentRepository {
  // Throws on a policy above the licence ceiling, at construction, where it is loud.
  validateCachePolicy(config.cachePolicy);

  const now = config.now ?? Date.now;
  const cache: QuranCache = createQuranCache(now);

  /**
   * Requests that are already on their way, keyed exactly as the cache is.
   *
   * ── The duplicate this removes is not hypothetical ──────────────────────────
   * The cache is written when a response *arrives*, so two callers that ask for the same thing
   * before the first answer lands both miss the cache and both invoke the function. That is the
   * normal case rather than a race: Faith home mounts the daily-ayah card and the Qur'an tab's
   * catalogue in the same commit, a re-render during navigation restarts a request that has not
   * settled, and React 18 double-invokes effects in development. Each duplicate is a full Supabase
   * session read plus an authenticated invocation plus a vendor round trip, against a rate limit
   * NoorLife shares across every user.
   *
   * Joining the in-flight promise is safe because the value is immutable and already shared: every
   * caller of `read` maps the same frozen payload through its own `map`, and no caller mutates it.
   * The entry is removed in a `finally`, so a rejection cannot leave a permanently-poisoned key.
   */
  const inFlight = new Map<string, Promise<QuranEndpointOutcome<QuranContentPayload>>>();

  const requestOnce = async (
    key: string,
    request: QuranContentRequest,
  ): Promise<QuranEndpointOutcome<QuranContentPayload>> => {
    const existing = inFlight.get(key);
    if (existing !== undefined) {
      return await existing;
    }
    const pending = config.endpoint.request(request).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, pending);
    return await pending;
  };

  /**
   * One read: cache, then the endpoint, then the cache again on the way out.
   *
   * ── The staleness rule, stated once ────────────────────────────────────────
   * A **fresh** cache entry is served without a request. A failure with a cached entry behind it is
   * served as `stale` — but only when the failure is `offline`, and only when the configuration
   * allows it. That narrowness is the point: "you are offline, here is what you read last week, and
   * we are telling you so" is honest, while doing the same for a `503` would quietly hide an outage,
   * and doing it for `authentication-required` would show one user's cached content to a session that
   * is no longer valid.
   *
   * An entry past the one-week licence window is not servable in any of these branches, because
   * `cache.read` has already dropped it.
   */
  const read = async <T>(
    request: QuranContentRequest,
    map: (payload: QuranContentPayload) => FaithResult<T>,
  ): Promise<FaithResult<T>> => {
    const key = cacheKeyFor(request);

    const cached = cache.read(key);
    if (cached !== null && cached.fresh) {
      return map(cached.payload);
    }

    const outcome = await requestOnce(key, request);
    if (outcome.kind === 'ok') {
      cache.write(key, outcome.data, outcome.cacheMaxAgeMs);
      return map(outcome.data);
    }

    if (cached !== null && outcome.failure === 'offline' && config.serveStaleWhenOffline) {
      const mapped = map(cached.payload);
      if (mapped.kind === 'ok') {
        return { kind: 'stale', data: mapped.data, cachedAt: cached.cachedAt };
      }
      // A cached payload that no longer maps to data is not something to present as stale content.
      return mapped;
    }

    return toFailure(outcome.failure);
  };

  /**
   * The shape of a payload that arrived for the wrong operation.
   *
   * The endpoint already checks the operation against the request, so this is unreachable in
   * practice — and it is here rather than as a cast because a cast would make it unreachable *and*
   * unchecked, which is a different thing.
   */
  const wrongPayload: FaithResult<never> = { kind: 'error', code: 'unknown' };

  /**
   * A stored edition or reciter id that is not a vendor resource id.
   *
   * ── Refused here, before anything is invoked ────────────────────────────────
   * `not-found` rather than `unknown`, because that is what it is: the identifier names no edition
   * the source can serve, and the remedy is to choose another one — which is exactly what the
   * preferences screen offers for `not-found`. The request is never made, so a malformed preference
   * costs neither a function invocation nor a Quran Foundation call.
   *
   * How one gets here at all: preferences persist, so a value written by an older build, an
   * interrupted migration, or a hand-edited store can outlive the catalogue it came from.
   */
  const unusableEdition: FaithResult<never> = { kind: 'error', code: 'not-found' };

  return {
    source: QURAN_FOUNDATION_SOURCE,

    /**
     * The 114 surahs, from the persisted catalogue when there is one.
     *
     * ── Order of consultation, and why it is this order ─────────────────────────
     *   1. **The in-memory cache**, via `read` — free, and correct within the process.
     *   2. **The persisted store** — a local AsyncStorage read, sub-millisecond, no network.
     *   3. **The network**, which is what every launch used to do unconditionally.
     *
     * Step 2 is the fix. `quran-cache` dies with the process by design, so before this the catalogue
     * was refetched on every cold start even though it had been fetched on every previous one and had
     * not changed — the Qur'an tab could not draw a single row until a session read, a function
     * invocation and a vendor round trip had all completed.
     *
     * The stored catalogue is served **as `ok`, not as `stale`**. `stale` means "the source could not
     * be reached and this is what we had", which carries a banner telling the user so. An entry
     * inside the licence window is not that: it is a current answer to a question whose answer does
     * not change. Marking it stale would put a warning on the normal path.
     *
     * The revalidation this warrants happens above this method, in the hook, which refreshes without
     * clearing what is on screen. Firing a background request from inside a repository read would
     * make one call site issue two requests with no way for a caller to observe or cancel either.
     */
    async listSurahs(options): Promise<FaithResult<readonly SurahSummary[]>> {
      const toSummaries = (chapters: readonly WireChapter[]): readonly SurahSummary[] =>
        chapters.map((chapter) => ({
          number: surahNumber(chapter.number),
          name: chapter.name,
          arabicName: chapter.arabicName,
          meaning: chapter.meaning,
          ayahCount: chapter.ayahCount,
          revelation: chapter.revelation,
        }));

      const key = cacheKeyFor({ operation: 'list_chapters' });
      const refreshing = options?.refresh === true;

      if (refreshing) {
        /**
         * A deliberate revalidation. Both caches are stepped over rather than consulted — a refresh
         * that could be answered by the thing it is refreshing is not a refresh.
         *
         * The in-memory entry is dropped first so `read` below cannot serve it. The write-through on
         * success then repopulates both layers, which is what makes one background revalidation per
         * screen mount enough.
         */
        cache.invalidate(key);
      } else {
        const memory = cache.read(key);
        if (memory === null && config.catalogueStore !== undefined) {
          /**
           * Consulted only on a miss, so a warm process never pays for a storage read, and never
           * when a store was not supplied. A store that throws or holds something unusable answers
           * `null` and the request below happens exactly as it would have.
           */
          const stored = await settled(
            () => config.catalogueStore?.read() ?? Promise.resolve(null),
          );
          if (stored !== null && stored !== undefined) {
            /**
             * Fresh entries are `ok`; entries past the server's freshness instruction but inside the
             * licence week are `stale`.
             *
             * `stale` is what makes the background re-check *targeted*. Returning `ok` always would
             * leave a caller no way to know a re-check was due, so the only honest alternative would
             * be re-checking on every mount — a network read per tab switch, handing back most of
             * the latency this store exists to save. The rows are drawn immediately either way; the
             * difference is only whether a revalidation is warranted.
             */
            const fresh = now() - stored.storedAt < config.cachePolicy.catalogueMaxAgeMs;
            const data = toSummaries(stored.chapters);
            return fresh
              ? { kind: 'ok', data }
              : { kind: 'stale', data, cachedAt: new Date(stored.storedAt).toISOString() };
          }
        }
      }

      const result = await read({ operation: 'list_chapters' }, (payload) => {
        if (payload.operation !== 'list_chapters') {
          return wrongPayload;
        }
        return { kind: 'ok', data: payload.chapters };
      });

      if (result.kind !== 'ok') {
        return result.kind === 'stale'
          ? { kind: 'stale', data: toSummaries(result.data), cachedAt: result.cachedAt }
          : result;
      }

      /**
       * Written after a successful fetch, and not awaited for correctness — the caller already has
       * its answer, and a storage failure must not turn a good response into a slow one. It *is*
       * awaited here so the write is ordered before the next read in a test, and because the write
       * is a few hundred microseconds against a request that took hundreds of milliseconds.
       */
      await settled(() => config.catalogueStore?.write(result.data) ?? Promise.resolve());
      return { kind: 'ok', data: toSummaries(result.data) };
    },

    async getSurah(surah: SurahNumber): Promise<FaithResult<SurahSummary>> {
      return await read({ operation: 'get_chapter', surah }, (payload) => {
        if (payload.operation !== 'get_chapter') {
          return wrongPayload;
        }
        const { chapter } = payload;
        return {
          kind: 'ok',
          data: {
            number: surahNumber(chapter.number),
            name: chapter.name,
            arabicName: chapter.arabicName,
            meaning: chapter.meaning,
            ayahCount: chapter.ayahCount,
            revelation: chapter.revelation,
          },
        };
      });
    },

    async listAyahs(
      surah: SurahNumber,
      page?: FaithPageRequest,
    ): Promise<FaithResult<FaithPage<AyahText>>> {
      const paging = pagingFor(page);
      return await read<FaithPage<AyahText>>(
        { operation: 'list_verses', surah, ...paging },
        (payload) => {
          if (payload.operation !== 'list_verses') {
            return wrongPayload;
          }
          if (payload.verses.length === 0) {
            // Paging past the end of a surah. Honest, and distinct from a failure.
            return { kind: 'empty' };
          }
          const source = toContentSource(payload.source);
          return {
            kind: 'ok',
            data: {
              items: payload.verses.map((verse) => ({
                surah: surahNumber(verse.surah),
                ayah: ayahNumber(verse.ayah),
                // Copied. There is no transformation on this path, here or anywhere upstream of it.
                arabic: verse.arabic,
                source,
              })),
              nextCursor: payload.pagination.nextCursor,
              ...(payload.pagination.total === undefined
                ? {}
                : { total: payload.pagination.total }),
            },
          };
        },
      );
    },

    async listTranslations(
      surah: SurahNumber,
      translationId: TranslationId,
      page?: FaithPageRequest,
    ): Promise<FaithResult<FaithPage<AyahTranslation>>> {
      const edition = toWireResourceId(translationId);
      if (edition === null) {
        return unusableEdition;
      }
      const paging = pagingFor(page);
      return await read<FaithPage<AyahTranslation>>(
        { operation: 'list_verse_translations', surah, translation_id: edition, ...paging },
        (payload) => {
          if (payload.operation !== 'list_verse_translations') {
            return wrongPayload;
          }
          if (payload.translations.length === 0) {
            return { kind: 'empty' };
          }
          const source = toContentSource(payload.source);
          return {
            kind: 'ok',
            data: {
              items: payload.translations.map((translation) => ({
                surah: surahNumber(translation.surah),
                ayah: ayahNumber(translation.ayah),
                translationId: translation.translationId,
                text: translation.text,
                source,
              })),
              nextCursor: payload.pagination.nextCursor,
              ...(payload.pagination.total === undefined
                ? {}
                : { total: payload.pagination.total }),
            },
          };
        },
      );
    },

    async getAyahOfTheDay(
      translationId: TranslationId,
    ): Promise<FaithResult<{ readonly text: AyahText; readonly translation: AyahTranslation }>> {
      /**
       * NoorLife chooses the verse; Quran Foundation supplies the text.
       *
       * The date decides the reference, so the card is the same all day and the same on every device,
       * and the text is fetched live for that verse key. No scripture is stored to make this work —
       * see `daily-ayah-rotation.ts`, which holds surah and ayah numbers and nothing else.
       */
      const edition = toWireResourceId(translationId);
      if (edition === null) {
        return unusableEdition;
      }
      const reference = dailyAyahFor(new Date(now()));
      return await read<{ readonly text: AyahText; readonly translation: AyahTranslation }>(
        {
          operation: 'get_verse',
          surah: reference.surah,
          verse: reference.ayah,
          translation_id: edition,
        },
        (payload) => {
          if (payload.operation !== 'get_verse') {
            return wrongPayload;
          }
          const { verse, translation, translationSource } = payload;
          if (translation === undefined || translationSource === undefined) {
            /**
             * The edition returned no rendering for today's verse. The card shows a verse *with its
             * meaning*, so scripture alone is not the thing it was asked for — and showing the Arabic
             * under a heading that promises a translation would be worse than an empty state.
             */
            return { kind: 'empty' };
          }
          return {
            kind: 'ok',
            data: {
              text: {
                surah: surahNumber(verse.surah),
                ayah: ayahNumber(verse.ayah),
                arabic: verse.arabic,
                source: toContentSource(payload.source),
              },
              translation: {
                surah: surahNumber(translation.surah),
                ayah: ayahNumber(translation.ayah),
                translationId: translation.translationId,
                text: translation.text,
                source: toContentSource(translationSource),
              },
            },
          };
        },
      );
    },

    searchTranslations(): Promise<FaithResult<FaithPage<AyahTranslation>>> {
      /**
       * Not approved, and therefore not implemented.
       *
       * Quran Foundation's Search APIs are a separate scope that NoorLife's Content-only approval does
       * not cover. This returns an honest unsupported result rather than searching the cache, which
       * would answer "no results" for verses that exist, and rather than dropping the method, which
       * would hide the gap. The search screen renders a notice; see `quran-foundation/README.md`.
       *
       * The parameters are deliberately not read. A method that accepted a query and ignored it would
       * still look like a search from the outside.
       */
      return Promise.resolve({
        kind: 'error',
        code: 'unsupported',
        detail: 'Qur’an search requires Quran Foundation Search API access, which is not approved.',
      });
    },

    async availableTranslations(): Promise<FaithResult<readonly TranslationEdition[]>> {
      return await read<readonly TranslationEdition[]>(
        { operation: 'list_translation_resources' },
        (payload) => {
          if (payload.operation !== 'list_translation_resources') {
            return wrongPayload;
          }
          if (payload.editions.length === 0) {
            return { kind: 'empty' };
          }
          return {
            kind: 'ok',
            data: payload.editions.map((edition) => ({
              id: edition.id,
              language: edition.language,
              name: edition.name,
              translator: edition.translator,
            })),
          };
        },
      );
    },

    async listRecitations(
      surah: SurahNumber,
      reciterId: ReciterId,
      page?: FaithPageRequest,
    ): Promise<FaithResult<FaithPage<AyahRecitation>>> {
      const recitation = toWireResourceId(reciterId);
      if (recitation === null) {
        return unusableEdition;
      }
      const paging = pagingFor(page);
      return await read<FaithPage<AyahRecitation>>(
        { operation: 'list_verse_recitations', surah, recitation_id: recitation, ...paging },
        (payload) => {
          if (payload.operation !== 'list_verse_recitations') {
            return wrongPayload;
          }
          if (payload.recitations.length === 0) {
            /**
             * Empty, and honest about which kind of empty it is not.
             *
             * This is reached when the page is past the end of the surah *or* when every URL on the
             * page failed validation — and from here the two are indistinguishable. `empty` is right
             * for both: the reader offers no play controls, which is the correct rendering either
             * way. Reporting an error for the second case would tell the user something is broken
             * when the verses on screen are perfectly readable.
             */
            return { kind: 'empty' };
          }
          return {
            kind: 'ok',
            data: {
              items: payload.recitations.map((recitation) => ({
                surah: surahNumber(recitation.surah),
                ayah: ayahNumber(recitation.ayah),
                reciterId,
                url: recitation.url,
                ...(recitation.durationSeconds === undefined
                  ? {}
                  : { durationSeconds: recitation.durationSeconds }),
              })),
              nextCursor: payload.pagination.nextCursor,
              ...(payload.pagination.total === undefined
                ? {}
                : { total: payload.pagination.total }),
            },
          };
        },
      );
    },

    async availableReciters(): Promise<FaithResult<readonly ReciterEdition[]>> {
      return await read<readonly ReciterEdition[]>(
        { operation: 'list_recitation_resources' },
        (payload) => {
          if (payload.operation !== 'list_recitation_resources') {
            return wrongPayload;
          }
          if (payload.reciters.length === 0) {
            return { kind: 'empty' };
          }
          return {
            kind: 'ok',
            data: payload.reciters.map((reciter) => ({
              id: reciter.id,
              name: reciter.name,
              ...(reciter.style === undefined ? {} : { style: reciter.style }),
            })),
          };
        },
      );
    },
  };
}
