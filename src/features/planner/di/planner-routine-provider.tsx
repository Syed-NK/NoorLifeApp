import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { AppState } from 'react-native';

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
 * **The routines a signed-in account owns**, held once for the Planner stack — issue #73.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why there is exactly one of these, on the Planner stack ────────────────
 * The Routines screen and the Planner home each used to mount their own provider, so completing a
 * routine on one left the other showing whatever it had read when it mounted. Both now read a single
 * owner mounted in `app/planner/_layout.tsx`, inside the entitlement gate.
 *
 * The Planner stack is the narrowest boundary covering every routine consumer, and unlike tasks there
 * is no consumer outside it: Main Home shows today's *tasks* through the agenda port and never reads
 * a routine. Mounting this at app scope would open two more keys on every route that will never
 * display them. The layout stays mounted for the whole module, so moving between Planner routes does
 * not remount it, and leaving Planner correctly disposes of it.
 *
 * ── Why this mirrors `PlannerProvider` rather than extending it ────────────
 * Tasks and routines are separate stores with separate envelopes, and a provider that held both would
 * make every routine tick re-render every task list.
 *
 * The shape is deliberately the same, though — `{ data, loading, fault, reload, …mutations }` — so
 * anyone who has read `planner-provider.tsx` already knows how this behaves, including that a fault
 * is surfaced rather than swallowed, and that a repository change clears what is published before the
 * next read resolves.
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

/**
 * What is published, and which repository produced it.
 *
 * They travel together so that an account change makes stale data recognisable in the same instant it
 * becomes stale — a comparison rather than a race. See `PlannerProvider`.
 */
type Owned = {
  readonly repository: PlannerRoutineRepository;
  readonly routines: readonly PlannerRoutine[];
  readonly completions: PlannerRoutineCompletions;
  readonly loading: boolean;
  readonly fault: PlannerRoutineState['fault'];
};

function absorb(
  repository: PlannerRoutineRepository,
  result: Awaited<ReturnType<PlannerRoutineRepository['list']>>,
): Owned {
  if (result.kind === 'ok') {
    return {
      repository,
      routines: result.routines,
      completions: result.completions,
      loading: false,
      fault: null,
    };
  }
  /*
    Nothing is displayed on a fault. Showing the last good list beside an error would let the user act
    on data the store has already refused to confirm.
  */
  return {
    repository,
    routines: [],
    completions: emptyCompletions,
    loading: false,
    fault: result.kind === 'corrupt' ? 'corrupt-data' : 'storage-unavailable',
  };
}

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

  const [owned, setOwned] = useState<Owned>(() => ({
    repository,
    routines: [],
    completions: emptyCompletions,
    loading: true,
    fault: null,
  }));

  /*
    Synchronously drop the previous account's routines when the repository is replaced. Adjusting
    state during render is React's documented answer for state derived from a changed input, and it is
    the only one that is synchronous: an effect would publish the old routines under the new
    repository for one frame first.
  */
  if (owned.repository !== repository) {
    setOwned({
      repository,
      routines: [],
      completions: emptyCompletions,
      loading: true,
      fault: null,
    });
  }

  useEffect(() => {
    let active = true;
    void repository.list().then((result) => {
      if (!active) {
        return;
      }
      /* `active` covers the unmount; the identity check covers a read that outlived its account. */
      setOwned((current) =>
        current.repository === repository ? absorb(repository, result) : current,
      );
    });
    return () => {
      active = false;
    };
  }, [repository]);

  const reload = useCallback(async () => {
    setOwned((current) =>
      current.repository === repository ? { ...current, loading: true } : current,
    );
    const result = await repository.list();
    setOwned((current) =>
      current.repository === repository ? absorb(repository, result) : current,
    );
  }, [repository]);

  /* A stable handle on the current reload, so the foreground listener never re-arms. */
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  /*
    Foreground reconciliation, owned by the owner of the state. Only the `active` transition reads;
    `inactive` and `background` do not, so an app-switcher pass costs nothing.
  */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void reloadRef.current();
      }
    });
    return () => subscription.remove();
  }, []);

  const apply = useCallback(
    async (operation: () => Promise<PlannerRoutineMutation>) => {
      const result = await operation();
      setOwned((current) => {
        /*
          A mutation that resolves after the account changed belongs to the account that started it.
          Its write went to that account's keys; the only thing left to refuse is publishing the
          result into somebody else's session.
        */
        if (current.repository !== repository) {
          return current;
        }
        if (result.kind === 'saved' || result.kind === 'removed' || result.kind === 'completion') {
          return {
            ...current,
            routines: result.routines,
            completions: result.completions,
            fault: null,
          };
        }
        if (result.kind === 'unavailable') {
          /* The write did not land, so only the fault is published — never an optimistic list. */
          return { ...current, fault: 'storage-unavailable' };
        }
        return current;
      });
      return result;
    },
    [repository],
  );

  const value = useMemo<PlannerRoutineState>(
    () => ({
      routines: owned.routines,
      completions: owned.completions,
      loading: owned.loading,
      fault: owned.fault,
      reload,
      createRoutine: (draft) => apply(() => repository.create(draft)),
      updateRoutine: (id, draft) => apply(() => repository.update(id, draft)),
      setActive: (id, active) => apply(() => repository.setActive(id, active)),
      setCompleted: (id, day, completed) =>
        apply(() => repository.setCompleted(id, day, completed)),
      removeRoutine: (id) => apply(() => repository.remove(id)),
    }),
    [apply, owned.completions, owned.fault, owned.loading, owned.routines, reload, repository],
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
