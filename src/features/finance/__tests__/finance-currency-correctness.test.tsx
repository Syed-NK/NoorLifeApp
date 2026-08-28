import fs from 'node:fs';
import path from 'node:path';

import { act, render, screen } from '@testing-library/react-native';

import { LocalizationProvider } from '@application/providers/localization-provider';
import { pinModuleWindow } from '@/test-support/module-window';
import { installPlannerDaySource, type PlannerDayHarness } from '@/test-support/planner-day';

import { progressForMonth } from '../data/finance-budget-progress';
import { compareFinanceMonths, percentTenthsOf } from '../data/finance-comparison';
import { describeChange, SPENDING_SUBJECT } from '../data/finance-comparison-copy';
import { formatAmount, formatMinor, parseAmountToMinor } from '../data/finance-format';
import { goalsProgress } from '../data/finance-goal-progress';
import { createFinanceGoalRepository } from '../data/finance-goal.repository';
import {
  FALLBACK_SEPARATORS,
  FINANCE_GROUP_SIZE,
  financeSeparators,
  groupDigits,
} from '../data/finance-locale';
import { isFinanceBudget, parseFinanceBudgetsEnvelope } from '../data/finance-budget';
import { isFinanceGoal, parseFinanceGoalsEnvelope } from '../data/finance-goal';
import {
  isFinanceTransaction,
  parseFinanceLedgerEnvelope,
  type FinanceLedger,
  type FinanceTransaction,
} from '../data/finance-ledger';
import {
  createFinanceLedgerRepository,
  financeBudgetsAddress,
  financeGoalsAddress,
  financeLedgerAddress,
  type FinanceStorage,
} from '../data/finance-ledger.repository';
import {
  FINANCE_CURRENCIES,
  MAX_MINOR_UNITS,
  isFinanceCurrency,
  minorUnitDigits,
  type FinanceCurrency,
} from '../data/finance-money';
import { totalFinance } from '../data/finance-selectors';
import { FinanceProvider } from '../di/finance-provider';
import { financeMoney } from '../di/use-finance-money';
import { FinanceSpendingScreen } from '../screens/finance-spending-screen';

/**
 * **Currency, minor units, rounding, negatives, large values and locale** — issue #96.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What the audit found, before any of this was written ───────────────────
 * Parsing was already correct and already currency-aware: `parseAmountToMinor` has taken the
 * currency since #93, so JPY refuses a fraction, KWD accepts three digits, AED refuses three, and
 * every amount ever stored by this app went through the right exponent. That matters more than it
 * sounds — it is what makes #96 a **presentation** correction with no migration, and the fixtures
 * below prove it rather than asserting it.
 *
 * Formatting was where it broke. `formatMinor(-5050, 'AED')` returned `"-50.-50"`: `Math.trunc` and
 * `%` each carry the sign, so a negative put a minus *inside* the fraction. Nobody had seen it
 * because every call site passed `Math.abs`, which meant the defect was one forgotten `Math.abs`
 * from a user's screen and would have arrived the moment somebody rendered a signed net directly.
 * There was also no grouping and no locale mark anywhere, so a nine-figure budget read
 * `987654321.99`.
 *
 * ── The three concerns, kept apart ─────────────────────────────────────────
 * Parsing refuses over-precision rather than rounding it. Formatting prints the stored integer's own
 * digits and rounds nothing. Only a *ratio* rounds, once, in `percentTenthsOf`. A test below states
 * that the currency's exponent has no part in the ratio.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = '3f6d2c18-9a4b-4c7e-8f21-5b7d0e9a1c42';
const AT = new Date('2026-08-10T09:00:00.000Z');
const NOW = new Date(2026, 7, 10, 9, 0, 0);
const TODAY = '2026-08-10';

/** One currency per exponent class, named so a failure says which class broke. */
const ZERO = 'JPY' as const;
const TWO = 'AED' as const;
const THREE = 'KWD' as const;

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
    id: () => 'finance.goal.cccccccc-1111-4111-8111-000000000001',
    now: () => AT,
  });

const txOf = (
  amountMinor: number,
  extra: Partial<FinanceTransaction> = {},
  index = 0,
): FinanceTransaction => ({
  id: `finance.aaaaaaaa-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
  direction: 'expense',
  amountMinor,
  occurredOn: TODAY,
  category: null,
  note: null,
  goalId: null,
  createdAt: '2026-08-10T09:00:00.000Z',
  updatedAt: '2026-08-10T09:00:00.000Z',
  ...extra,
});

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
// Currency metadata
// ─────────────────────────────────────────────────────────────────────────────

describe('one authoritative minor-unit exponent per currency', () => {
  const codes = Object.keys(FINANCE_CURRENCIES) as FinanceCurrency[];

  it('covers a reviewed, finite set with no duplicates', () => {
    expect(codes).toHaveLength(22);
    expect(new Set(codes).size).toBe(codes.length);
    /* An object literal cannot hold a duplicate key, so this states the count is the reviewed one. */
    expect(codes.every((code) => isFinanceCurrency(code))).toBe(true);
  });

  it('has all three exponent classes, and every exponent is 0, 2 or 3', () => {
    const byExponent = new Map<number, FinanceCurrency[]>();
    for (const code of codes) {
      const exponent = minorUnitDigits(code);
      byExponent.set(exponent, [...(byExponent.get(exponent) ?? []), code]);
    }
    expect([...byExponent.keys()].sort()).toEqual([0, 2, 3]);
    expect(byExponent.get(0)).toEqual(['JPY', 'KRW']);
    expect(byExponent.get(3)).toEqual(['BHD', 'KWD', 'OMR', 'TND']);
    expect(byExponent.get(2)).toHaveLength(16);
  });

  it('refuses an unknown code rather than assuming two decimals', () => {
    for (const unknown of ['XYZ', 'aed', 'US', 'USDT', '', 'EURO', null, undefined, 2]) {
      expect(isFinanceCurrency(unknown)).toBe(false);
    }
  });

  it('is the single source both the parser and the formatter read', () => {
    /*
      Asserted behaviourally rather than by import graph: change the exponent and *both* directions
      move together. A parser and a formatter holding separate tables is the defect that makes a
      value fail to round-trip through its own screen.
    */
    for (const [currency, text, minor] of [
      [ZERO, '7', 7],
      [TWO, '7', 700],
      [THREE, '7', 7000],
    ] as const) {
      const parsed = parseAmountToMinor(text, currency);
      expect(parsed).toEqual({ kind: 'ok', minor });
      expect(formatMinor(minor, currency)).toBe(
        minorUnitDigits(currency) === 0 ? '7' : `7.${'0'.repeat(minorUnitDigits(currency))}`,
      );
    }
  });

  it('keeps the whole ledger summable inside the safe-integer range', () => {
    /* #96: "Assert against `Number.MAX_SAFE_INTEGER` in minor units." */
    expect(5_000 * MAX_MINOR_UNITS).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(5_000 * MAX_MINOR_UNITS)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────────────────────

describe('parsing is integer-safe and carries the currency exponent', () => {
  it.each([
    [ZERO, '1', 1],
    [ZERO, '1234', 1234],
    [ZERO, '10000000000', 10_000_000_000],
    [TWO, '0.01', 1],
    [TWO, '1', 100],
    [TWO, '1.00', 100],
    [TWO, '0.1', 10],
    [TWO, '12.34', 1234],
    [TWO, '10000000000.00', MAX_MINOR_UNITS],
    [THREE, '0.001', 1],
    [THREE, '1', 1000],
    [THREE, '1.5', 1500],
    [THREE, '1.234', 1234],
  ])('%s accepts %p as %p minor units', (currency, text, minor) => {
    expect(parseAmountToMinor(text, currency as FinanceCurrency)).toEqual({ kind: 'ok', minor });
  });

  it('preserves leading fractional zeros rather than dropping them', () => {
    expect(parseAmountToMinor('0.05', TWO)).toEqual({ kind: 'ok', minor: 5 });
    expect(parseAmountToMinor('0.001', THREE)).toEqual({ kind: 'ok', minor: 1 });
    /* `0.010` is ten thousandths, not one — a naive trim of trailing zeros gets this wrong. */
    expect(parseAmountToMinor('0.010', THREE)).toEqual({ kind: 'ok', minor: 10 });
  });

  it('reads leading zeros truthfully', () => {
    expect(parseAmountToMinor('00012.50', TWO)).toEqual({ kind: 'ok', minor: 1250 });
    expect(parseAmountToMinor('007', ZERO)).toEqual({ kind: 'ok', minor: 7 });
  });

  it('accepts either decimal mark, because a keypad chooses which one it offers', () => {
    expect(parseAmountToMinor('1,50', TWO)).toEqual({ kind: 'ok', minor: 150 });
    expect(parseAmountToMinor('1.50', TWO)).toEqual({ kind: 'ok', minor: 150 });
  });

  it('cannot read one string two ways', () => {
    /*
      #96's ambiguity, closed by policy rather than by guessing: grouping is never accepted, so a
      separator is always the decimal mark. `1,234` is therefore 1.234 wherever it is legal at all —
      and in a 2-digit currency it is not legal, so it is refused rather than read as 1234.
    */
    expect(parseAmountToMinor('1,234', THREE)).toEqual({ kind: 'ok', minor: 1234 });
    expect(parseAmountToMinor('1,234', TWO)).toEqual({ kind: 'invalid', reason: 'too-precise' });
    expect(parseAmountToMinor('1,234', ZERO)).toEqual({ kind: 'invalid', reason: 'too-precise' });
  });

  it.each([
    ['grouped with a comma and a point', '1,234.56', TWO],
    ['grouped with points', '1.234.567', THREE],
    ['grouped with spaces', '1 234', TWO],
    ['two separators', '1,2,3', TWO],
    ['a leading sign', '-5', TWO],
    ['a positive sign', '+5', TWO],
    ['scientific notation', '1e3', TWO],
    ['a capitalised exponent', '1E3', TWO],
    ['Infinity', 'Infinity', TWO],
    ['NaN', 'NaN', TWO],
    ['letters', 'abc', TWO],
    ['a currency symbol', '$5', TWO],
    ['a trailing code', '5 AED', TWO],
  ])('refuses %s', (_why, text, currency) => {
    expect(parseAmountToMinor(text, currency as FinanceCurrency).kind).toBe('invalid');
  });

  it('refuses more fractional digits than the currency has, rather than rounding them', () => {
    expect(parseAmountToMinor('1.005', TWO)).toEqual({ kind: 'invalid', reason: 'too-precise' });
    expect(parseAmountToMinor('1.2345', THREE)).toEqual({ kind: 'invalid', reason: 'too-precise' });
    expect(parseAmountToMinor('1.0', ZERO)).toEqual({ kind: 'invalid', reason: 'too-precise' });
    /* Even a fraction that would round to itself is refused: the rule is refusal, not rounding. */
    expect(parseAmountToMinor('1.000', TWO)).toEqual({ kind: 'invalid', reason: 'too-precise' });
  });

  it('refuses empty and whitespace-only input, and trims what surrounds a real amount', () => {
    expect(parseAmountToMinor('', TWO)).toEqual({ kind: 'invalid', reason: 'empty' });
    expect(parseAmountToMinor('   ', TWO)).toEqual({ kind: 'invalid', reason: 'empty' });
    expect(parseAmountToMinor('\t\n', TWO)).toEqual({ kind: 'invalid', reason: 'empty' });
    expect(parseAmountToMinor('  1.50  ', TWO)).toEqual({ kind: 'ok', minor: 150 });
  });

  it('refuses zero where the domain requires a positive amount', () => {
    expect(parseAmountToMinor('0', TWO)).toEqual({ kind: 'invalid', reason: 'not-positive' });
    expect(parseAmountToMinor('0.00', TWO)).toEqual({ kind: 'invalid', reason: 'not-positive' });
    expect(parseAmountToMinor('0', ZERO)).toEqual({ kind: 'invalid', reason: 'not-positive' });
    expect(parseAmountToMinor('0.000', THREE)).toEqual({ kind: 'invalid', reason: 'not-positive' });
  });

  it('enforces the storable bound after conversion, never by truncating', () => {
    expect(parseAmountToMinor('10000000000.00', TWO)).toEqual({
      kind: 'ok',
      minor: MAX_MINOR_UNITS,
    });
    expect(parseAmountToMinor('10000000000.01', TWO)).toEqual({
      kind: 'invalid',
      reason: 'too-large',
    });
    expect(parseAmountToMinor('99999999999999999999', ZERO)).toEqual({
      kind: 'invalid',
      reason: 'too-large',
    });
  });

  it('gets the floating-point counterexamples exactly right', () => {
    /*
      `parseFloat('1.005') * 100` is 100.49999999999999, which rounds to 100 — a cent short, on a
      number the user typed exactly. These are the cases that make string parsing non-negotiable.
    */
    expect(parseAmountToMinor('1.10', TWO)).toEqual({ kind: 'ok', minor: 110 });
    expect(parseAmountToMinor('1.15', TWO)).toEqual({ kind: 'ok', minor: 115 });
    expect(parseAmountToMinor('8.20', TWO)).toEqual({ kind: 'ok', minor: 820 });
    expect(parseAmountToMinor('0.29', TWO)).toEqual({ kind: 'ok', minor: 29 });
    expect(parseAmountToMinor('1.005', THREE)).toEqual({ kind: 'ok', minor: 1005 });
    /* And the arithmetic route to the same value is provably not exact. */
    expect(Math.round(Number.parseFloat('1.005') * 100)).toBe(100);
  });

  it('round-trips every plain rendering back to the same integer', () => {
    for (const currency of [ZERO, TWO, THREE]) {
      for (const minor of [1, 5, 99, 100, 1_000, 123_456, MAX_MINOR_UNITS]) {
        expect(parseAmountToMinor(formatMinor(minor, currency), currency)).toEqual({
          kind: 'ok',
          minor,
        });
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────────────────────

describe('formatting prints the stored integer exactly', () => {
  it.each([
    [ZERO, 0, '0 JPY'],
    [ZERO, 1, '1 JPY'],
    [ZERO, 1234, '1,234 JPY'],
    [ZERO, 10_000_000_000, '10,000,000,000 JPY'],
    [TWO, 0, '0.00 AED'],
    [TWO, 1, '0.01 AED'],
    [TWO, 50, '0.50 AED'],
    [TWO, 100, '1.00 AED'],
    [TWO, 123_456, '1,234.56 AED'],
    [TWO, MAX_MINOR_UNITS, '10,000,000,000.00 AED'],
    [THREE, 0, '0.000 KWD'],
    [THREE, 1, '0.001 KWD'],
    [THREE, 10, '0.010 KWD'],
    [THREE, 1234, '1.234 KWD'],
    [THREE, 1_234_567, '1,234.567 KWD'],
  ])('renders %s %p as %p', (currency, minor, expected) => {
    expect(formatAmount(minor, currency as FinanceCurrency)).toBe(expected);
  });

  it('keeps trailing fractional zeros, because they are the amount', () => {
    expect(formatAmount(100, TWO)).toBe('1.00 AED');
    expect(formatAmount(1000, THREE)).toBe('1.000 KWD');
    expect(formatAmount(1500, THREE)).toBe('1.500 KWD');
  });

  it('renders a sub-unit amount without inventing a leading digit', () => {
    expect(formatAmount(1, TWO)).toBe('0.01 AED');
    expect(formatAmount(1, THREE)).toBe('0.001 KWD');
  });

  it.each([
    [TWO, -1, '−0.01 AED'],
    [TWO, -5050, '−50.50 AED'],
    [TWO, -123_456, '−1,234.56 AED'],
    [ZERO, -1234, '−1,234 JPY'],
    [THREE, -1_234_567, '−1,234.567 KWD'],
  ])('renders the negative %s %p as %p', (currency, minor, expected) => {
    const rendered = formatAmount(minor, currency as FinanceCurrency);
    expect(rendered).toBe(expected);
    /* Exactly one sign, and never inside the fraction — the defect this replaced. */
    expect(rendered.match(/[−-]/g)).toHaveLength(1);
    expect(rendered.split('.')[1] ?? '').not.toMatch(/[−-]/);
  });

  it('never produces scientific notation, at any magnitude', () => {
    for (const currency of [ZERO, TWO, THREE]) {
      for (const minor of [1, MAX_MINOR_UNITS, -MAX_MINOR_UNITS, 5_000 * MAX_MINOR_UNITS]) {
        expect(formatAmount(minor, currency)).not.toMatch(/e[+-]?\d/i);
      }
    }
  });

  it('stays exact past the point a major-unit float would not', () => {
    /*
      A full ledger of maximum records: 5 × 10^15 minor units. Dividing that by 100 into a `number`
      is still representable, but the moment the bound moves it is not — and the failure would be a
      silently wrong last digit, not an error. String splitting has no such edge.
    */
    const total = 5_000 * MAX_MINOR_UNITS;
    expect(formatAmount(total, TWO)).toBe('50,000,000,000,000.00 AED');
    expect(formatAmount(total, ZERO)).toBe('5,000,000,000,000,000 JPY');
  });

  it('stays exact at the top of the safe-integer range, where a float round-trip is not', () => {
    /*
      #96: "Assert against `Number.MAX_SAFE_INTEGER` in minor units." Dividing into major units and
      multiplying back is exact for ordinary amounts and stops being exact here — which is the shape
      of the defect that only ever appears in somebody's real ledger. Splitting digit strings has no
      such edge, so the assertion is the exact digits rather than an approximation of them.
    */
    const max = Number.MAX_SAFE_INTEGER;
    expect(formatAmount(max, THREE)).toBe('9,007,199,254,740.991 KWD');
    expect(formatAmount(max, TWO)).toBe('90,071,992,547,409.91 AED');
    expect(formatAmount(max, ZERO)).toBe('9,007,199,254,740,991 JPY');
    /* And the arithmetic route provably loses the last digits at this magnitude. */
    expect(String((max / 1000) * 1000)).not.toBe(String(max));
  });

  it('names the currency by its ISO code, never a symbol', () => {
    for (const code of Object.keys(FINANCE_CURRENCIES) as FinanceCurrency[]) {
      const rendered = formatAmount(12_345, code);
      expect(rendered.endsWith(` ${code}`)).toBe(true);
      /*
        `$` is ambiguous across USD/CAD/AUD, `¥` across JPY, and `Intl`'s currency style substitutes
        both. The code is unambiguous and it is the ledger's own.
      */
      expect(rendered).not.toMatch(/[$¥£€]/);
    }
  });

  it('shows the ledger currency even when the locale belongs to another', () => {
    /* #96: "A user reading in `de-DE` with a `AED` ledger sees `1.234,56 AED`, not euros." */
    expect(formatAmount(123_456, TWO, 'de-DE')).toBe('1.234,56 AED');
    expect(formatAmount(123_456, TWO, 'en-US')).toBe('1,234.56 AED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Locale
// ─────────────────────────────────────────────────────────────────────────────

describe('a locale chooses two characters and nothing else', () => {
  it.each([
    ['en', ',', '.'],
    ['en-US', ',', '.'],
    ['de-DE', '.', ','],
    ['fr-FR', ' ', ','],
  ])('reads %s separators as group %p decimal %p', (locale, group, decimal) => {
    expect(financeSeparators(locale)).toEqual({ group, decimal });
  });

  it.each(['', 'not-a-locale', 'xx-YY-ZZ-QQ', '@@@'])(
    'falls back deterministically for the unusable locale %p',
    (locale) => {
      expect(financeSeparators(locale)).toEqual(FALLBACK_SEPARATORS);
    },
  );

  it('falls back rather than throwing when Intl is unusable', () => {
    const original = Intl.NumberFormat;
    try {
      (Intl as { NumberFormat: unknown }).NumberFormat = function Broken() {
        throw new Error('minimal ICU');
      };
      expect(financeSeparators('en')).toEqual(FALLBACK_SEPARATORS);
      expect(formatAmount(123_456, TWO, 'en')).toBe('1,234.56 AED');
    } finally {
      (Intl as { NumberFormat: unknown }).NumberFormat = original;
    }
  });

  it('falls back when formatToParts is absent, as a minimal ICU may leave it', () => {
    const original = Intl.NumberFormat;
    try {
      (Intl as { NumberFormat: unknown }).NumberFormat = function Minimal() {
        return { format: (value: number) => String(value) };
      };
      expect(financeSeparators('de-DE')).toEqual(FALLBACK_SEPARATORS);
    } finally {
      (Intl as { NumberFormat: unknown }).NumberFormat = original;
    }
  });

  it('never falls back to another currency, only to separators', () => {
    /*
      `not-a-locale` does not throw in every engine — Node accepts the tag and answers with the
      root separators — so this asserts the property that matters either way: whatever the locale
      does or does not resolve to, the currency and its exponent are untouched.
    */
    expect(formatAmount(123_456, THREE, 'not-a-locale')).toBe('123.456 KWD');
    expect(formatAmount(1_234_567, THREE, 'not-a-locale')).toBe('1,234.567 KWD');
  });

  it('keeps Western digits whatever the locale, so the amount reads beside its code', () => {
    /*
      `ar` answers with the Arabic thousands and decimal marks (U+066C, U+066B), and that is the
      locale doing exactly its job. What must not change is the *numeral system*: the digits stay
      Western so the amount reads beside a Latin ISO code rather than half-transliterated.
    */
    for (const locale of ['en', 'ar', 'ar-EG', 'de-DE']) {
      const rendered = formatAmount(123_456, TWO, locale);
      expect(rendered.replace(/[^0-9]/g, '')).toBe('123456');
      /* No Arabic-Indic or Eastern Arabic-Indic digits anywhere. */
      expect(rendered).not.toMatch(/[٠-٩۰-۹]/);
      expect(rendered.endsWith(' AED')).toBe(true);
    }
  });

  it('groups by three, the only scheme the supported locales use', () => {
    expect(FINANCE_GROUP_SIZE).toBe(3);
    expect(groupDigits('1', ',')).toBe('1');
    expect(groupDigits('123', ',')).toBe('123');
    expect(groupDigits('1234', ',')).toBe('1,234');
    expect(groupDigits('1234567', ',')).toBe('1,234,567');
    expect(groupDigits('10000000000', ',')).toBe('10,000,000,000');
    expect(groupDigits('1234', '')).toBe('1234');
  });

  it('changes nothing but presentation when the locale changes', () => {
    const ledger: FinanceLedger = { currency: TWO, transactions: [txOf(123_456)] };
    const english = financeMoney(TWO, 'en');
    const german = financeMoney(TWO, 'de-DE');

    expect(english.amount(123_456)).toBe('1,234.56 AED');
    expect(german.amount(123_456)).toBe('1.234,56 AED');
    /* Same integer, same currency, same totals — only the characters between the digits moved. */
    expect(ledger.transactions[0]?.amountMinor).toBe(123_456);
    expect(totalFinance(ledger.transactions).expenseMinor).toBe(123_456);
    expect(english.parse('1.50')).toEqual(german.parse('1.50'));
    expect(english.locale).not.toBe(german.locale);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Rounding
// ─────────────────────────────────────────────────────────────────────────────

describe('exactly one rounding rule, and it rounds only ratios', () => {
  it('rounds a ratio half away from zero, in tenths of a percent', () => {
    /* 0.05% exactly, in both directions: the half case the rule is named for. */
    expect(percentTenthsOf(1, 2000)).toBe(1);
    expect(percentTenthsOf(-1, 2000)).toBe(-1);
    expect(percentTenthsOf(3, 2000)).toBe(2);
    expect(percentTenthsOf(1, 3000)).toBe(0);
    expect(percentTenthsOf(2, 3000)).toBe(1);
  });

  it('is unaffected by the currency exponent', () => {
    /*
      A ratio is a ratio. Using the minor-unit exponent as a percentage scale would make a JPY
      ledger's percentages whole numbers and a KWD ledger's thousandths, for the same two amounts.
    */
    for (const currency of [ZERO, TWO, THREE]) {
      const ledger: FinanceLedger = {
        currency,
        transactions: [txOf(15_000, {}, 0), txOf(12_000, { occurredOn: '2026-07-10' }, 1)],
      };
      expect(compareFinanceMonths(ledger, '2026-08').spending.percentTenths).toBe(250);
    }
  });

  it('never rounds an amount — a remainder is exact subtraction', () => {
    const ledger: FinanceLedger = { currency: THREE, transactions: [txOf(1, { category: 'x' })] };
    const view = progressForMonth(
      ledger,
      [
        {
          id: 'finance.budget.bbbbbbbb-1111-4111-8111-000000000001',
          category: 'x',
          limitMinor: 1000,
          createdAt: '2026-08-01T00:00:00.000Z',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      '2026-08',
    );
    expect(view.entries[0]?.differenceMinor).toBe(999);
    expect(formatAmount(999, THREE)).toBe('0.999 KWD');
  });

  it('never yields NaN or Infinity', () => {
    for (const [difference, previous] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [MAX_MINOR_UNITS, 1],
      [1, MAX_MINOR_UNITS],
    ] as const) {
      const result = percentTenthsOf(difference, previous);
      expect(result === null || Number.isFinite(result)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Storage compatibility
// ─────────────────────────────────────────────────────────────────────────────

describe('nothing stored has to change', () => {
  /** Bytes exactly as #92/#94/#95 wrote them, before this issue existed. */
  const PRE_96_LEDGER = JSON.stringify({
    version: 1,
    currency: 'KWD',
    transactions: [
      {
        id: 'finance.aaaaaaaa-1111-4111-8111-000000000001',
        direction: 'expense',
        amountMinor: 1234,
        occurredOn: '2026-08-10',
        category: 'Groceries',
        note: null,
        createdAt: '2026-08-10T09:00:00.000Z',
        updatedAt: '2026-08-10T09:00:00.000Z',
      },
    ],
  });
  const PRE_96_BUDGETS = JSON.stringify({
    version: 1,
    budgets: [
      {
        id: 'finance.budget.bbbbbbbb-1111-4111-8111-000000000001',
        category: 'Groceries',
        limitMinor: 50_000,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ],
  });
  const PRE_96_GOALS = JSON.stringify({
    version: 1,
    goals: [
      {
        id: 'finance.goal.cccccccc-1111-4111-8111-000000000001',
        name: 'Hajj',
        targetMinor: 2_000_000,
        targetOn: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-01T00:00:00.000Z',
      },
    ],
  });

  it('decodes a pre-#96 ledger unchanged, at a three-decimal currency', () => {
    const envelope = parseFinanceLedgerEnvelope(JSON.parse(PRE_96_LEDGER));
    expect(envelope).not.toBeNull();
    expect(envelope?.version).toBe(1);
    expect(envelope?.currency).toBe('KWD');
    /*
      The compatibility question this issue had to answer: 1234 stored under KWD meant 1.234 then and
      means 1.234 now, because the parser has carried the exponent since #93. No amount is
      reinterpreted, so there is nothing to migrate.
    */
    expect(envelope?.transactions[0]?.amountMinor).toBe(1234);
    expect(formatAmount(1234, 'KWD')).toBe('1.234 KWD');
  });

  it('decodes pre-#96 budgets and goals unchanged', () => {
    expect(parseFinanceBudgetsEnvelope(JSON.parse(PRE_96_BUDGETS))?.budgets[0]?.limitMinor).toBe(
      50_000,
    );
    expect(parseFinanceGoalsEnvelope(JSON.parse(PRE_96_GOALS))?.goals[0]?.targetMinor).toBe(
      2_000_000,
    );
  });

  it('rewrites nothing on read', async () => {
    const { storage, rows } = memory();
    rows.set(String(financeLedgerAddress(OWNER)), PRE_96_LEDGER);
    rows.set(String(financeBudgetsAddress(OWNER)), PRE_96_BUDGETS);
    rows.set(String(financeGoalsAddress(OWNER)), PRE_96_GOALS);

    await ledgerRepo(storage).read();
    await goalRepo(storage).read();

    expect(rows.get(String(financeLedgerAddress(OWNER)))).toBe(PRE_96_LEDGER);
    expect(rows.get(String(financeBudgetsAddress(OWNER)))).toBe(PRE_96_BUDGETS);
    expect(rows.get(String(financeGoalsAddress(OWNER)))).toBe(PRE_96_GOALS);
  });

  it('keeps every envelope at version 1, because no stored representation changed', () => {
    for (const [file, constant] of [
      ['finance-ledger.ts', 'FINANCE_LEDGER_SCHEMA_VERSION = 1'],
      ['finance-budget.ts', 'FINANCE_BUDGETS_SCHEMA_VERSION = 1'],
      ['finance-goal.ts', 'FINANCE_GOALS_SCHEMA_VERSION = 1'],
    ] as const) {
      expect(
        fs.readFileSync(path.join(process.cwd(), 'src/features/finance/data', file), 'utf8'),
      ).toContain(constant);
    }
  });

  it('quarantines a record that carries its own currency, rather than coercing it', () => {
    /* #96: "a record whose currency does not match the ledger's ... must be quarantined." */
    expect(isFinanceTransaction({ ...txOf(1234), currency: 'JPY' })).toBe(false);
    expect(
      parseFinanceLedgerEnvelope({
        version: 1,
        currency: 'AED',
        transactions: [{ ...txOf(1234), currency: 'AED' }],
      }),
    ).toBeNull();
    expect(
      isFinanceBudget({
        id: 'finance.budget.bbbbbbbb-1111-4111-8111-000000000001',
        category: 'x',
        limitMinor: 1,
        currency: 'AED',
        createdAt: 'a',
        updatedAt: 'b',
      }),
    ).toBe(false);
    expect(
      isFinanceGoal({
        id: 'finance.goal.cccccccc-1111-4111-8111-000000000001',
        name: 'x',
        targetMinor: 1,
        targetOn: null,
        currency: 'AED',
        createdAt: 'a',
        updatedAt: 'b',
      }),
    ).toBe(false);
  });

  it('refuses an envelope whose currency is not a supported code', () => {
    expect(
      parseFinanceLedgerEnvelope({ version: 1, currency: 'XYZ', transactions: [] }),
    ).toBeNull();
    expect(
      parseFinanceLedgerEnvelope({ version: 1, currency: 'aed', transactions: [] }),
    ).toBeNull();
  });

  it('stores no currency on any record it writes', async () => {
    const { storage, rows } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('KWD');
    await ledger.createTransaction({ direction: 'expense', amountMinor: 1234, occurredOn: TODAY });
    const stored = JSON.parse(String(rows.get(String(financeLedgerAddress(OWNER))))) as {
      transactions: Record<string, unknown>[];
    };
    expect(Object.keys(stored.transactions[0] as object)).not.toContain('currency');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-feature
// ─────────────────────────────────────────────────────────────────────────────

describe('every Finance surface reads the same contract', () => {
  it('formats a three-decimal ledger identically in comparison copy and on a row', () => {
    const phrasing = describeChange(
      {
        currentMinor: 15_000,
        previousMinor: 12_000,
        differenceMinor: 3_000,
        percentTenths: 250,
        trend: 'increase',
      },
      SPENDING_SUBJECT,
      THREE,
      '2026-07',
    );
    expect(phrasing.sentence).toContain(formatAmount(3_000, THREE));
    expect(phrasing.sentence).toContain('3.000 KWD');
  });

  it('threads the locale into comparison copy', () => {
    const change = {
      currentMinor: 150_000,
      previousMinor: 120_000,
      differenceMinor: 30_000,
      percentTenths: 250,
      trend: 'increase' as const,
    };
    expect(describeChange(change, SPENDING_SUBJECT, TWO, '2026-07', 'de-DE').sentence).toContain(
      '300,00 AED',
    );
    expect(describeChange(change, SPENDING_SUBJECT, TWO, '2026-07', 'en').sentence).toContain(
      '300.00 AED',
    );
  });

  it('agrees across Budgets, Savings and the ledger for the same integer', () => {
    const minor = 1_234_567;
    const money = financeMoney(THREE, 'en');
    expect(money.amount(minor)).toBe('1,234.567 KWD');
    expect(
      goalsProgress({ currency: THREE, transactions: [] }, [
        {
          id: 'finance.goal.cccccccc-1111-4111-8111-000000000001',
          name: 'Hajj',
          targetMinor: minor,
          targetOn: null,
          createdAt: 'a',
          updatedAt: 'b',
        },
      ]).entries[0]?.targetMinor,
    ).toBe(minor);
  });

  it('renders a three-decimal amount and a signed net on the Spending screen', async () => {
    const { storage } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('KWD');
    await ledger.createTransaction({
      direction: 'expense',
      amountMinor: 1_234_567,
      occurredOn: TODAY,
    });

    await render(
      <LocalizationProvider>
        <FinanceProvider repository={ledgerRepo(storage)}>
          <FinanceSpendingScreen />
        </FinanceProvider>
      </LocalizationProvider>,
    );
    await settle();

    expect(screen.getByTestId('finance-total-expense').props.accessibilityLabel).toBe(
      'Spent, 1,234.567 KWD',
    );
    /* Signed, and with exactly one sign — the negative the old formatter could not render. */
    expect(screen.getByTestId('finance-total-net').props.accessibilityLabel).toBe(
      'Net, −1,234.567 KWD',
    );
  });

  it('agrees between the visible amount and its accessibility label', async () => {
    const { storage } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('JPY');
    await ledger.createTransaction({
      direction: 'expense',
      amountMinor: 1_234_567,
      occurredOn: TODAY,
    });

    await render(
      <LocalizationProvider>
        <FinanceProvider repository={ledgerRepo(storage)}>
          <FinanceSpendingScreen />
        </FinanceProvider>
      </LocalizationProvider>,
    );
    await settle();

    const row = screen.getByTestId('finance-total-expense');
    expect(row.props.accessibilityLabel).toContain('1,234,567 JPY');
    /*
      The same string appears on more than one surface of this screen — the total, the row and the
      month comparison — which is the agreement being asserted, so every occurrence is collected
      rather than one being singled out.
    */
    const visible = screen.getAllByText('1,234,567 JPY');
    expect(visible.length).toBeGreaterThanOrEqual(2);
  });
});

describe('a screen follows the app locale, not one of its own', () => {
  it('re-renders Spending amounts in the locale the provider states', async () => {
    /*
      The behavioural half of the contract. A screen that bound `financeMoney(currency, 'en')` would
      pass every formatting test in this file and still ignore the app's own locale — so this drives
      the real provider and reads the rendered characters.
    */
    const { storage } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    await ledger.createTransaction({
      direction: 'expense',
      amountMinor: 123_456,
      occurredOn: TODAY,
    });

    const view = await render(
      <LocalizationProvider locale="en">
        <FinanceProvider repository={ledgerRepo(storage)}>
          <FinanceSpendingScreen />
        </FinanceProvider>
      </LocalizationProvider>,
    );
    await settle();
    expect(screen.getByTestId('finance-total-expense').props.accessibilityLabel).toBe(
      'Spent, 1,234.56 AED',
    );

    await view.rerender(
      <LocalizationProvider locale="ar">
        <FinanceProvider repository={ledgerRepo(storage)}>
          <FinanceSpendingScreen />
        </FinanceProvider>
      </LocalizationProvider>,
    );
    await settle();

    const arabic = screen.getByTestId('finance-total-expense').props.accessibilityLabel as string;
    /*
      The screen renders whatever the *provider's* locale produces, whatever that is on this runtime.
      Asserted as agreement with the binding rather than as a fixed string, because the same locale
      does not produce the same separators everywhere: plain Node answers  with the Arabic marks
      U+066C and U+066B, and this Jest environment answers it with ASCII — which is precisely the ICU
      variance the formatter is built to tolerate, and the reason correctness never depends on it.
      The literal-locale guard below is what pins the *binding* itself.
    */
    expect(arabic).toBe(`Spent, ${formatAmount(123_456, TWO, 'ar')}`);
    expect(arabic.replace(/[^0-9]/g, '')).toBe('123456');
    expect(arabic.endsWith('AED')).toBe(true);
  });

  it('binds no screen to a literal locale', () => {
    for (const file of [
      'finance-spending-screen.tsx',
      'finance-budgets-screen.tsx',
      'finance-savings-screen.tsx',
      'finance-home-content.tsx',
      'finance-receipts-screen.tsx',
    ]) {
      const source = fs.readFileSync(
        path.join(process.cwd(), 'src/features/finance/screens', file),
        'utf8',
      );
      /* `financeMoney(currency, 'en')` is the mutation this refuses. */
      expect(source).not.toMatch(/financeMoney\([^)]*,\s*'[a-z]{2}(-[A-Z]{2})?'\s*\)/);
      expect(source).toMatch(/useFinanceLocale\(\)/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source guards
// ─────────────────────────────────────────────────────────────────────────────

describe('the money contract has one implementation', () => {
  const FINANCE_SOURCES = (() => {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') {
            walk(full);
          }
        } else if (/\.tsx?$/.test(entry.name)) {
          found.push(full);
        }
      }
    };
    walk(path.join(process.cwd(), 'src/features/finance'));
    return found;
  })();

  const body = (file: string) =>
    fs
      .readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('found the Finance sources to guard', () => {
    expect(FINANCE_SOURCES.length).toBeGreaterThanOrEqual(18);
  });

  it.each(FINANCE_SOURCES.map((f) => [path.relative(process.cwd(), f).replace(/\\/g, '/'), f]))(
    '%s uses no float money arithmetic',
    (_name, file: string) => {
      const source = body(file);
      expect(source).not.toMatch(/parseFloat/);
      expect(source).not.toMatch(/Number\.parseFloat/);
      expect(source).not.toMatch(/toFixed/);
      /* `× 100` and `÷ 100` are the two-decimal assumption written as arithmetic. */
      expect(source).not.toMatch(/\*\s*100\b/);
      expect(source).not.toMatch(/\/\s*100\b/);
    },
  );

  it.each(FINANCE_SOURCES.map((f) => [path.relative(process.cwd(), f).replace(/\\/g, '/'), f]))(
    '%s holds no currency metadata of its own',
    (_name, file: string) => {
      const source = body(file);
      if (file.endsWith('finance-money.ts')) {
        return;
      }
      /* No local exponent table, and no symbol inference. */
      expect(source).not.toMatch(/minorDigits\s*[:=]\s*\d/);
      expect(source).not.toMatch(/currencySymbol|symbolFor|\bsymbols\b/);
      expect(source).not.toMatch(/style:\s*'currency'/);
    },
  );

  it('asks Intl for separators only, never for money', () => {
    const locale = body(path.join(process.cwd(), 'src/features/finance/data/finance-locale.ts'));
    expect(locale).toContain('formatToParts');
    expect(locale).not.toMatch(/style:\s*'currency'/);
    /* Everywhere else in Finance, Intl is not used at all. */
    for (const file of FINANCE_SOURCES) {
      if (file.endsWith('finance-locale.ts')) {
        continue;
      }
      expect(body(file)).not.toMatch(/\bIntl\./);
    }
  });

  it('reads no locale except through the app authority', () => {
    for (const file of FINANCE_SOURCES) {
      const source = body(file);
      expect(source).not.toMatch(/getLocales|I18nManager|resolvedOptions\(\)/);
    }
  });

  it('reaches no network and holds no rate', () => {
    for (const file of FINANCE_SOURCES) {
      const source = body(file);
      expect(source).not.toMatch(/exchangeRate|conversionRate|fetch\(|axios|https?:\/\//);
    }
  });

  it('leaves no screen formatting or parsing money directly', () => {
    for (const file of FINANCE_SOURCES.filter((f) => f.includes('screens'))) {
      const source = body(file);
      expect(source).not.toMatch(/\bformatAmount\(/);
      expect(source).not.toMatch(/\bformatMinor\(/);
      expect(source).not.toMatch(/\bparseAmountToMinor\(/);
      expect(source).toMatch(/financeMoney\(/);
    }
  });
});
