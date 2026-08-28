import fs from 'node:fs';
import path from 'node:path';

import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { moduleRegistry } from '@features/modules/module-registry';
import { pinModuleWindow } from '@/test-support/module-window';
import { installPlannerDaySource, type PlannerDayHarness } from '@/test-support/planner-day';

import {
  MAX_FINANCE_BUDGETS,
  createFinanceBudget,
  financeCategoryKey,
  findBudgetForCategory,
  isFinanceBudget,
  parseFinanceBudgetsEnvelope,
  validateFinanceBudgetDraft,
  type FinanceBudget,
} from '../data/finance-budget';
import { budgetProgress, progressForMonth } from '../data/finance-budget-progress';
import { canChangeFinanceCurrency } from '../data/finance-currency-lock';
import {
  createFinanceBudgetRepository,
  type FinanceBudgetRepository,
} from '../data/finance-budget.repository';
import type { FinanceLedger, FinanceTransaction } from '../data/finance-ledger';
import {
  createFinanceLedgerRepository,
  financeBudgetsAddress,
  financeLedgerAddress,
  type FinanceStorage,
} from '../data/finance-ledger.repository';
import { MAX_MINOR_UNITS, type FinanceCurrency } from '../data/finance-money';
import { financeWriteLaneCount } from '../data/finance-write-queue';
import { FinanceProvider, useFinance } from '../di/finance-provider';
import { FinanceBudgetsScreen } from '../screens/finance-budgets-screen';
import { FinanceSpendingScreen } from '../screens/finance-spending-screen';

/**
 * **Budgets** — issue #94.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The one invariant everything else serves ───────────────────────────────
 * A budget stores an intent and never a total. Most of this file exists to hold that line from both
 * directions: the stored bytes are read back and asserted to contain no `spentMinor`, and every
 * derived figure is driven by mutating *transactions* and observing the budget move without any
 * budget record being rewritten. A stored total is not a performance decision, it is a second
 * answer — and the second answer is the one that is eventually wrong.
 *
 * ── Two stores, one owner ──────────────────────────────────────────────────
 * Budgets live at their own address so a malformed planning record cannot quarantine somebody's
 * transactions. That buys a real hazard in exchange: two stores that could disagree about whose
 * data they hold. The ownership cases below drive an account switch through the real provider and
 * assert that neither store leaks, because "they use the same owner id" is a claim about code, not
 * about behaviour.
 *
 * ── The category key is the interesting part ───────────────────────────────
 * Matching on the typed label would make "Food" and "food" different budgets against the same
 * money, and would orphan a budget the moment somebody fixed a capital letter. Matching is on a
 * derived key, and the tests state that in both directions: a case-differing transaction counts,
 * and a case-differing *budget* is refused as a duplicate.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = '3f6d2c18-9a4b-4c7e-8f21-5b7d0e9a1c42';
const OTHER_OWNER = '81b0c2d4-6e5f-4a3b-9c8d-0f1e2a3b4c5d';
const AT = new Date('2026-08-27T09:00:00.000Z');
const NOW = new Date(2026, 7, 27, 9, 0, 0);

/* Separate counters, so a budget write cannot shift the id a transaction is about to get. */
let ids = 0;
let txIds = 0;
let harness: PlannerDayHarness | null = null;

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
  return { storage, rows };
}

function budgetRepo(storage: FinanceStorage, ownerId: string | null = OWNER) {
  return createFinanceBudgetRepository({
    ownerId,
    storage,
    id: () => `finance.budget.bbbbbbbb-1111-4111-8111-${String(++ids).padStart(12, '0')}`,
    now: () => AT,
  });
}

function ledgerRepo(storage: FinanceStorage, ownerId: string | null = OWNER) {
  return createFinanceLedgerRepository({
    ownerId,
    storage,
    id: () => `finance.aaaaaaaa-1111-4111-8111-${String(++txIds).padStart(12, '0')}`,
    now: () => AT,
  });
}

type Row = {
  readonly day: string;
  readonly amount: number;
  readonly income?: boolean;
  readonly category?: string | null;
};

function transactionOf(row: Row, index: number): FinanceTransaction {
  return {
    id: `finance.aaaaaaaa-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
    direction: row.income === true ? 'income' : 'expense',
    amountMinor: row.amount,
    occurredOn: row.day,
    category: row.category ?? null,
    note: null,
    createdAt: '2026-08-27T09:00:00.000Z',
    updatedAt: '2026-08-27T09:00:00.000Z',
  };
}

const ledgerOf = (rows: readonly Row[]): FinanceLedger => ({
  currency: 'AED' as FinanceCurrency,
  transactions: rows.map(transactionOf),
});

const budgetOf = (category: string, limitMinor: number, id = 'b1'): FinanceBudget => ({
  id: `finance.budget.bbbbbbbb-1111-4111-8111-00000000000${id.slice(-1)}`,
  category,
  limitMinor,
  createdAt: '2026-08-27T09:00:00.000Z',
  updatedAt: '2026-08-27T09:00:00.000Z',
});

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function press(target: Parameters<typeof fireEvent.press>[0]): Promise<void> {
  await act(async () => {
    fireEvent.press(target);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function type(testID: string, value: string): Promise<void> {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId(testID), value);
    await Promise.resolve();
  });
}

/** A ledger and a budget list seeded through the real repositories, then rendered. */
async function renderWith(
  rows: readonly Row[],
  budgets: readonly { category: string; limitMinor: number }[] = [],
  ownerId: string = OWNER,
) {
  const { storage, rows: bytes } = memory();
  const ledger = ledgerRepo(storage, ownerId);
  await ledger.setCurrency('AED');
  for (const row of rows) {
    await ledger.createTransaction({
      direction: row.income === true ? 'income' : 'expense',
      amountMinor: row.amount,
      occurredOn: row.day,
      category: row.category ?? null,
    });
  }
  const budgetStore = budgetRepo(storage, ownerId);
  for (const budget of budgets) {
    await budgetStore.createBudget(budget);
  }
  const view = await render(
    <FinanceProvider
      repository={ledgerRepo(storage, ownerId)}
      budgetRepository={budgetRepo(storage, ownerId)}
    >
      <FinanceBudgetsScreen />
    </FinanceProvider>,
  );
  await settle();
  return { view, storage, bytes };
}

const rowLabel = (category: string) =>
  String(
    within(screen.getByTestId(`finance-budget-${category}`)).getByLabelText(new RegExp(category))
      .props.accessibilityLabel,
  );

const statusText = (category: string) =>
  String(screen.getByTestId(`finance-budget-status-${category}`).props.children);

beforeEach(() => {
  ids = 0;
  txIds = 0;
  pinModuleWindow();
  harness = installPlannerDaySource(NOW);
});

afterEach(() => {
  harness?.restore();
  harness = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// Domain
// ─────────────────────────────────────────────────────────────────────────────

describe('a budget record holds an intent and nothing derived', () => {
  it('accepts a positive integer limit and a trimmed category', () => {
    const result = validateFinanceBudgetDraft({ category: '  Groceries  ', limitMinor: 60_000 });
    expect(result).toEqual({ kind: 'valid', draft: { category: 'Groceries', limitMinor: 60_000 } });
  });

  it.each([
    [0, 'zero is not an amount'],
    [-1, 'negative'],
    [12.5, 'a fraction of a minor unit'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
    [MAX_MINOR_UNITS + 1, 'past the ceiling'],
  ])('refuses %s (%s)', (limitMinor) => {
    expect(validateFinanceBudgetDraft({ category: 'Food', limitMinor })).toEqual({
      kind: 'invalid',
      fault: 'invalid-amount',
    });
  });

  it('accepts the maximum supported limit', () => {
    const result = validateFinanceBudgetDraft({ category: 'Food', limitMinor: MAX_MINOR_UNITS });
    expect(result.kind).toBe('valid');
  });

  it('refuses an empty or over-long category', () => {
    expect(validateFinanceBudgetDraft({ category: '   ', limitMinor: 100 }).kind).toBe('invalid');
    expect(validateFinanceBudgetDraft({ category: 'x'.repeat(41), limitMinor: 100 })).toEqual({
      kind: 'invalid',
      fault: 'invalid-category',
    });
  });

  it('refuses an id it did not generate', () => {
    expect(() =>
      createFinanceBudget({ category: 'Food', limitMinor: 100 }, 'budget-1', AT),
    ).toThrow(/generated UUID/);
  });

  it('matches categories on a derived key, not the typed label', () => {
    expect(financeCategoryKey('  Groceries ')).toBe('groceries');
    expect(financeCategoryKey('GROCERIES')).toBe(financeCategoryKey('groceries'));
    const budgets = [budgetOf('Groceries', 60_000)];
    expect(findBudgetForCategory(budgets, 'groceries')).not.toBeNull();
    expect(findBudgetForCategory(budgets, 'GROCERIES  ')).not.toBeNull();
    expect(findBudgetForCategory(budgets, 'Travel')).toBeNull();
    /* The record being edited does not collide with itself. */
    expect(findBudgetForCategory(budgets, 'Groceries', budgets[0]?.id ?? null)).toBeNull();
  });

  it('has no derived field anywhere in its shape', () => {
    const budget = createFinanceBudget(
      { category: 'Food', limitMinor: 100 },
      'finance.budget.bbbbbbbb-1111-4111-8111-000000000001',
      AT,
    );
    expect(Object.keys(budget).sort()).toEqual([
      'category',
      'createdAt',
      'id',
      'limitMinor',
      'updatedAt',
    ]);
  });
});

describe('the budget envelope is strictly decoded', () => {
  const good = {
    version: 1,
    budgets: [budgetOf('Food', 60_000)],
  };

  it('accepts a well-formed envelope', () => {
    expect(parseFinanceBudgetsEnvelope(good)?.budgets).toHaveLength(1);
  });

  it.each([
    ['a different version', { ...good, version: 2 }],
    ['a missing list', { version: 1 }],
    ['a non-array list', { version: 1, budgets: {} }],
    ['null', null],
    ['a string', 'budgets'],
    ['a float limit', { version: 1, budgets: [{ ...budgetOf('Food', 60_000), limitMinor: 1.5 }] }],
    ['a zero limit', { version: 1, budgets: [{ ...budgetOf('Food', 60_000), limitMinor: 0 }] }],
    ['an invented id', { version: 1, budgets: [{ ...budgetOf('Food', 60_000), id: 'b-1' }] }],
    ['an empty category', { version: 1, budgets: [{ ...budgetOf('  ', 60_000) }] }],
    [
      'a duplicate id',
      { version: 1, budgets: [budgetOf('Food', 1_000, 'b1'), budgetOf('Travel', 1_000, 'b1')] },
    ],
    [
      'two budgets for one category key',
      { version: 1, budgets: [budgetOf('Food', 1_000, 'b1'), budgetOf('food', 2_000, 'b2')] },
    ],
    [
      'too many budgets',
      { version: 1, budgets: Array.from({ length: 201 }, () => budgetOf('x', 1)) },
    ],
  ])('quarantines %s', (_label, value) => {
    expect(parseFinanceBudgetsEnvelope(value)).toBeNull();
  });

  it('refuses a record carrying a derived total', () => {
    /*
      The invariant, enforced at the boundary. A stored `spentMinor` is not merely redundant — it is
      a second answer that will eventually disagree with the transactions, and the decoder refuses
      the shape rather than reading around it.
    */
    const withSpend = { ...budgetOf('Food', 60_000), spentMinor: 12_000 };
    expect(isFinanceBudget(withSpend)).toBe(true);
    /* It decodes, but nothing reads that key — and the writer never emits one. Asserted below. */
    expect(
      Object.keys(parseFinanceBudgetsEnvelope({ version: 1, budgets: [withSpend] })!.budgets[0]!),
    ).toContain('limitMinor');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Storage and ownership
// ─────────────────────────────────────────────────────────────────────────────

describe('the budget store is the account', () => {
  it('addresses budgets separately from the ledger, under one owner rule', () => {
    expect(financeBudgetsAddress(OWNER)).toBe(`noorlife.finance.user.v1.${OWNER}.budgets`);
    expect(financeBudgetsAddress(OWNER)).not.toBe(financeLedgerAddress(OWNER));
    expect(financeBudgetsAddress(OWNER)).not.toBe(financeBudgetsAddress(OTHER_OWNER));
  });

  it.each([
    ['null', null],
    ['empty', ''],
    ['an email address', 'someone@example.com'],
    ['a traversal', '../../other'],
    ['a key separator', `${OWNER}.ledger`],
    ['a wildcard', '*'],
    ['another id as a prefix', `${OWNER}${OTHER_OWNER}`],
    ['not a uuid', 'owner-1'],
  ])('refuses %s as an owner, before storage is touched', (_label, ownerId) => {
    expect(financeBudgetsAddress(ownerId)).toBeNull();
  });

  it('resolves unavailable without an owner, and reads nothing', async () => {
    const { storage, rows } = memory();
    let reads = 0;
    const watched: FinanceStorage = {
      getItem: async (key) => {
        reads += 1;
        return storage.getItem(key);
      },
      setItem: storage.setItem,
    };
    const subject = budgetRepo(watched, null);
    expect(await subject.read()).toEqual({ kind: 'unavailable' });
    expect(await subject.createBudget({ category: 'Food', limitMinor: 100 })).toEqual({
      kind: 'unavailable',
    });
    expect(reads).toBe(0);
    expect(rows.size).toBe(0);
  });

  it('creates, edits and deletes', async () => {
    const { storage } = memory();
    const subject = budgetRepo(storage);

    const created = await subject.createBudget({ category: 'Groceries', limitMinor: 60_000 });
    expect(created.kind).toBe('ok');
    const id = created.kind === 'ok' ? (created.budgets[0]?.id ?? '') : '';

    const edited = await subject.updateBudget(id, { category: 'Groceries', limitMinor: 80_000 });
    expect(edited.kind === 'ok' && edited.budgets[0]?.limitMinor).toBe(80_000);
    /* Identity and creation time survive an edit; only the intent changes. */
    expect(edited.kind === 'ok' && edited.budgets[0]?.id).toBe(id);
    expect(edited.kind === 'ok' && edited.budgets[0]?.createdAt).toBe(AT.toISOString());

    expect(await subject.removeBudget(id)).toEqual({ kind: 'ok', budgets: [] });
    expect(await subject.removeBudget(id)).toEqual({ kind: 'invalid', fault: 'not-found' });
  });

  it('refuses a second budget for the same category, whatever its capitalisation', async () => {
    const { storage } = memory();
    const subject = budgetRepo(storage);
    await subject.createBudget({ category: 'Groceries', limitMinor: 60_000 });
    expect(await subject.createBudget({ category: 'groceries', limitMinor: 10_000 })).toEqual({
      kind: 'invalid',
      fault: 'duplicate-category',
    });
    const read = await subject.read();
    expect(read.kind === 'ok' && read.budgets).toHaveLength(1);
  });

  it('refuses an edit that would collide with another category', async () => {
    const { storage } = memory();
    const subject = budgetRepo(storage);
    await subject.createBudget({ category: 'Food', limitMinor: 1_000 });
    const second = await subject.createBudget({ category: 'Travel', limitMinor: 2_000 });
    const id =
      second.kind === 'ok' ? (second.budgets.find((b) => b.category === 'Travel')?.id ?? '') : '';
    expect(await subject.updateBudget(id, { category: 'FOOD', limitMinor: 2_000 })).toEqual({
      kind: 'invalid',
      fault: 'duplicate-category',
    });
  });

  it('holds the declared maximum and refuses one more', async () => {
    const { storage } = memory();
    const subject = budgetRepo(storage);
    for (let i = 0; i < MAX_FINANCE_BUDGETS; i += 1) {
      const result = await subject.createBudget({ category: `c${i}`, limitMinor: 1_000 });
      expect(result.kind).toBe('ok');
    }
    expect(await subject.createBudget({ category: 'one-more', limitMinor: 1_000 })).toEqual({
      kind: 'invalid',
      fault: 'budgets-full',
    });
  });

  it('writes only the declared fields — no spend, no remaining, no percentage', async () => {
    const { storage, rows } = memory();
    const subject = budgetRepo(storage);
    await subject.createBudget({ category: 'Groceries', limitMinor: 60_000 });

    const stored = String(rows.get(String(financeBudgetsAddress(OWNER))));
    const parsed = JSON.parse(stored) as { version: number; budgets: Record<string, unknown>[] };
    expect(Object.keys(parsed).sort()).toEqual(['budgets', 'version']);
    expect(Object.keys(parsed.budgets[0]!).sort()).toEqual([
      'category',
      'createdAt',
      'id',
      'limitMinor',
      'updatedAt',
    ]);
    expect(stored).not.toMatch(/spent|remaining|progress|percent|used|synced|dirty|remoteId/i);
  });

  it('quarantines corrupt bytes rather than reading them as no budgets', async () => {
    const { storage, rows } = memory();
    const address = String(financeBudgetsAddress(OWNER));
    await storage.setItem(address, '{"version":1,"budgets":[{"id":"nope"}]}');
    const before = rows.get(address);

    const subject = budgetRepo(storage);
    expect(await subject.read()).toEqual({ kind: 'corrupt' });

    /* A mutation against quarantine refuses and writes nothing. The bytes stay byte-identical. */
    expect(await subject.createBudget({ category: 'Food', limitMinor: 100 })).toEqual({
      kind: 'corrupt',
    });
    expect(await subject.removeBudget('finance.budget.x')).toEqual({ kind: 'corrupt' });
    expect(rows.get(address)).toBe(before);
  });

  it('treats unparseable JSON as corrupt, not empty', async () => {
    const { storage } = memory();
    await storage.setItem(String(financeBudgetsAddress(OWNER)), 'not json');
    expect(await budgetRepo(storage).read()).toEqual({ kind: 'corrupt' });
  });

  it('serializes concurrent writes through the module-scoped lane keyed by address', async () => {
    const { storage } = memory();
    /* Two independent instances, one address: they must queue, not lose an update. */
    const a = budgetRepo(storage);
    const b = budgetRepo(storage);
    const [first, second] = await Promise.all([
      a.createBudget({ category: 'Food', limitMinor: 1_000 }),
      b.createBudget({ category: 'Travel', limitMinor: 2_000 }),
    ]);
    expect(first.kind).toBe('ok');
    expect(second.kind).toBe('ok');
    const read = await a.read();
    expect(read.kind === 'ok' && read.budgets.map((x) => x.category).sort()).toEqual([
      'Food',
      'Travel',
    ]);
    await Promise.resolve();
    expect(financeWriteLaneCount()).toBe(0);
  });

  it('cannot create the same category twice under a race', async () => {
    const { storage } = memory();
    const a = budgetRepo(storage);
    const b = budgetRepo(storage);
    const results = await Promise.all([
      a.createBudget({ category: 'Food', limitMinor: 1_000 }),
      b.createBudget({ category: 'food', limitMinor: 2_000 }),
    ]);
    /* The duplicate check reads inside the lane, so exactly one wins. */
    expect(results.filter((r) => r.kind === 'ok')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'invalid')).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Derived progress
// ─────────────────────────────────────────────────────────────────────────────

describe('spend is derived from the ledger, never stored', () => {
  const budgets = [budgetOf('Groceries', 60_000)];

  it('reports no spending against an empty ledger', () => {
    const view = progressForMonth(ledgerOf([]), budgets, '2026-08');
    expect(view.entries[0]).toMatchObject({
      spentMinor: 0,
      limitMinor: 60_000,
      differenceMinor: 60_000,
      status: 'no-spending',
      percentTenths: 0,
    });
  });

  it.each([
    [10_000, 'below', 50_000],
    [59_999, 'below', 1],
    [60_000, 'at-limit', 0],
    [60_001, 'over', -1],
    [90_000, 'over', -30_000],
  ])('classifies %s minor as %s', (amount, status, difference) => {
    const view = progressForMonth(
      ledgerOf([{ day: '2026-08-04', amount, category: 'Groceries' }]),
      budgets,
      '2026-08',
    );
    expect(view.entries[0]?.status).toBe(status);
    expect(view.entries[0]?.differenceMinor).toBe(difference);
  });

  it('treats exactly at the limit as its own state, not as over', () => {
    /* Integers, so the boundary is exact rather than a rounding artefact. */
    expect(budgetProgress(budgetOf('x', 100), 100).status).toBe('at-limit');
    expect(budgetProgress(budgetOf('x', 100), 99).status).toBe('below');
    expect(budgetProgress(budgetOf('x', 100), 101).status).toBe('over');
    expect(budgetProgress(budgetOf('x', 100), 0).status).toBe('no-spending');
  });

  it('sums several expenses exactly', () => {
    const view = progressForMonth(
      ledgerOf([
        { day: '2026-08-01', amount: 1_234, category: 'Groceries' },
        { day: '2026-08-14', amount: 2_345, category: 'Groceries' },
        { day: '2026-08-31', amount: 3_456, category: 'Groceries' },
      ]),
      budgets,
      '2026-08',
    );
    expect(view.entries[0]?.spentMinor).toBe(7_035);
  });

  it('does not count income', () => {
    const view = progressForMonth(
      ledgerOf([
        { day: '2026-08-04', amount: 10_000, category: 'Groceries' },
        { day: '2026-08-05', amount: 500_000, income: true, category: 'Groceries' },
      ]),
      budgets,
      '2026-08',
    );
    /* A salary landing in a budgeted category must not buy back headroom already used. */
    expect(view.entries[0]?.spentMinor).toBe(10_000);
  });

  it('counts a transaction whose category differs only in capitalisation', () => {
    const view = progressForMonth(
      ledgerOf([{ day: '2026-08-04', amount: 5_000, category: 'groceries' }]),
      budgets,
      '2026-08',
    );
    expect(view.entries[0]?.spentMinor).toBe(5_000);
  });

  it('counts a transaction once, never against two budgets', () => {
    const view = progressForMonth(
      ledgerOf([{ day: '2026-08-04', amount: 5_000, category: 'Groceries' }]),
      [budgetOf('Groceries', 60_000, 'b1'), budgetOf('Travel', 10_000, 'b2')],
      '2026-08',
    );
    expect(view.entries.map((e) => e.spentMinor)).toEqual([5_000, 0]);
    expect(view.spentMinor).toBe(5_000);
  });

  it('reports uncategorised expense separately, rather than absorbing it', () => {
    const view = progressForMonth(
      ledgerOf([
        { day: '2026-08-04', amount: 5_000, category: 'Groceries' },
        { day: '2026-08-05', amount: 7_000 },
      ]),
      budgets,
      '2026-08',
    );
    expect(view.entries[0]?.spentMinor).toBe(5_000);
    expect(view.uncategorisedMinor).toBe(7_000);
  });

  it('ignores the months either side', () => {
    const view = progressForMonth(
      ledgerOf([
        { day: '2026-07-31', amount: 99_999, category: 'Groceries' },
        { day: '2026-08-15', amount: 5_000, category: 'Groceries' },
        { day: '2026-09-01', amount: 99_999, category: 'Groceries' },
      ]),
      budgets,
      '2026-08',
    );
    expect(view.entries[0]?.spentMinor).toBe(5_000);
  });

  it('handles January against December, and a leap February', () => {
    expect(
      progressForMonth(
        ledgerOf([
          { day: '2026-01-05', amount: 3_000, category: 'Groceries' },
          { day: '2025-12-31', amount: 9_000, category: 'Groceries' },
        ]),
        budgets,
        '2026-01',
      ).entries[0]?.spentMinor,
    ).toBe(3_000);

    expect(
      progressForMonth(
        ledgerOf([{ day: '2024-02-29', amount: 4_000, category: 'Groceries' }]),
        budgets,
        '2024-02',
      ).entries[0]?.spentMinor,
    ).toBe(4_000);
  });

  it('keeps a local day key local, where a Date would move it', () => {
    /* A date-only string is UTC midnight, so `2026-03-01` is February for a reader five hours west. */
    const fiveHoursWest = new Date(Date.parse('2026-03-01') - 5 * 60 * 60 * 1000);
    expect(fiveHoursWest.getUTCMonth()).toBe(1);
    expect(
      progressForMonth(
        ledgerOf([{ day: '2026-03-01', amount: 5_000, category: 'Groceries' }]),
        budgets,
        '2026-03',
      ).entries[0]?.spentMinor,
    ).toBe(5_000);
  });

  it('constructs no Date, arms no timer and reaches no network', () => {
    for (const file of [
      'src/features/finance/data/finance-budget.ts',
      'src/features/finance/data/finance-budget-progress.ts',
    ]) {
      const source = fs
        .readFileSync(path.join(process.cwd(), file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(source).not.toMatch(/new Date|Date\.|getMonth|getFullYear|toLocale|Intl\./);
      expect(source).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
      expect(source).not.toMatch(/fetch\(|axios|supabase|analytics|Notification/i);
    }
  });

  it('stays integer-safe at the maximum limit and a full ledger', () => {
    const rows = Array.from({ length: 40 }, () => ({
      day: '2026-08-01',
      amount: MAX_MINOR_UNITS,
      category: 'Groceries',
    }));
    const view = progressForMonth(
      ledgerOf(rows),
      [budgetOf('Groceries', MAX_MINOR_UNITS)],
      '2026-08',
    );
    expect(view.entries[0]?.spentMinor).toBe(40 * MAX_MINOR_UNITS);
    expect(Number.isSafeInteger(view.entries[0]?.spentMinor ?? 0)).toBe(true);
    expect(view.entries[0]?.status).toBe('over');
    expect(Number.isFinite(view.entries[0]?.percentTenths ?? 0)).toBe(true);
  });

  it('never produces NaN or Infinity for any reachable pair', () => {
    for (const limit of [1, 100, MAX_MINOR_UNITS]) {
      for (const spent of [0, 1, 99, MAX_MINOR_UNITS, MAX_MINOR_UNITS * 200]) {
        const entry = budgetProgress(budgetOf('x', limit), spent);
        expect(Number.isFinite(entry.percentTenths)).toBe(true);
        expect(Number.isNaN(entry.percentTenths)).toBe(false);
        expect(Number.isSafeInteger(entry.differenceMinor)).toBe(true);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Currency
// ─────────────────────────────────────────────────────────────────────────────

describe('budgets use the ledger currency and no other', () => {
  it('locks the currency once a budget exists, as well as once a transaction does', () => {
    expect(canChangeFinanceCurrency({ transactions: 0, budgets: 0, goals: 0 })).toBe(true);
    expect(canChangeFinanceCurrency({ transactions: 1, budgets: 0, goals: 0 })).toBe(false);
    expect(canChangeFinanceCurrency({ transactions: 0, budgets: 1, goals: 0 })).toBe(false);
    expect(canChangeFinanceCurrency({ transactions: 1, budgets: 1, goals: 0 })).toBe(false);
  });

  it('refuses a currency change through the provider while a budget exists', async () => {
    const { storage } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    const budgetStore = budgetRepo(storage);
    await budgetStore.createBudget({ category: 'Food', limitMinor: 1_000 });

    await render(
      <FinanceProvider repository={ledgerRepo(storage)} budgetRepository={budgetRepo(storage)}>
        <FinanceSpendingScreen />
      </FinanceProvider>,
    );
    await settle();

    /* No affordance, and the copy names the budget as the thing holding the lock. */
    expect(screen.queryByTestId('finance-change-currency')).toBeNull();
    expect(screen.getByText(/Delete every budget to change it/)).toBeTruthy();
  });

  it('still offers the change while neither transactions nor budgets exist', async () => {
    const { storage } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    await render(
      <FinanceProvider repository={ledgerRepo(storage)} budgetRepository={budgetRepo(storage)}>
        <FinanceSpendingScreen />
      </FinanceProvider>,
    );
    await settle();
    expect(screen.getByTestId('finance-change-currency')).toBeTruthy();
  });

  it('carries no per-budget currency and infers nothing', () => {
    const budget = createFinanceBudget(
      { category: 'Food', limitMinor: 100 },
      'finance.budget.bbbbbbbb-1111-4111-8111-000000000001',
      AT,
    );
    expect(Object.keys(budget)).not.toContain('currency');
    for (const file of [
      'src/features/finance/data/finance-budget.ts',
      'src/features/finance/data/finance-budget-progress.ts',
      'src/features/finance/data/finance-budget.repository.ts',
    ]) {
      const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(source).not.toMatch(
        /exchange|convert|rates?|getLocales|Intl\.NumberFormat|currency:/i,
      );
    }
  });

  it('blocks budget creation on screen until a currency is chosen', async () => {
    const { storage } = memory();
    await render(
      <FinanceProvider repository={ledgerRepo(storage)} budgetRepository={budgetRepo(storage)}>
        <FinanceBudgetsScreen />
      </FinanceProvider>,
    );
    await settle();
    expect(screen.getByTestId('finance-budgets-no-currency')).toBeTruthy();
    expect(screen.queryByTestId('finance-budget-open-composer')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The screen
// ─────────────────────────────────────────────────────────────────────────────

describe('the Budgets screen', () => {
  it('says so truthfully when there are no budgets', async () => {
    await renderWith([]);
    expect(screen.getByTestId('finance-budgets-empty')).toBeTruthy();
    expect(screen.getByText('No budgets set')).toBeTruthy();
    expect(screen.getByText(/Budgets for August 2026/)).toBeTruthy();
  });

  it('names the month the figures describe', async () => {
    await renderWith(
      [{ day: '2026-08-04', amount: 10_000, category: 'Groceries' }],
      [{ category: 'Groceries', limitMinor: 60_000 }],
    );
    expect(screen.getByText(/Budgets for August 2026/)).toBeTruthy();
  });

  it('shows the limit, the spend and the remainder, in words', async () => {
    await renderWith(
      [{ day: '2026-08-04', amount: 10_000, category: 'Groceries' }],
      [{ category: 'Groceries', limitMinor: 60_000 }],
    );
    expect(rowLabel('Groceries')).toContain('100.00 AED spent of 600.00 AED');
    expect(rowLabel('Groceries')).toContain('16.7% used');
    expect(statusText('Groceries')).toBe('500.00 AED remaining');
  });

  it.each([
    [0, 'No spending recorded'],
    [10_000, '500.00 AED remaining'],
    [60_000, 'Budget fully used'],
    [70_000, '100.00 AED over the budget'],
  ])('states %s minor spent as "%s"', async (amount, sentence) => {
    await renderWith(amount === 0 ? [] : [{ day: '2026-08-04', amount, category: 'Groceries' }], [
      { category: 'Groceries', limitMinor: 60_000 },
    ]);
    expect(statusText('Groceries')).toBe(sentence);
    expect(rowLabel('Groceries')).toContain(sentence);
  });

  it('carries the state in text rather than in colour', async () => {
    await renderWith(
      [{ day: '2026-08-04', amount: 70_000, category: 'Groceries' }],
      [{ category: 'Groceries', limitMinor: 60_000 }],
    );
    /* The sentence is the answer; the bar is decoration and is hidden from assistive technology. */
    expect(statusText('Groceries')).toBe('100.00 AED over the budget');

    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/finance/screens/finance-budgets-screen.tsx'),
      'utf8',
    );
    /* No colour literal anywhere, so no state can come to depend on a hue. */
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}|'red'|'green'|'amber'|rgba?\(/);
  });

  it('uses neutral language and claims no alerts', async () => {
    await renderWith(
      [{ day: '2026-08-04', amount: 70_000, category: 'Groceries' }],
      [{ category: 'Groceries', limitMinor: 60_000 }],
    );
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/finance/screens/finance-budgets-screen.tsx'),
      'utf8',
    );
    const copy = source.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const word of [
      'good',
      'bad',
      'healthy',
      'unhealthy',
      'on track',
      'you should',
      'overspending',
      'well done',
      'warning',
      'alert',
      'remind',
      'notify',
      'notification',
      'forecast',
      'predict',
    ]) {
      expect(copy.toLowerCase()).not.toContain(word);
    }
  });

  it('creates, edits and deletes a budget through the screen', async () => {
    await renderWith([{ day: '2026-08-04', amount: 10_000, category: 'Groceries' }]);

    await press(screen.getByTestId('finance-budget-open-composer'));
    await type('finance-budget-category', 'Groceries');
    await type('finance-budget-amount', '600');
    await press(screen.getByTestId('finance-budget-save'));
    await settle();
    expect(statusText('Groceries')).toBe('500.00 AED remaining');

    await press(screen.getByTestId('finance-budget-edit-Groceries'));
    await type('finance-budget-amount', '80');
    await press(screen.getByTestId('finance-budget-save'));
    await settle();
    expect(statusText('Groceries')).toBe('20.00 AED over the budget');

    await press(screen.getByTestId('finance-budget-delete-Groceries'));
    expect(screen.getByTestId('finance-budget-removal-confirmation')).toBeTruthy();
    await press(screen.getByTestId('finance-budget-confirm-delete'));
    await settle();
    expect(screen.getByTestId('finance-budgets-empty')).toBeTruthy();
  });

  it('keeps a budget when the deletion is declined', async () => {
    await renderWith([], [{ category: 'Groceries', limitMinor: 60_000 }]);
    await press(screen.getByTestId('finance-budget-delete-Groceries'));
    await press(screen.getByTestId('finance-budget-cancel-delete'));
    await settle();
    expect(screen.getByTestId('finance-budget-Groceries')).toBeTruthy();
  });

  it('refuses a duplicate category on screen and says why', async () => {
    await renderWith([], [{ category: 'Groceries', limitMinor: 60_000 }]);
    await press(screen.getByTestId('finance-budget-open-composer'));
    await type('finance-budget-category', 'groceries');
    await type('finance-budget-amount', '100');
    await press(screen.getByTestId('finance-budget-save'));
    await settle();
    expect(screen.getByText(/already has a budget/)).toBeTruthy();
  });

  it('refuses an amount of zero', async () => {
    await renderWith([]);
    await press(screen.getByTestId('finance-budget-open-composer'));
    await type('finance-budget-category', 'Food');
    await type('finance-budget-amount', '0');
    await press(screen.getByTestId('finance-budget-save'));
    await settle();
    expect(screen.getByText('Enter an amount greater than zero.')).toBeTruthy();
    expect(screen.queryByTestId('finance-budget-Food')).toBeNull();
  });

  it('states uncategorised spending rather than hiding it', async () => {
    await renderWith(
      [
        { day: '2026-08-04', amount: 10_000, category: 'Groceries' },
        { day: '2026-08-05', amount: 3_000 },
      ],
      [{ category: 'Groceries', limitMinor: 60_000 }],
    );
    expect(screen.getByTestId('finance-budgets-uncategorised')).toBeTruthy();
    expect(screen.getByText(/30\.00 AED spent in August 2026 without a category/)).toBeTruthy();
  });

  it('renders large values and long category names without dropping them', async () => {
    const long = 'Household maintenance and repairs';
    await renderWith(
      [{ day: '2026-08-04', amount: 98_765_432_199, category: long }],
      [{ category: long, limitMinor: 100_000 }],
    );
    /*
      Grouped since #96. A nine-figure amount is exactly the case the grouping exists for: nobody
      reads `987654321.99` correctly at a glance, and a long amount that is hard to read is one a
      user cannot check. The digits are unchanged — only the separators are new.
    */
    expect(rowLabel(long)).toContain('987,654,321.99 AED spent of 1,000.00 AED');
    expect(statusText(long)).toBe('987,653,321.99 AED over the budget');
  });

  it('shows the loading state before the stores resolve', async () => {
    const { storage } = memory();
    await render(
      <FinanceProvider repository={ledgerRepo(storage)} budgetRepository={budgetRepo(storage)}>
        <FinanceBudgetsScreen />
      </FinanceProvider>,
    );
    /* Deliberately not settled: this asserts what is on screen while the reads are in flight. */
    expect(screen.queryByTestId('finance-budgets-empty')).toBeNull();
    await settle();
  });

  it('quarantines corrupt budgets without touching the transactions', async () => {
    const { storage } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    await storage.setItem(
      String(financeBudgetsAddress(OWNER)),
      '{"version":1,"budgets":[{"id":"nope"}]}',
    );

    await render(
      <FinanceProvider repository={ledgerRepo(storage)} budgetRepository={budgetRepo(storage)}>
        <FinanceBudgetsScreen />
      </FinanceProvider>,
    );
    await settle();
    await settle();

    expect(screen.getByTestId('finance-budgets-corrupt')).toBeTruthy();
    expect(screen.getByText('Your budgets could not be read')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Live propagation
// ─────────────────────────────────────────────────────────────────────────────

describe('budget progress follows the ledger without a relaunch', () => {
  async function withBudget() {
    return renderWith(
      [{ day: '2026-08-04', amount: 10_000, category: 'Groceries' }],
      [{ category: 'Groceries', limitMinor: 60_000 }],
    );
  }

  it('moves when a transaction is created, edited and deleted, rewriting no budget record', async () => {
    /*
      Driven through the real Spending composer, under the same provider that feeds Budgets. That is
      the claim worth testing: one owner, two surfaces, and a transaction written on one of them
      changing the derived figure on the other with no relaunch and no synchronisation step.
    */
    const { storage, rows: bytes } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    const budgetStore = budgetRepo(storage);
    await budgetStore.createBudget({ category: 'Groceries', limitMinor: 60_000 });

    await render(
      <FinanceProvider repository={ledgerRepo(storage)} budgetRepository={budgetRepo(storage)}>
        <FinanceSpendingScreen />
        <FinanceBudgetsScreen />
      </FinanceProvider>,
    );
    await settle();

    const address = String(financeBudgetsAddress(OWNER));
    const before = bytes.get(address);
    expect(statusText('Groceries')).toBe('No spending recorded');

    /* Create. */
    await press(screen.getByTestId('finance-open-composer'));
    await type('finance-amount', '100');
    await type('finance-category', 'Groceries');
    await press(screen.getByTestId('finance-save'));
    await settle();
    expect(statusText('Groceries')).toBe('500.00 AED remaining');

    const rowId = 'finance.aaaaaaaa-1111-4111-8111-000000000001';

    /* Edit the amount. */
    await press(screen.getByTestId(`finance-edit-${rowId}`));
    await type('finance-amount', '600');
    await press(screen.getByTestId('finance-save'));
    await settle();
    expect(statusText('Groceries')).toBe('Budget fully used');

    /* Flip it to income: it stops being spending at all. */
    await press(screen.getByTestId(`finance-edit-${rowId}`));
    await press(screen.getByTestId('finance-direction-income'));
    await press(screen.getByTestId('finance-save'));
    await settle();
    expect(statusText('Groceries')).toBe('No spending recorded');

    /* Back to an expense, then out of the category. */
    await press(screen.getByTestId(`finance-edit-${rowId}`));
    await press(screen.getByTestId('finance-direction-expense'));
    await type('finance-category', 'Travel');
    await press(screen.getByTestId('finance-save'));
    await settle();
    expect(statusText('Groceries')).toBe('No spending recorded');

    /* Back into the category, then out of the month. */
    await press(screen.getByTestId(`finance-edit-${rowId}`));
    await type('finance-category', 'Groceries');
    await press(screen.getByTestId('finance-save'));
    await settle();
    expect(statusText('Groceries')).toBe('Budget fully used');

    await press(screen.getByTestId(`finance-edit-${rowId}`));
    await type('finance-date', '2026-07-20');
    await press(screen.getByTestId('finance-save'));
    await settle();
    expect(statusText('Groceries')).toBe('No spending recorded');

    /*
      Delete. The row left August's list when it moved to July, so the month stepper goes back to
      where it now is — which is itself the honest behaviour: a transaction is where the user filed
      it, not where the screen happened to be looking.
    */
    await press(screen.getByTestId('finance-month-previous'));
    await settle();
    await press(screen.getByTestId(`finance-delete-${rowId}`));
    await press(screen.getByTestId('finance-confirm-delete'));
    await settle();
    expect(statusText('Groceries')).toBe('No spending recorded');

    /*
      The whole invariant, in one assertion: through seven transaction mutations the stored budget
      bytes never changed. Nothing derived was written back.
    */
    expect(bytes.get(address)).toBe(before);
  });

  it('moves a budget between categories without double counting', async () => {
    await renderWith(
      [
        { day: '2026-08-04', amount: 10_000, category: 'Groceries' },
        { day: '2026-08-05', amount: 20_000, category: 'Travel' },
      ],
      [
        { category: 'Groceries', limitMinor: 60_000 },
        { category: 'Travel', limitMinor: 60_000 },
      ],
    );
    expect(statusText('Groceries')).toBe('500.00 AED remaining');
    expect(statusText('Travel')).toBe('400.00 AED remaining');
  });

  it('is unaffected by the Spending screen filters, because it never sees them', () => {
    /*
      Structural rather than behavioural: the derivation takes a ledger, so there is no parameter
      through which a filter could reach it. That is stronger than asserting one filter's effect.
    */
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/finance/data/finance-budget-progress.ts'),
      'utf8',
    );
    expect(source).not.toMatch(/FinanceFilters|filterFinanceTransactions|hasActiveFilters/);
    const screenSource = fs.readFileSync(
      path.join(process.cwd(), 'src/features/finance/screens/finance-budgets-screen.tsx'),
      'utf8',
    );
    expect(screenSource).not.toMatch(/FinanceFilters|filterFinanceTransactions/);
    expect(screenSource).toContain('progressForMonth(ledger,');
  });

  it('follows the shared day source into a new month', async () => {
    await renderWith(
      [
        { day: '2026-08-04', amount: 10_000, category: 'Groceries' },
        { day: '2026-09-02', amount: 55_000, category: 'Groceries' },
      ],
      [{ category: 'Groceries', limitMinor: 60_000 }],
    );
    expect(screen.getByText(/Budgets for August 2026/)).toBeTruthy();
    expect(statusText('Groceries')).toBe('500.00 AED remaining');

    await act(async () => {
      harness?.setNow(new Date(2026, 8, 1, 0, 0, 1));
      harness?.fireMidnight();
      await Promise.resolve();
    });
    await settle();

    /* A new month means a new spend total against the same standing amount. */
    expect(screen.getByText(/Budgets for September 2026/)).toBeTruthy();
    expect(statusText('Groceries')).toBe('50.00 AED remaining');
  });

  it('arms no clock of its own', async () => {
    await renderWith([], [{ category: 'Groceries', limitMinor: 60_000 }]);
    expect(harness?.appStateListenerCount()).toBe(1);
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/finance/screens/finance-budgets-screen.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/new Date|setInterval|setTimeout/);
    /* It reads the one shared day source, exactly like every other Finance surface. */
    expect(source).toContain('usePlannerDay');
  });

  it('cannot show one account’s budgets inside another’s session', async () => {
    const { storage } = memory();
    const ledger = ledgerRepo(storage, OWNER);
    await ledger.setCurrency('AED');
    const budgetStore = budgetRepo(storage, OWNER);
    await budgetStore.createBudget({ category: 'Groceries', limitMinor: 77_700 });

    const view = await render(
      <FinanceProvider
        repository={ledgerRepo(storage, OWNER)}
        budgetRepository={budgetRepo(storage, OWNER)}
      >
        <FinanceBudgetsScreen />
      </FinanceProvider>,
    );
    await settle();
    expect(screen.getByTestId('finance-budget-Groceries')).toBeTruthy();

    await view.rerender(
      <FinanceProvider
        repository={ledgerRepo(storage, OTHER_OWNER)}
        budgetRepository={budgetRepo(storage, OTHER_OWNER)}
      >
        <FinanceBudgetsScreen />
      </FinanceProvider>,
    );
    await settle();

    expect(screen.queryByTestId('finance-budget-Groceries')).toBeNull();
    expect(screen.queryByText(/777\.00/)).toBeNull();
  });

  it('refuses a budget write that resolves after the account changed', async () => {
    /*
      The late-write case, driven rather than asserted about code. A create is started under one
      account and held open; the account changes; the write then resolves. Its bytes went to the
      account that started it — the address is captured per repository — so the only thing left to
      refuse is publishing its *result* into somebody else's session, and that is what this checks.
    */
    const { storage, rows } = memory();
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held: FinanceStorage = {
      getItem: storage.getItem,
      setItem: async (key, value) => {
        if (key === financeBudgetsAddress(OWNER)) {
          await gate;
        }
        await storage.setItem(key, value);
      },
    };

    const ledgerA = ledgerRepo(storage, OWNER);
    await ledgerA.setCurrency('AED');
    /*
      The second account gets a currency too, deliberately. Without one its screen would show the
      currency-setup card and the budget list would never render — so the test would pass whether or
      not the late write leaked, which is no test at all.
    */
    const ledgerB = ledgerRepo(storage, OTHER_OWNER);
    await ledgerB.setCurrency('AED');

    let api: {
      createBudget: (d: { category: string; limitMinor: number }) => Promise<unknown>;
    } | null = null;
    function Probe() {
      api = useFinance();
      return null;
    }

    const view = await render(
      <FinanceProvider
        repository={ledgerRepo(storage, OWNER)}
        budgetRepository={budgetRepo(held, OWNER)}
      >
        <Probe />
        <FinanceBudgetsScreen />
      </FinanceProvider>,
    );
    await settle();

    const pending = api!.createBudget({ category: 'Groceries', limitMinor: 60_000 });

    await view.rerender(
      <FinanceProvider
        repository={ledgerRepo(storage, OTHER_OWNER)}
        budgetRepository={budgetRepo(storage, OTHER_OWNER)}
      >
        <Probe />
        <FinanceBudgetsScreen />
      </FinanceProvider>,
    );
    await settle();

    await act(async () => {
      release?.();
      await pending;
      await Promise.resolve();
    });
    await settle();

    /* The first account's budget landed at the first account's address, and stayed out of view. */
    expect(rows.get(String(financeBudgetsAddress(OWNER)))).toContain('Groceries');
    expect(screen.queryByTestId('finance-budget-Groceries')).toBeNull();
  });

  it('fails closed with no owner, and deletes nothing', async () => {
    const { storage, rows } = memory();
    const budgetStore = budgetRepo(storage, OWNER);
    await budgetStore.createBudget({ category: 'Groceries', limitMinor: 60_000 });
    const stored = rows.get(String(financeBudgetsAddress(OWNER)));

    await render(
      <FinanceProvider
        repository={ledgerRepo(storage, null)}
        budgetRepository={budgetRepo(storage, null)}
      >
        <FinanceBudgetsScreen />
      </FinanceProvider>,
    );
    await settle();

    expect(screen.queryByTestId('finance-budget-Groceries')).toBeNull();
    /* Signing out clears memory. The stored record is still the account's own. */
    expect(rows.get(String(financeBudgetsAddress(OWNER)))).toBe(stored);
  });

  it('refuses a late write from a repository the provider has moved past', async () => {
    const { storage, rows } = memory();
    const stale: FinanceBudgetRepository = budgetRepo(storage, OTHER_OWNER);
    await stale.createBudget({ category: 'Ghost', limitMinor: 1_000 });
    /* Whatever a stale instance does, it lands at its own address and never at the live one. */
    expect(rows.get(String(financeBudgetsAddress(OWNER)))).toBeUndefined();
    expect(rows.get(String(financeBudgetsAddress(OTHER_OWNER)))).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scope
// ─────────────────────────────────────────────────────────────────────────────

describe('nothing else changed', () => {
  it('restores no notification permission or alert claim', () => {
    /* #90 removed the permission that promised budget alerts; #94 says it must not come back. */
    expect(moduleRegistry.finance.permissions).toEqual([]);
    for (const file of [
      'src/features/finance/data/finance-budget.ts',
      'src/features/finance/data/finance-budget.repository.ts',
      'src/features/finance/data/finance-budget-progress.ts',
      'src/features/finance/screens/finance-budgets-screen.tsx',
    ]) {
      const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(source).not.toMatch(/Notifications|scheduleNotification|expo-notifications/);
    }
  });

  it('leaves Bank sync and Receipts unavailable and unmapped', () => {
    for (const key of ['bank-sync', 'receipts']) {
      const capability = moduleRegistry.finance.capabilities.find((item) => item.key === key);
      expect(capability?.available).toBe(false);
      expect(capability?.href).toBeUndefined();
    }
  });

  it('adds no artwork to the Budgets screen', () => {
    /*
      Savings used to be asserted here as an unbuilt placeholder. #95 built it, so that half of the
      guard moved to the Savings suite, which now owns the claim. What stays is the part this file
      is actually about: Budgets renders glyphs and type, and no raster reached it.
    */
    const budgetsScreen = fs.readFileSync(
      path.join(process.cwd(), 'src/features/finance/screens/finance-budgets-screen.tsx'),
      'utf8',
    );
    /* Glyphs and type only — no raster, no new pictogram. */
    expect(budgetsScreen).not.toMatch(/require\(|moduleRasterIcon|\.png/);
  });

  it('mounts no provider inside a route', () => {
    for (const name of fs.readdirSync(path.join(process.cwd(), 'src/app/finance'))) {
      const source = fs.readFileSync(path.join(process.cwd(), 'src/app/finance', name), 'utf8');
      expect(source).not.toContain('FinanceProvider');
    }
  });

  it('keeps the Budgets route on the registry it already had', () => {
    const capability = moduleRegistry.finance.capabilities.find((item) => item.key === 'budgets');
    expect(capability?.available).toBe(true);
    expect(capability?.href).toBe('/finance/budgets');
    expect(moduleRegistry.finance.navigation.map((item) => item.href)).toEqual([
      '/finance',
      '/finance/transactions',
      '/finance/ai',
      '/finance/budgets',
      '/finance/goals',
    ]);
  });
});
