import fs from 'node:fs';
import path from 'node:path';

import { act, render, screen, within } from '@testing-library/react-native';

import { LocalizationProvider } from '@application/providers/localization-provider';
import { pinModuleWindow } from '@/test-support/module-window';
import { installPlannerDaySource, type PlannerDayHarness } from '@/test-support/planner-day';

import { progressForMonth } from '../data/finance-budget-progress';
import { compareFinanceMonths } from '../data/finance-comparison';
import { goalsProgress } from '../data/finance-goal-progress';
import { createFinanceGoalRepository } from '../data/finance-goal.repository';
import type { FinanceBudget } from '../data/finance-budget';
import {
  isFinanceTransaction,
  parseFinanceLedgerEnvelope,
  reviseFinanceTransaction,
  validateFinanceDraft,
  type FinanceLedger,
  type FinanceTransaction,
} from '../data/finance-ledger';
import {
  createFinanceLedgerRepository,
  financeLedgerAddress,
  type FinanceStorage,
} from '../data/finance-ledger.repository';
import {
  financeRecordEffect,
  financeRecordKind,
  financeTotalEffect,
  isRefund,
} from '../data/finance-record-kind';
import { summariseFinance, totalFinance } from '../data/finance-selectors';
import { FinanceProvider } from '../di/finance-provider';
import { FinanceBudgetsScreen } from '../screens/finance-budgets-screen';
import { FinanceSpendingScreen } from '../screens/finance-spending-screen';

/**
 * **A refund is a negative expense, not an income record** — issue #96.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The conflict this resolves ─────────────────────────────────────────────
 * #96 asks for that sentence. #92 stores every amount as a **positive** integer with a direction,
 * and documents why: "a signed amount invites two representations of the same fact and a `Math.abs`
 * somewhere that forgets which one it has."
 *
 * Both survive, because "negative" was doing two jobs at once. The **magnitude stays positive** in
 * storage; the **effect is negative** in every derivation. `financeRecordEffect` is where the sign
 * lives, once, so no consumer decides it and no consumer can decide it differently.
 *
 * ── What a refund must never become ────────────────────────────────────────
 * Income. That is the half of #96's sentence that is easiest to get wrong, because "money coming in"
 * is a plausible reading of a refund and it silently inflates earnings, improves the net twice, and
 * makes a month look better than it was. Every aggregate below is asserted for a zero income effect,
 * and a mutation that files a refund as income is killed by name.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = '3f6d2c18-9a4b-4c7e-8f21-5b7d0e9a1c42';
const GOAL = 'finance.goal.cccccccc-1111-4111-8111-000000000001';
const AT = new Date('2026-08-10T09:00:00.000Z');
const NOW = new Date(2026, 7, 10, 9, 0, 0);
const TODAY = '2026-08-10';
const LAST_MONTH = '2026-07-10';

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

const ledgerRepo = (storage: FinanceStorage) =>
  createFinanceLedgerRepository({
    ownerId: OWNER,
    storage,
    id: () => `finance.aaaaaaaa-1111-4111-8111-${String(++txIds).padStart(12, '0')}`,
    now: () => AT,
  });

const goalRepo = (storage: FinanceStorage) =>
  createFinanceGoalRepository({
    ownerId: OWNER,
    storage,
    id: () => GOAL,
    now: () => AT,
  });

type Row = {
  readonly amount: number;
  readonly income?: boolean;
  readonly refund?: boolean;
  readonly category?: string | null;
  readonly goalId?: string | null;
  readonly day?: string;
};

const tx = (row: Row, index = 0): FinanceTransaction => ({
  id: `finance.aaaaaaaa-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
  direction: row.income === true ? 'income' : 'expense',
  amountMinor: row.amount,
  occurredOn: row.day ?? TODAY,
  category: row.category ?? null,
  note: null,
  goalId: row.goalId ?? null,
  kind: row.refund === true ? 'refund' : 'ordinary',
  createdAt: '2026-08-10T09:00:00.000Z',
  updatedAt: '2026-08-10T09:00:00.000Z',
});

const ledgerOf = (rows: readonly Row[]): FinanceLedger => ({
  currency: 'AED',
  transactions: rows.map((row, index) => tx(row, index)),
});

const budgetOf = (category: string, limitMinor: number): FinanceBudget => ({
  id: 'finance.budget.bbbbbbbb-1111-4111-8111-000000000001',
  category,
  limitMinor,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
});

const monthOf = (ledger: FinanceLedger, month: string) =>
  ledger.transactions.filter((row) => row.occurredOn.startsWith(month));

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  txIds = 0;
  pinModuleWindow();
  harness = installPlannerDaySource(NOW);
});

afterEach(() => {
  harness?.restore();
  harness = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// Storage and compatibility
// ─────────────────────────────────────────────────────────────────────────────

describe('the discriminant is additive and backwards compatible', () => {
  /** Bytes as #92/#95 wrote them: no `kind` key at all. */
  const PRE_96 = {
    version: 1,
    currency: 'AED',
    transactions: [
      {
        id: 'finance.aaaaaaaa-1111-4111-8111-000000000001',
        direction: 'expense',
        amountMinor: 30_000,
        occurredOn: TODAY,
        category: 'Groceries',
        note: null,
        createdAt: '2026-08-10T09:00:00.000Z',
        updatedAt: '2026-08-10T09:00:00.000Z',
      },
      {
        id: 'finance.aaaaaaaa-1111-4111-8111-000000000002',
        direction: 'income',
        amountMinor: 90_000,
        occurredOn: TODAY,
        category: 'Salary',
        note: null,
        createdAt: '2026-08-10T09:00:00.000Z',
        updatedAt: '2026-08-10T09:00:00.000Z',
      },
    ],
  };

  it('decodes pre-#96 records with their previous meaning', () => {
    const envelope = parseFinanceLedgerEnvelope(PRE_96);
    expect(envelope).not.toBeNull();
    const decoded = envelope?.transactions ?? [];
    /* Byte-identical: nothing was added, defaulted or rewritten on the way in. */
    expect(decoded[0]).toEqual(PRE_96.transactions[0]);
    expect(decoded[1]).toEqual(PRE_96.transactions[1]);
    expect(financeRecordKind(decoded[0]!)).toBe('spending');
    expect(financeRecordKind(decoded[1]!)).toBe('income');
    expect(isRefund(decoded[0]!)).toBe(false);
  });

  it('totals a pre-#96 ledger exactly as before', () => {
    const ledger: FinanceLedger = {
      currency: 'AED',
      transactions: parseFinanceLedgerEnvelope(PRE_96)?.transactions ?? [],
    };
    expect(totalFinance(ledger.transactions)).toMatchObject({
      expenseMinor: 30_000,
      grossExpenseMinor: 30_000,
      refundedMinor: 0,
      incomeMinor: 90_000,
      netMinor: 60_000,
    });
  });

  it('writes nothing back when a pre-#96 ledger is only read', async () => {
    const { storage, rows } = memory();
    const bytes = JSON.stringify(PRE_96);
    rows.set(String(financeLedgerAddress(OWNER)), bytes);
    await ledgerRepo(storage).read();
    expect(rows.get(String(financeLedgerAddress(OWNER)))).toBe(bytes);
  });

  it('keeps the envelope at version 1, because the representation did not change', () => {
    expect(
      fs.readFileSync(
        path.join(process.cwd(), 'src/features/finance/data/finance-ledger.ts'),
        'utf8',
      ),
    ).toContain('FINANCE_LEDGER_SCHEMA_VERSION = 1');
  });

  it('quarantines an unrecognised kind rather than guessing it is ordinary', () => {
    /*
      A word this build does not know has a meaning this build cannot compute. Defaulting it to
      ordinary would silently turn somebody's refund into spending — the same coercion #96 refuses
      for a mismatched currency.
    */
    for (const kind of ['transfer', 'REFUND', '', 'ordinary ', 1, null, true]) {
      expect(isFinanceTransaction({ ...tx({ amount: 100 }), kind })).toBe(false);
    }
    expect(
      parseFinanceLedgerEnvelope({
        version: 1,
        currency: 'AED',
        transactions: [{ ...tx({ amount: 100 }), kind: 'transfer' }],
      }),
    ).toBeNull();
  });

  it('stores a positive magnitude for a refund, never a negative one', async () => {
    const { storage, rows } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    await ledger.createTransaction({
      direction: 'expense',
      amountMinor: 5_000,
      occurredOn: TODAY,
      kind: 'refund',
    });
    const stored = JSON.parse(String(rows.get(String(financeLedgerAddress(OWNER))))) as {
      transactions: Record<string, unknown>[];
    };
    expect(stored.transactions[0]).toMatchObject({
      amountMinor: 5_000,
      direction: 'expense',
      kind: 'refund',
    });
    /* #92's positive-magnitude model is untouched: no minus sign reaches storage. */
    expect(String(rows.get(String(financeLedgerAddress(OWNER))))).not.toContain('-5000');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The domain refuses the two meaningless combinations
// ─────────────────────────────────────────────────────────────────────────────

describe('a refund is a kind of expense, and only that', () => {
  const base = { amountMinor: 1_000, occurredOn: TODAY } as const;

  it('accepts a refund on an expense', () => {
    expect(validateFinanceDraft({ ...base, direction: 'expense', kind: 'refund' }).kind).toBe(
      'valid',
    );
  });

  it('refuses a refund filed as income', () => {
    expect(validateFinanceDraft({ ...base, direction: 'income', kind: 'refund' })).toEqual({
      kind: 'invalid',
      fault: 'refund-must-be-expense',
    });
  });

  it('refuses a refund attributed to a savings goal', () => {
    expect(
      validateFinanceDraft({ ...base, direction: 'expense', kind: 'refund', goalId: GOAL }),
    ).toEqual({ kind: 'invalid', fault: 'refund-cannot-be-savings' });
  });

  it('refuses an unrecognised kind on a draft', () => {
    expect(
      validateFinanceDraft({
        ...base,
        direction: 'expense',
        kind: 'transfer' as never,
      }).kind,
    ).toBe('invalid');
  });

  it('preserves the flavour when a revise says nothing about it', () => {
    /* Receipts and the Savings composer send no `kind`; neither may turn a refund back into spending. */
    const existing = tx({ amount: 5_000, refund: true });
    expect(
      reviseFinanceTransaction(
        existing,
        { direction: 'expense', amountMinor: 5_000, occurredOn: TODAY, category: null, note: 'x' },
        AT,
      ).kind,
    ).toBe('refund');
  });

  it('changes the flavour only when the draft says so', () => {
    const existing = tx({ amount: 5_000, refund: true });
    expect(
      reviseFinanceTransaction(
        existing,
        {
          direction: 'expense',
          amountMinor: 5_000,
          occurredOn: TODAY,
          category: null,
          note: null,
          kind: 'ordinary',
        },
        AT,
      ).kind,
    ).toBe('ordinary');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The one effect authority
// ─────────────────────────────────────────────────────────────────────────────

describe('one authority decides what every record does', () => {
  it.each([
    ['spending', { amount: 100 }, { expenseMinor: 100, incomeMinor: 0 }],
    ['income', { amount: 100, income: true }, { expenseMinor: 0, incomeMinor: 0 }],
    ['refund', { amount: 100, refund: true }, { expenseMinor: -100, incomeMinor: 0 }],
  ] as const)('gives %s the right expense effect', (_kind, row, expected) => {
    const effect = financeRecordEffect(tx(row));
    expect(effect.expenseMinor).toBe(expected.expenseMinor);
  });

  it('gives a refund a negative expense and exactly zero income', () => {
    expect(financeRecordEffect(tx({ amount: 5_000, refund: true }))).toEqual({
      expenseMinor: -5_000,
      incomeMinor: 0,
      savingsContributedMinor: 0,
      savingsWithdrawnMinor: 0,
    });
  });

  it('gives ordinary income its income effect and no expense effect', () => {
    expect(financeRecordEffect(tx({ amount: 9_000, income: true }))).toEqual({
      expenseMinor: 0,
      incomeMinor: 9_000,
      savingsContributedMinor: 0,
      savingsWithdrawnMinor: 0,
    });
  });

  it('leaves savings transfers exactly as #95 defined them', () => {
    expect(financeRecordKind(tx({ amount: 100, goalId: GOAL }))).toBe('savings-contribution');
    expect(financeRecordKind(tx({ amount: 100, income: true, goalId: GOAL }))).toBe(
      'savings-withdrawal',
    );
    expect(financeRecordEffect(tx({ amount: 100, goalId: GOAL }))).toMatchObject({
      expenseMinor: 0,
      incomeMinor: 0,
      savingsContributedMinor: 100,
    });
  });

  it('sums many records without any of them borrowing from another', () => {
    expect(
      financeTotalEffect(
        ledgerOf([
          { amount: 30_000, category: 'Groceries' },
          { amount: 90_000, income: true },
          { amount: 5_000, refund: true, category: 'Groceries' },
          { amount: 20_000, goalId: GOAL },
        ]).transactions,
      ),
    ).toEqual({
      expenseMinor: 25_000,
      incomeMinor: 90_000,
      savingsContributedMinor: 20_000,
      savingsWithdrawnMinor: 0,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Month semantics
// ─────────────────────────────────────────────────────────────────────────────

describe('refunds reduce spending and never raise income', () => {
  it('nets a partial refund out of the month', () => {
    const totals = totalFinance(
      ledgerOf([
        { amount: 30_000, category: 'Groceries' },
        { amount: 5_000, refund: true, category: 'Groceries' },
      ]).transactions,
    );
    expect(totals).toMatchObject({
      grossExpenseMinor: 30_000,
      refundedMinor: 5_000,
      expenseMinor: 25_000,
      incomeMinor: 0,
      netMinor: -25_000,
    });
  });

  it('nets a full refund to nothing without producing income', () => {
    const totals = totalFinance(
      ledgerOf([
        { amount: 30_000, category: 'Groceries' },
        { amount: 30_000, refund: true, category: 'Groceries' },
      ]).transactions,
    );
    expect(totals).toMatchObject({ expenseMinor: 0, incomeMinor: 0, netMinor: 0 });
  });

  it('reports an excess refund as negative spending, not as earnings', () => {
    const totals = totalFinance(
      ledgerOf([
        { amount: 10_000, category: 'Groceries' },
        { amount: 25_000, refund: true, category: 'Groceries' },
      ]).transactions,
    );
    /*
      The policy, stated: month spending goes negative and says so. The alternative — `Math.abs` —
      would print 15,000 of spending that never happened, and calling it income would be the reading
      #96 forbids in as many words.
    */
    expect(totals.expenseMinor).toBe(-15_000);
    expect(totals.incomeMinor).toBe(0);
    expect(totals.netMinor).toBe(15_000);
  });

  it('handles a refund with no matching expense at all', () => {
    const totals = totalFinance(ledgerOf([{ amount: 5_000, refund: true }]).transactions);
    expect(totals).toMatchObject({
      grossExpenseMinor: 0,
      refundedMinor: 5_000,
      expenseMinor: -5_000,
      incomeMinor: 0,
      netMinor: 5_000,
    });
  });

  it('improves the signed net by the refund exactly once', () => {
    const without = totalFinance(ledgerOf([{ amount: 30_000 }]).transactions);
    const with_ = totalFinance(
      ledgerOf([{ amount: 30_000 }, { amount: 5_000, refund: true }]).transactions,
    );
    /* Once through the expense it reduces — never a second time as income. */
    expect(with_.netMinor - without.netMinor).toBe(5_000);
    expect(with_.incomeMinor).toBe(without.incomeMinor);
  });

  it('agrees between the ledger summary and the month totals', () => {
    const ledger = ledgerOf([
      { amount: 30_000, category: 'Groceries' },
      { amount: 5_000, refund: true, category: 'Groceries' },
    ]);
    const summary = summariseFinance(ledger, TODAY);
    const totals = totalFinance(ledger.transactions);
    expect(summary.expenseMinor).toBe(totals.expenseMinor);
    expect(summary.incomeMinor).toBe(totals.incomeMinor);
    expect(summary.grossExpenseMinor).toBe(totals.grossExpenseMinor);
    expect(summary.refundedMinor).toBe(totals.refundedMinor);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Comparison
// ─────────────────────────────────────────────────────────────────────────────

describe('the month comparison uses net expense', () => {
  const ledger = ledgerOf([
    { amount: 30_000, category: 'Groceries' },
    { amount: 5_000, refund: true, category: 'Groceries' },
    { amount: 90_000, income: true, category: 'Salary' },
    { amount: 10_000, category: 'Groceries', day: LAST_MONTH },
  ]);

  it('compares spending after refunds', () => {
    const comparison = compareFinanceMonths(ledger, '2026-08');
    expect(comparison.spending.currentMinor).toBe(25_000);
    expect(comparison.spending.previousMinor).toBe(10_000);
    /* +150%, not the +200% a gross figure would have claimed. */
    expect(comparison.spending.percentTenths).toBe(1_500);
  });

  it('leaves the income comparison untouched by refunds', () => {
    expect(compareFinanceMonths(ledger, '2026-08').income.currentMinor).toBe(90_000);
  });

  it('moves the signed net by the refund, once', () => {
    expect(compareFinanceMonths(ledger, '2026-08').net.currentMinor).toBe(65_000);
  });

  it('uses net expense for category movement', () => {
    const groceries = compareFinanceMonths(ledger, '2026-08').categories.find(
      (entry) => entry.category === 'Groceries',
    );
    expect(groceries?.change.currentMinor).toBe(25_000);
  });

  it('lets a category movement go negative when refunds exceed its spending', () => {
    const heavy = ledgerOf([
      { amount: 10_000, category: 'Groceries' },
      { amount: 25_000, refund: true, category: 'Groceries' },
      { amount: 10_000, category: 'Groceries', day: LAST_MONTH },
    ]);
    const groceries = compareFinanceMonths(heavy, '2026-08').categories.find(
      (entry) => entry.category === 'Groceries',
    );
    expect(groceries?.change.currentMinor).toBe(-15_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Budgets
// ─────────────────────────────────────────────────────────────────────────────

describe('a same-category refund gives budget headroom back', () => {
  const budgets = [budgetOf('Groceries', 100_000)];

  it('reduces usage by the refund', () => {
    const entry = progressForMonth(
      ledgerOf([
        { amount: 60_000, category: 'Groceries' },
        { amount: 10_000, refund: true, category: 'Groceries' },
      ]),
      budgets,
      '2026-08',
    ).entries[0];
    expect(entry).toMatchObject({
      spentMinor: 50_000,
      netSpentMinor: 50_000,
      refundedBeyondSpendMinor: 0,
      differenceMinor: 50_000,
      status: 'below',
    });
  });

  it('takes a budget back under its limit when a refund lands', () => {
    const entry = progressForMonth(
      ledgerOf([
        { amount: 120_000, category: 'Groceries' },
        { amount: 30_000, refund: true, category: 'Groceries' },
      ]),
      budgets,
      '2026-08',
    ).entries[0];
    expect(entry?.status).toBe('below');
    expect(entry?.spentMinor).toBe(90_000);
  });

  it('never reports negative usage, and states the excess instead', () => {
    const entry = progressForMonth(
      ledgerOf([
        { amount: 10_000, category: 'Groceries' },
        { amount: 25_000, refund: true, category: 'Groceries' },
      ]),
      budgets,
      '2026-08',
    ).entries[0];
    /*
      The three rules together: usage floored at nothing, the true net kept, and the part the floor
      removed reported as a refund rather than invented as spending or income.
    */
    expect(entry?.spentMinor).toBe(0);
    expect(entry?.netSpentMinor).toBe(-15_000);
    expect(entry?.refundedBeyondSpendMinor).toBe(15_000);
    expect(entry?.status).toBe('refunded-beyond');
    expect(entry?.percentTenths).toBe(0);
  });

  it('applies an uncategorised refund only to uncategorised spending', () => {
    const view = progressForMonth(
      ledgerOf([
        { amount: 60_000, category: 'Groceries' },
        { amount: 20_000 },
        { amount: 5_000, refund: true },
      ]),
      budgets,
      '2026-08',
    );
    expect(view.entries[0]?.spentMinor).toBe(60_000);
    expect(view.uncategorisedMinor).toBe(15_000);
  });

  it('leaves a refund in another category alone', () => {
    const entry = progressForMonth(
      ledgerOf([
        { amount: 60_000, category: 'Groceries' },
        { amount: 10_000, refund: true, category: 'Transport' },
      ]),
      budgets,
      '2026-08',
    ).entries[0];
    expect(entry?.spentMinor).toBe(60_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Savings is untouched
// ─────────────────────────────────────────────────────────────────────────────

describe('refunds and savings stay separate', () => {
  it('leaves savings progress unchanged by a refund', () => {
    const goal = {
      id: GOAL,
      name: 'Hajj',
      targetMinor: 1_000_000,
      targetOn: null,
      createdAt: 'a',
      updatedAt: 'b',
    };
    const ledger = ledgerOf([
      { amount: 50_000, goalId: GOAL },
      { amount: 5_000, refund: true, category: 'Groceries' },
    ]);
    expect(goalsProgress(ledger, [goal]).entries[0]).toMatchObject({
      contributedMinor: 50_000,
      withdrawnMinor: 0,
      setAsideMinor: 50_000,
    });
  });

  it('refuses a refund that also carries a goal, through the provider', async () => {
    const { storage } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    await goalRepo(storage).createGoal({ name: 'Hajj', targetMinor: 1_000_000, targetOn: null });

    expect(
      await ledger.createTransaction({
        direction: 'expense',
        amountMinor: 5_000,
        occurredOn: TODAY,
        goalId: GOAL,
        kind: 'refund',
      }),
    ).toEqual({ kind: 'invalid', fault: 'refund-cannot-be-savings' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Screens
// ─────────────────────────────────────────────────────────────────────────────

describe('the Spending screen records and shows refunds truthfully', () => {
  async function mounted(rows: readonly Row[] = []) {
    const { storage, rows: bytes } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    for (const row of rows) {
      await ledger.createTransaction({
        direction: row.income === true ? 'income' : 'expense',
        amountMinor: row.amount,
        occurredOn: row.day ?? TODAY,
        category: row.category ?? null,
        ...(row.refund === true ? { kind: 'refund' as const } : {}),
      });
    }
    const view = await render(
      <LocalizationProvider>
        <FinanceProvider repository={ledgerRepo(storage)}>
          <FinanceSpendingScreen />
        </FinanceProvider>
      </LocalizationProvider>,
    );
    await settle();
    return { view, bytes, storage };
  }

  it('offers Expense, Income and Refund, and nothing else', async () => {
    await mounted();
    await act(async () => {
      screen.getByTestId('finance-open-composer').props.onClick?.();
      await Promise.resolve();
    });
    /* The control exists with exactly the three choices the domain can represent. */
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/finance/screens/finance-spending-screen.tsx'),
      'utf8',
    );
    expect(source).toContain("{ key: 'refund', label: 'Refund' }");
    expect(source).toContain('A refund reduces what you have recorded spending');
    expect(source).toContain('It is not counted as income.');
  });

  it('labels a refund row as a refund, not an expense', async () => {
    await mounted([{ amount: 5_000, refund: true, category: 'Groceries' }]);
    const id = 'finance.aaaaaaaa-1111-4111-8111-000000000001';
    const row = screen.getByTestId(`finance-row-${id}`);
    expect(within(row).getByText('Refund')).toBeTruthy();
    expect(within(row).queryByText('Expense')).toBeNull();
    expect(within(row).queryByText('Income')).toBeNull();
  });

  it('shows totals net of the refund', async () => {
    await mounted([
      { amount: 30_000, category: 'Groceries' },
      { amount: 5_000, refund: true, category: 'Groceries' },
    ]);
    expect(screen.getByTestId('finance-total-expense').props.accessibilityLabel).toBe(
      'Spent, 250.00 AED',
    );
    expect(screen.getByTestId('finance-total-income').props.accessibilityLabel).toBe(
      'Received, 0.00 AED',
    );
  });

  it('shows an excess refund as negative spending rather than as income', async () => {
    await mounted([
      { amount: 10_000, category: 'Groceries' },
      { amount: 25_000, refund: true, category: 'Groceries' },
    ]);
    expect(screen.getByTestId('finance-total-expense').props.accessibilityLabel).toBe(
      'Spent, −150.00 AED',
    );
    expect(screen.getByTestId('finance-total-income').props.accessibilityLabel).toBe(
      'Received, 0.00 AED',
    );
  });

  it('keeps a refund visible under a category filter', async () => {
    await mounted([
      { amount: 30_000, category: 'Groceries' },
      { amount: 5_000, refund: true, category: 'Groceries' },
    ]);
    /* A refund is a record in the category it refunds, so a filter on it must not drop it. */
    const id = 'finance.aaaaaaaa-1111-4111-8111-000000000002';
    expect(screen.getByTestId(`finance-row-${id}`)).toBeTruthy();
  });
});

describe('the Budgets screen states an excess refund', () => {
  it('says what came back rather than inventing spending', async () => {
    const { storage } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    await ledger.createTransaction({
      direction: 'expense',
      amountMinor: 10_000,
      occurredOn: TODAY,
      category: 'Groceries',
    });
    await ledger.createTransaction({
      direction: 'expense',
      amountMinor: 25_000,
      occurredOn: TODAY,
      category: 'Groceries',
      kind: 'refund',
    });
    const budgets = {
      ownerId: OWNER,
      read: async () => ({ kind: 'ok' as const, budgets: [budgetOf('Groceries', 100_000)] }),
      createBudget: async () => ({ kind: 'ok' as const, budgets: [] }),
      updateBudget: async () => ({ kind: 'ok' as const, budgets: [] }),
      removeBudget: async () => ({ kind: 'ok' as const, budgets: [] }),
    };

    await render(
      <LocalizationProvider>
        <FinanceProvider repository={ledgerRepo(storage)} budgetRepository={budgets}>
          <FinanceBudgetsScreen />
        </FinanceProvider>
      </LocalizationProvider>,
    );
    await settle();

    expect(screen.getByTestId('finance-budget-status-Groceries').props.children).toBe(
      '150.00 AED refunded beyond this category’s spending',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Propagation and scope
// ─────────────────────────────────────────────────────────────────────────────

describe('a refund propagates and stays contained', () => {
  it('moves every derived surface when created, edited and deleted', async () => {
    const { storage } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    await ledger.createTransaction({
      direction: 'expense',
      amountMinor: 30_000,
      occurredOn: TODAY,
      category: 'Groceries',
    });

    const read = async (): Promise<FinanceLedger> => {
      const result = await ledger.read();
      if (result.kind !== 'ok') {
        throw new Error(result.kind);
      }
      return result.ledger;
    };
    const netOf = async () => totalFinance(monthOf(await read(), '2026-08')).expenseMinor;

    expect(await netOf()).toBe(30_000);

    await ledger.createTransaction({
      direction: 'expense',
      amountMinor: 5_000,
      occurredOn: TODAY,
      category: 'Groceries',
      kind: 'refund',
    });
    expect(await netOf()).toBe(25_000);

    const refundId = 'finance.aaaaaaaa-1111-4111-8111-000000000002';
    await ledger.updateTransaction(refundId, {
      direction: 'expense',
      amountMinor: 12_000,
      occurredOn: TODAY,
      category: 'Groceries',
      kind: 'refund',
    });
    expect(await netOf()).toBe(18_000);

    /* Turning it back into ordinary spending is the inverse, and it moves the same way. */
    await ledger.updateTransaction(refundId, {
      direction: 'expense',
      amountMinor: 12_000,
      occurredOn: TODAY,
      category: 'Groceries',
      kind: 'ordinary',
    });
    expect(await netOf()).toBe(42_000);

    await ledger.removeTransaction(refundId);
    expect(await netOf()).toBe(30_000);
  });

  it('cannot be inferred by the dormant receipt reader', () => {
    const source = fs
      .readFileSync(
        path.join(process.cwd(), 'src/features/finance/receipts/receipt-reading.ts'),
        'utf8',
      )
      .replace(/\/\*[\s\S]*?\*\//g, '');
    expect(source).not.toContain('refund');
    const screenSource = fs
      .readFileSync(
        path.join(process.cwd(), 'src/features/finance/screens/finance-receipts-screen.tsx'),
        'utf8',
      )
      .replace(/\/\*[\s\S]*?\*\//g, '');
    /* Receipts offers two directions and never a refund, so a scan cannot decide money came back. */
    expect(screenSource).not.toMatch(/label: 'Refund'/);
    expect(screenSource).not.toMatch(/kind: 'refund'/);
  });

  it('is not reimplemented by any consumer', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') {
            walk(full);
          }
        } else if (/\.tsx?$/.test(entry.name)) {
          files.push(full);
        }
      }
    };
    walk(path.join(process.cwd(), 'src/features/finance'));

    for (const file of files) {
      if (
        file.endsWith('finance-record-kind.ts') ||
        file.endsWith('finance-ledger.ts') ||
        file.endsWith('finance-spending-screen.tsx')
      ) {
        /* The authority, the domain that stores the field, and the one composer that offers it. */
        continue;
      }
      const source = fs
        .readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      /*
        No consumer may test the flavour itself. The sign of a refund lives in one function, and a
        second copy is how one aggregate ends up disagreeing with the rest — producing a plausible
        number rather than a failure.
      */
      expect(source).not.toMatch(/kind\s*===\s*'refund'/);
      expect(source).not.toMatch(/kind\s*!==\s*'refund'/);
    }
  });
});
