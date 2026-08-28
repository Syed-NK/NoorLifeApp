import fs from 'node:fs';
import path from 'node:path';

import { StyleSheet } from 'react-native';

import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { pinModuleWindow } from '@/test-support/module-window';
import { installPlannerDaySource, type PlannerDayHarness } from '@/test-support/planner-day';

import { moduleAIPolicies } from '@features/modules/module-ai-policy';
import { moduleRegistry } from '@features/modules/module-registry';
import { ModuleHomeScreen } from '@features/modules/screens/module-home-screen';

import { formatMinor, parseAmountToMinor, searchCurrencies } from '../data/finance-format';
import type { FinanceLedger } from '../data/finance-ledger';
import {
  createFinanceLedgerRepository,
  type FinanceStorage,
} from '../data/finance-ledger.repository';
import { isFinanceCurrency, type FinanceCurrency } from '../data/finance-money';
import {
  NO_FINANCE_FILTERS,
  filterFinanceTransactions,
  financeCategories,
  groupFinanceByDay,
  normaliseRange,
  summariseFinance,
} from '../data/finance-selectors';
import { FinanceProvider } from '../di/finance-provider';
import { FinanceSpendingScreen } from '../screens/finance-spending-screen';

/**
 * **Spending: the first Finance screen that records anything** — issue #93.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Against the real repository ────────────────────────────────────────────
 * Every render here is backed by `createFinanceLedgerRepository` over in-memory storage, not by a
 * hand-written stand-in. A second implementation of the same rules is a second place for them to be
 * wrong, and the rules — the currency lock, the quarantine, the serialized writes — are exactly what
 * this screen must not be able to bypass.
 *
 * ── The two properties that matter most ────────────────────────────────────
 * Amounts must survive being typed. `Math.round(parseFloat('1.005') * 100)` is 100, a cent short of
 * what the user entered, and on a ledger that is a defect rather than a rounding curiosity.
 *
 * Propagation must be immediate. The Finance home and Main Home read the one provider from #92, so a
 * transaction saved here reaches both without a relaunch — the property Planner's #72/#73
 * established and its regression proved.
 *
 * ── Why `fireEvent` inside `act`, and no `userEvent` ───────────────────────
 * `installPlannerDaySource` replaces the global timer so the day can be stated rather than waited
 * for, which is incompatible with anything that sleeps — `userEvent`'s inter-event delay and
 * `waitFor`'s polling both do. `act` + `fireEvent` is what the Planner boundary suite settled on for
 * the same reason, and wrapping each event in `act` is also what makes a press after a `changeText`
 * read current state rather than stale state.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = '3f6d2c18-9a4b-4c7e-8f21-5b7d0e9a1c42';
const OTHER = '7b1e4a90-2c3d-4e5f-9a08-1d2c3b4a5e6f';
const AT = new Date('2026-08-27T09:00:00.000Z');
/** A stated clock, so "today" is a fixture rather than whatever day the suite happens to run. */
const NOW = new Date(2026, 7, 27, 9, 0, 0);
const TODAY = '2026-08-27';

const FINANCE_ROOT = path.join(process.cwd(), 'src', 'features', 'finance');
const SPENDING_SCREEN = path.join(FINANCE_ROOT, 'screens', 'finance-spending-screen.tsx');

function stripComments(file: string): string {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

let ids = 0;

function memory(seed?: Record<string, string>) {
  const rows = new Map<string, string>(Object.entries(seed ?? {}));
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
  return { rows, storage };
}

function repo(storage: FinanceStorage, ownerId: string = OWNER) {
  return createFinanceLedgerRepository({
    ownerId,
    storage,
    id: () => `finance.aaaaaaaa-1111-4111-8111-${String(++ids).padStart(12, '0')}`,
    now: () => AT,
  });
}

let harness: PlannerDayHarness | null = null;

/** One event, flushed. Anything reading state after this sees the state the event produced. */
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

/** The rendered ledger rows, scoped away from the month totals that repeat the same amounts. */
function inList() {
  return within(screen.getByTestId('finance-list'));
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderSpending(storage: FinanceStorage, ownerId: string = OWNER) {
  const view = await render(
    <FinanceProvider repository={repo(storage, ownerId)}>
      <FinanceSpendingScreen />
    </FinanceProvider>,
  );
  await settle();
  return view;
}

/** The screen with a currency already chosen — the state most of these cases start from. */
async function renderConfigured(storage: FinanceStorage) {
  await repo(storage).setCurrency('AED');
  return renderSpending(storage);
}

async function compose(
  amount: string,
  extra?: { readonly category?: string; readonly income?: boolean },
): Promise<void> {
  if (screen.queryByTestId('finance-composer') === null) {
    await press(screen.getByTestId('finance-open-composer'));
  }
  if (extra?.income === true) {
    await press(screen.getByTestId('finance-direction-income'));
  }
  await type('finance-amount', amount);
  if (extra?.category !== undefined) {
    await type('finance-category', extra.category);
  }
  await press(screen.getByTestId('finance-save'));
  await settle();
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
// Amounts
// ─────────────────────────────────────────────────────────────────────────────

describe('typed amounts become exact minor units', () => {
  it.each([
    ['1', 'AED', 100],
    ['0.1', 'AED', 10],
    ['0.01', 'AED', 1],
    ['12.34', 'AED', 1234],
    ['12,34', 'AED', 1234],
    ['.5', 'AED', 50],
    ['1.005', 'BHD', 1005],
    ['1.234', 'KWD', 1234],
    ['100', 'JPY', 100],
  ] as const)('reads %s in %s as %i', (text, currency, expected) => {
    expect(parseAmountToMinor(text, currency)).toEqual({ kind: 'ok', minor: expected });
  });

  it.each([
    ['0.29', 29],
    ['0.57', 57],
    ['1.13', 113],
    ['2.01', 201],
  ] as const)('does not lose the minor unit a float loses on %s', (text, expected) => {
    /*
      The whole reason parsing is string work. `1.13 * 100` is 112.99999999999999 in IEEE 754, so a
      float implementation reports 112 — a cent short of what the user typed, silently, on a number
      they entered exactly. These four are counterexamples found by exhaustive search over ordinary
      two-decimal amounts, so they are not a curiosity: they are what a shopping list is made of.
    */
    expect(Math.trunc(Number.parseFloat(text) * 100)).toBe(expected - 1);
    expect(parseAmountToMinor(text, 'AED')).toEqual({ kind: 'ok', minor: expected });
  });

  it('refuses what a float would silently accept', () => {
    /*
      A float parser is not only inexact, it is permissive: `parseFloat` reads '1.2.3' as 1.2 and
      '12.345' as an amount with a third decimal a two-digit currency cannot hold. Both are refused
      here, so the validation cannot be satisfied by reaching for the easier implementation.
    */
    expect(Number.parseFloat('1.2.3')).toBe(1.2);
    expect(parseAmountToMinor('1.2.3', 'AED')).toEqual({ kind: 'invalid', reason: 'malformed' });
    expect(parseAmountToMinor('12.345', 'AED')).toEqual({ kind: 'invalid', reason: 'too-precise' });
  });

  it.each([
    ['', 'AED', 'empty'],
    ['   ', 'AED', 'empty'],
    ['0', 'AED', 'not-positive'],
    ['0.00', 'AED', 'not-positive'],
    ['-5', 'AED', 'malformed'],
    ['1.2.3', 'AED', 'malformed'],
    ['abc', 'AED', 'malformed'],
    ['1 000', 'AED', 'malformed'],
    ['12.345', 'AED', 'too-precise'],
    ['1.5', 'JPY', 'too-precise'],
    ['99999999999999999', 'AED', 'too-large'],
    ['20000000000', 'AED', 'too-large'],
  ] as const)('refuses %s in %s', (text, currency, reason) => {
    expect(parseAmountToMinor(text, currency)).toEqual({ kind: 'invalid', reason });
  });

  it.each([
    [1, 'AED'],
    [1005, 'BHD'],
    [100, 'JPY'],
    [123456, 'AED'],
  ] as const)('round-trips %i %s through formatting', (minor, currency) => {
    expect(parseAmountToMinor(formatMinor(minor, currency), currency)).toEqual({
      kind: 'ok',
      minor,
    });
  });

  it('crosses no decimal point with arithmetic', () => {
    const source = stripComments(path.join(FINANCE_ROOT, 'data', 'finance-format.ts'));
    expect(source).not.toMatch(/parseFloat|\* 100|\/ 100|toFixed/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Currency setup
// ─────────────────────────────────────────────────────────────────────────────

describe('an unconfigured ledger asks before it records', () => {
  it('shows the picker instead of a composer', async () => {
    await renderSpending(memory().storage);

    expect(screen.getByTestId('finance-currency-setup')).toBeTruthy();
    expect(screen.queryByTestId('finance-composer')).toBeNull();
    expect(screen.queryByTestId('finance-open-composer')).toBeNull();
    expect(screen.getByText('Choose your currency')).toBeTruthy();
  });

  it('states that nothing is guessed from the phone', async () => {
    await renderSpending(memory().storage);
    expect(screen.getByText(/does not guess it from your/)).toBeTruthy();
  });

  it('lists code and name, and searches on both', async () => {
    await renderSpending(memory().storage);

    expect(screen.getByText('AED — UAE Dirham')).toBeTruthy();

    await type('finance-currency-search', 'yen');
    expect(screen.getByTestId('finance-currency-JPY')).toBeTruthy();
    expect(screen.queryByTestId('finance-currency-AED')).toBeNull();

    await type('finance-currency-search', 'pkr');
    expect(screen.getByTestId('finance-currency-PKR')).toBeTruthy();

    await type('finance-currency-search', 'zzz');
    expect(screen.getByTestId('finance-currency-none')).toBeTruthy();
  });

  it('offers no code the repository would refuse', () => {
    /* One registry behind both, so the picker cannot present an option that fails on selection. */
    const offered = searchCurrencies('');
    expect(offered.length).toBeGreaterThan(0);
    for (const option of offered) {
      expect(isFinanceCurrency(option.code)).toBe(true);
    }
  });

  it('reads nothing from the locale, the SIM or the device settings', () => {
    for (const file of [SPENDING_SCREEN, path.join(FINANCE_ROOT, 'data', 'finance-format.ts')]) {
      expect(stripComments(file)).not.toMatch(
        /getLocales|getCalendars|Localization|Intl\.|supportedValuesOf|countryCode|timeZone|NativeModules/,
      );
    }
  });

  it('writes the choice through the repository and moves on', async () => {
    const { storage } = memory();
    await renderSpending(storage);

    await press(screen.getByTestId('finance-currency-AED'));
    await settle();

    expect(screen.queryByTestId('finance-currency-setup')).toBeNull();
    expect(screen.getByTestId('finance-open-composer')).toBeTruthy();

    const stored = await repo(storage).read();
    expect(stored.kind === 'ok' && stored.ledger.currency).toBe('AED');
  });
});

describe('the currency is fixed once money exists', () => {
  it('can still be changed while the ledger is empty', async () => {
    const { storage } = memory();
    await renderConfigured(storage);

    await press(screen.getByTestId('finance-change-currency'));
    expect(screen.getByTestId('finance-currency-setup')).toBeTruthy();

    await press(screen.getByTestId('finance-currency-JPY'));
    await settle();

    const stored = await repo(storage).read();
    expect(stored.kind === 'ok' && stored.ledger.currency).toBe('JPY');
  });

  it('can be left alone once the picker is open', async () => {
    const { storage } = memory();
    await renderConfigured(storage);

    await press(screen.getByTestId('finance-change-currency'));
    await press(screen.getByTestId('finance-currency-cancel'));

    expect(screen.queryByTestId('finance-currency-setup')).toBeNull();
    const stored = await repo(storage).read();
    expect(stored.kind === 'ok' && stored.ledger.currency).toBe('AED');
  });

  it('withdraws the change and says why once a transaction exists', async () => {
    const { storage } = memory();
    const subject = repo(storage);
    await subject.setCurrency('AED');
    await subject.createTransaction({
      direction: 'expense',
      amountMinor: 1500,
      occurredOn: TODAY,
    });

    await renderSpending(storage);

    expect(screen.queryByTestId('finance-change-currency')).toBeNull();
    expect(screen.getByText(/Delete every entry to change it/)).toBeTruthy();
  });

  it('is refused by the store as well as hidden by the screen', async () => {
    /* Belt and braces: the control is withdrawn, and the write would be refused if it were not. */
    const { storage } = memory();
    const subject = repo(storage);
    await subject.setCurrency('AED');
    await subject.createTransaction({
      direction: 'expense',
      amountMinor: 1500,
      occurredOn: TODAY,
    });

    const result = await subject.setCurrency('USD');
    expect(result).toEqual({ kind: 'invalid', fault: 'currency-locked' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Create, edit, delete
// ─────────────────────────────────────────────────────────────────────────────

describe('recording a transaction', () => {
  it('creates an expense and lists it', async () => {
    const { storage } = memory();
    await renderConfigured(storage);
    await compose('12.34', { category: 'Food' });

    expect(inList().getByText('12.34 AED')).toBeTruthy();
    expect(inList().getByText('Expense')).toBeTruthy();
    expect(inList().getByText('Food')).toBeTruthy();

    const stored = await repo(storage).read();
    const record = stored.kind === 'ok' ? stored.ledger.transactions[0] : null;
    expect(record?.amountMinor).toBe(1234);
    expect(record?.direction).toBe('expense');
    expect(record?.category).toBe('Food');
    expect(record?.occurredOn).toBe(TODAY);
  });

  it('creates income and names the direction in words, not only colour', async () => {
    const { storage } = memory();
    await renderConfigured(storage);
    await compose('50', { income: true });

    /*
      A word, because two hues alone leave a colour-blind reader unable to tell a refund from a
      purchase — and this is the one distinction on the screen that changes what a number means.
    */
    expect(inList().getByText('Income')).toBeTruthy();
    const stored = await repo(storage).read();
    expect(stored.kind === 'ok' && stored.ledger.transactions[0]?.direction).toBe('income');
  });

  it('groups the day under the shared day source, with no clock of its own', async () => {
    const { storage } = memory();
    await renderConfigured(storage);
    await press(screen.getByTestId('finance-open-composer'));

    expect(screen.getByTestId('finance-date').props.value).toBe(TODAY);
    expect(stripComments(SPENDING_SCREEN)).not.toMatch(/new Date\(|Date\.now\(/);
  });

  it.each([
    ['12.345', /more decimal places/],
    ['0', /greater than zero/],
    ['-5', /digits and at most one decimal point/],
    ['', /Enter an amount/],
  ])('refuses %s without writing anything', async (amount, message) => {
    const { storage } = memory();
    await renderConfigured(storage);
    await compose(amount);

    expect(screen.getByText(message)).toBeTruthy();
    const stored = await repo(storage).read();
    expect(stored.kind === 'ok' && stored.ledger.transactions).toEqual([]);
  });

  it('records one transaction however fast the button is pressed twice', async () => {
    /*
      A real double tap delivers both presses inside one React batch, so a guard reading the `saving`
      *state* would still see `false` on the second. This fires two presses with no flush between
      them, which is the shape that catches it — and two records of one spend is a silent data defect
      on a ledger, not a cosmetic one.
    */
    const { storage } = memory();
    await renderConfigured(storage);

    await press(screen.getByTestId('finance-open-composer'));
    await type('finance-amount', '10');

    await act(async () => {
      const save = screen.getByTestId('finance-save');
      fireEvent.press(save);
      fireEvent.press(save);
      await Promise.resolve();
      await Promise.resolve();
    });
    await settle();

    const stored = await repo(storage).read();
    expect(stored.kind === 'ok' && stored.ledger.transactions).toHaveLength(1);
  });

  it('edits in place, keeping the id and the creation time', async () => {
    const { storage } = memory();
    const subject = repo(storage);
    await subject.setCurrency('AED');
    const created = await subject.createTransaction({
      direction: 'expense',
      amountMinor: 1000,
      occurredOn: TODAY,
    });
    const original = created.kind === 'ok' ? created.ledger.transactions[0] : null;

    await renderSpending(storage);
    await press(screen.getByTestId(`finance-edit-${original?.id ?? ''}`));

    /* The composer opens already carrying the record, so an edit corrects rather than retypes. */
    expect(screen.getByTestId('finance-amount').props.value).toBe('10.00');

    await type('finance-amount', '25');
    await press(screen.getByTestId('finance-save'));
    await settle();

    const stored = await repo(storage).read();
    const after = stored.kind === 'ok' ? stored.ledger.transactions[0] : null;
    expect(stored.kind === 'ok' && stored.ledger.transactions).toHaveLength(1);
    expect(after?.id).toBe(original?.id);
    expect(after?.createdAt).toBe(original?.createdAt);
    expect(after?.amountMinor).toBe(2500);
  });

  it('will not delete without a confirmation that says it is permanent', async () => {
    const { storage } = memory();
    const subject = repo(storage);
    await subject.setCurrency('AED');
    const created = await subject.createTransaction({
      direction: 'expense',
      amountMinor: 1000,
      occurredOn: TODAY,
    });
    const id = created.kind === 'ok' ? (created.ledger.transactions[0]?.id ?? '') : '';

    await renderSpending(storage);
    await press(screen.getByTestId(`finance-delete-${id}`));

    /* Asking is not doing: the record is still there until the confirmation is pressed. */
    expect(screen.getByTestId('finance-removal-confirmation')).toBeTruthy();
    expect(screen.getByText(/will be permanently removed\. This cannot be undone\./)).toBeTruthy();
    let stored = await repo(storage).read();
    expect(stored.kind === 'ok' && stored.ledger.transactions).toHaveLength(1);

    /* And declining leaves it there too. */
    await press(screen.getByTestId('finance-cancel-delete'));
    stored = await repo(storage).read();
    expect(stored.kind === 'ok' && stored.ledger.transactions).toHaveLength(1);

    await press(screen.getByTestId(`finance-delete-${id}`));
    await press(screen.getByTestId('finance-confirm-delete'));
    await settle();

    stored = await repo(storage).read();
    expect(stored.kind === 'ok' && stored.ledger.transactions).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reading: order, grouping, filters
// ─────────────────────────────────────────────────────────────────────────────

const ledgerOf = (
  rows: readonly { readonly day: string; readonly amount: number; readonly category?: string }[],
): FinanceLedger => ({
  currency: 'AED' as FinanceCurrency,
  transactions: rows.map((row, index) => ({
    id: `finance.aaaaaaaa-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
    direction: 'expense' as const,
    amountMinor: row.amount,
    occurredOn: row.day,
    category: row.category ?? null,
    note: null,
    createdAt: `2026-08-27T09:0${index}:00.000Z`,
    updatedAt: `2026-08-27T09:0${index}:00.000Z`,
  })),
});

describe('the list is ordered, grouped and filterable', () => {
  const ledger = ledgerOf([
    { day: '2026-08-25', amount: 100, category: 'Food' },
    { day: '2026-08-27', amount: 200, category: 'Travel' },
    { day: '2026-08-27', amount: 300, category: 'Food' },
    { day: '2026-08-26', amount: 400 },
  ]);

  it('groups by day, newest first', () => {
    const groups = groupFinanceByDay(ledger.transactions);
    expect(groups.map((group) => group.day)).toEqual(['2026-08-27', '2026-08-26', '2026-08-25']);
    expect(groups[0]?.transactions).toHaveLength(2);
  });

  it('breaks a same-day tie the same way every run', () => {
    /*
      Two records on one day need one order, and it must not be whichever the engine produced. The
      domain's sort settles it — day, then creation time, then id — so the list does not reshuffle
      between reads of identical data.
    */
    const forwards = groupFinanceByDay(ledger.transactions)[0]?.transactions.map((t) => t.id);
    const backwards = groupFinanceByDay([...ledger.transactions].reverse())[0]?.transactions.map(
      (t) => t.id,
    );
    expect(forwards).toHaveLength(2);
    expect(forwards).toEqual(backwards);
  });

  it('offers only categories actually present', () => {
    expect(financeCategories(ledger)).toEqual(['Food', 'Travel']);
    expect(financeCategories({ currency: null, transactions: [] })).toEqual([]);
  });

  it.each([
    ['category', { ...NO_FINANCE_FILTERS, category: 'Food' }, [100, 300]],
    ['a start date', { ...NO_FINANCE_FILTERS, from: '2026-08-26' }, [200, 300, 400]],
    ['an end date', { ...NO_FINANCE_FILTERS, to: '2026-08-26' }, [100, 400]],
  ] as const)('filters by %s', (_label, filters, expected) => {
    const visible = filterFinanceTransactions(ledger, filters);
    expect(visible.map((t) => t.amountMinor).sort((a, b) => a - b)).toEqual([...expected]);
  });

  it('composes every filter at once', () => {
    const visible = filterFinanceTransactions(ledger, {
      category: 'Food',
      from: '2026-08-26',
      to: '2026-08-27',
    });
    expect(visible.map((t) => t.amountMinor)).toEqual([300]);
  });

  it('includes both endpoints of a range', () => {
    const visible = filterFinanceTransactions(ledger, {
      category: null,
      from: '2026-08-25',
      to: '2026-08-25',
    });
    expect(visible.map((t) => t.amountMinor)).toEqual([100]);
  });

  it('reads a reversed range as a range, explicitly', () => {
    /*
      Normalised rather than refused. Somebody who picks the 27th and then the 25th has expressed an
      interval, and every calendar control in the world reads it that way. The swap happens in one
      place, so no comparison silently returns nothing.
    */
    const reversed = { category: null, from: '2026-08-27', to: '2026-08-25' };
    expect(normaliseRange(reversed)).toEqual({
      category: null,
      from: '2026-08-25',
      to: '2026-08-27',
    });
    expect(filterFinanceTransactions(ledger, reversed)).toHaveLength(4);
  });

  it('leaves an already-ordered range untouched', () => {
    const ordered = { category: null, from: '2026-08-25', to: '2026-08-27' };
    expect(normaliseRange(ordered)).toBe(ordered);
  });

  it('never mutates what it reads', () => {
    const before = JSON.stringify(ledger);
    filterFinanceTransactions(ledger, { category: 'Food', from: '2026-08-26', to: '2026-08-25' });
    groupFinanceByDay(ledger.transactions);
    summariseFinance(ledger, TODAY);
    expect(JSON.stringify(ledger)).toBe(before);
  });

  it('sums by direction in integers', () => {
    const base = ledgerOf([{ day: TODAY, amount: 10 }]).transactions[0];
    const mixed: FinanceLedger = {
      currency: 'AED' as FinanceCurrency,
      transactions: [
        { ...base!, direction: 'income' },
        { ...base!, id: `${base!.id}-b`, amountMinor: 1 },
      ],
    };
    /*
      The savings fields joined this shape when the cross-feature audit made the exclusion policy
      explicit. Zero here because neither record is attributed to a goal — an unattributed ledger
      summarises exactly as it did before #95.
    */
    expect(summariseFinance(mixed, TODAY)).toEqual({
      count: 2,
      todayCount: 2,
      expenseMinor: 1,
      incomeMinor: 10,
      savingsContributedMinor: 0,
      savingsWithdrawnMinor: 0,
    });
  });
});

describe('filtering from the screen', () => {
  async function withOneFoodEntry(): Promise<FinanceStorage> {
    const { storage } = memory();
    const subject = repo(storage);
    await subject.setCurrency('AED');
    await subject.createTransaction({
      direction: 'expense',
      amountMinor: 100,
      occurredOn: TODAY,
      category: 'Food',
    });
    await renderSpending(storage);
    return storage;
  }

  it('tells the user their entries are still there, and writes nothing', async () => {
    const storage = await withOneFoodEntry();

    await type('finance-filters-from', '2027-01-01');

    expect(screen.getByText('Nothing matches these filters')).toBeTruthy();
    expect(screen.getByText(/Clear the filters to see them again/)).toBeTruthy();
    expect(screen.queryByText('Nothing recorded yet')).toBeNull();

    const stored = await repo(storage).read();
    expect(stored.kind === 'ok' && stored.ledger.transactions).toHaveLength(1);

    await press(screen.getByTestId('finance-filters-clear'));
    expect(screen.queryByText('Nothing matches these filters')).toBeNull();
    expect(inList().getByText('1.00 AED')).toBeTruthy();
  });

  it('filters by a category taken from the ledger itself', async () => {
    await withOneFoodEntry();

    expect(screen.getByTestId('finance-filters-category-Food')).toBeTruthy();
    await press(screen.getByTestId('finance-filters-category-Food'));
    expect(inList().getByText('1.00 AED')).toBeTruthy();
  });

  it('says so when it has read a reversed range as a range', async () => {
    await withOneFoodEntry();

    await type('finance-filters-from', '2026-08-28');
    await type('finance-filters-to', '2026-08-01');

    expect(screen.getByText(/the other way round, so they have been read as a range/)).toBeTruthy();
    expect(inList().getByText('1.00 AED')).toBeTruthy();
  });

  it('says nothing recorded when the ledger really is empty', async () => {
    const { storage } = memory();
    await renderConfigured(storage);
    expect(screen.getByText('Nothing recorded yet')).toBeTruthy();
    expect(screen.queryByText('Nothing matches these filters')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Faults and account boundaries
// ─────────────────────────────────────────────────────────────────────────────

describe('faults are stated, never presented as empty', () => {
  it('reports a quarantined ledger and leaves the bytes alone', async () => {
    const raw = '{"version":99,"nonsense":true}';
    const address = `noorlife.finance.user.v1.${OWNER}.ledger`;
    const { storage, rows } = memory({ [address]: raw });
    await renderSpending(storage);

    expect(screen.getByTestId('finance-spending-corrupt')).toBeTruthy();
    expect(screen.getByText('Your Finance records could not be read')).toBeTruthy();
    expect(screen.getByText(/left exactly as they are on this device/)).toBeTruthy();

    /* No composer, because the first write would overwrite the bytes that were retained. */
    expect(screen.queryByTestId('finance-composer')).toBeNull();
    expect(screen.queryByTestId('finance-open-composer')).toBeNull();
    expect(rows.get(address)).toBe(raw);
  });

  it('reports an unusable store rather than an empty ledger', async () => {
    const storage: FinanceStorage = {
      getItem: async () => {
        await Promise.resolve();
        throw new Error('unavailable');
      },
      setItem: async () => {
        await Promise.resolve();
      },
    };
    await renderSpending(storage);

    expect(screen.getByTestId('finance-spending-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('finance-open-composer')).toBeNull();
  });

  it('shows one account nothing belonging to another', async () => {
    const { storage } = memory();
    const first = repo(storage, OWNER);
    await first.setCurrency('AED');
    await first.createTransaction({ direction: 'expense', amountMinor: 4200, occurredOn: TODAY });

    const view = await renderSpending(storage, OWNER);
    expect(inList().getByText('42.00 AED')).toBeTruthy();

    await act(async () => {
      view.rerender(
        <FinanceProvider repository={repo(storage, OTHER)}>
          <FinanceSpendingScreen />
        </FinanceProvider>,
      );
      await Promise.resolve();
    });
    await settle();

    /* The other account has its own, unconfigured ledger — never the first one's. */
    expect(screen.getByTestId('finance-currency-setup')).toBeTruthy();
    expect(screen.queryByText('42.00 AED')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Propagation
// ─────────────────────────────────────────────────────────────────────────────

describe('one ledger, every surface', () => {
  it('moves the Finance home off its empty state and back, with no relaunch', async () => {
    const { storage } = memory();
    const repository = repo(storage);
    await repository.setCurrency('AED');

    await render(
      <FinanceProvider repository={repository}>
        <ModuleHomeScreen moduleId="finance" />
        <FinanceSpendingScreen />
      </FinanceProvider>,
    );
    await settle();

    const entries = () => within(screen.getByTestId('finance-summary-entries'));
    expect(entries().getByText('0')).toBeTruthy();

    await compose('12.34');

    /* Two mounted surfaces, one provider — the home moved without being told to. */
    expect(entries().getByText('1')).toBeTruthy();
    expect(within(screen.getByTestId('finance-summary-spent')).getByText('12.34 AED')).toBeTruthy();

    const remove = screen.getAllByTestId(/^finance-delete-/)[0];
    expect(remove).toBeTruthy();
    await press(remove!);
    await press(screen.getByTestId('finance-confirm-delete'));
    await settle();

    expect(entries().getByText('0')).toBeTruthy();
  });

  it('shows the home nothing at all before a currency is chosen', async () => {
    const { storage } = memory();
    await render(
      <FinanceProvider repository={repo(storage)}>
        <ModuleHomeScreen moduleId="finance" />
      </FinanceProvider>,
    );
    await settle();

    /* No "0.00" in a currency the user has not picked — the inference this module refuses. */
    expect(screen.getByTestId('finance-no-currency')).toBeTruthy();
    expect(screen.getByText('No transactions yet')).toBeTruthy();
    expect(screen.queryByTestId('finance-summary')).toBeNull();
  });

  it('survives a provider remount, because the bytes are the record', async () => {
    const { storage } = memory();
    const view = await renderConfigured(storage);
    await compose('7.50');

    /*
      A fresh provider over a fresh repository, pointed at the same storage — what a relaunch does.
      Nothing is held in memory across it, so the record coming back is the stored bytes and not a
      cached copy.
    */
    await act(async () => {
      view.rerender(
        <FinanceProvider repository={repo(storage)}>
          <FinanceSpendingScreen />
        </FinanceProvider>,
      );
      await Promise.resolve();
    });
    await settle();

    expect(inList().getByText('7.50 AED')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Truthfulness and privacy
// ─────────────────────────────────────────────────────────────────────────────

describe('the screen claims only what it does', () => {
  const source = stripComments(SPENDING_SCREEN);

  it('promises no sync, server, receipt, categorisation or forecast', () => {
    expect(source).not.toMatch(
      /\b(synced?|syncing|upload|cloud|server|receipts?|forecast|predict|automatic(ally)?)\b/i,
    );
  });

  it('says where the records live', async () => {
    const { storage } = memory();
    await renderConfigured(storage);
    expect(screen.getByText(/Everything stays on this device/)).toBeTruthy();
  });

  it('keeps the whole Finance feature free of logging, network and analytics', () => {
    const walk = (dir: string): readonly string[] => {
      const found: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__tests__') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          found.push(...walk(full));
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          found.push(full);
        }
      }
      return found;
    };

    const files = walk(FINANCE_ROOT);
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      expect({
        file,
        offends: /console\.|fetch\(|axios|supabase|analytics|Sentry|track\(|Notifications\./.test(
          stripComments(file),
        ),
      }).toEqual({ file, offends: false });
    }
  });

  it('never puts an amount, a note or a category on Main Home', () => {
    /*
      The privacy line. Main Home is the screen somebody hands to a child or leaves face-up on a
      desk, so Finance's row there is a count and nothing else — no total, no category, and none of
      the free text the user typed about their own spending.
    */
    const row = stripComments(
      path.join(process.cwd(), 'src/features/home/hooks/use-finance-timeline-entries.ts'),
    );
    expect(row).not.toMatch(
      /\.note|\.category|formatAmount|formatMinor|amountMinor|expenseMinor|incomeMinor/,
    );
    expect(row).toContain('summary.todayCount');
  });

  it('leaves Money AI with no reach into the ledger', () => {
    const ai = stripComments(
      path.join(process.cwd(), 'src/features/modules/noor-ai/module-noor-ai-screen.tsx'),
    );
    expect(ai).not.toMatch(/useFinance|useOptionalFinance|finance\/data|FinanceLedger/);

    expect(moduleAIPolicies.finance.capabilities.every((c) => !c.mutatesData)).toBe(true);
  });
});

describe('nothing else in Finance became functional', () => {
  it('leaves Spending unchanged by the Savings work', () => {
    /*
      Savings was asserted here as a placeholder until #95 built it. Inverted rather than deleted:
      what this file needs to know now is that the Savings route is a real screen and that Spending
      itself did not acquire any savings behaviour along the way — #95 adds an attribution field to
      a transaction, not a goal picker to this composer.
    */
    const route = fs.readFileSync(path.join(process.cwd(), 'src/app/finance/goals.tsx'), 'utf8');
    expect(route).toContain('FinanceSavingsScreen');
    expect(route).not.toContain('ModuleSectionScreen');

    const spending = fs.readFileSync(
      path.join(process.cwd(), 'src/features/finance/screens/finance-spending-screen.tsx'),
      'utf8',
    );
    /*
      Spending *reads* the attribution, so it can label a savings transfer truthfully instead of
      calling it an ordinary expense — that is the cross-feature audit, and it is deliberate. What
      it must still not do is write one: there is no goal picker in this composer, so no draft
      assembled here carries a `goalId` key and no goal can be created or edited from Spending.
      The read is asserted positively; the write is asserted absent.
    */
    expect(spending).toContain('isSavingsTransfer');
    expect(spending).not.toMatch(/goalId:/);
    expect(spending).not.toContain('createGoal');
    expect(spending).not.toContain('updateGoal');
    expect(spending).not.toContain('removeGoal');
  });

  it('leaves Bank sync and Receipts unavailable and unreachable', () => {
    for (const key of ['bank-sync', 'receipts']) {
      const capability = moduleRegistry.finance.capabilities.find((item) => item.key === key);
      expect(capability?.available).toBe(false);
      expect(capability?.href).toBeUndefined();
    }
  });

  it('keeps all five Finance tabs', () => {
    expect(moduleRegistry.finance.navigation.map((item) => item.href)).toEqual([
      '/finance',
      '/finance/transactions',
      '/finance/ai',
      '/finance/budgets',
      '/finance/goals',
    ]);
  });

  it('sends Add expense to Spending with a typed intent, and Transactions without one', () => {
    const action = moduleRegistry.finance.quickActions.find((item) => item.key === 'add-expense');
    expect(action?.href).toBe('/finance/transactions?intent=add-expense');

    const tab = moduleRegistry.finance.navigation.find((item) => item.key === 'transactions');
    expect(tab?.href).toBe('/finance/transactions');
  });

  it('opens the list without forcing create mode when no intent is carried', async () => {
    const { storage } = memory();
    await renderConfigured(storage);
    /* Ordinary navigation lands on the ledger, not on a form nobody asked for. */
    expect(screen.queryByTestId('finance-composer')).toBeNull();
    expect(screen.getByTestId('finance-open-composer')).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Accessibility
// ─────────────────────────────────────────────────────────────────────────────

describe('accessibility', () => {
  it('labels every field', async () => {
    const { storage } = memory();
    await renderConfigured(storage);
    await press(screen.getByTestId('finance-open-composer'));

    expect(screen.getByTestId('finance-amount').props.accessibilityLabel).toBe('Amount in AED');
    expect(screen.getByTestId('finance-date').props.accessibilityLabel).toBe('Date');
    expect(screen.getByTestId('finance-category').props.accessibilityLabel).toBe('Category');
    expect(screen.getByTestId('finance-note').props.accessibilityLabel).toBe('Note');
  });

  it('gives the direction control a radio role and a selected state', async () => {
    const { storage } = memory();
    await renderConfigured(storage);
    await press(screen.getByTestId('finance-open-composer'));

    const expense = screen.getByTestId('finance-direction-expense');
    const income = screen.getByTestId('finance-direction-income');
    expect(expense.props.accessibilityRole).toBe('radio');
    expect(expense.props.accessibilityState?.selected).toBe(true);
    expect(income.props.accessibilityState?.selected).toBe(false);

    await press(income);
    expect(screen.getByTestId('finance-direction-income').props.accessibilityState?.selected).toBe(
      true,
    );
  });

  it('floors every choice control at the touch minimum, unscaled', async () => {
    /* A bound, not a dimension — issue #84's rule, so it must not shrink with the font scale. */
    const { storage } = memory();
    await renderConfigured(storage);
    await press(screen.getByTestId('finance-open-composer'));

    for (const testID of ['finance-direction-expense', 'finance-direction-income']) {
      const flat = StyleSheet.flatten(screen.getByTestId(testID).props.style) as {
        readonly minHeight?: number;
      };
      expect(flat.minHeight).toBe(44);
    }
  });
});
