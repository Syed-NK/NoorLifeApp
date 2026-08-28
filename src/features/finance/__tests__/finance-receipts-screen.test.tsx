import fs from 'node:fs';
import path from 'node:path';

import { Directory, File, Paths } from 'expo-file-system';

import { act, fireEvent, render } from '@testing-library/react-native';

import { pinModuleWindow } from '@/test-support/module-window';
import { installPlannerDaySource, type PlannerDayHarness } from '@/test-support/planner-day';

import {
  createFinanceLedgerRepository,
  type FinanceLedgerRepository,
  type FinanceStorage,
} from '../data/finance-ledger.repository';
import { FinanceProvider } from '../di/finance-provider';
import {
  receiptRetentionDirectory,
  receiptStagingDirectory,
} from '../receipts/receipt-image-store';
import type { ReceiptOcrOutcome, ReceiptOcrPort } from '../receipts/receipt-ocr.port';
import type { ReceiptAcquisition, ReceiptSourcePort } from '../receipts/receipt-source.port';
import { FinanceReceiptsScreen } from '../screens/finance-receipts-screen';

/**
 * **Receipts: nothing is recorded until the user says so** — issue #101.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Against the real repository, and real ports ────────────────────────────
 * The ledger under these renders is `createFinanceLedgerRepository` over in-memory storage, and the
 * image store is the real one over the in-memory filesystem double. Only the two *native* seams —
 * recognition and acquisition — are stated doubles, because they are the two things Jest genuinely
 * cannot run. A hand-written stand-in for the ledger or the file store would be a second
 * implementation of the rules these cases exist to protect.
 *
 * ── Counting writes, not observing them ────────────────────────────────────
 * Most cases here assert `ledger.transactions.length`, read from storage after the fact. "No write
 * happened" is a claim about the store, and the only honest way to make it is to look in the store —
 * a spy on the provider would prove that one function was not called, which is a weaker and more
 * easily satisfied statement.
 *
 * ── `fireEvent` inside `act`, and no `userEvent` ───────────────────────────
 * `installPlannerDaySource` replaces the global timer so "today" can be stated rather than waited
 * for, which is incompatible with anything that sleeps — `userEvent`'s inter-event delay and
 * `waitFor`'s polling both do. Wrapping each event in `act` is also what makes a press after a
 * `changeText` read current state rather than stale state.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = '3f6d2c18-9a4b-4c7e-8f21-5b7d0e9a1c42';
const OTHER = '7b1e4a90-2c3d-4e5f-9a08-1d2c3b4a5e6f';
const AT = new Date('2026-08-27T09:00:00.000Z');
const NOW = new Date(2026, 7, 27, 9, 0, 0);
const TODAY = '2026-08-27';

/** A file the app did not create, standing in for what a camera or a picker hands back. */
const SOURCE = 'file:///documents/DCIM/IMG_0042.jpg';

const SCREEN_FILE = path.join(
  process.cwd(),
  'src',
  'features',
  'finance',
  'screens',
  'finance-receipts-screen.tsx',
);

let ids = 0;
let harness: PlannerDayHarness | null = null;

function memory(seed?: Record<string, string>) {
  const rows = new Map<string, string>(Object.entries(seed ?? {}));
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
  return { rows, storage };
}

function repo(storage: FinanceStorage, ownerId: string = OWNER): FinanceLedgerRepository {
  return createFinanceLedgerRepository({
    ownerId,
    storage,
    id: () => `finance.aaaaaaaa-1111-4111-8111-${String(++ids).padStart(12, '0')}`,
    now: () => AT,
  });
}

/** The stated recogniser. Records every call so "was it called at all" is answerable. */
function ocrThat(outcome: ReceiptOcrOutcome | (() => Promise<ReceiptOcrOutcome>)) {
  const calls: string[] = [];
  const port: ReceiptOcrPort = {
    recognise: async ({ uri }) => {
      calls.push(uri);
      return typeof outcome === 'function' ? await outcome() : outcome;
    },
  };
  return { port, calls };
}

/** The stated camera and library. Records which permission was asked for, and when. */
function sourceThat(...results: ReceiptAcquisition[]) {
  const asked: ('camera' | 'library')[] = [];
  let index = 0;
  const port: ReceiptSourcePort = {
    acquire: async (kind) => {
      asked.push(kind);
      const result = results[Math.min(index, results.length - 1)];
      index += 1;
      await Promise.resolve();
      return result ?? { kind: 'failed' };
    },
  };
  return { port, asked };
}

const ACQUIRED: ReceiptAcquisition = { kind: 'acquired', uri: SOURCE };
const READ: ReceiptOcrOutcome = {
  kind: 'recognised',
  lines: ['MARKET STREET', 'BREAD 3.50', 'TOTAL 8.14', 'DATE 2026-08-20'],
};

type View = Awaited<ReturnType<typeof render>>;

/**
 * The view the current case is driving.
 *
 * Deliberately not the library's global `screen`. Several cases here unmount on purpose — an
 * abandoned draft is one of the states under test — and an explicit unmount clears the global
 * render result, after which every later case in the file queries a screen that no longer exists and
 * fails for a reason that has nothing to do with what it was asserting. Holding the view each mount
 * returned keeps one case's teardown out of the next one's way.
 */
let view: View | null = null;

function ui(): View {
  if (view === null) {
    throw new Error('No Receipts screen is mounted.');
  }
  return view;
}

async function settle(): Promise<void> {
  await act(async () => {
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
    await Promise.resolve();
  });
}

async function type(testID: string, value: string): Promise<void> {
  await act(async () => {
    fireEvent.changeText(ui().getByTestId(testID), value);
    await Promise.resolve();
  });
}

type Mounted = {
  readonly storage: FinanceStorage;
  readonly ledger: () => Promise<{ readonly count: number; readonly rows: readonly unknown[] }>;
};

async function mount(options: {
  readonly ocr: ReceiptOcrPort;
  readonly source: ReceiptSourcePort;
  readonly currency?: string | null;
  readonly ownerId?: string;
  readonly seed?: Record<string, string>;
}) {
  const { storage } = memory(options.seed);
  /*
    The owner travels with the repository, not as a screen prop. That is the production wiring: the
    account a receipt image is kept for is read from the same object that decides which address the
    transaction is written to, so a test cannot accidentally prove a partitioning the app does not
    have.
  */
  const repository = repo(storage, options.ownerId ?? OWNER);
  if (options.currency !== null) {
    await repository.setCurrency(options.currency ?? 'AED');
  }
  view = await render(
    <FinanceProvider repository={repository}>
      <FinanceReceiptsScreen ocr={options.ocr} source={options.source} />
    </FinanceProvider>,
  );
  await settle();

  const mounted: Mounted = {
    storage,
    ledger: async () => {
      const result = await repo(storage).read();
      const rows = result.kind === 'ok' ? result.ledger.transactions : [];
      return { count: rows.length, rows };
    },
  };
  return { ...mounted };
}

/** Capture, recognise and land on the review form. The state most cases start from. */
async function capture(options?: { readonly ocr?: ReceiptOcrPort; readonly ownerId?: string }) {
  const acquisition = sourceThat(ACQUIRED);
  const recogniser = options?.ocr ?? ocrThat(READ).port;
  const mounted = await mount({
    ocr: recogniser,
    source: acquisition.port,
    ...(options?.ownerId === undefined ? {} : { ownerId: options.ownerId }),
  });
  await press(ui().getByTestId('finance-receipts-capture'));
  await settle();
  return { ...mounted, asked: acquisition.asked };
}

function stagedFiles(): readonly string[] {
  const directory = receiptStagingDirectory();
  return directory.exists ? directory.list().map((entry) => entry.uri) : [];
}

function keptFiles(ownerId: string = OWNER): readonly string[] {
  const directory = receiptRetentionDirectory(ownerId);
  return directory !== null && directory.exists ? directory.list().map((entry) => entry.uri) : [];
}

beforeEach(() => {
  ids = 0;
  view = null;
  pinModuleWindow();
  harness = installPlannerDaySource(NOW);
  new Directory(Paths.cache).delete();
  new Directory(Paths.document).delete();
  new File(SOURCE).write('jpeg-bytes');
});

afterEach(() => {
  harness?.restore();
  harness = null;
});

// ─────────────────────────────────────────────────────────────────────────────
// Permissions are asked for at the press, and never before
// ─────────────────────────────────────────────────────────────────────────────

describe('permission timing', () => {
  it('asks for nothing on mount', async () => {
    const acquisition = sourceThat(ACQUIRED);
    const recogniser = ocrThat(READ);

    await mount({ ocr: recogniser.port, source: acquisition.port });

    /*
      #90 removed Finance's registry claim that it wanted photo access, on the grounds that it asked
      for nothing. Entering the Receipts screen must not quietly make that claim true again.
    */
    expect(acquisition.asked).toEqual([]);
    expect(recogniser.calls).toEqual([]);
  });

  it('asks for the camera only after Capture', async () => {
    const acquisition = sourceThat(ACQUIRED);
    await mount({ ocr: ocrThat(READ).port, source: acquisition.port });

    await press(ui().getByTestId('finance-receipts-capture'));

    expect(acquisition.asked).toEqual(['camera']);
  });

  it('asks for the photo library only after Import', async () => {
    const acquisition = sourceThat(ACQUIRED);
    await mount({ ocr: ocrThat(READ).port, source: acquisition.port });

    await press(ui().getByTestId('finance-receipts-import'));

    expect(acquisition.asked).toEqual(['library']);
  });

  it('never asks for the camera when the user only imports', async () => {
    const acquisition = sourceThat(ACQUIRED);
    await mount({ ocr: ocrThat(READ).port, source: acquisition.port });

    await press(ui().getByTestId('finance-receipts-import'));
    await settle();

    expect(acquisition.asked).not.toContain('camera');
  });

  it('leaves a usable screen with a retry when access is refused but can be asked again', async () => {
    const acquisition = sourceThat({ kind: 'denied', retryable: true }, ACQUIRED);
    await mount({ ocr: ocrThat(READ).port, source: acquisition.port });

    await press(ui().getByTestId('finance-receipts-capture'));

    expect(ui().getByTestId('finance-receipts-denied-camera')).toBeTruthy();
    /* Manual entry stays reachable: a declined permission is never the end of the road. */
    expect(ui().getByTestId('finance-receipts-manual')).toBeTruthy();

    await press(ui().getByTestId('finance-receipts-retry-camera'));
    await settle();

    expect(acquisition.asked).toEqual(['camera', 'camera']);
    expect(ui().getByTestId('finance-receipts-preview')).toBeTruthy();
  });

  it('offers no retry once the platform will not ask again', async () => {
    const acquisition = sourceThat({ kind: 'denied', retryable: false });
    await mount({ ocr: ocrThat(READ).port, source: acquisition.port });

    await press(ui().getByTestId('finance-receipts-import'));

    /*
      A "Try again" that provably cannot produce a prompt is a button that does nothing. The card
      says so and points at Settings instead.
    */
    expect(ui().queryByTestId('finance-receipts-retry-library')).toBeNull();
    expect(ui().getByTestId('finance-receipts-denied-library')).toBeTruthy();
  });

  it('records nothing when acquisition is refused, cancelled or fails', async () => {
    for (const outcome of [
      { kind: 'denied', retryable: true } as const,
      { kind: 'cancelled' } as const,
      { kind: 'failed' } as const,
    ]) {
      const mounted = await mount({ ocr: ocrThat(READ).port, source: sourceThat(outcome).port });

      await press(ui().getByTestId('finance-receipts-capture'));
      await settle();

      expect((await mounted.ledger()).count).toBe(0);
      await act(async () => {
        ui().unmount();
        await Promise.resolve();
      });
      view = null;
    }
  });

  it('does not recognise anything before an image exists', async () => {
    const recogniser = ocrThat(READ);
    await mount({ ocr: recogniser.port, source: sourceThat({ kind: 'cancelled' }).port });

    await press(ui().getByTestId('finance-receipts-capture'));
    await settle();

    expect(recogniser.calls).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Recognition runs against the app's own copy
// ─────────────────────────────────────────────────────────────────────────────

describe('recognition', () => {
  it('is given the staged copy, never the acquired uri', async () => {
    const recogniser = ocrThat(READ);
    await capture({ ocr: recogniser.port });

    expect(recogniser.calls).toHaveLength(1);
    expect(recogniser.calls[0]).not.toBe(SOURCE);
    expect(recogniser.calls[0]?.startsWith(`${receiptStagingDirectory().uri}/`)).toBe(true);
  });

  it('fills the fields with suggestions and records nothing', async () => {
    const mounted = await capture();

    expect(ui().getByTestId('finance-receipts-amount').props.value).toBe('8.14');
    expect(ui().getByTestId('finance-receipts-date').props.value).toBe('2026-08-20');
    /* Suggested, not recorded. The whole point of the screen. */
    expect((await mounted.ledger()).count).toBe(0);
  });

  it('offers every amount it read, and lets one be chosen', async () => {
    await capture();

    await press(ui().getByTestId('finance-receipts-candidate-350'));

    expect(ui().getByTestId('finance-receipts-amount').props.value).toBe('3.50');
  });

  it('says so, and records nothing, when nothing could be read', async () => {
    const mounted = await capture({ ocr: ocrThat({ kind: 'empty' }).port });

    expect(ui().getByTestId('finance-receipts-status-nothing')).toBeTruthy();
    expect(ui().getByTestId('finance-receipts-amount').props.value).toBe('');
    expect((await mounted.ledger()).count).toBe(0);
  });

  it('says so, and records nothing, when recognition failed', async () => {
    const mounted = await capture({
      ocr: ocrThat({ kind: 'failed', reason: 'unreadable' }).port,
    });

    expect(ui().getByTestId('finance-receipts-status-failed')).toBeTruthy();
    expect((await mounted.ledger()).count).toBe(0);
    /* The fields are still there: a failed reading leaves a usable manual form. */
    expect(ui().getByTestId('finance-receipts-amount')).toBeTruthy();
  });

  it('falls back to today and says the receipt did not establish the date', async () => {
    await capture({
      ocr: ocrThat({ kind: 'recognised', lines: ['TOTAL 8.14'] }).port,
    });

    expect(ui().getByTestId('finance-receipts-date').props.value).toBe(TODAY);
    expect(ui().getByTestId('finance-receipts-date-unread')).toBeTruthy();
  });

  it('withdraws a reading when the image is replaced, and cleans only its own copy', async () => {
    const acquisition = sourceThat(ACQUIRED, { kind: 'acquired', uri: SOURCE });
    const recogniser = ocrThat(READ);
    await mount({ ocr: recogniser.port, source: acquisition.port });

    await press(ui().getByTestId('finance-receipts-capture'));
    await settle();
    const first = stagedFiles();

    await press(ui().getByTestId('finance-receipts-import'));
    await settle();
    const second = stagedFiles();

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second[0]).not.toBe(first[0]);
    /* The user's own photograph is untouched by any of it. */
    expect(new File(SOURCE).exists).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The confirmation boundary
// ─────────────────────────────────────────────────────────────────────────────

describe('nothing reaches the ledger before confirmation', () => {
  it('writes nothing on mount', async () => {
    const mounted = await mount({ ocr: ocrThat(READ).port, source: sourceThat(ACQUIRED).port });

    expect((await mounted.ledger()).count).toBe(0);
  });

  it('writes nothing after an image is chosen and read', async () => {
    const mounted = await capture();

    expect((await mounted.ledger()).count).toBe(0);
  });

  it('writes nothing when a suggestion is accepted into a field', async () => {
    const mounted = await capture();

    await press(ui().getByTestId('finance-receipts-candidate-814'));
    await type('finance-receipts-category', 'Groceries');
    await settle();

    expect((await mounted.ledger()).count).toBe(0);
  });

  it('writes nothing when the draft is cancelled', async () => {
    const mounted = await capture();

    await press(ui().getByTestId('finance-receipts-cancel'));
    await settle();

    expect((await mounted.ledger()).count).toBe(0);
    expect(stagedFiles()).toEqual([]);
    expect(ui().queryByTestId('finance-receipts-preview')).toBeNull();
  });

  it('writes nothing when the screen is unmounted mid-draft, and leaves no file', async () => {
    const mounted = await capture();

    await act(async () => {
      ui().unmount();
      await Promise.resolve();
    });
    view = null;
    await settle();

    expect((await mounted.ledger()).count).toBe(0);
    expect(stagedFiles()).toEqual([]);
  });

  it('creates exactly one transaction on confirmation', async () => {
    const mounted = await capture();

    await press(ui().getByTestId('finance-receipts-confirm'));
    await settle();

    const { count, rows } = await mounted.ledger();
    expect(count).toBe(1);
    expect(rows[0]).toMatchObject({
      direction: 'expense',
      amountMinor: 814,
      occurredOn: '2026-08-20',
      category: null,
      note: null,
    });
  });

  it('creates exactly one transaction for a real double press', async () => {
    const mounted = await capture();
    const button = ui().getByTestId('finance-receipts-confirm');

    /*
      Both presses inside one `act`, which is what a real double tap is. A guard held in React state
      would let the second through — the second handler closes over the same `saving === false` — and
      the ledger would hold two records of one receipt. Only a ref is written between them.
    */
    await act(async () => {
      fireEvent.press(button);
      fireEvent.press(button);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    await settle();

    expect((await mounted.ledger()).count).toBe(1);
  });

  it('records what the user corrected, not what the receipt said', async () => {
    const mounted = await capture();

    await type('finance-receipts-amount', '9.99');
    await type('finance-receipts-date', '2026-08-25');
    await type('finance-receipts-category', 'Groceries');
    await press(ui().getByTestId('finance-receipts-direction-income'));
    await press(ui().getByTestId('finance-receipts-confirm'));
    await settle();

    expect((await mounted.ledger()).rows[0]).toMatchObject({
      direction: 'income',
      amountMinor: 999,
      occurredOn: '2026-08-25',
      category: 'Groceries',
    });
  });

  it('never writes recognised text into the ledger by itself', async () => {
    const mounted = await capture();

    await press(ui().getByTestId('finance-receipts-confirm'));
    await settle();

    const stored = JSON.stringify((await mounted.ledger()).rows);
    expect(stored).not.toContain('MARKET STREET');
    expect(stored).not.toContain('BREAD');
  });

  it('writes recognised text only when the user explicitly asks for it as a note', async () => {
    const mounted = await capture();

    await press(ui().getByTestId('finance-receipts-note-from-text'));
    await press(ui().getByTestId('finance-receipts-confirm'));
    await settle();

    expect((await mounted.ledger()).rows[0]).toMatchObject({ note: 'MARKET STREET' });
  });

  it('adds no field the ledger does not have', async () => {
    const mounted = await capture();

    await press(ui().getByTestId('finance-receipts-confirm'));
    await settle();

    /*
      The #92 envelope, exactly. A receipt exposes a merchant, a tax number and an image path, and
      none of them belongs in a transaction — widening the envelope is a migration, not a
      convenience, and a stored record carrying an unknown key would fail that decoder outright.

      `goalId` is on this list because #95 put it there deliberately, and Receipts writes it as
      `null`: a receipt is a purchase, not a contribution to somebody's savings. Its presence here
      is the guard, not a concession — if a receipt ever started attributing money to a goal, this
      assertion is where it would show up.
    */
    expect(Object.keys((await mounted.ledger()).rows[0] as object).sort()).toEqual([
      'amountMinor',
      'category',
      'createdAt',
      'direction',
      'goalId',
      'id',
      'note',
      'occurredOn',
      'updatedAt',
    ]);
    expect((await mounted.ledger()).rows[0]).toMatchObject({ goalId: null });
  });

  it('refuses an amount the ledger cannot hold, and records nothing', async () => {
    const mounted = await capture();

    await type('finance-receipts-amount', '12.345');
    await press(ui().getByTestId('finance-receipts-confirm'));
    await settle();

    expect((await mounted.ledger()).count).toBe(0);
    expect(ui().getByTestId('finance-receipts-message')).toBeTruthy();
  });

  it('has exactly one call to the ledger mutation in the whole file', () => {
    const source = fs
      .readFileSync(SCREEN_FILE, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    /*
      Asserted from the source as well as from the behaviour. "Only confirmation writes" is a claim
      about every path through the file, and the behavioural cases can only cover the paths somebody
      thought of.
    */
    expect(source.match(/createTransaction\s*\(/g) ?? []).toHaveLength(1);
    expect(source).not.toMatch(/updateTransaction|removeTransaction|setCurrency\s*\(/);
  });
});

describe('a ledger that will not accept the write', () => {
  it('fails closed on quarantined records and offers no composer at all', async () => {
    const address = `noorlife.finance.user.v1.${OWNER}.ledger`;
    const mounted = await mount({
      ocr: ocrThat(READ).port,
      source: sourceThat(ACQUIRED).port,
      currency: null,
      seed: { [address]: '{"version":1,"currency":"AED","transactions":[{"bad":true}]}' },
    });

    expect(ui().getByTestId('finance-receipts-corrupt')).toBeTruthy();
    expect(ui().queryByTestId('finance-receipts-capture')).toBeNull();
    /* And the stored bytes are still exactly what they were. */
    expect(await mounted.storage.getItem(address)).toBe(
      '{"version":1,"currency":"AED","transactions":[{"bad":true}]}',
    );
  });

  it('reports a refused write and leaves the ledger empty', async () => {
    const acquisition = sourceThat(ACQUIRED);
    const { rows } = memory();
    /*
      The same store throughout, with a switch in it. Substituting a second, failing repository after
      the render would prove nothing — the screen would still be holding the working one, and the
      write under test would succeed against a store nobody was looking at. What has to fail is the
      store the screen is actually using, and it has to start failing *after* the reading, which is
      the instant a device runs out of space between a photograph and a confirmation.
    */
    let refusing = false;
    const storage: FinanceStorage = {
      getItem: async (key) => {
        await Promise.resolve();
        return rows.get(key) ?? null;
      },
      setItem: async (key, value) => {
        await Promise.resolve();
        if (refusing) {
          throw new Error('ENOSPC');
        }
        rows.set(key, value);
      },
    };
    const repository = repo(storage);
    await repository.setCurrency('AED');
    view = await render(
      <FinanceProvider repository={repository}>
        <FinanceReceiptsScreen ocr={ocrThat(READ).port} source={acquisition.port} />
      </FinanceProvider>,
    );
    await settle();
    await press(ui().getByTestId('finance-receipts-capture'));
    await settle();

    refusing = true;
    await press(ui().getByTestId('finance-receipts-confirm'));
    await settle();

    const result = await repo(storage).read();
    expect(result.kind === 'ok' ? result.ledger.transactions : []).toHaveLength(0);
    /*
      A store that refuses a write is a *module* fault, not a field-level message, and #92's provider
      raises it as one — so the screen shows the same storage-unavailable state Spending shows, with
      a retry, rather than a banner over a draft whose confirmation cannot work. Losing the draft is
      the honest outcome: the alternative is a form that looks ready and has nowhere to save to.
    */
    expect(ui().getByTestId('finance-receipts-unavailable')).toBeTruthy();
    expect(ui().queryByTestId('finance-receipts-confirm')).toBeNull();
  });

  it('still has the photograph after a refused write, so nothing is lost', async () => {
    const acquisition = sourceThat(ACQUIRED);
    const { rows } = memory();
    let refusing = false;
    const storage: FinanceStorage = {
      getItem: async (key) => {
        await Promise.resolve();
        return rows.get(key) ?? null;
      },
      setItem: async (key, value) => {
        await Promise.resolve();
        if (refusing) {
          throw new Error('ENOSPC');
        }
        rows.set(key, value);
      },
    };
    const repository = repo(storage);
    await repository.setCurrency('AED');
    view = await render(
      <FinanceProvider repository={repository}>
        <FinanceReceiptsScreen ocr={ocrThat(READ).port} source={acquisition.port} />
      </FinanceProvider>,
    );
    await settle();
    await press(ui().getByTestId('finance-receipts-capture'));
    await settle();

    refusing = true;
    await press(ui().getByTestId('finance-receipts-confirm'));
    await settle();

    /*
      The *ordering* of the two operations, asserted where it can be seen. Cleanup that ran before
      the write would delete the photograph and then fail to record anything — the user would be left
      with neither, having done nothing wrong. Deleting only after a confirmed success is what makes
      a refused write cost nothing but the attempt.
    */
    expect(stagedFiles()).toHaveLength(1);
  });

  it('keeps no image when the write it was kept for was refused', async () => {
    const acquisition = sourceThat(ACQUIRED);
    const { rows } = memory();
    let refusing = false;
    const storage: FinanceStorage = {
      getItem: async (key) => {
        await Promise.resolve();
        return rows.get(key) ?? null;
      },
      setItem: async (key, value) => {
        await Promise.resolve();
        if (refusing) {
          throw new Error('ENOSPC');
        }
        rows.set(key, value);
      },
    };
    const repository = repo(storage);
    await repository.setCurrency('AED');
    view = await render(
      <FinanceProvider repository={repository}>
        <FinanceReceiptsScreen ocr={ocrThat(READ).port} source={acquisition.port} />
      </FinanceProvider>,
    );
    await settle();
    await press(ui().getByTestId('finance-receipts-capture'));
    await settle();
    await press(ui().getByTestId('finance-receipts-retain'));

    refusing = true;
    await press(ui().getByTestId('finance-receipts-confirm'));
    await settle();

    /*
      The one state that must never exist: a kept image with no record of why it was kept. Retention
      happens just before the write so that a failure to keep reports *instead of* a transaction; a
      write that then fails has to undo the keeping in the same breath.
    */
    expect(keptFiles()).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Currency
// ─────────────────────────────────────────────────────────────────────────────

describe('currency', () => {
  it('sends the user to the existing setup when the ledger has none', async () => {
    const acquisition = sourceThat(ACQUIRED);
    await mount({ ocr: ocrThat(READ).port, source: acquisition.port, currency: null });

    /*
      No second picker. There is one currency setup in this app and it belongs to Spending, with the
      rule about when it may be changed — a copy here would be a second place for that rule to drift.
    */
    expect(ui().getByTestId('finance-receipts-no-currency')).toBeTruthy();
    expect(ui().queryByTestId('finance-receipts-capture')).toBeNull();
    expect(acquisition.asked).toEqual([]);
  });

  it('states a mismatch and withholds confirmation until it is resolved', async () => {
    const mounted = await capture({
      ocr: ocrThat({ kind: 'recognised', lines: ['TOTAL 12.34 USD'] }).port,
    });

    expect(ui().getByTestId('finance-receipts-mismatch')).toBeTruthy();
    expect(ui().getByTestId('finance-receipts-confirm').props.accessibilityState.disabled).toBe(
      true,
    );

    await press(ui().getByTestId('finance-receipts-confirm'));
    await settle();
    expect((await mounted.ledger()).count).toBe(0);

    await press(ui().getByTestId('finance-receipts-mismatch-accept'));
    await press(ui().getByTestId('finance-receipts-confirm'));
    await settle();

    /* Recorded in the ledger's own currency, with the digits the user left in the field. */
    expect((await mounted.ledger()).rows[0]).toMatchObject({ amountMinor: 1234 });
  });

  it('converts nothing: the resolved amount is exactly what was in the field', async () => {
    const mounted = await capture({
      ocr: ocrThat({ kind: 'recognised', lines: ['TOTAL 12.34 USD'] }).port,
    });

    await press(ui().getByTestId('finance-receipts-mismatch-accept'));
    await type('finance-receipts-amount', '45.30');
    await press(ui().getByTestId('finance-receipts-confirm'));
    await settle();

    expect((await mounted.ledger()).rows[0]).toMatchObject({ amountMinor: 4530 });
  });

  it('does not block manual entry when the receipt names no currency', async () => {
    const mounted = await capture({
      ocr: ocrThat({ kind: 'recognised', lines: ['TOTAL 12.34'] }).port,
    });

    expect(ui().queryByTestId('finance-receipts-mismatch')).toBeNull();

    await press(ui().getByTestId('finance-receipts-confirm'));
    await settle();

    expect((await mounted.ledger()).count).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Retention
// ─────────────────────────────────────────────────────────────────────────────

describe('the receipt image is not kept unless asked for', () => {
  it('defaults to off, and deletes the copy once the transaction is recorded', async () => {
    const mounted = await capture();

    await press(ui().getByTestId('finance-receipts-confirm'));
    await settle();

    expect((await mounted.ledger()).count).toBe(1);
    expect(stagedFiles()).toEqual([]);
    expect(keptFiles()).toEqual([]);
    /* And the user's own photograph is where it always was. */
    expect(new File(SOURCE).exists).toBe(true);
  });

  it('keeps a copy in the account directory when asked, and clears the temporary one', async () => {
    const mounted = await capture();

    await press(ui().getByTestId('finance-receipts-retain'));
    await press(ui().getByTestId('finance-receipts-confirm'));
    await settle();

    expect((await mounted.ledger()).count).toBe(1);
    expect(keptFiles()).toHaveLength(1);
    expect(stagedFiles()).toEqual([]);
  });

  it('records no path to the kept image in the transaction', async () => {
    const mounted = await capture();

    await press(ui().getByTestId('finance-receipts-retain'));
    await press(ui().getByTestId('finance-receipts-confirm'));
    await settle();

    /*
      Deliberately no durable link. #92's envelope has no field for it and adding one is a schema
      migration whose consequences — an old build reading a new record, a decoder that refuses
      unknown keys — belong to a decision nobody has made yet.
    */
    expect(JSON.stringify((await mounted.ledger()).rows)).not.toContain('finance-receipts');
  });

  it('keeps nothing for a draft that was never confirmed, whatever the toggle said', async () => {
    await capture();

    await press(ui().getByTestId('finance-receipts-retain'));
    await press(ui().getByTestId('finance-receipts-cancel'));
    await settle();

    /*
      Retention is carried out by *recording the transaction*, not by pressing the toggle — the toggle
      is a statement of intent about a transaction that does not exist yet. So an abandoned draft has
      nothing kept to remove, which is a stronger property than remembering to remove it: there is no
      window, however short, in which a kept image exists without a record of why.
    */
    expect(keptFiles()).toEqual([]);
    expect(stagedFiles()).toEqual([]);
  });

  it('keeps nothing when the toggle is on and the screen is simply left', async () => {
    await capture();

    await press(ui().getByTestId('finance-receipts-retain'));
    await act(async () => {
      ui().unmount();
      await Promise.resolve();
    });
    view = null;

    expect(keptFiles()).toEqual([]);
    expect(stagedFiles()).toEqual([]);
  });

  it('offers no workflow at all when there is no account', async () => {
    const { storage } = memory();
    view = await render(
      <FinanceProvider repository={createFinanceLedgerRepository({ ownerId: null, storage })}>
        <FinanceReceiptsScreen ocr={ocrThat(READ).port} source={sourceThat(ACQUIRED).port} />
      </FinanceProvider>,
    );
    await settle();

    /*
      Stronger than "retention refuses without an owner", and the reason the owner is taken from the
      repository rather than resolved separately: with no account there is no ledger address, so the
      store reports unavailable and there is no Capture button, no draft and no confirmation to
      reach. The signed-out case cannot produce a kept file because it cannot produce a workflow.

      The retention function's own refusal is still asserted directly, in the image-store suite —
      this is the path, that is the guard.
    */
    expect(ui().getByTestId('finance-receipts-unavailable')).toBeTruthy();
    expect(ui().queryByTestId('finance-receipts-capture')).toBeNull();
    expect(keptFiles()).toEqual([]);
    expect(keptFiles(OTHER)).toEqual([]);
  });

  it("puts one account's kept receipt nowhere another account can see it", async () => {
    await capture();

    await press(ui().getByTestId('finance-receipts-retain'));
    await press(ui().getByTestId('finance-receipts-confirm'));
    await settle();

    expect(keptFiles(OWNER)).toHaveLength(1);
    expect(keptFiles(OTHER)).toEqual([]);
    expect(keptFiles(OWNER)[0]).not.toContain(OTHER);
  });
});

describe('cleanup cannot affect the record', () => {
  it('keeps exactly one transaction when the temporary file has already gone', async () => {
    const mounted = await capture();

    /* The OS reclaimed the cache between the reading and the confirmation. */
    for (const uri of stagedFiles()) {
      new File(uri).delete();
    }

    await press(ui().getByTestId('finance-receipts-confirm'));
    await settle();

    expect((await mounted.ledger()).count).toBe(1);
  });

  it('keeps exactly one transaction when the file cannot be removed at all', async () => {
    const mounted = await capture();
    const staged = stagedFiles()[0] ?? '';
    const original = File.prototype.delete;
    File.prototype.delete = function throwing(): void {
      throw new Error('EBUSY');
    };

    try {
      await press(ui().getByTestId('finance-receipts-confirm'));
      await settle();
    } finally {
      File.prototype.delete = original;
    }

    /*
      One transaction, and the user told plainly that the temporary copy is still there. A cleanup
      failure is an inconvenience; a transaction lost or duplicated because of one would be a defect
      in somebody's money.
    */
    expect((await mounted.ledger()).count).toBe(1);
    expect(new File(staged).exists).toBe(true);
    expect(ui().getByTestId('finance-receipts-message')).toBeTruthy();
  });
});
