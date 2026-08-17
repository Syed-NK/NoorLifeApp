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

/** The first word of a name, for the Main Home greeting. Never empty. */
function givenNameOf(full: string): string {
  return full.trim().split(/\s+/)[0] ?? 'Friend';
}

/**
 * Maps the service's user onto the profile shape the rest of the app already consumes.
 *
 * `durableFullName` is `public.profiles.full_name` and wins when it is present. The session's own
 * `user_metadata.full_name` is only ever a copy taken at signup, so once the profile row has been
 * edited the two disagree — and the row is the record. Passing null (no row, or a row with no
 * name) falls back to the session copy, which is still a real value rather than a guess.
 */
function toProfile(user: AuthUser, durableFullName: string | null = null): UserProfile {
  const full = durableFullName ?? user.fullName ?? user.email ?? 'Friend';
  const given = givenNameOf(full);
  return {
    id: user.id,
    fullName: full,
    givenName: given,
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
   * Applies a **server-validated** user, and records that it happened.
   *
   * ── Why the receipt is written here and nowhere else ───────────────────────
   * This is the only function reached after Supabase has actually confirmed a live session, so it is
   * the only place where "this device held a real session for this user" is a true statement. Writing
   * the receipt anywhere else would make it a claim about nothing.
   */
  const adopt = useCallback(
    async (user: AuthUser | null) => {
      if (user === null) {
        setState(await signedOut());
        return;
      }
      // An unconfirmed account is not a usable session: leaving it signed out is what stops Verify
      // Email being bypassed.
      if (!user.emailConfirmed) {
        setState(await signedOut(user.email));
        return;
      }
      // The profile row is the durable record; a read failure falls back to the local flag rather than
      // blocking launch.
      const profile = await authService.getProfile(user.id).catch(() => null);
      const localFlag = await readOnboardingFlag();
      const resolved = toProfile(user, profile?.full_name ?? null);
      const onboarded = profile?.onboarding_completed ?? localFlag;

      setState({
        status: 'signed-in',
        authority: 'online',
        user: resolved,
        hasCompletedOnboarding: onboarded,
        pendingVerificationEmail: null,
        isBackendConfigured: isSupabaseConfigured,
      });

      /*
        Token-free, and written only now. See `offline-receipt.ts` for why an id and a display name are
        the whole of it, and for the revocation tradeoff this accepts.
      */
      await writeOfflineReceipt({
        userId: user.id,
        displayName: resolved.fullName,
        avatarUrl: user.avatarUrl,
        hasCompletedOnboarding: onboarded,
        now: Date.now(),
      });
    },
    [signedOut],
  );

  /** Enters offline authority from a validated receipt, or reports that there is none. */
  const adoptOffline = useCallback(async (): Promise<boolean> => {
    const receipt = await readOfflineReceipt();
    if (receipt === null) {
      return false;
    }
    setState({
      status: 'signed-in',
      authority: 'offline',
      user: {
        id: receipt.userId,
        fullName: receipt.displayName,
        givenName: givenNameOf(receipt.displayName),
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
  }, []);

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
  const resolveLaunch = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setState(await signedOut());
      return;
    }

    if (await isConfirmedOffline(network)) {
      /*
        The platform says there is no link at all. **No refresh is attempted** — locked decision 7:
        a token refresh with no route could only fail, and its failure would tell us nothing the port
        has not already said.

        Every other reading — reachable, link-only, or no answer — falls through and asks Supabase,
        because only an attempt can distinguish a captive portal from a working connection. See
        `isConfirmedOffline` for why the default is to try.
      */
      if (!(await adoptOffline())) {
        setState(await signedOut());
      }
      return;
    }

    const resolution = await authService.resolveSession();
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
        setState(await signedOut());
        return;
      case 'retryable-offline':
        /*
          The platform said the internet was reachable and the request still could not complete — a
          captive portal, a flapping link, a server that never answered. Not a verdict, so the receipt
          survives and local access is permitted if one exists.
        */
        if (!(await adoptOffline())) {
          setState(await signedOut());
        }
        return;
      case 'unavailable':
        setState(await signedOut());
        return;
    }
  }, [adopt, adoptOffline, network, signedOut]);

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

    const resolution = await authService.resolveSession();
    switch (resolution.kind) {
      case 'authenticated':
        await adopt(resolution.user);
        return;
      case 'no-session':
      case 'invalid-or-revoked':
        await clearOfflineReceipt();
        setState(await signedOut());
        return;
      case 'retryable-offline':
      case 'unavailable':
        /*
          Nothing learned, so nothing written. `unavailable` cannot be reached from offline authority —
          an unconfigured build never gets one — and is inert here rather than duplicating a launch
          decision that has already been taken.
        */
        return;
    }
  }, [adopt, network, signedOut]);

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
      await resolveLaunch();
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
        setState(await signedOut());
      })();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [adopt, resolveLaunch, signedOut]);

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
        setState(await signedOut());
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
    [adopt, pendingVerificationEmail, signedOut, state.user?.id],
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
