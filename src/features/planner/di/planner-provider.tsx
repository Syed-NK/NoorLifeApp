import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { isLocallyAuthenticated, useAuth } from '@application/providers/auth-provider';

import type { PlannerTask, PlannerTaskDraft } from '../data/planner-task';
import {
  createPlannerTaskRepository,
  type PlannerTaskMutation,
  type PlannerTaskRepository,
} from '../data/planner-task.repository';

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

export function PlannerProvider({ children, repository: injected }: PlannerProviderProps) {
  const auth = useAuth();
  const ownerId = isLocallyAuthenticated(auth) ? (auth.user?.id ?? null) : null;
  const repository = useMemo(
    () => injected ?? createPlannerTaskRepository({ ownerId }),
    [injected, ownerId],
  );
  const [tasks, setTasks] = useState<readonly PlannerTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [fault, setFault] = useState<PlannerState['fault']>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    const result = await repository.list();
    if (result.kind === 'ok') {
      setTasks(result.tasks);
      setFault(null);
    } else {
      setTasks([]);
      setFault(result.kind === 'corrupt' ? 'corrupt-data' : 'storage-unavailable');
    }
    setLoading(false);
  }, [repository]);

  useEffect(() => {
    let active = true;
    void repository.list().then((result) => {
      if (!active) return;
      if (result.kind === 'ok') {
        setTasks(result.tasks);
        setFault(null);
      } else {
        setTasks([]);
        setFault(result.kind === 'corrupt' ? 'corrupt-data' : 'storage-unavailable');
      }
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [repository]);

  const apply = useCallback(async (operation: () => Promise<PlannerTaskMutation>) => {
    const result = await operation();
    if (result.kind === 'saved' || result.kind === 'removed') {
      setTasks(result.tasks);
      setFault(null);
    } else if (result.kind === 'unavailable') {
      setFault('storage-unavailable');
    }
    return result;
  }, []);

  const value = useMemo<PlannerState>(
    () => ({
      tasks,
      loading,
      fault,
      reload,
      createTask: (draft) => apply(() => repository.create(draft)),
      updateTask: (id, draft) => apply(() => repository.update(id, draft)),
      setCompleted: (id, completed) => apply(() => repository.setCompleted(id, completed)),
      removeTask: (id) => apply(() => repository.remove(id)),
    }),
    [apply, fault, loading, reload, repository, tasks],
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
