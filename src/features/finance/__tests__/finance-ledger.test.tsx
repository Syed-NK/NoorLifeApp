import fs from 'node:fs';
import path from 'node:path';

import { render, screen, act } from '@testing-library/react-native';
import { Text } from 'react-native';
import { useEffect } from 'react';

import { plannerDayAt } from '@features/planner/data/planner-day';

import {
  MAX_FINANCE_TRANSACTIONS,
  canChangeCurrency,
  emptyFinanceLedger,
  parseFinanceLedgerEnvelope,
} from '../data/finance-ledger';
import { MAX_MINOR_UNITS, isFinanceCurrency, isStorableMinorAmount } from '../data/finance-money';
import {
  createFinanceLedgerRepository,
  financeLedgerAddress,
  type FinanceStorage,
} from '../data/finance-ledger.repository';
import { financeWriteLaneCount } from '../data/finance-write-queue';
import { FinanceProvider, useFinance } from '../di/finance-provider';

/**
 * **The Finance ledger's foundation** — issue #92.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What this layer is, and is not ─────────────────────────────────────────
 * A domain, an account-scoped repository and one app-scoped provider. No screen reads any of it:
 * Finance's three section routes are still the honest "Not built yet" placeholders, and Spending is
 * #93. The point of building it first is that the ownership, serialization and quarantine rules are
 * settled before anything renders against them — Planner arrived at all three the hard way, through
 * #72, #73 and #76.
 *
 * ── The rules with teeth ───────────────────────────────────────────────────
 * A ledger starts with **no currency**, and nothing may infer one. It may be chosen once and changed
 * only while no transaction exists, because there is no honest conversion afterwards. Money is a
 * positive integer count of minor units inside a stated safe bound. Bytes that do not decode are
 * **quarantined, never overwritten** — asserted from both directions, because "corrupt read reports
 * corrupt" is easy and "a later write leaves the bytes byte-identical" is the one that actually
 * protects somebody's records.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = '3f6d2c18-9a4b-4c7e-8f21-5b7d0e9a1c42';
const OTHER = '7b1e4a90-2c3d-4e5f-9a08-1d2c3b4a5e6f';
const AT = new Date('2026-08-27T09:00:00.000Z');
const DAY = plannerDayAt(new Date(2026, 7, 27, 9, 0, 0)).today;

function memory(seed?: Record<string, string>) {
  const raw = new Map<string, string>(Object.entries(seed ?? {}));
  const store = {
    raw,
    reads: 0,
    writes: 0,
    async getItem(key: string): Promise<string | null> {
      store.reads += 1;
      await Promise.resolve();
      return raw.get(key) ?? null;
    },
    async setItem(key: string, value: string): Promise<void> {
      store.writes += 1;
      await Promise.resolve();
      raw.set(key, value);
    },
  };
  return store;
}

let ids = 0;
function repo(storage: FinanceStorage, ownerId: string = OWNER) {
  return createFinanceLedgerRepository({
    ownerId,
    storage,
    id: () => `finance.${String(++ids).padStart(8, '0')}-0000-4000-8000-000000000000`,
    now: () => AT,
  });
}

const draft = (amountMinor: number, extra: Record<string, unknown> = {}) =>
  ({ direction: 'expense', amountMinor, occurredOn: DAY, ...extra }) as never;

beforeEach(() => {
  ids = 0;
});

// ─────────────────────────────────────────────────────────────────────────────
// The unconfigured ledger and its currency
// ─────────────────────────────────────────────────────────────────────────────

describe('a new ledger is unconfigured', () => {
  it('starts with no currency and no transactions', async () => {
    const storage = memory();
    const result = await repo(storage).read();
    expect(result).toEqual({ kind: 'ok', ledger: { currency: null, transactions: [] } });
  });

  it('infers nothing from anywhere', () => {
    /*
      The rule stated against the source, because inference is the kind of convenience that gets
      added later by someone trying to be helpful. A locale, a SIM, a timezone and a region are all
      guesses about *where* somebody is; none is a statement about which currency their money is in.
    */
    for (const file of ['finance-money.ts', 'finance-ledger.ts', 'finance-ledger.repository.ts']) {
      const source = fs
        .readFileSync(path.join(process.cwd(), 'src/features/finance/data', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(source).not.toMatch(
        /getLocales|getCurrencies|Localization|Intl\.|timeZone|SIM|countryCode|DEFAULT_CURRENCY/i,
      );
    }
  });

  it('refuses to record money before a currency is chosen', async () => {
    const storage = memory();
    const result = await repo(storage).createTransaction(draft(1500));
    expect(result).toEqual({ kind: 'invalid', fault: 'no-currency' });
    expect(storage.writes).toBe(0);
  });

  it('accepts a supported ISO code and rejects everything else', async () => {
    const storage = memory();
    const subject = repo(storage);

    const ok = await subject.setCurrency('AED');
    expect(ok.kind).toBe('ok');
    expect((await subject.read()).kind === 'ok' && (await subject.read())).toMatchObject({
      ledger: { currency: 'AED' },
    });

    for (const bad of ['XYZ', 'aed ', '', 'USDD', '840', 'BITCOIN', '$']) {
      expect(await repo(memory()).setCurrency(bad)).toEqual({
        kind: 'invalid',
        fault: 'unsupported-currency',
      });
    }
  });

  it('covers all three minor-unit classes', () => {
    // A `× 100` assumption inflates JPY a hundredfold and divides KWD by ten.
    expect(isFinanceCurrency('JPY')).toBe(true);
    expect(isFinanceCurrency('KWD')).toBe(true);
    expect(isFinanceCurrency('AED')).toBe(true);
  });
});

describe('the currency may change only while the ledger is empty', () => {
  it('allows a change before any transaction exists', async () => {
    const storage = memory();
    const subject = repo(storage);
    await subject.setCurrency('AED');
    expect((await subject.setCurrency('GBP')).kind).toBe('ok');
    const after = await subject.read();
    expect(after.kind === 'ok' && after.ledger.currency).toBe('GBP');
  });

  it('refuses a change once money is recorded', async () => {
    const storage = memory();
    const subject = repo(storage);
    await subject.setCurrency('AED');
    await subject.createTransaction(draft(1500));

    expect(await subject.setCurrency('GBP')).toEqual({ kind: 'invalid', fault: 'currency-locked' });
    const after = await subject.read();
    expect(after.kind === 'ok' && after.ledger.currency).toBe('AED');
  });

  it('allows re-selecting the same currency, which changes nothing', async () => {
    const storage = memory();
    const subject = repo(storage);
    await subject.setCurrency('AED');
    await subject.createTransaction(draft(1500));
    expect((await subject.setCurrency('AED')).kind).toBe('ok');
  });

  it('states the rule as one predicate', () => {
    expect(canChangeCurrency(emptyFinanceLedger())).toBe(true);
    expect(
      canChangeCurrency({
        currency: 'AED',
        transactions: [{ id: 'x' } as never],
      }),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Amounts
// ─────────────────────────────────────────────────────────────────────────────

describe('money is a positive integer in minor units', () => {
  it.each([
    ['a float', 15.5],
    ['a float that looks whole', 0.1 + 0.2],
    ['zero', 0],
    ['negative', -100],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['above the safe bound', MAX_MINOR_UNITS + 1],
    ['a string', '1500'],
  ])('refuses %s', (_label, value) => {
    expect(isStorableMinorAmount(value)).toBe(false);
  });

  it('accepts one minor unit and the bound itself', () => {
    expect(isStorableMinorAmount(1)).toBe(true);
    expect(isStorableMinorAmount(MAX_MINOR_UNITS)).toBe(true);
  });

  it('leaves room for a full ledger to be summed exactly', () => {
    // The reason the bound is where it is: the sum must stay inside the safe-integer range.
    expect(MAX_MINOR_UNITS * MAX_FINANCE_TRANSACTIONS).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('refuses a float at the repository boundary, not only in the predicate', async () => {
    const storage = memory();
    const subject = repo(storage);
    await subject.setCurrency('AED');
    expect(await subject.createTransaction(draft(15.5))).toEqual({
      kind: 'invalid',
      fault: 'invalid-amount',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round trips
// ─────────────────────────────────────────────────────────────────────────────

describe('expense and income round-trip through storage', () => {
  it.each(['expense', 'income'] as const)(
    '%s survives a write and a fresh read',
    async (direction) => {
      const storage = memory();
      const subject = repo(storage);
      await subject.setCurrency('AED');
      await subject.createTransaction(draft(2500, { direction, category: 'Food', note: 'Lunch' }));

      /* A *different* instance, so this is storage round-tripping and not an in-memory cache. */
      const reread = await repo(storage).read();
      expect(reread.kind).toBe('ok');
      expect(reread.kind === 'ok' && reread.ledger.transactions).toHaveLength(1);
      expect(reread.kind === 'ok' && reread.ledger.transactions[0]).toMatchObject({
        direction,
        amountMinor: 2500,
        occurredOn: DAY,
        category: 'Food',
        note: 'Lunch',
      });
    },
  );

  it('updates and deletes by id', async () => {
    const storage = memory();
    const subject = repo(storage);
    await subject.setCurrency('AED');
    const created = await subject.createTransaction(draft(2500));
    const id = created.kind === 'ok' ? (created.ledger.transactions[0]?.id ?? '') : '';

    const updated = await subject.updateTransaction(id, draft(3000, { direction: 'income' }));
    expect(updated.kind === 'ok' && updated.ledger.transactions[0]).toMatchObject({
      amountMinor: 3000,
      direction: 'income',
    });

    expect((await subject.removeTransaction(id)).kind).toBe('ok');
    const after = await subject.read();
    expect(after.kind === 'ok' && after.ledger.transactions).toEqual([]);

    expect(await subject.removeTransaction(id)).toEqual({ kind: 'invalid', fault: 'not-found' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Serialization
// ─────────────────────────────────────────────────────────────────────────────

describe('concurrent writes serialize across instances', () => {
  it('loses no update when two repositories write the same ledger at once', async () => {
    const storage = memory();
    await repo(storage).setCurrency('AED');

    /*
      The lost-update case, exactly. Two instances, both reading-modifying-writing the same key with
      no await between them — before the shared queue this is where one write erased the other.
    */
    const a = repo(storage);
    const b = repo(storage);
    await Promise.all([
      a.createTransaction(draft(100)),
      b.createTransaction(draft(200)),
      a.createTransaction(draft(300)),
      b.createTransaction(draft(400)),
    ]);

    const final = await repo(storage).read();
    expect(final.kind === 'ok' && final.ledger.transactions).toHaveLength(4);
    expect(
      final.kind === 'ok' &&
        final.ledger.transactions.map((t) => t.amountMinor).sort((x, y) => x - y),
    ).toEqual([100, 200, 300, 400]);
  });

  it('keeps separate ledgers in separate lanes', async () => {
    const storage = memory();
    await repo(storage, OWNER).setCurrency('AED');
    await repo(storage, OTHER).setCurrency('GBP');

    const mine = repo(storage, OWNER);
    const theirs = repo(storage, OTHER);
    await Promise.all([mine.createTransaction(draft(100)), theirs.createTransaction(draft(200))]);

    const a = await mine.read();
    const b = await theirs.read();
    expect(a.kind === 'ok' && a.ledger.transactions).toHaveLength(1);
    expect(b.kind === 'ok' && b.ledger.transactions).toHaveLength(1);
    expect(a.kind === 'ok' && a.ledger.currency).toBe('AED');
    expect(b.kind === 'ok' && b.ledger.currency).toBe('GBP');
  });

  it('drains its lanes', async () => {
    const storage = memory();
    await repo(storage).setCurrency('AED');
    await repo(storage).createTransaction(draft(100));
    await Promise.resolve();
    expect(financeWriteLaneCount()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Account isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('the address is the account', () => {
  it('gives each owner its own key', () => {
    expect(financeLedgerAddress(OWNER)).toBe(`noorlife.finance.user.v1.${OWNER}.ledger`);
    expect(financeLedgerAddress(OWNER)).not.toBe(financeLedgerAddress(OTHER));
  });

  it.each([
    ['no owner', null],
    ['empty', ''],
    ['a wildcard', '*'],
    ['a traversal segment', '../../other'],
    ['a key separator', `${OWNER}.ledger`],
    ['another id appended', `${OWNER}${OTHER}`],
    ['a prefix of a real id', OWNER.slice(0, 30)],
    ['a namespace collision attempt', 'noorlife.finance.user.v1'],
    ['whitespace padding only', '   '],
  ])('refuses %s rather than escaping it', (_label, ownerId) => {
    expect(financeLedgerAddress(ownerId)).toBeNull();
  });

  it('is injective on the domain it accepts', () => {
    /*
      The accepted alphabet is hex and hyphens at a fixed width, with no `.` in it, so a UUID can
      neither collide with another nor reach into a neighbouring namespace. Refusal *is* the
      encoding — nothing is escaped, because nothing outside the alphabet is admitted.
    */
    const addresses = new Set([OWNER, OTHER, OWNER.toUpperCase()].map(financeLedgerAddress));
    expect(addresses.size).toBe(2);
  });

  it('touches no storage without an owner', async () => {
    const storage = memory();
    const anonymous = createFinanceLedgerRepository({ ownerId: null, storage });
    expect(await anonymous.read()).toEqual({ kind: 'unavailable' });
    expect(await anonymous.setCurrency('AED')).toEqual({ kind: 'unavailable' });
    expect(await anonymous.createTransaction(draft(100))).toEqual({ kind: 'unavailable' });
    expect(storage.reads).toBe(0);
    expect(storage.writes).toBe(0);
  });

  it('never reads one account’s ledger from another’s repository', async () => {
    const storage = memory();
    const mine = repo(storage, OWNER);
    await mine.setCurrency('AED');
    await mine.createTransaction(draft(9900));

    const theirs = await repo(storage, OTHER).read();
    expect(theirs).toEqual({ kind: 'ok', ledger: { currency: null, transactions: [] } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Corruption
// ─────────────────────────────────────────────────────────────────────────────

describe('unreadable bytes are quarantined, never guessed', () => {
  const key = `noorlife.finance.user.v1.${OWNER}.ledger`;

  it.each([
    ['not JSON', 'not json at all'],
    ['a future version', JSON.stringify({ version: 2, currency: 'AED', transactions: [] })],
    ['a missing version', JSON.stringify({ currency: 'AED', transactions: [] })],
    ['an unknown currency', JSON.stringify({ version: 1, currency: 'XYZ', transactions: [] })],
    [
      'a float amount',
      JSON.stringify({
        version: 1,
        currency: 'AED',
        transactions: [
          {
            id: 'finance.00000001-0000-4000-8000-000000000000',
            direction: 'expense',
            amountMinor: 1.5,
            occurredOn: '2026-08-27',
            category: null,
            note: null,
            createdAt: 'x',
            updatedAt: 'x',
          },
        ],
      }),
    ],
    [
      'money with no currency',
      JSON.stringify({
        version: 1,
        currency: null,
        transactions: [
          {
            id: 'finance.00000001-0000-4000-8000-000000000000',
            direction: 'expense',
            amountMinor: 100,
            occurredOn: '2026-08-27',
            category: null,
            note: null,
            createdAt: 'x',
            updatedAt: 'x',
          },
        ],
      }),
    ],
  ])('reports %s as corrupt, not empty', async (_label, stored) => {
    const storage = memory({ [key]: stored });
    expect(await repo(storage).read()).toEqual({ kind: 'corrupt' });
  });

  it('leaves the retained bytes byte-identical when a write is attempted', async () => {
    /*
      The assertion that actually protects somebody's records. Reporting corrupt is easy; the danger
      is the *next* write, which on an "empty" reading would replace whatever was really there.
    */
    const stored = JSON.stringify({ version: 2, currency: 'AED', transactions: ['unreadable'] });
    const storage = memory({ [key]: stored });
    const subject = repo(storage);

    expect(await subject.setCurrency('GBP')).toEqual({ kind: 'corrupt' });
    expect(await subject.createTransaction(draft(100))).toEqual({ kind: 'corrupt' });
    expect(await subject.removeTransaction('finance.x')).toEqual({ kind: 'corrupt' });

    expect(storage.raw.get(key)).toBe(stored);
    expect(storage.writes).toBe(0);
  });

  it('decodes a well-formed envelope', () => {
    expect(parseFinanceLedgerEnvelope({ version: 1, currency: null, transactions: [] })).toEqual({
      version: 1,
      currency: null,
      transactions: [],
    });
  });

  it('refuses duplicate ids', () => {
    const one = {
      id: 'finance.00000001-0000-4000-8000-000000000000',
      direction: 'expense',
      amountMinor: 100,
      occurredOn: '2026-08-27',
      category: null,
      note: null,
      createdAt: 'x',
      updatedAt: 'x',
    };
    expect(
      parseFinanceLedgerEnvelope({ version: 1, currency: 'AED', transactions: [one, one] }),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The day, read once
// ─────────────────────────────────────────────────────────────────────────────

describe('the date comes from the shared day source', () => {
  it('has no clock, timer or day derivation of its own', () => {
    for (const file of ['finance-money.ts', 'finance-ledger.ts', 'finance-ledger.repository.ts']) {
      const source = fs
        .readFileSync(path.join(process.cwd(), 'src/features/finance/data', file), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      /*
        The repository's one `new Date()` is the injectable default for record timestamps, and it is
        allowed. What must not exist is a second definition of *today* — a timer, an interval, or a
        `localDateKey` call that would let this layer disagree with the shared day source across
        midnight, which is issue #76's whole lesson.
      */
      expect(source).not.toMatch(/setInterval|setTimeout|localDateKey\(|plannerDayAt\(/);
      const clockReads = source.match(/new Date\(\)/g) ?? [];
      expect(clockReads.length).toBeLessThanOrEqual(1);
      if (clockReads.length === 1) {
        expect(source).toContain('deps.now ?? (() => new Date())');
      }
    }
  });

  it('stores the day it was handed, reading no clock to second-guess it', async () => {
    /*
      One read per operation, by construction: `occurredOn` arrives as a value. A repository that
      re-derived "today" could disagree with the caller across midnight — issue #76's whole lesson.
    */
    const storage = memory();
    const subject = repo(storage);
    await subject.setCurrency('AED');
    const created = await subject.createTransaction(draft(100, { occurredOn: '2026-08-21' }));
    expect(created.kind === 'ok' && created.ledger.transactions[0]?.occurredOn).toBe('2026-08-21');
  });

  it('refuses a malformed date', async () => {
    const storage = memory();
    const subject = repo(storage);
    await subject.setCurrency('AED');
    expect(await subject.createTransaction(draft(100, { occurredOn: '27/08/2026' }))).toEqual({
      kind: 'invalid',
      fault: 'invalid-date',
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Ownership
// ─────────────────────────────────────────────────────────────────────────────

describe('the provider owns the ledger', () => {
  function Probe() {
    const finance = useFinance();
    useEffect(() => {
      handle.current = finance;
    }, [finance]);
    return (
      <Text testID="probe">{`${finance.ledger.currency ?? 'none'}:${finance.ledger.transactions.length}:${finance.fault ?? 'ok'}`}</Text>
    );
  }
  const handle: { current: ReturnType<typeof useFinance> | null } = { current: null };

  it('publishes the account’s ledger to its consumers', async () => {
    const storage = memory();
    await repo(storage).setCurrency('AED');

    await render(
      <FinanceProvider repository={repo(storage)}>
        <Probe />
      </FinanceProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('probe').props.children).toBe('AED:0:ok');
  });

  it('reports a corrupt store as quarantined rather than empty', async () => {
    const storage = memory({
      [`noorlife.finance.user.v1.${OWNER}.ledger`]: '{"version":9}',
    });

    await render(
      <FinanceProvider repository={repo(storage)}>
        <Probe />
      </FinanceProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId('probe').props.children).toBe('none:0:corrupt-data');
  });

  it('drops the previous account’s ledger the instant the owner changes', async () => {
    const storage = memory();
    await repo(storage, OWNER).setCurrency('AED');

    const view = await render(
      <FinanceProvider repository={repo(storage, OWNER)}>
        <Probe />
      </FinanceProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('probe').props.children).toBe('AED:0:ok');

    await act(async () => {
      await view.rerender(
        <FinanceProvider repository={repo(storage, OTHER)}>
          <Probe />
        </FinanceProvider>,
      );
    });

    /* The other account's ledger, never a frame of the first one's. */
    expect(screen.getByTestId('probe').props.children).toBe('none:0:ok');
  });

  it('publishes nothing from a read that lands after the account changed', async () => {
    let release: (() => void) | null = null;
    const slow: FinanceStorage = {
      getItem: () =>
        new Promise((resolve) => {
          release = () => resolve(null);
        }),
      setItem: async () => undefined,
    };

    const view = await render(
      <FinanceProvider repository={repo(slow, OWNER)}>
        <Probe />
      </FinanceProvider>,
    );

    const fast = memory();
    await repo(fast, OTHER).setCurrency('GBP');
    await act(async () => {
      await view.rerender(
        <FinanceProvider repository={repo(fast, OTHER)}>
          <Probe />
        </FinanceProvider>,
      );
      await Promise.resolve();
    });

    /* The first account's read resolves now — into a session that is no longer its own. */
    await act(async () => {
      release?.();
      await Promise.resolve();
    });

    expect(screen.getByTestId('probe').props.children).toBe('GBP:0:ok');
  });

  it('publishes nothing from a mutation that resolves after the account changed', async () => {
    /*
      The guard the in-flight *read* case does not reach. A dependency change already tears the read
      effect down, so `active` alone catches a late read; a mutation has no such cleanup — it is a
      promise held by a closure, and only the repository-identity check stops its result landing in
      the next account's session.
    */
    const bytes = new Map<string, string>();
    let gate: (() => void) | null = null;
    const gated: FinanceStorage = {
      getItem: async (key) => {
        await Promise.resolve();
        return bytes.get(key) ?? null;
      },
      setItem: async (key, value) => {
        if (gate !== null) {
          await new Promise<void>((resolve) => {
            const open = gate;
            gate = () => {
              open?.();
              resolve();
            };
          });
        }
        bytes.set(key, value);
      },
    };

    const view = await render(
      <FinanceProvider repository={repo(gated, OWNER)}>
        <Probe />
      </FinanceProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });

    /* Arm the gate, then start a mutation on the first account that cannot settle. */
    gate = () => undefined;
    let pending: Promise<unknown> | undefined;
    await act(async () => {
      pending = handle.current?.setCurrency('GBP');
      await Promise.resolve();
    });

    const fast = memory();
    await repo(fast, OTHER).setCurrency('JPY');
    await act(async () => {
      await view.rerender(
        <FinanceProvider repository={repo(fast, OTHER)}>
          <Probe />
        </FinanceProvider>,
      );
      await Promise.resolve();
    });
    expect(screen.getByTestId('probe').props.children).toBe('JPY:0:ok');

    /* The first account's write settles now — into a session that is no longer its own. */
    await act(async () => {
      gate?.();
      gate = null;
      await pending?.catch(() => undefined);
      await Promise.resolve();
    });

    expect(screen.getByTestId('probe').props.children).toBe('JPY:0:ok');
  });

  it('throws outside the provider rather than inventing an empty ledger', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(render(<Probe />)).rejects.toThrow(/FinanceProvider/);
    spy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Where the provider is mounted, and what does not consume it
// ─────────────────────────────────────────────────────────────────────────────

describe('one owner, at the app boundary', () => {
  const appProviders = fs.readFileSync(
    path.join(process.cwd(), 'src/application/providers/app-providers.tsx'),
    'utf8',
  );

  it('is mounted exactly once, in `AppProviders`', () => {
    expect(appProviders.match(/<FinanceProvider>/g)).toHaveLength(1);
  });

  it('is mounted by no route', () => {
    const routes = fs
      .readdirSync(path.join(process.cwd(), 'src/app/finance'))
      .filter((name) => name.endsWith('.tsx'));
    expect(routes.length).toBeGreaterThan(0);
    for (const name of routes) {
      const source = fs.readFileSync(path.join(process.cwd(), 'src/app/finance', name), 'utf8');
      expect(source).not.toContain('FinanceProvider');
    }
  });

  it('is consumed only by Finance surfaces', () => {
    /*
      #92 asserted this store had no consumer at all, which was true of the foundation and is no
      longer true now that #93 built Spending. What must still hold is the boundary: only Finance's
      own screens read the ledger, and Main Home reaches it through the optional variant rather than
      importing a Finance screen.
    */
    const consumers: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.tsx') && !entry.name.endsWith('.ts')) continue;
        if (full.includes(`${path.sep}finance${path.sep}di${path.sep}`)) continue;
        const source = fs.readFileSync(full, 'utf8');
        if (source.includes('useFinance(') || source.includes('useOptionalFinance(')) {
          consumers.push(path.relative(process.cwd(), full).split(path.sep).join('/'));
        }
      }
    };
    walk(path.join(process.cwd(), 'src'));

    expect(consumers.sort()).toEqual([
      /*
        Writes budgets, and reads the ledger to derive spend against them — issue #94. It takes the
        same app-scoped owner rather than mounting a provider of its own, which is what keeps one
        answer to "whose money is this" across a screen that now reads two stores at once.
      */
      'src/features/finance/screens/finance-budgets-screen.tsx',
      /* Reads a summary; degrades to "nothing recorded" without an owner. */
      'src/features/finance/screens/finance-home-content.tsx',
      /*
        Writes, and only from an explicit confirmation — issue #101. Receipts is the second writing
        surface, and it reads the same app-scoped owner rather than mounting one of its own: a
        provider inside a screen shadows the app's, which is the #73 defect that made three surfaces
        disagree until relaunch. Its presence on this list is what shows it did not.
      */
      'src/features/finance/screens/finance-receipts-screen.tsx',
      /*
        Writes goals, and writes the ledger — issue #95. A contribution *is* a transaction, so this
        screen is a third writing surface on the same app-scoped owner: attribution lives on the
        transaction, which is what keeps adding a contribution one atomic write to one lane instead
        of two stores that could fall out of step.
      */
      'src/features/finance/screens/finance-savings-screen.tsx',
      /* Writes, so it requires the owner and throws without one. */
      'src/features/finance/screens/finance-spending-screen.tsx',
      /* Main Home's aggregate row — a count only, through the optional read. */
      'src/features/home/hooks/use-finance-timeline-entries.ts',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Privacy
// ─────────────────────────────────────────────────────────────────────────────

describe('no financial record leaves the device', () => {
  const financeFiles = (() => {
    const found: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === '__tests__') continue;
          walk(full);
          continue;
        }
        if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) found.push(full);
      }
    };
    walk(path.join(process.cwd(), 'src/features/finance'));
    return found;
  })();

  it('makes no network call and reaches no analytics or logger', () => {
    for (const file of financeFiles) {
      const source = fs
        .readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(source).not.toMatch(
        /fetch\(|axios|supabase|analytics|Sentry|track\(|console\.(log|info|warn|error)/,
      );
    }
  });

  it('is not reachable from the module AI screen', () => {
    const ai = fs
      .readFileSync(
        path.join(process.cwd(), 'src/features/modules/noor-ai/module-noor-ai-screen.tsx'),
        'utf8',
      )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(ai).not.toMatch(/useFinance|finance\/data|finance\/di|FinanceLedger/);
  });

  it('adds no sync, server or notification field to the schema', () => {
    /*
      Executable text only. The docblock *names* the fields it refuses to add, and prose explaining a
      rule must not be what a scan for the rule trips over.
    */
    const domain = fs
      .readFileSync(path.join(process.cwd(), 'src/features/finance/data/finance-ledger.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const invented of [
      'syncedAt',
      'remoteId',
      'serverId',
      'dirty',
      'deviceId',
      'uploadedAt',
    ]) {
      expect(domain).not.toContain(invented);
    }
  });
});
