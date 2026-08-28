import { isLocalDate } from '@features/planner/data/planner-task';

import { isFinanceGoalId } from './finance-goal';
import { isFinanceCurrency, isStorableMinorAmount, type FinanceCurrency } from './finance-money';

/**
 * **One account's Finance ledger, and the envelope it is stored in** — issue #92.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The ledger begins unconfigured ─────────────────────────────────────────
 * A new ledger has `currency: null`. That is not an error state and not a missing value to be
 * filled with a default — it is the honest description of an account whose owner has not yet said
 * what their money is in. Every later screen has to handle it, which is the point: the alternative
 * is guessing, and a guessed currency is unrecoverable once amounts are entered under it.
 *
 * ── The rule that makes the currency safe ──────────────────────────────────
 * It may change **only while the ledger holds no transactions**. There is no honest conversion:
 * historical amounts were recorded in the old currency and rewriting them would invent a rate, while
 * leaving them would relabel money that never was that money. So the change is available exactly
 * when it costs nothing, and refused afterwards. `canChangeCurrency` states that as one predicate
 * rather than leaving each caller to remember it.
 *
 * ── What a transaction carries, and what it does not ───────────────────────
 * An id, a direction, a positive minor-unit amount, the local day it happened on, and optional
 * category and note. Nothing else. There is no `syncedAt`, no `remoteId`, no `dirty` flag and no
 * `deviceId`: Finance has no server, and a field that anticipates one is a claim in the schema —
 * the same class of untruth #90 removed from the registry copy.
 *
 * `occurredOn` is a `YYYY-MM-DD` local date key, produced by the caller from the shared Planner day
 * source. This module never reads a clock; it validates the shape it is handed.
 *
 * ── One field was added, and it is user intent — issue #95 ─────────────────
 * `goalId` marks a transaction as a contribution the user deliberately made toward a savings goal.
 * #95 requires that "a contribution is a transaction, so the ledger stays the single record of money
 * moved", and a contribution therefore has to be identifiable *as* one. The alternative considered
 * was matching a goal to transactions by category, the way #94 matches a budget — rejected, because
 * a "Holiday" goal beside a "Holiday" spending category would count a hotel bill as money set
 * aside. `finance-goal.ts` records that reasoning at length.
 *
 * It is a reference the user created, not a total, a status or a flag anticipating a server, so it
 * belongs here for the same reason `category` does. Nothing in this module resolves it: the ledger
 * knows a goal id is *shaped* like one and nothing more, and only `finance-goal-progress` — which
 * holds both stores — ever asks whether a goal by that id exists.
 *
 * It is **optional on the type**, deliberately and permanently. Every transaction this app writes
 * carries the key explicitly, `null` included; the optionality exists for records already stored
 * before Savings did, which decode unchanged and read as unattributed. That is why the schema version
 * did not move: a bump would have quarantined every existing ledger over a field whose absence is
 * already unambiguous, and quarantining somebody's real transactions to add a feature is a far worse
 * outcome than a type that admits `undefined`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const FINANCE_LEDGER_SCHEMA_VERSION = 1;

/** How many transactions one ledger may hold. A bound the decoder enforces, not a suggestion. */
export const MAX_FINANCE_TRANSACTIONS = 5000;

const MAX_CATEGORY_LENGTH = 40;
const MAX_NOTE_LENGTH = 280;

/** `finance.` plus a v4-shaped UUID, so an id cannot be a sequence a caller invented. */
const TRANSACTION_ID_PATTERN = /^finance\.[0-9a-f-]{36}$/i;

/**
 * Which way the money moved.
 *
 * Carried here rather than by the amount's sign, so there is exactly one representation of "spent
 * twelve" and no `Math.abs` anywhere deciding what a negative meant.
 */
export type FinanceDirection = 'expense' | 'income';

export type FinanceTransaction = {
  readonly id: string;
  readonly direction: FinanceDirection;
  /** Positive integer, in the ledger currency's minor unit. */
  readonly amountMinor: number;
  /** Local `YYYY-MM-DD`, from the shared day source. */
  readonly occurredOn: string;
  readonly category: string | null;
  readonly note: string | null;
  /**
   * The savings goal this contribution was made toward — issue #95.
   *
   * `null` for ordinary spending and income, and absent on records stored before Savings existed.
   * Both read as unattributed; see the header note on why the version did not move.
   */
  readonly goalId?: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type FinanceLedger = {
  /** `null` until the owner chooses one. Never inferred. */
  readonly currency: FinanceCurrency | null;
  readonly transactions: readonly FinanceTransaction[];
};

export type FinanceLedgerEnvelope = {
  readonly version: typeof FINANCE_LEDGER_SCHEMA_VERSION;
  readonly currency: FinanceCurrency | null;
  readonly transactions: readonly FinanceTransaction[];
};

export type FinanceDraft = {
  readonly direction: FinanceDirection;
  readonly amountMinor: number;
  readonly occurredOn: string;
  readonly category?: string | null;
  readonly note?: string | null;
  /**
   * Which savings goal this contributes to, if any — issue #95.
   *
   * Three-valued on purpose. A goal id attributes the record, `null` detaches it, and **omitting the
   * key means "leave whatever is already there"**. That third case is what stops the Spending screen
   * from silently destroying an attribution: someone editing a contribution's note there sends a
   * draft with no `goalId`, and without this the goal would quietly lose the money. `undefined` is
   * only meaningful on a revise; a create has nothing to preserve and stores `null`.
   */
  readonly goalId?: string | null;
};

export type FinanceFault =
  | 'no-currency'
  | 'currency-locked'
  | 'unsupported-currency'
  | 'invalid-amount'
  | 'invalid-date'
  | 'invalid-category'
  | 'invalid-note'
  /** The attribution is not a goal-shaped id. Decided here, from the record alone. */
  | 'invalid-goal'
  /**
   * The attribution is well formed but names no goal this account holds.
   *
   * Raised by the provider, not by this module: whether a goal exists is a question about a store the
   * ledger domain must know nothing about, and it is answered where both stores are already held.
   */
  | 'unknown-goal'
  | 'not-found'
  | 'ledger-full';

/**
 * A draft every field of which has been checked.
 *
 * Named rather than `Required<FinanceDraft>` because `goalId` must stay three-valued through
 * validation — `Required` would collapse "leave it alone" into a value and lose the distinction the
 * draft type exists to carry.
 */
export type ValidatedFinanceDraft = {
  readonly direction: FinanceDirection;
  readonly amountMinor: number;
  readonly occurredOn: string;
  readonly category: string | null;
  readonly note: string | null;
  readonly goalId?: string | null;
};

export type FinanceValidation =
  | { readonly kind: 'valid'; readonly draft: ValidatedFinanceDraft }
  | { readonly kind: 'invalid'; readonly fault: FinanceFault };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An empty, unconfigured ledger. The state a new account starts in. */
export function emptyFinanceLedger(): FinanceLedger {
  return { currency: null, transactions: [] };
}

/**
 * Whether the currency may still be set or changed.
 *
 * The whole rule, in one place: a ledger with no monetary records has nothing to relabel.
 */
export function canChangeCurrency(ledger: FinanceLedger): boolean {
  return ledger.transactions.length === 0;
}

/** Validates a draft without touching a clock or a store. */
export function validateFinanceDraft(draft: FinanceDraft): FinanceValidation {
  if (!isStorableMinorAmount(draft.amountMinor)) {
    return { kind: 'invalid', fault: 'invalid-amount' };
  }
  if (!isLocalDate(draft.occurredOn)) {
    return { kind: 'invalid', fault: 'invalid-date' };
  }
  const category = draft.category?.trim() ?? '';
  if (category.length > MAX_CATEGORY_LENGTH) {
    return { kind: 'invalid', fault: 'invalid-category' };
  }
  const note = draft.note?.trim() ?? '';
  if (note.length > MAX_NOTE_LENGTH) {
    return { kind: 'invalid', fault: 'invalid-note' };
  }
  if (draft.goalId !== undefined && draft.goalId !== null && !isFinanceGoalId(draft.goalId)) {
    /*
      Shape only. Whether a goal by that id exists is a question about a store this module must know
      nothing about, and it is asked where both stores are held — see the header note.
    */
    return { kind: 'invalid', fault: 'invalid-goal' };
  }
  return {
    kind: 'valid',
    draft: {
      direction: draft.direction,
      amountMinor: draft.amountMinor,
      occurredOn: draft.occurredOn,
      category: category.length === 0 ? null : category,
      note: note.length === 0 ? null : note,
      /* Spread rather than assigned, so an omitted key stays omitted rather than becoming `null`. */
      ...(draft.goalId === undefined ? {} : { goalId: draft.goalId }),
    },
  };
}

/**
 * Builds a transaction from a validated draft.
 *
 * `id` and `at` are supplied by the caller — the repository owns identity and the clock, so this
 * function is pure and a test can state both.
 */
export function createFinanceTransaction(
  draft: ValidatedFinanceDraft,
  id: string,
  at: Date,
): FinanceTransaction {
  if (!TRANSACTION_ID_PATTERN.test(id)) {
    throw new Error('Finance transaction ids must be generated UUID addresses.');
  }
  const timestamp = at.toISOString();
  return {
    id,
    direction: draft.direction,
    amountMinor: draft.amountMinor,
    occurredOn: draft.occurredOn,
    category: draft.category,
    note: draft.note,
    /* A create has nothing to preserve, so an omitted attribution is stored as the absence it is. */
    goalId: draft.goalId ?? null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** Applies a validated draft to an existing transaction, keeping its identity and creation time. */
export function reviseFinanceTransaction(
  existing: FinanceTransaction,
  draft: ValidatedFinanceDraft,
  at: Date,
): FinanceTransaction {
  return {
    ...existing,
    direction: draft.direction,
    amountMinor: draft.amountMinor,
    occurredOn: draft.occurredOn,
    category: draft.category,
    note: draft.note,
    /*
      The one place the third state matters. A draft that says nothing about the goal leaves the
      existing attribution alone, so editing a contribution from the Spending screen — which knows
      nothing about goals — cannot silently take the money out of somebody's savings total.
    */
    goalId: draft.goalId === undefined ? (existing.goalId ?? null) : draft.goalId,
    updatedAt: at.toISOString(),
  };
}

export function isFinanceTransaction(value: unknown): value is FinanceTransaction {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    TRANSACTION_ID_PATTERN.test(value.id) &&
    (value.direction === 'expense' || value.direction === 'income') &&
    isStorableMinorAmount(value.amountMinor) &&
    typeof value.occurredOn === 'string' &&
    isLocalDate(value.occurredOn) &&
    (value.category === null ||
      (typeof value.category === 'string' &&
        value.category.length > 0 &&
        value.category.length <= MAX_CATEGORY_LENGTH)) &&
    (value.note === null ||
      (typeof value.note === 'string' &&
        value.note.length > 0 &&
        value.note.length <= MAX_NOTE_LENGTH)) &&
    /*
      Absent, `null`, or a goal-shaped id. Absent is the pre-#95 record and is accepted rather than
      quarantined — see the header note on why the schema version did not move. Anything else is a
      value nothing wrote, so it is refused.
    */
    (value.goalId === undefined || value.goalId === null || isFinanceGoalId(value.goalId)) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

/**
 * The strict decoder.
 *
 * Returns `null` for **anything** it does not recognise — a different version, a missing field, a
 * duplicate id, a float amount, an unknown currency. The caller treats `null` as *quarantine*, never
 * as *empty*: the distinction is the whole point, because "empty" is a ledger the app will happily
 * write over.
 */
export function parseFinanceLedgerEnvelope(value: unknown): FinanceLedgerEnvelope | null {
  if (
    !isRecord(value) ||
    value.version !== FINANCE_LEDGER_SCHEMA_VERSION ||
    !Array.isArray(value.transactions)
  ) {
    return null;
  }
  if (!(value.currency === null || isFinanceCurrency(value.currency))) {
    return null;
  }
  if (
    value.transactions.length > MAX_FINANCE_TRANSACTIONS ||
    !value.transactions.every(isFinanceTransaction)
  ) {
    return null;
  }
  const ids = new Set(value.transactions.map((transaction) => transaction.id));
  if (ids.size !== value.transactions.length) {
    return null;
  }
  /*
    A ledger holding money in no currency is incoherent, whatever produced it. Refusing it here is
    what stops a later screen having to decide how to render an amount it cannot label.
  */
  if (value.currency === null && value.transactions.length > 0) {
    return null;
  }
  return {
    version: FINANCE_LEDGER_SCHEMA_VERSION,
    currency: value.currency,
    transactions: value.transactions,
  };
}

/** Newest occurrence first, then newest creation, so a list is stable across equal days. */
export function sortFinanceTransactions(
  transactions: readonly FinanceTransaction[],
): readonly FinanceTransaction[] {
  return [...transactions].sort((left, right) => {
    if (left.occurredOn !== right.occurredOn) {
      return left.occurredOn < right.occurredOn ? 1 : -1;
    }
    if (left.createdAt !== right.createdAt) {
      return left.createdAt < right.createdAt ? 1 : -1;
    }
    return left.id < right.id ? -1 : 1;
  });
}
