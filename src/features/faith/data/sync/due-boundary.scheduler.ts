/**
 * The due-boundary scheduler — one per session owner, disposed with it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this is an object and not a module-level timer ─────────────────────
 * The first version kept the handle in a module variable beside the owner. It worked, and the way it
 * failed under test was the warning: eight cases passed alone and failed in file order, because one
 * mount's pending callback was still armed when the next one started. That is usually dismissed as a
 * test-harness problem. It is not — a pending callback that outlives the thing that armed it is the
 * same defect on a device, and the shapes it takes there are worse than a confused assertion:
 *
 *   • React remounts the provider tree — deliberately in development, and on any parent re-key in
 *     production. Two mounts sharing one module variable meant the second armed over the first's
 *     handle, and whichever callback was already queued still ran.
 *   • Sign-out then sign-in inside one process gave the new session whatever retry deadline the old
 *     one had negotiated. A backoff belongs to the run that earned it.
 *   • A callback that fires between `clearTimeout` and the platform actually dropping it had nothing
 *     to consult except a module flag that the *next* owner had by then overwritten.
 *
 * So ownership is explicit. A scheduler is created for one owner, holds its own handle and its own
 * disposed flag, and once disposed does nothing at all — every entry point checks first, and the
 * armed callback checks again when it fires. A stale callback from a disposed scheduler is inert by
 * construction rather than by timing.
 *
 * ── What it is not ─────────────────────────────────────────────────────────
 * Not a sync engine. It decides *when to ask*, and the asking is `run`, which is the coordinator's
 * existing single-flight path. It holds no clock of its own: `dueDelayMs` reads the same generation
 * manifest the orchestrator's own due gate reads, so the two can never disagree.
 *
 * ── Injection, and the line it does not cross ──────────────────────────────
 * `now`, `setTimer` and `clearTimer` are injectable so a test can drive time deterministically. They
 * default to the real ones, and no lifecycle decision consults the environment: disposal, the
 * disposed checks and the owner check behave identically whether or not anything was injected. There
 * is no test-only disposal path, and nothing here reads `NODE_ENV`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The largest single wakeup. See `DUE_BOUNDARY_CHUNK_MS` at the call site for why it is bounded. */
export type TimerHandle = ReturnType<typeof setTimeout>;

export type DueBoundaryOutcome = {
  /** How long the caller was told to wait, when it was told anything. */
  readonly retryAfterMs?: number;
  readonly kind: string;
};

export type DueBoundaryDeps = {
  /**
   * How long until the feed check is next owed, capped by the caller.
   *
   * Zero or less means "owed now". This is the only clock the scheduler consults, and it is derived
   * from state that already exists — nothing here is persisted.
   */
  readonly dueDelayMs: (now: number) => Promise<number>;
  /** The existing single-flight sync path. Returns `null` when there is no live owner to run it. */
  readonly run: () => Promise<DueBoundaryOutcome | null>;
  /** Whether the owner this scheduler was built for is still the live one. */
  readonly isLive: () => boolean;
  /** The floor applied to any reschedule, so a past-due boundary cannot spin. */
  readonly minDelayMs: number;
  readonly now?: () => number;
  readonly setTimer?: (callback: () => void, ms: number) => TimerHandle;
  readonly clearTimer?: (handle: TimerHandle) => void;
};

export type DueBoundaryScheduler = {
  /** Arms the next evaluation, replacing whatever was armed. `delayMs` overrides the derived delay. */
  arm: (delayMs?: number) => Promise<void>;
  /** Drops the pending callback. The scheduler stays usable. */
  cancel: () => void;
  /** Asks whether the boundary has arrived, runs if it has, and re-arms either way. */
  reEvaluate: () => Promise<void>;
  /** Cancels and makes the scheduler permanently inert. Idempotent. */
  dispose: () => void;
  readonly isArmed: () => boolean;
  readonly isDisposed: () => boolean;
};

export function createDueBoundaryScheduler(deps: DueBoundaryDeps): DueBoundaryScheduler {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle));

  /** This scheduler's own handle. Not shared, so nothing else can arm over it or clear it. */
  let handle: TimerHandle | null = null;
  let disposed = false;

  /**
   * Whether this scheduler may still act.
   *
   * Both halves matter. `disposed` is about this object; `isLive()` is about the owner it was built
   * for. A scheduler can be undisposed and still have no business acting, because its session ended.
   */
  const active = (): boolean => !disposed && deps.isLive();

  const cancel = (): void => {
    if (handle !== null) {
      clearTimer(handle);
      handle = null;
    }
  };

  const arm = async (delayMs?: number): Promise<void> => {
    cancel();
    if (!active()) {
      return;
    }
    const delay = delayMs ?? (await deps.dueDelayMs(now()));
    /*
      Re-checked after the await. Disposal or a sign-out during the derivation must not leave a timer
      behind, and `cancel` above already ran — so returning here leaves nothing armed.
    */
    if (!active()) {
      return;
    }
    handle = setTimer(
      () => {
        handle = null;
        /*
        The armed callback re-checks rather than trusting that it was cancelled in time. A callback
        already queued when `cancel` ran will still fire, and this is what makes that harmless.
      */
        if (!active()) {
          return;
        }
        void reEvaluate();
      },
      Math.max(delay, 0),
    );
  };

  const reEvaluate = async (): Promise<void> => {
    if (!active()) {
      return;
    }
    /*
      ── A wakeup is a question, not a request ───────────────────────────────
      Most wakeups are not the boundary: they exist so a week-long wait is never entrusted to one
      timer. Re-deriving costs a subtraction against a timestamp already in memory. Asking the
      orchestrator instead would send a trigger every few hours — it would answer 'not-due' each
      time, but only after the coordinator had claimed a run and told every Faith screen a sync was
      under way.
    */
    const remaining = await deps.dueDelayMs(now());
    if (!active()) {
      return;
    }
    if (remaining > 0) {
      await arm(remaining);
      return;
    }

    const outcome = await deps.run();
    if (!active()) {
      return;
    }
    /*
      A throttled run already decided how long to wait, and re-deriving that here would be a second
      retry policy disagreeing with the first. The floor still applies, so a report of zero cannot
      become a spin.
    */
    if (outcome !== null && outcome.kind === 'throttled' && outcome.retryAfterMs !== undefined) {
      await arm(Math.max(outcome.retryAfterMs, deps.minDelayMs));
      return;
    }
    /*
      Everything else re-derives. A publication moved the clock, so the next delay is a fresh
      interval. Offline and failure leave the boundary in the past, and the floor is what stops that
      becoming a spin — the device waits and asks again, and the connectivity trigger usually beats it.
    */
    const derived = await deps.dueDelayMs(now());
    if (!active()) {
      return;
    }
    await arm(derived > 0 ? derived : deps.minDelayMs);
  };

  return {
    arm,
    cancel,
    reEvaluate,
    dispose: () => {
      cancel();
      disposed = true;
    },
    isArmed: () => handle !== null,
    isDisposed: () => disposed,
  };
}
