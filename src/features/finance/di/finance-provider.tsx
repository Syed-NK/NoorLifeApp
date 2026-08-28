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

import {
  canChangeFinanceCurrency,
  type FinanceBudget,
  type FinanceBudgetDraft,
} from '../data/finance-budget';
import {
  createFinanceBudgetRepository,
  type FinanceBudgetMutation,
  type FinanceBudgetRepository,
} from '../data/finance-budget.repository';
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
 *
 * ── Budgets join the same owner, not a second one — issue #94 ──────────────
 * Budgets live at their own address and decode through their own version, so a malformed planning
 * record cannot quarantine the transactions. But they are read under **this** provider and switched
 * by **this** owner, because the alternative is two things that each believe they know whose data
 * they hold — and #73's lesson is that the moment there are two answers, one of them is stale.
 *
 * That is also what lets the currency rule stay whole. #92 refuses a currency change once money has
 * been recorded; a budget is money recorded in that currency, so the refusal has to see both stores
 * at once. It is composed here, where both are already held, rather than teaching the ledger domain
 * to read a store it should know nothing about.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type FinanceState = {
  readonly ledger: FinanceLedger;
  /** The account's budgets — issue #94. Planning intent only; spend is never stored. */
  readonly budgets: readonly FinanceBudget[];
  /**
   * Whose ledger this is, normalised, or `null` outside a session — issue #101.
   *
   * Read from the repository rather than from the session a second time. The repository is what
   * decides which address a write lands at, so anything that has to be scoped to the same account —
   * Receipts' optional retained image is the first — must take the owner from there or risk being
   * scoped to a different answer.
   */
  readonly ownerId: string | null;
  readonly loading: boolean;
  /** `corrupt-data` means quarantined: the stored bytes are intact and were not overwritten. */
  readonly fault: 'storage-unavailable' | 'corrupt-data' | null;
  /**
   * The budget store's own fault, separate from the ledger's — issue #94.
   *
   * Separate because the stores are separate: budgets that cannot be read must not take the
   * transactions down with them, and a Spending screen has no reason to stop working because a
   * planning record went bad.
   */
  readonly budgetFault: 'storage-unavailable' | 'corrupt-data' | null;
  /** Whether the ledger currency may still be set or changed — transactions *and* budgets. */
  readonly canChangeCurrency: boolean;
  readonly reload: () => Promise<void>;
  readonly setCurrency: (currency: string) => Promise<FinanceMutation>;
  readonly createTransaction: (draft: FinanceDraft) => Promise<FinanceMutation>;
  readonly updateTransaction: (id: string, draft: FinanceDraft) => Promise<FinanceMutation>;
  readonly removeTransaction: (id: string) => Promise<FinanceMutation>;
  readonly createBudget: (draft: FinanceBudgetDraft) => Promise<FinanceBudgetMutation>;
  readonly updateBudget: (id: string, draft: FinanceBudgetDraft) => Promise<FinanceBudgetMutation>;
  readonly removeBudget: (id: string) => Promise<FinanceBudgetMutation>;
};

const FinanceContext = createContext<FinanceState | null>(null);

export type FinanceProviderProps = {
  readonly children: ReactNode;
  readonly repository?: FinanceLedgerRepository;
  readonly budgetRepository?: FinanceBudgetRepository;
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

/** The budget half of the owned state. Its own fault, switched by the same owner. */
type OwnedBudgets = {
  readonly repository: FinanceBudgetRepository;
  readonly budgets: readonly FinanceBudget[];
  readonly loading: boolean;
  readonly fault: FinanceState['budgetFault'];
};

function absorbBudgets(
  repository: FinanceBudgetRepository,
  result: Awaited<ReturnType<FinanceBudgetRepository['read']>>,
): OwnedBudgets {
  if (result.kind === 'ok') {
    return { repository, budgets: result.budgets, loading: false, fault: null };
  }
  /*
    An empty list beside an error would let somebody create a budget against a store that has already
    refused to confirm itself — which, on the corrupt branch, is the write that would destroy the
    retained bytes.
  */
  return {
    repository,
    budgets: [],
    loading: false,
    fault: result.kind === 'corrupt' ? 'corrupt-data' : 'storage-unavailable',
  };
}

export function FinanceProvider({
  children,
  repository: injected,
  budgetRepository: injectedBudgets,
}: FinanceProviderProps) {
  const auth = useAuth();
  const ownerId = isLocallyAuthenticated(auth) ? (auth.user?.id ?? null) : null;
  const repository = useMemo(
    () => injected ?? createFinanceLedgerRepository({ ownerId }),
    [injected, ownerId],
  );
  const budgetRepository = useMemo(
    () => injectedBudgets ?? createFinanceBudgetRepository({ ownerId }),
    [injectedBudgets, ownerId],
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

  const [ownedBudgets, setOwnedBudgets] = useState<OwnedBudgets>(() => ({
    repository: budgetRepository,
    budgets: [],
    loading: true,
    fault: null,
  }));

  /* The same synchronous reset, for the same reason: no frame of one account's plan in another's. */
  if (ownedBudgets.repository !== budgetRepository) {
    setOwnedBudgets({ repository: budgetRepository, budgets: [], loading: true, fault: null });
  }

  useEffect(() => {
    let active = true;
    void budgetRepository.read().then((result) => {
      if (!active) {
        return;
      }
      setOwnedBudgets((current) =>
        current.repository === budgetRepository ? absorbBudgets(budgetRepository, result) : current,
      );
    });
    return () => {
      active = false;
    };
  }, [budgetRepository]);

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
    setOwnedBudgets((current) =>
      current.repository === budgetRepository ? { ...current, loading: true } : current,
    );
    /*
      Both stores, one reload. They are read together because a screen showing spent against
      budgeted needs both to be current — refreshing one on foreground and leaving the other would
      show this month's transactions against a stale plan.
    */
    const [result, budgetResult] = await Promise.all([repository.read(), budgetRepository.read()]);
    setOwned((current) =>
      current.repository === repository ? absorb(repository, result) : current,
    );
    setOwnedBudgets((current) =>
      current.repository === budgetRepository
        ? absorbBudgets(budgetRepository, budgetResult)
        : current,
    );
  }, [budgetRepository, repository]);

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

  /* The same late-owner refusal, for the budget store's own mutations. */
  const applyBudget = useCallback(
    async (operation: () => Promise<FinanceBudgetMutation>) => {
      const result = await operation();
      setOwnedBudgets((current) => {
        if (current.repository !== budgetRepository) {
          return current;
        }
        if (result.kind === 'ok') {
          return { ...current, budgets: result.budgets, fault: null };
        }
        if (result.kind === 'corrupt') {
          return { ...current, fault: 'corrupt-data' };
        }
        if (result.kind === 'unavailable') {
          return { ...current, fault: 'storage-unavailable' };
        }
        return current;
      });
      return result;
    },
    [budgetRepository],
  );

  /*
    The currency rule, composed across both stores — issue #94.

    #92 refuses a change once a transaction exists, because there is no honest conversion and
    relabelling recorded money is not one. A budget is an amount in that currency, so it counts: a
    ledger with no transactions but a 600.00 grocery budget must not silently reinterpret that as
    600 yen. The predicate lives with the budget domain; the composition happens here, where both
    stores are already held.
  */
  const canChange = canChangeFinanceCurrency(
    owned.ledger.transactions.length > 0,
    ownedBudgets.budgets,
  );

  const value = useMemo<FinanceState>(
    () => ({
      ledger: owned.ledger,
      budgets: ownedBudgets.budgets,
      ownerId: repository.ownerId,
      loading: owned.loading || ownedBudgets.loading,
      fault: owned.fault,
      budgetFault: ownedBudgets.fault,
      canChangeCurrency: canChange,
      reload,
      setCurrency: (currency) =>
        /*
          Refused here as well as in the ledger repository, because only this layer can see the
          budgets. The repository's own `currency-locked` still guards the transaction case; this
          adds the one it cannot see, and reports the same fault so the caller needs no new branch.
        */
        canChange
          ? apply(() => repository.setCurrency(currency))
          : Promise.resolve({ kind: 'invalid', fault: 'currency-locked' } as const),
      createTransaction: (draft) => apply(() => repository.createTransaction(draft)),
      updateTransaction: (id, draft) => apply(() => repository.updateTransaction(id, draft)),
      removeTransaction: (id) => apply(() => repository.removeTransaction(id)),
      createBudget: (draft) => applyBudget(() => budgetRepository.createBudget(draft)),
      updateBudget: (id, draft) => applyBudget(() => budgetRepository.updateBudget(id, draft)),
      removeBudget: (id) => applyBudget(() => budgetRepository.removeBudget(id)),
    }),
    [
      apply,
      applyBudget,
      budgetRepository,
      canChange,
      owned.fault,
      owned.ledger,
      owned.loading,
      ownedBudgets.budgets,
      ownedBudgets.fault,
      ownedBudgets.loading,
      reload,
      repository,
    ],
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
