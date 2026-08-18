import { createContext, useContext, useMemo, type ReactNode } from 'react';

import type { FaithRepositories } from '../data';
import { createMockFaithRepositories } from '../data/mock';

/**
 * Dependency injection for the Faith module.
 *
 * ── What this buys, concretely ──────────────────────────────────────────────
 * The phase requires that the future Quran Foundation implementation be swappable
 * "without changing presentation components". That is only true if no screen ever
 * imports a concrete repository. This context is the enforcement point: screens call
 * `useFaithRepositories()`, which returns an interface, and the only file that names a
 * concrete implementation is this one's default.
 *
 * A lint-visible consequence worth stating: if you find yourself importing anything from
 * `data/mock/` inside a screen, the swap has already been broken.
 *
 * ── Why the default is the mock rather than null ────────────────────────────
 * A null default would force every test and every route to wrap in a provider before
 * anything rendered, which in practice means people wrap at the top and forget the
 * seam exists. Defaulting to the mock keeps the app runnable with no provider, while
 * `FaithRepositoryProvider` remains the single place a different set is supplied.
 */
const FaithRepositoryContext = createContext<FaithRepositories | null>(null);

export type FaithRepositoryProviderProps = {
  /**
   * Overrides any subset of the repositories.
   *
   * Partial on purpose: a test that exercises the Tasbih screen should supply a Tasbih
   * repository and inherit the other eight, rather than constructing a full set it does
   * not care about.
   */
  readonly repositories?: Partial<FaithRepositories>;
  readonly children: ReactNode;
};

export function FaithRepositoryProvider({ repositories, children }: FaithRepositoryProviderProps) {
  const value = useMemo<FaithRepositories>(
    () => ({ ...createMockFaithRepositories(), ...repositories }),
    [repositories],
  );

  return (
    <FaithRepositoryContext.Provider value={value}>{children}</FaithRepositoryContext.Provider>
  );
}

/**
 * The Faith data sources for the current tree.
 *
 * Falls back to the mock set when no provider is mounted, so a route file does not have
 * to wrap itself. The returned object is stable across renders within a provider, which
 * matters because these go into effect dependency arrays.
 */
export function useFaithRepositories(): FaithRepositories {
  const injected = useContext(FaithRepositoryContext);
  // Module-level singleton so the no-provider path is referentially stable too —
  // building a fresh set per render would re-run every data effect forever.
  return injected ?? defaultRepositories;
}

const defaultRepositories: FaithRepositories = createMockFaithRepositories();
