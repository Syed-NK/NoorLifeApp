import { financeCategoryKey, sortFinanceBudgets, type FinanceBudget } from './finance-budget';
import { percentTenthsOf } from './finance-comparison';
import type { FinanceLedger } from './finance-ledger';
import { dayIsInMonth, type FinanceMonth } from './finance-month';
import { financeRecordEffect, isConsumptionRecord } from './finance-record-kind';

/**
 * **Spent against budgeted, derived on every read** — issue #94.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The whole point of the issue ───────────────────────────────────────────
 * "Spend is always derived, so a budget cannot drift from the transactions it measures." Nothing in
 * this file is stored and nothing it computes is written anywhere: a transaction created, edited,
 * deleted, recategorised, moved between months or flipped between expense and income changes these
 * figures on the next read, with no budget record rewritten and no synchronisation step that could
 * fail halfway.
 *
 * ── It reads the ledger, never the filtered list ───────────────────────────
 * `progressForMonth` takes the **ledger**. The Spending screen's category chips and date range
 * narrow what that screen lists; a budget derived from those rows would report a fraction of the
 * month as the month and would move whenever somebody touched a filter. This is the same defect
 * #102's comparison exists to avoid, and it is avoided the same way — by not being handed the
 * filtered rows in the first place.
 *
 * ── Savings contributions are not spending either ──────────────────────────
 * A budget measures what was consumed in a category. Money moved into a savings goal was not, so it
 * is skipped by the same rule every other Finance aggregate now uses — `isConsumptionRecord`.
 *
 * ── Income is not spending ─────────────────────────────────────────────────
 * Only `direction === 'expense'` counts. A refund or a salary landing in a budgeted category must
 * not quietly buy back headroom the user has already used.
 *
 * ── The month is a prefix ──────────────────────────────────────────────────
 * `dayIsInMonth` is #93's string comparison. No `Date` is constructed here: `new Date('2026-03-01')`
 * is UTC midnight, which is February for anyone west of Greenwich, so a `Date`-based month would
 * count a user's 1 March spend against February's budget — for them, and invisibly to anyone east of
 * UTC. February needs no case of its own for the same reason.
 *
 * ── Five states since #96, and not one more ───────────────────────────────
 * No spending, below, exactly at, over, and — since refunds exist — refunded beyond what was spent.
 * The fifth is not a threshold but a genuinely new fact: a category can be refunded more than it was
 * spent in the same month, and saying so is the only honest alternative to hiding it.
 *
 * #94 defines no warning threshold, so none is invented — an "80% used" caution would be a product
 * policy smuggled in as an implementation detail, and it would be the app deciding when somebody
 * should feel uneasy about their own money.
 *
 * The comparison is on integers, so "exactly at the limit" is exact rather than a rounding artefact.
 *
 * ── Uncategorised spending is reported, not absorbed ───────────────────────
 * A budget measures a category; a transaction filed without one belongs to no budget. Silently
 * dropping it would mean the budgets covered less of the month than they appeared to. It is totalled
 * separately so the screen can say so.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type FinanceBudgetStatus =
  | 'no-spending'
  | 'below'
  | 'at-limit'
  | 'over'
  /** Refunds in this category exceeded its spending this month — issue #96. */
  | 'refunded-beyond';

export type FinanceBudgetProgress = {
  readonly budget: FinanceBudget;
  /** Usage against the limit: net spending, floored at zero. Derived, never stored. */
  readonly spentMinor: number;
  /** The true net, which a refund can drive below zero. Reported so nothing is hidden. */
  readonly netSpentMinor: number;
  /** How far the refunds went past the spending. Zero unless `netSpentMinor` is negative. */
  readonly refundedBeyondSpendMinor: number;
  readonly limitMinor: number;
  /** `limit − spent`. Positive is remaining, negative is over, and it is exact either way. */
  readonly differenceMinor: number;
  readonly status: FinanceBudgetStatus;
  /**
   * How much of the limit is used, in tenths of a percent.
   *
   * Always defined: a limit is a positive integer by construction, so there is no zero baseline here
   * and no case where a percentage would have to be invented or withheld.
   */
  readonly percentTenths: number;
};

export type FinanceBudgetsView = {
  /** The month these figures describe. Named on screen, so "spent" is never ambiguous about when. */
  readonly month: FinanceMonth;
  readonly entries: readonly FinanceBudgetProgress[];
  /** Expense in this month filed without a category, so belonging to no budget. */
  readonly uncategorisedMinor: number;
  /** Total budgeted across every category. */
  readonly budgetedMinor: number;
  /** Total spent in the budgeted categories. Not the month's whole expense. */
  readonly spentMinor: number;
};

/**
 * Expense totals for one month, keyed by category key.
 *
 * Built once per read and shared by every budget, so a ledger is walked once rather than once per
 * budget — and so a transaction cannot be counted against two budgets, because one key maps to one
 * bucket and one budget claims one key.
 */
function expenseByCategoryKey(
  ledger: FinanceLedger,
  month: FinanceMonth,
): { readonly totals: ReadonlyMap<string, number>; readonly uncategorisedMinor: number } {
  const totals = new Map<string, number>();
  let uncategorisedMinor = 0;
  for (const transaction of ledger.transactions) {
    /*
      Direction alone no longer decides this — issue #96. A refund is an expense-direction record
      whose effect is negative, so the effect authority is what says how much this contributes, and a
      same-category refund reduces that category's usage rather than adding to it.
    */
    if (transaction.direction !== 'expense') {
      continue;
    }
    /*
      A savings contribution is not spending against a budget. Before this, a 500.00 transfer landed
      in `uncategorisedMinor` and the screen reported "500.00 spent this month without a category, so
      it counts towards no budget" — money the user had set aside, described to them as untracked
      spending. A transfer that had also been given a category would have gone further and eaten a
      real budget's headroom.
    */
    if (!isConsumptionRecord(transaction)) {
      continue;
    }
    if (!dayIsInMonth(transaction.occurredOn, month)) {
      continue;
    }
    const { expenseMinor } = financeRecordEffect(transaction);
    if (transaction.category === null) {
      uncategorisedMinor += expenseMinor;
      continue;
    }
    const key = financeCategoryKey(transaction.category);
    totals.set(key, (totals.get(key) ?? 0) + expenseMinor);
  }
  return { totals, uncategorisedMinor };
}

/**
 * One budget's standing, against a **net** spend total already computed for its month.
 *
 * ── The excess-refund policy, stated once — issue #96 ──────────────────────
 * `netSpentMinor` may be negative: a category can be refunded more than it was spent in the same
 * month, and that is a real thing that happens when a purchase is returned after the month it was
 * bought in. Three rules, chosen deliberately:
 *
 * 1. **Usage never goes below zero.** `spentMinor` is floored, so the bar, the percentage and the
 *    status describe a budget that has been used somewhere between nothing and everything. A
 *    negative "usage" has no meaning against a limit, and #96 does not ask for one to be displayed.
 * 2. **The excess is stated, not swallowed.** `refundedBeyondSpendMinor` carries the part the floor
 *    removed, so the screen can say so. `Math.abs` on the net would have turned money coming back
 *    into money going out — inventing spending that never happened, which is the failure this issue
 *    exists to prevent.
 * 3. **It never becomes income.** The excess is reported as a *refund* figure and contributes
 *    nothing to earned income anywhere — that is enforced upstream by the effect authority, which
 *    gives a refund a zero income component whatever its magnitude.
 */
export function budgetProgress(
  budget: FinanceBudget,
  netSpentMinor: number,
): FinanceBudgetProgress {
  const limitMinor = budget.limitMinor;
  /* Usage: what has actually been consumed against the limit, never less than nothing. */
  const spentMinor = Math.max(netSpentMinor, 0);
  const refundedBeyondSpendMinor = Math.max(-netSpentMinor, 0);
  const differenceMinor = limitMinor - spentMinor;
  const status: FinanceBudgetStatus =
    refundedBeyondSpendMinor > 0
      ? 'refunded-beyond'
      : spentMinor === 0
        ? 'no-spending'
        : spentMinor < limitMinor
          ? 'below'
          : spentMinor === limitMinor
            ? 'at-limit'
            : 'over';
  return {
    budget,
    spentMinor,
    netSpentMinor,
    refundedBeyondSpendMinor,
    limitMinor,
    differenceMinor,
    status,
    /* Reuses #102's exact BigInt ratio rather than a second rounding rule. */
    percentTenths: percentTenthsOf(spentMinor, limitMinor) ?? 0,
  };
}

/**
 * Every budget with its spend for one month, derived from the whole owner ledger.
 *
 * Takes the ledger and the month explicitly. The month comes from the shared day source at the call
 * site, so this file holds no notion of "now" and nothing here needs a timer to stay current.
 */
export function progressForMonth(
  ledger: FinanceLedger,
  budgets: readonly FinanceBudget[],
  month: FinanceMonth,
): FinanceBudgetsView {
  const { totals, uncategorisedMinor } = expenseByCategoryKey(ledger, month);
  const entries = sortFinanceBudgets(budgets).map((budget) =>
    budgetProgress(budget, totals.get(financeCategoryKey(budget.category)) ?? 0),
  );
  return {
    month,
    entries,
    uncategorisedMinor,
    budgetedMinor: entries.reduce((sum, entry) => sum + entry.limitMinor, 0),
    spentMinor: entries.reduce((sum, entry) => sum + entry.spentMinor, 0),
  };
}
