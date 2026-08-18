import { cleanup } from '@testing-library/react-native';

/**
 * The two costs that pushed provider-heavy suites past Jest's five-second default, and the
 * per-suite opt-in that removes both.
 *
 * ── Cost one: the mocks sleep on purpose ────────────────────────────────────
 * Four mock data sources delay so a developer can see a loading skeleton:
 *
 *   • `features/home/hooks/use-main-home-dashboard.ts`        450 ms per Main Home mount
 *   • `features/modules/services/mock-module-repository.ts`   350 ms per read
 *   • `features/faith/data/mock/mock-support.ts`              280 ms per read
 *   • `services/auth/mock-auth-service.ts`                    650 ms per call
 *
 * Under Jest those are real sleeps. A measured Main Home mount took 545 ms, of which 450 ms was the
 * timer and ~95 ms was React; under fake timers the same mount took 93 ms. Main Home's four suites
 * mount the screen 246 times, so roughly 110 seconds of a 92-second parallel run was spent asleep.
 *
 * Advancing the clock instead of waiting on it removes the sleep without removing the timer: the
 * loading branch still renders, `waitFor` still polls, every assertion is untouched, and no
 * production file changes.
 *
 * ── Cost two: the first mount in a worker is seven times the others ─────────
 * The same measurement showed mount 0 at 1148 ms against ~545 ms for mounts 1–3 — V8 compiling and
 * optimising a provider stack and a full screen the first time it runs them. Jest charges all of it
 * to whichever test mounts first, so the opening test of a heavy suite was failing on a cost the
 * other eighty tests never paid. Under thirteen workers on fourteen cores that first mount measured
 * 5.7 seconds, and once it timed out mid-`act` the rest of the suite failed in milliseconds behind
 * it — 83 of 85 tests, from one slow render.
 *
 * `warmUp` moves that mount into `beforeAll`, which is given its own explicit budget. Every real
 * test then keeps the plain five-second default, which is the point: a hang has to look like a hang.
 *
 * ── What is deliberately left real ──────────────────────────────────────────
 * `Date`, `performance` and `hrtime` stay real, because faking them makes elapsed-time measurement
 * report the *advanced* clock rather than the truth — that silently defeats any test reasoning about
 * duration, and it made the first profiling run of this change report 450 ms for a 93 ms mount.
 * `queueMicrotask` and `nextTick` stay real because promise resolution runs on them; faking those
 * deadlocks anything awaiting a service double.
 *
 * ── Why this is opt-in rather than global ───────────────────────────────────
 * Installing it in `jest.setup.ts` would apply it to suites that assert on real elapsed time — the
 * splash handoff, the load-timeout hook — and a broad switch applied to every suite is exactly how
 * 6C-3A's global thirty-second timeout happened. Each suite that needs this says so.
 */

/** Timer APIs faked. Everything else — clocks, microtasks — is left alone. */
const DO_NOT_FAKE = ['Date', 'hrtime', 'performance', 'queueMicrotask', 'nextTick'] as const;

/**
 * The warm-up hook's budget.
 *
 * Generous, because it absorbs a one-off compile cost on a saturated machine, and harmless, because
 * it applies to a hook that renders a screen and throws it away. No assertion runs under it.
 */
const WARM_UP_BUDGET_MS = 30000;

/**
 * Installs fake timers for the surrounding `describe`, and restores real ones afterwards.
 *
 * Call at suite top level, outside any `it`.
 *
 * @param warmUp Optional. Mounts the suite's heaviest tree once in `beforeAll` and discards it, so
 *   the first real test is not charged for compiling it. Pass the suite's own render helper.
 */
export function installMockLatencyTimers(warmUp?: () => Promise<unknown>): void {
  if (warmUp !== undefined) {
    beforeAll(async () => {
      jest.useFakeTimers({ doNotFake: [...DO_NOT_FAKE] });
      try {
        await warmUp();
      } finally {
        // Explicit, because RNTL's automatic cleanup runs in `afterEach` — without this the
        // throwaway tree would stay mounted through the first test.
        await cleanup();
        jest.useRealTimers();
      }
    }, WARM_UP_BUDGET_MS);
  }

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: [...DO_NOT_FAKE] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });
}

/**
 * The warm-up on its own, for suites where fake timers are not usable.
 *
 * Two suites drive real promise chains through screens whose readiness is not timer-driven
 * (`faith-interactions`, `help-support-screen`), and under fake timers `waitFor` exhausts its
 * simulated budget in microseconds before those chains settle. They keep real timers and take only
 * the part that helps: the first mount, paid for in `beforeAll` rather than by the opening test.
 *
 * Call at suite top level, outside any `it`.
 */
export function warmUpFirstMount(warmUp: () => Promise<unknown>): void {
  beforeAll(async () => {
    try {
      await warmUp();
    } finally {
      await cleanup();
    }
  }, WARM_UP_BUDGET_MS);
}
