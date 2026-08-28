import fs from 'node:fs';
import path from 'node:path';

import { act, render, screen, within } from '@testing-library/react-native';

import { pinModuleWindow } from '@/test-support/module-window';
import { installPlannerDaySource, type PlannerDayHarness } from '@/test-support/planner-day';

import { progressForMonth } from '../data/finance-budget-progress';
import { compareFinanceMonths } from '../data/finance-comparison';
import { canChangeFinanceCurrency } from '../data/finance-currency-lock';
import { goalsProgress } from '../data/finance-goal-progress';
import { createFinanceGoalRepository } from '../data/finance-goal.repository';
import type { FinanceBudget } from '../data/finance-budget';
import type { FinanceGoal } from '../data/finance-goal';
import {
  isFinanceTransaction,
  parseFinanceLedgerEnvelope,
  type FinanceLedger,
  type FinanceTransaction,
} from '../data/finance-ledger';
import {
  createFinanceLedgerRepository,
  financeGoalsAddress,
  financeLedgerAddress,
  type FinanceStorage,
} from '../data/finance-ledger.repository';
import {
  DELETED_SAVINGS_GOAL_LABEL,
  consumptionRecords,
  financeRecordKind,
  isConsumptionRecord,
  isSavingsTransfer,
  savingsTransferLabel,
  savingsTransfers,
} from '../data/finance-record-kind';
import {
  NO_FINANCE_FILTERS,
  filterFinanceTransactions,
  financeCategories,
  summariseFinance,
  totalFinance,
} from '../data/finance-selectors';
import { FinanceProvider, useFinance } from '../di/finance-provider';
import { FinanceSpendingScreen } from '../screens/finance-spending-screen';

/**
 * **Savings transfers are records, not consumption** — the cross-feature accounting audit.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this file is for ──────────────────────────────────────────────────
 * #95 made a savings contribution an ordinary ledger transaction so that "the ledger stays the single
 * record of money moved". That is right about storage and was silently wrong about meaning: every
 * consumption aggregate in Finance counted those transfers as spending or as income.
 *
 * On the ledger this suite uses — 300.00 of groceries, 900.00 of salary, a 500.00 contribution and a
 * 200.00 withdrawal — the module reported 800.00 spent, 1100.00 received, a +700% month against a
 * true +200%, a phantom uncategorised category movement of 500.00, and "500.00 spent this month
 * without a category" on the Budgets screen. Every one of those is a false statement about somebody's
 * money, and none of them is an error anybody would notice: they are plausible numbers.
 *
 * The tests below are written per *consumer*, because the defect was never in one place — it was one
 * missing idea repeated in six selectors. The idea now has a name, `isConsumptionRecord`, and the last
 * test in this file asserts that no consumer has quietly grown a second copy of it.
 *
 * ── The rule, stated once ──────────────────────────────────────────────────
 * Classification reads the record's own attribution and nothing else — never whether the goal still
 * exists. A transfer whose goal was deleted is still a transfer, because the money still moved into
 * savings and the user still recorded it that way. Reclassifying history to match a bookkeeping
 * change would be the same class of untruth in the other direction.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = '3f6d2c18-9a4b-4c7e-8f21-5b7d0e9a1c42';
const GOAL_A = 'finance.goal.cccccccc-1111-4111-8111-000000000001';
const GOAL_B = 'finance.goal.cccccccc-1111-4111-8111-000000000002';
const MISSING_GOAL = 'finance.goal.dddddddd-9999-4999-8999-999999999999';
const AT = new Date('2026-08-10T09:00:00.000Z');
const NOW = new Date(2026, 7, 10, 9, 0, 0);
const TODAY = '2026-08-10';
const LAST_MONTH = '2026-07-10';

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

const ledgerRepo = (storage: FinanceStorage, ownerId: string | null = OWNER) =>
  createFinanceLedgerRepository({
    ownerId,
    storage,
    id: () => `finance.aaaaaaaa-1111-4111-8111-${String(++txIds).padStart(12, '0')}`,
    now: () => AT,
  });

const goalRepo = (storage: FinanceStorage, ownerId: string | null = OWNER) =>
  createFinanceGoalRepository({
    ownerId,
    storage,
    id: () => `finance.goal.cccccccc-1111-4111-8111-${String(++ids).padStart(12, '0')}`,
    now: () => AT,
  });

type Row = {
  readonly amount: number;
  readonly income?: boolean;
  readonly category?: string | null;
  readonly goalId?: string | null;
  readonly day?: string;
  readonly note?: string | null;
};

const tx = (row: Row, index: number): FinanceTransaction => ({
  id: `finance.aaaaaaaa-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
  direction: row.income === true ? 'income' : 'expense',
  amountMinor: row.amount,
  occurredOn: row.day ?? TODAY,
  category: row.category ?? null,
  note: row.note ?? null,
  goalId: row.goalId ?? null,
  createdAt: '2026-08-10T09:00:00.000Z',
  updatedAt: '2026-08-10T09:00:00.000Z',
});

const ledgerOf = (rows: readonly Row[]): FinanceLedger => ({
  currency: 'AED',
  transactions: rows.map(tx),
});

const goalOf = (name: string, targetMinor: number, id: string = GOAL_A): FinanceGoal => ({
  id,
  name,
  targetMinor,
  targetOn: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
});

const budgetOf = (category: string, limitMinor: number): FinanceBudget => ({
  id: 'finance.budget.bbbbbbbb-1111-4111-8111-000000000001',
  category,
  limitMinor,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
});

/**
 * The audit ledger: one ordinary expense, one ordinary income, one contribution, one withdrawal,
 * plus a smaller expense last month so the comparison has a real baseline.
 */
const MIXED = ledgerOf([
  { amount: 30_000, category: 'Groceries' },
  { amount: 90_000, income: true, category: 'Salary' },
  { amount: 50_000, goalId: GOAL_A },
  { amount: 20_000, income: true, goalId: GOAL_A },
  { amount: 10_000, category: 'Groceries', day: LAST_MONTH },
]);

const monthRows = (ledger: FinanceLedger, month: string) =>
  filterFinanceTransactions(ledger, NO_FINANCE_FILTERS, { kind: 'month', month });

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

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
// The classification itself
// ─────────────────────────────────────────────────────────────────────────────

describe('every ledger record has exactly one kind', () => {
  it.each([
    ['spending', { amount: 100 }],
    ['income', { amount: 100, income: true }],
    ['savings-contribution', { amount: 100, goalId: GOAL_A }],
    ['savings-withdrawal', { amount: 100, income: true, goalId: GOAL_A }],
  ] as const)('classifies %s', (kind, row) => {
    expect(financeRecordKind(tx(row, 0))).toBe(kind);
  });

  it('treats an absent attribution exactly as a null one', () => {
    const legacy = { ...tx({ amount: 100 }, 0) };
    delete (legacy as { goalId?: unknown }).goalId;
    expect(isSavingsTransfer(legacy)).toBe(false);
    expect(isConsumptionRecord(legacy)).toBe(true);
    expect(financeRecordKind(legacy)).toBe('spending');
  });

  it('partitions a ledger with nothing lost and nothing counted twice', () => {
    const consumption = consumptionRecords(MIXED.transactions);
    const transfers = savingsTransfers(MIXED.transactions);
    expect(consumption).toHaveLength(3);
    expect(transfers).toHaveLength(2);
    expect(consumption.length + transfers.length).toBe(MIXED.transactions.length);
    expect(consumption.some((row) => transfers.includes(row))).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 1–4: each consumer, on the audit ledger
// ─────────────────────────────────────────────────────────────────────────────

describe('an ordinary expense counts everywhere it should', () => {
  const ordinary = ledgerOf([
    { amount: 30_000, category: 'Groceries' },
    { amount: 10_000, category: 'Groceries', day: LAST_MONTH },
  ]);

  it('counts in Spending, in the comparison and against a budget', () => {
    expect(totalFinance(monthRows(ordinary, '2026-08')).expenseMinor).toBe(30_000);
    expect(compareFinanceMonths(ordinary, '2026-08').spending.currentMinor).toBe(30_000);
    /* +200%: 30,000 against last month's 10,000. */
    expect(compareFinanceMonths(ordinary, '2026-08').spending.percentTenths).toBe(2_000);
    expect(
      progressForMonth(ordinary, [budgetOf('Groceries', 100_000)], '2026-08').entries[0]
        ?.spentMinor,
    ).toBe(30_000);
  });
});

describe('a goal contribution moves Savings and nothing else', () => {
  const withContribution = ledgerOf([
    { amount: 30_000, category: 'Groceries' },
    { amount: 50_000, goalId: GOAL_A },
    { amount: 10_000, category: 'Groceries', day: LAST_MONTH },
  ]);

  it('counts toward the goal', () => {
    expect(goalsProgress(withContribution, [goalOf('Hajj', 1_000_000)]).entries[0]).toMatchObject({
      contributedMinor: 50_000,
      setAsideMinor: 50_000,
    });
  });

  it('does not count as spending, in the comparison, or against a budget', () => {
    const totals = totalFinance(monthRows(withContribution, '2026-08'));
    expect(totals.expenseMinor).toBe(30_000);
    expect(totals.savingsContributedMinor).toBe(50_000);

    const comparison = compareFinanceMonths(withContribution, '2026-08');
    expect(comparison.spending.currentMinor).toBe(30_000);
    /* Still +200%. Before the correction this read +700%. */
    expect(comparison.spending.percentTenths).toBe(2_000);

    const budgets = progressForMonth(withContribution, [budgetOf('Groceries', 100_000)], '2026-08');
    expect(budgets.entries[0]?.spentMinor).toBe(30_000);
    /* The contribution carries no category, so this is where it used to surface. */
    expect(budgets.uncategorisedMinor).toBe(0);
  });

  it('does not count against a budget even when it carries a category', () => {
    /*
      The dangerous variant. A transfer normally has no category, but an edit from the Spending
      screen can give it one while preserving the attribution — and a category match would then eat a
      real budget's headroom rather than merely inflating the uncategorised line.
    */
    const categorised = ledgerOf([
      { amount: 30_000, category: 'Groceries' },
      { amount: 50_000, category: 'Groceries', goalId: GOAL_A },
    ]);
    expect(
      progressForMonth(categorised, [budgetOf('Groceries', 100_000)], '2026-08').entries[0]
        ?.spentMinor,
    ).toBe(30_000);
  });
});

describe('a goal withdrawal is not earned income', () => {
  const withWithdrawal = ledgerOf([
    { amount: 90_000, income: true, category: 'Salary' },
    { amount: 50_000, goalId: GOAL_A },
    { amount: 20_000, income: true, goalId: GOAL_A },
  ]);

  it('reduces Savings progress', () => {
    expect(goalsProgress(withWithdrawal, [goalOf('Hajj', 1_000_000)]).entries[0]).toMatchObject({
      contributedMinor: 50_000,
      withdrawnMinor: 20_000,
      setAsideMinor: 30_000,
    });
  });

  it('does not count as income in Spending or in the comparison', () => {
    const totals = totalFinance(monthRows(withWithdrawal, '2026-08'));
    expect(totals.incomeMinor).toBe(90_000);
    expect(totals.savingsWithdrawnMinor).toBe(20_000);
    expect(compareFinanceMonths(withWithdrawal, '2026-08').income.currentMinor).toBe(90_000);
  });
});

describe('a mixed ledger produces independent, correct totals', () => {
  it('reports consumption, savings and the signed net without any of them borrowing from another', () => {
    const totals = totalFinance(monthRows(MIXED, '2026-08'));
    expect(totals).toEqual({
      /* All four of this month's records are listed — the exclusion is in the money, not the rows. */
      count: 4,
      expenseMinor: 30_000,
      incomeMinor: 90_000,
      netMinor: 60_000,
      savingsContributedMinor: 50_000,
      savingsWithdrawnMinor: 20_000,
      savingsCount: 2,
    });

    const comparison = compareFinanceMonths(MIXED, '2026-08');
    expect(comparison.spending.currentMinor).toBe(30_000);
    expect(comparison.income.currentMinor).toBe(90_000);
    expect(comparison.net.currentMinor).toBe(60_000);

    expect(goalsProgress(MIXED, [goalOf('Hajj', 1_000_000)]).entries[0]?.setAsideMinor).toBe(
      30_000,
    );

    const summary = summariseFinance(MIXED, TODAY);
    expect(summary).toMatchObject({
      /* The whole ledger, so last month's 10,000 is included here by design. */
      expenseMinor: 40_000,
      incomeMinor: 90_000,
      savingsContributedMinor: 50_000,
      savingsWithdrawnMinor: 20_000,
      /* Counts are counts of records, and a transfer is a record. */
      count: 5,
      todayCount: 4,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5–6: category movement and filters
// ─────────────────────────────────────────────────────────────────────────────

describe('category movement and filters', () => {
  it('excludes savings transfers from category movement', () => {
    const comparison = compareFinanceMonths(MIXED, '2026-08');
    expect(comparison.categories.map((entry) => entry.category)).toEqual(['Groceries']);
    /* The phantom line the audit found: an uncategorised "category" that had moved by 500.00. */
    expect(comparison.categories.some((entry) => entry.category === null)).toBe(false);
  });

  it('does not offer a savings transfer’s category as a spending filter', () => {
    const categorised = ledgerOf([
      { amount: 30_000, category: 'Groceries' },
      { amount: 50_000, category: 'Hajj fund', goalId: GOAL_A },
    ]);
    expect(financeCategories(categorised)).toEqual(['Groceries']);
  });

  it.each([
    ['no filter', NO_FINANCE_FILTERS],
    ['a category filter', { ...NO_FINANCE_FILTERS, category: 'Groceries' }],
    ['a date range covering everything', { category: null, from: '2026-01-01', to: '2026-12-31' }],
    ['a date range covering only the transfer', { category: null, from: TODAY, to: TODAY }],
  ])('cannot let %s pull a savings transfer into the totals', (_why, filters) => {
    const rows = filterFinanceTransactions(MIXED, filters);
    const totals = totalFinance(rows);
    /*
      The property that makes this safe by construction: filters choose the *scope*, and the
      inclusion policy is applied inside the totalling regardless of which rows arrive. So there is no
      filter, present or future, that can make a transfer count as spending.
    */
    expect(totals.expenseMinor + totals.incomeMinor).toBe(
      rows.filter(isConsumptionRecord).reduce((sum, row) => sum + row.amountMinor, 0),
    );
    expect(totals.savingsContributedMinor + totals.savingsWithdrawnMinor).toBe(
      rows.filter(isSavingsTransfer).reduce((sum, row) => sum + row.amountMinor, 0),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7–9: transitions
// ─────────────────────────────────────────────────────────────────────────────

describe('a record moving between kinds moves between aggregates', () => {
  async function seeded() {
    const { storage } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    const goals = goalRepo(storage);
    await goals.createGoal({ name: 'Hajj', targetMinor: 1_000_000, targetOn: null });
    await ledger.createTransaction({
      direction: 'expense',
      amountMinor: 30_000,
      occurredOn: TODAY,
      category: 'Groceries',
    });
    const id = 'finance.aaaaaaaa-1111-4111-8111-000000000001';
    const read = async (): Promise<FinanceLedger> => {
      const result = await ledger.read();
      if (result.kind !== 'ok') {
        throw new Error(result.kind);
      }
      return result.ledger;
    };
    return { ledger, goals, id, read, storage };
  }

  it('ordinary → attributed leaves Spending, Budgets and the comparison, and joins Savings', async () => {
    const { ledger, id, read } = await seeded();

    const before = await read();
    expect(totalFinance(before.transactions).expenseMinor).toBe(30_000);
    expect(goalsProgress(before, [goalOf('Hajj', 1_000_000)]).entries[0]?.setAsideMinor).toBe(0);

    await ledger.updateTransaction(id, {
      direction: 'expense',
      amountMinor: 30_000,
      occurredOn: TODAY,
      category: 'Groceries',
      goalId: GOAL_A,
    });

    const after = await read();
    expect(totalFinance(after.transactions).expenseMinor).toBe(0);
    expect(totalFinance(after.transactions).savingsContributedMinor).toBe(30_000);
    expect(compareFinanceMonths(after, '2026-08').spending.currentMinor).toBe(0);
    expect(
      progressForMonth(after, [budgetOf('Groceries', 100_000)], '2026-08').entries[0]?.spentMinor,
    ).toBe(0);
    expect(goalsProgress(after, [goalOf('Hajj', 1_000_000)]).entries[0]?.setAsideMinor).toBe(
      30_000,
    );
  });

  it('attributed → ordinary only when the draft says so explicitly', async () => {
    const { ledger, id, read } = await seeded();
    await ledger.updateTransaction(id, {
      direction: 'expense',
      amountMinor: 30_000,
      occurredOn: TODAY,
      goalId: GOAL_A,
    });
    expect(totalFinance((await read()).transactions).expenseMinor).toBe(0);

    /*
      The supported workflow is a draft that *names* the change. A draft omitting `goalId` — which is
      what the Spending composer sends — must leave the attribution alone, or editing a note there
      would silently take money out of somebody's savings and put it into their spending.
    */
    await ledger.updateTransaction(id, {
      direction: 'expense',
      amountMinor: 30_000,
      occurredOn: TODAY,
      note: 'Edited from Spending',
    });
    const preserved = await read();
    expect(preserved.transactions[0]?.goalId).toBe(GOAL_A);
    expect(totalFinance(preserved.transactions).expenseMinor).toBe(0);
    expect(preserved.transactions[0]?.note).toBe('Edited from Spending');

    /* Explicit detachment is the inverse, and only it. */
    await ledger.updateTransaction(id, {
      direction: 'expense',
      amountMinor: 30_000,
      occurredOn: TODAY,
      goalId: null,
    });
    const detached = await read();
    expect(detached.transactions[0]?.goalId).toBeNull();
    expect(totalFinance(detached.transactions).expenseMinor).toBe(30_000);
    expect(goalsProgress(detached, [goalOf('Hajj', 1_000_000)]).entries[0]?.setAsideMinor).toBe(0);
  });

  it('moving a transfer between months changes Savings history, not the spending comparison', async () => {
    const { ledger, id, read } = await seeded();
    await ledger.updateTransaction(id, {
      direction: 'expense',
      amountMinor: 30_000,
      occurredOn: TODAY,
      goalId: GOAL_A,
    });

    const august = await read();
    const augustComparison = compareFinanceMonths(august, '2026-08');

    await ledger.updateTransaction(id, {
      direction: 'expense',
      amountMinor: 30_000,
      occurredOn: LAST_MONTH,
      goalId: GOAL_A,
    });
    const july = await read();

    /* The goal total is date-independent: the money is still set aside. */
    expect(goalsProgress(july, [goalOf('Hajj', 1_000_000)]).entries[0]?.setAsideMinor).toBe(30_000);
    /* But it moved in the savings history. */
    expect(july.transactions[0]?.occurredOn).toBe(LAST_MONTH);

    const julyComparison = compareFinanceMonths(july, '2026-08');
    expect(julyComparison.spending).toEqual(augustComparison.spending);
    expect(julyComparison.spending.currentMinor).toBe(0);
    expect(julyComparison.spending.previousMinor).toBe(0);
    expect(julyComparison.categories).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10–12: deleted goals, orphans and new writes
// ─────────────────────────────────────────────────────────────────────────────

describe('deleting a goal preserves history without reclassifying it', () => {
  const orphaned = ledgerOf([
    { amount: 30_000, category: 'Groceries' },
    { amount: 50_000, goalId: MISSING_GOAL },
    { amount: 20_000, income: true, goalId: MISSING_GOAL },
  ]);

  it('still classifies the transfers as savings, with no goal to resolve', () => {
    expect(financeRecordKind(orphaned.transactions[1]!)).toBe('savings-contribution');
    expect(financeRecordKind(orphaned.transactions[2]!)).toBe('savings-withdrawal');
    expect(savingsTransferLabel(orphaned.transactions[1]!)).toBe('Savings contribution');
    expect(savingsTransferLabel(orphaned.transactions[2]!)).toBe('Savings withdrawal');
  });

  it('does not convert them into spending or income', () => {
    const totals = totalFinance(orphaned.transactions);
    expect(totals.expenseMinor).toBe(30_000);
    expect(totals.incomeMinor).toBe(0);
    expect(totals.savingsContributedMinor).toBe(50_000);
    expect(totals.savingsWithdrawnMinor).toBe(20_000);
    expect(compareFinanceMonths(orphaned, '2026-08').spending.currentMinor).toBe(30_000);
    expect(progressForMonth(orphaned, [], '2026-08').uncategorisedMinor).toBe(0);
  });

  it('counts them toward no surviving goal', () => {
    expect(goalsProgress(orphaned, [goalOf('Other', 1_000_000, GOAL_A)]).entries[0]).toMatchObject({
      setAsideMinor: 0,
      contributionCount: 0,
    });
  });

  it('does not let a recreated goal reclaim the id, or the history', async () => {
    const { storage } = memory();
    const goals = goalRepo(storage);
    await goals.createGoal({ name: 'Hajj', targetMinor: 1_000_000, targetOn: null });
    await goals.removeGoal(GOAL_A);
    const again = await goals.createGoal({ name: 'Hajj', targetMinor: 1_000_000, targetOn: null });

    expect(again.kind).toBe('ok');
    if (again.kind === 'ok') {
      /* A fresh id, so the old transfers stay orphaned rather than reappearing in the new goal. */
      expect(again.goals[0]?.id).toBe(GOAL_B);
      expect(again.goals[0]?.id).not.toBe(GOAL_A);
      const ledger = ledgerOf([{ amount: 50_000, goalId: GOAL_A }]);
      expect(goalsProgress(ledger, again.goals).entries[0]?.setAsideMinor).toBe(0);
    }
  });

  it('keeps orphan transfers findable and truthfully named in the Spending history', async () => {
    const { storage } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    await ledger.createTransaction({
      direction: 'expense',
      amountMinor: 50_000,
      occurredOn: TODAY,
      goalId: MISSING_GOAL,
    });

    await render(
      <FinanceProvider repository={ledgerRepo(storage)} goalRepository={goalRepo(storage)}>
        <FinanceSpendingScreen />
      </FinanceProvider>,
    );
    await settle();

    const id = 'finance.aaaaaaaa-1111-4111-8111-000000000001';
    /*
      The surface that makes preservation honest. Without it the record would be retained where
      nobody could reach it, which is worse than deleting it — and before the audit it was reachable
      but described as an ordinary "Expense".
    */
    const row = screen.getByTestId(`finance-row-${id}`);
    expect(within(row).getByText('Savings contribution')).toBeTruthy();
    expect(within(row).getByText(DELETED_SAVINGS_GOAL_LABEL)).toBeTruthy();
    expect(within(row).queryByText('Expense')).toBeNull();
    /* And it is still excluded from the totals it is listed above. */
    expect(screen.getByTestId('finance-total-expense').props.accessibilityLabel).toContain('0.00');
  });

  it('names the goal while it exists', async () => {
    const { storage } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    const goals = goalRepo(storage);
    await goals.createGoal({ name: 'Hajj 1450', targetMinor: 1_000_000, targetOn: null });
    await ledger.createTransaction({
      direction: 'expense',
      amountMinor: 50_000,
      occurredOn: TODAY,
      goalId: GOAL_A,
    });

    await render(
      <FinanceProvider repository={ledgerRepo(storage)} goalRepository={goalRepo(storage)}>
        <FinanceSpendingScreen />
      </FinanceProvider>,
    );
    await settle();

    const row = screen.getByTestId('finance-row-finance.aaaaaaaa-1111-4111-8111-000000000001');
    expect(within(row).getByText('Savings contribution')).toBeTruthy();
    expect(within(row).getByText('Hajj 1450')).toBeTruthy();
  });
});

describe('a new write cannot target a goal that is not there', () => {
  async function probe(storage: FinanceStorage) {
    let api: ReturnType<typeof useFinance> | null = null;
    function Probe() {
      api = useFinance();
      return null;
    }
    await render(
      <FinanceProvider repository={ledgerRepo(storage)} goalRepository={goalRepo(storage)}>
        <Probe />
      </FinanceProvider>,
    );
    await settle();
    return () => api!;
  }

  it('refuses a contribution to a missing goal, and writes nothing', async () => {
    const { storage, rows } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    const api = await probe(storage);

    const result = await api().createTransaction({
      direction: 'expense',
      amountMinor: 50_000,
      occurredOn: TODAY,
      goalId: MISSING_GOAL,
    });

    expect(result).toEqual({ kind: 'invalid', fault: 'unknown-goal' });
    expect(String(rows.get(String(financeLedgerAddress(OWNER))))).not.toContain(MISSING_GOAL);
  });

  it('refuses an edit that would attach a record to a missing goal', async () => {
    const { storage } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    await ledger.createTransaction({
      direction: 'expense',
      amountMinor: 30_000,
      occurredOn: TODAY,
    });
    const api = await probe(storage);

    expect(
      await api().updateTransaction('finance.aaaaaaaa-1111-4111-8111-000000000001', {
        direction: 'expense',
        amountMinor: 30_000,
        occurredOn: TODAY,
        goalId: MISSING_GOAL,
      }),
    ).toEqual({ kind: 'invalid', fault: 'unknown-goal' });
  });

  it('still allows an ordinary edit of an orphaned transfer, which stays orphaned', async () => {
    /*
      The case the guard must not catch. An orphan edited from Spending sends no `goalId` at all, so
      there is nothing to check and nothing to refuse — and the attribution survives, because losing
      it here is exactly how preserved history would quietly become spending.
    */
    const { storage } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    await ledger.createTransaction({
      direction: 'expense',
      amountMinor: 50_000,
      occurredOn: TODAY,
      goalId: GOAL_A,
    });
    const goals = goalRepo(storage);
    await goals.createGoal({ name: 'Hajj', targetMinor: 1_000_000, targetOn: null });
    await goals.removeGoal(GOAL_A);
    const api = await probe(storage);

    const result = await api().updateTransaction('finance.aaaaaaaa-1111-4111-8111-000000000001', {
      direction: 'expense',
      amountMinor: 50_000,
      occurredOn: TODAY,
      note: 'Edited after the goal went',
    });

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.ledger.transactions[0]?.goalId).toBe(GOAL_A);
      expect(totalFinance(result.ledger.transactions).expenseMinor).toBe(0);
    }
  });

  it('accepts a contribution to a goal that does exist', async () => {
    const { storage } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    await goalRepo(storage).createGoal({ name: 'Hajj', targetMinor: 1_000_000, targetOn: null });
    const api = await probe(storage);

    expect(
      (
        await api().createTransaction({
          direction: 'expense',
          amountMinor: 50_000,
          occurredOn: TODAY,
          goalId: GOAL_A,
        })
      ).kind,
    ).toBe('ok');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13–15: compatibility, currency, and no second copy of anything
// ─────────────────────────────────────────────────────────────────────────────

describe('nothing about the existing ledger changed', () => {
  it('decodes a pre-Savings v1 transaction and treats it exactly as before', () => {
    const legacy = {
      id: 'finance.aaaaaaaa-1111-4111-8111-000000000001',
      direction: 'expense' as const,
      amountMinor: 30_000,
      occurredOn: TODAY,
      category: 'Groceries',
      note: null,
      createdAt: '2026-08-10T09:00:00.000Z',
      updatedAt: '2026-08-10T09:00:00.000Z',
    };
    expect(isFinanceTransaction(legacy)).toBe(true);
    const envelope = parseFinanceLedgerEnvelope({
      version: 1,
      currency: 'AED',
      transactions: [legacy],
    });
    expect(envelope?.transactions[0]).toEqual(legacy);

    const ledger: FinanceLedger = { currency: 'AED', transactions: [legacy] };
    expect(totalFinance(ledger.transactions).expenseMinor).toBe(30_000);
    expect(compareFinanceMonths(ledger, '2026-08').spending.currentMinor).toBe(30_000);
    expect(
      progressForMonth(ledger, [budgetOf('Groceries', 100_000)], '2026-08').entries[0]?.spentMinor,
    ).toBe(30_000);
    expect(financeCategories(ledger)).toEqual(['Groceries']);
  });

  it('keeps the currency lock exactly as it was', () => {
    expect(canChangeFinanceCurrency({ transactions: 0, budgets: 0, goals: 0 })).toBe(true);
    expect(canChangeFinanceCurrency({ transactions: 1, budgets: 0, goals: 0 })).toBe(false);
    expect(canChangeFinanceCurrency({ transactions: 0, budgets: 1, goals: 0 })).toBe(false);
    expect(canChangeFinanceCurrency({ transactions: 0, budgets: 0, goals: 1 })).toBe(false);
    /* A savings transfer is still a transaction, so it still locks the currency. */
    expect(
      canChangeFinanceCurrency({
        transactions: ledgerOf([{ amount: 50_000, goalId: GOAL_A }]).transactions.length,
        budgets: 0,
        goals: 1,
      }),
    ).toBe(false);
  });

  it('stores no aggregate anywhere', async () => {
    const { storage, rows } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    await goalRepo(storage).createGoal({ name: 'Hajj', targetMinor: 1_000_000, targetOn: null });
    await ledger.createTransaction({
      direction: 'expense',
      amountMinor: 50_000,
      occurredOn: TODAY,
      goalId: GOAL_A,
    });

    for (const key of [financeLedgerAddress(OWNER), financeGoalsAddress(OWNER)]) {
      const raw = String(rows.get(String(key))).toLowerCase();
      for (const cached of [
        'expenseminor',
        'incomeminor',
        'netminor',
        'savingscontributed',
        'savingswithdrawn',
        'spentminor',
        'setaside',
        'contributedminor',
      ]) {
        expect(raw).not.toContain(cached);
      }
    }
  });
});

describe('the classification is not re-implemented anywhere', () => {
  const CONSUMERS = [
    'src/features/finance/data/finance-selectors.ts',
    'src/features/finance/data/finance-comparison.ts',
    'src/features/finance/data/finance-budget-progress.ts',
    'src/features/finance/screens/finance-spending-screen.tsx',
    'src/features/finance/screens/finance-home-content.tsx',
    'src/features/home/hooks/use-finance-timeline-entries.ts',
  ];

  const body = (file: string) =>
    fs
      .readFileSync(path.join(process.cwd(), file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it.each(CONSUMERS)('%s tests the attribution through the shared rule, never inline', (file) => {
    /*
      The defect was one missing idea repeated across six selectors, so the guard is that the idea has
      exactly one home. A consumer comparing `goalId` itself is how the next aggregate silently
      disagrees with the rest — it would produce a plausible number, not an error.
    */
    const source = body(file);
    expect(source).not.toMatch(/goalId\s*(===|!==|==|!=)\s*null/);
    expect(source).not.toMatch(/goalId\s*(===|!==|==|!=)\s*undefined/);
  });

  it('routes every monetary aggregate through the one predicate', () => {
    for (const file of [
      'src/features/finance/data/finance-selectors.ts',
      'src/features/finance/data/finance-comparison.ts',
      'src/features/finance/data/finance-budget-progress.ts',
    ]) {
      expect(body(file)).toMatch(/isConsumptionRecord|isSavingsTransfer/);
    }
  });

  it('keeps the rule itself free of any store, goal list or lookup', () => {
    const source = body('src/features/finance/data/finance-record-kind.ts');
    /* Classification must not depend on whether the goal still exists — that is the orphan case. */
    expect(source).not.toMatch(/goals|repository|storage|AsyncStorage|find\(/);
  });
});
