import type { UserProfile } from '@shared/models/user';

import {
  AuthError,
  type AuthService,
  type Session,
  type SignUpInput,
  type SocialProvider,
} from './auth-service.contract';
import { clearAccessToken, readAccessToken, writeAccessToken } from './session-storage';

/**
 * Mock authentication adapter.
 *
 * No backend is connected in this phase, so this stands in for one. It is a *service*, not a
 * fixture: it enforces the same validation the real provider will, applies realistic latency,
 * and can produce every failure the screens must render. That is what makes the error,
 * loading and cooldown states testable before a server exists.
 *
 * ── Deliberate omissions ────────────────────────────────────────────────────
 * • No secret, key or endpoint of any kind. None may exist in the mobile app.
 * • Nothing is logged — not credentials, not OTPs, not tokens.
 * • Google and Apple reject with `provider-not-configured`, because implying those work
 *   before they are wired would be a lie the UI then has to tell.
 *
 * Accounts live in memory for the process lifetime. The *session* is persisted, so a
 * relaunch restores it; the account list is not, which is the one place this diverges from a
 * real backend and is called out at `restoreSession`.
 */

/** Credentials that succeed, so the happy path is reachable without a server. */
const DEMO_EMAIL = 'ahmed@example.com';
const DEMO_PASSWORD = 'NoorLife2026';

/** The fixed six-digit code the mock accepts, in place of a real emailed OTP. */
const DEMO_OTP = '123456';

/** Seconds a resend must wait, matching the 00:45 countdown in the locked reference. */
export const RESEND_COOLDOWN_SECONDS = 45;

/** Minimum password length the reference's strength meter treats as acceptable. */
export const MIN_PASSWORD_LENGTH = 8;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

export type PasswordStrength = 'weak' | 'fair' | 'strong';

/**
 * Scores a password for the strength meter on Create Account and New Password.
 *
 * Length is weighted first because it is the only factor that reliably matters; character
 * classes then separate "fair" from "strong". The result is shown *before* submission, which
 * the spec requires, so this must be a pure synchronous function.
 */
export function scorePassword(password: string): PasswordStrength {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return 'weak';
  }
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (password.length >= 12 && classes >= 3) {
    return 'strong';
  }
  return classes >= 2 ? 'fair' : 'weak';
}

type Account = {
  readonly email: string;
  password: string;
  readonly profile: UserProfile;
  verified: boolean;
  lastCodeSentAt: number;
};

/** Latency band, so loading states are visible rather than instantaneous. */
const LATENCY_MS = 650;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function givenNameFrom(fullName: string): string {
  const first = fullName.trim().split(/\s+/)[0];
  return first === undefined || first.length === 0 ? 'Friend' : first;
}

function profileFor(email: string, fullName: string): UserProfile {
  return {
    id: `mock-${email}`,
    fullName,
    givenName: givenNameFrom(fullName),
    subscriptionTier: 'free',
    greeting: 'Assalamu Alaikum,',
  };
}

export function createMockAuthService(now: () => number = Date.now): AuthService {
  const accounts = new Map<string, Account>([
    [
      DEMO_EMAIL,
      {
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        profile: profileFor(DEMO_EMAIL, 'Ahmed Al-Rashid'),
        verified: true,
        lastCodeSentAt: 0,
      },
    ],
  ]);

  /** Reset tokens issued by `requestPasswordReset`, keyed by token. */
  const resetTokens = new Map<string, { email: string; issuedAt: number }>();
  const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

  let issued = 0;
  const mintToken = (): string => {
    issued += 1;
    return `mock-token-${issued}`;
  };

  const sessionFor = async (account: Account): Promise<Session> => {
    const accessToken = mintToken();
    await writeAccessToken(accessToken);
    return {
      user: account.profile,
      accessToken,
      requiresEmailVerification: !account.verified,
    };
  };

  return {
    async restoreSession() {
      const token = await readAccessToken();
      if (token === null) {
        return null;
      }
      // A real backend would exchange the token for the profile. The mock cannot, because its
      // account list does not survive the process, so it restores the demo account. This is
      // the single behaviour that will change when a backend is connected.
      const account = accounts.get(DEMO_EMAIL);
      if (account === undefined) {
        return null;
      }
      return { user: account.profile, accessToken: token, requiresEmailVerification: false };
    },

    async signInWithEmail(email, password) {
      await delay(LATENCY_MS);
      const key = email.trim().toLowerCase();
      if (!isValidEmail(key)) {
        throw new AuthError('invalid-email');
      }
      const account = accounts.get(key);
      // One error for "no such account" and "wrong password" alike: distinguishing them
      // tells an attacker which addresses are registered.
      if (account === undefined || account.password !== password) {
        throw new AuthError('invalid-credentials');
      }
      return sessionFor(account);
    },

    async signUpWithEmail(input: SignUpInput) {
      await delay(LATENCY_MS);
      const key = input.email.trim().toLowerCase();
      if (!input.acceptedTerms) {
        throw new AuthError('terms-not-accepted');
      }
      if (!isValidEmail(key)) {
        throw new AuthError('invalid-email');
      }
      if (scorePassword(input.password) === 'weak') {
        throw new AuthError('weak-password');
      }
      if (accounts.has(key)) {
        throw new AuthError('email-already-registered');
      }
      const account: Account = {
        email: key,
        password: input.password,
        profile: profileFor(key, input.fullName.trim()),
        verified: false,
        lastCodeSentAt: now(),
      };
      accounts.set(key, account);
      return sessionFor(account);
    },

    async verifyEmail(email, code) {
      await delay(LATENCY_MS);
      const account = accounts.get(email.trim().toLowerCase());
      if (account === undefined) {
        throw new AuthError('invalid-credentials');
      }
      // Codes expire after two cooldown windows, so the expired-OTP state is reachable by
      // waiting rather than by a debug switch.
      if (now() - account.lastCodeSentAt > RESEND_COOLDOWN_SECONDS * 2 * 1000) {
        throw new AuthError('expired-otp');
      }
      if (code !== DEMO_OTP) {
        throw new AuthError('incorrect-otp');
      }
      account.verified = true;
      return sessionFor(account);
    },

    async resendVerificationCode(email) {
      const account = accounts.get(email.trim().toLowerCase());
      if (account !== undefined) {
        const elapsed = now() - account.lastCodeSentAt;
        if (elapsed < RESEND_COOLDOWN_SECONDS * 1000) {
          throw new AuthError('resend-cooldown');
        }
        account.lastCodeSentAt = now();
      }
      await delay(LATENCY_MS);
    },

    async requestPasswordReset(email) {
      await delay(LATENCY_MS);
      const key = email.trim().toLowerCase();
      if (!isValidEmail(key)) {
        throw new AuthError('invalid-email');
      }
      // Resolves whether or not the account exists. Only a real account gets a usable
      // token; the caller cannot tell the difference, which is the point.
      if (accounts.has(key)) {
        resetTokens.set(`reset-${key}`, { email: key, issuedAt: now() });
      }
    },

    async resetPassword(resetToken, newPassword) {
      await delay(LATENCY_MS);
      const entry = resetTokens.get(resetToken);
      if (entry === undefined || now() - entry.issuedAt > RESET_TOKEN_TTL_MS) {
        throw new AuthError('expired-reset-link');
      }
      if (scorePassword(newPassword) === 'weak') {
        throw new AuthError('weak-password');
      }
      const account = accounts.get(entry.email);
      if (account === undefined) {
        throw new AuthError('expired-reset-link');
      }
      account.password = newPassword;
      resetTokens.delete(resetToken);
    },

    async signInWithProvider(_provider: SocialProvider) {
      await delay(300);
      // Not configured, and saying so is the honest state. The spec forbids implying
      // provider sign-in works before it is wired.
      throw new AuthError('provider-not-configured');
    },

    async signOut() {
      await clearAccessToken();
    },
  };
}

/** The demo credentials, exported so the sign-in screen can offer them as a hint. */
export const mockCredentials = {
  email: DEMO_EMAIL,
  password: DEMO_PASSWORD,
  otp: DEMO_OTP,
} as const;
