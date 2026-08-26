import type { ReactNode } from 'react';

import { TodayAgendaProvider } from '@application/providers/today-agenda-provider';
import { createPlannerRoutineRepository } from '@features/planner/data/planner-routine.repository';
import { createPlannerTaskRepository } from '@features/planner/data/planner-task.repository';
import { PlannerRoutineProvider } from '@features/planner/di/planner-routine-provider';

/**
 * The two Planner state owners, for a test that renders a Planner surface outside the app tree.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ── Why a surface now needs this and did not before ────────────────────────
 * Planner's home composition used to mount its own providers, which is exactly the defect issue #73
 * removed: a provider inside a screen shadows the app's owner, so the screen reads a private copy and
 * every other surface goes stale. The composition now reads the owners above it — `TodayAgendaProvider`
 * for tasks, mounted app-wide, and `app/planner/_layout.tsx` for routines, mounted on the Planner
 * stack.
 *
 * A test that renders `ModuleHomeScreen moduleId="planner"` bare therefore renders it somewhere it
 * cannot exist in production, and `usePlanner` throws. That throw is correct and worth keeping: a
 * Planner surface outside its owner is the defect, and a hook that quietly returned an empty plan
 * instead would let it back in silently. This supplies the missing ancestors rather than softening
 * the rule.
 *
 * ── Empty by construction ──────────────────────────────────────────────────
 * Both repositories are built with a storage that holds nothing and accepts nothing, so a suite that
 * is really testing chrome — hero geometry, navigation height, robot size — gets a Planner home with
 * no tasks and no routines and never touches AsyncStorage. A suite that wants Planner *data* should
 * inject its own repositories instead, as the Planner suites do.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const OWNER = '00000000-0000-4000-8000-000000000000';

/** A store that is permanently empty and silently refuses writes. Nothing here has a fixture. */
const emptyStorage = {
  getItem: async (): Promise<string | null> => null,
  setItem: async (): Promise<void> => undefined,
};

export function PlannerOwners({ children }: { readonly children: ReactNode }) {
  return (
    <TodayAgendaProvider
      repository={createPlannerTaskRepository({ ownerId: OWNER, storage: emptyStorage })}
    >
      <PlannerRoutineProvider
        repository={createPlannerRoutineRepository({ ownerId: OWNER, storage: emptyStorage })}
      >
        {children}
      </PlannerRoutineProvider>
    </TodayAgendaProvider>
  );
}
