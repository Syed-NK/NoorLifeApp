import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';

import {
  MAX_ROUTINES,
  PLANNER_ROUTINE_SCHEMA_VERSION,
  createPlannerRoutine,
  emptyCompletions,
  parsePlannerRoutineCompletions,
  parsePlannerRoutineEnvelope,
  pruneCompletions,
  revisePlannerRoutine,
  setPlannerRoutineActive,
  sortPlannerRoutines,
  withRoutineCompletion,
  type PlannerRoutine,
  type PlannerRoutineCompletions,
  type PlannerRoutineDraft,
  type PlannerRoutineFault,
} from './planner-routine';
import { serializePlannerWrite } from './planner-write-queue';

/**
 * **Where one account's routines live** — two keys under Planner's own namespace, and nothing
 * shared with tasks.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why routines are not stored with tasks ─────────────────────────────────
 * A task and a routine are different records with different lifetimes, and putting them in one
 * envelope would tie their schemas together for ever: a change to the task shape would have to parse
 * routines too, and a corrupt routine would take somebody's task list down with it. They share the
 * account namespace — the same owner, the same privacy disclosure — and nothing else.
 *
 * ── Why *two* keys and not one routine envelope ────────────────────────────
 * Definitions change when the user edits them; completions change every time a box is ticked. One
 * envelope would rewrite every definition on every tick, which is both wasteful and a wider window
 * for a partial write to damage something the user cannot re-derive. It also means a corrupt
 * completion log reports `corrupt` for *completions* while the definitions still load, so the screen
 * can say what is actually wrong.
 *
 * ── The rules this file exists to keep ─────────────────────────────────────
 * Every one of these is a behaviour somebody would notice if it broke:
 *
 *   • **No owner, no access.** A null or malformed account id yields a null address, and every read
 *     and write answers `unavailable`. There is no shared fallback key to leak into.
 *   • **Corrupt is never overwritten.** A parse failure reports `corrupt` and refuses to write, so an
 *     unreadable file is never replaced by an empty one — the user's data may be recoverable, and it
 *     certainly is not recoverable after we have written `{}` over it.
 *   • **Writes are serialised.** One queue for both keys, so two taps in the same frame cannot
 *     interleave a read-modify-write and lose one of them.
 *   • **History is bounded and cleaned deterministically.** Deleting a routine drops its ids from
 *     every retained day in the same write, and the retention window trims whole days from the
 *     oldest end. Nothing accumulates without a limit.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const PLANNER_USER_NAMESPACE = 'noorlife.planner.user.v1';
const USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PlannerRoutineStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;

/** Both halves of the state, or why neither can be read. */
export type PlannerRoutineRepositoryResult =
  | {
      readonly kind: 'ok';
      readonly routines: readonly PlannerRoutine[];
      readonly completions: PlannerRoutineCompletions;
    }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'corrupt' };

export type PlannerRoutineMutation =
  | {
      readonly kind: 'saved';
      readonly routine: PlannerRoutine;
      readonly routines: readonly PlannerRoutine[];
      readonly completions: PlannerRoutineCompletions;
    }
  | {
      readonly kind: 'removed';
      readonly routines: readonly PlannerRoutine[];
      readonly completions: PlannerRoutineCompletions;
    }
  | {
      readonly kind: 'completion';
      readonly routines: readonly PlannerRoutine[];
      readonly completions: PlannerRoutineCompletions;
    }
  | { readonly kind: 'invalid'; readonly fault: PlannerRoutineFault }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unavailable' };

export type PlannerRoutineRepository = {
  /** The definitions key, or `null` when there is no account to read for. */
  readonly address: string | null;
  /** The completions key, or `null`. Exposed so a test can seed or corrupt exactly one half. */
  readonly completionsAddress: string | null;
  list(): Promise<PlannerRoutineRepositoryResult>;
  create(draft: PlannerRoutineDraft): Promise<PlannerRoutineMutation>;
  update(id: string, draft: PlannerRoutineDraft): Promise<PlannerRoutineMutation>;
  setActive(id: string, active: boolean): Promise<PlannerRoutineMutation>;
  setCompleted(id: string, day: string, completed: boolean): Promise<PlannerRoutineMutation>;
  remove(id: string): Promise<PlannerRoutineMutation>;
};

export type PlannerRoutineRepositoryDeps = {
  readonly ownerId: string | null;
  readonly storage?: PlannerRoutineStorage;
  readonly now?: () => Date;
  readonly id?: () => string;
};

/** `noorlife.planner.user.v1.<uuid>.routines`, or `null` for anything that is not an account id. */
export function plannerRoutineAddress(ownerId: string | null): string | null {
  if (ownerId === null) {
    return null;
  }
  const trimmed = ownerId.trim().toLowerCase();
  return USER_ID_PATTERN.test(trimmed) ? `${PLANNER_USER_NAMESPACE}.${trimmed}.routines` : null;
}

/** The completion log's key for the same account. */
export function plannerRoutineCompletionsAddress(ownerId: string | null): string | null {
  const base = plannerRoutineAddress(ownerId);
  return base === null ? null : `${base}-completions`;
}

/*
  Serialization moved to `planner-write-queue.ts` — issue #72.

  This file used to hold its own module-scope queue, with a comment claiming it matched the task
  repository. It did not: the task repository's queue was declared inside its factory, so the two
  files disagreed about the invariant one of them documented. Both now reach the same lane, keyed by
  the storage address, and neither has a local queue left to drift back to.
*/

export function createPlannerRoutineRepository(
  deps: PlannerRoutineRepositoryDeps,
): PlannerRoutineRepository {
  const storage = deps.storage ?? AsyncStorage;
  const now = deps.now ?? (() => new Date());
  const id = deps.id ?? (() => `routine.${Crypto.randomUUID()}`);
  const address = plannerRoutineAddress(deps.ownerId);
  const completionsAddress = plannerRoutineCompletionsAddress(deps.ownerId);

  async function read(): Promise<PlannerRoutineRepositoryResult> {
    if (address === null || completionsAddress === null) {
      return { kind: 'unavailable' };
    }
    let rawRoutines: string | null;
    let rawCompletions: string | null;
    try {
      rawRoutines = await storage.getItem(address);
      rawCompletions = await storage.getItem(completionsAddress);
    } catch {
      return { kind: 'unavailable' };
    }

    /*
      An absent key is an empty store, not a corrupt one — a first run has written nothing. Only a key
      that exists and will not parse is corrupt.
    */
    let routines: readonly PlannerRoutine[] = [];
    if (rawRoutines !== null) {
      const parsed = safeParse(rawRoutines);
      if (parsed === undefined) {
        return { kind: 'corrupt' };
      }
      const envelope = parsePlannerRoutineEnvelope(parsed);
      if (envelope === null) {
        return { kind: 'corrupt' };
      }
      routines = envelope.routines;
    }

    let completions: PlannerRoutineCompletions = emptyCompletions;
    if (rawCompletions !== null) {
      const parsed = safeParse(rawCompletions);
      if (parsed === undefined) {
        return { kind: 'corrupt' };
      }
      const log = parsePlannerRoutineCompletions(parsed);
      if (log === null) {
        return { kind: 'corrupt' };
      }
      completions = log;
    }

    return { kind: 'ok', routines: sortPlannerRoutines(routines), completions };
  }

  async function write(
    routines: readonly PlannerRoutine[],
    completions: PlannerRoutineCompletions,
  ): Promise<boolean> {
    if (address === null || completionsAddress === null) {
      return false;
    }
    try {
      await storage.setItem(
        address,
        JSON.stringify({ version: PLANNER_ROUTINE_SCHEMA_VERSION, routines }),
      );
      await storage.setItem(completionsAddress, JSON.stringify(completions));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Serializes one write against every other write to this account's routine keys — issue #72.
   *
   * The lane is the routine address, and the completion log writes on it too: both live behind the
   * same `write` call, so a completion and a routine edit must not interleave even though they
   * touch two keys. Naming the routine address for both is what keeps that pair atomic.
   */
  function mutate(
    operation: () => Promise<PlannerRoutineMutation>,
  ): Promise<PlannerRoutineMutation> {
    return address === null ? operation() : serializePlannerWrite(address, operation);
  }

  return {
    address,
    completionsAddress,
    list: read,

    create: (draft) =>
      mutate(async () => {
        const current = await read();
        if (current.kind !== 'ok') {
          return { kind: 'unavailable' };
        }
        if (current.routines.length >= MAX_ROUTINES) {
          return { kind: 'invalid', fault: 'too-many-routines' };
        }
        const created = createPlannerRoutine(draft, id(), now());
        if (created.kind === 'invalid') {
          return created;
        }
        const routines = sortPlannerRoutines([...current.routines, created.routine]);
        return (await write(routines, current.completions))
          ? {
              kind: 'saved',
              routine: created.routine,
              routines,
              completions: current.completions,
            }
          : { kind: 'unavailable' };
      }),

    update: (routineId, draft) =>
      mutate(async () => {
        const current = await read();
        if (current.kind !== 'ok') {
          return { kind: 'unavailable' };
        }
        const existing = current.routines.find((routine) => routine.id === routineId);
        if (existing === undefined) {
          return { kind: 'not-found' };
        }
        const updated = revisePlannerRoutine(existing, draft, now());
        if (updated.kind === 'invalid') {
          return updated;
        }
        const routines = sortPlannerRoutines(
          current.routines.map((routine) => (routine.id === routineId ? updated.routine : routine)),
        );
        /*
          The completion log is written back **unchanged**. Editing a schedule cannot rewrite history:
          a completion records the day it happened on, and what the schedule says now has no bearing
          on what the user did last Tuesday.
        */
        return (await write(routines, current.completions))
          ? {
              kind: 'saved',
              routine: updated.routine,
              routines,
              completions: current.completions,
            }
          : { kind: 'unavailable' };
      }),

    setActive: (routineId, active) =>
      mutate(async () => {
        const current = await read();
        if (current.kind !== 'ok') {
          return { kind: 'unavailable' };
        }
        const existing = current.routines.find((routine) => routine.id === routineId);
        if (existing === undefined) {
          return { kind: 'not-found' };
        }
        const updated = setPlannerRoutineActive(existing, active, now());
        const routines = sortPlannerRoutines(
          current.routines.map((routine) => (routine.id === routineId ? updated : routine)),
        );
        // History untouched: disabling stops future occurrences and forgets nothing.
        return (await write(routines, current.completions))
          ? { kind: 'saved', routine: updated, routines, completions: current.completions }
          : { kind: 'unavailable' };
      }),

    setCompleted: (routineId, day, completed) =>
      mutate(async () => {
        const current = await read();
        if (current.kind !== 'ok') {
          return { kind: 'unavailable' };
        }
        if (!current.routines.some((routine) => routine.id === routineId)) {
          return { kind: 'not-found' };
        }
        /*
          Pruned on the way out, so the retention window is enforced by the act of recording rather
          than by a sweep somebody has to remember to run. The definitions are written unchanged.
        */
        const completions = pruneCompletions(
          withRoutineCompletion(current.completions, routineId, day, completed),
          current.routines.map((routine) => routine.id),
        );
        return (await write(current.routines, completions))
          ? { kind: 'completion', routines: current.routines, completions }
          : { kind: 'unavailable' };
      }),

    remove: (routineId) =>
      mutate(async () => {
        const current = await read();
        if (current.kind !== 'ok') {
          return { kind: 'unavailable' };
        }
        if (!current.routines.some((routine) => routine.id === routineId)) {
          return { kind: 'not-found' };
        }
        const routines = current.routines.filter((routine) => routine.id !== routineId);
        /*
          The deleted routine's completions go with it, in the same write. Keeping them would leave
          rows nothing can display or delete — unbounded orphan history — and the definition is gone,
          so there is no honest way to show them.
        */
        const completions = pruneCompletions(
          current.completions,
          routines.map((routine) => routine.id),
        );
        return (await write(routines, completions))
          ? { kind: 'removed', routines, completions }
          : { kind: 'unavailable' };
      }),
  };
}

/** `JSON.parse` that reports failure rather than throwing, so `read` can classify it. */
function safeParse(raw: string): unknown | undefined {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
