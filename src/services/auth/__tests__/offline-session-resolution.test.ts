/**
 * Why airplane mode signs a user out, pinned before anything is changed.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The chain, traced ──────────────────────────────────────────────────────
 * A device with a valid stored session and 3,158 downloaded recitation files shows Authentication
 * Options in airplane mode. Four links, and the defect is in the first:
 *
 *   1. `getSession()` returns `AuthUser | null`, and maps **both** "Supabase says there is no
 *      session" and "the refresh could not be attempted because the device is offline" onto `null`.
 *   2. `AuthProvider.adopt(null)` reads that as `status: 'signed-out'`.
 *   3. `use-startup-routing` reports `isSignedIn: false`.
 *   4. The startup machine routes every non-signed-in launch to `authentication`.
 *
 * Nothing downstream can recover the distinction, because it was destroyed at step 1. The same
 * collapse happens on the event path: `subscribeToAuthChanges` discards Supabase's event name and
 * forwards `toUser(session)`, so a `TOKEN_REFRESH_FAILED` carrying a null session is indistinguishable
 * from `SIGNED_OUT`.
 *
 * ── What these tests are for ───────────────────────────────────────────────
 * They fail against the current implementation on purpose. They are the executable statement of the
 * defect, written before the fix so the fix has something to satisfy rather than the other way round.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { resolveSession } from '../auth.service';
import { classifyAuthFailure, isDefinitive } from '../session-resolution';

/* `mock` prefix: Jest permits only these names inside a module factory. */
const mockGetSession = jest.fn();
const mockOnAuthStateChange = jest.fn();

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
    },
  },
}));

/** What Supabase returns when the refresh could not be attempted at all. */
function retryableFetchFailure() {
  const error = new Error('Network request failed');
  error.name = 'AuthRetryableFetchError';
  return { data: { session: null }, error };
}

/** What Supabase returns when it has definitively decided there is no usable session. */
function refreshTokenRejected() {
  const error = new Error('Invalid Refresh Token: Already Used');
  error.name = 'AuthApiError';
  (error as unknown as { status: number }).status = 400;
  /*
    The `code` matters and this fixture used to omit it. `auth-js` 2.111.0 populates it from the
    server's `error_code` and GoTrueClient itself branches on
    `err.code === 'refresh_token_already_used'`, so a real reused token always carries one. Without
    it this modelled a bare 400 — which is now correctly retryable, because a bare 400 is any
    malformed request and must not delete a valid offline receipt.
  */
  (error as unknown as { code: string }).code = 'refresh_token_already_used';
  return { data: { session: null }, error };
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockOnAuthStateChange.mockReset();
  mockOnAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: () => undefined } },
  });
});

describe('a session resolution distinguishes "no session" from "could not ask"', () => {
  it('reports a retryable outage as retryable, not as signed out', async () => {
    /*
      ── The defect, stated as the thing that must not happen ──────────────────
      The device is in airplane mode. Supabase cannot reach the token endpoint, so it returns a null
      session beside an `AuthRetryableFetchError`. Reading that as "signed out" is what strands a user
      outside an app whose content is already on their phone.
    */
    mockGetSession.mockResolvedValue(retryableFetchFailure());

    const result = await resolveSession();

    expect(result.kind).toBe('retryable-offline');
    expect(result.kind).not.toBe('no-session');
  });

  it('reports a rejected refresh token as definitively invalid', async () => {
    /*
      The other half of the same distinction, and the half that must stay strict: a refresh token the
      server has rejected is a revoked session, and it may not be softened into "try again later".
    */
    mockGetSession.mockResolvedValue(refreshTokenRejected());

    expect((await resolveSession()).kind).toBe('invalid-or-revoked');
  });

  it('reports a clean absence of any stored session as no-session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    expect((await resolveSession()).kind).toBe('no-session');
  });

  it('reports a live session as authenticated, carrying the user', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: {
            id: 'user-1',
            email: 'a@example.com',
            email_confirmed_at: '2026-01-01T00:00:00Z',
            user_metadata: { full_name: 'A Person' },
          },
        },
      },
      error: null,
    });

    const result = await resolveSession();
    expect(result.kind).toBe('authenticated');
    expect(result.kind === 'authenticated' && result.user.id).toBe('user-1');
  });

  it('treats a thrown transport failure as retryable rather than as a sign-out', async () => {
    /*
      `getSession` can reject outright rather than resolving with an error — a DNS failure inside the
      fetch, for instance. The provider currently wraps the call in `.catch(() => null)`, which is the
      same collapse by a different route.
    */
    mockGetSession.mockRejectedValue(
      Object.assign(new Error('getaddrinfo ENOTFOUND'), {
        name: 'TypeError',
      }),
    );

    expect((await resolveSession()).kind).toBe('retryable-offline');
  });

  it('never surfaces the provider’s own error text', async () => {
    /*
      A raw provider message can name a host, a token state or an internal endpoint. The result is a
      closed set for the same reason every other boundary in this project uses one.
    */
    mockGetSession.mockResolvedValue(retryableFetchFailure());
    const result = await resolveSession();

    expect(JSON.stringify(result)).not.toMatch(/Network request failed/);
    expect(JSON.stringify(result)).not.toMatch(/https?:/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What may and may not end offline access
// ─────────────────────────────────────────────────────────────────────────────

describe('classifying an auth failure', () => {
  /*
    ── Written after a device signed itself out mid-session ──────────────────
    The receipt and the Supabase session both vanished during a long test run, and my first
    explanation — rate limiting — was wrong: 429 already fell through to retryable and could not have
    deleted anything. Auditing the classifier found the real hazard instead:

        if (status === 400 || status === 401 || status === 403) return invalid-or-revoked;

    A 400 is *any* malformed request — a validation failure, a bad parameter, an SDK/server
    disagreement — and every one of them was being read as "your session was revoked", which deletes
    the receipt and ejects a signed-in user from their own downloads.

    The actual cause of that sign-out remains **unknown**. These cases pin the rule rather than the
    diagnosis.
  */

  function apiError(status: number, code = ''): unknown {
    const error = new Error('unused prose') as Error & { status: number; code?: string };
    error.name = 'AuthApiError';
    error.status = status;
    if (code !== '') {
      error.code = code;
    }
    return error;
  }

  function named(name: string): unknown {
    const error = new Error('unused prose');
    error.name = name;
    return error;
  }

  it.each([
    ['429 rate limited', apiError(429)],
    ['429 with a code', apiError(429, 'over_request_rate_limit')],
    ['500 server error', apiError(500)],
    ['502 bad gateway', apiError(502)],
    ['503 unavailable', apiError(503)],
    ['a 400 with no code', apiError(400)],
    ['a 400 for a malformed request', apiError(400, 'validation_failed')],
    ['a 400 about a bad parameter', apiError(400, 'bad_json')],
    ['a DNS failure', named('TypeError')],
    ['a timeout', named('AbortError')],
    ['a retryable fetch failure', named('AuthRetryableFetchError')],
    ['an unknown native exception', named('NativeModuleError')],
    ['a bare object', {}],
    ['null', null],
    ['a string', 'something went wrong'],
  ])('treats %s as retryable, so the receipt survives', (_label, error) => {
    expect(classifyAuthFailure(error)).toEqual({ kind: 'retryable-offline' });
  });

  it.each([
    ['401 unauthorised', apiError(401)],
    ['403 forbidden', apiError(403)],
    ['a 400 naming a missing refresh token', apiError(400, 'refresh_token_not_found')],
    ['a 400 naming a reused refresh token', apiError(400, 'refresh_token_already_used')],
    ['a 400 naming a revoked refresh token', apiError(400, 'refresh_token_revoked')],
    ['a 400 naming a missing session', apiError(400, 'session_not_found')],
    ['a 400 naming an expired session', apiError(400, 'session_expired')],
    ['a 400 naming a deleted user', apiError(400, 'user_not_found')],
  ])('treats %s as a terminal verdict', (_label, error) => {
    expect(classifyAuthFailure(error)).toEqual({ kind: 'invalid-or-revoked' });
  });

  it('never lets a message decide the outcome', () => {
    /*
      Prose is localised and reworded between releases, and it is the one thing that must not reach a
      screen or a log. Two errors identical but for their text must classify identically.
    */
    const a = apiError(400, 'validation_failed');
    const b = apiError(400, 'validation_failed');
    (b as { message: string }).message = 'Invalid Refresh Token: Already Used';
    expect(classifyAuthFailure(a)).toEqual(classifyAuthFailure(b));
  });

  it('keeps the terminal code set closed', () => {
    /*
      A code the server invents tomorrow must not silently end somebody's offline access. Adding one
      has to be a deliberate edit with a case above it.
    */
    expect(classifyAuthFailure(apiError(400, 'some_future_code'))).toEqual({
      kind: 'retryable-offline',
    });
  });

  it('reports only the closed resolution vocabulary', () => {
    const kinds = new Set(
      [apiError(429), apiError(401), apiError(400, 'session_expired'), named('TypeError')].map(
        (error) => classifyAuthFailure(error).kind,
      ),
    );
    for (const kind of kinds) {
      expect(['retryable-offline', 'invalid-or-revoked', 'no-session', 'unavailable']).toContain(
        kind,
      );
    }
  });

  it('is only ever definitive for a verdict', () => {
    expect(isDefinitive(classifyAuthFailure(apiError(429)))).toBe(false);
    expect(isDefinitive(classifyAuthFailure(apiError(400)))).toBe(false);
    expect(isDefinitive(classifyAuthFailure(apiError(401)))).toBe(true);
  });
});
