import { FaithHomeContent } from './faith/faith-home-content';
import { NoorAIHomeContent } from './noor-ai/noor-ai-home-content';
import { HealthHomeContent } from './health/health-home-content';
import type { UseModuleOverview } from './use-module-overview';
import { FinanceHomeContent } from '@features/finance/screens/finance-home-content';
import { PlannerHomeContent } from '@features/planner/screens/planner-home-content';
import type { FrameworkModuleId } from './module-tokens';

/**
 * Per-module home compositions.
 *
 * ── The architecture correction, in one file ────────────────────────────────
 * The framework's mistake was not its components — it was assuming every module home is
 * the *same arrangement* of them. The approved individual-core-screen references disagree:
 * Faith has eight feature cards and a Continue-Quran row, Health has four metrics and a
 * Quick Log, and neither has the generic "quick actions / At a glance / Today" stack.
 *
 * So the shell stays shared and the arrangement becomes per module. A module handled below
 * renders its own composition; the rest fall back to the generic layout, which is what
 * Learning, Family and Goals still use.
 *
 * ── Why a switch rather than a lookup map ───────────────────────────────────
 * A `Record<id, ComponentType>` read during render produces a component *value*, and the
 * React Compiler rejects that: a component type resolved at render time can remount its
 * whole subtree if the reference ever changes. A switch returning JSX keeps every component
 * reference static, so the risk cannot arise — and it reads more directly besides.
 */
export function ModuleHomeComposition({
  moduleId,
  state,
}: {
  readonly moduleId: FrameworkModuleId;
  /*
    The overview state, forwarded rather than re-read. `ModuleHomeScreen` computes it for every
    module including the composed ones, where it used to be discarded — Health read a fixture
    instead (issue #27). Passing it keeps one read and one state for the screen.
  */
  readonly state: UseModuleOverview;
}) {
  switch (moduleId) {
    case 'noor-ai':
      return <NoorAIHomeContent />;
    case 'faith':
      return <FaithHomeContent />;
    case 'health':
      return <HealthHomeContent state={state} />;
    case 'planner':
      /*
        No providers here — issue #73.

        This used to mount both Planner stores, which shadowed the app-scoped task owner and the
        Planner stack's routine owner. A task added on the Tasks screen therefore never reached this
        home: pressing back revealed a copy that had read storage once, when the composition mounted.

        Tasks are owned by `TodayAgendaProvider` (app scope, because Main Home consumes them) and
        routines by `app/planner/_layout.tsx` (the Planner stack, because nothing outside it does).
        Both are above this component, so it reads them and re-renders with them.
      */
      return <PlannerHomeContent />;
    case 'finance':
      /*
        Finance reads its own ledger — issue #93.

        The generic branch resolves `empty` from the shared mock, which is correct for a module with
        no repository and wrong for one that now has a real store. This composition renders the same
        arrangement the generic branch does — hero, quick actions, "At a glance", capability grid —
        with the figures derived live instead of fixed. Nothing Finance had is dropped: unlike
        Planner, its quick actions and capability grid do render, and removing them here would be a
        regression dressed as a rewrite.
      */
      return <FinanceHomeContent state={state} />;
    default:
      // Learning, Family, Goals — awaiting their own reference passes.
      return null;
  }
}

/**
 * Module ids composed to their approved individual-core-screen reference.
 *
 * The single source for "does this module have its own layout?", used by the home screen to
 * choose a branch and by tests to assert that a composed module is *not* rendering the
 * generic sample layout.
 */
export const COMPOSED_MODULE_IDS: readonly FrameworkModuleId[] = [
  'noor-ai',
  'faith',
  'health',
  'planner',
  'finance',
];

export function hasApprovedComposition(moduleId: FrameworkModuleId): boolean {
  return COMPOSED_MODULE_IDS.includes(moduleId);
}
