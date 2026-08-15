import {
  defaultFaithPreferences,
  mutateFaithPreferences,
  readFaithPreferences,
  type FaithPreferences,
} from '../storage/faith-preferences';

/**
 * The one authority for Faith preferences, shared by every consumer in the module.
 *
 * ── The defect this replaces ────────────────────────────────────────────────
 * `useFaithPreferences` used to be a plain `useState` inside the hook body. Every call site
 * therefore got its **own** copy: the reminder screen held one, `usePrayerNotifications` — mounted by
 * that same screen — held a second, and the Tasbih, reader, reciter and preferences screens held four
 * more. Turning the master switch on wrote through `usePrayerNotifications`'s copy, so the switch the
 * user had just pressed was still reading the screen's own untouched copy and rendered as off. The
 * value was in storage the whole time; nothing was listening.
 *
 * That shape also raced. Two copies each did read-modify-write against the same blob, so a per-prayer
 * toggle followed quickly by the master toggle could have the second write land on a snapshot read
 * before the first, silently discarding it.
 *
 * ── Why a module singleton rather than only a context ───────────────────────
 * `FaithPreferencesProvider` mounts at the Faith boundary and is what triggers hydration once for the
 * whole module, but the *state* lives here, at module scope, rather than in the provider's value. Two
 * reasons, both practical:
 *
 *   1. Preferences are read from outside the Faith stack — the Main Home prayer row among them — and
 *      a context would make those call sites either crash or need a second, diverging source. A
 *      singleton has no boundary to be outside of.
 *   2. It survives navigation. Expo Router unmounts a stack's providers when the user leaves the
 *      module; a context-held snapshot would be re-read from storage on every return, reintroducing
 *      the flash of defaults the original hook was written to avoid.
 *
 * ── The two invariants ──────────────────────────────────────────────────────
 * **One snapshot.** `snapshot` is replaced, never mutated, so `useSyncExternalStore` can compare by
 * identity and every subscriber re-renders on the same commit with the same value. There is no path
 * that updates one consumer without the others.
 *
 * **One mutation at a time.** Every hydrate and every update goes through `enqueue`, a single promise
 * chain. Read-modify-write halves cannot interleave, so no write is lost, and a functional updater
 * always sees the result of the mutation before it rather than a value captured in a closure.
 */

export type FaithPreferencesSnapshot = {
  readonly preferences: FaithPreferences;
  /**
   * True once storage has answered, whatever it said.
   *
   * Never returns to false. A consumer that gated a fetch on `ready` would otherwise re-gate it every
   * time somebody changed an unrelated preference.
   */
  readonly ready: boolean;
  /**
   * Set when the most recent write did not reach the device.
   *
   * `null` is the normal state and is restored by the next write that succeeds. Held as a message
   * rather than a boolean so the surface that shows it does not have to invent the wording, and so a
   * future failure mode can say something different.
   */
  readonly persistenceError: string | null;
};

/** What a screen shows when the device refused a preference write. */
export const FAITH_PREFERENCES_PERSISTENCE_ERROR =
  'This change could not be saved on this device. It will apply until you close NoorLife.';

export type FaithPreferencesPatch =
  | Partial<FaithPreferences>
  | ((current: FaithPreferences) => Partial<FaithPreferences>);

type Listener = () => void;

/**
 * The single in-memory snapshot.
 *
 * Starts from the defaults rather than null so no screen has to guard against "not loaded yet" — the
 * defaults are valid preferences, and `ready` tells the two callers that need the distinction.
 */
let snapshot: FaithPreferencesSnapshot = {
  preferences: defaultFaithPreferences,
  ready: false,
  persistenceError: null,
};

const listeners = new Set<Listener>();

/** The serialisation chain. Every hydrate and update is a link in it. */
let queue: Promise<unknown> = Promise.resolve();

/** Memoised so a hundred mounting consumers produce one storage read, not a hundred. */
let hydration: Promise<FaithPreferences> | null = null;

/**
 * Bumped whenever the store is reset, so work started before the reset cannot publish after it.
 *
 * ── The leak this closes ────────────────────────────────────────────────────
 * `resetFaithPreferencesStore` used to drop the memoised promise and publish fresh defaults — but an
 * **already-running** hydration holds its own reference to `publish` and resolves regardless. Its
 * result then lands on top of the reset state, so the store reports `ready: true` carrying the
 * *previous* read's preferences.
 *
 * In tests that is a leak between cases: a suite would pass in isolation and fail in sequence,
 * because the second test's screen reconciled against the first test's preferences. In production it
 * is the same hazard in a rarer shape — anything that re-reads while a read is in flight.
 *
 * A generation stamp is the smallest fix that is correct in both: a publish that belongs to a
 * superseded generation is discarded rather than applied.
 */
let generation = 0;

function publish(next: FaithPreferencesSnapshot): void {
  snapshot = next;
  /*
    Iterated over a copy: a listener that unsubscribes during notification — a component unmounting
    in response to the very change being published — would otherwise mutate the set mid-iteration.
  */
  for (const listener of [...listeners]) {
    listener();
  }
}

/**
 * Runs `work` after everything already queued, whether that finished or threw.
 *
 * The chain is advanced with a swallowing continuation so one rejected mutation cannot wedge every
 * later one; the rejection is still delivered to *this* caller through the returned promise.
 */
function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export function getFaithPreferencesSnapshot(): FaithPreferencesSnapshot {
  return snapshot;
}

export function subscribeToFaithPreferences(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Reads storage into the snapshot, once per process.
 *
 * Queued rather than run directly, so a mutation issued before hydration settles cannot be undone by
 * a read that started before it. Without the queue the sequence "toggle master, then hydration
 * resolves" would publish the pre-toggle blob and put the switch back.
 */
export function hydrateFaithPreferences(): Promise<FaithPreferences> {
  const started = generation;
  hydration ??= enqueue(async () => {
    const stored = await readFaithPreferences();
    /* Superseded by a reset while this read was in flight. Its answer is about a past state. */
    if (started !== generation) {
      return stored;
    }
    publish({ ...snapshot, preferences: stored, ready: true });
    return stored;
  });
  return hydration;
}

/**
 * Applies a patch, persists it, and notifies every consumer.
 *
 * @param patch
 *   An object, or a function of the current preferences. Prefer the function whenever the new value
 *   depends on the old one — `(current) => ({ prayerNotifications: current.prayerNotifications.map(…) })`
 *   is correct under concurrent toggling where a captured array is not.
 *
 * Resolves with the merged preferences even when the write failed; the failure is reported through
 * the snapshot's `persistenceError` rather than by rejecting, because the in-memory value *is* what
 * the user asked for and the screen should show it.
 */
export function updateFaithPreferences(patch: FaithPreferencesPatch): Promise<FaithPreferences> {
  const started = generation;
  return enqueue(async () => {
    const { preferences, persisted } = await mutateFaithPreferences((current) =>
      typeof patch === 'function' ? patch(current) : patch,
    );
    if (started !== generation) {
      return preferences;
    }
    publish({
      preferences,
      ready: true,
      persistenceError: persisted ? null : FAITH_PREFERENCES_PERSISTENCE_ERROR,
    });
    return preferences;
  });
}

/**
 * Returns the store to its pre-hydration state.
 *
 * For tests only, and exported rather than reached through a back door so the reset is one call that
 * cannot drift from the fields above. Production has no path that should forget the user's
 * preferences, and nothing under `app/` or `features/` calls it.
 *
 * The wording avoids naming the fixture directory, deliberately: `privacy-security-source-scan`
 * asserts that no production module contains that string at all, because a single import of it would
 * put fixture data back into the release bundle silently. A comment is not an import, but a scan that
 * had to tell the difference would be a weaker scan.
 */
export function resetFaithPreferencesStore(): void {
  /* Before anything else: everything already in flight now belongs to a superseded generation. */
  generation += 1;
  hydration = null;
  queue = Promise.resolve();
  publish({ preferences: defaultFaithPreferences, ready: false, persistenceError: null });
}
