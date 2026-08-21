import {
  createPlannerTaskRepository,
  plannerTaskAddress,
  type PlannerTaskStorage,
} from '../data/planner-task.repository';

const USER_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const ID_A = 'task.aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ID_B = 'task.bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

function memoryStorage(): PlannerTaskStorage & { readonly rows: Map<string, string> } {
  const rows = new Map<string, string>();
  return {
    rows,
    getItem: async (key) => rows.get(key) ?? null,
    setItem: async (key, value) => {
      rows.set(key, value);
    },
  };
}

describe('account-scoped Planner repository', () => {
  it('maps only valid account ids to an address', () => {
    expect(plannerTaskAddress(USER_A)).toBe(`noorlife.planner.user.v1.${USER_A}.tasks`);
    expect(plannerTaskAddress(null)).toBeNull();
    expect(plannerTaskAddress('')).toBeNull();
    expect(plannerTaskAddress('../shared')).toBeNull();
  });

  it('refuses every read and write when there is no owner', async () => {
    const storage = memoryStorage();
    const repository = createPlannerTaskRepository({ ownerId: null, storage });
    await expect(repository.list()).resolves.toEqual({ kind: 'unavailable' });
    await expect(repository.create({ title: 'Must not escape' })).resolves.toEqual({
      kind: 'unavailable',
    });
    expect(storage.rows.size).toBe(0);
  });

  it('keeps two accounts at different addresses and restores each one', async () => {
    const storage = memoryStorage();
    const a = createPlannerTaskRepository({ ownerId: USER_A, storage, id: () => ID_A });
    const b = createPlannerTaskRepository({ ownerId: USER_B, storage, id: () => ID_B });
    await a.create({ title: 'A private task' });
    await b.create({ title: 'B private task' });
    expect(storage.rows.size).toBe(2);
    await expect(a.list()).resolves.toMatchObject({
      kind: 'ok',
      tasks: [{ title: 'A private task' }],
    });
    await expect(b.list()).resolves.toMatchObject({
      kind: 'ok',
      tasks: [{ title: 'B private task' }],
    });
  });

  it('creates, updates, completes, reopens and removes without losing unrelated rows', async () => {
    const storage = memoryStorage();
    let tick = 8;
    const ids = [ID_A, ID_B];
    const repository = createPlannerTaskRepository({
      ownerId: USER_A,
      storage,
      id: () => ids.shift() ?? ID_B,
      now: () => new Date(`2026-08-21T${String(tick++).padStart(2, '0')}:00:00.000Z`),
    });
    await repository.create({ title: 'First' });
    await repository.create({ title: 'Second' });
    await repository.update(ID_A, { title: 'First edited', priority: 'high' });
    await repository.setCompleted(ID_A, true);
    await repository.setCompleted(ID_A, false);
    await repository.remove(ID_B);
    await expect(repository.list()).resolves.toMatchObject({
      kind: 'ok',
      tasks: [{ id: ID_A, title: 'First edited', priority: 'high', status: 'open' }],
    });
  });

  it('serialises concurrent mutations so both tasks survive', async () => {
    const storage = memoryStorage();
    const ids = [ID_A, ID_B];
    const repository = createPlannerTaskRepository({
      ownerId: USER_A,
      storage,
      id: () => ids.shift() ?? ID_B,
    });
    await Promise.all([
      repository.create({ title: 'First' }),
      repository.create({ title: 'Second' }),
    ]);
    const result = await repository.list();
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.tasks).toHaveLength(2);
  });

  it('does not overwrite corrupt data with an apparently empty store', async () => {
    const storage = memoryStorage();
    const address = plannerTaskAddress(USER_A)!;
    storage.rows.set(address, '{broken');
    const repository = createPlannerTaskRepository({ ownerId: USER_A, storage, id: () => ID_A });
    await expect(repository.list()).resolves.toEqual({ kind: 'corrupt' });
    await expect(repository.create({ title: 'Would overwrite' })).resolves.toEqual({
      kind: 'unavailable',
    });
    expect(storage.rows.get(address)).toBe('{broken');
  });

  it('reports write failures instead of showing a task that will vanish', async () => {
    const repository = createPlannerTaskRepository({
      ownerId: USER_A,
      storage: {
        getItem: async () => null,
        setItem: async () => Promise.reject(new Error('full')),
      },
      id: () => ID_A,
    });
    await expect(repository.create({ title: 'Not stored' })).resolves.toEqual({
      kind: 'unavailable',
    });
  });
});
