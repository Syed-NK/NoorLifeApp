import type { TrustedAuthCallback } from '../auth-callback.contract';

/**
 * The exchange, its replay guards, and what it reports.
 *
 * ── Why the client is replaced rather than the shared double reused ─────────
 * The shared double in `jest.setup.ts` serves one healthy signed-in session, which is right for screens
 * and useless here: this suite is about a verifier that has already been spent, a `PASSWORD_RECOVERY`
 * event, an email change with one side outstanding, and a transport failure. Each of those is a
 * specific response, so the response is what gets injected.
 *
 * Nothing here contacts a real project, and no account is changed.
 */

/** The `AuthChangeEvent` listeners the service registers around each exchange. */
const listeners = new Set<(event: string, session: unknown) => void>();

const mockAuth = {
  exchangeCodeForSession: jest.fn(),
  getUser: jest.fn(),
  onAuthStateChange: jest.fn((handler: (event: string, session: unknown) => void) => {
    listeners.add(handler);
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            listeners.delete(handler);
          },
        },
      },
    };
  }),
};

/**
 * `auth` is a getter, and that is load-bearing.
 *
 * `jest.mock` is hoisted above every import, so this factory runs while the service module is being
 * evaluated — before `const mockAuth` below has been initialised. Returning `{ auth: mockAuth }` captured
 * the value at that moment, which was `undefined`, and every test failed on
 * `Cannot read properties of undefined`. A getter defers the read to the moment the service actually
 * reaches for the client, which is after this file has finished loading.
 */
jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    get auth() {
      return mockAuth;
    },
  },
  requireSupabase: () => ({ auth: mockAuth }),
}));

/**
 * Imported statically even though it depends on the mock above.
 *
 * `jest.mock` is hoisted above every import in the file, so by the time this module is evaluated the
 * stand-in client is already registered. A `require` here would say the same thing less clearly.
 */
// eslint-disable-next-line import/first -- the mock must be declared above this import to be hoisted legibly.
import * as service from '../auth-callback.service';

const SESSION = { access_token: 'token', user: { id: 'user-1', email: 'ahmed@example.com' } };

function callbackFor(overrides: Partial<TrustedAuthCallback> = {}): TrustedAuthCallback {
  return {
    kind: 'callback',
    // A distinct code per call by default, because the service's guard is keyed on it and a shared
    // code would make the second test in a file see the first one's mark.
    code: `code-${Math.random().toString(36).slice(2)}-abcdefghijklmnop`,
    flowId: null,
    declaredFlow: null,
    ...overrides,
  };
}

/** Answers a successful exchange, optionally emitting the recovery event the SDK emits. */
function resolveExchange(options: { recovery?: boolean; redirectType?: string | null } = {}) {
  mockAuth.exchangeCodeForSession.mockImplementation(async () => {
    if (options.recovery === true) {
      // `_exchangeCodeForSession` awaits `_notifyAllSubscribers` before returning, so a subscription
      // taken around the call has already fired by the time it resolves.
      for (const listener of listeners) {
        listener('PASSWORD_RECOVERY', SESSION);
      }
    } else {
      for (const listener of listeners) {
        listener('SIGNED_IN', SESSION);
      }
    }
    return {
      data: {
        session: SESSION,
        user: SESSION.user,
        ...(options.redirectType === undefined ? {} : { redirectType: options.redirectType }),
      },
      error: null,
    };
  });
}

function resolveUser(user: Record<string, unknown> | null, error: unknown = null) {
  mockAuth.getUser.mockResolvedValue({ data: { user }, error });
}

beforeEach(() => {
  listeners.clear();
  mockAuth.exchangeCodeForSession.mockReset();
  mockAuth.getUser.mockReset();
  mockAuth.onAuthStateChange.mockClear();
  service.resetAuthCallbackGuards();
  resolveUser({ id: 'user-1', email: 'ahmed@example.com' });
});

describe('a signup confirmation', () => {
  it('exchanges the code exactly once and reports a signed-in session', async () => {
    resolveExchange();
    const callback = callbackFor();

    const outcome = await service.processAuthCallback(callback);

    expect(mockAuth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(mockAuth.exchangeCodeForSession).toHaveBeenCalledWith(callback.code, undefined);
    expect(outcome).toEqual({
      status: 'signed-in',
      flow: 'signup',
      email: 'ahmed@example.com',
      pendingEmail: null,
    });
  });

  it('passes the Supabase flow id through when the redirect carried one', async () => {
    resolveExchange();
    const callback = callbackFor({ flowId: 'abc12345_XY-9' });

    await service.processAuthCallback(callback);

    /**
     * With two flows open, omitting the id would submit the most recently started flow's verifier and
     * burn a single-use code — `retrievePKCEVerifier` consults only the matching slot when given one.
     * This is the SDK's own documented usage.
     */
    expect(mockAuth.exchangeCodeForSession).toHaveBeenCalledWith(callback.code, {
      flowId: 'abc12345_XY-9',
    });
  });

  it('reads the address from the refreshed user rather than from the session copy', async () => {
    resolveExchange();
    resolveUser({ id: 'user-1', email: 'moved@example.com' });

    const outcome = await service.processAuthCallback(callbackFor());

    // `getUser` is a network read of `auth.users`; the session's own copy was minted at exchange time.
    expect(mockAuth.getUser).toHaveBeenCalled();
    expect(outcome).toMatchObject({ email: 'moved@example.com' });
  });

  it('stays signed-in when the refresh fails, reporting what it does not know', async () => {
    resolveExchange();
    resolveUser(null, { name: 'AuthRetryableFetchError' });

    const outcome = await service.processAuthCallback(callbackFor());

    // The session is live and the user *is* signed in. Degrading to nulls is honest; failing the
    // callback would sign them out of something that worked.
    expect(outcome).toEqual({
      status: 'signed-in',
      flow: 'signup',
      email: null,
      pendingEmail: null,
    });
  });
});

describe('a password recovery', () => {
  it('is recognised from the documented PASSWORD_RECOVERY event', async () => {
    resolveExchange({ recovery: true });

    const outcome = await service.processAuthCallback(callbackFor());

    expect(outcome).toEqual({ status: 'recovery-ready', userId: 'user-1' });
  });

  it('is recognised from the SDK’s redirectType even without the event', async () => {
    // Corroboration, in case a future SDK stops emitting the event around this call.
    mockAuth.exchangeCodeForSession.mockResolvedValue({
      data: { session: SESSION, user: SESSION.user, redirectType: 'recovery' },
      error: null,
    });

    const outcome = await service.processAuthCallback(callbackFor());

    expect(outcome).toEqual({ status: 'recovery-ready', userId: 'user-1' });
  });

  it('keys the grant to the account the server reports, not the one in the session copy', async () => {
    resolveExchange({ recovery: true });
    resolveUser({ id: 'server-authoritative-id', email: 'ahmed@example.com' });

    const outcome = await service.processAuthCallback(callbackFor());

    // The Set New Password screen checks its grant against this id. Reading it from the server is what
    // makes "this grant belongs to the account you are about to change" verified rather than inherited.
    expect(outcome).toEqual({ status: 'recovery-ready', userId: 'server-authoritative-id' });
  });

  it('fails rather than granting when the user cannot be read', async () => {
    resolveExchange({ recovery: true });
    resolveUser(null);

    const outcome = await service.processAuthCallback(callbackFor());

    expect(outcome).toEqual({ status: 'failed', code: 'session-unavailable' });
  });

  it('unsubscribes its listener however the exchange ends', async () => {
    resolveExchange({ recovery: true });
    await service.processAuthCallback(callbackFor());
    expect(listeners.size).toBe(0);

    mockAuth.exchangeCodeForSession.mockRejectedValue({ name: 'AuthPKCECodeVerifierMissingError' });
    await service.processAuthCallback(callbackFor());
    expect(listeners.size).toBe(0);
  });
});

describe('an email change', () => {
  it('reports the pending address from Supabase’s own new_email', async () => {
    resolveExchange();
    resolveUser({ id: 'user-1', email: 'ahmed@example.com', new_email: 'new@example.com' });

    const outcome = await service.processAuthCallback(callbackFor());

    expect(outcome).toEqual({
      status: 'signed-in',
      flow: 'email-change',
      email: 'ahmed@example.com',
      pendingEmail: 'new@example.com',
    });
  });

  it('reports it as confirmed once no side is outstanding', async () => {
    resolveExchange();
    resolveUser({ id: 'user-1', email: 'new@example.com', new_email: '' });

    const outcome = await service.processAuthCallback(
      callbackFor({ declaredFlow: 'email-change' }),
    );

    expect(outcome).toEqual({
      status: 'signed-in',
      flow: 'email-change',
      email: 'new@example.com',
      pendingEmail: null,
    });
  });

  it('never takes an address from the callback itself', async () => {
    resolveExchange();
    resolveUser({ id: 'user-1', email: 'authoritative@example.com' });

    const outcome = await service.processAuthCallback(
      callbackFor({ declaredFlow: 'email-change' }),
    );

    /**
     * The one rule the email-change flow lives or dies by. An address on a callback URL is an untrusted
     * claim; rendering it as the account's address would show a confirmed change that had not happened,
     * and the user would then fail to sign in with it.
     */
    expect(outcome).toMatchObject({ email: 'authoritative@example.com' });
    expect(JSON.stringify(outcome)).not.toContain('example.org');
  });
});

describe('replay and duplicate delivery', () => {
  it('exchanges a duplicated same-tick delivery once and gives both callers one outcome', async () => {
    resolveExchange();
    const callback = callbackFor();

    const [first, second] = await Promise.all([
      service.processAuthCallback(callback),
      service.processAuthCallback(callback),
    ]);

    // What a `singleTask` re-entry plus a mounted screen actually produces.
    expect(mockAuth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
  });

  it('refuses a replay after the first exchange has finished', async () => {
    resolveExchange();
    const callback = callbackFor();

    await service.processAuthCallback(callback);
    const replay = await service.processAuthCallback(callback);

    expect(mockAuth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
    expect(replay).toEqual({ status: 'failed', code: 'link-already-used' });
  });

  it('refuses a replay even after the first exchange failed', async () => {
    /**
     * Marked before the request, not after. The code is single-use at the server, so a retry could only
     * ever fail again while looking to the user like a fresh attempt — and marking first also means a
     * crash mid-request cannot produce a second live exchange.
     */
    mockAuth.exchangeCodeForSession.mockRejectedValue({ name: 'AuthRetryableFetchError' });
    const callback = callbackFor();

    expect(await service.processAuthCallback(callback)).toEqual({
      status: 'failed',
      code: 'offline',
    });
    expect(await service.processAuthCallback(callback)).toEqual({
      status: 'failed',
      code: 'link-already-used',
    });
  });

  it('maps Supabase’s own spent-verifier error to already-used', async () => {
    // `_exchangeCodeForSession` removes the verifier on both the success and the failure path, so a
    // second exchange throws before any network call. That is the cross-restart half of the guard.
    mockAuth.exchangeCodeForSession.mockRejectedValue({
      name: 'AuthPKCECodeVerifierMissingError',
      message: 'code verifier missing',
    });

    expect(await service.processAuthCallback(callbackFor())).toEqual({
      status: 'failed',
      code: 'link-already-used',
    });
  });

  it('lets a genuinely different code through', async () => {
    resolveExchange();

    await service.processAuthCallback(callbackFor());
    const second = await service.processAuthCallback(callbackFor());

    expect(mockAuth.exchangeCodeForSession).toHaveBeenCalledTimes(2);
    expect(second).toMatchObject({ status: 'signed-in' });
  });
});

describe('conflicting flow types', () => {
  it('refuses a link claiming recovery that produces a non-recovery verifier', async () => {
    resolveExchange();

    const outcome = await service.processAuthCallback(callbackFor({ declaredFlow: 'recovery' }));

    expect(outcome).toEqual({ status: 'failed', code: 'conflicting-flow' });
  });

  it('refuses a link claiming signup that produces a recovery verifier', async () => {
    resolveExchange({ recovery: true });

    const outcome = await service.processAuthCallback(callbackFor({ declaredFlow: 'signup' }));

    expect(outcome).toEqual({ status: 'failed', code: 'conflicting-flow' });
  });

  it('accepts a link that agrees with the exchange', async () => {
    resolveExchange({ recovery: true });
    expect(
      await service.processAuthCallback(callbackFor({ declaredFlow: 'recovery' })),
    ).toMatchObject({ status: 'recovery-ready' });
  });

  it('does not treat an undeclared flow as a conflict', async () => {
    // A PKCE signup confirmation carries no `type` at all.
    resolveExchange();
    expect(await service.processAuthCallback(callbackFor())).toMatchObject({
      status: 'signed-in',
    });
  });
});

describe('failures', () => {
  it.each([
    [{ code: 'otp_expired' }, 'link-expired'],
    [{ code: 'flow_state_expired' }, 'link-expired'],
    [{ code: 'flow_state_not_found' }, 'link-already-used'],
    [{ code: 'bad_code_verifier' }, 'link-already-used'],
    [{ code: 'validation_failed' }, 'invalid-link'],
    [{ code: 'signup_disabled' }, 'unsupported-flow'],
    [{ code: 'PGRST125' }, 'not-configured'],
    [{ message: 'Network request failed' }, 'offline'],
    [{ name: 'AuthRetryableFetchError' }, 'offline'],
    [{ status: 401 }, 'link-already-used'],
    [{ status: 410 }, 'link-expired'],
    [{ status: 503 }, 'server-error'],
    [{ message: 'something nobody has classified' }, 'server-error'],
  ])('maps %p to %s', async (error, expected) => {
    mockAuth.exchangeCodeForSession.mockResolvedValue({
      data: { session: null, user: null },
      error,
    });

    expect(await service.processAuthCallback(callbackFor())).toEqual({
      status: 'failed',
      code: expected,
    });
  });

  it('reports a missing session rather than assuming one', async () => {
    mockAuth.exchangeCodeForSession.mockResolvedValue({
      data: { session: null, user: null },
      error: null,
    });

    expect(await service.processAuthCallback(callbackFor())).toEqual({
      status: 'failed',
      code: 'session-unavailable',
    });
  });

  it('never lets a raw backend message reach the outcome', async () => {
    mockAuth.exchangeCodeForSession.mockResolvedValue({
      data: { session: null, user: null },
      error: {
        status: 400,
        message: 'Email link is invalid or has expired for ahmed@example.com (ref: xyz-internal)',
      },
    });

    const outcome = await service.processAuthCallback(callbackFor());

    expect(outcome).toEqual({ status: 'failed', code: 'server-error' });
    expect(JSON.stringify(outcome)).not.toContain('ahmed@example.com');
    expect(JSON.stringify(outcome)).not.toContain('xyz-internal');
  });
});

describe('what is never logged', () => {
  it('emits at most a mapped code, and never the authorization code or a token', async () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((level) =>
      jest.spyOn(console, level).mockImplementation(() => undefined),
    );

    const callback = callbackFor({ flowId: 'flow-1234abcd', code: 'secret-code-abcdefghijklmnop' });
    mockAuth.exchangeCodeForSession.mockResolvedValue({
      data: { session: null, user: null },
      error: { code: 'otp_expired', message: 'expired for ahmed@example.com' },
    });

    await service.processAuthCallback(callback);
    // And again, to cover the replay branch's log too.
    await service.processAuthCallback(callback);

    const emitted = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join(' ');
    for (const forbidden of [
      'secret-code-abcdefghijklmnop',
      'flow-1234abcd',
      'ahmed@example.com',
      'noorlifeapp://',
      'access_token',
    ]) {
      expect(emitted).not.toContain(forbidden);
    }
    for (const spy of spies) {
      spy.mockRestore();
    }
  });
});

describe('an unconfigured build', () => {
  it('reports not-configured rather than attempting a call', async () => {
    jest.resetModules();
    jest.doMock('@/lib/supabase', () => ({ isSupabaseConfigured: false, supabase: null }));
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- re-required under the new mock.
    const unconfigured = require('../auth-callback.service') as typeof import('../auth-callback.service');

    expect(await unconfigured.processAuthCallback(callbackFor())).toEqual({
      status: 'failed',
      code: 'not-configured',
    });
    expect(mockAuth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
