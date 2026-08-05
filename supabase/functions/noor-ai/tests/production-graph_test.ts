import { createNoorAIHandler } from '../handler.ts';
import {
  createProductionDependencies,
  productionConfig,
  unavailableProvider,
  unavailableRateLimiter,
} from '../production.ts';
import { assert, assertEquals, assertExcludes } from './assert.ts';
import {
  createCapturingLogger,
  createFakeClock,
  createFakeRequestIds,
  createFakeTimer,
  createSigningFixture,
  jsonRequest,
  validClaimSet,
  withNetworkTripwire,
} from './fakes.ts';

/**
 * The production dependency graph — the real one, not a description of it.
 *
 * §K's AI-2 exit criteria include "**no key exists anywhere**", and the phase requirement is that the
 * production graph performs no OpenAI call, no network call, and returns unavailable. The only way to assert
 * that honestly is to build the graph the entry point builds and drive a request through it, which is what
 * `createProductionDependencies` taking its environment as an argument is for.
 */

const PROJECT_URL = 'https://project.supabase.co';

Deno.test('the production provider is unavailable by construction and touches no network', async () => {
  const tripwire = withNetworkTripwire();
  try {
    const outcome = await unavailableProvider.generate(
      {
        instructions: 'anything',
        userInput: 'anything',
        maxOutputTokens: 1,
        store: false,
        languageHint: 'en',
      },
      new AbortController().signal,
    );

    assertEquals(outcome.kind, 'unavailable', 'the only thing it can answer');
    assertEquals(tripwire.calls, [], 'and it calls nothing');
  } finally {
    tripwire.restore();
  }
});

Deno.test('the production rate limiter fails closed and is not a counter', async () => {
  /**
   * §I.1: "an Edge Function runs in ephemeral, horizontally-scaled isolates, so an in-memory counter is not a
   * rate limit." So the assertion is not "the counter works" — it is that repeated calls never start allowing
   * traffic, because there is no counter to exhaust or reset.
   */
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const decision = await unavailableRateLimiter.check('any-user', Date.now());
    assertEquals(
      decision.kind,
      'unavailable',
      'never allowed, never limited — simply unable to answer',
    );
  }
});

Deno.test('§I.2 — the production kill switch is off and the budgets are correctly shaped', () => {
  assertEquals(productionConfig.enabled, false, 'Noor AI is not enabled in AI-2');
  assert(
    productionConfig.handlerBudgetMs > productionConfig.upstreamTimeoutMs,
    '§F.7 — the handler budget is strictly greater than the upstream budget',
  );
  assert(productionConfig.maxOutputTokens > 0, '§F.5 — the output is bounded');
});

Deno.test('the production graph answers 503 to a genuinely authenticated request, with no network call', async () => {
  /**
   * The end-to-end AI-2 statement, and it is deliberately built the hard way.
   *
   * The verifier is the **real** one, fed a real ES256 key set and a genuinely signed token, so authentication
   * actually succeeds rather than being stubbed past. Only the clock, the timer, the request-id source and the
   * logger are substituted, and only so the test is deterministic and can read the log — none of them can
   * affect whether a call is made.
   *
   * The result is `503` produced after authentication and validation both ran, with the network tripwire
   * recording nothing.
   */
  const tripwire = withNetworkTripwire();
  try {
    const keys = await createSigningFixture();
    const token = await keys.sign(validClaimSet(Math.floor(Date.now() / 1000), {
      iss: `${PROJECT_URL}/auth/v1`,
    }));

    const production = createProductionDependencies({ supabaseUrl: PROJECT_URL, jwks: keys.jwks });
    const logger = createCapturingLogger();
    const handler = createNoorAIHandler({
      ...production,
      clock: createFakeClock(),
      timer: createFakeTimer(),
      requestIds: createFakeRequestIds(),
      logger,
    });

    const message = 'Where do I change my prayer reminder sound?';
    const response = await handler(
      jsonRequest({ contract_version: 1, message }, { authorization: `Bearer ${token}` }),
    );
    const body = await response.json();

    assertEquals(response.status, 503, 'the production graph fails closed');
    assertEquals(body.error.code, 'service_unavailable', 'with §I.5’s stable code');
    assertEquals('answer' in body, false, 'and never a canned answer');
    assertEquals('refusal' in body, false, 'nor a refusal it did not decide');
    assertEquals(tripwire.calls, [], 'no network call of any kind was made');

    // Authentication succeeded — there is no `auth_reason` — and validation ran, so the message length was
    // measured. The 503 is therefore genuinely "after authentication/validation", not instead of them.
    const record = logger.records[0];
    assertEquals(record?.auth_reason, null, 'the real verifier accepted the real token');
    assertEquals(record?.message_length, [...message].length, 'and the schema was validated');
    assertEquals(record?.provider_outcome, null, 'the provider was never reached');
  } finally {
    tripwire.restore();
  }
});

Deno.test('the production graph refuses an anon-role token even with a valid signature', async () => {
  /**
   * §D.4 check 6 through the production graph rather than through the pure claim function. §J.2d2 calls this
   * "**The single most important handler auth test**", and this is the version that proves the production
   * verifier — not just `checkClaims` — enforces it.
   */
  const keys = await createSigningFixture();
  const token = await keys.sign(
    validClaimSet(Math.floor(Date.now() / 1000), { iss: `${PROJECT_URL}/auth/v1`, role: 'anon' }),
  );

  const production = createProductionDependencies({ supabaseUrl: PROJECT_URL, jwks: keys.jwks });
  const logger = createCapturingLogger();
  const handler = createNoorAIHandler({
    ...production,
    logger,
    requestIds: createFakeRequestIds(),
  });

  const response = await handler(
    jsonRequest({ contract_version: 1, message: 'hello' }, { authorization: `Bearer ${token}` }),
  );

  assertEquals(
    response.status,
    401,
    'a correctly signed anon token is still not a signed-in person',
  );
  assertEquals(logger.records[0]?.auth_reason, 'role', 'refused on the role claim');
});

Deno.test('the production graph fails closed when the platform supplies no verification key', async () => {
  // The legacy-HS256 configuration. `503`, not `401`, and not a guess at an algorithm.
  const production = createProductionDependencies({ supabaseUrl: PROJECT_URL, jwks: undefined });
  const logger = createCapturingLogger();
  const handler = createNoorAIHandler({
    ...production,
    logger,
    requestIds: createFakeRequestIds(),
  });

  const response = await handler(
    jsonRequest({ contract_version: 1, message: 'hello' }, { authorization: 'Bearer aaa.bbb.ccc' }),
  );

  assertEquals(response.status, 503, 'an unconfigurable verifier declines to serve');
  assertEquals(logger.records[0]?.auth_reason, 'verifier-unavailable', 'and says so operationally');
});

Deno.test('nothing in the production graph is a fake, and nothing in it can be told to be one', async () => {
  /**
   * The behavioural half of the "no fake in production" rule; `source-scan_test.ts` owns the structural half.
   *
   * Every attempt below is a way a caller might try to select a different provider — a request field, a
   * plausible flag, a header. All of them are refused or ignored, and in no case does an answer appear.
   */
  const keys = await createSigningFixture();
  const token = await keys.sign(validClaimSet(Math.floor(Date.now() / 1000), {
    iss: `${PROJECT_URL}/auth/v1`,
  }));
  const production = createProductionDependencies({ supabaseUrl: PROJECT_URL, jwks: keys.jwks });
  const handler = createNoorAIHandler({
    ...production,
    requestIds: createFakeRequestIds(),
    logger: createCapturingLogger(),
  });

  const attempts: Record<string, unknown>[] = [
    { contract_version: 1, message: 'hi', provider: 'fake' },
    { contract_version: 1, message: 'hi', mock: true },
    { contract_version: 1, message: 'hi', test_mode: true },
    { contract_version: 1, message: 'hi', debug: true },
    { contract_version: 1, message: 'hi', use_fake_provider: true },
  ];

  for (const body of attempts) {
    const response = await handler(jsonRequest(body, { authorization: `Bearer ${token}` }));
    const text = await response.text();
    assertEquals(response.status, 400, `${Object.keys(body)[2]} is rejected as an unknown field`);
    assertExcludes(text, '"outcome"', 'and no outcome of any kind is produced');
  }
});
