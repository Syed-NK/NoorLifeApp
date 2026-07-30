import { FaithHomeContent } from './faith/faith-home-content';
import { NoorAIHomeContent } from './noor-ai/noor-ai-home-content';
import { HealthHomeContent } from './health/health-home-content';
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
 * Planner, Finance, Learning, Family and Goals still use.
 *
 * ── Why a switch rather than a lookup map ───────────────────────────────────
 * A `Record<id, ComponentType>` read during render produces a component *value*, and the
 * React Compiler rejects that: a component type resolved at render time can remount its
 * whole subtree if the reference ever changes. A switch returning JSX keeps every component
 * reference static, so the risk cannot arise — and it reads more directly besides.
 */
export function ModuleHomeComposition({ moduleId }: { readonly moduleId: FrameworkModuleId }) {
  switch (moduleId) {
    case 'noor-ai':
      return <NoorAIHomeContent />;
    case 'faith':
      return <FaithHomeContent />;
    case 'health':
      return <HealthHomeContent />;
    default:
      // Planner, Finance, Learning, Family, Goals — awaiting their own reference passes.
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
export const COMPOSED_MODULE_IDS: readonly FrameworkModuleId[] = ['noor-ai', 'faith', 'health'];

export function hasApprovedComposition(moduleId: FrameworkModuleId): boolean {
  return COMPOSED_MODULE_IDS.includes(moduleId);
}
