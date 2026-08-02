import {
  AccountSecurityError,
  type AccountSecurityPort,
  type AccountSecuritySummary,
} from '@services/account/account-security.contract';

/**
 * The account-security states a real account cannot safely be put into.
 *
 * ── Why this file is here and not under `src/app` ───────────────────────────
 * Phase 6C-3A reached these states through a fixture *screen* at
 * `/profile/privacy-security/fixtures`, guarded by `if (!__DEV__) return <Redirect …>`. That guard
 * makes the harness unreachable; it does not remove it. Metro follows the route file's top-level
 * import unconditionally, so the harness, its five state names and its fixture address were all
 * compiled into the release bundle — and the previous report's claim that `__DEV__` excluded them
 * was wrong. A grep of the built bundle disproved it.
 *
 * The route and the screen are gone. What is worth keeping is the part that was never the problem:
 * the five *states*, as data. They live here, outside `src/app` and outside `src/features`, so
 * Expo Router cannot route to them and no production module can import them without failing
 * `privacy-security-fixture-isolation.test.ts`. Jest imports them directly, which is the only
 * consumer they ever needed — the states are now proven by render tests instead of by a screen
 * somebody has to open.
 *
 * ── Nothing here performs a network call ────────────────────────────────────
 * Every method resolves or rejects in memory. There is no Supabase client, no `fetch`, and no
 * credential of any kind: `FIXTURE_EMAIL` is an `example.com` address, which RFC 2606 reserves for
 * exactly this and which cannot receive mail.
 */

/** Reserved by RFC 2606. Not a real mailbox, and deliberately not a real provider's domain. */
export const FIXTURE_EMAIL = 'fixture.user@example.com';

export const FIXTURE_BASE_SUMMARY: AccountSecuritySummary = {
  provider: 'email',
  email: FIXTURE_EMAIL,
  emailVerification: 'verified',
  lastSignInAt: '2026-08-01T08:30:00.000Z',
  canManagePassword: true,
  pendingEmail: null,
};

/** A port that performs nothing. Every method resolves locally or rejects with a mapped code. */
export function inertAccountSecurityPort(
  summary: Partial<AccountSecuritySummary> = {},
  overrides: Partial<AccountSecurityPort> = {},
): AccountSecurityPort {
  return {
    readSummary: () => Promise.resolve({ ...FIXTURE_BASE_SUMMARY, ...summary }),
    sendReauthenticationCode: () => Promise.resolve(),
    updatePassword: () => Promise.resolve(),
    requestEmailChange: (newEmail) =>
      Promise.resolve({ status: 'pending' as const, requestedEmail: newEmail }),
    signOutThisDevice: () => Promise.resolve(),
    signOutEverywhere: () => Promise.resolve({ status: 'signed-out-everywhere' as const }),
    ...overrides,
  };
}

/** A Google identity: the credential belongs to the provider, so no form is drawn. */
export const socialIdentityPort = () =>
  inertAccountSecurityPort({ provider: 'google', canManagePassword: false });

/** GoTrue answering `reauthentication_needed`, which is the only trigger for the code step. */
export const reauthenticationRequiredPort = () =>
  inertAccountSecurityPort(
    {},
    { updatePassword: () => Promise.reject(new AccountSecurityError('reauthentication-required')) },
  );

/** An outstanding email confirmation. The signed-in address is unchanged. */
export const emailChangePendingPort = () =>
  inertAccountSecurityPort({ pendingEmail: 'pending.address@example.com' });

/** A global sign-out whose remote half failed. `supabase-js` still cleared the local session. */
export const globalSignOutFailurePort = () =>
  inertAccountSecurityPort(
    {},
    {
      signOutEverywhere: () =>
        Promise.resolve({ status: 'local-only' as const, code: 'offline' as const }),
    },
  );
