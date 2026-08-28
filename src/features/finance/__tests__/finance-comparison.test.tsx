import fs from 'node:fs';
import path from 'node:path';

import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { pinModuleWindow } from '@/test-support/module-window';
import { installPlannerDaySource, type PlannerDayHarness } from '@/test-support/planner-day';

import { moduleRegistry } from '@features/modules/module-registry';

import {
  compareFinanceMonths,
  compareMagnitude,
  compareSigned,
  percentTenthsOf,
} from '../data/finance-comparison';
import {
  NET_SUBJECT,
  SPENDING_SUBJECT,
  describeChange,
  describeMovement,
  formatPercentTenths,
  percentClause,
} from '../data/finance-comparison-copy';
import {
  MAX_FINANCE_TRANSACTIONS,
  type FinanceLedger,
  type FinanceTransaction,
} from '../data/finance-ledger';
import {
  createFinanceLedgerRepository,
  financeLedgerAddress,
  type FinanceStorage,
} from '../data/finance-ledger.repository';
import { MAX_MINOR_UNITS, type FinanceCurrency } from '../data/finance-money';
import { FinanceProvider } from '../di/finance-provider';
import { FinanceSpendingScreen } from '../screens/finance-spending-screen';

/**
 * **This month against last** — issue #102.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What is actually hard about a comparison feature ───────────────────────
 * Not the subtraction. Three things, and each of them has its own block below.
 *
 * The **zero baseline**, which is where most comparison features lie. Dividing by last month's zero
 * gives `Infinity`; dressing that up as "+100%" claims a doubling that did not happen. Both reach
 * the screen looking like figures. The assertions here state that no percentage exists in that case
 * and that the *rendered* screen contains no `%` at all — not that a helper returned `null`, which a
 * component could still ignore.
 *
 * The **month boundary**, which is #93's string arithmetic and must stay that way. A `Date` built
 * from a local day string is UTC midnight, which is the previous month for anyone west of Greenwich,
 * so a `Date`-based comparison files a 1 March spend under February for a third of the world and for
 * nobody in this timezone. It is asserted twice: once as arithmetic with an explicit offset, and
 * once as a scan of the source proving the wrong version cannot come back.
 *
 * The **source of the figures**. The Spending list is narrowed by category chips and a date range; a
 * comparison derived from the visible rows would report a slice of August as August and would move
 * whenever somebody touched a filter. The tests drive the real filter controls and assert the
 * comparison does not move.
 *
 * ── Rendered, not mocked ───────────────────────────────────────────────────
 * The screen tests seed a ledger through the **real repository** and render the real screen inside
 * the real provider. Create, edit, delete and the month steppers are driven by pressing the actual
 * controls, so "it updates without a relaunch" is demonstrated rather than asserted about a hook.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = '3f6d2c18-9a4b-4c7e-8f21-5b7d0e9a1c42';
const OTHER_OWNER = '81b0c2d4-6e5f-4a3b-9c8d-0f1e2a3b4c5d';
const AT = new Date('2026-08-27T09:00:00.000Z');
const NOW = new Date(2026, 7, 27, 9, 0, 0);

let ids = 0;
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

function repo(storage: FinanceStorage, ownerId: string = OWNER) {
  return createFinanceLedgerRepository({
    ownerId,
    storage,
    id: () => `finance.aaaaaaaa-1111-4111-8111-${String(++ids).padStart(12, '0')}`,
    now: () => AT,
  });
}

type Row = {
  readonly day: string;
  readonly amount: number;
  readonly income?: boolean;
  readonly category?: string;
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

/** A ledger built directly, for the pure derivation tests. */
const ledgerOf = (rows: readonly Row[]): FinanceLedger => ({
  currency: 'AED' as FinanceCurrency,
  transactions: rows.map(transactionOf),
});

async function settle(): Promise<void> {
  await act(async () => {
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

/** A ledger seeded through the real repository, then rendered through the real provider. */
async function renderWith(rows: readonly Row[], ownerId: string = OWNER) {
  const { storage } = memory();
  const subject = repo(storage, ownerId);
  await subject.setCurrency('AED');
  for (const row of rows) {
    await subject.createTransaction({
      direction: row.income === true ? 'income' : 'expense',
      amountMinor: row.amount,
      occurredOn: row.day,
      category: row.category ?? null,
    });
  }
  const view = await render(
    <FinanceProvider repository={repo(storage, ownerId)}>
      <FinanceSpendingScreen />
    </FinanceProvider>,
  );
  await settle();
  return { view, storage };
}

const section = () => within(screen.getByTestId('finance-comparison'));
const spendingLabel = () =>
  String(screen.getByTestId('finance-comparison-spending').props.accessibilityLabel);
const netLabel = () =>
  String(screen.getByTestId('finance-comparison-net').props.accessibilityLabel);
const incomeLabel = () =>
  String(screen.getByTestId('finance-comparison-income').props.accessibilityLabel);

/** Every string the comparison section renders, flattened. */
function sectionText(): string {
  const walk = (node: unknown): string => {
    if (typeof node === 'string') {
      return node;
    }
    const children = (node as { children?: readonly unknown[] }).children ?? [];
    return children.map(walk).join(' ');
  };
  return walk(screen.getByTestId('finance-comparison')).replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  ids = 0;
  pinModuleWindow();
  harness = installPlannerDaySource(NOW);
});

afterEach(() => {
  harness?.restore();
  harness = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// The derivation
// ─────────────────────────────────────────────────────────────────────────────

describe('the comparison is derived from the ledger', () => {
  it('reports no activity when the ledger is empty', () => {
    const result = compareFinanceMonths(ledgerOf([]), '2026-08');
    expect(result.previous).toBe('2026-07');
    expect(result.spending).toEqual({
      currentMinor: 0,
      previousMinor: 0,
      differenceMinor: 0,
      percentTenths: null,
      trend: 'no-activity',
    });
    expect(result.income.trend).toBe('no-activity');
    expect(result.net.trend).toBe('unchanged');
    expect(result.categories).toEqual([]);
    expect(result.unchangedCategoryCount).toBe(0);
  });

  it('calls a month with nothing before it new activity, and states no percentage', () => {
    const result = compareFinanceMonths(
      ledgerOf([{ day: '2026-08-04', amount: 12_500 }]),
      '2026-08',
    );
    expect(result.spending.trend).toBe('new-activity');
    expect(result.spending.currentMinor).toBe(12_500);
    expect(result.spending.previousMinor).toBe(0);
    expect(result.spending.differenceMinor).toBe(12_500);
    /* Not 100, not Infinity, not 0. Absent. */
    expect(result.spending.percentTenths).toBeNull();
  });

  it('calls a month with nothing in it, after one with something, ceased activity at −100%', () => {
    const result = compareFinanceMonths(
      ledgerOf([{ day: '2026-07-04', amount: 9_000 }]),
      '2026-08',
    );
    expect(result.spending.trend).toBe('ceased-activity');
    expect(result.spending.differenceMinor).toBe(-9_000);
    /* This one *is* defined: the baseline exists, and the fall is exactly the whole of it. */
    expect(result.spending.percentTenths).toBe(-1000);
  });

  it('calls equal non-zero totals unchanged, at exactly zero percent', () => {
    const result = compareFinanceMonths(
      ledgerOf([
        { day: '2026-08-04', amount: 5_000 },
        { day: '2026-07-04', amount: 5_000 },
      ]),
      '2026-08',
    );
    expect(result.spending.trend).toBe('unchanged');
    expect(result.spending.differenceMinor).toBe(0);
    expect(result.spending.percentTenths).toBe(0);
  });

  it('states an increase with its absolute size and its percentage', () => {
    const result = compareFinanceMonths(
      ledgerOf([
        { day: '2026-08-04', amount: 12_000 },
        { day: '2026-07-04', amount: 10_000 },
      ]),
      '2026-08',
    );
    expect(result.spending.trend).toBe('increase');
    expect(result.spending.differenceMinor).toBe(2_000);
    expect(result.spending.percentTenths).toBe(200);
  });

  it('states a decrease with the decrease kept exact, and the sign the right way round', () => {
    const result = compareFinanceMonths(
      ledgerOf([
        { day: '2026-08-04', amount: 7_500 },
        { day: '2026-07-04', amount: 10_000 },
      ]),
      '2026-08',
    );
    expect(result.spending.trend).toBe('decrease');
    /* current − previous. A reversed sign would report a fall as a rise, in every state. */
    expect(result.spending.differenceMinor).toBe(-2_500);
    expect(result.spending.percentTenths).toBe(-250);
  });

  it('adds every transaction in each month, not merely the first', () => {
    const result = compareFinanceMonths(
      ledgerOf([
        { day: '2026-08-01', amount: 1_000 },
        { day: '2026-08-14', amount: 2_000 },
        { day: '2026-08-31', amount: 3_000 },
        { day: '2026-07-01', amount: 500 },
        { day: '2026-07-31', amount: 500 },
      ]),
      '2026-08',
    );
    expect(result.spending.currentMinor).toBe(6_000);
    expect(result.spending.previousMinor).toBe(1_000);
  });

  it('does not count income as spending', () => {
    const result = compareFinanceMonths(
      ledgerOf([
        { day: '2026-08-04', amount: 1_000 },
        { day: '2026-08-05', amount: 900_000, income: true },
        { day: '2026-07-04', amount: 1_000 },
        { day: '2026-07-05', amount: 100, income: true },
      ]),
      '2026-08',
    );
    expect(result.spending.currentMinor).toBe(1_000);
    expect(result.spending.previousMinor).toBe(1_000);
    expect(result.spending.trend).toBe('unchanged');
    /* And income is compared in its own right, rather than being discarded. */
    expect(result.income.currentMinor).toBe(900_000);
    expect(result.income.previousMinor).toBe(100);
    expect(result.income.trend).toBe('increase');
  });

  it('compares the signed net, and never calls a zero net an absence', () => {
    const result = compareFinanceMonths(
      ledgerOf([
        { day: '2026-08-04', amount: 5_000 },
        { day: '2026-08-05', amount: 5_000, income: true },
        { day: '2026-07-04', amount: 9_000 },
        { day: '2026-07-05', amount: 4_000, income: true },
      ]),
      '2026-08',
    );
    expect(result.currentTotals.netMinor).toBe(0);
    expect(result.previousTotals.netMinor).toBe(-5_000);
    expect(result.net.differenceMinor).toBe(5_000);
    expect(result.net.trend).toBe('increase');
    /* A percentage of a negative baseline would be a ratio taken across zero. There is none. */
    expect(result.net.percentTenths).toBeNull();
  });

  it('ignores months either side of the pair', () => {
    const result = compareFinanceMonths(
      ledgerOf([
        { day: '2026-09-01', amount: 99_999 },
        { day: '2026-08-01', amount: 1_000 },
        { day: '2026-07-01', amount: 2_000 },
        { day: '2026-06-30', amount: 99_999 },
      ]),
      '2026-08',
    );
    expect(result.spending.currentMinor).toBe(1_000);
    expect(result.spending.previousMinor).toBe(2_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The month boundary
// ─────────────────────────────────────────────────────────────────────────────

describe('the month pair is string arithmetic, in the local calendar', () => {
  it.each([
    ['2026-01', '2025-12'],
    ['2026-03', '2026-02'],
    ['2024-03', '2024-02'],
    ['2026-12', '2026-11'],
  ])('sets %s against %s', (month, previous) => {
    expect(compareFinanceMonths(ledgerOf([]), month).previous).toBe(previous);
  });

  it('crosses January into December of the previous year with the transactions attached', () => {
    const result = compareFinanceMonths(
      ledgerOf([
        { day: '2026-01-05', amount: 3_000 },
        { day: '2025-12-31', amount: 1_000 },
        { day: '2025-12-01', amount: 1_000 },
      ]),
      '2026-01',
    );
    expect(result.previous).toBe('2025-12');
    expect(result.spending.currentMinor).toBe(3_000);
    expect(result.spending.previousMinor).toBe(2_000);
  });

  it('handles a leap February and its 29th without a case of its own', () => {
    const result = compareFinanceMonths(
      ledgerOf([
        { day: '2024-02-29', amount: 4_000 },
        { day: '2024-01-31', amount: 1_000 },
      ]),
      '2024-02',
    );
    expect(result.spending.currentMinor).toBe(4_000);
    expect(result.spending.previousMinor).toBe(1_000);
  });

  it.each([
    ['2026-02', '2026-02-28', '2026-01-31'],
    ['2026-04', '2026-04-30', '2026-03-31'],
    ['2026-05', '2026-05-31', '2026-04-30'],
  ])('takes the last day of %s and of the month before it', (month, current, previous) => {
    const result = compareFinanceMonths(
      ledgerOf([
        { day: current, amount: 700 },
        { day: previous, amount: 300 },
      ]),
      month,
    );
    expect(result.spending.currentMinor).toBe(700);
    expect(result.spending.previousMinor).toBe(300);
  });

  it('keeps a local day key local, where a Date would move it', () => {
    /*
      A date-only string is parsed as UTC midnight by specification, so a reader five hours west sees
      `2026-03-01` as the evening of 28 February. A `Date`-based comparison would put that spend in
      February's column — for them, and invisibly to a suite running at UTC+4. The shift is therefore
      constructed with a stated offset rather than left to the machine's zone.
    */
    const fiveHoursWest = new Date(Date.parse('2026-03-01') - 5 * 60 * 60 * 1000);
    expect(fiveHoursWest.getUTCMonth()).toBe(1);

    const result = compareFinanceMonths(
      ledgerOf([
        { day: '2026-03-01', amount: 5_000 },
        { day: '2026-02-28', amount: 1_000 },
      ]),
      '2026-03',
    );
    expect(result.spending.currentMinor).toBe(5_000);
    expect(result.spending.previousMinor).toBe(1_000);
  });

  it('constructs no Date and reads no clock', () => {
    /*
      The companion to the case above: that one proves the arithmetic is right, this one proves the
      wrong arithmetic cannot come back — and that no second date owner, timer or poll was introduced
      alongside it.
    */
    for (const file of [
      'src/features/finance/data/finance-comparison.ts',
      'src/features/finance/data/finance-comparison-copy.ts',
    ]) {
      const source = fs
        .readFileSync(path.join(process.cwd(), file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(source).not.toMatch(/new Date|Date\.|getMonth|getFullYear|toLocale|Intl\./);
      expect(source).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Percentage semantics
// ─────────────────────────────────────────────────────────────────────────────

describe('a percentage exists only where one is defined', () => {
  it('has none without a baseline greater than zero', () => {
    expect(percentTenthsOf(500, 0)).toBeNull();
    expect(percentTenthsOf(0, 0)).toBeNull();
    expect(percentTenthsOf(-500, 0)).toBeNull();
    /* A negative baseline is the signed-net case: a ratio across zero has no reading. */
    expect(percentTenthsOf(500, -1_000)).toBeNull();
  });

  it('is exactly zero for equal non-zero figures', () => {
    expect(percentTenthsOf(0, 4_000)).toBe(0);
    expect(compareMagnitude(4_000, 4_000).percentTenths).toBe(0);
    expect(compareSigned(4_000, 4_000).percentTenths).toBe(0);
  });

  it.each([
    [1_000, 1_000, 1000],
    [-500, 1_000, -500],
    [1, 1_000, 1],
    [-1, 1_000, -1],
    [3, 1_000, 3],
    [250, 2_000, 125],
  ])('reports %s over %s as %s tenths of a percent', (difference, previous, tenths) => {
    expect(percentTenthsOf(difference, previous)).toBe(tenths);
  });

  it('rounds half away from zero, in both directions', () => {
    /* 5/8 of a percent is 6.25 tenths, which is not a tie and rounds down. */
    expect(percentTenthsOf(5, 800)).toBe(6);
    /* 1/16 of a percent is 6.25 tenths of a percent per 100 — the tie is constructed below. */
    expect(percentTenthsOf(1, 1_600)).toBe(1);
    /* An exact half tenth: 3/1600 = 0.1875% = 1.875 tenths → 2. */
    expect(percentTenthsOf(3, 1_600)).toBe(2);
    /* Exactly 0.05% = 0.5 tenths, the tie itself: away from zero in both directions. */
    expect(percentTenthsOf(1, 2_000)).toBe(1);
    expect(percentTenthsOf(-1, 2_000)).toBe(-1);
  });

  it('never returns NaN or Infinity, for any pair the ledger can hold', () => {
    const extremes = [0, 1, 2, 999, MAX_MINOR_UNITS, MAX_MINOR_UNITS * MAX_FINANCE_TRANSACTIONS];
    for (const current of extremes) {
      for (const previous of extremes) {
        const change = compareMagnitude(current, previous);
        expect(Number.isFinite(change.differenceMinor)).toBe(true);
        if (change.percentTenths !== null) {
          expect(Number.isFinite(change.percentTenths)).toBe(true);
          expect(Number.isNaN(change.percentTenths)).toBe(false);
        }
      }
    }
  });

  it('stays exact at the very top of the supported range, where a double would not', () => {
    /*
      #92's bound: 5,000 records of 10^12 is 5 × 10^15, inside the safe-integer range — but
      `2000 × 5 × 10^15` is not, which is why the ratio is taken in `BigInt`. A double would give an
      answer here, and it would be the wrong one.
    */
    const ceiling = MAX_MINOR_UNITS * MAX_FINANCE_TRANSACTIONS;
    expect(Number.isSafeInteger(ceiling)).toBe(true);
    expect(Number.isSafeInteger(2000 * ceiling)).toBe(false);

    expect(percentTenthsOf(ceiling, ceiling)).toBe(1000);
    expect(percentTenthsOf(-ceiling, ceiling)).toBe(-1000);
    /* One minor unit against the whole ledger rounds below a tenth, and says so rather than lying. */
    expect(percentTenthsOf(1, ceiling)).toBe(0);
    expect(percentClause({ ...compareMagnitude(ceiling + 1, ceiling) }, SPENDING_SUBJECT)).toBe(
      'under 0.1% more',
    );
  });

  it('keeps a full ledger of the largest transactions integer-safe', () => {
    const rows = Array.from({ length: 40 }, (_, index) => ({
      day: index % 2 === 0 ? '2026-08-01' : '2026-07-01',
      amount: MAX_MINOR_UNITS,
    }));
    const result = compareFinanceMonths(ledgerOf(rows), '2026-08');
    expect(result.spending.currentMinor).toBe(20 * MAX_MINOR_UNITS);
    expect(Number.isSafeInteger(result.spending.currentMinor)).toBe(true);
    expect(result.spending.differenceMinor).toBe(0);
    expect(result.spending.percentTenths).toBe(0);
  });

  it('writes tenths as text without ever holding a float', () => {
    expect(formatPercentTenths(0)).toBe('0%');
    expect(formatPercentTenths(1000)).toBe('100%');
    expect(formatPercentTenths(125)).toBe('12.5%');
    expect(formatPercentTenths(-125)).toBe('12.5%');
    expect(formatPercentTenths(1)).toBe('0.1%');
    expect(formatPercentTenths(200)).toBe('20%');
  });

  it('says "under 0.1%" rather than "0%" beside an amount that really moved', () => {
    const change = compareMagnitude(1_000_001, 1_000_000);
    expect(change.percentTenths).toBe(0);
    expect(percentClause(change, SPENDING_SUBJECT)).toBe('under 0.1% more');
  });

  it('writes no percentage clause where none is defined', () => {
    expect(percentClause(compareMagnitude(500, 0), SPENDING_SUBJECT)).toBeNull();
    expect(percentClause(compareMagnitude(0, 0), SPENDING_SUBJECT)).toBeNull();
    expect(percentClause(compareMagnitude(500, 500), SPENDING_SUBJECT)).toBeNull();
    expect(percentClause(compareSigned(-100, -500), NET_SUBJECT)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Categories
// ─────────────────────────────────────────────────────────────────────────────

describe('category movement', () => {
  it('reports which categories moved, largest movement first', () => {
    const result = compareFinanceMonths(
      ledgerOf([
        { day: '2026-08-01', amount: 1_000, category: 'Food' },
        { day: '2026-08-02', amount: 9_000, category: 'Rent' },
        { day: '2026-07-01', amount: 4_000, category: 'Food' },
        { day: '2026-07-02', amount: 9_000, category: 'Rent' },
        { day: '2026-07-03', amount: 200, category: 'Travel' },
      ]),
      '2026-08',
    );
    expect(result.categories.map((entry) => entry.category)).toEqual(['Food', 'Travel']);
    expect(result.categories[0]?.change.differenceMinor).toBe(-3_000);
    expect(result.categories[1]?.change.trend).toBe('ceased-activity');
    /* Rent did not move, so it is counted rather than listed. */
    expect(result.unchangedCategoryCount).toBe(1);
  });

  it('keeps uncategorised spending rather than dropping it', () => {
    const result = compareFinanceMonths(
      ledgerOf([
        { day: '2026-08-01', amount: 2_500 },
        { day: '2026-07-01', amount: 500 },
      ]),
      '2026-08',
    );
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0]?.category).toBeNull();
    expect(result.categories[0]?.change.differenceMinor).toBe(2_000);
  });

  it('counts no income into a category', () => {
    const result = compareFinanceMonths(
      ledgerOf([
        { day: '2026-08-01', amount: 50_000, income: true, category: 'Food' },
        { day: '2026-07-01', amount: 1_000, category: 'Food' },
      ]),
      '2026-08',
    );
    expect(result.categories[0]?.change.currentMinor).toBe(0);
    expect(result.categories[0]?.change.trend).toBe('ceased-activity');
  });

  it('orders equal movements by name, with the unlabelled bucket last', () => {
    const result = compareFinanceMonths(
      ledgerOf([
        { day: '2026-08-01', amount: 1_000, category: 'Zakat' },
        { day: '2026-08-02', amount: 1_000, category: 'Books' },
        { day: '2026-08-03', amount: 1_000 },
      ]),
      '2026-08',
    );
    expect(result.categories.map((entry) => entry.category)).toEqual(['Books', 'Zakat', null]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The copy
// ─────────────────────────────────────────────────────────────────────────────

describe('the words are descriptive and never judgemental', () => {
  const CURRENCY: FinanceCurrency = 'AED';
  const STATES = [
    compareMagnitude(0, 0),
    compareMagnitude(12_000, 0),
    compareMagnitude(0, 12_000),
    compareMagnitude(12_000, 12_000),
    compareMagnitude(15_000, 12_000),
    compareMagnitude(9_000, 12_000),
    compareMagnitude(12_001, 12_000),
    compareSigned(-500, 400),
    compareSigned(400, -500),
    compareSigned(0, 0),
  ];

  it.each([
    'good',
    'bad',
    'better',
    'worse',
    'overspend',
    'on track',
    'you should',
    'budget',
    'saving',
    'forecast',
    'predict',
    'score',
    'grade',
    'advice',
    'well done',
  ])('never says "%s", in any state', (word) => {
    for (const change of STATES) {
      for (const subject of [SPENDING_SUBJECT, NET_SUBJECT]) {
        const full = describeChange(change, subject, CURRENCY, '2026-07');
        const short = describeMovement(change, subject, CURRENCY);
        for (const phrasing of [full, short]) {
          const text = `${phrasing.sentence} ${phrasing.percent ?? ''}`.toLowerCase();
          expect(text).not.toContain(word);
        }
      }
    }
  });

  it('never writes a percent sign where no percentage exists', () => {
    for (const change of STATES) {
      for (const subject of [SPENDING_SUBJECT, NET_SUBJECT]) {
        const phrasing = describeChange(change, subject, CURRENCY, '2026-07');
        if (change.percentTenths === null || change.differenceMinor === 0) {
          expect(phrasing.percent).toBeNull();
          expect(phrasing.sentence).not.toContain('%');
        }
        expect(`${phrasing.sentence} ${phrasing.percent ?? ''}`).not.toMatch(/NaN|Infinity|∞/);
      }
    }
  });

  it('names its direction in words, so the glyph is never doing the work alone', () => {
    const previous = '2026-07';
    expect(describeChange(compareMagnitude(0, 0), SPENDING_SUBJECT, CURRENCY, previous)).toEqual({
      glyph: '=',
      sentence: 'No spending in either month',
      percent: null,
    });
    expect(
      describeChange(compareMagnitude(12_000, 0), SPENDING_SUBJECT, CURRENCY, previous).sentence,
    ).toBe('New spending activity this month — 120.00 AED, with none in July 2026');
    expect(
      describeChange(compareMagnitude(15_000, 12_000), SPENDING_SUBJECT, CURRENCY, previous),
    ).toEqual({ glyph: '↑', sentence: '30.00 AED more than July 2026', percent: '25% more' });
    expect(
      describeChange(compareMagnitude(9_000, 12_000), SPENDING_SUBJECT, CURRENCY, previous),
    ).toEqual({ glyph: '↓', sentence: '30.00 AED less than July 2026', percent: '25% less' });
    expect(
      describeChange(compareMagnitude(12_000, 12_000), SPENDING_SUBJECT, CURRENCY, previous)
        .sentence,
    ).toBe('The same as July 2026');
    expect(describeChange(compareSigned(400, -500), NET_SUBJECT, CURRENCY, previous).sentence).toBe(
      '9.00 AED higher than July 2026',
    );
  });

  it('renders the ledger currency, and only that one', () => {
    const phrasing = describeChange(
      compareMagnitude(15_000, 12_000),
      SPENDING_SUBJECT,
      'JPY',
      '2026-07',
    );
    /*
      JPY has no minor digits — a `× 100` assumption would inflate this a hundredfold — and since
      #96 the integer part is grouped in the locale's marks, so the figure reads as a person would
      write it. Both halves matter: the digits are the currency's, the separators are the locale's.
    */
    expect(phrasing.sentence).toBe('3,000 JPY more than July 2026');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// On the screen
// ─────────────────────────────────────────────────────────────────────────────

describe('the Spending screen states the comparison', () => {
  it('names both months and both totals', async () => {
    await renderWith([
      { day: '2026-08-04', amount: 12_000 },
      { day: '2026-07-04', amount: 10_000 },
    ]);

    expect(section().getByText('August 2026 compared with July 2026')).toBeTruthy();
    expect(spendingLabel()).toContain('Spent in August 2026, 120.00 AED');
    expect(spendingLabel()).toContain('20.00 AED more than July 2026');
    expect(spendingLabel()).toContain('20% more');
    expect(spendingLabel()).toContain('Spent in July 2026, 100.00 AED');
  });

  it('shows no percentage anywhere when the previous month is zero', async () => {
    await renderWith([{ day: '2026-08-04', amount: 12_000 }]);

    expect(spendingLabel()).toContain('New spending activity this month');
    expect(spendingLabel()).not.toContain('%');
    /* Not merely absent from the label: absent from every string the section renders. */
    expect(sectionText()).not.toContain('%');
    expect(sectionText()).not.toMatch(/NaN|Infinity|∞/);
  });

  it('says nothing happened in either month, and still shows no percentage', async () => {
    await renderWith([{ day: '2026-06-04', amount: 12_000 }]);

    expect(spendingLabel()).toContain('No spending in either month');
    expect(sectionText()).not.toContain('%');
  });

  it('states a decrease as a decrease', async () => {
    await renderWith([
      { day: '2026-08-04', amount: 7_500 },
      { day: '2026-07-04', amount: 10_000 },
    ]);
    expect(spendingLabel()).toContain('25.00 AED less than July 2026');
    expect(spendingLabel()).toContain('25% less');
  });

  it('states equal months as the same, with no percentage clause', async () => {
    await renderWith([
      { day: '2026-08-04', amount: 10_000 },
      { day: '2026-07-04', amount: 10_000 },
    ]);
    expect(spendingLabel()).toContain('The same as July 2026');
    expect(sectionText()).not.toContain('%');
  });

  it('keeps income out of the spending line and compares it in its own', async () => {
    await renderWith([
      { day: '2026-08-04', amount: 3_000 },
      { day: '2026-08-05', amount: 500_000, income: true },
      { day: '2026-07-04', amount: 3_000 },
    ]);
    expect(spendingLabel()).toContain('The same as July 2026');
    expect(incomeLabel()).toContain('New income activity this month');
    expect(netLabel()).toContain('higher than July 2026');
  });

  it('carries direction in words rather than in colour', async () => {
    await renderWith([
      { day: '2026-08-04', amount: 12_000 },
      { day: '2026-07-04', amount: 10_000 },
    ]);
    /*
      The assertion that matters is the absence of a second signal: every direction word is present
      in the text, and the component gives the glyph the module's own ink rather than a hue that
      means "up". A greyscale reader loses nothing.
    */
    expect(sectionText()).toContain('more than July 2026');
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/finance/screens/finance-spending-screen.tsx'),
      'utf8',
    );
    const component = source.slice(source.indexOf('function MonthComparison'));
    expect(component).not.toMatch(/#[0-9a-fA-F]{3,8}|'red'|'green'|rgba?\(/);
  });

  it('shows the categories that moved and counts the ones that did not', async () => {
    await renderWith([
      { day: '2026-08-01', amount: 1_000, category: 'Food' },
      { day: '2026-08-02', amount: 9_000, category: 'Rent' },
      { day: '2026-07-01', amount: 4_000, category: 'Food' },
      { day: '2026-07-02', amount: 9_000, category: 'Rent' },
    ]);
    expect(screen.getByTestId('finance-comparison-category-Food')).toBeTruthy();
    expect(screen.queryByTestId('finance-comparison-category-Rent')).toBeNull();
    expect(sectionText()).toContain('1 category was exactly the same in both months.');
  });

  it('shows nothing at all before a currency is chosen', async () => {
    const { storage } = memory();
    await render(
      <FinanceProvider repository={repo(storage)}>
        <FinanceSpendingScreen />
      </FinanceProvider>,
    );
    await settle();
    /* The existing currency-setup path owns this state; the comparison never renders over it. */
    expect(screen.getByTestId('finance-currency-setup')).toBeTruthy();
    expect(screen.queryByTestId('finance-comparison')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// It stays live, and it stays the owner's
// ─────────────────────────────────────────────────────────────────────────────

describe('the comparison follows the ledger without a relaunch', () => {
  it('updates when a transaction is created', async () => {
    await renderWith([{ day: '2026-07-04', amount: 10_000 }]);
    expect(spendingLabel()).toContain('No spending this month');

    await press(screen.getByTestId('finance-open-composer'));
    await type('finance-amount', '40');
    await type('finance-date', '2026-08-10');
    await press(screen.getByTestId('finance-save'));
    await settle();

    expect(spendingLabel()).toContain('60.00 AED less than July 2026');
    expect(spendingLabel()).toContain('60% less');
  });

  it('updates when a transaction is edited', async () => {
    await renderWith([
      { day: '2026-08-04', amount: 12_000 },
      { day: '2026-07-04', amount: 10_000 },
    ]);
    expect(spendingLabel()).toContain('20.00 AED more than July 2026');

    const rowId = 'finance.aaaaaaaa-1111-4111-8111-000000000001';
    await press(screen.getByTestId(`finance-edit-${rowId}`));
    await type('finance-amount', '60');
    await press(screen.getByTestId('finance-save'));
    await settle();

    expect(spendingLabel()).toContain('40.00 AED less than July 2026');
  });

  it('updates when a transaction is deleted', async () => {
    await renderWith([
      { day: '2026-08-04', amount: 12_000 },
      { day: '2026-07-04', amount: 10_000 },
    ]);
    const rowId = 'finance.aaaaaaaa-1111-4111-8111-000000000001';
    await press(screen.getByTestId(`finance-delete-${rowId}`));
    await press(screen.getByTestId('finance-confirm-delete'));
    await settle();

    expect(spendingLabel()).toContain('No spending this month');
    expect(spendingLabel()).toContain('100.00 AED less than July 2026');
  });

  it('moves both sides when a transaction is moved across the month boundary', async () => {
    await renderWith([
      { day: '2026-08-04', amount: 12_000 },
      { day: '2026-07-04', amount: 10_000 },
    ]);
    expect(spendingLabel()).toContain('Spent in August 2026, 120.00 AED');
    expect(spendingLabel()).toContain('Spent in July 2026, 100.00 AED');

    const rowId = 'finance.aaaaaaaa-1111-4111-8111-000000000001';
    await press(screen.getByTestId(`finance-edit-${rowId}`));
    await type('finance-date', '2026-07-20');
    await press(screen.getByTestId('finance-save'));
    await settle();

    expect(spendingLabel()).toContain('Spent in August 2026, 0.00 AED');
    expect(spendingLabel()).toContain('Spent in July 2026, 220.00 AED');
  });

  it('changes direction when a transaction is switched between income and expense', async () => {
    await renderWith([
      { day: '2026-08-04', amount: 12_000 },
      { day: '2026-07-04', amount: 10_000 },
    ]);
    const rowId = 'finance.aaaaaaaa-1111-4111-8111-000000000001';
    await press(screen.getByTestId(`finance-edit-${rowId}`));
    await press(screen.getByTestId('finance-direction-income'));
    await press(screen.getByTestId('finance-save'));
    await settle();

    expect(spendingLabel()).toContain('No spending this month');
    expect(incomeLabel()).toContain('New income activity this month');
  });

  it('is untouched by the category filter', async () => {
    await renderWith([
      { day: '2026-08-01', amount: 1_000, category: 'Food' },
      { day: '2026-08-02', amount: 11_000, category: 'Rent' },
      { day: '2026-07-04', amount: 10_000, category: 'Food' },
    ]);
    const before = spendingLabel();
    expect(before).toContain('Spent in August 2026, 120.00 AED');

    await press(screen.getByTestId('finance-filters-category-Food'));
    await settle();

    /* The list narrows; the month's comparison is about the month, so it does not. */
    expect(spendingLabel()).toBe(before);
  });

  it('is untouched by a custom date range, and still names the months it describes', async () => {
    await renderWith([
      { day: '2026-08-01', amount: 4_000 },
      { day: '2026-08-20', amount: 8_000 },
      { day: '2026-07-04', amount: 10_000 },
    ]);
    const before = spendingLabel();

    await type('finance-filters-from', '2026-08-15');
    await type('finance-filters-to', '2026-08-31');
    await settle();

    expect(screen.getByTestId('finance-month-superseded')).toBeTruthy();
    expect(spendingLabel()).toBe(before);
    expect(section().getByText('August 2026 compared with July 2026')).toBeTruthy();
  });

  it('follows the month stepper to a different pair', async () => {
    await renderWith([
      { day: '2026-08-04', amount: 12_000 },
      { day: '2026-07-04', amount: 10_000 },
      { day: '2026-06-04', amount: 2_000 },
    ]);
    await press(screen.getByTestId('finance-month-previous'));
    await settle();

    expect(section().getByText('July 2026 compared with June 2026')).toBeTruthy();
    expect(spendingLabel()).toContain('Spent in July 2026, 100.00 AED');
    expect(spendingLabel()).toContain('Spent in June 2026, 20.00 AED');
  });

  it('follows the shared day source across midnight into a new month', async () => {
    await renderWith([
      { day: '2026-09-01', amount: 5_000 },
      { day: '2026-08-04', amount: 12_000 },
    ]);
    expect(section().getByText('August 2026 compared with July 2026')).toBeTruthy();

    await act(async () => {
      harness?.setNow(new Date(2026, 8, 1, 0, 0, 1));
      harness?.fireMidnight();
      await Promise.resolve();
    });
    await settle();

    expect(section().getByText('September 2026 compared with August 2026')).toBeTruthy();
    expect(spendingLabel()).toContain('Spent in September 2026, 50.00 AED');
    expect(spendingLabel()).toContain('Spent in August 2026, 120.00 AED');
  });

  it('follows a foreground reconciliation across a month boundary', async () => {
    await renderWith([{ day: '2026-08-04', amount: 12_000 }]);

    await act(async () => {
      harness?.setNow(new Date(2026, 8, 1, 8, 30, 0));
      harness?.sendAppState('active');
      await Promise.resolve();
    });
    await settle();

    expect(section().getByText('September 2026 compared with August 2026')).toBeTruthy();
  });

  it('owns no clock of its own', async () => {
    await renderWith([
      { day: '2026-08-04', amount: 12_000 },
      { day: '2026-07-04', amount: 10_000 },
    ]);
    /*
      The shared day source is the only thing that may hold a notion of "now" — #76, and the reason
      the month above follows midnight without this screen arming anything. The one listener is that
      source's own; a comparison that reconciled on its own schedule would be a second, which is the
      shape `today-agenda-provider` records as worth catching before it ships.
    */
    expect(harness?.appStateListenerCount()).toBe(1);

    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/finance/screens/finance-spending-screen.tsx'),
      'utf8',
    );
    const component = source.slice(source.indexOf('function MonthComparison'));
    expect(component).not.toMatch(/new Date|setInterval|setTimeout|usePlannerDay/);
  });

  it('cannot show one account’s comparison inside another’s session', async () => {
    const { storage } = memory();
    const first = repo(storage, OWNER);
    await first.setCurrency('AED');
    await first.createTransaction({
      direction: 'expense',
      amountMinor: 77_700,
      occurredOn: '2026-08-04',
    });

    const view = await render(
      <FinanceProvider repository={repo(storage, OWNER)}>
        <FinanceSpendingScreen />
      </FinanceProvider>,
    );
    await settle();
    expect(spendingLabel()).toContain('777.00 AED');

    await view.rerender(
      <FinanceProvider repository={repo(storage, OTHER_OWNER)}>
        <FinanceSpendingScreen />
      </FinanceProvider>,
    );
    await settle();

    /* A different owner reads a different address, so there is no ledger and no comparison. */
    expect(screen.queryByTestId('finance-comparison')).toBeNull();
    expect(screen.queryByText(/777.00/)).toBeNull();
  });

  it('fails closed with no owner at all', async () => {
    const { storage } = memory();
    await render(
      <FinanceProvider
        repository={createFinanceLedgerRepository({ ownerId: null, storage, now: () => AT })}
      >
        <FinanceSpendingScreen />
      </FinanceProvider>,
    );
    await settle();
    expect(screen.queryByTestId('finance-comparison')).toBeNull();
  });

  it('shows no comparison over quarantined records', async () => {
    const { storage } = memory();
    const address = financeLedgerAddress(OWNER);
    /* Written at the repository's own address, so the quarantine path is the one being exercised. */
    await storage.setItem(
      String(address),
      '{"version":1,"currency":"AED","transactions":[{"id":"nope"}]}',
    );

    await render(
      <FinanceProvider repository={repo(storage)}>
        <FinanceSpendingScreen />
      </FinanceProvider>,
    );
    await settle();

    expect(screen.getByTestId('finance-spending-corrupt')).toBeTruthy();
    expect(screen.queryByTestId('finance-comparison')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scope
// ─────────────────────────────────────────────────────────────────────────────

describe('nothing was stored, and nothing else was started', () => {
  it('writes no monthly aggregate into the stored envelope', async () => {
    const { storage, rows } = memory();
    const subject = repo(storage);
    await subject.setCurrency('AED');
    await subject.createTransaction({
      direction: 'expense',
      amountMinor: 12_000,
      occurredOn: '2026-08-04',
    });
    await subject.createTransaction({
      direction: 'expense',
      amountMinor: 10_000,
      occurredOn: '2026-07-04',
    });

    const stored = JSON.parse(String([...rows.values()][0])) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(['currency', 'transactions', 'version']);
    expect(JSON.stringify(stored)).not.toMatch(/comparison|monthly|summary|aggregate|percent/i);
  });

  it('exposes no repository method that could write one', () => {
    const { storage } = memory();
    const subject = repo(storage);
    expect(Object.keys(subject).sort()).toEqual([
      'createTransaction',
      'ownerId',
      'read',
      'removeTransaction',
      'setCurrency',
      'updateTransaction',
    ]);
  });

  it('reaches no network, no rate table and no analytics', () => {
    for (const file of [
      'src/features/finance/data/finance-comparison.ts',
      'src/features/finance/data/finance-comparison-copy.ts',
    ]) {
      const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(source).not.toMatch(/fetch\(|axios|supabase|http|exchange|analytics|track\(/i);
    }
  });

  it('leaves the dormant capabilities alone', () => {
    const capabilities = moduleRegistry.finance.capabilities;
    const receipts = capabilities.find((entry) => entry.key === 'receipts');
    const bank = capabilities.find((entry) => entry.key === 'bank-sync');
    expect(receipts?.available).toBe(false);
    expect(receipts?.href).toBeUndefined();
    expect(bank?.available).toBe(false);
  });
});
