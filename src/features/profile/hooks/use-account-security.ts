import { useCallback, useEffect, useState } from 'react';

import type {
  AccountSecurityPort,
  AccountSecuritySummary,
} from '@services/account/account-security.contract';
import { accountSecurityPort } from '@services/account/account-security.service';

/**
 * The account's security facts, for the three screens that display them.
 *
 * ── Why there is a `loading` state but no `error` one ───────────────────────
 * `readSummary` resolves for every input it can receive: an unreadable session, a build with no
 * Supabase configuration and a signed-out user all produce a summary of `unknown`s and nulls
 * rather than a rejection. That is deliberate at the service, and it means the only two states a
 * consumer has to draw are "not resolved yet" and "here is what is known" — where "what is known"
 * may legitimately be very little, and each field says so on its own.
 *
 * A screen therefore never has to decide what to render for a failed read of a security fact,
 * which is exactly the decision that produces a plausible-looking guess.
 *
 * ── Refresh, and why it is manual ───────────────────────────────────────────
 * A pending email change appears in the session's `new_email` only after the user object is
 * refreshed, and requesting one is the moment that happens. `reload` is exposed so Change Email
 * can pull the new state after a successful request instead of the parent screen polling for it.
 */
export type AccountSecurityState = {
  readonly status: 'loading' | 'resolved';
  /** Null only while loading. */
  readonly summary: AccountSecuritySummary | null;
  readonly reload: () => Promise<void>;
};

export function useAccountSecurity(
  port: AccountSecurityPort = accountSecurityPort,
): AccountSecurityState {
  const [summary, setSummary] = useState<AccountSecuritySummary | null>(null);

  const read = useCallback(async () => {
    // A rejection would leave the screen on its loading state forever, so it resolves to the
    // "nothing is known" summary the service already models rather than being swallowed silently.
    const next = await port.readSummary().catch((): AccountSecuritySummary => ({
      provider: 'unknown',
      email: null,
      emailVerification: 'unknown',
      lastSignInAt: null,
      canManagePassword: false,
      pendingEmail: null,
    }));
    setSummary(next);
  }, [port]);

  useEffect(() => {
    let cancelled = false;
    void port
      .readSummary()
      .then((next) => {
        if (!cancelled) {
          setSummary(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSummary({
            provider: 'unknown',
            email: null,
            emailVerification: 'unknown',
            lastSignInAt: null,
            canManagePassword: false,
            pendingEmail: null,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [port]);

  return {
    status: summary === null ? 'loading' : 'resolved',
    summary,
    reload: read,
  };
}
