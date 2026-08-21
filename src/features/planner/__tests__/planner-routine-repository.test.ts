import {
  MAX_COMPLETION_DAYS,
  MAX_ROUTINES,
  routineIsCompletedOn,
  type PlannerRoutineDraft,
} from '../data/planner-routine';
import {
  createPlannerRoutineRepository,
  plannerRoutineAddress,
  plannerRoutineCompletionsAddress,
  type PlannerRoutineRepository,
  type PlannerRoutineStorage,
} from '../data/planner-routine.repository';

/**
 * The account-scoped routine store: who may read it, what it refuses to overwrite, and what it
 * bounds.
 */

const OWNER_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const OWNER_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const MONDAY = '2026-08-17';
const TUESDAY = '2026-08-18';

const DAILY: PlannerRoutineDraft = { title: 'Stretch', schedule: { kind: 'daily' } };

function storage(rows: Map<string, string>): PlannerRoutineStorage {
  return {
    getItem: async (key) => rows.get(key) ?? null,
    setItem: async (key, value) => {
      rows.set(key, value);
    },
  };
}

function repository(
  rows: Map<string, string>,
  ownerId: string | null = OWNER_A,
  overrides?: Partial<Parameters<typeof createPlannerRoutineRepository>[0]>,
): PlannerRoutineRepository {
  let sequence = 0;
  return createPlannerRoutineRepository({
    ownerId,
    storage: storage(rows),
    id: () => `routine.aaaaaaaa-1111-4111-8111-${String(++sequence).padStart(12, '0')}`,
    now: () => new Date('2026-08-17T08:00:00.000Z'),
    ...overrides,
  });
}

describe('the address', () => {
  it('maps only a valid account id to a pair of keys', () => {
    expect(plannerRoutineAddress(OWNER_A)).toBe(`noorlife.planner.user.v1.${OWNER_A}.routines`);
    expect(plannerRoutineCompletionsAddress(OWNER_A)).toBe(
      `noorlife.planner.user.v1.${OWNER_A}.routines-completions`,
    );
  });

  it.each([[null], [''], ['   '], ['not-a-uuid'], ['aaaaaaaa-1111-4111-8111']])(
    'refuses %p',
    (bad) => {
      expect(plannerRoutineAddress(bad as string | null)).toBeNull();
      expect(plannerRoutineCompletionsAddress(bad as string | null)).toBeNull();
    },
  );

  /*
    Both keys live under `noorlife.planner`, the namespace the Privacy screen already discloses. A new
    top-level namespace would have to be added there, and the privacy suite fails if one appears.
  */
  it('stays inside the disclosed planner namespace', () => {
    expect(plannerRoutineAddress(OWNER_A)).toMatch(/^noorlife\.planner\./);
    expect(plannerRoutineCompletionsAddress(OWNER_A)).toMatch(/^noorlife\.planner\./);
  });

  it('is a different key from the task store, so the schemas cannot couple', () => {
    expect(plannerRoutineAddress(OWNER_A)).not.toContain('.tasks');
  });
});

describe('with no owner', () => {
  it('refuses every read and write', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows, null);

    expect(repo.address).toBeNull();
    expect(await repo.list()).toEqual({ kind: 'unavailable' });
    expect(await repo.create(DAILY)).toEqual({ kind: 'unavailable' });
    expect(await repo.update('routine.x', DAILY)).toEqual({ kind: 'unavailable' });
    expect(await repo.setActive('routine.x', false)).toEqual({ kind: 'unavailable' });
    expect(await repo.setCompleted('routine.x', MONDAY, true)).toEqual({ kind: 'unavailable' });
    expect(await repo.remove('routine.x')).toEqual({ kind: 'unavailable' });
    // Nothing was written to any fallback key.
    expect(rows.size).toBe(0);
  });
});

describe('account isolation', () => {
  it('keeps two accounts at different addresses and restores each one', async () => {
    const rows = new Map<string, string>();

    const mine = repository(rows, OWNER_A);
    await mine.create({ title: 'Mine', schedule: { kind: 'daily' } });

    const theirs = repository(rows, OWNER_B);
    const theirRead = await theirs.list();
    expect(theirRead.kind).toBe('ok');
    if (theirRead.kind === 'ok') {
      expect(theirRead.routines).toEqual([]);
    }

    await theirs.create({ title: 'Theirs', schedule: { kind: 'daily' } });

    const mineAgain = await repository(rows, OWNER_A).list();
    expect(mineAgain.kind).toBe('ok');
    if (mineAgain.kind === 'ok') {
      expect(mineAgain.routines.map((r) => r.title)).toEqual(['Mine']);
    }
  });

  it("does not leak one account's completions to another", async () => {
    const rows = new Map<string, string>();
    const mine = repository(rows, OWNER_A);
    const created = await mine.create(DAILY);
    const id = created.kind === 'saved' ? created.routine.id : '';
    await mine.setCompleted(id, MONDAY, true);

    const theirs = await repository(rows, OWNER_B).list();
    expect(theirs.kind).toBe('ok');
    if (theirs.kind === 'ok') {
      expect(theirs.completions.days).toEqual({});
    }
  });
});

describe('create, edit, disable, delete', () => {
  it('creates and reads back', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);

    const created = await repo.create({
      title: 'Stretch',
      note: 'Shoulders',
      schedule: { kind: 'weekdays', days: [0, 2] },
      preferredTime: '07:30',
      priority: 'high',
    });
    expect(created.kind).toBe('saved');

    const read = await repo.list();
    expect(read.kind).toBe('ok');
    if (read.kind === 'ok') {
      const [one] = read.routines;
      expect(one?.title).toBe('Stretch');
      expect(one?.note).toBe('Shoulders');
      expect(one?.preferredTime).toBe('07:30');
      expect(one?.priority).toBe('high');
      expect(one?.active).toBe(true);
    }
  });

  it('reports an invalid draft rather than saving it', async () => {
    const repo = repository(new Map());

    expect(await repo.create({ title: '', schedule: { kind: 'daily' } })).toEqual({
      kind: 'invalid',
      fault: 'empty-title',
    });
    expect(await repo.create({ title: 'x', schedule: { kind: 'weekdays', days: [] } })).toEqual({
      kind: 'invalid',
      fault: 'no-weekdays',
    });
  });

  it('refuses to exceed the routine limit', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);
    for (let index = 0; index < MAX_ROUTINES; index += 1) {
      const result = await repo.create({ title: `R${index}`, schedule: { kind: 'daily' } });
      expect(result.kind).toBe('saved');
    }
    expect(await repo.create({ title: 'One too many', schedule: { kind: 'daily' } })).toEqual({
      kind: 'invalid',
      fault: 'too-many-routines',
    });
  });

  it('updates without losing unrelated routines', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);
    const first = await repo.create({ title: 'First', schedule: { kind: 'daily' } });
    await repo.create({ title: 'Second', schedule: { kind: 'daily' } });
    const id = first.kind === 'saved' ? first.routine.id : '';

    const updated = await repo.update(id, {
      title: 'First renamed',
      schedule: { kind: 'weekdays', days: [4] },
    });
    expect(updated.kind).toBe('saved');

    const read = await repo.list();
    if (read.kind === 'ok') {
      expect(read.routines.map((r) => r.title).sort()).toEqual(['First renamed', 'Second']);
    }
  });

  it('reports not-found for an id that is not there', async () => {
    const repo = repository(new Map());
    expect(await repo.update('routine.missing', DAILY)).toEqual({ kind: 'not-found' });
    expect(await repo.setActive('routine.missing', false)).toEqual({ kind: 'not-found' });
    expect(await repo.setCompleted('routine.missing', MONDAY, true)).toEqual({
      kind: 'not-found',
    });
    expect(await repo.remove('routine.missing')).toEqual({ kind: 'not-found' });
  });

  it('disables without deleting, and re-enables', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);
    const created = await repo.create(DAILY);
    const id = created.kind === 'saved' ? created.routine.id : '';

    await repo.setActive(id, false);
    let read = await repo.list();
    if (read.kind === 'ok') {
      expect(read.routines[0]?.active).toBe(false);
      expect(read.routines).toHaveLength(1);
    }

    await repo.setActive(id, true);
    read = await repo.list();
    if (read.kind === 'ok') {
      expect(read.routines[0]?.active).toBe(true);
    }
  });

  it('deletes the definition', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);
    const created = await repo.create(DAILY);
    const id = created.kind === 'saved' ? created.routine.id : '';

    expect((await repo.remove(id)).kind).toBe('removed');
    const read = await repo.list();
    if (read.kind === 'ok') {
      expect(read.routines).toEqual([]);
    }
  });
});

describe('completions', () => {
  it('marks and reopens exactly one date', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);
    const created = await repo.create(DAILY);
    const id = created.kind === 'saved' ? created.routine.id : '';

    await repo.setCompleted(id, MONDAY, true);
    let read = await repo.list();
    if (read.kind === 'ok') {
      expect(routineIsCompletedOn(read.completions, id, MONDAY)).toBe(true);
      // Tomorrow starts incomplete, and nothing about Monday was deleted to achieve that.
      expect(routineIsCompletedOn(read.completions, id, TUESDAY)).toBe(false);
    }

    await repo.setCompleted(id, TUESDAY, true);
    await repo.setCompleted(id, MONDAY, false);
    read = await repo.list();
    if (read.kind === 'ok') {
      expect(routineIsCompletedOn(read.completions, id, MONDAY)).toBe(false);
      expect(routineIsCompletedOn(read.completions, id, TUESDAY)).toBe(true);
    }
  });

  /*
    The rule that makes editing safe. History is keyed by the day it happened on, so what the schedule
    says now cannot rewrite what the user did last week.
  */
  it('does not erase history when the schedule is edited', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);
    const created = await repo.create({ title: 'Stretch', schedule: { kind: 'daily' } });
    const id = created.kind === 'saved' ? created.routine.id : '';
    await repo.setCompleted(id, MONDAY, true);

    // Monday is no longer in the schedule at all.
    await repo.update(id, { title: 'Stretch', schedule: { kind: 'weekdays', days: [5, 6] } });

    const read = await repo.list();
    if (read.kind === 'ok') {
      expect(routineIsCompletedOn(read.completions, id, MONDAY)).toBe(true);
    }
  });

  it('does not erase history when a routine is disabled', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);
    const created = await repo.create(DAILY);
    const id = created.kind === 'saved' ? created.routine.id : '';
    await repo.setCompleted(id, MONDAY, true);

    await repo.setActive(id, false);

    const read = await repo.list();
    if (read.kind === 'ok') {
      expect(routineIsCompletedOn(read.completions, id, MONDAY)).toBe(true);
    }
  });

  it('bounds retained history to the window', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);
    const created = await repo.create(DAILY);
    const id = created.kind === 'saved' ? created.routine.id : '';

    for (let day = 0; day < MAX_COMPLETION_DAYS + 10; day += 1) {
      const iso = new Date(Date.UTC(2024, 0, 1 + day)).toISOString().slice(0, 10);
      await repo.setCompleted(id, iso, true);
    }

    const read = await repo.list();
    if (read.kind === 'ok') {
      expect(Object.keys(read.completions.days)).toHaveLength(MAX_COMPLETION_DAYS);
    }
  });

  /*
    Deleting must not leave rows nothing can display or remove. The cleanup runs in the same write as
    the deletion, so there is no window in which orphans exist.
  */
  it('removes a deleted routine’s completions in the same write, and bounds the result', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);
    const keep = await repo.create({ title: 'Keep', schedule: { kind: 'daily' } });
    const drop = await repo.create({ title: 'Drop', schedule: { kind: 'daily' } });
    const keepId = keep.kind === 'saved' ? keep.routine.id : '';
    const dropId = drop.kind === 'saved' ? drop.routine.id : '';

    await repo.setCompleted(keepId, MONDAY, true);
    await repo.setCompleted(dropId, MONDAY, true);
    await repo.setCompleted(dropId, TUESDAY, true);

    await repo.remove(dropId);

    const read = await repo.list();
    if (read.kind === 'ok') {
      expect(routineIsCompletedOn(read.completions, keepId, MONDAY)).toBe(true);
      expect(routineIsCompletedOn(read.completions, dropId, MONDAY)).toBe(false);
      // The day that held only the deleted routine is gone entirely, not left empty.
      expect(Object.keys(read.completions.days)).toEqual([MONDAY]);
      // And it is deterministic: the raw record contains the id nowhere.
      expect(JSON.stringify(read.completions)).not.toContain(dropId);
    }
  });
});

describe('failure handling', () => {
  it('does not overwrite corrupt definitions with an empty store', async () => {
    const rows = new Map<string, string>();
    const address = plannerRoutineAddress(OWNER_A) as string;
    rows.set(address, '{ this is not json');

    const repo = repository(rows);
    expect(await repo.list()).toEqual({ kind: 'corrupt' });
    expect(await repo.create(DAILY)).toEqual({ kind: 'unavailable' });

    // Byte-for-byte untouched: the user's data may be recoverable, and it is not after we write over it.
    expect(rows.get(address)).toBe('{ this is not json');
  });

  it('treats a structurally invalid envelope as corrupt, not empty', async () => {
    const rows = new Map<string, string>();
    rows.set(
      plannerRoutineAddress(OWNER_A) as string,
      JSON.stringify({ version: 9, routines: [] }),
    );

    expect(await repository(rows).list()).toEqual({ kind: 'corrupt' });
  });

  it('does not overwrite a corrupt completion log either', async () => {
    const rows = new Map<string, string>();
    const completions = plannerRoutineCompletionsAddress(OWNER_A) as string;
    rows.set(completions, 'not json at all');

    const repo = repository(rows);
    expect(await repo.list()).toEqual({ kind: 'corrupt' });
    expect(rows.get(completions)).toBe('not json at all');
  });

  it('reports a write failure instead of showing a routine that will vanish', async () => {
    const failing: PlannerRoutineStorage = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error('disk full');
      },
    };
    const repo = createPlannerRoutineRepository({
      ownerId: OWNER_A,
      storage: failing,
      id: () => 'routine.aaaaaaaa-1111-4111-8111-000000000001',
    });

    expect(await repo.create(DAILY)).toEqual({ kind: 'unavailable' });
  });

  it('reports unavailable when the store cannot be read at all', async () => {
    const failing: PlannerRoutineStorage = {
      getItem: async () => {
        throw new Error('unavailable');
      },
      setItem: async () => undefined,
    };
    const repo = createPlannerRoutineRepository({
      ownerId: OWNER_A,
      storage: failing,
      id: () => 'routine.aaaaaaaa-1111-4111-8111-000000000001',
    });

    expect(await repo.list()).toEqual({ kind: 'unavailable' });
  });

  it('treats an absent key as an empty store rather than corruption', async () => {
    const read = await repository(new Map()).list();
    expect(read.kind).toBe('ok');
    if (read.kind === 'ok') {
      expect(read.routines).toEqual([]);
      expect(read.completions.days).toEqual({});
    }
  });
});

describe('concurrency', () => {
  it('serialises concurrent creates so both survive', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);

    await Promise.all([
      repo.create({ title: 'First', schedule: { kind: 'daily' } }),
      repo.create({ title: 'Second', schedule: { kind: 'daily' } }),
    ]);

    const read = await repo.list();
    if (read.kind === 'ok') {
      expect(read.routines.map((r) => r.title).sort()).toEqual(['First', 'Second']);
    }
  });

  it('serialises concurrent completions on different days', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);
    const created = await repo.create(DAILY);
    const id = created.kind === 'saved' ? created.routine.id : '';

    await Promise.all([repo.setCompleted(id, MONDAY, true), repo.setCompleted(id, TUESDAY, true)]);

    const read = await repo.list();
    if (read.kind === 'ok') {
      expect(routineIsCompletedOn(read.completions, id, MONDAY)).toBe(true);
      expect(routineIsCompletedOn(read.completions, id, TUESDAY)).toBe(true);
    }
  });

  it('serialises a create against a delete without losing the store', async () => {
    const rows = new Map<string, string>();
    const repo = repository(rows);
    const first = await repo.create({ title: 'First', schedule: { kind: 'daily' } });
    const id = first.kind === 'saved' ? first.routine.id : '';

    await Promise.all([
      repo.create({ title: 'Second', schedule: { kind: 'daily' } }),
      repo.remove(id),
    ]);

    const read = await repo.list();
    expect(read.kind).toBe('ok');
    if (read.kind === 'ok') {
      expect(read.routines.map((r) => r.title)).toEqual(['Second']);
    }
  });
});
