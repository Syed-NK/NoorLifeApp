import { isLocalDate } from '@features/planner/data/planner-task';

import { isStorableMinorAmount } from './finance-money';

/**
 * **A savings goal is an intent, and the ledger holds the money** — issue #95.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What #95 actually asks for ─────────────────────────────────────────────
 * "A savings goal is a target amount, an optional target date, and progress **derived from the
 * ledger** — the same rule as #94: an intent is stored, a total never is." And: "A contribution is
 * a transaction, so the ledger stays the single record of money moved."
 *
 * So a record here holds a name, a target, an optional target date, and nothing that could be
 * computed. There is no `contributedMinor`, no `remainingMinor`, no `percentage`, no `completedAt`
 * and no `status`, and a test reads the stored bytes back to prove their absence. A stored total can
 * disagree with the transactions it totals, and a goal that disagrees with the ledger is worse than
 * no goal: it is a wrong answer about somebody's money with a confident label on it.
 *
 * ── Why a contribution is not a record in this file ────────────────────────
 * #95 is explicit that a contribution *is* a transaction. Storing contributions here as well would
 * put two records behind one movement of money: the ledger would say a payment happened and this
 * store would say a contribution happened, and nothing could tell you whether they were the same
 * event counted once or two events counted twice. The ledger already owns amounts, dates, ownership,
 * serialization and quarantine, so a contribution goes there and this store holds only the target it
 * is measured against.
 *
 * ── Why attribution is an id on the transaction, not a category match ──────
 * #94 matches a budget to spending by **category key**, and that is right for a budget: a budget
 * measures a category, so every transaction in the category is in scope by definition.
 *
 * Applying the same trick to a goal was tried and rejected, because a goal does not measure a
 * category — it measures *a set of deliberate transfers*. Someone with a "Holiday" goal and a
 * "Holiday" spending category is entirely ordinary, and a category match would then count their
 * hotel bill as money they had set aside. The screen would report a goal filling up while the money
 * was in fact being spent. That is precisely the class of false claim this programme exists to
 * remove, and no amount of naming guidance makes it safe.
 *
 * So a transaction carries an explicit optional `goalId` — see `finance-ledger.ts`, where the field
 * and its backwards compatibility are documented. Attribution is then something the user did on
 * purpose to one record, never something inferred from a string two features happen to share. It
 * also keeps every contribution mutation **atomic**: adding, editing or removing a contribution is
 * one write to one address in one lane, with no second store to keep in step.
 *
 * ── Deleting a goal keeps its transactions ─────────────────────────────────
 * The money moved. #95 makes the ledger the single record of that, so removing the goal removes the
 * target, not the history — and the confirmation says so in as many words rather than letting the
 * user guess. The transactions keep a `goalId` that now resolves to nothing, which is inert: only
 * `finance-goal-progress` reads it, and only for goals that exist. A goal recreated afterwards gets
 * a new id, so nothing is ever resurrected into a total.
 *
 * ── One goal per name ──────────────────────────────────────────────────────
 * Refused case-insensitively. Two goals called "Hajj" are not ambiguous to the code — they have
 * different ids and their contributions never mix — but they are completely ambiguous on screen, and
 * "250 recorded toward 1,000" printed twice with no way to tell which is which is a worse answer
 * than a refusal at the point of typing.
 *
 * ── What this file will not do ─────────────────────────────────────────────
 * No interest. No projected completion date. No "on track" verdict. No automatic transfer, and no
 * reading of the ledger's net as though a surplus were money saved — a positive net is not proof
 * that anything was set aside. #95 rules all of that out by name, and Money AI's safety rules
 * already refuse the advice it would amount to.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const FINANCE_GOALS_SCHEMA_VERSION = 1;

/**
 * How many goals one account may hold. A bound the decoder enforces, not a suggestion.
 *
 * This times `MAX_MINOR_UNITS` is 10^14, inside the safe-integer range, so every target in a full
 * list still adds exactly. A test asserts that product rather than trusting the arithmetic here.
 */
export const MAX_FINANCE_GOALS = 100;

const MAX_GOAL_NAME_LENGTH = 60;

/** `finance.goal.` plus a v4-shaped UUID, so an id cannot be a sequence a caller invented. */
export const FINANCE_GOAL_ID_PATTERN = /^finance\.goal\.[0-9a-f-]{36}$/i;

/** Whether a value is a goal id this module will accept as an attribution target. */
export function isFinanceGoalId(value: unknown): value is string {
  return typeof value === 'string' && FINANCE_GOAL_ID_PATTERN.test(value);
}

export type FinanceGoal = {
  readonly id: string;
  /** The name as the user typed it. Display, and the uniqueness key when folded. */
  readonly name: string;
  /** Positive integer, in the ledger currency's minor unit. The whole of the user's intent. */
  readonly targetMinor: number;
  /** Optional local `YYYY-MM-DD`. A date the user is aiming at, never a prediction. */
  readonly targetOn: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type FinanceGoalsEnvelope = {
  readonly version: typeof FINANCE_GOALS_SCHEMA_VERSION;
  readonly goals: readonly FinanceGoal[];
};

export type FinanceGoalDraft = {
  readonly name: string;
  readonly targetMinor: number;
  readonly targetOn: string | null;
};

export type FinanceGoalFault =
  | 'no-currency'
  | 'invalid-amount'
  | 'invalid-name'
  | 'invalid-date'
  | 'duplicate-name'
  | 'not-found'
  | 'goals-full';

export type FinanceGoalValidation =
  | { readonly kind: 'valid'; readonly draft: FinanceGoalDraft }
  | { readonly kind: 'invalid'; readonly fault: FinanceGoalFault };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The folding used to decide whether two goal names are the same one.
 *
 * Deliberately **not** `financeCategoryKey`, despite folding identically today. That function is the
 * rule that decides which transactions a budget measures, so money is attributed by it; this one
 * decides only whether to refuse a second goal with the same name, and no amount of money is moved
 * or counted by its answer. Naming them apart is what keeps a later change to one from silently
 * becoming a change to the other's meaning.
 */
export function financeGoalNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function emptyFinanceGoals(): readonly FinanceGoal[] {
  return [];
}

/** Validates a draft without touching a clock or a store. */
export function validateFinanceGoalDraft(draft: FinanceGoalDraft): FinanceGoalValidation {
  if (!isStorableMinorAmount(draft.targetMinor)) {
    return { kind: 'invalid', fault: 'invalid-amount' };
  }
  const name = draft.name.trim();
  if (name.length === 0 || name.length > MAX_GOAL_NAME_LENGTH) {
    return { kind: 'invalid', fault: 'invalid-name' };
  }
  if (draft.targetOn !== null && !isLocalDate(draft.targetOn)) {
    /*
      A local date key or nothing. Never a `Date` parsed from the string — `new Date('2026-03-01')`
      is UTC midnight, which is the previous day for anyone west of Greenwich, and a target date that
      moved with the reader's timezone would be a different date to different people.
    */
    return { kind: 'invalid', fault: 'invalid-date' };
  }
  return {
    kind: 'valid',
    draft: { name, targetMinor: draft.targetMinor, targetOn: draft.targetOn },
  };
}

/** Whether a name is already taken, ignoring one id — the record being edited. */
export function findGoalByName(
  goals: readonly FinanceGoal[],
  name: string,
  exceptId: string | null = null,
): FinanceGoal | null {
  const key = financeGoalNameKey(name);
  return (
    goals.find((goal) => goal.id !== exceptId && financeGoalNameKey(goal.name) === key) ?? null
  );
}

/**
 * Builds a goal from a validated draft.
 *
 * `id` and `at` are supplied by the caller — the repository owns identity and the clock — so this
 * function is pure and a test can state both.
 */
export function createFinanceGoal(draft: FinanceGoalDraft, id: string, at: Date): FinanceGoal {
  if (!FINANCE_GOAL_ID_PATTERN.test(id)) {
    throw new Error('Finance goal ids must be generated UUID addresses.');
  }
  const timestamp = at.toISOString();
  return {
    id,
    name: draft.name,
    targetMinor: draft.targetMinor,
    targetOn: draft.targetOn,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

/** Applies a validated draft to an existing goal, keeping its identity and creation time. */
export function reviseFinanceGoal(
  existing: FinanceGoal,
  draft: FinanceGoalDraft,
  at: Date,
): FinanceGoal {
  return {
    ...existing,
    name: draft.name,
    targetMinor: draft.targetMinor,
    targetOn: draft.targetOn,
    updatedAt: at.toISOString(),
  };
}

export function isFinanceGoal(value: unknown): value is FinanceGoal {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    FINANCE_GOAL_ID_PATTERN.test(value.id) &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    value.name.length <= MAX_GOAL_NAME_LENGTH &&
    isStorableMinorAmount(value.targetMinor) &&
    /*
      No per-record currency — issue #96. The envelope owns it for every amount inside, and a record
      carrying its own code is a second answer to what the integer means. Quarantined, never coerced.
    */
    !('currency' in value) &&
    (value.targetOn === null || isLocalDate(value.targetOn)) &&
    typeof value.createdAt === 'string' &&
    typeof value.updatedAt === 'string'
  );
}

/**
 * The strict decoder.
 *
 * Returns `null` for anything it does not recognise — a different version, a missing field, a
 * duplicate id, a duplicate name key, a float target, a malformed target date, a derived field that
 * has no business being stored. The caller treats `null` as *quarantine*, never as *no goals*: an
 * empty list is something the app will happily write over, and these are the user's own decisions
 * about what they are saving for.
 */
export function parseFinanceGoalsEnvelope(value: unknown): FinanceGoalsEnvelope | null {
  if (
    !isRecord(value) ||
    value.version !== FINANCE_GOALS_SCHEMA_VERSION ||
    !Array.isArray(value.goals)
  ) {
    return null;
  }
  if (value.goals.length > MAX_FINANCE_GOALS || !value.goals.every(isFinanceGoal)) {
    return null;
  }
  const ids = new Set(value.goals.map((goal) => goal.id));
  if (ids.size !== value.goals.length) {
    return null;
  }
  /* One goal per name, at the boundary as well as at the mutation — see the header note. */
  const keys = new Set(value.goals.map((goal) => financeGoalNameKey(goal.name)));
  if (keys.size !== value.goals.length) {
    return null;
  }
  return { version: FINANCE_GOALS_SCHEMA_VERSION, goals: value.goals };
}

/** By name, so the list has one stable order rather than insertion order. */
export function sortFinanceGoals(goals: readonly FinanceGoal[]): readonly FinanceGoal[] {
  return [...goals].sort((left, right) => left.name.localeCompare(right.name));
}
