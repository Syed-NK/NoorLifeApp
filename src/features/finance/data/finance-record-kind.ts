import { isFinanceGoalId } from './finance-goal';
import type { FinanceTransaction } from './finance-ledger';

/**
 * **What a ledger record actually is** — the one classification every Finance selector asks.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The defect this exists to remove ───────────────────────────────────────
 * #95 made a savings contribution an ordinary ledger transaction, so that "the ledger stays the
 * single record of money moved". That is right about *storage* and was silently wrong about
 * *meaning*: every consumption aggregate in the module counted those transfers as though the money
 * had been spent or earned.
 *
 * Measured on the ledger the audit used — 300.00 of groceries, 900.00 of salary, a 500.00
 * contribution and a 200.00 withdrawal:
 *
 * | Surface                       | Reported | True   |
 * | ----------------------------- | -------- | ------ |
 * | Spending total spent          |   800.00 | 300.00 |
 * | Spending total received       |  1100.00 | 900.00 |
 * | Month-on-month spending       |    +700% |  +200% |
 * | Budgets "spent without a category" | 500.00 |   0.00 |
 *
 * Moving money into a goal is not consumption, and taking it back out is not earnings. A person
 * reading "you spent 800 this month" after setting 500 aside has been told something false about
 * their own money by an app whose entire premise is not doing that.
 *
 * ── Why one module rather than a check at each call site ───────────────────
 * `transaction.goalId == null` scattered through six selectors is six chances to forget one, and the
 * one that is forgotten is invisible: it produces a plausible number, not an error. So the rule lives
 * here, every consumer imports it, and a test asserts that no consumer re-implements it.
 *
 * ── Classification is the attribution, never the goal's existence ──────────
 * A transfer whose goal has since been deleted is **still a transfer**. Its `goalId` no longer
 * resolves to anything, but the money still moved into savings and the user still recorded it that
 * way; reclassifying it as spending the moment its goal is removed would rewrite history to match a
 * bookkeeping detail. So this reads the field, and nothing else — no store, no goal list, no lookup.
 *
 * That also makes the classification total and cheap: every record has exactly one kind, decidable
 * from the record alone, with no way for two surfaces to disagree because one of them held a
 * staler goal list than the other.
 *
 * ── What is deliberately *not* excluded ────────────────────────────────────
 * The records themselves. A transfer stays in the ledger, stays in the Spending list, stays
 * filterable and stays editable — it is the user's own record of their own money. What changes is
 * that the list labels it truthfully and the *aggregates* leave it out. Hiding it would be the
 * opposite failure: money that moved, absent from every history the user can reach.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * The four things a ledger record can be.
 *
 * Exhaustive by construction: direction is two-valued and attribution is present or absent, so every
 * transaction lands in exactly one, and a `switch` over this has no default branch to get wrong.
 */
export type FinanceRecordKind =
  /** Money spent. Counts toward spending, budgets and the spending comparison. */
  | 'spending'
  /** Money received. Counts toward income and the income comparison. */
  | 'income'
  /** Money moved into a savings goal. Consumption aggregates exclude it. */
  | 'savings-contribution'
  /** Money taken back out of a savings goal. Income aggregates exclude it. */
  | 'savings-withdrawal';

/**
 * Whether a record is attributed to a savings goal.
 *
 * Shape only, and on purpose. `isFinanceGoalId` is the same predicate the ledger validates writes
 * with, so a stored attribution that reaches this is one the decoder already accepted — and a goal
 * that has since been deleted still leaves a well-formed id here, which is exactly the case that
 * must keep classifying as a transfer.
 */
export function isSavingsTransfer(transaction: FinanceTransaction): boolean {
  const goalId = transaction.goalId;
  return goalId !== undefined && goalId !== null && isFinanceGoalId(goalId);
}

/** What this record is. One answer, from the record alone. */
export function financeRecordKind(transaction: FinanceTransaction): FinanceRecordKind {
  if (isSavingsTransfer(transaction)) {
    return transaction.direction === 'expense' ? 'savings-contribution' : 'savings-withdrawal';
  }
  return transaction.direction === 'expense' ? 'spending' : 'income';
}

/**
 * Whether this record describes consumption — money spent or money earned.
 *
 * **The inclusion policy for every spending, income, net, category and budget aggregate.** Written
 * as its own named predicate rather than `!isSavingsTransfer(...)` at each call site, so the reason
 * a record is being skipped is stated where it is skipped.
 */
export function isConsumptionRecord(transaction: FinanceTransaction): boolean {
  return !isSavingsTransfer(transaction);
}

/**
 * Only the consumption records, in the order they were given.
 *
 * The convenience the selectors use, so the filter is applied identically everywhere instead of once
 * per loop with a subtly different condition.
 */
export function consumptionRecords(
  transactions: readonly FinanceTransaction[],
): readonly FinanceTransaction[] {
  return transactions.filter(isConsumptionRecord);
}

/** Only the savings transfers. For surfaces that present savings activity as savings activity. */
export function savingsTransfers(
  transactions: readonly FinanceTransaction[],
): readonly FinanceTransaction[] {
  return transactions.filter(isSavingsTransfer);
}

/**
 * What a savings transfer is called on a raw history surface.
 *
 * Neutral and factual. It states the direction, and it never guesses the goal — resolving the name
 * is the caller's job, because only a caller holding the goal list can do it and a wrong name is
 * worse than no name.
 */
export function savingsTransferLabel(transaction: FinanceTransaction): string {
  return financeRecordKind(transaction) === 'savings-contribution'
    ? 'Savings contribution'
    : 'Savings withdrawal';
}

/**
 * The fallback for a transfer whose goal no longer exists.
 *
 * A deleted goal takes its name with it, and there is nowhere honest to recover it from — the goal
 * store held it and the store no longer does. So the record says what it is and admits what it
 * cannot say, rather than reading as an ordinary uncategorised purchase, which is what it looked
 * like before this existed.
 */
export const DELETED_SAVINGS_GOAL_LABEL = 'Deleted savings goal';
