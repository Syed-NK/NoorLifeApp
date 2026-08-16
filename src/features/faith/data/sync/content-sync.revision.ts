import type { SyncFailure } from '../../storage/faith-sync-checkpoint';

/**
 * The one bounded notification that a new generation became active, and the status readers render.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why a revision counter rather than the generation itself ───────────────
 * Consumers do not need the content pushed at them; they need to know that what they read last is no
 * longer current. A monotonically increasing number does that in a few bytes and cannot carry a
 * verse, a token or a path — whereas broadcasting the generation would put 6,236 rows into every
 * subscriber's closure and make "readers started before publication keep their generation" a
 * discipline rather than a fact.
 *
 * So a reader that captured generation A keeps reading A until it chooses to re-resolve. The revision
 * is the signal that re-resolving would now give something different.
 *
 * ── The ordering rule ──────────────────────────────────────────────────────
 * **A revision is emitted only after the pointer write has succeeded.** Emitting earlier would tell
 * subscribers to re-read while the pointer still names the old generation — they would re-read the
 * same thing and conclude nothing changed, and a later real publication with the same revision would
 * be missed. A failed publication emits nothing at all.
 *
 * ── What may never be in here ──────────────────────────────────────────────
 * There is no field on `SyncStatus` or `SyncRevision` that can hold Qur'an text, translation text, an
 * audio URL, a token, a cursor, a resource id or a filesystem path. Every member is a closed literal
 * or a number, which is what makes "the status UI cannot leak content" structural rather than a rule
 * somebody has to remember at each call site.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * What a Faith consumer may be told about synchronisation.
 *
 * `provisional-snapshot-reconciliation` is the one member that is a licence statement rather than an
 * engineering one: the change feed has never emitted a recitation mutation, so audio currency rests
 * on re-fetching the approved snapshot and comparing it — **assumption A1, provisional and pending
 * Quran Foundation's written confirmation**. A screen showing this must not describe the recitation
 * as confirmed by the feed, because it was not.
 */
export type SyncStatus =
  /** No generation has ever been published on this device. */
  | 'never-synchronized'
  /** A transaction is in flight. */
  | 'checking'
  /** A generation is active and inside its window. */
  | 'current'
  /** A generation is active and the seven-connected-day window has elapsed. */
  | 'update-due'
  /** No link at all. Content stays available; the check is owed. */
  | 'offline'
  /** A link exists but reachability is unconfirmed — a captive portal, or a platform that will not say. */
  | 'waiting-for-connectivity'
  /** The last run failed for a reason that retrying can fix. */
  | 'failed-retryable'
  /** The session is absent or was refused. Nothing is attempted. */
  | 'authentication-required'
  /** Current, but the audio half rests on assumption A1 rather than an observed mutation. */
  | 'provisional-snapshot-reconciliation';

/**
 * A bounded description of where synchronisation stands.
 *
 * Every field is a literal, a boolean or a timestamp. Nothing here identifies content, and nothing
 * here is a path.
 */
export type SyncStatusModel = {
  readonly status: SyncStatus;
  /** Increments once per successful publication. The signal to re-resolve. */
  readonly revision: number;
  /** When the active generation was published. `null` when none has been. */
  readonly lastPublishedAt: number | null;
  /** When the recitation resource was last reconciled. `null` when never. */
  readonly lastRecitationCheckAt: number | null;
  /** Whether a recitation mutation has ever been observed. `false` on every device to date. */
  readonly recitationMutationObserved: boolean;
  /** The last failure, when one is outstanding. A closed reason, never a message. */
  readonly lastFailure: SyncFailure | null;
  /** Whether a transaction is in flight right now. */
  readonly isRunning: boolean;
};

export const INITIAL_STATUS: SyncStatusModel = {
  status: 'never-synchronized',
  revision: 0,
  lastPublishedAt: null,
  lastRecitationCheckAt: null,
  recitationMutationObserved: false,
  lastFailure: null,
  isRunning: false,
};

type Listener = (model: SyncStatusModel) => void;

/**
 * The in-memory revision channel.
 *
 * A module singleton, deliberately: there is one synchronisation for the process, so there is one
 * place its state lives. It holds no content and dies with the process — nothing here is persisted,
 * because everything durable is already in the generation.
 */
const listeners = new Set<Listener>();
let current: SyncStatusModel = INITIAL_STATUS;

export function readSyncStatus(): SyncStatusModel {
  return current;
}

/**
 * Subscribes to status changes. Returns the unsubscribe.
 *
 * Not invoked with the current value on subscribe — a caller that wants it now calls
 * `readSyncStatus()`. Keeping "I asked" and "I was told" apart is what stops a screen treating its
 * own mount as a change and re-running work.
 */
export function subscribeSyncStatus(listener: Listener): () => void {
  listeners.add(listener);
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    listeners.delete(listener);
  };
}

/** Whether two models describe the same state. Every field is a primitive, so this is total. */
function same(a: SyncStatusModel, b: SyncStatusModel): boolean {
  return (
    a.status === b.status &&
    a.revision === b.revision &&
    a.lastPublishedAt === b.lastPublishedAt &&
    a.lastRecitationCheckAt === b.lastRecitationCheckAt &&
    a.recitationMutationObserved === b.recitationMutationObserved &&
    a.lastFailure === b.lastFailure &&
    a.isRunning === b.isRunning
  );
}

/**
 * Publishes a new model, unless it is the one already published.
 *
 * The equality check is not an optimisation. `useSyncExternalStore` re-renders every subscriber on
 * notification, and the signed-out path is re-entered on every auth-state render — so emitting an
 * identical model would make "nothing happened" indistinguishable from "something happened" both to
 * React and to a test asserting that a repeated signed-out render changes nothing.
 */
function emit(next: SyncStatusModel): void {
  if (same(current, next)) {
    return;
  }
  current = next;
  /* Iterated over a copy: a listener that unsubscribes itself must not stop the next being told. */
  for (const listener of [...listeners]) {
    try {
      listener(next);
    } catch {
      /* A subscriber's failure is its own. This channel has no logger, by design. */
    }
  }
}

/** Merges a partial update and notifies. The only mutation path. */
export function updateSyncStatus(patch: Partial<Omit<SyncStatusModel, 'revision'>>): void {
  emit({ ...current, ...patch });
}

/**
 * Drops everything the ended session told the UI, and says why nothing is running now.
 *
 * ── Why this is not `resetSyncStatus` ──────────────────────────────────────
 * `resetSyncStatus` clears the **subscribers** as well, which is right between test cases and wrong
 * on sign-out: a `useContentSync` consumer that survives the sign-out — every Faith screen does —
 * would be left holding a subscription that had been thrown away, and would never hear another
 * update for the rest of the process. Sign-out ends a session, not a component tree.
 *
 * `revision` is carried forward rather than reset, because it is a *process-wide re-read signal* and
 * not session state. The published generation is still on disk and still readable after sign-out —
 * it is application content, not the departed user's data — so a consumer that already resolved it
 * has nothing to re-read, and winding the counter back would tell it otherwise.
 */
export function clearSessionSyncStatus(status: SyncStatus): void {
  emit({ ...INITIAL_STATUS, revision: current.revision, status });
}

/**
 * Announces that a new generation is active.
 *
 * **Called only after the pointer write succeeded.** The revision increments here and nowhere else,
 * so "exactly one revision per successful publication" is a property of there being one call site
 * rather than a convention.
 */
export function publishRevision(details: {
  readonly publishedAt: number;
  readonly lastRecitationCheckAt: number | null;
  readonly recitationMutationObserved: boolean;
  readonly provisional: boolean;
}): number {
  const revision = current.revision + 1;
  emit({
    ...current,
    revision,
    status: details.provisional ? 'provisional-snapshot-reconciliation' : 'current',
    lastPublishedAt: details.publishedAt,
    lastRecitationCheckAt: details.lastRecitationCheckAt,
    recitationMutationObserved: details.recitationMutationObserved,
    lastFailure: null,
    isRunning: false,
  });
  return revision;
}

/**
 * Resets the channel **and drops every subscriber**. For tests, between cases.
 *
 * Not the sign-out path, and the comment here used to say it was. Discarding the subscribers is
 * correct only when the component tree is being discarded too; on a sign-out it would silently
 * unhook every live `useContentSync` for the rest of the process. Sign-out uses
 * `clearSessionSyncStatus`.
 */
export function resetSyncStatus(): void {
  current = INITIAL_STATUS;
  listeners.clear();
}

/** How many subscribers are attached. Lets a test prove a teardown actually detached. */
export function syncStatusSubscriberCount(): number {
  return listeners.size;
}
