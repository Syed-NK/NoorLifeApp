import fs from 'node:fs';
import path from 'node:path';

import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { pinModuleWindow } from '@/test-support/module-window';
import { installPlannerDaySource, type PlannerDayHarness } from '@/test-support/planner-day';

import {
  currentMonthOf,
  dayIsInMonth,
  formatMonth,
  isFinanceMonth,
  monthOfDay,
  nextMonth,
  previousMonth,
} from '../data/finance-month';
import type { FinanceLedger } from '../data/finance-ledger';
import {
  createFinanceLedgerRepository,
  type FinanceStorage,
} from '../data/finance-ledger.repository';
import type { FinanceCurrency } from '../data/finance-money';
import {
  canStepBack,
  canStepForward,
  clampMonth,
  filterFinanceTransactions,
  financeMonthBounds,
  financeMonths,
  totalFinance,
  NO_FINANCE_FILTERS,
} from '../data/finance-selectors';
import { FinanceProvider } from '../di/finance-provider';
import { FinanceSpendingScreen } from '../screens/finance-spending-screen';

/**
 * **The month view** — issue #93.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why the month is a string, and why that is the interesting part ────────
 * Everything a month view usually gets wrong comes from turning a local day into a `Date` and asking
 * it questions. `new Date('2026-03-01')` is UTC midnight, which is the *last day of February* for
 * anyone west of Greenwich — so a transaction the user filed on 1 March lands in the wrong month for
 * a third of the world, and only for them. This module never builds one. A month is the first seven
 * characters of the day the user chose, and membership is prefix equality.
 *
 * The same choice disposes of February. Nothing here computes how many days a month has, so 28, 29,
 * 30 and 31 are all the same code path and a leap year has no case of its own — which is asserted
 * below rather than assumed, because "it cannot go wrong" is the sentence that precedes most of
 * these defects.
 *
 * ── One clock, still ───────────────────────────────────────────────────────
 * The current month comes from the shared day source (#76). When midnight or a foreground
 * reconciliation moves the day into a new month, the month moves with it — everywhere, at once, with
 * no second timer. That is asserted by driving the shared harness rather than by reading the code.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = '3f6d2c18-9a4b-4c7e-8f21-5b7d0e9a1c42';
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
  return storage;
}

function repo(storage: FinanceStorage) {
  return createFinanceLedgerRepository({
    ownerId: OWNER,
    storage,
    id: () => `finance.aaaaaaaa-1111-4111-8111-${String(++ids).padStart(12, '0')}`,
    now: () => AT,
  });
}

const ledgerOf = (
  rows: readonly { readonly day: string; readonly amount: number; readonly income?: boolean }[],
): FinanceLedger => ({
  currency: 'AED' as FinanceCurrency,
  transactions: rows.map((row, index) => ({
    id: `finance.aaaaaaaa-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
    direction: row.income === true ? ('income' as const) : ('expense' as const),
    amountMinor: row.amount,
    occurredOn: row.day,
    category: null,
    note: null,
    createdAt: '2026-08-27T09:00:00.000Z',
    updatedAt: '2026-08-27T09:00:00.000Z',
  })),
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

/** A ledger seeded through the real repository, then rendered. */
async function renderWith(days: readonly { day: string; amount: number; income?: boolean }[]) {
  const storage = memory();
  const subject = repo(storage);
  await subject.setCurrency('AED');
  for (const row of days) {
    await subject.createTransaction({
      direction: row.income === true ? 'income' : 'expense',
      amountMinor: row.amount,
      occurredOn: row.day,
    });
  }
  const view = await render(
    <FinanceProvider repository={repo(storage)}>
      <FinanceSpendingScreen />
    </FinanceProvider>,
  );
  await settle();
  return { view, storage };
}

const label = () => screen.getByTestId('finance-month-label').props.children;
const listRows = () => within(screen.getByTestId('finance-list'));

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
// The month, as arithmetic
// ─────────────────────────────────────────────────────────────────────────────

describe('a month is a prefix, not a date', () => {
  it.each([
    ['2026-08-27', '2026-08'],
    ['2026-01-01', '2026-01'],
    ['2026-12-31', '2026-12'],
    ['2024-02-29', '2024-02'],
  ])('reads %s as %s', (day, month) => {
    expect(monthOfDay(day)).toBe(month);
    expect(currentMonthOf(day)).toBe(month);
    expect(isFinanceMonth(month)).toBe(true);
  });

  it('gives the answer a Date would get wrong west of Greenwich', () => {
    /*
      ── Why this is written as arithmetic rather than as a rendered assertion ──
      A date-only string is parsed as **UTC midnight** by specification. A reader five hours west
      therefore sees it as the evening of 28 February, so a `Date`-based month reading files their
      1 March transaction under February — and only theirs. It is the worst class of defect to test
      for, because it is invisible to a test runner in any zone at or east of UTC, which includes
      this machine (UTC+4).

      So the shift is constructed explicitly, with a stated offset, instead of being left to whatever
      zone the suite happens to run in. That makes the assertion true everywhere, and it is paired
      below with a scan proving this module builds no `Date` at all.
    */
    const utcMidnight = Date.parse('2026-03-01');
    const fiveHoursWest = new Date(utcMidnight - 5 * 60 * 60 * 1000);
    expect(fiveHoursWest.getUTCMonth()).toBe(1);

    expect(monthOfDay('2026-03-01')).toBe('2026-03');
    expect(dayIsInMonth('2026-03-01', '2026-03')).toBe(true);
    expect(dayIsInMonth('2026-03-01', '2026-02')).toBe(false);
  });

  it('constructs no Date and reads no date accessor', () => {
    /*
      The companion to the case above. That one proves the arithmetic is right; this one proves the
      wrong arithmetic cannot come back, in the only way available to a suite that cannot itself run
      in a western zone.
    */
    const source = fs
      .readFileSync(path.join(process.cwd(), 'src/features/finance/data/finance-month.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(
      /new Date|Date\.|getMonth|getFullYear|getTimezoneOffset|toLocale|Intl\./,
    );
  });

  it.each([
    ['2026-01', '2025-12', '2026-02'],
    ['2026-12', '2026-11', '2027-01'],
    ['2026-08', '2026-07', '2026-09'],
    ['2024-02', '2024-01', '2024-03'],
  ])('steps %s to %s and %s', (month, back, forward) => {
    expect(previousMonth(month)).toBe(back);
    expect(nextMonth(month)).toBe(forward);
  });

  it('crosses a year boundary in both directions and comes back', () => {
    let month = '2026-01';
    for (let i = 0; i < 14; i += 1) month = previousMonth(month);
    expect(month).toBe('2024-11');
    for (let i = 0; i < 14; i += 1) month = nextMonth(month);
    expect(month).toBe('2026-01');
  });

  it.each([
    ['2024-02-29', '2024-02'],
    ['2023-02-28', '2023-02'],
    ['2026-01-31', '2026-01'],
    ['2026-04-30', '2026-04'],
  ])('holds %s without computing a month length', (day, month) => {
    /* 28, 29, 30 and 31 are one code path, so a leap February needs no case of its own. */
    expect(dayIsInMonth(day, month)).toBe(true);
  });

  it('includes both boundary days of a month and excludes their neighbours', () => {
    const ledger = ledgerOf([
      { day: '2024-01-31', amount: 100 },
      { day: '2024-02-01', amount: 200 },
      { day: '2024-02-29', amount: 300 },
      { day: '2024-03-01', amount: 400 },
    ]);
    const february = filterFinanceTransactions(ledger, NO_FINANCE_FILTERS, {
      kind: 'month',
      month: '2024-02',
    });
    expect(february.map((t) => t.amountMinor).sort((a, b) => a - b)).toEqual([200, 300]);
  });

  it('names a month without asking the device what language it speaks', () => {
    expect(formatMonth('2026-08')).toBe('August 2026');
    expect(formatMonth('2024-02')).toBe('February 2024');
    expect(formatMonth('2026-12')).toBe('December 2026');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Totals
// ─────────────────────────────────────────────────────────────────────────────

describe('monthly totals are derived, never stored', () => {
  const ledger = ledgerOf([
    { day: '2026-08-01', amount: 1000, income: true },
    { day: '2026-08-31', amount: 250 },
    { day: '2026-07-15', amount: 9999 },
  ]);

  it('adds income, expense and net over exactly the month in scope', () => {
    const august = filterFinanceTransactions(ledger, NO_FINANCE_FILTERS, {
      kind: 'month',
      month: '2026-08',
    });
    /*
      The savings fields joined this shape when the cross-feature audit made the exclusion policy
      explicit. They are zero throughout this suite because none of its records is attributed to a
      goal — which is the point: an unattributed ledger behaves exactly as it did before #95.
    */
    expect(totalFinance(august)).toEqual({
      count: 2,
      incomeMinor: 1000,
      expenseMinor: 250,
      netMinor: 750,
      savingsContributedMinor: 0,
      savingsWithdrawnMinor: 0,
      savingsCount: 0,
    });
  });

  it('reports a negative net rather than hiding it', () => {
    const july = filterFinanceTransactions(ledger, NO_FINANCE_FILTERS, {
      kind: 'month',
      month: '2026-07',
    });
    expect(totalFinance(july).netMinor).toBe(-9999);
  });

  it('reports zeroes for a month with nothing in it', () => {
    expect(totalFinance([])).toEqual({
      count: 0,
      incomeMinor: 0,
      expenseMinor: 0,
      netMinor: 0,
      savingsContributedMinor: 0,
      savingsWithdrawnMinor: 0,
      savingsCount: 0,
    });
  });

  it('stores nothing and mutates nothing', () => {
    const before = JSON.stringify(ledger);
    totalFinance(ledger.transactions);
    financeMonths(ledger);
    financeMonthBounds(ledger, '2026-08');
    expect(JSON.stringify(ledger)).toBe(before);
    /* The ledger's own shape has no total in it, so there is nothing that could go stale. */
    expect(Object.keys(ledger).sort()).toEqual(['currency', 'transactions']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// How far the stepper may go
// ─────────────────────────────────────────────────────────────────────────────

describe('the stepper stops where the records do', () => {
  const empty: FinanceLedger = { currency: 'AED' as FinanceCurrency, transactions: [] };

  it('will not walk into an empty future', () => {
    const bounds = financeMonthBounds(empty, '2026-08');
    expect(bounds).toEqual({ earliest: '2026-08', latest: '2026-08' });
    expect(canStepForward('2026-08', bounds)).toBe(false);
    expect(canStepBack('2026-08', bounds)).toBe(false);
  });

  it('does go forward when the user has future-dated something', () => {
    const bounds = financeMonthBounds(ledgerOf([{ day: '2026-11-04', amount: 100 }]), '2026-08');
    expect(bounds.latest).toBe('2026-11');
    expect(canStepForward('2026-08', bounds)).toBe(true);
    expect(canStepForward('2026-11', bounds)).toBe(false);
  });

  it('goes back only as far as the earliest record', () => {
    const bounds = financeMonthBounds(ledgerOf([{ day: '2026-05-04', amount: 100 }]), '2026-08');
    expect(bounds.earliest).toBe('2026-05');
    expect(canStepBack('2026-06', bounds)).toBe(true);
    expect(canStepBack('2026-05', bounds)).toBe(false);
  });

  it('leaves the empty months in between reachable', () => {
    const bounds = financeMonthBounds(ledgerOf([{ day: '2026-05-04', amount: 100 }]), '2026-08');
    /* A gap in somebody's records is information, not an error. */
    for (const month of ['2026-06', '2026-07']) {
      expect(clampMonth(month, bounds)).toBe(month);
    }
  });

  it('pulls a selection back inside bounds that have moved', () => {
    const bounds = financeMonthBounds(empty, '2026-08');
    expect(clampMonth('2026-11', bounds)).toBe('2026-08');
    expect(clampMonth('2025-01', bounds)).toBe('2026-08');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The screen
// ─────────────────────────────────────────────────────────────────────────────

describe('Spending opens on this month', () => {
  it('shows the current month and only its transactions', async () => {
    await renderWith([
      { day: '2026-08-27', amount: 1234 },
      { day: '2026-07-15', amount: 5000 },
    ]);

    expect(label()).toBe('August 2026');
    expect(listRows().getByText('12.34 AED')).toBeTruthy();
    expect(listRows().queryByText('50.00 AED')).toBeNull();
  });

  it('states income, spent and net for the month', async () => {
    await renderWith([
      { day: '2026-08-02', amount: 1000, income: true },
      { day: '2026-08-27', amount: 250 },
    ]);

    const totals = within(screen.getByTestId('finance-month-totals'));
    expect(totals.getByText('10.00 AED')).toBeTruthy();
    expect(totals.getByText('2.50 AED')).toBeTruthy();
    expect(totals.getByText('+7.50 AED')).toBeTruthy();
  });

  it('signs a negative net rather than colouring it', async () => {
    await renderWith([{ day: '2026-08-27', amount: 250 }]);
    /* A sign survives greyscale and colour blindness; a red number does not. */
    expect(screen.getByTestId('finance-total-net').props.accessibilityLabel).toBe('Net, −2.50 AED');
  });

  it('steps to the previous month and back', async () => {
    await renderWith([
      { day: '2026-08-27', amount: 1234 },
      { day: '2026-07-15', amount: 5000 },
    ]);

    await press(screen.getByTestId('finance-month-previous'));
    expect(label()).toBe('July 2026');
    expect(listRows().getByText('50.00 AED')).toBeTruthy();
    expect(listRows().queryByText('12.34 AED')).toBeNull();

    await press(screen.getByTestId('finance-month-next'));
    expect(label()).toBe('August 2026');
  });

  it('says a month is empty without saying the ledger is', async () => {
    await renderWith([
      { day: '2026-08-27', amount: 1234 },
      { day: '2026-06-15', amount: 5000 },
    ]);

    await press(screen.getByTestId('finance-month-previous'));
    expect(label()).toBe('July 2026');
    expect(screen.getByText('Nothing recorded in July 2026')).toBeTruthy();
    expect(screen.getByText(/Your other entries are still here/)).toBeTruthy();
    expect(screen.queryByText('Nothing recorded yet')).toBeNull();
  });

  it('still says nothing recorded yet when that is the truth', async () => {
    await renderWith([]);
    expect(screen.getByText('Nothing recorded yet')).toBeTruthy();
    expect(screen.queryByText(/Nothing recorded in [A-Z]/)).toBeNull();
  });

  it('refuses to step past this month with nothing later recorded', async () => {
    await renderWith([{ day: '2026-08-27', amount: 1234 }]);

    const next = screen.getByTestId('finance-month-next');
    expect(next.props.accessibilityState?.disabled).toBe(true);
    await press(next);
    expect(label()).toBe('August 2026');
  });

  it('allows it when the user has future-dated a transaction', async () => {
    await renderWith([
      { day: '2026-08-27', amount: 1234 },
      { day: '2026-09-03', amount: 4444 },
    ]);

    const next = screen.getByTestId('finance-month-next');
    expect(next.props.accessibilityState?.disabled).toBe(false);
    await press(next);
    expect(label()).toBe('September 2026');
    expect(listRows().getByText('44.44 AED')).toBeTruthy();
  });

  it('follows the shared day source across a month boundary', async () => {
    /*
      No second clock: the day source owns midnight, and the month is derived from the day it
      states. Driving the shared harness is what proves that, rather than reading the source.
    */
    await renderWith([
      { day: '2026-08-31', amount: 1000 },
      { day: '2026-09-01', amount: 2000 },
    ]);
    expect(label()).toBe('August 2026');

    await act(async () => {
      harness?.setNow(new Date(2026, 8, 1, 0, 0, 1));
      harness?.fireMidnight();
      await Promise.resolve();
    });
    await settle();

    expect(label()).toBe('September 2026');
    expect(listRows().getByText('20.00 AED')).toBeTruthy();
    expect(listRows().queryByText('10.00 AED')).toBeNull();
  });

  it('follows a foreground reconciliation across a month boundary too', async () => {
    await renderWith([{ day: '2026-09-01', amount: 2000 }]);
    expect(label()).toBe('August 2026');

    await act(async () => {
      harness?.setNow(new Date(2026, 8, 1, 8, 30, 0));
      harness?.sendAppState('active');
      await Promise.resolve();
    });
    await settle();

    expect(label()).toBe('September 2026');
  });

  it('keeps the month the user chose while the app re-renders', async () => {
    await renderWith([
      { day: '2026-08-27', amount: 1234 },
      { day: '2026-07-15', amount: 5000 },
    ]);

    await press(screen.getByTestId('finance-month-previous'));
    expect(label()).toBe('July 2026');

    /* Opening the composer re-renders everything; the chosen month is state, not a derivation. */
    await press(screen.getByTestId('finance-open-composer'));
    expect(label()).toBe('July 2026');
  });
});

describe('a custom range and a month are told apart', () => {
  async function withTwoMonths() {
    return renderWith([
      { day: '2026-08-27', amount: 1234 },
      { day: '2026-07-15', amount: 5000 },
    ]);
  }

  it('replaces the month with the range, and says so', async () => {
    await withTwoMonths();
    await type('finance-filters-from', '2026-07-01');

    expect(screen.getByTestId('finance-month-superseded')).toBeTruthy();
    expect(screen.getByText(/A date range is in force/)).toBeTruthy();
    /* Both months, because the range and the month are alternatives rather than an intersection. */
    expect(listRows().getByText('50.00 AED')).toBeTruthy();
    expect(listRows().getByText('12.34 AED')).toBeTruthy();
    expect(screen.getByText(/Selected range \(2\)/)).toBeTruthy();
  });

  it('disables the stepper while a range is in force', async () => {
    await withTwoMonths();
    await type('finance-filters-from', '2026-07-01');

    expect(screen.getByTestId('finance-month-previous').props.accessibilityState?.disabled).toBe(
      true,
    );
    expect(screen.getByTestId('finance-month-next').props.accessibilityState?.disabled).toBe(true);
  });

  it('totals the range rather than the month', async () => {
    await withTwoMonths();
    await type('finance-filters-from', '2026-07-01');

    const totals = within(screen.getByTestId('finance-month-totals'));
    expect(totals.getByText('62.34 AED')).toBeTruthy();
  });

  it('returns to the month when the range is cleared', async () => {
    await withTwoMonths();
    await type('finance-filters-from', '2026-07-01');

    expect(screen.getByText('Clear filters and return to months')).toBeTruthy();
    await press(screen.getByTestId('finance-filters-clear'));

    expect(screen.queryByTestId('finance-month-superseded')).toBeNull();
    expect(screen.getByText(/August 2026 \(1\)/)).toBeTruthy();
    expect(listRows().queryByText('50.00 AED')).toBeNull();
  });

  it('lets a category narrow the month without becoming a range', async () => {
    const storage = memory();
    const subject = repo(storage);
    await subject.setCurrency('AED');
    await subject.createTransaction({
      direction: 'expense',
      amountMinor: 100,
      occurredOn: '2026-08-27',
      category: 'Food',
    });
    await subject.createTransaction({
      direction: 'expense',
      amountMinor: 200,
      occurredOn: '2026-08-27',
      category: 'Travel',
    });
    await render(
      <FinanceProvider repository={repo(storage)}>
        <FinanceSpendingScreen />
      </FinanceProvider>,
    );
    await settle();

    await press(screen.getByTestId('finance-filters-category-Food'));

    expect(screen.queryByTestId('finance-month-superseded')).toBeNull();
    expect(label()).toBe('August 2026');
    expect(listRows().getByText('1.00 AED')).toBeTruthy();
    expect(listRows().queryByText('2.00 AED')).toBeNull();
  });
});
