import { useCallback, useState } from 'react';

import { AuthError, type AuthErrorCode } from '@services/auth/auth-service.contract';

import { authErrorCopy } from './entry-auth-copy';

/** Maps any thrown value to locked user-facing copy. */
export function describeAuthError(thrown: unknown): { code: AuthErrorCode; message: string } {
  if (thrown instanceof AuthError) {
    return { code: thrown.code, message: authErrorCopy[thrown.code] };
  }
  // Anything else is unexpected — a bug, or a transport failure the service did not classify. It is
  // reported as a server error rather than surfaced raw: an unmapped message could contain internals.
  return { code: 'server-error', message: authErrorCopy['server-error'] };
}

export type SubmitState = {
  readonly loading: boolean;
  /** Screen-level failure, for the status banner. */
  readonly error: { code: AuthErrorCode; message: string } | null;
  /** Runs an action with loading and error handling. Resolves true when it succeeded. */
  readonly run: (action: () => Promise<void>) => Promise<boolean>;
  readonly clear: () => void;
};

/**
 * Loading and error handling for one submit action.
 *
 * Every form screen needs the same three things — a busy flag, a mapped error, and a guard against
 * double submission — so they live here rather than being re-implemented per screen. The guard
 * matters: without it a second tap during a request starts a second request.
 */
export function useSubmit(): SubmitState {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: AuthErrorCode; message: string } | null>(null);

  const run = useCallback(
    async (action: () => Promise<void>) => {
      if (loading) {
        return false;
      }
      setLoading(true);
      setError(null);
      try {
        await action();
        return true;
      } catch (thrown) {
        // Never logged: a failure here can carry a credential or an OTP.
        setError(describeAuthError(thrown));
        return false;
      } finally {
        setLoading(false);
      }
    },
    [loading],
  );

  const clear = useCallback(() => setError(null), []);

  return { loading, error, run, clear };
}
