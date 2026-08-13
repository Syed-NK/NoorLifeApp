import { assert, assertEquals } from './assert.ts';
import {
  createQuranFoundationClient,
  MAX_RETRY_AFTER_SECONDS,
  QF_API_ORIGIN,
  QF_CONTENT_PREFIX,
  routeFor,
  unconfiguredUpstream,
} from '../quran-foundation-client.ts';
import { QF_OAUTH_ORIGIN } from '../token-store.ts';
import type { QuranQuery } from '../ports.ts';
import {
  fakeClock,
  forbiddenFetch,
  jsonResponse,
  recordingFetch,
  syntheticToken,
} from './fakes.ts';

/**
 * The upstream client: one retry after a `401`, never a loop, and seven fixed routes.
 *
 * The retry rule is the reason this file exists. "At most one retry" is easy to write and easy to
 * turn into a loop by accident, so it is asserted three ways: by counting content requests, by
 * counting token exchanges, and by driving a vendor that refuses **every** attempt and watching the
 * client stop at two.
 */

const CLIENT_ID = 'synthetic-client-id-for-tests';
const CLIENT_SECRET = 'synthetic-client-secret-for-tests';
const CHAPTERS: QuranQuery = { operation: 'list_chapters' };

function neverAborted(): AbortSignal {
  return new AbortController().signal;
}

function isTokenCall(url: string): boolean {
  return url.startsWith(QF_OAUTH_ORIGIN);
}

function tokenResponse(marker: string): Response {
  return jsonResponse({
    access_token: syntheticToken(marker),
    token_type: 'bearer',
    expires_in: 3600,
    scope: 'content',
  });
}

function clientWith(fetchImpl: typeof fetch) {
  return createQuranFoundationClient({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    tokenTimeoutMs: 1_000,
    clock: fakeClock(),
    fetchImpl,
  });
}

Deno.test('missing credentials make no request of any kind', async () => {
  for (
    const [clientId, clientSecret] of [
      [undefined, undefined],
      [CLIENT_ID, undefined],
      [undefined, CLIENT_SECRET],
    ] as const
  ) {
    const client = createQuranFoundationClient({
      clientId,
      clientSecret,
      tokenTimeoutMs: 1_000,
      clock: fakeClock(),
      fetchImpl: forbiddenFetch(),
    });
    const result = await client.read(CHAPTERS, neverAborted());
    assertEquals(result.kind, 'unconfigured');
    assertEquals(result.attempts, 0, 'nothing left the process');
    assertEquals(result.tokenRenewed, false);
  }

  const bare = await unconfiguredUpstream.read(CHAPTERS, neverAborted());
  assertEquals(bare, { kind: 'unconfigured', attempts: 0, tokenRenewed: false });
});

Deno.test('a successful read sends both required headers and no caller credential', async () => {
  const call = recordingFetch((request) =>
    isTokenCall(request.url) ? tokenResponse('ok') : jsonResponse({ chapters: [] })
  );

  const result = await clientWith(call).read(CHAPTERS, neverAborted());
  assertEquals(result.kind, 'ok');
  assertEquals(result.attempts, 1);
  assertEquals(result.tokenRenewed, false);

  const content = call.calls.find((request) => !isTokenCall(request.url));
  assert(content !== undefined, 'a content request was made');
  assertEquals(content.method, 'GET');
  assertEquals(content.headers['x-auth-token'], syntheticToken('ok'));
  assertEquals(content.headers['x-client-id'], CLIENT_ID);
  assertEquals(content.redirect, 'error');
  /**
   * There is no `Authorization` on the content hop at all — the vendor's schemes are the two headers
   * above — and in particular the caller's own bearer token is never forwarded. This request
   * authenticates as NoorLife; the vendor is told nothing about who asked.
   */
  assertEquals(content.headers['authorization'], undefined);
  assertEquals(content.headers['x-auth-token']?.includes(CLIENT_SECRET) ?? true, false);
});

Deno.test('a 401 buys exactly one fresh token and exactly one retry', async () => {
  let contentCalls = 0;
  const call = recordingFetch((request) => {
    if (isTokenCall(request.url)) {
      return tokenResponse(`gen${call.calls.filter((c) => isTokenCall(c.url)).length}`);
    }
    contentCalls += 1;
    return contentCalls === 1 ? jsonResponse({}, 401) : jsonResponse({ chapters: [] });
  });

  const result = await clientWith(call).read(CHAPTERS, neverAborted());

  assertEquals(result.kind, 'ok', 'the retry succeeded');
  assertEquals(result.attempts, 2);
  assertEquals(result.tokenRenewed, true);
  assertEquals(contentCalls, 2, 'two content requests, not three');
  assertEquals(
    call.calls.filter((request) => isTokenCall(request.url)).length,
    2,
    'two token exchanges: the initial one and the single renewal',
  );

  // And the retry actually presented a different token.
  const contentRequests = call.calls.filter((request) => !isTokenCall(request.url));
  assert(
    contentRequests[0]?.headers['x-auth-token'] !== contentRequests[1]?.headers['x-auth-token'],
    'the retry presented a different token',
  );
});

Deno.test('a 403 is retried once on the same rule as a 401', async () => {
  let contentCalls = 0;
  const call = recordingFetch((request) => {
    if (isTokenCall(request.url)) {
      return tokenResponse('renewed');
    }
    contentCalls += 1;
    return contentCalls === 1 ? jsonResponse({}, 403) : jsonResponse({ chapters: [] });
  });

  const result = await clientWith(call).read(CHAPTERS, neverAborted());
  assertEquals(result.kind, 'ok');
  assertEquals(contentCalls, 2);
});

Deno.test('a vendor that refuses every attempt stops at two — there is no retry loop', async () => {
  /**
   * The loop test. If the retry were expressed as a `while` or a recursion, this vendor would be
   * called forever; the assertion is that the client makes exactly two content requests and then
   * reports the credential as refused.
   */
  let contentCalls = 0;
  const call = recordingFetch((request) => {
    if (isTokenCall(request.url)) {
      return tokenResponse(`gen${contentCalls}`);
    }
    contentCalls += 1;
    return jsonResponse({}, 401);
  });

  const result = await clientWith(call).read(CHAPTERS, neverAborted());

  assertEquals(result.kind, 'unauthorized');
  assertEquals(result.attempts, 2);
  assertEquals(contentCalls, 2, 'never a third attempt');
});

Deno.test('nothing except a 401 or 403 is retried', async () => {
  /**
   * The retry allowance exists for a token that was not accepted. It is not a general "try harder"
   * budget, and spending a second vendor request on a `404` or a `500` would be exactly that.
   */
  const cases: readonly [number, string][] = [
    [404, 'not-found'],
    [429, 'rate-limited'],
    [500, 'transient'],
    [502, 'transient'],
    [503, 'transient'],
    [504, 'transient'],
    [408, 'transient'],
    [400, 'malformed'],
    [422, 'malformed'],
    [418, 'malformed'],
  ];

  for (const [status, expected] of cases) {
    let contentCalls = 0;
    const call = recordingFetch((request) => {
      if (isTokenCall(request.url)) {
        return tokenResponse('once');
      }
      contentCalls += 1;
      return jsonResponse({ error: 'must not be forwarded' }, status);
    });

    const result = await clientWith(call).read(CHAPTERS, neverAborted());
    assertEquals(result.kind, expected, `status ${status}`);
    assertEquals(contentCalls, 1, `status ${status} was not retried`);
    assertEquals(result.attempts, 1);
    assertEquals(result.tokenRenewed, false);
  }
});

Deno.test('a rejected credential at the token endpoint is not retried at the content endpoint', async () => {
  const call = recordingFetch((request) =>
    isTokenCall(request.url) ? jsonResponse({ error: 'invalid_client' }, 401) : jsonResponse({})
  );

  const result = await clientWith(call).read(CHAPTERS, neverAborted());

  assertEquals(result.kind, 'unauthorized');
  assertEquals(
    call.calls.some((request) => !isTokenCall(request.url)),
    false,
    'no content request was made with a credential that was already refused',
  );
  /**
   * And the reported count says so. `attempts` means "content requests issued", so a failure at the
   * token step must report zero — otherwise the one number an operator uses to see vendor load would
   * be counting requests that never happened.
   */
  assertEquals(result.attempts, 0, 'nothing reached the content host');
  assertEquals(result.tokenRenewed, false);
});

Deno.test('a Retry-After is passed on as a bounded number, or not at all', async () => {
  const cases: readonly [string | null, number | null][] = [
    ['30', 30],
    ['0', 0],
    [String(MAX_RETRY_AFTER_SECONDS), MAX_RETRY_AFTER_SECONDS],
    [String(MAX_RETRY_AFTER_SECONDS + 1), null],
    ['-5', null],
    ['1.5', null],
    ['Wed, 21 Oct 2026 07:28:00 GMT', null],
    ['99999999999', null],
    [null, null],
  ];

  for (const [header, expected] of cases) {
    const call = recordingFetch((request) =>
      isTokenCall(request.url) ? tokenResponse('rl') : new Response('{}', {
        status: 429,
        headers: header === null ? {} : { 'retry-after': header },
      })
    );
    const result = await clientWith(call).read(CHAPTERS, neverAborted());
    assert(result.kind === 'rate-limited', `rate limited, header ${String(header)}`);
    assertEquals(result.retryAfterSeconds, expected, String(header));
  }
});

Deno.test('a body that is not JSON is malformed rather than passed through', async () => {
  const call = recordingFetch((request) =>
    isTokenCall(request.url) ? tokenResponse('html') : new Response('<html>proxy error</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })
  );
  assertEquals((await clientWith(call).read(CHAPTERS, neverAborted())).kind, 'malformed');
});

Deno.test('an over-large body is refused without being read into memory', async () => {
  const call = recordingFetch((request) =>
    isTokenCall(request.url) ? tokenResponse('big') : new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'content-length': '99999999' },
    })
  );
  assertEquals((await clientWith(call).read(CHAPTERS, neverAborted())).kind, 'malformed');
});

Deno.test('an aborted request is a timeout, and a dropped connection is transient', async () => {
  const controller = new AbortController();
  const aborting = recordingFetch((request) => {
    if (isTokenCall(request.url)) {
      return tokenResponse('abort');
    }
    controller.abort();
    throw new Error('The signal has been aborted');
  });
  assertEquals((await clientWith(aborting).read(CHAPTERS, controller.signal)).kind, 'timeout');

  const dropped = recordingFetch((request) => {
    if (isTokenCall(request.url)) {
      return tokenResponse('reset');
    }
    throw new Error('connection reset by peer');
  });
  assertEquals((await clientWith(dropped).read(CHAPTERS, neverAborted())).kind, 'transient');
});

Deno.test('a token exchange failure never reaches the content host', async () => {
  const call = recordingFetch((request) => {
    if (isTokenCall(request.url)) {
      throw new Error('dns failure');
    }
    throw new Error('a content request must not have been attempted');
  });

  const result = await clientWith(call).read(CHAPTERS, neverAborted());
  assertEquals(result.kind, 'transient');
  assertEquals(call.calls.filter((request) => !isTokenCall(request.url)).length, 0);
  assertEquals(result.attempts, 0, 'and the count agrees that nothing was issued');
});

Deno.test('a retry that cannot get a token counts one attempt, not two', async () => {
  /**
   * The first attempt reached the content host and was refused; the renewal then failed before a
   * second request could be built. Reporting two would claim a vendor request that never happened.
   */
  let tokenCalls = 0;
  const call = recordingFetch((request) => {
    if (isTokenCall(request.url)) {
      tokenCalls += 1;
      return tokenCalls === 1
        ? tokenResponse('first')
        : jsonResponse({ error: 'server_error' }, 503);
    }
    return jsonResponse({}, 401);
  });

  const result = await clientWith(call).read(CHAPTERS, neverAborted());

  assertEquals(result.kind, 'transient');
  assertEquals(result.attempts, 1);
  assertEquals(result.tokenRenewed, true, 'a renewal was attempted, which is the operator signal');
  assertEquals(call.calls.filter((request) => !isTokenCall(request.url)).length, 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// The route table — the whole of this function's reach
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('every route is a fixed template under the approved content prefix', () => {
  const queries: readonly QuranQuery[] = [
    { operation: 'list_chapters' },
    { operation: 'get_chapter', surah: 18 },
    { operation: 'list_verses', surah: 18, page: 2, perPage: 50 },
    { operation: 'list_verse_translations', surah: 18, translationId: 131, page: 1, perPage: 20 },
    { operation: 'get_verse', surah: 94, ayah: 6, translationId: 131 },
    { operation: 'get_verse', surah: 94, ayah: 6, translationId: null },
    { operation: 'list_translation_resources' },
    { operation: 'list_recitation_resources' },
  ];

  const paths = queries.map((query) => routeFor(query).path);
  assertEquals(paths, [
    '/chapters',
    '/chapters/18',
    '/verses/by_chapter/18',
    '/translations/131/by_chapter/18',
    '/verses/by_key/94:6',
    '/verses/by_key/94:6',
    '/resources/translations',
    '/resources/recitations',
  ]);

  for (const path of paths) {
    assertEquals(path.includes('..'), false, 'no traversal is expressible');
    assertEquals(/^[/a-z_0-9:]+$/.test(path), true, `${path} is literals and integers only`);
  }
});

Deno.test('no route reaches search, a user API or content sync', async () => {
  /**
   * The scope boundary, asserted against the URLs that are actually built. Search and the user APIs
   * are not approved, and the assertion is that no approved operation's URL can be mistaken for one.
   */
  const call = recordingFetch((request) =>
    isTokenCall(request.url) ? tokenResponse('scope') : jsonResponse({ chapters: [] })
  );
  const client = clientWith(call);

  for (
    const query of [
      { operation: 'list_chapters' },
      { operation: 'get_chapter', surah: 1 },
      { operation: 'list_verses', surah: 1, page: 1, perPage: 10 },
      { operation: 'list_verse_translations', surah: 1, translationId: 131, page: 1, perPage: 10 },
      { operation: 'get_verse', surah: 1, ayah: 1, translationId: null },
      { operation: 'list_translation_resources' },
      { operation: 'list_recitation_resources' },
    ] as const
  ) {
    await client.read(query, neverAborted());
  }

  for (const request of call.calls.filter((entry) => !isTokenCall(entry.url))) {
    assert(
      request.url.startsWith(`${QF_API_ORIGIN}${QF_CONTENT_PREFIX}/`),
      `${request.url} is under the approved content prefix`,
    );
    for (
      const forbidden of [
        '/search',
        '/bookmarks',
        '/notes',
        '/reading_sessions',
        '/collections',
        '/resources/sync',
        '/resources/snapshots',
        '/quran-reflect',
        '/tafsirs',
      ]
    ) {
      assertEquals(request.url.includes(forbidden), false, `${request.url} avoids ${forbidden}`);
    }
  }
});

Deno.test('verse routes ask for the Uthmani text and refuse word-by-word data', async () => {
  /**
   * The vendor omits Arabic unless `fields` asks for it, so a missing parameter would produce verses
   * with no scripture. `words=false` is sent explicitly because word-level data carries
   * transliteration, and transliteration arriving alongside scripture is the payload that must never
   * be able to stand in for it.
   */
  const call = recordingFetch((request) =>
    isTokenCall(request.url) ? tokenResponse('fields') : jsonResponse({ verses: [] })
  );
  const client = clientWith(call);

  await client.read({ operation: 'list_verses', surah: 18, page: 1, perPage: 20 }, neverAborted());
  await client.read(
    { operation: 'get_verse', surah: 94, ayah: 6, translationId: 131 },
    neverAborted(),
  );

  /**
   * Verse routes only. A translated read also fetches the edition catalogue to resolve attribution,
   * and that route neither has nor should have `fields` — narrowing here keeps the assertion about
   * scripture requests rather than quietly passing on whatever else happens to be recorded.
   */
  const verseCalls = call.calls.filter((entry) =>
    !isTokenCall(entry.url) && new URL(entry.url).pathname.includes('/verses/')
  );
  assertEquals(verseCalls.length, 2, 'both verse reads were recorded');

  for (const request of verseCalls) {
    const url = new URL(request.url);
    assertEquals(url.searchParams.get('fields'), 'text_uthmani');
    assertEquals(url.searchParams.get('words'), 'false');
    assertEquals(url.searchParams.get('audio'), null, 'no audio file is requested');
    assertEquals(url.searchParams.get('tafsirs'), null, 'no tafsir is requested');
  }

  const daily = verseCalls[1];
  assert(daily !== undefined, 'the daily-verse request was recorded');
  assertEquals(new URL(daily.url).searchParams.get('translations'), '131');
});

Deno.test('paging travels as the vendor’s own parameters', async () => {
  const call = recordingFetch((request) =>
    isTokenCall(request.url) ? tokenResponse('paging') : jsonResponse({ verses: [] })
  );
  await clientWith(call).read(
    { operation: 'list_verses', surah: 2, page: 4, perPage: 50 },
    neverAborted(),
  );

  const content = call.calls.find((request) => !isTokenCall(request.url));
  assert(content !== undefined, 'a content request was recorded');
  const params = new URL(content.url).searchParams;
  assertEquals(params.get('page'), '4');
  assertEquals(params.get('per_page'), '50');
});
