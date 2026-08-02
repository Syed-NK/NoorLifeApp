/**
 * The account-security contract: what the Privacy & Security screens are allowed to know.
 *
 * ── Why this exists beside `auth-service.contract.ts` rather than inside it ──
 * `src/services/auth/auth.service.ts` is design-locked — `protected-files.test.ts` asserts it
 * byte-for-byte against the branch point, and adding an email change or a scoped sign-out to it
 * would be exactly the edit that lock exists to catch. Weakening the lock to fit this phase would
 * trade a permanent guarantee for a session's convenience.
 *
 * The separation is also the better architecture. `auth.service.ts` owns *establishing* a session:
 * signing up, signing in, recovering a password nobody can remember. This owns *managing an
 * account that already has one*: what the credential is, what address it is attached to, and how
 * to end a session everywhere. The two have different failure vocabularies, which is why they have
 * different error unions.
 *
 * ── Nothing here carries a secret ───────────────────────────────────────────
 * `AccountSecuritySummary` is the complete set of facts the screens may render, and every field on
 * it is either a display string the user already knows or a state word. There is deliberately no
 * user id, no access or refresh token, no provider token, no Supabase project reference and no raw
 * metadata bag — the shape is an allow-list, so a fifth field cannot arrive by accident. A test
 * asserts the key set.
 *
 * Passwords appear in exactly one place: as an argument to `updatePassword`. They are never stored
 * on a returned object, never logged, and never attached to a diagnostic report.
 */

/**
 * How the current session was established.
 *
 * `unknown` is a first-class answer, not a defect. Supabase reports the provider in
 * `app_metadata.provider`, and anything that is not one of the three methods this application
 * implements resolves here. The screens then say so, or omit the row — telling a Google user they
 * signed in with Email would be an invented claim about their own credentials, and "email" is
 * precisely the plausible default a careless implementation falls back to.
 */
export type AccountProvider = 'email' | 'google' | 'apple' | 'unknown';

/**
 * Whether the authenticated address has been confirmed.
 *
 * Three states rather than a boolean, because "we could not read it" and "it is not confirmed" are
 * different things to tell somebody about their own account. A boolean would collapse them, and
 * the collapse always lands on the alarming side.
 */
export type EmailVerificationState = 'verified' | 'not-verified' | 'unknown';

/**
 * Everything the account-security surfaces may display. The complete list.
 *
 * @see ACCOUNT_SECURITY_SUMMARY_FIELDS — the same set as data, asserted by test.
 */
export type AccountSecuritySummary = {
  readonly provider: AccountProvider;
  /** The authenticated address, or null when the session reports none. Never a placeholder. */
  readonly email: string | null;
  readonly emailVerification: EmailVerificationState;
  /**
   * The last sign-in, ISO-8601, or null.
   *
   * Null whenever the identity provider did not report one. A "last seen" line that quietly falls
   * back to "now" is a fabricated security fact, and this is a security screen.
   */
  readonly lastSignInAt: string | null;
  /**
   * Whether NoorLife holds a password for this account at all.
   *
   * False for a social identity: the credential belongs to Google or Apple, and no form on this
   * device can change it. Drives whether a password form is drawn — never a disabled one.
   */
  readonly canManagePassword: boolean;
  /**
   * An address awaiting confirmation, when Supabase reports one in `new_email`.
   *
   * Present only between requesting a change and confirming it. This is what lets the screen show
   * a pending state that survives leaving and returning, rather than one held in component state
   * that a navigation would discard.
   */
  readonly pendingEmail: string | null;
};

/** The complete field set, as data, so the allow-list is inspectable and testable. */
export const ACCOUNT_SECURITY_SUMMARY_FIELDS = [
  'provider',
  'email',
  'emailVerification',
  'lastSignInAt',
  'canManagePassword',
  'pendingEmail',
] as const satisfies readonly (keyof AccountSecuritySummary)[];

/**
 * Every failure these screens have to render.
 *
 * A closed union rather than free text, for the same reason `AuthErrorCode` is one: a raw backend
 * message can carry internals, and a screen that renders whatever it was handed will eventually
 * render something it should not. Mapping happens once, in the service.
 */
export type SecurityErrorCode =
  /** No usable connection. */
  | 'offline'
  /** The supplied credential was rejected. */
  | 'invalid-credentials'
  /** The new password does not meet the backend's policy. */
  | 'weak-password'
  /**
   * The new password is the current one.
   *
   * Only ever produced when Supabase says so (`same_password`). This app cannot detect it locally
   * — it does not hold the old password — and must not imply that it can.
   */
  | 'same-password'
  /**
   * The session is too old for a credential change and Supabase requires a fresh proof.
   *
   * Raised by the backend, never guessed. See `sendReauthenticationCode`.
   */
  | 'reauthentication-required'
  /** The emailed reauthentication code was wrong, expired or missing. */
  | 'invalid-reauthentication-code'
  | 'invalid-email'
  /**
   * The address is already attached to an account.
   *
   * Supabase decides whether to report this at all — with confirmations on it deliberately does
   * not, so as not to turn the form into an account-existence oracle. This code is rendered with
   * wording that does not widen what the backend was willing to say.
   */
  | 'email-already-used'
  | 'rate-limited'
  | 'session-expired'
  /** The provider does not support this operation — a social identity, or a disabled email provider. */
  | 'provider-unsupported'
  | 'server-unavailable'
  /** No Supabase URL or publishable key in this build. */
  | 'not-configured'
  | 'unknown';

export class AccountSecurityError extends Error {
  readonly code: SecurityErrorCode;

  constructor(code: SecurityErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AccountSecurityError';
    this.code = code;
  }
}

/**
 * What a global sign-out actually achieved.
 *
 * ── Why this is an outcome and not a thrown error ───────────────────────────
 * `supabase-js` removes the local session *before* returning a failed global sign-out — see
 * `_signOut`, which calls `removeCurrentSession()` on the error path for every scope except
 * `others`. So a failed "sign out everywhere" leaves the user genuinely signed out here and
 * genuinely uncertain elsewhere, and neither "it worked" nor "it failed" describes that.
 *
 * Modelling it as two successes-with-different-scope is what lets the screen say the true thing:
 * you are signed out on this device, and we could not confirm the others.
 */
export type GlobalSignOutOutcome =
  | { readonly status: 'signed-out-everywhere' }
  | { readonly status: 'local-only'; readonly code: SecurityErrorCode };

/**
 * What requesting an email change achieved.
 *
 * `pending` is the only success. Supabase does not change the authenticated address on request —
 * it sends a confirmation, and with Secure Email Change enabled it sends one to *both* addresses.
 * A screen that reported "email updated" here would be describing something that has not happened
 * yet and may never happen.
 */
export type EmailChangeOutcome = {
  readonly status: 'pending';
  /** The normalized address the confirmation was sent to. */
  readonly requestedEmail: string;
};

/**
 * The seam the screens depend on.
 *
 * ── Why an interface when there is exactly one implementation ───────────────
 * Three of the states this feature must render are unreachable without changing a real account:
 * a social identity, a session old enough that Supabase demands reauthentication, and a global
 * sign-out whose remote half failed. The alternative to injecting them is either shipping without
 * having seen them, or altering a genuine test account's credentials to take a screenshot — and
 * the phase brief forbids the second explicitly.
 *
 * So the screens accept a port and default to the real service. Production passes nothing. Tests
 * and the capture harness pass a fixture that returns the state under examination and performs no
 * network call at all, which is also what makes "no real password or email was changed" a
 * verifiable claim rather than an assurance.
 */
export type AccountSecurityPort = {
  readSummary(): Promise<AccountSecuritySummary>;
  sendReauthenticationCode(): Promise<void>;
  updatePassword(input: { readonly newPassword: string; readonly nonce?: string }): Promise<void>;
  requestEmailChange(newEmail: string): Promise<EmailChangeOutcome>;
  signOutThisDevice(): Promise<void>;
  signOutEverywhere(): Promise<GlobalSignOutOutcome>;
};
