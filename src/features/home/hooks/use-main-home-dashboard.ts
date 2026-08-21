import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useTodayAgenda } from '@application/providers/today-agenda-provider';

import { mockMainHomeDashboard } from '@mocks/main-home';
import type { MainHomeDashboard } from '@shared/models/dashboard';
import type { AsyncState } from '@shared/states/app-state';

import { usePlannerTimelineEntries } from './use-planner-timeline-entries';
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

  /*
    The Planner rows, from the same seam and for the same reason. They come through an
    application-level read-only port, so Home never imports Planner: see
    `today-agenda-provider.tsx` for why the boundary sits there.
  */
  const plannerRows = usePlannerTimelineEntries();
  const agenda = useTodayAgenda();

  /*
    Planner is re-read whenever Main Home regains focus, so a task added, completed or deleted on the
    Tasks or Calendar screen shows up the moment the user comes back. Without this the section would
    keep reporting the plan as it stood at launch — a quieter version of the same dishonesty the
    fixtures were.
  */
  /*
    Armed once, and deliberately not re-armed when the agenda changes.

    A focus effect that depends on the reload it calls re-arms on the state change that reload causes,
    and refreshes forever. The current function is reached through a ref so this effect has no
    dependency that its own work can invalidate.
  */
  const reloadAgenda = agenda.reload;
  const reloadRef = useRef(reloadAgenda);
  useEffect(() => {
    reloadRef.current = reloadAgenda;
  }, [reloadAgenda]);
  useFocusEffect(
    useCallback(() => {
      void reloadRef.current();
    }, []),
  );

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
  /*
    Readiness is deliberately **not** gated on Planner.

    Gating was tried and was wrong twice over. It coupled Main Home's first paint to another module's
    storage read, so a slow or missing Planner would hold the whole screen on its skeleton; and it
    made the screen untestable without the agenda provider mounted, which is a sign the dependency was
    pointing the wrong way. The honest loading pattern is already in place — the dashboard shows
    `MainHomeSkeleton` for its own load — and the Planner rows simply contribute nothing until they
    have something true to say, exactly as the prayer row carries no time while its calculation runs.
  */
  const state: AsyncState<MainHomeDashboard> =
    resolved.status === 'ready'
      ? {
          ...resolved,
          /*
            The live rows are composed here rather than stored: the prayer row first, then the user's
            real Planner rows. `resolved.data.timeline` is empty now and is spread last so the shape
            still comes from the model rather than from this file.
          */
          data: {
            ...resolved.data,
            timeline: [prayerRow, ...plannerRows, ...resolved.data.timeline],
          },
        }
      : resolved;

  return { state, reload };
}
