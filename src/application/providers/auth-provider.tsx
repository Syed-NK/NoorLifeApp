import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import * as authService from '@services/auth/auth.service';
import type { AuthUser } from '@services/auth/auth.service';
import { AuthError, type SignUpInput } from '@services/auth/auth-service.contract';
import * as profileService from '@services/profile/profile.service';
import {
  hasCompletedOnboarding as readOnboardingFlag,
  setOnboardingCompleted as persistOnboardingFlag,
} from '@services/auth/session-storage';
import { isSupabaseConfigured } from '@/lib/supabase';
import {
  clearOfflineReceipt,
  readOfflineReceipt,
  writeOfflineReceipt,
  type OfflineIdentity,
} from '@services/auth/offline-receipt';
import { isServerValidatedAuthEvent, isTerminalAuthEvent } from '@services/auth/session-resolution';
import { setRemoteAccessAuthorised } from '@services/network/remote-access';
/*
  The connectivity boundary, reused rather than duplicated.

  It lives under Faith because that is where it was first needed, and a scan asserts it is the only
  module in the project that imports `expo-network`. Importing it here rather than adding a second
  reader keeps that guarantee intact; the port itself is feature-agnostic — three fields and a closed
  set of link kinds — so the dependency is on an interpretation of the platform, not on Faith.
*/
import type { ConnectivityPort } from '@features/faith/data/connectivity/connectivity.port';
import { createExpoConnectivity } from '@features/faith/data/connectivity/expo-connectivity.port';
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

/**
 * Where the authority for a signed-in state came from.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this is a separate field and not a fourth status ───────────────────
 * Twenty call sites already branch on `status`, and renaming `signed-in` would have rewritten every
 * one of them mechanically — turning a security review into a diff nobody can read. Keeping the
 * status and adding the authority means each of those sites is visited *deliberately*, and the
 * question asked at each is the one that matters: does this need a server, or only the device?
 *
 * ── The distinction, in one sentence each ──────────────────────────────────
 *   • `online`  — Supabase validated a live session in this launch. A network call may be made.
 *   • `offline` — this device holds a token-free receipt proving somebody signed in here. **Local
 *     data may be opened. No network call is authorised, ever.**
 *
 * An offline authority is not a weaker session; it is not a session at all. It carries no token, so
 * there is nothing it *could* authorise. Every remote operation must therefore ask for `online`
 * explicitly — `isOnlineAuthenticated` — and a bare `status === 'signed-in'` at such a site is a bug.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export type SessionAuthority = 'online' | 'offline';

export type AuthState = {
  readonly status: SessionStatus;
  /**
   * Present only while `status === 'signed-in'`, and `null` otherwise.
   *
   * Nullable rather than defaulted, so a call site that forgets to check cannot silently read a
   * signed-out state as online.
   */
  readonly authority: SessionAuthority | null;
  /** Present only while `status === 'signed-in'`. */
  readonly user: UserProfile | null;
  readonly hasCompletedOnboarding: boolean;
  /** Address awaiting email confirmation, set by `signUp`. */
  readonly pendingVerificationEmail: string | null;
  /** False when this build has no Supabase URL/key, so the UI can say so plainly. */
  readonly isBackendConfigured: boolean;
};

/**
 * Whether a live, server-validated session exists.
 *
 * **The predicate every remote operation must use.** Reading `status === 'signed-in'` instead is what
 * would let an offline launch attempt a Supabase write, a Content Sync transaction or a Noor AI
 * request — each of which would fail at the transport after the user had already been shown a
 * working control.
 */
export function isOnlineAuthenticated(state: AuthState): boolean {
  return state.status === 'signed-in' && state.authority === 'online';
}

/**
 * Whether this device may open **its own local data** for the signed-in user.
 *
 * True under either authority. The predicate for the app shell, Faith home, the Qur'an reader, the
 * downloaded recitation and every other thing that lives on the phone already.
 */
export function isLocallyAuthenticated(state: AuthState): boolean {
  return state.status === 'signed-in';
}

/** What `signUp` resolved to, so the caller can route without re-deriving it. */
export type SignUpOutcome = {
  /**
   * True when the account needs an emailed code before it can be used.
   *
   * False when the project auto-confirms: Supabase returns a live session and sends nothing, so there
   * is no code to wait for and Verify Email would sit there forever asking for one. The screen must
   * branch on this rather than assume — assuming is exactly what sent auto-confirmed signups to a
   * screen that could never complete.
   */
  readonly needsVerification: boolean;
};

export type AuthActions = {
  signIn(email: string, password: string): Promise<void>;
  signUp(input: SignUpInput): Promise<SignUpOutcome>;
  verifyEmail(code: string): Promise<void>;
  resendVerificationCode(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(newPassword: string): Promise<void>;
  signInWithProvider(provider: 'google' | 'apple'): Promise<void>;
  signOut(): Promise<void>;
  completeOnboarding(): Promise<void>;
  /**
   * Writes a new display name to the durable profile row and adopts it into shared state.
   *
   * Lives here rather than on the editing screen because `state.user` is what Main Home's greeting
   * and Profile Home's identity card render. Updating it in place is what makes a saved name
   * visible everywhere immediately, with no relaunch and no second read.
   */
  updateFullName(fullName: string): Promise<void>;
};

const UNRESOLVED: AuthState = {
  status: 'unknown',
  authority: null,
  user: null,
  hasCompletedOnboarding: false,
  pendingVerificationEmail: null,
  isBackendConfigured: isSupabaseConfigured,
};

/**
 * How long the launch will wait for the platform to say whether there is a network.
 *
 * ── Why there is a bound at all ────────────────────────────────────────────
 * `getNetworkStateAsync` normally answers in milliseconds, but "normally" is not a guarantee and the
 * startup path may not depend on one: a launch that waited indefinitely would sit on the splash
 * screen forever, which is worse than either answer.
 *
 * Two seconds, and the timeout resolves to **offline** rather than online. That direction is
 * deliberate: falling back to the receipt opens the user's own downloaded content, while guessing
 * "online" would spend the launch on a refresh that cannot complete and end at the sign-in screen —
 * the exact failure this work exists to remove.
 */
const CONNECTIVITY_TIMEOUT_MS = 2000;

/**
 * How long the launch waits for Supabase to answer before deciding without it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this bounds, and what it deliberately does not ────────────────────
 * `resolveSession()` is unbounded by design and stays that way — every other caller runs straight
 * after a user action, where waiting is the correct behaviour and a bound would abandon a sign-in
 * that was about to succeed. This bound is a property of the **launch policy**, which is this
 * provider's concern, so it lives here rather than inside the service.
 *
 * It does not cancel anything. The request keeps running and its real answer is still applied when
 * it lands (see `resolveLaunch`). What the bound stops is a network round trip *blocking a decision
 * that can already be made* — which, on a device holding a valid receipt, it can.
 *
 * ── Why a timeout is never a signed-out verdict ────────────────────────────
 * A bound firing means "we have not finished asking". It is not `no-session`, and mapping it to one
 * would be the original defect rebuilt: #34 names this explicitly, and the receipt would be cleared
 * on a flapping link. So the timeout branch has exactly two outcomes — adopt the receipt if there is
 * one, or stay `unknown` and let the startup machine hold. Never Authentication Options.
 *
 * ── Why six seconds ───────────────────────────────────────────────────────
 * The measured refresh on a live link is sub-second to about two, so six is well clear of a healthy
 * round trip and will not pre-empt one that was going to succeed. The ceiling on it is the one that
 * matters: the connectivity probe (2 s) plus this must stay under
 * `STARTUP_PRESENTATION_CEILING_MS` (10 s), so a bounded launch resolves *before* the #31 "still
 * resolving" notice would appear. That keeps the notice for launches that are genuinely unresolved
 * rather than merely slow, which is what makes it truthful. `startup-authority-latency.test.tsx`
 * asserts that relationship, so raising either value without the other fails.
 */
export const SESSION_RESOLUTION_TIMEOUT_MS = 6000;

/** A sentinel distinct from every `SessionResolution` kind, so a bound cannot be mistaken for one. */
const TIMED_OUT = Symbol('session-resolution-timed-out');

/**
 * Races a promise against a bound, clearing the timer either way.
 *
 * The handle is kept and cleared for the reason `isConfirmedOffline` records: `Promise.race` settles
 * on the first result and does not cancel the loser, so a bare `setTimeout` leaves a live timer
 * behind on every launch — which in Jest holds the environment open after the run finishes.
 */
async function withBound<T>(work: Promise<T>, ms: number): Promise<T | typeof TIMED_OUT> {
  let handle: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<typeof TIMED_OUT>((resolve) => {
    handle = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    return await Promise.race([work, bound]);
  } finally {
    if (handle !== undefined) {
      clearTimeout(handle);
    }
  }
}

/**
 * Whether the platform **positively reports no link at all**.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why the question is "confirmed offline" and not "confirmed online" ─────
 * The first version asked the opposite — proceed to Supabase only when reachability was confirmed
 * `online` — and it was wrong in a way worth recording, because it looks more careful and is less so.
 *
 * `NetworkState` has three optional fields and a platform is entitled to answer with none of them.
 * Under that reading, "will not say" and "no internet" become the same thing, so a device that is
 * perfectly online but reticent takes the offline path, never revalidates, and runs from a receipt it
 * did not need. Two hundred existing tests found this immediately: they render the real provider
 * against a mocked Supabase and an unmocked `expo-network`, and every one of them fell to
 * `signed-out`.
 *
 * Asking "is it confirmed offline" inverts the default in the right direction. Only a definite
 * `offline` — no link — skips the refresh, which is precisely what locked decision 7 forbids
 * spending: a refresh with no route can only fail. Everything else, including `link-only` and
 * silence, *tries*, and `retryable-offline` catches the failure and falls back to the receipt. The
 * end state is identical for a genuinely offline device; the difference is that an online one is no
 * longer misclassified.
 *
 * The timeout resolves to `false` for the same reason: a platform that has not answered within the
 * bound has told us nothing, and "try and classify the result" is strictly better informed than
 * "assume the worst and skip".
 * ═══════════════════════════════════════════════════════════════════════════
 */
async function isConfirmedOffline(connectivity: ConnectivityPort): Promise<boolean> {
  /*
    The handle is kept and cleared. `Promise.race` settles on the first result but does not cancel
    the loser, so a bare `setTimeout` here leaves a live two-second timer behind on every launch —
    harmless once in production, and in Jest it holds the environment open after the run finishes,
    which is reported as a leak in whatever suite happened to mount the provider last.
  */
  let handle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<false>((resolve) => {
    handle = setTimeout(() => resolve(false), CONNECTIVITY_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      /*
        `currentOrUnknown`, not `current`. The latter answers `OFFLINE_STATE` when the platform did
        not respond at all, which would make an unreadable platform indistinguishable from a device
        with no link — and skipping the refresh on that basis is precisely the mistake this launch
        path exists to avoid. `null` means "no reading", and no reading is not a verdict.
      */
      connectivity.currentOrUnknown().then((state) => state?.reachability === 'offline'),
      timeout,
    ]);
  } catch {
    return false;
  } finally {
    if (handle !== undefined) {
      clearTimeout(handle);
    }
  }
}

const AuthContext = createContext<AuthState>(UNRESOLVED);
const AuthActionsContext = createContext<AuthActions | null>(null);

/**
 * What to call somebody when nothing better is known.
 *
 * Named because two places must agree on it: `toProfile`'s last resort, and the receipt's refusal to
 * persist an address. A literal in both would drift.
 */
const NEUTRAL_DISPLAY_NAME = 'Friend';

/**
 * The name to display, or null when nothing usable is known.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The one rule, and why it is equality rather than a pattern ──────────────
 * A stored name that **is this account's own address** is not a name. It arrives that way from a build
 * before #48, which wrote the address into `profiles.full_name` and into the offline receipt, and it
 * cannot be assumed to have been chosen: nobody typed it, a fallback did.
 *
 * The test is equality with *that account's* address, trimmed and case-folded — not the presence of an
 * `@`. `profile-name.ts` is explicit that there is no character allow-list for names, because a
 * Latin-only pattern would reject أحمد, Айша, 王 and every hyphenated or accented European name; names
 * are not addresses and have no format to conform to. So `a@b` as a name is perfectly acceptable for an
 * account whose address is something else, and rejecting it would be a validation rule protecting
 * nothing. Only the collision matters.
 *
 * Case-folded and trimmed because addresses are compared that way everywhere else: `Ahmed@Example.com`
 * stored against `ahmed@example.com` is the same address, and a leading space is a paste artefact
 * rather than a distinguishing character.
 *
 * ── Why empty is here too ──────────────────────────────────────────────────
 * A whitespace-only `full_name` is the other value that is not a name, and `validateFullName` already
 * refuses it on the way *in*. Refusing it on the way out as well costs one comparison and stops a
 * greeting that reads "Assalamu Alaikum," followed by nothing.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function usableName(
  candidate: string | null | undefined,
  email: string | null | undefined,
): string | null {
  if (candidate === null || candidate === undefined) {
    return null;
  }
  const trimmed = candidate.trim();
  if (trimmed.length === 0) {
    return null;
  }
  if (
    email !== null &&
    email !== undefined &&
    trimmed.toLowerCase() === email.trim().toLowerCase()
  ) {
    return null;
  }
  return trimmed;
}

/** The first word of a name, for the Main Home greeting. Never empty. */
function givenNameOf(full: string): string {
  return full.trim().split(/\s+/)[0] ?? NEUTRAL_DISPLAY_NAME;
}

/**
 * Maps the service's user onto the profile shape the rest of the app already consumes.
 *
 * `durableFullName` is `public.profiles.full_name` and wins when it is present. The session's own
 * `user_metadata.full_name` is only ever a copy taken at signup, so once the profile row has been
 * edited the two disagree — and the row is the record. Passing null (no row, or a row with no
 * name) falls back to the session copy, which is still a real value rather than a guess.
 */
/** The durable values a receipt records, or null when this authority may not produce one. */
type ReceiptProjection = {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly hasCompletedOnboarding: boolean;
};

/**
 * The receipt this authority implies, derived rather than signalled.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why the receipt became a projection ────────────────────────────────────
 * It had two writers — one in `adopt` at publication, one in enrichment when the durable row landed —
 * and they needed to agree about *when* the values were final. That agreement was a boolean set from
 * inside a `setState` updater, which is an impure updater and a side effect controlled from a place
 * React is entitled to evaluate twice.
 *
 * A single derivation removes the question rather than answering it. The receipt records what
 * published authority already says, so there is nothing to signal between two writers: whatever the
 * state holds *is* the record, and the effect below is the only thing that persists it.
 *
 * ── Why `online` is the whole condition ────────────────────────────────────
 * A receipt asserts "this device held a real session for this user". `authority: 'online'` is set by
 * exactly one function — `adopt`, reached only after Supabase confirmed a live session — so keying on
 * it preserves the original invariant precisely: no other path can produce one.
 *
 * Offline authority is excluded deliberately. It was *read from* a receipt, so re-writing it would
 * refresh a validation timestamp on the strength of the record it came from, which is a claim about
 * nothing. Signed-out and unresolved states project null, which is what makes a sign-out inert here
 * without a second check.
 * ═══════════════════════════════════════════════════════════════════════════
 */
function receiptProjection(state: AuthState): ReceiptProjection | null {
  if (state.status !== 'signed-in' || state.authority !== 'online' || state.user === null) {
    return null;
  }
  return {
    userId: state.user.id,
    /*
      ── The address never becomes the display name ─────────────────────────────
      `toProfile`'s fallback chain ends `?? user.email ?? NEUTRAL_DISPLAY_NAME`, so an account whose
      session carries no name at all — a provider sign-in that supplies none, or a signup with no
      metadata — resolves its display name **to the address**. Persisting that put the address in the
      Keystore, which is precisely what `offline-receipt.ts` set out to stop: it *rejects* a stored
      record carrying an `email` field rather than ignoring it, so the same value arriving under
      `displayName` defeats that check by renaming the field. Worse than not having the check.

      This was equally true of the write in `adopt` before this branch existed, so it is a repair
      rather than a regression — and it heals a device that already holds such a record, because the
      projection no longer matches what is stored and the next online launch replaces it.

      The equality test is deliberately the whole condition. A profile row whose `full_name` genuinely
      *is* the address reaches the same outcome, which is also right: how the address got into the
      field does not change whether it belongs in the Keystore.
    */
    /*
      The same rule as `toProfile`, not an approximation of it. This used to compare for exact equality
      with the address, which would have missed a case or whitespace variant — and the two disagreeing
      is how an address gets persisted after being correctly refused for display.
    */
    displayName: usableName(state.user.fullName, state.user.email) ?? NEUTRAL_DISPLAY_NAME,
    avatarUrl: state.user.avatarUri ?? null,
    hasCompletedOnboarding: state.hasCompletedOnboarding,
  };
}

/** Whether a stored receipt already records exactly these durable values. */
function receiptMatches(stored: OfflineIdentity, projection: ReceiptProjection): boolean {
  return (
    stored.userId === projection.userId &&
    stored.displayName === projection.displayName &&
    stored.avatarUrl === projection.avatarUrl &&
    stored.hasCompletedOnboarding === projection.hasCompletedOnboarding
  );
}

function toProfile(user: AuthUser, durableFullName: string | null = null): UserProfile {
  /*
    ═════════════════════════════════════════════════════════════════════════
    ── The address is not a name, and there is no rung below a real one ──────
    This chain used to end `?? user.email ?? NEUTRAL_DISPLAY_NAME`, so an account that never supplied a
    name resolved its *name* to its sign-in address — and Main Home rendered that as the greeting, the
    most prominent text on the first screen. Issue #48.

    Every candidate below a genuine name is wrong, which is why there is now nothing there. The address
    is not a name. Its local part is not a name — parsing one out would be a guess dressed as data. And
    initials derived from either are a fabrication. So when no name is known the fields are **omitted**,
    and each consumer applies its own already-approved neutral: Main Home's `?? 'there'`, and the
    Profile surfaces' "not available" copy. None of them needed changing, which is the sign that absence
    was the value they were always written for.

    The address is still carried — in `email`, spread below, where it is labelled as what it is.
    ═════════════════════════════════════════════════════════════════════════
  */
  const full = usableName(durableFullName ?? user.fullName, user.email);
  return {
    id: user.id,
    ...(full === null ? {} : { fullName: full, givenName: givenNameOf(full) }),
    ...(user.avatarUrl === null ? {} : { avatarUri: user.avatarUrl }),
    // Spread rather than assigned, so a provider with no address leaves the field absent instead
    // of setting it to an empty string the Profile card would then render as a blank line.
    ...(user.email === null || user.email === undefined ? {} : { email: user.email }),
    subscriptionTier: 'free',
    greeting: 'Assalamu Alaikum,',
  };
}

export function AuthProvider({
  connectivity,
  children,
}: {
  /** Injected so a test can drive airplane mode without a device. Defaults to the real port. */
  readonly connectivity?: ConnectivityPort;
  readonly children: React.ReactNode;
}) {
  const [state, setState] = useState<AuthState>(UNRESOLVED);
  const network = useMemo(() => connectivity ?? createExpoConnectivity(), [connectivity]);

  /**
   * The single writer of authority, and where "is this still true?" is answered.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * ── The hole this closes ───────────────────────────────────────────────────
   * Taking the profile read off the critical path means a network result now lands *after* authority
   * was published, so for the first time this provider has work in flight that can arrive into a
   * different world than the one it started in. Before, every await sat inside the one function that
   * then wrote state, so "stale" could not happen; now it can, and it has to be structurally
   * impossible rather than merely unlikely.
   *
   * ── Why a predicate over `previous` and not a generation counter ─────────────
   * The first attempt at that was an epoch counter in a ref, and a ref is the wrong instrument here:
   * the actions object is built in a `useMemo`, so every function it closes over is reachable from
   * render, and `react-hooks/refs` cannot tell that these particular reads all happen after an await.
   * Moving the same counter into a mutable `useState` object only trades one correct complaint for
   * another.
   *
   * The state itself is the better authority. React hands the *current* value to a functional update,
   * so a caller with something to write can ask "is what I am about to overwrite still the thing I
   * decided about?" at the exact instant of the write — later than any counter could be sampled, and
   * with no second copy of the truth to keep in step. An unmounted provider needs no check at all:
   * React discards the update, and Strict Mode's second mount has its own state for the same reason.
   *
   * `onlyIf` omitted means unconditional, which is right for a decision the user has just taken and
   * for a server verdict that must land whatever else has happened since.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  const publish = useCallback((next: AuthState, onlyIf?: (previous: AuthState) => boolean) => {
    setState((previous) => (onlyIf === undefined || onlyIf(previous) ? next : previous));
  }, []);

  const projection = receiptProjection(state);
  /*
    A scalar key, so the effect below runs once per distinct set of durable values rather than once per
    render. The record has four fields and they are all primitives; a unit separator joins them because
    a display name may legitimately contain anything a person is called, including the characters one
    would otherwise reach for.
  */
  const projectionKey =
    projection === null
      ? null
      : [
          projection.userId,
          projection.displayName,
          projection.avatarUrl ?? '',
          String(projection.hasCompletedOnboarding),
        ].join('\u001f');

  /**
   * Persists the receipt, and is the only thing that does.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * ── What each guarantee rests on ───────────────────────────────────────────
   * **Inert on sign-out, replacement and unresolved states** — not by checking for them, but because
   * `receiptProjection` returns null for all three. A replaced account produces a *different* key, so
   * the effect re-runs for B and the in-flight attempt for A is cancelled by the cleanup below before
   * it can write. Account A's values are never in scope for account B's run.
   *
   * **Inert on unmount and cancellation** — the cleanup sets `cancelled`, and it is checked after the
   * only await that precedes the write. Strict Mode's mount / cleanup / mount therefore cancels the
   * first attempt while it is still reading, and exactly one write survives.
   *
   * **One write per real change** — the key gates re-runs within a session, and the stored-value
   * comparison gates the rest: a launch that re-publishes the same durable values, or an enrichment
   * whose row matches what the receipt already holds, reads and returns without writing.
   *
   * **A failed write changes nothing else** — it is caught and dropped. The receipt is a convenience
   * for the *next* launch; failing to refresh it must not revoke this one's authority, alter the live
   * profile, or sign anybody out. There is no retry: the next publication projects the same values and
   * the next launch will try again.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  useEffect(() => {
    if (projectionKey === null) {
      return;
    }
    /*
      Re-derived inside the effect from the key's own dependency, not captured from the render that
      queued it — so the values written are the values the key describes, and nothing else.
    */
    const [userId, displayName, avatarUrl, onboarded] = projectionKey.split('\u001f');
    if (userId === undefined || displayName === undefined) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const stored = await readOfflineReceipt();
      if (cancelled) {
        return;
      }
      const next = {
        userId,
        displayName,
        avatarUrl: avatarUrl === undefined || avatarUrl === '' ? null : avatarUrl,
        hasCompletedOnboarding: onboarded === 'true',
      };
      if (stored !== null && receiptMatches(stored, next)) {
        return;
      }
      await writeOfflineReceipt({ ...next, now: Date.now() }).catch(() => undefined);
    })();

    return () => {
      cancelled = true;
    };
  }, [projectionKey]);

  /**
   * Mirrors the authority onto the services gate, during render.
   *
   * ── Why not an effect ──────────────────────────────────────────────────────
   * React runs effects bottom-up, so every child's effect fires before this component's would. A
   * child effect that calls a remote service on mount — and several do — would therefore run
   * against whatever the flag last held, which on the first resolution after an offline launch is
   * the permissive default. The gate would be correct one commit too late, which for a gate is the
   * same as being wrong.
   *
   * `useMemo` runs during this component's render, before any child renders or commits. The write
   * is idempotent and derived entirely from `state`, so a re-render cannot change the outcome.
   * `remote-access.ts` is a mirror of this value and never a second opinion about it.
   */
  useMemo(() => {
    setRemoteAccessAuthorised(isOnlineAuthenticated(state));
  }, [state]);

  /** The signed-out state, with the local onboarding flag that decides Onboarding vs Authentication. */
  const signedOut = useCallback(
    async (pendingVerificationEmail: string | null = null): Promise<AuthState> => ({
      status: 'signed-out',
      authority: null,
      user: null,
      hasCompletedOnboarding: await readOnboardingFlag(),
      pendingVerificationEmail,
      isBackendConfigured: isSupabaseConfigured,
    }),
    [],
  );

  /**
   * Reads the durable profile row and folds it into an authority that has already been published.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * ── Not a second resolution ────────────────────────────────────────────────
   * This decides nothing. It cannot sign anyone in, cannot sign anyone out, cannot change an
   * authority and does not touch the receipt's revocation contract. It refines two display-facing
   * values on a session that was already validated, and if it never completes the launch is
   * unaffected — which is the entire point of moving it off the critical path.
   *
   * There is no retry and no loop. One read per adoption; a failure is silence, exactly as the old
   * inline `.catch(() => null)` was, and for the same reason: the local fallback is already correct.
   *
   * ── How a late answer is made inert ────────────────────────────────────────
   * One condition, checked at the instant of the write rather than before the read: the account
   * signed in **now** must still be this account. `previous.user` inside the functional update is
   * whoever is current, not whoever was current when the read began, so a sign-out leaves no user to
   * match, and an account replacement leaves a different id — which is what makes account A's row
   * unable to land under account B a property rather than a probability. An unmounted provider never
   * runs the updater at all, and Strict Mode's second mount has its own state.
   *
   * A second launch for the same account is deliberately *not* excluded: the row is still theirs, so
   * there is nothing stale about it. Whose name gets written is the only thing enrichment could get
   * wrong, and identity answers that completely.
   *
   * ── Why the same check is still sound at persistence time ──────────────────
   * It is not re-derived there. Persistence reads the **published state**, so it inherits this check
   * rather than repeating it: a row that failed the branch above changed nothing, so it contributes
   * nothing to persist. The projection can therefore only ever describe an account that is signed in
   * *now* under online authority — which is a strictly stronger statement than "the account that was
   * signed in when some read began", and it is re-evaluated on every publication rather than captured.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  const enrich = useCallback(async (user: AuthUser): Promise<void> => {
    const profile = await authService.getProfile(user.id).catch(() => null);
    if (profile === null) {
      return;
    }
    /*
      A pure updater, and the whole of what enrichment does. It returns a value and nothing else: no
      outer variable is written, no promise is started, and nothing downstream is gated on whether the
      branch was taken. React may evaluate it twice — in development it deliberately does — and the
      second evaluation produces the identical result from the identical input.

      Persisting the durable values is a *separate* concern, and it is derived from the state this
      publishes rather than signalled from in here. See `receiptProjection` and the effect below it.
    */
    setState((previous) => {
      if (
        previous.status !== 'signed-in' ||
        previous.user === null ||
        previous.user.id !== user.id
      ) {
        return previous;
      }
      const durableName = profile.full_name ?? null;
      return {
        ...previous,
        user: durableName === null ? previous.user : toProfile(user, durableName),
        hasCompletedOnboarding: profile.onboarding_completed ?? previous.hasCompletedOnboarding,
      };
    });
  }, []);

  /**
   * Applies a **server-validated** user, and records that it happened.
   *
   * ── Why the receipt is written here and nowhere else ───────────────────────
   * This is the only function reached after Supabase has actually confirmed a live session, so it is
   * the only place where "this device held a real session for this user" is a true statement. Writing
   * the receipt anywhere else would make it a claim about nothing.
   */
  const adopt = useCallback(
    async (user: AuthUser | null, onlyIf?: (previous: AuthState) => boolean) => {
      if (user === null) {
        publish(await signedOut());
        return;
      }
      // An unconfirmed account is not a usable session: leaving it signed out is what stops Verify
      // Email being bypassed.
      if (!user.emailConfirmed) {
        publish(await signedOut(user.email));
        return;
      }
      /*
        ═══════════════════════════════════════════════════════════════════════
        ── Authority is published before the profile is read ──────────────────
        The profile read used to sit here, awaited, between a validated session and
        `status: 'signed-in'` — a second serial network hop gating an authentication decision for the
        sake of a display name and a duplicate onboarding flag. #34 measures what that costs.

        The two are different kinds of fact. **Authority** is *whose session this is and may this
        device open its data* — a security decision, and `user` above is the validated answer to it.
        **Enrichment** is *what to call them*, which has a local answer already: `toProfile` falls
        back to the session's own `user_metadata.full_name`, then the address, and the only surface
        that renders it — Main Home's greeting — additionally carries its own `?? 'there'`. Nothing
        account-shaped is empty or placeholder in the gap, which is the constraint #28 and #31 rest
        on and the reason this split is safe rather than merely faster.

        The onboarding flag is not a routing input for a signed-in launch: `nextStartupState` decides
        an authenticated destination from recovery containment and the plan-selection read, and
        consults `hasCompletedOnboarding` only on the signed-*out* branch. So the local flag is a
        complete answer here, and the durable column refines a value nothing is waiting on.

        ── The two local reads run together ───────────────────────────────────
        Neither needs the other. The receipt supplies the last durable name known for *this* user id,
        which is what keeps the greeting from showing the signup name and then visibly switching to
        an edited one when the row arrives — and it is not a new cache: it is the receipt this
        function already writes, already owner-keyed, already read on every offline launch.
        ═══════════════════════════════════════════════════════════════════════
      */
      const [localFlag, priorReceipt] = await Promise.all([
        readOnboardingFlag(),
        readOfflineReceipt(),
      ]);
      /*
        ── What may be seeded from a receipt, and what may not ─────────────────
        Strictly the same account: a receipt for another user is not a fallback for this one, and an id
        mismatch must produce the session's own name rather than a previous occupant's.

        And strictly a *name*. Two stored values are not names, and both would otherwise arrive here as
        one:

          • `NEUTRAL_DISPLAY_NAME` is the wire form of "no name known" — the record cannot store
            absence, so seeding it back would turn absence into a placeholder and hand Main Home
            something to greet by;
          • the account's own **address**, which a build before #48 wrote into this field. Seeding that
            would reintroduce the whole defect through the cache rather than the fallback chain — and
            worse, the projection would then match what is stored, so the record would never heal.

        Both fall through to no name, which is the honest value and the one that heals on the next
        write.
      */
      const knownName =
        priorReceipt !== null &&
        priorReceipt.userId === user.id &&
        priorReceipt.displayName !== NEUTRAL_DISPLAY_NAME
          ? usableName(priorReceipt.displayName, user.email)
          : null;
      const resolved = toProfile(user, knownName);

      publish(
        {
          status: 'signed-in',
          authority: 'online',
          user: resolved,
          hasCompletedOnboarding: localFlag,
          pendingVerificationEmail: null,
          isBackendConfigured: isSupabaseConfigured,
        },
        onlyIf,
      );

      /*
        The receipt is **not** written here any more. It is a projection of published online authority
        and is persisted by the one effect below, which subsumes both this write and the second one
        enrichment used to perform. Two writers for one account-scoped record, each with its own idea
        of when the values were final, is what made the old pair need a flag passed between them.
      */
      void enrich(user);
    },
    [enrich, publish, signedOut],
  );

  /** Enters offline authority from a validated receipt, or reports that there is none. */
  const adoptOffline = useCallback(async (): Promise<boolean> => {
    const receipt = await readOfflineReceipt();
    if (receipt === null) {
      return false;
    }
    publish({
      status: 'signed-in',
      authority: 'offline',
      user: {
        id: receipt.userId,
        /*
          ── `NEUTRAL_DISPLAY_NAME` is the wire form of "no name known" ────────
          `isReceipt` requires a non-empty `displayName`, so the record cannot store absence directly;
          the projection writes the neutral name instead. Decoding it back to absent here is what keeps
          an offline launch and an online one greeting the same person the same way — otherwise a
          nameless account would read "Assalamu Alaikum, Friend" offline and "…, there" online, which
          is two different neutral answers to one question.
        */
        ...(receipt.displayName === NEUTRAL_DISPLAY_NAME
          ? {}
          : { fullName: receipt.displayName, givenName: givenNameOf(receipt.displayName) }),
        ...(receipt.avatarUrl === null ? {} : { avatarUri: receipt.avatarUrl }),
        /*
          No `email`. The receipt no longer carries one, so Profile's identity row renders its
          designed "not available" copy offline rather than an address restored from the Keystore.
          See `offline-receipt.ts` for why that trade goes this way.
        */
        /*
          Free, always. Locked decision 11: an offline launch may not unlock an entitlement that was
          not already cached and valid, and this record deliberately carries no entitlement claim at
          all — so the only honest tier to present is the one Faith needs, which is free.
        */
        subscriptionTier: 'free',
        greeting: 'Assalamu Alaikum,',
      },
      hasCompletedOnboarding: receipt.hasCompletedOnboarding,
      pendingVerificationEmail: null,
      isBackendConfigured: isSupabaseConfigured,
    });
    return true;
  }, [publish]);

  /**
   * Decides the launch state once, from what can actually be established.
   *
   * ── The order is the whole design ──────────────────────────────────────────
   * Connectivity is consulted **first**, because the alternative — attempting a refresh and reading
   * its failure — is how "could not ask" became "signed out". Asking the platform whether there is a
   * network is cheap, local and unambiguous; asking the server is neither when there is no route to
   * it.
   *
   * Nothing here enters the app before deciding: the state stays `unknown`, and the startup machine
   * holds on the splash rather than flashing Authentication Options.
   */
  /**
   * Applies a **server answer** without deciding anything the answer does not say.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * Extracted so the two callers that need these exact semantics share them rather than keeping two
   * copies of a security decision. `revalidateOnlineAuthority` calls it after re-asking, and the
   * launch's bounded path calls it when a request that outran its bound finally lands.
   *
   * "Without deciding anything the answer does not say" is the whole contract. An upgrade and a
   * verdict are both written; `retryable-offline` and `unavailable` are **silence**, because a failed
   * attempt has taught us nothing and re-adopting on it would mint a fresh user object and churn
   * identity through every consumer on a flapping link.
   *
   * A verdict is still allowed to sign the user out — that is how a remote sign-out reaches a device
   * running from a receipt, and it is only reachable here because a server actually answered.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  const applyServerAnswer = useCallback(
    async (
      resolution: Awaited<ReturnType<typeof authService.resolveSession>>,
      /** Guards an **upgrade** only. A verdict is never conditional — see the caller. */
      onlyIf?: (previous: AuthState) => boolean,
    ) => {
      switch (resolution.kind) {
        case 'authenticated':
          await adopt(resolution.user, onlyIf);
          return;
        case 'no-session':
        case 'invalid-or-revoked':
          await clearOfflineReceipt();
          publish(await signedOut());
          return;
        case 'retryable-offline':
        case 'unavailable':
          return;
      }
    },
    [adopt, publish, signedOut],
  );

  /**
   * Applies a resolution that arrived **within** the launch's bound, where a completed failure is
   * itself information.
   *
   * The difference from `applyServerAnswer` is `retryable-offline`: here the attempt finished and
   * reported the server unreachable, which is the pre-existing launch contract — adopt the receipt if
   * there is one, and otherwise nothing has been established, so the launch says so. That is not the
   * same event as *the bound firing*, where the request is still running and no failure has been
   * observed at all. Collapsing the two would either make a slow link look like an outage or make an
   * outage look like a launch still in progress.
   */
  const applyLaunchResolution = useCallback(
    async (resolution: Awaited<ReturnType<typeof authService.resolveSession>>) => {
      switch (resolution.kind) {
        case 'authenticated':
          await adopt(resolution.user);
          return;
        case 'no-session':
        case 'invalid-or-revoked':
          /*
            A verdict. The server answered, and the answer ends offline access for this device — which
            is exactly how a remote sign-out reaches a phone that had been running from a receipt.
          */
          await clearOfflineReceipt();
          publish(await signedOut());
          return;
        case 'retryable-offline':
          /*
            The platform said the internet was reachable and the request still could not complete — a
            captive portal, a flapping link, a server that never answered. Not a verdict, so the
            receipt survives and local access is permitted if one exists.
          */
          if (!(await adoptOffline())) {
            publish(await signedOut());
          }
          return;
        case 'unavailable':
          publish(await signedOut());
          return;
      }
    },
    [adopt, adoptOffline, publish, signedOut],
  );

  const resolveLaunch = useCallback(
    /**
     * @param isLive Whether the launch this belongs to is still the live one.
     *
     * Owned by the mount effect as a closure variable rather than kept in a ref, which is both the
     * idiomatic answer and the only one that lints: the actions object is built in a `useMemo`, so
     * anything it reaches must not read refs during render. The effect already had exactly this flag
     * for the Supabase listener and simply never shared it — which is why an abandoned launch could
     * still write a receipt and issue a profile read after the provider had gone.
     */
    async (isLive: () => boolean) => {
      if (!isSupabaseConfigured) {
        publish(await signedOut());
        return;
      }

      if (await isConfirmedOffline(network)) {
        if (!isLive()) {
          return;
        }
        /*
        The platform says there is no link at all. **No refresh is attempted** — locked decision 7:
        a token refresh with no route could only fail, and its failure would tell us nothing the port
        has not already said.

        Every other reading — reachable, link-only, or no answer — falls through and asks Supabase,
        because only an attempt can distinguish a captive portal from a working connection. See
        `isConfirmedOffline` for why the default is to try.
      */
        if (!(await adoptOffline())) {
          publish(await signedOut());
        }
        return;
      }

      /*
      ═════════════════════════════════════════════════════════════════════════
      ── The bound, and why the request is not abandoned ──────────────────────
      The promise is kept. `withBound` only decides how long the *launch* waits on it; the request
      carries on and its real answer is applied below when it lands. So the bound buys resolution
      time without giving up the one thing that ends offline access — a definitive server verdict.
      That matters for revocation: a remote sign-out still reaches this device on this launch, just
      after the receipt has already opened the user's own data rather than instead of it.
      ═════════════════════════════════════════════════════════════════════════
    */
      const inFlight = authService.resolveSession();
      const raced = await withBound(inFlight, SESSION_RESOLUTION_TIMEOUT_MS);

      /*
        Checked here as well as in the continuation below, because the request winning its race after
        the provider has gone is the ordinary case for a launch the user backed out of — and applying
        it would write a receipt and issue a profile read for a tree that no longer exists.
      */
      if (!isLive()) {
        return;
      }

      if (raced === TIMED_OUT) {
        /*
        Not a verdict, and specifically **not** `no-session`. Two outcomes only:

          • a valid receipt exists → offline authority, under the existing permitted-offline policy.
            Locked decision 7 is untouched: the attempt was made and is still running; what changed
            is that its slowness no longer holds the launch;
          • no receipt → the state stays `unknown`. The startup machine holds the splash and, past
            its ceiling, shows #31's identity-free notice. Not Authentication Options, not Welcome,
            and no protected surface — because nothing has been established yet, and saying otherwise
            would be the false signed-out verdict #31 removed, reintroduced by a timer.
      */
        await adoptOffline();

        void inFlight.then(
          async (late) => {
            /*
            Nothing at all once the launch is over. Below this line lies real work — a receipt write
            and a profile read — and React discarding a setState does not undo either of those.
          */
            if (!isLive()) {
              return;
            }
            /*
            ── What a late answer may overwrite ─────────────────────────────────
            Only the conclusion this launch reached without it. If the state has since become
            `signed-out`, or already holds `online` authority from a Supabase event, then something
            newer and better informed has spoken and an upgrade must be silent — otherwise a late
            `authenticated` would resurrect a session the user had deliberately ended.

            A **verdict** is exempt and lands unconditionally: `no-session` and `invalid-or-revoked`
            are how a remote sign-out reaches a device running from a receipt, and suppressing one to
            protect a newer state would make the receipt unrevocable for the life of the process.
          */
            await applyServerAnswer(
              late,
              (previous) => previous.status === 'unknown' || previous.authority === 'offline',
            );
          },
          () => {
            /* A rejection tells the launch nothing it has not already assumed. */
          },
        );
        return;
      }

      await applyLaunchResolution(raced);
    },
    [adoptOffline, applyLaunchResolution, applyServerAnswer, network, publish, signedOut],
  );

  /**
   * Re-asks the server, while this process is running on offline authority.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * ── The defect this exists for, observed on a device ───────────────────────
   * Launch in airplane mode, then turn airplane mode **off**. The device has a proven route — `ping`
   * answers — and the app stays offline for the rest of the process. The Qur'an reader keeps
   * rendering its offline body, Verse of the day keeps saying it could not be loaded, and the
   * product's own "Try again" button does nothing at all. Neither a retry nor backgrounding and
   * reopening the app recovers it. Only force-quitting does.
   *
   * The cause is that `authority` had exactly one writer. `resolveLaunch` runs once on mount, and the
   * only other route to `'online'` is a server-validated auth event — which, after a launch that
   * never reached the server, will not arrive until Supabase's own refresh timer happens to fire.
   * `setRemoteAccessAuthorised` mirrors that authority, so every remote read in the app stays gated
   * shut. The retry the user is offered reloads a *resource* whose gate is held closed one layer
   * below it, which is why pressing it changes nothing.
   *
   * So connectivity returning is made a trigger, exactly as Content Sync already treats it.
   *
   * ── Why this is not `resolveLaunch` again ──────────────────────────────────
   * `resolveLaunch` writes state on every branch, including the ones that change nothing: a failed
   * re-attempt would call `adoptOffline` and mint a fresh user object, so a flapping link would churn
   * identity through every consumer that depends on it. This writes **only when the answer differs
   * from what we already believe** — an upgrade, or a verdict that ends offline access. A
   * `retryable-offline` result is silence, and silence leaves the existing offline session alone.
   *
   * ── Why a verdict is still allowed to sign the user out ────────────────────
   * `no-session` and `invalid-or-revoked` mean the server looked and refused, and that is precisely
   * how a remote sign-out is meant to reach a device that has been running from a receipt. Suppressing
   * it here to keep the retry "safe" would make the receipt unrevocable for as long as the process
   * lives. It is the same contract `resolveLaunch` applies, and it is only reachable now because a
   * server actually answered.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  const revalidateOnlineAuthority = useCallback(async () => {
    if (!isSupabaseConfigured) {
      return;
    }
    /*
      Cheap and local, and it keeps a foreground trigger from putting a request on a device that still
      has no link. Every other reading falls through and asks, for the reason `isConfirmedOffline`
      gives: only an attempt distinguishes a captive portal from a working connection.
    */
    if (await isConfirmedOffline(network)) {
      return;
    }

    /*
      The same switch the bounded launch path uses when a late answer lands, because they are the same
      question: a server has spoken while this process already believes something. `unavailable`
      cannot be reached from offline authority — an unconfigured build never gets one — and is inert
      there rather than duplicating a launch decision already taken.
    */
    await applyServerAnswer(await authService.resolveSession());
  }, [applyServerAnswer, network]);

  /**
   * Attaches the triggers, and only while they can do something.
   *
   * The subscription exists solely for the offline case: on `authority: 'online'` this effect returns
   * immediately, so a normally-launched app carries no extra listener and makes no extra request.
   *
   * Both triggers are needed, because they cover different launches. A launch in airplane mode is
   * recovered by the **transition** to reachable. A launch that had a link but could not reach the
   * server — a captive portal, a flapping connection — is already reachable when this attaches, so no
   * transition will ever come; **foreground** is what recovers that one.
   */
  useEffect(() => {
    if (state.authority !== 'offline') {
      return;
    }

    let released = false;
    let inFlight = false;
    let reachable = false;
    let observed = false;

    const attempt = (): void => {
      /*
        `inFlight` collapses overlapping triggers. A link that flaps while a request is outstanding
        would otherwise put a second one behind it, and the pair could settle in either order.
      */
      if (released || inFlight) {
        return;
      }
      inFlight = true;
      void revalidateOnlineAuthority().finally(() => {
        inFlight = false;
      });
    };

    const releaseConnectivity = network.subscribe((next) => {
      observed = true;
      const now = next.reachability === 'online';
      /*
        A transition, not a state. The platform emits a run of events for one arrival, and only the
        first of them is news. `'online'` rather than `isConnected`, so a captive portal — a link that
        reaches nothing — is not mistaken for the internet coming back.
      */
      const became = now && !reachable;
      reachable = now;
      if (became) {
        attempt();
      }
    });

    /*
      Seeds the baseline, and only if no real event has arrived first. `current()` resolves after
      `subscribe` has already attached, so applying it unconditionally could overwrite a live reading
      with a staler one and turn the next genuine arrival into a non-transition.
    */
    void network.current().then((next) => {
      if (!released && !observed) {
        reachable = next.reachability === 'online';
      }
    });

    const appState = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') {
        attempt();
      }
    });

    return () => {
      released = true;
      releaseConnectivity();
      appState.remove();
    };
  }, [network, revalidateOnlineAuthority, state.authority]);

  // Resolve once on mount, then follow Supabase's own auth events.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await resolveLaunch(() => !cancelled);
    })();

    const unsubscribe = authService.subscribeToAuthChanges(({ event, user }) => {
      if (cancelled) {
        return;
      }
      void (async () => {
        if (user !== null) {
          /*
            ── Only a server round trip may grant online authority ──────────────
            `INITIAL_SESSION` carries the session read from local storage, not one a server
            confirmed, and `resolveLaunch` has already classified that exact value. Adopting it
            here upgraded a correctly-resolved offline launch to `authority: 'online'` in airplane
            mode — observed on device — which would authorise every remote call the offline design
            exists to block. See `isServerValidatedAuthEvent`.
          */
          if (!isServerValidatedAuthEvent(event)) {
            return;
          }
          await adopt(user);
          return;
        }
        /*
          ── A null session is only a sign-out when Supabase says it is ─────────
          `TOKEN_REFRESHED` with a null session is a refresh that failed, and on a device that has
          just lost its connection that is the ordinary case. Treating it as a sign-out is the second
          half of the original defect: it would delete the receipt and eject the user mid-session.
        */
        if (!isTerminalAuthEvent(event)) {
          return;
        }
        await clearOfflineReceipt();
        publish(await signedOut());
      })();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [adopt, publish, resolveLaunch, signedOut]);

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
          return { needsVerification: true };
        }
        // Auto-confirmed: a live session already exists, so adopt it and let the caller skip
        // verification entirely.
        await adopt(await authService.getSession());
        return { needsVerification: false };
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
        /*
          ── The receipt goes first, and the order is load-bearing ──────────────
          Locked decision 8: an explicit local sign-out revokes offline access immediately. Deleting
          before the network call means a `signOut()` that fails offline — which is the ordinary case
          on a plane — still ends this device's local access. Doing it afterwards would leave a window
          in which the app was "signed out" on screen and would have reopened on the next launch.

          It is also why this does not go through `adopt(null)`: that path is for a *resolution*, and
          this is a decision.
        */
        await clearOfflineReceipt();
        publish(await signedOut());
        await authService.signOut().catch(() => undefined);
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
      async updateFullName(fullName) {
        const id = state.user?.id;
        if (id === undefined) {
          throw new AuthError('session-expired', 'No signed-in user to update.');
        }
        // Rejects on failure, so the caller keeps the user's edits on screen. Nothing below runs
        // unless the row was actually written.
        const saved = await profileService.updateFullName(id, fullName);
        setState((previous) =>
          previous.user === null
            ? previous
            : {
                ...previous,
                user: {
                  ...previous.user,
                  fullName: saved.fullName,
                  givenName: givenNameOf(saved.fullName),
                },
              },
        );
      },
    }),
    [adopt, pendingVerificationEmail, publish, signedOut, state.user?.id],
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
