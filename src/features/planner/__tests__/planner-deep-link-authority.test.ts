import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createPlannerTaskRepository,
  plannerTaskAddress,
  type PlannerTaskStorage,
} from '../data/planner-task.repository';

/**
 * **A Planner deep link may not open somebody's tasks without authority** — the data half of #28.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why Planner, specifically ──────────────────────────────────────────────
 * Issue #28 recorded that direct routes outside Faith mounted with no authentication decision, and
 * that on the routes actually observed no user data was exposed — because Finance, Learning, Family
 * and Goals have no store at all. That is a property of today's feature set, not a boundary.
 *
 * **Planner is the exception**: it is reachable by direct link and it owns real account-scoped rows,
 * so it is the module where the two barriers have to be proven together rather than assumed. The
 * issue explicitly recorded Planner as untested and claimed nothing about it; this is that test.
 *
 * ── Two barriers, asserted separately ──────────────────────────────────────
 * The route boundary decides whether the *screen* may mount. The storage address decides whether the
 * *data* may be read. Neither substitutes for the other — the boundary could be removed and the
 * screens would render empty, looking fine; the address could leak and the boundary would hide it
 * until the next direct link — so `protected-route-boundary.test.ts` covers the first and this
 * covers the second, for the same account states.
 *
 * The repository's own owner rules are already asserted in `planner-task-repository.test.ts`. What
 * this adds is the case that belongs to a *routing* change: what happens to retained rows when
 * access ends, which is the thing a guard is most likely to get wrong by being too aggressive.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const USER_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

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

describe('losing access does not lose the data', () => {
  it('keeps a retained row through a no-owner interval and returns it to the same account', async () => {
    const storage = memoryStorage();
    const owned = createPlannerTaskRepository({
      ownerId: USER_A,
      storage,
      id: () => `task.${USER_A}`,
    });
    await owned.create({ title: 'A retained task' });
    const addressA = plannerTaskAddress(USER_A);
    expect(addressA).not.toBeNull();
    const rawAfterWrite = storage.rows.get(addressA as string);

    /*
      Access ends — a sign-out, an expired session, or a direct link the boundary rejected. The
      repository is rebuilt with no owner, which is exactly what `PlannerProvider` does when
      `isLocallyAuthenticated` is false.
    */
    const unowned = createPlannerTaskRepository({ ownerId: null, storage });
    await expect(unowned.list()).resolves.toEqual({ kind: 'unavailable' });
    await expect(unowned.create({ title: 'Must not escape' })).resolves.toEqual({
      kind: 'unavailable',
    });

    /*
      The row is still there, byte for byte. "Do not delete retained account data merely because
      access ends" — a guard that cleared the store on rejection would pass every reachability test
      in the suite and destroy somebody's tasks on a mistyped link.
    */
    expect(storage.rows.get(addressA as string)).toBe(rawAfterWrite);

    // And it comes back, to the same account and no other.
    const returned = createPlannerTaskRepository({ ownerId: USER_A, storage });
    const result = await returned.list();
    expect(result.kind).toBe('ok');
    expect(result.kind === 'ok' ? result.tasks.map((task) => task.title) : []).toEqual([
      'A retained task',
    ]);
  });

  it('resolves a different account to a different address, reading none of the first', async () => {
    const storage = memoryStorage();
    await createPlannerTaskRepository({
      ownerId: USER_A,
      storage,
      id: () => `task.${USER_A}`,
    }).create({ title: 'A private task' });

    const other = await createPlannerTaskRepository({ ownerId: USER_B, storage }).list();
    expect(other).toEqual({ kind: 'ok', tasks: [] });
    expect(plannerTaskAddress(USER_B)).not.toBe(plannerTaskAddress(USER_A));
  });
});

describe('the provider asks the same authority the boundary does', () => {
  /*
    One authority, asserted where it could diverge. If `PlannerProvider` derived its owner from
    anything other than the shared predicate — a bare `status === 'signed-in'`, or a user id read
    without checking the status — then a route the boundary admitted and a store the provider opened
    could disagree about who the user is. That disagreement is the whole shape of issue #28, one
    layer down.
  */
  const provider = readFileSync(
    join(__dirname, '..', 'di', 'planner-provider.tsx'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, '');

  it('derives the owner through isLocallyAuthenticated', () => {
    expect(provider).toContain('isLocallyAuthenticated(auth)');
  });

  it('passes null rather than a fallback when there is no authority', () => {
    expect(provider).toContain('ownerId');
    expect(provider).not.toMatch(/ownerId\s*[:=]\s*['"`]/);
    expect(provider).not.toMatch(/\?\?\s*['"`]/);
  });
});
