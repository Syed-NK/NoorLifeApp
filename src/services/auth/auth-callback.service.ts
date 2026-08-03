import type {
  AuthChangeEvent,
  AuthError as SupabaseAuthError,
  User,
} from '@supabase/supabase-js';

import { isSupabaseConfigured, supabase } from '@/lib/supabase';

import type { AuthCallbackFlowName } from './auth-callback.config';
import {
  type AuthCallbackErrorCode,
  type AuthCallbackOutcome,
  type AuthCallbackPort,
  type TrustedAuthCallback,
} from './auth-callback.contract';

/**
 * Turning a trusted callback into a session, exactly once.
 *
 * ── Where the authority is, and where it is not ─────────────────────────────
 * The URL is an untrusted claim; `exchangeCodeForSession` is the authority. Audited against
 * `@supabase/auth-js@2.111.0`, that call resolves the PKCE verifier **this device stored when it
 * started the flow**, splits it on `/`, and returns `data.redirectType` — `'recovery'` when the flow
 * was begun by `resetPasswordForEmail`, undefined otherwise. So "is this a password recovery?" is
 * answered by something the attacker cannot write, and the `type` parameter on the link is only ever
 * cross-checked against it.
 *
 * The same audit is why replay is not a guard this file has to invent. `_exchangeCodeForSession`
 * removes the verifier on **both** the success and the failure path, and `retrievePKCEVerifier` does
 * not fall back to the legacy key when an explicit `flowId` is given. A second exchange of the same
 * code therefore fails with `AuthPKCECodeVerifierMissingError` *before any network call*, and it maps
 * to `link-already-used`. The in-process guard below is the cheaper front half of the same rule: it
 * stops a duplicated warm-start delivery from making a second request at all.
 *
 * ── There is no `setSession` in this file ───────────────────────────────────
 * Deliberately, and permanently. Supporting a fragment-token callback would mean taking an access and
 * refresh token off an untrusted input and installing them as the session — the highest-value thing a
 * deep link could smuggle, for an implicit flow this application never requests. The parser refuses
 * those links and this file has no code path that could consume one. A source scan asserts it.
 *
 * ── What may be logged ──────────────────────────────────────────────────────
 * In development only, and only a mapped code: `[auth-callback] code=link-expired`. Never the
 * authorization code, the flow id, an access or refresh token, `error_description`, the callback URL,
 * or any part of the session. That list is exactly what a log line is the easiest place to lose.
 * Silent in production.
 */

/** Codes that have already been handed to Supabase in this process. */
const consumed = new Set<string>();

/**
 * In-flight exchanges, keyed by code.
 *
 * A promise rather than a boolean, so two deliveries of the same callback in the same tick — which is
 * what a `singleTask` re-entry plus a mounted screen can produce — both await the *same* request and
 * receive the same outcome. A boolean guard would make the second caller resolve with nothing and the
 * screen would have to invent a state for it.
 */
const inFlight = new Map<string, Promise<AuthCallbackOutcome>>();

/**
 * Clears the in-process guards.
 *
 * Exported for tests only. Not called by the application: a code that has been consumed stays
 * consumed for the life of the process, which is the whole point of the guard. Supabase's own
 * verifier deletion is what enforces it across a restart.
 */
export function resetAuthCallbackGuards(): void {
  consumed.clear();
  inFlight.clear();
}

function logCallbackFailure(code: AuthCallbackErrorCode): void {
  if (!__DEV__) {
    return;
  }
  // The mapped code and nothing else. There is no branch here that can widen it.
  console.warn(`[auth-callback] code=${code}`);
}

/**
 * Maps a Supabase failure onto the closed union.
 *
 * Reads only `code`, `name` and `status`. `message` is consulted for the two transport strings React
 * Native's fetch produces and for nothing else — a substring test against a GoTrue message is how an
 * `error_description` ends up being pattern-matched, and from there rendered.
 */
export function toCallbackErrorCode(error: unknown): AuthCallbackErrorCode {
  if (error === null || typeof error !== 'object') {
    return 'server-error';
  }
  const read = (key: string): string =>
    key in error ? String((error as Record<string, unknown>)[key] ?? '') : '';

  const name = read('name');
  if (name === 'AuthPKCECodeVerifierMissingError') {
    /**
     * No stored verifier for this code.
     *
     * Two real causes, one honest answer. Either the exchange already happened and the SDK deleted
     * the verifier — a replay — or the link was opened on a device that never started the flow. In
     * both cases the link cannot be completed here and a fresh one is the way forward, which is what
     * `link-already-used` tells the user.
     */
    return 'link-already-used';
  }
  if (name === 'AuthInvalidTokenResponseError') {
    return 'server-error';
  }
  if (name === 'AuthRetryableFetchError') {
    return 'offline';
  }

  switch (read('code')) {
    case 'otp_expired':
    case 'token_expired':
    case 'flow_state_expired':
      return 'link-expired';
    case 'flow_state_not_found':
    case 'bad_code_verifier':
    case 'refresh_token_already_used':
      return 'link-already-used';
    case 'validation_failed':
    case 'bad_json':
      return 'invalid-link';
    case 'signup_disabled':
    case 'email_provider_disabled':
    case 'provider_disabled':
      return 'unsupported-flow';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'server-error';
    case 'PGRST125':
      return 'not-configured';
    default:
      break;
  }

  const message = read('message').toLowerCase();
  if (message.includes('network request failed') || message.includes('failed to fetch')) {
    return 'offline';
  }

  const status = Number(read('status'));
  if (status === 401 || status === 403) {
    return 'link-already-used';
  }
  if (status === 404 || status === 410) {
    return 'link-expired';
  }
  if (Number.isFinite(status) && status >= 500) {
    return 'server-error';
  }
  return 'server-error';
}

function failure(code: AuthCallbackErrorCode): AuthCallbackOutcome {
  logCallbackFailure(code);
  return { status: 'failed', code };
}

/**
 * Reads `redirectType` off the exchange result, which the SDK returns but does not type.
 *
 * `exchangeCodeForSession` is declared as returning `AuthTokenResponse`, whose `data` is
 * `{ user, session }` — yet `_exchangeCodeForSession` resolves
 * `{ ...data, redirectType: redirectType ?? null }`, verified in `@supabase/auth-js@2.111.0`. The
 * value is the second half of the stored verifier (`"<verifier>/recovery"`), so it is genuine
 * device-side state rather than anything an attacker supplies.
 *
 * It is read through this one narrow accessor, and only ever as *corroboration* for the documented
 * `PASSWORD_RECOVERY` event. If a future SDK stops returning it the field simply reads `null` and the
 * event carries the decision on its own — which is why the untyped read is safe to make and why it is
 * not the primary signal.
 */
function readRedirectType(data: unknown): string | null {
  if (data === null || typeof data !== 'object' || !('redirectType' in data)) {
    return null;
  }
  const value = (data as { redirectType?: unknown }).redirectType;
  return typeof value === 'string' ? value : null;
}

/**
 * Reads the authoritative address and pending address off a refreshed user.
 *
 * Both come from `auth.users`, never from a callback parameter. That is the single rule the
 * email-change flow lives or dies by: an address on the URL is a claim, and rendering it as the
 * account's address would show a confirmed change that had not happened.
 */
function readEmailState(user: User | null): { email: string | null; pendingEmail: string | null } {
  const newEmail = (user as (User & { new_email?: string | null }) | null)?.new_email;
  return {
    email: typeof user?.email === 'string' && user.email.length > 0 ? user.email : null,
    pendingEmail: typeof newEmail === 'string' && newEmail.length > 0 ? newEmail : null,
  };
}

/**
 * Whether the URL's claim and the exchange's answer agree about the flow.
 *
 * A link that says `type=recovery` and produces a non-recovery verifier — or the reverse — is not
 * something to resolve in favour of either side. It means the parameter was edited, or a verifier
 * from a different flow was used, and completing it would run the wrong flow's routing over a real
 * session. `conflicting-flow` refuses it.
 *
 * A link that declares nothing is not a conflict: a PKCE signup confirmation ordinarily carries no
 * `type` at all.
 */
function conflicts(declared: AuthCallbackFlowName | null, isRecovery: boolean): boolean {
  if (declared === null) {
    return false;
  }
  if (declared === 'recovery') {
    return !isRecovery;
  }
  // `signup`, `magiclink`, `invite` and `email-change` all resolve to a non-recovery verifier.
  return isRecovery;
}

/**
 * Exchanges the code and reports what it achieved.
 *
 * Resolves for every input, including every failure — each one is a state the callback screen has to
 * draw, and a rejection would invite a `catch` that renders the thrown value.
 */
export async function processAuthCallback(
  callback: TrustedAuthCallback,
): Promise<AuthCallbackOutcome> {
  if (!isSupabaseConfigured || supabase === null) {
    return failure('not-configured');
  }

  const pending = inFlight.get(callback.code);
  if (pending !== undefined) {
    // The same callback delivered twice in one tick. Both callers await one request.
    return pending;
  }
  if (consumed.has(callback.code)) {
    return failure('link-already-used');
  }

  const attempt = exchange(callback).finally(() => {
    inFlight.delete(callback.code);
  });
  inFlight.set(callback.code, attempt);
  return attempt;
}

async function exchange(callback: TrustedAuthCallback): Promise<AuthCallbackOutcome> {
  const client = supabase;
  if (client === null) {
    return failure('not-configured');
  }

  /**
   * Marked before the request, not after.
   *
   * If it were marked on success, a failed exchange would leave the code re-submittable — and the
   * code is single-use at the server, so the retry could only ever fail again while looking to the
   * user like a fresh attempt. Marking first also means a crash mid-request cannot produce a second
   * live exchange of the same code.
   */
  consumed.add(callback.code);

  /**
   * The documented recovery signal, captured around the exchange.
   *
   * Supabase's published contract is the event: "A `PASSWORD_RECOVERY` event will be emitted when the
   * password recovery link is clicked" — `AuthChangeEvent` includes it and `onAuthStateChange` is the
   * supported way to observe it. `_exchangeCodeForSession` **awaits** `_notifyAllSubscribers` before
   * returning, so a subscription taken here has already fired by the time the call resolves. No
   * polling and no timing assumption.
   *
   * `INITIAL_SESSION` and `TOKEN_REFRESHED` are ignored: only the two events that describe what this
   * exchange did are recorded.
   */
  let observed: AuthChangeEvent | null = null;
  const {
    data: { subscription },
  } = client.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
      observed = event;
    }
  });

  let redirectType: string | null = null;
  try {
    /**
     * The flow id is passed when the redirect carried one.
     *
     * `retrievePKCEVerifier` consults *only* the matching slot when given a flow id, and the legacy
     * fixed key mirrors just the most recently started flow — so with two flows open (a signup
     * confirmation and a recovery, say) omitting it would submit the wrong flow's verifier and burn
     * a single-use code. This is the SDK's own documented usage.
     */
    const { data, error } = await client.auth.exchangeCodeForSession(
      callback.code,
      callback.flowId === null ? undefined : { flowId: callback.flowId },
    );

    if (error !== null) {
      return failure(toCallbackErrorCode(error as SupabaseAuthError));
    }
    if (data.session === null || data.session === undefined) {
      // The SDK models this, so it is handled rather than assumed away.
      return failure('session-unavailable');
    }
    redirectType = readRedirectType(data);
  } catch (thrown) {
    // `AuthPKCECodeVerifierMissingError` is thrown rather than returned, which is the replay path.
    return failure(toCallbackErrorCode(thrown));
  } finally {
    subscription.unsubscribe();
  }

  /**
   * Either signal is enough, and that asymmetry is on purpose.
   *
   * Failing to notice a recovery is the worse mistake: it would leave a recovery session sitting in
   * the authenticated app without ever asking for the new password the user came to set. Mistaking a
   * confirmation for a recovery costs one extra screen the user can leave. So the two signals are
   * OR-ed rather than required to agree — and where the *link* disagrees with both, `conflicts`
   * below refuses the callback outright.
   */
  const isRecovery = observed === 'PASSWORD_RECOVERY' || redirectType === 'recovery';
  if (conflicts(callback.declaredFlow, isRecovery)) {
    return failure('conflicting-flow');
  }

  if (isRecovery) {
    /**
     * A recovery grant, keyed to the account the session belongs to.
     *
     * `getUser` rather than the session's embedded user: the id is what the Set New Password screen
     * checks its grant against, and reading it from the server is what makes "this grant belongs to
     * the account you are about to change" a verified statement rather than an inherited one.
     */
    const { data, error } = await client.auth.getUser();
    if (error !== null || data.user === null) {
      return failure(error === null ? 'session-unavailable' : toCallbackErrorCode(error));
    }
    return { status: 'recovery-ready', userId: data.user.id };
  }

  /**
   * The authoritative refresh, for signup confirmation and email change alike.
   *
   * `getUser` is a network read of `auth.users`; the session's own copy is whatever was minted at
   * exchange time. For an email change the difference is the whole point — `new_email` is what says
   * whether Secure Email Change still has a side outstanding.
   *
   * A failed refresh is **not** a failed callback: the session is live and the user is signed in. It
   * degrades to nulls, and the screen says what it genuinely knows rather than guessing at an address.
   */
  const { data, error } = await client.auth.getUser();
  const user = error === null ? data.user : null;
  const { email, pendingEmail } = readEmailState(user);

  /**
   * Signup versus email change, decided by the refreshed user and never by the URL.
   *
   * A pending `new_email` means an email change is mid-flight, which is the only observable
   * difference between the two at this layer. The URL's `type` is not consulted: it has already been
   * cross-checked for conflicts, and letting it pick the flow would put an untrusted parameter in
   * charge of which screen a real session lands on.
   *
   * Both branches route through the same authoritative startup decision afterwards, so getting this
   * wrong changes the wording on one screen and cannot skip the plan chooser.
   */
  const flow: Exclude<AuthCallbackFlowName, 'recovery' | 'oauth'> =
    pendingEmail !== null || callback.declaredFlow === 'email-change' ? 'email-change' : 'signup';

  return { status: 'signed-in', flow, email, pendingEmail };
}

/**
 * The real port. Screens take an `AuthCallbackPort` and default to this.
 *
 * It is the only object a screen ever holds, which is what keeps the Supabase client on this side of
 * the boundary — `profile-isolation.test.ts`'s rule, applied to the same kind of surface.
 */
export const authCallbackPort: AuthCallbackPort = {
  process: processAuthCallback,
};
