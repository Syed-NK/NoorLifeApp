import AsyncStorage from '@react-native-async-storage/async-storage';

import { isFinanceCurrency, type FinanceCurrency } from './finance-money';
import {
  FINANCE_LEDGER_SCHEMA_VERSION,
  MAX_FINANCE_TRANSACTIONS,
  canChangeCurrency,
  createFinanceTransaction,
  emptyFinanceLedger,
  parseFinanceLedgerEnvelope,
  reviseFinanceTransaction,
  sortFinanceTransactions,
  validateFinanceDraft,
  type FinanceDraft,
  type FinanceFault,
  type FinanceLedger,
} from './finance-ledger';
import { serializeFinanceWrite } from './finance-write-queue';

/**
 * **The account-scoped Finance ledger store** — issue #92.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The address is the account ─────────────────────────────────────────────
 * A ledger lives at `noorlife.finance.user.v1.<owner>.ledger`, and `<owner>` must match a v4-shaped
 * UUID or there is no address at all. That is the injective encoding: the accepted domain is a
 * fixed-width alphabet with no separator in it, so no two owners can produce the same key and no
 * owner can produce a key belonging to another namespace. An id carrying a dot, a wildcard, a
 * traversal segment or another user's id as a prefix is not escaped — it is **refused**, and a
 * refused address resolves `unavailable` before storage is touched.
 *
 * Signed out is the same path: no owner, no address, no read.
 *
 * ── Quarantine is not empty ────────────────────────────────────────────────
 * If the stored bytes do not decode, the repository reports `corrupt` and **writes nothing**. It
 * does not return an empty ledger, because the caller would then let the user add a transaction and
 * the write would overwrite whatever was really there. Data that cannot be read is not data that
 * should be destroyed — the bytes stay exactly as they are until something that understands them
 * arrives.
 *
 * That is asserted from both directions: a corrupt read reports corrupt, and a mutation attempted
 * against a corrupt ledger leaves the stored string byte-identical.
 *
 * ── One writer per ledger ──────────────────────────────────────────────────
 * Every mutation goes through `serializeFinanceWrite` keyed by the address, so two repository
 * instances pointed at one account queue behind each other instead of losing an update. The read
 * inside a mutation happens *inside* the lane, which is what makes read-modify-write atomic.
 *
 * ── No clock of its own ────────────────────────────────────────────────────
 * `occurredOn` arrives from the caller, which reads the shared Planner day source once per
 * operation. This file has `now` only for record timestamps, injected so a test can state it. There
 * is no Finance clock, no timer and no second definition of "today" — that was issue #76's whole
 * lesson.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const FINANCE_USER_NAMESPACE = 'noorlife.finance.user.v1';
const USER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type FinanceStorage = Pick<typeof AsyncStorage, 'getItem' | 'setItem'>;

export type FinanceReadResult =
  | { readonly kind: 'ok'; readonly ledger: FinanceLedger }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'corrupt' };

export type FinanceMutation =
  | { readonly kind: 'ok'; readonly ledger: FinanceLedger }
  | { readonly kind: 'invalid'; readonly fault: FinanceFault }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'corrupt' };

export type FinanceLedgerRepository = {
  /**
   * The owner this repository writes for, normalised, or `null` when there is none it will trust.
   *
   * Exposed for issue #101. Receipts keeps an optional image in a directory named for the account,
   * and the account it must be named for is *the one the transaction is written under* — not
   * whatever a screen resolved from the session separately. Two independent answers to "whose is
   * this" is exactly how a file ends up in one account's folder describing another's money.
   *
   * It is also what keeps `useAuth` out of the route files: `protected-route-boundary` is the only
   * thing under `src/app` allowed to read the session, and a Finance screen that needed the owner
   * would otherwise have had to break that rule to get it.
   */
  readonly ownerId: string | null;
  readonly read: () => Promise<FinanceReadResult>;
  /** Sets or changes the currency. Refused with `currency-locked` once a transaction exists. */
  readonly setCurrency: (currency: string) => Promise<FinanceMutation>;
  readonly createTransaction: (draft: FinanceDraft) => Promise<FinanceMutation>;
  readonly updateTransaction: (id: string, draft: FinanceDraft) => Promise<FinanceMutation>;
  readonly removeTransaction: (id: string) => Promise<FinanceMutation>;
};

export type FinanceRepositoryDeps = {
  readonly ownerId: string | null;
  readonly storage?: FinanceStorage;
  readonly id?: () => string;
  /** Record timestamps only. Never a source of "today" — see the note above. */
  readonly now?: () => Date;
};

/**
 * The storage address for an owner, or `null` when there is none that can be trusted.
 *
 * Exported so a test can assert the encoding directly, and so the provider can decide whether a
 * read is worth attempting at all.
 */
export function financeLedgerAddress(ownerId: string | null): string | null {
  const segment = financeOwnerSegment(ownerId);
  return segment === null ? null : `${FINANCE_USER_NAMESPACE}.${segment}.ledger`;
}

/**
 * The one derivation of "which account owns this", as an address segment.
 *
 * Extracted from `financeLedgerAddress` when Receipts gained an account-scoped directory for
 * retained images (#101). Finance now partitions in two places — a storage key and a filesystem
 * path — and a second copy of this rule would be a second partitioning scheme: one of them would
 * eventually admit an id the other refuses, and the two would disagree about whose data a file is.
 *
 * The rule itself is unchanged and deliberately unforgiving. Only a v4-shaped uuid is accepted, and
 * the accepted alphabet contains neither `.` nor `/` — so a segment can grow neither a key namespace
 * nor a directory, and an id carrying a traversal, a wildcard or another account's id as a prefix is
 * refused outright rather than escaped.
 */
export function financeOwnerSegment(ownerId: string | null): string | null {
  if (ownerId === null) {
    return null;
  }
  const trimmed = ownerId.trim().toLowerCase();
  return USER_ID_PATTERN.test(trimmed) ? trimmed : null;
}

function uuid(): string {
  /*
    `crypto.randomUUID` where the runtime has it. The fallback is not a security decision — ids are
    addresses, not secrets — it is a uniqueness one, and the shape is validated by the domain either
    way, so a malformed id fails loudly rather than being stored.
  */
  const cryptoRef = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoRef?.randomUUID === 'function') {
    return `finance.${cryptoRef.randomUUID()}`;
  }
  const hex = (length: number): string =>
    Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `finance.${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
}

export function createFinanceLedgerRepository(
  deps: FinanceRepositoryDeps,
): FinanceLedgerRepository {
  const storage: FinanceStorage = deps.storage ?? AsyncStorage;
  const now = deps.now ?? (() => new Date());
  const nextId = deps.id ?? uuid;
  const address = financeLedgerAddress(deps.ownerId);

  async function readAt(): Promise<FinanceReadResult> {
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
      return { kind: 'ok', ledger: emptyFinanceLedger() };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { kind: 'corrupt' };
    }
    const envelope = parseFinanceLedgerEnvelope(parsed);
    if (envelope === null) {
      return { kind: 'corrupt' };
    }
    return {
      kind: 'ok',
      ledger: {
        currency: envelope.currency,
        transactions: sortFinanceTransactions(envelope.transactions),
      },
    };
  }

  async function write(ledger: FinanceLedger): Promise<FinanceMutation> {
    if (address === null) {
      return { kind: 'unavailable' };
    }
    const envelope = {
      version: FINANCE_LEDGER_SCHEMA_VERSION,
      currency: ledger.currency,
      transactions: ledger.transactions,
    };
    try {
      await storage.setItem(address, JSON.stringify(envelope));
    } catch {
      return { kind: 'unavailable' };
    }
    return { kind: 'ok', ledger };
  }

  /**
   * Read, change, write — all inside one lane slot.
   *
   * The read has to be *inside* the serialized section. Reading outside it and writing inside would
   * still lose an update, because both writers would have read the same bytes before either queued.
   */
  function mutate(change: (ledger: FinanceLedger) => FinanceMutation): Promise<FinanceMutation> {
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
      const next = change(current.ledger);
      return next.kind === 'ok' ? write(next.ledger) : next;
    });
  }

  return {
    /* The normalised segment, so the filesystem path and the storage key cannot disagree. */
    ownerId: financeOwnerSegment(deps.ownerId),

    read: () => serializeFinanceWrite(address ?? 'finance.unavailable', readAt),

    setCurrency: (currency) =>
      mutate((ledger) => {
        if (!isFinanceCurrency(currency)) {
          return { kind: 'invalid', fault: 'unsupported-currency' };
        }
        if (!canChangeCurrency(ledger) && ledger.currency !== currency) {
          /*
            The rule, enforced where it cannot be forgotten. Re-selecting the *same* currency is
            allowed on a non-empty ledger because it changes nothing — refusing it would make an
            idempotent call an error.
          */
          return { kind: 'invalid', fault: 'currency-locked' };
        }
        return { kind: 'ok', ledger: { ...ledger, currency } };
      }),

    createTransaction: (draft) =>
      mutate((ledger) => {
        if (ledger.currency === null) {
          /* Money cannot be recorded before the ledger knows what money it is in. */
          return { kind: 'invalid', fault: 'no-currency' };
        }
        if (ledger.transactions.length >= MAX_FINANCE_TRANSACTIONS) {
          return { kind: 'invalid', fault: 'ledger-full' };
        }
        const validation = validateFinanceDraft(draft);
        if (validation.kind === 'invalid') {
          return validation;
        }
        const transaction = createFinanceTransaction(validation.draft, nextId(), now());
        return {
          kind: 'ok',
          ledger: {
            ...ledger,
            transactions: sortFinanceTransactions([...ledger.transactions, transaction]),
          },
        };
      }),

    updateTransaction: (id, draft) =>
      mutate((ledger) => {
        const existing = ledger.transactions.find((transaction) => transaction.id === id);
        if (existing === undefined) {
          return { kind: 'invalid', fault: 'not-found' };
        }
        const validation = validateFinanceDraft(draft);
        if (validation.kind === 'invalid') {
          return validation;
        }
        const revised = reviseFinanceTransaction(existing, validation.draft, now());
        return {
          kind: 'ok',
          ledger: {
            ...ledger,
            transactions: sortFinanceTransactions(
              ledger.transactions.map((transaction) =>
                transaction.id === id ? revised : transaction,
              ),
            ),
          },
        };
      }),

    removeTransaction: (id) =>
      mutate((ledger) => {
        if (!ledger.transactions.some((transaction) => transaction.id === id)) {
          return { kind: 'invalid', fault: 'not-found' };
        }
        return {
          kind: 'ok',
          ledger: {
            ...ledger,
            transactions: ledger.transactions.filter((transaction) => transaction.id !== id),
          },
        };
      }),
  };
}

export type { FinanceCurrency };
