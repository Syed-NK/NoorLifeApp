import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  FINANCE_GOALS_SCHEMA_VERSION,
  MAX_FINANCE_GOALS,
  createFinanceGoal,
  findGoalByName,
  parseFinanceGoalsEnvelope,
  reviseFinanceGoal,
  sortFinanceGoals,
  validateFinanceGoalDraft,
  type FinanceGoal,
  type FinanceGoalDraft,
  type FinanceGoalFault,
} from './finance-goal';
import {
  financeGoalsAddress,
  financeOwnerSegment,
  type FinanceStorage,
} from './finance-ledger.repository';
import { serializeFinanceWrite } from './finance-write-queue';

/**
 * **The account-scoped savings-goal store** — issue #95.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The same three rules the other two stores already live by ──────────────
 * The address is the account, quarantine is not empty, and one writer per address. This is #92's
 * repository shape applied to a third store rather than a new design, because every one of those
 * rules was arrived at by finding the defect it prevents, and a goal store that reasoned about
 * ownership differently would be a second answer to "whose data is this".
 *
 * `financeOwnerSegment` is imported, not restated. Only a v4-shaped uuid becomes an address, and an
 * id carrying a dot, a traversal or another account's id as a prefix is refused outright rather than
 * escaped — so a refused address resolves `unavailable` before storage is touched, and signed out
 * takes exactly that path.
 *
 * ── There is no contribution method here, and that is the design ───────────
 * #95 makes a contribution a transaction, so contributions are created, edited and removed through
 * the **ledger** repository. This store holds targets only.
 *
 * That is what makes every contribution mutation atomic. The alternative — a list of contribution
 * ids kept beside each goal — was rejected precisely because it cannot be: adding one would be a
 * write to the ledger followed by a write to this store, two lanes, no transaction across them, and
 * a failure between them leaving money recorded that no goal counts. Keeping attribution *on the
 * transaction* makes adding a contribution one write to one address in one lane, and there is no
 * cross-store consistency left to get wrong.
 *
 * ── One goal per name, enforced inside the lane ────────────────────────────
 * The duplicate check reads the current list *inside* `serializeFinanceWrite`, so two writes racing
 * to create the same name cannot both pass it. Checking before the lane would be a check against a
 * list that a queued write is about to change.
 *
 * ── Deleting a goal touches nothing else ──────────────────────────────────
 * One write, to this address, removing one record. The transactions attributed to it stay in the
 * ledger untouched, because #95 makes the ledger the single record of money that moved and the money
 * did move. Their now-unresolvable `goalId` is inert: `finance-goal-progress` only ever asks what
 * belongs to a goal that exists, so a stale id is never reached and a goal recreated later gets a
 * new id rather than inheriting a total.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type FinanceGoalsReadResult =
  | { readonly kind: 'ok'; readonly goals: readonly FinanceGoal[] }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'corrupt' };

export type FinanceGoalMutation =
  | { readonly kind: 'ok'; readonly goals: readonly FinanceGoal[] }
  | { readonly kind: 'invalid'; readonly fault: FinanceGoalFault }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'corrupt' };

export type FinanceGoalRepository = {
  /** The owner this repository writes for, normalised, or `null` when there is none it will trust. */
  readonly ownerId: string | null;
  readonly read: () => Promise<FinanceGoalsReadResult>;
  readonly createGoal: (draft: FinanceGoalDraft) => Promise<FinanceGoalMutation>;
  readonly updateGoal: (id: string, draft: FinanceGoalDraft) => Promise<FinanceGoalMutation>;
  readonly removeGoal: (id: string) => Promise<FinanceGoalMutation>;
};

export type FinanceGoalRepositoryDeps = {
  readonly ownerId: string | null;
  readonly storage?: FinanceStorage;
  readonly id?: () => string;
  /** Record timestamps only. Never a source of "today". */
  readonly now?: () => Date;
};

function uuid(): string {
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoRef?.randomUUID === 'function') {
    return `finance.goal.${cryptoRef.randomUUID()}`;
  }
  const hex = (length: number): string =>
    Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `finance.goal.${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
}

export function createFinanceGoalRepository(
  deps: FinanceGoalRepositoryDeps,
): FinanceGoalRepository {
  const storage: FinanceStorage = deps.storage ?? AsyncStorage;
  const now = deps.now ?? (() => new Date());
  const nextId = deps.id ?? uuid;
  const address = financeGoalsAddress(deps.ownerId);

  async function readAt(): Promise<FinanceGoalsReadResult> {
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
      /* Nothing stored is genuinely no goals — distinct from bytes that would not decode. */
      return { kind: 'ok', goals: [] };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { kind: 'corrupt' };
    }
    const envelope = parseFinanceGoalsEnvelope(parsed);
    if (envelope === null) {
      return { kind: 'corrupt' };
    }
    return { kind: 'ok', goals: sortFinanceGoals(envelope.goals) };
  }

  async function write(goals: readonly FinanceGoal[]): Promise<FinanceGoalMutation> {
    if (address === null) {
      return { kind: 'unavailable' };
    }
    /*
      Exactly the two fields the schema declares. Nothing derived is written — no contributed total,
      no remaining, no percentage, no completion flag — and a test reads the stored string back to
      prove it.
    */
    const envelope = { version: FINANCE_GOALS_SCHEMA_VERSION, goals };
    try {
      await storage.setItem(address, JSON.stringify(envelope));
    } catch {
      return { kind: 'unavailable' };
    }
    return { kind: 'ok', goals };
  }

  /** Read, change, write — all inside one lane slot, so read-modify-write is atomic. */
  function mutate(
    change: (goals: readonly FinanceGoal[]) => FinanceGoalMutation,
  ): Promise<FinanceGoalMutation> {
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
      const next = change(current.goals);
      return next.kind === 'ok' ? write(next.goals) : next;
    });
  }

  return {
    ownerId: financeOwnerSegment(deps.ownerId),

    read: () => serializeFinanceWrite(address ?? 'finance.goals.unavailable', readAt),

    createGoal: (draft) =>
      mutate((goals) => {
        const validation = validateFinanceGoalDraft(draft);
        if (validation.kind !== 'valid') {
          return { kind: 'invalid', fault: validation.fault };
        }
        if (goals.length >= MAX_FINANCE_GOALS) {
          return { kind: 'invalid', fault: 'goals-full' };
        }
        if (findGoalByName(goals, validation.draft.name) !== null) {
          return { kind: 'invalid', fault: 'duplicate-name' };
        }
        const created = createFinanceGoal(validation.draft, nextId(), now());
        return { kind: 'ok', goals: sortFinanceGoals([...goals, created]) };
      }),

    updateGoal: (id, draft) =>
      mutate((goals) => {
        const existing = goals.find((goal) => goal.id === id);
        if (existing === undefined) {
          return { kind: 'invalid', fault: 'not-found' };
        }
        const validation = validateFinanceGoalDraft(draft);
        if (validation.kind !== 'valid') {
          return { kind: 'invalid', fault: validation.fault };
        }
        if (findGoalByName(goals, validation.draft.name, id) !== null) {
          return { kind: 'invalid', fault: 'duplicate-name' };
        }
        const revised = reviseFinanceGoal(existing, validation.draft, now());
        return {
          kind: 'ok',
          goals: sortFinanceGoals(goals.map((goal) => (goal.id === id ? revised : goal))),
        };
      }),

    removeGoal: (id) =>
      mutate((goals) => {
        if (!goals.some((goal) => goal.id === id)) {
          return { kind: 'invalid', fault: 'not-found' };
        }
        return { kind: 'ok', goals: goals.filter((goal) => goal.id !== id) };
      }),
  };
}
