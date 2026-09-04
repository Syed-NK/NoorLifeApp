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

/**
 * The longest receipt path this ledger will store.
 *
 * A sandbox path is well under it. A bound rather than a guess, for the same reason the sanitiser in
 * `pending-destination.ts` carries one: an unbounded string reaching storage is a string somebody
 * else chose the length of.
 */
const MAX_RECEIPT_URI_LENGTH = 512;

/** Codepoints no path this app generates can contain. */
const RECEIPT_URI_SPACE = 0x20;
const RECEIPT_URI_DELETE = 0x7f;
const RECEIPT_URI_BACKSLASH = 0x5c;

/**
 * Whether a receipt attachment is a shape this app could have written — issue #101.
 *
 * A local `file://` URI, bounded, with no traversal segment and no character a path this app
 * generated could contain. The stored name is 32 hex characters and an extension, so anything
 * carrying `..`, a control character, a backslash or a query fragment did not come from
 * `retainReceiptImage` and is refused rather than stored and later handed to a delete.
 *
 * Shape only. Containment inside the account's own directory is enforced where the filesystem is
 * known — see the fault's note.
 */
function isReceiptAttachment(value: string): boolean {
  if (value.length === 0 || value.length > MAX_RECEIPT_URI_LENGTH) {
    return false;
  }
  if (!value.startsWith('file:///')) {
    return false;
  }
  if (value.includes('?') || value.includes('#')) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (
      code <= RECEIPT_URI_SPACE ||
      code === RECEIPT_URI_DELETE ||
      code === RECEIPT_URI_BACKSLASH
    ) {
      return false;
    }
  }
  return !value.split('/').some((segment) => segment === '..' || segment === '.');
}

/** `finance.` plus a v4-shaped UUID, so an id cannot be a sequence a caller invented. */
const TRANSACTION_ID_PATTERN = /^finance\.[0-9a-f-]{36}$/i;

/**
 * Which way the money moved.
 *
 * Carried here rather than by the amount's sign, so there is exactly one representation of "spent
 * twelve" and no `Math.abs` anywhere deciding what a negative meant.
 */
export type FinanceDirection = 'expense' | 'income';

/**
 * Whether an expense is money spent or money coming back — issue #96.
 *
 * A named union rather than a boolean `refund?: true`, so the ordinary case has a name too. A
 * boolean would leave "not a refund" as the absence of a flag, and absence is exactly what a
 * future third case — a transfer, a correction — would have to be squeezed into.
 */
export type FinanceRecordFlavour = 'ordinary' | 'refund';

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
  /**
   * Whether this expense is money coming back — issue #96.
   *
   * #96: "A refund is a negative expense, not an income record." That sentence and #92's model —
   * positive magnitudes with a direction — are both kept, by separating the two things the word
   * "negative" was doing at once. The **stored magnitude stays positive**, because a signed amount
   * invites two spellings of one fact; the **derived effect is negative**, because a refund reduces
   * what was consumed. `finance-record-kind.ts` owns that effect, once.
   *
   * `'refund'` is only ever paired with `direction: 'expense'`, which the validator enforces: a
   * refund is a *kind of expense*, so filing it as income would be the exact reading #96 forbids.
   *
   * Optional, and absent means `'ordinary'`. Every record stored before this issue decodes unchanged
   * with its previous expense-or-income meaning, which is why the schema version does not move —
   * the same reasoning `goalId` records above.
   */
  readonly kind?: FinanceRecordFlavour;
  /**
   * The retained receipt image this transaction was recorded from — issue #101.
   *
   * ═══════════════════════════════════════════════════════════════════════════
   * ── Why this belongs in the record rather than in an index beside it ───────
   * #101's retention contract is that "deleting the transaction deletes the image". That is a
   * statement about one thing owning another, and the only way to keep it true is for the owner to
   * hold the reference. A second store keyed by transaction id would be two writes that can
   * disagree — the exact objection `finance-provider` already records against `addContribution`,
   * where "a method that wrote to two stores could not be atomic".
   *
   * Without it a kept image is an orphan: a random filename under the account's retention directory
   * that nothing points at, that no screen can show, and that no deletion can ever reach. Receipts
   * are among the most sensitive things this app holds, and an unbounded store of them with no
   * deletion path is a worse privacy outcome than not keeping them at all.
   *
   * ── It is a reference the user created, which is the test this schema applies ──
   * The header note refuses `syncedAt`, `remoteId`, `dirty` and `deviceId` because each anticipates
   * a server. This anticipates nothing: it is a local file the user explicitly asked to keep,
   * recorded for the same reason `goalId` is — so the thing they created can be found again.
   *
   * Optional and permanently so, exactly as `goalId` and `kind` are. Records written before
   * Receipts existed decode unchanged and read as unattached, so the schema version does not move
   * and no existing ledger is quarantined over a field whose absence is already unambiguous.
   *
   * **Never an accounting input.** No total, budget, goal progress or refund effect reads it, which
   * `finance-receipt-attachment.test.ts` asserts by attaching one and comparing every derived
   * figure.
   * ═══════════════════════════════════════════════════════════════════════════
   */
  readonly receiptUri?: string | null;
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
  /**
   * Ordinary or refund — issue #96. Three-valued for the same reason `goalId` is.
   *
   * Omitting the key preserves what is already stored, so a surface that knows nothing about refunds
   * — Receipts, or the Savings contribution composer — cannot silently turn one back into an
   * ordinary expense by editing its note.
   */
  readonly kind?: FinanceRecordFlavour;
  /**
   * The retained receipt image to attach — issue #101. Three-valued for the same reason.
   *
   * Omitting the key preserves an existing attachment, so editing an amount from the Spending
   * screen — which knows nothing about receipts — cannot detach the image and strand it. `null`
   * detaches deliberately.
   */
  readonly receiptUri?: string | null;
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
  /** A refund filed as income, which is the reading #96 forbids. */
  | 'refund-must-be-expense'
  /** A refund attributed to a savings goal. #96 defines no such combination, so it is refused. */
  | 'refund-cannot-be-savings'
  | 'not-found'
  /**
   * The receipt attachment is not a shape this app could have written — issue #101.
   *
   * Shape only, like `invalid-goal`. Whether the file exists, and whether it sits inside *this*
   * account's retention directory, are questions about the filesystem this module must know nothing
   * about; `discardRetainedImage` answers the second one and refuses everything else, so a stored
   * path can never reach outside the account that stored it however it got here.
   */
  | 'invalid-receipt'
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
  readonly kind?: FinanceRecordFlavour;
  readonly receiptUri?: string | null;
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
  if (draft.kind !== undefined && draft.kind !== 'ordinary' && draft.kind !== 'refund') {
    /* An unrecognised flavour is refused rather than guessed at — see the decoder note. */
    return { kind: 'invalid', fault: 'refund-must-be-expense' };
  }
  if (draft.kind === 'refund') {
    /*
      #96: "A refund is a negative expense, **not an income record**." Filing one as income is
      precisely the mistake the sentence names, so it is refused at the boundary rather than
      corrected later by something that has to guess what was meant.
    */
    if (draft.direction !== 'expense') {
      return { kind: 'invalid', fault: 'refund-must-be-expense' };
    }
    /*
      A refund into a savings goal has no defined meaning: #95 gives a goal-attributed expense one
      reading (money set aside) and a goal-attributed income another (money taken back out), and a
      refund is neither. #96 defines no third combination, so this is refused rather than invented.
    */
    if (draft.goalId !== undefined && draft.goalId !== null) {
      return { kind: 'invalid', fault: 'refund-cannot-be-savings' };
    }
  }
  if (
    draft.receiptUri !== undefined &&
    draft.receiptUri !== null &&
    !isReceiptAttachment(draft.receiptUri)
  ) {
    /*
      Refused rather than dropped. Silently discarding a malformed attachment would record the
      transaction and strand the image the user asked to keep, which is the orphan this field exists
      to prevent.
    */
    return { kind: 'invalid', fault: 'invalid-receipt' };
  }
  return {
    kind: 'valid',
    draft: {
      direction: draft.direction,
      amountMinor: draft.amountMinor,
      occurredOn: draft.occurredOn,
      category: category.length === 0 ? null : category,
      note: note.length === 0 ? null : note,
      /* Spread rather than assigned, so an omitted key stays omitted rather than becoming a value. */
      ...(draft.kind === undefined ? {} : { kind: draft.kind }),
      ...(draft.goalId === undefined ? {} : { goalId: draft.goalId }),
      ...(draft.receiptUri === undefined ? {} : { receiptUri: draft.receiptUri }),
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
    /* Absent means ordinary, so a create stores the flavour it was given or the default. */
    kind: draft.kind ?? 'ordinary',
    /* A create has nothing to preserve either: no attachment is stored as the absence it is. */
    receiptUri: draft.receiptUri ?? null,
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
    /* Same three-valued preservation: a draft that says nothing leaves a refund a refund. */
    kind: draft.kind === undefined ? (existing.kind ?? 'ordinary') : draft.kind,
    /*
      And again for the receipt — issue #101. Editing an amount from the Spending screen sends a
      draft with no `receiptUri`, and dropping the attachment there would strand the kept image
      under a name nothing points at any more.
    */
    receiptUri: draft.receiptUri === undefined ? (existing.receiptUri ?? null) : draft.receiptUri,
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
    /*
      Absent, `'ordinary'`, or `'refund'` — issue #96. Absent is the pre-#96 record and reads as
      ordinary, which is what keeps every existing ledger decoding unchanged.

      An unrecognised flavour is **quarantined, not guessed**. A record stamped with a word this
      build does not know has some meaning that this build cannot compute, and defaulting it to
      ordinary would silently turn a refund into spending — the same coercion #96 refuses for a
      mismatched currency, for the same reason.
    */
    (value.kind === undefined || value.kind === 'ordinary' || value.kind === 'refund') &&
    /*
      A stored refund must be an expense and must not be a savings transfer. Both are refused rather
      than corrected: a refund filed as income is the reading #96 forbids, and a refund attributed to
      a goal is a combination #96 never defines.
    */
    (value.kind !== 'refund' ||
      (value.direction === 'expense' && (value.goalId === undefined || value.goalId === null))) &&
    /*
      Absent, `null`, or a path this app could have written — issue #101. Absent is the pre-Receipts
      record and reads as unattached, on the same terms as `goalId` above.

      A malformed one is **quarantined, not dropped**. Accepting the record and discarding the field
      would leave a kept image that nothing points at — the orphan the field exists to prevent — and
      the record itself is evidence something wrote a path this app does not generate.
    */
    (value.receiptUri === undefined ||
      value.receiptUri === null ||
      (typeof value.receiptUri === 'string' && isReceiptAttachment(value.receiptUri))) &&
    /*
      A record may not carry a currency — issue #96: "a record whose currency does not match the
      ledger's ... must be quarantined, never coerced."

      The envelope owns the currency, once, for every amount inside it. A per-record code would be a
      second answer to what an integer means, and the coercion it invites is the dangerous part: a
      record stamped `JPY` inside an `AED` ledger has no honest reading — 1234 is either 12.34 or
      1234 and nothing here can tell which. Refusing the whole envelope keeps the bytes intact for
      something that does know, which is the same reason quarantine exists at all.
    */
    !('currency' in value) &&
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
