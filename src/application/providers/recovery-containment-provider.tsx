import { createContext, useContext } from 'react';

import {
  useRecoveryContainment,
  type RecoveryContainmentState,
} from '@application/startup/use-recovery-containment';

/**
 * **The one owner of recovery containment, mounted for every launch however it started.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The gap this closes (issue #30) ────────────────────────────────────────
 * `useRecoveryContainment` was called from `useStartupRouting`, which only `src/app/index.tsx`
 * mounts. Expo Router makes a deep-linked route the *initial* route, so on a direct link the entry
 * gate never mounts, the hook never ran, the marker on disk was never read, and **no containment
 * decision was taken at all**. The session still restored normally — `AuthProvider` sits above the
 * navigator — so a user with an open, unfinished password recovery could reach any authenticated
 * route by link, while the same user arriving through an ordinary launch was correctly held at Set
 * New Password.
 *
 * Two of the decisions are clean-up actions — `discard` clears an unsatisfiable marker, `sign-out`
 * clears a mismatched or corrupt one — so neither ran on a direct link either. A corrupt marker that
 * should have ended the session survived the launch untouched.
 *
 * ── The precedent this follows exactly ─────────────────────────────────────
 * `src/app/_layout.tsx` already solves this shape of problem. Its docblock, about the native splash
 * ceiling: *"`useNativeSplashHandoff` lives in the entry gate … but Expo Router makes a deep-linked
 * route the initial route, so a cold-start authentication callback never mounts the gate and never
 * armed its ceiling. This layout mounts for every route, so the ceiling is armed on every launch
 * however it started."*
 *
 * Same reasoning, same remedy: the containment read has to be armed once per launch **regardless of
 * launch path**, which means above the navigator rather than inside one route. `AppProviders` is
 * rendered by the root layout, so mounting the actor here arms it for a cold direct link, a warm
 * link, an ordinary launch, and a launch that begins on the authentication callback alike.
 *
 * ── Why this is one owner and not a second actor ───────────────────────────
 * The hook is called **here and nowhere else**. `useStartupRouting` now *consumes* this context
 * instead of calling the hook, so the number of `useRecoveryContainment` call sites went from one to
 * one. A test asserts that count directly.
 *
 * This is strictly safer than before rather than merely equivalent. `useRecoveryContainment` guards
 * its side effects with a `settled` ref, which is per-instance — so it protects against re-runs of
 * *one* instance, not against a second instance. The entry gate unmounts after it redirects, so
 * anything that remounted it produced a fresh instance with a fresh ref, free to re-mint a grant the
 * password screen had deliberately released. A provider mounted by `AppProviders` is instantiated
 * once for the life of the process, so that window is gone.
 *
 * ── Why the actor is not the gate ──────────────────────────────────────────
 * It performs side effects and takes no navigation decision — navigation was always the consumer's
 * job, which is what makes moving it safe. `RecoveryContainmentGate` reads this context and the live
 * grant and renders a `Redirect`; it holds no state, writes nothing, and clears nothing. Keeping the
 * effects in one place and the redirect in another is what stops nineteen mount points from becoming
 * nineteen actors.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The default, for a tree rendered without this provider.
 *
 * `pending: null` means **unanswered**, which is the fail-closed reading: a consumer that finds it
 * waits rather than assuming no recovery is in progress. Production always has the provider —
 * `AppProviders` mounts it on every route — so this only ever applies to a test that renders a
 * fragment of the tree, and there the safe answer is the same one.
 *
 * Frozen and module-level so the context value is referentially stable; a fresh object literal here
 * would re-render every consumer on every render of the provider's parent.
 */
const UNANSWERED: RecoveryContainmentState = Object.freeze({
  pending: null,
  containment: null,
});

const RecoveryContainmentContext = createContext<RecoveryContainmentState>(UNANSWERED);

export function RecoveryContainmentProvider({ children }: { readonly children: React.ReactNode }) {
  /*
    The single call site. It must sit inside both `AuthProvider` (it reads the session and can sign
    out) and `AuthCallbackProvider` (it mints and clears the in-memory grant) — see the ordering in
    `app-providers.tsx`.
  */
  const state = useRecoveryContainment();

  return (
    <RecoveryContainmentContext.Provider value={state}>
      {children}
    </RecoveryContainmentContext.Provider>
  );
}

/**
 * What the one containment actor has decided, for consumers that need it.
 *
 * Read-only by construction: the context carries the verdict and no actions, so a consumer cannot
 * mint a grant, clear a marker or sign anybody out. That is the whole point of publishing the state
 * rather than the hook.
 */
export function useRecoveryContainmentState(): RecoveryContainmentState {
  return useContext(RecoveryContainmentContext);
}
