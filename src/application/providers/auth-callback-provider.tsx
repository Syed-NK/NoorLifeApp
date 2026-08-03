import * as Linking from 'expo-linking';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  sanitizeDestination,
  type PendingDestination,
} from '@application/navigation/pending-destination';
import { parseAuthCallback } from '@services/auth/auth-callback-url';
import type { ParsedAuthCallback } from '@services/auth/auth-callback.contract';

/**
 * The deep-link boundary: capture an authentication callback, hand it over exactly once.
 *
 * ── Why this is a provider and not a hook inside a screen ───────────────────
 * A cold-start link has to be read before anything decides where to navigate. `Linking.getInitialURL`
 * resolves on the first tick; fonts, session and onboarding take up to four seconds; and the entry
 * gate freezes its destination the moment the startup machine names one. A hook inside a screen would
 * be mounted after that race had already been lost — the link would arrive to find the app on Main
 * Home with the code discarded, which is exactly the behaviour audited before this phase.
 *
 * Sitting above the router also means a warm-start link is captured whatever screen is showing, and
 * that an invalid one leaves that screen alone.
 *
 * ── Why the callback is held rather than acted on ───────────────────────────
 * This provider performs no network call and establishes no session. It parses, deduplicates, and
 * holds. `/auth/callback` claims the value and does the exchange. Keeping the two apart is what makes
 * "the callback is consumed exactly once" a property of one small stateful object instead of a race
 * between a listener and a screen.
 *
 * ── Nothing here is persisted ───────────────────────────────────────────────
 * Not the callback, not the recovery grant, not the pending destination. All three live in component
 * state for the life of the process. A recovery grant written to storage would outlive the recovery it
 * was minted for and become a standing permission to change the account's password; a pending
 * destination written to storage would survive into a session it was never intended for. Losing them
 * on a restart is the correct behaviour, not a limitation.
 */

/** Where a captured callback came from, which decides who navigates to the callback screen. */
export type CallbackOrigin =
  /** Read from `getInitialURL` — the app was launched by the link. The entry gate routes it. */
  | 'cold'
  /** Delivered to a running app by the `url` event. The warm navigator routes it. */
  | 'warm';

export type CapturedCallback = {
  readonly parsed: ParsedAuthCallback;
  readonly origin: CallbackOrigin;
  /**
   * Identity for deduplication.
   *
   * The authorization code for a usable callback, and the rejection code for a refused one. Android's
   * `singleTask` launch mode re-delivers an intent to the running task, and a screen that is already
   * mounted can see the same URL again — so the same link arriving twice must collapse to one pending
   * item rather than being exchanged twice.
   */
  readonly key: string;
};

/**
 * A live password-recovery grant.
 *
 * Minted only by a successful recovery exchange, held only in memory, consumed once. `userId` is
 * carried so the Set New Password screen can refuse a grant that does not match the session it finds:
 * a stale grant plus a different live session is precisely how a recovery screen would come to change
 * the wrong account's password.
 */
export type RecoveryGrant = {
  readonly userId: string;
};

export type AuthCallbackState = {
  /** The callback waiting to be processed, or null. */
  readonly pending: CapturedCallback | null;
  /**
   * Whether the cold-start read has settled.
   *
   * ── Why a consumer has to know this ─────────────────────────────────────────
   * `Linking.getInitialURL()` is a promise. Until it resolves, `pending === null` means "we do not know
   * yet", not "the app was not launched by a link" — and a consumer that cannot tell the two apart draws
   * the wrong conclusion whenever it mounts in the same commit as this provider.
   *
   * That is not hypothetical. The callback screen concludes "there is no link to confirm" when its claim
   * comes back empty, so without this flag a screen mounted before the read settled would show an
   * invalid-link state for a perfectly good launch URL. In the running app the entry gate holds the
   * splash for at least 900 ms first, which hid the fault; mounting the screen directly, as a test does,
   * exposed it. Waiting on an explicit signal is correct regardless of how much slack the splash happens
   * to provide.
   */
  readonly resolved: boolean;
  readonly recovery: RecoveryGrant | null;
  readonly pendingDestination: PendingDestination | null;
};

export type AuthCallbackActions = {
  /**
   * Takes the pending callback and clears it, so a second caller gets null.
   *
   * Synchronous and state-free in its decision: it reads and writes a ref before touching React
   * state, because two components mounting in the same commit would otherwise both read the same
   * pre-clear value and both start an exchange.
   */
  claim(): CapturedCallback | null;
  /** Records a recovery grant after a successful recovery exchange. */
  grantRecovery(grant: RecoveryGrant): void;
  /** Consumes the grant. Called after the password is set, and on leaving the recovery flow. */
  clearRecovery(): void;
  /** Stores a destination to resume at, if it survives sanitizing. Returns whether it did. */
  rememberDestination(value: unknown): boolean;
  /** Takes the destination and clears it. */
  takeDestination(): PendingDestination | null;
  /**
   * Feeds a URL in as though the OS had delivered it.
   *
   * Exported for the warm-start tests, which cannot make Android send an intent. The application
   * itself never calls this — the two effects below are the only producers.
   */
  deliver(url: string, origin: CallbackOrigin): void;
};

const EMPTY: AuthCallbackState = {
  pending: null,
  resolved: false,
  recovery: null,
  pendingDestination: null,
};

const StateContext = createContext<AuthCallbackState>(EMPTY);
const ActionsContext = createContext<AuthCallbackActions | null>(null);

/** The identity used to collapse a duplicated delivery. */
function keyFor(parsed: ParsedAuthCallback): string {
  switch (parsed.kind) {
    case 'callback':
      return `code:${parsed.code}`;
    case 'error':
      return `error:${parsed.code}`;
    case 'rejected':
      return `rejected:${parsed.code}`;
    default:
      return 'unrelated';
  }
}

export function AuthCallbackProvider({ children }: { readonly children: React.ReactNode }) {
  const [state, setState] = useState<AuthCallbackState>(EMPTY);

  /**
   * The authoritative copy of the pending callback.
   *
   * A ref beside the state, and the reason is `claim`. React state is not readable synchronously
   * after a set, so two consumers in one commit would both see the same value; a ref is, so the
   * second one sees null. State exists only so a render can observe that something is pending.
   */
  const pendingRef = useRef<CapturedCallback | null>(null);
  const destinationRef = useRef<PendingDestination | null>(null);
  /** Keys already delivered, so a re-delivered intent is dropped rather than re-queued. */
  const seenRef = useRef<Set<string>>(new Set());

  const deliver = useCallback((url: string, origin: CallbackOrigin) => {
    const parsed = parseAuthCallback(url);
    if (parsed.kind === 'unrelated') {
      /**
       * Not ours, and therefore not touched.
       *
       * `noorlifeapp://faith/quran` is somebody navigating. Raising an authentication state over it
       * would put an error screen on top of whatever the user was doing, for a link that was never
       * addressed to this boundary.
       */
      return;
    }

    const key = keyFor(parsed);
    if (seenRef.current.has(key)) {
      // The same link again — a `singleTask` re-delivery, or a screen re-reading the launch URL.
      // Collapsed rather than queued: this is what makes "handled once" true for warm start.
      return;
    }
    seenRef.current.add(key);

    const captured: CapturedCallback = { parsed, origin, key };
    pendingRef.current = captured;
    setState((previous) => ({ ...previous, pending: captured }));
  }, []);

  /**
   * Cold start: the URL the app was launched with.
   *
   * `getInitialURL` rather than `useLinkingURL`. The hook re-reports the launch URL on every reload
   * and also reports subsequent changes, which would make one delivery indistinguishable from two;
   * this reads the launch value once and lets the event listener below own everything after it.
   *
   * A rejection is swallowed: `getInitialURL` can reject on a platform with no linking support, and
   * that is "the app was not launched by a link", not a failure to report.
   */
  useEffect(() => {
    let cancelled = false;
    const settle = (url: string | null) => {
      if (cancelled) {
        return;
      }
      if (typeof url === 'string' && url.length > 0) {
        deliver(url, 'cold');
      }
      /**
       * Marked after the delivery, in the same pass.
       *
       * Order matters: a consumer waiting on `resolved` must never observe it true while the callback it
       * is waiting for is still one setState behind. `deliver` and this both run before React commits, so
       * a render sees either neither or both.
       */
      setState((previous) => ({ ...previous, resolved: true }));
    };
    // A rejection is "the app was not launched by a link", not a failure to report: `getInitialURL` can
    // reject on a platform with no linking support, and either way the read has settled.
    Linking.getInitialURL().then(settle, () => settle(null));
    return () => {
      cancelled = true;
    };
  }, [deliver]);

  /**
   * Warm start: `singleTask` re-entry.
   *
   * `MainActivity` is `launchMode="singleTask"`, so a second link re-uses the running task and
   * arrives here as a `url` event rather than as a new process. Warm handling is therefore not an
   * optional nicety — it is the only path a second link can take.
   */
  useEffect(() => {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      deliver(url, 'warm');
    });
    return () => {
      subscription.remove();
    };
  }, [deliver]);

  const actions = useMemo<AuthCallbackActions>(
    () => ({
      claim() {
        const captured = pendingRef.current;
        if (captured === null) {
          return null;
        }
        // Cleared before returning, so the second caller in the same commit gets null.
        pendingRef.current = null;
        setState((previous) => ({ ...previous, pending: null }));
        return captured;
      },
      grantRecovery(grant) {
        setState((previous) => ({ ...previous, recovery: grant }));
      },
      clearRecovery() {
        setState((previous) => ({ ...previous, recovery: null }));
      },
      rememberDestination(value) {
        const sanitized = sanitizeDestination(value);
        if (sanitized === null) {
          // Refused, and refused silently: the value came from an untrusted link, and logging it
          // would be logging the thing this function exists to distrust.
          return false;
        }
        destinationRef.current = sanitized;
        setState((previous) => ({ ...previous, pendingDestination: sanitized }));
        return true;
      },
      takeDestination() {
        const destination = destinationRef.current;
        destinationRef.current = null;
        if (destination !== null) {
          setState((previous) => ({ ...previous, pendingDestination: null }));
        }
        return destination;
      },
      deliver,
    }),
    [deliver],
  );

  return (
    <StateContext.Provider value={state}>
      <ActionsContext.Provider value={actions}>{children}</ActionsContext.Provider>
    </StateContext.Provider>
  );
}

export function useAuthCallback(): AuthCallbackState {
  return useContext(StateContext);
}

export function useAuthCallbackActions(): AuthCallbackActions {
  const actions = useContext(ActionsContext);
  if (actions === null) {
    throw new Error('useAuthCallbackActions was called outside AuthCallbackProvider.');
  }
  return actions;
}
