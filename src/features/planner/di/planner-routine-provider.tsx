import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { isLocallyAuthenticated, useAuth } from '@application/providers/auth-provider';

import {
  emptyCompletions,
  type PlannerRoutine,
  type PlannerRoutineCompletions,
  type PlannerRoutineDraft,
} from '../data/planner-routine';
import {
  createPlannerRoutineRepository,
  type PlannerRoutineMutation,
  type PlannerRoutineRepository,
} from '../data/planner-routine.repository';

/**
 * **The routines a signed-in account owns**, held once per composition and read through one
 * repository.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why this mirrors `PlannerProvider` rather than extending it ────────────
 * Tasks and routines are separate stores with separate envelopes, and a provider that held both
 * would make every routine tick re-render every task list. Keeping them apart also means the
 * Routines screen mounts only what it needs: a route that never shows a routine never reads the
 * routine keys.
 *
 * The shape is deliberately the same, though — `{ data, loading, fault, reload, …mutations }` — so
 * anyone who has read `planner-provider.tsx` already knows how this behaves, including that a fault
 * is surfaced rather than swallowed.
 *
 * ── The account boundary is the repository's, not a second copy ────────────
 * `ownerId` comes from the signed-in session and the repository is rebuilt whenever it changes, so a
 * different account constructs a different address. With no owner the repository refuses every read
 * and write, which is what keeps one person's routines off another's screen. None of that logic is
 * restated here.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type PlannerRoutineState = {
  readonly routines: readonly PlannerRoutine[];
  readonly completions: PlannerRoutineCompletions;
  readonly loading: boolean;
  /**
   * Why the store could not be read, or `null`.
   *
   * `corrupt-data` is distinct from `storage-unavailable` because the user can act on one and not the
   * other, and because the repository refuses to write over corrupt data — so the screen must be able
   * to say that rather than showing an empty list as though it were the truth.
   */
  readonly fault: 'storage-unavailable' | 'corrupt-data' | null;
  readonly reload: () => Promise<void>;
  readonly createRoutine: (draft: PlannerRoutineDraft) => Promise<PlannerRoutineMutation>;
  readonly updateRoutine: (
    id: string,
    draft: PlannerRoutineDraft,
  ) => Promise<PlannerRoutineMutation>;
  readonly setActive: (id: string, active: boolean) => Promise<PlannerRoutineMutation>;
  readonly setCompleted: (
    id: string,
    day: string,
    completed: boolean,
  ) => Promise<PlannerRoutineMutation>;
  readonly removeRoutine: (id: string) => Promise<PlannerRoutineMutation>;
};

const PlannerRoutineContext = createContext<PlannerRoutineState | null>(null);

export type PlannerRoutineProviderProps = {
  readonly children: ReactNode;
  /** Injected in tests, exactly as `PlannerProvider` takes one. Production passes nothing. */
  readonly repository?: PlannerRoutineRepository;
};

export function PlannerRoutineProvider({
  children,
  repository: injected,
}: PlannerRoutineProviderProps) {
  const auth = useAuth();
  const ownerId = isLocallyAuthenticated(auth) ? (auth.user?.id ?? null) : null;

  const repository = useMemo(
    () => injected ?? createPlannerRoutineRepository({ ownerId }),
    [injected, ownerId],
  );

  const [routines, setRoutines] = useState<readonly PlannerRoutine[]>([]);
  const [completions, setCompletions] = useState<PlannerRoutineCompletions>(emptyCompletions);
  const [loading, setLoading] = useState(true);
  const [fault, setFault] = useState<PlannerRoutineState['fault']>(null);

  const absorb = useCallback((result: Awaited<ReturnType<PlannerRoutineRepository['list']>>) => {
    if (result.kind === 'ok') {
      setRoutines(result.routines);
      setCompletions(result.completions);
      setFault(null);
      return;
    }
    /*
      Nothing is displayed on a fault. Showing the last good list beside an error would let the user
      act on data the store has already refused to confirm.
    */
    setRoutines([]);
    setCompletions(emptyCompletions);
    setFault(result.kind === 'corrupt' ? 'corrupt-data' : 'storage-unavailable');
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    absorb(await repository.list());
    setLoading(false);
  }, [absorb, repository]);

  useEffect(() => {
    let active = true;
    void repository.list().then((result) => {
      if (!active) {
        return;
      }
      absorb(result);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [absorb, repository]);

  const apply = useCallback(async (operation: () => Promise<PlannerRoutineMutation>) => {
    const result = await operation();
    if (result.kind === 'saved' || result.kind === 'removed' || result.kind === 'completion') {
      setRoutines(result.routines);
      setCompletions(result.completions);
      setFault(null);
    } else if (result.kind === 'unavailable') {
      setFault('storage-unavailable');
    }
    return result;
  }, []);

  const value = useMemo<PlannerRoutineState>(
    () => ({
      routines,
      completions,
      loading,
      fault,
      reload,
      createRoutine: (draft) => apply(() => repository.create(draft)),
      updateRoutine: (id, draft) => apply(() => repository.update(id, draft)),
      setActive: (id, active) => apply(() => repository.setActive(id, active)),
      setCompleted: (id, day, completed) =>
        apply(() => repository.setCompleted(id, day, completed)),
      removeRoutine: (id) => apply(() => repository.remove(id)),
    }),
    [apply, completions, fault, loading, reload, repository, routines],
  );

  return <PlannerRoutineContext.Provider value={value}>{children}</PlannerRoutineContext.Provider>;
}

export function usePlannerRoutines(): PlannerRoutineState {
  const value = useContext(PlannerRoutineContext);
  if (value === null) {
    throw new Error('usePlannerRoutines must be used inside PlannerRoutineProvider.');
  }
  return value;
}
