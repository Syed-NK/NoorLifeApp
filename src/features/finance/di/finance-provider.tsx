import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { isLocallyAuthenticated, useAuth } from '@application/providers/auth-provider';

import type { FinanceDraft, FinanceLedger } from '../data/finance-ledger';
import { emptyFinanceLedger } from '../data/finance-ledger';
import {
  createFinanceLedgerRepository,
  type FinanceLedgerRepository,
  type FinanceMutation,
} from '../data/finance-ledger.repository';

/**
 * **The one live copy of the signed-in account's ledger** — issue #92.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why there is exactly one, mounted at app scope ─────────────────────────
 * Planner learned this twice. Issue #73: a provider mounted per route shadows the app-scoped one, so
 * each screen holds a private copy and three surfaces disagree until relaunch. Issue #72: two live
 * repository instances lose an update. Finance starts with both answers already in place rather than
 * repeating the discovery — one provider, above every route, and a module-scoped write queue keyed
 * by storage address so instances serialize even if a second one is ever created.
 *
 * It costs nothing on the routes that do not want it. `financeLedgerAddress` returns `null` without
 * a signed-in owner, and the repository refuses every read **before touching storage**, so a public
 * or authentication route mounts a provider that resolves `unavailable` in one microtask and never
 * opens AsyncStorage. It gates nothing: this renders its children unconditionally and makes no
 * routing, entitlement or authentication decision. Finance's premium boundary is still
 * `ModuleEntitlementGate` in `app/finance/_layout.tsx`.
 *
 * ── Nothing consumes it yet, deliberately ──────────────────────────────────
 * #92 is the data foundation and nothing else. No Finance screen reads this hook, and the three
 * section screens are still the honest "Not built yet" placeholders — Spending is #93. Mounting the
 * owner now is what lets those screens be written against a store that already has its ownership,
 * serialization and quarantine settled.
 *
 * ── The account is the identity ────────────────────────────────────────────
 * The repository travels *with* the ledger, because the two must never be read apart: an account
 * change replaces the repository, and anything still holding the previous account's ledger has to be
 * recognisable as stale in the same instant. Keeping them in one state value makes that a comparison
 * rather than a race — the pattern `planner-provider` arrived at, reused here for the same reason.
 *
 * Signing out clears what is in memory. It does **not** delete the stored ledger: the account's
 * records are still theirs, and a sign-out that quietly destroyed financial history would be a data
 * loss disguised as a session boundary.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type FinanceState = {
  readonly ledger: FinanceLedger;
  readonly loading: boolean;
  /** `corrupt-data` means quarantined: the stored bytes are intact and were not overwritten. */
  readonly fault: 'storage-unavailable' | 'corrupt-data' | null;
  readonly reload: () => Promise<void>;
  readonly setCurrency: (currency: string) => Promise<FinanceMutation>;
  readonly createTransaction: (draft: FinanceDraft) => Promise<FinanceMutation>;
  readonly updateTransaction: (id: string, draft: FinanceDraft) => Promise<FinanceMutation>;
  readonly removeTransaction: (id: string) => Promise<FinanceMutation>;
};

const FinanceContext = createContext<FinanceState | null>(null);

export type FinanceProviderProps = {
  readonly children: ReactNode;
  readonly repository?: FinanceLedgerRepository;
};

type Owned = {
  readonly repository: FinanceLedgerRepository;
  readonly ledger: FinanceLedger;
  readonly loading: boolean;
  readonly fault: FinanceState['fault'];
};

function absorb(
  repository: FinanceLedgerRepository,
  result: Awaited<ReturnType<FinanceLedgerRepository['read']>>,
): Owned {
  if (result.kind === 'ok') {
    return { repository, ledger: result.ledger, loading: false, fault: null };
  }
  /*
    Nothing is displayed on a fault, and nothing is invented. An empty ledger beside an error would
    let somebody record a transaction against a store that has already refused to confirm itself —
    which, on the corrupt branch, is the write that would destroy the retained bytes.
  */
  return {
    repository,
    ledger: emptyFinanceLedger(),
    loading: false,
    fault: result.kind === 'corrupt' ? 'corrupt-data' : 'storage-unavailable',
  };
}

export function FinanceProvider({ children, repository: injected }: FinanceProviderProps) {
  const auth = useAuth();
  const ownerId = isLocallyAuthenticated(auth) ? (auth.user?.id ?? null) : null;
  const repository = useMemo(
    () => injected ?? createFinanceLedgerRepository({ ownerId }),
    [injected, ownerId],
  );

  const [owned, setOwned] = useState<Owned>(() => ({
    repository,
    ledger: emptyFinanceLedger(),
    loading: true,
    fault: null,
  }));

  /*
    Signing out, or switching account, must not leave the previous account's ledger on screen for the
    frame it takes a read to resolve. Adjusting state during render is React's documented answer to
    "this state is derived from a prop that changed", and the only synchronous one: an effect would
    publish the old ledger under the new repository first and correct it afterwards, which is a
    visible frame of one account's money inside another's session.
  */
  if (owned.repository !== repository) {
    setOwned({ repository, ledger: emptyFinanceLedger(), loading: true, fault: null });
  }

  useEffect(() => {
    let active = true;
    void repository.read().then((result) => {
      if (!active) {
        return;
      }
      /*
        Guarded twice on purpose. `active` covers the unmount; the identity check covers a read that
        was already in flight when the account changed — a late resolution that would otherwise
        publish account A's ledger into account B's session.
      */
      setOwned((current) =>
        current.repository === repository ? absorb(repository, result) : current,
      );
    });
    return () => {
      active = false;
    };
  }, [repository]);

  const reload = useCallback(async () => {
    setOwned((current) =>
      current.repository === repository ? { ...current, loading: true } : current,
    );
    const result = await repository.read();
    setOwned((current) =>
      current.repository === repository ? absorb(repository, result) : current,
    );
  }, [repository]);

  /*
    A stable handle on the current reload, for listeners that must not re-arm. `reload` changes
    identity whenever the repository does, and a reload-shaped dependency that re-arms its own effect
    is how ninety-nine tests once hung — `today-agenda-provider` records that at length.
  */
  const reloadRef = useRef(reload);
  useEffect(() => {
    reloadRef.current = reload;
  }, [reload]);

  /*
    Foreground reconciliation, owned here because the owner of the state is the only thing that can
    correctly own its refresh. Only the `active` transition triggers a read; `inactive` and
    `background` are the iOS app-switcher pass and do not.
  */
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void reloadRef.current();
      }
    });
    return () => subscription.remove();
  }, []);

  const apply = useCallback(
    async (operation: () => Promise<FinanceMutation>) => {
      const result = await operation();
      setOwned((current) => {
        /*
          A mutation that resolves after the account changed belongs to the account that started it.
          Its write went to that account's key — the address is captured per repository — so the only
          thing left to refuse is publishing its result into somebody else's session.
        */
        if (current.repository !== repository) {
          return current;
        }
        if (result.kind === 'ok') {
          return { ...current, ledger: result.ledger, fault: null };
        }
        if (result.kind === 'corrupt') {
          return { ...current, fault: 'corrupt-data' };
        }
        if (result.kind === 'unavailable') {
          return { ...current, fault: 'storage-unavailable' };
        }
        /* A validation refusal is not a store fault and must not raise one. */
        return current;
      });
      return result;
    },
    [repository],
  );

  const value = useMemo<FinanceState>(
    () => ({
      ledger: owned.ledger,
      loading: owned.loading,
      fault: owned.fault,
      reload,
      setCurrency: (currency) => apply(() => repository.setCurrency(currency)),
      createTransaction: (draft) => apply(() => repository.createTransaction(draft)),
      updateTransaction: (id, draft) => apply(() => repository.updateTransaction(id, draft)),
      removeTransaction: (id) => apply(() => repository.removeTransaction(id)),
    }),
    [apply, owned.fault, owned.ledger, owned.loading, reload, repository],
  );

  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>;
}

/**
 * The signed-in account's ledger.
 *
 * Throws outside the provider, deliberately: a Finance surface that reads a private copy is the
 * defect #73 removed from Planner, and a hook that quietly returned an empty ledger would let it
 * back in silently.
 */
export function useFinance(): FinanceState {
  const value = useContext(FinanceContext);
  if (value === null) {
    throw new Error('useFinance must be used inside a FinanceProvider.');
  }
  return value;
}

/**
 * The ledger, or `null` outside the provider.
 *
 * `useFinance` throws, deliberately — a Finance surface reading a private copy is the defect #73
 * removed from Planner. But Main Home is a *consumer*, not a Finance surface, and
 * `today-agenda-provider` records why that distinction matters: "a missing provider on Main Home
 * would otherwise take down the app's first screen". So the fan-in reads this instead and
 * contributes no row when there is no owner, which is the same safe-empty shape the agenda port
 * uses for the same reason.
 */
export function useOptionalFinance(): FinanceState | null {
  return useContext(FinanceContext);
}
