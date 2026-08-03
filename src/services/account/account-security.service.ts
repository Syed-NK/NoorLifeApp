import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { authCallbackRedirectUrl } from '@services/auth/auth-callback.config';
import { rememberPendingFlow } from '@services/auth/pending-auth-flow';
import { clearAccessToken } from '@services/auth/session-storage';

import {
  AccountSecurityError,
  type AccountProvider,
  type AccountSecurityPort,
  type AccountSecuritySummary,
  type EmailChangeOutcome,
  type EmailVerificationState,
  type GlobalSignOutOutcome,
  type SecurityErrorCode,
} from './account-security.contract';

/**
 * Account security, against the real Supabase project.
 *
 * ── What this owns that `auth.service.ts` does not ──────────────────────────
 * That file is design-locked and establishes sessions. This manages an account that already has
 * one: reading the security facts a user is entitled to see, changing the password, changing the
 * authenticated address, and ending sessions at a chosen scope. Nothing here edits the locked file
 * and nothing here weakens it — the lock stays exactly as strict as it was.
 *
 * ── Presentation never sees the client ──────────────────────────────────────
 * The Supabase client is imported here and nowhere near a screen. `profile-isolation.test.ts`
 * asserts that no file under `features/profile` references it, directly or through a component.
 *
 * ── Nothing is simulated ────────────────────────────────────────────────────
 * Every function below performs the real call or rejects. There is no branch that returns a
 * fabricated success, no locally-verified "current password correct", and no path that reports a
 * global sign-out without the server having been asked. Where a capability does not exist — a
 * password for a Google identity — the call rejects with `provider-unsupported` rather than
 * pretending to do nothing successfully.
 *
 * ── What is never logged ────────────────────────────────────────────────────
 * This module contains no logging at all. A password, an emailed nonce and an address are each
 * enough to matter on their own, and a log line is the easiest place for one to escape. The
 * classification below is returned to the caller, not printed.
 */

function requireClient() {
  if (!isSupabaseConfigured || supabase === null) {
    throw new AccountSecurityError(
      'not-configured',
      'Supabase is not configured for this build.',
    );
  }
  return supabase;
}

/**
 * Maps a Supabase failure to the closed union the screens render.
 *
 * ── Why the codes are consulted before the messages ─────────────────────────
 * GoTrue publishes a stable `code` for every case this feature cares about, and a message that
 * changes with the release. Matching on the code first means `reauthentication_needed` cannot be
 * mistaken for a generic 4xx, and `same_password` cannot be swallowed by a substring test for
 * "password". Message matching remains only as the fallback for transport failures, which carry no
 * code at all.
 *
 * Anything unrecognised becomes `unknown` rather than being surfaced raw. An unmapped backend
 * message is exactly the string that turns out to contain an internal identifier.
 */
export function toSecurityErrorCode(error: unknown): SecurityErrorCode {
  if (error instanceof AccountSecurityError) {
    return error.code;
  }

  const read = (key: string): string =>
    typeof error === 'object' && error !== null && key in error
      ? String((error as Record<string, unknown>)[key])
      : '';

  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status: unknown }).status)
      : undefined;
  const message = read('message').toLowerCase();

  switch (read('code')) {
    case 'reauthentication_needed':
    case 'insufficient_aal':
      return 'reauthentication-required';
    case 'reauthentication_not_valid':
    case 'reauth_nonce_missing':
    case 'otp_expired':
      return 'invalid-reauthentication-code';
    case 'same_password':
      return 'same-password';
    case 'weak_password':
      return 'weak-password';
    case 'invalid_credentials':
      return 'invalid-credentials';
    case 'email_exists':
    case 'user_already_exists':
    case 'identity_already_exists':
    case 'email_conflict_identity_not_deletable':
      return 'email-already-used';
    case 'email_address_invalid':
    case 'email_address_not_authorized':
    case 'validation_failed':
      return 'invalid-email';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'rate-limited';
    case 'session_not_found':
    case 'session_expired':
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
    case 'bad_jwt':
      return 'session-expired';
    case 'email_provider_disabled':
    case 'provider_disabled':
    case 'user_sso_managed':
    case 'manual_linking_disabled':
      return 'provider-unsupported';
    case 'PGRST125':
      return 'not-configured';
    default:
      break;
  }

  // Transport failures carry no GoTrue code. React Native's fetch reports exactly these two.
  if (message.includes('network request failed') || message.includes('failed to fetch')) {
    return 'offline';
  }
  if (status === 429) {
    return 'rate-limited';
  }
  if (status === 401 || status === 403) {
    return 'session-expired';
  }
  if (status !== undefined && status >= 500) {
    return 'server-unavailable';
  }
  return 'unknown';
}

/** Re-throws as the closed union. The original message never reaches a screen. */
function fail(error: unknown): never {
  throw new AccountSecurityError(toSecurityErrorCode(error));
}

/**
 * Narrows Supabase's provider string to the three methods this application implements.
 *
 * Anything else — a provider added in the dashboard, an anonymous session, a missing value —
 * becomes `unknown`, which the screens label honestly rather than guessing at.
 */
function toProvider(value: unknown): AccountProvider {
  switch (value) {
    case 'email':
      return 'email';
    case 'google':
      return 'google';
    case 'apple':
      return 'apple';
    default:
      return 'unknown';
  }
}

/**
 * The security facts for the current session.
 *
 * ── Why every unavailable value resolves rather than throws ─────────────────
 * This feeds a summary card that must render on a cold start, offline, and in a build with no
 * Supabase configuration. A rejection would leave the user with an error where an account
 * overview should be. So an unreadable session produces a summary of `unknown`s and nulls, and the
 * screen shows what it genuinely knows — which on a signed-out or unconfigured build is nothing.
 *
 * Read from the cached session, not the network: there is no round trip and no failure mode beyond
 * "not known", which is already a state every field models.
 */
export async function readAccountSecuritySummary(): Promise<AccountSecuritySummary> {
  const unknownSummary: AccountSecuritySummary = {
    provider: 'unknown',
    email: null,
    emailVerification: 'unknown',
    lastSignInAt: null,
    canManagePassword: false,
    pendingEmail: null,
  };

  if (!isSupabaseConfigured || supabase === null) {
    return unknownSummary;
  }

  const { data, error } = await supabase.auth.getSession();
  if (error !== null || data.session === null) {
    return unknownSummary;
  }

  const user = data.session.user;
  const provider = toProvider(user.app_metadata.provider);

  /**
   * Verification, from `email_confirmed_at`.
   *
   * An account with no address at all cannot be described as unverified — there is nothing to
   * verify — so that case stays `unknown` rather than being reported as a security shortfall the
   * user cannot act on.
   */
  const emailVerification: EmailVerificationState =
    typeof user.email !== 'string' || user.email.length === 0
      ? 'unknown'
      : typeof user.email_confirmed_at === 'string' && user.email_confirmed_at.length > 0
        ? 'verified'
        : 'not-verified';

  return {
    provider,
    email: typeof user.email === 'string' && user.email.length > 0 ? user.email : null,
    emailVerification,
    lastSignInAt:
      typeof user.last_sign_in_at === 'string' && user.last_sign_in_at.length > 0
        ? user.last_sign_in_at
        : null,
    /**
     * A password belongs to NoorLife only for an email identity.
     *
     * `unknown` resolves to false deliberately: offering a password form for a credential we
     * cannot confirm we hold would produce a form that fails on submit, which is worse than a
     * sentence explaining where the password actually lives.
     */
    canManagePassword: provider === 'email',
    pendingEmail:
      typeof user.new_email === 'string' && user.new_email.length > 0 ? user.new_email : null,
  };
}

/**
 * Asks Supabase to email a reauthentication nonce.
 *
 * ── When this is needed, and who decides ────────────────────────────────────
 * The project, not this code. With **Secure password change** enabled, GoTrue requires a fresh
 * proof of identity when the session was not created in the last 24 hours, and answers
 * `updateUser({ password })` with `reauthentication_needed`. That error is the *only* trigger for
 * this call — the app never predicts the requirement, because predicting it wrongly means either
 * a pointless email or a form that fails after the user has typed a password.
 *
 * The nonce goes to the confirmed address. It is a single-use capability, never persisted, and it
 * is passed straight back into `updatePassword` by the screen that collected it.
 */
export async function sendReauthenticationCode(): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.reauthenticate();
  if (error !== null) {
    fail(error);
  }
}

/**
 * Sets a new password for the signed-in account.
 *
 * ── There is no "current password" argument, and that is deliberate ─────────
 * Supabase's supported proof for a credential change is the emailed nonce, not a re-submitted old
 * password. A client cannot tell whether a project has
 * `GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD` set, so a current-password field
 * would be a control that sometimes enforces something and sometimes enforces nothing, with the
 * user unable to tell which. Worse, the obvious shortcut — signing in again with the old password
 * to "check" it — rotates the session and turns the form into a credential-testing endpoint.
 *
 * So the flow is the backend's: attempt the change; if GoTrue asks for a nonce, ask the user for
 * the one it emailed and attempt again with it. Nothing is verified locally and nothing is
 * bypassed.
 *
 * The password is passed through and never retained: no module-level variable holds it, no
 * returned object carries it, and this file contains no logging.
 */
export async function updatePassword(input: {
  readonly newPassword: string;
  /** The emailed reauthentication nonce, when one was requested. */
  readonly nonce?: string;
}): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.updateUser({
    password: input.newPassword,
    ...(input.nonce === undefined ? {} : { nonce: input.nonce }),
  });
  if (error !== null) {
    fail(error);
  }
}

/**
 * Requests a change of the authenticated address.
 *
 * ── Why this cannot resolve to "changed" ────────────────────────────────────
 * `updateUser({ email })` starts a confirmation; it does not complete one. With **Secure email
 * change** enabled — which this project has, and which this code does not disable — GoTrue sends
 * a message to the *existing* address as well as the new one, and both must be actioned. The
 * session's `email` is unchanged throughout, and `new_email` holds the pending address.
 *
 * Returning `pending` rather than void is what stops a caller from inventing a success: there is
 * no shape here that says the address moved.
 *
 * ── Auth, not `profiles` ────────────────────────────────────────────────────
 * The address lives in `auth.users`. Writing one into `public.profiles` instead would produce a
 * screen that shows the new address, a credential that still answers to the old one, and a user
 * locked out the next time they sign in. `profile.service.ts` refuses to write an email for the
 * same reason, and a test asserts neither path exists.
 */
export async function requestEmailChange(newEmail: string): Promise<EmailChangeOutcome> {
  const client = requireClient();
  const normalized = normalizeEmail(newEmail);

  const { error } = await client.auth.updateUser(
    { email: normalized },
    /**
     * Where the confirmation links come back to (added in Phase 6C-3C).
     *
     * Before this, `updateUser` was called with no `emailRedirectTo` at all, so GoTrue substituted the
     * project's Site URL: both confirmation emails pointed at a web page rather than at the
     * application, and a user who tapped one had no way to finish the change on their phone.
     *
     * The value comes from `auth-callback.config.ts` — the single declaration of the callback URL — so
     * this, `signUp`'s `emailRedirectTo` and `resetPasswordForEmail`'s `redirectTo` cannot drift apart
     * and there is one string to allow-list in the Supabase Dashboard.
     *
     * Nothing about Secure Email Change is altered by supplying a redirect. GoTrue still emails **both**
     * the current and the new address and still requires both to be actioned; this only decides where
     * each link lands.
     */
    { emailRedirectTo: authCallbackRedirectUrl(await rememberPendingFlow('email-change')) },
  );
  if (error !== null) {
    fail(error);
  }
  return { status: 'pending', requestedEmail: normalized };
}

/**
 * Trims and lower-cases an address.
 *
 * Only the two transformations that are always safe. The local part of an address is
 * case-sensitive by the RFC, but every identity provider this application talks to treats it
 * case-insensitively, and Supabase stores addresses folded — so lower-casing matches what the
 * backend will do rather than pre-empting it. Nothing else is altered: stripping dots or `+tags`
 * would silently change which mailbox the user asked for.
 */
export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Ends the session on this device only.
 *
 * ── Why this exists when `auth.service.signOut` already does ────────────────
 * That function passes no scope, and `supabase-js` defaults to `global` — so today's Log Out
 * already ends every session the account holds, on every device. That is a defensible product
 * choice, but it is not what a control labelled "Sign Out This Device" means, and a security
 * screen cannot offer two controls that do the same thing under two different promises.
 *
 * Passing `local` explicitly is the whole difference. The locked service is untouched.
 */
export async function signOutThisDevice(): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.signOut({ scope: 'local' });
  if (error !== null) {
    fail(error);
  }
  await clearAccessToken();
}

/**
 * Ends every session the account holds, on this device and elsewhere.
 *
 * ── What the SDK actually does, audited at 2.111.0 ──────────────────────────
 * `signOut({ scope: 'global' })` reaches `GoTrueClient._signOut`, which reads the current session
 * and — *only if it holds an access token* — posts to `/logout?scope=global` through the admin
 * `signOut` helper in `@supabase/auth-js`. GoTrue revokes the refresh tokens for every session on
 * the account.
 * Access tokens already issued are self-contained JWTs and are not revoked by this or any other
 * client call; the SDK states that in its own doc comment. So the achievable promise is "no other
 * device can renew", not "every other device is closed now", and the copy says exactly that.
 *
 * ── Why the session is read first ───────────────────────────────────────────
 * `_signOut` skips the network entirely when the session carries no access token, and still returns
 * `{ error: null }`. Handing that straight back would have this function report a *global* sign-out
 * that no server was ever asked about — the precise failure the outcome type exists to prevent. So
 * the token is checked here, and its absence resolves to `local-only`: the local session is cleared,
 * and nothing is claimed about the other devices, because nothing was asked.
 *
 * ── Why the result is an outcome rather than a resolve-or-throw ─────────────
 * `supabase-js` removes the local session on the failure path too: `_signOut` calls
 * `removeCurrentSession()` before returning the error for every scope except `others`. So when the
 * server cannot be reached, the user *is* signed out here and the other devices are simply
 * unknown. Throwing would invite the screen to say "that failed, you are still signed in", which
 * is false; resolving would let it say "signed out everywhere", which is also false.
 *
 * `local-only` is the honest third answer, and the screen renders it as exactly that.
 *
 * Nothing is deleted. This ends sessions; it does not touch the profile row, the onboarding
 * preference, the Faith module's stored progress or any account data.
 */
export async function signOutEverywhere(): Promise<GlobalSignOutOutcome> {
  const client = requireClient();

  const { data, error: sessionError } = await client.auth.getSession();
  const accessToken = data?.session?.access_token;
  const remoteCallIsPossible =
    sessionError === null && typeof accessToken === 'string' && accessToken.length > 0;

  if (!remoteCallIsPossible) {
    // End what can be ended here, then say only that. `local` is passed explicitly so this cannot
    // become a global claim by way of the SDK's default scope.
    await client.auth.signOut({ scope: 'local' });
    await clearAccessToken();
    return {
      status: 'local-only',
      code: sessionError === null ? 'session-expired' : toSecurityErrorCode(sessionError),
    };
  }

  const { error } = await client.auth.signOut({ scope: 'global' });

  // The Keystore copy is ours rather than the SDK's, so it is cleared on both paths — the local
  // session is gone in both, and leaving a stale token behind would be the one piece of this the
  // user could not see.
  await clearAccessToken();

  if (error !== null) {
    return { status: 'local-only', code: toSecurityErrorCode(error) };
  }
  return { status: 'signed-out-everywhere' };
}

/**
 * The real port, bound to the functions above.
 *
 * Screens take an optional `AccountSecurityPort` and fall back to this. It is the only object a
 * screen ever holds, which is what keeps the Supabase client on this side of the boundary.
 */
export const accountSecurityPort: AccountSecurityPort = {
  readSummary: readAccountSecuritySummary,
  sendReauthenticationCode,
  updatePassword,
  requestEmailChange,
  signOutThisDevice,
  signOutEverywhere,
};
