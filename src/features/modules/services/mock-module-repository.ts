import type { FrameworkModuleId } from '../module-tokens';
import type {
  ModuleDataResult,
  ModuleRepository,
  ModuleRepositoryProvider,
} from './module-data.contract';

/**
 * In-memory module repositories — **carrying no user data, because there is none.**
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── What was here, and why it had to go (issue #23) ────────────────────────
 * A `FIXTURES` table gave every module a populated overview, and the generic module homes
 * rendered it as the signed-in user's own record. Finance showed *"Spent £412 this month"*,
 * *"Budget used 68%"* and a `Groceries · Today · £38.40` row. Health showed *"Steps 6,240"* and
 * *"Sleep 6h 20m — 40 minutes less than your average"*. Family showed *"Family dinner, Friday 7:00
 * pm"* and *"Eid photos added — By Fatima · yesterday"*, naming a person who does not exist. Goals
 * and Learning showed streaks. Each module also carried an "insight" that was a causal claim about
 * the user's life — *"Groceries are your largest category and rose 14% this month"*, *"Your sleep is
 * shorter on the nights you log an evening walk after 9 pm"*.
 *
 * None of it was the user's. Nobody could correct, complete or delete any of it, and no store
 * existed behind any of it — `finance`, `learning`, `family` and `goals` have no data layer at all.
 * Presented in the same cards and the same type as a real record, it was indistinguishable from one.
 *
 * The old docblock argued the fixtures were "realistic enough to prove the layout", and that a
 * framework validated only against empty data hides overflow and truncation defects. That argument
 * is sound — and it is an argument for a **development** tool, not for what a signed-in user sees.
 * The Module Gallery still reviews every component in every state; it now builds its own
 * self-evidently sample content, in a `__DEV__`-only screen, instead of borrowing the product's.
 *
 * ── Why there is no `populated` scenario any more ──────────────────────────
 * Not because nothing needs one, but because a `populated` path in production source is a
 * hard-coded dataset waiting to be filled in again. A module gets real data when it gets a real
 * repository; until then the honest answer is `empty`, and the module homes already render each
 * module's own onboarding copy for it — *"No transactions yet — Add what you spent today"* — which
 * is both true and more useful than an invented total.
 *
 * A test asserts no dataset returns here, so the next person to reach for one has to argue with a
 * failing test rather than with a comment.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/**
 * Which outcome a mock repository should produce.
 *
 * `populated` is deliberately absent. Every remaining value is a *state*, not content: they let the
 * Module Gallery and the framework suite reach the loading, empty, offline and failed branches
 * without a network, which is what `scenario` existed for.
 */
export type MockScenario = 'empty' | 'offline' | 'error';

/** Time the mock takes to resolve, so loading states are observable. */
const MOCK_LATENCY_MS = 350;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), MOCK_LATENCY_MS);
  });
}

/**
 * A repository that reports a state and never invents a record.
 *
 * `empty` is the default because it is the truth for every module that has no store yet: nothing
 * has been entered, so there is nothing to show. It is distinct from `ok` with no rows — the screen
 * renders the module's onboarding copy for the first and an unpopulated working surface for the
 * second — and this returns the former, because these modules are not working surfaces yet.
 */
export function createMockModuleRepository(
  moduleId: FrameworkModuleId,
  scenario: MockScenario = 'empty',
): ModuleRepository {
  return {
    moduleId,
    async getOverview(): Promise<ModuleDataResult<never>> {
      switch (scenario) {
        case 'offline':
          return delay({ kind: 'offline' as const });
        case 'error':
          return delay({
            kind: 'error' as const,
            code: 'unavailable' as const,
            detail: 'mock scenario: error',
          });
        case 'empty':
          return delay({ kind: 'empty' as const });
      }
    },
  };
}

export const mockModuleRepositoryProvider: ModuleRepositoryProvider = (moduleId) =>
  createMockModuleRepository(moduleId, 'empty');
