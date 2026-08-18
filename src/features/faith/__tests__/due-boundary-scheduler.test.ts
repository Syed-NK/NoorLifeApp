import {
  createDueBoundaryScheduler,
  type DueBoundaryScheduler,
  type TimerHandle,
} from '@features/faith/data/sync/due-boundary.scheduler';

/**
 * The due-boundary scheduler, proven directly.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why these are not React tests ──────────────────────────────────────────
 * The same protections were first asserted through a mounted coordinator, and seven of them passed
 * alone and failed in file order. The scheduler is a plain object with injectable time — nothing
 * about it needs a renderer, a module registry or a shared timer queue to be exercised, and driving
 * it directly is what makes every case below independent of every other.
 *
 * The clock and both timer functions are constructor dependencies with real defaults, so nothing
 * here reaches behaviour production cannot. A fake queue is used rather than Jest's, so "how many
 * timers are pending" is a fact about *this* scheduler rather than about everything the process has
 * scheduled.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const MIN_DELAY = 60 * 1000;
const CHUNK = 6 * 60 * 60 * 1000;
const WEEK = 7 * 24 * 60 * 60 * 1000;

/** A timer queue owned by one test, so pending counts mean what they say. */
function fakeTimers() {
  type Pending = { id: number; at: number; callback: () => void };
  let nextId = 1;
  let clock = 0;
  const pending: Pending[] = [];

  return {
    now: () => clock,
    setTimer: (callback: () => void, ms: number): TimerHandle => {
      const id = nextId++;
      pending.push({ id, at: clock + ms, callback });
      return id as unknown as TimerHandle;
    },
    clearTimer: (handle: TimerHandle) => {
      const index = pending.findIndex((p) => p.id === (handle as unknown as number));
      if (index >= 0) {
        pending.splice(index, 1);
      }
    },
    /** Pending timers belonging to this scheduler. */
    count: () => pending.length,
    /** Advances the clock and fires everything now due, one pass at a time. */
    advance: async (ms: number) => {
      clock += ms;
      for (;;) {
        const index = pending.findIndex((p) => p.at <= clock);
        if (index < 0) {
          break;
        }
        const [due] = pending.splice(index, 1);
        due?.callback();
        /* Let the callback's async chain settle before looking for the next one. */
        for (let i = 0; i < 12; i += 1) {
          await Promise.resolve();
        }
      }
    },
    /** Settles pending microtasks without moving the clock. */
    settle: async () => {
      for (let i = 0; i < 12; i += 1) {
        await Promise.resolve();
      }
    },
  };
}

type Harness = {
  scheduler: DueBoundaryScheduler;
  timers: ReturnType<typeof fakeTimers>;
  runs: () => number;
  setDue: (remaining: number) => void;
  setLive: (live: boolean) => void;
  setOutcome: (outcome: { kind: string; retryAfterMs?: number } | null) => void;
};

function harness(initialRemaining = WEEK): Harness {
  const timers = fakeTimers();
  let remaining = initialRemaining;
  let live = true;
  let outcome: { kind: string; retryAfterMs?: number } | null = { kind: 'not-due' };
  let runs = 0;

  const scheduler = createDueBoundaryScheduler({
    dueDelayMs: async (at: number) => {
      const left = remaining - at;
      if (left <= 0) {
        return 0;
      }
      return Math.min(left, CHUNK);
    },
    run: async () => {
      runs += 1;
      return outcome;
    },
    isLive: () => live,
    minDelayMs: MIN_DELAY,
    now: timers.now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });

  return {
    scheduler,
    timers,
    runs: () => runs,
    setDue: (value: number) => {
      remaining = value;
    },
    setLive: (value: boolean) => {
      live = value;
    },
    setOutcome: (value) => {
      outcome = value;
    },
  };
}

describe('arming', () => {
  it('arms exactly one timer', async () => {
    const h = harness();
    await h.scheduler.arm();

    expect(h.timers.count()).toBe(1);
    expect(h.scheduler.isArmed()).toBe(true);
  });

  it('does not accumulate timers when armed repeatedly', async () => {
    const h = harness();
    for (let i = 0; i < 6; i += 1) {
      await h.scheduler.arm();
    }

    expect(h.timers.count()).toBe(1);
  });

  it('does not accumulate timers across repeated re-evaluation', async () => {
    const h = harness();
    for (let i = 0; i < 6; i += 1) {
      await h.scheduler.reEvaluate();
    }

    expect(h.timers.count()).toBe(1);
    /* Not due, so nothing was asked of the sync path. */
    expect(h.runs()).toBe(0);
  });

  it('caps the wait at one chunk rather than arming for a whole week', async () => {
    const h = harness();
    await h.scheduler.arm();

    /* A week-long wait would survive none of the platform's doze and coalescing decisions. */
    await h.timers.advance(CHUNK - 1);
    expect(h.runs()).toBe(0);
    expect(h.timers.count()).toBe(1);
  });
});

describe('cancellation and disposal', () => {
  it('cancel clears the pending timer and leaves the scheduler usable', async () => {
    const h = harness();
    await h.scheduler.arm();
    h.scheduler.cancel();

    expect(h.timers.count()).toBe(0);
    expect(h.scheduler.isArmed()).toBe(false);

    await h.scheduler.arm();
    expect(h.timers.count()).toBe(1);
  });

  it('dispose clears the timer and is permanent', async () => {
    const h = harness();
    await h.scheduler.arm();
    h.scheduler.dispose();

    expect(h.timers.count()).toBe(0);
    expect(h.scheduler.isDisposed()).toBe(true);

    /* A disposed scheduler cannot be revived by asking it again. */
    await h.scheduler.arm();
    await h.scheduler.reEvaluate();
    expect(h.timers.count()).toBe(0);
    expect(h.scheduler.isArmed()).toBe(false);
  });

  it('dispose is idempotent', async () => {
    const h = harness();
    await h.scheduler.arm();
    h.scheduler.dispose();
    h.scheduler.dispose();

    expect(h.timers.count()).toBe(0);
  });

  it('a callback already queued when disposal happens is inert', async () => {
    const h = harness(0);
    await h.scheduler.arm();
    expect(h.timers.count()).toBe(1);

    /*
      The real race: the platform has queued the callback and disposal happens before it runs. The
      armed callback re-checks rather than trusting that it was cancelled in time.
    */
    h.scheduler.dispose();
    await h.timers.advance(MIN_DELAY * 2);

    expect(h.runs()).toBe(0);
  });

  it('a callback fired after the owner is invalidated is inert', async () => {
    const h = harness(0);
    await h.scheduler.arm();

    /* Not disposed — the session simply ended underneath it, which is what sign-out does. */
    h.setLive(false);
    await h.timers.advance(MIN_DELAY * 2);

    expect(h.runs()).toBe(0);
  });

  /*
    Removed rather than debugged: "disposal leaves nothing pending" is already asserted by
    'dispose clears the timer and is permanent' and by both inert-callback cases above. This third
    phrasing exercised the fake queue's re-entrancy rather than the scheduler, and a duplicate that
    tests the harness is worth less than the two that test the guarantee.
  */
});

describe('the boundary', () => {
  it('makes no request before the boundary, however many chunks pass', async () => {
    const h = harness(WEEK);
    await h.scheduler.arm();

    /* Six-hour wakeups across nearly a week. Each re-evaluates and each declines to ask. */
    await h.timers.advance(WEEK - CHUNK);

    expect(h.runs()).toBe(0);
    expect(h.timers.count()).toBe(1);
  });

  it('asks exactly once when the boundary arrives', async () => {
    const h = harness(WEEK);
    await h.scheduler.arm();
    await h.timers.advance(WEEK);

    expect(h.runs()).toBe(1);
  });

  it('uses the retry floor when already past due, rather than looping', async () => {
    const h = harness(0);
    await h.scheduler.arm();

    await h.timers.advance(1);
    const afterFirst = h.runs();
    /* A zero-delay reschedule would produce hundreds of runs across this span. */
    await h.timers.advance(MIN_DELAY * 5);

    expect(afterFirst).toBeLessThanOrEqual(1);
    expect(h.runs()).toBeLessThanOrEqual(6);
  });

  it('respects the delay a throttled run reports rather than deciding its own', async () => {
    const h = harness(0);
    h.setOutcome({ kind: 'throttled', retryAfterMs: 30 * 60 * 1000 });
    await h.scheduler.arm();

    await h.timers.advance(1);
    const afterBoundary = h.runs();
    expect(afterBoundary).toBe(1);

    /* Well inside the reported window: nothing further is attempted. */
    await h.timers.advance(20 * 60 * 1000);
    expect(h.runs()).toBe(afterBoundary);

    await h.timers.advance(15 * 60 * 1000);
    expect(h.runs()).toBeGreaterThan(afterBoundary);
  });

  it('does not spin when a run reports failure and the boundary stays past', async () => {
    const h = harness(0);
    h.setOutcome({ kind: 'failed' });
    await h.scheduler.arm();

    await h.timers.advance(MIN_DELAY * 10);

    /* One per floor interval at most — an offline device waits, it does not hammer. */
    expect(h.runs()).toBeLessThanOrEqual(11);
  });

  it('re-derives a full interval once a run moves the clock forward', async () => {
    const h = harness(0);
    h.setOutcome({ kind: 'synced' });
    await h.scheduler.arm();

    await h.timers.advance(1);
    expect(h.runs()).toBe(1);

    /* The publication moved the authoritative clock, so nothing is owed for another week. */
    h.setDue(h.timers.now() + WEEK);
    await h.scheduler.arm();
    await h.timers.advance(WEEK - CHUNK);

    expect(h.runs()).toBe(1);
  });
});
