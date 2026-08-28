/**
 * **When the ledger currency may still be changed** — issues #92, #94, #95.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── One rule, and it now spans three stores ────────────────────────────────
 * #92 stated it for transactions: the currency may change **only while no money has been recorded**,
 * because there is no honest conversion. Rewriting historical amounts would invent a rate; leaving
 * them would relabel money that never was that money. So the change is offered exactly when it costs
 * nothing and refused afterwards.
 *
 * #94 added budgets, and #95 adds savings goals. Both hold an amount in the ledger currency, so both
 * hold the lock: a ledger with no transactions but a 600.00 grocery budget must not silently become
 * 600 yen, and neither must a 20,000.00 Hajj target.
 *
 * ── Why the rule moved here ────────────────────────────────────────────────
 * It lived in the budget domain while there were two stores, which was already slightly off and
 * became untenable at three: the budget module would have had to learn the goal type to keep owning
 * a rule that is not about budgets at all. It is a rule about the **currency**, so it lives beside
 * the currency, and each store's domain stays ignorant of the others.
 *
 * ── Why the argument is a named record, not three booleans ─────────────────
 * `canChangeFinanceCurrency(false, true, false)` is unreadable and, worse, silently survives having
 * two of its arguments transposed — a defect that would let somebody relabel money in exactly the
 * case the rule exists to refuse. Counts under names cannot be swapped by accident, and a fourth
 * store (#101's receipts hold no amount, but something later may) is an added field rather than a
 * changed signature at every call site.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * How many monetary records the account holds, per store.
 *
 * Counts rather than the records themselves, so this module imports no domain and no domain has to
 * import another to answer the question.
 */
export type FinanceMonetaryRecordCounts = {
  readonly transactions: number;
  readonly budgets: number;
  readonly goals: number;
};

/**
 * Whether the ledger currency may still be set or changed.
 *
 * True only when nothing anywhere is denominated in it. Every store counts, and adding one that
 * holds an amount without adding it here is the defect this single predicate exists to prevent.
 */
export function canChangeFinanceCurrency(counts: FinanceMonetaryRecordCounts): boolean {
  return counts.transactions === 0 && counts.budgets === 0 && counts.goals === 0;
}
