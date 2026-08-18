import { assert, assertEquals } from './assert.ts';
import {
  createTokenStore,
  MAX_TOKEN_LIFETIME_MS,
  QF_OAUTH_ORIGIN,
  QF_TOKEN_PATH,
  TOKEN_RENEWAL_SKEW_MS,
  unavailableTokenSource,
} from '../token-store.ts';
import {
  fakeClock,
  forbiddenFetch,
  jsonResponse,
  recordingFetch,
  syntheticToken,
} from './fakes.ts';

/**
 * The OAuth2 client-credentials exchange: fail-closed without secrets, cached, renewed early, and
 * never a source of credential detail.
 *
 * Every test below runs with **no real credential** — the ids and secrets are obviously synthetic
 * strings built in the test — and with a `fetch` the test owns, so nothing here can reach the vendor.
 * The suite runs without `--allow-net`, so an accidental real call fails at the runtime rather than
 * succeeding quietly.
 */

const CLIENT_ID = 'synthetic-client-id-for-tests';
const CLIENT_SECRET = 'synthetic-client-secret-for-tests';
const TOKEN_ENDPOINT = `${QF_OAUTH_ORIGIN}${QF_TOKEN_PATH}`;

function neverAborted(): AbortSignal {
  return new AbortController().signal;
}

function tokenBody(marker: string, expiresIn = 3600): Record<string, unknown> {
  return {
    access_token: syntheticToken(marker),
    token_type: 'bearer',
    expires_in: expiresIn,
    scope: 'content',
  };
}

Deno.test('missing secrets fail closed, and construct no transport at all', async () => {
  /**
   * The most important test in this file. With either half of the credential absent the store makes
   * **zero** outbound requests — `forbiddenFetch` throws if one is attempted — so a deployment with
   * no secrets cannot leak a partial credential to the authorization server while failing.
   */
  for (
    const [clientId, clientSecret] of [
      [undefined, undefined],
      [CLIENT_ID, undefined],
      [undefined, CLIENT_SECRET],
      ['', CLIENT_SECRET],
      [CLIENT_ID, ''],
    ] as const
  ) {
    const store = createTokenStore({
      clientId,
      clientSecret,
      timeoutMs: 1_000,
      clock: fakeClock(),
      fetchImpl: forbiddenFetch(),
    });
    const outcome = await store.get({ forceRenew: false }, neverAborted());
    assertEquals(outcome.kind, 'unavailable');
  }

  assertEquals(
    (await unavailableTokenSource.get({ forceRenew: true }, neverAborted())).kind,
    'unavailable',
  );
});

Deno.test('the exchange is exactly the documented client-credentials request', async () => {
  const call = recordingFetch(() => jsonResponse(tokenBody('a')));
  const store = createTokenStore({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    timeoutMs: 1_000,
    clock: fakeClock(),
    fetchImpl: call,
  });

  const outcome = await store.get({ forceRenew: false }, neverAborted());
  assertEquals(outcome.kind, 'token');

  assertEquals(call.calls.length, 1);
  const request = call.calls[0];
  assert(request !== undefined, 'the exchange request was recorded');
  assertEquals(request.url, TOKEN_ENDPOINT);
  assertEquals(request.method, 'POST');
  assertEquals(request.headers['content-type'], 'application/x-www-form-urlencoded');
  assertEquals(request.body, 'grant_type=client_credentials&scope=content');
  assertEquals(request.redirect, 'error', 'a redirect must never replay the Basic credential');

  // HTTP Basic, and the decoded value is exactly `id:secret` — no other framing.
  const authorization = request.headers['authorization'] ?? '';
  assert(authorization.startsWith('Basic '), 'Basic authentication');
  assertEquals(atob(authorization.slice('Basic '.length)), `${CLIENT_ID}:${CLIENT_SECRET}`);
});

Deno.test('the secret appears in exactly one place on the wire', async () => {
  const call = recordingFetch(() => jsonResponse(tokenBody('b')));
  const store = createTokenStore({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    timeoutMs: 1_000,
    clock: fakeClock(),
    fetchImpl: call,
  });

  await store.get({ forceRenew: false }, neverAborted());
  const request = call.calls[0];
  assert(request !== undefined, 'the exchange request was recorded');

  assertEquals(request.url.includes(CLIENT_SECRET), false, 'never in the URL');
  assertEquals(request.body?.includes(CLIENT_SECRET) ?? false, false, 'never in the body');
  assertEquals(
    Object.entries(request.headers)
      .filter(([name]) => name !== 'authorization')
      .some(([, value]) => value.includes(CLIENT_SECRET)),
    false,
    'never in any other header',
  );
});

Deno.test('a live token is reused rather than re-exchanged', async () => {
  const clock = fakeClock();
  const call = recordingFetch(() => jsonResponse(tokenBody('c', 3600)));
  const store = createTokenStore({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    timeoutMs: 1_000,
    clock,
    fetchImpl: call,
  });

  const first = await store.get({ forceRenew: false }, neverAborted());
  clock.advance(60_000);
  const second = await store.get({ forceRenew: false }, neverAborted());
  clock.advance(60_000);
  const third = await store.get({ forceRenew: false }, neverAborted());

  assertEquals(call.calls.length, 1, 'one exchange for three reads');
  assert(
    first.kind === 'token' && second.kind === 'token' && third.kind === 'token',
    'all three reads returned a token',
  );
  assertEquals(second.accessToken, first.accessToken);
  assertEquals(third.accessToken, first.accessToken);
});

Deno.test('the token is renewed shortly before its reported expiry, not after it', async () => {
  /**
   * The window this protects is the request in flight when the clock crosses over: a token that is
   * valid when the header is written and expired when the vendor reads it produces a `401` that looks
   * like a credential problem and is not.
   */
  const clock = fakeClock();
  let issued = 0;
  const call = recordingFetch(() => {
    issued += 1;
    return jsonResponse(tokenBody(`gen${issued}`, 3600));
  });
  const store = createTokenStore({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    timeoutMs: 1_000,
    clock,
    fetchImpl: call,
  });

  const first = await store.get({ forceRenew: false }, neverAborted());
  assert(first.kind === 'token', 'the first read returned a token');

  // One second before the renewal point: still the same token.
  clock.advance(3600_000 - TOKEN_RENEWAL_SKEW_MS - 1_000);
  const stillCached = await store.get({ forceRenew: false }, neverAborted());
  assert(stillCached.kind === 'token', 'the cached token was served again');
  assertEquals(stillCached.accessToken, first.accessToken);
  assertEquals(call.calls.length, 1);

  // Past the renewal point but still inside the reported lifetime: a new token, early.
  clock.advance(2_000);
  const renewed = await store.get({ forceRenew: false }, neverAborted());
  assert(renewed.kind === 'token', 'the early renewal returned a token');
  assertEquals(call.calls.length, 2, 'exchanged again before the vendor’s expiry');
  assert(renewed.accessToken !== first.accessToken, 'and it is a different token');
});

Deno.test('forceRenew drops the cached token even while it is live', async () => {
  const clock = fakeClock();
  let issued = 0;
  const call = recordingFetch(() => {
    issued += 1;
    return jsonResponse(tokenBody(`force${issued}`, 3600));
  });
  const store = createTokenStore({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    timeoutMs: 1_000,
    clock,
    fetchImpl: call,
  });

  const first = await store.get({ forceRenew: false }, neverAborted());
  const second = await store.get({ forceRenew: true }, neverAborted());
  assert(first.kind === 'token' && second.kind === 'token', 'both reads returned a token');
  assertEquals(call.calls.length, 2);
  assert(second.accessToken !== first.accessToken, 'forceRenew produced a different token');

  /**
   * And the refused token is gone rather than merely bypassed: a later ordinary read must not be
   * handed the value the vendor just rejected.
   */
  const third = await store.get({ forceRenew: false }, neverAborted());
  assert(third.kind === 'token', 'the later read returned a token');
  assertEquals(third.accessToken, second.accessToken);
  assertEquals(call.calls.length, 2);
});

Deno.test('concurrent cold reads share one exchange', async () => {
  /**
   * An isolate serves requests concurrently, so without a single-flight slot a burst on a cold
   * isolate would perform one identical exchange per request — the vendor's load multiplied for
   * nothing, and every token but one discarded on arrival.
   */
  let resolveExchange: ((response: Response) => void) | null = null;
  const call = recordingFetch(() =>
    new Promise<Response>((resolve) => {
      resolveExchange = resolve;
    })
  );
  const store = createTokenStore({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    timeoutMs: 1_000,
    clock: fakeClock(),
    fetchImpl: call,
  });

  const all = Promise.all([
    store.get({ forceRenew: false }, neverAborted()),
    store.get({ forceRenew: false }, neverAborted()),
    store.get({ forceRenew: false }, neverAborted()),
  ]);
  await Promise.resolve();
  assert(resolveExchange !== null, 'the exchange started');
  (resolveExchange as (response: Response) => void)(jsonResponse(tokenBody('shared')));

  const outcomes = await all;
  assertEquals(call.calls.length, 1, 'three readers, one exchange');
  for (const outcome of outcomes) {
    assertEquals(outcome.kind, 'token');
  }
});

Deno.test('a rejected credential is reported distinctly from an unreachable server', async () => {
  /**
   * The remedies differ — look at the client id, the secret or the approved scope, against do
   * nothing at all — so an operator has to be able to tell them apart. Neither branch retains the
   * status, and neither reads the body.
   */
  for (const status of [400, 401, 403]) {
    const store = createTokenStore({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      timeoutMs: 1_000,
      clock: fakeClock(),
      fetchImpl: recordingFetch(() =>
        jsonResponse({ error: 'invalid_client', error_description: 'do not forward me' }, status)
      ),
    });
    assertEquals(
      (await store.get({ forceRenew: false }, neverAborted())).kind,
      'refused',
      `${status}`,
    );
  }

  for (const status of [429, 500, 502, 503, 504, 418]) {
    const store = createTokenStore({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      timeoutMs: 1_000,
      clock: fakeClock(),
      fetchImpl: recordingFetch(() => jsonResponse({ error: 'server_error' }, status)),
    });
    assertEquals(
      (await store.get({ forceRenew: false }, neverAborted())).kind,
      'unavailable',
      `${status}`,
    );
  }
});

Deno.test('a malformed token response yields no token', async () => {
  const bodies: readonly unknown[] = [
    {},
    { access_token: '' },
    { access_token: 123, expires_in: 3600 },
    { access_token: syntheticToken('x') },
    { access_token: syntheticToken('x'), expires_in: 0 },
    { access_token: syntheticToken('x'), expires_in: -1 },
    { access_token: syntheticToken('x'), expires_in: '3600' },
    { access_token: syntheticToken('x'), expires_in: 3600, scope: 'user' },
    { access_token: 'has a space in it', expires_in: 3600 },
    { access_token: 'has\r\nnewlines', expires_in: 3600 },
    { access_token: 'short', expires_in: 3600 },
    [],
    'a string',
    null,
  ];

  for (const body of bodies) {
    const store = createTokenStore({
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      timeoutMs: 1_000,
      clock: fakeClock(),
      fetchImpl: recordingFetch(() => jsonResponse(body)),
    });
    assertEquals(
      (await store.get({ forceRenew: false }, neverAborted())).kind,
      'unavailable',
      JSON.stringify(body),
    );
  }
});

Deno.test('a body that is not JSON at all yields no token', async () => {
  const store = createTokenStore({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    timeoutMs: 1_000,
    clock: fakeClock(),
    fetchImpl: recordingFetch(() =>
      new Response('<html>gateway error</html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      })
    ),
  });
  assertEquals((await store.get({ forceRenew: false }, neverAborted())).kind, 'unavailable');
});

Deno.test('a transport failure yields no token and captures nothing about the error', async () => {
  const store = createTokenStore({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    timeoutMs: 1_000,
    clock: fakeClock(),
    fetchImpl: recordingFetch(() => {
      throw new Error(`connection reset while sending ${CLIENT_SECRET}`);
    }),
  });
  const outcome = await store.get({ forceRenew: false }, neverAborted());
  assertEquals(outcome, { kind: 'unavailable' }, 'the outcome has no field an error could occupy');
});

Deno.test('an absurd reported lifetime is clamped rather than trusted', async () => {
  const clock = fakeClock();
  let issued = 0;
  const call = recordingFetch(() => {
    issued += 1;
    // A year, which is either a mistake or a value nobody intended.
    return jsonResponse(tokenBody(`long${issued}`, 365 * 24 * 3600));
  });
  const store = createTokenStore({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    timeoutMs: 1_000,
    clock,
    fetchImpl: call,
  });

  await store.get({ forceRenew: false }, neverAborted());
  // Just inside the clamped lifetime: still cached.
  clock.advance(MAX_TOKEN_LIFETIME_MS - TOKEN_RENEWAL_SKEW_MS - 1_000);
  await store.get({ forceRenew: false }, neverAborted());
  assertEquals(call.calls.length, 1);

  // Past it: renewed, long before the year the server claimed.
  clock.advance(2_000);
  await store.get({ forceRenew: false }, neverAborted());
  assertEquals(call.calls.length, 2, 'a day is the longest this store reuses a credential');
});

Deno.test('an already-aborted caller does not start an exchange', async () => {
  const controller = new AbortController();
  controller.abort();
  const store = createTokenStore({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    timeoutMs: 1_000,
    clock: fakeClock(),
    fetchImpl: forbiddenFetch(),
  });

  assertEquals((await store.get({ forceRenew: false }, controller.signal)).kind, 'unavailable');
});

Deno.test('there is no refresh-token path anywhere in the store', async () => {
  /**
   * The quickstart is explicit that a client-credentials integration has no refresh token, so a
   * response carrying one must change nothing: the store still exchanges again when the cache
   * expires, and it never sends a `refresh_token` grant.
   */
  const clock = fakeClock();
  const call = recordingFetch(() =>
    jsonResponse({ ...tokenBody('refreshy', 120), refresh_token: 'must-be-ignored-entirely' })
  );
  const store = createTokenStore({
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    timeoutMs: 1_000,
    clock,
    fetchImpl: call,
  });

  await store.get({ forceRenew: false }, neverAborted());
  clock.advance(120_000);
  await store.get({ forceRenew: false }, neverAborted());

  assertEquals(call.calls.length, 2);
  for (const request of call.calls) {
    assertEquals(request.body, 'grant_type=client_credentials&scope=content');
  }
});
