import { percentTenthsOf } from './finance-comparison';
import { sortFinanceGoals, type FinanceGoal } from './finance-goal';
import type { FinanceLedger, FinanceTransaction } from './finance-ledger';
import { sortFinanceTransactions } from './finance-ledger';

/**
 * **Set aside against target, derived on every read** — issue #95.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Nothing here is stored ─────────────────────────────────────────────────
 * "Progress derived from the ledger — an intent is stored, a total never is." Every figure below is
 * computed from the transactions each time it is asked for, and none of it is written anywhere. A
 * contribution created, edited, deleted, re-dated or detached changes these numbers on the next
 * render, with no goal record rewritten and no synchronisation step that could fail halfway leaving
 * a total that disagrees with the money.
 *
 * ── Attribution is the explicit id, and only that ──────────────────────────
 * A transaction counts toward a goal when its `goalId` **is** that goal's id. Not when its category
 * looks like the goal's name, not when the month's income exceeded its expense, not when a balance
 * happens to be positive. #95 forbids the automatic transfer and the "on track" verdict, and this is
 * where that is actually enforced: there is no code path here that can add to a total without the
 * user having attributed a specific record to a specific goal.
 *
 * A transaction whose `goalId` names a goal that no longer exists counts toward nothing. That is the
 * referential integrity, and it is enforced by construction rather than by a repair pass — the loop
 * asks each goal what belongs to it, so an id nothing matches is simply never reached. Deleting a
 * goal therefore leaves its transactions in the ledger, which is what #95 requires: the money did
 * move, and the ledger is the single record of that.
 *
 * ── Both directions count, and they mean opposite things ───────────────────
 * An `expense` attributed to a goal is money set aside. An `income` attributed to a goal is money
 * taken back out — the only honest reading of a record the user themselves filed that way. So
 * `setAsideMinor` is expenses minus withdrawals, and the two totals are also reported separately so
 * the screen can say what actually happened rather than only the difference.
 *
 * This differs from #94 on purpose, and the difference is not an inconsistency. A budget asks "how
 * much did you spend in this category", so a refund must not quietly buy back headroom the user has
 * already used. A goal asks "how much is set aside **right now**", and money withdrawn is genuinely
 * no longer set aside. Ignoring withdrawals would leave the screen claiming an amount the user's own
 * records say came back — which is the class of false claim this module exists to refuse.
 *
 * Because withdrawals can exceed contributions, `setAsideMinor` may be negative. It is reported that
 * way rather than clamped: a clamp would hide a state the user created, and the sentence for it says
 * plainly that more has been taken out than put in.
 *
 * ── Integers throughout ────────────────────────────────────────────────────
 * Minor units, added and subtracted. #92's per-record ceiling is set so a whole ledger sums inside
 * the safe-integer range, so no accumulation here can leave it, and there is no division except the
 * percentage — which is #102's exact `BigInt` ratio rather than a second rounding rule. No float, no
 * `parseFloat`, and no path that can produce `NaN` or `Infinity`: the only divisor is a target, and a
 * target is a positive integer by construction.
 *
 * ── Five states, in words ──────────────────────────────────────────────────
 * Nothing recorded, in progress, target reached, above target, and withdrawn past nothing. Each is a
 * sentence; the bar is decoration. #95 defines no threshold and no verdict, so there is no "nearly
 * there" and no "on track" — the first would be this file deciding when somebody should feel uneasy,
 * and the second is a forecast that #95 rules out by name.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type FinanceGoalStatus =
  'nothing-recorded' | 'in-progress' | 'target-reached' | 'above-target' | 'withdrawn-past-zero';

export type FinanceGoalProgress = {
  readonly goal: FinanceGoal;
  /** Derived. Never stored, never written back. May be negative — see the header note. */
  readonly setAsideMinor: number;
  /** Total attributed expense. Reported alongside the net so both facts are available. */
  readonly contributedMinor: number;
  /** Total attributed income — money the user recorded taking back out. */
  readonly withdrawnMinor: number;
  readonly targetMinor: number;
  /** `target − setAside`, floored at zero. Nothing "remains" once the target is met or passed. */
  readonly remainingMinor: number;
  /** How much is over the target, or zero. The factual figure, never capped for the bar's sake. */
  readonly aboveTargetMinor: number;
  readonly status: FinanceGoalStatus;
  /**
   * How much of the target is set aside, in tenths of a percent.
   *
   * Always defined: a target is a positive integer by construction, so there is no zero baseline and
   * no case where a percentage would have to be invented or withheld. Signed, so a goal withdrawn
   * past nothing reports a negative rather than a misleading zero.
   */
  readonly percentTenths: number;
  /** How many transactions are attributed to this goal, in either direction. */
  readonly contributionCount: number;
};

export type FinanceGoalsView = {
  readonly entries: readonly FinanceGoalProgress[];
  /** Total targeted across every goal. */
  readonly targetedMinor: number;
  /** Total net set aside across every goal. */
  readonly setAsideMinor: number;
};

/**
 * Attributed totals for every goal, keyed by goal id.
 *
 * Built by walking the ledger once rather than once per goal, and keyed by id so a transaction
 * cannot be counted toward two goals — one record carries one attribution, by construction.
 */
function attributedTotals(
  ledger: FinanceLedger,
): ReadonlyMap<string, { contributedMinor: number; withdrawnMinor: number; count: number }> {
  const totals = new Map<
    string,
    { contributedMinor: number; withdrawnMinor: number; count: number }
  >();
  for (const transaction of ledger.transactions) {
    const goalId = transaction.goalId;
    /* Absent and `null` both mean unattributed; neither is a key. */
    if (goalId === undefined || goalId === null) {
      continue;
    }
    const entry = totals.get(goalId) ?? { contributedMinor: 0, withdrawnMinor: 0, count: 0 };
    if (transaction.direction === 'expense') {
      entry.contributedMinor += transaction.amountMinor;
    } else {
      entry.withdrawnMinor += transaction.amountMinor;
    }
    entry.count += 1;
    totals.set(goalId, entry);
  }
  return totals;
}

/** One goal's standing, against totals already attributed to it. */
export function goalProgress(
  goal: FinanceGoal,
  contributedMinor: number,
  withdrawnMinor: number,
  contributionCount: number,
): FinanceGoalProgress {
  const targetMinor = goal.targetMinor;
  const setAsideMinor = contributedMinor - withdrawnMinor;
  const status: FinanceGoalStatus =
    contributionCount === 0
      ? 'nothing-recorded'
      : setAsideMinor < 0
        ? 'withdrawn-past-zero'
        : setAsideMinor < targetMinor
          ? 'in-progress'
          : setAsideMinor === targetMinor
            ? 'target-reached'
            : 'above-target';
  return {
    goal,
    setAsideMinor,
    contributedMinor,
    withdrawnMinor,
    targetMinor,
    /*
      Floored. "AED −50 remaining" is not a sentence about somebody's savings, and the amount past
      the target is reported by its own field rather than as a negative remainder.
    */
    remainingMinor: Math.max(targetMinor - setAsideMinor, 0),
    aboveTargetMinor: Math.max(setAsideMinor - targetMinor, 0),
    status,
    /* #102's exact BigInt ratio. Signed, and never `NaN` — a target is positive by construction. */
    percentTenths: percentTenthsOf(setAsideMinor, targetMinor) ?? 0,
    contributionCount,
  };
}

/**
 * Every goal with what has been set aside toward it, derived from the whole owner ledger.
 *
 * Takes the ledger, not a filtered view of it. A goal measures deliberate transfers wherever and
 * whenever they were recorded, so narrowing by month or category first would report a slice of the
 * user's savings as the whole of it — the defect #94 records avoiding for the same reason.
 */
export function goalsProgress(
  ledger: FinanceLedger,
  goals: readonly FinanceGoal[],
): FinanceGoalsView {
  const totals = attributedTotals(ledger);
  const entries = sortFinanceGoals(goals).map((goal) => {
    const total = totals.get(goal.id);
    return goalProgress(
      goal,
      total?.contributedMinor ?? 0,
      total?.withdrawnMinor ?? 0,
      total?.count ?? 0,
    );
  });
  return {
    entries,
    targetedMinor: entries.reduce((sum, entry) => sum + entry.targetMinor, 0),
    setAsideMinor: entries.reduce((sum, entry) => sum + entry.setAsideMinor, 0),
  };
}

/**
 * The transactions attributed to one goal, newest first.
 *
 * The domain's own sort, so a list has one stable order rather than whichever the engine produced.
 */
export function contributionsForGoal(
  ledger: FinanceLedger,
  goalId: string,
): readonly FinanceTransaction[] {
  return sortFinanceTransactions(
    ledger.transactions.filter((transaction) => transaction.goalId === goalId),
  );
}

/**
 * Where a target date sits relative to today. A fact, never a verdict.
 *
 * `null` when there is no target date. String comparison on local date keys — no `Date` is
 * constructed, because `new Date('2026-03-01')` is UTC midnight and would report the wrong side of
 * the boundary for anyone west of Greenwich.
 *
 * Nothing acts on this. A date that has passed does not fail a goal, does not mutate it, and does
 * not produce a projected completion — #95 forbids all three, and the screen states only which of
 * the three cases holds.
 */
export function targetDateStanding(
  targetOn: string | null,
  todayKey: string,
): 'past' | 'today' | 'future' | null {
  if (targetOn === null) {
    return null;
  }
  if (targetOn === todayKey) {
    return 'today';
  }
  return targetOn < todayKey ? 'past' : 'future';
}
