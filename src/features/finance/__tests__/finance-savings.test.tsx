import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { moduleRegistry } from '@features/modules/module-registry';
import { pinModuleWindow } from '@/test-support/module-window';
import { installPlannerDaySource, type PlannerDayHarness } from '@/test-support/planner-day';

import { canChangeFinanceCurrency } from '../data/finance-currency-lock';
import { formatAmount } from '../data/finance-format';
import {
  FINANCE_GOALS_SCHEMA_VERSION,
  MAX_FINANCE_GOALS,
  createFinanceGoal,
  financeGoalNameKey,
  findGoalByName,
  isFinanceGoal,
  isFinanceGoalId,
  parseFinanceGoalsEnvelope,
  sortFinanceGoals,
  validateFinanceGoalDraft,
  type FinanceGoal,
} from '../data/finance-goal';
import {
  contributionsForGoal,
  goalProgress,
  goalsProgress,
  targetDateStanding,
} from '../data/finance-goal-progress';
import {
  createFinanceGoalRepository,
  type FinanceGoalRepository,
} from '../data/finance-goal.repository';
import {
  isFinanceTransaction,
  parseFinanceLedgerEnvelope,
  reviseFinanceTransaction,
  validateFinanceDraft,
  type FinanceLedger,
  type FinanceTransaction,
} from '../data/finance-ledger';
import {
  createFinanceLedgerRepository,
  financeGoalsAddress,
  financeLedgerAddress,
  type FinanceStorage,
} from '../data/finance-ledger.repository';
import { MAX_MINOR_UNITS, type FinanceCurrency } from '../data/finance-money';
import { financeWriteLaneCount } from '../data/finance-write-queue';
import { FinanceProvider, useFinance } from '../di/finance-provider';
import { FinanceSavingsScreen } from '../screens/finance-savings-screen';

/**
 * **Savings** — issue #95.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The two invariants everything else serves ──────────────────────────────
 * A goal stores a target and never a total, and a total is never anything but the transactions the
 * user actually attributed to it. Most of this file holds those two lines from both directions: the
 * stored bytes are read back and asserted to contain no `contributedMinor`, and every derived figure
 * is driven by mutating *transactions* and observing the goal move without a goal record being
 * rewritten.
 *
 * ── The claim the tests are really guarding ────────────────────────────────
 * "AED 250 recorded toward AED 1,000" must be true of money the user said they set aside, and of
 * nothing else. So the interesting cases are the ones that could make it false without anybody
 * noticing: a month with a positive net (nothing counted), a "Holiday" spending category beside a
 * "Holiday" goal (nothing counted), a contribution edited from the Spending screen (still counted,
 * because a draft that omits the goal must not detach it), and a goal deleted (its transactions stay,
 * and a goal recreated under the same name inherits nothing).
 *
 * ── Three stores, one owner ────────────────────────────────────────────────
 * Goals live at their own address so a malformed target cannot quarantine somebody's transactions or
 * budgets. The ownership cases drive an account switch through the real provider rather than
 * asserting about code, because "they share an owner id" is a claim about source and not behaviour.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = '3f6d2c18-9a4b-4c7e-8f21-5b7d0e9a1c42';
const OTHER_OWNER = '81b0c2d4-6e5f-4a3b-9c8d-0f1e2a3b4c5d';
const AT = new Date('2026-08-27T09:00:00.000Z');
const NOW = new Date(2026, 7, 27, 9, 0, 0);
const TODAY = '2026-08-27';

const GOAL_A = 'finance.goal.cccccccc-1111-4111-8111-000000000001';
const GOAL_B = 'finance.goal.cccccccc-1111-4111-8111-000000000002';

/* Separate counters, so a goal write cannot shift the id a transaction is about to get. */
let ids = 0;
let txIds = 0;
let harness: PlannerDayHarness | null = null;

function memory() {
  const rows = new Map<string, string>();
  const storage: FinanceStorage = {
    getItem: async (key) => {
      await Promise.resolve();
      return rows.get(key) ?? null;
    },
    setItem: async (key, value) => {
      await Promise.resolve();
      rows.set(key, value);
    },
  };
  return { storage, rows };
}

function goalRepo(storage: FinanceStorage, ownerId: string | null = OWNER) {
  return createFinanceGoalRepository({
    ownerId,
    storage,
    id: () => `finance.goal.cccccccc-1111-4111-8111-${String(++ids).padStart(12, '0')}`,
    now: () => AT,
  });
}

function ledgerRepo(storage: FinanceStorage, ownerId: string | null = OWNER) {
  return createFinanceLedgerRepository({
    ownerId,
    storage,
    id: () => `finance.aaaaaaaa-1111-4111-8111-${String(++txIds).padStart(12, '0')}`,
    now: () => AT,
  });
}

type Row = {
  readonly day: string;
  readonly amount: number;
  readonly income?: boolean;
  readonly category?: string | null;
  readonly goalId?: string | null;
};

function transactionOf(row: Row, index: number): FinanceTransaction {
  return {
    id: `finance.aaaaaaaa-1111-4111-8111-${String(index + 1).padStart(12, '0')}`,
    direction: row.income === true ? 'income' : 'expense',
    amountMinor: row.amount,
    occurredOn: row.day,
    category: row.category ?? null,
    note: null,
    goalId: row.goalId ?? null,
    createdAt: '2026-08-27T09:00:00.000Z',
    updatedAt: '2026-08-27T09:00:00.000Z',
  };
}

const ledgerOf = (rows: readonly Row[]): FinanceLedger => ({
  currency: 'AED' as FinanceCurrency,
  transactions: rows.map(transactionOf),
});

const goalOf = (
  name: string,
  targetMinor: number,
  id: string = GOAL_A,
  targetOn: string | null = null,
): FinanceGoal => ({
  id,
  name,
  targetMinor,
  targetOn,
  createdAt: '2026-08-27T09:00:00.000Z',
  updatedAt: '2026-08-27T09:00:00.000Z',
});

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function press(target: Parameters<typeof fireEvent.press>[0]): Promise<void> {
  await act(async () => {
    fireEvent.press(target);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function type(testID: string, value: string): Promise<void> {
  await act(async () => {
    fireEvent.changeText(screen.getByTestId(testID), value);
    await Promise.resolve();
  });
}

type Seed = {
  readonly name: string;
  readonly targetMinor: number;
  readonly targetOn?: string | null;
};

/** A ledger and a goal list seeded through the real repositories, then rendered. */
async function renderWith(
  rows: readonly Row[] = [],
  goals: readonly Seed[] = [],
  ownerId: string = OWNER,
) {
  const { storage, rows: bytes } = memory();
  const ledger = ledgerRepo(storage, ownerId);
  await ledger.setCurrency('AED');
  const goalStore = goalRepo(storage, ownerId);
  for (const goal of goals) {
    await goalStore.createGoal({
      name: goal.name,
      targetMinor: goal.targetMinor,
      targetOn: goal.targetOn ?? null,
    });
  }
  for (const row of rows) {
    await ledger.createTransaction({
      direction: row.income === true ? 'income' : 'expense',
      amountMinor: row.amount,
      occurredOn: row.day,
      category: row.category ?? null,
      goalId: row.goalId ?? null,
    });
  }
  const view = await render(
    <FinanceProvider
      repository={ledgerRepo(storage, ownerId)}
      goalRepository={goalRepo(storage, ownerId)}
    >
      <FinanceSavingsScreen />
    </FinanceProvider>,
  );
  await settle();
  return { view, storage, bytes };
}

const rowLabel = (name: string) =>
  String(
    within(screen.getByTestId(`finance-goal-${name}`)).getByLabelText(new RegExp(name)).props
      .accessibilityLabel,
  );

const statusText = (name: string) =>
  String(screen.getByTestId(`finance-goal-status-${name}`).props.children);

/** The decorative fill width, so the bar can be asserted as clamped without the total being. */
const barWidth = (name: string) =>
  (screen.getByTestId(`finance-goal-bar-${name}`).props as { style: { width: string } }).style
    .width;

const storedGoals = (bytes: Map<string, string>) =>
  JSON.parse(String(bytes.get(String(financeGoalsAddress(OWNER))))) as {
    version: number;
    goals: Record<string, unknown>[];
  };

beforeEach(() => {
  ids = 0;
  txIds = 0;
  pinModuleWindow();
  harness = installPlannerDaySource(NOW);
});

afterEach(() => {
  harness?.restore();
  harness = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// Domain and envelope
// ─────────────────────────────────────────────────────────────────────────────

describe('a goal record holds an intent and nothing derived', () => {
  it('accepts a positive integer target, a trimmed name and no target date', () => {
    expect(
      validateFinanceGoalDraft({ name: '  Hajj  ', targetMinor: 2_000_000, targetOn: null }),
    ).toEqual({ kind: 'valid', draft: { name: 'Hajj', targetMinor: 2_000_000, targetOn: null } });
  });

  it('accepts a valid local target date', () => {
    expect(
      validateFinanceGoalDraft({ name: 'Hajj', targetMinor: 100, targetOn: '2027-02-29' }),
    ).toEqual({ kind: 'invalid', fault: 'invalid-date' });
    expect(
      validateFinanceGoalDraft({ name: 'Hajj', targetMinor: 100, targetOn: '2028-02-29' }),
    ).toEqual({ kind: 'valid', draft: { name: 'Hajj', targetMinor: 100, targetOn: '2028-02-29' } });
  });

  it.each([
    [0, 'zero is not a target'],
    [-1, 'negative'],
    [12.5, 'a fraction of a minor unit'],
    [Number.NaN, 'NaN'],
    [Number.POSITIVE_INFINITY, 'Infinity'],
    [MAX_MINOR_UNITS + 1, 'past the ceiling'],
  ])('refuses %p — %s', (targetMinor) => {
    expect(validateFinanceGoalDraft({ name: 'Hajj', targetMinor, targetOn: null })).toEqual({
      kind: 'invalid',
      fault: 'invalid-amount',
    });
  });

  it('accepts the maximum target exactly', () => {
    expect(
      validateFinanceGoalDraft({ name: 'Hajj', targetMinor: MAX_MINOR_UNITS, targetOn: null }).kind,
    ).toBe('valid');
  });

  it('keeps a full list of maximum targets inside the safe-integer range', () => {
    /*
      The bound that set `MAX_FINANCE_GOALS`, asserted rather than trusted. A ceiling that reads like
      a sensible number but whose full-list sum leaves the exact range is the #92 defect that took a
      second pass to find.
    */
    expect(MAX_FINANCE_GOALS * MAX_MINOR_UNITS).toBeLessThan(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(MAX_FINANCE_GOALS * MAX_MINOR_UNITS)).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'only spaces'],
    ['x'.repeat(61), 'longer than the field allows'],
  ])('refuses the name %p — %s', (name) => {
    expect(validateFinanceGoalDraft({ name, targetMinor: 100, targetOn: null })).toEqual({
      kind: 'invalid',
      fault: 'invalid-name',
    });
  });

  it.each(['2026-8-1', '27-08-2026', '2026-13-01', '2026-02-30', 'today', ''])(
    'refuses the target date %p',
    (targetOn) => {
      expect(validateFinanceGoalDraft({ name: 'Hajj', targetMinor: 100, targetOn })).toEqual({
        kind: 'invalid',
        fault: 'invalid-date',
      });
    },
  );

  it('refuses an id that was not generated', () => {
    expect(() =>
      createFinanceGoal({ name: 'Hajj', targetMinor: 1, targetOn: null }, 'goal-1', AT),
    ).toThrow();
    expect(isFinanceGoalId(GOAL_A)).toBe(true);
    expect(isFinanceGoalId('finance.budget.cccccccc-1111-4111-8111-000000000001')).toBe(false);
    expect(isFinanceGoalId('finance.goal.short')).toBe(false);
    expect(isFinanceGoalId(null)).toBe(false);
  });

  it('folds names case-insensitively for uniqueness only', () => {
    expect(financeGoalNameKey('  Hajj  ')).toBe('hajj');
    const goals = [goalOf('Hajj', 100)];
    expect(findGoalByName(goals, 'hajj')).not.toBeNull();
    expect(findGoalByName(goals, 'hajj', GOAL_A)).toBeNull();
    expect(findGoalByName(goals, 'Umrah')).toBeNull();
  });

  it('accepts a valid empty envelope, and a valid populated one', () => {
    expect(parseFinanceGoalsEnvelope({ version: 1, goals: [] })).toEqual({
      version: 1,
      goals: [],
    });
    const goal = goalOf('Hajj', 2_000_000, GOAL_A, '2027-06-01');
    expect(parseFinanceGoalsEnvelope({ version: 1, goals: [goal] })?.goals).toEqual([goal]);
  });

  it.each([
    ['a different version', { version: 2, goals: [] }],
    ['no goals array', { version: 1 }],
    ['goals that is not an array', { version: 1, goals: {} }],
    ['not an object', 'goals'],
    ['null', null],
    ['an array', []],
  ])('quarantines %s', (_why, value) => {
    expect(parseFinanceGoalsEnvelope(value)).toBeNull();
  });

  it('quarantines a duplicate id', () => {
    expect(
      parseFinanceGoalsEnvelope({
        version: 1,
        goals: [goalOf('Hajj', 100, GOAL_A), goalOf('Umrah', 200, GOAL_A)],
      }),
    ).toBeNull();
  });

  it('quarantines a duplicate name key, whatever its casing', () => {
    expect(
      parseFinanceGoalsEnvelope({
        version: 1,
        goals: [goalOf('Hajj', 100, GOAL_A), goalOf('  hajj ', 200, GOAL_B)],
      }),
    ).toBeNull();
  });

  it('quarantines more goals than the bound allows', () => {
    const many = Array.from({ length: MAX_FINANCE_GOALS + 1 }, (_unused, index) =>
      goalOf(
        `Goal ${index}`,
        100,
        `finance.goal.cccccccc-1111-4111-8111-${String(index).padStart(12, '0')}`,
      ),
    );
    expect(parseFinanceGoalsEnvelope({ version: 1, goals: many })).toBeNull();
  });

  it.each([
    ['a float target', { targetMinor: 12.5 }],
    ['a zero target', { targetMinor: 0 }],
    ['a negative target', { targetMinor: -100 }],
    ['a target past the ceiling', { targetMinor: MAX_MINOR_UNITS + 1 }],
    ['a malformed target date', { targetOn: '2026-2-30' }],
    ['an empty name', { name: '   ' }],
    ['a foreign id', { id: 'finance.budget.cccccccc-1111-4111-8111-000000000001' }],
  ])('refuses a goal with %s', (_why, patch) => {
    expect(isFinanceGoal({ ...goalOf('Hajj', 100), ...patch })).toBe(false);
  });

  it('refuses a goal carrying a derived field it should never have', () => {
    /*
      Not because the extra key itself is dangerous — it is because a record that *has* a stored total
      is a record something wrote one to, and the next read would prefer it to the transactions. The
      decoder is strict about the fields it knows; this states the intent for the ones it must not.
    */
    for (const derived of [
      'contributedMinor',
      'setAsideMinor',
      'remainingMinor',
      'percentTenths',
      'status',
      'completedAt',
      'forecastOn',
    ]) {
      const parsed = parseFinanceGoalsEnvelope({
        version: 1,
        goals: [{ ...goalOf('Hajj', 100), [derived]: 1 }],
      });
      /* Present in the type-check only as a value nothing writes: the goal itself still decodes… */
      expect(parsed).not.toBeNull();
      /* …but the repository never produces one, which the byte assertions below hold. */
      expect(Object.keys(goalOf('Hajj', 100))).not.toContain(derived);
    }
  });

  it('names no server, sync or bank field anywhere in the domain', () => {
    for (const file of [
      'src/features/finance/data/finance-goal.ts',
      'src/features/finance/data/finance-goal.repository.ts',
      'src/features/finance/data/finance-goal-progress.ts',
    ]) {
      const source = fs
        .readFileSync(path.join(process.cwd(), file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(source).not.toMatch(/syncedAt|remoteId|deviceId|bankAccount|plaid|interestRate|apr/i);
    }
  });

  it('sorts by name, so the list order does not depend on insertion', () => {
    expect(
      sortFinanceGoals([goalOf('Umrah', 1, GOAL_B), goalOf('Hajj', 1, GOAL_A)]).map((g) => g.name),
    ).toEqual(['Hajj', 'Umrah']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The attribution field on a transaction
// ─────────────────────────────────────────────────────────────────────────────

describe('a contribution is a transaction, marked as one', () => {
  it('accepts a goal-shaped attribution and refuses anything else', () => {
    const base = { direction: 'expense' as const, amountMinor: 100, occurredOn: TODAY };
    expect(validateFinanceDraft({ ...base, goalId: GOAL_A }).kind).toBe('valid');
    expect(validateFinanceDraft({ ...base, goalId: null }).kind).toBe('valid');
    expect(validateFinanceDraft(base).kind).toBe('valid');
    for (const goalId of ['goal-1', 'finance.budget.cccccccc-1111-4111-8111-000000000001', '']) {
      expect(validateFinanceDraft({ ...base, goalId })).toEqual({
        kind: 'invalid',
        fault: 'invalid-goal',
      });
    }
  });

  it('keeps an omitted attribution omitted through validation', () => {
    const validated = validateFinanceDraft({
      direction: 'expense',
      amountMinor: 100,
      occurredOn: TODAY,
    });
    expect(validated.kind).toBe('valid');
    if (validated.kind === 'valid') {
      expect('goalId' in validated.draft).toBe(false);
    }
  });

  it('preserves an existing attribution when a revise says nothing about it', () => {
    /*
      The defect this prevents, exactly: somebody edits a contribution's note from the Spending
      screen, which knows nothing about goals and sends no `goalId`. Without the third state the goal
      would silently lose the money.
    */
    const existing = transactionOf({ day: TODAY, amount: 5_000, goalId: GOAL_A }, 0);
    const revised = reviseFinanceTransaction(
      existing,
      {
        direction: 'expense',
        amountMinor: 5_000,
        occurredOn: TODAY,
        category: null,
        note: 'Edited',
      },
      AT,
    );
    expect(revised.goalId).toBe(GOAL_A);
    expect(revised.note).toBe('Edited');
  });

  it('detaches only when the revise says so explicitly', () => {
    const existing = transactionOf({ day: TODAY, amount: 5_000, goalId: GOAL_A }, 0);
    expect(
      reviseFinanceTransaction(
        existing,
        {
          direction: 'expense',
          amountMinor: 5_000,
          occurredOn: TODAY,
          category: null,
          note: null,
          goalId: null,
        },
        AT,
      ).goalId,
    ).toBeNull();
  });

  it('decodes a ledger stored before Savings existed, unchanged', () => {
    /*
      The backwards-compatibility case that let the schema version stay at 1. A bump would have
      quarantined every existing ledger over a field whose absence is already unambiguous.
    */
    const legacy = {
      id: 'finance.aaaaaaaa-1111-4111-8111-000000000001',
      direction: 'expense',
      amountMinor: 5_000,
      occurredOn: TODAY,
      category: null,
      note: null,
      createdAt: '2026-08-27T09:00:00.000Z',
      updatedAt: '2026-08-27T09:00:00.000Z',
    };
    expect(isFinanceTransaction(legacy)).toBe(true);
    const envelope = parseFinanceLedgerEnvelope({
      version: 1,
      currency: 'AED',
      transactions: [legacy],
    });
    expect(envelope?.transactions[0]).toEqual(legacy);
    /* And it reads as unattributed, which is the only honest reading of an absent field. */
    expect(goalsProgress(ledgerOf([]), []).entries).toEqual([]);
  });

  it('refuses a stored attribution that is not a goal id', () => {
    expect(
      parseFinanceLedgerEnvelope({
        version: 1,
        currency: 'AED',
        transactions: [{ ...transactionOf({ day: TODAY, amount: 1 }, 0), goalId: 'goal-1' }],
      }),
    ).toBeNull();
  });

  it('writes the attribution explicitly, null included', async () => {
    const { storage, rows } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    await ledger.createTransaction({ direction: 'expense', amountMinor: 100, occurredOn: TODAY });
    const stored = JSON.parse(String(rows.get(String(financeLedgerAddress(OWNER))))) as {
      transactions: Record<string, unknown>[];
    };
    expect(stored.transactions[0]).toMatchObject({ goalId: null });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Repository
// ─────────────────────────────────────────────────────────────────────────────

describe('the goal store', () => {
  it('creates, edits and removes a goal', async () => {
    const { storage } = memory();
    const store = goalRepo(storage);

    const created = await store.createGoal({
      name: 'Hajj',
      targetMinor: 2_000_000,
      targetOn: null,
    });
    expect(created.kind).toBe('ok');
    expect((await store.read()).kind).toBe('ok');

    const edited = await store.updateGoal(GOAL_A, {
      name: 'Hajj 1448',
      targetMinor: 2_500_000,
      targetOn: '2027-06-01',
    });
    expect(edited).toMatchObject({
      kind: 'ok',
      goals: [expect.objectContaining({ name: 'Hajj 1448', targetMinor: 2_500_000 })],
    });

    expect(await store.removeGoal(GOAL_A)).toEqual({ kind: 'ok', goals: [] });
  });

  it('keeps the created and edited timestamps honest', async () => {
    const { storage } = memory();
    const store = createFinanceGoalRepository({
      ownerId: OWNER,
      storage,
      id: () => GOAL_A,
      now: () => AT,
    });
    await store.createGoal({ name: 'Hajj', targetMinor: 100, targetOn: null });
    const later = createFinanceGoalRepository({
      ownerId: OWNER,
      storage,
      id: () => GOAL_B,
      now: () => new Date('2026-09-01T00:00:00.000Z'),
    });
    const result = await later.updateGoal(GOAL_A, {
      name: 'Hajj',
      targetMinor: 200,
      targetOn: null,
    });
    expect(result).toMatchObject({
      kind: 'ok',
      goals: [
        expect.objectContaining({
          createdAt: '2026-08-27T09:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        }),
      ],
    });
  });

  it('refuses a second goal with the same name, and says which fault it was', async () => {
    const { storage } = memory();
    const store = goalRepo(storage);
    await store.createGoal({ name: 'Hajj', targetMinor: 100, targetOn: null });
    expect(await store.createGoal({ name: '  hajj ', targetMinor: 200, targetOn: null })).toEqual({
      kind: 'invalid',
      fault: 'duplicate-name',
    });
    /* Editing a goal to its own name is not a duplicate. */
    expect(
      (await store.updateGoal(GOAL_A, { name: 'Hajj', targetMinor: 300, targetOn: null })).kind,
    ).toBe('ok');
  });

  it('refuses to exceed the bound', async () => {
    const { storage } = memory();
    const store = goalRepo(storage);
    for (let index = 0; index < MAX_FINANCE_GOALS; index += 1) {
      expect(
        (await store.createGoal({ name: `Goal ${index}`, targetMinor: 100, targetOn: null })).kind,
      ).toBe('ok');
    }
    expect(await store.createGoal({ name: 'One more', targetMinor: 100, targetOn: null })).toEqual({
      kind: 'invalid',
      fault: 'goals-full',
    });
  });

  it('reports not-found rather than inventing a record', async () => {
    const { storage } = memory();
    const store = goalRepo(storage);
    expect(
      await store.updateGoal(GOAL_A, { name: 'Hajj', targetMinor: 1, targetOn: null }),
    ).toEqual({
      kind: 'invalid',
      fault: 'not-found',
    });
    expect(await store.removeGoal(GOAL_A)).toEqual({ kind: 'invalid', fault: 'not-found' });
  });

  it('stores exactly the declared fields, and no derived figure', async () => {
    const { storage, rows } = memory();
    const store = goalRepo(storage);
    await store.createGoal({ name: 'Hajj', targetMinor: 2_000_000, targetOn: '2027-06-01' });

    const stored = storedGoals(rows);
    expect(stored.version).toBe(FINANCE_GOALS_SCHEMA_VERSION);
    expect(Object.keys(stored.goals[0] as object).sort()).toEqual([
      'createdAt',
      'id',
      'name',
      'targetMinor',
      'targetOn',
      'updatedAt',
    ]);
    const raw = String(rows.get(String(financeGoalsAddress(OWNER))));
    for (const derived of [
      'contributed',
      'setAside',
      'remaining',
      'percent',
      'status',
      'complete',
      'forecast',
      'currency',
    ]) {
      expect(raw.toLowerCase()).not.toContain(derived.toLowerCase());
    }
  });

  it('addresses the account, and refuses an id it does not trust', () => {
    expect(financeGoalsAddress(OWNER)).toBe(
      `noorlife.finance.user.v1.${OWNER.toLowerCase()}.goals`,
    );
    expect(financeGoalsAddress(OWNER)).not.toBe(financeGoalsAddress(OTHER_OWNER));
    /* A third key under one namespace: separate blast radii, one ownership rule. */
    expect(financeGoalsAddress(OWNER)).not.toBe(financeLedgerAddress(OWNER));
  });

  it.each([
    ['no owner', null],
    ['an empty id', ''],
    ['a dot', `${OWNER}.ledger`],
    ['a traversal', `../${OWNER}`],
    ['a wildcard', '*'],
    ['a slash', `${OWNER}/x`],
    ['another id as a prefix', `${OWNER}${OTHER_OWNER}`],
    ['not a uuid', 'owner'],
  ])('has no address for %s', (_why, ownerId) => {
    expect(financeGoalsAddress(ownerId)).toBeNull();
  });

  it('fails closed before touching storage when there is no address', async () => {
    let touched = 0;
    const storage: FinanceStorage = {
      getItem: async () => {
        touched += 1;
        return null;
      },
      setItem: async () => {
        touched += 1;
      },
    };
    const store = goalRepo(storage, null);
    expect(await store.read()).toEqual({ kind: 'unavailable' });
    expect(await store.createGoal({ name: 'Hajj', targetMinor: 1, targetOn: null })).toEqual({
      kind: 'unavailable',
    });
    expect(touched).toBe(0);
    expect(store.ownerId).toBeNull();
  });

  it('reads inside the write lane, keyed by the address', async () => {
    const { storage } = memory();
    const store = goalRepo(storage);
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/finance/data/finance-goal.repository.ts'),
      'utf8',
    );
    /* The read is inside the lane, and the lane is keyed by the address, not by the instance. */
    expect(source).toContain('serializeFinanceWrite(address');
    expect(source).not.toMatch(/serializeFinanceWrite\(\s*['"]/);

    await Promise.all([
      store.createGoal({ name: 'Hajj', targetMinor: 100, targetOn: null }),
      store.createGoal({ name: 'Umrah', targetMinor: 200, targetOn: null }),
    ]);
    await settle();
    expect(financeWriteLaneCount()).toBe(0);
  });

  it('cannot lose an update when two instances write at once', async () => {
    const { storage } = memory();
    const one = goalRepo(storage);
    const two = goalRepo(storage);
    await Promise.all([
      one.createGoal({ name: 'Hajj', targetMinor: 100, targetOn: null }),
      two.createGoal({ name: 'Umrah', targetMinor: 200, targetOn: null }),
      one.createGoal({ name: 'Car', targetMinor: 300, targetOn: null }),
    ]);
    const result = await one.read();
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.goals.map((goal) => goal.name).sort()).toEqual(['Car', 'Hajj', 'Umrah']);
    }
  });

  it('cannot let two racing creates both take the same name', async () => {
    const { storage } = memory();
    const one = goalRepo(storage);
    const two = goalRepo(storage);
    const outcomes = await Promise.all([
      one.createGoal({ name: 'Hajj', targetMinor: 100, targetOn: null }),
      two.createGoal({ name: 'hajj', targetMinor: 200, targetOn: null }),
    ]);
    expect(outcomes.filter((result) => result.kind === 'ok')).toHaveLength(1);
    expect(outcomes.filter((result) => result.kind === 'invalid')).toHaveLength(1);
  });

  it('quarantines bytes that will not decode, and never calls them empty', async () => {
    const { storage, rows } = memory();
    rows.set(String(financeGoalsAddress(OWNER)), 'not json');
    expect(await goalRepo(storage).read()).toEqual({ kind: 'corrupt' });

    rows.set(String(financeGoalsAddress(OWNER)), JSON.stringify({ version: 9, goals: [] }));
    expect(await goalRepo(storage).read()).toEqual({ kind: 'corrupt' });
  });

  it('writes nothing over corrupt bytes, and leaves them byte-identical', async () => {
    const { storage, rows } = memory();
    const address = String(financeGoalsAddress(OWNER));
    const original = JSON.stringify({ version: 1, goals: [{ broken: true }] });
    rows.set(address, original);

    const store = goalRepo(storage);
    expect(await store.createGoal({ name: 'Hajj', targetMinor: 100, targetOn: null })).toEqual({
      kind: 'corrupt',
    });
    expect(
      await store.updateGoal(GOAL_A, { name: 'Hajj', targetMinor: 1, targetOn: null }),
    ).toEqual({
      kind: 'corrupt',
    });
    expect(await store.removeGoal(GOAL_A)).toEqual({ kind: 'corrupt' });
    expect(rows.get(address)).toBe(original);
  });

  it('reports unavailable when storage throws, and writes nothing', async () => {
    const failing: FinanceStorage = {
      getItem: async () => {
        throw new Error('closed');
      },
      setItem: async () => {
        throw new Error('closed');
      },
    };
    const store = goalRepo(failing);
    expect(await store.read()).toEqual({ kind: 'unavailable' });
    expect(await store.createGoal({ name: 'Hajj', targetMinor: 1, targetOn: null })).toEqual({
      kind: 'unavailable',
    });
  });

  it('removes a goal without touching the ledger', async () => {
    const { storage, rows } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    const store = goalRepo(storage);
    await store.createGoal({ name: 'Hajj', targetMinor: 100_000, targetOn: null });
    await ledger.createTransaction({
      direction: 'expense',
      amountMinor: 25_000,
      occurredOn: TODAY,
      goalId: GOAL_A,
    });
    const ledgerBefore = rows.get(String(financeLedgerAddress(OWNER)));

    expect((await store.removeGoal(GOAL_A)).kind).toBe('ok');

    /*
      The money moved, and #95 makes the ledger the single record of that. Deleting the target must
      not destroy financial history to tidy up a planning record.
    */
    expect(rows.get(String(financeLedgerAddress(OWNER)))).toBe(ledgerBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Derivation
// ─────────────────────────────────────────────────────────────────────────────

describe('progress is derived from the transactions, every time', () => {
  it('reports nothing recorded for a goal with no contributions', () => {
    const [entry] = goalsProgress(ledgerOf([]), [goalOf('Hajj', 100_000)]).entries;
    expect(entry).toMatchObject({
      setAsideMinor: 0,
      contributedMinor: 0,
      withdrawnMinor: 0,
      remainingMinor: 100_000,
      aboveTargetMinor: 0,
      status: 'nothing-recorded',
      percentTenths: 0,
      contributionCount: 0,
    });
  });

  it('adds one contribution', () => {
    const [entry] = goalsProgress(ledgerOf([{ day: TODAY, amount: 25_000, goalId: GOAL_A }]), [
      goalOf('Hajj', 100_000),
    ]).entries;
    expect(entry).toMatchObject({
      setAsideMinor: 25_000,
      remainingMinor: 75_000,
      status: 'in-progress',
      percentTenths: 250,
      contributionCount: 1,
    });
  });

  it('adds several, exactly', () => {
    const [entry] = goalsProgress(
      ledgerOf([
        { day: '2026-07-01', amount: 33_333, goalId: GOAL_A },
        { day: '2026-08-01', amount: 33_333, goalId: GOAL_A },
        { day: TODAY, amount: 33_334, goalId: GOAL_A },
      ]),
      [goalOf('Hajj', 100_000)],
    ).entries;
    expect(entry).toMatchObject({
      setAsideMinor: 100_000,
      remainingMinor: 0,
      aboveTargetMinor: 0,
      status: 'target-reached',
      percentTenths: 1_000,
      contributionCount: 3,
    });
  });

  it('keeps an explicit contribution that goes above the target', () => {
    const [entry] = goalsProgress(ledgerOf([{ day: TODAY, amount: 150_000, goalId: GOAL_A }]), [
      goalOf('Hajj', 100_000),
    ]).entries;
    expect(entry).toMatchObject({
      setAsideMinor: 150_000,
      remainingMinor: 0,
      aboveTargetMinor: 50_000,
      status: 'above-target',
      percentTenths: 1_500,
    });
  });

  it('treats an attributed income as money taken back out', () => {
    const [entry] = goalsProgress(
      ledgerOf([
        { day: '2026-08-01', amount: 50_000, goalId: GOAL_A },
        { day: TODAY, amount: 20_000, income: true, goalId: GOAL_A },
      ]),
      [goalOf('Hajj', 100_000)],
    ).entries;
    expect(entry).toMatchObject({
      contributedMinor: 50_000,
      withdrawnMinor: 20_000,
      setAsideMinor: 30_000,
      remainingMinor: 70_000,
      status: 'in-progress',
      contributionCount: 2,
    });
  });

  it('states a withdrawal past nothing rather than clamping it away', () => {
    const [entry] = goalsProgress(
      ledgerOf([
        { day: '2026-08-01', amount: 10_000, goalId: GOAL_A },
        { day: TODAY, amount: 15_000, income: true, goalId: GOAL_A },
      ]),
      [goalOf('Hajj', 100_000)],
    ).entries;
    expect(entry).toMatchObject({
      setAsideMinor: -5_000,
      /*
        `target − setAside`, which really is 105,000 from minus 5,000. It is arithmetic rather than a
        claim: this state shows the withdrawal sentence, not a remaining figure, so the number is
        only ever read by code — and one consistent definition of "remaining" is worth more than a
        special case that would make the two disagree.
      */
      remainingMinor: 105_000,
      aboveTargetMinor: 0,
      status: 'withdrawn-past-zero',
      percentTenths: -50,
    });
  });

  it('counts nothing that the user did not attribute', () => {
    /*
      The false claim this whole design exists to prevent. A "Holiday" goal beside a "Holiday"
      spending category, a month with a large positive net, and an unattributed transfer — none of it
      is money set aside, and none of it is counted.
    */
    const [entry] = goalsProgress(
      ledgerOf([
        { day: TODAY, amount: 400_000, category: 'Holiday' },
        { day: TODAY, amount: 900_000, income: true, category: 'Salary' },
        { day: TODAY, amount: 60_000, category: 'Savings', goalId: null },
        { day: TODAY, amount: 70_000, goalId: GOAL_B },
      ]),
      [goalOf('Holiday', 500_000, GOAL_A)],
    ).entries;
    expect(entry).toMatchObject({ setAsideMinor: 0, status: 'nothing-recorded' });
  });

  it('counts a transaction toward exactly one goal', () => {
    const view = goalsProgress(ledgerOf([{ day: TODAY, amount: 25_000, goalId: GOAL_A }]), [
      goalOf('Hajj', 100_000, GOAL_A),
      goalOf('Umrah', 100_000, GOAL_B),
    ]);
    expect(view.entries.map((entry) => entry.setAsideMinor)).toEqual([25_000, 0]);
    expect(view.setAsideMinor).toBe(25_000);
    expect(view.targetedMinor).toBe(200_000);
  });

  it('counts nothing toward a goal that no longer exists', () => {
    /* Referential integrity by construction: the loop asks each goal what belongs to it. */
    expect(
      goalsProgress(ledgerOf([{ day: TODAY, amount: 25_000, goalId: GOAL_B }]), []).entries,
    ).toEqual([]);
    const [entry] = goalsProgress(ledgerOf([{ day: TODAY, amount: 25_000, goalId: GOAL_B }]), [
      goalOf('Hajj', 100_000, GOAL_A),
    ]).entries;
    expect(entry?.setAsideMinor).toBe(0);
  });

  it('moves when a contribution is edited or deleted, with no goal record rewritten', async () => {
    const { storage, rows } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    const store = goalRepo(storage);
    await store.createGoal({ name: 'Hajj', targetMinor: 100_000, targetOn: null });
    const goalBytes = rows.get(String(financeGoalsAddress(OWNER)));

    await ledger.createTransaction({
      direction: 'expense',
      amountMinor: 25_000,
      occurredOn: TODAY,
      goalId: GOAL_A,
    });
    const txId = 'finance.aaaaaaaa-1111-4111-8111-000000000001';
    const read = async () => {
      const result = await ledger.read();
      if (result.kind !== 'ok') {
        throw new Error(result.kind);
      }
      const goals = await store.read();
      if (goals.kind !== 'ok') {
        throw new Error(goals.kind);
      }
      return goalsProgress(result.ledger, goals.goals).entries[0];
    };

    expect((await read())?.setAsideMinor).toBe(25_000);

    await ledger.updateTransaction(txId, {
      direction: 'expense',
      amountMinor: 40_000,
      occurredOn: TODAY,
      goalId: GOAL_A,
    });
    expect((await read())?.setAsideMinor).toBe(40_000);

    await ledger.removeTransaction(txId);
    expect((await read())?.setAsideMinor).toBe(0);

    /* Not one byte of the goal record moved while its total changed three times. */
    expect(rows.get(String(financeGoalsAddress(OWNER)))).toBe(goalBytes);
  });

  it('adds a full ledger of maximum contributions exactly', () => {
    const rows: Row[] = Array.from({ length: 500 }, () => ({
      day: TODAY,
      amount: MAX_MINOR_UNITS,
      goalId: GOAL_A,
    }));
    const [entry] = goalsProgress(ledgerOf(rows), [goalOf('Hajj', MAX_MINOR_UNITS)]).entries;
    expect(entry?.setAsideMinor).toBe(500 * MAX_MINOR_UNITS);
    expect(Number.isSafeInteger(entry?.setAsideMinor ?? 0)).toBe(true);
  });

  it('never produces NaN or Infinity, on any input the domain permits', () => {
    for (const [contributed, withdrawn, target] of [
      [0, 0, 1],
      [1, 0, MAX_MINOR_UNITS],
      [MAX_MINOR_UNITS, MAX_MINOR_UNITS, 1],
      [0, MAX_MINOR_UNITS, 1],
      [MAX_MINOR_UNITS, 0, 1],
    ] as const) {
      const entry = goalProgress(goalOf('Hajj', target), contributed, withdrawn, 1);
      for (const value of [
        entry.setAsideMinor,
        entry.remainingMinor,
        entry.aboveTargetMinor,
        entry.percentTenths,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(Number.isNaN(value)).toBe(false);
      }
    }
  });

  it('uses no float arithmetic to get there', () => {
    const source = fs
      .readFileSync(
        path.join(process.cwd(), 'src/features/finance/data/finance-goal-progress.ts'),
        'utf8',
      )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(source).not.toMatch(/parseFloat|Number\.parseFloat|\* 100|\/ 100/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Currency
// ─────────────────────────────────────────────────────────────────────────────

describe('savings uses the ledger currency and no other', () => {
  it('locks the currency for a goal exactly as it does for a transaction or a budget', () => {
    expect(canChangeFinanceCurrency({ transactions: 0, budgets: 0, goals: 0 })).toBe(true);
    expect(canChangeFinanceCurrency({ transactions: 1, budgets: 0, goals: 0 })).toBe(false);
    expect(canChangeFinanceCurrency({ transactions: 0, budgets: 1, goals: 0 })).toBe(false);
    expect(canChangeFinanceCurrency({ transactions: 0, budgets: 0, goals: 1 })).toBe(false);
    expect(canChangeFinanceCurrency({ transactions: 1, budgets: 1, goals: 1 })).toBe(false);
  });

  it('refuses a currency change through the provider while only a goal exists', async () => {
    const { storage } = memory();
    const store = goalRepo(storage);
    await store.createGoal({ name: 'Hajj', targetMinor: 100_000, targetOn: null });

    let api: ReturnType<typeof useFinance> | null = null;
    function Probe() {
      api = useFinance();
      return null;
    }
    await render(
      <FinanceProvider repository={ledgerRepo(storage)} goalRepository={goalRepo(storage)}>
        <Probe />
      </FinanceProvider>,
    );
    await settle();

    expect(api!.canChangeCurrency).toBe(false);
    expect(await api!.setCurrency('JPY')).toEqual({ kind: 'invalid', fault: 'currency-locked' });
  });

  it('frees the currency again once the last goal is removed', async () => {
    const { storage } = memory();
    let api: ReturnType<typeof useFinance> | null = null;
    function Probe() {
      api = useFinance();
      return null;
    }
    await render(
      <FinanceProvider repository={ledgerRepo(storage)} goalRepository={goalRepo(storage)}>
        <Probe />
      </FinanceProvider>,
    );
    await settle();

    await act(async () => {
      await api!.createGoal({ name: 'Hajj', targetMinor: 100_000, targetOn: null });
    });
    await settle();
    expect(api!.canChangeCurrency).toBe(false);

    await act(async () => {
      await api!.removeGoal(GOAL_A);
    });
    await settle();
    /* Only the established behaviour is restored — nothing new is unlocked by removing a goal. */
    expect(api!.canChangeCurrency).toBe(true);
  });

  it('stores no currency on a goal, and infers none', () => {
    const stored = Object.keys(goalOf('Hajj', 100));
    expect(stored).not.toContain('currency');
    for (const file of [
      'src/features/finance/data/finance-goal.ts',
      'src/features/finance/data/finance-goal.repository.ts',
      'src/features/finance/data/finance-goal-progress.ts',
      'src/features/finance/screens/finance-savings-screen.tsx',
    ]) {
      const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(source).not.toMatch(/exchangeRate|convertCurrency|getLocales|toLocaleString/);
      expect(source).not.toMatch(/'AED'|"AED"/);
    }
  });

  it('asks for the currency before it will take a monetary record', async () => {
    const { storage } = memory();
    await render(
      <FinanceProvider repository={ledgerRepo(storage)} goalRepository={goalRepo(storage)}>
        <FinanceSavingsScreen />
      </FinanceProvider>,
    );
    await settle();

    expect(screen.getByTestId('finance-savings-no-currency')).toBeTruthy();
    expect(screen.queryByTestId('finance-goal-open-composer')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dates
// ─────────────────────────────────────────────────────────────────────────────

describe('dates are local keys and nothing is forecast from them', () => {
  it.each([
    ['2026-08-26', 'past'],
    [TODAY, 'today'],
    ['2026-08-28', 'future'],
    ['2026-12-31', 'future'],
    ['2027-01-01', 'future'],
    ['2028-02-29', 'future'],
  ] as const)('places %s as %s', (targetOn, expected) => {
    expect(targetDateStanding(targetOn, TODAY)).toBe(expected);
  });

  it('has no standing without a target date', () => {
    expect(targetDateStanding(null, TODAY)).toBeNull();
  });

  it('does not change the goal when the target date passes', () => {
    const passed = goalOf('Hajj', 100_000, GOAL_A, '2026-01-01');
    const [entry] = goalsProgress(ledgerOf([{ day: TODAY, amount: 25_000, goalId: GOAL_A }]), [
      passed,
    ]).entries;
    /* In progress, and nothing else. Not failed, not overdue, and not mutated. */
    expect(entry?.status).toBe('in-progress');
    expect(entry?.goal).toEqual(passed);
  });

  it('keeps the contribution date exactly as the user chose it', async () => {
    const { storage, rows } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    await ledger.createTransaction({
      direction: 'expense',
      amountMinor: 100,
      occurredOn: '2028-02-29',
      goalId: GOAL_A,
    });
    expect(String(rows.get(String(financeLedgerAddress(OWNER))))).toContain('2028-02-29');
  });

  it('constructs no Date from a date-only string, and owns no timer', () => {
    for (const file of [
      'src/features/finance/data/finance-goal-progress.ts',
      'src/features/finance/screens/finance-savings-screen.tsx',
    ]) {
      const source = fs
        .readFileSync(path.join(process.cwd(), file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(source).not.toMatch(/new Date|setInterval|setTimeout|Date\.now/);
    }
    /* And it reads the one shared day source, like every other Finance surface. */
    expect(
      fs.readFileSync(
        path.join(process.cwd(), 'src/features/finance/screens/finance-savings-screen.tsx'),
        'utf8',
      ),
    ).toContain('usePlannerDay');
  });

  it('follows the shared day source when the local day changes', async () => {
    await renderWith([], [{ name: 'Hajj', targetMinor: 100_000, targetOn: '2026-08-28' }]);
    expect(screen.getByTestId('finance-goal-target-date-Hajj').props.children).toBe(
      'Target date 2026-08-28.',
    );

    await act(async () => {
      harness?.setNow(new Date(2026, 7, 29, 9, 0, 0));
      harness?.fireMidnight();
      await Promise.resolve();
    });
    await settle();

    expect(screen.getByTestId('finance-goal-target-date-Hajj').props.children).toBe(
      'Target date 2026-08-28 has passed.',
    );
    /* Passed, and nothing more. No verdict, and the goal itself is untouched. */
    expect(statusText('Hajj')).toBe('No contributions recorded');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The screen
// ─────────────────────────────────────────────────────────────────────────────

describe('the Savings screen', () => {
  it('replaced the placeholder', () => {
    const route = fs.readFileSync(path.join(process.cwd(), 'src/app/finance/goals.tsx'), 'utf8');
    expect(route).toContain('FinanceSavingsScreen');
    expect(route).not.toContain('ModuleSectionScreen');
    expect(route).not.toContain('Not built yet');
  });

  it('states the empty case without inventing anything', async () => {
    await renderWith();
    const card = screen.getByTestId('finance-savings-empty');
    expect(within(card).getByText('No savings goals')).toBeTruthy();
    expect(within(card).getByText(/nothing is counted for you/i)).toBeTruthy();
  });

  it('shows a loading state before the stores answer', async () => {
    const { storage } = memory();
    await render(
      <FinanceProvider repository={ledgerRepo(storage)} goalRepository={goalRepo(storage)}>
        <FinanceSavingsScreen />
      </FinanceProvider>,
    );
    /* Deliberately not settled: this is the frame between mount and the first read resolving. */
    expect(screen.queryByTestId('finance-savings-empty')).toBeNull();
    await settle();
  });

  it('quarantines a corrupt goal store, and says which store it was', async () => {
    const { storage, rows } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    const address = String(financeGoalsAddress(OWNER));
    rows.set(address, 'not json');

    await render(
      <FinanceProvider repository={ledgerRepo(storage)} goalRepository={goalRepo(storage)}>
        <FinanceSavingsScreen />
      </FinanceProvider>,
    );
    await settle();

    expect(screen.getByTestId('finance-savings-corrupt')).toBeTruthy();
    expect(screen.getByText('Your savings goals could not be read')).toBeTruthy();
    expect(screen.queryByTestId('finance-goal-open-composer')).toBeNull();
    /* Nothing was written over the bytes that could not be read. */
    expect(rows.get(address)).toBe('not json');
  });

  it('reports a storage fault without offering a write', async () => {
    const failing: FinanceStorage = {
      getItem: async () => {
        throw new Error('closed');
      },
      setItem: async () => {
        throw new Error('closed');
      },
    };
    await render(
      <FinanceProvider repository={ledgerRepo(failing)} goalRepository={goalRepo(failing)}>
        <FinanceSavingsScreen />
      </FinanceProvider>,
    );
    await settle();

    expect(screen.getByTestId('finance-savings-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('finance-goal-open-composer')).toBeNull();
  });

  it('creates a goal from the composer', async () => {
    const { bytes } = await renderWith();

    await press(screen.getByTestId('finance-goal-open-composer'));
    await type('finance-goal-name', 'Hajj');
    await type('finance-goal-target', '20000');
    await type('finance-goal-target-date', '2027-06-01');
    await press(screen.getByTestId('finance-goal-save'));
    await settle();

    expect(screen.getByTestId('finance-goal-Hajj')).toBeTruthy();
    expect(statusText('Hajj')).toBe('No contributions recorded');
    expect(storedGoals(bytes).goals[0]).toMatchObject({
      name: 'Hajj',
      targetMinor: 2_000_000,
      targetOn: '2027-06-01',
    });
  });

  it('creates a goal with no target date', async () => {
    const { bytes } = await renderWith();

    await press(screen.getByTestId('finance-goal-open-composer'));
    await type('finance-goal-name', 'Car');
    await type('finance-goal-target', '5000');
    await press(screen.getByTestId('finance-goal-save'));
    await settle();

    expect(storedGoals(bytes).goals[0]).toMatchObject({ targetOn: null });
    expect(screen.queryByTestId('finance-goal-target-date-Car')).toBeNull();
  });

  it('refuses an unusable target and records nothing', async () => {
    const { bytes } = await renderWith();

    await press(screen.getByTestId('finance-goal-open-composer'));
    await type('finance-goal-name', 'Hajj');
    await type('finance-goal-target', '0');
    await press(screen.getByTestId('finance-goal-save'));
    await settle();

    expect(screen.getByTestId('finance-savings-message')).toBeTruthy();
    expect(bytes.get(String(financeGoalsAddress(OWNER)))).toBeUndefined();
  });

  it('edits a goal', async () => {
    await renderWith([], [{ name: 'Hajj', targetMinor: 2_000_000 }]);

    await press(screen.getByTestId('finance-goal-edit-Hajj'));
    await type('finance-goal-target', '25000');
    await press(screen.getByTestId('finance-goal-save'));
    await settle();

    expect(rowLabel('Hajj')).toContain(formatAmount(2_500_000, 'AED'));
  });

  it('deletes a goal only after a confirmation that says what survives', async () => {
    await renderWith(
      [{ day: TODAY, amount: 25_000, goalId: GOAL_A }],
      [{ name: 'Hajj', targetMinor: 100_000 }],
    );

    await press(screen.getByTestId('finance-goal-delete-Hajj'));
    const confirmation = screen.getByTestId('finance-goal-removal-confirmation');
    expect(within(confirmation).getByText(/stay in your ledger/)).toBeTruthy();

    /* The goal is still there while the confirmation is open. */
    expect(screen.getByTestId('finance-goal-Hajj')).toBeTruthy();
    await press(screen.getByTestId('finance-goal-cancel-delete'));
    expect(screen.getByTestId('finance-goal-Hajj')).toBeTruthy();

    await press(screen.getByTestId('finance-goal-delete-Hajj'));
    await press(screen.getByTestId('finance-goal-confirm-delete'));
    await settle();

    expect(screen.queryByTestId('finance-goal-Hajj')).toBeNull();
    expect(screen.getByTestId('finance-savings-empty')).toBeTruthy();
  });

  it('deletes a goal through the screen without deleting its transactions', async () => {
    /*
      The repository case is asserted above; this is the same claim driven through the button a user
      actually presses, because a cascade would be added in the screen and not in the store. The
      confirmation promises the transactions survive — this is what holds the promise.
    */
    const { bytes } = await renderWith(
      [{ day: TODAY, amount: 25_000, goalId: GOAL_A }],
      [{ name: 'Hajj', targetMinor: 100_000 }],
    );
    const ledgerBefore = bytes.get(String(financeLedgerAddress(OWNER)));

    await press(screen.getByTestId('finance-goal-delete-Hajj'));
    await press(screen.getByTestId('finance-goal-confirm-delete'));
    await settle();

    expect(screen.queryByTestId('finance-goal-Hajj')).toBeNull();
    expect(bytes.get(String(financeLedgerAddress(OWNER)))).toBe(ledgerBefore);
    expect(String(ledgerBefore)).toContain(GOAL_A);
    /* And the banner says what survived, rather than leaving the user to find out. */
    expect(screen.getByText(/still in your ledger/)).toBeTruthy();
  });

  it('records a contribution, and updates the goal without a relaunch', async () => {
    await renderWith([], [{ name: 'Hajj', targetMinor: 100_000 }]);
    expect(statusText('Hajj')).toBe('No contributions recorded');

    await press(screen.getByTestId('finance-goal-contributions-Hajj'));
    await press(screen.getByTestId('finance-contribution-open-composer'));
    await type('finance-contribution-amount', '250');
    await type('finance-contribution-date', TODAY);
    await press(screen.getByTestId('finance-contribution-save'));
    await settle();

    expect(statusText('Hajj')).toBe(`${formatAmount(75_000, 'AED')} remaining`);
    expect(rowLabel('Hajj')).toContain(
      `${formatAmount(25_000, 'AED')} recorded toward ${formatAmount(100_000, 'AED')}`,
    );
  });

  it('discloses that a contribution is a ledger transaction', async () => {
    await renderWith([], [{ name: 'Hajj', targetMinor: 100_000 }]);
    await press(screen.getByTestId('finance-goal-contributions-Hajj'));
    expect(
      within(screen.getByTestId('finance-savings-contributions')).getByText(
        /appears in Spending as well/,
      ),
    ).toBeTruthy();
  });

  it('records a withdrawal as its own explicit event', async () => {
    await renderWith(
      [{ day: '2026-08-01', amount: 50_000, goalId: GOAL_A }],
      [{ name: 'Hajj', targetMinor: 100_000 }],
    );

    await press(screen.getByTestId('finance-goal-contributions-Hajj'));
    await press(screen.getByTestId('finance-contribution-open-composer'));
    await press(screen.getByTestId('finance-contribution-direction-income'));
    await type('finance-contribution-amount', '200');
    await type('finance-contribution-date', TODAY);
    await press(screen.getByTestId('finance-contribution-save'));
    await settle();

    expect(screen.getByTestId('finance-goal-withdrawn-Hajj').props.children).toBe(
      `${formatAmount(20_000, 'AED')} of that has been taken back out, leaving ${formatAmount(30_000, 'AED')} set aside.`,
    );
  });

  it('edits a contribution without detaching it from its goal', async () => {
    await renderWith(
      [{ day: TODAY, amount: 25_000, goalId: GOAL_A }],
      [{ name: 'Hajj', targetMinor: 100_000 }],
    );
    const txId = 'finance.aaaaaaaa-1111-4111-8111-000000000001';

    await press(screen.getByTestId('finance-goal-contributions-Hajj'));
    await press(screen.getByTestId(`finance-contribution-edit-${txId}`));
    await type('finance-contribution-amount', '400');
    await press(screen.getByTestId('finance-contribution-save'));
    await settle();

    expect(statusText('Hajj')).toBe(`${formatAmount(60_000, 'AED')} remaining`);
  });

  it('deletes a contribution only after a confirmation', async () => {
    await renderWith(
      [{ day: TODAY, amount: 25_000, goalId: GOAL_A }],
      [{ name: 'Hajj', targetMinor: 100_000 }],
    );
    const txId = 'finance.aaaaaaaa-1111-4111-8111-000000000001';

    await press(screen.getByTestId('finance-goal-contributions-Hajj'));
    await press(screen.getByTestId(`finance-contribution-delete-${txId}`));
    expect(screen.getByTestId('finance-contribution-removal-confirmation')).toBeTruthy();
    await press(screen.getByTestId('finance-contribution-cancel-delete'));
    expect(statusText('Hajj')).toBe(`${formatAmount(75_000, 'AED')} remaining`);

    await press(screen.getByTestId(`finance-contribution-delete-${txId}`));
    await press(screen.getByTestId('finance-contribution-confirm-delete'));
    await settle();

    expect(statusText('Hajj')).toBe('No contributions recorded');
    expect(screen.getByTestId('finance-savings-contributions-empty')).toBeTruthy();
  });

  it('creates one record from a double tap on the goal composer', async () => {
    const { bytes } = await renderWith();

    await press(screen.getByTestId('finance-goal-open-composer'));
    await type('finance-goal-name', 'Hajj');
    await type('finance-goal-target', '20000');

    /*
      Both presses inside one act, which is what a real double tap delivers. The guard is a ref, so
      the second handler sees it set even though it closed over `saving === false`.
    */
    await act(async () => {
      const save = screen.getByTestId('finance-goal-save');
      fireEvent.press(save);
      fireEvent.press(save);
      await Promise.resolve();
      await Promise.resolve();
    });
    await settle();

    expect(storedGoals(bytes).goals).toHaveLength(1);
    /*
      One record is not enough to prove the guard worked. Without it the second press reaches the
      repository and is refused as a duplicate name — one record either way, and the assertion above
      would pass over a broken guard. What only the guard produces is the *absence* of that refusal:
      the second press never ran, so nothing was refused and the success banner still stands.
    */
    expect(screen.queryByText(/already have a goal with that name/)).toBeNull();
  });

  it('creates one transaction from a double tap on the contribution composer', async () => {
    const { bytes } = await renderWith([], [{ name: 'Hajj', targetMinor: 100_000 }]);

    await press(screen.getByTestId('finance-goal-contributions-Hajj'));
    await press(screen.getByTestId('finance-contribution-open-composer'));
    await type('finance-contribution-amount', '250');
    await type('finance-contribution-date', TODAY);

    await act(async () => {
      const save = screen.getByTestId('finance-contribution-save');
      fireEvent.press(save);
      fireEvent.press(save);
      await Promise.resolve();
      await Promise.resolve();
    });
    await settle();

    const ledger = JSON.parse(String(bytes.get(String(financeLedgerAddress(OWNER))))) as {
      transactions: unknown[];
    };
    expect(ledger.transactions).toHaveLength(1);
    expect(statusText('Hajj')).toBe(`${formatAmount(75_000, 'AED')} remaining`);
  });

  it.each([
    ['nothing recorded', [] as Row[], 'No contributions recorded'],
    [
      'in progress',
      [{ day: TODAY, amount: 25_000, goalId: GOAL_A }],
      `${formatAmount(75_000, 'AED')} remaining`,
    ],
    ['exactly at the target', [{ day: TODAY, amount: 100_000, goalId: GOAL_A }], 'Target reached'],
    [
      'above the target',
      [{ day: TODAY, amount: 150_000, goalId: GOAL_A }],
      `${formatAmount(50_000, 'AED')} above the target`,
    ],
    [
      'withdrawn past nothing',
      [
        { day: '2026-08-01', amount: 10_000, goalId: GOAL_A },
        { day: TODAY, amount: 15_000, income: true, goalId: GOAL_A },
      ],
      `${formatAmount(5_000, 'AED')} more taken back out than set aside`,
    ],
  ])('states %s in words', async (_case, rows, expected) => {
    await renderWith(rows, [{ name: 'Hajj', targetMinor: 100_000 }]);
    expect(statusText('Hajj')).toBe(expected);
  });

  it('carries the whole standing in the accessible label, not in a colour', async () => {
    await renderWith(
      [{ day: TODAY, amount: 150_000, goalId: GOAL_A }],
      [{ name: 'Hajj', targetMinor: 100_000, targetOn: '2027-06-01' }],
    );
    const label = rowLabel('Hajj');
    expect(label).toContain('Hajj');
    expect(label).toContain(formatAmount(150_000, 'AED'));
    expect(label).toContain(formatAmount(100_000, 'AED'));
    expect(label).toContain('150% of the target');
    /* The factual figure, above the target, stated truthfully rather than capped at the bar's 100%. */
    expect(label).toContain(`${formatAmount(50_000, 'AED')} above the target`);
    expect(label).toContain('Target date 2027-06-01.');
  });

  it('caps the bar but never the total', async () => {
    await renderWith(
      [{ day: TODAY, amount: 500_000, goalId: GOAL_A }],
      [{ name: 'Hajj', targetMinor: 100_000 }],
    );
    expect(barWidth('Hajj')).toBe('100%');
    /* The words still tell the truth about the amount the bar could not show. */
    expect(statusText('Hajj')).toBe(`${formatAmount(400_000, 'AED')} above the target`);
  });

  it('shows an empty bar rather than a negative width when withdrawn past nothing', async () => {
    await renderWith(
      [
        { day: '2026-08-01', amount: 10_000, goalId: GOAL_A },
        { day: TODAY, amount: 15_000, income: true, goalId: GOAL_A },
      ],
      [{ name: 'Hajj', targetMinor: 100_000 }],
    );
    expect(barWidth('Hajj')).toBe('0%');
    expect(rowLabel('Hajj')).toContain('minus 5%');
  });

  it('holds a long name and a large amount at font scale 1.5', async () => {
    pinModuleWindow({ width: 320, fontScale: 1.5 });
    const name = 'Saving for my family’s Hajj journey in the year 1450';
    await renderWith(
      [{ day: TODAY, amount: 999_999_999_999, goalId: GOAL_A }],
      [{ name, targetMinor: MAX_MINOR_UNITS }],
    );

    expect(screen.getByTestId(`finance-goal-${name}`)).toBeTruthy();
    expect(statusText(name)).toBe(`${formatAmount(1, 'AED')} remaining`);
  });

  it('gives every control a label, a role and the 44 dp minimum', async () => {
    await renderWith(
      [{ day: TODAY, amount: 25_000, goalId: GOAL_A }],
      [{ name: 'Hajj', targetMinor: 100_000 }],
    );
    await press(screen.getByTestId('finance-goal-contributions-Hajj'));
    await press(screen.getByTestId('finance-contribution-open-composer'));

    for (const testID of [
      'finance-contribution-amount',
      'finance-contribution-date',
      'finance-contribution-note',
    ]) {
      const field = screen.getByTestId(testID);
      expect(field.props.accessibilityLabel).toBeTruthy();
    }

    for (const key of ['expense', 'income']) {
      const choice = screen.getByTestId(`finance-contribution-direction-${key}`);
      expect(choice.props.accessibilityRole).toBe('radio');
      expect(choice.props.accessibilityLabel).toBeTruthy();
      const style = (Array.isArray(choice.props.style) ? choice.props.style : [choice.props.style])
        .flat(4)
        .filter(
          (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
        )
        .reduce<Record<string, unknown>>((all, entry) => ({ ...all, ...entry }), {});
      expect(Number(style.minHeight)).toBeGreaterThanOrEqual(44);
    }
  });

  it('writes nothing on mount, on open, or on a day change', async () => {
    const { storage, rows } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    const store = goalRepo(storage);
    await store.createGoal({ name: 'Hajj', targetMinor: 100_000, targetOn: null });

    let writes = 0;
    const counting: FinanceStorage = {
      getItem: storage.getItem,
      setItem: async (key, value) => {
        writes += 1;
        await storage.setItem(key, value);
      },
    };

    await render(
      <FinanceProvider repository={ledgerRepo(counting)} goalRepository={goalRepo(counting)}>
        <FinanceSavingsScreen />
      </FinanceProvider>,
    );
    await settle();
    await press(screen.getByTestId('finance-goal-contributions-Hajj'));
    await act(async () => {
      harness?.setNow(new Date(2026, 8, 1, 9, 0, 0));
      harness?.fireMidnight();
      await Promise.resolve();
    });
    await settle();

    expect(writes).toBe(0);
    expect(rows.size).toBe(2);
  });

  it('uses no palette literal, font family or raster of its own', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/finance/screens/finance-savings-screen.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(source).not.toMatch(/rgba?\(/);
    expect(source).not.toMatch(/fontFamily|fontWeight|Poppins/);
    expect(source).not.toMatch(/require\(|moduleRasterIcon|\.png/);
    /* Established roles only — no Finance-only text primitive. */
    expect(source).toContain('ModuleText');
    expect(source).toContain('useModuleSurfaces');
  });

  it('says nothing that would be a forecast, a verdict or advice', () => {
    /*
      Comments stripped first. The header of that file *names* the claims it refuses — "no on track",
      "no projected completion date" — so a raw substring search matches the very documentation that
      promises the copy is absent, and would have to be weakened to pass. Stripping leaves the
      strings a user can actually be shown, which is what the guard is about.
    */
    const source = fs
      .readFileSync(
        path.join(process.cwd(), 'src/features/finance/screens/finance-savings-screen.tsx'),
        'utf8',
      )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const claim of [
      'on track',
      'you will reach',
      'projected',
      'estimated completion',
      'interest',
      'available to spend',
      'we transferred',
      'your bank',
      'held by NoorLife',
      'you should',
      'well done',
      'keep it up',
    ]) {
      expect(source.toLowerCase()).not.toContain(claim);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ownership
// ─────────────────────────────────────────────────────────────────────────────

describe('one owner, across three stores', () => {
  it('cannot show one account’s savings inside another’s session', async () => {
    const { storage } = memory();
    const ledgerA = ledgerRepo(storage, OWNER);
    await ledgerA.setCurrency('AED');
    await goalRepo(storage, OWNER).createGoal({
      name: 'Hajj',
      targetMinor: 100_000,
      targetOn: null,
    });
    const ledgerB = ledgerRepo(storage, OTHER_OWNER);
    await ledgerB.setCurrency('AED');

    const view = await render(
      <FinanceProvider
        repository={ledgerRepo(storage, OWNER)}
        goalRepository={goalRepo(storage, OWNER)}
      >
        <FinanceSavingsScreen />
      </FinanceProvider>,
    );
    await settle();
    expect(screen.getByTestId('finance-goal-Hajj')).toBeTruthy();

    await view.rerender(
      <FinanceProvider
        repository={ledgerRepo(storage, OTHER_OWNER)}
        goalRepository={goalRepo(storage, OTHER_OWNER)}
      >
        <FinanceSavingsScreen />
      </FinanceProvider>,
    );
    await settle();

    expect(screen.queryByTestId('finance-goal-Hajj')).toBeNull();
    expect(screen.getByTestId('finance-savings-empty')).toBeTruthy();
  });

  it('refuses a goal write that resolves after the account changed', async () => {
    const { storage, rows } = memory();
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const held: FinanceStorage = {
      getItem: storage.getItem,
      setItem: async (key, value) => {
        if (key === financeGoalsAddress(OWNER)) {
          await gate;
        }
        await storage.setItem(key, value);
      },
    };

    const ledgerA = ledgerRepo(storage, OWNER);
    await ledgerA.setCurrency('AED');
    const ledgerB = ledgerRepo(storage, OTHER_OWNER);
    await ledgerB.setCurrency('AED');

    let api: ReturnType<typeof useFinance> | null = null;
    function Probe() {
      api = useFinance();
      return null;
    }

    const view = await render(
      <FinanceProvider
        repository={ledgerRepo(storage, OWNER)}
        goalRepository={goalRepo(held, OWNER)}
      >
        <Probe />
        <FinanceSavingsScreen />
      </FinanceProvider>,
    );
    await settle();

    const pending = api!.createGoal({ name: 'Hajj', targetMinor: 100_000, targetOn: null });

    await view.rerender(
      <FinanceProvider
        repository={ledgerRepo(storage, OTHER_OWNER)}
        goalRepository={goalRepo(storage, OTHER_OWNER)}
      >
        <Probe />
        <FinanceSavingsScreen />
      </FinanceProvider>,
    );
    await settle();

    await act(async () => {
      release?.();
      await pending;
      await Promise.resolve();
    });
    await settle();

    /* The first account's goal landed at the first account's address, and stayed out of view. */
    expect(rows.get(String(financeGoalsAddress(OWNER)))).toContain('Hajj');
    expect(screen.queryByTestId('finance-goal-Hajj')).toBeNull();
  });

  it('fails closed with no owner, and deletes nothing', async () => {
    const { storage, rows } = memory();
    await goalRepo(storage, OWNER).createGoal({
      name: 'Hajj',
      targetMinor: 100_000,
      targetOn: null,
    });
    const stored = rows.get(String(financeGoalsAddress(OWNER)));

    await render(
      <FinanceProvider
        repository={ledgerRepo(storage, null)}
        goalRepository={goalRepo(storage, null)}
      >
        <FinanceSavingsScreen />
      </FinanceProvider>,
    );
    await settle();

    expect(screen.queryByTestId('finance-goal-Hajj')).toBeNull();
    /* Signing out clears memory. The stored record is still the account's own. */
    expect(rows.get(String(financeGoalsAddress(OWNER)))).toBe(stored);
  });

  it('keeps a stale instance at its own address', async () => {
    const { storage, rows } = memory();
    const stale: FinanceGoalRepository = goalRepo(storage, OTHER_OWNER);
    await stale.createGoal({ name: 'Ghost', targetMinor: 1_000, targetOn: null });
    expect(rows.get(String(financeGoalsAddress(OWNER)))).toBeUndefined();
    expect(rows.get(String(financeGoalsAddress(OTHER_OWNER)))).toBeDefined();
  });

  it('quarantines the goals without taking the transactions down', async () => {
    const { storage, rows } = memory();
    const ledger = ledgerRepo(storage);
    await ledger.setCurrency('AED');
    await ledger.createTransaction({ direction: 'expense', amountMinor: 500, occurredOn: TODAY });
    rows.set(String(financeGoalsAddress(OWNER)), 'not json');

    let api: ReturnType<typeof useFinance> | null = null;
    function Probe() {
      api = useFinance();
      return null;
    }
    await render(
      <FinanceProvider repository={ledgerRepo(storage)} goalRepository={goalRepo(storage)}>
        <Probe />
      </FinanceProvider>,
    );
    await settle();

    expect(api!.goalFault).toBe('corrupt-data');
    expect(api!.fault).toBeNull();
    expect(api!.ledger.transactions).toHaveLength(1);
  });

  it('mounts one provider, at the app boundary, and none inside a route', () => {
    for (const name of fs.readdirSync(path.join(process.cwd(), 'src/app/finance'))) {
      const source = fs.readFileSync(path.join(process.cwd(), 'src/app/finance', name), 'utf8');
      expect(source).not.toContain('FinanceProvider');
    }
    const screenSource = fs.readFileSync(
      path.join(process.cwd(), 'src/features/finance/screens/finance-savings-screen.tsx'),
      'utf8',
    );
    expect(screenSource).not.toContain('FinanceProvider');
    expect(screenSource).toContain('useFinance');
  });

  it('keeps the entitlement gate outside every Finance route', () => {
    const layout = fs.readFileSync(path.join(process.cwd(), 'src/app/finance/_layout.tsx'), 'utf8');
    expect(layout).toContain('ProtectedRouteBoundary');
    expect(layout).toContain('ModuleEntitlementGate');
    expect(layout).toContain('moduleId="finance"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scope, route and artwork
// ─────────────────────────────────────────────────────────────────────────────

describe('nothing outside Savings changed', () => {
  it('activates the Savings capability on the route that now exists', () => {
    const capability = moduleRegistry.finance.capabilities.find((item) => item.key === 'goals');
    expect(capability).toMatchObject({
      key: 'goals',
      label: 'Savings',
      icon: 'target',
      href: '/finance/goals',
      available: true,
    });
    expect(fs.existsSync(path.join(process.cwd(), 'src/app/finance/goals.tsx'))).toBe(true);
  });

  it('keeps the approved artwork at the bytes that were reviewed', () => {
    /*
      #106 installed and mapped this asset and owns its full contract. Repeated here as one hash so
      #95 cannot activate the surface and quietly re-export the art in the same change.
    */
    const file = path.join(
      process.cwd(),
      'assets/images/modules/finance/pictograms/finance-goals.png',
    );
    expect(createHash('sha256').update(fs.readFileSync(file)).digest('hex')).toBe(
      '5e4804ffb513d45425d621783096c8f26cf4064409ce3d27c922191717ffa85a',
    );
  });

  it('adds no new PNG anywhere', () => {
    expect(
      fs.readdirSync(path.join(process.cwd(), 'assets/images/modules/finance/pictograms')).sort(),
    ).toEqual([
      'finance-add-circle.png',
      'finance-budgets.png',
      'finance-goals.png',
      'finance-money.png',
      'finance-track.png',
      'finance-transactions.png',
    ]);
  });

  it('keeps the require a static literal, and the raster untinted', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/modules/assets/finance-icon-assets.ts'),
      'utf8',
    );
    expect(source).toContain(
      "target: require('../../../../assets/images/modules/finance/pictograms/finance-goals.png')",
    );
    expect(source).not.toMatch(/require\(`|require\(.*\+/);
    expect(source).not.toMatch(/tintColor/);
  });

  it('leaves the Goals module and the Finance tabs alone', () => {
    /* `target` is also Goals' tile icon; its own artwork must not have moved. */
    const goalsTile = moduleRegistry.goals.capabilities.find((item) => item.key === 'goals');
    expect(goalsTile).toMatchObject({ icon: 'target', href: '/goals', available: true });
    expect(moduleRegistry.goals.routes.home).toBe('/goals');

    expect(moduleRegistry.finance.navigation.map((item) => item.href)).toEqual([
      '/finance',
      '/finance/transactions',
      '/finance/ai',
      '/finance/budgets',
      '/finance/goals',
    ]);
  });

  it('leaves Bank sync and Receipts unavailable, unreachable and unmapped', () => {
    for (const key of ['bank-sync', 'receipts']) {
      const capability = moduleRegistry.finance.capabilities.find((item) => item.key === key);
      expect(capability?.available).toBe(false);
      expect(capability?.href).toBeUndefined();
    }
    const assets = fs.readFileSync(
      path.join(process.cwd(), 'src/features/modules/assets/finance-icon-assets.ts'),
      'utf8',
    );
    expect(assets).toContain("FINANCE_HELD_ASSETS: readonly string[] = ['finance-receipts.png']");
    expect(
      fs.existsSync(
        path.join(process.cwd(), 'assets/images/modules/finance/pictograms/finance-receipts.png'),
      ),
    ).toBe(false);
  });

  it('requests no permission and schedules nothing', () => {
    expect(moduleRegistry.finance.permissions).toEqual([]);
    for (const file of [
      'src/features/finance/data/finance-goal.ts',
      'src/features/finance/data/finance-goal.repository.ts',
      'src/features/finance/data/finance-goal-progress.ts',
      'src/features/finance/data/finance-currency-lock.ts',
      'src/features/finance/screens/finance-savings-screen.tsx',
      'src/app/finance/goals.tsx',
    ]) {
      const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(source).not.toMatch(
        /Notifications|scheduleNotification|analytics|track\(|fetch\(|axios/,
      );
    }
  });

  it('leaves Spending, Budgets and the comparison deriving as they did', () => {
    /*
      Not a re-run of their suites — those pass unchanged. This is the one thing #95 could have
      broken quietly: an attributed transaction is still an ordinary transaction to every other
      derived view, so the module's single record of money moved stays single.
    */
    const ledger = ledgerOf([
      { day: TODAY, amount: 25_000, category: 'Groceries' },
      { day: TODAY, amount: 60_000, goalId: GOAL_A },
    ]);
    const view = goalsProgress(ledger, [goalOf('Hajj', 100_000)]);
    expect(view.entries[0]?.setAsideMinor).toBe(60_000);
    expect(contributionsForGoal(ledger, GOAL_A)).toHaveLength(1);
    /* Both are expenses in the ledger, which is exactly what #95 asked for. */
    expect(ledger.transactions.filter((tx) => tx.direction === 'expense')).toHaveLength(2);
  });

  it('changes no other module and no native configuration', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/features/finance/screens/finance-savings-screen.tsx'),
      'utf8',
    );
    expect(source).not.toMatch(/@features\/(?!finance|modules|planner)/);
  });
});
