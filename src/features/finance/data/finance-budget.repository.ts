import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  FINANCE_BUDGETS_SCHEMA_VERSION,
  MAX_FINANCE_BUDGETS,
  createFinanceBudget,
  findBudgetForCategory,
  parseFinanceBudgetsEnvelope,
  reviseFinanceBudget,
  sortFinanceBudgets,
  validateFinanceBudgetDraft,
  type FinanceBudget,
  type FinanceBudgetDraft,
  type FinanceBudgetFault,
} from './finance-budget';
import {
  financeBudgetsAddress,
  financeOwnerSegment,
  type FinanceStorage,
} from './finance-ledger.repository';
import { serializeFinanceWrite } from './finance-write-queue';

/**
 * **The account-scoped budget store** — issue #94.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The same three rules the ledger store already lives by ─────────────────
 * The address is the account, quarantine is not empty, and one writer per address. This is #92's
 * repository shape applied to a second store rather than a new design, because every one of those
 * rules was arrived at by finding the defect it prevents, and a budget store that reasoned about
 * ownership differently would be a second answer to "whose data is this".
 *
 * `financeOwnerSegment` is imported, not restated. Only a v4-shaped uuid becomes an address, and an
 * id carrying a dot, a traversal or another account's id as a prefix is refused outright rather than
 * escaped — so a refused address resolves `unavailable` before storage is touched, and signed out
 * takes exactly that path.
 *
 * ── Why budgets are not folded into the ledger envelope ────────────────────
 * Two independently-corruptible records behind one decoder means a malformed budget quarantines the
 * transactions. Somebody would lose sight of what they had spent because a planning record went
 * bad. Separate addresses, separate versions, separate blast radii.
 *
 * The cost is that two stores can be read at different moments, and the provider therefore holds
 * both under one owner and switches them together. That is a real cost, and it is smaller than the
 * one it buys off.
 *
 * ── One budget per category, enforced inside the lane ──────────────────────
 * The duplicate check reads the current list *inside* `serializeFinanceWrite`, so two writes racing
 * to create the same category cannot both pass it. Checking before the lane would be a check against
 * a list that a queued write is about to change.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type FinanceBudgetsReadResult =
  | { readonly kind: 'ok'; readonly budgets: readonly FinanceBudget[] }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'corrupt' };

export type FinanceBudgetMutation =
  | { readonly kind: 'ok'; readonly budgets: readonly FinanceBudget[] }
  | { readonly kind: 'invalid'; readonly fault: FinanceBudgetFault }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'corrupt' };

export type FinanceBudgetRepository = {
  /** The owner this repository writes for, normalised, or `null` when there is none it will trust. */
  readonly ownerId: string | null;
  readonly read: () => Promise<FinanceBudgetsReadResult>;
  readonly createBudget: (draft: FinanceBudgetDraft) => Promise<FinanceBudgetMutation>;
  readonly updateBudget: (id: string, draft: FinanceBudgetDraft) => Promise<FinanceBudgetMutation>;
  readonly removeBudget: (id: string) => Promise<FinanceBudgetMutation>;
};

export type FinanceBudgetRepositoryDeps = {
  readonly ownerId: string | null;
  readonly storage?: FinanceStorage;
  readonly id?: () => string;
  /** Record timestamps only. Never a source of "today". */
  readonly now?: () => Date;
};

function uuid(): string {
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoRef?.randomUUID === 'function') {
    return `finance.budget.${cryptoRef.randomUUID()}`;
  }
  const hex = (length: number): string =>
    Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `finance.budget.${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
}

export function createFinanceBudgetRepository(
  deps: FinanceBudgetRepositoryDeps,
): FinanceBudgetRepository {
  const storage: FinanceStorage = deps.storage ?? AsyncStorage;
  const now = deps.now ?? (() => new Date());
  const nextId = deps.id ?? uuid;
  const address = financeBudgetsAddress(deps.ownerId);

  async function readAt(): Promise<FinanceBudgetsReadResult> {
    if (address === null) {
      return { kind: 'unavailable' };
    }
    let raw: string | null;
    try {
      raw = await storage.getItem(address);
    } catch {
      return { kind: 'unavailable' };
    }
    if (raw === null) {
      /* Nothing stored is genuinely no budgets — distinct from bytes that would not decode. */
      return { kind: 'ok', budgets: [] };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { kind: 'corrupt' };
    }
    const envelope = parseFinanceBudgetsEnvelope(parsed);
    if (envelope === null) {
      return { kind: 'corrupt' };
    }
    return { kind: 'ok', budgets: sortFinanceBudgets(envelope.budgets) };
  }

  async function write(budgets: readonly FinanceBudget[]): Promise<FinanceBudgetMutation> {
    if (address === null) {
      return { kind: 'unavailable' };
    }
    /*
      Exactly the two fields the schema declares. Nothing derived is written — no spend, no
      remaining, no percentage — and a test reads the stored string back to prove it.
    */
    const envelope = { version: FINANCE_BUDGETS_SCHEMA_VERSION, budgets };
    try {
      await storage.setItem(address, JSON.stringify(envelope));
    } catch {
      return { kind: 'unavailable' };
    }
    return { kind: 'ok', budgets };
  }

  /** Read, change, write — all inside one lane slot, so read-modify-write is atomic. */
  function mutate(
    change: (budgets: readonly FinanceBudget[]) => FinanceBudgetMutation,
  ): Promise<FinanceBudgetMutation> {
    if (address === null) {
      return Promise.resolve({ kind: 'unavailable' });
    }
    return serializeFinanceWrite(address, async () => {
      const current = await readAt();
      if (current.kind !== 'ok') {
        /* Corrupt stays corrupt, and nothing is written over it. */
        return current.kind === 'corrupt'
          ? ({ kind: 'corrupt' } as const)
          : ({ kind: 'unavailable' } as const);
      }
      const next = change(current.budgets);
      return next.kind === 'ok' ? write(next.budgets) : next;
    });
  }

  return {
    ownerId: financeOwnerSegment(deps.ownerId),

    read: () => serializeFinanceWrite(address ?? 'finance.budgets.unavailable', readAt),

    createBudget: (draft) =>
      mutate((budgets) => {
        const validation = validateFinanceBudgetDraft(draft);
        if (validation.kind !== 'valid') {
          return { kind: 'invalid', fault: validation.fault };
        }
        if (budgets.length >= MAX_FINANCE_BUDGETS) {
          return { kind: 'invalid', fault: 'budgets-full' };
        }
        if (findBudgetForCategory(budgets, validation.draft.category) !== null) {
          return { kind: 'invalid', fault: 'duplicate-category' };
        }
        const created = createFinanceBudget(validation.draft, nextId(), now());
        return { kind: 'ok', budgets: sortFinanceBudgets([...budgets, created]) };
      }),

    updateBudget: (id, draft) =>
      mutate((budgets) => {
        const existing = budgets.find((budget) => budget.id === id);
        if (existing === undefined) {
          return { kind: 'invalid', fault: 'not-found' };
        }
        const validation = validateFinanceBudgetDraft(draft);
        if (validation.kind !== 'valid') {
          return { kind: 'invalid', fault: validation.fault };
        }
        if (findBudgetForCategory(budgets, validation.draft.category, id) !== null) {
          return { kind: 'invalid', fault: 'duplicate-category' };
        }
        const revised = reviseFinanceBudget(existing, validation.draft, now());
        return {
          kind: 'ok',
          budgets: sortFinanceBudgets(
            budgets.map((budget) => (budget.id === id ? revised : budget)),
          ),
        };
      }),

    removeBudget: (id) =>
      mutate((budgets) => {
        if (!budgets.some((budget) => budget.id === id)) {
          return { kind: 'invalid', fault: 'not-found' };
        }
        return { kind: 'ok', budgets: budgets.filter((budget) => budget.id !== id) };
      }),
  };
}
