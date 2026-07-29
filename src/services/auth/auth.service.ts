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
 * ── Nothing is logged ───────────────────────────────────────────────────────
 * No password, OTP, token or identity assertion is written to a log, a breadcrumb or an error message.
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

  if (message.includes('network request failed') || message.includes('failed to fetch')) {
    return 'offline';
  }
  if (status === 429 || message.includes('rate limit') || message.includes('too many requests')) {
    return 'rate-limited';
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
  if (message.includes('token has expired') || message.includes('otp_expired') || message.includes('expired')) {
    return message.includes('recovery') || message.includes('reset') ? 'expired-reset-link' : 'expired-otp';
  }
  if (message.includes('invalid') && (message.includes('otp') || message.includes('token'))) {
    return 'incorrect-otp';
  }
  if (message.includes('unable to validate email') || message.includes('invalid email')) {
    return 'invalid-email';
  }
  if (message.includes('session') && message.includes('expired')) {
    return 'session-expired';
  }
  if (status !== undefined && status >= 500) {
    return 'server-error';
  }
  return 'server-error';
}

function fail(error: unknown): never {
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
    fail(error);
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
    fail(error);
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
    fail(error);
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
    fail(error);
  }
}

/** Sets a new password for the session established by the reset link. */
export async function updatePassword(newPassword: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error !== null) {
    fail(error);
  }
}

export async function resendVerificationEmail(email: string): Promise<void> {
  const client = requireClient();
  const { error } = await client.auth.resend({ type: 'signup', email: email.trim() });
  if (error !== null) {
    fail(error);
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
    fail(error);
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
    fail(error);
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
    fail(error);
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
    fail(error);
  }
}

/** The redirect URI Supabase must be configured to allow. Surfaced for the setup checklist. */
export function getRedirectUri(): string {
  return redirectTo();
}
