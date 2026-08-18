import { hasData, type FaithResult } from '../data/faith-result';
import { surahNumber } from '../data/quran-content.repository';
import { createQuranCache } from '../data/quran-foundation/quran-cache';
import { createQuranFoundationRepository } from '../data/quran-foundation/quran-foundation.repository';
import { DAILY_AYAH_ROTATION, dailyAyahFor } from '../data/quran-foundation/daily-ayah-rotation';
import {
  MAX_CACHE_AGE_MS,
  MAX_CACHE_ENTRIES,
  defaultQuranCachePolicy,
  type QuranContentPayload,
  type QuranContentRequest,
  type QuranEndpointFailure,
  type QuranEndpointOutcome,
  toWireResourceId,
} from '../data/quran-foundation/quran-foundation.contract';

/**
 * The approved Quran Foundation adapter, driven end to end against a fake endpoint.
 *
 * ── What a fake endpoint here does and does not stand in for ────────────────
 * It stands in for the `quran-content` edge function, whose own behaviour — the credential, the
 * token exchange, the retry, the operation allow-list, the vendor's response shapes — is proven by
 * `supabase/functions/quran-content/tests/`, against a fake `fetch`, with no network and no
 * credential. What these tests own is the half that runs on the device: the mapping into
 * `FaithResult`, the cache and its licence ceiling, the staleness rule, and the refusal to invent
 * content when the approved source is unavailable.
 *
 * No test in this file performs a real request. The Supabase client is never constructed, because the
 * repository takes its endpoint as a value rather than reaching for one.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Arabic written as escapes rather than pasted glyphs.
 *
 * The assertion is not "the Arabic looks right" but "these code points came back in this order", and
 * a pasted string would be at the mercy of the editor, the file encoding and any tool that rewrites
 * the file. `DECOMPOSED` in particular is alef plus a combining maddah, which NFC would fold into one
 * code point — the sharpest available test that nothing normalises scripture on the way through.
 */
const UTHMANI = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ';
const DECOMPOSED = 'آلَم';

const SCRIPTURE_SOURCE = {
  name: 'Quran Foundation Content API',
  edition: 'Uthmani script (text_uthmani)',
  verified: true,
} as const;

const TRANSLATION_SOURCE = {
  name: 'Quran Foundation Content API',
  edition: 'Translation 131',
  attribution: 'Dr. Mustafa Khattab, the Clear Quran',
  verified: true,
} as const;

const CHAPTERS: QuranContentPayload = {
  operation: 'list_chapters',
  chapters: [
    {
      number: 18,
      name: 'Al-Kahf',
      arabicName: 'الكهف',
      meaning: 'The Cave',
      ayahCount: 110,
      revelation: 'meccan',
    },
  ],
};

const VERSES: QuranContentPayload = {
  operation: 'list_verses',
  verses: [
    { surah: 18, ayah: 1, arabic: UTHMANI },
    { surah: 18, ayah: 2, arabic: DECOMPOSED },
  ],
  pagination: { nextCursor: '2', total: 110 },
  source: SCRIPTURE_SOURCE,
};

const TRANSLATIONS: QuranContentPayload = {
  operation: 'list_verse_translations',
  translations: [{ surah: 18, ayah: 1, translationId: '131', text: 'All praise is for Allah.' }],
  pagination: { nextCursor: null, total: 110 },
  source: TRANSLATION_SOURCE,
};

const DAILY: QuranContentPayload = {
  operation: 'get_verse',
  verse: { surah: 94, ayah: 6, arabic: UTHMANI },
  source: SCRIPTURE_SOURCE,
  translation: {
    surah: 94,
    ayah: 6,
    translationId: '131',
    text: 'Surely with hardship comes ease.',
  },
  translationSource: TRANSLATION_SOURCE,
};

const EDITIONS: QuranContentPayload = {
  operation: 'list_translation_resources',
  editions: [
    {
      id: '131',
      language: 'english',
      name: 'The Clear Quran',
      translator: 'Dr. Mustafa Khattab',
    },
  ],
};

const RECITERS: QuranContentPayload = {
  operation: 'list_recitation_resources',
  reciters: [{ id: '1', name: 'AbdulBaset AbdulSamad', style: 'Mujawwad' }],
};

const RECITATIONS: QuranContentPayload = {
  operation: 'list_verse_recitations',
  recitations: [
    { surah: 18, ayah: 1, url: 'https://verses.quran.foundation/AbdulBaset/Mujawwad/018001.mp3' },
  ],
  pagination: { nextCursor: null, total: 110 },
};

const PAYLOADS: Readonly<Record<string, QuranContentPayload>> = {
  list_chapters: CHAPTERS,
  get_chapter: {
    operation: 'get_chapter',
    chapter: CHAPTERS.operation === 'list_chapters' ? CHAPTERS.chapters[0]! : ({} as never),
  },
  list_verses: VERSES,
  list_verse_translations: TRANSLATIONS,
  get_verse: DAILY,
  list_translation_resources: EDITIONS,
  list_recitation_resources: RECITERS,
  list_verse_recitations: RECITATIONS,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A fake endpoint that records every request and answers from a script.
 *
 * `requests` is what most of the assertions below are really about: "the cache served this" is a
 * claim that **no** request was made, and only the object that would have made one can prove it.
 */
function fakeEndpoint(
  respond: (
    request: QuranContentRequest,
    index: number,
  ) => QuranEndpointOutcome<QuranContentPayload>,
) {
  const requests: QuranContentRequest[] = [];
  return {
    requests,
    endpoint: {
      request: (body: QuranContentRequest) => {
        requests.push(body);
        return Promise.resolve(respond(body, requests.length - 1));
      },
    },
  };
}

/** Answers every operation from the fixture table, with a one-day cache instruction. */
function alwaysOk(cacheMaxAgeMs = DAY_MS) {
  return fakeEndpoint((request) => ({
    kind: 'ok',
    data: PAYLOADS[request.operation]!,
    cacheMaxAgeMs,
  }));
}

function alwaysFailing(failure: QuranEndpointFailure) {
  return fakeEndpoint(() => ({ kind: 'failed', failure }));
}

type Clock = { now: () => number; advance: (ms: number) => void };

function fakeClock(start = 1_700_000_000_000): Clock {
  let value = start;
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms;
    },
  };
}

function repositoryWith(
  endpoint: {
    request: (body: QuranContentRequest) => Promise<QuranEndpointOutcome<QuranContentPayload>>;
  },
  options: { clock?: Clock; serveStaleWhenOffline?: boolean } = {},
) {
  const clock = options.clock ?? fakeClock();
  return createQuranFoundationRepository({
    cachePolicy: defaultQuranCachePolicy,
    serveStaleWhenOffline: options.serveStaleWhenOffline ?? true,
    endpoint,
    now: clock.now,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping
// ─────────────────────────────────────────────────────────────────────────────

describe('mapping the approved source into the domain', () => {
  it('maps the chapter catalogue', async () => {
    const { endpoint, requests } = alwaysOk();
    const result = await repositoryWith(endpoint).listSurahs();

    expect(requests).toEqual([{ operation: 'list_chapters' }]);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data[0]).toEqual({
        number: 18,
        name: 'Al-Kahf',
        arabicName: 'الكهف',
        meaning: 'The Cave',
        ayahCount: 110,
        revelation: 'meccan',
      });
    }
  });

  it('preserves Qur’anic Arabic byte-for-byte', async () => {
    const { endpoint } = alwaysOk();
    const result = await repositoryWith(endpoint).listAyahs(surahNumber(18));

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data.items[0]?.arabic).toBe(UTHMANI);
      expect(result.data.items[1]?.arabic).toBe(DECOMPOSED);
      // No Unicode composition happened on the way through.
      expect([...(result.data.items[1]?.arabic ?? '')]).toHaveLength(5);
      expect(result.data.items[1]?.arabic.normalize('NFC')).not.toBe(result.data.items[1]?.arabic);
    }
  });

  it('stamps every verse with the approved source', async () => {
    const { endpoint } = alwaysOk();
    const result = await repositoryWith(endpoint).listAyahs(surahNumber(18));

    if (result.kind === 'ok') {
      for (const item of result.data.items) {
        expect(item.source.name).toBe('Quran Foundation Content API');
        expect(item.source.verified).toBe(true);
      }
    }
  });

  it('carries explicit translator attribution on every translation', async () => {
    const { endpoint } = alwaysOk();
    const result = await repositoryWith(endpoint).listTranslations(surahNumber(18), '131');

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      const item = result.data.items[0];
      expect(item?.translationId).toBe('131');
      expect(item?.source.attribution).toBe('Dr. Mustafa Khattab, the Clear Quran');
      expect(item?.source.edition).toBe('Translation 131');
      expect(item?.source.verified).toBe(true);
    }
  });

  it('keeps the daily verse and its meaning in separate objects', async () => {
    const { endpoint } = alwaysOk();
    const result = await repositoryWith(endpoint).getAyahOfTheDay('131');

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data.text.arabic).toBe(UTHMANI);
      expect(result.data.text).not.toHaveProperty('text');
      expect(result.data.translation.text).toBe('Surely with hardship comes ease.');
      expect(result.data.translation.source.attribution).toBeDefined();
    }
  });

  it('maps the edition and reciter catalogues', async () => {
    const { endpoint } = alwaysOk();
    const repository = repositoryWith(endpoint);

    const editions = await repository.availableTranslations();
    expect(editions.kind).toBe('ok');
    if (editions.kind === 'ok') {
      expect(editions.data[0]).toEqual({
        id: '131',
        language: 'english',
        name: 'The Clear Quran',
        translator: 'Dr. Mustafa Khattab',
      });
    }

    const reciters = await repository.availableReciters();
    expect(reciters.kind).toBe('ok');
    if (reciters.kind === 'ok') {
      expect(reciters.data[0]).toEqual({
        id: '1',
        name: 'AbdulBaset AbdulSamad',
        style: 'Mujawwad',
      });
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pagination
// ─────────────────────────────────────────────────────────────────────────────

describe('pagination', () => {
  it('sends the vendor’s paging parameters and returns an opaque cursor', async () => {
    const { endpoint, requests } = alwaysOk();
    const result = await repositoryWith(endpoint).listAyahs(surahNumber(18), {
      cursor: '3',
      limit: 10,
    });

    expect(requests[0]).toEqual({
      operation: 'list_verses',
      surah: 18,
      page: 3,
      per_page: 10,
    });
    if (result.kind === 'ok') {
      expect(result.data.nextCursor).toBe('2');
      expect(result.data.total).toBe(110);
    }
  });

  it('never asks for more than the vendor’s documented page size', async () => {
    const { endpoint, requests } = alwaysOk();
    await repositoryWith(endpoint).listAyahs(surahNumber(18), { limit: 5_000 });
    expect(requests[0]).toMatchObject({ per_page: 50 });
  });

  it('restarts at page one for a cursor it did not issue', async () => {
    const { endpoint, requests } = alwaysOk();
    await repositoryWith(endpoint).listAyahs(surahNumber(18), { cursor: 'not-a-page' });
    expect(requests[0]).toMatchObject({ page: 1 });
  });

  it('reports an empty page as empty rather than as a failure', async () => {
    const { endpoint } = fakeEndpoint(() => ({
      kind: 'ok',
      data: {
        operation: 'list_verses',
        verses: [],
        pagination: { nextCursor: null },
        source: SCRIPTURE_SOURCE,
      },
      cacheMaxAgeMs: DAY_MS,
    }));
    const result = await repositoryWith(endpoint).listAyahs(surahNumber(18), { cursor: '99' });
    expect(result.kind).toBe('empty');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Resource ids on the wire
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The regression a deployed environment found.
 *
 * A live invocation answered `400 invalid_request` with `error_field: recitation_id` and
 * `upstream_attempts: 0`: the app had sent `"1"`, and the edge function requires a bounded integer.
 * Nothing reached Quran Foundation, so the failure was entirely NoorLife's own contract with itself.
 *
 * The policy these tests pin: **the domain keeps its strings, the wire gets integers, and the
 * conversion happens in exactly one place — the last statement before a request is built.** The
 * server is not loosened to meet the app; a request the server would reject is not made at all.
 */
describe('resource ids are converted at the wire boundary, not coerced at either end', () => {
  it('converts a stored string id into a wire integer for every request that carries one', async () => {
    const { endpoint, requests } = alwaysOk();
    const repository = repositoryWith(endpoint);

    await repository.listTranslations(surahNumber(18), '131');
    await repository.getAyahOfTheDay('131');
    await repository.listRecitations(surahNumber(18), '1');

    expect(requests[0]).toMatchObject({
      operation: 'list_verse_translations',
      translation_id: 131,
    });
    expect(requests[1]).toMatchObject({ operation: 'get_verse', translation_id: 131 });
    expect(requests[2]).toMatchObject({ operation: 'list_verse_recitations', recitation_id: 1 });

    /**
     * Stated as an identity rather than as equality, because `"1" == 1` and `expect("1").toEqual(1)`
     * would have passed on the very value that produced the production `400`.
     */
    for (const request of requests) {
      const id =
        'translation_id' in request
          ? request.translation_id
          : 'recitation_id' in request
            ? request.recitation_id
            : undefined;
      expect(typeof id).toBe('number');
    }
  });

  it('keeps the domain id a string on the way back out', async () => {
    // The conversion is one-way and local to the request. Nothing downstream sees a number.
    const { endpoint } = alwaysOk();
    const result = await repositoryWith(endpoint).listTranslations(surahNumber(18), '131');

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.data.items[0]?.translationId).toBe('131');
    }
  });

  it.each([
    ['an empty id', ''],
    ['a non-decimal id', 'abc'],
    ['a hexadecimal id', '0x7b'],
    ['a leading-zero id', '0131'],
    ['zero', '0'],
    ['a negative id', '-1'],
    ['a fractional id', '1.5'],
    ['a padded id', ' 131 '],
    ['an exponent form', '1e2'],
    ['an id past the bound', '10000000'],
    ['a numeric-looking name', '131abc'],
    ['an infinity', 'Infinity'],
    ['a NaN', 'NaN'],
  ])('refuses %s before any request is made', async (_label, id) => {
    const { endpoint, requests } = alwaysOk();
    const repository = repositoryWith(endpoint);

    const translations = await repository.listTranslations(surahNumber(18), id);
    const daily = await repository.getAyahOfTheDay(id);
    const recitations = await repository.listRecitations(surahNumber(18), id);

    /**
     * `not-found` rather than `unknown`: the identifier names no edition the source can serve, and
     * the remedy — choose another one — is exactly what the preferences screen offers for that code.
     */
    for (const result of [translations, daily, recitations]) {
      expect(result).toEqual({ kind: 'error', code: 'not-found' });
    }
    // The load-bearing assertion: no function invocation, and therefore no Quran Foundation call.
    expect(requests).toEqual([]);
  });

  it('accepts the ends of the permitted range and nothing past them', () => {
    expect(toWireResourceId('1')).toBe(1);
    expect(toWireResourceId('1000000')).toBe(1_000_000);
    expect(toWireResourceId('1000001')).toBeNull();

    // A number that is already one is passed through, so a future numeric caller is not a new policy.
    expect(toWireResourceId(131)).toBe(131);
    expect(toWireResourceId(131.5)).toBeNull();
    expect(toWireResourceId(Number.MAX_SAFE_INTEGER)).toBeNull();
    expect(toWireResourceId(undefined)).toBeNull();
    expect(toWireResourceId(null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Failure mapping
// ─────────────────────────────────────────────────────────────────────────────

describe('failure mapping', () => {
  it.each([
    ['not-configured', 'error', 'not-configured'],
    ['authentication-required', 'error', 'unauthorized'],
    ['timed-out', 'error', 'timeout'],
    ['rate-limited', 'error', 'rate-limited'],
    ['not-found', 'error', 'not-found'],
    ['unavailable', 'error', 'unavailable'],
    ['invalid-response', 'error', 'unknown'],
  ] as const)('maps %s to an honest state', async (failure, kind, code) => {
    const { endpoint } = alwaysFailing(failure);
    const result = await repositoryWith(endpoint).listSurahs();
    expect(result.kind).toBe(kind);
    if (result.kind === 'error') {
      expect(result.code).toBe(code);
    }
  });

  it('reports offline as the offline state, not an error', async () => {
    const { endpoint } = alwaysFailing('offline');
    const result = await repositoryWith(endpoint).listSurahs();
    expect(result.kind).toBe('offline');
  });

  it('never returns content on any failure path', async () => {
    /**
     * The rule that matters most once a real source exists. Every failure yields a state with no data
     * at all — there is no branch that reaches for sample scripture, and the repository imports none.
     */
    for (const failure of [
      'not-configured',
      'authentication-required',
      'offline',
      'timed-out',
      'rate-limited',
      'not-found',
      'unavailable',
      'invalid-response',
    ] as const) {
      const { endpoint } = alwaysFailing(failure);
      const repository = repositoryWith(endpoint);
      const results: FaithResult<unknown>[] = await Promise.all([
        repository.listSurahs(),
        repository.listAyahs(surahNumber(18)),
        repository.listTranslations(surahNumber(18), '131'),
        repository.getAyahOfTheDay('131'),
        repository.availableTranslations(),
        repository.availableReciters(),
      ]);
      for (const result of results) {
        expect({ failure, hasData: hasData(result) }).toEqual({ failure, hasData: false });
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────────

describe('search is reported as unsupported rather than faked', () => {
  it('returns an unsupported error and makes no request', async () => {
    const { endpoint, requests } = alwaysOk();
    const result = await repositoryWith(endpoint).searchTranslations('mercy', '131');

    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.code).toBe('unsupported');
      expect(result.detail).toMatch(/not approved/i);
    }
    expect(requests).toHaveLength(0);
  });

  it('does not search the cache, however much of it has been filled', async () => {
    /**
     * The cache holds at most the handful of pages this user opened. Searching it would answer "no
     * results" for verses that plainly exist, which looks like an answer and is worse than an error.
     */
    const { endpoint } = alwaysOk();
    const repository = repositoryWith(endpoint);
    await repository.listTranslations(surahNumber(18), '131');

    const result = await repository.searchTranslations('praise', '131');
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.code).toBe('unsupported');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cache
// ─────────────────────────────────────────────────────────────────────────────

describe('the cache, and the licence it enforces', () => {
  it('serves a fresh entry without a second request', async () => {
    const { endpoint, requests } = alwaysOk();
    const repository = repositoryWith(endpoint);

    await repository.listSurahs();
    await repository.listSurahs();

    expect(requests).toHaveLength(1);
  });

  it('re-fetches once the server’s freshness window has passed', async () => {
    const clock = fakeClock();
    const { endpoint, requests } = alwaysOk(DAY_MS);
    const repository = repositoryWith(endpoint, { clock });

    await repository.listSurahs();
    clock.advance(DAY_MS - 1_000);
    await repository.listSurahs();
    expect(requests).toHaveLength(1);

    clock.advance(2_000);
    await repository.listSurahs();
    expect(requests).toHaveLength(2);
  });

  it('caches each page and each edition separately', async () => {
    const { endpoint, requests } = alwaysOk();
    const repository = repositoryWith(endpoint);

    await repository.listAyahs(surahNumber(18), { cursor: '1' });
    await repository.listAyahs(surahNumber(18), { cursor: '2' });
    await repository.listTranslations(surahNumber(18), '131');
    await repository.listTranslations(surahNumber(18), '20');

    expect(requests).toHaveLength(4);
  });

  it('does not store a response the server declined to authorise caching for', async () => {
    const { endpoint, requests } = alwaysOk(0);
    const repository = repositoryWith(endpoint);

    await repository.listSurahs();
    await repository.listSurahs();

    expect(requests).toHaveLength(2);
  });

  it('never serves an entry older than one week, even offline', async () => {
    /**
     * The licence ceiling, which is a term rather than a tuning parameter — and the assertion that
     * separates "stale but servable" from "gone".
     *
     * The server's freshness window here is a day, so there is a six-day band in which the entry is
     * stale and still worth showing behind a notice. Past the week there is no offline exception at
     * all: the entry is dropped, and the screen gets the offline state with nothing behind it.
     */
    const clock = fakeClock();
    let failing = false;
    const { endpoint } = fakeEndpoint(() =>
      failing
        ? { kind: 'failed', failure: 'offline' }
        : { kind: 'ok', data: VERSES, cacheMaxAgeMs: DAY_MS },
    );
    const repository = repositoryWith(endpoint, { clock });

    await repository.listAyahs(surahNumber(18));
    failing = true;

    // Past the freshness window, inside the licence window: stale, and served with a notice.
    clock.advance(DAY_MS + 1_000);
    expect((await repository.listAyahs(surahNumber(18))).kind).toBe('stale');

    // Still inside the week, a second before it closes.
    clock.advance(MAX_CACHE_AGE_MS - DAY_MS - 3_000);
    expect((await repository.listAyahs(surahNumber(18))).kind).toBe('stale');

    // Past it: gone, with no offline exception.
    clock.advance(4_000);
    expect((await repository.listAyahs(surahNumber(18))).kind).toBe('offline');
  });

  it('serves stale content only when offline, and only when configured to', async () => {
    /**
     * Doing the same for a `503` would quietly hide an outage, and doing it for an authentication
     * failure would show one user's cached content to a session that is no longer valid.
     */
    for (const failure of ['unavailable', 'authentication-required', 'rate-limited'] as const) {
      const clock = fakeClock();
      let failing = false;
      const { endpoint } = fakeEndpoint(() =>
        failing ? { kind: 'failed', failure } : { kind: 'ok', data: VERSES, cacheMaxAgeMs: DAY_MS },
      );
      const repository = repositoryWith(endpoint, { clock });

      await repository.listAyahs(surahNumber(18));
      failing = true;
      clock.advance(DAY_MS + 1_000);

      const result = await repository.listAyahs(surahNumber(18));
      expect({ failure, kind: result.kind }).toEqual({ failure, kind: 'error' });
    }
  });

  it('does not serve stale content when the configuration forbids it', async () => {
    const clock = fakeClock();
    let failing = false;
    const { endpoint } = fakeEndpoint(() =>
      failing
        ? { kind: 'failed', failure: 'offline' }
        : { kind: 'ok', data: VERSES, cacheMaxAgeMs: DAY_MS },
    );
    const repository = repositoryWith(endpoint, { clock, serveStaleWhenOffline: false });

    await repository.listAyahs(surahNumber(18));
    failing = true;
    clock.advance(DAY_MS + 1_000);

    expect((await repository.listAyahs(surahNumber(18))).kind).toBe('offline');
  });

  it('carries the stored time onto the stale result, so the screen can say when', async () => {
    const clock = fakeClock();
    const storedAt = new Date(clock.now()).toISOString();
    let failing = false;
    const { endpoint } = fakeEndpoint(() =>
      failing
        ? { kind: 'failed', failure: 'offline' }
        : { kind: 'ok', data: VERSES, cacheMaxAgeMs: DAY_MS },
    );
    const repository = repositoryWith(endpoint, { clock });

    await repository.listAyahs(surahNumber(18));
    failing = true;
    clock.advance(DAY_MS + 1_000);

    const result = await repository.listAyahs(surahNumber(18));
    expect(result.kind).toBe('stale');
    if (result.kind === 'stale') {
      expect(result.cachedAt).toBe(storedAt);
      expect(result.data.items[0]?.arabic).toBe(UTHMANI);
    }
  });

  it('is bounded, so it cannot grow into a copy of the Qur’an', () => {
    const clock = fakeClock();
    const cache = createQuranCache(clock.now);

    for (let index = 0; index < MAX_CACHE_ENTRIES * 3; index += 1) {
      cache.write(`key-${index}`, VERSES, DAY_MS);
    }

    expect(cache.size()).toBe(MAX_CACHE_ENTRIES);
    // The oldest keys were evicted; the newest survive.
    expect(cache.read('key-0')).toBeNull();
    expect(cache.read(`key-${MAX_CACHE_ENTRIES * 3 - 1}`)).not.toBeNull();
  });

  it('clamps a cache instruction above the licence ceiling', () => {
    const clock = fakeClock();
    const cache = createQuranCache(clock.now);
    cache.write('key', VERSES, MAX_CACHE_AGE_MS * 52);

    clock.advance(MAX_CACHE_AGE_MS - 1_000);
    expect(cache.read('key')?.fresh).toBe(true);

    clock.advance(2_000);
    expect(cache.read('key')).toBeNull();
  });

  it('drops an entry whose age cannot be reasoned about', () => {
    // The device clock can move backwards across a timezone fix or an NTP correction.
    const clock = fakeClock();
    const cache = createQuranCache(clock.now);
    cache.write('key', VERSES, DAY_MS);
    clock.advance(-60_000);
    expect(cache.read('key')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The Daily Ayah rotation
// ─────────────────────────────────────────────────────────────────────────────

describe('the Daily Ayah rotation', () => {
  it('holds verse references and no scripture', () => {
    /**
     * NoorLife chooses *which* verse; Quran Foundation supplies the text. A string of Arabic in this
     * list would mean the app was storing scripture, which is exactly what the integration exists to
     * avoid.
     */
    for (const entry of DAILY_AYAH_ROTATION) {
      expect(Number.isInteger(entry.surah)).toBe(true);
      expect(entry.surah).toBeGreaterThanOrEqual(1);
      expect(entry.surah).toBeLessThanOrEqual(114);
      expect(Number.isInteger(entry.ayah)).toBe(true);
      expect(entry.ayah).toBeGreaterThanOrEqual(1);
      expect(entry.note).not.toMatch(/[؀-ۿ]/);
    }
  });

  it('gives the same verse all day, and a different one tomorrow', () => {
    const morning = dailyAyahFor(new Date('2026-08-10T00:30:00.000Z'));
    const evening = dailyAyahFor(new Date('2026-08-10T23:30:00.000Z'));
    const tomorrow = dailyAyahFor(new Date('2026-08-11T00:30:00.000Z'));

    expect(evening).toEqual(morning);
    expect(tomorrow).not.toEqual(morning);
  });

  it('fetches today’s verse live rather than from a stored copy', async () => {
    const clock = fakeClock(new Date('2026-08-10T12:00:00.000Z').getTime());
    const { endpoint, requests } = alwaysOk();
    await repositoryWith(endpoint, { clock }).getAyahOfTheDay('131');

    const expected = dailyAyahFor(new Date('2026-08-10T12:00:00.000Z'));
    expect(requests[0]).toEqual({
      operation: 'get_verse',
      surah: expected.surah,
      verse: expected.ayah,
      translation_id: 131,
    });
  });

  it('reports an empty state rather than showing scripture with no meaning', async () => {
    const { endpoint } = fakeEndpoint(() => ({
      kind: 'ok',
      data: {
        operation: 'get_verse',
        verse: { surah: 94, ayah: 6, arabic: UTHMANI },
        source: SCRIPTURE_SOURCE,
      },
      cacheMaxAgeMs: DAY_MS,
    }));
    expect((await repositoryWith(endpoint).getAyahOfTheDay('131')).kind).toBe('empty');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Construction
// ─────────────────────────────────────────────────────────────────────────────

describe('construction', () => {
  it('refuses a cache policy above the licence ceiling, loudly and at construction', () => {
    const { endpoint } = alwaysOk();
    expect(() =>
      createQuranFoundationRepository({
        cachePolicy: { ...defaultQuranCachePolicy, scriptureMaxAgeMs: MAX_CACHE_AGE_MS + 1 },
        serveStaleWhenOffline: true,
        endpoint,
      }),
    ).toThrow(/one week/);
  });

  it('declares the approved source, so the badge follows the swap', () => {
    const { endpoint } = alwaysOk();
    const repository = repositoryWith(endpoint);
    expect(repository.source.verified).toBe(true);
    expect(repository.source.name).toBe('Quran Foundation Content API');
  });
});
