import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { useAuth } from '@application/providers/auth-provider';

import { createExpoConnectivity } from '../data/connectivity/expo-connectivity.port';
import { canSync, type ConnectivityState } from '../data/connectivity/connectivity.port';
import {
  type ContentSyncOrchestrator,
  createContentSyncOrchestrator,
} from '../data/sync/content-sync.orchestrator';
import { clearSessionSyncStatus } from '../data/sync/content-sync.revision';
import { createSyncSession, type SyncSession } from '../data/sync/content-sync.session';
import { createQuranContentEndpoint } from '../data/quran-foundation/quran-content.endpoint';

/**
 * The **one** production owner of Content Sync. Renders nothing.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this exists at all ─────────────────────────────────────────────────
 * `createContentSyncOrchestrator` had zero production call sites. Every guarantee it makes — one
 * transaction per process, the token published with its content, the seven-connected-day check — was
 * true of code nothing ran. A transaction nobody starts synchronises nothing.
 *
 * ── Why here, and not in a screen ──────────────────────────────────────────
 * It sits beside `QuranCatalogueWarmup` inside `AuthProvider`, which is the narrowest existing place
 * that satisfies all five requirements at once: it has the authenticated repository boundary, it
 * mounts **once per signed-in app session** rather than per navigation, it can observe `AppState`,
 * it can observe the approved connectivity port, and it can publish a revision to Faith consumers.
 *
 * A screen would fail the second of those. Prayer, Reader and Reciter all mount and unmount as the
 * user navigates, and an effect there would start a run per visit — which is exactly the "sync on
 * every navigation" this must not do. That the orchestrator would coalesce them is not a reason to
 * produce them.
 *
 * ── The five triggers, and why each is separate ────────────────────────────
 *   1. **session becomes ready** — the first moment a request could be authorised at all
 *   2. **cold start** — the same effect, on a launch that restored a session
 *   3. **foreground** — a device that has been asleep for a week is due the moment it wakes
 *   4. **connectivity becomes confirmed** — an offline device owes a check; this is when it can pay
 *   5. **explicit "check for updates"** — exposed through `useContentSync`, not from here
 *
 * Triggers 3 and 4 routinely fire together — waking a phone reconnects it — and the orchestrator's
 * single-flight promise is what makes that one transaction. The backoff in the health record is what
 * makes a *flapping* connection not a loop: `mayAttempt` refuses closely-spaced attempts even when
 * none of them overlap.
 *
 * ── What it will not do ────────────────────────────────────────────────────
 * Nothing runs while signed out; nothing runs before auth restoration resolves (`status` is
 * `'unknown'` until then, and only `'signed-in'` proceeds); nothing runs on unconfirmed reachability;
 * and **no audio is downloaded**. This coordinator synchronises metadata. The 6,236-file download is
 * a decision a user makes on a screen, and starting it automatically would spend somebody's storage
 * and data because they signed in.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The lifecycle defect this version closes ───────────────────────────────
 * The previous version detached its two listeners when auth left `signed-in` and did nothing else.
 * `resetContentSyncCoordinator` was documented as "called on sign-out" and had **zero production
 * callers**, so the module-level orchestrator — and any transaction already inside it — survived the
 * sign-out and the next sign-in intact.
 *
 * Detaching a listener stops new *triggers*. It does not stop a run. A transaction that had already
 * fetched page one was free to fetch page two, stage a generation, flip the pointer, publish a
 * revision and write current-session status, minutes after the user who authorised it had gone.
 *
 * **`orchestrator = null` would not have fixed it either.** That drops the reference; the promise
 * keeps running, keeps its closure over the endpoint, and keeps its authority.
 *
 * ── The model: owner, and what an owner is keyed on ────────────────────────
 * Every transaction belongs to a `SyncSession` — the authenticated user id plus a per-process epoch
 * — minted when a session becomes authenticated and invalidated when it ends. The orchestrator is
 * created *for* an owner and given that owner's validity check, so ending the session is a single
 * flag flip that every checkpoint inside the run observes.
 *
 * The user id is used for one comparison — "is this the same person?" — and is never persisted,
 * never logged and never handed to the transaction. `AuthProvider` already exposes it on the public
 * `AuthState`, so no new auth surface was needed and no token is involved.
 *
 * ── Where invalidation happens, and where it deliberately does not ─────────
 * In the effect **body**, on entering a state that is not "the same signed-in user" — never in the
 * cleanup. The cleanup runs on every unmount, including React's deliberate development double-mount
 * and any remount of the provider tree, and none of those is a sign-out. Invalidating there would
 * kill a legitimate in-flight run and mint a second owner for one session; the double-mount test
 * exists because that is the version a reasonable reading produces first.
 *
 * So: the cleanup detaches listeners. The body decides ownership.
 *
 * ── What survives a sign-out, and why that is correct ──────────────────────
 * The published generation stays on disk and stays readable. It is the Qur'an, a licensed
 * translation and a recitation index — application content, not the departed user's data — and
 * deleting it would make the next launch re-download eight mebibytes to arrive at the same bytes.
 * What does not survive is the old session's *request authority* and its *active transaction*.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The current owner and the orchestrator built for it. Created together, discarded together.
 *
 * Module-level rather than a `useMemo`, and the difference is load-bearing: the single-flight guard
 * lives *inside* the orchestrator instance, so two instances would be two in-flight promises and the
 * guarantee would be lost. React can mount, unmount and remount a component — in development it does
 * so deliberately — and each of those would produce a fresh instance if it were held in a hook.
 */
let owner: SyncSession | null = null;
let orchestrator: ContentSyncOrchestrator | null = null;

/** The connectivity boundary, likewise shared so one native listener serves the whole process. */
let connectivity: ReturnType<typeof createExpoConnectivity> | null = null;

function sharedConnectivity(): ReturnType<typeof createExpoConnectivity> {
  connectivity ??= createExpoConnectivity();
  return connectivity;
}

/**
 * The orchestrator belonging to `ownerKey`, creating a fresh owner when there is not one already.
 *
 * A different user, or an owner that has already been invalidated, is not reused: the old one is
 * ended first and a new session, a new epoch and a new orchestrator are built. That is what stops a
 * new sign-in inheriting the previous session's in-flight promise, its retry state or its
 * single-flight guard — a fresh instance has none of them.
 */
function ownedOrchestrator(ownerKey: string): ContentSyncOrchestrator {
  if (owner !== null && (owner.ownerKey !== ownerKey || !owner.isValid())) {
    resetContentSyncCoordinator();
  }
  if (orchestrator === null || owner === null) {
    /* Held locally as well, so the guard closes over this session and not over whatever the module
       variable points at later. */
    const session = createSyncSession(ownerKey);
    owner = session;
    orchestrator = createContentSyncOrchestrator({
      endpoint: createQuranContentEndpoint(),
      connectivity: sharedConnectivity(),
      now: () => Date.now(),
      /* Only the question, never the identity: the transaction cannot read who it belongs to. */
      session: { isValid: () => session.isValid() },
    });
  }
  return orchestrator;
}

/**
 * Runs a due check, if one is owed and there is a session to owe it.
 *
 * Exported so the manual "check for updates" action and the tests reach the same function the
 * lifecycle triggers use. `force` skips the *due* calculation only — it cannot skip the single-flight
 * guard, the session requirement, the reachability requirement, schema validation or the
 * transactional publication, because none of those is decided here.
 *
 * With no live owner this returns without touching anything. A manual check pressed on a screen that
 * outlived the session — or during the instant between sign-out and the effect re-running — sends no
 * request, which is the same answer the lifecycle triggers give.
 */
export async function runContentSync(options: { readonly force?: boolean } = {}): Promise<void> {
  if (orchestrator === null || owner === null || !owner.isValid()) {
    return;
  }
  await orchestrator.run(options);
}

/** Whether a transaction is in flight. For a screen that renders "checking". */
export function isContentSyncRunning(): boolean {
  return orchestrator?.isRunning() ?? false;
}

/**
 * Ends the current session and disposes of everything built for it.
 *
 * **This has a production call site** — the coordinator's own effect, whenever auth is not a live
 * signed-in session, and `ownedOrchestrator` when the signed-in user changes. It used to have none,
 * which is how a documented "called on sign-out" reset came to be called only by tests. A source
 * scan in `quran-content-sync-wiring.test.tsx` fails if it becomes test-only again.
 *
 * The order is deliberate. References are dropped *first*, so a re-entrant caller finds nothing
 * rather than finding a dead owner; the invalidation then reaches the transaction still holding its
 * guard, which is the only thing that can stop it publishing.
 *
 * Idempotent by construction: with nothing to drop, every line is a no-op and no status is emitted.
 *
 * The connectivity port is **not** dropped. Whether the device has a working link is a fact about
 * the device and not about who is signed in, and the port already removes its native listener when
 * its last subscriber leaves — so discarding it on every signed-out render would rebuild a native
 * subscription for no gain, which is precisely the repeated reset this lifecycle must not perform.
 */
export function resetContentSyncCoordinator(): void {
  const previous = owner;
  owner = null;
  orchestrator = null;
  previous?.invalidate();
}

export function ContentSyncCoordinator() {
  const { status, user } = useAuth();
  /**
   * The authenticated user id, or `null`.
   *
   * A primitive rather than the profile object: `AuthProvider` builds a new `user` on every token
   * refresh, and an effect keyed on the object would tear down and re-establish the whole lifecycle
   * each time one arrived.
   */
  const ownerKey = status === 'signed-in' ? (user?.id ?? null) : null;
  /** The last reachability seen, so a *transition* into reachable is distinguishable from a repeat. */
  const wasReachable = useRef(false);

  useEffect(() => {
    if (ownerKey === null) {
      /*
        Signed out, auth restoration unresolved (`'unknown'`), or — defensively — signed in with no
        identifiable user. Nothing is attempted, no listener is attached, and any previous session is
        ended here rather than merely unsubscribed from: a request sent before restoration completes
        would carry no credential and could only be refused, and one sent after sign-out would carry
        somebody else's.
      */
      wasReachable.current = false;
      resetContentSyncCoordinator();
      /*
        The status channel keeps its subscribers and loses its session state. Every Faith screen
        reading `useContentSync` survives a sign-out; what must not survive is a "last synchronised"
        line describing somebody else's run.
      */
      clearSessionSyncStatus(
        status === 'signed-out' ? 'authentication-required' : 'never-synchronized',
      );
      return;
    }

    let released = false;
    /*
      Established before the first trigger. A remount under the same session reuses this owner; a
      different user replaces it, and the replaced one is invalidated inside `ownedOrchestrator`.
    */
    ownedOrchestrator(ownerKey);

    /* Trigger 1 and 2: a session exists, on a cold start or the moment it becomes ready. */
    void runContentSync();

    /*
      Trigger 3: foreground. A device asleep for a week is due the instant it wakes, and the
      subscription is torn down below rather than left attached across a sign-out.
    */
    const appState = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (!released && next === 'active') {
        void runContentSync();
      }
    });

    /*
      Trigger 4: connectivity becoming *confirmed*. Only a transition counts — a stream of events
      that are all reachable is one arrival, not many — and unconfirmed reachability is never
      treated as online, so a captive portal produces no attempt at all.
    */
    const releaseConnectivity = sharedConnectivity().subscribe((state: ConnectivityState) => {
      const reachable = canSync(state);
      const becameReachable = reachable && !wasReachable.current;
      wasReachable.current = reachable;
      if (!released && becameReachable) {
        void runContentSync();
      }
    });

    void sharedConnectivity()
      .current()
      .then((state) => {
        wasReachable.current = canSync(state);
      });

    return () => {
      /*
        Listeners only. This runs on every unmount — including React's development double-mount and
        any remount of the provider tree — and none of those is a sign-out. Ending the session here
        would abandon a legitimate run and mint a second owner for a single session; ownership is
        decided in the body above, where the auth state is actually known.

        `released` is checked by both callbacks as well, so an event that fires between this line and
        the platform actually detaching cannot start a run. Both releases are idempotent.
      */
      released = true;
      appState.remove();
      releaseConnectivity();
    };
  }, [status, ownerKey]);

  return null;
}
