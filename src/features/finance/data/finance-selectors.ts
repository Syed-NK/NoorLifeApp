import type { FinanceLedger, FinanceTransaction } from './finance-ledger';
import { sortFinanceTransactions } from './finance-ledger';
import {
  dayIsInMonth,
  monthOfDay,
  nextMonth,
  previousMonth,
  type FinanceMonth,
} from './finance-month';

/**
 * **Reading the ledger: grouping, filtering and the derived summary** — issue #93.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Everything here is derived, nothing is stored ──────────────────────────
 * A total that is written down can disagree with the records it totals, and then there are two
 * answers and no way to know which is right. So the summary, the day groups and the filtered view
 * are all computed on read from the one stored list. That is also why filtering cannot corrupt
 * anything: these functions take a ledger and return new arrays, and none of them writes.
 *
 * ── The day comes from the caller ──────────────────────────────────────────
 * `todayKey` is passed in, read once per operation from the shared day source. Nothing in this file
 * asks what day it is — issue #76's lesson, applied to a second module.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type FinanceFilters = {
  /** A category present in the ledger, or `null` for all. */
  readonly category: string | null;
  /** Inclusive local `YYYY-MM-DD` bounds, or `null` for open-ended. */
  readonly from: string | null;
  readonly to: string | null;
};

export const NO_FINANCE_FILTERS: FinanceFilters = { category: null, from: null, to: null };

export function hasActiveFilters(filters: FinanceFilters): boolean {
  return filters.category !== null || filters.from !== null || filters.to !== null;
}

export function hasCustomRange(filters: FinanceFilters): boolean {
  return filters.from !== null || filters.to !== null;
}

/**
 * What the list is scoped to: one month, or a range the user typed.
 *
 * Two modes rather than one set of overlapping controls. A month stepper and an inclusive custom
 * range answer different questions — "how did August go" and "what happened between these two
 * days" — and a screen that silently intersected them would give an answer to neither. Choosing a
 * month clears the range; typing a range leaves the month, and the screen says which is in force.
 */
export type FinanceScope =
  { readonly kind: 'month'; readonly month: FinanceMonth } | { readonly kind: 'range' };

/**
 * The date range, with a reversed pair normalised rather than refused.
 *
 * A user who picks the 20th and then the 14th has expressed an interval, not an error, and every
 * calendar control in the world reads it that way. Swapping is therefore the honest reading — and it
 * is done **explicitly, in one place**, so no caller has to remember which way round its bounds are
 * and no comparison silently returns nothing.
 */
export function normaliseRange(filters: FinanceFilters): FinanceFilters {
  const { from, to } = filters;
  if (from !== null && to !== null && from > to) {
    return { ...filters, from: to, to: from };
  }
  return filters;
}

/** Every category actually present, sorted, for a filter that cannot offer an empty result by construction. */
export function financeCategories(ledger: FinanceLedger): readonly string[] {
  const present = new Set<string>();
  for (const transaction of ledger.transactions) {
    if (transaction.category !== null) {
      present.add(transaction.category);
    }
  }
  return [...present].sort((left, right) => left.localeCompare(right));
}

/**
 * Applies the scope and every filter. Composed by construction: each clause narrows what the last
 * one left, and the category composes with either scope.
 */
export function filterFinanceTransactions(
  ledger: FinanceLedger,
  filters: FinanceFilters,
  scope: FinanceScope = { kind: 'range' },
): readonly FinanceTransaction[] {
  const { category, from, to } = normaliseRange(filters);
  return ledger.transactions.filter((transaction) => {
    if (scope.kind === 'month' && !dayIsInMonth(transaction.occurredOn, scope.month)) {
      return false;
    }
    if (category !== null && transaction.category !== category) {
      return false;
    }
    /* Inclusive on both ends — a range that excluded its own endpoints would surprise everyone. */
    if (from !== null && transaction.occurredOn < from) {
      return false;
    }
    if (to !== null && transaction.occurredOn > to) {
      return false;
    }
    return true;
  });
}

export type FinanceDayGroup = {
  readonly day: string;
  readonly transactions: readonly FinanceTransaction[];
};

/**
 * Groups into days, newest first.
 *
 * The tie-break is the domain's own sort — occurrence day, then creation time, then id — so two
 * records made on the same day in the same millisecond still have one stable order rather than
 * whichever the engine happened to produce.
 */
export function groupFinanceByDay(
  transactions: readonly FinanceTransaction[],
): readonly FinanceDayGroup[] {
  const sorted = sortFinanceTransactions(transactions);
  const groups: FinanceDayGroup[] = [];
  for (const transaction of sorted) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.day === transaction.occurredOn) {
      groups[groups.length - 1] = {
        day: last.day,
        transactions: [...last.transactions, transaction],
      };
      continue;
    }
    groups.push({ day: transaction.occurredOn, transactions: [transaction] });
  }
  return groups;
}

export type FinanceSummary = {
  readonly count: number;
  readonly todayCount: number;
  readonly expenseMinor: number;
  readonly incomeMinor: number;
};

/**
 * The figures the Finance home shows, derived on every read.
 *
 * Integer addition throughout — the amounts are minor units, and #92's bound is set so a full
 * ledger still sums inside the safe-integer range.
 */
export function summariseFinance(ledger: FinanceLedger, todayKey: string): FinanceSummary {
  let expenseMinor = 0;
  let incomeMinor = 0;
  let todayCount = 0;
  for (const transaction of ledger.transactions) {
    if (transaction.direction === 'expense') {
      expenseMinor += transaction.amountMinor;
    } else {
      incomeMinor += transaction.amountMinor;
    }
    if (transaction.occurredOn === todayKey) {
      todayCount += 1;
    }
  }
  return { count: ledger.transactions.length, todayCount, expenseMinor, incomeMinor };
}

export type FinanceTotals = {
  readonly count: number;
  readonly expenseMinor: number;
  readonly incomeMinor: number;
  /** Income minus expense. Signed, because a month that spent more than it took in is a real answer. */
  readonly netMinor: number;
};

/**
 * Income, expense and net over exactly the transactions given.
 *
 * Takes a list rather than a ledger so the month view and the custom range share one implementation
 * — a second totalling function is a second thing to disagree with the first. Integer addition
 * throughout, and nothing is stored: a written-down total can contradict the records it totals.
 */
export function totalFinance(transactions: readonly FinanceTransaction[]): FinanceTotals {
  let expenseMinor = 0;
  let incomeMinor = 0;
  for (const transaction of transactions) {
    if (transaction.direction === 'expense') {
      expenseMinor += transaction.amountMinor;
    } else {
      incomeMinor += transaction.amountMinor;
    }
  }
  return {
    count: transactions.length,
    expenseMinor,
    incomeMinor,
    netMinor: incomeMinor - expenseMinor,
  };
}

/** Every month the ledger has a transaction in, ascending. */
export function financeMonths(ledger: FinanceLedger): readonly FinanceMonth[] {
  const present = new Set<FinanceMonth>();
  for (const transaction of ledger.transactions) {
    present.add(monthOfDay(transaction.occurredOn));
  }
  return [...present].sort();
}

export type FinanceMonthBounds = {
  readonly earliest: FinanceMonth;
  readonly latest: FinanceMonth;
};

/**
 * How far the month stepper may travel.
 *
 * Forward stops at the current month **unless the ledger already holds something later** — a
 * back-dated ledger should not hide a record the user themselves entered, and a stepper that walked
 * indefinitely into an empty future would be offering months that cannot contain anything. Backward
 * stops at the earliest month that has a transaction, for the same reason in the other direction.
 *
 * Empty months *between* those bounds stay reachable, and say so honestly — a gap in someone's
 * records is information, not an error.
 */
export function financeMonthBounds(
  ledger: FinanceLedger,
  currentMonth: FinanceMonth,
): FinanceMonthBounds {
  const months = financeMonths(ledger);
  const earliest = months[0];
  const latest = months[months.length - 1];
  return {
    earliest: earliest !== undefined && earliest < currentMonth ? earliest : currentMonth,
    latest: latest !== undefined && latest > currentMonth ? latest : currentMonth,
  };
}

export function canStepBack(month: FinanceMonth, bounds: FinanceMonthBounds): boolean {
  return previousMonth(month) >= bounds.earliest;
}

export function canStepForward(month: FinanceMonth, bounds: FinanceMonthBounds): boolean {
  return nextMonth(month) <= bounds.latest;
}

/**
 * Keeps a selected month inside the bounds the ledger allows.
 *
 * Needed because the bounds move underneath the selection: deleting the last transaction of the
 * only future month must not leave the screen parked on a month it can no longer reach.
 */
export function clampMonth(month: FinanceMonth, bounds: FinanceMonthBounds): FinanceMonth {
  if (month < bounds.earliest) {
    return bounds.earliest;
  }
  return month > bounds.latest ? bounds.latest : month;
}
