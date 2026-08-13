import { assert, assertEquals } from './assert.ts';
import { createQuranContentHandler } from '../handler.ts';
import { MAX_CACHE_AGE_MS, OPERATION_CACHE_MAX_AGE_MS, QURAN_OPERATIONS } from '../contract.ts';
import type { UpstreamResult } from '../ports.ts';
import {
  dependencies,
  fakeTimer,
  hangingUpstream,
  jsonRequest,
  recordingLogger,
  scriptedUpstream,
  testConfig,
} from './fakes.ts';

/**
 * Every upstream outcome, mapped to the answer the client sees — and to the answer it must not.
 *
 * Two mappings carry most of the weight. A vendor `401` is **never** a `401` to the caller, because
 * the caller's own session was fine and telling them to sign in again sends them round a loop that
 * cannot help. And an absent credential is `503` with nothing rendered, because the alternative —
 * serving something — is the failure this whole integration exists to prevent.
 */

const LIST = { contract_version: 1, operation: 'list_chapters' };

const CHAPTER_BODY = {
  chapters: [
    {
      id: 18,
      revelation_place: 'makkah',
      revelation_order: 69,
      bismillah_pre: true,
      name_simple: 'Al-Kahf',
      name_complex: 'Al-Kahf',
      name_arabic: 'الكهف',
      verses_count: 110,
      pages: [293, 304],
      translated_name: { language_name: 'english', name: 'The Cave' },
    },
  ],
};

function handlerFor(result: UpstreamResult, timer = fakeTimer()) {
  const upstream = scriptedUpstream(result);
  const logger = recordingLogger();
  return {
    handle: createQuranContentHandler(dependencies({ upstream, logger, timer })),
    upstream,
    logger,
  };
}

Deno.test('a validated upstream body becomes a 200 payload', async () => {
  const { handle } = handlerFor({
    kind: 'ok',
    body: CHAPTER_BODY,
    attempts: 1,
    tokenRenewed: false,
  });

  const response = await handle(jsonRequest(LIST));
  assertEquals(response.status, 200);

  const body = await response.json();
  assertEquals(body.outcome, 'ok');
  assertEquals(body.contract_version, 1);
  assert(String(body.request_id).startsWith('quran_req_'), 'carries a request id');
  assertEquals(body.data.operation, 'list_chapters');
  assertEquals(body.data.chapters[0].number, 18);
  assertEquals(body.data.chapters[0].arabicName, 'الكهف');
});

Deno.test('a 200 body that does not match the documented shape is a 502, not a pass-through', async () => {
  /**
   * The alternative is rendering unvalidated third-party text as scripture. A `200` is not an answer
   * until `normalize.ts` has agreed it is one.
   */
  for (
    const body of [
      { chapters: [{ id: 18 }] },
      { chapters: 'not an array' },
      { chapters: [] },
      { unexpected: true },
      'a string',
      null,
      42,
    ]
  ) {
    const { handle, logger } = handlerFor({ kind: 'ok', body, attempts: 1, tokenRenewed: false });
    const response = await handle(jsonRequest(LIST));
    assertEquals(response.status, 502, JSON.stringify(body));
    assertEquals(logger.entries[0]?.upstream_outcome, 'ok');
    assertEquals(logger.entries[0]?.error_code, 'upstream_unavailable');
  }
});

Deno.test('a vendor 404 is a 404', async () => {
  const { handle } = handlerFor({ kind: 'not-found', attempts: 1, tokenRenewed: false });
  assertEquals((await handle(jsonRequest(LIST))).status, 404);
});

Deno.test('a vendor rate limit passes on the number and nothing else', async () => {
  const { handle } = handlerFor({
    kind: 'rate-limited',
    retryAfterSeconds: 42,
    attempts: 1,
    tokenRenewed: false,
  });

  const response = await handle(jsonRequest(LIST));
  assertEquals(response.status, 429);
  assertEquals(response.headers.get('retry-after'), '42');

  const body = await response.json();
  assertEquals(body.error.retry_after_seconds, 42);
  // NoorLife's own copy, chosen before the failure happened.
  assertEquals(body.error.message.includes('Qur’an content'), true);
});

Deno.test('a rate limit with no usable hint invents none', async () => {
  const { handle } = handlerFor({
    kind: 'rate-limited',
    retryAfterSeconds: null,
    attempts: 1,
    tokenRenewed: false,
  });
  const response = await handle(jsonRequest(LIST));
  assertEquals(response.status, 429);
  assertEquals(response.headers.get('retry-after'), null);
  assertEquals((await response.json()).error.retry_after_seconds, undefined);
});

Deno.test('a refused vendor credential is a 503 with an operator alert — never a 401', async () => {
  const { handle, logger } = handlerFor({
    kind: 'unauthorized',
    attempts: 2,
    tokenRenewed: true,
  });

  const response = await handle(jsonRequest(LIST));

  assertEquals(response.status, 503, 'the caller’s session was fine');
  assertEquals((await response.json()).error.code, 'service_unavailable');
  assertEquals(logger.entries[0]?.operator_alert, 'credentials_rejected');
  assertEquals(logger.entries[0]?.upstream_attempts, 2);
  assertEquals(logger.entries[0]?.token_renewed, true);
});

Deno.test('a missing vendor credential fails closed with nothing rendered', async () => {
  /**
   * The fail-closed path. `attempts: 0` is the load-bearing part — no request left the process — and
   * the response body carries no content of any kind, because there is no sample scripture in this
   * module graph to fall back to.
   */
  const { handle, logger } = handlerFor({ kind: 'unconfigured', attempts: 0, tokenRenewed: false });

  const response = await handle(jsonRequest(LIST));
  const body = await response.json();

  assertEquals(response.status, 503);
  assertEquals(body.error.code, 'service_unavailable');
  assertEquals('data' in body, false, 'no payload accompanies a configuration failure');
  assertEquals(logger.entries[0]?.operator_alert, 'credentials_missing');
  assertEquals(logger.entries[0]?.upstream_attempts, 0);
});

Deno.test('a vendor timeout is a 504 and a vendor fault is a 502', async () => {
  const timeout = handlerFor({ kind: 'timeout', attempts: 1, tokenRenewed: false });
  assertEquals((await timeout.handle(jsonRequest(LIST))).status, 504);

  const transient = handlerFor({ kind: 'transient', attempts: 1, tokenRenewed: false });
  assertEquals((await transient.handle(jsonRequest(LIST))).status, 502);

  const malformed = handlerFor({ kind: 'malformed', attempts: 1, tokenRenewed: false });
  assertEquals((await malformed.handle(jsonRequest(LIST))).status, 502);
});

Deno.test('the two 502 causes stay distinguishable in the log', async () => {
  const transient = handlerFor({ kind: 'transient', attempts: 1, tokenRenewed: false });
  await transient.handle(jsonRequest(LIST));
  assertEquals(transient.logger.entries[0]?.upstream_outcome, 'transient');

  const malformed = handlerFor({ kind: 'malformed', attempts: 1, tokenRenewed: false });
  await malformed.handle(jsonRequest(LIST));
  assertEquals(malformed.logger.entries[0]?.upstream_outcome, 'malformed');
});

Deno.test('the upstream budget aborts the connection and wins the race', async () => {
  /**
   * The client is given a signal and the handler fires the budget. The client then resolves with a
   * *transient* outcome after the abort, and the handler must still answer `timeout`: the budget is
   * the authority on whether the answer arrived in time, not the vendor.
   */
  const timer = fakeTimer();
  const upstream = hangingUpstream();
  const logger = recordingLogger();
  const handle = createQuranContentHandler(dependencies({ upstream, logger, timer }));

  const pending = handle(jsonRequest(LIST));
  /**
   * Wait until the handler has actually reached the upstream before firing the budget.
   *
   * Counting microtasks would be guessing: authentication, the body read and JSON parsing are each
   * asynchronous, and the count changes whenever any of them does. Waiting for the observable
   * event — the client having been handed a signal — keeps the test pinned to behaviour.
   */
  while (upstream.signals.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  timer.fire();
  const response = await pending;

  assertEquals(response.status, 504);
  assertEquals(timer.scheduled[0], testConfig.upstreamTimeoutMs, 'the declared budget was used');
  assertEquals(upstream.signals[0]?.aborted, true, 'the connection was genuinely aborted');
  assertEquals(logger.entries[0]?.upstream_outcome, 'timeout');
});

Deno.test('the budget timer is cancelled once the upstream answers', async () => {
  const timer = fakeTimer();
  const { handle } = handlerFor(
    { kind: 'ok', body: CHAPTER_BODY, attempts: 1, tokenRenewed: false },
    timer,
  );

  await handle(jsonRequest(LIST));

  assertEquals(timer.cancelled(), 1, 'no timer is left behind');
});

Deno.test('every operation declares a cache age inside the one-week licence ceiling', async () => {
  for (const operation of QURAN_OPERATIONS) {
    const declared = OPERATION_CACHE_MAX_AGE_MS[operation];
    assert(
      declared > 0 && declared <= MAX_CACHE_AGE_MS,
      `${operation} declares ${declared}ms, which must be positive and inside one week`,
    );
  }

  const { handle } = handlerFor({
    kind: 'ok',
    body: CHAPTER_BODY,
    attempts: 1,
    tokenRenewed: false,
  });
  const body = await (await handle(jsonRequest(LIST))).json();
  assertEquals(body.cache_max_age_ms, OPERATION_CACHE_MAX_AGE_MS.list_chapters);
  assert(body.cache_max_age_ms <= MAX_CACHE_AGE_MS, 'and never above the licence ceiling');
});

Deno.test('the HTTP response is never cacheable by an intermediary', async () => {
  /**
   * The payload's own `cache_max_age_ms` instructs the client's store, which sits behind this
   * function's authentication. The HTTP response travels over a per-user authenticated channel, so an
   * intermediary caching it would serve one user's authorized response to somebody else.
   */
  const { handle } = handlerFor({
    kind: 'ok',
    body: CHAPTER_BODY,
    attempts: 1,
    tokenRenewed: false,
  });
  const response = await handle(jsonRequest(LIST));
  assertEquals(response.headers.get('cache-control'), 'no-store');
});

Deno.test('an unexpected throw inside the handler becomes a 500 that says nothing', async () => {
  const exploding = {
    read: () => {
      throw new Error('a message that must never reach a caller: token=abc secret=def');
    },
  };
  const logger = recordingLogger();
  const handle = createQuranContentHandler(
    dependencies({ upstream: exploding as never, logger }),
  );

  const response = await handle(jsonRequest(LIST));
  const text = await response.text();

  assertEquals(response.status, 500);
  assertEquals(text.includes('token='), false);
  assertEquals(text.includes('secret='), false);
  assertEquals(JSON.stringify(logger.entries).includes('secret='), false);
});

Deno.test('exactly one log line is emitted per request, and it carries the operation only', async () => {
  const { handle, logger } = handlerFor({
    kind: 'ok',
    body: CHAPTER_BODY,
    attempts: 1,
    tokenRenewed: false,
  });

  await handle(jsonRequest({ contract_version: 1, operation: 'get_chapter', surah: 18 }));

  assertEquals(logger.entries.length, 1);
  const entry = logger.entries[0];
  assert(entry !== undefined, 'a record was emitted');
  assertEquals(entry.operation, 'get_chapter');

  /**
   * Which *kind* of read happened, never which surah, which edition, or who asked. Asserted against
   * the record's key set rather than its serialisation, so the check keeps its meaning when an
   * unrelated numeric field happens to contain the same digits.
   */
  assertEquals(
    Object.keys(entry).sort(),
    [
      'auth_reason',
      'catalogue_fetched',
      'catalogue_outcome',
      'contract_version',
      'duration_ms',
      'error_code',
      'error_field',
      'event',
      'http_status',
      'normalize_reason',
      'operation',
      'operator_alert',
      'outcome',
      'request_id',
      'retry_after_seconds',
      'token_renewed',
      'upstream_attempts',
      'upstream_outcome',
    ],
    'the record has no field that could hold a surah, a verse, an edition or a subject',
  );
});
