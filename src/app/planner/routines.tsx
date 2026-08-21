import { PlannerRoutineProvider } from '@features/planner/di/planner-routine-provider';
import { PlannerRoutinesScreen } from '@features/planner/screens/planner-routines-screen';

/** Planner → Routines. */
export default function Screen() {
  return (
    <PlannerRoutineProvider>
      <PlannerRoutinesScreen />
    </PlannerRoutineProvider>
  );
}
