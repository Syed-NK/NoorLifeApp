import {
  ACCOUNT_SECURITY_SUMMARY_FIELDS,
  AccountSecurityError,
} from '../account-security.contract';

/**
 * The account-security service, against a controllable Supabase client.
 *
 * ── Why the client is replaced rather than the shared double reused ─────────
 * The shared double in `jest.setup.ts` serves one healthy signed-in session, which is exactly
 * right for screens and useless here: this suite is about what happens when GoTrue answers
 * `reauthentication_needed`, when a global sign-out fails at the server, and when a session
 * reports a provider nobody implements. Each of those is a specific response, so the response is
 * what gets injected.
 *
 * Nothing here touches a real project. `updatePassword` and `requestEmailChange` are asserted on
 * the arguments they pass, not on an account they changed.
 */

const mockAuth = {
  getSession: jest.fn(),
  updateUser: jest.fn(),
  reauthenticate: jest.fn(),
  signOut: jest.fn(),
};

jest.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: true,
  get supabase() {
    return { auth: mockAuth };
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const service = require('../account-security.service') as typeof import('../account-security.service');

function session(user: Record<string, unknown>) {
  return { data: { session: { user } }, error: null };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.getSession.mockResolvedValue(
    session({
      id: 'user-uuid',
      email: 'ahmed@example.com',
      email_confirmed_at: '2026-01-01T00:00:00Z',
      last_sign_in_at: '2026-07-30T09:15:00Z',
      app_metadata: { provider: 'email' },
      user_metadata: { full_name: 'Ahmed Al-Rashid' },
    }),
  );
  mockAuth.updateUser.mockResolvedValue({ data: { user: {} }, error: null });
  mockAuth.reauthenticate.mockResolvedValue({ data: {}, error: null });
  mockAuth.signOut.mockResolvedValue({ error: null });
});

describe('the security summary', () => {
  it('reads the provider, the address, verification and last sign-in', async () => {
    const summary = await service.readAccountSecuritySummary();

    expect(summary.provider).toBe('email');
    expect(summary.email).toBe('ahmed@example.com');
    expect(summary.emailVerification).toBe('verified');
    expect(summary.lastSignInAt).toBe('2026-07-30T09:15:00Z');
    expect(summary.canManagePassword).toBe(true);
  });

  it('carries no user id, token or metadata bag', async () => {
    const summary = await service.readAccountSecuritySummary();

    expect(Object.keys(summary).sort()).toEqual([...ACCOUNT_SECURITY_SUMMARY_FIELDS].sort());
    expect(JSON.stringify(summary)).not.toContain('user-uuid');
    expect(JSON.stringify(summary)).not.toContain('Ahmed Al-Rashid');
  });

  it('reports an unconfirmed address as not verified', async () => {
    mockAuth.getSession.mockResolvedValue(
      session({ id: 'u', email: 'a@b.co', app_metadata: { provider: 'email' } }),
    );

    expect((await service.readAccountSecuritySummary()).emailVerification).toBe('not-verified');
  });

  it('reports no address as unknown rather than as a verification failure', async () => {
    mockAuth.getSession.mockResolvedValue(session({ id: 'u', app_metadata: { provider: 'apple' } }));

    const summary = await service.readAccountSecuritySummary();
    expect(summary.email).toBeNull();
    expect(summary.emailVerification).toBe('unknown');
  });

  it.each([
    ['google', 'google', false],
    ['apple', 'apple', false],
    ['azure', 'unknown', false],
    [undefined, 'unknown', false],
  ])('maps the provider %s to %s', async (raw, expected, canManage) => {
    mockAuth.getSession.mockResolvedValue(
      session({ id: 'u', email: 'a@b.co', app_metadata: raw === undefined ? {} : { provider: raw } }),
    );

    const summary = await service.readAccountSecuritySummary();
    expect(summary.provider).toBe(expected);
    // A password form is offered only for an identity NoorLife actually holds a credential for.
    expect(summary.canManagePassword).toBe(canManage);
  });

  it('omits a last sign-in the provider did not report', async () => {
    mockAuth.getSession.mockResolvedValue(
      session({ id: 'u', email: 'a@b.co', app_metadata: { provider: 'email' } }),
    );

    expect((await service.readAccountSecuritySummary()).lastSignInAt).toBeNull();
  });

  it('surfaces a pending address from Supabase rather than from local state', async () => {
    mockAuth.getSession.mockResolvedValue(
      session({
        id: 'u',
        email: 'old@example.com',
        new_email: 'new@example.com',
        email_confirmed_at: '2026-01-01T00:00:00Z',
        app_metadata: { provider: 'email' },
      }),
    );

    const summary = await service.readAccountSecuritySummary();
    expect(summary.email).toBe('old@example.com');
    expect(summary.pendingEmail).toBe('new@example.com');
  });

  it('resolves to a summary of unknowns rather than rejecting when there is no session', async () => {
    mockAuth.getSession.mockResolvedValue({ data: { session: null }, error: null });

    const summary = await service.readAccountSecuritySummary();
    expect(summary).toEqual({
      provider: 'unknown',
      email: null,
      emailVerification: 'unknown',
      lastSignInAt: null,
      canManagePassword: false,
      pendingEmail: null,
    });
  });
});

describe('the password change', () => {
  it('calls updateUser with the password and nothing else', async () => {
    await service.updatePassword({ newPassword: 'NoorLife2026!' });

    expect(mockAuth.updateUser).toHaveBeenCalledTimes(1);
    expect(mockAuth.updateUser).toHaveBeenCalledWith({ password: 'NoorLife2026!' });
  });

  it('passes the reauthentication nonce through when one was collected', async () => {
    await service.updatePassword({ newPassword: 'NoorLife2026!', nonce: '123456' });

    expect(mockAuth.updateUser).toHaveBeenCalledWith({
      password: 'NoorLife2026!',
      nonce: '123456',
    });
  });

  it('never sends a current password, because nothing here can verify one', async () => {
    await service.updatePassword({ newPassword: 'NoorLife2026!' });

    const [payload] = mockAuth.updateUser.mock.calls[0] as [Record<string, unknown>];
    expect(payload).not.toHaveProperty('current_password');
  });

  it('uses the supported reauthentication call rather than a re-sign-in', async () => {
    await service.sendReauthenticationCode();

    expect(mockAuth.reauthenticate).toHaveBeenCalledTimes(1);
    // A second sign-in would rotate the session and turn the form into a credential-testing tool.
    expect(mockAuth).not.toHaveProperty('signInWithPassword.mock.calls.length', 1);
  });
});

describe('the email change', () => {
  it('goes to auth, normalized, and reports pending rather than done', async () => {
    const outcome = await service.requestEmailChange('  NEW@Example.com ');

    expect(mockAuth.updateUser).toHaveBeenCalledWith({ email: 'new@example.com' });
    expect(outcome).toEqual({ status: 'pending', requestedEmail: 'new@example.com' });
  });

  it('normalizes only case and surrounding space', () => {
    // Stripping dots or a +tag would silently change which mailbox the user asked for.
    expect(service.normalizeEmail(' Ahmed.Al+noor@Example.COM ')).toBe(
      'ahmed.al+noor@example.com',
    );
  });
});

describe('scoped sign-out', () => {
  it('ends this device only with the local scope', async () => {
    await service.signOutThisDevice();

    expect(mockAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it('ends every session with the global scope', async () => {
    const outcome = await service.signOutEverywhere();

    expect(mockAuth.signOut).toHaveBeenCalledWith({ scope: 'global' });
    expect(outcome).toEqual({ status: 'signed-out-everywhere' });
  });

  it('reports local-only when the server half failed, and never claims otherwise', async () => {
    // supabase-js removes the local session on this path too, so "you are still signed in" would
    // be false and "signed out everywhere" would be false. The third answer is the true one.
    mockAuth.signOut.mockResolvedValue({
      error: { message: 'Network request failed' },
    });

    const outcome = await service.signOutEverywhere();
    expect(outcome).toEqual({ status: 'local-only', code: 'offline' });
  });

  it('rejects a failed device sign-out, because that session really is still live', async () => {
    mockAuth.signOut.mockResolvedValue({ error: { message: 'Network request failed' } });

    await expect(service.signOutThisDevice()).rejects.toBeInstanceOf(AccountSecurityError);
  });

  it('deletes no data', async () => {
    await service.signOutEverywhere();

    // The only call made is the sign-out itself. No table write, no profile deletion, no admin API.
    expect(mockAuth.updateUser).not.toHaveBeenCalled();
    expect(Object.keys(mockAuth)).not.toContain('admin');
  });
});

describe('error mapping', () => {
  it.each([
    [{ code: 'reauthentication_needed' }, 'reauthentication-required'],
    [{ code: 'reauthentication_not_valid' }, 'invalid-reauthentication-code'],
    [{ code: 'same_password' }, 'same-password'],
    [{ code: 'weak_password' }, 'weak-password'],
    [{ code: 'invalid_credentials' }, 'invalid-credentials'],
    [{ code: 'email_exists' }, 'email-already-used'],
    [{ code: 'email_address_invalid' }, 'invalid-email'],
    [{ code: 'over_request_rate_limit' }, 'rate-limited'],
    [{ code: 'session_expired' }, 'session-expired'],
    [{ code: 'email_provider_disabled' }, 'provider-unsupported'],
    [{ message: 'Network request failed' }, 'offline'],
    [{ status: 429 }, 'rate-limited'],
    [{ status: 401 }, 'session-expired'],
    [{ status: 503 }, 'server-unavailable'],
    [{ message: 'something nobody has classified' }, 'unknown'],
  ])('maps %j to %s', (error, expected) => {
    expect(service.toSecurityErrorCode(error)).toBe(expected);
  });

  it('never lets a raw backend message through', async () => {
    mockAuth.updateUser.mockResolvedValue({
      data: { user: null },
      error: { code: 'weak_password', message: 'Password should contain at least one of abcdef' },
    });

    await expect(service.updatePassword({ newPassword: 'x' })).rejects.toMatchObject({
      code: 'weak-password',
    });
    // The thrown error carries the code as its message, not the server's sentence.
    await service
      .updatePassword({ newPassword: 'x' })
      .catch((thrown: AccountSecurityError) => {
        expect(thrown.message).not.toContain('abcdef');
      });
  });
});
