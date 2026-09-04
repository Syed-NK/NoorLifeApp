import { act, render, waitFor } from '@testing-library/react-native';
import { Directory, File, Paths } from 'expo-file-system';
import { Text } from 'react-native';

import {
  createFinanceTransaction,
  isFinanceTransaction,
  reviseFinanceTransaction,
  validateFinanceDraft,
  type FinanceDraft,
  type FinanceTransaction,
} from '../data/finance-ledger';
import {
  createFinanceLedgerRepository,
  financeLedgerAddress,
  type FinanceStorage,
} from '../data/finance-ledger.repository';
import { FinanceProvider, useFinance } from '../di/finance-provider';
import { receiptRetentionDirectory } from '../receipts/receipt-image-store';

/**
 * **A kept receipt image belongs to the transaction it was kept for** — issue #101.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What was wrong, and why it was not visible ─────────────────────────────
 * Retention worked and the image landed in the right account's directory. Nothing recorded *which
 * transaction it belonged to*, so a kept receipt was an orphan the moment it was written: a random
 * filename that no screen could show, no deletion could reach, and nothing could ever remove. The
 * files simply accumulated, and receipts are among the most sensitive things this app holds.
 *
 * #101's retention contract is one sentence — "deleting the transaction deletes the image" — and it
 * is unimplementable without a reference. This suite is that reference and its consequences.
 *
 * ── The three things that have to stay true ────────────────────────────────
 *   • the attachment is a path this app could have written, and nothing else;
 *   • it changes no accounting figure, ever;
 *   • deleting the transaction deletes the image, and touches nothing else on disk.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = '3f6d2c18-9a4b-4c7e-8f21-5b7d0e9a1c42';
const OTHER = '7b1e4a90-2c3d-4e5f-9a08-1d2c3b4a5e6f';

const ID = 'finance.11111111-2222-4333-8444-555555555555';
const AT = new Date('2026-09-04T10:00:00.000Z');

function keptUri(owner: string, name = 'a'.repeat(32) + '.jpg'): string {
  const directory = receiptRetentionDirectory(owner);
  if (directory === null) {
    throw new Error('the fixture owner must resolve to a retention directory');
  }
  return `${directory.uri}/${name}`;
}

function draft(over: Partial<FinanceDraft> = {}): FinanceDraft {
  return {
    direction: 'expense',
    amountMinor: 1250,
    occurredOn: '2026-09-04',
    category: 'Groceries',
    note: null,
    ...over,
  };
}

function seedFile(uri: string, owner: string = OWNER): void {
  receiptRetentionDirectory(owner)?.create({ intermediates: true, idempotent: true });
  new File(uri).write('jpeg-bytes');
}

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

beforeEach(() => {
  new Directory(Paths.cache).delete();
  new Directory(Paths.document).delete();
});

// ─────────────────────────────────────────────────────────────────────────────
// The shape the ledger will accept
// ─────────────────────────────────────────────────────────────────────────────

describe('the attachment is a path this app could have written', () => {
  it('accepts a retained image under an account directory', () => {
    const result = validateFinanceDraft(draft({ receiptUri: keptUri(OWNER) }));
    expect(result.kind).toBe('valid');
  });

  it('accepts no attachment at all, which is the ordinary transaction', () => {
    expect(validateFinanceDraft(draft()).kind).toBe('valid');
    expect(validateFinanceDraft(draft({ receiptUri: null })).kind).toBe('valid');
  });

  it.each([
    ['a remote URL', 'https://elsewhere.example/receipt.jpg'],
    ['a bare path', '/documents/finance-receipts/kept/x/a.jpg'],
    ['traversal', 'file:///documents/finance-receipts/kept/../../etc/passwd'],
    ['a single-dot segment', 'file:///documents/./finance-receipts/kept/a.jpg'],
    ['a query fragment', 'file:///documents/a.jpg?x=1'],
    ['a hash', 'file:///documents/a.jpg#frag'],
    ['a newline', 'file:///documents/a\n.jpg'],
    ['a backslash', 'file:///documents\\a.jpg'],
    ['an empty string', ''],
  ])('refuses %s', (_label, value) => {
    /*
      Refused, not dropped. Storing the transaction and silently discarding the attachment would
      strand the image the user asked to keep — the orphan this field exists to prevent.
    */
    const result = validateFinanceDraft(draft({ receiptUri: value }));
    expect(result).toEqual({ kind: 'invalid', fault: 'invalid-receipt' });
  });

  it('refuses an unbounded path', () => {
    const long = `file:///${'a'.repeat(600)}.jpg`;
    expect(validateFinanceDraft(draft({ receiptUri: long }))).toEqual({
      kind: 'invalid',
      fault: 'invalid-receipt',
    });
  });

  it('quarantines a stored record whose attachment is malformed', () => {
    const sound = createFinanceTransaction(
      {
        direction: 'expense',
        amountMinor: 100,
        occurredOn: '2026-09-04',
        category: null,
        note: null,
      },
      ID,
      AT,
    );
    expect(isFinanceTransaction(sound)).toBe(true);
    expect(isFinanceTransaction({ ...sound, receiptUri: '../../secrets' })).toBe(false);
    /* Absent and null are both the pre-Receipts record, and both still decode. */
    const { receiptUri: _dropped, ...withoutKey } = sound;
    expect(isFinanceTransaction(withoutKey)).toBe(true);
    expect(isFinanceTransaction({ ...sound, receiptUri: null })).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// It is not an accounting input
// ─────────────────────────────────────────────────────────────────────────────

describe('attaching a receipt changes no figure', () => {
  it('produces a transaction identical but for the attachment', () => {
    const plain = createFinanceTransaction(
      {
        direction: 'expense',
        amountMinor: 1250,
        occurredOn: '2026-09-04',
        category: 'Groceries',
        note: null,
      },
      ID,
      AT,
    );
    const attached = createFinanceTransaction(
      {
        direction: 'expense',
        amountMinor: 1250,
        occurredOn: '2026-09-04',
        category: 'Groceries',
        note: null,
        receiptUri: keptUri(OWNER),
      },
      ID,
      AT,
    );

    /*
      Every field that any total, budget, goal or refund effect reads is compared. If attaching an
      image ever moved one of them, this is where it would show — which is the whole reason the
      comparison is field-by-field rather than a snapshot.
    */
    const accounting = ({
      direction,
      amountMinor,
      occurredOn,
      category,
      note,
      goalId,
      kind,
    }: FinanceTransaction) => ({
      direction,
      amountMinor,
      occurredOn,
      category,
      note,
      goalId,
      kind,
    });
    expect(accounting(attached)).toEqual(accounting(plain));
    expect(attached.receiptUri).not.toBeNull();
    expect(plain.receiptUri).toBeNull();
  });

  it('survives an edit that says nothing about it', () => {
    /*
      The three-valued rule `goalId` and `kind` already follow. Editing an amount from a screen that
      knows nothing about receipts must not detach the image and strand it.
    */
    const existing = createFinanceTransaction(
      {
        direction: 'expense',
        amountMinor: 1250,
        occurredOn: '2026-09-04',
        category: null,
        note: null,
        receiptUri: keptUri(OWNER),
      },
      ID,
      AT,
    );
    const validated = validateFinanceDraft(draft({ amountMinor: 9900 }));
    if (validated.kind !== 'valid') {
      throw new Error('the fixture draft must validate');
    }

    const revised = reviseFinanceTransaction(existing, validated.draft, AT);

    expect(revised.amountMinor).toBe(9900);
    expect(revised.receiptUri).toBe(existing.receiptUri);
  });

  it('detaches only when the draft says so', () => {
    const existing = createFinanceTransaction(
      {
        direction: 'expense',
        amountMinor: 1250,
        occurredOn: '2026-09-04',
        category: null,
        note: null,
        receiptUri: keptUri(OWNER),
      },
      ID,
      AT,
    );
    const validated = validateFinanceDraft(draft({ receiptUri: null }));
    if (validated.kind !== 'valid') {
      throw new Error('the fixture draft must validate');
    }

    expect(reviseFinanceTransaction(existing, validated.draft, AT).receiptUri).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Deleting the transaction deletes the image
// ─────────────────────────────────────────────────────────────────────────────

type Harness = {
  /** Whether the write was accepted. The new id is read from `ids()` once the act block settles. */
  readonly create: (input: FinanceDraft) => Promise<boolean>;
  readonly remove: (id: string) => Promise<void>;
  readonly ids: () => readonly string[];
};

async function mount(ownerId: string, storage: FinanceStorage): Promise<Harness> {
  /*
    A holder rather than a captured value. The provider hands a fresh state object to every render,
    so a harness closing over the one from mount would read a ledger that stopped updating after the
    first write — and every assertion below would then be about a stale snapshot.
  */
  const latest: { current: ReturnType<typeof useFinance> | null } = { current: null };

  function Probe() {
    const finance = useFinance();
    latest.current = finance;
    return <Text testID="ready">{finance.loading ? 'loading' : 'ready'}</Text>;
  }

  const repository = createFinanceLedgerRepository({ ownerId, storage });
  /* Receipts records money, so the ledger needs the currency it is recorded in. */
  await repository.setCurrency('AED');

  const view = await render(
    <FinanceProvider repository={repository}>
      <Probe />
    </FinanceProvider>,
  );
  await waitFor(() => expect(view.getByTestId('ready').props.children).toBe('ready'));

  const now = (): ReturnType<typeof useFinance> => {
    if (latest.current === null) {
      throw new Error('the probe did not mount');
    }
    return latest.current;
  };

  return {
    create: async (input) => {
      /*
        Only the outcome. React flushes the provider's state at the end of the enclosing `act`, so
        reading the ledger here would return the snapshot from before the write every time.
      */
      const result = await now().createTransaction(input);
      return result.kind === 'ok';
    },
    remove: async (id) => {
      await now().removeTransaction(id);
    },
    ids: () => now().ledger.transactions.map((transaction) => transaction.id),
  };
}

describe('removing the transaction removes the image it owned', () => {
  it('deletes the kept file and leaves the record gone', async () => {
    const uri = keptUri(OWNER);
    seedFile(uri);
    const { storage } = memory();
    const finance = await mount(OWNER, storage);

    let accepted = false;
    await act(async () => {
      accepted = await finance.create(draft({ receiptUri: uri }));
    });
    expect(accepted).toBe(true);
    const [id] = finance.ids();
    expect(id).toBeDefined();
    expect(new File(uri).exists).toBe(true);

    await act(async () => {
      await finance.remove(id as string);
    });

    expect(new File(uri).exists).toBe(false);
    expect(finance.ids()).toEqual([]);
  });

  it('touches no other kept image', async () => {
    const mine = keptUri(OWNER);
    const neighbour = keptUri(OWNER, `${'b'.repeat(32)}.jpg`);
    seedFile(mine);
    seedFile(neighbour);
    const { storage } = memory();
    const finance = await mount(OWNER, storage);

    await act(async () => {
      await finance.create(draft({ receiptUri: mine }));
    });
    const [id] = finance.ids();
    await act(async () => {
      await finance.remove(id as string);
    });

    /* One deletion, one file. A cascade that cleared the directory would fail here. */
    expect(new File(mine).exists).toBe(false);
    expect(new File(neighbour).exists).toBe(true);
  });

  it('cannot reach another account’s kept image', async () => {
    /*
      The containment guarantee, asserted through the whole stack rather than at the store alone. A
      record carrying a path under a different account is refused by the validator; even if one
      reached storage some other way, `discardRetainedImage` re-checks the root and refuses.
    */
    const foreign = keptUri(OTHER);
    seedFile(foreign, OTHER);
    const { storage } = memory();
    const finance = await mount(OWNER, storage);

    /*
      Shape alone cannot separate the two — both are well-formed paths under the retention root — so
      the validator accepts this and containment has to hold one layer down. This is the case that
      matters: a record naming *another account's* image, removed by *this* account.
    */
    expect(validateFinanceDraft(draft({ receiptUri: foreign })).kind).toBe('valid');

    await act(async () => {
      await finance.create(draft({ receiptUri: foreign }));
    });
    const [id] = finance.ids();
    await act(async () => {
      await finance.remove(id as string);
    });

    /* The record is gone; the other account's file is untouched, because the root did not match. */
    expect(finance.ids()).toEqual([]);
    expect(new File(foreign).exists).toBe(true);
  });

  it('removes a transaction that has no image without touching the directory', async () => {
    const untouched = keptUri(OWNER);
    seedFile(untouched);
    const { storage } = memory();
    const finance = await mount(OWNER, storage);

    await act(async () => {
      await finance.create(draft());
    });
    const [id] = finance.ids();
    await act(async () => {
      await finance.remove(id as string);
    });

    expect(finance.ids()).toEqual([]);
    expect(new File(untouched).exists).toBe(true);
  });

  it('does not delete the image when the record could not be removed', async () => {
    const uri = keptUri(OWNER);
    seedFile(uri);
    const { storage } = memory();
    const finance = await mount(OWNER, storage);

    await act(async () => {
      await finance.create(draft({ receiptUri: uri }));
    });

    /*
      Record first, file second. A removal that names nothing changes no record, so the image stays —
      the ordering that stops a failed delete from destroying evidence for a transaction that is
      still there.
    */
    await act(async () => {
      await finance.remove('finance.99999999-8888-4777-8666-555555555555');
    });

    expect(new File(uri).exists).toBe(true);
    expect(finance.ids()).toHaveLength(1);
  });
});

describe('the stored ledger carries the path and nothing about the receipt', () => {
  it('writes the attachment and no receipt content', async () => {
    const uri = keptUri(OWNER);
    seedFile(uri);
    const { rows, storage } = memory();
    const finance = await mount(OWNER, storage);

    await act(async () => {
      await finance.create(draft({ receiptUri: uri, note: 'Weekly shop' }));
    });

    const stored = rows.get(financeLedgerAddress(OWNER) ?? '') ?? '';
    expect(stored).toContain('finance-receipts');
    /*
      What must never appear: anything the recogniser read. The attachment is a path to an image and
      carries no merchant, no card fragment and no line item, which is what keeps a directory listing
      or a backup from disclosing a purchase.
    */
    expect(stored).not.toContain('MERCHANT');
    expect(stored).not.toMatch(/\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/);
  });
});
