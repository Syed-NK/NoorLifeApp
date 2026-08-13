import { assert, assertEquals } from './assert.ts';
import { createQuranContentHandler } from '../handler.ts';
import {
  claimsPolicyFor,
  createProductionDependencies,
  productionConfig,
  TOKEN_TIMEOUT_MS,
} from '../production.ts';

/**
 * The **real** production graph, built and driven.
 *
 * ── Why this is worth a file of its own ──────────────────────────────────────
 * Every other test in this suite injects a fake somewhere. This one injects nothing: it constructs
 * the real verifier, the real Quran Foundation client, the real logger and the real config from an
 * environment with no secrets in it, and asserts what that combination actually does. It is the
 * difference between "the handler answers `503` when the upstream says `unconfigured`" — which is a
 * statement about a fake — and "a deployment with no Quran Foundation credentials serves nothing and
 * contacts nobody", which is the statement that matters.
 *
 * The suite runs without `--allow-net`, so any outbound request this graph attempted would fail at
 * the runtime rather than succeed quietly.
 */

/**
 * An environment with nothing in it — which is every environment in this repository.
 *
 * `QF_CLIENT_ID` and `QF_CLIENT_SECRET` are set with `supabase secrets set` against the deployed
 * project and exist in no file here. The test reads no environment variable of its own: the values
 * are passed in, so the graph's behaviour cannot depend on whatever happens to be set on the machine.
 */
const EMPTY = {
  supabaseUrl: undefined,
  jwks: undefined,
  qfClientId: undefined,
  qfClientSecret: undefined,
};

function request(body: unknown, authorization = 'Bearer header.payload.signature'): Request {
  return new Request('https://project.functions.supabase.co/functions/v1/quran-content', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization },
    body: JSON.stringify(body),
  });
}

Deno.test('with no secrets the real graph refuses, and contacts nobody', async () => {
  const deps = createProductionDependencies(EMPTY);
  const handle = createQuranContentHandler(deps);

  const response = await handle(request({ contract_version: 1, operation: 'list_chapters' }));
  const body = await response.json();

  /**
   * `503` rather than `401`: with no `SUPABASE_JWKS` the verifier cannot verify anything, which is a
   * statement about the server. Either way the request never reaches the vendor — and the point of
   * driving the real graph is that nothing here was arranged to make that true.
   */
  assertEquals(response.status, 503);
  assertEquals(body.error.code, 'service_unavailable');
  assertEquals('data' in body, false, 'no content of any kind accompanies the refusal');
});

Deno.test('the real upstream client makes no request when no credential is configured', async () => {
  const deps = createProductionDependencies(EMPTY);
  const controller = new AbortController();

  const result = await deps.upstream.read({ operation: 'list_chapters' }, controller.signal);

  assertEquals(result.kind, 'unconfigured');
  assertEquals(result.attempts, 0, 'nothing left the process');
  assertEquals(result.tokenRenewed, false);
});

Deno.test('the real graph answers nothing that could be mistaken for scripture', async () => {
  /**
   * The fail-closed guarantee, checked as text rather than as a shape. A `503` body that happened to
   * carry a verse would be exactly the failure the whole integration exists to prevent, and this
   * asserts the body contains no Arabic at all.
   */
  const handle = createQuranContentHandler(createProductionDependencies(EMPTY));

  for (
    const body of [
      { contract_version: 1, operation: 'list_chapters' },
      { contract_version: 1, operation: 'list_verses', surah: 18 },
      { contract_version: 1, operation: 'get_verse', surah: 94, verse: 6, translation_id: '131' },
    ]
  ) {
    const text = await (await handle(request(body))).text();
    assertEquals(/[؀-ۿ]/.test(text), false, 'no Arabic in any refusal body');
    assertEquals(text.includes('quran.foundation'), false, 'and no vendor detail either');
  }
});

Deno.test('the claim policy is derived from the platform-injected project URL', () => {
  assertEquals(
    claimsPolicyFor('https://project.supabase.co').issuer,
    'https://project.supabase.co/auth/v1',
  );
  assertEquals(
    claimsPolicyFor('https://project.supabase.co/').issuer,
    'https://project.supabase.co/auth/v1',
  );
  assertEquals(
    claimsPolicyFor(undefined).issuer,
    '/auth/v1',
    'an absent URL cannot match any issuer',
  );
  assertEquals(claimsPolicyFor('https://project.supabase.co').audience, 'authenticated');
});

Deno.test('the budgets are ordered so a retry cannot buy itself a fresh deadline', () => {
  /**
   * `upstreamTimeoutMs` covers the whole upstream operation — up to two content requests and any
   * token exchange between them — and the handler budget is strictly greater, leaving room for JWT
   * verification and body parsing on either side.
   */
  assert(
    productionConfig.handlerBudgetMs > productionConfig.upstreamTimeoutMs,
    'the handler budget exceeds the upstream budget',
  );
  assert(
    TOKEN_TIMEOUT_MS < productionConfig.upstreamTimeoutMs,
    'a token exchange fits inside the upstream budget with room for the content request',
  );
  assert(TOKEN_TIMEOUT_MS * 2 < productionConfig.upstreamTimeoutMs, 'and so do two of them');
});

Deno.test('the production logger is the only thing that can write a line', () => {
  /**
   * Driven rather than only scanned: the logger is handed a record and its output is captured, so the
   * assertion is about the JSON that would actually be emitted.
   */
  const deps = createProductionDependencies(EMPTY);
  const original = console.log;
  const written: string[] = [];
  console.log = (value: unknown) => {
    written.push(String(value));
  };
  try {
    deps.logger.record({
      event: 'quran_content_request',
      request_id: 'quran_req_00000000-0000-4000-8000-000000000001',
      contract_version: 1,
      http_status: 503,
      outcome: 'error',
      error_code: 'service_unavailable',
      error_field: null,
      auth_reason: null,
      operation: 'list_verses',
      upstream_outcome: 'unconfigured',
      upstream_attempts: 0,
      token_renewed: false,
      catalogue_fetched: false,
      catalogue_outcome: null,
      normalize_reason: null,
      retry_after_seconds: null,
      operator_alert: 'credentials_missing',
      duration_ms: 3,
    });
  } finally {
    console.log = original;
  }

  assertEquals(written.length, 1);
  const record = JSON.parse(written[0] ?? '{}');
  assertEquals(record.operation, 'list_verses');
  assertEquals(record.operator_alert, 'credentials_missing');
  assertEquals(
    Object.keys(record).sort(),
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
    'the serialiser writes exactly the allow-listed keys',
  );
});
