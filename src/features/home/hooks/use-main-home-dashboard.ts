import { useCallback, useEffect, useState } from 'react';

import { mockMainHomeDashboard } from '@mocks/main-home';
import type { MainHomeDashboard } from '@shared/models/dashboard';
import type { AsyncState } from '@shared/states/app-state';

/**
 * Simulated latency for the mock aggregation, in milliseconds.
 *
 * Short enough not to be an annoyance in development, long enough that the
 * loading skeletons actually render — a loading state that never appears is a
 * loading state that never gets tested.
 */
const MOCK_LATENCY_MS = 450;

export type MainHomeDashboardResult = {
  readonly state: AsyncState<MainHomeDashboard>;
  readonly reload: () => void;
};

/** A settled outcome, tagged with the attempt that produced it. */
type Settled = {
  readonly attempt: number;
  readonly state: Extract<AsyncState<MainHomeDashboard>, { status: 'ready' | 'error' }>;
};

/**
 * Aggregates the Main Home dashboard.
 *
 * Workflow §5: Main Home aggregates data from Faith, Planner, Health, Family,
 * Learning, Finance, Goals and Noor AI, but owns none of it. This hook is the seam
 * where those module repositories will be fanned in; today it resolves the typed
 * local mock, since Phase 1 connects no backend.
 *
 * It returns a discriminated `AsyncState`, so the screen has to render its loading
 * and error branches explicitly rather than reading possibly-absent data.
 *
 * Loading is **derived**, not stored: state is only written when an attempt
 * settles, and any attempt without a matching settled result reads as `loading`.
 * That keeps the effect free of a synchronous `setState` (which
 * `react-hooks/set-state-in-effect` rightly flags as a cascading render) and makes
 * a stale result from a superseded attempt unrepresentable rather than merely
 * guarded against.
 *
 * The `error` branch is reachable via `simulateFailure`, which is how the Main
 * Home error state is exercised and tested without a network to fail.
 */
export function useMainHomeDashboard(options?: {
  readonly simulateFailure?: boolean;
}): MainHomeDashboardResult {
  const simulateFailure = options?.simulateFailure ?? false;
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled({
        attempt,
        state: simulateFailure
          ? { status: 'error', kind: 'error', reference: 'NL-HOME-0001' }
          : { status: 'ready', data: mockMainHomeDashboard },
      });
    }, MOCK_LATENCY_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [simulateFailure, attempt]);

  const reload = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  // A result from an earlier attempt is ignored, so pressing retry returns to the
  // loading branch immediately.
  const state: AsyncState<MainHomeDashboard> =
    settled !== null && settled.attempt === attempt ? settled.state : { status: 'loading' };

  return { state, reload };
}
