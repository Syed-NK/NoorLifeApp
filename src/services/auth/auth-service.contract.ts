import type { UserProfile } from '@shared/models/user';

/**
 * The authentication service contract.
 *
 * Presentation never talks to a backend directly; it depends on this interface only. That
 * is what lets the entry screens be built and validated against a mock adapter now and
 * repointed at a real provider later without a screen changing.
 *
 * ── Security constraints baked into the shape ───────────────────────────────
 * • No method returns a password, and no method accepts a token from the UI layer.
 * • A successful call returns a `Session`, whose token the service layer is responsible
 *   for storing in secure storage. The UI receives the user profile only.
 * • Nothing here is logged. Implementations must not log credentials, OTPs or tokens.
 */

/** A resolved authentication attempt. */
export type Session = {
  readonly user: UserProfile;
  /**
   * Opaque access token.
   *
   * Held by the service layer and written to secure storage only. Never rendered, never
   * persisted to AsyncStorage, never logged.
   */
  readonly accessToken: string;
  /** Whether the account still needs email verification before it is usable. */
  readonly requiresEmailVerification: boolean;
};

/**
 * Every failure the entry flow has to render.
 *
 * A closed union rather than free-text messages, so each screen maps a known code to
 * locked copy instead of displaying whatever a server returned.
 */
export type AuthErrorCode =
  | 'invalid-email'
  | 'invalid-credentials'
  | 'email-already-registered'
  | 'weak-password'
  | 'passwords-do-not-match'
  | 'terms-not-accepted'
  | 'incorrect-otp'
  | 'expired-otp'
  | 'resend-cooldown'
  | 'expired-reset-link'
  | 'provider-cancelled'
  | 'provider-failed'
  | 'provider-not-configured'
  | 'offline'
  /** Signed up but the address has not been confirmed yet. */
  | 'email-not-confirmed'
  /** Supabase returned 429, or its own rate-limit message. */
  | 'rate-limited'
  /** The stored session is no longer valid and could not be refreshed. */
  | 'session-expired'
  /** No Supabase URL or publishable key in this build. */
  | 'not-configured'
  | 'server-error';

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AuthError';
    this.code = code;
  }
}

export type SocialProvider = 'google' | 'apple';

export type SignUpInput = {
  readonly fullName: string;
  readonly email: string;
  readonly password: string;
  readonly acceptedTerms: boolean;
};

export type AuthService = {
  /** Resolves the persisted session on launch, or `null` when signed out. */
  restoreSession(): Promise<Session | null>;
  signInWithEmail(email: string, password: string): Promise<Session>;
  signUpWithEmail(input: SignUpInput): Promise<Session>;
  /** Verifies the six-digit code issued by `signUpWithEmail`. */
  verifyEmail(email: string, code: string): Promise<Session>;
  /** Re-issues a verification code. Rejects with `resend-cooldown` while cooling down. */
  resendVerificationCode(email: string): Promise<void>;
  /**
   * Requests a password-reset link.
   *
   * Resolves regardless of whether the address is registered — the caller must not be
   * able to use this to discover which accounts exist.
   */
  requestPasswordReset(email: string): Promise<void>;
  /** Completes a reset using the token carried by the emailed link. */
  resetPassword(resetToken: string, newPassword: string): Promise<void>;
  signInWithProvider(provider: SocialProvider): Promise<Session>;
  signOut(): Promise<void>;
};
