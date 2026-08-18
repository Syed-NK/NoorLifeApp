import type { AIRequestContext } from '@shared/permissions/ai-scope';

import {
  NOOR_AI_ANSWER_FIELDS,
  NOOR_AI_CONTRACT_VERSION,
  NOOR_AI_MAX_ANSWER_CODE_POINTS,
  NOOR_AI_MAX_BODY_BYTES,
  NOOR_AI_MAX_MESSAGE_CODE_POINTS,
  NOOR_AI_REQUEST_FIELDS,
} from '../noor-ai.contract';

/**
 * The Noor AI mobile adapter, against a controllable Supabase client.
 *
 * ── Nothing here reaches a network, a project, or a provider ────────────────
 * `@/lib/supabase` is replaced wholesale, so there is no client capable of a request. Every
 * response below is a literal written in this file. No hosted Supabase call, no OpenAI call and no
 * provider request occurs when this suite runs, and none can: the module under test holds no URL,
 * no key and no fetch of its own.
 *
 * ── What these tests are actually for ───────────────────────────────────────
 * Two properties that a screen cannot check for itself and a reviewer cannot check by reading:
 * that exactly one invocation happens per `ask` and never a second, and that nothing a response
 * carries — a request id, a provider id, a token count, a cost, a platform message — can reach a
 * returned value. Both are asserted by driving the real adapter, not by matching its comments.
 */

const mockAuth = { getSession: jest.fn() };
const mockInvoke = jest.fn();
let mockConfigured = true;

jest.mock('@/lib/supabase', () => ({
  get isSupabaseConfigured() {
    return mockConfigured;
  },
  get supabase() {
    return mockConfigured ? { auth: mockAuth, functions: { invoke: mockInvoke } } : null;
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const service = require('../noor-ai.service') as typeof import('../noor-ai.service');

/**
 * A signed-in session.
 *
 * The token is a plain sentinel rather than anything JWT-shaped: the repository's secret scan
 * rejects a `eyJ…` literal anywhere under `src/`, tests included, and a fixture that looks like
 * key material is the thing that eventually is key material.
 */
const ACCESS_TOKEN = 'test-access-token';

function signedIn() {
  return { data: { session: { access_token: ACCESS_TOKEN } }, error: null };
}

/**
 * A context carrying exactly the fields §C.6 forbids on the wire.
 *
 * `permittedModules` and `grantedModules` are populated deliberately. §12.1's request half is that
 * `AIRequestContext` "is right as a local decision and wrong as a wire field", and a fixture with
 * empty arrays could not tell a correct adapter from one that spreads the context into the body.
 */
const context: AIRequestContext = {
  scope: { kind: 'noorlife', permittedModules: ['faith', 'health', 'finance'] },
  currentScreen: '/faith',
  grantedModules: ['faith', 'health'],
};

/** A §C.4 answer body, with anything a caller wants to override. */
function answerBody(overrides: Record<string, unknown> = {}) {
  return {
    contract_version: 1,
    request_id: 'noorai_req_00000000-0000-4000-8000-000000000000',
    outcome: 'answer',
    answer: {
      text: 'Open Faith, then Prayer Settings, then Reminders.',
      sources: [],
      accessed_modules: [],
    },
    finish: 'complete',
    ...overrides,
  };
}

/** What `supabase-js` hands back for a non-2xx: an error carrying the `Response` as `context`. */
function httpError(status: number, body: unknown) {
  return {
    data: null,
    error: {
      name: 'FunctionsHttpError',
      message: 'Edge Function returned a non-2xx status code',
      context: {
        status,
        json: async () => {
          if (body instanceof Error) {
            throw body;
          }
          return body;
        },
      },
    },
  };
}

/** What `supabase-js` hands back when `fetch` itself rejected. */
function fetchError(cause: unknown) {
  return {
    data: null,
    error: {
      name: 'FunctionsFetchError',
      message: 'Failed to send a request to the Edge Function',
      context: cause,
    },
  };
}

function ok(data: unknown) {
  return { data, error: null };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockConfigured = true;
  mockAuth.getSession.mockResolvedValue(signedIn());
  mockInvoke.mockResolvedValue(ok(answerBody()));
});

/** The body of the single invocation, for assertions about what was actually sent. */
function sentBody(): Record<string, unknown> {
  expect(mockInvoke).toHaveBeenCalledTimes(1);
  return mockInvoke.mock.calls[0][1].body as Record<string, unknown>;
}

describe('local validation happens before any invocation', () => {
  it('sends a valid minimal question exactly once', async () => {
    const result = await service.noorAIService.ask('How do I turn off the Fajr reminder?', context);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke.mock.calls[0][0]).toBe('noor-ai');
    expect(result.outcome).toBe('answer');
  });

  it('refuses an empty question without invoking', async () => {
    const result = await service.noorAIService.ask('', context);

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'failed', failure: 'invalid-request' });
  });

  it('refuses a whitespace-only question without invoking', async () => {
    /**
     * Ordinary spaces, a tab, a newline, a zero-width space and a right-to-left mark.
     *
     * §C.3.4 names the last two families explicitly: they are invisible, so a "non-empty" message
     * could be made entirely of them and still cost a handler execution.
     */
    for (const blank of ['   ', '\t\n', '\u200b\u200b', '\u200e \u202a', '\ufeff']) {
      mockInvoke.mockClear();
      const result = await service.noorAIService.ask(blank, context);
      expect(mockInvoke).not.toHaveBeenCalled();
      expect(result).toEqual({ outcome: 'failed', failure: 'invalid-request' });
    }
  });

  it('refuses an oversized question without invoking, and accepts one at the limit', async () => {
    const overLimit = 'a'.repeat(NOOR_AI_MAX_MESSAGE_CODE_POINTS + 1);
    const atLimit = 'a'.repeat(NOOR_AI_MAX_MESSAGE_CODE_POINTS);

    const refused = await service.noorAIService.ask(overLimit, context);
    expect(mockInvoke).not.toHaveBeenCalled();
    expect(refused).toEqual({ outcome: 'failed', failure: 'invalid-request' });

    // The positive control: without it, an adapter that refused everything would pass the above.
    const accepted = await service.noorAIService.ask(atLimit, context);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(accepted.outcome).toBe('answer');
  });

  it('counts code points, so an Arabic question is not penalised against an English one', async () => {
    /**
     * §C.3.6 — "a byte-based limit would be a language-based limit". Each of these characters is
     * two UTF-16 units and several UTF-8 bytes, so a naive `.length` or byte count would refuse a
     * question well inside the contract's limit.
     */
    const emoji = '\u{1f600}'.repeat(NOOR_AI_MAX_MESSAGE_CODE_POINTS);
    const result = await service.noorAIService.ask(emoji, context);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe('answer');
  });

  it('refuses control characters without invoking, but permits tab, newline and return', async () => {
    // A NUL, an ESC and a C1 control, which the message rules refuse.
    for (const hostile of ['bad\u0000null', 'esc\u001bhere', 'c1\u009fchar']) {
      mockInvoke.mockClear();
      const result = await service.noorAIService.ask(hostile, context);
      expect(mockInvoke).not.toHaveBeenCalled();
      expect(result).toEqual({ outcome: 'failed', failure: 'invalid-request' });
    }

    mockInvoke.mockClear();
    const permitted = await service.noorAIService.ask('line one\nline\ttwo\r\nline three', context);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(permitted.outcome).toBe('answer');
  });

  it('keeps the byte cap below the point where it could falsely refuse a real question', async () => {
    /**
     * §C.3.1's cap is enforced by the adapter as well as by the server, and this records what that
     * check can and cannot do rather than overstating it.
     *
     * The densest body the adapter can construct is a message at the code-point limit made entirely
     * of four-byte characters, and §C.3.1's own sizing arithmetic — "1000 code points at UTF-8's
     * four-byte worst case is 4000 bytes, so 8 KiB is generous" — is exactly why that body is still
     * comfortably inside the cap. So the byte check is defence in depth against a fifth field
     * arriving in the body, not a rule a question can trip. What is worth asserting is the half
     * that would be a real defect: that it never refuses a legitimate one.
     */
    const dense = '\u{1f600}'.repeat(NOOR_AI_MAX_MESSAGE_CODE_POINTS);
    expect([...dense].length).toBe(NOOR_AI_MAX_MESSAGE_CODE_POINTS);

    const result = await service.noorAIService.ask(dense, context);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe('answer');
    expect(JSON.stringify(sentBody()).length).toBeLessThan(NOOR_AI_MAX_BODY_BYTES);
  });

  it('answers a build with no Supabase configuration without invoking', async () => {
    mockConfigured = false;

    const result = await service.noorAIService.ask('Where are my reminders?', context);

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'failed', failure: 'not-configured' });
  });

  it('answers a missing session without invoking', async () => {
    for (const session of [
      { data: { session: null }, error: null },
      { data: { session: { access_token: '' } }, error: null },
      { data: null, error: { message: 'session unreadable' } },
    ]) {
      mockInvoke.mockClear();
      mockAuth.getSession.mockResolvedValue(session);

      const result = await service.noorAIService.ask('Where are my reminders?', context);

      expect(mockInvoke).not.toHaveBeenCalled();
      expect(result).toEqual({ outcome: 'failed', failure: 'authentication-required' });
    }
  });
});

describe('the request body is §C.2 and nothing else', () => {
  it('sends exactly the four contract fields', async () => {
    await service.noorAIService.ask('How do I turn off the Fajr reminder?', context, {
      locale: 'ar',
    });

    const body = sentBody();
    expect(Object.keys(body).sort()).toEqual([...NOOR_AI_REQUEST_FIELDS].sort());
    expect(body.contract_version).toBe(NOOR_AI_CONTRACT_VERSION);
    expect(body.message).toBe('How do I turn off the Fajr reminder?');
    expect(body.surface).toBe('/faith');
    expect(body.locale).toBe('ar');
  });

  it('serialises nothing from the request context except an allow-listed surface', async () => {
    await service.noorAIService.ask('Where are my reminders?', context);

    const body = sentBody();
    const serialised = JSON.stringify(body);

    // §12.1 — the fields the client holds as local policy and the server recomputes.
    for (const forbidden of ['scope', 'permittedModules', 'grantedModules', 'currentScreen']) {
      expect(body).not.toHaveProperty(forbidden);
      expect(serialised).not.toContain(forbidden);
    }
    // Nor their values, which is the assertion a renamed key would slip past.
    expect(serialised).not.toContain('noorlife');
    expect(serialised).not.toContain('health');
  });

  it('omits an unrecognised surface rather than sending a raw route', async () => {
    await service.noorAIService.ask('Where are my reminders?', {
      ...context,
      currentScreen: '/faith/quran/juz/17?bookmark=private',
    });

    const body = sentBody();
    expect(body).not.toHaveProperty('surface');
    expect(JSON.stringify(body)).not.toContain('bookmark');
  });

  it('omits locale when the caller does not choose one', async () => {
    await service.noorAIService.ask('Where are my reminders?', context);

    expect(sentBody()).not.toHaveProperty('locale');
  });

  it('carries no identity, generation parameter, history or debug field, under any name', async () => {
    await service.noorAIService.ask('Where are my reminders?', context, { locale: 'en' });

    const body = sentBody();
    /**
     * §C.6's table, as an executable assertion. Every one of these is rejected by name on the
     * server; the point of checking here is that the client cannot even construct one, so a
     * rejection is never how we find out.
     */
    for (const forbidden of [
      'user_id',
      'sub',
      'email',
      'account_id',
      'model',
      'model_id',
      'deployment',
      'system',
      'instructions',
      'developer',
      'prompt',
      'preamble',
      'tools',
      'functions',
      'tool_choice',
      'permitted_modules',
      'granted_modules',
      'entitlement',
      'plan',
      'temperature',
      'top_p',
      'max_output_tokens',
      'store',
      'stream',
      'previous_response_id',
      'conversation_id',
      'history',
      'messages',
      'debug',
      'verbose',
      'trace',
      'client_request_id',
      'access_token',
      'apikey',
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it('sends the session token on Authorization and never the publishable key', async () => {
    await service.noorAIService.ask('Where are my reminders?', context);

    const options = mockInvoke.mock.calls[0][1];
    /**
     * §12.11's easily-missed consequence: the publishable key goes on `apikey` **only**, because a
     * key passed as `Authorization: Bearer` is parsed as a JWT and rejected — and a correctly
     * authenticated user then sees a session error caused entirely by header construction. The
     * adapter therefore pins `Authorization` to the user's token at invoke level, where it takes
     * priority, and sets no `apikey` of its own.
     */
    expect(options.headers.Authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
    expect(Object.keys(options.headers)).toEqual(['Authorization']);
  });

  it('names a function rather than a URL, so no endpoint is client-controlled', async () => {
    await service.noorAIService.ask('Where are my reminders?', context);

    expect(mockInvoke.mock.calls[0][0]).toBe('noor-ai');
    expect(mockInvoke.mock.calls[0][0]).not.toMatch(/^https?:/);
  });
});

describe('success parsing exposes only the allow-listed fields', () => {
  it('returns text, finish and an empty sources list, and nothing else', async () => {
    const result = await service.noorAIService.ask('Where are my reminders?', context);

    expect(result).toEqual({
      outcome: 'answer',
      answer: {
        text: 'Open Faith, then Prayer Settings, then Reminders.',
        finish: 'complete',
        sources: [],
      },
    });
    if (result.outcome !== 'answer') {
      throw new Error('expected an answer');
    }
    expect(Object.keys(result.answer).sort()).toEqual([...NOOR_AI_ANSWER_FIELDS].sort());
  });

  it('carries finish: length rather than presenting a truncated answer as finished', async () => {
    mockInvoke.mockResolvedValue(ok(answerBody({ finish: 'length' })));

    const result = await service.noorAIService.ask('Where are my reminders?', context);

    expect(result).toEqual({
      outcome: 'answer',
      answer: expect.objectContaining({ finish: 'length' }),
    });
  });

  it('returns a policy refusal as a successful outcome, not a failure', async () => {
    mockInvoke.mockResolvedValue(
      ok({
        contract_version: 1,
        request_id: 'noorai_req_00000000-0000-4000-8000-000000000000',
        outcome: 'refused',
        refusal: {
          kind: 'out-of-scope',
          explanation: 'I only cover NoorLife.',
          suggested_handoff: null,
        },
      }),
    );

    const result = await service.noorAIService.ask('Who won the match?', context);

    // §C.4 — "a refusal is a successful request". It is not an error and must not render as one.
    expect(result).toEqual({
      outcome: 'refused',
      refusal: { kind: 'out-of-scope', explanation: 'I only cover NoorLife.' },
    });
  });

  it('does not let a provider id, safety value, quota id, token count or cost escape', async () => {
    /**
     * The body a leaky server, or a compromised one, might send. Every extra key here is something
     * §F.9, §H.2 or §12.6 keeps server-side; the assertion is that the adapter's allow-list copy
     * makes their presence irrelevant rather than something a filter has to remember to strip.
     */
    mockInvoke.mockResolvedValue(
      ok(
        answerBody({
          model: 'some-model-id',
          provider_request_id: 'resp_leaked',
          'x-request-id': 'req_leaked',
          safety_id: 'nl_osi_v1_leaked',
          quota_request_id: 'quota_leaked',
          usage: { input_tokens: 555, output_tokens: 64, cost_micro_usd: 2155 },
          debug: { sql: 'select 1', host: 'db.internal' },
        }),
      ),
    );

    const result = await service.noorAIService.ask('Where are my reminders?', context);

    const serialised = JSON.stringify(result);
    for (const leak of [
      'some-model-id',
      'resp_leaked',
      'req_leaked',
      'nl_osi_v1_leaked',
      'quota_leaked',
      '555',
      '2155',
      'select 1',
      'db.internal',
      'noorai_req_',
    ]) {
      expect(serialised).not.toContain(leak);
    }
    expect(result.outcome).toBe('answer');
  });

  it('never carries the NoorLife request id, even though the body always has one', async () => {
    const result = await service.noorAIService.ask('Where are my reminders?', context);

    // §I.7's id is safe to display but this adapter does not surface it — see NoorAIResult.
    expect(JSON.stringify(result)).not.toContain('request_id');
    expect(JSON.stringify(result)).not.toContain('noorai_req_');
  });

  it('fails closed on a malformed 2xx body', async () => {
    const malformed: unknown[] = [
      null,
      'a plain string body',
      [],
      42,
      {},
      answerBody({ contract_version: 2 }),
      answerBody({ request_id: undefined }),
      answerBody({ request_id: 42 }),
      answerBody({ outcome: 'something-else' }),
      answerBody({ answer: null }),
      answerBody({ answer: { text: 42, sources: [], accessed_modules: [] } }),
      answerBody({ answer: { text: '', sources: [], accessed_modules: [] } }),
      answerBody({ finish: 'truncated' }),
      answerBody({ finish: undefined }),
    ];

    for (const body of malformed) {
      mockInvoke.mockClear();
      mockInvoke.mockResolvedValue(ok(body));

      const result = await service.noorAIService.ask('Where are my reminders?', context);

      expect(result).toEqual({ outcome: 'failed', failure: 'invalid-server-response' });
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    }
  });

  it('fails closed on a non-empty sources or accessed_modules list', async () => {
    /**
     * §C.4 — both are empty in AI-1 because there is no retrieval layer and nothing is read. A
     * populated list is either a server this build does not understand or a fabricated citation,
     * and §07 requires Faith content to show real ones.
     */
    for (const answer of [
      { text: 'x', sources: [{ id: 's1' }], accessed_modules: [] },
      { text: 'x', sources: [], accessed_modules: ['health'] },
      { text: 'x', sources: 'none', accessed_modules: [] },
    ]) {
      mockInvoke.mockClear();
      mockInvoke.mockResolvedValue(ok(answerBody({ answer })));

      const result = await service.noorAIService.ask('Where are my reminders?', context);

      expect(result).toEqual({ outcome: 'failed', failure: 'invalid-server-response' });
    }
  });

  it('fails closed on an oversized answer rather than truncating it', async () => {
    mockInvoke.mockResolvedValue(
      ok(
        answerBody({
          answer: {
            text: 'a'.repeat(NOOR_AI_MAX_ANSWER_CODE_POINTS + 1),
            sources: [],
            accessed_modules: [],
          },
        }),
      ),
    );

    const result = await service.noorAIService.ask('Where are my reminders?', context);

    expect(result).toEqual({ outcome: 'failed', failure: 'invalid-server-response' });
  });

  it('fails closed on a malformed refusal', async () => {
    const base = {
      contract_version: 1,
      request_id: 'noorai_req_00000000-0000-4000-8000-000000000000',
      outcome: 'refused',
    };
    for (const refusal of [
      { kind: 'unavailable', explanation: 'x', suggested_handoff: null },
      { kind: 'out-of-scope', explanation: '', suggested_handoff: null },
      { kind: 'out-of-scope', explanation: 42, suggested_handoff: null },
      { kind: 'out-of-scope', explanation: 'a'.repeat(1001), suggested_handoff: null },
      { kind: 'out-of-scope', explanation: 'x', suggested_handoff: 'noor-ai' },
      null,
    ]) {
      mockInvoke.mockClear();
      mockInvoke.mockResolvedValue(ok({ ...base, refusal }));

      const result = await service.noorAIService.ask('Who won the match?', context);

      expect(result).toEqual({ outcome: 'failed', failure: 'invalid-server-response' });
    }
  });
});

describe('gateway and handler errors normalise into the same safe states', () => {
  /**
   * The three gateway bodies §K.1 actually observed, not the one the hosted documentation shows.
   *
   * The real runtime returns a **string** `code` and an extra duplicated `msg` key. §I.5 requires
   * the adapter to treat `code` as opaque, to assume nothing about its type, and not to treat the
   * extra key as malformed — "The invariant to rely on is the *absence* of `request_id`".
   */
  it('maps a platform gateway 401 with no NoorLife request id to authentication-required', async () => {
    for (const body of [
      { code: 401, message: 'Missing authorization header' },
      { code: 'UNAUTHORIZED_NO_AUTH_HEADER', message: 'Missing authorization header', msg: 'x' },
      { code: 'UNAUTHORIZED_ASYMMETRIC_JWT', message: 'Invalid JWT', msg: 'x' },
      { code: 'UNAUTHORIZED_INVALID_JWT_FORMAT', message: 'Invalid JWT format', msg: 'x' },
    ]) {
      mockInvoke.mockClear();
      mockInvoke.mockResolvedValue(httpError(401, body));

      const result = await service.noorAIService.ask('Where are my reminders?', context);

      expect(result).toEqual({ outcome: 'failed', failure: 'authentication-required' });
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    }
  });

  it('maps a handler authentication envelope to the same state as the gateway 401', async () => {
    mockInvoke.mockResolvedValue(
      httpError(401, {
        contract_version: 1,
        request_id: 'noorai_req_00000000-0000-4000-8000-000000000000',
        error: { code: 'unauthenticated', message: 'Please sign in again to continue.' },
      }),
    );

    const result = await service.noorAIService.ask('Where are my reminders?', context);

    // §12.11 — "treating a 401 from either producer as one 'session expired' state".
    expect(result).toEqual({ outcome: 'failed', failure: 'authentication-required' });
  });

  it('maps every handler error code in §I.5 to its state', async () => {
    const table: readonly (readonly [string, number, string])[] = [
      ['invalid_request', 400, 'invalid-request'],
      ['unsupported_contract_version', 400, 'invalid-request'],
      ['unauthenticated', 401, 'authentication-required'],
      ['forbidden', 403, 'unknown'],
      ['not_found', 404, 'unknown'],
      ['method_not_allowed', 405, 'invalid-request'],
      ['unsupported_media_type', 415, 'invalid-request'],
      ['payload_too_large', 413, 'invalid-request'],
      ['rate_limited', 429, 'temporarily-limited'],
      ['timeout', 504, 'timed-out'],
      ['upstream_unavailable', 502, 'temporarily-unavailable'],
      ['service_unavailable', 503, 'temporarily-unavailable'],
      ['internal_error', 500, 'unknown'],
      // A code from a future contract this build does not know. Never guessed at.
      ['some_future_code', 418, 'unknown'],
    ];

    for (const [code, status, expected] of table) {
      mockInvoke.mockClear();
      mockInvoke.mockResolvedValue(
        httpError(status, {
          contract_version: 1,
          request_id: 'noorai_req_00000000-0000-4000-8000-000000000000',
          error: { code, message: 'illustrative copy', retry_after_seconds: 30 },
        }),
      );

      const result = await service.noorAIService.ask('Where are my reminders?', context);

      expect(result).toEqual({ outcome: 'failed', failure: expected });
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    }
  });

  it('maps the disabled function’s 503 to temporary unavailability', async () => {
    /**
     * The state the **current deployment** always reaches. The kill switch is the literal `false`,
     * no provider key is set and no identifier secret exists, so an authenticated, valid request
     * fails closed with §I.5's stable `503` after authentication and validation have both run.
     */
    mockInvoke.mockResolvedValue(
      httpError(503, {
        contract_version: 1,
        request_id: 'noorai_req_00000000-0000-4000-8000-000000000000',
        error: {
          code: 'service_unavailable',
          message: 'Noor AI is unavailable right now. Please try again later.',
          retry_after_seconds: 120,
        },
      }),
    );

    const result = await service.noorAIService.ask('Where are my reminders?', context);

    expect(result).toEqual({ outcome: 'failed', failure: 'temporarily-unavailable' });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('maps 429 to a temporary limit, never to authentication or a permanent failure', async () => {
    for (const body of [
      {
        contract_version: 1,
        request_id: 'noorai_req_00000000-0000-4000-8000-000000000000',
        error: { code: 'rate_limited', message: 'x', retry_after_seconds: 30 },
      },
      // The same status from the platform, with no NoorLife envelope at all.
      { code: 429, message: 'Too Many Requests' },
    ]) {
      mockInvoke.mockClear();
      mockInvoke.mockResolvedValue(httpError(429, body));

      const result = await service.noorAIService.ask('Where are my reminders?', context);

      expect(result).toEqual({ outcome: 'failed', failure: 'temporarily-limited' });
    }
  });

  it('maps platform statuses with no NoorLife envelope on status alone', async () => {
    const table: readonly (readonly [number, string])[] = [
      [401, 'authentication-required'],
      [400, 'invalid-request'],
      [404, 'temporarily-unavailable'],
      [408, 'timed-out'],
      [413, 'invalid-request'],
      [415, 'invalid-request'],
      [429, 'temporarily-limited'],
      [500, 'temporarily-unavailable'],
      [502, 'temporarily-unavailable'],
      [503, 'temporarily-unavailable'],
      [504, 'timed-out'],
      [546, 'temporarily-unavailable'],
      [402, 'unknown'],
      [451, 'unknown'],
    ];

    for (const [status, expected] of table) {
      mockInvoke.mockClear();
      mockInvoke.mockResolvedValue(httpError(status, { code: status, message: 'platform text' }));

      const result = await service.noorAIService.ask('Where are my reminders?', context);

      expect(result).toEqual({ outcome: 'failed', failure: expected });
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    }
  });

  it('never lets a malformed or hostile error body reach the result', async () => {
    for (const body of [
      new SyntaxError('Unexpected token < in JSON at position 0'),
      '<html><body>502 Bad Gateway — upstream db.internal:5432</body></html>',
      { error: 'PGRST301: JWT expired for user 00000000-0000-4000-8000-000000000000' },
      {
        contract_version: 1,
        request_id: 'noorai_req_00000000-0000-4000-8000-000000000000',
        error: { code: 'service_unavailable', message: 'OpenAI org quota exceeded for proj_abc' },
      },
      null,
    ]) {
      mockInvoke.mockClear();
      mockInvoke.mockResolvedValue(httpError(503, body));

      const result = await service.noorAIService.ask('Where are my reminders?', context);

      const serialised = JSON.stringify(result);
      for (const leak of [
        'db.internal',
        'PGRST301',
        'JWT expired',
        'OpenAI',
        'proj_abc',
        'noorai_req_',
        'html',
        'Unexpected token',
      ]) {
        expect(serialised).not.toContain(leak);
      }
      expect(result).toEqual({ outcome: 'failed', failure: 'temporarily-unavailable' });
    }
  });

  it('returns a bare tag with no message, detail, cause or identifier field', async () => {
    mockInvoke.mockResolvedValue(
      httpError(502, {
        contract_version: 1,
        request_id: 'noorai_req_00000000-0000-4000-8000-000000000000',
        error: { code: 'upstream_unavailable', message: 'Noor AI is having trouble right now.' },
      }),
    );

    const result = await service.noorAIService.ask('Where are my reminders?', context);

    expect(Object.keys(result).sort()).toEqual(['failure', 'outcome']);
    if (result.outcome !== 'failed') {
      throw new Error('expected a failure');
    }
    expect(typeof result.failure).toBe('string');
  });
});

describe('transport failures are classified on evidence, not by default', () => {
  it('maps a recognisable network failure to network-unavailable', async () => {
    for (const message of ['Network request failed', 'Failed to fetch']) {
      mockInvoke.mockClear();
      mockInvoke.mockResolvedValue(fetchError(new TypeError(message)));

      const result = await service.noorAIService.ask('Where are my reminders?', context);

      expect(result).toEqual({ outcome: 'failed', failure: 'network-unavailable' });
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    }
  });

  it('maps the client deadline to timed-out, not to a network failure', async () => {
    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    mockInvoke.mockResolvedValue(fetchError(abort));

    const result = await service.noorAIService.ask('Where are my reminders?', context);

    expect(result).toEqual({ outcome: 'failed', failure: 'timed-out' });
  });

  it('passes the caller’s signal through and sets a deadline above the server budget', async () => {
    const controller = new AbortController();

    await service.noorAIService.ask('Where are my reminders?', context, {
      signal: controller.signal,
    });

    const options = mockInvoke.mock.calls[0][1];
    expect(options.signal).toBe(controller.signal);
    // §F.7's committed handler budget is 25s; the client must not give up before the server does.
    expect(options.timeout).toBeGreaterThan(25_000);
  });

  it('maps an abort the caller asked for to cancelled', async () => {
    const controller = new AbortController();
    mockInvoke.mockImplementation(async () => {
      controller.abort();
      const abort = new Error('Aborted');
      abort.name = 'AbortError';
      return fetchError(abort);
    });

    const result = await service.noorAIService.ask('Where are my reminders?', context, {
      signal: controller.signal,
    });

    expect(result).toEqual({ outcome: 'failed', failure: 'cancelled' });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('does not invoke at all when the caller has already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await service.noorAIService.ask('Where are my reminders?', context, {
      signal: controller.signal,
    });

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(result).toEqual({ outcome: 'failed', failure: 'cancelled' });
  });

  it('maps an unrecognised failure to unknown rather than inventing a diagnosis', async () => {
    for (const thrown of [
      fetchError(new Error('something went sideways')),
      fetchError(undefined),
      { data: null, error: 'a bare string' },
      { data: null, error: { name: 'FunctionsRelayError', message: 'Relay Error' } },
      { data: null, error: new Error('boom') },
    ]) {
      mockInvoke.mockClear();
      mockInvoke.mockResolvedValue(thrown);

      const result = await service.noorAIService.ask('Where are my reminders?', context);

      expect(result).toEqual({ outcome: 'failed', failure: 'unknown' });
      expect(mockInvoke).toHaveBeenCalledTimes(1);
    }
  });
});

describe('exactly one invocation, and never an automatic second', () => {
  /**
   * §I.1's quota store mints a fresh request id per handler execution, so a second invocation is a
   * second reservation, a second provider attempt and a second charge. A client retry is therefore
   * **not idempotent**, and this adapter never performs one — §I.5's "retryable" column describes
   * what a person may choose after reading an error, not what the adapter may do silently.
   */
  const everyFailureClass: [string, unknown][] = [
    ['gateway 401', httpError(401, { code: 'UNAUTHORIZED_NO_AUTH_HEADER', message: 'x' })],
    [
      'handler 400',
      httpError(400, {
        contract_version: 1,
        request_id: 'noorai_req_x',
        error: { code: 'invalid_request', message: 'x', field: 'message' },
      }),
    ],
    [
      'handler 429',
      httpError(429, {
        contract_version: 1,
        request_id: 'noorai_req_x',
        error: { code: 'rate_limited', message: 'x' },
      }),
    ],
    [
      'handler 502',
      httpError(502, {
        contract_version: 1,
        request_id: 'noorai_req_x',
        error: { code: 'upstream_unavailable', message: 'x' },
      }),
    ],
    [
      'handler 503',
      httpError(503, {
        contract_version: 1,
        request_id: 'noorai_req_x',
        error: { code: 'service_unavailable', message: 'x' },
      }),
    ],
    [
      'handler 504',
      httpError(504, {
        contract_version: 1,
        request_id: 'noorai_req_x',
        error: { code: 'timeout', message: 'x' },
      }),
    ],
    ['malformed 2xx', ok({ nonsense: true })],
    ['malformed error body', httpError(500, new SyntaxError('bad json'))],
    ['network failure', fetchError(new TypeError('Network request failed'))],
    ['unknown failure', fetchError(new Error('sideways'))],
  ];

  it.each(everyFailureClass)('invokes exactly once for %s', async (_label, outcome) => {
    mockInvoke.mockResolvedValue(outcome);

    const result = await service.noorAIService.ask('Where are my reminders?', context);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(result.outcome).toBe('failed');
  });

  it('does not re-read the session or re-invoke after a timeout', async () => {
    const abort = new Error('Aborted');
    abort.name = 'AbortError';
    mockInvoke.mockResolvedValue(fetchError(abort));

    await service.noorAIService.ask('Where are my reminders?', context);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockAuth.getSession).toHaveBeenCalledTimes(1);
  });

  it('performs no sign-in, refresh or scope-widening call of its own', async () => {
    /**
     * A session read is the only auth call the adapter is allowed to make. A silent refresh-and-
     * retry is what would turn one question into two provider attempts, which is the invariant this
     * whole group exists to protect.
     */
    const auth = mockAuth as unknown as Record<string, unknown>;
    for (const forbidden of ['refreshSession', 'signInWithPassword', 'setSession', 'signOut']) {
      auth[forbidden] = jest.fn();
    }

    await service.noorAIService.ask('Where are my reminders?', context);

    for (const forbidden of ['refreshSession', 'signInWithPassword', 'setSession', 'signOut']) {
      expect(auth[forbidden]).not.toHaveBeenCalled();
      delete auth[forbidden];
    }
  });

  it('two questions are two invocations, so the count is not simply always one', async () => {
    // The positive control for every assertion above.
    await service.noorAIService.ask('First question?', context);
    await service.noorAIService.ask('Second question?', context);

    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });
});

describe('nothing is logged', () => {
  it('writes no console output on any path', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => undefined),
    );

    try {
      await service.noorAIService.ask('Where are my reminders?', context);
      await service.noorAIService.ask('', context);
      mockInvoke.mockResolvedValue(httpError(503, { code: 'x', message: 'platform text' }));
      await service.noorAIService.ask('Where are my reminders?', context);
      mockInvoke.mockResolvedValue(fetchError(new TypeError('Network request failed')));
      await service.noorAIService.ask('Where are my reminders?', context);
      mockInvoke.mockResolvedValue(ok({ nonsense: true }));
      await service.noorAIService.ask('Where are my reminders?', context);

      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    } finally {
      for (const spy of spies) {
        spy.mockRestore();
      }
    }
  });
});
