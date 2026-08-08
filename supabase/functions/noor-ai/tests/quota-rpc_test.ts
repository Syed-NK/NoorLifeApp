import {
  createQuotaRpcStore,
  QUOTA_KEY_ENV,
  QUOTA_URL_ENV,
  QUOTA_WRAPPERS,
  unavailableQuotaStore,
} from '../quota-rpc.ts';
import { assert, assertEquals, assertExcludes } from './assert.ts';
import { TEST_RESERVATION_ID, TEST_USER_ID } from './fakes.ts';

/**
 * The quota RPC adapter, driven through an injected transport.
 *
 * ── No real credential, and no real network ──────────────────────────────────
 * `createQuotaRpcStore` takes both its URL and its key as arguments rather than reading the
 * environment, which is the same shape `createProductionDependencies` uses and for the same reason: a
 * test can exercise the *real* adapter without a project existing and without a secret being set. The
 * values below are obvious non-credentials, and the suite runs without `--allow-net`, so an escape
 * from the injected transport would fail at the runtime boundary as well as at an assertion.
 *
 * The env var *names* are asserted rather than read. Names are not secrets; values never appear here.
 */

const URL_BASE = 'https://project.supabase.co';
/** Not a credential: a literal marker, short and obviously inert. */
const FAKE_KEY = 'test-key-not-a-credential';

type Captured = {
  readonly url: string;
  readonly init: RequestInit;
};

/** A transport that records what it was asked to send and replies from a script. */
function transport(
  ...replies: readonly (Response | (() => Response | Promise<Response>))[]
): { readonly sent: readonly Captured[]; readonly impl: typeof fetch } {
  const sent: Captured[] = [];
  let index = 0;
  const impl = ((input: URL | RequestInfo, init?: RequestInit) => {
    sent.push({ url: String(input), init: init ?? {} });
    const reply = replies[Math.min(index, replies.length - 1)];
    index += 1;
    if (reply === undefined) {
      return Promise.resolve(json({ ok: true }));
    }
    return Promise.resolve(typeof reply === 'function' ? reply() : reply.clone());
  }) as typeof fetch;
  return { sent, impl };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function store(impl: typeof fetch) {
  return createQuotaRpcStore({
    supabaseUrl: URL_BASE,
    serviceRoleKey: FAKE_KEY,
    timeoutMs: 1000,
    fetchImpl: impl,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Construction and configuration
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('the adapter names the platform environment variables and no others', () => {
  assertEquals(QUOTA_URL_ENV, 'SUPABASE_URL', 'the platform project URL, which is not a secret');
  assertEquals(
    QUOTA_KEY_ENV,
    'SUPABASE_SERVICE_ROLE_KEY',
    'and the one secret this function reads',
  );
});

Deno.test('the five wrapper names are exactly the approved public surface', () => {
  assertEquals(
    Object.values(QUOTA_WRAPPERS).sort(),
    [
      'noor_ai_finalize',
      'noor_ai_register_attempt',
      'noor_ai_release',
      'noor_ai_reserve',
      'noor_ai_status',
    ],
    'five wrappers, and the private schema is not among them',
  );
});

Deno.test('with no URL or no key the adapter degrades to the store that can only refuse', async () => {
  /**
   * The state of every environment in this phase. It is a degradation, not an error: a store that
   * cannot be reached must answer `unavailable` rather than allow, because the alternative is an
   * unmetered AI endpoint (§I.1).
   */
  for (
    const config of [
      { supabaseUrl: undefined, serviceRoleKey: FAKE_KEY },
      { supabaseUrl: URL_BASE, serviceRoleKey: undefined },
      { supabaseUrl: '', serviceRoleKey: '' },
    ]
  ) {
    const built = createQuotaRpcStore({ ...config, timeoutMs: 100 });
    assertEquals(
      (await built.reserve(TEST_USER_ID, 'noorai_req_x')).kind,
      'unavailable',
      'reserve refuses',
    );
    assertEquals(
      (await built.finalize(TEST_USER_ID, TEST_RESERVATION_ID)).ok,
      false,
      'and acks nothing',
    );
  }
  assertEquals(
    (await unavailableQuotaStore.release('a', 'b')).ok,
    false,
    'as does the shared instance',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// URL validation — the credential must not be sent to an arbitrary host
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every hostname below is synthetic: `attacker.example` and `evil.example` are under the reserved
 * `.example` TLD (RFC 2606), and `project`/`abcdefghijklmnopqrst` are placeholder refs. No real
 * project hostname and no real credential appears in this file.
 */

/** Builds a store on a candidate URL and reports both its behaviour and its network activity. */
async function probeUrl(candidate: string): Promise<{
  readonly accepted: boolean;
  readonly calls: readonly string[];
}> {
  const net = transport(json({ decision: 'allowed', reservation_id: TEST_RESERVATION_ID }));
  const built = createQuotaRpcStore({
    supabaseUrl: candidate,
    serviceRoleKey: FAKE_KEY,
    timeoutMs: 1000,
    fetchImpl: net.impl,
  });
  const outcome = await built.reserve(TEST_USER_ID, 'noorai_req_probe');
  return { accepted: outcome.kind === 'allowed', calls: net.sent.map((call) => call.url) };
}

Deno.test('a valid HTTPS project URL is accepted and is the origin the credential goes to', async () => {
  const probe = await probeUrl('https://abcdefghijklmnopqrst.supabase.co');
  assert(probe.accepted, 'accepted');
  assertEquals(
    probe.calls,
    ['https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc/noor_ai_reserve'],
    'and the request goes exactly there',
  );
});

Deno.test('one trailing slash is accepted and normalised away', async () => {
  const probe = await probeUrl('https://abcdefghijklmnopqrst.supabase.co/');
  assert(probe.accepted, 'accepted');
  assertEquals(
    probe.calls,
    ['https://abcdefghijklmnopqrst.supabase.co/rest/v1/rpc/noor_ai_reserve'],
    'no doubled slash reaches the route',
  );
});

Deno.test('loopback hosts may be reached over HTTP, on an explicit local port', async () => {
  /**
   * The local stack does not run on 443 and does not serve TLS. HTTP is permitted here and nowhere
   * else, because the request never leaves the machine — there is no transport to intercept.
   */
  for (
    const local of [
      'http://localhost:54321',
      'http://127.0.0.1:54321',
      'http://[::1]:54321',
      'https://localhost:54321',
    ]
  ) {
    const probe = await probeUrl(local);
    assert(probe.accepted, `${local} is accepted for local development`);
    assertEquals(probe.calls.length, 1, `${local} makes its call`);
    assert(
      probe.calls[0]?.endsWith('/rest/v1/rpc/noor_ai_reserve') === true,
      'to the wrapper route',
    );
  }
});

Deno.test('a loopback URL without an explicit port is refused, and nothing is sent', async () => {
  /**
   * The rule the code previously documented but did not enforce.
   *
   * The local Supabase stack never listens on 80 or 443, so a portless loopback URL is not a working
   * local configuration — it is a truncated or half-edited value. `URL` strips the default port, so
   * an empty `url.port` means either that none was written or that the default was; both are refused
   * rather than being allowed to resolve against whatever happens to be listening on the same host.
   */
  for (
    const portless of ['http://localhost', 'https://localhost', 'http://127.0.0.1', 'http://[::1]']
  ) {
    const probe = await probeUrl(portless);
    assertEquals(probe.accepted, false, `${portless} is refused for having no explicit port`);
    assertEquals(probe.calls, [], `${portless} makes zero network calls`);
  }

  // And a default port written out explicitly is normalised away by `URL`, so it is refused too —
  // the check is on the parsed value, not on the spelling.
  for (const defaulted of ['http://localhost:80', 'https://localhost:443']) {
    const probe = await probeUrl(defaulted);
    assertEquals(probe.accepted, false, `${defaulted} normalises to no port and is refused`);
    assertEquals(probe.calls, [], `${defaulted} makes zero network calls`);
  }
});

Deno.test('a URL that is not an ordinary Supabase project origin is refused, and nothing is sent', async () => {
  /**
   * The exfiltration this closes: every quota RPC carries the service-role key in two headers, so a
   * `SUPABASE_URL` pointing anywhere else hands that key — which bypasses RLS on the whole database —
   * to whoever set it. The environment variable is platform-injected, which makes it conventionally
   * trustworthy and not structurally so, and "it came from the environment" is not a trust argument.
   */
  const rejected: readonly [string, string][] = [
    ['https://evil.example', 'an unrelated external host'],
    ['https://attacker.example/rest/v1/rpc/noor_ai_reserve', 'a host that mimics the route'],
    [
      'https://project.supabase.co.attacker.example',
      'a deceptive suffix that only contains the domain',
    ],
    ['https://supabase.co', 'the bare apex, which is not a project'],
    ['https://a.b.supabase.co', 'a multi-label host that is not a project ref'],
    ['http://abcdefghijklmnopqrst.supabase.co', 'a production project over plain HTTP'],
    ['https://user:pass@abcdefghijklmnopqrst.supabase.co', 'embedded user information'],
    ['https://abcdefghijklmnopqrst.supabase.co:8443', 'an explicit non-default port'],
    ['https://abcdefghijklmnopqrst.supabase.co/rest', 'an unexpected path'],
    ['https://abcdefghijklmnopqrst.supabase.co/?x=1', 'a query string'],
    ['https://abcdefghijklmnopqrst.supabase.co/#f', 'a fragment'],
    ['http://evil.example', 'a non-loopback HTTP host'],
    ['ftp://abcdefghijklmnopqrst.supabase.co', 'a scheme that is not HTTP(S)'],
    ['not a url at all', 'a malformed URL'],
    ['', 'an empty value'],
    ['//abcdefghijklmnopqrst.supabase.co', 'a protocol-relative URL, which does not parse'],
  ];

  for (const [candidate, why] of rejected) {
    const probe = await probeUrl(candidate);
    assertEquals(probe.accepted, false, `refused: ${why}`);
    assertEquals(probe.calls, [], `and zero network calls were made: ${why}`);
  }
});

Deno.test('a rejected URL leaks neither itself nor the credential', async () => {
  /**
   * A misconfigured URL can itself be sensitive — the userinfo case carries a credential — so the
   * rejection path builds no message containing it. The store simply refuses.
   */
  const secretish = 'https://user:swordfish@attacker.example/callback?token=abc#frag';
  const built = createQuotaRpcStore({
    supabaseUrl: secretish,
    serviceRoleKey: FAKE_KEY,
    timeoutMs: 1000,
    fetchImpl: (() => {
      throw new Error('the network must not be reached');
    }) as typeof fetch,
  });

  const outcome = await built.reserve(TEST_USER_ID, 'noorai_req_probe');
  const serialised = JSON.stringify(outcome);
  assertEquals(outcome.kind, 'unavailable', 'it refuses');
  for (const leak of ['attacker.example', 'swordfish', 'user:', FAKE_KEY, 'callback']) {
    assertExcludes(serialised, leak, `the outcome never carries ${leak}`);
  }

  const ack = await built.finalize(TEST_USER_ID, TEST_RESERVATION_ID);
  assertEquals(
    JSON.stringify(ack),
    '{"ok":false}',
    'and an ack is a bare boolean, carrying nothing',
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// The outbound request
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('reserve posts to the exact public wrapper route with the server’s own credential', async () => {
  const net = transport(json({ decision: 'allowed', reservation_id: TEST_RESERVATION_ID }));
  await store(net.impl).reserve(TEST_USER_ID, 'noorai_req_abc');

  assertEquals(net.sent.length, 1, 'one call');
  const [call] = net.sent;
  assert(call !== undefined, 'captured');
  assertEquals(
    call.url,
    `${URL_BASE}/rest/v1/rpc/noor_ai_reserve`,
    'the public wrapper route — never a table, never the private schema',
  );
  assertEquals(call.init.method, 'POST', 'an RPC is a POST');

  const headers = call.init.headers as Record<string, string>;
  assertEquals(headers['content-type'], 'application/json', 'JSON in');
  assert(headers['apikey'] !== undefined, 'the server credential is presented');
  assert(headers['authorization']?.startsWith('Bearer ') === true, 'as a bearer token');

  // The caller's own token is not among the headers: this call authenticates as the server.
  const serialised = JSON.stringify(headers);
  assertExcludes(serialised, 'header.payload.signature', 'no caller token is forwarded');

  assertEquals(
    JSON.parse(String(call.init.body)),
    { p_subject_id: TEST_USER_ID, p_request_id: 'noorai_req_abc' },
    'exactly the two declared parameters, and nothing else',
  );
});

Deno.test('register_attempt sends counts and a coarse class, and never a money value', async () => {
  const net = transport(json({ ok: true, idempotent: false }));
  await store(net.impl).registerAttempt(
    TEST_USER_ID,
    TEST_RESERVATION_ID,
    2,
    { inputTokens: 311, outputTokens: 57, reasoningTokens: 23 },
    'transient',
  );

  const [call] = net.sent;
  assert(call !== undefined, 'captured');
  assertEquals(call.url, `${URL_BASE}/rest/v1/rpc/noor_ai_register_attempt`, 'the wrapper');
  assertEquals(JSON.parse(String(call.init.body)), {
    p_subject_id: TEST_USER_ID,
    p_reservation_id: TEST_RESERVATION_ID,
    p_attempt_number: 2,
    p_input_tokens: 311,
    p_output_tokens: 57,
    p_reasoning_tokens: 23,
    p_outcome: 'transient',
  }, 'counts and a class — the database computes cost itself');

  for (const money of ['micros', 'cost', 'price', 'usd']) {
    assertExcludes(String(call.init.body).toLowerCase(), money, `no ${money} is sent`);
  }
});

Deno.test('a malformed subject or reservation id is refused before anything is sent', async () => {
  const net = transport(json({ ok: true }));
  const built = store(net.impl);

  assertEquals(
    (await built.reserve('not-a-uuid', 'noorai_req_x')).kind,
    'unavailable',
    'bad subject',
  );
  assertEquals((await built.reserve(TEST_USER_ID, '')).kind, 'unavailable', 'empty request id');
  assertEquals(
    (await built.reserve(TEST_USER_ID, 'x'.repeat(65))).kind,
    'unavailable',
    'a request id past the database bound',
  );
  assertEquals((await built.finalize(TEST_USER_ID, 'nope')).ok, false, 'bad reservation id');
  assertEquals(net.sent.length, 0, 'not one of them reached the network');
});

// ─────────────────────────────────────────────────────────────────────────────
// Response handling — every failure mode fails closed
// ─────────────────────────────────────────────────────────────────────────────

Deno.test('an allowed reservation is read from the payload', async () => {
  const net = transport(json({ decision: 'allowed', reservation_id: TEST_RESERVATION_ID }));
  const outcome = await store(net.impl).reserve(TEST_USER_ID, 'noorai_req_a');
  assertEquals(outcome, { kind: 'allowed', reservationId: TEST_RESERVATION_ID }, 'allowed');
});

Deno.test('a replayed reservation is treated as allowed — the same request, not a second one', async () => {
  const net = transport(
    json({ decision: 'replayed', reservation_id: TEST_RESERVATION_ID, idempotent: true }),
  );
  const outcome = await store(net.impl).reserve(TEST_USER_ID, 'noorai_req_a');
  assertEquals(outcome, { kind: 'allowed', reservationId: TEST_RESERVATION_ID }, 'the same lease');
});

Deno.test('each denial reason is carried through as its closed-enum value', async () => {
  for (
    const reason of [
      'per_user_minute',
      'per_user_hour',
      'per_user_day',
      'global_minute',
      'global_day',
      'concurrency',
      'daily_spend',
      'monthly_spend',
      'disabled',
    ]
  ) {
    const net = transport(json({ decision: 'limited', reason }));
    const outcome = await store(net.impl).reserve(TEST_USER_ID, 'noorai_req_a');
    assertEquals(outcome, { kind: 'limited', reason }, `${reason} is recognised`);
  }
});

Deno.test('a configuration_error is a store fault, never a denial', async () => {
  /**
   * The database's fail-closed configuration rule reaching the Edge Function. It must map to `503`
   * and never to `429`: a missing ceiling is NoorLife's defect, and telling the user to slow down
   * would blame them for it. Checked ahead of `decision`, so the payload cannot be read as anything
   * else.
   */
  const net = transport(
    json({
      ok: false,
      decision: 'unavailable',
      reason: 'configuration',
      key: 'per_user_day',
      configuration_error: true,
    }),
  );
  const outcome = await store(net.impl).reserve(TEST_USER_ID, 'noorai_req_a');
  assertEquals(outcome.kind, 'unavailable', 'a store fault, mapped to 503 by the handler');

  const ackNet = transport(json({ ok: true, configuration_error: true }));
  assertEquals(
    (await store(ackNet.impl).finalize(TEST_USER_ID, TEST_RESERVATION_ID)).ok,
    false,
    'and it is not an ack even when the call itself succeeded',
  );
});

Deno.test('an unrecognised decision, reason or reservation id fails closed', async () => {
  const cases: readonly unknown[] = [
    { decision: 'maybe' },
    { decision: 'limited', reason: 'a_reason_nobody_reviewed' },
    { decision: 'limited' },
    { decision: 'allowed' },
    { decision: 'allowed', reservation_id: 'not-a-uuid' },
    { decision: 'allowed', reservation_id: 42 },
    {},
    [],
    'a string',
    null,
  ];
  for (const payload of cases) {
    const net = transport(json(payload));
    const outcome = await store(net.impl).reserve(TEST_USER_ID, 'noorai_req_a');
    assertEquals(
      outcome.kind,
      'unavailable',
      `an unrecognised shape is never read as permission: ${JSON.stringify(payload)}`,
    );
  }
});

Deno.test('a non-2xx status, unparseable body or transport failure all fail closed', async () => {
  for (const status of [400, 401, 403, 404, 409, 429, 500, 502, 503]) {
    const net = transport(
      json({ decision: 'allowed', reservation_id: TEST_RESERVATION_ID }, status),
    );
    assertEquals(
      (await store(net.impl).reserve(TEST_USER_ID, 'noorai_req_a')).kind,
      'unavailable',
      `HTTP ${status} is not an allowance, whatever the body says`,
    );
  }

  const badJson = transport(() => new Response('<html>gateway</html>', { status: 200 }));
  assertEquals(
    (await store(badJson.impl).reserve(TEST_USER_ID, 'noorai_req_a')).kind,
    'unavailable',
    'unparseable JSON',
  );

  const thrown = transport(() => {
    throw new Error('connection reset');
  });
  assertEquals(
    (await store(thrown.impl).reserve(TEST_USER_ID, 'noorai_req_a')).kind,
    'unavailable',
    'a transport failure',
  );

  const rejected = transport(() => Promise.reject(new Error('dns')));
  assertEquals(
    (await store(rejected.impl).reserve(TEST_USER_ID, 'noorai_req_a')).kind,
    'unavailable',
    'a rejected promise',
  );
});

Deno.test('an ack is true only when the store said ok', async () => {
  const okNet = transport(json({ ok: true, accumulated_micros: 9200 }));
  assertEquals(
    (await store(okNet.impl).finalize(TEST_USER_ID, TEST_RESERVATION_ID)).ok,
    true,
    'ok',
  );

  for (const payload of [{ ok: false, reason: 'not_open' }, { ok: 'true' }, {}, { ok: 1 }]) {
    const net = transport(json(payload));
    assertEquals(
      (await store(net.impl).finalize(TEST_USER_ID, TEST_RESERVATION_ID)).ok,
      false,
      `only a literal true is an ack: ${JSON.stringify(payload)}`,
    );
  }
});

Deno.test('the call is bounded by a timeout that cleans itself up', async () => {
  /**
   * The abort is asserted through the signal the adapter passes, rather than by waiting: a test that
   * proved a timeout by sleeping would make the suite slow and flaky at once. The transport here
   * never settles, so the only way this test can finish is if the adapter's own timer aborts it.
   *
   * The cleanup half matters as much: `clearTimeout` runs in `finally`, so it runs on success, on
   * rejection and on abort alike, and nothing here creates a promise it does not await — an aborted
   * call cannot resurface later as an unhandled rejection and fail an unrelated test.
   */
  const built = createQuotaRpcStore({
    supabaseUrl: URL_BASE,
    serviceRoleKey: FAKE_KEY,
    timeoutMs: 5,
    fetchImpl: ((_input: URL | RequestInfo, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new Error('aborted')));
      })) as typeof fetch,
  });

  const outcome = await built.reserve(TEST_USER_ID, 'noorai_req_slow');
  assertEquals(outcome.kind, 'unavailable', 'a store that does not answer in time fails closed');
});

Deno.test('the adapter never retries — a second attempt is the handler’s decision, not the transport’s', async () => {
  /**
   * A retry inside the adapter is invisible to §F.7's handler budget, and a retry policy that cannot
   * see the deadline can blow through it. Both idempotent and non-idempotent operations are checked,
   * so the rule is "no retries" rather than "no retries where it would be unsafe".
   */
  const failing = transport(json({}, 500));
  const built = store(failing.impl);

  await built.reserve(TEST_USER_ID, 'noorai_req_a');
  assertEquals(failing.sent.length, 1, 'reserve is attempted once');

  await built.registerAttempt(
    TEST_USER_ID,
    TEST_RESERVATION_ID,
    1,
    { inputTokens: 1, outputTokens: 1, reasoningTokens: 0 },
    'success',
  );
  assertEquals(failing.sent.length, 2, 'and so is a registration');

  await built.finalize(TEST_USER_ID, TEST_RESERVATION_ID);
  assertEquals(failing.sent.length, 3, 'and a finalize');
});

Deno.test('every wrapper posts to its own route and nothing shares one', async () => {
  const net = transport(json({ ok: true }));
  const built = store(net.impl);

  await built.reserve(TEST_USER_ID, 'noorai_req_a');
  await built.registerAttempt(
    TEST_USER_ID,
    TEST_RESERVATION_ID,
    1,
    { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
    'success',
  );
  await built.finalize(TEST_USER_ID, TEST_RESERVATION_ID);
  await built.release(TEST_USER_ID, TEST_RESERVATION_ID);
  await built.status(TEST_USER_ID);

  assertEquals(
    net.sent.map((call) => call.url),
    [
      `${URL_BASE}/rest/v1/rpc/noor_ai_reserve`,
      `${URL_BASE}/rest/v1/rpc/noor_ai_register_attempt`,
      `${URL_BASE}/rest/v1/rpc/noor_ai_finalize`,
      `${URL_BASE}/rest/v1/rpc/noor_ai_release`,
      `${URL_BASE}/rest/v1/rpc/noor_ai_status`,
    ],
    'five wrappers, five distinct routes, all under /rpc/',
  );
  for (const call of net.sent) {
    assertExcludes(call.url, 'noor_ai.', 'the private schema is never addressed');
  }
});
