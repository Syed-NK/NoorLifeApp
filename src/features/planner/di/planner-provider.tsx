import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { isLocallyAuthenticated, useAuth } from '@application/providers/auth-provider';

import type { PlannerTask, PlannerTaskDraft } from '../data/planner-task';
import {
  createPlannerTaskRepository,
  type PlannerTaskMutation,
  type PlannerTaskRepository,
} from '../data/planner-task.repository';

/**
 * **The one live copy of the signed-in account's tasks** — issue #73.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why there is exactly one of these ──────────────────────────────────────
 * Every Planner route used to mount its own provider, and each held its own `tasks` array. React
 * context resolves to the nearest provider, so a route-local one *shadowed* the app-scoped one that
 * `TodayAgendaProvider` already mounts. Adding a task on the Tasks screen updated that screen's copy
 * and nothing else: pressing back revealed the Planner home's copy, still holding what it read when
 * it mounted, and pressing back again revealed Main Home's. Three surfaces disagreed with the store
 * and with each other until the app was relaunched.
 *
 * The fix was not to synchronise them. It was to delete them. `TodayAgendaProvider` mounts this
 * provider once, inside `AuthProvider`, above every route — so Planner home, Tasks, Calendar and Main
 * Home now read the same object and re-render together, because they are one consumer set of one
 * state. There is no event bus and nothing to keep in step.
 *
 * ── Why app scope is the narrowest boundary that works ─────────────────────
 * Main Home is a consumer. It shows today's plan through the agenda port and it is not inside the
 * Planner stack, so any owner mounted under `/planner` would leave Main Home reading a second copy —
 * the defect again, with fewer participants. App scope is therefore forced by the consumer set, not
 * chosen for convenience.
 *
 * It costs nothing on the routes that do not want it. `plannerTaskAddress` returns `null` without a
 * signed-in owner, and the repository refuses every read *before touching storage*, so a public or
 * authentication route mounts a provider that resolves `unavailable` in one microtask and never opens
 * AsyncStorage. It also gates nothing: this provider renders its children unconditionally and makes
 * no routing, entitlement or authentication decision. The premium boundary is still
 * `ModuleEntitlementGate` in `app/planner/_layout.tsx`, exactly where it was.
 *
 * The read itself was already accepted — `TodayAgendaProvider` has mounted this provider app-wide
 * since Main Home stopped inventing its timeline. This change removes four mounts and adds none.
 *
 * ── Routines are a separate owner, deliberately ────────────────────────────
 * `PlannerRoutineProvider` lives on the Planner stack rather than here, because Main Home does not
 * consume routines and the Planner stack is the narrowest boundary that covers everything that does.
 * Two stores, two envelopes, two owners — so ticking a routine does not re-render every task list.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type PlannerState = {
  readonly tasks: readonly PlannerTask[];
  readonly loading: boolean;
  readonly fault: 'storage-unavailable' | 'corrupt-data' | null;
  readonly reload: () => Promise<void>;
  readonly createTask: (draft: PlannerTaskDraft) => Promise<PlannerTaskMutation>;
  readonly updateTask: (id: string, draft: PlannerTaskDraft) => Promise<PlannerTaskMutation>;
  readonly setCompleted: (id: string, completed: boolean) => Promise<PlannerTaskMutation>;
  readonly removeTask: (id: string) => Promise<PlannerTaskMutation>;
};

const PlannerContext = createContext<PlannerState | null>(null);

export type PlannerProviderProps = {
  readonly children: ReactNode;
  readonly repository?: PlannerTaskRepository;
};

/**
 * What is published, and which repository produced it.
 *
 * The repository travels *with* the data rather than beside it, because the two must never be read
 * apart: an account change replaces the repository, and anything still holding the previous
 * account's tasks has to be recognisable as stale in the same instant. Keeping them in one state
 * value is what makes that check a comparison rather than a race.
 */
type Owned = {
  readonly repository: PlannerTaskRepository;
  readonly tasks: readonly PlannerTask[];
  readonly loading: boolean;
  readonly fault: PlannerState['fault'];
};

function absorb(
  repository: PlannerTaskRepository,
  result: Awaited<ReturnType<PlannerTaskRepository['list']>>,
): Owned {
  if (result.kind === 'ok') {
    return { repository, tasks: result.tasks, loading: false, fault: null };
  }
  /*
    Nothing is displayed on a fault. Showing the last good list beside an error would let somebody act
    on data the store has already refused to confirm.
  */
  return {
    repository,
    tasks: [],
    loading: false,
    fault: result.kind === 'corrupt' ? 'corrupt-data' : 'storage-unavailable',
  };
}

export function PlannerProvider({ children, repository: injected }: PlannerProviderProps) {
  const auth = useAuth();
  const ownerId = isLocallyAuthenticated(auth) ? (auth.user?.id ?? null) : null;
  const repository = useMemo(
    () => injected ?? createPlannerTaskRepository({ ownerId }),
    [injected, ownerId],
  );

  const [owned, setOwned] = useState<Owned>(() => ({
    repository,
    tasks: [],
    loading: true,
    fault: null,
  }));

  /*
    Signing out, or switching account, must not leave the previous account's tasks on screen for the
    frame it takes a read to resolve.

    Adjusting state during render is React's documented answer to "this state is derived from a prop
    that changed", and it is the only answer that is synchronous: an effect would publish the old
    tasks under the new repository first and correct it afterwards, which is a visible frame of one
    account's plan inside another's session. React discards this render and re-runs the component
    immediately, so children never see the stale pair.
  */
  if (owned.repository !== repository) {
    setOwned({ repository, tasks: [], loading: true, fault: null });
  }

  useEffect(() => {
    let active = true;
    void repository.list().then((result) => {
      if (!active) {
        return;
      }
      /*
        Guarded twice on purpose. `active` covers the unmount; the identity check covers a result that
        was already in flight when the account changed — a late resolution that would otherwise
        publish account A's tasks into account B's session.
      */
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

  /*
    A stable handle on the current reload, for listeners that must not re-arm.

    `reload` changes identity whenever the repository does. An effect depending on it directly would
    tear down and re-add its subscription on every account change, and — as `today-agenda-provider`
    records at length — a reload-shaped dependency that re-arms its own effect is how ninety-nine
    tests once hung. The ref keeps the listener mounted once while still calling the current reload.
  */
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  /*
    Foreground reconciliation, owned here because the owner of the state is the only thing that can
    correctly own its refresh.

    Storage can change while the app is backgrounded — another process, a restore, a future sync — and
    coming back to a plan that is quietly out of date is the same defect this provider exists to fix,
    displaced in time. Only the `active` transition triggers a read; `inactive` and `background` do
    not, so the iOS app-switcher pass does not cost one.
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
    async (operation: () => Promise<PlannerTaskMutation>) => {
      const result = await operation();
      setOwned((current) => {
        /*
          A mutation that resolves after the account changed belongs to the account that started it.
          Its write went to that account's key — the address is captured per repository — so the only
          thing left to refuse is publishing its result into somebody else's session.
        */
        if (current.repository !== repository) {
          return current;
        }
        if (result.kind === 'saved' || result.kind === 'removed') {
          return { ...current, tasks: result.tasks, fault: null };
        }
        if (result.kind === 'unavailable') {
          /*
            The write did not land, so no task list is published — only the fault. Publishing an
            optimistic list here would claim a save the store refused.
          */
          return { ...current, fault: 'storage-unavailable' };
        }
        return current;
      });
      return result;
    },
    [repository],
  );

  const value = useMemo<PlannerState>(
    () => ({
      tasks: owned.tasks,
      loading: owned.loading,
      fault: owned.fault,
      reload,
      createTask: (draft) => apply(() => repository.create(draft)),
      updateTask: (id, draft) => apply(() => repository.update(id, draft)),
      setCompleted: (id, completed) => apply(() => repository.setCompleted(id, completed)),
      removeTask: (id) => apply(() => repository.remove(id)),
    }),
    [apply, owned.fault, owned.loading, owned.tasks, reload, repository],
  );

  return <PlannerContext.Provider value={value}>{children}</PlannerContext.Provider>;
}

export function usePlanner(): PlannerState {
  const value = useContext(PlannerContext);
  if (value === null) {
    throw new Error('usePlanner must be used inside PlannerProvider.');
  }
  return value;
}
