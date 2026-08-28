import type { FinanceLedger, FinanceTransaction } from './finance-ledger';
import { previousMonth, type FinanceMonth } from './finance-month';
import {
  NO_FINANCE_FILTERS,
  filterFinanceTransactions,
  totalFinance,
  type FinanceTotals,
} from './finance-selectors';

/**
 * **One month set against the one before it, derived and without judgement** — issue #102.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Nothing here is stored, and that is the point ──────────────────────────
 * Every figure is computed on read from the ledger, exactly as #93's totals are. A written-down
 * comparison can disagree with the records it compares, and then there are two answers with no way
 * to tell which is right. So there is no monthly aggregate in the envelope, no cache and no second
 * copy of a transaction — the repository has no method that could write one.
 *
 * ── The two months are read from the whole ledger, never from the visible rows ──
 * `compareFinanceMonths` takes the ledger and applies `NO_FINANCE_FILTERS`. That is deliberate, and
 * it is the defect this file exists to avoid: the Spending screen's list is narrowed by category and
 * by date range, and deriving a *monthly* comparison from whatever rows happen to be on screen would
 * silently report a fraction of a month as the month. The comparison describes the two calendar
 * months in full, and it says which two by name.
 *
 * ── The month is a prefix, still ───────────────────────────────────────────
 * `previousMonth` and the month scope are #93's string arithmetic. No `Date` is constructed anywhere
 * in this file. `new Date('2026-03-01')` is UTC midnight, which is February for anyone west of
 * Greenwich, so a `Date`-based month reading files a user's 1 March spend under the wrong month —
 * and only for them. String prefixes also dispose of February: 28, 29, 30 and 31-day months are one
 * code path and a leap year needs no case of its own. January's previous month is December of the
 * year before, which is `finance-month.ts`'s single carry.
 *
 * ── Why a percentage is sometimes absent, and why that is not a gap ────────
 * A percentage needs a baseline greater than zero. When last month was nothing, `+∞%` and `+100%`
 * are both *false descriptions* of "there was nothing before and now there is something" — the first
 * is not a number and the second claims a doubling that did not happen. So the percentage is `null`
 * and the state is stated in words instead, beside the absolute figure, which is the honest answer
 * and the one the user can actually read. Nothing downstream may invent one: `percentTenths` is
 * `null` rather than `0`, so a renderer that forgot the case shows nothing instead of a lie.
 *
 * The mirror case — something last month, nothing this month — *does* have a defined percentage. It
 * is exactly −100%, and saying so is true.
 *
 * ── Signed net is compared, but never as a percentage of a signed baseline ──
 * "From −100 to +50" is not "+150%"; a ratio taken across zero has no meaning a reader could use. So
 * there is one rule, applied everywhere: a percentage exists only when the previous figure is
 * **greater than zero**. A net that was negative or zero last month is compared by its exact
 * absolute movement, and by nothing else.
 *
 * ── Integers, and the one place a ratio is unavoidable ─────────────────────
 * Money is added as integer minor units inside #92's bound: 5,000 records of 10^12 is 5 × 10^15,
 * within the safe-integer range. A percentage is a *ratio*, not money, and cannot be an integer — so
 * it is carried as tenths of a percent, rounded half away from zero, and computed with `BigInt`
 * because the intermediate `2000 × difference` leaves the safe range at the ledger's own bound.
 * Doing it in doubles would be exact for every ordinary ledger and quietly wrong for a large one,
 * which is the class of defect that only ever shows up in somebody's real records.
 *
 * ── What this file will not do ─────────────────────────────────────────────
 * No forecast, no score, no grade, no advice and no adjective. "Good month" and "you overspent" are
 * judgements about a person's money made from two data points. Stating a difference is the whole
 * job, so this module returns figures and a direction, and the words that describe them are plain.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * How one figure moved.
 *
 * `new-activity`, `ceased-activity` and `no-activity` are kept apart from `increase`/`decrease`
 * because they are different facts, and a screen that rendered "+100%" for the first would be
 * describing a change against a previous value that does not exist.
 */
export type FinanceTrend =
  | 'increase'
  | 'decrease'
  | 'unchanged'
  /** Nothing before, something now. No percentage exists. */
  | 'new-activity'
  /** Something before, nothing now. The percentage is exactly −100%. */
  | 'ceased-activity'
  /** Nothing in either month. */
  | 'no-activity';

export type FinanceChange = {
  readonly currentMinor: number;
  readonly previousMinor: number;
  /** `current − previous`. Signed, and exact: a decrease keeps its full magnitude. */
  readonly differenceMinor: number;
  /**
   * Tenths of a percent, rounded half away from zero, or `null` when no percentage is defined.
   *
   * Tenths rather than whole percent so a small but real movement is not rendered as "0%", and
   * `null` rather than `0` so an absent percentage cannot be mistaken for no change.
   */
  readonly percentTenths: number | null;
  readonly trend: FinanceTrend;
};

export type FinanceCategoryChange = {
  /** The category as recorded, or `null` for spending filed without one. */
  readonly category: string | null;
  readonly change: FinanceChange;
};

export type FinanceMonthComparison = {
  /** The month being described. */
  readonly month: FinanceMonth;
  /** The month it is set against — always the calendar month immediately before. */
  readonly previous: FinanceMonth;
  readonly currentTotals: FinanceTotals;
  readonly previousTotals: FinanceTotals;
  /** Expense against expense. */
  readonly spending: FinanceChange;
  /** Income against income. */
  readonly income: FinanceChange;
  /** Signed net against signed net. */
  readonly net: FinanceChange;
  /** Expense movement per category, largest movement first. Only categories that actually moved. */
  readonly categories: readonly FinanceCategoryChange[];
  /** How many categories were spent on in both months at exactly the same total. */
  readonly unchangedCategoryCount: number;
};

/**
 * Tenths of a percent of `previousMinor`, rounded half away from zero.
 *
 * `round(1000 · d / p)` is `floor((2000 · d + p) / (2p))` for a positive `d` — one truncating
 * division, and no floating point anywhere. `BigInt` because `2000 × 5 × 10^15` is past
 * `Number.MAX_SAFE_INTEGER` at the ledger's own bound; a double would be exact for every ordinary
 * ledger and silently wrong for a large one, and "wrong only sometimes" is the worst outcome
 * available here.
 *
 * Returns `null` when there is no baseline to be a percentage of. There is no fallback value,
 * deliberately: a caller must handle the absence, because inventing one is the defect.
 */
export function percentTenthsOf(differenceMinor: number, previousMinor: number): number | null {
  if (previousMinor <= 0) {
    return null;
  }
  if (differenceMinor === 0) {
    return 0;
  }
  const negative = differenceMinor < 0;
  const magnitude = BigInt(Math.abs(differenceMinor));
  const baseline = BigInt(previousMinor);
  const tenths = Number((2000n * magnitude + baseline) / (2n * baseline));
  return negative ? -tenths : tenths;
}

/**
 * Compares a figure that cannot be negative — spending, or income.
 *
 * The zero cases are named rather than collapsed. "Nothing in either month" and "something last
 * month, nothing this month" are different facts about someone's records, and only one of them has a
 * percentage.
 */
export function compareMagnitude(currentMinor: number, previousMinor: number): FinanceChange {
  const differenceMinor = currentMinor - previousMinor;
  if (previousMinor === 0) {
    return {
      currentMinor,
      previousMinor,
      differenceMinor,
      /* No baseline, so no percentage — not zero, and certainly not a hundred. */
      percentTenths: null,
      trend: currentMinor === 0 ? 'no-activity' : 'new-activity',
    };
  }
  const percentTenths = percentTenthsOf(differenceMinor, previousMinor);
  if (currentMinor === 0) {
    return {
      currentMinor,
      previousMinor,
      differenceMinor,
      percentTenths,
      trend: 'ceased-activity',
    };
  }
  const trend = differenceMinor === 0 ? 'unchanged' : differenceMinor > 0 ? 'increase' : 'decrease';
  return { currentMinor, previousMinor, differenceMinor, percentTenths, trend };
}

/**
 * Compares a figure that may be negative — the net.
 *
 * Deliberately never reports `new-activity` or `no-activity`: a net of zero is not an absence, it is
 * a month whose income and spending matched, and calling that "no activity" would be false about a
 * month that may hold hundreds of records. The percentage rule is the same one — a baseline greater
 * than zero, or nothing at all.
 */
export function compareSigned(currentMinor: number, previousMinor: number): FinanceChange {
  const differenceMinor = currentMinor - previousMinor;
  return {
    currentMinor,
    previousMinor,
    differenceMinor,
    percentTenths: percentTenthsOf(differenceMinor, previousMinor),
    trend: differenceMinor === 0 ? 'unchanged' : differenceMinor > 0 ? 'increase' : 'decrease',
  };
}

/** Expense totals per category over exactly the transactions given. Income is not spending. */
function spendByCategory(
  transactions: readonly FinanceTransaction[],
): ReadonlyMap<string | null, number> {
  const totals = new Map<string | null, number>();
  for (const transaction of transactions) {
    if (transaction.direction !== 'expense') {
      continue;
    }
    const running = totals.get(transaction.category) ?? 0;
    totals.set(transaction.category, running + transaction.amountMinor);
  }
  return totals;
}

/**
 * The whole comparison, derived from the ledger on every read.
 *
 * Takes the **ledger**, not a filtered list, so a category or a date range on the screen cannot
 * narrow what "August" means. The scope is the month, applied twice, with no other filter in force.
 */
export function compareFinanceMonths(
  ledger: FinanceLedger,
  month: FinanceMonth,
): FinanceMonthComparison {
  const previous = previousMonth(month);
  const currentRows = filterFinanceTransactions(ledger, NO_FINANCE_FILTERS, {
    kind: 'month',
    month,
  });
  const previousRows = filterFinanceTransactions(ledger, NO_FINANCE_FILTERS, {
    kind: 'month',
    month: previous,
  });
  const currentTotals = totalFinance(currentRows);
  const previousTotals = totalFinance(previousRows);

  const currentByCategory = spendByCategory(currentRows);
  const previousByCategory = spendByCategory(previousRows);
  const names = new Set<string | null>([...currentByCategory.keys(), ...previousByCategory.keys()]);

  const moved: FinanceCategoryChange[] = [];
  let unchangedCategoryCount = 0;
  for (const category of names) {
    const change = compareMagnitude(
      currentByCategory.get(category) ?? 0,
      previousByCategory.get(category) ?? 0,
    );
    if (change.differenceMinor === 0) {
      /* Listing every category that did not move buries the ones that did. It is counted instead. */
      unchangedCategoryCount += 1;
      continue;
    }
    moved.push({ category, change });
  }
  /*
    Largest movement first, in either direction — "which categories moved, and by how much" is a
    question about magnitude, not about which way it went. Ties fall back to the name so the order is
    stable across reads rather than whichever the engine's iteration happened to produce, and the
    uncategorised bucket sorts last among equals because it is not a name the user chose.
  */
  moved.sort((left, right) => {
    const byMagnitude =
      Math.abs(right.change.differenceMinor) - Math.abs(left.change.differenceMinor);
    if (byMagnitude !== 0) {
      return byMagnitude;
    }
    if (left.category === null) {
      return right.category === null ? 0 : 1;
    }
    if (right.category === null) {
      return -1;
    }
    return left.category.localeCompare(right.category);
  });

  return {
    month,
    previous,
    currentTotals,
    previousTotals,
    spending: compareMagnitude(currentTotals.expenseMinor, previousTotals.expenseMinor),
    income: compareMagnitude(currentTotals.incomeMinor, previousTotals.incomeMinor),
    net: compareSigned(currentTotals.netMinor, previousTotals.netMinor),
    categories: moved,
    unchangedCategoryCount,
  };
}
