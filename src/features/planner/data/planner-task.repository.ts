import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import {
  PLANNER_TASK_SCHEMA_VERSION,
  createPlannerTask,
  parsePlannerTaskEnvelope,
  revisePlannerTask,
  setPlannerTaskCompleted,
  sortPlannerTasks,
  type PlannerTask,
  type PlannerTaskDraft,
  type PlannerTaskFault,
} from './planner-task';

const PLANNER_USER_NAMESPACE = 'noorlife.planner.user.v1';
const USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PlannerTaskStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;

export type PlannerTaskRepositoryResult =
  | { readonly kind: 'ok'; readonly tasks: readonly PlannerTask[] }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'corrupt' };

export type PlannerTaskMutation =
  | { readonly kind: 'saved'; readonly task: PlannerTask; readonly tasks: readonly PlannerTask[] }
  | { readonly kind: 'removed'; readonly tasks: readonly PlannerTask[] }
  | { readonly kind: 'invalid'; readonly fault: PlannerTaskFault }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable' };

export type PlannerTaskRepository = {
  readonly address: string | null;
  list(): Promise<PlannerTaskRepositoryResult>;
  create(draft: PlannerTaskDraft): Promise<PlannerTaskMutation>;
  update(id: string, draft: PlannerTaskDraft): Promise<PlannerTaskMutation>;
  setCompleted(id: string, completed: boolean): Promise<PlannerTaskMutation>;
  remove(id: string): Promise<PlannerTaskMutation>;
};

export type PlannerTaskRepositoryDeps = {
  readonly ownerId: string | null;
  readonly storage?: PlannerTaskStorage;
  readonly now?: () => Date;
  readonly id?: () => string;
};

export function plannerTaskAddress(ownerId: string | null): string | null {
  if (ownerId === null) {
    return null;
  }
  const trimmed = ownerId.trim().toLowerCase();
  return USER_ID_PATTERN.test(trimmed) ? `${PLANNER_USER_NAMESPACE}.${trimmed}.tasks` : null;
}

export function createPlannerTaskRepository(
  deps: PlannerTaskRepositoryDeps,
): PlannerTaskRepository {
  const storage = deps.storage ?? AsyncStorage;
  const now = deps.now ?? (() => new Date());
  const id = deps.id ?? (() => `task.${Crypto.randomUUID()}`);
  const address = plannerTaskAddress(deps.ownerId);
  let mutationQueue: Promise<void> = Promise.resolve();

  async function read(): Promise<PlannerTaskRepositoryResult> {
    if (address === null) {
      return { kind: 'unavailable' };
    }
    try {
      const raw = await storage.getItem(address);
      if (raw === null) {
        return { kind: 'ok', tasks: [] };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        return { kind: 'corrupt' };
      }
      const envelope = parsePlannerTaskEnvelope(parsed);
      return envelope === null
        ? { kind: 'corrupt' }
        : { kind: 'ok', tasks: sortPlannerTasks(envelope.tasks) };
    } catch {
      return { kind: 'unavailable' };
    }
  }

  async function write(tasks: readonly PlannerTask[]): Promise<boolean> {
    if (address === null) {
      return false;
    }
    try {
      await storage.setItem(
        address,
        JSON.stringify({ version: PLANNER_TASK_SCHEMA_VERSION, tasks }),
      );
      return true;
    } catch {
      return false;
    }
  }

  function mutate(operation: () => Promise<PlannerTaskMutation>): Promise<PlannerTaskMutation> {
    const result = mutationQueue.then(operation, operation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  return {
    address,
    list: read,
    create: (draft) =>
      mutate(async () => {
        const current = await read();
        if (current.kind !== 'ok') {
          return { kind: 'unavailable' };
        }
        const created = createPlannerTask(draft, id(), now());
        if (created.kind === 'invalid') {
          return created;
        }
        const tasks = sortPlannerTasks([...current.tasks, created.task]);
        return (await write(tasks))
          ? { kind: 'saved', task: created.task, tasks }
          : { kind: 'unavailable' };
      }),
    update: (taskId, draft) =>
      mutate(async () => {
        const current = await read();
        if (current.kind !== 'ok') {
          return { kind: 'unavailable' };
        }
        const existing = current.tasks.find((task) => task.id === taskId);
        if (existing === undefined) {
          return { kind: 'not-found' };
        }
        const updated = revisePlannerTask(existing, draft, now());
        if (updated.kind === 'invalid') {
          return updated;
        }
        const tasks = sortPlannerTasks(
          current.tasks.map((task) => (task.id === taskId ? updated.task : task)),
        );
        return (await write(tasks))
          ? { kind: 'saved', task: updated.task, tasks }
          : { kind: 'unavailable' };
      }),
    setCompleted: (taskId, completed) =>
      mutate(async () => {
        const current = await read();
        if (current.kind !== 'ok') {
          return { kind: 'unavailable' };
        }
        const existing = current.tasks.find((task) => task.id === taskId);
        if (existing === undefined) {
          return { kind: 'not-found' };
        }
        const updated = setPlannerTaskCompleted(existing, completed, now());
        const tasks = sortPlannerTasks(
          current.tasks.map((task) => (task.id === taskId ? updated : task)),
        );
        return (await write(tasks))
          ? { kind: 'saved', task: updated, tasks }
          : { kind: 'unavailable' };
      }),
    remove: (taskId) =>
      mutate(async () => {
        const current = await read();
        if (current.kind !== 'ok') {
          return { kind: 'unavailable' };
        }
        if (!current.tasks.some((task) => task.id === taskId)) {
          return { kind: 'not-found' };
        }
        const tasks = current.tasks.filter((task) => task.id !== taskId);
        return (await write(tasks)) ? { kind: 'removed', tasks } : { kind: 'unavailable' };
      }),
  };
}
