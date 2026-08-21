import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

import {
  plannerOpenTasksDueOn,
  type PlannerAgendaItem,
} from '@features/planner/data/planner-agenda';
import { localDateKey } from '@features/planner/data/planner-task';
import type { PlannerTaskRepository } from '@features/planner/data/planner-task.repository';
import { PlannerProvider, usePlanner } from '@features/planner/di/planner-provider';

/**
 * **Today's agenda, as a read-only port** — so Main Home can show the user's real plan without
 * knowing that Planner exists.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── The problem this exists for ────────────────────────────────────────────
 * Main Home's "Today at a Glance" showed three invented rows — School drop-off at 8:00, Work focus
 * time at 10:00, Family dinner at 17:30 — while Planner correctly held zero tasks. Nobody created
 * them, they could not be completed or deleted, and they were indistinguishable from real
 * commitments. Two taps away, Planner promises *"NoorLife will not invent a schedule for you."*
 *
 * ── Why the boundary sits at the application layer ─────────────────────────
 * Home could have imported Planner directly — it already imports Faith for the live prayer row, so
 * there is precedent. It does not, for two reasons. Home is a *summary* of every module, so if each
 * module it summarises becomes an import, Home ends up coupled to all of them and every module change
 * reaches it. And the thing Home actually needs is far smaller than Planner's surface: a list of
 * titles and times for one day. A port that publishes exactly that cannot leak more later.
 *
 * So the dependency runs `home → application → planner`, and `src/application/providers` is already
 * where feature-owned providers are composed — `FaithScopeProvider`, `EntitlementProvider` and the
 * content-sync coordinator all live at this layer for the same reason.
 *
 * ── What this deliberately does not do ─────────────────────────────────────
 * It does not read storage, parse an envelope, or construct an account key. It wraps Planner's own
 * `PlannerProvider` and reads through `usePlanner`, so there is exactly one code path to Planner data
 * and one owner of the address, the parsing and the serialised writes. It is **not** a second store
 * and **not** a cache: it holds no state of its own and derives its value on each render from
 * Planner's.
 *
 * It also does not decide what "due today" means, or how a time is written. Both are questions about
 * what a task *is*, so both are answered by `plannerOpenTasksDueOn` inside Planner.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type TodayAgendaState = {
  /**
   * `loading` until Planner's first read settles, then `ready` or `unavailable`.
   *
   * `unavailable` is a distinct answer rather than an empty list, because "you have nothing planned"
   * and "we could not read your plan" are different sentences and the user acts differently on each.
   * Collapsing them is how a storage fault gets presented as a free afternoon.
   */
  readonly status: 'loading' | 'ready' | 'unavailable';
  /** Open tasks due today, in Planner's order. Empty when `status` is not `ready`. */
  readonly items: readonly PlannerAgendaItem[];
  /** The local day these items are for, so a caller can label them without reading its own clock. */
  readonly today: string;
  /** Re-read Planner. Called when Main Home reloads or regains focus. */
  readonly reload: () => Promise<void>;
};

const TodayAgendaContext = createContext<TodayAgendaState | null>(null);

export type TodayAgendaProviderProps = {
  readonly children: ReactNode;
  /**
   * A fixed reading, for tests and for previews.
   *
   * Injected the same way `PlannerProvider` takes a repository: a caller that supplies one gets it
   * published verbatim and **no** `PlannerProvider` is mounted, so a suite can state "today holds
   * these two tasks" without seeding storage or deriving an account key. Production passes nothing.
   */
  readonly state?: TodayAgendaState;
  /**
   * A Planner repository to read through, passed straight to `PlannerProvider`.
   *
   * Distinct from `state`: `state` replaces the reading, this replaces only the *storage* underneath
   * it, so the real selector, the real fail-closed rules and the real loading transitions all still
   * run. That is what a test wanting to prove account isolation or corrupt-store behaviour needs.
   * Production passes nothing.
   */
  readonly repository?: PlannerTaskRepository;
};

/**
 * Mounts Planner's provider and republishes the one slice of it summary surfaces may read.
 *
 * Placed inside `AuthProvider`, because `PlannerProvider` derives its account-scoped address from the
 * signed-in user and fails closed to `unavailable` when there is no owner. That is what keeps one
 * account's plan off another's Main Home, and it is Planner's rule rather than a second copy of it
 * here.
 */
export function TodayAgendaProvider({ children, state, repository }: TodayAgendaProviderProps) {
  if (state !== undefined) {
    return <TodayAgendaContext.Provider value={state}>{children}</TodayAgendaContext.Provider>;
  }
  return (
    <PlannerProvider {...(repository === undefined ? {} : { repository })}>
      <TodayAgendaPublisher>{children}</TodayAgendaPublisher>
    </PlannerProvider>
  );
}

/**
 * A ready reading with the given items, for a caller that only wants to state today's contents.
 *
 * Exists so a test says what it means — `todayAgenda([{ id, title, time }])` — rather than restating
 * the whole state shape and getting `status` or `reload` subtly wrong.
 */
export function todayAgenda(
  items: readonly PlannerAgendaItem[],
  overrides?: Partial<TodayAgendaState>,
): TodayAgendaState {
  return {
    status: 'ready',
    items,
    today: '',
    reload: () => Promise.resolve(),
    ...overrides,
  };
}

/** Split out because it has to read the context `TodayAgendaProvider` renders. */
function TodayAgendaPublisher({ children }: TodayAgendaProviderProps) {
  const planner = usePlanner();

  /*
    The day is read once per mount. Main Home is long-lived, so a date that recomputed on every render
    would be a different value across a midnight boundary mid-render; refreshing on focus is what
    picks up the new day, which is the same moment the user would expect the list to change.
  */
  const today = useMemo(() => localDateKey(new Date()), []);

  const items = useMemo(
    () => (planner.fault === null ? plannerOpenTasksDueOn(planner.tasks, today) : []),
    [planner.fault, planner.tasks, today],
  );

  /*
    `reload` must keep one identity for the life of the provider.

    Derived straight from `planner` it did not: `PlannerState` is a new object whenever tasks, loading
    or fault change, so every reload produced a new `reload`, which re-armed the caller's focus effect,
    which called reload again. That loop hung ninety-nine tests in three Main Home suites — the screens
    render the real provider tree, so they inherited it. Routing through a ref keeps the callback stable
    while still calling the current Planner.
  */
  const plannerRef = useRef(planner);
  useEffect(() => {
    plannerRef.current = planner;
  }, [planner]);
  const reload = useCallback(() => plannerRef.current.reload(), []);

  const value = useMemo<TodayAgendaState>(() => {
    const status: TodayAgendaState['status'] = planner.loading
      ? 'loading'
      : planner.fault === null
        ? 'ready'
        : 'unavailable';
    return { status, items: status === 'ready' ? items : [], today, reload };
  }, [items, planner.fault, planner.loading, reload, today]);

  return <TodayAgendaContext.Provider value={value}>{children}</TodayAgendaContext.Provider>;
}

/**
 * Today's agenda, or a safe empty reading outside the provider.
 *
 * Returns a `loading` state rather than throwing when no provider is present. A missing provider on
 * Main Home would otherwise take down the app's first screen, and this hook's whole purpose is to let
 * a summary surface say less rather than fail.
 */
export function useTodayAgenda(): TodayAgendaState {
  const value = useContext(TodayAgendaContext);
  if (value !== null) {
    return value;
  }
  return UNCONFIGURED;
}

/**
 * The reading outside a provider — one frozen value, not a fresh object per call.
 *
 * It was a literal, and that was a defect rather than a style choice: a new object every render gave
 * every `useCallback` and `useEffect` that depended on this state a new identity every render. Main
 * Home's focus effect re-armed on each pass and re-entered its own reload, and ninety-nine tests
 * across three suites failed with a torn-down environment. A hook that reports "nothing to say" must
 * report it with a stable value.
 */
const UNCONFIGURED: TodayAgendaState = {
  status: 'loading',
  items: [],
  today: '',
  reload: () => Promise.resolve(),
};
