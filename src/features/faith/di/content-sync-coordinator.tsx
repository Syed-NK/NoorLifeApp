import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { isOnlineAuthenticated, useAuth } from '@application/providers/auth-provider';

import { createExpoConnectivity } from '../data/connectivity/expo-connectivity.port';
import { canSync, type ConnectivityState } from '../data/connectivity/connectivity.port';
import {
  type ContentSyncOrchestrator,
  createContentSyncOrchestrator,
  SYNC_INTERVAL_MS,
  type SyncOutcome,
} from '../data/sync/content-sync.orchestrator';
import { readActiveGeneration } from '../storage/faith-sync-generation';
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
export async function runContentSync(
  options: { readonly force?: boolean } = {},
): Promise<SyncOutcome | null> {
  if (orchestrator === null || owner === null || !owner.isValid()) {
    return null;
  }
  return await orchestrator.run(options);
}

/**
 * The largest single wakeup this schedules.
 *
 * ── Why the seven-day delay is not simply handed to setTimeout ─────────────
 * It would fit — seven days is well inside the 2^31-1 millisecond ceiling — and it would still be
 * the wrong thing to rely on. A single timer armed for a week has to survive every doze, throttle
 * and timer-coalescing decision the platform makes in between, and if it is dropped the boundary
 * passes in silence. Waking every few hours to ask "is it due yet?" costs one comparison against a
 * timestamp already in memory, makes no request until the answer is yes, and self-corrects if a
 * wakeup is missed.
 *
 * It also bounds the damage of a clock that jumps: the next evaluation is never more than this far
 * away, whatever the device thinks the time is.
 */
export const DUE_BOUNDARY_CHUNK_MS = 6 * 60 * 60 * 1000;

/**
 * The floor on any rescheduling, so a past-due boundary cannot become a zero-delay loop.
 *
 * Reached when the boundary is already behind us and the run that followed did not publish — an
 * offline device, a throttled attempt, a failure. Without a floor each of those would reschedule
 * immediately and re-ask the same question forever.
 */
export const DUE_BOUNDARY_MIN_DELAY_MS = 60 * 1000;

/**
 * The one due-boundary timer, beside the one owner it belongs to.
 *
 * Module-level for the same reason the orchestrator is: a hook would give every mount its own timer,
 * and two timers are two triggers. Exactly one exists at a time, and `clearDueBoundary` is called
 * before any new one is armed, so re-rendering, remounting or replacing the session cannot
 * accumulate them.
 */
let dueTimer: ReturnType<typeof setTimeout> | null = null;

function clearDueBoundary(): void {
  if (dueTimer !== null) {
    clearTimeout(dueTimer);
    dueTimer = null;
  }
}

/**
 * How long until the feed check is next owed, from the authoritative clock.
 *
 * The clock is `manifest.createdAt` on the active generation — the same timestamp the orchestrator's
 * own due gate reads, so this can never disagree with it. Nothing is persisted here and no second
 * timestamp is introduced; this is a question asked of state that already exists.
 *
 * A missing generation, a clock that moved backwards and a boundary already passed all answer
 * "now", and the caller applies the floor. A future `createdAt` cannot postpone the check by its
 * own distance, because the wait is capped at one chunk regardless.
 */
async function nextDueDelayMs(now: number): Promise<number> {
  const generation = await readActiveGeneration();
  if (generation === null) {
    return DUE_BOUNDARY_MIN_DELAY_MS;
  }
  const remaining = generation.manifest.createdAt + SYNC_INTERVAL_MS - now;
  if (remaining <= 0) {
    return 0;
  }
  return Math.min(remaining, DUE_BOUNDARY_CHUNK_MS);
}

/**
 * Arms the next evaluation, replacing whatever was armed before.
 *
 * `delayOverride` carries the backoff the orchestrator already decided. When a run comes back
 * throttled it says how long to wait, and re-deriving that here would be a second retry policy
 * disagreeing with the first.
 */
export async function scheduleDueBoundary(delayOverride?: number): Promise<void> {
  clearDueBoundary();
  const session = owner;
  if (session === null || !session.isValid()) {
    return;
  }
  const delay = delayOverride ?? Math.max(await nextDueDelayMs(Date.now()), 0);
  /*
    Re-checked after the await: a sign-out during the read must not arm a timer for a session that
    has since ended, and `clearDueBoundary` above already ran before it.
  */
  if (owner !== session || !session.isValid()) {
    return;
  }
  dueTimer = setTimeout(
    () => {
      dueTimer = null;
      void onDueBoundary(session);
    },
    Math.max(delay, 0),
  );
}

/**
 * One evaluation at the boundary.
 *
 * Runs the **existing** single-flight path rather than anything of its own, so a timer firing beside
 * a foreground event or a reconnection produces one transaction and not two — the orchestrator
 * decides that, exactly as it does for every other trigger.
 *
 * Whatever comes back, the next evaluation is armed from it: a publication moves the clock forward a
 * week, a throttle supplies its own retry delay, and everything else waits at least the floor. There
 * is no branch that reschedules at zero.
 */
async function onDueBoundary(session: SyncSession): Promise<void> {
  if (owner !== session || !session.isValid()) {
    return;
  }
  /*
    ── A chunk wakeup is a question, not a request ─────────────────────────
    Most wakeups are not the boundary: they exist so a week-long wait is never entrusted to a single
    timer. Re-deriving the delay costs one subtraction against a timestamp, and asking the
    orchestrator instead would send a trigger every few hours — the orchestrator would answer
    'not-due' each time, but only after the coordinator had claimed a run and told every Faith screen
    a sync was under way.
  */
  const remaining = await nextDueDelayMs(Date.now());
  if (owner !== session || !session.isValid()) {
    return;
  }
  if (remaining > 0) {
    await scheduleDueBoundary(remaining);
    return;
  }

  const outcome = await runContentSync();
  if (owner !== session || !session.isValid()) {
    return;
  }
  if (outcome !== null && outcome.kind === 'throttled') {
    await scheduleDueBoundary(Math.max(outcome.retryAfterMs, DUE_BOUNDARY_MIN_DELAY_MS));
    return;
  }
  /*
    'synced' moved the clock, so the derived delay is a fresh week. 'not-due' means something else
    published first. Offline and failure leave the boundary in the past, and the floor is what stops
    that becoming a spin — the device waits a minute and asks again, and the connectivity trigger
    will usually beat it to the answer.
  */
  const derived = await nextDueDelayMs(Date.now());
  await scheduleDueBoundary(Math.max(derived, derived === 0 ? DUE_BOUNDARY_MIN_DELAY_MS : 0));
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
  /*
    Before the invalidation, so a timer that fires in the same tick finds no owner rather than a
    dead one. A pending wakeup belongs to the session that armed it and must not outlive it: left
    behind, it would wake into the next sign-in and evaluate a boundary on somebody else's clock.
  */
  clearDueBoundary();
  previous?.invalidate();
}

export function ContentSyncCoordinator() {
  const auth = useAuth();
  const { status, user } = auth;
  /**
   * The authenticated user id, or `null`.
   *
   * A primitive rather than the profile object: `AuthProvider` builds a new `user` on every token
   * refresh, and an effect keyed on the object would tear down and re-establish the whole lifecycle
   * each time one arrived.
   */
  /*
    ── Online authority, not merely "signed in" ──────────────────────────────
    Content Sync is an authenticated transaction against Supabase and Quran Foundation. An offline
    authority carries no token, so a run started under one could only be refused at the transport —
    after the coordinator had already claimed an owner and told every Faith screen a sync was under
    way. Reading `isOnlineAuthenticated` gates it *before* the transport, which is what locked
    decision 7 requires.

    The transition matters as much as the state: when authority drops from online to offline this
    key becomes `null`, and the branch below invalidates the in-flight session owner through the
    cancellation work already built for sign-out.
  */
  const ownerKey = isOnlineAuthenticated(auth) ? (user?.id ?? null) : null;
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
        /*
          Three states now reach here, and they are not the same thing. A signed-out device needs
          authentication; an offline-authenticated one needs a connection and already holds whatever
          it last synchronised; an unresolved one knows nothing yet. Reporting the first for all three
          would tell a user on a plane to sign in — the defect this whole phase exists to remove.
        */
        status === 'signed-out'
          ? 'authentication-required'
          : auth.authority === 'offline'
            ? 'offline'
            : 'never-synchronized',
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
    void runContentSync().then(() => {
      if (!released) {
        void scheduleDueBoundary();
      }
    });

    /*
      Trigger 3: foreground. A device asleep for a week is due the instant it wakes, and the
      subscription is torn down below rather than left attached across a sign-out.
    */
    const appState = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (released) {
        return;
      }
      if (next === 'active') {
        void runContentSync().then(() => {
          if (!released) {
            void scheduleDueBoundary();
          }
        });
        return;
      }
      /*
        Trigger 5's other half. This coordinator does not operate in the background — every other
        trigger it has is a foreground event — and a timer left armed there would either be throttled
        into uselessness by the platform or wake to start a transaction nothing is watching. It is
        cancelled on the way out and re-derived on the way back in, which is the same answer a
        moment later.
      */
      clearDueBoundary();
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
        void runContentSync().then(() => {
          if (!released) {
            void scheduleDueBoundary();
          }
        });
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
      /*
        The timer is a listener in every sense that matters here: it is a pending callback into a
        component that is going away. Left armed across an unmount it would fire into a released
        closure, and across React's development double-mount it would be the second of two.
      */
      clearDueBoundary();
    };
  }, [auth.authority, ownerKey, status]);

  return null;
}
