import { PlannerProvider } from '@features/planner/di/planner-provider';
import { PlannerTasksScreen } from '@features/planner/screens/planner-tasks-screen';

/** Planner → Tasks. */
export default function Screen() {
  return (
    <PlannerProvider>
      <PlannerTasksScreen />
    </PlannerProvider>
  );
}
