import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import * as authService from '@services/auth/auth.service';
import type { AuthUser } from '@services/auth/auth.service';
import { AuthError, type SignUpInput } from '@services/auth/auth-service.contract';
import {
  hasCompletedOnboarding as readOnboardingFlag,
  setOnboardingCompleted as persistOnboardingFlag,
} from '@services/auth/session-storage';
import { isSupabaseConfigured } from '@/lib/supabase';
import type { UserProfile } from '@shared/models/user';

/**
 * Authentication boundary.
 *
 * The only place that knows Supabase exists. Screens consume `useAuth`/`useAuthActions` and never
 * import a service or a client, which is what keeps presentation separable from authentication.
 *
 * ── Session ownership ───────────────────────────────────────────────────────
 * Supabase owns the session and its refresh; this provider mirrors it into React state and subscribes
 * to `onAuthStateChange`, so a token refresh or a sign-out in another tab is reflected without a
 * bespoke polling loop. No token is held in component state or exposed through the context value.
 *
 * ── Onboarding ─────────────────────────────────────────────────────────────
 * The flag lives in two places on purpose. `public.profiles.onboarding_completed` is the durable
 * record for a signed-in user; a device-local flag covers the *signed-out* case, which is the one that
 * distinguishes a first launch (→ Onboarding) from a returning launch (→ Authentication Options).
 * There is no server to ask when nobody is signed in.
 */

export type SessionStatus = 'unknown' | 'signed-in' | 'signed-out';

export type AuthState = {
  readonly status: SessionStatus;
  /** Present only while `status === 'signed-in'`. */
  readonly user: UserProfile | null;
  readonly hasCompletedOnboarding: boolean;
  /** Address awaiting email confirmation, set by `signUp`. */
  readonly pendingVerificationEmail: string | null;
  /** False when this build has no Supabase URL/key, so the UI can say so plainly. */
  readonly isBackendConfigured: boolean;
};

export type AuthActions = {
  signIn(email: string, password: string): Promise<void>;
  signUp(input: SignUpInput): Promise<void>;
  verifyEmail(code: string): Promise<void>;
  resendVerificationCode(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(newPassword: string): Promise<void>;
  signInWithProvider(provider: 'google' | 'apple'): Promise<void>;
  signOut(): Promise<void>;
  completeOnboarding(): Promise<void>;
};

const UNRESOLVED: AuthState = {
  status: 'unknown',
  user: null,
  hasCompletedOnboarding: false,
  pendingVerificationEmail: null,
  isBackendConfigured: isSupabaseConfigured,
};

const AuthContext = createContext<AuthState>(UNRESOLVED);
const AuthActionsContext = createContext<AuthActions | null>(null);

/** Maps the service's user onto the profile shape the rest of the app already consumes. */
function toProfile(user: AuthUser): UserProfile {
  const full = user.fullName ?? user.email ?? 'Friend';
  const given = full.trim().split(/\s+/)[0] ?? 'Friend';
  return {
    id: user.id,
    fullName: full,
    givenName: given,
    ...(user.avatarUrl === null ? {} : { avatarUri: user.avatarUrl }),
    subscriptionTier: 'free',
    greeting: 'Assalamu Alaikum,',
  };
}

export function AuthProvider({ children }: { readonly children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(UNRESOLVED);

  /** Applies a resolved user, reading the durable onboarding flag for a signed-in one. */
  const adopt = useCallback(async (user: AuthUser | null) => {
    if (user === null) {
      const onboarded = await readOnboardingFlag();
      setState({
        status: 'signed-out',
        user: null,
        hasCompletedOnboarding: onboarded,
        pendingVerificationEmail: null,
        isBackendConfigured: isSupabaseConfigured,
      });
      return;
    }
    // An unconfirmed account is not a usable session: leaving it signed out is what stops Verify
    // Email being bypassed.
    if (!user.emailConfirmed) {
      setState({
        status: 'signed-out',
        user: null,
        hasCompletedOnboarding: await readOnboardingFlag(),
        pendingVerificationEmail: user.email,
        isBackendConfigured: isSupabaseConfigured,
      });
      return;
    }
    // The profile row is the durable record; a read failure falls back to the local flag rather than
    // blocking launch.
    const profile = await authService.getProfile(user.id).catch(() => null);
    const localFlag = await readOnboardingFlag();
    setState({
      status: 'signed-in',
      user: toProfile(user),
      hasCompletedOnboarding: profile?.onboarding_completed ?? localFlag,
      pendingVerificationEmail: null,
      isBackendConfigured: isSupabaseConfigured,
    });
  }, []);

  // Resolve once on mount, then follow Supabase's own auth events.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const user = await authService.getSession().catch(() => null);
      if (!cancelled) {
        await adopt(user);
      }
    })();

    const unsubscribe = authService.subscribeToAuthChanges((user) => {
      if (!cancelled) {
        void adopt(user);
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [adopt]);

  const { pendingVerificationEmail } = state;

  const actions = useMemo<AuthActions>(
    () => ({
      async signIn(email, password) {
        const user = await authService.signInWithEmail(email, password);
        await adopt(user);
      },
      async signUp(input) {
        const { needsConfirmation } = await authService.signUpWithEmail({
          fullName: input.fullName,
          email: input.email,
          password: input.password,
        });
        const email = input.email.trim().toLowerCase();
        if (needsConfirmation) {
          setState((previous) => ({ ...previous, pendingVerificationEmail: email }));
          return;
        }
        await adopt(await authService.getSession());
      },
      async verifyEmail(code) {
        if (pendingVerificationEmail === null) {
          throw new AuthError('server-error', 'No pending verification email.');
        }
        const user = await authService.verifyOtp(pendingVerificationEmail, code);
        await adopt(user);
      },
      async resendVerificationCode() {
        if (pendingVerificationEmail === null) {
          throw new AuthError('server-error', 'No pending verification email.');
        }
        await authService.resendVerificationEmail(pendingVerificationEmail);
      },
      async requestPasswordReset(email) {
        await authService.sendPasswordReset(email);
      },
      async resetPassword(newPassword) {
        await authService.updatePassword(newPassword);
      },
      async signInWithProvider(provider) {
        if (provider === 'google') {
          await authService.signInWithGoogle();
        } else {
          await authService.signInWithApple();
        }
        await adopt(await authService.getSession());
      },
      async signOut() {
        await authService.signOut();
        await adopt(null);
      },
      async completeOnboarding() {
        await persistOnboardingFlag();
        const id = state.user?.id;
        if (id !== undefined) {
          // Best effort: the local flag already covers routing, so a failed write must not block the
          // user from leaving onboarding.
          await authService.setOnboardingCompleted(id).catch(() => undefined);
        }
        setState((previous) => ({ ...previous, hasCompletedOnboarding: true }));
      },
    }),
    [adopt, pendingVerificationEmail, state.user?.id],
  );

  return (
    <AuthContext.Provider value={state}>
      <AuthActionsContext.Provider value={actions}>{children}</AuthActionsContext.Provider>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}

export function useAuthActions(): AuthActions {
  const actions = useContext(AuthActionsContext);
  if (actions === null) {
    throw new Error('useAuthActions was called outside AuthProvider.');
  }
  return actions;
}

/**
 * The signed-in user, or throws.
 *
 * For screens only reachable behind a session. Throwing beats a nullable return that every screen
 * then has to re-check.
 */
export function useCurrentUser(): UserProfile {
  const { user } = useAuth();
  if (user === null) {
    throw new Error('useCurrentUser was called outside an authenticated route.');
  }
  return user;
}
