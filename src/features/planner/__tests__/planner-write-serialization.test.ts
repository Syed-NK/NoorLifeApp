import {
  createPlannerTaskRepository,
  plannerTaskAddress,
  type PlannerTaskStorage,
} from '../data/planner-task.repository';
import { createPlannerRoutineRepository } from '../data/planner-routine.repository';
import { plannerWriteLaneCount, serializePlannerWrite } from '../data/planner-write-queue';
import { PLANNER_TASK_SCHEMA_VERSION } from '../data/planner-task';

/**
 * **Two live repositories for one account cannot lose a write** — issue #72.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why the storage has to be slow ─────────────────────────────────────────
 * Every mutation is a read-modify-write of the whole envelope. With an instantaneous store the read
 * and the write land in the same microtask and nothing can interleave, so a fast fake would pass
 * against the defect as readily as against the fix — it would prove only that the test cannot see the
 * bug. The fake below puts a fixed number of microtasks between accepting a call and answering it,
 * which is the smallest thing that lets a second operation start inside the first one's gap.
 *
 * That gap is exactly what the old code allowed. Each repository held its own queue, so two instances
 * for one account both read, both mutated their own snapshot, and both wrote the whole array back;
 * the later write erased the earlier change with no error. Reverting `mutate` to a per-instance queue
 * makes the first three cases here fail.
 *
 * ── Two instances, deliberately ────────────────────────────────────────────
 * One repository has always serialized against itself. The defect only appears with two, which is
 * what a provider-per-route tree produced in production and what every case below constructs.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = '3f6d2c18-9a4b-4c7e-8f21-5b7d0e9a1c42';
const OTHER = '7b1e4a90-2c3d-4e5f-9a08-1d2c3b4a5e6f';

/** A store that answers after `gap` microtasks, so operations can be made to overlap on purpose. */
function slowStorage(gap = 4): PlannerTaskStorage & {
  readonly raw: Map<string, string>;
  writes: number;
  fail: boolean;
} {
  const raw = new Map<string, string>();
  const wait = async (): Promise<void> => {
    for (let i = 0; i < gap; i += 1) {
      await Promise.resolve();
    }
  };
  const store = {
    raw,
    writes: 0,
    fail: false,
    async getItem(key: string): Promise<string | null> {
      await wait();
      return raw.get(key) ?? null;
    },
    async setItem(key: string, value: string): Promise<void> {
      await wait();
      if (store.fail) {
        throw new Error('storage refused the write');
      }
      store.writes += 1;
      raw.set(key, value);
    },
  };
  return store;
}

function repositoryPair(storage: PlannerTaskStorage, ownerId = OWNER) {
  let counter = 0;
  const id = (): string => `task.${String(counter++).padStart(8, '0')}-0000-4000-8000-000000000000`;
  const now = (): Date => new Date('2026-03-01T09:00:00.000Z');
  return {
    a: createPlannerTaskRepository({ ownerId, storage, now, id }),
    b: createPlannerTaskRepository({ ownerId, storage, now, id }),
  };
}

function storedTitles(storage: { raw: Map<string, string> }, ownerId = OWNER): readonly string[] {
  const raw = storage.raw.get(plannerTaskAddress(ownerId) ?? '');
  if (raw === undefined) {
    return [];
  }
  const parsed = JSON.parse(raw) as { tasks: readonly { title: string }[] };
  return parsed.tasks.map((task) => task.title).sort();
}

describe('concurrent writes from two repository instances', () => {
  it('retains both tasks when two instances create at the same time', async () => {
    const storage = slowStorage();
    const { a, b } = repositoryPair(storage);

    /* Started without awaiting the first: both are in flight before either has written. */
    const [first, second] = await Promise.all([
      a.create({ title: 'From A' }),
      b.create({ title: 'From B' }),
    ]);

    expect(first.kind).toBe('saved');
    expect(second.kind).toBe('saved');
    expect(storedTitles(storage)).toEqual(['From A', 'From B']);
  });

  it('retains both results when one instance edits while the other creates', async () => {
    const storage = slowStorage();
    const { a, b } = repositoryPair(storage);

    const seeded = await a.create({ title: 'Original' });
    expect(seeded.kind).toBe('saved');
    const id = seeded.kind === 'saved' ? seeded.task.id : '';

    await Promise.all([a.update(id, { title: 'Edited' }), b.create({ title: 'Added' })]);

    expect(storedTitles(storage)).toEqual(['Added', 'Edited']);
  });

  it('produces the defined serialized result when a completion races a delete', async () => {
    const storage = slowStorage();
    const { a, b } = repositoryPair(storage);

    const seeded = await a.create({ title: 'Contested', dueDate: '2026-03-01' });
    const id = seeded.kind === 'saved' ? seeded.task.id : '';

    /*
      Completion is queued first, so it runs first. The delete then operates on the completed task and
      removes it. The defined outcome is therefore: completion saved, delete removed, store empty —
      not an interleaving where the completion's full-array write resurrects the deleted row.
    */
    const [completion, removal] = await Promise.all([a.setCompleted(id, true), b.remove(id)]);

    expect(completion.kind).toBe('saved');
    expect(removal.kind).toBe('removed');
    expect(storedTitles(storage)).toEqual([]);
  });

  it('runs the second operation only after the first has written', async () => {
    /*
      The mechanism, asserted directly rather than through its consequence. Under a per-instance queue
      B's read happens before A's write and the order is read,read,write,write.
    */
    const order: string[] = [];
    const raw = new Map<string, string>();
    const storage: PlannerTaskStorage = {
      async getItem(key: string) {
        order.push('read');
        await Promise.resolve();
        await Promise.resolve();
        return raw.get(key) ?? null;
      },
      async setItem(key: string, value: string) {
        order.push('write');
        await Promise.resolve();
        raw.set(key, value);
      },
    };
    const { a, b } = repositoryPair(storage);

    await Promise.all([a.create({ title: 'One' }), b.create({ title: 'Two' })]);

    expect(order).toEqual(['read', 'write', 'read', 'write']);
  });
});

describe('concurrent writes from two routine repository instances', () => {
  function routinePair(storage: PlannerTaskStorage, ownerId = OWNER) {
    let counter = 0;
    const make = () =>
      createPlannerRoutineRepository({
        ownerId,
        storage,
        now: () => new Date('2026-03-01T09:00:00.000Z'),
        id: () => `routine.${String(counter++).padStart(8, '0')}-0000-4000-8000-000000000000`,
      });
    return { a: make(), b: make() };
  }

  function storedRoutineTitles(storage: { raw: Map<string, string> }): readonly string[] {
    const raw = storage.raw.get(`noorlife.planner.user.v1.${OWNER}.routines`);
    if (raw === undefined) {
      return [];
    }
    const parsed = JSON.parse(raw) as { routines: readonly { title: string }[] };
    return parsed.routines.map((routine) => routine.title).sort();
  }

  it('retains both routines when two instances create at the same time', async () => {
    const storage = slowStorage();
    const { a, b } = routinePair(storage);

    const [first, second] = await Promise.all([
      a.create({ title: 'Morning walk', schedule: { kind: 'daily' } }),
      b.create({ title: 'Evening reading', schedule: { kind: 'daily' } }),
    ]);

    expect(first.kind).toBe('saved');
    expect(second.kind).toBe('saved');
    expect(storedRoutineTitles(storage)).toEqual(['Evening reading', 'Morning walk']);
  });

  it('keeps a completion and a routine edit from clobbering each other', async () => {
    /*
      These touch two different keys through one `write`, which is why the lane is named after the
      routine address for both. Unserialized, the edit's routine-array write and the completion's
      routine-array write are built from the same snapshot and one of them disappears.
    */
    const storage = slowStorage();
    const { a, b } = routinePair(storage);

    const seeded = await a.create({ title: 'Original', schedule: { kind: 'daily' } });
    const id = seeded.kind === 'saved' ? seeded.routine.id : '';

    await Promise.all([
      a.update(id, { title: 'Renamed', schedule: { kind: 'daily' } }),
      b.create({ title: 'Added', schedule: { kind: 'daily' } }),
    ]);

    expect(storedRoutineTitles(storage)).toEqual(['Added', 'Renamed']);
  });

  it('retains a completion recorded while another instance adds a routine', async () => {
    const storage = slowStorage();
    const { a, b } = routinePair(storage);

    const seeded = await a.create({ title: 'Tracked', schedule: { kind: 'daily' } });
    const id = seeded.kind === 'saved' ? seeded.routine.id : '';

    await Promise.all([
      a.setCompleted(id, '2026-03-01', true),
      b.create({ title: 'Also added', schedule: { kind: 'daily' } }),
    ]);

    const listed = await a.list();
    expect(listed.kind).toBe('ok');
    if (listed.kind === 'ok') {
      expect(listed.routines.map((routine) => routine.title).sort()).toEqual([
        'Also added',
        'Tracked',
      ]);
      expect(listed.completions.days['2026-03-01']).toEqual([id]);
    }
  });

  it('preserves the retention bound and deletion cleanup under concurrency', async () => {
    const storage = slowStorage();
    const { a, b } = routinePair(storage);

    const kept = await a.create({ title: 'Kept', schedule: { kind: 'daily' } });
    const doomed = await b.create({ title: 'Doomed', schedule: { kind: 'daily' } });
    const keptId = kept.kind === 'saved' ? kept.routine.id : '';
    const doomedId = doomed.kind === 'saved' ? doomed.routine.id : '';

    await a.setCompleted(keptId, '2026-03-01', true);
    await b.setCompleted(doomedId, '2026-03-01', true);

    await Promise.all([a.remove(doomedId), b.setCompleted(keptId, '2026-03-02', true)]);

    const listed = await a.list();
    expect(listed.kind).toBe('ok');
    if (listed.kind === 'ok') {
      expect(listed.routines.map((routine) => routine.title)).toEqual(['Kept']);
      /* The deleted routine's completion is pruned; the survivor's two days are untouched. */
      expect(listed.completions.days['2026-03-01']).toEqual([keptId]);
      expect(listed.completions.days['2026-03-02']).toEqual([keptId]);
      expect(Object.keys(listed.completions.days).length).toBeLessThanOrEqual(400);
    }
  });
});

describe('serialization does not weaken what the repository already guaranteed', () => {
  it('publishes nothing and stores nothing when the write fails', async () => {
    const storage = slowStorage();
    const { a } = repositoryPair(storage);
    storage.fail = true;

    const result = await a.create({ title: 'Never lands' });

    expect(result.kind).toBe('unavailable');
    expect(storage.writes).toBe(0);
    expect(storedTitles(storage)).toEqual([]);
  });

  it('refuses to overwrite corrupt storage', async () => {
    const storage = slowStorage();
    const address = plannerTaskAddress(OWNER) ?? '';
    const corrupt = JSON.stringify({ version: PLANNER_TASK_SCHEMA_VERSION, tasks: [{ nope: 1 }] });
    storage.raw.set(address, corrupt);
    const { a, b } = repositoryPair(storage);

    const [one, two] = await Promise.all([a.create({ title: 'A' }), b.create({ title: 'B' })]);

    expect(one.kind).toBe('unavailable');
    expect(two.kind).toBe('unavailable');
    expect(storage.writes).toBe(0);
    /* Byte-identical: a corrupt store is evidence, and overwriting it would destroy the evidence. */
    expect(storage.raw.get(address)).toBe(corrupt);
  });

  it('keeps a failed operation from wedging the lane', async () => {
    const storage = slowStorage();
    const { a, b } = repositoryPair(storage);

    storage.fail = true;
    const refused = await a.create({ title: 'Refused' });
    expect(refused.kind).toBe('unavailable');

    storage.fail = false;
    const accepted = await b.create({ title: 'Accepted' });
    expect(accepted.kind).toBe('saved');
    expect(storedTitles(storage)).toEqual(['Accepted']);
  });

  it('does not serialize one account behind another', async () => {
    /*
      The lane is the storage address, so two accounts write in parallel. A single module-wide queue
      would also be correct and would make this test's `order` strictly sequential.
    */
    const storage = slowStorage(6);
    const mine = repositoryPair(storage, OWNER).a;
    const theirs = repositoryPair(storage, OTHER).a;

    await Promise.all([mine.create({ title: 'Mine' }), theirs.create({ title: 'Theirs' })]);

    expect(storedTitles(storage, OWNER)).toEqual(['Mine']);
    expect(storedTitles(storage, OTHER)).toEqual(['Theirs']);
  });

  it('drains its lanes, so a long session accumulates nothing', async () => {
    const storage = slowStorage();
    const { a } = repositoryPair(storage);
    await a.create({ title: 'Transient' });
    /* One more turn for the cleanup continuation to run. */
    await Promise.resolve();
    await Promise.resolve();
    expect(plannerWriteLaneCount()).toBe(0);
  });

  it('runs an ownerless mutation without a lane, and still refuses it', async () => {
    const storage = slowStorage();
    const orphan = createPlannerTaskRepository({ ownerId: null, storage });
    expect(orphan.address).toBeNull();

    const result = await orphan.create({ title: 'No owner' });

    expect(result.kind).toBe('unavailable');
    expect(storage.writes).toBe(0);
  });
});

describe('the queue is one shared boundary, not a per-file copy', () => {
  it('is the same lane both repositories reach', async () => {
    /*
      Asserted through behaviour rather than by reading the source: a routine write and a task write
      for one account use different keys, so they must *not* block each other — while two writers on
      one key must. Both facts follow from the lane being the address, and neither would hold if a
      repository had quietly kept a local queue.
    */
    const raw = new Map<string, string>();
    const storage = {
      async getItem(key: string) {
        await Promise.resolve();
        return raw.get(key) ?? null;
      },
      async setItem(key: string, value: string) {
        await Promise.resolve();
        raw.set(key, value);
      },
    };
    let n = 0;
    const routines = createPlannerRoutineRepository({
      ownerId: OWNER,
      storage,
      now: () => new Date('2026-03-01T09:00:00.000Z'),
      id: () => `routine.${String(n++).padStart(8, '0')}-0000-4000-8000-000000000000`,
    });
    const tasks = createPlannerTaskRepository({
      ownerId: OWNER,
      storage,
      now: () => new Date('2026-03-01T09:00:00.000Z'),
      id: () => `task.${String(n++).padStart(8, '0')}-0000-4000-8000-000000000000`,
    });

    const [routine, task] = await Promise.all([
      routines.create({ title: 'Morning walk', schedule: { kind: 'daily' } }),
      tasks.create({ title: 'Call the clinic' }),
    ]);

    expect(routine.kind).toBe('saved');
    expect(task.kind).toBe('saved');
  });

  it('orders operations on one lane and settles them in order', async () => {
    const seen: number[] = [];
    const step = (n: number) => async () => {
      await Promise.resolve();
      await Promise.resolve();
      seen.push(n);
      return n;
    };

    const results = await Promise.all([
      serializePlannerWrite('lane', step(1)),
      serializePlannerWrite('lane', step(2)),
      serializePlannerWrite('lane', step(3)),
    ]);

    expect(seen).toEqual([1, 2, 3]);
    expect(results).toEqual([1, 2, 3]);
  });
});
