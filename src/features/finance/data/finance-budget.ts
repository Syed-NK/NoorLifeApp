import { isStorableMinorAmount } from './finance-money';

/**
 * **A budget is an intent, and only an intent** — issue #94.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What #94 actually asks for ─────────────────────────────────────────────
 * "A budget is an amount per category per period, evaluated **against the transaction ledger** — it
 * stores an intent, never a duplicate total." So a record here holds a category and an amount, and
 * nothing else that could be computed. There is no `spentMinor`, no `remaining`, no `progress` and
 * no `percentageUsed`, and a test asserts their absence from the stored bytes rather than trusting
 * this comment. A stored total can disagree with the transactions it totals, and a budget that
 * disagrees with the ledger is worse than no budget: it is a wrong answer with a confident label.
 *
 * ── Why the record carries no month ────────────────────────────────────────
 * The issue says "Set, edit and remove a budget **per category**" and "Show spent against budgeted
 * for **the current period**". Read together, the unit the user manages is the category and the
 * period in view is the current one — so a budget is a standing monthly amount, evaluated against
 * whichever month the shared day source is in.
 *
 * The alternative — stamping each record with a month — was rejected because it invents everything
 * #94 does not mention: per-month creation, a month stepper, empty future months, and then the
 * question of whether last month's figure should be copied forward. #94 asks for none of that, and
 * a budget that silently cloned itself into a month the user never looked at would be inventing
 * their intent. Nothing here rolls over, because there is nothing to roll over.
 *
 * The consequence is stated on screen rather than hidden: the period being measured is named, so
 * "500 spent of 600" is never ambiguous about *when*.
 *
 * ── The category key, and why it is not the label ──────────────────────────
 * Transactions carry the category the user typed. Matching on that string exactly would mean "Food"
 * and "food" were different budgets against the same spending, and that correcting a label's
 * capitalisation orphaned the budget measuring it. So matching is on a **derived key** — trimmed and
 * lower-cased — while the record keeps the label as typed, for display. One key, one budget, and a
 * cosmetic edit cannot detach a budget from the money it measures.
 *
 * Uncategorised spending has no category and therefore no budget. That is a real gap in coverage, so
 * the screen states the uncategorised total explicitly instead of letting it vanish between the
 * budgets — money the user spent must not disappear because they did not label it.
 *
 * ── Amounts, and the bound ─────────────────────────────────────────────────
 * `isStorableMinorAmount` is #92's own predicate: a positive safe integer, at most 10^12 minor
 * units. Reused rather than restated, so zero, negatives, fractions, `NaN` and `Infinity` are all
 * refused by the same rule that already guards a transaction. `MAX_FINANCE_BUDGETS` × that ceiling
 * is 2 × 10^14, inside the safe-integer range, so a full budget list still adds exactly.
 *
 * ── What this file will not do ─────────────────────────────────────────────
 * No alerts. #90 removed the notifications permission that promised them and #94 says so in as many
 * words; nothing here schedules, notifies or asks for permission. No forecasting, no automatic
 * adjustment, and no assistant write path.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const FINANCE_BUDGETS_SCHEMA_VERSION = 1;

/** How many budgets one account may hold. A bound the decoder enforces, not a suggestion. */
export const MAX_FINANCE_BUDGETS = 200;

const MAX_CATEGORY_LENGTH = 40;

/** `finance.budget.` plus a v4-shaped UUID, so an id cannot be a sequence a caller invented. */
const BUDGET_ID_PATTERN = /^finance\.budget\.[0-9a-f-]{36}$/i;

export type FinanceBudget = {
  readonly id: string;
  /** The category label as the user typed it. Display only — never the matching key. */
  readonly category: string;
  /** Positive integer, in the ledger currency's minor unit. The whole of the user's intent. */
  readonly limitMinor: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type FinanceBudgetsEnvelope = {
  readonly version: typeof FINANCE_BUDGETS_SCHEMA_VERSION;
  readonly budgets: readonly FinanceBudget[];
};

export type FinanceBudgetDraft = {
  readonly category: string;
  readonly limitMinor: number;
};

export type FinanceBudgetFault =
  | 'no-currency'
  | 'invalid-amount'
  | 'invalid-category'
  | 'duplicate-category'
  | 'not-found'
  | 'budgets-full';

export type FinanceBudgetValidation =
  | { readonly kind: 'valid'; readonly draft: FinanceBudgetDraft }
  | { readonly kind: 'invalid'; readonly fault: FinanceBudgetFault };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The matching key for a category.
 *
 * One derivation, used by the budget list, the duplicate check and the spend roll-up alike — a
 * second copy of this rule would eventually disagree with the first about whether two categories
 * were the same, and a budget would then measure money that belonged to another.
 */
export function financeCategoryKey(category: string): string {
  return category.trim().toLowerCase();
}

export function emptyFinanceBudgets(): readonly FinanceBudget[] {
  return [];
}

/** Validates a draft without touching a clock or a store. */
export function validateFinanceBudgetDraft(draft: FinanceBudgetDraft): FinanceBudgetValidation {
  if (!isStorableMinorAmount(draft.limitMinor)) {
    return { kind: 'invalid', fault: 'invalid-amount' };
  }
  const category = draft.category.trim();
  if (category.length === 0 || category.length > MAX_CATEGORY_LENGTH) {
    /*
      An empty category is refused rather than stored as "uncategorised". #94 budgets a category, and
      the absence of one is not a category — treating it as though it were would create a budget the
      spend roll-up could never match against a transaction's `null`.
    */
    return { kind: 'invalid', fault: 'invalid-category' };
  }
  return { kind: 'valid', draft: { category, limitMinor: draft.limitMinor } };
}

/** Whether a category already has a budget, ignoring one id — the record being edited. */
export function findBudgetForCategory(
  budgets: readonly FinanceBudget[],
  category: string,
  exceptId: string | null = null,
): FinanceBudget | null {
  const key = financeCategoryKey(category);
  return (
    budgets.find(
      (budget) => budget.id !== exceptId && financeCategoryKey(budget.category) === key,
    ) ?? null
  );
}

/**
 * Builds a budget from a validated draft.
 *
 * `id` and `at` are supplied by the caller — the repository owns identity and the clock — so this
 * function is pure and a test can state both.
 */
export function createFinanceBudget(
  draft: FinanceBudgetDraft,
  id: string,
  at: Date,
): FinanceBudget {
  if (!BUDGET_ID_PATTERN.test(id)) {
    throw new Error('Finance budget ids must be generated UUID addresses.');
  }
  const timestamp = at.toISOString();
  return {
    id,
    category: draft.category,
    limitMinor: draft.limitMinor,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** Applies a validated draft to an existing budget, keeping its identity and creation time. */
export function reviseFinanceBudget(
  existing: FinanceBudget,
  draft: FinanceBudgetDraft,
  at: Date,
): FinanceBudget {
  return {
    ...existing,
    category: draft.category,
    limitMinor: draft.limitMinor,
    updatedAt: at.toISOString(),
  };
}

export function isFinanceBudget(value: unknown): value is FinanceBudget {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    BUDGET_ID_PATTERN.test(value.id) &&
    typeof value.category === 'string' &&
    value.category.trim().length > 0 &&
    value.category.length <= MAX_CATEGORY_LENGTH &&
    isStorableMinorAmount(value.limitMinor) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

/**
 * The strict decoder.
 *
 * Returns `null` for anything it does not recognise — a different version, a missing field, a
 * duplicate id, a duplicate category key, a float limit, a derived field that has no business being
 * stored. The caller treats `null` as *quarantine*, never as *an empty budget list*: an empty list
 * is something the app will happily write over, and these are the user's own planning decisions.
 */
export function parseFinanceBudgetsEnvelope(value: unknown): FinanceBudgetsEnvelope | null {
  if (
    !isRecord(value) ||
    value.version !== FINANCE_BUDGETS_SCHEMA_VERSION ||
    !Array.isArray(value.budgets)
  ) {
    return null;
  }
  if (value.budgets.length > MAX_FINANCE_BUDGETS || !value.budgets.every(isFinanceBudget)) {
    return null;
  }
  const ids = new Set(value.budgets.map((budget) => budget.id));
  if (ids.size !== value.budgets.length) {
    return null;
  }
  /*
    One budget per category, enforced at the boundary as well as at the mutation. Two budgets for one
    category would make "spent against budgeted" ambiguous, and the roll-up would have to pick one —
    which is a decision no code should be making silently about somebody's money.
  */
  const keys = new Set(value.budgets.map((budget) => financeCategoryKey(budget.category)));
  if (keys.size !== value.budgets.length) {
    return null;
  }
  return { version: FINANCE_BUDGETS_SCHEMA_VERSION, budgets: value.budgets };
}

/** By category label, so the list has one stable order rather than insertion order. */
export function sortFinanceBudgets(budgets: readonly FinanceBudget[]): readonly FinanceBudget[] {
  return [...budgets].sort((left, right) => left.category.localeCompare(right.category));
}

/**
 * Whether the ledger currency may still be changed, now that budgets exist too.
 *
 * #92's rule was "only while the ledger holds no transactions", for a reason that applies word for
 * word to a budget: there is no honest conversion, so a change is offered exactly when it costs
 * nothing and refused afterwards. A budget is an amount of money in that currency, so leaving it
 * out would let somebody switch from AED to JPY while a 600.00 grocery budget sat there and quietly
 * became 600 yen.
 *
 * Stated here rather than inside `canChangeCurrency` because budgets live in their own store and the
 * ledger domain must not learn to read it — the composition happens where both are already held.
 */
export function canChangeFinanceCurrency(
  hasTransactions: boolean,
  budgets: readonly FinanceBudget[],
): boolean {
  return !hasTransactions && budgets.length === 0;
}
