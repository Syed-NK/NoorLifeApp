import * as AppleAuthentication from 'expo-apple-authentication';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';
import type { Session as SupabaseSession, Subscription } from '@supabase/supabase-js';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

import { AuthError, type AuthErrorCode } from './auth-service.contract';

/**
 * The Supabase-backed authentication service.
 *
 * Presentation never imports `supabase` directly — it calls these functions, which own every network
 * call and translate every failure into the closed `AuthErrorCode` union the screens render. That is
 * what keeps a raw server message from ever reaching the UI.
 *
 * ── Nothing here is simulated ───────────────────────────────────────────────
 * No function returns a fabricated success. Where a provider is not configured, the call rejects with
 * `provider-not-configured` rather than pretending; where Supabase itself is not configured, every
 * call rejects with `not-configured`. The app stays buildable and the screens stay honest.
 *
 * ── What may be logged ──────────────────────────────────────────────────────
 * In development only, a failed call logs its operation name, HTTP status, provider code and message —
 * enough to identify a fault without a round trip to the dashboard. Never the request payload, the
 * session, an access or refresh token, a password, an OTP or the publishable key. Silent in production.
 */

/**
 * The deep link Supabase returns to, built from the scheme already declared in app.json.
 *
 * Resolved lazily and memoized rather than computed at module scope. `makeRedirectUri` reads the
 * expo-constants manifest, which does not exist under Jest, so evaluating it on import threw as soon
 * as anything transitively imported this module — including screens that never touch authentication.
 * Deferring it means importing the service is always safe and only *calling* a provider flow needs a
 * manifest, which is the only place one is genuinely required.
 */
let cachedRedirect: string | null = null;
function redirectTo(): string {
  if (cachedRedirect === null) {
    cachedRedirect = AuthSession.makeRedirectUri({ scheme: 'noorlifeapp' });
  }
  return cachedRedirect;
}

export type AuthUser = {
  readonly id: string;
  readonly email: string | null;
  readonly fullName: string | null;
  readonly avatarUrl: string | null;
  readonly emailConfirmed: boolean;
};

export type ProfileRow = {
  readonly id: string;
  readonly full_name: string | null;
  readonly avatar_url: string | null;
  readonly onboarding_completed: boolean;
};

function requireClient() {
  if (!isSupabaseConfigured || supabase === null) {
    throw new AuthError(
      'not-configured',
      'Supabase is not configured. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.',
    );
  }
  return supabase;
}

/**
 * Maps a Supabase error to the closed union the UI renders.
 *
 * Matching is on status code first and then on the stable parts of the message. Supabase does not
 * expose a machine-readable code for every case, so the message check is unavoidable — but it is
 * confined to this one function rather than spread across the screens.
 */
export function toAuthErrorCode(error: unknown): AuthErrorCode {
  if (error instanceof AuthError) {
    return error.code;
  }
  const status = typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status: unknown }).status) : undefined;
  const raw =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message: unknown }).message)
      : '';
  const message = raw.toLowerCase();
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  /**
   * Explicit codes first, fuzzy message matching second.
   *
   * The original order put a broad `message.includes('expired')` above the JWT check, so
   * `PGRST301 "JWT expired"` was classified as an expired OTP. Codes are unambiguous where they exist,
   * so they decide before any substring test gets a chance to be greedy.
   */
  switch (code) {
    // A base URL carrying a path makes supabase-js request endpoints that do not exist. This is the
    // fault that reported itself as "Something went wrong on our side" — local misconfiguration, not
    // an outage, and no amount of retrying would have helped.
    case 'PGRST125':
      return 'not-configured';
    // Postgres permission denied, and a missing or rejected JWT. The caller is not authorised for what
    // it asked, which is a session problem.
    case '42501':
    case 'PGRST301':
      return 'session-expired';
    case 'email_address_invalid':
      return 'invalid-email';
    case 'email_not_confirmed':
      return 'email-not-confirmed';
    case 'user_already_exists':
    case 'email_exists':
      return 'email-already-registered';
    case 'weak_password':
      return 'weak-password';
    case 'otp_expired':
      return 'expired-otp';
    // Separated deliberately: the email quota is hourly and needs a project change, while a request
    // rate limit clears in seconds. Collapsing them told the user to wait a minute for something a
    // minute could not fix.
    case 'over_email_send_rate_limit':
      return 'email-rate-limited';
    case 'over_request_rate_limit':
      return 'rate-limited';
    case 'validation_failed':
      return 'invalid-email';
    default:
      break;
  }

  if (message.includes('network request failed') || message.includes('failed to fetch')) {
    return 'offline';
  }
  if (message.includes('email rate limit')) {
    return 'email-rate-limited';
  }
  if (status === 429 || message.includes('rate limit') || message.includes('too many requests')) {
    return 'rate-limited';
  }
  if (message.includes('invalid path specified') || (status === 404 && message.includes('path'))) {
    return 'not-configured';
  }
  if (status === 401) {
    return 'session-expired';
  }
  if (message.includes('email not confirmed') || message.includes('not confirmed')) {
    return 'email-not-confirmed';
  }
  if (message.includes('invalid login credentials')) {
    return 'invalid-credentials';
  }
  if (message.includes('already registered') || message.includes('already been registered')) {
    return 'email-already-registered';
  }
  if (message.includes('password should be') || message.includes('weak password')) {
    return 'weak-password';
  }
  // Session before OTP: a JWT message also contains "expired", and misreading it as a bad code would
  // send the user to re-enter a verification code they were never asked for.
  if (message.includes('jwt') || (message.includes('session') && message.includes('expired'))) {
    return 'session-expired';
  }
  if (message.includes('token has expired') || message.includes('expired')) {
    return message.includes('recovery') || message.includes('reset') ? 'expired-reset-link' : 'expired-otp';
  }
  if (message.includes('invalid') && (message.includes('otp') || message.includes('token'))) {
    return 'incorrect-otp';
  }
  // Covers both "unable to validate email address" and Supabase's "Email address "x" is invalid".
  if (
    message.includes('unable to validate email') ||
    message.includes('invalid email') ||
    (message.includes('email address') && message.includes('invalid'))
  ) {
    return 'invalid-email';
  }
  return 'server-error';
}

/**
 * Development-only diagnostic for a failed Supabase call.
 *
 * Logs the classification and nothing else: status, provider code and message. Deliberately never the
 * payload, the session, the access or refresh token, the password, the OTP or the publishable key —
 * a log line is the easiest place for a credential to escape, and the message alone is what identifies
 * the fault. Silent in production.
 */
function logAuthFailure(operation: string, error: unknown): void {
  if (!__DEV__) {
    return;
  }
  const read = (key: string): string | undefined => {
    if (typeof error === 'object' && error !== null && key in error) {
      const value = (error as Record<string, unknown>)[key];
      return value === undefined || value === null ? undefined : String(value);
    }
    return undefined;
  };
  const parts = [
    `op=${operation}`,
    read('status') === undefined ? null : `status=${read('status')}`,
    read('code') === undefined ? null : `code=${read('code')}`,
    read('name') === undefined ? null : `name=${read('name')}`,
    `mapped=${toAuthErrorCode(error)}`,
    read('message') === undefined ? null : `message="${read('message')}"`,
  ].filter((part): part is string => part !== null);
  console.warn(`[auth] ${parts.join(' ')}`);

  /**
   * Actionable hints for faults that are configuration rather than code.
   *
   * These go to the developer, not to the user: the on-screen copy stays short and human, while the
   * console says which dashboard setting to change. Without this the email quota reads as a mystery —
   * the request is correct, the server is healthy, and the button still cannot succeed.
   */
  const hint: Partial<Record<AuthErrorCode, string>> = {
    'email-rate-limited':
      "Supabase's built-in email service allows only a few messages per hour. Configure custom SMTP (Authentication -> Emails -> SMTP Settings), or turn off Confirm email (Authentication -> Providers -> Email) while developing.",
    'not-configured':
      'Check EXPO_PUBLIC_SUPABASE_URL is the project origin with no path, and restart Metro with --clear so the new value is inlined into the bundle.',
    'provider-not-configured':
      'Enable the provider in Authentication -> Providers and add the redirect URL Supabase should return to.',
  };
  const advice = hint[toAuthErrorCode(error)];
  if (advice !== undefined) {
    console.warn(`[auth] hint: ${advice}`);
  }
}

function fail(error: unknown, operation = 'unknown'): never {
  logAuthFailure(operation, error);
  throw new AuthError(toAuthErrorCode(error));
}

function toUser(session: SupabaseSession | null): AuthUser | null {
  const user = session?.user;
  if (user === undefined) {
    return null;
  }
  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const read = (key: string): string | null => {
    const value = meta?.[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };
  return {
    id: user.id,
    email: user.email ?? null,
    fullName: read('full_name'),
    avatarUrl: read('avatar_url'),
    emailConfirmed: user.email_confirmed_at !== null && user.email_confirmed_at !== undefined,
  };
}

// ── email and password ──────────────────────────────────────────────────────

/**
 * Creates an account and sends the six-digit confirmation.
 *
 * `full_name` goes into `options.data`, which lands in `raw_user_meta_data` — exactly where the
 * `handle_new_user` trigger reads it from to populate `public.profiles`. That is why the profile is
 * created by the database rather than by a second client call that could fail independently.
 */
export async function signUpWithEmail(input: {
  fullName: string;
  email: string;
  password: string;
}): Promise<{ user: AuthUser | null; needsConfirmation: boolean }> {
  const client = requireClient();
  const { data, error } = await client.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: {
      data: { full_name: input.fullName.trim() },
      emailRedirectTo: redirectTo(),
    },
  });
  if (error !== null) {
    fail(error, 'signUp');
  }
  // With confirmations on, Supabase returns a user but no session. That absence *is* the signal that
  // verification is required — not an error.
  return { user: toUser(data.session), needsConfirmation: data.session === null };
}

export async function signInWithEmail(email: string, password: string): Promise<AuthUser> {
  const client = requireClient();
  const { data, error } = await client.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  if (error !== null) {
    fail(error, 'signInWithPassword');
  }
  const user = toUser(data.session);
  if (user === null) {
    throw new AuthError('server-error');
  }
  return user;
}

export async function signOut(): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.signOut();
  if (error !== null) {
    fail(error, 'signOut');
  }
}

/**
 * Requests a password-reset email.
 *
 * Resolves even when the address has no account. Supabase behaves this way by design and the UI must
 * not undo it: a different outcome for a registered address turns this form into an account-existence
 * oracle.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
    redirectTo: redirectTo(),
  });
  // A rate limit is worth surfacing — it is about the caller, not about whether the account exists.
  if (error !== null && toAuthErrorCode(error) === 'rate-limited') {
    fail(error, 'resetPasswordForEmail');
  }
}

/** Sets a new password for the session established by the reset link. */
export async function updatePassword(newPassword: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error !== null) {
    fail(error, 'updateUser');
  }
}

export async function resendVerificationEmail(email: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.resend({ type: 'signup', email: email.trim() });
  if (error !== null) {
    fail(error, 'resend');
  }
}

/** Confirms a signup with the emailed six-digit code. */
export async function verifyOtp(email: string, token: string): Promise<AuthUser> {
  const client = requireClient();
  const { data, error } = await client.auth.verifyOtp({
    email: email.trim(),
    token,
    type: 'signup',
  });
  if (error !== null) {
    fail(error, 'verifyOtp');
  }
  const user = toUser(data.session);
  if (user === null) {
    throw new AuthError('incorrect-otp');
  }
  return user;
}

/**
 * Completes a reset deep link by exchanging its code for a session.
 *
 * Native has `detectSessionInUrl` off, so this is the explicit hand-off the deep-link handler makes.
 */
export async function exchangeCodeForSession(code: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.exchangeCodeForSession(code);
  if (error !== null) {
    fail(error, 'exchangeCodeForSession');
  }
}

// ── providers ───────────────────────────────────────────────────────────────

/**
 * Google, through Supabase's OAuth provider and an Expo web-auth session.
 *
 * No Google client secret is involved: the mobile app opens Supabase's authorize URL, Supabase holds
 * the secret server-side, and the browser returns a code to our scheme. A secret in the APK would be
 * readable by anyone who unzipped it.
 *
 * Rejects with `provider-not-configured` until the provider is enabled in Supabase — which is a
 * dashboard action this code cannot perform, so it is reported rather than assumed.
 */
export async function signInWithGoogle(): Promise<void> {
  const client = requireClient();
  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: redirectTo(), skipBrowserRedirect: true },
  });
  if (error !== null) {
    // Supabase answers 400 for a provider that is not enabled.
    throw new AuthError('provider-not-configured');
  }
  if (data.url === null || data.url === undefined) {
    throw new AuthError('provider-not-configured');
  }

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo());
  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw new AuthError('provider-cancelled');
  }
  if (result.type !== 'success') {
    throw new AuthError('provider-failed');
  }
  const code = new URL(result.url).searchParams.get('code');
  if (code === null) {
    throw new AuthError('provider-failed');
  }
  await exchangeCodeForSession(code);
}

/**
 * Apple, through the native flow where it exists.
 *
 * `signInWithIdToken` is the supported path for a native Apple credential — it hands Supabase the
 * identity token Apple already signed, so no Apple private key is needed in the app or the repo.
 *
 * Unsupported platforms reject rather than fall back to web OAuth, because that flow is not
 * configured; offering it would produce a dead end.
 */
export async function signInWithApple(): Promise<void> {
  const client = requireClient();
  if (Platform.OS !== 'ios' || !(await AppleAuthentication.isAvailableAsync())) {
    throw new AuthError('provider-not-configured');
  }

  let identityToken: string | null = null;
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    identityToken = credential.identityToken;
  } catch (thrown) {
    const code = typeof thrown === 'object' && thrown !== null && 'code' in thrown ? String((thrown as { code: unknown }).code) : '';
    throw new AuthError(code === 'ERR_REQUEST_CANCELED' ? 'provider-cancelled' : 'provider-failed');
  }
  if (identityToken === null) {
    throw new AuthError('provider-failed');
  }

  const { error } = await client.auth.signInWithIdToken({
    provider: 'apple',
    token: identityToken,
  });
  if (error !== null) {
    throw new AuthError('provider-not-configured');
  }
}

// ── session ─────────────────────────────────────────────────────────────────

export async function getSession(): Promise<AuthUser | null> {
  if (!isSupabaseConfigured || supabase === null) {
    return null;
  }
  const { data, error } = await supabase.auth.getSession();
  if (error !== null) {
    return null;
  }
  return toUser(data.session);
}

/** Subscribes to sign-in, sign-out and token-refresh. Returns an unsubscribe function. */
export function subscribeToAuthChanges(listener: (user: AuthUser | null) => void): () => void {
  if (!isSupabaseConfigured || supabase === null) {
    return () => undefined;
  }
  const {
    data: { subscription },
  }: { data: { subscription: Subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    listener(toUser(session));
  });
  return () => {
    subscription.unsubscribe();
  };
}

// ── profile ─────────────────────────────────────────────────────────────────

/** Reads the caller's own profile. RLS makes any other row invisible, so no filter is a loophole. */
export async function getProfile(userId: string): Promise<ProfileRow | null> {
  const client = requireClient();
  const { data, error } = await client
    .from('profiles')
    .select('id, full_name, avatar_url, onboarding_completed')
    .eq('id', userId)
    .maybeSingle();
  if (error !== null) {
    fail(error, 'select profiles');
  }
  return (data as ProfileRow | null) ?? null;
}

export async function setOnboardingCompleted(userId: string): Promise<void> {
  const client = requireClient();
  const { error } = await client
    .from('profiles')
    .update({ onboarding_completed: true })
    .eq('id', userId);
  if (error !== null) {
    fail(error, 'update profiles');
  }
}

/** The redirect URI Supabase must be configured to allow. Surfaced for the setup checklist. */
export function getRedirectUri(): string {
  return redirectTo();
}
