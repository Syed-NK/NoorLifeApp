import fs from 'node:fs';
import path from 'node:path';

import { Text } from 'react-native';

import { act, render, renderHook, screen } from '@testing-library/react-native';

import { modulePalettes } from '@ds/tokens';

import { installPlannerDaySource, type PlannerDayHarness } from '@/test-support/planner-day';

import {
  createFinanceLedgerRepository,
  type FinanceStorage,
} from '@features/finance/data/finance-ledger.repository';
import { FinanceProvider, useOptionalFinance } from '@features/finance/di/finance-provider';
import { PLAN_CAPABILITIES, type Entitlement } from '@features/subscription/domain/entitlement';
import {
  EntitlementProvider,
  useEntitlementActions,
} from '@features/subscription/services/entitlement-context';
import { MockPurchaseAdapter } from '@features/subscription/services/mock-purchase-adapter';
import type { PurchaseAdapter } from '@features/subscription/services/purchase-adapter';
import type { TimelineEntry } from '@shared/models/dashboard';

import { useFinanceTimelineEntries } from '../hooks/use-finance-timeline-entries';

/**
 * **What Finance is allowed to say on Main Home** — issue #93.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Two boundaries, not one ────────────────────────────────────────────────
 * The first is about *what* may be shown to anyone. Main Home is the screen somebody hands to a
 * child, reads on a train, or leaves face-up on a desk, so Finance contributes how many entries were
 * recorded today and nothing else — no amount, no total, no category, and none of the free text the
 * user typed about their own spending. The brief permits an aggregate amount; a count is the smaller
 * of the two permitted disclosures and it is enough for the row to be useful.
 *
 * The second is about *whether* anything may be shown at all. The row stays visible when Finance is
 * locked, because a module nobody can see is a module nobody discovers. But a locked row must
 * disclose nothing, and "nothing" has to include the row's own existence: a locked row that appeared
 * only when something had been recorded today would make its presence the disclosure, and anyone
 * glancing at the phone would learn that this person spent money today — most of what the count
 * would have told them.
 *
 * So the unentitled path returns *before the ledger is read at all*. That is the property these
 * tests are built around, and it is why several assert that two very different ledgers produce
 * byte-identical output rather than merely asserting that a number is missing.
 *
 * ── Where the rendered proof lives ─────────────────────────────────────────
 * This file holds the hook's contract. The committed accessibility tree — the label, the hint, the
 * padlock and the upgrade tap — is asserted in `main-home-paid-content.test.tsx`, which already
 * mounts the whole screen inside the real provider stack. Duplicating that stack here would give a
 * second, weaker answer to the same question.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = '3f6d2c18-9a4b-4c7e-8f21-5b7d0e9a1c42';
const OTHER = '7b1e4a90-2c3d-4e5f-9a08-1d2c3b4a5e6f';
const NOW = new Date(2026, 7, 27, 9, 0, 0);
const TODAY = '2026-08-27';
const AT = new Date('2026-08-27T09:00:00.000Z');

const NEUTRAL_TITLE = 'Track what you spend';

/**
 * The locked row, written out in full.
 *
 * Every field is a literal, deliberately. An earlier version of this pinned the accent by reading it
 * back off the row under test, which meant a count smuggled into that field would have been compared
 * against itself and passed — a leak into `accent` survived the mutation run until this was written
 * as a constant. A fixture that borrows from the actual cannot contradict it.
 */
const NEUTRAL_ROW: TimelineEntry = {
  id: 'finance-today',
  time: 'Today',
  title: NEUTRAL_TITLE,
  icon: 'transactions',
  sourceModule: 'finance',
  accent: modulePalettes.finance.primary,
};

let ids = 0;
let harness: PlannerDayHarness | null = null;

function entitlement(plan: Entitlement['plan']): Entitlement {
  return {
    plan,
    billingPeriod: plan === 'free' ? 'none' : 'yearly',
    status: plan === 'free' ? 'free' : 'active',
    provider: 'development_mock',
    currentPeriodEnd: plan === 'free' ? null : '2027-03-01T00:00:00.000Z',
    trialEnd: null,
    cancelAtPeriodEnd: false,
    isFamilyOrganizer: false,
    capabilities: PLAN_CAPABILITIES[plan],
  };
}

const FREE = entitlement('free');
const PAID = entitlement('premium_single');

/**
 * A store whose entitlement the test can change between refreshes.
 *
 * The provider re-reads through `refresh()`, which is the same path a foreground reconciliation and
 * a completed purchase both take — so a grant proved this way is proved through production code
 * rather than by reaching into the provider's state.
 */
class SettableAdapter extends MockPurchaseAdapter {
  private current: Entitlement;

  constructor(initial: Entitlement) {
    super({ initialEntitlement: initial });
    this.current = initial;
  }

  set(next: Entitlement): void {
    this.current = next;
  }

  override async getEntitlement(): Promise<Entitlement> {
    return this.current;
  }
}

function memory() {
  const rows = new Map<string, string>();
  const storage: FinanceStorage = {
    getItem: async (key) => {
      await Promise.resolve();
      return rows.get(key) ?? null;
    },
    setItem: async (key, value) => {
      await Promise.resolve();
      rows.set(key, value);
    },
  };
  return storage;
}

function repo(storage: FinanceStorage, ownerId: string | null = OWNER) {
  return createFinanceLedgerRepository({
    ownerId,
    storage,
    id: () => `finance.aaaaaaaa-1111-4111-8111-${String(++ids).padStart(12, '0')}`,
    now: () => AT,
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** A ledger seeded through the real repository, with a category and a note to leak if it can. */
async function seeded(entries: readonly { day: string; amount: number }[]) {
  const storage = memory();
  const subject = repo(storage);
  await subject.setCurrency('AED');
  for (const entry of entries) {
    await subject.createTransaction({
      direction: 'expense',
      amountMinor: entry.amount,
      occurredOn: entry.day,
      category: 'Groceries',
      note: 'weekly shop',
    });
  }
  return storage;
}

type Wrap = {
  /** `'none'` mounts no entitlement provider at all. */
  readonly entitlement?: Entitlement | 'none' | PurchaseAdapter;
  readonly storage?: FinanceStorage;
  readonly ownerId?: string | null;
};

function wrapper({ entitlement: plan = FREE, storage, ownerId = OWNER }: Wrap) {
  return function Wrapper({ children }: { readonly children: React.ReactNode }) {
    const withFinance =
      storage === undefined ? (
        <>{children}</>
      ) : (
        <FinanceProvider repository={repo(storage, ownerId)}>{children}</FinanceProvider>
      );

    if (plan === 'none') {
      return withFinance;
    }
    const adapter =
      typeof plan === 'object' && 'getEntitlement' in plan && !('capabilities' in plan)
        ? (plan as PurchaseAdapter)
        : new MockPurchaseAdapter({ initialEntitlement: plan as Entitlement });
    return <EntitlementProvider adapter={adapter}>{withFinance}</EntitlementProvider>;
  };
}

async function rowsFor(options: Wrap) {
  const view = await renderHook(() => useFinanceTimelineEntries(), {
    wrapper: wrapper(options),
  });
  await settle();
  return view;
}

const only = (rows: readonly TimelineEntry[]): TimelineEntry => {
  expect(rows).toHaveLength(1);
  return rows[0]!;
};

beforeEach(() => {
  ids = 0;
  harness = installPlannerDaySource(NOW);
});

afterEach(() => {
  harness?.restore();
  harness = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// Entitled
// ─────────────────────────────────────────────────────────────────────────────

describe('an entitled account sees the live count', () => {
  it('reports today as a count once something is recorded', async () => {
    const view = await rowsFor({
      entitlement: PAID,
      storage: await seeded([{ day: TODAY, amount: 4250 }]),
    });

    expect(only(view.result.current)).toEqual(
      expect.objectContaining({
        id: 'finance-today',
        time: 'Today',
        title: '1 entry recorded',
        sourceModule: 'finance',
      }),
    );
  });

  it('pluralises, and counts only today', async () => {
    const view = await rowsFor({
      entitlement: PAID,
      storage: await seeded([
        { day: TODAY, amount: 100 },
        { day: TODAY, amount: 200 },
        { day: '2026-08-20', amount: 300 },
      ]),
    });

    expect(only(view.result.current).title).toBe('2 entries recorded');
  });

  it('carries no amount, category or note even where it is entitled to the count', async () => {
    const view = await rowsFor({
      entitlement: PAID,
      storage: await seeded([{ day: TODAY, amount: 4250 }]),
    });

    /*
      The whole row, serialized. Anything private that leaked into any field shows up here — which is
      the point of checking the value rather than only the title.
    */
    const serialized = JSON.stringify(view.result.current);
    for (const secret of ['Groceries', 'weekly shop', '42.50', '4250', 'AED']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('falls back to the neutral row when the ledger has nothing today', async () => {
    const view = await rowsFor({
      entitlement: PAID,
      storage: await seeded([{ day: '2026-08-20', amount: 300 }]),
    });

    expect(only(view.result.current).title).toBe(NEUTRAL_TITLE);
  });

  it('falls back to the neutral row before a currency is chosen', async () => {
    const view = await rowsFor({ entitlement: PAID, storage: memory() });
    expect(only(view.result.current).title).toBe(NEUTRAL_TITLE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Not entitled
// ─────────────────────────────────────────────────────────────────────────────

describe('an unentitled account sees a row that reports nothing', () => {
  it('keeps the row, for discoverability', async () => {
    const view = await rowsFor({ storage: await seeded([{ day: TODAY, amount: 4250 }]) });

    const row = only(view.result.current);
    expect(row.title).toBe(NEUTRAL_TITLE);
    expect(row.sourceModule).toBe('finance');
    /* One id for every state, so the row's identity cannot become the disclosure. */
    expect(row.id).toBe('finance-today');
  });

  it('carries no count in any field of the row', async () => {
    const view = await rowsFor({
      storage: await seeded([
        { day: TODAY, amount: 100 },
        { day: TODAY, amount: 200 },
        { day: TODAY, amount: 300 },
      ]),
    });

    /*
      Equality against a fixture built from literals is the real guard here. A substring search for
      the word "entries" would miss a bare digit tucked into an id, an accent or a field nothing
      draws, and a mutation doing exactly that survived until this became an equality check. The word
      list below is kept as a second, human-readable statement of what must not appear — it cannot
      search for digits, because the module accent is itself a hex colour full of them.
    */
    expect(view.result.current).toEqual([NEUTRAL_ROW]);

    const serialized = JSON.stringify(view.result.current);
    for (const leak of ['entries', 'entry', 'recorded', 'Groceries', 'weekly shop']) {
      expect(serialized).not.toContain(leak);
    }
  });

  it.each([
    ['an empty ledger', []],
    ['one entry today', [{ day: TODAY, amount: 100 }]],
    [
      'many entries today',
      [
        { day: TODAY, amount: 100 },
        { day: TODAY, amount: 200 },
        { day: TODAY, amount: 300 },
      ],
    ],
    ['entries on other days only', [{ day: '2026-08-20', amount: 300 }]],
  ] as const)('is byte-identical with %s', async (_label, entries) => {
    /*
      The property that matters most. A locked row must be the *same row* whatever the ledger holds,
      because a row that varied at all — in wording, in ordering, or in whether it appeared — would
      be reporting on records the viewer is not entitled to see.
    */
    const view = await rowsFor({ storage: await seeded(entries) });
    expect(view.result.current).toEqual([NEUTRAL_ROW]);
    expect(JSON.stringify(view.result.current)).toBe(JSON.stringify([NEUTRAL_ROW]));
  });

  it('returns before the ledger is read, rather than reading it and omitting the number', async () => {
    /*
      Asserted against the source, because "the number did not appear" and "the number was never
      derived" are different guarantees, and only the second survives somebody later adding a field
      to the row. The guard has to come first in the file, not merely first in intent.
    */
    const guard = HOOK.indexOf('if (!isEntitled)');
    expect(guard).toBeGreaterThan(-1);
    for (const read of ['finance.ledger', 'summariseFinance(', 'todayCount']) {
      expect(HOOK.indexOf(read)).toBeGreaterThan(guard);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unresolved, absent and signed out
// ─────────────────────────────────────────────────────────────────────────────

describe('every uncertain state is closed', () => {
  it('reports nothing with no entitlement provider at all', async () => {
    const view = await rowsFor({
      entitlement: 'none',
      storage: await seeded([{ day: TODAY, amount: 100 }]),
    });
    expect(only(view.result.current).title).toBe(NEUTRAL_TITLE);
  });

  it('reports nothing while the entitlement is still unknown', async () => {
    /*
      What the provider holds before its first resolve. A surface that showed the figure during that
      window would have shown it, and no later correction takes it back — which is why the default is
      closed rather than optimistic.
    */
    const view = await rowsFor({
      entitlement: { ...FREE, status: 'unknown' },
      storage: await seeded([{ day: TODAY, amount: 100 }]),
    });
    expect(only(view.result.current).title).toBe(NEUTRAL_TITLE);
  });

  it('reports nothing while the entitlement never resolves at all', async () => {
    const neverResolves: PurchaseAdapter = {
      id: 'mock',
      canTransact: false,
      getOffers: () => new Promise(() => {}),
      getEntitlement: () => new Promise(() => {}),
      purchase: () => new Promise(() => {}),
      restore: () => new Promise(() => {}),
      openManagement: () => new Promise(() => {}),
    };
    const view = await rowsFor({
      entitlement: neverResolves,
      storage: await seeded([{ day: TODAY, amount: 100 }]),
    });
    expect(only(view.result.current).title).toBe(NEUTRAL_TITLE);
  });

  it('reports nothing on an expired subscription', async () => {
    const view = await rowsFor({
      entitlement: { ...PAID, status: 'expired' },
      storage: await seeded([{ day: TODAY, amount: 100 }]),
    });
    expect(only(view.result.current).title).toBe(NEUTRAL_TITLE);
  });

  it('reports nothing when signed out', async () => {
    /*
      No owner means no storage address at all (#92), so the repository refuses before touching
      storage and the row has nothing to derive even for a paid account.
    */
    const view = await rowsFor({
      entitlement: PAID,
      storage: await seeded([{ day: TODAY, amount: 100 }]),
      ownerId: null,
    });
    expect(only(view.result.current).title).toBe(NEUTRAL_TITLE);
  });

  it('survives Main Home mounting without a Finance owner', async () => {
    /*
      Main Home is a consumer, not a Finance surface. `useFinance` throws by design — reading a
      private copy is the defect #73 removed from Planner — but a missing owner must not take down
      the app's first screen, which is the same rule `today-agenda-provider` records.
    */
    const view = await rowsFor({ entitlement: PAID });
    expect(only(view.result.current).title).toBe(NEUTRAL_TITLE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation
// ─────────────────────────────────────────────────────────────────────────────

describe('the boundary moves with the account, not with the launch', () => {
  it('reveals the count when entitlement is granted and hides it when revoked', async () => {
    const storage = await seeded([{ day: TODAY, amount: 100 }]);
    const adapter = new SettableAdapter(FREE);

    const view = await renderHook(
      () => ({ rows: useFinanceTimelineEntries(), actions: useEntitlementActions() }),
      {
        wrapper: ({ children }) => (
          <EntitlementProvider adapter={adapter}>
            <FinanceProvider repository={repo(storage)}>{children}</FinanceProvider>
          </EntitlementProvider>
        ),
      },
    );
    await settle();
    expect(view.result.current.rows[0]?.title).toBe(NEUTRAL_TITLE);

    adapter.set(PAID);
    await act(async () => {
      await view.result.current.actions.refresh();
    });
    await settle();

    /* No relaunch and no remount: entitlement is read live, exactly like the ledger beside it. */
    expect(view.result.current.rows[0]?.title).toBe('1 entry recorded');

    adapter.set(FREE);
    await act(async () => {
      await view.result.current.actions.refresh();
    });
    await settle();

    expect(view.result.current.rows[0]?.title).toBe(NEUTRAL_TITLE);
  });

  it('appears the moment a transaction is written through the provider', async () => {
    const storage = memory();
    const repository = repo(storage);
    await repository.setCurrency('AED');

    /*
      One provider, shared by the row and by the write — the property Planner's #72/#73 established.
      Nothing here reloads, re-mounts or re-reads by hand: the write publishes into the owner and the
      row follows in the same render.
    */
    const view = await renderHook(
      () => ({ rows: useFinanceTimelineEntries(), finance: useOptionalFinance() }),
      {
        wrapper: ({ children }) => (
          <EntitlementProvider adapter={new MockPurchaseAdapter({ initialEntitlement: PAID })}>
            <FinanceProvider repository={repository}>{children}</FinanceProvider>
          </EntitlementProvider>
        ),
      },
    );
    await settle();
    expect(view.result.current.rows[0]?.title).toBe(NEUTRAL_TITLE);

    await act(async () => {
      await view.result.current.finance?.createTransaction({
        direction: 'expense',
        amountMinor: 100,
        occurredOn: TODAY,
      });
    });
    await settle();

    expect(view.result.current.rows[0]?.title).toBe('1 entry recorded');

    const id = view.result.current.finance?.ledger.transactions[0]?.id ?? '';
    await act(async () => {
      await view.result.current.finance?.removeTransaction(id);
    });
    await settle();

    /* And it returns to the neutral row on the final deletion, without a relaunch either. */
    expect(view.result.current.rows[0]?.title).toBe(NEUTRAL_TITLE);
  });

  it('never shows the previous account holder count after a switch', async () => {
    const storage = await seeded([{ day: TODAY, amount: 100 }]);

    /* Rendered rather than hooked, so the switch happens by re-rendering one live tree. */
    function Probe() {
      const rows = useFinanceTimelineEntries();
      return <Text testID="probe">{rows.map((row) => row.title).join('|')}</Text>;
    }
    const tree = (ownerId: string) => (
      <EntitlementProvider adapter={new MockPurchaseAdapter({ initialEntitlement: PAID })}>
        <FinanceProvider repository={repo(storage, ownerId)}>
          <Probe />
        </FinanceProvider>
      </EntitlementProvider>
    );

    const view = await render(tree(OWNER));
    await settle();
    expect(screen.getByTestId('probe').props.children).toBe('1 entry recorded');

    /*
      The assertion is taken *before* anything is allowed to settle. The provider resets to loading
      during the render in which the repository identity changes, so there is no frame in which the
      first account's figure sits inside the second account's session — and the frame is precisely
      what is being tested.
    */
    await act(async () => {
      view.rerender(tree(OTHER));
    });
    expect(screen.getByTestId('probe').props.children).toBe(NEUTRAL_TITLE);

    await settle();
    expect(screen.getByTestId('probe').props.children).toBe(NEUTRAL_TITLE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Contracts that must not move
// ─────────────────────────────────────────────────────────────────────────────

const HOOK = fs
  .readFileSync(
    path.join(process.cwd(), 'src/features/home/hooks/use-finance-timeline-entries.ts'),
    'utf8',
  )
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

describe('the surrounding contracts', () => {
  it('names no amount, note or category anywhere in the hook', () => {
    expect(HOOK).not.toMatch(
      /\.note|\.category|formatAmount|formatMinor|amountMinor|expenseMinor|incomeMinor/,
    );
    expect(HOOK).toContain('summary.todayCount');
  });

  it('logs nothing and reaches no analytics', () => {
    expect(HOOK).not.toMatch(/console\.|fetch\(|analytics|track\(|Sentry/);
  });

  it('is fanned in through the one existing dashboard seam', () => {
    const dashboard = fs
      .readFileSync(
        path.join(process.cwd(), 'src/features/home/hooks/use-main-home-dashboard.ts'),
        'utf8',
      )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(dashboard).toContain('useFinanceTimelineEntries()');
    expect(dashboard).toContain('...financeRows');
    /* Into the existing timeline, not a section of its own. */
    expect(dashboard).toMatch(/timeline: \[[^\]]*\.\.\.financeRows[^\]]*\]/);
  });

  it('resolves entitlement through the shared rule rather than reading a plan', () => {
    /*
      A `plan === 'free'` written into a component is a rule that has escaped its definition.
      `useOptionalModuleAccess` resolves through `canAccessModule`, the same function the route gate
      uses, so this row and the module behind it cannot disagree about who is entitled.
    */
    expect(HOOK).toContain("useOptionalModuleAccess('finance')");
    expect(HOOK).not.toMatch(/plan ===|status ===|premium_single|premium_family/);
  });

  it('leaves the Planner rows exactly as they were', () => {
    /*
      Planner reaches the same timeline through its own hook, and this change touched neither it nor
      the shared row component. Asserted because "only Finance changed" is the claim, and the two
      hooks sit side by side in the same fan-in.
    */
    const planner = fs.readFileSync(
      path.join(process.cwd(), 'src/features/home/hooks/use-planner-timeline-entries.ts'),
      'utf8',
    );
    expect(planner).not.toMatch(/useOptionalModuleAccess|isEntitled|Track what you spend/);
  });
});
