import type { AuthUser } from './auth.service';

/**
 * What asking Supabase about the current session actually told us.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect this type exists to make unrepresentable ────────────────────
 * `getSession()` returned `AuthUser | null`, and mapped two completely different facts onto `null`:
 *
 *   • "Supabase has decided there is no usable session." — a **verdict**.
 *   • "The refresh could not be attempted, because the device has no network." — an **absence of a
 *     verdict**.
 *
 * The provider then read `null` as `signed-out`, startup routing read that as "not signed in", and
 * the startup machine routed to Authentication Options. So a user in airplane mode, holding a valid
 * stored session and three thousand downloaded recitation files, was shown a sign-in screen and
 * locked out of content already on their phone.
 *
 * The information needed to tell those apart existed at the boundary and was thrown away one line
 * into the call. Nothing downstream could recover it, so nothing downstream could be fixed. This
 * union is the repair: the boundary now returns what it learned, and every caller has to say which
 * of these it is willing to act on.
 *
 * ── Why "could not ask" is not an error ────────────────────────────────────
 * `retryable-offline` is deliberately not modelled as a failure. Nothing went wrong: a device with no
 * network is a normal state, and the honest response is to fall back to locally-held authority rather
 * than to report a fault. Treating it as an error is what produced the sign-out.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export type SessionResolution =
  /** Supabase returned a live, usable session. The only outcome that authorises network calls. */
  | { readonly kind: 'authenticated'; readonly user: AuthUser }
  /**
   * Supabase looked and there is no stored session at all.
   *
   * A verdict, not an outage: the user is signed out and any offline receipt must be deleted.
   */
  | { readonly kind: 'no-session' }
  /**
   * The question could not be put to the server.
   *
   * Airplane mode, no route, DNS failure, timeout. **Not** evidence about the session, so it may
   * never delete a receipt and may never sign anybody out.
   */
  | { readonly kind: 'retryable-offline' }
  /**
   * The server rejected the credentials it was given.
   *
   * A 401, a rejected or reused refresh token, a revoked session. This is the case that must stay
   * strict: it deletes the offline receipt and routes to sign-in, because the account holder may have
   * signed out elsewhere precisely to end this device's access.
   */
  | { readonly kind: 'invalid-or-revoked' }
  /**
   * Supabase is not configured in this build, so there is nothing to ask.
   *
   * Distinct from `no-session` because it is a property of the build rather than of the user, and the
   * shell already says so plainly through `isBackendConfigured`.
   */
  | { readonly kind: 'unavailable' };

/**
 * Whether a resolution is a **verdict about the session** rather than an absence of one.
 *
 * The predicate that decides whether the offline receipt may be deleted. Only a server that actually
 * answered may end offline access; a device that could not reach one may not.
 */
export function isDefinitive(resolution: SessionResolution): boolean {
  return resolution.kind === 'no-session' || resolution.kind === 'invalid-or-revoked';
}

/**
 * Classifies whatever Supabase gave back, without letting its text escape.
 *
 * ── How the two are told apart, and why it is done by shape ────────────────
 * `supabase-js` distinguishes them itself: a failure it could not even send is an
 * `AuthRetryableFetchError`, and a failure the server returned is an `AuthApiError` carrying an HTTP
 * status. Reading `name` and `status` is therefore reading the SDK's own classification rather than
 * pattern-matching its prose — which matters, because prose is localised, reworded between releases,
 * and the one thing that must never reach a screen or a log.
 *
 * Anything unrecognised is treated as **retryable**, and that default is the safe direction: mistaking
 * a real revocation for an outage costs one launch of offline access that the next connected launch
 * corrects, while mistaking an outage for a revocation strands a user outside their own downloads.
 */
export function classifyAuthFailure(error: unknown): SessionResolution {
  const name =
    typeof error === 'object' && error !== null && 'name' in error
      ? String((error as { name: unknown }).name)
      : '';
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status: unknown }).status)
      : Number.NaN;
  /*
    GoTrue's own error code, where it supplies one. An identifier rather than prose, so reading it is
    reading the server's classification rather than pattern-matching localised wording.
  */
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';

  /* The SDK's own name for "the request never completed". */
  if (name === 'AuthRetryableFetchError') {
    return { kind: 'retryable-offline' };
  }
  /*
    A thrown `TypeError` is what a fetch rejection surfaces as in React Native — a DNS failure, a
    dropped socket, an aborted request. None of them is the server saying anything.
  */
  if (name === 'TypeError' || name === 'AbortError') {
    return { kind: 'retryable-offline' };
  }
  /*
    ── Rate limiting is not a verdict about the session ──────────────────────
    Explicit rather than left to the fall-through, because it is the case most likely to be
    misclassified by a future edit: a 429 says "not now", never "not you". Deleting a receipt on one
    would sign a user out of their own downloaded content for being too quick.
  */
  if (status === 429) {
    return { kind: 'retryable-offline' };
  }
  /*
    A 5xx is the server failing rather than judging. Stated before the 4xx branches so widening those
    can never accidentally swallow it.
  */
  if (status >= 500 && status < 600) {
    return { kind: 'retryable-offline' };
  }
  /*
    ── A rejected credential: the server looked at it and refused ─────────────
    401 and 403 on a refresh mean the token presented was not accepted. That is the case that must
    stay strict — it is how a remote sign-out reaches a device running from a receipt.
  */
  if (status === 401 || status === 403) {
    return { kind: 'invalid-or-revoked' };
  }
  /*
    ── Why 400 is no longer terminal on its own ──────────────────────────────
    This branch used to read `status === 400 || status === 401 || status === 403`, and the comment
    claimed 400 "covers a rejected or reused refresh token". It covers that **and** every other way a
    request can be malformed — a validation failure, a bad parameter, a payload the SDK and server
    disagree about. Treating all of them as revocation deletes the offline receipt and ejects a
    signed-in user on the strength of an error that said nothing about their session.

    So a 400 is terminal only when GoTrue names the reason. `code` is an SDK-assigned identifier
    rather than prose — the same reasoning that makes `name` safe to read and messages not — so this
    is reading the server's own classification instead of pattern-matching its wording.

    Anything else, including a 400 with no code, is retryable. The asymmetry is deliberate: mistaking
    a revocation for an outage costs one launch of offline access that the next connected launch
    corrects, while mistaking an outage for a revocation strands somebody outside their own downloads.
  */
  if (status === 400) {
    return TERMINAL_AUTH_CODES.has(code)
      ? { kind: 'invalid-or-revoked' }
      : { kind: 'retryable-offline' };
  }
  /* Anything unrecognised is an outage, for the reason given above. */
  return { kind: 'retryable-offline' };
}

/**
 * GoTrue error codes that genuinely mean this session is over.
 *
 * A closed set, matched exactly. Every one of them is a statement about the *credential presented*
 * rather than about the request that carried it, which is what distinguishes a revocation from a
 * malformed call. Anything absent here is treated as retryable, so adding a code is a deliberate act
 * with a test behind it rather than a widening that happens by accident.
 */
const TERMINAL_AUTH_CODES: ReadonlySet<string> = new Set([
  'refresh_token_not_found',
  'refresh_token_already_used',
  'refresh_token_revoked',
  'session_not_found',
  'session_expired',
  'user_not_found',
]);

/**
 * Whether a Supabase auth event name is an explicit end of session.
 *
 * ── Why the event is kept rather than the session ──────────────────────────
 * `onAuthStateChange` used to be collapsed to `toUser(session)`, so a `TOKEN_REFRESHED` that failed
 * and a deliberate `SIGNED_OUT` both arrived as `null` and both signed the user out. The event name is
 * the only thing that distinguishes them, and it was the one thing being discarded.
 *
 * Only `SIGNED_OUT` and `USER_DELETED` end offline access. A null session on any other event is an
 * outage, and the receipt survives it.
 */
export function isTerminalAuthEvent(event: string): boolean {
  return event === 'SIGNED_OUT' || event === 'USER_DELETED';
}

/**
 * Whether an auth event is evidence that a **server** validated this session.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The upgrade this exists to prevent, observed on a device ───────────────
 * In airplane mode the launch correctly resolved to `authority: 'offline'` — and then flipped to
 * `'online'` a few seconds later, with no network and no server contact. The diagnostic sequence
 * read `adoption=adopted authority=offline authority=online`.
 *
 * The cause is `INITIAL_SESSION`. `onAuthStateChange` emits it on subscribe, carrying whatever
 * session is **in local storage** — the very same row `getSession()` reads. It is not a server
 * answer and it is not a validation; it is a replay of a value the launch has already classified.
 * The old handler treated any non-null user as an online adoption, so that replay silently
 * upgraded a token-free offline launch into one that `isOnlineAuthenticated` reports as live —
 * which would open Content Sync, the Qur'an Edge function, Noor AI and every profile write, on a
 * device with no route to any of them.
 *
 * ── Why the list is what it is ─────────────────────────────────────────────
 * `SIGNED_IN` and `TOKEN_REFRESHED` both mean GoTrue completed an exchange with the server;
 * `USER_UPDATED` follows a successful write. Each is a fact about a round trip. `INITIAL_SESSION`
 * is a fact about a disk read, and `resolveLaunch` already owns that decision — so it is ignored
 * rather than merely demoted, because a second opinion about the initial state is exactly the
 * thing that raced.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export function isServerValidatedAuthEvent(event: string): boolean {
  return event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED';
}
