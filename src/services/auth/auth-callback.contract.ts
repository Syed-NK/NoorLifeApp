import type { AuthCallbackFlowName } from './auth-callback.config';

/**
 * What a callback may be, what may be said about a failed one, and what a completed one produces.
 *
 * ── The rule this whole file exists to enforce ──────────────────────────────
 * A deep link is an untrusted input that can establish a session. Everything that crosses out of the
 * callback layer therefore has to be a *closed set of state words*, not a passthrough of whatever
 * arrived. There is deliberately no field anywhere below that can hold an authorization code, an
 * access or refresh token, a flow id, a server-authored `error_description` or the callback URL
 * itself — so "the UI cannot render a secret" and "a log line cannot leak one" are properties of
 * these types rather than promises about the code.
 *
 * `auth-callback-source-scan.test.ts` reads the source to keep it that way.
 */

/**
 * Why a callback was refused, or why processing one failed.
 *
 * A closed union for the same reason `AuthErrorCode` and `SecurityErrorCode` are: a raw backend
 * message will eventually carry something internal, and a screen that renders whatever it was handed
 * will eventually render it. Mapping happens once, in `auth-callback.service.ts`.
 */
export type AuthCallbackErrorCode =
  /** The scheme is not NoorLife's. Includes `exp+noorlifeapp`, `https` and anything else. */
  | 'untrusted-scheme'
  /** An authority that is not part of the approved path. */
  | 'untrusted-host'
  /** A NoorLife URL, but not the callback path. */
  | 'unsupported-path'
  /** No code and no error — nothing to act on. */
  | 'missing-code'
  /** A code outside the approved shape, or repeated with conflicting values. */
  | 'malformed-code'
  /** A declared `type` this application does not handle, or one that is declared but disabled. */
  | 'unsupported-flow'
  /** The URL claims one flow and the authoritative exchange reports another. */
  | 'conflicting-flow'
  /** GoTrue says the link is past its lifetime. */
  | 'link-expired'
  /**
   * The link has already been used.
   *
   * Covers both halves: a callback this app already consumed, and a code whose PKCE verifier is gone
   * because the exchange that used it deleted it.
   */
  | 'link-already-used'
  /** Structurally wrong in a way none of the above describes — including fragment tokens. */
  | 'invalid-link'
  | 'offline'
  | 'server-error'
  /** No Supabase URL or publishable key in this build. */
  | 'not-configured'
  /** The exchange resolved but produced no session, so there is nothing to route on. */
  | 'session-unavailable';

/**
 * A callback that passed every structural check, ready to be exchanged.
 *
 * `code` is present here because the service needs it, and nowhere else: the value is passed straight
 * into `supabase.auth.exchangeCodeForSession` and never stored, logged, rendered or returned. The
 * *outcome* types below carry no code at all, which is what keeps it from travelling any further.
 */
export type TrustedAuthCallback = {
  readonly kind: 'callback';
  readonly code: string;
  /** Supabase's PKCE flow id, when the redirect carried one. */
  readonly flowId: string | null;
  /**
   * The flow the URL claimed.
   *
   * A **hint**. Null when the link declared nothing, which is the ordinary case for a PKCE signup
   * confirmation. Cross-checked against the exchange's own answer and never trusted on its own — see
   * `conflicting-flow`.
   */
  readonly declaredFlow: AuthCallbackFlowName | null;
};

/**
 * A callback that carried a GoTrue error instead of a code.
 *
 * An expired recovery link is the common case and it is a normal outcome, not an exception: the user
 * needs to be told to request a new one. The server's `error_description` is *not* here — only the
 * fact that one was present, so a test can assert it was seen and discarded.
 */
export type FailedAuthCallback = {
  readonly kind: 'error';
  readonly code: AuthCallbackErrorCode;
  readonly declaredFlow: AuthCallbackFlowName | null;
  /** True when the server sent a description. Its text is never retained. */
  readonly hadDescription: boolean;
};

/** A URL this application refuses to treat as a callback. */
export type RejectedAuthCallback = {
  readonly kind: 'rejected';
  readonly code: AuthCallbackErrorCode;
};

/** A URL that is not addressed to the callback at all, and is simply not ours to handle. */
export type UnrelatedUrl = {
  readonly kind: 'unrelated';
};

/**
 * The parser's four answers.
 *
 * `unrelated` is separated from `rejected` on purpose. A link to `noorlifeapp://faith/quran` is not a
 * hostile callback, it is somebody navigating; collapsing the two would make ordinary deep linking
 * raise an authentication error, and would put an error state over whatever screen the user was on.
 */
export type ParsedAuthCallback =
  | TrustedAuthCallback
  | FailedAuthCallback
  | RejectedAuthCallback
  | UnrelatedUrl;

/**
 * What processing a callback achieved.
 *
 * ── Why the flow is reported and the destination is not ─────────────────────
 * This layer establishes a session and says which flow did it. It does **not** decide where the user
 * goes: `startup-machine.ts` already holds the one authoritative post-auth decision, including the
 * rule that a signed-in account without a recorded plan choice goes to the chooser rather than Main
 * Home. A second decision here is exactly how a confirmed signup would come to bypass it.
 */
export type AuthCallbackOutcome =
  | {
      readonly status: 'signed-in';
      /** `signup` or `email-change`. Never `recovery` — that has its own status. */
      readonly flow: Exclude<AuthCallbackFlowName, 'recovery' | 'oauth'>;
      /**
       * The authoritative address, read back from `auth.users` after the exchange.
       *
       * Null when the refresh could not be completed. Never taken from a callback parameter: an
       * address on the URL is an untrusted claim, and displaying it as the account's address is the
       * one mistake the email-change flow cannot make.
       */
      readonly email: string | null;
      /**
       * An address still awaiting confirmation, from Supabase's own `new_email`.
       *
       * Non-null means Secure Email Change has one side outstanding, and the screen must say so
       * rather than reporting the change as done.
       */
      readonly pendingEmail: string | null;
    }
  | {
      readonly status: 'recovery-ready';
      /**
       * The account the recovery grant belongs to.
       *
       * Held so the Set New Password screen can refuse a grant that does not match the session it
       * finds — a stale grant plus a different live session is how a recovery screen would come to
       * change the wrong account's password.
       */
      readonly userId: string;
    }
  | {
      readonly status: 'failed';
      readonly code: AuthCallbackErrorCode;
    };

/**
 * Thrown only inside the callback layer, and carrying a mapped code.
 *
 * The message defaults to the code, so even an accidentally-logged `error.message` is a state word.
 */
export class AuthCallbackError extends Error {
  readonly code: AuthCallbackErrorCode;

  constructor(code: AuthCallbackErrorCode) {
    super(code);
    this.name = 'AuthCallbackError';
    this.code = code;
  }
}

/**
 * The seam the callback screen depends on.
 *
 * Every state the screen has to draw — expired, already used, offline, a server fault, a recovery
 * grant, a pending email change — is unreachable without a real emailed link against a real account.
 * The alternative to injecting them is shipping without having seen them, or altering a genuine test
 * account to take a screenshot, which the phase brief forbids. So the screen takes a port and
 * defaults to the real service; production passes nothing.
 */
export type AuthCallbackPort = {
  /**
   * Exchanges a trusted callback for a session, exactly once.
   *
   * Resolves with a `failed` outcome rather than rejecting: every failure here is a state the screen
   * has to render, and a rejection would invite a `catch` that renders the thrown value.
   */
  process(callback: TrustedAuthCallback): Promise<AuthCallbackOutcome>;
};
