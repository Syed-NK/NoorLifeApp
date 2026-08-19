import {
  faithStorageKeys,
  hasNumber,
  isRecord,
  readJson,
  removeKey,
  writeChecked,
  writeJson,
} from '../../storage/faith-storage';
import type { FaithResult } from '../faith-result';
import {
  MAX_TASBIH_TARGET,
  MIN_TASBIH_TARGET,
  type CounterLabel,
  type TasbihHistoryEntry,
  type TasbihRepository,
  type TasbihSession,
} from '../tasbih.repository';

/**
 * The tasbih counter — a **private, on-device counter**, and nothing more.
 *
 * ── Why this file exists at a production path ───────────────────────────────
 * The counting engine below is real: it persists, it serialises its mutations, it survives a
 * force-stop. It lived in `data/mock/mock-tasbih.repository.ts`, which was wrong in the same way
 * `getQiblaBearing` living in the mosque fixture was wrong — the *engine* was never a fixture. What
 * made that file a fixture was the five built-in dhikr it shipped alongside, and those are gone.
 *
 * ── What was removed, and on what grounds ───────────────────────────────────
 * Five built-in entries, each carrying Arabic, a transliteration and an English translation. An
 * audit for the four things NoorLife requires of religious content it presents — verified Arabic,
 * verified translation, recorded provenance, compatible redistribution licence — found **none of the
 * four** for any of the five. No source, no reference, no verification note, no licence, anywhere in
 * the repository or its documentation.
 *
 * That is the same standard that deleted the prayer-times fixture and the Hadith, Dua and mosque
 * fixtures, and it applies with more force here: this text is rendered at display size and is text a
 * user may recite. The removed strings are not reproduced here, in a comment, in a test fixture, or
 * in `docs/` — see `docs/FAITH_TASBIH_CONTENT_AUDIT.md` for the record of what was removed and why.
 *
 * Built-in phrases may return only when all four elements are documented per entry.
 *
 * ── What a label is now ─────────────────────────────────────────────────────
 * The user's own words, stored on this device, sent nowhere. `CounterLabel` has no `arabic`, no
 * `translation`, no `reference` and no `verified` — there is no shape in which NoorLife could
 * present one as authenticated, recommended or sourced, which is stronger than a rule saying it
 * must not.
 */

/**
 * The default counter, present on a fresh install so the screen is usable immediately.
 *
 * ── Deliberately neutral ────────────────────────────────────────────────────
 * "My counter", not "dhikr", not "Sunnah", not "recommended", not "verified". A default target of 33
 * is a round length and is described as nothing else: it is a number this counter happens to start
 * at, and the user may change it. Naming it after a devotional practice would reintroduce, as a
 * label, exactly the unverified claim the five entries were removed for.
 */
export const DEFAULT_COUNTER: CounterLabel = {
  id: 'default',
  name: 'My counter',
  target: 33,
};

/** The persisted shape's version. Bumped when the *meaning* of a stored field changes. */
export const TASBIH_SCHEMA_VERSION = 2;

/** How long a user's own label may be. Bounded so a label cannot become a document. */
export const MAX_LABEL_LENGTH = 40;

/**
 * The identifiers the removed built-in entries used.
 *
 * Kept as **ids only** — no Arabic, no transliteration, no translation. A stored session pointing at
 * one of these is a session from a build that shipped content NoorLife can no longer stand behind,
 * and the migration converts it to the neutral counter while keeping the count. The ids are needed
 * to recognise that case; the text is not, so it is not here.
 */
const REMOVED_BUILT_IN_IDS: ReadonlySet<string> = new Set([
  'subhanallah',
  'alhamdulillah',
  'allahuakbar',
  'astaghfirullah',
  'la-ilaha',
]);

const nowIso = (): string => new Date().toISOString();

/** A string field, or `null`. `hasString` reports presence; this narrows the value too. */
function readString(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === 'string' && field.length > 0 ? field : null;
}

/** A count, target or round as it must be to be usable: finite, whole, not negative. */
function usableNumber(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  const whole = Math.round(value);
  return whole < min || whole > max ? null : whole;
}

function isLabel(value: unknown): value is CounterLabel {
  return (
    isRecord(value) &&
    readString(value, 'id') !== null &&
    readString(value, 'name') !== null &&
    usableNumber((value as { target: unknown }).target, MIN_TASBIH_TARGET, MAX_TASBIH_TARGET) !==
      null
  );
}

function isHistory(value: unknown): value is TasbihHistoryEntry[] {
  return Array.isArray(value) && value.every((item) => isRecord(item) && hasNumber(item, 'count'));
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * What a stored session turned out to be.
 *
 * A union rather than "a session or null", because the three outcomes have different consequences:
 * a current record is used as-is, a legacy one is rewritten once, and an unreadable one must not
 * quietly become a fresh counter that discards a real count.
 */
export type StoredSessionParse =
  | { readonly kind: 'current'; readonly session: TasbihSession }
  | { readonly kind: 'migrated'; readonly session: TasbihSession }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable' };

/**
 * Interprets whatever is in the session key.
 *
 * ── The migration table ─────────────────────────────────────────────────────
 * | Stored                                        | Becomes                                       |
 * |-----------------------------------------------|-----------------------------------------------|
 * | `version: 2`, valid                           | itself — no write                             |
 * | v1 with a **removed built-in** `presetId`     | the neutral counter; count, target and rounds kept |
 * | v1 with any other `presetId`                  | that id kept as the counter id; values kept   |
 * | count / target / rounds non-finite or out of range | that field falls back to a safe value    |
 * | anything else                                 | *unreadable* — storage is left alone          |
 *
 * ── Why a removed preset does not reset the count ───────────────────────────
 * Because the count is the user's, and the reason for the removal is NoorLife's. Somebody who has
 * counted eighty-seven repetitions has done that regardless of what the label said, and discarding
 * it on upgrade would be the app deciding their dhikr did not happen. The *label* is dropped — that
 * is the part NoorLife could not stand behind — and the number is kept.
 *
 * ── Idempotent by construction ──────────────────────────────────────────────
 * A migrated record is written with `version: 2` and a counter id that is never in
 * `REMOVED_BUILT_IN_IDS`, so re-running this on its own output takes the `current` branch and writes
 * nothing.
 */
export function parseStoredSession(value: unknown): StoredSessionParse {
  if (value === null || value === undefined) {
    return { kind: 'absent' };
  }
  if (!isRecord(value)) {
    return { kind: 'unreadable' };
  }

  const target =
    usableNumber(value.target, MIN_TASBIH_TARGET, MAX_TASBIH_TARGET) ?? DEFAULT_COUNTER.target;
  const count = usableNumber(value.count, 0, MAX_TASBIH_TARGET) ?? 0;
  const rounds = usableNumber(value.rounds, 0, Number.MAX_SAFE_INTEGER) ?? 0;
  const startedAt = readString(value, 'startedAt') ?? nowIso();

  const counterId = readString(value, 'counterId');
  if (value.version === TASBIH_SCHEMA_VERSION && counterId !== null) {
    return {
      kind: 'current',
      session: {
        counterId,
        count,
        target,
        rounds,
        startedAt,
        updatedAt: readString(value, 'updatedAt') ?? nowIso(),
      },
    };
  }

  /*
    V1 had no `version` and identified the counter by `presetId`. Anything with a usable `presetId`
    is a v1 record; anything without one is not a session this app ever wrote.
  */
  const legacyId = readString(value, 'presetId');
  if (legacyId === null) {
    return { kind: 'unreadable' };
  }
  return {
    kind: 'migrated',
    session: {
      // The label goes; the number stays. See the note above.
      counterId: REMOVED_BUILT_IN_IDS.has(legacyId) ? DEFAULT_COUNTER.id : legacyId,
      count,
      target,
      rounds,
      startedAt,
      updatedAt: nowIso(),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The per-counter session store
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The version of the **store**, which is a different thing from the version of a session.
 *
 * `TASBIH_SCHEMA_VERSION` describes one session record and is unchanged: a v2 session is still a v2
 * session, it simply now lives in a map beside its siblings rather than alone under its own key.
 * Two numbers because the two shapes can change independently, and conflating them would make a
 * change to either look like a change to both.
 */
export const TASBIH_STORE_VERSION = 3;

/**
 * Every counter's counting state, and which one is in front.
 *
 * ── Why the active id lives here rather than in preferences ────────────────
 * Because "which counter am I on" and "where is that counter up to" are read together, on every
 * mount and every tap, and a split across two keys is a split across two writes — an app killed
 * between them would come back pointing at one counter and showing another's count.
 */
type SessionStore = {
  readonly version: number;
  readonly activeCounterId: string;
  readonly sessions: Readonly<Record<string, TasbihSession>>;
};

function isSession(value: unknown): value is TasbihSession {
  if (!isRecord(value)) {
    return false;
  }
  return (
    readString(value, 'counterId') !== null &&
    usableNumber(value.count, 0, MAX_TASBIH_TARGET) !== null &&
    usableNumber(value.target, MIN_TASBIH_TARGET, MAX_TASBIH_TARGET) !== null &&
    usableNumber(value.rounds, 0, Number.MAX_SAFE_INTEGER) !== null
  );
}

/**
 * Interprets whatever is under the sessions key, or `null` if it is not a store.
 *
 * A session whose stored key and whose own `counterId` disagree is dropped rather than repaired. The
 * two are the same fact written twice, and a disagreement means one of them is wrong — repairing it
 * would be guessing which, and guessing wrong attaches somebody's count to a counter they were not
 * on.
 */
function parseSessionStore(value: unknown): SessionStore | null {
  if (!isRecord(value) || value.version !== TASBIH_STORE_VERSION) {
    return null;
  }
  const activeCounterId = readString(value, 'activeCounterId');
  const raw = value.sessions;
  if (activeCounterId === null || !isRecord(raw)) {
    return null;
  }
  const sessions: Record<string, TasbihSession> = {};
  for (const [counterId, session] of Object.entries(raw)) {
    if (isSession(session) && session.counterId === counterId) {
      sessions[counterId] = session;
    }
  }
  return { version: TASBIH_STORE_VERSION, activeCounterId, sessions };
}

export function createLocalTasbihRepository(): TasbihRepository {
  /**
   * Mutations run one at a time, in the order they were requested.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * ── The race this closes, and why it is the important one here ──────────────
   * Every mutation is a read-modify-write across an `await`: load the store, apply the change, write
   * it back. Two taps arriving before the first write lands both read the *same* stored session,
   * both compute a count of one, and both write it. The second tap is silently lost.
   *
   * Which is exactly the defining use of a tasbih. Somebody counting a hundred repetitions taps as
   * fast as their thumb moves — that is not an edge case, it is the feature — and a counter that
   * drops beads under fast tapping is a counter that miscounts an act of worship.
   *
   * A serial queue is the smallest fix that is actually correct: each mutation awaits the previous
   * one, so every one of them reads what the last one wrote. Ordering is preserved, no work is
   * dropped, and nothing needs to know about anything else.
   *
   * **Switching counters is queued too**, which it was not before. It has always been a
   * read-modify-write of the same key as a tap, so a switch racing an in-flight increment could
   * write a store built from the state before that increment — losing the tap, on the one operation
   * where losing one is most visible.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  let pending: Promise<unknown> = Promise.resolve();

  const freshSession = (counterId: string, target: number): TasbihSession => ({
    counterId,
    count: 0,
    rounds: 0,
    target,
    startedAt: nowIso(),
    updatedAt: nowIso(),
  });

  async function loadLabels(): Promise<readonly CounterLabel[]> {
    const stored = await readJson<CounterLabel[]>(
      faithStorageKeys.tasbihLabels,
      [],
      (value): value is CounterLabel[] => Array.isArray(value) && value.every(isLabel),
    );
    /*
      The default is always present and is not stored, so it cannot be deleted, corrupted or
      duplicated — which is what guarantees a counter always exists.
    */
    return [DEFAULT_COUNTER, ...stored.filter((label) => label.id !== DEFAULT_COUNTER.id)];
  }

  /**
   * Reads the store, migrating a single-session build exactly once.
   *
   * ── What the migration does, and the one thing it refuses to do ───────────
   * A v1 or v2 record under the old key becomes the sole entry of a new store, active, with its
   * count, rounds and target intact — `parseStoredSession` already handles the label question and
   * this changes none of its answers. The old key is then removed, because leaving it would leave a
   * second copy of a count that will never be updated again, and a stale count is the one kind of
   * wrong number this feature must not produce.
   *
   * An **unreadable** record is left exactly where it is and nothing is written. Storage is not
   * destroyed to make a screen render; the caller sees no session and starts a fresh counter beside
   * whatever could not be interpreted.
   */
  async function loadStore(): Promise<SessionStore | null> {
    const raw = await readJson<unknown>(
      faithStorageKeys.tasbihSessions,
      null,
      (_value): _value is unknown => true,
    );
    const parsed = parseSessionStore(raw);
    if (parsed !== null) {
      return parsed;
    }

    const legacyRaw = await readJson<unknown>(
      faithStorageKeys.tasbihSession,
      null,
      (_value): _value is unknown => true,
    );
    const legacy = parseStoredSession(legacyRaw);
    if (legacy.kind !== 'current' && legacy.kind !== 'migrated') {
      return null;
    }

    const migrated: SessionStore = {
      version: TASBIH_STORE_VERSION,
      activeCounterId: legacy.session.counterId,
      sessions: { [legacy.session.counterId]: legacy.session },
    };
    const written = await writeChecked(faithStorageKeys.tasbihSessions, migrated);
    if (written) {
      /*
        Removed only once the new store is safely on disk. A failed write leaves both keys as they
        were and the next launch migrates again, identically — the migration is idempotent, so
        repeating it costs nothing where losing the count would cost everything.
      */
      await removeKey(faithStorageKeys.tasbihSession);
    }
    return migrated;
  }

  async function writeStore(store: SessionStore): Promise<boolean> {
    return writeChecked(faithStorageKeys.tasbihSessions, store);
  }

  async function archive(session: TasbihSession): Promise<void> {
    if (session.count === 0 && session.rounds === 0) {
      return;
    }
    const history = await readJson(
      faithStorageKeys.tasbihHistory,
      [] as TasbihHistoryEntry[],
      isHistory,
    );
    const entry: TasbihHistoryEntry = {
      counterId: session.counterId,
      count: session.count,
      rounds: session.rounds,
      completedAt: nowIso(),
    };
    await writeJson(faithStorageKeys.tasbihHistory, [entry, ...history].slice(0, 50));
  }

  /**
   * Runs one change to the store, serialised behind every other.
   *
   * The queue is advanced by a promise that cannot reject, so a failed operation does not wedge every
   * later tap.
   */
  async function withStore<T>(operation: (store: SessionStore | null) => Promise<T>): Promise<T> {
    const run = pending.then(async () => operation(await loadStore()));
    pending = run.catch(() => undefined);
    return run;
  }

  /** Applies a change to whichever session is active, creating one if there is none. */
  async function mutate(
    change: (session: TasbihSession) => TasbihSession,
  ): Promise<FaithResult<TasbihSession>> {
    return withStore(async (store): Promise<FaithResult<TasbihSession>> => {
      const activeCounterId = store?.activeCounterId ?? DEFAULT_COUNTER.id;
      const current =
        store?.sessions[activeCounterId] ?? freshSession(activeCounterId, DEFAULT_COUNTER.target);
      const next = change(current);
      const written = await writeStore({
        version: TASBIH_STORE_VERSION,
        activeCounterId,
        sessions: { ...(store?.sessions ?? {}), [activeCounterId]: next },
      });
      if (!written) {
        return { kind: 'error', code: 'unavailable', detail: 'tasbih write failed' };
      }
      return { kind: 'ok', data: next };
    });
  }

  /** Drops one counter's state, falling the active pointer back to the default when it was that one. */
  async function forget(counterId: string): Promise<void> {
    await withStore(async (store) => {
      if (store === null || store.sessions[counterId] === undefined) {
        return;
      }
      const sessions = { ...store.sessions };
      delete sessions[counterId];
      /*
        Every other counter's state is copied across untouched, which is the whole point: removing one
        selection must never be able to disturb the count on another.
      */
      const activeCounterId =
        store.activeCounterId === counterId ? DEFAULT_COUNTER.id : store.activeCounterId;
      await writeStore({ version: TASBIH_STORE_VERSION, activeCounterId, sessions });
    });
  }

  return {
    async listLabels(): Promise<FaithResult<readonly CounterLabel[]>> {
      return { kind: 'ok', data: await loadLabels() };
    },

    async createLabel(name: string): Promise<FaithResult<CounterLabel>> {
      const trimmed = name.trim().slice(0, MAX_LABEL_LENGTH);
      if (trimmed.length === 0) {
        return { kind: 'error', code: 'unknown', detail: 'a label needs a name' };
      }
      const labels = await loadLabels();
      /*
        The id is derived from the clock rather than from the name. A name-derived id would leak the
        user's words into a key, and two labels with the same name would collide.
      */
      const label: CounterLabel = {
        id: `user-${Date.now().toString(36)}`,
        name: trimmed,
        target: DEFAULT_COUNTER.target,
      };
      const stored = labels.filter((item) => item.id !== DEFAULT_COUNTER.id);
      const written = await writeChecked(faithStorageKeys.tasbihLabels, [...stored, label]);
      if (!written) {
        return { kind: 'error', code: 'unavailable', detail: 'label write failed' };
      }
      return { kind: 'ok', data: label };
    },

    async renameLabel(id: string, name: string): Promise<FaithResult<CounterLabel>> {
      const trimmed = name.trim().slice(0, MAX_LABEL_LENGTH);
      if (trimmed.length === 0) {
        return { kind: 'error', code: 'unknown', detail: 'a label needs a name' };
      }
      if (id === DEFAULT_COUNTER.id) {
        /*
          The default is not the user's text — it is the neutral counter every install starts with,
          and the fallback `deleteLabel` returns to. Letting it be renamed would make the one label
          NoorLife supplies indistinguishable from one the user wrote.
        */
        return { kind: 'error', code: 'unsupported', detail: 'the default counter keeps its name' };
      }

      const stored = (await loadLabels()).filter((item) => item.id !== DEFAULT_COUNTER.id);
      const existing = stored.find((item) => item.id === id);
      if (existing === undefined) {
        return { kind: 'error', code: 'unknown', detail: 'no such label' };
      }

      const renamed: CounterLabel = { ...existing, name: trimmed };
      const written = await writeChecked(
        faithStorageKeys.tasbihLabels,
        stored.map((item) => (item.id === id ? renamed : item)),
      );
      if (!written) {
        return { kind: 'error', code: 'unavailable', detail: 'label write failed' };
      }
      return { kind: 'ok', data: renamed };
    },

    async deleteLabel(id: string): Promise<FaithResult<readonly CounterLabel[]>> {
      if (id === DEFAULT_COUNTER.id) {
        // Removing the default would leave a screen with no counter at all.
        return { kind: 'error', code: 'unsupported', detail: 'the default counter stays' };
      }
      const labels = await loadLabels();
      const remaining = labels.filter((item) => item.id !== id && item.id !== DEFAULT_COUNTER.id);
      const written = await writeChecked(faithStorageKeys.tasbihLabels, remaining);
      if (!written) {
        return { kind: 'error', code: 'unavailable', detail: 'label write failed' };
      }
      /*
        The label is gone, so its counting state is unreachable — nothing could ever select it again,
        and leaving it behind would be a row of storage nobody can see or clear. The history entry it
        may have produced is untouched.
      */
      await forget(id);
      return { kind: 'ok', data: [DEFAULT_COUNTER, ...remaining] };
    },

    async getSession(): Promise<FaithResult<TasbihSession>> {
      const store = await loadStore();
      const session = store === null ? undefined : store.sessions[store.activeCounterId];
      return session === undefined ? { kind: 'empty' } : { kind: 'ok', data: session };
    },

    async startSession(
      counterId: string,
      options?: { readonly target?: number },
    ): Promise<FaithResult<TasbihSession>> {
      return withStore(async (store): Promise<FaithResult<TasbihSession>> => {
        const existing = store?.sessions[counterId];
        if (existing !== undefined) {
          /*
            Resumed exactly as it was left, including its target. Nothing is archived and no other
            counter is touched — switching is a change of view, not the end of a count.
          */
          const written = await writeStore({
            version: TASBIH_STORE_VERSION,
            activeCounterId: counterId,
            sessions: store?.sessions ?? {},
          });
          return written
            ? { kind: 'ok', data: existing }
            : { kind: 'error', code: 'unavailable', detail: 'tasbih write failed' };
        }

        /*
          A counter with no session yet. Its starting target comes from its label where it has one,
          from the caller where it does not — a Quran selection has no label, so the screen sending
          it here is the only thing that knows what to start it at — and from the neutral default
          otherwise.
        */
        const label = (await loadLabels()).find((item) => item.id === counterId);
        const target =
          label?.target ??
          (options?.target === undefined
            ? DEFAULT_COUNTER.target
            : Math.min(Math.max(Math.round(options.target), MIN_TASBIH_TARGET), MAX_TASBIH_TARGET));
        const next = freshSession(counterId, target);
        const written = await writeStore({
          version: TASBIH_STORE_VERSION,
          activeCounterId: counterId,
          sessions: { ...(store?.sessions ?? {}), [counterId]: next },
        });
        return written
          ? { kind: 'ok', data: next }
          : { kind: 'error', code: 'unavailable', detail: 'tasbih write failed' };
      });
    },

    async forgetCounter(counterId: string): Promise<void> {
      await forget(counterId);
    },

    async increment(): Promise<FaithResult<TasbihSession>> {
      return mutate((session) => {
        const count = session.count + 1;
        // A completed round rolls the count back to zero and banks the round, which is how a
        // physical tasbih behaves.
        const completed = count >= session.target;
        return {
          ...session,
          count: completed ? 0 : count,
          rounds: completed ? session.rounds + 1 : session.rounds,
          updatedAt: nowIso(),
        };
      });
    },

    async decrement(): Promise<FaithResult<TasbihSession>> {
      return mutate((session) => ({
        ...session,
        count: Math.max(0, session.count - 1),
        updatedAt: nowIso(),
      }));
    },

    async adjustTarget(delta: number): Promise<FaithResult<TasbihSession>> {
      if (!Number.isFinite(delta)) {
        return { kind: 'error', code: 'unknown' };
      }
      /*
        The count survives a target change. The taps already made were real, and discarding them
        because somebody adjusted their intention mid-session would be the counter deciding their
        count did not happen. A target set below the current count simply completes the round on the
        next tap.
      */
      return mutate((session) => ({
        ...session,
        // Clamped after applying, so pressing past a bound stops there rather than failing.
        target: Math.min(
          Math.max(Math.round(session.target + delta), MIN_TASBIH_TARGET),
          MAX_TASBIH_TARGET,
        ),
        updatedAt: nowIso(),
      }));
    },

    /**
     * Ends the **active** count, and only it.
     *
     * The count is archived to history first, so a reset is a completed session rather than a
     * deletion, and the replacement keeps the target the user had set — resetting the round length
     * along with the count would undo an intention they never asked to change.
     */
    async reset(): Promise<FaithResult<TasbihSession>> {
      return withStore(async (store): Promise<FaithResult<TasbihSession>> => {
        const activeCounterId = store?.activeCounterId ?? DEFAULT_COUNTER.id;
        const current = store?.sessions[activeCounterId] ?? null;
        if (current !== null) {
          await archive(current);
        }
        const next = freshSession(activeCounterId, current?.target ?? DEFAULT_COUNTER.target);
        const written = await writeStore({
          version: TASBIH_STORE_VERSION,
          activeCounterId,
          sessions: { ...(store?.sessions ?? {}), [activeCounterId]: next },
        });
        return written
          ? { kind: 'ok', data: next }
          : { kind: 'error', code: 'unavailable', detail: 'tasbih write failed' };
      });
    },

    async getHistory(limit = 20): Promise<FaithResult<readonly TasbihHistoryEntry[]>> {
      const history = await readJson(
        faithStorageKeys.tasbihHistory,
        [] as TasbihHistoryEntry[],
        isHistory,
      );
      return history.length === 0
        ? { kind: 'empty' }
        : { kind: 'ok', data: history.slice(0, limit) };
    },
  };
}
