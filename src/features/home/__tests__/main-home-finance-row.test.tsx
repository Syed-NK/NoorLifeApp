import fs from 'node:fs';
import path from 'node:path';

import { act, renderHook } from '@testing-library/react-native';

import { installPlannerDaySource, type PlannerDayHarness } from '@/test-support/planner-day';

import {
  createFinanceLedgerRepository,
  type FinanceStorage,
} from '@features/finance/data/finance-ledger.repository';
import { FinanceProvider, useOptionalFinance } from '@features/finance/di/finance-provider';

import { useFinanceTimelineEntries } from '../hooks/use-finance-timeline-entries';

/**
 * **What Finance is allowed to say on Main Home** — issue #93.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── A count, and nothing else ──────────────────────────────────────────────
 * Main Home is the screen somebody hands to a child, reads on a train, or leaves face-up on a desk.
 * A row there is seen by whoever is *looking at* the phone, not only by whoever unlocked it. So
 * Finance contributes how many entries were recorded today and stops: no amount, no total, no
 * category, and none of the free text the user typed about their own spending.
 *
 * The brief permits an aggregate amount. A count is the smaller of the two permitted disclosures and
 * it is enough for the row to be useful, so it is what this takes.
 *
 * ── Through the one provider, into the one seam ────────────────────────────
 * `use-main-home-dashboard.ts` already fans Faith and Planner in, and Finance takes the same route
 * rather than acquiring a dashboard section of its own — the screen is byte-locked, and a new
 * section would be a product decision arriving as a side effect of a data change. Reading the #92
 * provider rather than building a second store is what makes the row appear the instant Spending
 * writes, with no relaunch and no event bus.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = '3f6d2c18-9a4b-4c7e-8f21-5b7d0e9a1c42';
const NOW = new Date(2026, 7, 27, 9, 0, 0);
const TODAY = '2026-08-27';
const AT = new Date('2026-08-27T09:00:00.000Z');

let ids = 0;

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

let harness: PlannerDayHarness | null = null;

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function rowsFor(storage: FinanceStorage) {
  const view = await renderHook(() => useFinanceTimelineEntries(), {
    wrapper: ({ children }) => (
      <FinanceProvider repository={repo(storage)}>{children}</FinanceProvider>
    ),
  });
  await settle();
  return view;
}

beforeEach(() => {
  ids = 0;
  harness = installPlannerDaySource(NOW);
});

afterEach(() => {
  harness?.restore();
  harness = null;
});

describe('Finance on Main Home', () => {
  it('contributes nothing before a currency is chosen', async () => {
    const view = await rowsFor(memory());
    expect(view.result.current).toEqual([]);
  });

  it('contributes nothing while the ledger is empty', async () => {
    const storage = memory();
    await repo(storage).setCurrency('AED');
    const view = await rowsFor(storage);
    expect(view.result.current).toEqual([]);
  });

  it('reports today as a count once something is recorded', async () => {
    const storage = memory();
    const subject = repo(storage);
    await subject.setCurrency('AED');
    await subject.createTransaction({
      direction: 'expense',
      amountMinor: 4250,
      occurredOn: TODAY,
      category: 'Groceries',
      note: 'weekly shop',
    });

    const view = await rowsFor(storage);
    expect(view.result.current).toEqual([
      expect.objectContaining({
        id: 'finance-today',
        time: 'Today',
        title: '1 entry recorded',
        sourceModule: 'finance',
      }),
    ]);
  });

  it('carries no amount, category or note in what it renders', async () => {
    const storage = memory();
    const subject = repo(storage);
    await subject.setCurrency('AED');
    await subject.createTransaction({
      direction: 'expense',
      amountMinor: 4250,
      occurredOn: TODAY,
      category: 'Groceries',
      note: 'weekly shop',
    });

    const view = await rowsFor(storage);
    /*
      The whole row, serialized. Anything private that leaked into any field would show up here —
      which is the point of checking the value rather than only the title.
    */
    const serialized = JSON.stringify(view.result.current);
    for (const secret of ['Groceries', 'weekly shop', '42.50', '4250', 'AED']) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('counts only today, on the day the shared source states', async () => {
    const storage = memory();
    const subject = repo(storage);
    await subject.setCurrency('AED');
    await subject.createTransaction({
      direction: 'expense',
      amountMinor: 100,
      occurredOn: TODAY,
    });
    await subject.createTransaction({
      direction: 'income',
      amountMinor: 200,
      occurredOn: TODAY,
    });
    await subject.createTransaction({
      direction: 'expense',
      amountMinor: 300,
      occurredOn: '2026-08-20',
    });

    const view = await rowsFor(storage);
    expect(view.result.current[0]?.title).toBe('2 entries recorded');
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
          <FinanceProvider repository={repository}>{children}</FinanceProvider>
        ),
      },
    );
    await settle();
    expect(view.result.current.rows).toEqual([]);

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

    /* And it leaves again on the final deletion, without a relaunch either. */
    expect(view.result.current.rows).toEqual([]);
  });

  it('survives Main Home mounting without a Finance owner', async () => {
    /*
      Main Home is a consumer, not a Finance surface. `useFinance` throws by design — reading a
      private copy is the defect #73 removed from Planner — but a missing owner must not take down
      the app's first screen, which is the same rule `today-agenda-provider` records.
    */
    const view = await renderHook(() => useFinanceTimelineEntries());
    await settle();
    expect(view.result.current).toEqual([]);
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
});
