import { assert, assertEquals } from './assert.ts';
import { createQuranContentHandler } from '../handler.ts';
import { MAX_BODY_BYTES, QURAN_OPERATIONS } from '../contract.ts';
import { DEFAULT_PAGE, DEFAULT_PER_PAGE } from '../request-schema.ts';
import { dependencies, jsonRequest, recordingLogger, scriptedUpstream } from './fakes.ts';

/**
 * The operation allow-list, input validation, and the claim that no URL can be proxied.
 *
 * Nearly every assertion below is paired with `upstream.queries.length === 0`. That pairing is the
 * point: a rejected request must not merely produce the right status, it must produce **no Quran
 * Foundation request at all**. The vendor's rate limits are NoorLife's to respect, and a malformed
 * request that still costs a call is a malformed request that costs the quota.
 */

/**
 * A minimal but *valid* upstream body.
 *
 * Valid on purpose: a fixture that failed normalisation would turn every accepted request into a
 * `502`, and the assertions below could then no longer tell "the schema accepted it" from "the schema
 * rejected it". A refused request must be a `400`, and an accepted one must be a `200`.
 */
const CHAPTER_BODY = {
  chapters: [
    {
      id: 18,
      revelation_place: 'makkah',
      name_simple: 'Al-Kahf',
      name_arabic: 'الكهف',
      verses_count: 110,
      translated_name: { language_name: 'english', name: 'The Cave' },
    },
  ],
};

function handlerWith() {
  const upstream = scriptedUpstream({
    kind: 'ok',
    body: CHAPTER_BODY,
    attempts: 1,
    tokenRenewed: false,
  });
  const logger = recordingLogger();
  return {
    handle: createQuranContentHandler(dependencies({ upstream, logger })),
    upstream,
    logger,
  };
}

Deno.test('only the seven approved operations are accepted', async () => {
  const { handle, upstream } = handlerWith();

  /**
   * The refused list is the scope boundary written out. `search` and `search_verses` are the Quran
   * Foundation Search APIs; `bookmarks`, `notes` and `reading_sessions` are the user APIs; the rest
   * are the shapes somebody reaches for when trying to turn an operation name into a path.
   */
  for (
    const operation of [
      'search',
      'search_verses',
      'bookmarks',
      'notes',
      'reading_sessions',
      'collections',
      'sync',
      'list_tafsirs',
      'LIST_CHAPTERS',
      'list_chapters ',
      '../chapters',
      '/chapters',
      'https://apis.quran.foundation/content/api/v4/chapters',
      '',
    ]
  ) {
    const response = await handle(jsonRequest({ contract_version: 1, operation }));
    assertEquals(response.status, 400, `refused: ${operation}`);
    const body = await response.json();
    assertEquals(body.error.field, 'operation');
    // The rejected value is never echoed — reflecting an attacker's string is how a reflection
    // becomes something worse.
    assertEquals(JSON.stringify(body).includes('quran.foundation'), false);
  }

  assertEquals(upstream.queries.length, 0, 'none of them reached the vendor');
});

Deno.test('a non-string operation is refused', async () => {
  const { handle, upstream } = handlerWith();
  for (const operation of [1, null, true, ['list_chapters'], { operation: 'list_chapters' }]) {
    assertEquals((await handle(jsonRequest({ contract_version: 1, operation }))).status, 400);
  }
  assertEquals(upstream.queries.length, 0);
});

Deno.test('every approved operation is reachable with a well-formed body', async () => {
  /**
   * The negative control for the test above. A closed allow-list that refused everything would pass
   * it, so this drives one valid request per operation and asserts the query reached the client.
   */
  const bodies: Readonly<Record<string, Record<string, unknown>>> = {
    list_chapters: {},
    get_chapter: { surah: 18 },
    list_verses: { surah: 18 },
    list_verse_translations: { surah: 18, translation_id: 131 },
    get_verse: { surah: 94, verse: 6 },
    list_translation_resources: {},
    list_recitation_resources: {},
    list_verse_recitations: { surah: 18, recitation_id: 1 },
    /*
      Both synchronisation operations take their scope from the server, so the bootstrap case is an
      empty body — which is exactly the point worth driving here: a well-formed sync request names
      no resource at all.
    */
    sync_content_resources: {},
    get_content_snapshot: { resource_group: 'recitations' },
  };

  for (const operation of QURAN_OPERATIONS) {
    const { handle, upstream } = handlerWith();
    await handle(jsonRequest({ contract_version: 1, operation, ...bodies[operation] }));
    assertEquals(upstream.queries.length, 1, operation);
    assertEquals(upstream.queries[0]?.operation, operation);
  }
});

Deno.test('an unknown field is refused by name, and the name is not attacker text', async () => {
  const { handle, upstream, logger } = handlerWith();

  const named = await handle(
    jsonRequest({ contract_version: 1, operation: 'list_chapters', language: 'fr' }),
  );
  assertEquals(named.status, 400);
  assertEquals((await named.json()).error.field, 'language');

  // A field name that is not a conservative identifier is refused *without* being echoed.
  const hostile = await handle(
    jsonRequest({
      contract_version: 1,
      operation: 'list_chapters',
      '<script>alert(1)</script>': true,
    }),
  );
  assertEquals(hostile.status, 400);
  assertEquals((await hostile.json()).error.field, undefined);
  assertEquals(
    JSON.stringify(logger.entries).includes('script'),
    false,
    'and it never reached the log',
  );

  assertEquals(upstream.queries.length, 0);
});

Deno.test('a URL, a path or a host in the body is an unknown field', async () => {
  /**
   * The behavioural half of "this is not an arbitrary upstream proxy". `source-scan_test.ts` asserts
   * the structural half — that `QuranQuery` has no string field a path could occupy, and that the
   * client builds paths only from a fixed table.
   */
  const { handle, upstream } = handlerWith();

  for (
    const field of ['url', 'path', 'endpoint', 'host', 'origin', 'base_url', 'query', 'params']
  ) {
    const response = await handle(
      jsonRequest({
        contract_version: 1,
        operation: 'list_chapters',
        [field]: 'https://example.invalid/anything',
      }),
    );
    assertEquals(response.status, 400, field);
  }
  assertEquals(upstream.queries.length, 0);
});

Deno.test('a field meaningless for the operation is refused rather than ignored', async () => {
  /**
   * A parameter that is accepted and discarded is a parameter a future edit can start honouring
   * without anybody noticing, so `list_chapters` does not quietly swallow a surah.
   */
  const { handle, upstream } = handlerWith();

  assertEquals(
    (await handle(jsonRequest({ contract_version: 1, operation: 'list_chapters', surah: 2 })))
      .status,
    400,
  );
  assertEquals(
    (await handle(jsonRequest({ contract_version: 1, operation: 'get_chapter', page: 2 }))).status,
    400,
  );
  assertEquals(upstream.queries.length, 0);
});

Deno.test('surah numbers are bounded to 1–114 and must be integers', async () => {
  const { handle, upstream } = handlerWith();

  for (const surah of [0, -1, 115, 1000, 1.5, '18', null, true, Number.NaN, Number.MAX_VALUE]) {
    const response = await handle(
      jsonRequest({ contract_version: 1, operation: 'get_chapter', surah }),
    );
    assertEquals(response.status, 400, `refused surah ${String(surah)}`);
    assertEquals((await response.json()).error.field, 'surah');
  }
  assertEquals(upstream.queries.length, 0);

  for (const surah of [1, 18, 114]) {
    const { handle: ok, upstream: reached } = handlerWith();
    await ok(jsonRequest({ contract_version: 1, operation: 'get_chapter', surah }));
    assertEquals(reached.queries.length, 1, `accepted surah ${surah}`);
  }
});

Deno.test('verse numbers are bounded, and a verse beyond the longest surah is refused', async () => {
  const { handle, upstream } = handlerWith();
  for (const verse of [0, -3, 287, 1.5, '6']) {
    assertEquals(
      (await handle(jsonRequest({ contract_version: 1, operation: 'get_verse', surah: 94, verse })))
        .status,
      400,
      String(verse),
    );
  }
  assertEquals(upstream.queries.length, 0);
});

Deno.test('pagination is bounded, and per_page respects the vendor’s documented maximum', async () => {
  const { handle, upstream } = handlerWith();

  for (const page of [0, -1, 501, 2.5, '3']) {
    const response = await handle(
      jsonRequest({ contract_version: 1, operation: 'list_verses', surah: 2, page }),
    );
    assertEquals(response.status, 400, `page ${String(page)}`);
    assertEquals((await response.json()).error.field, 'page');
  }

  for (const perPage of [0, -1, 51, 100, 1000, 10.5, '20']) {
    const response = await handle(
      jsonRequest({ contract_version: 1, operation: 'list_verses', surah: 2, per_page: perPage }),
    );
    assertEquals(response.status, 400, `per_page ${String(perPage)}`);
    assertEquals((await response.json()).error.field, 'per_page');
  }

  assertEquals(upstream.queries.length, 0, 'no out-of-range paging reached the vendor');

  // 50 is the documented ceiling and must be accepted, not clamped.
  const { handle: ok, upstream: reached } = handlerWith();
  await ok(jsonRequest({ contract_version: 1, operation: 'list_verses', surah: 2, per_page: 50 }));
  const query = reached.queries[0];
  assert(query?.operation === 'list_verses', 'the query is a verse listing');
  assertEquals(query.perPage, 50);
});

Deno.test('paging defaults are applied server-side when the client omits them', async () => {
  const { handle, upstream } = handlerWith();
  await handle(jsonRequest({ contract_version: 1, operation: 'list_verses', surah: 18 }));
  const query = upstream.queries[0];
  assert(query?.operation === 'list_verses', 'the query is a verse listing');
  assertEquals(query.page, DEFAULT_PAGE);
  assertEquals(query.perPage, DEFAULT_PER_PAGE);
});

Deno.test('a translation id is required for a translation read, and never defaulted', async () => {
  /**
   * The domain contract's "there is no implicit default translation" rule, enforced on the server
   * where a client cannot bypass it. Answering with *some* edition would attribute a rendering the
   * user did not choose.
   */
  const { handle, upstream } = handlerWith();

  const missing = await handle(
    jsonRequest({ contract_version: 1, operation: 'list_verse_translations', surah: 18 }),
  );
  assertEquals(missing.status, 400);
  assertEquals((await missing.json()).error.field, 'translation_id');

  /**
   * Every string form is refused, including the ones that look like a number.
   *
   * A deployment answered `400` with `error_field: recitation_id` for every audio request because the
   * app sent `"1"` where an integer was required, while `translation_id` quietly accepted the string
   * form. One policy now: the server takes integers, the client converts explicitly before it asks.
   */
  for (
    const id of [
      '131',
      '1',
      '0',
      '01',
      'abc',
      '-5',
      '1e3',
      ' 131',
      '131 ',
      '',
      0,
      -1,
      1.5,
      null,
      Number.NaN,
      Number.MAX_SAFE_INTEGER,
    ]
  ) {
    assertEquals(
      (await handle(
        jsonRequest({
          contract_version: 1,
          operation: 'list_verse_translations',
          surah: 18,
          translation_id: id,
        }),
      )).status,
      400,
      `refused translation_id ${JSON.stringify(id)}`,
    );
  }
  assertEquals(upstream.queries.length, 0);
});

Deno.test('both resource ids take integers, and take them the same way', async () => {
  /**
   * The two fields disagreed once — `translation_id` accepted a digit string, `recitation_id` did
   * not — and the disagreement is what broke audio in production. This pins them to one rule, from
   * both directions: the integer is accepted and reaches the client, the string is not.
   */
  const translations = handlerWith();
  await translations.handle(
    jsonRequest({
      contract_version: 1,
      operation: 'list_verse_translations',
      surah: 18,
      translation_id: 131,
    }),
  );
  const translationQuery = translations.upstream.queries[0];
  assert(
    translationQuery?.operation === 'list_verse_translations',
    'the query is a translation listing',
  );
  assertEquals(translationQuery.translationId, 131);

  const recitations = handlerWith();
  await recitations.handle(
    jsonRequest({
      contract_version: 1,
      operation: 'list_verse_recitations',
      surah: 18,
      recitation_id: 1,
    }),
  );
  const recitationQuery = recitations.upstream.queries[0];
  assert(
    recitationQuery?.operation === 'list_verse_recitations',
    'the query is a recitation listing',
  );
  assertEquals(recitationQuery.recitationId, 1);

  // And the string form that production actually sent is refused by both, reaching no vendor.
  const refused = handlerWith();
  for (
    const body of [
      { operation: 'list_verse_translations', surah: 18, translation_id: '131' },
      { operation: 'list_verse_recitations', surah: 18, recitation_id: '1' },
    ]
  ) {
    const response = await refused.handle(jsonRequest({ contract_version: 1, ...body }));
    assertEquals(response.status, 400, JSON.stringify(body));
  }
  assertEquals(refused.upstream.queries.length, 0, 'no string id reached the vendor');
});

Deno.test('get_verse may omit the translation, and then asks for scripture alone', async () => {
  const { handle, upstream } = handlerWith();
  await handle(jsonRequest({ contract_version: 1, operation: 'get_verse', surah: 94, verse: 6 }));
  const query = upstream.queries[0];
  assert(query?.operation === 'get_verse', 'the query is a single verse');
  assertEquals(query.translationId, null);
});

Deno.test('a mismatched contract version is its own code, and is checked before the operation', async () => {
  const { handle, upstream } = handlerWith();

  const response = await handle(jsonRequest({ contract_version: 2, operation: 'nonsense' }));
  assertEquals(response.status, 400);
  const body = await response.json();
  assertEquals(body.error.code, 'unsupported_contract_version');
  assertEquals(body.error.field, 'contract_version');
  assertEquals(upstream.queries.length, 0);
});

Deno.test('the method, path and media type are checked before anything else', async () => {
  const { handle, upstream } = handlerWith();

  const wrongMethod = await handle(
    jsonRequest({}, { method: 'GET', body: null }),
  );
  assertEquals(wrongMethod.status, 405);
  assertEquals(wrongMethod.headers.get('allow'), 'POST, OPTIONS');

  const deepPath = await handle(
    new Request('https://project.functions.supabase.co/functions/v1/quran-content/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer t.t.t' },
      body: '{}',
    }),
  );
  assertEquals(deepPath.status, 404, 'a path under the function is not a second endpoint');

  const wrongType = await handle(
    jsonRequest({ contract_version: 1, operation: 'list_chapters' }, {
      headers: { 'content-type': 'text/plain', authorization: 'Bearer t.t.t' },
    }),
  );
  assertEquals(wrongType.status, 415);

  assertEquals(upstream.queries.length, 0);
});

Deno.test('a charset parameter on the media type is not a different media type', async () => {
  const { handle, upstream } = handlerWith();
  const response = await handle(
    jsonRequest({ contract_version: 1, operation: 'list_chapters' }, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: 'Bearer t.t.t',
      },
      body: JSON.stringify({ contract_version: 1, operation: 'list_chapters' }),
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(upstream.queries.length, 1);
});

Deno.test('an over-large body is refused, whether or not the header admits it', async () => {
  const { handle, upstream } = handlerWith();

  const oversized = 'x'.repeat(MAX_BODY_BYTES + 64);
  const declared = await handle(
    jsonRequest({}, {
      body: JSON.stringify({ contract_version: 1, operation: 'list_chapters', pad: oversized }),
    }),
  );
  assertEquals(declared.status, 413);

  /**
   * A lying `Content-Length` is the case the second check exists for. The header claims a small body
   * and the stream delivers a large one; the read has to stop on its own.
   */
  const lying = await handle(
    new Request('https://project.functions.supabase.co/functions/v1/quran-content', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer t.t.t',
        'content-length': '10',
      },
      body: oversized,
    }),
  );
  assertEquals(lying.status, 413);

  assertEquals(upstream.queries.length, 0);
});

Deno.test('an unparseable body is a 400 and its bytes are not logged', async () => {
  const { handle, upstream, logger } = handlerWith();

  const response = await handle(
    jsonRequest({}, { body: '{"contract_version": 1, "operation": ' }),
  );
  assertEquals(response.status, 400);
  assertEquals((await response.json()).error.field, 'body');
  assertEquals(JSON.stringify(logger.entries).includes('contract_version": 1'), false);
  assertEquals(upstream.queries.length, 0);
});

Deno.test('an array or a scalar body is not the object the schema describes', async () => {
  const { handle, upstream } = handlerWith();
  for (const body of ['[]', '"list_chapters"', '42', 'null', 'true']) {
    assertEquals((await handle(jsonRequest({}, { body }))).status, 400, body);
  }
  assertEquals(upstream.queries.length, 0);
});
