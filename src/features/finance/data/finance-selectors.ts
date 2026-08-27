import type { FinanceLedger, FinanceTransaction } from './finance-ledger';
import { sortFinanceTransactions } from './finance-ledger';

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

/** Applies every filter. Composed by construction: each clause narrows what the last one left. */
export function filterFinanceTransactions(
  ledger: FinanceLedger,
  filters: FinanceFilters,
): readonly FinanceTransaction[] {
  const { category, from, to } = normaliseRange(filters);
  return ledger.transactions.filter((transaction) => {
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
