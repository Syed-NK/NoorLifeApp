import { useCallback, useEffect, useState } from 'react';

import { mockMainHomeDashboard } from '@mocks/main-home';
import type { MainHomeDashboard } from '@shared/models/dashboard';
import type { AsyncState } from '@shared/states/app-state';

import { usePrayerTimelineEntry } from './use-prayer-timeline-entry';

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

  /**
   * The one row that is real, fanned in here because this is the seam for exactly that.
   *
   * The doc comment above describes this hook as "the seam where those module repositories will be
   * fanned in", and Faith is the first module to have a repository worth fanning. Composing it here
   * rather than in `main-home-screen.tsx` matters: that screen's byte-for-byte lock was reopened only
   * for the upgrade-sheet provider, and adding data assembly to it would exceed that permission. The
   * screen still receives one `MainHomeDashboard` and renders it unchanged.
   *
   * It is called unconditionally, before the `simulateFailure` branch, because it is a hook. On the
   * error path its value is simply unused — the screen renders its error state and no timeline.
   */
  const prayerRow = usePrayerTimelineEntry();

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
  const resolved: AsyncState<MainHomeDashboard> =
    settled !== null && settled.attempt === attempt ? settled.state : { status: 'loading' };

  /**
   * The prayer row is merged on **read**, not at settle time.
   *
   * ── Why that distinction matters ────────────────────────────────────────────
   * `settled` is written once when the simulated aggregation finishes, and the prayer calculation
   * resolves on its own schedule — a location fix can take seconds, and the countdown then updates
   * every fifteen seconds after that. Merging into `settled` would freeze whatever the prayer row
   * happened to be at that instant, which is the same staleness bug as the hero's frozen countdown,
   * reintroduced one layer down.
   *
   * Composing here means the row's own transitions — loading, then a time, or the location prompt —
   * flow through without the dashboard needing to re-settle, and a failed prayer calculation cannot
   * take the rest of Main Home with it.
   *
   * It is prepended, holding the position and the Faith accent the locked composition gives it.
   */
  const state: AsyncState<MainHomeDashboard> =
    resolved.status === 'ready'
      ? {
          ...resolved,
          data: { ...resolved.data, timeline: [prayerRow, ...resolved.data.timeline] },
        }
      : resolved;

  return { state, reload };
}
