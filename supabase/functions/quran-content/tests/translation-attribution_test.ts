import { assert, assertEquals } from './assert.ts';
import {
  createQuranFoundationClient,
  routeFor,
  TRANSLATION_FIELDS,
} from '../quran-foundation-client.ts';
import { createQuranContentHandler } from '../handler.ts';
import { normalizeTranslations } from '../normalize.ts';
import { QF_OAUTH_ORIGIN } from '../token-store.ts';
import type { QuranQuery, QuranUpstream, UpstreamResult } from '../ports.ts';
import {
  acceptingVerifier,
  dependencies,
  fakeClock,
  jsonRequest,
  jsonResponse,
  recordingFetch,
  recordingLogger,
  syntheticToken,
} from './fakes.ts';

/**
 * The intermittent translation `502`, reproduced and then closed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect, as it appeared in the deployed logs ─────────────────────────
 * `list_verse_translations` answered `200` for some requests and NoorLife's own
 * `502 upstream_unavailable` for others — same surah, same edition, same user, minutes apart. Every
 * failing line said `upstream_outcome: ok` (the vendor answered fine) and `catalogue_fetched: true`
 * (which reads as "and the catalogue was fetched"), so the evidence pointed at a vendor problem that
 * was not there.
 *
 * ── What was actually happening ─────────────────────────────────────────────
 * The live API omits the optional `resource_name` on every translation row, so the *only* source of
 * a translator's name is `/resources/translations` — a **second** upstream read. It was issued
 * sequentially, after the content read, on the same `AbortSignal` and inside the same 15-second
 * budget the content read had already been spending. A warm isolate answered from its cached
 * catalogue and returned `200`. A cold isolate had to fetch, and when the content read had been slow
 * the catalogue read was aborted by the shared timer, `attribution` came back `null`,
 * `normalizeTranslations` correctly refused to render scripture with nobody to credit, and the
 * handler answered `502`.
 *
 * Three things had to be true for that to survive investigation, and each has a test below:
 *   1. `catalogueFetched` was `true` on the failure path as well as the success path.
 *   2. Every normalisation refusal returned an indistinguishable `null`.
 *   3. The catalogue read got the *leftover* deadline rather than its own.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const CLIENT_ID = 'synthetic-client-id-for-tests';
const CLIENT_SECRET = 'synthetic-client-secret-for-tests';

const TRANSLATIONS: QuranQuery = {
  operation: 'list_verse_translations',
  surah: 18,
  translationId: 131,
  page: 1,
  perPage: 20,
};

/** A translations page exactly as production sends one: no `resource_name`, no `meta`. */
const LIVE_PAGE = {
  translations: [
    { resource_id: 131, verse_key: '18:1', text: 'All praise is for Allah.' },
    { resource_id: 131, verse_key: '18:2', text: 'A statement of the truth.' },
  ],
  pagination: { per_page: 20, current_page: 1, next_page: 2, total_pages: 6, total_records: 110 },
};

/** The vendor's edition catalogue, carrying the pair the rows do not. */
const CATALOGUE_BODY = {
  translations: [
    {
      id: 131,
      name: 'The Clear Quran',
      author_name: 'Dr. Mustafa Khattab',
      language_name: 'english',
    },
  ],
};

function neverAborted(): AbortSignal {
  return new AbortController().signal;
}

/** The catalogue's answer for edition 131, as a pair. */
const CATALOGUE_PAIR = { title: 'The Clear Quran', translator: 'Dr. Mustafa Khattab' } as const;

/**
 * A client over a `fetch` that records every call, so a test can assert the **URL actually built**.
 *
 * `routeFor` returning the right query object and the transport sending it are two different claims,
 * and only the second one is what the vendor sees.
 */
function recordingVendor() {
  const fetchImpl = recordingFetch((call) => {
    if (call.url.startsWith(QF_OAUTH_ORIGIN)) {
      return tokenResponse();
    }
    if (call.url.includes('/resources/translations')) {
      return jsonResponse(CATALOGUE_BODY);
    }
    return jsonResponse(LIVE_PAGE);
  });

  return {
    calls: fetchImpl.calls,
    client: createQuranFoundationClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      tokenTimeoutMs: 1_000,
      clock: fakeClock(),
      fetchImpl,
    }),
  };
}

function tokenResponse(): Response {
  return jsonResponse({
    access_token: syntheticToken('attribution'),
    token_type: 'bearer',
    expires_in: 3600,
    scope: 'content',
  });
}

/**
 * A vendor that answers content and catalogue independently, and counts what was asked of it.
 *
 * `catalogue` is a thunk so a test can make the catalogue fail on the first call and succeed on the
 * second — which is what distinguishes "the cache is doing its job" from "it happened to work".
 */
function vendor(options: {
  readonly catalogue: () => Response | 'fail';
  readonly content?: () => Response;
}) {
  const calls = { token: 0, content: 0, catalogue: 0 };
  const fetchImpl = ((url: string | URL | Request): Promise<Response> => {
    const href = String(url);
    if (href.startsWith(QF_OAUTH_ORIGIN)) {
      calls.token += 1;
      return Promise.resolve(tokenResponse());
    }
    if (href.includes('/resources/translations')) {
      calls.catalogue += 1;
      const answer = options.catalogue();
      return answer === 'fail' ? Promise.reject(new TypeError('network')) : Promise.resolve(answer);
    }
    calls.content += 1;
    return Promise.resolve((options.content ?? (() => jsonResponse(LIVE_PAGE)))());
  }) as unknown as typeof fetch;

  return {
    calls,
    client: createQuranFoundationClient({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      tokenTimeoutMs: 1_000,
      clock: fakeClock(),
      fetchImpl,
    }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The client: what the catalogue did is now a fact the caller can read
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('a catalogue that cannot be reached is reported as such, not as a fetch that happened', async () => {
  /**
   * The heart of the diagnosis. `catalogueFetched` is `true` here — a fetch *was* attempted — and it
   * was `true` on the successful path too, which is why the two were indistinguishable in the log.
   * `catalogueOutcome` is what separates them.
   */
  const { client, calls } = vendor({ catalogue: () => 'fail' });
  const result = await client.read(TRANSLATIONS, neverAborted());

  assertEquals(result.kind, 'ok', 'the vendor answered the content read perfectly well');
  assertEquals(result.catalogueFetched, true, 'the misleading field still says a fetch happened');
  assertEquals(result.catalogueOutcome, 'unreachable', 'and this one says it failed');
  assertEquals(result.attribution, undefined, 'so there is nobody to credit');
  assertEquals(calls.content, 1, 'the content read was not retried for a catalogue failure');
});

Deno.test('a catalogue that does not list the requested edition is distinct from one that failed', async () => {
  /**
   * Both produce no attribution and both used to log identically. They need different remedies: an
   * edition the catalogue has stopped listing is a *product* problem the user can act on by choosing
   * another translation, and a catalogue that will not load is an operational one.
   */
  const { client } = vendor({ catalogue: () => jsonResponse({ translations: [] }) });
  const result = await client.read(TRANSLATIONS, neverAborted());

  assertEquals(result.catalogueOutcome, 'fetched_miss');
  assertEquals(result.attribution, undefined);
});

Deno.test('a resolved edition reports a hit, and the second read is served from cache', async () => {
  const { client, calls } = vendor({ catalogue: () => jsonResponse(CATALOGUE_BODY) });

  const first = await client.read(TRANSLATIONS, neverAborted());
  assertEquals(first.catalogueOutcome, 'fetched_hit');
  assertEquals(first.attribution?.title, 'The Clear Quran');
  assertEquals(first.attribution?.translator, 'Dr. Mustafa Khattab');

  const second = await client.read(TRANSLATIONS, neverAborted());
  assertEquals(second.catalogueOutcome, 'cached_hit', 'the warm path, which always worked');
  assertEquals(second.catalogueFetched, false);
  assertEquals(calls.catalogue, 1, 'the catalogue is read once per isolate per day');
});

Deno.test('a catalogue failure does not poison the cache for the next request', async () => {
  /**
   * The failure is not remembered as an answer. A transient network fault on a cold isolate must not
   * turn into a translation outage that lasts until the isolate is recycled.
   */
  let attempt = 0;
  const { client } = vendor({
    catalogue: () => {
      attempt += 1;
      return attempt === 1 ? 'fail' : jsonResponse(CATALOGUE_BODY);
    },
  });

  assertEquals((await client.read(TRANSLATIONS, neverAborted())).catalogueOutcome, 'unreachable');
  assertEquals((await client.read(TRANSLATIONS, neverAborted())).catalogueOutcome, 'fetched_hit');
});

Deno.test('the catalogue read runs beside the content read, not after it', async () => {
  /**
   * ── The behavioural fix, asserted on ordering rather than on wall-clock ─────
   * The sequential version could not start the catalogue request until the content response had
   * resolved, so the catalogue only ever got what was left of the shared deadline. Holding the
   * content response open and observing that the catalogue request has *already been issued* is what
   * proves the two now overlap — a timing assertion would prove only that this machine was fast.
   */
  const issued: string[] = [];
  const held = Promise.withResolvers<void>();

  const fetchImpl = (async (url: string | URL | Request): Promise<Response> => {
    const href = String(url);
    if (href.startsWith(QF_OAUTH_ORIGIN)) {
      return tokenResponse();
    }
    if (href.includes('/resources/translations')) {
      issued.push('catalogue');
      return jsonResponse(CATALOGUE_BODY);
    }
    issued.push('content');
    await held.promise;
    return jsonResponse(LIVE_PAGE);
  }) as unknown as typeof fetch;

  const client = createQuranFoundationClient({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    tokenTimeoutMs: 1_000,
    clock: fakeClock(),
    fetchImpl,
  });

  const pending = client.read(TRANSLATIONS, neverAborted());

  // Let the two requests reach the transport, with the content response still held open.
  for (let tick = 0; tick < 20; tick += 1) {
    await Promise.resolve();
  }
  assert(
    issued.includes('catalogue'),
    'the catalogue request was issued while the content response was still outstanding',
  );

  held.resolve();
  const result = await pending;
  assertEquals(result.catalogueOutcome, 'fetched_hit');
  assertEquals(result.attribution?.translator, 'Dr. Mustafa Khattab');
});

// ─────────────────────────────────────────────────────────────────────────────
// The handler: the failure is now legible in the one line it emits
// ─────────────────────────────────────────────────────────────────────────────

/** An upstream that answers a valid live page with whatever attribution state a test wants. */
function upstreamAnswering(result: Omit<UpstreamResult, 'kind'>): QuranUpstream {
  return {
    // deno-lint-ignore require-await
    read: async () => ({ kind: 'ok', body: LIVE_PAGE, ...result } as UpstreamResult),
  };
}

function translationRequest(): Request {
  return jsonRequest({
    contract_version: 1,
    operation: 'list_verse_translations',
    surah: 18,
    translation_id: 131,
    page: 1,
    per_page: 20,
  });
}

Deno.test('an unreachable catalogue produces a 502 that says exactly why', async () => {
  /**
   * The whole defect, end to end, in one log line. Before the reason existed this record read
   * `upstream_outcome: ok, catalogue_fetched: true, error_code: upstream_unavailable` — three fields
   * that together suggested the vendor had sent something malformed. It had not.
   */
  const logger = recordingLogger();
  const handler = createQuranContentHandler(
    dependencies({
      verifier: acceptingVerifier(),
      upstream: upstreamAnswering({
        attempts: 1,
        tokenRenewed: false,
        catalogueFetched: true,
        catalogueOutcome: 'unreachable',
      }),
      logger,
    }),
  );

  const response = await handler(translationRequest());
  assertEquals(response.status, 502);

  const entry = logger.entries[0];
  assert(entry !== undefined, 'one line was emitted');
  assertEquals(entry.upstream_outcome, 'ok', 'the vendor answered');
  assertEquals(entry.error_code, 'upstream_unavailable');
  assertEquals(entry.normalize_reason, 'attribution', 'and this is the check that refused it');
  assertEquals(entry.catalogue_outcome, 'unreachable', 'and this is why that check had nothing');
});

Deno.test('the same page succeeds the moment an attribution is available', async () => {
  /**
   * The control for the test above: nothing about the body changes, and the response is a `200`.
   * That is what makes the failure a NoorLife-side one rather than a vendor-side one, and it is the
   * assertion that would have redirected the original investigation on day one.
   */
  const logger = recordingLogger();
  const handler = createQuranContentHandler(
    dependencies({
      verifier: acceptingVerifier(),
      upstream: upstreamAnswering({
        attempts: 1,
        tokenRenewed: false,
        catalogueFetched: true,
        catalogueOutcome: 'fetched_hit',
        attribution: { title: 'The Clear Quran', translator: 'Dr. Mustafa Khattab' },
      }),
      logger,
    }),
  );

  const response = await handler(translationRequest());
  assertEquals(response.status, 200);

  const body = await response.json();
  assertEquals(body.data.source.edition, 'The Clear Quran');
  assertEquals(body.data.source.attribution, 'Dr. Mustafa Khattab');
  assertEquals(body.data.translations.length, 2);

  const entry = logger.entries[0];
  assert(entry !== undefined, 'one line was emitted');
  assertEquals(entry.normalize_reason, null, 'nothing refused it');
  assertEquals(entry.catalogue_outcome, 'fetched_hit');
});

Deno.test('fail-closed attribution is unchanged — the fix is to the lookup, not to the rule', () => {
  /**
   * Stated as a test because it is the thing most at risk of being "fixed" the wrong way. The
   * tempting repair is to let an unattributed page through, or to substitute a placeholder credit.
   * Both would put NoorLife's guess where a translator's name belongs, next to scripture.
   *
   * The rule stays: rows to render and nobody to credit is a refusal. What changed is that the
   * lookup which supplies the credit now gets its own deadline, does not depend on a warm isolate,
   * and reports its own failure — so the refusal becomes rare *and* explicable, rather than being
   * relaxed.
   */
  const source = new URL('../normalize.ts', import.meta.url);
  /**
   * Comments are stripped before the scan.
   *
   * The prose in `normalize.ts` explains at length why inventing a placeholder attribution would be
   * wrong, and it names the words it is warning against. A scan over the raw file therefore matches
   * the warning and reports it as the defect — which is how the first version of this test failed.
   * What is being asserted is a property of the **code**, so the code is what is read.
   */
  const code = Deno.readTextFileSync(source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  assert(
    code.includes("return rejected('attribution');"),
    'the unattributed-rows branch still refuses',
  );
  assert(
    code.includes('if (source === null)'),
    'the refusal is still reached from a null resolved source, not from a substituted one',
  );
  for (const forbidden of ['Unknown', 'Anonymous', 'Various', 'Placeholder', 'Unattributed']) {
    assertEquals(
      code.includes(forbidden),
      false,
      `no placeholder attribution was introduced: ${forbidden}`,
    );
  }
});

// ---------------------------------------------------------------------------
// The `fields` parameter: the second production 502, and the request that fixes it
// ---------------------------------------------------------------------------

/**
 * The defect the deployed diagnostics caught, and the request-side fix for it.
 *
 * Once the attribution failure was closed, production showed a *different* line for the same
 * operation:
 *
 *     operation: list_verse_translations   http_status: 502
 *     upstream_outcome: ok                 upstream_attempts: 1
 *     catalogue_outcome: fetched_hit       normalize_reason: verse_key
 *
 * Every part of that record is a fact rather than a guess, and together they exonerate everything
 * except the request: the vendor answered, one attempt, the catalogue resolved the edition, and the
 * check that refused the body was the **verse-key** one. `GET /translations/{id}/by_chapter/{n}`
 * makes `verse_key` optional and omits it by default, and the client was sending only `page` and
 * `per_page`.
 *
 * That is the whole value of the reason enum: this 502 and the attribution one were byte-identical
 * in the log before it existed, and they have entirely different causes and fixes.
 */

Deno.test('the translations request asks for the optional fields the normaliser requires', () => {
  const route = routeFor(TRANSLATIONS);

  assertEquals(route.path, '/translations/131/by_chapter/18');
  assertEquals(
    route.query.fields,
    'verse_key,resource_name,language_name',
    'verse_key binds a translation to its ayah and is omitted unless asked for',
  );
  assertEquals(TRANSLATION_FIELDS, 'verse_key,resource_name,language_name');
  assertEquals(route.query.page, '1');
  assertEquals(route.query.per_page, '20');
});

Deno.test('the fields parameter actually reaches the wire, not just the route table', async () => {
  /**
   * Asserted against the URL the transport was handed rather than against `routeFor`'s return
   * value. A route table that is right while the query string is dropped somewhere between it and
   * `fetch` would satisfy the test above and still ship the defect.
   */
  const recorder = recordingVendor();
  await recorder.client.read(TRANSLATIONS, neverAborted());

  const contentCall = recorder.calls.find((call) =>
    call.url.includes('/translations/131/by_chapter/18')
  );
  assert(contentCall !== undefined, 'the content request was issued');
  const query = new URL(contentCall.url).searchParams;
  assertEquals(query.get('fields'), 'verse_key,resource_name,language_name');
  assertEquals(query.get('page'), '1');
  assertEquals(query.get('per_page'), '20');
});

Deno.test('no other route gained a fields parameter it does not need', () => {
  // The verse routes keep `text_uthmani` alone, and the catalogues take none.
  assertEquals(routeFor({ operation: 'list_translation_resources' }).query.fields, undefined);
  assertEquals(routeFor({ operation: 'list_recitation_resources' }).query.fields, undefined);
  assertEquals(
    routeFor({ operation: 'list_verses', surah: 18, page: 1, perPage: 20 }).query.fields,
    'text_uthmani',
  );
});

Deno.test('a live-shaped page carrying verse_key normalises, and one without it still refuses', () => {
  /**
   * The before and after, side by side. The only difference between these two bodies is the field
   * the request now asks for.
   */
  const withKey = {
    translations: [
      { resource_id: 131, verse_key: '18:1', text: 'All praise is for Allah.' },
      { resource_id: 131, verse_key: '18:2', text: 'A statement of the truth.' },
    ],
    pagination: { per_page: 20, current_page: 1, next_page: 2, total_pages: 6, total_records: 110 },
  };
  const page = normalizeTranslations(withKey, 18, 131, CATALOGUE_PAIR);
  assert(page.ok, 'the page normalises once verse_key is present');
  assertEquals(page.value.translations[0]?.ayah, 1);
  assertEquals(page.value.translations[1]?.ayah, 2);
  assertEquals(page.value.source.attribution, 'Dr. Mustafa Khattab');

  /**
   * And the check is **not** relaxed. Deriving the ayah from the row's index would have made this
   * body "work", and would have bound every translation to a position rather than to a verse — a
   * silent misalignment with no error state, which is the one failure mode worse than a 502.
   */
  const withoutKey = {
    translations: [
      { resource_id: 131, text: 'All praise is for Allah.' },
      { resource_id: 131, text: 'A statement of the truth.' },
    ],
    pagination: { per_page: 20, current_page: 1, next_page: 2, total_pages: 6, total_records: 110 },
  };
  const refused = normalizeTranslations(withoutKey, 18, 131, CATALOGUE_PAIR);
  assert(!refused.ok, 'a row with no verse key is still refused');
  assertEquals(refused.reason, 'verse_key', 'and reports the same reason production showed');
});

Deno.test('a verse key naming another surah is still refused after the fix', () => {
  const wrongSurah = {
    translations: [{ resource_id: 131, verse_key: '19:1', text: 'From a different surah.' }],
    pagination: {
      per_page: 20,
      current_page: 1,
      next_page: null,
      total_pages: 1,
      total_records: 1,
    },
  };
  const refused = normalizeTranslations(wrongSurah, 18, 131, CATALOGUE_PAIR);
  assert(!refused.ok, 'a key for another surah cannot be rendered as this one');
  assertEquals(refused.reason, 'verse_key');

  // An unparseable key is refused on the same check rather than coerced into something.
  const garbled = {
    translations: [{ resource_id: 131, verse_key: 'eighteen:one', text: 'x' }],
    pagination: {
      per_page: 20,
      current_page: 1,
      next_page: null,
      total_pages: 1,
      total_records: 1,
    },
  };
  const alsoRefused = normalizeTranslations(garbled, 18, 131, CATALOGUE_PAIR);
  assert(!alsoRefused.ok, 'an unparseable key is not repaired');
  assertEquals(alsoRefused.reason, 'verse_key');
});

Deno.test('asking for resource_name does not make attribution depend on it', () => {
  /**
   * The request now asks for `resource_name`, and the vendor may still omit it — it is optional in
   * the schema and absent on this route in practice. Attribution must keep resolving from the
   * catalogue, exactly as it did before, or this fix would have quietly reintroduced the *first*
   * production 502 while closing the second.
   */
  const liveShape = {
    translations: [{ resource_id: 131, verse_key: '18:1', text: 'All praise is for Allah.' }],
    pagination: {
      per_page: 20,
      current_page: 1,
      next_page: null,
      total_pages: 1,
      total_records: 1,
    },
  };
  const page = normalizeTranslations(liveShape, 18, 131, CATALOGUE_PAIR);
  assert(page.ok, 'no resource_name, and the page still normalises');
  assertEquals(page.value.source.edition, 'The Clear Quran');
  assertEquals(page.value.source.attribution, 'Dr. Mustafa Khattab');

  // And with no catalogue either, it still fails closed rather than rendering unattributed.
  const unattributed = normalizeTranslations(liveShape, 18, 131, undefined);
  assert(!unattributed.ok, 'nobody to credit is still a refusal');
  assertEquals(unattributed.reason, 'attribution');
});

Deno.test('the credential and retry properties are untouched by the fields change', async () => {
  /**
   * The request grew a query parameter. Nothing about *how* it authenticates moved, and this asserts
   * that rather than assuming it: the two documented headers, no `Authorization` on the content hop,
   * no caller token forwarded anywhere, and one attempt for a clean `200`.
   */
  const recorder = recordingVendor();
  const result = await recorder.client.read(TRANSLATIONS, neverAborted());

  assertEquals(result.kind, 'ok');
  assertEquals(result.attempts, 1, 'a clean 200 is one attempt');
  assertEquals(result.tokenRenewed, false);

  const contentCall = recorder.calls.find((call) =>
    call.url.includes('/translations/131/by_chapter/18')
  );
  assert(contentCall !== undefined, 'the content request was issued');
  assertEquals(contentCall.headers['x-client-id'], CLIENT_ID);
  assert(
    typeof contentCall.headers['x-auth-token'] === 'string' &&
      contentCall.headers['x-auth-token'].length > 0,
    'the vendor token header is present',
  );
  assertEquals(
    contentCall.headers['authorization'],
    undefined,
    'the content hop carries no Authorization header',
  );
  assertEquals(contentCall.redirect, 'error', 'redirects are still refused');

  // The client secret appears nowhere on the content hop, in any URL or any header.
  for (const call of recorder.calls) {
    assertEquals(call.url.includes(CLIENT_SECRET), false, 'no secret in any URL');
    for (const value of Object.values(call.headers)) {
      assertEquals(String(value).includes(CLIENT_SECRET), false, 'no secret in any header');
    }
  }
});
